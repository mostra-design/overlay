import { createAnchor, createSelectionAnchor, describeElement } from './anchor'
import { captureEnvironment } from './capture'
import { applyToSummaries, mergeComments, replacePageComments, withoutComment, withSummaryPage, type CommentMap } from './comments'
import { displayName, isUnresolved, type Transition } from './lifecycle'
import { watchNavigation } from './navigation'
import { documentTitle, normalizePageUrl, urlOnThisSite } from './page-url'
import type { Point } from './placement'
import {
  RETRYABLE,
  request,
  RequestError,
  type Anchor,
  type Comment,
  type CommentSummary,
  type Connection,
  type ConnectionStatus,
  type Invite,
  type JoinReply,
  type Person,
  type PresentPerson,
  type Project,
  type Rejection,
  type TalkStatus,
  type Verdict,
  type VerdictValue,
  type Version,
  type Visibility,
} from './protocol'
import { createStore } from './store'
import type { SafeStorage, StorageKeys } from './storage'
import { createTalk, type TalkBackend, type TalkState } from './talk'
import { parseToolbarPosition, type ToolbarPosition } from './toolbar-position'

export type Target =
  | { kind: 'element'; element: Element; point: Point | null; trail: Element[]; anchor: Anchor }
  | { kind: 'selection'; range: Range; anchor: Anchor }
  | { kind: 'page' }

export type Card =
  | { type: 'composer'; target: Target; draftKey: string }
  | { type: 'thread'; id: string }
  | { type: 'cluster'; ids: string[] }
  | { type: 'done'; checked: number | null }
  | { type: 'shortcuts' }
  | { type: 'welcome' }
  | { type: 'catch-up' }

export type Stepper = { kind: 'browse' | 'check' | 'replies'; numbers: number[]; index: number; checked: number }

export type ListFilter = 'open' | 'mine' | 'resolved' | 'new'

export type Pending = { clientId: string; payload: Record<string, unknown>; comment: Comment }

export type Toast = { id: number; message: string; tone: 'neutral' | 'error'; undo?: () => void }

export type MostraState = {
  connection: ConnectionStatus
  me: Person | null
  project: Project | null
  version: Version | null
  pageUrl: string
  comments: CommentMap
  pending: ReadonlyMap<string, Pending>
  deleting: ReadonlySet<string>
  summaries: ReadonlyMap<string, CommentSummary> | null
  verdict: Verdict | null
  lastSeenAt: string | null
  catchUp: { to_check: number[]; replied: number[] }
  invite: Invite | null
  presence: PresentPerson[]
  mode: { repin: string | null; stay: boolean } | null
  aim: { element: Element; trail: Element[] } | null
  card: Card | null
  list: boolean
  listFilter: ListFilter
  listPerson: string | null
  stepper: Stepper | null
  menu: boolean
  hidden: boolean
  singleKeys: boolean
  toolbar: ToolbarPosition
  read: ReadonlySet<string>
  arrived: ReadonlySet<string>
  positions: ReadonlyMap<string, number>
  unplaced: ReadonlySet<string>
  toasts: Toast[]
  focus: { id: string; nonce: number } | null
  announcement: { text: string; nonce: number } | null
  talkStatus: TalkStatus | null
  talk: TalkState | null
  arrivals: ReadonlySet<string>
}

export type ControllerOptions = {
  window: Window
  version: string | null
  local: SafeStorage
  session: SafeStorage
  keys: StorageKeys
  connect(joinPayload: () => object): Connection
  onRejected(reason: Rejection): void
  onStop(): void
  navigate(url: string): void
  deepLink: number | null
  talk?: TalkBackend | null
  isOwnEvent?: (event: Event) => boolean
  isOwnElement?: (element: Element) => boolean
  peekMs?: () => number | null
}

export type Controller = ReturnType<typeof createController>

const PAGE_VISIT_GAP_MS = 1000
const READS_REFUSED_WAIT_MS = 61_000
const LIST_PAGE_LIMIT = 25
const PAGED_RELOAD_MS = 60_000
const TOAST_MS = 4000
const UNDO_MS = 5000
const PEEK_MS = 3400

