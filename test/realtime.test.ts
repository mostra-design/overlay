import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { connectRealtime } from '../src/realtime'
import { safeStorage } from '../src/storage'
import { dima, jonas, joinReply } from './helpers'

const phoenix = vi.hoisted(() => {
  const state = {
    socket: null as any,
    channel: null as any,
    presence: null as any,
  }

  class Socket {
    url: string
    options: any
    openCallbacks: Array<() => void> = []
    errorCallbacks: Array<() => void> = []
    connected = false
    constructor(url: string, options: any) {
      this.url = url
      this.options = options
      state.socket = this
    }
    onOpen(callback: () => void) {
      this.openCallbacks.push(callback)
    }
    onError(callback: () => void) {
      this.errorCallbacks.push(callback)
    }
    connect() {
      this.connected = true
    }
    disconnect() {
      this.connected = false
    }
    isConnected() {
      return this.connected
    }
    channel(topic: string, params: () => object) {
      const hooks = new Map<string, (response: any) => void>()
      const joinPush = {
        receive(status: string, callback: (response: any) => void) {
          hooks.set(status, callback)
          return joinPush
        },
      }
      state.channel = { topic, params, hooks, onError: vi.fn(), join: () => joinPush, leave: vi.fn(), on: vi.fn(), push: vi.fn() }
      return state.channel
    }
  }

  class Presence {
    sync: () => void = () => {}
    state: Record<string, { metas: any[] }> = {}
    constructor() {
      state.presence = this
    }
    onSync(callback: () => void) {
      this.sync = callback
    }
    list(chooser: (id: string, presence: { metas: any[] }) => unknown) {
      return Object.entries(this.state).map(([id, presence]) => chooser(id, presence))
    }
  }

  return { state, Socket, Presence }
})

vi.mock('phoenix', () => ({ Socket: phoenix.Socket, Presence: phoenix.Presence }))

function connect() {
  const connection = connectRealtime({
    endpoint: 'https://api.mostra.design',
    token: 'token-1',
    projectId: 'project-1',
    joinPayload: () => ({ page_url: '/' }),
    sessionStorage: safeStorage(window, 'sessionStorage'),
  })
  const rejected = vi.fn()
  const statuses = vi.fn()
  connection.onRejected(rejected)
  connection.onStatus(statuses)
  return { connection, rejected, statuses }
}

beforeEach(() => {
  phoenix.state.socket = null
})

