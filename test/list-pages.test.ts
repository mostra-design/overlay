import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createController } from '../src/controller'
import type { CommentSummary, JoinReply } from '../src/protocol'
import { safeStorage, storageKeys } from '../src/storage'
import { HOST_TAG, mountOverlay } from '../src/ui/mount'
import { createFakeChannel, createFakeConnection, flush, joinReply, makeComment, maya, setUrl, v15 } from './helpers'

const keys = storageKeys('pk_test')
const PAGE = 200
let cleanup: Array<() => void> = []

const row = (number: number, overrides: Partial<CommentSummary> = {}): CommentSummary => ({ ...makeComment({ id: `c${number}`, number, author: maya, page_url: '/elsewhere', ...overrides }), reply_count: 0, last_activity_at: '2026-10-24T20:00:00.000000Z' })

function pagesOf(total: number) {
  return ({ after }: { after?: number }) => {
    const from = after ?? 0
    const comments = Array.from({ length: Math.max(0, Math.min(PAGE, total - from)) }, (_unused, index) => row(from + index + 1))
    return { comments, next_after: comments.length === PAGE ? comments[comments.length - 1]!.number : null }
  }
}

function setup(respond: (payload: any) => unknown, reply: Partial<JoinReply> = {}) {
  const channel = createFakeChannel()
  const connection = createFakeConnection(channel.channel)
  channel.respond('comments:list', respond)
  const controller = createController({
    window,
    version: '9be01d7',
    local: safeStorage(window, 'localStorage'),
    session: safeStorage(window, 'sessionStorage'),
    keys,
    connect: () => connection.connection,
    onRejected: vi.fn(),
    onStop: vi.fn(),
    navigate: vi.fn(),
    deepLink: null,
    peekMs: () => 0,
  })
  cleanup.push(() => controller.destroy())
  connection.join(joinReply(reply))
  const requests = () => channel.pushes.filter((push) => push.event === 'comments:list').map((push) => push.payload)
  const numbers = () => Array.from(controller.store.get().summaries?.values() ?? [], (summary) => summary.number)
  return { controller, channel, requests, numbers }
}

beforeEach(() => {
  setUrl('/pricing')
  window.localStorage.clear()
  window.sessionStorage.clear()
  document.body.innerHTML = '<p>The page</p>'
})

afterEach(() => {
  vi.useRealTimers()
  for (const finish of cleanup.splice(0)) finish()
})

