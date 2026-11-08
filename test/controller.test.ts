import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createController, type ControllerOptions } from '../src/controller'
import type { Comment, JoinReply } from '../src/protocol'
import type { TalkBackend, TalkOutcome } from '../src/talk'
import { safeStorage, storageKeys } from '../src/storage'
import { createFakeChannel, createFakeConnection, dima, flush, jonas, joinReply, makeComment, makeReply, maya, setUrl, v15 } from './helpers'

const keys = storageKeys('pk_test')
const running: Array<{ destroy(): void }> = []

function setup(options: Partial<ControllerOptions> = {}) {
  const fake = createFakeChannel()
  const connection = createFakeConnection(fake.channel)
  let joinPayload: (() => object) | null = null
  const navigate = vi.fn()
  const onRejected = vi.fn()
  const onStop = vi.fn()
  const controller = createController({
    window,
    version: '9be01d7',
    local: safeStorage(window, 'localStorage'),
    session: safeStorage(window, 'sessionStorage'),
    keys,
    connect(payload) {
      joinPayload = payload
      return connection.connection
    },
    onRejected,
    onStop,
    navigate,
    deepLink: null,
    ...options,
  })
  running.push(controller)
  const join = async (reply: Partial<JoinReply> = {}) => {
    connection.join(joinReply(reply))
    await flush()
  }
  return { controller, fake, connection, join, joinPayload: () => joinPayload?.(), navigate, onRejected, onStop }
}

beforeEach(() => {
  setUrl('/pricing')
  window.localStorage.clear()
  window.sessionStorage.clear()
})

afterEach(() => {
  vi.useRealTimers()
  for (const controller of running.splice(0)) controller.destroy()
})

describe('joining', () => {
  it('sends the version and the normalized page, then applies the reply', async () => {
    setUrl('/pricing?b=2&mostra_comment=12&a=1')
    const { controller, joinPayload, join } = setup()
    expect(joinPayload()).toEqual({ version: '9be01d7', page_url: '/pricing?a=1&b=2', page_title: document.title })
    const comment = makeComment({ page_url: '/pricing?a=1&b=2' })
    await join({ comments: [comment] })
    const state = controller.store.get()
    expect(state.me).toEqual(maya)
    expect(state.project?.name).toBe('Lumen')
    expect(state.version).toEqual(v15)
    expect(state.comments.get(comment.id)).toEqual(comment)
  })

  it('shows the welcome card on a first visit through an invite', async () => {
    const { controller, join, fake } = setup()
    await join({ invite: { from_name: 'Dima', note: 'Is the new pricing clear?' }, last_seen_at: null })
    expect(controller.store.get().card).toEqual({ type: 'welcome' })
    expect(fake.pushes.map((push) => push.event)).not.toContain('seen')
  })

  it('folds the welcome card into the catch-up card, then sends seen when that is dismissed', async () => {
    const { controller, join, fake } = setup()
    await join({ invite: { from_name: 'Dima', note: null }, catch_up: { to_check: [14], replied: [] }, last_seen_at: null })
    controller.dismissNotice()
    expect(controller.store.get().card).toEqual({ type: 'catch-up' })
    controller.dismissNotice()
    await flush()
    expect(controller.store.get().card).toBeNull()
    expect(fake.pushes.filter((push) => push.event === 'seen')).toHaveLength(1)
  })

  it('greets a returning reviewer with the catch-up card; builders send seen right after joining', async () => {
    const reviewer = setup()
    await reviewer.join({ catch_up: { to_check: [], replied: [12] } })
    expect(reviewer.controller.store.get().card).toEqual({ type: 'catch-up' })

    const builder = setup()
    await builder.join({ reviewer: dima, catch_up: { to_check: [3], replied: [] } })
    expect(builder.controller.store.get().card).toBeNull()
    expect(builder.fake.pushes.map((push) => push.event)).toContain('seen')
  })

  it('passes join refusals on', () => {
    const { connection, onRejected } = setup()
    connection.reject('unauthorized')
    expect(onRejected).toHaveBeenCalledWith('unauthorized')
  })

  it('sends no title when a page has given the name to something else, which would not even serialize', async () => {
    Object.defineProperty(document, 'title', { configurable: true, value: window })
    try {
      const { joinPayload, connection, join } = setup()
      expect(joinPayload()).toMatchObject({ page_title: '' })
      expect(() => JSON.stringify(joinPayload())).not.toThrow()
      void connection
      await join()
    } finally {
      delete (document as unknown as Record<string, unknown>).title
    }
  })

  it('opens a ?mostra_comment deep link once joined', async () => {
    const thread = makeComment({ number: 38, page_url: '/pricing' })
    const { controller, fake, join } = setup({ deepLink: 38 })
    fake.respond('comment:get', () => ({ comment: thread, replies: [] }))
    await join()
    await flush()
    expect(fake.pushes.find((push) => push.event === 'comment:get')?.payload).toEqual({ number: 38 })
    expect(controller.store.get().card).toEqual({ type: 'thread', id: thread.id })
  })

  it('loads the page of a comment that lives elsewhere on this site', async () => {
    const thread = makeComment({ number: 38, page_url: '/about/?team=1' })
    const { controller, fake, join, navigate } = setup({ deepLink: 38 })
    fake.respond('comment:get', () => ({ comment: thread, replies: [] }))
    await join()
    await flush()
    expect(navigate).toHaveBeenCalledWith(`${window.location.origin}/about/?team=1`)
    expect(window.sessionStorage.getItem(keys.pendingFocus)).toBe('38')
    expect(controller.store.get().card).toBeNull()
  })

  it.each(['javascript:alert(1)', "javascript:/pricing/?alert(1):0", 'data:text/html,hi', '//evil.example/', '/\\evil.example/', 'https://evil.example/', 'pricing', '/\t/evil.example/'])('opens nothing for a comment whose page is %j', async (page_url) => {
    const thread = makeComment({ number: 38, page_url })
    const { controller, fake, join, navigate } = setup({ deepLink: 38 })
    fake.respond('comment:get', () => ({ comment: thread, replies: [] }))
    await join()
    await flush()
    await controller.open(38)
    await flush()
    expect(navigate).not.toHaveBeenCalled()
    expect(window.sessionStorage.getItem(keys.pendingFocus)).toBeNull()
    expect(controller.store.get().card).toBeNull()
  })
})

