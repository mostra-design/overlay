import { isRendered, parentOf } from './anchor'
import { measurePin, readPageContent, type PageContent } from './pin-measure'
import type { Point, Rect, Surroundings } from './placement'
import type { Anchor } from './protocol'
import { backdropOf } from './region'
import { readsPageText, resolveAnchor } from './resolver'

export type Placement = {
  status: 'placed' | 'hidden' | 'pending' | 'unplaced'
  box: Rect | null
  point: Point | null
  surroundings: Surroundings | null
  documentY: number | null
  onTrigger: boolean
  origin: Point | null
  backdrop: string | null
}

export type AnchorTracker = {
  track(anchors: ReadonlyMap<string, Anchor>): void
  element(id: string): Element | null
  refresh(): void
  destroy(): void
}

type Entry = {
  anchor: Anchor
  element: Element | null
  range: Range | null
  trigger: Element | null
  clippers: Element[]
  staysOnScreen: boolean
  attempts: number
  retryAt: number
  looked: boolean
  readAt: number
  pin: { dot: Point; surroundings: Surroundings; width: number; height: number; backdrop: string } | null
}

const BACKOFF_MS = [250, 500, 1000, 2000, 4000, 8000]
const PENDING_ATTEMPTS = 3
const MUTATION_THROTTLE_MS = 150
const PASS_LOOKING_MS = 16
const PASS_READING_MS = 8
const PASS_REST_MS = 64
const POLL_MS = 1000
const PIN_MEASURE_THROTTLE_MS = 200