describe('connectRealtime', () => {
  it('connects to <endpoint>/socket with the token and joins the project topic', () => {
    const { connection, statuses } = connect()
    const joined = vi.fn()
    connection.onJoin(joined)

    expect(phoenix.state.socket.url).toBe('wss://api.mostra.design/socket')
    expect(phoenix.state.socket.options.authToken).toBe('token-1')
    expect(phoenix.state.socket.options.params).toBeUndefined()
    expect(phoenix.state.socket.connected).toBe(true)
    expect(phoenix.state.channel.topic).toBe('project:project-1')
    expect(phoenix.state.channel.params()).toEqual({ page_url: '/' })

    phoenix.state.channel.hooks.get('ok')(joinReply())
    expect(joined).toHaveBeenCalledWith(joinReply())
    expect(statuses).toHaveBeenLastCalledWith('online')
  })

  describe('when the server says rate_limited', () => {
    const refuse = () => phoenix.state.channel.hooks.get('error')({ reason: 'rate_limited' })

    beforeEach(() => {
      vi.useFakeTimers()
      vi.spyOn(console, 'warn').mockImplementation(() => {})
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('waits past the next minute and tries again, without closing anything for good', () => {
      const { connection, rejected, statuses } = connect()
      const joined = vi.fn()
      connection.onJoin(joined)

      refuse()
      expect(rejected).not.toHaveBeenCalled()
      expect(statuses).toHaveBeenLastCalledWith('offline')
      expect(phoenix.state.socket.connected).toBe(false)
      expect(phoenix.state.channel.leave).not.toHaveBeenCalled()

      vi.advanceTimersByTime(60_999)
      expect(phoenix.state.socket.connected).toBe(false)
      vi.advanceTimersByTime(5_001)
      expect(phoenix.state.socket.connected).toBe(true)

      phoenix.state.channel.hooks.get('ok')(joinReply())
      expect(joined).toHaveBeenCalledOnce()
      expect(statuses).toHaveBeenLastCalledWith('online')
      expect(rejected).not.toHaveBeenCalled()
    })

    it('gives up after a few minutes of it, keeping the token', () => {
      const { rejected } = connect()
      for (let attempt = 0; attempt < 5; attempt++) {
        refuse()
        expect(rejected).not.toHaveBeenCalled()
        vi.advanceTimersByTime(66_001)
      }
      refuse()
      expect(rejected).toHaveBeenCalledExactlyOnceWith('failed')
      expect(phoenix.state.channel.leave).toHaveBeenCalled()
      expect(phoenix.state.socket.connected).toBe(false)
    })

    it('starts counting again after a join gets through', () => {
      const { rejected } = connect()
      for (let round = 0; round < 3; round++) {
        for (let attempt = 0; attempt < 5; attempt++) {
          refuse()
          vi.advanceTimersByTime(66_001)
        }
        phoenix.state.channel.hooks.get('ok')(joinReply())
      }
      expect(rejected).not.toHaveBeenCalled()
    })

    it('does not come back after the overlay has closed', () => {
      const { connection } = connect()
      refuse()
      connection.disconnect()
      vi.advanceTimersByTime(66_001)
      expect(phoenix.state.socket.connected).toBe(false)
    })
  })

  it('says offline as soon as the browser loses the network, and online once it is back and still joined', () => {
    const { connection, statuses } = connect()
    phoenix.state.channel.hooks.get('ok')(joinReply())
    phoenix.state.channel.state = 'joined'

    window.dispatchEvent(new Event('offline'))
    expect(statuses).toHaveBeenLastCalledWith('offline')
    window.dispatchEvent(new Event('online'))
    expect(statuses).toHaveBeenLastCalledWith('online')

    connection.disconnect()
    statuses.mockClear()
    window.dispatchEvent(new Event('offline'))
    expect(statuses).not.toHaveBeenCalled()
  })

  it('stays offline when the network is back but the socket is not, until it rejoins', () => {
    const { statuses } = connect()
    phoenix.state.channel.hooks.get('ok')(joinReply())
    window.dispatchEvent(new Event('offline'))
    phoenix.state.socket.connected = false
    window.dispatchEvent(new Event('online'))
    expect(statuses).toHaveBeenLastCalledWith('offline')
  })

  it('reports socket trouble as offline and keeps reconnecting: an unreachable server is not a refusal', () => {
    const { rejected, statuses } = connect()
    for (let attempt = 0; attempt < 5; attempt++) phoenix.state.socket.errorCallbacks.forEach((callback: () => void) => callback())
    expect(statuses).toHaveBeenLastCalledWith('offline')
    expect(rejected).not.toHaveBeenCalled()
    expect(phoenix.state.socket.connected).toBe(true)
  })

  it('treats every join error as terminal: leaves, disconnects and never rejoins (M2)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    for (const [reason, expected] of [
      ['unauthorized', 'unauthorized'],
      ['join crashed', 'failed'],
    ] as const) {
      const { rejected, statuses } = connect()
      const channel = phoenix.state.channel
      channel.hooks.get('error')({ reason })
      expect(rejected).toHaveBeenCalledWith(expected)
      expect(channel.leave).toHaveBeenCalled()
      expect(phoenix.state.socket.connected).toBe(false)
      phoenix.state.socket.errorCallbacks.forEach((callback: () => void) => callback())
      expect(statuses).not.toHaveBeenCalledWith('offline')
    }
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it("reports each person once with their most recent tab's page, role and ink", () => {
    const { connection } = connect()
    const people = vi.fn()
    connection.onPresence(people)

    phoenix.state.presence.state = {
      [jonas.id]: {
        metas: [
          { display_name: 'Jonas', role: 'reviewer', ink: 3, page_url: '/old', page_title: 'Old', online_at: '2026-10-24T20:00:00Z' },
          { display_name: 'Jonas', role: 'reviewer', ink: 3, page_url: '/pricing', page_title: 'Pricing', online_at: '2026-10-24T20:05:00Z' },
        ],
      },
      [dima.id]: { metas: [{ display_name: 'Dima', role: 'builder', ink: 1, page_url: '/', page_title: null, online_at: '2026-10-24T20:00:00Z' }] },
    }
    phoenix.state.presence.sync()

    expect(people).toHaveBeenCalledWith([
      { ...jonas, page_url: '/pricing', page_title: 'Pricing' },
      { ...dima, page_url: '/', page_title: null },
    ])
  })
})