describe('moving to another page', () => {
  const pages = (fake: ReturnType<typeof createFakeChannel>) => fake.pushes.filter((push) => push.event === 'page:visit').map((push) => push.payload.page_url)
  const moveTo = async (path: string) => {
    setUrl(path)
    window.dispatchEvent(new PopStateEvent('popstate'))
    await vi.advanceTimersByTimeAsync(60)
  }

  async function joined() {
    const result = setup()
    await result.join()
    vi.useFakeTimers()
    return result
  }

  it('asks again a minute after being refused, and the pins come', async () => {
    const { controller, fake } = await joined()
    const here = makeComment({ number: 5, page_url: '/reports' })
    let limited = true
    fake.respond('page:visit', () => (limited ? { status: 'error', response: { reason: 'rate_limited' } } : { comments: [here] }))

    await moveTo('/reports')
    expect(pages(fake)).toEqual(['/reports'])
    expect(controller.store.get().comments.has(here.id)).toBe(false)

    limited = false
    await vi.advanceTimersByTimeAsync(60_000)
    expect(pages(fake)).toEqual(['/reports'])
    await vi.advanceTimersByTimeAsync(1_001)
    expect(pages(fake)).toEqual(['/reports', '/reports'])
    expect(controller.store.get().comments.has(here.id)).toBe(true)
  })

  it('keeps on asking only once a minute while it goes on being refused', async () => {
    const { fake } = await joined()
    fake.respond('page:visit', () => ({ status: 'error', response: { reason: 'rate_limited' } }))
    await moveTo('/reports')
    await vi.advanceTimersByTimeAsync(5 * 61_000)
    expect(pages(fake).length).toBeLessThanOrEqual(6)
  })

  it('goes to wherever the person has got to by then', async () => {
    const { fake } = await joined()
    let limited = true
    fake.respond('page:visit', () => (limited ? { status: 'error', response: { reason: 'rate_limited' } } : { comments: [] }))
    await moveTo('/first')
    limited = false
    await moveTo('/second')
    await moveTo('/third')
    expect(pages(fake)).toEqual(['/first'])

    await vi.advanceTimersByTimeAsync(61_001)
    expect(pages(fake)).toEqual(['/first', '/third'])
  })

  it('forgets having asked when it was refused for any other reason, so the page can be asked for again', async () => {
    const { fake } = await joined()
    let failing = true
    fake.respond('page:visit', () => (failing ? { status: 'timeout' } : { comments: [] }))
    await moveTo('/reports')
    expect(pages(fake)).toEqual(['/reports'])
    await vi.advanceTimersByTimeAsync(120_000)
    expect(pages(fake)).toEqual(['/reports'])

    failing = false
    await moveTo('/elsewhere')
    await vi.advanceTimersByTimeAsync(1_001)
    await moveTo('/reports')
    expect(pages(fake)).toEqual(['/reports', '/elsewhere', '/reports'])
  })

  it('takes one a second at most from a site writing what someone types to the address', async () => {
    const { fake } = await joined()
    fake.respond('page:visit', () => ({ comments: [] }))
    for (const letter of 'typing fast') await moveTo(`/search?q=${letter.trim() || 'space'}`)
    expect(pages(fake).length).toBe(1)
    await vi.advanceTimersByTimeAsync(1_001)
    expect(pages(fake).length).toBeLessThanOrEqual(2)
    expect(pages(fake).at(-1)).toBe('/search?q=t')
  })

  it('still asks at once for the first page after a while', async () => {
    const { fake } = await joined()
    fake.respond('page:visit', () => ({ comments: [] }))
    await moveTo('/one')
    await vi.advanceTimersByTimeAsync(2_000)
    await moveTo('/two')
    expect(pages(fake)).toEqual(['/one', '/two'])
  })
})