describe('loading the list', () => {
  it('goes on until the server says that was all', async () => {
    const { controller, requests, numbers } = setup(pagesOf(450))

    await controller.loadSummaries()

    expect(requests()).toEqual([{ filter: 'all' }, { filter: 'all', after: 200 }, { filter: 'all', after: 400 }])
    expect(numbers()).toHaveLength(450)
    expect(numbers().at(-1)).toBe(450)
  })

  it('asks once when one page holds it all', async () => {
    const { controller, requests, numbers } = setup(pagesOf(3))
    await controller.loadSummaries()
    expect(requests()).toEqual([{ filter: 'all' }])
    expect(numbers()).toEqual([1, 2, 3])
  })

  it('shows each page as it arrives', async () => {
    const { controller, numbers } = setup(pagesOf(450))
    const seen: number[] = []
    controller.store.subscribe(() => seen.push(numbers().length))
    await controller.loadSummaries()
    expect(seen).toEqual([200, 400, 450])
  })

  it('stops when the server says rate_limited, and keeps what it has', async () => {
    const pages = pagesOf(1000)
    const { controller, requests, numbers } = setup((payload) => (payload.after === 400 ? { status: 'error', response: { reason: 'rate_limited' } } : pages(payload)))

    await expect(controller.loadSummaries()).resolves.toBeUndefined()

    expect(requests()).toHaveLength(3)
    expect(numbers()).toHaveLength(400)
  })

  it('stops the same way when a page times out', async () => {
    const pages = pagesOf(1000)
    const { controller, numbers } = setup((payload) => (payload.after === 200 ? { status: 'timeout' } : pages(payload)))
    await controller.loadSummaries()
    expect(numbers()).toHaveLength(200)
  })

  it('gives up on a list that never ends, however the server words it', async () => {
    const { controller, requests, numbers } = setup(({ after }) => {
      const from = after ?? 0
      return { comments: [row(from + 1)], next_after: from + 1 }
    })
    await controller.loadSummaries()
    expect(requests()).toHaveLength(25)
    expect(numbers()).toHaveLength(25)
  })

  it.each([
    ['one that stays where it is', 1],
    ['one that goes back', 0],
    ['one that is not a number', 'more'],
    ['none at all', undefined],
  ])('stops at a cursor that goes nowhere: %s', async (_name, nextAfter) => {
    const { controller, requests, numbers } = setup(({ after }) => (after === undefined ? { comments: [row(1)], next_after: 1 } : { comments: [row(2)], next_after: nextAfter }))
    await controller.loadSummaries()
    expect(requests()).toHaveLength(2)
    expect(numbers()).toEqual([1, 2])
  })

  it('survives a page that is not a list', async () => {
    const { controller, numbers } = setup(({ after }) => (after === undefined ? { comments: [row(1)], next_after: 1 } : { comments: null, next_after: null }))
    await expect(controller.loadSummaries()).resolves.toBeUndefined()
    expect(numbers()).toEqual([1])
  })

  it('makes someone who asks during a load wait for all of it', async () => {
    const { controller, numbers } = setup(pagesOf(450))
    const first = controller.loadSummaries()
    await flush()
    await controller.loadSummaries()
    expect(numbers()).toHaveLength(450)
    await first
  })

  it('steps through comments past the first page', async () => {
    const { controller, channel } = setup(pagesOf(450))
    channel.respond('comment:get', ({ number }: { number: number }) => ({ comment: makeComment({ id: `c${number}`, number, page_url: '/pricing' }), replies: [] }))
    await controller.step(-1)
    expect(controller.store.get().stepper?.numbers).toHaveLength(450)
  })
})

describe('reloading the list', () => {
  it('drops what has gone, within what it read', async () => {
    let rows = [1, 2, 3]
    const { controller, numbers } = setup(() => ({ comments: rows.map((number) => row(number)), next_after: null }))
    await controller.loadSummaries()
    rows = [1, 3]
    await controller.loadSummaries(true)
    expect(numbers()).toEqual([1, 3])
  })

  it('reloads a one-page list every time it opens', async () => {
    const { controller, requests } = setup(pagesOf(3))
    await controller.loadSummaries()
    await controller.loadSummaries(true)
    await controller.loadSummaries(true)
    expect(requests()).toHaveLength(3)
  })

  it('keeps what it never got back to when cut short, rather than a list that shrinks', async () => {
    let limited = false
    const pages = pagesOf(450)
    const { controller, numbers } = setup((payload) => (limited && payload.after === 200 ? { status: 'error', response: { reason: 'rate_limited' } } : pages(payload)))
    await controller.loadSummaries()
    expect(numbers()).toHaveLength(450)

    vi.useFakeTimers({ now: Date.now() + 61_000, toFake: ['Date'] })
    limited = true
    await controller.loadSummaries(true)
    expect(numbers()).toHaveLength(450)
  })

  it('keeps everything when the reload is refused outright', async () => {
    let limited = false
    const pages = pagesOf(3)
    const { controller, numbers } = setup((payload) => (limited ? { status: 'error', response: { reason: 'rate_limited' } } : pages(payload)))
    await controller.loadSummaries()
    limited = true
    await controller.loadSummaries(true)
    expect(numbers()).toEqual([1, 2, 3])
  })

  it("doesn't spend a person's reads on reopening a long list, which joining shares", async () => {
    const { controller, requests } = setup(pagesOf(450))
    await controller.loadSummaries()
    expect(requests()).toHaveLength(3)

    for (let open = 0; open < 10; open++) await controller.loadSummaries(true)
    expect(requests()).toHaveLength(3)

    vi.useFakeTimers({ now: Date.now() + 61_000, toFake: ['Date'] })
    await controller.loadSummaries(true)
    expect(requests()).toHaveLength(6)
  })
})

