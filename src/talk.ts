import { anchorTarget, createAnchor, createSelectionAnchor, elementText, isElement, isMasked, isRendered, sectionName } from './anchor'
import { captureEnvironment } from './capture'
import { documentTitle, normalizePageUrl } from './page-url'
import { emptyTrack, parseTrack, recordPointer, type PointerRecording, type PointerTrack } from './pointer-track'
import type { Anchor, Comment, Environment, TalkStatus, Transcription, Viewport } from './protocol'
import type { SafeStorage } from './storage'

export type TalkEvent = {
  id: string
  at_ms: number
  type: 'page' | 'click' | 'point' | 'select' | 'element'
  page_url: string
  page_title: string | null
  anchor: Anchor | null
  viewport: Viewport | null
  environment: Environment | null
  context?: string | null
}

export type Utterance = { at_ms: number; text: string; end_ms?: number; words_ms?: number[] }

export type TalkListener = {
  heard(utterance: Utterance): void
  level(value: number): void
  words(text: string): void
  pointed(element: Element, type: 'click' | 'point'): void
  ended(): void
}

export type TalkCapture = {
  stop(): Promise<void>
  flush?(): void
  example?: boolean
}

export class TalkRefused extends Error {
  readonly reason: 'denied' | 'unsupported' | 'blocked' | 'unavailable'

  constructor(reason: TalkRefused['reason']) {
    super(reason)
    this.reason = reason
  }
}

export type OnPreparing = (fraction: number | null) => void

export type TalkOutcome =
  | { status: 'done'; comments: Comment[]; minutes_left: number }
  | { status: 'processing' }
  | { status: 'out_of_minutes' }
  | { status: 'name_required' }
  | { status: 'failed' }
  | { status: 'empty' }

export type TalkRecording = {
  timeline: TalkEvent[]
  utterances: Utterance[]
  track: PointerTrack
  durationMs: number
  transcription: Transcription | null
}

export type TalkBackend = {
  pick(transcribers: Transcription[]): Transcription | null
  record(talkId: string, offsetMs: number, transcription: Transcription, listener: TalkListener): Promise<TalkCapture>
  submit(talkId: string, recording: TalkRecording, onPreparing?: OnPreparing): Promise<TalkOutcome>
  forget(talkId: string, transcription: Transcription | null): Promise<void>
  purgeAbandoned?(keep: string | null): Promise<void>
}

export type TalkState =
  | { phase: 'opening' }
  | { phase: 'recording'; elapsedMs: number; level: number; words: string; example: boolean }
  | { phase: 'turning'; preparing?: number }
  | { phase: 'naming' }
  | { phase: 'failed' }

type Saved = { id: string; reviewer_id: string | null; phase: 'recording' | 'turning' | 'naming' | 'failed'; elapsed_ms: number; events: TalkEvent[]; utterances: Utterance[]; transcription: Transcription | null }

export type TalkAnnouncement = { id: string; state: 'recording' | 'paused' | 'stopped'; at_ms: number }

const TICK_MS = 250
const SELECTION_SETTLE_MS = 500
const SELECTION_GROWS_MS = 2000
const END_OF_THIS_TO_START_OF_OTHER = 1
const START_OF_THIS_TO_END_OF_OTHER = 3
const MAX_EVENTS = 900
const MAX_OUTLINE = 1500
const MAX_OUTLINE_PER_PAGE = 120
const OUTLINE_EVERY_MS = 4000
const TITLE_LENGTH = 300
const OUTLINE = 'h1, h2, h3, h4, a[href], button, [role="button"], [data-testid], label, summary, th, img[alt]'
const RETRY_MS = 3000
const MAX_WAITS = 40
const REFUSALS = {
  denied: 'Allow the microphone to talk. Comment works without it.',
  unsupported: "This browser can't record here. Comment works without it.",
  blocked: "This site's security settings block on-device speech. Comment works without it.",
  unavailable: "On-device speech didn't load. Try again, or use Comment.",
}

export type TalkOptions = {
  window: Window
  backend: TalkBackend
  session: SafeStorage
  key: string
  isOwnEvent(event: Event): boolean
  isOwnElement(element: Element): boolean
  viewport(): Viewport
  status(): TalkStatus | null
  named(): boolean
  reviewerId(): string | null
  onChange(state: TalkState | null): void
  onDone(comments: Comment[], minutesLeft: number): void
  notify(message: string, tone?: 'neutral' | 'error'): void
}