describe('broadcasts', () => {
  it('de-duplicates by id and ignores an older copy', async () => {
    const { controller, fake, join } = setup()
    await join()
    const comment = makeComment({ page_url: '/pricing', updated_at: '2026-10-25T10:00:00.000000Z' })
    fake.emit('comment:created', { comment })
    fake.emit('comment:created', { comment })
    fake.emit('comment:updated', { comment: { ...comment, body: 'Old', updated_at: '2026-10-25T09:00:00.000000Z' } })
    expect(controller.store.get().comments.size).toBe(1)
    expect(controller.store.get().comments.get(comment.id)?.body).toBe(comment.body)
  })

  it('treats comment:updated for an unknown id as an insert (a team note shown to everyone)', async () => {
    const { controller, fake, join } = setup()
    await join()
    const comment = makeComment({ page_url: '/pricing' })
    fake.emit('comment:updated', { comment })
    expect(controller.store.get().comments.has(comment.id)).toBe(true)
  })

  it('removes a deleted thread with its replies and ignores late echoes', async () => {
    const thread = makeComment({ page_url: '/pricing' })
    const reply = makeReply(thread)
    const { controller, fake, join } = setup()
    await join({ comments: [thread, reply] })
    controller.openThread(thread.id)
    fake.emit('comment:deleted', { id: thread.id })
    fake.emit('comment:updated', { comment: { ...thread, updated_at: '2026-10-26T00:00:00.000000Z' } })
    expect(controller.store.get().comments.size).toBe(0)
    expect(controller.store.get().card).toBeNull()
  })

  it('announces new comments from others politely', async () => {
    const { controller, fake, join } = setup()
    await join()
    fake.emit('comment:created', { comment: makeComment({ number: 41, author: jonas, page_url: '/pricing' }) })
    expect(controller.store.get().announcement?.text).toBe('New comment 41 from Jonas on this page')
  })

  it('peeks at a comment that lands on this page from someone else, then lets it go', async () => {
    const { controller, fake, join } = setup()
    await join()
    vi.useFakeTimers()
    const landed = makeComment({ number: 41, author: jonas, page_url: '/pricing' })
    fake.emit('comment:created', { comment: landed })
    fake.emit('comment:created', { comment: makeComment({ number: 42, author: maya, page_url: '/pricing' }) })
    fake.emit('comment:created', { comment: makeComment({ number: 43, author: jonas, page_url: '/other' }) })
    fake.emit('comment:updated', { comment: makeComment({ number: 44, author: jonas, page_url: '/pricing' }) })
    expect(Array.from(controller.store.get().arrivals)).toEqual([landed.id])
    vi.advanceTimersByTime(3400)
    expect(controller.store.get().arrivals.size).toBe(0)
    vi.useRealTimers()
  })

  it('keeps a peek open as long as the overlay CSS says', async () => {
    const { controller, fake, join } = setup({ peekMs: () => 8000 })
    await join()
    vi.useFakeTimers()
    const landed = makeComment({ number: 41, author: jonas, page_url: '/pricing' })
    fake.emit('comment:created', { comment: landed })
    vi.advanceTimersByTime(3400)
    expect(controller.store.get().arrivals.has(landed.id)).toBe(true)
    vi.advanceTimersByTime(4600)
    expect(controller.store.get().arrivals.size).toBe(0)
    vi.useRealTimers()
  })

  it('still peeks when the list heard of the comment first', async () => {
    const { controller, fake, join } = setup()
    await join()
    vi.useFakeTimers()
    const landed = makeComment({ number: 41, author: jonas, page_url: '/pricing' })
    controller.store.update({ summaries: new Map([[landed.id, { ...landed, reply_count: 0, last_activity_at: landed.updated_at }]]) })
    fake.emit('comment:created', { comment: landed })
    expect(controller.store.get().arrivals.has(landed.id)).toBe(true)
    vi.useRealTimers()
  })

  it("follows my own verdict across tabs; others' verdicts are not mine", async () => {
    const { controller, fake, join } = setup()
    await join()
    fake.emit('verdict:changed', { verdict: { reviewer: jonas, version: v15, verdict: 'approved', note: null, updated_at: '' } })
    expect(controller.store.get().verdict).toBeNull()
    fake.emit('verdict:changed', { verdict: { reviewer: maya, version: v15, verdict: 'approved', note: null, updated_at: '' } })
    expect(controller.store.get().verdict?.verdict).toBe('approved')
    fake.emit('verdict:changed', { verdict: { reviewer: maya, version: v15, verdict: null, note: null, updated_at: '' } })
    expect(controller.store.get().verdict).toBeNull()
  })
})

