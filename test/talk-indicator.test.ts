import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createController } from '../src/controller'
import type { TalkStatus } from '../src/protocol'
import { safeStorage, storageKeys } from '../src/storage'
import type { TalkBackend } from '../src/talk'
import { HOST_TAG, mountOverlay } from '../src/ui/mount'
import { createFakeChannel, createFakeConnection, dima, flush, joinReply, maya, setUrl } from './helpers'

const keys = storageKeys('pk_test')
const talkStatus: TalkStatus = { minutes_left: 30, max_duration_ms: 60_000, transcribers: ['browser'] }
let cleanup: Array<() => void> = []

function backend(): TalkBackend {
  return {
    pick: () => 'browser',
    record: vi.fn(async () => ({ stop: async () => {} })),
    submit: vi.fn(async () => ({ status: 'done' as const, comments: [], minutes_left: 29 })),
    forget: vi.fn(async () => {}),
  }
}

async function mount(onRejected: () => void = () => {}, reviewer = maya) {
  const channel = createFakeChannel()
  const connection = createFakeConnection(channel.channel)
  const controller = createController({
    window,
    version: '9be01d7',
    local: safeStorage(window, 'localStorage'),
    session: safeStorage(window, 'sessionStorage'),
    keys,
    connect: () => connection.connection,
    onRejected,
    onStop: vi.fn(),
    navigate: vi.fn(),
    deepLink: null,
    peekMs: () => 0,
    talk: backend(),
  })
  const unmount = mountOverlay(controller, window, null)
  cleanup.push(() => {
    unmount()
    controller.destroy()
  })
  connection.join(joinReply({ talk: talkStatus, reviewer }))
  await flush()
  return Object.assign(controller, { reject: () => connection.reject('unauthorized') })
}

const toolbar = () => document.querySelector(HOST_TAG)?.shadowRoot?.querySelector('[role="toolbar"]') ?? null

beforeEach(() => {
  setUrl('/pricing')
  window.localStorage.clear()
  window.sessionStorage.clear()
  document.body.innerHTML = '<p>The page</p>'
})

afterEach(() => {
  for (const finish of cleanup.splice(0)) finish()
})

describe('the recording indicator', () => {
  it('stays when H is pressed while recording, and the comments go', async () => {
    const controller = await mount()
    await controller.toggleTalk()
    await flush()
    expect(toolbar()?.textContent).toContain('Recording')

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', bubbles: true }))
    await flush()

    expect(controller.store.get().hidden).toBe(true)
    expect(toolbar()?.classList.contains('collapsed')).toBe(false)
    expect(toolbar()?.textContent).toContain('Recording')
    expect(toolbar()?.textContent).toContain('Stop')
  })

  it('shows on the next page of a pass, even with comments hidden there', async () => {
    window.localStorage.setItem(keys.collapsed, '1')
    window.sessionStorage.setItem(keys.talk, JSON.stringify({ id: 't-1', reviewer_id: maya.id, phase: 'recording', elapsed_ms: 5000, events: [], utterances: [], transcription: 'browser' }))

    const controller = await mount()
    await flush()

    expect(controller.store.get().hidden).toBe(true)
    expect(controller.store.get().talk?.phase).toBe('recording')
    expect(toolbar()?.classList.contains('collapsed')).toBe(false)
    expect(toolbar()?.textContent).toContain('Recording')
  })

  it('shows while the words are turned into comments, and goes back to the dot after', async () => {
    const controller = await mount()
    await controller.toggleTalk()
    controller.setHidden(true)
    await flush()
    expect(toolbar()?.classList.contains('collapsed')).toBe(false)

    await controller.toggleTalk()
    await flush()
    expect(controller.store.get().talk).toBeNull()
    expect(toolbar()?.classList.contains('collapsed')).toBe(true)
  })

  it('comes back as a recording to send, for the next session, after a token ends mid-recording', async () => {
    const controller = await mount(() => {
      for (const finish of cleanup.splice(0)) finish()
    })
    await controller.toggleTalk()
    await flush()
    expect(toolbar()?.textContent).toContain('Recording')

    controller.reject()
    await flush()
    expect(toolbar()).toBeNull()

    await mount()
    await flush()
    expect(toolbar()?.textContent).toContain("Couldn't turn that into comments")
    expect(toolbar()?.textContent).toContain('Try again')
    expect(toolbar()?.textContent).toContain('Discard')
  })

  it("shows nothing of a recording left by someone else, when a builder link takes over the tab", async () => {
    const controller = await mount(() => {
      for (const finish of cleanup.splice(0)) finish()
    })
    await controller.toggleTalk()
    await flush()
    controller.reject()
    await flush()
    expect(window.sessionStorage.getItem(keys.talk)).not.toBeNull()

    await mount(() => {}, dima)
    await flush()
    expect(toolbar()?.textContent).not.toContain("Couldn't turn that into comments")
    expect(toolbar()?.textContent).not.toContain('Recording')
    expect(window.sessionStorage.getItem(keys.talk)).toBeNull()
  })

  it('leaves the dot alone when nothing is being recorded', async () => {
    window.localStorage.setItem(keys.collapsed, '1')
    await mount()
    await flush()
    expect(toolbar()?.classList.contains('collapsed')).toBe(true)
  })
})
