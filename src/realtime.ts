import { Presence, Socket } from 'phoenix'
import { socketUrl } from './config'
import type { Connection, ConnectionStatus, JoinReply, PresentPerson, Rejection, Role } from './protocol'
import type { SafeStorage } from './storage'

export type RealtimeOptions = {
  endpoint: string
  token: string
  projectId: string
  joinPayload: () => object
  sessionStorage: SafeStorage
}

const RATE_LIMITED_WAIT_MS = 61_000
const RATE_LIMITED_SPREAD_MS = 5_000
const RATE_LIMITED_TRIES = 5

type PresenceMeta = { display_name: string | null; role: Role; ink: number | null; page_url: string | null; page_title: string | null; online_at: string }

export function connectRealtime(options: RealtimeOptions): Connection {
  const joinCallbacks: Array<(reply: JoinReply) => void> = []
  const presenceCallbacks: Array<(people: PresentPerson[]) => void> = []
  const statusCallbacks: Array<(status: ConnectionStatus) => void> = []
  const rejectedCallbacks: Array<(reason: Rejection) => void> = []
  let closed = false
  let refusals = 0
  let waiting: ReturnType<typeof setTimeout> | undefined

  const socket = new Socket(socketUrl(options.endpoint), {
    authToken: options.token,
    sessionStorage: {
      getItem: (key: string) => options.sessionStorage.get(key),
      setItem: (key: string, value: string) => options.sessionStorage.set(key, value),
      removeItem: (key: string) => options.sessionStorage.remove(key),
    },
    reconnectAfterMs: (tries: number) => [250, 1000, 2000, 5000][tries - 1] ?? 10000,
  })

  const setStatus = (status: ConnectionStatus) => {
    if (closed) return
    for (const callback of statusCallbacks) callback(status)
  }

  const channel = socket.channel(`project:${options.projectId}`, options.joinPayload)
  const presence = new Presence(channel)
  presence.onSync(() => {
    const people = presence.list((id: string, { metas }: { metas: PresenceMeta[] }) => presentPerson(id, metas))
    for (const callback of presenceCallbacks) callback(people)
  })

  socket.onError(() => setStatus('offline'))
  channel.onError(() => setStatus('offline'))
  channel
    .join()
    .receive('ok', (reply: JoinReply) => {
      refusals = 0
      setStatus('online')
      for (const callback of joinCallbacks) callback(reply)
    })
    .receive('error', (reply?: { reason?: string }) => {
      if (reply?.reason === 'rate_limited' && refusals < RATE_LIMITED_TRIES) {
        refusals++
        console.warn('[mostra] Too many requests for now. Trying again in a minute.')
        setStatus('offline')
        socket.disconnect()
        waiting = setTimeout(() => socket.connect(), RATE_LIMITED_WAIT_MS + Math.random() * RATE_LIMITED_SPREAD_MS)
        return
      }
      const reason: Rejection = reply?.reason === 'unauthorized' ? reply.reason : 'failed'
      console.warn(`[mostra] Joining the review failed: ${reply?.reason ?? 'unknown reason'}.`)
      close()
      for (const callback of rejectedCallbacks) callback(reason)
    })
  socket.connect()

  function close() {
    if (closed) return
    closed = true
    clearTimeout(waiting)
    channel.leave()
    socket.disconnect()
  }

  return {
    channel,
    onJoin: (callback) => void joinCallbacks.push(callback),
    onPresence: (callback) => void presenceCallbacks.push(callback),
    onStatus: (callback) => void statusCallbacks.push(callback),
    onRejected: (callback) => void rejectedCallbacks.push(callback),
    disconnect: close,
  }
}

function presentPerson(id: string, metas: PresenceMeta[]): PresentPerson {
  const latest = metas.reduce((newest, meta) => (Date.parse(meta.online_at) >= Date.parse(newest.online_at) ? meta : newest))
  return { id, display_name: latest.display_name, role: latest.role, ink: latest.ink, page_url: latest.page_url, page_title: latest.page_title }
}