describe('clicking away', () => {
  it("closes a thread and a count pin's card", async () => {
    const thread = makeComment({ page_url: '/pricing' })
    const { controller, join } = setup()
    await join({ comments: [thread] })
    controller.openThread(thread.id)
    controller.clickAway()
    expect(controller.store.get().card).toBeNull()
    controller.openCluster([thread.id])
    controller.clickAway()
    expect(controller.store.get().card).toBeNull()
  })

  it('closes the list, the shortcuts and the Done card', async () => {
    const { controller, join } = setup()
    await join()
    controller.toggleList(true)
    controller.clickAway()
    expect(controller.store.get().list).toBe(false)
    controller.openShortcuts()
    controller.clickAway()
    expect(controller.store.get().card).toBeNull()
    await controller.openDone()
    controller.clickAway()
    expect(controller.store.get().card).toBeNull()
  })

  it('folds the welcome card, as Start does', async () => {
    const { controller, join } = setup()
    await join()
    controller.store.update({ card: { type: 'welcome' } })
    controller.clickAway()
    expect(controller.store.get().card).toBeNull()
  })

  it('leaves a composer to decide for itself, as only it knows what it holds', async () => {
    const { controller, join } = setup()
    await join()
    document.body.innerHTML = '<button data-testid="cta">Choose Pro</button>'
    controller.startCommentMode()
    controller.pick(document.querySelector('button')!, { x: 1, y: 1 })
    expect(controller.store.get().mode).toBeNull()
    controller.clickAway()
    expect(controller.store.get().card?.type).toBe('composer')
  })

  it('leaves a check open, so the page can be clicked to see the fix', async () => {
    const thread = makeComment({ page_url: '/pricing' })
    const { controller, join } = setup()
    await join({ comments: [thread] })
    controller.store.update({ stepper: { kind: 'check', numbers: [thread.number!], index: 0, checked: 0 } })
    controller.openThread(thread.id)
    controller.clickAway()
    expect(controller.store.get().card?.type).toBe('thread')
    expect(controller.store.get().stepper).not.toBeNull()
  })

  it('ends a walk through comments, as closing the card does', async () => {
    const thread = makeComment({ page_url: '/pricing' })
    const { controller, join } = setup()
    await join({ comments: [thread] })
    controller.store.update({ stepper: { kind: 'browse', numbers: [thread.number!], index: 0, checked: 0 } })
    controller.openThread(thread.id)
    controller.clickAway()
    expect(controller.store.get().card).toBeNull()
    expect(controller.store.get().stepper).toBeNull()
  })

  it('leaves the click to comment mode, which picks what was clicked', async () => {
    const thread = makeComment({ page_url: '/pricing' })
    const { controller, join } = setup()
    await join({ comments: [thread] })
    controller.startCommentMode()
    controller.openThread(thread.id)
    controller.clickAway()
    expect(controller.store.get().card?.type).toBe('thread')
  })
})