export function createController(options: ControllerOptions) {
  const { window: target, local, session, keys } = options
  const store = createStore<MostraState>({
    connection: 'connecting',
    me: null,
    project: null,
    version: null,
    pageUrl: normalizePageUrl(target.location),
    comments: new Map(),
    pending: new Map(),
    deleting: new Set(),
    summaries: null,
    verdict: null,
    lastSeenAt: null,
    catchUp: { to_check: [], replied: [] },
    invite: null,
    presence: [],
    mode: null,
    aim: null,
    card: null,
    list: false,
    listFilter: 'open',
    listPerson: null,
    stepper: null,
    menu: false,
    hidden: local.get(keys.collapsed) === '1',
    singleKeys: local.get(keys.shortcuts) !== '0',
    toolbar: parseToolbarPosition(local.get(keys.toolbar)),
    read: new Set(),
    arrived: new Set(),
    positions: new Map(),
    unplaced: new Set(),
    toasts: [],
    focus: null,
    announcement: null,
    talkStatus: null,
    talk: null,
    arrivals: new Set(),
  })
  const deleted = new Set<string>()
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const deleteTimers = new Map<string, ReturnType<typeof setTimeout>>()
  let joined = false
  let joinedPageUrl = store.get().pageUrl
  let requestedPageUrl: string | null = joinedPageUrl
  let nextVisitAt = 0
  let visitTimer: ReturnType<typeof setTimeout> | null = null
  let summariesLoading: Promise<void> | null = null
  let lastPagedLoadAt = -Infinity
  let nonce = 0
  let markReady = () => {}
  const ready = new Promise<void>((resolve) => (markReady = resolve))
  const talk = options.talk
    ? createTalk({
        window: target,
        backend: options.talk,
        session,
        key: keys.talk,
        isOwnEvent: options.isOwnEvent ?? (() => false),
        isOwnElement: options.isOwnElement ?? (() => false),
        viewport,
        status: () => store.get().talkStatus,
        named: () => Boolean(store.get().me?.display_name),
        reviewerId: () => store.get().me?.id ?? null,
        onChange: (state) => store.update({ talk: state }),
        onDone: (comments, minutesLeft) => {
          merge(comments)
          for (const comment of comments) if (comment.page_url === store.get().pageUrl) peek(comment.id)
          store.update((state) => ({ talkStatus: state.talkStatus && { ...state.talkStatus, minutes_left: minutesLeft } }))
          if (comments.length > 0) notify(`${comments.length} ${comments.length === 1 ? 'comment' : 'comments'} added`)
        },
        notify,
      })
    : null

  const connection = options.connect(() => {
    joinedPageUrl = normalizePageUrl(target.location)
    return { version: options.version, page_url: joinedPageUrl, page_title: documentTitle(target.document) }
  })
  const { channel } = connection
  connection.onJoin(applyJoin)
  connection.onPresence((people) => store.update((state) => ({ presence: people.filter((person) => person.id !== state.me?.id) })))
  connection.onStatus((connectionStatus) => store.update({ connection: connectionStatus }))
  connection.onRejected((reason) => {
    talk?.keep()
    options.onRejected(reason)
  })

  channel.on('comment:created', (payload: { comment: Comment }) => {
    noteArrival(payload.comment)
    receive(payload.comment, true)
  })
  channel.on('comment:updated', (payload: { comment: Comment }) => receive(payload.comment, false))
  channel.on('comment:deleted', (payload: { id: string }) => forget(payload.id))
  channel.on('verdict:changed', (payload: { verdict: Verdict }) => {
    if (payload.verdict.reviewer.id !== store.get().me?.id) return
    store.update({ verdict: payload.verdict.verdict === null ? null : payload.verdict })
  })

  function noteArrival(comment: Comment) {
    const thread = comment.parent_id
    if (!thread || comment.author.id === store.get().me?.id) return
    store.update((state) => {
      if (state.card?.type === 'thread' && state.card.id === thread) return {}
      const read = new Set(state.read)
      read.delete(thread)
      return { read, arrived: new Set(state.arrived).add(comment.id) }
    })
  }

  const stopWatching = watchNavigation(target, () => visitPage())
  const flushDeletes = () => {
    for (const id of Array.from(deleteTimers.keys())) commitDelete(id)
  }
  target.addEventListener('pagehide', flushDeletes)

  function applyJoin(reply: JoinReply) {
    const pageUrl = joinedPageUrl
    requestedPageUrl = pageUrl
    const first = !joined
    store.update((state) => ({
      me: reply.reviewer,
      project: reply.project,
      version: reply.version,
      verdict: first ? reply.verdict : state.verdict,
      comments: replacePageComments(state.comments, pageUrl, reply.comments, deleted),
      ...(first
        ? {
            lastSeenAt: reply.last_seen_at,
            catchUp: reply.catch_up,
            invite: reply.invite,
            card: firstCard(reply),
            talkStatus: reply.talk && options.talk?.pick(reply.talk.transcribers) ? reply.talk : null,
          }
        : {}),
    }))
    if (first) {
      joined = true
      if (reply.reviewer.role === 'builder') void request(channel, 'seen').catch(() => {})
      markReady()
      void resume()
      void talk?.resume()
    }
    resendPending()
    if (normalizePageUrl(target.location) !== pageUrl) visitPage()
  }

  function firstCard(reply: JoinReply): Card | null {
    if (reply.invite) return { type: 'welcome' }
    if (reply.reviewer.role !== 'builder' && hasCatchUp(reply.catch_up)) return { type: 'catch-up' }
    return null
  }

  async function resume() {
    const saved = parseJson<Stepper>(session.get(keys.player))
    const focusNumber = Number(session.get(keys.pendingFocus)) || null
    session.remove(keys.pendingFocus)
    if (saved && Array.isArray(saved.numbers) && saved.numbers.length > 0) {
      store.update({ stepper: saved, card: null })
      await showStep(saved.index, false)
    } else if (focusNumber) {
      await openNumber(focusNumber, false)
    }
    if (options.deepLink) await openNumber(options.deepLink, true)
  }

  function visitPage() {
    const pageUrl = normalizePageUrl(target.location)
    if (pageUrl !== store.get().pageUrl) {
      talk?.pageChanged()
      store.update((state) => ({
        pageUrl,
        card: state.card && keepsAcrossPages(state.card, state.comments) ? state.card : null,
        aim: null,
        focus: null,
        positions: new Map(),
        unplaced: new Set(),
      }))
    }
    if (!joined || pageUrl === requestedPageUrl) return
    const wait = nextVisitAt - Date.now()
    if (wait > 0) {
      visitTimer ??= later(() => {
        visitTimer = null
        visitPage()
      }, wait)
      return
    }
    nextVisitAt = Date.now() + PAGE_VISIT_GAP_MS
    requestedPageUrl = pageUrl
    request<{ comments: Comment[] }>(channel, 'page:visit', { page_url: pageUrl, page_title: documentTitle(target.document) }).then(
      ({ comments }) => {
        store.update((state) => ({ comments: replacePageComments(state.comments, pageUrl, comments, deleted) }))
        const { stepper } = store.get()
        if (stepper) void showStep(stepper.index, false)
      },
      (error: RequestError) => {
        if (requestedPageUrl === pageUrl) requestedPageUrl = null
        if (error.reason !== 'rate_limited') return
        nextVisitAt = Date.now() + READS_REFUSED_WAIT_MS
        visitPage()
      },
    )
  }

  function receive(comment: Comment, created: boolean) {
    const state = store.get()
    const known = state.comments.has(comment.id) || (state.summaries?.has(comment.id) ?? false)
    merge([comment])
    if (comment.client_id && comment.author.id === state.me?.id) settlePending(comment.client_id, comment)
    const landed = created && !state.comments.has(comment.id) && comment.author.id !== state.me?.id
    if (landed && comment.parent_id === null && comment.number !== null && comment.page_url === state.pageUrl) peek(comment.id)
    if (created && !known && comment.author.id !== state.me?.id) {
      const where = comment.page_url === state.pageUrl ? 'this page' : (comment.page_title ?? comment.page_url ?? 'a version note')
      if (comment.parent_id === null && comment.number !== null) announce(`New comment ${comment.number} from ${displayName(comment.author)} on ${where}`)
      else if (comment.parent_id !== null) announce(`New reply from ${displayName(comment.author)}`)
    }
  }

  function peek(id: string) {
    store.update((state) => ({ arrivals: new Set(state.arrivals).add(id) }))
    const timer = setTimeout(() => {
      timers.delete(timer)
      store.update((state) => {
        const arrivals = new Set(state.arrivals)
        arrivals.delete(id)
        return { arrivals }
      })
    }, options.peekMs?.() ?? PEEK_MS)
    timers.add(timer)
  }

  function merge(comments: readonly Comment[]) {
    store.update((state) => {
      let summaries = state.summaries
      if (summaries) for (const comment of comments) summaries = applyToSummaries(summaries, comment, state.comments.has(comment.id))
      return { comments: mergeComments(state.comments, comments, deleted), summaries }
    })
  }

  function forget(id: string) {
    deleted.add(id)
    store.update((state) => {
      const comment = state.comments.get(id) ?? state.summaries?.get(id)
      let summaries = state.summaries
      if (summaries?.has(id)) {
        const next = new Map(summaries)
        next.delete(id)
        summaries = next
      } else if (summaries && comment?.parent_id) {
        const thread = summaries.get(comment.parent_id)
        if (thread) summaries = new Map(summaries).set(thread.id, { ...thread, reply_count: Math.max(0, thread.reply_count - 1) })
      }
      return { comments: withoutComment(state.comments, id), summaries, card: cardWithout(state.card, id) }
    })
  }

  async function sendComment(payload: Record<string, unknown>, optimistic: Comment): Promise<Comment | null> {
    const clientId = optimistic.client_id!
    store.update((state) => ({ pending: new Map(state.pending).set(clientId, { clientId, payload, comment: optimistic }) }))
    return push(clientId)
  }

  async function push(clientId: string): Promise<Comment | null> {
    const pending = store.get().pending.get(clientId)
    if (!pending) return null
    try {
      const { comment } = await request<{ comment: Comment }>(channel, 'comment:create', pending.payload)
      merge([comment])
      settlePending(clientId, comment)
      return comment
    } catch (error) {
      const reason = error instanceof RequestError ? error.reason : 'error'
      if (RETRYABLE.has(reason) || store.get().connection !== 'online') return null
      store.update((state) => {
        const next = new Map(state.pending)
        next.delete(clientId)
        return { pending: next, card: cardWithout(state.card, pending.comment.id) }
      })
      drafts.set(draftKeyFor(pending), String(pending.payload.body ?? ''))
      notify(reason === 'name_required' ? 'Add your name, then send again.' : "Couldn't send your comment. It's kept in the composer.", 'error')
      return null
    }
  }

  function settlePending(clientId: string, comment: Comment) {
    const pending = store.get().pending.get(clientId)
    if (!pending) return
    store.update((state) => {
      const next = new Map(state.pending)
      next.delete(clientId)
      const card = state.card?.type === 'thread' && state.card.id === pending.comment.id ? { type: 'thread' as const, id: comment.id } : state.card
      return { pending: next, card }
    })
  }

  function resendPending() {
    for (const clientId of store.get().pending.keys()) void push(clientId)
  }

  function optimisticComment(fields: Partial<Comment>): Comment {
    const { me, version, pageUrl } = store.get()
    const now = new Date().toISOString()
    const clientId = newClientId()
    return {
      id: `pending:${clientId}`,
      number: null,
      parent_id: null,
      kind: 'change',
      status: 'open',
      resolution: null,
      duplicate_of: null,
      visibility: 'everyone',
      body: '',
      author: me!,
      attribution: null,
      page_url: pageUrl,
      page_title: documentTitle(target.document) || null,
      version,
      anchor: null,
      viewport: null,
      environment: null,
      suggested_text: null,
      source: 'typed',
      talk_id: null,
      client_id: clientId,
      fixed: null,
      resolved: null,
      event: null,
      checkable: false,
      link: null,
      edited_at: null,
      inserted_at: now,
      updated_at: now,
      ...fields,
    }
  }

  async function send<Reply>(event: string, payload: object, failure: string): Promise<Reply> {
    try {
      return await request<Reply>(channel, event, payload)
    } catch (error) {
      const reason = error instanceof RequestError ? error.reason : ''
      notify(store.get().connection === 'online' || !RETRYABLE.has(reason) ? failure : "You're offline. Try again when you're back.", 'error')
      throw error
    }
  }

  function notify(message: string, tone: Toast['tone'] = 'neutral', undo?: () => void) {
    const id = ++nonce
    store.update((state) => ({ toasts: [...state.toasts.slice(-1), { id, message, tone, undo }] }))
    later(() => dismissToast(id), undo ? UNDO_MS : TOAST_MS)
    if (!undo) announce(message)
  }

  function dismissToast(id: number) {
    store.update((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }))
  }

  function announce(text: string) {
    store.update({ announcement: { text, nonce: ++nonce } })
  }

  function later(callback: () => void, delay: number) {
    const timer = setTimeout(() => {
      timers.delete(timer)
      callback()
    }, delay)
    timers.add(timer)
    return timer
  }

  function openCard(card: Card | null) {
    store.update((state) => ({
      card,
      list: card ? false : state.list,
      menu: false,
      read: card?.type === 'thread' ? new Set(state.read).add(card.id) : state.read,
      focus: card?.type === 'thread' ? { id: card.id, nonce: ++nonce } : state.focus,
    }))
  }

  async function openNumber(number: number, navigate: boolean): Promise<void> {
    const comment = await fetchThread({ number })
    if (!comment) return
    const { pageUrl } = store.get()
    if (comment.page_url === null || comment.page_url === pageUrl) {
      openCard({ type: 'thread', id: comment.id })
    } else if (navigate) {
      const destination = urlOnThisSite(comment.page_url, target.location.origin)
      if (!destination) return
      session.set(keys.pendingFocus, String(number))
      options.navigate(destination)
    }
  }

  async function fetchThread(reference: { number: number } | { id: string }): Promise<Comment | null> {
    try {
      const { comment, replies } = await request<{ comment: Comment; replies: Comment[] }>(channel, 'comment:get', reference)
      merge([comment, ...replies])
      return comment
    } catch {
      return null
    }
  }

  async function loadSummaries(force = false): Promise<void> {
    const upToDate = store.get().summaries !== null && (!force || Date.now() - lastPagedLoadAt < PAGED_RELOAD_MS)
    if (upToDate && !summariesLoading) return
    summariesLoading ??= fetchSummaries().finally(() => (summariesLoading = null))
    await summariesLoading
  }

  async function fetchSummaries(): Promise<void> {
    let after: number | null = null
    try {
      for (let page = 0; page < LIST_PAGE_LIMIT; page++) {
        if (page === 1) lastPagedLoadAt = Date.now()
        const reply: { comments: CommentSummary[]; next_after: number | null } = await request(channel, 'comments:list', after === null ? { filter: 'all' } : { filter: 'all', after })
        const from: number | null = after
        const upTo: number | null = typeof reply.next_after === 'number' && reply.next_after > (from ?? -Infinity) ? reply.next_after : null
        store.update((state) => ({ summaries: withSummaryPage(state.summaries, reply.comments, from, upTo) }))
        if (upTo === null) return
        after = upTo
      }
    } catch {
    }
  }

  function readingOrder(): CommentSummary[] {
    const state = store.get()
    const items = Array.from(state.summaries?.values() ?? []).filter((comment) => comment.page_url !== null && matchesFilter(comment, state))
    const position = (comment: CommentSummary) => state.positions.get(comment.id) ?? comment.anchor?.rect?.y ?? Number.MAX_SAFE_INTEGER
    const here = items.filter((comment) => comment.page_url === state.pageUrl).sort((first, second) => position(first) - position(second) || (first.number ?? 0) - (second.number ?? 0))
    const elsewhere = items
      .filter((comment) => comment.page_url !== state.pageUrl)
      .sort((first, second) => pageName(first).localeCompare(pageName(second)) || (first.number ?? 0) - (second.number ?? 0))
    return [...here, ...elsewhere]
  }

  async function startStepper(kind: Stepper['kind'], numbers: number[], index = 0) {
    if (numbers.length === 0) return
    store.update({ stepper: { kind, numbers, index: 0, checked: 0 }, list: false, mode: null, aim: null })
    await showStep(index, true)
  }

  async function showStep(index: number, navigate: boolean) {
    const { stepper } = store.get()
    if (!stepper) return
    const clamped = Math.max(0, Math.min(index, stepper.numbers.length - 1))
    const next = { ...stepper, index: clamped }
    store.update({ stepper: next })
    session.set(keys.player, JSON.stringify(next))
    await openNumber(next.numbers[clamped]!, navigate)
  }

  function stopStepper() {
    session.remove(keys.player)
    store.update({ stepper: null })
  }

  function commitDelete(id: string) {
    const timer = deleteTimers.get(id)
    if (timer === undefined) return
    clearTimeout(timer)
    deleteTimers.delete(id)
    request(channel, 'comment:delete', { id }).then(
      () => forget(id),
      () => {
        store.update((state) => {
          const next = new Set(state.deleting)
          next.delete(id)
          return { deleting: next }
        })
        notify("Couldn't delete the comment.", 'error')
      },
    )
  }

  const drafts = {
    get(key: string): string {
      return parseJson<Record<string, string>>(session.get(keys.drafts))?.[key] ?? ''
    },
    set(key: string, text: string) {
      const all = parseJson<Record<string, string>>(session.get(keys.drafts)) ?? {}
      if (text.trim()) all[key] = text
      else delete all[key]
      session.set(keys.drafts, JSON.stringify(all))
    },
  }

  function draftKeyFor(pending: Pending): string {
    const { comment } = pending
    if (comment.parent_id) return `reply:${comment.parent_id}`
    return targetKey(comment.page_url ?? '', comment.anchor)
  }

  function composerFor(target: Target): Card {
    const { pageUrl } = store.get()
    return { type: 'composer', target, draftKey: targetKey(pageUrl, target.kind === 'page' ? null : target.anchor) }
  }

  function elementTarget(element: Element, point: Point | null, trail: Element[]): Target {
    return { kind: 'element', element, point, trail, anchor: createAnchor(element, point) }
  }

  function viewport() {
    return {
      width: target.innerWidth,
      height: target.innerHeight,
      scroll_x: Math.round(target.scrollX),
      scroll_y: Math.round(target.scrollY),
      device_pixel_ratio: target.devicePixelRatio || 1,
    }
  }

  function seen() {
    void request(channel, 'seen').catch(() => {})
  }

  const actions = {
    store,
    ready,
    drafts,

    startCommentMode(repin: string | null = null) {
      store.update({ mode: { repin, stay: false }, aim: null, card: null, list: false, menu: false })
      announce(repin ? 'Pick the element again.' : 'Comment mode. Point at something, or press Tab to move between elements.')
    },
    stopCommentMode() {
      store.update({ mode: null, aim: null })
    },
    aimAt(element: Element | null, trail: Element[] = []) {
      if (store.get().aim?.element === element) return
      store.update({ aim: element ? { element, trail } : null })
      if (element) announce(`${describeElement(element)}. Enter to comment, Up for wider.`)
    },
    pick(element: Element, point: Point | null, stay = false) {
      const { mode, aim } = store.get()
      if (!mode) return
      if (mode.repin) {
        const id = mode.repin
        store.update({ mode: null, aim: null })
        void send<{ comment: Comment }>('comment:update', { id, anchor: createAnchor(element, point) }, "Couldn't re-pin the comment.").then(({ comment }) => {
          merge([comment])
          openCard({ type: 'thread', id })
        })
        return
      }
      const trail = aim?.element === element ? aim.trail : []
      store.update({ mode: stay ? { ...mode, stay: true } : null, aim: stay ? aim : null, card: composerFor(elementTarget(element, point, trail)), list: false })
    },
    pickSelection(range: Range) {
      store.update({ mode: null, aim: null, list: false, menu: false, card: composerFor({ kind: 'selection', range: range.cloneRange(), anchor: createSelectionAnchor(range) }) })
    },
    pickPage() {
      store.update({ mode: null, aim: null, list: false, menu: false, card: composerFor({ kind: 'page' }) })
    },
    retarget(element: Element, trail: Element[]) {
      const { card } = store.get()
      if (card?.type !== 'composer' || card.target.kind !== 'element') return
      store.update({ card: composerFor(elementTarget(element, null, trail)) })
    },

    async createComment(input: { body: string; suggestedText: string | null; visibility: Visibility; name: string | null }) {
      const { card, me, pageUrl } = store.get()
      if (card?.type !== 'composer' || !me) return
      if (input.name && !me.display_name) await actions.setName(input.name)
      const targetAnchor = card.target.kind === 'page' ? null : card.target.anchor
      const suggested = card.target.kind === 'selection' && input.suggestedText !== null ? { old_text: card.target.anchor.text_quote?.exact ?? '', new_text: input.suggestedText } : null
      const optimistic = optimisticComment({
        body: input.body,
        visibility: input.visibility,
        anchor: targetAnchor,
        suggested_text: suggested,
        viewport: viewport(),
        environment: captureEnvironment(target),
        author: store.get().me!,
      })
      const payload = {
        client_id: optimistic.client_id,
        body: input.body,
        page_url: pageUrl,
        page_title: optimistic.page_title,
        anchor: targetAnchor,
        viewport: optimistic.viewport,
        environment: optimistic.environment,
        ...(suggested ? { suggested_text: suggested } : {}),
        ...(input.visibility === 'team' ? { visibility: 'team' } : {}),
      }
      drafts.set(card.draftKey, '')
      store.update((state) => ({
        card: state.mode?.stay ? null : { type: 'thread', id: optimistic.id },
        read: new Set(state.read).add(optimistic.id),
      }))
      announce('Sent.')
      await sendComment(payload, optimistic)
    },

    async reply(thread: Comment, body: string, visibility: Visibility, name: string | null = null) {
      if (name && !store.get().me?.display_name) await actions.setName(name)
      const optimistic = optimisticComment({ parent_id: thread.id, body, visibility, kind: null, status: null, page_url: thread.page_url, author: store.get().me! })
      drafts.set(`reply:${thread.id}`, '')
      await sendComment({ client_id: optimistic.client_id, parent_id: thread.id, body, ...(visibility === 'team' ? { visibility } : {}) }, optimistic)
    },

    async edit(id: string, body: string) {
      const { comment } = await send<{ comment: Comment }>('comment:update', { id, body }, "Couldn't save your edit.")
      merge([comment])
    },
    async showToEveryone(id: string) {
      const { comment } = await send<{ comment: Comment }>('comment:update', { id, visibility: 'everyone' }, "Couldn't show it to everyone.")
      merge([comment])
    },

    remove(comment: Comment) {
      const { id } = comment
      store.update((state) => ({ deleting: new Set(state.deleting).add(id), card: cardWithout(state.card, id) }))
      deleteTimers.set(
        id,
        setTimeout(() => commitDelete(id), UNDO_MS),
      )
      const label = comment.number !== null ? `Deleted #${comment.number}` : 'Deleted your reply'
      notify(label, 'neutral', () => {
        clearTimeout(deleteTimers.get(id))
        deleteTimers.delete(id)
        store.update((state) => {
          const next = new Set(state.deleting)
          next.delete(id)
          return { deleting: next }
        })
      })
      announce(`${label}. Undo is available for 5 seconds.`)
    },

    async transition(comment: Comment, transition: Transition, body: string, duplicateOf: number | null = null) {
      const payload = {
        id: comment.id,
        to: transition.to,
        ...(transition.resolution ? { resolution: transition.resolution } : {}),
        ...(duplicateOf !== null ? { duplicate_of: duplicateOf } : {}),
        ...(body.trim() ? { body: body.trim() } : {}),
      }
      const result = await send<{ comment: Comment; reply: Comment | null }>('comment:status', payload, "Couldn't update the comment. Try again.")
      merge(result.reply ? [result.comment, result.reply] : [result.comment])
      const { stepper, catchUp } = store.get()
      if (comment.number !== null && catchUp.to_check.includes(comment.number)) {
        store.update((state) => ({ catchUp: { ...state.catchUp, to_check: state.catchUp.to_check.filter((number) => number !== comment.number) } }))
      }
      if (stepper?.kind === 'check') {
        const checked = { ...stepper, checked: stepper.checked + 1 }
        store.update({ stepper: checked })
        if (stepper.index >= stepper.numbers.length - 1) {
          stopStepper()
          openCard({ type: 'done', checked: stepper.numbers.length })
        } else {
          await showStep(stepper.index + 1, true)
        }
      }
    },

    async toggleTalk() {
      const { talkStatus, talk: current } = store.get()
      if (!talk || !talkStatus) return
      if (current?.phase === 'recording') return talk.stop()
      if (current) return
      if (talkStatus.minutes_left <= 0) return notify('No talking minutes left this month. Comment still works.', 'error')
      store.update({ mode: null, aim: null, card: null, list: false, menu: false })
      await talk.start()
      const started = store.get().talk
      if (started?.phase !== 'recording') return
      if (started.example) return announce('Playing an example.')
      announce('Recording. Talk while you look around.')
    },
    retryTalk: () => talk?.retry(),
    dropTalk: () => talk?.drop(),
    async postTalkAs(name: string) {
      await actions.setName(name)
      await talk?.retry()
    },

    async setVerdict(verdict: VerdictValue | null, note: string) {
      const result = await send<{ verdict: Verdict | null }>('verdict:set', { verdict, ...(note.trim() && verdict ? { note: note.trim() } : {}) }, "Couldn't send your verdict. Try again.")
      store.update({ verdict: result.verdict && result.verdict.verdict ? result.verdict : null })
      drafts.set('verdict', '')
    },

    async setName(name: string) {
      const { reviewer } = await send<{ reviewer: Person }>('reviewer:update', { display_name: name.trim() }, "Couldn't save your name.")
      store.update({ me: reviewer })
    },

    openThread(id: string) {
      openCard({ type: 'thread', id })
    },
    openCluster(ids: string[]) {
      openCard({ type: 'cluster', ids })
    },
    async openDone() {
      openCard({ type: 'done', checked: null })
      await loadSummaries()
    },
    openShortcuts() {
      openCard({ type: 'shortcuts' })
    },
    closeCard() {
      const { card, stepper } = store.get()
      if (card?.type === 'welcome' || card?.type === 'catch-up') return actions.dismissNotice()
      store.update({ card: null })
      if (stepper && (card?.type === 'thread' || card === null)) stopStepper()
    },
    clickAway() {
      const { card, stepper, mode, list } = store.get()
      if (mode) return
      if (list) store.update({ list: false })
      const checking = stepper?.kind === 'check' && card?.type === 'thread'
      if (card && card.type !== 'composer' && !checking) actions.closeCard()
    },
    dismissNotice() {
      const { card, catchUp, me } = store.get()
      if (card?.type === 'welcome' && me?.role !== 'builder' && hasCatchUp(catchUp)) {
        store.update({ card: { type: 'catch-up' } })
        return
      }
      store.update({ card: null })
      if (card?.type === 'welcome' || card?.type === 'catch-up') seen()
    },
    async checkFixes() {
      const { catchUp } = store.get()
      seen()
      store.update({ card: null })
      await startStepper('check', catchUp.to_check)
    },
    async showReplies() {
      const { catchUp } = store.get()
      seen()
      store.update({ card: null })
      await startStepper('replies', catchUp.replied)
    },
    async step(direction: 1 | -1) {
      const { stepper, card } = store.get()
      if (stepper) return showStep(stepper.index + direction, true)
      await loadSummaries()
      const order = readingOrder().map((comment) => comment.number!)
      if (order.length === 0) return
      const current = card?.type === 'thread' ? store.get().comments.get(card.id)?.number : null
      const at = current ? order.indexOf(current) : -1
      const index = at === -1 ? (direction === 1 ? 0 : order.length - 1) : (at + direction + order.length) % order.length
      await startStepper('browse', order, index)
    },
    stopStepper() {
      stopStepper()
      store.update({ card: null })
    },
    toggleList(open = !store.get().list) {
      store.update({ list: open, card: open ? null : store.get().card, menu: false, mode: open ? null : store.get().mode })
      if (open) void loadSummaries(true)
    },
    setListFilter(listFilter: ListFilter, listPerson: string | null = null) {
      store.update({ listFilter, listPerson })
    },
    async open(number: number) {
      store.update({ list: false })
      await openNumber(number, true)
    },
    readingOrder,
    loadSummaries,

    toggleMenu(open = !store.get().menu) {
      store.update({ menu: open, list: open ? false : store.get().list })
    },
    setHidden(hidden: boolean) {
      local.set(keys.collapsed, hidden ? '1' : '0')
      store.update({ hidden, mode: null, aim: null, card: hidden ? null : store.get().card, list: false, menu: false })
      announce(hidden ? 'Comments hidden.' : 'Comments shown.')
    },
    setSingleKeys(singleKeys: boolean) {
      local.set(keys.shortcuts, singleKeys ? '1' : '0')
      store.update({ singleKeys })
    },
    setToolbar(toolbar: ToolbarPosition) {
      local.set(keys.toolbar, JSON.stringify(toolbar))
      store.update({ toolbar })
    },
    setLayout(positions: ReadonlyMap<string, number>, unplaced: ReadonlySet<string>) {
      store.update({ positions, unplaced })
    },
    stopReviewing() {
      options.onStop()
    },

    notify,
    dismissToast,
    announce,
    destroy() {
      flushDeletes()
      stopWatching()
      talk?.destroy()
      target.removeEventListener('pagehide', flushDeletes)
      connection.disconnect()
      for (const timer of timers) clearTimeout(timer)
    },
  }
  return actions
}

