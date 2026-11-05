import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createController } from '../src/controller'
import type { Anchor, Comment } from '../src/protocol'
import { safeStorage, storageKeys } from '../src/storage'
import { HOST_TAG, mountOverlay } from '../src/ui/mount'
import { createFakeChannel, createFakeConnection, dima, flush, jonas, joinReply, makeComment, setUrl } from './helpers'

const HOSTILE: unknown[] = [
  { selectors: [{ type: 'css', value: '#nothing' }], element_text: 123 },
  { selectors: [{ type: 'css', value: '#nothing' }], element_text: { a: 1 } },
  { selectors: [{ type: 'css', value: '#nothing' }], element_text: ['a'] },
  { selectors: [{ type: 'css', value: '#nothing' }], label: 123 },
  { selectors: [{ type: 'css', value: '#nothing' }], label: { a: 1 } },
  { selectors: [{ type: 'nonsense', value: { a: 1 } }] },
  { selectors: [5, null, 'text'] },
  { selectors: [{ type: 'css', value: '#nothing' }], text_quote: 5 },
  { selectors: [{ type: 'css', value: '#nothing' }], text_quote: { exact: 5 } },
  { selectors: [{ type: 'css', value: '#nothing' }], rect: 'here' },
  { selectors: [{ type: 'css', value: '#nothing' }], offset: 'here' },
  { selectors: [{ type: 'css', value: '#nothing' }], spec: 5 },
  { selectors: [{ type: 'css', value: '#nothing' }], spec: { color: { a: 1 } } },
  { selectors: [{ type: 'css', value: '#nothing' }], state: 5 },
  { selectors: [{ type: 'css', value: '#nothing' }], state: 'open' },
  { selectors: [{ type: 'css', value: '#nothing' }], state: { ancestors: 5, opened_by: 5 } },
  { selectors: [{ type: 'css', value: '#nothing' }], state: { ancestors: [5, null], opened_by: [5] } },
  { selectors: [{ type: 'css', value: '#target' }], element_text: 123, spec: 5, state: { ancestors: 5 } },
  { selectors: [{ type: 'css', value: '#target' }], element_text: { a: 1 }, offset: { x: 'a', y: 'b' }, spec: { color: 5 } },
]

const keys = storageKeys('pk_test')
let cleanup: Array<() => void> = []

function setup(comments: Comment[]) {
  const channel = createFakeChannel()
  const connection = createFakeConnection(channel.channel)
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
  channel.respond('comment:get', ({ number }: { number: number }) => ({ comment: comments.find((comment) => comment.number === number)!, replies: [] }))
  channel.respond('comments:list', () => ({ comments: comments.map((comment) => ({ ...comment, reply_count: 0, last_activity_at: comment.updated_at })), next_after: null }))
  const unmount = mountOverlay(controller, window, null)
  cleanup.push(() => {
    unmount()
    controller.destroy()
  })
  connection.join(joinReply({ reviewer: dima, comments, catch_up: { to_check: comments.map((comment) => comment.number!), replied: [] } }))
  return controller
}

const shadow = () => document.querySelector(HOST_TAG)?.shadowRoot ?? null

beforeEach(() => {
  setUrl('/pricing')
  window.localStorage.clear()
  window.sessionStorage.clear()
  document.body.innerHTML = `<button id="target">Target</button><button id="other">Other</button>`
})

afterEach(() => {
  for (const finish of cleanup.splice(0)) finish()
})

describe('an anchor that is not the shape it should be', () => {
  it('leaves the rest of the overlay working, on every surface it can reach', async () => {
    const hostile = HOSTILE.map((anchor, index) => makeComment({ number: index + 1, author: jonas, page_url: '/pricing', status: 'fixed', checkable: true, anchor: anchor as Anchor }))
    const honest = makeComment({ number: 100, author: jonas, page_url: '/pricing', anchor: { selectors: [{ type: 'id', value: 'other' }], element_text: 'Other' } })
    const controller = setup([...hostile, honest])
    await flush()
    await vi.waitFor(() => expect(shadow()?.querySelector('[role="toolbar"]')).not.toBeNull())

    await new Promise((resolve) => setTimeout(resolve, 2100))

    controller.toggleList(true)
    await flush()
    await vi.waitFor(() => expect(shadow()?.querySelectorAll('.row').length).toBe(hostile.length + 1))
    controller.toggleList(false)
    await flush()

    for (const comment of hostile) {
      await controller.open(comment.number!)
      await flush()
      expect(controller.store.get().card).toEqual({ type: 'thread', id: comment.id })
      expect(shadow()?.querySelector('[role="toolbar"]')).not.toBeNull()
    }

    await controller.checkFixes()
    await flush()
    for (let step = 0; step < hostile.length; step++) {
      await controller.step(1)
      await flush()
    }

    await controller.open(100)
    await flush()
    expect(controller.store.get().card).toEqual({ type: 'thread', id: honest.id })
    expect(shadow()?.querySelector('[role="toolbar"]')).not.toBeNull()
  }, 15_000)
})