describe('sending', () => {
  function pickSomething(controller: ReturnType<typeof setup>['controller']) {
    document.body.innerHTML = '<button data-testid="cta">Choose Pro</button>'
    controller.startCommentMode()
    controller.pick(document.querySelector('button')!, { x: 1, y: 1 })
  }

  it('publishes at once with a client id; the pin shows "sending" until the number comes back', async () => {
    const { controller, fake, join } = setup()
    await join()
    pickSomething(controller)
    expect(controller.store.get().mode).toBeNull()
    expect(controller.store.get().card?.type).toBe('composer')
    const created = makeComment({ number: 38, author: maya, page_url: '/pricing' })
    fake.respond('comment:create', (payload) => ({ comment: { ...created, client_id: payload.client_id } }))

    const sending = controller.createComment({ body: 'Make it the main button', suggestedText: null, visibility: 'everyone', name: null })
    const pending = Array.from(controller.store.get().pending.values())
    expect(pending).toHaveLength(1)
    expect(pending[0]!.comment.number).toBeNull()
    expect(controller.store.get().card).toEqual({ type: 'thread', id: pending[0]!.comment.id })
    await sending

    const push = fake.pushes.find((item) => item.event === 'comment:create')!
    expect(push.payload).toMatchObject({ body: 'Make it the main button', page_url: '/pricing' })
    expect(push.payload).not.toHaveProperty('kind')
    expect(push.payload.client_id).toMatch(/^c-/)
    expect(push.payload.anchor.selectors[0]).toEqual({ type: 'testid', value: 'cta' })
    expect(push.payload.environment).toMatchObject({ user_agent: expect.any(String) })
    expect(controller.store.get().pending.size).toBe(0)
    expect(controller.store.get().card).toEqual({ type: 'thread', id: created.id })
  })

  it('keeps an unconfirmed comment through a dropped connection and resends it with the same client id', async () => {
    const { controller, fake, connection, join } = setup()
    await join()
    pickSomething(controller)
    let attempts = 0
    fake.respond('comment:create', (payload) => (++attempts === 1 ? { status: 'timeout' } : { comment: makeComment({ author: maya, client_id: payload.client_id, page_url: '/pricing' }) }))
    connection.status('offline')
    await controller.createComment({ body: 'Hello', suggestedText: null, visibility: 'everyone', name: null })
    expect(controller.store.get().pending.size).toBe(1)

    await join()
    await flush()
    const creates = fake.pushes.filter((push) => push.event === 'comment:create')
    expect(creates).toHaveLength(2)
    expect(creates[1]!.payload.client_id).toBe(creates[0]!.payload.client_id)
    expect(controller.store.get().pending.size).toBe(0)
  })

  it('asks a guest for a name first, then sends', async () => {
    const guest = { ...maya, display_name: null }
    const { controller, fake, join } = setup()
    await join({ reviewer: guest })
    pickSomething(controller)
    fake.respond('reviewer:update', (payload) => ({ reviewer: { ...guest, display_name: payload.display_name } }))
    fake.respond('comment:create', (payload) => ({ comment: makeComment({ author: maya, client_id: payload.client_id }) }))
    await controller.createComment({ body: 'Hi', suggestedText: null, visibility: 'everyone', name: ' Sam ' })
    expect(fake.pushes.map((push) => push.event).filter((event) => event !== 'seen')).toEqual(['reviewer:update', 'comment:create'])
    expect(fake.pushes[0]!.payload).toEqual({ display_name: 'Sam' })
    expect(controller.store.get().me?.display_name).toBe('Sam')
  })

  it('says when a name is taken, and sends nothing', async () => {
    const guest = { ...maya, display_name: null }
    const { controller, fake, join } = setup()
    await join({ reviewer: guest })
    pickSomething(controller)
    const draftKey = (controller.store.get().card as { draftKey: string }).draftKey
    controller.drafts.set(draftKey, 'Hi')
    fake.respond('reviewer:update', () => ({ status: 'error', response: { reason: 'invalid', errors: { display_name: ['is taken. Use your own name.'] } } }))
    await expect(controller.createComment({ body: 'Hi', suggestedText: null, visibility: 'everyone', name: 'Maya' })).rejects.toThrow()
    expect(controller.store.get().toasts.at(-1)?.message).toBe('Someone here already uses that name. Add an initial.')
    expect(fake.pushes.some((push) => push.event === 'comment:create')).toBe(false)
    expect(controller.drafts.get(draftKey)).toBe('Hi')
    expect(controller.store.get().me?.display_name).toBe(null)
  })

  it("says only that a name wasn't saved when it's refused for another reason", async () => {
    const guest = { ...maya, display_name: null }
    const { controller, fake, join } = setup()
    await join({ reviewer: guest })
    fake.respond('reviewer:update', () => ({ status: 'error', response: { reason: 'invalid', errors: { display_name: ["can't be blank"] } } }))
    await expect(controller.setName(' ')).rejects.toThrow()
    expect(controller.store.get().toasts.at(-1)?.message).toBe("Couldn't save your name.")
  })

  it('replies with only the parent, the body and a client id', async () => {
    const thread = makeComment({ page_url: '/pricing' })
    const { controller, fake, join } = setup()
    await join({ comments: [thread] })
    fake.respond('comment:create', (payload) => ({ comment: makeReply(thread, { author: maya, client_id: payload.client_id }) }))
    await controller.reply(thread, 'Same here', 'everyone')
    expect(fake.pushes.find((push) => push.event === 'comment:create')!.payload).toEqual({ client_id: expect.stringMatching(/^c-/), parent_id: thread.id, body: 'Same here' })
  })

  it('keeps the words when the server refuses them for good', async () => {
    const { controller, fake, join } = setup()
    await join()
    pickSomething(controller)
    const draftKey = (controller.store.get().card as { draftKey: string }).draftKey
    fake.respond('comment:create', () => ({ status: 'error', response: { reason: 'invalid', errors: { body: ['is too long'] } } }))
    await controller.createComment({ body: 'Too long', suggestedText: null, visibility: 'everyone', name: null })
    expect(controller.store.get().pending.size).toBe(0)
    expect(controller.drafts.get(draftKey)).toBe('Too long')
    expect(controller.store.get().toasts[0]?.tone).toBe('error')
  })
})