export type Talk = ReturnType<typeof createTalk>

export function createTalk(options: TalkOptions) {
  const { window: target, backend, session, key } = options
  const trackKey = `${key}:track`
  let state: TalkState | null = null
  let id = ''
  let events: TalkEvent[] = []
  let utterances: Utterance[] = []
  let track = emptyTrack()
  let pointer: PointerRecording | null = null
  let transcription: Transcription | null = null
  let baseMs = 0
  let startedAt = 0
  let capture: TalkCapture | null = null
  let stopping: TalkCapture | null = null
  let ticking: ReturnType<typeof setInterval> | undefined
  let outlining: ReturnType<typeof setInterval> | undefined
  let unwatch = () => {}
  let level = 0
  let words = ''
  let gone = false
  let kept = false

  function set(next: TalkState | null) {
    state = next
    options.onChange(next)
  }

  function elapsed(): number {
    return capture ? baseMs + (Date.now() - startedAt) : baseMs
  }

  function announce(state: TalkAnnouncement['state']) {
    const detail: TalkAnnouncement = { id, state, at_ms: elapsed() }
    try {
      target.dispatchEvent(new CustomEvent('mostra:talk', { detail }))
    } catch {
    }
  }

  function save(phase: Saved['phase']) {
    const saved: Saved = { id, reviewer_id: options.reviewerId(), phase, elapsed_ms: elapsed(), events, utterances, transcription }
    session.set(key, JSON.stringify(saved))
    session.set(trackKey, JSON.stringify(track))
  }

  function clear() {
    session.remove(key)
    session.remove(trackKey)
    selecting = null
    events = []
    utterances = []
    track = emptyTrack()
    baseMs = 0
    set(null)
  }

  function record(type: TalkEvent['type'], anchor: Anchor | null, context: string | null = null): TalkEvent | null {
    if (type !== 'page' && events.filter((event) => event.type !== 'element').length >= MAX_EVENTS) return null
    const recorded = happening(`e${events.length + 1}`, elapsed(), type, anchor, context)
    events.push(recorded)
    return recorded
  }

  function happening(id: string, at: number, type: TalkEvent['type'], anchor: Anchor | null, context: string | null): TalkEvent {
    return { id, at_ms: at, type, page_url: normalizePageUrl(target.location), page_title: pageTitle(), anchor, viewport: options.viewport(), environment: captureEnvironment(target), context }
  }

  let selecting: { id: string; range: Range; changedAt: number } | null = null

  function selected(range: Range) {
    const around = range.commonAncestorContainer
    const context = sectionName(isElement(around) ? around : (around.parentElement ?? target.document.body))
    const anchor = createSelectionAnchor(range)
    const at = elapsed()
    const index = selecting ? events.findIndex((event) => event.id === selecting!.id && event.type === 'select') : -1
    const earlier = events[index]
    if (selecting && earlier && at - selecting.changedAt <= SELECTION_GROWS_MS && overlaps(selecting.range, range)) {
      events[index] = happening(earlier.id, earlier.at_ms, 'select', anchor, context)
    } else {
      const recorded = record('select', anchor, context)
      if (!recorded) return
      selecting = { id: recorded.id, range, changedAt: at }
    }
    selecting!.range = range.cloneRange()
    selecting!.changedAt = at
  }

  function pageTitle(): string | null {
    return documentTitle(target.document).slice(0, TITLE_LENGTH) || null
  }

  function outlinePage() {
    const pageUrl = normalizePageUrl(target.location)
    const outlined = events.filter((event) => event.type === 'element')
    const known = new Set(outlined.filter((event) => event.page_url === pageUrl).map((event) => `${event.anchor?.element_text}\n${event.context ?? ''}`))
    let room = Math.min(MAX_OUTLINE - outlined.length, MAX_OUTLINE_PER_PAGE - known.size)
    for (const element of target.document.querySelectorAll(OUTLINE)) {
      if (room <= 0) return
      const text = elementText(element)
      if (!text || isMasked(element) || !isRendered(element)) continue
      const context = sectionName(element)
      if (known.has(`${text}\n${context ?? ''}`)) continue
      const { selectors, label, element_text } = createAnchor(anchorTarget(element), null)
      known.add(`${text}\n${context ?? ''}`)
      room -= 1
      events.push({ id: `e${events.length + 1}`, at_ms: elapsed(), type: 'element', page_url: pageUrl, page_title: pageTitle(), anchor: { selectors, label, element_text }, viewport: null, environment: null, context })
    }
  }

  const listener: TalkListener = {
    heard(utterance) {
      utterances.push(utterance)
    },
    level(value) {
      level = value
    },
    words(text) {
      words = text
    },
    pointed(element, type) {
      const box = element.getBoundingClientRect()
      record(type, createAnchor(anchorTarget(element), { x: box.left + box.width / 2, y: box.top + box.height / 2 }), sectionName(element))
    },
    ended() {
      void stop()
    },
  }

  async function open() {
    set({ phase: 'opening' })
    const picked = backend.pick(options.status()?.transcribers ?? [])
    try {
      if (!picked) throw new TalkRefused('unsupported')
      capture = await backend.record(id, baseMs, picked, listener)
    } catch (error) {
      await refused(error)
      return
    }
    if (gone) {
      void capture.stop()
      capture = null
      return
    }
    startedAt = Date.now()
    transcription = transcription === 'local' ? 'local' : picked
    level = 0
    words = ''
    announce('recording')
    record('page', null)
    pointer = recordPointer(target, track, { isOwnEvent: options.isOwnEvent, isOwnElement: options.isOwnElement, now: elapsed, pageUrl: () => normalizePageUrl(target.location), pageTitle })
    unwatch = watchClicks(target, options.isOwnEvent, record, selected)
    ticking = setInterval(tick, TICK_MS)
    outlining = setInterval(outlinePage, OUTLINE_EVERY_MS)
    tick()
  }

  async function refused(error: unknown) {
    if (baseMs > 0 || utterances.length > 0) {
      await turn()
      return
    }
    clear()
    const reason = error instanceof TalkRefused ? error.reason : 'unsupported'
    options.notify(REFUSALS[reason], 'error')
  }

  function tick() {
    const limit = options.status()?.max_duration_ms ?? Infinity
    if (elapsed() >= limit) {
      void stop()
      return
    }
    set({ phase: 'recording', elapsedMs: elapsed(), level, words, example: capture?.example === true })
  }

  function stopWatching() {
    clearInterval(ticking)
    clearInterval(outlining)
    unwatch()
    unwatch = () => {}
    pointer?.stop()
    pointer = null
  }

  async function stop() {
    if (state?.phase !== 'recording') return
    outlinePage()
    baseMs = elapsed()
    stopWatching()
    stopping = capture
    capture = null
    announce('stopped')
    set({ phase: 'turning' })
    save('turning')
    await stopping?.stop()
    stopping = null
    await turn()
  }

  async function turn() {
    if (!options.named()) return waitForName()
    set({ phase: 'turning' })
    save('turning')
    for (let waits = 0; waits < MAX_WAITS; waits++) {
      const outcome = await backend.submit(id, { timeline: events, utterances, track, durationMs: baseMs, transcription }, (preparing) => set(preparing === null ? { phase: 'turning' } : { phase: 'turning', preparing }))
      switch (outcome.status) {
        case 'done':
          await backend.forget(id, transcription)
          clear()
          if (outcome.comments.length === 0) options.notify("We didn't catch any feedback in that. Try again, or use Comment.")
          options.onDone(outcome.comments, outcome.minutes_left)
          return
        case 'name_required':
          waitForName()
          return
        case 'out_of_minutes':
          save('failed')
          set({ phase: 'failed' })
          options.notify('No talking minutes left this month. Your recording stays in this tab until you close it or discard it.', 'error')
          return
        case 'empty':
          await backend.forget(id, transcription)
          clear()
          options.notify("We didn't hear anything. Try again, or use Comment.", 'error')
          return
        case 'failed':
          save('failed')
          set({ phase: 'failed' })
          return
        case 'processing':
          await new Promise((resolve) => setTimeout(resolve, RETRY_MS))
      }
    }
    save('failed')
    set({ phase: 'failed' })
  }

  function waitForName() {
    save('naming')
    set({ phase: 'naming' })
  }

  const saveOnLeaving = () => {
    if (stopping) {
      stopping.flush?.()
      save('turning')
    } else if (state?.phase === 'recording') {
      capture?.flush?.()
      outlinePage()
      pointer?.leave()
      save('recording')
      announce('paused')
    }
  }
  target.addEventListener('pagehide', saveOnLeaving)

  return {
    async resume() {
      const found = parseSaved(session.get(key))
      const saved = found?.reviewer_id === options.reviewerId() ? found : null
      void backend.purgeAbandoned?.(saved?.id ?? null)
      if (found && !saved) {
        void backend.forget(found.id, found.transcription).catch(() => {})
        session.remove(key)
        session.remove(trackKey)
      }
      if (!saved) return
      id = saved.id
      events = saved.events
      utterances = saved.utterances
      track = parseTrack(session.get(trackKey)) ?? emptyTrack()
      transcription = saved.transcription
      baseMs = saved.elapsed_ms
      if (saved.phase === 'recording') await open()
      else if (saved.phase === 'turning' || saved.phase === 'naming') await turn()
      else set({ phase: 'failed' })
    },
    async start() {
      if (state) return
      id = newTalkId()
      selecting = null
      events = []
      utterances = []
      track = emptyTrack()
      transcription = null
      baseMs = 0
      await open()
    },
    stop,
    async retry() {
      if (state?.phase === 'failed' || state?.phase === 'naming') await turn()
    },
    async drop() {
      if (state?.phase !== 'failed' && state?.phase !== 'naming') return
      await backend.forget(id, transcription)
      clear()
    },
    pageChanged() {
      if (state?.phase === 'recording') record('page', null)
    },
    keep() {
      if (!id || !state || (state.phase === 'opening' && baseMs === 0 && utterances.length === 0)) return
      kept = true
      baseMs = elapsed()
      stopWatching()
      const listening = capture
      capture = null
      if (state.phase === 'recording') announce('stopped')
      set({ phase: 'failed' })
      save('failed')
      void listening?.stop().then(() => save('failed'))
    },
    destroy() {
      gone = true
      stopWatching()
      target.removeEventListener('pagehide', saveOnLeaving)
      if (state?.phase === 'recording') announce('stopped')
      const stopping = capture
      capture = null
      void stopping?.stop()
      if (id && state && !kept) {
        void backend.forget(id, transcription)
        session.remove(key)
        session.remove(trackKey)
      }
    },
  }
}

