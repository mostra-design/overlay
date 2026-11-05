import type { ChannelLike, Comment, Connection, ConnectionStatus, JoinReply, Person, PresentPerson, PushLike, PushStatus, Rejection, Version } from '../src/protocol'

type Reply = { status: PushStatus; response?: unknown }
type Responder = (payload: any) => Reply | unknown

export function createFakeChannel() {
  const handlers = new Map<string, Array<(payload: unknown) => void>>()
  const responders = new Map<string, Responder>()
  const pushes: Array<{ event: string; payload: any }> = []

  const channel: ChannelLike = {
    on(event, callback) {
      handlers.set(event, [...(handlers.get(event) ?? []), callback])
      return handlers.get(event)!.length
    },
    push(event, payload) {
      pushes.push({ event, payload })
      const hooks = new Map<PushStatus, (response?: unknown) => void>()
      const push: PushLike = {
        receive(status, callback) {
          hooks.set(status, callback)
          return push
        },
      }
      queueMicrotask(() => {
        const answer = responders.get(event)?.(payload) ?? { status: 'ok', response: {} }
        const reply = isReply(answer) ? answer : { status: 'ok' as const, response: answer }
        hooks.get(reply.status)?.(reply.response)
      })
      return push
    },
  }

  return {
    channel,
    pushes,
    respond(event: string, responder: Responder) {
      responders.set(event, responder)
    },
    emit(event: string, payload: unknown) {
      for (const handler of handlers.get(event) ?? []) handler(payload)
    },
  }
}

function isReply(value: unknown): value is Reply {
  return typeof value === 'object' && value !== null && 'status' in value && ['ok', 'error', 'timeout'].includes((value as Reply).status)
}

export function createFakeConnection(channel: ChannelLike) {
  const joins: Array<(reply: JoinReply) => void> = []
  const presences: Array<(people: PresentPerson[]) => void> = []
  const statuses: Array<(status: ConnectionStatus) => void> = []
  const rejections: Array<(reason: Rejection) => void> = []
  let disconnected = false

  const connection: Connection = {
    channel,
    onJoin: (callback) => void joins.push(callback),
    onPresence: (callback) => void presences.push(callback),
    onStatus: (callback) => void statuses.push(callback),
    onRejected: (callback) => void rejections.push(callback),
    disconnect() {
      disconnected = true
    },
  }

  return {
    connection,
    join(reply: JoinReply) {
      for (const callback of statuses) callback('online')
      for (const callback of joins) callback(reply)
    },
    status(status: ConnectionStatus) {
      for (const callback of statuses) callback(status)
    },
    presence(people: PresentPerson[]) {
      for (const callback of presences) callback(people)
    },
    reject(reason: Rejection = 'unauthorized') {
      for (const callback of rejections) callback(reason)
    },
    get disconnected() {
      return disconnected
    },
  }
}

export const maya: Person = { id: 'person-maya', display_name: 'Maya', role: 'reviewer', ink: 2 }
export const jonas: Person = { id: 'person-jonas', display_name: 'Jonas', role: 'reviewer', ink: 3 }
export const dima: Person = { id: 'person-dima', display_name: 'Dima', role: 'builder', ink: 1 }
export const agent: Person = { id: 'person-agent', display_name: 'Claude Code for Dima', role: 'agent', ink: null }

export const v14: Version = { id: 'version-14', label: 'a1c94e2', number: 14 }
export const v15: Version = { id: 'version-15', label: '9be01d7', number: 15 }

let sequence = 0

export function makeComment(overrides: Partial<Comment> = {}): Comment {
  sequence++
  return {
    id: `comment-${sequence}`,
    number: sequence + 30,
    parent_id: null,
    kind: 'change',
    status: 'open',
    resolution: null,
    duplicate_of: null,
    visibility: 'everyone',
    body: `Comment ${sequence}`,
    author: jonas,
    attribution: null,
    page_url: '/',
    page_title: 'Home',
    version: v14,
    anchor: { selectors: [{ type: 'testid', value: 'cta' }], offset: { x: 0.5, y: 0.5 }, rect: { x: 10, y: 20, width: 100, height: 40 }, element_text: 'Start free trial', label: "'Start free trial' link" },
    viewport: null,
    environment: null,
    suggested_text: null,
    source: 'typed',
    talk_id: null,
    client_id: null,
    fixed: null,
    resolved: null,
    event: null,
    checkable: false,
    link: null,
    edited_at: null,
    inserted_at: '2026-10-24T20:00:00.000000Z',
    updated_at: '2026-10-24T20:00:00.000000Z',
    ...overrides,
  }
}

export function makeReply(thread: Comment, overrides: Partial<Comment> = {}): Comment {
  return makeComment({ parent_id: thread.id, number: null, kind: null, status: null, anchor: null, page_url: thread.page_url, ...overrides })
}

export function joinReply(overrides: Partial<JoinReply> = {}): JoinReply {
  return {
    reviewer: maya,
    project: { id: 'project-1', name: 'Lumen' },
    version: v15,
    comments: [],
    verdict: null,
    catch_up: { to_check: [], replied: [] },
    last_seen_at: '2026-10-24T19:00:00.000000Z',
    invite: null,
    talk: null,
    ...overrides,
  }
}

export function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

export function setUrl(path: string) {
  window.history.replaceState(null, '', path)
}