export function createAnchorTracker(target: Window, onChange: (placements: ReadonlyMap<string, Placement>) => void): AnchorTracker {
  const document = target.document
  const entries = new Map<string, Entry>()
  let placements: ReadonlyMap<string, Placement> = new Map()
  let frame = 0
  let mutationTimer: ReturnType<typeof setTimeout> | undefined
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let pinTimer: ReturnType<typeof setTimeout> | undefined
  let pinsStale = false
  let pinsMeasuredAt = -Infinity
  let passTookMs = 0

  const remeasurePins = () => {
    pinTimer ??= setTimeout(
      () => {
        pinTimer = undefined
        pinsStale = true
        scheduleMeasure()
      },
      Math.max(0, pinsMeasuredAt + PIN_MEASURE_THROTTLE_MS - Date.now()),
    )
  }
  const resizeObserver = typeof ResizeObserver === 'function'
    ? new ResizeObserver(() => {
        remeasurePins()
        scheduleMeasure()
      })
    : null
  const mutationObserver = new MutationObserver(() => {
    if (!mutationTimer) {
      mutationTimer = setTimeout(() => {
        mutationTimer = undefined
        revalidate(true)
      }, MUTATION_THROTTLE_MS)
    }
    remeasurePins()
    scheduleMeasure()
  })
  mutationObserver.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true })
  resizeObserver?.observe(document.documentElement)
  const listenerOptions = { capture: true, passive: true }
  target.addEventListener('scroll', scheduleMeasure, listenerOptions)
  target.addEventListener('resize', scheduleMeasure, listenerOptions)
  target.addEventListener('resize', remeasurePins, listenerOptions)
  document.fonts?.addEventListener?.('loadingdone', remeasurePins)
  const poll = setInterval(scheduleMeasure, POLL_MS)

  function scheduleMeasure() {
    if (frame) return
    frame = target.requestAnimationFrame(() => {
      frame = 0
      measure()
    })
  }

  function revalidate(changed: boolean) {
    const now = Date.now()
    const due: Entry[] = []
    for (const entry of entries.values()) {
      const lost = !entry.element || !entry.element.isConnected || !isRendered(entry.element)
      if (lost && (changed || now >= entry.retryAt)) due.push(entry)
      else if (changed) entry.staysOnScreen = staysOnScreen(entry.trigger ?? entry.element, target)
    }
    resolvePass(due)
    scheduleRetry()
    scheduleMeasure()
  }

  function resolvePass(due: Entry[]) {
    const now = () => target.performance.now()
    const started = now()
    const toRead: Entry[] = []
    for (const entry of due) {
      const quick = !entry.looked && now() - started < PASS_LOOKING_MS
      if (!quick || !resolve(entry, false)) toRead.push(entry)
    }
    const reading = now()
    for (const entry of toRead.sort((first, second) => first.readAt - second.readAt)) {
      if (now() - reading >= PASS_READING_MS) break
      resolve(entry, true)
    }
    passTookMs = now() - started
  }

  function resolve(entry: Entry, readText: boolean): boolean {
    const resolved = resolveAnchor(entry.anchor, document, readText)
    entry.looked = true
    const full = readText || !readsPageText(entry.anchor)
    if (!resolved && !full) return false
    if (full) entry.readAt = Date.now()
    const element = resolved?.element ?? null
    if (element !== entry.element) {
      if (entry.element) resizeObserver?.unobserve(entry.element)
      if (element) resizeObserver?.observe(element)
      entry.clippers = element ? clippingAncestors(element, target) : []
    }
    entry.pin = null
    entry.element = element
    entry.range = resolved?.range ?? null
    entry.trigger = element && !isRendered(element) ? resolveTrigger(entry.anchor, readText) : null
    entry.staysOnScreen = staysOnScreen(entry.trigger ?? element, target)
    if (element) {
      entry.attempts = 0
      entry.retryAt = Infinity
    } else {
      entry.retryAt = Date.now() + (BACKOFF_MS[entry.attempts] ?? BACKOFF_MS[BACKOFF_MS.length - 1]!)
      entry.attempts++
    }
    return true
  }

  function resolveTrigger(anchor: Anchor, readText: boolean): Element | null {
    const selectors = anchor.state?.opened_by
    if (!selectors?.length) return null
    const trigger = resolveAnchor({ selectors }, document, readText)?.element ?? null
    return trigger && isRendered(trigger) ? trigger : null
  }

  function scheduleRetry() {
    clearTimeout(retryTimer)
    const next = Math.min(...Array.from(entries.values(), (entry) => entry.retryAt))
    if (Number.isFinite(next)) retryTimer = setTimeout(() => revalidate(false), Math.max(PASS_REST_MS, passTookMs * 3, next - Date.now()))
  }

  function measure() {
    const stale = pinsStale
    pinsStale = false
    if (stale) pinsMeasuredAt = Date.now()
    let page: PageContent | null = null
    const content = () => (page ??= readPageContent(document))
    const origin = pageOrigin(target)
    const next = new Map<string, Placement>()
    for (const [id, entry] of entries) next.set(id, place(entry, stale, content, origin))
    if (!samePlacements(placements, next)) {
      placements = next
      onChange(next)
    }
  }

  function place(entry: Entry, stale: boolean, content: () => PageContent, origin: Point): Placement {
    const { anchor, element } = entry
    if (!element || !element.isConnected) {
      const status = entry.attempts <= PENDING_ATTEMPTS ? 'pending' : 'unplaced'
      return { status, box: null, point: null, surroundings: null, documentY: null, onTrigger: false, origin: null, backdrop: null }
    }
    const shown = entry.trigger ?? element
    if (!isRendered(shown)) return { status: 'hidden', box: null, point: null, surroundings: null, documentY: null, onTrigger: false, origin: null, backdrop: null }

    const box = entry.range && !entry.trigger ? rangeBox(entry.range) : toRect(shown.getBoundingClientRect())
    const resized = entry.pin && (Math.abs(entry.pin.width - box.width) > 1 || Math.abs(entry.pin.height - box.height) > 1)
    if (!entry.pin || stale || resized) {
      const offset = entry.trigger || entry.range ? { x: 0, y: 0 } : (anchor.offset ?? { x: 0, y: 0 })
      const wanted = offset.x === 0 && offset.y === 0 ? null : { x: box.left + offset.x * box.width, y: box.top + offset.y * box.height }
      const selected = entry.range && !entry.trigger ? Array.from(entry.range.getClientRects(), toRect) : null
      const measured = measurePin(shown, box, wanted, selected, content(), target)
      const backdrop = backdropOf(entry.range && !entry.trigger ? entry.range.commonAncestorContainer : shown, target)
      entry.pin = { dot: { x: measured.dot.x - box.left, y: measured.dot.y - box.top }, surroundings: measured.surroundings, width: box.width, height: box.height, backdrop }
    }
    const { surroundings, backdrop } = entry.pin
    const point = { x: box.left + entry.pin.dot.x, y: box.top + entry.pin.dot.y }
    const outermost = entry.clippers[entry.clippers.length - 1]
    const clipped = entry.clippers.find((clipper) => !contains(clipper.getBoundingClientRect(), point))
    const documentY = (clipped && outermost ? outermost.getBoundingClientRect().top : box.top) + target.scrollY
    if (clipped) return { status: 'hidden', box, point: null, surroundings: null, documentY, onTrigger: false, origin: null, backdrop: null }
    return { status: 'placed', box, point, surroundings, documentY, onTrigger: entry.trigger !== null, origin: entry.staysOnScreen ? null : origin, backdrop }
  }

  return {
    track(anchors) {
      for (const [id, entry] of entries) {
        if (anchors.get(id) === entry.anchor) continue
        if (entry.element) resizeObserver?.unobserve(entry.element)
        entries.delete(id)
      }
      const added: Entry[] = []
      for (const [id, anchor] of anchors) {
        if (entries.has(id)) continue
        const entry: Entry = { anchor, element: null, range: null, trigger: null, clippers: [], staysOnScreen: false, attempts: 0, retryAt: 0, looked: false, readAt: 0, pin: null }
        entries.set(id, entry)
        added.push(entry)
      }
      resolvePass(added)
      scheduleRetry()
      measure()
    },
    element(id) {
      const entry = entries.get(id)
      return entry?.trigger ?? entry?.element ?? null
    },
    refresh() {
      resolvePass(Array.from(entries.values()))
      scheduleRetry()
      measure()
    },
    destroy() {
      target.cancelAnimationFrame(frame)
      clearTimeout(mutationTimer)
      clearTimeout(retryTimer)
      clearTimeout(pinTimer)
      clearInterval(poll)
      mutationObserver.disconnect()
      resizeObserver?.disconnect()
      target.removeEventListener('scroll', scheduleMeasure, listenerOptions)
      target.removeEventListener('resize', scheduleMeasure, listenerOptions)
      target.removeEventListener('resize', remeasurePins, listenerOptions)
      document.fonts?.removeEventListener?.('loadingdone', remeasurePins)
    },
  }
}