describe('delete with Undo', () => {
  it('hides the comment at once and only sends the delete after 5 seconds', async () => {
    const thread = makeComment({ number: 38, author: maya, page_url: '/pricing' })
    const { controller, fake, join } = setup()
    await join({ comments: [thread] })
    vi.useFakeTimers()
    controller.remove(thread)
    expect(controller.store.get().deleting.has(thread.id)).toBe(true)
    expect(controller.store.get().toasts[0]?.message).toBe('Deleted #38')
    await vi.advanceTimersByTimeAsync(4900)
    expect(fake.pushes.some((push) => push.event === 'comment:delete')).toBe(false)
    await vi.advanceTimersByTimeAsync(200)
    expect(fake.pushes.find((push) => push.event === 'comment:delete')?.payload).toEqual({ id: thread.id })
    expect(controller.store.get().comments.has(thread.id)).toBe(false)
  })

  it('Undo brings it back and nothing is sent', async () => {
    const thread = makeComment({ number: 38, author: maya, page_url: '/pricing' })
    const { controller, fake, join } = setup()
    await join({ comments: [thread] })
    vi.useFakeTimers()
    controller.remove(thread)
    controller.store.get().toasts[0]!.undo!()
    await vi.advanceTimersByTimeAsync(6000)
    expect(controller.store.get().deleting.size).toBe(0)
    expect(fake.pushes.some((push) => push.event === 'comment:delete')).toBe(false)
  })
})

