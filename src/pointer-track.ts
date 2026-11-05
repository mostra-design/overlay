import { anchorTarget, createAnchor, elementText, isMasked, isRendered, sectionName } from './anchor'
import type { Anchor } from './protocol'
import { captureRegion, type RegionNode } from './region'

export type TrackElement = {
  page_url: string
  page_title: string | null
  anchor: Anchor
  context: string | null
  region?: [region: number, node: number]
}

export type TrackRegion = { page_url: string; nodes: RegionNode[] }

export type TrackSpan = [at_ms: number, element: number | null, cause: 'm' | 's']
export type TrackPoint = [at_ms: number, x: number, y: number]
export type TrackScroll = [at_ms: number, scroll_y: number, heading: string | null]

export type PointerTrack = {
  elements: TrackElement[]
  regions: TrackRegion[]
  spans: TrackSpan[]
  path: TrackPoint[]
  scrolls: TrackScroll[]
}

export type TrackOptions = {
  isOwnEvent(event: Event): boolean
  isOwnElement(element: Element): boolean
  now(): number
  pageUrl(): string
  pageTitle(): string | null
}

export type PointerRecording = {
  leave(): void
  stop(): void
}

const NAMING_MS = 80
const PATH_EVERY_MS = 50
const SCROLL_SETTLE_MS = 150
const READING_LINE = 0.4
const HEADINGS = 'h1, h2, h3, [role="heading"]'
export const MAX_TRACK_ELEMENTS = 500
export const MAX_TRACK_REGIONS = 40
export const MAX_TRACK_SPANS = 12_000
export const MAX_TRACK_PATH = 24_000
export const MAX_TRACK_SCROLLS = 2_000

export function emptyTrack(): PointerTrack {
  return { elements: [], regions: [], spans: [], path: [], scrolls: [] }
}

export function recordPointer(target: Window, track: PointerTrack, options: TrackOptions): PointerRecording {
  const document = target.document
  const named = new WeakMap<Element, number>()
  const placed = new WeakMap<Element, [number, number]>()
  let current: Element | null = null
  let naming: ReturnType<typeof setTimeout> | undefined
  let settling: ReturnType<typeof setTimeout> | undefined
  let pointer: { x: number; y: number } | null = null
  let sampledAt = -Infinity

  function push(at: number, element: number | null, cause: TrackSpan[2]) {
    const open = track.spans.at(-1)
    if (open && open[1] === element) return
    if (open && open[0] === at) {
      open[1] = element
      open[2] = cause
    } else if (track.spans.length < MAX_TRACK_SPANS) {
      track.spans.push([at, element, cause])
    }
  }

  function over(found: Element | null, cause: TrackSpan[2]) {
    const element = found && worthNaming(found) ? anchorTarget(found) : null
    if (element === current) return
    current = element
    clearTimeout(naming)
    const at = options.now()
    const known = element ? named.get(element) : undefined
    if (!element || known !== undefined) return push(at, known ?? null, cause)
    push(at, null, cause)
    const point = pointer
    naming = setTimeout(() => {
      if (current !== element || !element.isConnected) return
      const index = name(element, point)
      if (index !== null) push(at, index, cause)
    }, NAMING_MS)
  }

  function worthNaming(element: Element): boolean {
    return element !== document.documentElement && element !== document.body && !options.isOwnElement(element)
  }

  function name(element: Element, point: { x: number; y: number } | null): number | null {
    if (track.elements.length >= MAX_TRACK_ELEMENTS) return null
    let anchor: Anchor
    try {
      anchor = createAnchor(element, point)
    } catch {
      return null
    }
    const region = placed.get(element) ?? regionOf(element)
    track.elements.push({ page_url: options.pageUrl(), page_title: options.pageTitle(), anchor, context: sectionName(element), ...(region ? { region } : {}) })
    named.set(element, track.elements.length - 1)
    return track.elements.length - 1
  }

  function regionOf(element: Element): [number, number] | null {
    if (track.regions.length >= MAX_TRACK_REGIONS) return null
    let region
    try {
      region = captureRegion(element, options.isOwnElement)
    } catch {
      return null
    }
    if (!region) return null
    track.regions.push({ page_url: options.pageUrl(), nodes: region.nodes })
    region.elements.forEach((captured, node) => placed.set(captured, [track.regions.length - 1, node]))
    return placed.get(element) ?? null
  }

  const onPointerMove = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse') return
    pointer = { x: event.clientX, y: event.clientY }
    const at = options.now()
    if (at - sampledAt >= PATH_EVERY_MS && track.path.length < MAX_TRACK_PATH) {
      sampledAt = at
      track.path.push([at, Math.round(event.clientX), Math.round(event.clientY)])
    }
    over(options.isOwnEvent(event) ? null : (event.composedPath()[0] as Element | undefined) ?? null, 'm')
  }

  const onLeave = () => {
    pointer = null
    over(null, 'm')
  }

  const onScroll = () => {
    if (settling === undefined) scrolled(null)
    clearTimeout(settling)
    settling = setTimeout(() => {
      settling = undefined
      scrolled(headingInView(target))
      if (pointer) over(document.elementFromPoint(pointer.x, pointer.y), 's')
    }, SCROLL_SETTLE_MS)
  }

  function scrolled(heading: string | null) {
    if (track.scrolls.length < MAX_TRACK_SCROLLS) track.scrolls.push([options.now(), Math.round(target.scrollY), heading])
  }

  const listening = { capture: true, passive: true }
  target.addEventListener('pointermove', onPointerMove, listening)
  target.addEventListener('scroll', onScroll, listening)
  document.documentElement.addEventListener('pointerleave', onLeave)

  return {
    leave: onLeave,
    stop() {
      clearTimeout(naming)
      clearTimeout(settling)
      target.removeEventListener('pointermove', onPointerMove, listening)
      target.removeEventListener('scroll', onScroll, listening)
      document.documentElement.removeEventListener('pointerleave', onLeave)
      onLeave()
    },
  }
}

function headingInView(target: Window): string | null {
  const line = target.innerHeight * READING_LINE
  let reading: Element | null = null
  let below: Element | null = null
  for (const heading of target.document.querySelectorAll(HEADINGS)) {
    if (isMasked(heading) || !isRendered(heading)) continue
    const top = heading.getBoundingClientRect().top
    if (top <= line) reading = heading
    else if (!below && top < target.innerHeight) below = heading
  }
  const heading = reading ?? below
  return heading ? elementText(heading) || null : null
}

export function parseTrack(text: string | null): PointerTrack | null {
  if (!text) return null
  try {
    const track = JSON.parse(text) as PointerTrack
    return Array.isArray(track.elements) && Array.isArray(track.regions) && Array.isArray(track.spans) && Array.isArray(track.path) && Array.isArray(track.scrolls) ? track : null
  } catch {
    return null
  }
}