describe('what the list shows', () => {
  const whole = `${'word '.repeat(300)}and the end`
  const cut = `${whole.slice(0, 500)}...`

  function mounted(comments: CommentSummary[] | ((payload: any) => unknown), answerGet: (number: number) => unknown = (number) => ({ comment: makeComment({ id: `c${number}`, number, author: maya, page_url: '/pricing', body: whole }), replies: [] })) {
    const channel = createFakeChannel()
    const connection = createFakeConnection(channel.channel)
    channel.respond('comments:list', typeof comments === 'function' ? comments : () => ({ comments, next_after: null }))
    channel.respond('comment:get', ({ number }: { number: number }) => answerGet(number))
    const controller = createController({
      window,
      version: '9be01d7',
      local: safeStorage(window, 'localStorage'),
      session: safeStorage(window, 'sessionStorage'),
      keys,
      connect: () => connection.connection,
      onRejected: vi.fn(),
      onStop: vi.fn(),
      navigate: vi.fn(),
      deepLink: null,
      peekMs: () => 0,
    })
    const unmount = mountOverlay(controller, window, null)
    cleanup.push(() => {
      unmount()
      controller.destroy()
    })
    connection.join(joinReply({ reviewer: maya }))
    return { controller, shadow: () => document.querySelector(HOST_TAG)!.shadowRoot! }
  }

  it('counts every page in the toolbar', async () => {
    const { controller, shadow } = mounted(pagesOf(450))
    await controller.loadSummaries()
    await flush()
    expect(shadow().querySelector('[role="toolbar"]')!.textContent).toContain('450')
  })

  it('counts every page on the Done card', async () => {
    const { controller, shadow } = mounted(({ after }: { after?: number }) => {
      const from = after ?? 0
      const comments = Array.from({ length: Math.min(PAGE, 450 - from) }, (_unused, index) => row(from + index + 1, { version: v15 }))
      return { comments, next_after: comments.length === PAGE ? comments[comments.length - 1]!.number : null }
    })
    await flush()
    await controller.openDone()
    await flush()
    expect(shadow().querySelector('[role="dialog"], .card')!.textContent).toContain('450')
  })

  it('opens the whole body from comment:get, never the cut one, and edits that', async () => {
    const { controller, shadow } = mounted([row(38, { body: cut, page_url: '/pricing' })])
    await controller.loadSummaries()
    controller.toggleList(true)
    await flush()
    expect(shadow().querySelector('.row')!.textContent).toContain('word')

    await controller.open(38)
    await flush()

    expect(controller.store.get().comments.get('c38')?.body).toBe(whole)
    const body = shadow().querySelector('.body')!.textContent
    expect(body).toContain('and the end')
    expect(body).not.toContain('...')
  })

  it("leaves a thread's whole body alone when the list reloads with a cut one", async () => {
    const { controller } = mounted([row(38, { body: cut, page_url: '/pricing' })])
    await controller.open(38)
    await controller.loadSummaries(true)
    expect(controller.store.get().comments.get('c38')?.body).toBe(whole)
  })

  it("opens nothing from a cut summary when comment:get doesn't answer", async () => {
    const { controller } = mounted([row(38, { body: cut, page_url: '/pricing' })], () => ({ status: 'error', response: { reason: 'rate_limited' } }))
    await controller.loadSummaries()
    await controller.open(38)
    expect(controller.store.get().comments.get('c38')).toBeUndefined()
    expect(controller.store.get().card).toBeNull()
  })
})