describe('lifecycle and verdicts', () => {
  it('sends a transition with its text and merges the reply that carried it', async () => {
    const thread = makeComment({ status: 'fixed', checkable: true, author: maya, page_url: '/pricing' })
    const { controller, fake, join } = setup()
    await join({ comments: [thread] })
    const reply = makeReply(thread, { author: maya, body: 'Still small on phones', event: { status: 'open', resolution: null } })
    fake.respond('comment:status', () => ({ comment: { ...thread, status: 'open', updated_at: '2026-10-26T00:00:00.000000Z' }, reply }))
    await controller.transition(thread, { label: 'Not yet', to: 'open', text: 'required' }, ' Still small on phones ')
    expect(fake.pushes.find((push) => push.event === 'comment:status')!.payload).toEqual({ id: thread.id, to: 'open', body: 'Still small on phones' })
    expect(controller.store.get().comments.get(thread.id)?.status).toBe('open')
    expect(controller.store.get().comments.get(reply.id)?.event).toEqual({ status: 'open', resolution: null })
  })

  it('steps Check fixes across pages and ends on the Done card', async () => {
    const here = makeComment({ number: 14, status: 'fixed', checkable: true, author: maya, page_url: '/pricing' })
    const there = makeComment({ number: 9, status: 'answered', checkable: true, author: maya, page_url: '/' })
    const { controller, fake, join, navigate } = setup()
    fake.respond('comment:get', (payload) => {
      const comment = [here, there].find((candidate) => candidate.number === payload.number)!
      return { comment, replies: [] }
    })
    fake.respond('comment:status', (payload) => ({ comment: { ...here, id: payload.id, status: 'resolved', resolution: 'confirmed', updated_at: '2026-10-26T00:00:00.000000Z' }, reply: null }))
    await join({ comments: [here], catch_up: { to_check: [14, 9], replied: [] } })

    await controller.checkFixes()
    expect(controller.store.get().stepper).toMatchObject({ kind: 'check', numbers: [14, 9], index: 0 })
    expect(controller.store.get().card).toEqual({ type: 'thread', id: here.id })

    await controller.transition(here, { label: 'Looks fixed', to: 'resolved', resolution: 'confirmed', text: 'none' }, '')
    expect(navigate).toHaveBeenCalledWith(`${window.location.origin}/`)
    expect(JSON.parse(window.sessionStorage.getItem(keys.player)!)).toMatchObject({ kind: 'check', index: 1 })
    expect(window.sessionStorage.getItem(keys.pendingFocus)).toBe('9')

    controller.store.update({ stepper: { kind: 'check', numbers: [14, 9], index: 1, checked: 1 } })
    await controller.transition(there, { label: 'Got it', to: 'resolved', resolution: 'confirmed', text: 'none' }, '')
    expect(controller.store.get().stepper).toBeNull()
    expect(controller.store.get().card).toEqual({ type: 'done', checked: 2 })
  })

  it('gives and withdraws a verdict', async () => {
    const { controller, fake, join } = setup()
    await join()
    fake.respond('verdict:set', (payload) => ({ verdict: payload.verdict ? { reviewer: maya, version: v15, verdict: payload.verdict, note: payload.note ?? null, updated_at: '' } : null }))
    await controller.setVerdict('approved', ' Ship it ')
    expect(fake.pushes.at(-1)!.payload).toEqual({ verdict: 'approved', note: 'Ship it' })
    expect(controller.store.get().verdict?.verdict).toBe('approved')
    await controller.setVerdict(null, '')
    expect(fake.pushes.at(-1)!.payload).toEqual({ verdict: null })
    expect(controller.store.get().verdict).toBeNull()
  })
})

describe('pages', () => {
  it('visits the new page after an SPA navigation and swaps in its comments', async () => {
    const { controller, fake, join } = setup()
    const other: Comment = makeComment({ page_url: '/reports' })
    fake.respond('page:visit', () => ({ comments: [other] }))
    await join({ comments: [makeComment({ page_url: '/pricing' })] })
    window.history.pushState(null, '', '/reports')
    await new Promise((resolve) => setTimeout(resolve, 80))
    await flush()
    expect(fake.pushes.find((push) => push.event === 'page:visit')?.payload).toEqual({ page_url: '/reports', page_title: document.title })
    expect(controller.store.get().pageUrl).toBe('/reports')
    expect(controller.store.get().comments.has(other.id)).toBe(true)
  })

  it('keeps preferences per device: hidden comments, the toolbar position, single keys', async () => {
    const { controller } = setup()
    const position = { horizontal: 'center', x: 40, vertical: 'top', y: 120 } as const
    controller.setHidden(true)
    controller.setToolbar(position)
    controller.setSingleKeys(false)
    const again = setup()
    expect(again.controller.store.get()).toMatchObject({ hidden: true, toolbar: position, singleKeys: false })
  })
})

