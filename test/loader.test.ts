import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MostraConfig } from '../src/config'
import { createMostra, type OverlayModule } from '../src/loader'
import { createOverlay, type Environment } from '../src/overlay'
import type { RealtimeOptions } from '../src/realtime'
import { HOST_TAG } from '../src/ui/mount'
import { createFakeChannel, createFakeConnection, flush, joinReply, maya, setUrl } from './helpers'

const config: MostraConfig = { projectKey: 'pk_demo00000000000000000000', endpoint: 'http://localhost:4000', version: 'abc1234' }
const tokenKey = 'mostra:pk_demo00000000000000000000:token'
const project = { id: 'project-1', name: 'Demo' }

function createTestMostra(environment: Pick<Environment, 'fetch' | 'connect'>) {
  return createMostra(config, async () => ({
    createOverlay: (overlayConfig, base) => createOverlay(overlayConfig, { ...base, ...environment }),
  }))
}

function fakeOverlayModule(): OverlayModule {
  return { createOverlay: () => ({ enable: async () => true, stop() {} }) }
}

type Route = (init: RequestInit | undefined) => Response | Promise<Response>

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function mockFetch(routes: Record<string, Route>) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${String(input)}`
    const route = routes[key]
    if (!route) throw new Error(`Unexpected request ${key}`)
    return route(init)
  })
}

function mockConnect() {
  const fakes: Array<ReturnType<typeof createFakeConnection>> = []
  const channels: Array<ReturnType<typeof createFakeChannel>> = []
  const connect = vi.fn((_options: RealtimeOptions) => {
    const channel = createFakeChannel()
    channels.push(channel)
    const fake = createFakeConnection(channel.channel)
    fakes.push(fake)
    return fake.connection
  })
  return { connect, fakes, channels }
}

const configRoute = `GET ${config.endpoint}/api/v1/projects/${config.projectKey}/config`
const sessionsRoute = `POST ${config.endpoint}/api/v1/reviewer_sessions`

function host(): HTMLElement | null {
  return document.querySelector(HOST_TAG)
}

function shadowQuery<Type extends Element>(selector: string): Type | null {
  return host()?.shadowRoot?.querySelector<Type>(selector) ?? null
}

let disable: (() => void) | null = null

beforeEach(() => {
  setUrl('/')
  window.localStorage.clear()
  window.sessionStorage.clear()
})

afterEach(() => {
  disable?.()
  disable = null
  document.querySelectorAll(HOST_TAG).forEach((element) => element.remove())
  document.querySelectorAll('script[data-project]').forEach((element) => element.remove())
  delete window.Mostra
  vi.doUnmock('../src/loader')
  vi.doUnmock('../src/overlay')
})

describe('dormancy', () => {
  it('makes no requests, imports no overlay code and changes no DOM without a token or invite', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
    const importOverlay = vi.fn(async () => fakeOverlayModule())
    const mutations: MutationRecord[] = []
    const observer = new MutationObserver((records) => mutations.push(...records))
    observer.observe(document, { childList: true, subtree: true, attributes: true })

    const mostra = createMostra(config, importOverlay)
    await flush()
    observer.disconnect()

    expect(importOverlay).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
    expect(mutations).toHaveLength(0)
    expect(mostra.version).toBe('abc1234')
    expect(await mostra.enable()).toBe(false)
    expect(importOverlay).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('imports the overlay once a reviewer has a token', async () => {
    const importOverlay = vi.fn(async () => fakeOverlayModule())
    const mostra = createMostra(config, importOverlay)
    expect(await mostra.enable()).toBe(false)

    window.localStorage.setItem(tokenKey, 'token-1')
    expect(await mostra.enable()).toBe(true)
    expect(await mostra.enable()).toBe(true)
    expect(importOverlay).toHaveBeenCalledOnce()
  })

  it('stays dormant when the overlay cannot be loaded', async () => {
    window.localStorage.setItem(tokenKey, 'token-1')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const mostra = createMostra(config, async () => Promise.reject(new TypeError('Failed to fetch dynamically imported module')))

    expect(await mostra.enable()).toBe(false)
    expect(warn).toHaveBeenCalledWith('[mostra] Could not load the overlay.', expect.any(TypeError))
    expect(host()).toBeNull()
  })

  describe('the script-tag entry', () => {
    function spyOnOverlayImport() {
      const importOverlay = vi.fn(async () => fakeOverlayModule())
      vi.doMock('../src/loader', async (importOriginal) => {
        const loader = await importOriginal<typeof import('../src/loader')>()
        return { ...loader, createMostra: (scriptConfig: MostraConfig) => loader.createMostra(scriptConfig, importOverlay) }
      })
      return importOverlay
    }

    function addScriptTag() {
      const script = document.createElement('script')
      script.dataset.project = config.projectKey
      script.dataset.version = 'from-tag'
      document.head.appendChild(script)
    }

    it('exposes window.Mostra, stays dormant and never imports the overlay', async () => {
      const fetch = vi.spyOn(globalThis, 'fetch')
      const importOverlay = spyOnOverlayImport()
      addScriptTag()
      const childCount = document.documentElement.childElementCount

      vi.resetModules()
      await import('../src/auto')
      await flush()

      expect(window.Mostra?.version).toBe('from-tag')
      expect(typeof window.Mostra?.enable).toBe('function')
      expect(typeof window.Mostra?.disable).toBe('function')
      expect(await window.Mostra?.enable()).toBe(false)
      expect(importOverlay).not.toHaveBeenCalled()
      expect(fetch).not.toHaveBeenCalled()
      expect(document.documentElement.childElementCount).toBe(childCount)
    })

    it('imports the overlay for a reviewer with a stored token', async () => {
      window.localStorage.setItem(tokenKey, 'token-1')
      const importOverlay = spyOnOverlayImport()
      addScriptTag()

      vi.resetModules()
      await import('../src/auto')

      await vi.waitFor(() => expect(importOverlay).toHaveBeenCalledOnce())
    })
  })

  describe('the npm entry', () => {
    function countOverlayImports() {
      const imports = vi.fn()
      vi.doMock('../src/overlay', () => {
        imports()
        return fakeOverlayModule()
      })
      return imports
    }

    it('stays dormant and never imports the overlay chunk', async () => {
      const fetch = vi.spyOn(globalThis, 'fetch')
      const imports = countOverlayImports()

      vi.resetModules()
      const { init } = await import('../src/index')
      const mostra = init({ project: config.projectKey })
      await flush()

      expect(window.Mostra).toBe(mostra)
      expect(await mostra.enable()).toBe(false)
      expect(imports).not.toHaveBeenCalled()
      expect(fetch).not.toHaveBeenCalled()
    })

    it('imports the overlay chunk after an invite', async () => {
      setUrl('/?mostra=demo-invite-token')
      const imports = countOverlayImports()

      vi.resetModules()
      const { init } = await import('../src/index')
      expect(await init({ project: config.projectKey }).enable('demo-invite-token')).toBe(true)
      expect(imports).toHaveBeenCalledOnce()
    })

    it('talks to mostra.design', async () => {
      const createOverlay = vi.fn(fakeOverlayModule().createOverlay)
      vi.doMock('../src/overlay', () => ({ createOverlay }))

      vi.resetModules()
      const { init } = await import('../src/index')
      await init({ project: config.projectKey }).enable('demo-invite-token')
      expect(createOverlay).toHaveBeenCalledWith(expect.objectContaining({ endpoint: 'https://mostra.design' }), expect.anything())
    })
  })
})

describe('with a stored token', () => {
  it('validates the project, connects with the token and mounts the overlay after joining', async () => {
    window.localStorage.setItem(tokenKey, 'token-1')
    const fetch = mockFetch({ [configRoute]: () => json({ project }) })
    const { connect, fakes } = mockConnect()

    const mostra = createTestMostra({ fetch, connect })
    disable = mostra.disable
    await vi.waitFor(() => expect(connect).toHaveBeenCalled())
    expect(connect.mock.calls[0]?.[0]).toMatchObject({ endpoint: config.endpoint, token: 'token-1', projectId: 'project-1' })
    expect(host()).toBeNull()

    fakes[0]!.join(joinReply())
    await vi.waitFor(() => expect(host()).not.toBeNull())
    expect(host()?.shadowRoot?.querySelector('[role="toolbar"]')).not.toBeNull()
  })

  it('forgets a token the server refuses at join and stays dormant', async () => {
    window.localStorage.setItem(tokenKey, 'expired')
    const fetch = mockFetch({ [configRoute]: () => json({ project }) })
    const { connect, fakes } = mockConnect()

    const mostra = createTestMostra({ fetch, connect })
    const enabled = mostra.enable()
    await vi.waitFor(() => expect(connect).toHaveBeenCalled())
    fakes[0]!.reject('unauthorized')

    expect(await enabled).toBe(false)
    expect(window.localStorage.getItem(tokenKey)).toBeNull()
    expect(fakes[0]!.disconnected).toBe(true)
    expect(host()).toBeNull()
  })

  it("leaves a newer token alone when a tab that woke up has its old one refused", async () => {
    window.localStorage.setItem(tokenKey, 'old')
    const fetch = mockFetch({ [configRoute]: () => json({ project }) })
    const { connect, fakes } = mockConnect()

    const enabled = createTestMostra({ fetch, connect }).enable()
    await vi.waitFor(() => expect(connect).toHaveBeenCalled())
    window.localStorage.setItem(tokenKey, 'newer, from another tab')
    fakes[0]!.reject('unauthorized')

    expect(await enabled).toBe(false)
    expect(window.localStorage.getItem(tokenKey)).toBe('newer, from another tab')
    expect(host()).toBeNull()
  })

  it('leaves a newer token alone when the project turns out to be unknown', async () => {
    window.localStorage.setItem(tokenKey, 'old')
    const fetch = mockFetch({
      [configRoute]: () => {
        window.localStorage.setItem(tokenKey, 'newer, from another tab')
        return new Response(null, { status: 404 })
      },
    })
    const { connect } = mockConnect()

    expect(await createTestMostra({ fetch, connect }).enable()).toBe(false)
    expect(window.localStorage.getItem(tokenKey)).toBe('newer, from another tab')
  })

  it('forgets the token when the project key is unknown', async () => {
    window.localStorage.setItem(tokenKey, 'token-1')
    const fetch = mockFetch({ [configRoute]: () => json({ errors: {} }, 404) })
    const { connect } = mockConnect()

    expect(await createTestMostra({ fetch, connect }).enable()).toBe(false)
    expect(window.localStorage.getItem(tokenKey)).toBeNull()
    expect(connect).not.toHaveBeenCalled()
  })

  it('keeps the token when the server is unreachable', async () => {
    window.localStorage.setItem(tokenKey, 'token-1')
    const fetch = mockFetch({ [configRoute]: () => Promise.reject(new TypeError('Failed to fetch')) })
    const { connect } = mockConnect()

    expect(await createTestMostra({ fetch, connect }).enable()).toBe(false)
    expect(window.localStorage.getItem(tokenKey)).toBe('token-1')
    expect(host()).toBeNull()
  })

  it('disable() forgets the token and removes the overlay', async () => {
    window.localStorage.setItem(tokenKey, 'token-1')
    const fetch = mockFetch({ [configRoute]: () => json({ project }) })
    const { connect, fakes } = mockConnect()
    const mostra = createTestMostra({ fetch, connect })
    await vi.waitFor(() => expect(connect).toHaveBeenCalled())
    fakes[0]!.join(joinReply())
    await vi.waitFor(() => expect(host()).not.toBeNull())

    mostra.disable()

    expect(host()).toBeNull()
    expect(window.localStorage.getItem(tokenKey)).toBeNull()
    expect(fakes[0]!.disconnected).toBe(true)
  })

  it('asks nothing of the server about a link when there is none', async () => {
    window.localStorage.setItem(tokenKey, 'token-1')
    const fetch = mockFetch({ [configRoute]: () => json({ project }) })
    const { connect } = mockConnect()

    disable = createTestMostra({ fetch, connect }).disable
    await vi.waitFor(() => expect(connect).toHaveBeenCalled())

    expect(fetch.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
  })
})

describe('a link opened where a token is already stored', () => {
  const posted = (fetch: ReturnType<typeof mockFetch>) => fetch.mock.calls.filter(([, init]) => init?.method === 'POST').map(([, init]) => JSON.parse(String(init?.body)))

  beforeEach(() => {
    window.localStorage.setItem(tokenKey, 'token-1')
    setUrl('/?mostra=the-link&tab=2&mostra_comment=38')
  })

  it('takes a builder link: the new token replaces the stored one and starts', async () => {
    const fetch = mockFetch({ [sessionsRoute]: () => json({ token: 'builder-token', reviewer: maya, project }, 201) })
    const { connect, fakes, channels } = mockConnect()

    disable = createTestMostra({ fetch, connect }).disable
    await vi.waitFor(() => expect(connect).toHaveBeenCalled())

    expect(posted(fetch)).toEqual([{ project_key: config.projectKey, invite_token: 'the-link', builder_only: true }])
    expect(window.localStorage.getItem(tokenKey)).toBe('builder-token')
    expect(connect).toHaveBeenCalledOnce()
    expect(connect.mock.calls[0]?.[0]).toMatchObject({ token: 'builder-token', projectId: 'project-1' })
    expect(window.location.search).toBe('?tab=2')

    fakes[0]!.join(joinReply())
    await vi.waitFor(() => expect(channels[0]!.pushes.find((push) => push.event === 'comment:get')?.payload).toEqual({ number: 38 }))
  })

  it("keeps the stored token for a link that isn't a builder's, and creates nobody", async () => {
    const fetch = mockFetch({
      [sessionsRoute]: () => json({ errors: { detail: 'Not a builder link' }, reason: 'not_a_builder_link' }, 409),
      [configRoute]: () => json({ project }),
    })
    const { connect, fakes, channels } = mockConnect()

    disable = createTestMostra({ fetch, connect }).disable
    await vi.waitFor(() => expect(connect).toHaveBeenCalled())

    expect(posted(fetch)).toEqual([{ project_key: config.projectKey, invite_token: 'the-link', builder_only: true }])
    expect(window.localStorage.getItem(tokenKey)).toBe('token-1')
    expect(connect.mock.calls[0]?.[0].token).toBe('token-1')

    fakes[0]!.join(joinReply())
    await vi.waitFor(() => expect(channels[0]!.pushes.find((push) => push.event === 'comment:get')?.payload).toEqual({ number: 38 }))
  })

  it.each([
    ['an expired link', () => json({ errors: { detail: 'Expired' }, reason: 'expired', from_name: 'Dima' }, 401)],
    ['a turned-off link', () => json({ errors: { detail: 'Off' }, reason: 'revoked', from_name: 'Dima' }, 401)],
    ['too many requests', () => json({ reason: 'rate_limited' }, 429)],
    ['a server error', () => new Response('oops', { status: 500 })],
    ['an unknown project', () => json({ errors: { detail: 'No' } }, 404)],
    ['no network', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['a success that says nothing', () => new Response('not json', { status: 201 })],
  ])('keeps the stored token, with no card, on %s', async (_name, answer) => {
    const fetch = mockFetch({ [sessionsRoute]: answer, [configRoute]: () => json({ project }) })
    const { connect } = mockConnect()

    disable = createTestMostra({ fetch, connect }).disable
    await vi.waitFor(() => expect(connect).toHaveBeenCalled())

    expect(window.localStorage.getItem(tokenKey)).toBe('token-1')
    expect(connect.mock.calls[0]?.[0].token).toBe('token-1')
    expect(host()?.shadowRoot?.querySelector('[role="alertdialog"]') ?? null).toBeNull()
  })

  it('redeems the link as usual when the stored token then turns out to be dead', async () => {
    const bodies: Array<{ builder_only?: boolean }> = []
    const fetch = mockFetch({
      [sessionsRoute]: (init) => {
        const body = JSON.parse(String(init?.body))
        bodies.push(body)
        return body.builder_only ? json({ reason: 'not_a_builder_link' }, 409) : json({ token: 'guest-token', reviewer: maya, project }, 201)
      },
      [configRoute]: () => json({ project }),
    })
    const { connect, fakes } = mockConnect()

    disable = createTestMostra({ fetch, connect }).disable
    await vi.waitFor(() => expect(connect).toHaveBeenCalled())
    expect(connect.mock.calls[0]?.[0].token).toBe('token-1')

    fakes[0]!.reject('unauthorized')
    await vi.waitFor(() => expect(connect).toHaveBeenCalledTimes(2))

    expect(bodies.map((body) => body.builder_only ?? false)).toEqual([true, false])
    expect(connect.mock.calls[1]?.[0].token).toBe('guest-token')
    expect(window.localStorage.getItem(tokenKey)).toBe('guest-token')
  })

  it('asks for nothing special with nothing stored, as that is an ordinary first visit', async () => {
    window.localStorage.removeItem(tokenKey)
    const fetch = mockFetch({ [sessionsRoute]: () => json({ token: 'first-token', reviewer: maya, project }, 201) })
    const { connect } = mockConnect()

    disable = createTestMostra({ fetch, connect }).disable
    await vi.waitFor(() => expect(connect).toHaveBeenCalled())

    expect(posted(fetch)).toEqual([{ project_key: config.projectKey, invite_token: 'the-link' }])
  })
})

describe('the mostra parameters', () => {
  it('leave the address before the overlay is imported or anything is sent', () => {
    setUrl('/pricing?mostra=demo-invite-token&mostra_comment=38&plan=pro#faq')
    const addressAtImport: string[] = []
    const fetch = vi.spyOn(globalThis, 'fetch')

    createMostra(config, async () => {
      addressAtImport.push(window.location.href)
      return fakeOverlayModule()
    })

    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe('/pricing?plan=pro#faq')
    expect(addressAtImport).toEqual([])
    expect(fetch).not.toHaveBeenCalled()
  })

  it('leave for a person with a stored token too', () => {
    window.localStorage.setItem(tokenKey, 'token-1')
    setUrl('/?mostra_comment=38&tab=2')
    createMostra(config, async () => fakeOverlayModule())
    expect(window.location.search).toBe('?tab=2')
  })

  it("stay for a visitor who isn't a reviewer: this script touches nothing for them", async () => {
    setUrl('/?mostra_comment=38&tab=2')
    const replaceState = vi.spyOn(window.history, 'replaceState')
    createMostra(config, async () => fakeOverlayModule())
    await flush()
    expect(replaceState).not.toHaveBeenCalled()
    expect(window.location.search).toBe('?mostra_comment=38&tab=2')
  })

  it('still redeem the invite and open the deep link after leaving the address', async () => {
    setUrl('/?mostra=demo-invite-token&mostra_comment=38')
    const fetch = mockFetch({ [sessionsRoute]: () => json({ token: 'signed-token', reviewer: maya, project }, 201) })
    const { connect, fakes, channels } = mockConnect()

    disable = createTestMostra({ fetch, connect }).disable
    await vi.waitFor(() => expect(connect).toHaveBeenCalled())
    const post = fetch.mock.calls.find(([, init]) => init?.method === 'POST')
    expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({ invite_token: 'demo-invite-token' })

    fakes[0]!.join(joinReply())
    await vi.waitFor(() => expect(channels[0]!.pushes.find((push) => push.event === 'comment:get')?.payload).toEqual({ number: 38 }))
  })

  it('open the deep link once, not again after stopping and starting', async () => {
    window.localStorage.setItem(tokenKey, 'token-1')
    setUrl('/?mostra_comment=38')
    const fetch = mockFetch({ [configRoute]: () => json({ project }) })
    const { connect, fakes, channels } = mockConnect()

    const mostra = createTestMostra({ fetch, connect })
    await vi.waitFor(() => expect(connect).toHaveBeenCalledOnce())
    fakes[0]!.join(joinReply())
    await vi.waitFor(() => expect(host()).not.toBeNull())
    await flush()
    expect(channels[0]!.pushes.some((push) => push.event === 'comment:get')).toBe(true)

    mostra.disable()
    window.localStorage.setItem(tokenKey, 'token-1')
    void mostra.enable()
    await vi.waitFor(() => expect(connect).toHaveBeenCalledTimes(2))
    fakes[1]!.join(joinReply())
    await flush()
    expect(channels[1]!.pushes.some((push) => push.event === 'comment:get')).toBe(false)
    disable = mostra.disable
  })

  it('work from what was read if the browser refuses to change the address', async () => {
    setUrl('/?mostra=demo-invite-token&mostra_comment=38')
    vi.spyOn(window.history, 'replaceState').mockImplementation(() => {
      throw new DOMException('Refused', 'SecurityError')
    })
    const fetch = mockFetch({ [sessionsRoute]: () => json({ token: 'signed-token', reviewer: maya, project }, 201) })
    const { connect, fakes, channels } = mockConnect()

    disable = createTestMostra({ fetch, connect }).disable
    await vi.waitFor(() => expect(connect).toHaveBeenCalled())
    expect(window.localStorage.getItem(tokenKey)).toBe('signed-token')
    expect(window.location.search).toBe('?mostra=demo-invite-token&mostra_comment=38')

    fakes[0]!.join(joinReply())
    await vi.waitFor(() => expect(channels[0]!.pushes.find((push) => push.event === 'comment:get')?.payload).toEqual({ number: 38 }))
  })

  it('are read by the overlay itself when the page calls enable later', async () => {
    setUrl('/?mostra_comment=38')
    const fetch = mockFetch({ [sessionsRoute]: () => json({ token: 'signed-token', reviewer: maya, project }, 201) })
    const { connect, fakes, channels } = mockConnect()

    const mostra = createTestMostra({ fetch, connect })
    disable = mostra.disable
    expect(window.location.search).toBe('?mostra_comment=38')
    void mostra.enable('demo-invite-token')
    await vi.waitFor(() => expect(connect).toHaveBeenCalled())
    expect(window.location.search).toBe('')

    fakes[0]!.join(joinReply())
    await vi.waitFor(() => expect(channels[0]!.pushes.find((push) => push.event === 'comment:get')?.payload).toEqual({ number: 38 }))
  })
})

describe('invite flow', () => {
  const card = () => host()?.shadowRoot?.querySelector('[role="alertdialog"]')

  it('trades the link for a token without asking anything, strips it and starts', async () => {
    setUrl('/pricing?mostra=demo-invite-token&plan=pro#faq')
    const fetch = mockFetch({ [sessionsRoute]: () => json({ token: 'signed-token', reviewer: maya, project }, 201) })
    const { connect, fakes } = mockConnect()

    disable = createTestMostra({ fetch, connect }).disable
    await vi.waitFor(() => expect(connect).toHaveBeenCalled())
    const post = fetch.mock.calls.find(([, init]) => init?.method === 'POST')
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ project_key: config.projectKey, invite_token: 'demo-invite-token' })
    expect(window.localStorage.getItem(tokenKey)).toBe('signed-token')
    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe('/pricing?plan=pro#faq')
    expect(connect.mock.calls[0]?.[0]).toMatchObject({ token: 'signed-token', projectId: 'project-1' })
    expect(fetch).toHaveBeenCalledTimes(1)

    fakes[0]!.join(joinReply({ invite: { from_name: 'Dima', note: 'Is the new pricing clear?' }, last_seen_at: null }))
    await vi.waitFor(() => expect(shadowQuery('[role="toolbar"]')).not.toBeNull())
    expect(shadowQuery('#mostra-card-title')?.textContent).toBe('Dima asked for your review of Lumen')
  })

  it("shows the error card for an expired or turned-off link, with the inviter's name, and does nothing else", async () => {
    for (const [reason, headline] of [
      ['expired', 'This link has expired.'],
      ['revoked', 'This link was turned off.'],
    ]) {
      setUrl('/?mostra=old-link')
      const fetch = mockFetch({ [sessionsRoute]: () => json({ errors: { detail: 'no' }, reason, from_name: 'Dima' }, 401) })
      const { connect } = mockConnect()

      expect(await createTestMostra({ fetch, connect }).enable('old-link')).toBe(false)
      expect(card()?.textContent).toBe(`${headline}Ask Dima for a new one.`)
      expect(window.location.search).toBe('')
      expect(window.localStorage.getItem(tokenKey)).toBeNull()
      expect(connect).not.toHaveBeenCalled()

      card()!.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      expect(host()).toBeNull()
    }
  })

  it('shows the setup card for an unknown project, and does nothing else', async () => {
    setUrl('/?mostra=invite')
    const fetch = mockFetch({ [sessionsRoute]: () => json({ errors: { detail: 'no' } }, 404) })
    const { connect } = mockConnect()

    expect(await createTestMostra({ fetch, connect }).enable('invite')).toBe(false)
    expect(card()?.textContent).toBe("This site's mostra tag doesn't match any project.Copy the tag from Setup in the dashboard, or pass this on to whoever invited you.")
    expect(window.location.search).toBe('')
    expect(window.localStorage.getItem(tokenKey)).toBeNull()
    expect(connect).not.toHaveBeenCalled()

    card()!.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(host()).toBeNull()
  })
})