function watchClicks(target: Window, isOwnEvent: (event: Event) => boolean, record: (type: TalkEvent['type'], anchor: Anchor | null, context: string | null) => void, selected: (range: Range) => void): () => void {
  let settle: ReturnType<typeof setTimeout> | undefined

  const onClick = (event: MouseEvent) => {
    if (isOwnEvent(event)) return
    const element = event.composedPath()[0] as Element | undefined
    if (element && typeof element.getBoundingClientRect === 'function') record('click', createAnchor(anchorTarget(element), { x: event.clientX, y: event.clientY }), sectionName(element))
  }

  const onSelection = () => {
    clearTimeout(settle)
    settle = setTimeout(() => {
      const selection = target.getSelection()
      if (!selection || selection.isCollapsed || selection.rangeCount === 0 || !selection.toString().trim()) return
      try {
        selected(selection.getRangeAt(0).cloneRange())
      } catch {
      }
    }, SELECTION_SETTLE_MS)
  }

  target.addEventListener('click', onClick, { capture: true, passive: true })
  target.document.addEventListener('selectionchange', onSelection)
  return () => {
    clearTimeout(settle)
    target.removeEventListener('click', onClick, { capture: true })
    target.document.removeEventListener('selectionchange', onSelection)
  }
}

function overlaps(first: Range, second: Range): boolean {
  try {
    return first.compareBoundaryPoints(START_OF_THIS_TO_END_OF_OTHER, second) <= 0 && first.compareBoundaryPoints(END_OF_THIS_TO_START_OF_OTHER, second) >= 0
  } catch {
    return false
  }
}

function parseSaved(text: string | null): Saved | null {
  if (!text) return null
  try {
    const saved = JSON.parse(text) as Saved
    return typeof saved.id === 'string' && Array.isArray(saved.events) && Array.isArray(saved.utterances) ? saved : null
  } catch {
    return null
  }
}

function newTalkId(): string {
  const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
  return `t-${random}`
}