describe('talking', () => {
  const talkStatus = { minutes_left: 30, max_duration_ms: 60_000, transcribers: ['browser' as const] }

  function postingBackend(...outcomes: TalkOutcome[]) {
    return {
      pick: () => 'browser' as const,
      record: vi.fn(async () => ({ stop: async () => {} })),
      submit: vi.fn(async () => (outcomes.length > 1 ? outcomes.shift()! : outcomes[0]!)),
      forget: vi.fn(async () => {}),
    } satisfies TalkBackend
  }

  it('has no talking unless the server and this browser both do', async () => {
    const backend = { pick: () => 'browser' as const, record: vi.fn(), submit: vi.fn(), forget: vi.fn() }
    const noBackend = setup()
    await noBackend.join({ talk: talkStatus })
    expect(noBackend.controller.store.get().talkStatus).toBeNull()

    const offOnServer = setup({ talk: backend })
    await offOnServer.join({ talk: null })
    expect(offOnServer.controller.store.get().talkStatus).toBeNull()

    const cantDoIt = setup({ talk: { ...backend, pick: () => null } })
    await cantDoIt.join({ talk: talkStatus })
    expect(cantDoIt.controller.store.get().talkStatus).toBeNull()

    const on = setup({ talk: backend })
    await on.join({ talk: talkStatus })
    expect(on.controller.store.get().talkStatus?.minutes_left).toBe(30)
  })

  it('says a played example is one, and never that it is recording', async () => {
    const record = vi.fn(async () => ({ stop: async () => {}, example: true }))
    const { controller, join } = setup({ talk: { pick: () => 'browser', record, submit: vi.fn(), forget: vi.fn() } })
    await join({ talk: talkStatus })

    await controller.toggleTalk()

    expect(controller.store.get().talk).toMatchObject({ phase: 'recording', example: true })
    expect(controller.store.get().announcement?.text).toBe('Playing an example.')
    expect(controller.store.get().toasts).toEqual([])
  })

  it('tells someone it is recording only once the microphone is live', async () => {
    const record = vi.fn(async () => ({ stop: async () => {} }))
    const { controller, join } = setup({ talk: { pick: () => 'browser', record, submit: vi.fn(), forget: vi.fn() } })
    await join({ talk: talkStatus })

    await controller.toggleTalk()

    expect(controller.store.get().announcement?.text).toBe('Recording. Talk while you look around.')
    expect(controller.store.get().toasts).toEqual([])
  })

  it('opens the menu or the list, never both', async () => {
    const { controller, join } = setup()
    await join()
    controller.toggleList(true)
    controller.toggleMenu(true)
    expect(controller.store.get()).toMatchObject({ menu: true, list: false })
    controller.toggleList(true)
    expect(controller.store.get()).toMatchObject({ menu: false, list: true })
    controller.toggleMenu(false)
    expect(controller.store.get().list).toBe(true)
  })

  it('refuses to start with no minutes left, without touching the microphone', async () => {
    const record = vi.fn()
    const { controller, join } = setup({ talk: { pick: () => 'browser', record, submit: vi.fn(), forget: vi.fn() } })
    await join({ talk: { ...talkStatus, minutes_left: 0 } })

    await controller.toggleTalk()

    expect(record).not.toHaveBeenCalled()
    expect(controller.store.get().toasts[0]?.message).toContain('talking minutes')
  })

  it('on Stop, posts the pass: its comments land as pins on this page and a toast says how many', async () => {
    const here = makeComment({ id: 'c41', number: 41, body: 'Too small.', source: 'spoken', talk_id: 't1', page_url: '/pricing' })
    const elsewhere = makeComment({ id: 'c42', number: 42, body: 'Too long.', source: 'spoken', talk_id: 't1', page_url: '/about' })
    const backend = postingBackend({ status: 'done', comments: [here, elsewhere], minutes_left: 28 })
    const { controller, join } = setup({ talk: backend })
    await join({ talk: talkStatus })

    await controller.toggleTalk()
    await controller.toggleTalk()
    await flush()

    const state = controller.store.get()
    expect(state.talk).toBeNull()
    expect(state.comments.get('c41')?.number).toBe(41)
    expect(state.arrivals).toEqual(new Set(['c41']))
    expect(state.toasts.at(-1)?.message).toBe('2 comments added')
    expect(state.talkStatus?.minutes_left).toBe(28)
    expect(state.list).toBe(false)
  })

  it('a guest with no name gives one, then the pass posts under it', async () => {
    const posted = makeComment({ id: 'c41', number: 41, source: 'spoken', talk_id: 't1' })
    const backend = postingBackend({ status: 'done', comments: [posted], minutes_left: 28 })
    const { controller, fake, join } = setup({ talk: backend })
    await join({ talk: talkStatus, reviewer: { ...maya, display_name: null } })

    await controller.toggleTalk()
    await controller.toggleTalk()
    await flush()
    expect(controller.store.get().talk).toEqual({ phase: 'naming' })
    expect(backend.submit).not.toHaveBeenCalled()

    fake.respond('reviewer:update', () => ({ reviewer: { ...maya, display_name: 'Tess' } }))
    await controller.postTalkAs('Tess')

    expect(fake.pushes.find(({ event }) => event === 'reviewer:update')?.payload).toEqual({ display_name: 'Tess' })
    expect(backend.submit).toHaveBeenCalledTimes(1)
    expect(controller.store.get().talk).toBeNull()
    expect(controller.store.get().toasts.at(-1)?.message).toBe('1 comment added')
  })
})