export function rangeBox(range: Range): Rect {
  const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 || rect.height > 0)
  if (rects.length === 0) return toRect(range.getBoundingClientRect())
  const left = Math.min(...rects.map((rect) => rect.left))
  const top = Math.min(...rects.map((rect) => rect.top))
  const right = Math.max(...rects.map((rect) => rect.right))
  const bottom = Math.max(...rects.map((rect) => rect.bottom))
  return { left, top, width: right - left, height: bottom - top }
}

export function toRect(rect: DOMRect): Rect {
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
}

function pageOrigin(target: Window): Point {
  const root = target.document.documentElement
  if (target.getComputedStyle(root).position === 'static') return { x: -target.scrollX, y: -target.scrollY }
  const box = root.getBoundingClientRect()
  return { x: box.left + root.clientLeft, y: box.top + root.clientTop }
}

function staysOnScreen(node: Node | null, target: Window): boolean {
  const element = node?.nodeType === 1 ? (node as Element) : (node?.parentElement ?? null)
  for (let current = element; current; current = parentOf(current)) {
    const { position } = target.getComputedStyle(current)
    if (position === 'fixed' || position === 'sticky') return true
  }
  return false
}

export function originFor(node: Node, target: Window): Point | null {
  return staysOnScreen(node, target) ? null : pageOrigin(target)
}

function clippingAncestors(element: Element, target: Window): Element[] {
  const document = element.ownerDocument
  const clippers: Element[] = []
  for (let current = parentOf(element); current && current !== document.body && current !== document.documentElement; current = parentOf(current)) {
    const style = target.getComputedStyle(current)
    if (style.position === 'fixed') break
    if (style.overflowX !== 'visible' || style.overflowY !== 'visible') clippers.push(current)
  }
  return clippers
}

function contains(rect: DOMRect, point: Point): boolean {
  return point.x >= rect.left - 1 && point.x <= rect.right + 1 && point.y >= rect.top - 1 && point.y <= rect.bottom + 1
}

function samePlacements(previous: ReadonlyMap<string, Placement>, next: ReadonlyMap<string, Placement>): boolean {
  if (previous.size !== next.size) return false
  for (const [id, placement] of next) {
    const before = previous.get(id)
    if (!before || before.status !== placement.status || before.onTrigger !== placement.onTrigger || before.surroundings !== placement.surroundings || before.backdrop !== placement.backdrop) return false
    if (!near(before.point, placement.point) || !near(before.origin, placement.origin) || !sameBox(before.box, placement.box) || before.documentY !== placement.documentY) return false
  }
  return true
}

function near(first: Point | null, second: Point | null): boolean {
  if (!first || !second) return first === second
  return Math.abs(first.x - second.x) <= 0.5 && Math.abs(first.y - second.y) <= 0.5
}

function sameBox(first: Rect | null, second: Rect | null): boolean {
  if (!first || !second) return first === second
  return Math.abs(first.left - second.left) <= 0.5 && Math.abs(first.top - second.top) <= 0.5 && Math.abs(first.width - second.width) <= 0.5 && Math.abs(first.height - second.height) <= 0.5
}