export function matchesFilter(comment: CommentSummary | Comment, state: Pick<MostraState, 'listFilter' | 'listPerson' | 'me' | 'lastSeenAt'>): boolean {
  if (state.listPerson && comment.author.id !== state.listPerson) return false
  const note = comment.page_url === null
  switch (state.listFilter) {
    case 'open':
      return note || isUnresolved(comment)
    case 'mine':
      return comment.author.id === state.me?.id
    case 'resolved':
      return comment.status === 'resolved'
    case 'new': {
      const activity = 'last_activity_at' in comment ? comment.last_activity_at : comment.updated_at
      return !state.lastSeenAt || Date.parse(activity) > Date.parse(state.lastSeenAt)
    }
  }
}

export function hasCatchUp(catchUp: JoinReply['catch_up']): boolean {
  return catchUp.to_check.length > 0 || catchUp.replied.length > 0
}

export function targetKey(pageUrl: string, anchor: Anchor | null): string {
  if (!anchor) return `page:${pageUrl}`
  const selector = anchor.text_quote ? `quote:${anchor.text_quote.exact}` : JSON.stringify(anchor.selectors[0] ?? null)
  return `element:${pageUrl}:${selector}`
}

function keepsAcrossPages(card: Card, comments: CommentMap): boolean {
  if (card.type === 'thread') return comments.get(card.id)?.page_url === null
  return card.type === 'done' || card.type === 'shortcuts' || card.type === 'welcome' || card.type === 'catch-up'
}

function cardWithout(card: Card | null, id: string): Card | null {
  if (card?.type === 'thread' && card.id === id) return null
  if (card?.type === 'cluster') {
    const ids = card.ids.filter((other) => other !== id)
    return ids.length > 0 ? { type: 'cluster', ids } : null
  }
  return card
}

function pageName(comment: Comment): string {
  return comment.page_title || comment.page_url || ''
}

function newClientId(): string {
  const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
  return `c-${random}`
}

function parseJson<Value>(text: string | null): Value | null {
  if (!text) return null
  try {
    return JSON.parse(text) as Value
  } catch {
    return null
  }
}
