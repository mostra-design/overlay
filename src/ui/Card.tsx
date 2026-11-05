import type { ComponentChildren } from 'preact'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import type { Card as CardState } from '../controller'
import { pinState } from '../lifecycle'
import { CARD_WIDTH, followsTarget, intersects, leaderRoute, nearestFree, placeCard, screenArea, union, type Point, type Rect, type Side, type Size } from '../placement'
import type { Comment } from '../protocol'
import { readPageContent } from '../pin-measure'
import { backdropOf } from '../region'
import { originFor, rangeBox, toRect, type Placement } from '../tracker'
import { ClusterCard } from './ClusterCard'
import { Composer } from './Composer'
import { followPointer } from './drag'
import { DoneCard } from './Done'
import { useController, useFrame, useMostraState, prefersReducedMotion } from './hooks'
import { useLayout, useSheetLift, useSurface, useSurfaceChanges } from './layout'
import { Highlight, inLayer, labelStyle, labelWidth, layerClass, lonePin, onScreen, PinTip, sideClass } from './Marks'
import { CatchUpCard, ShortcutsCard, WelcomeCard } from './Notices'
import { inkStyle } from './theme'
import { Thread } from './Thread'

const SWIPE_DISTANCE = 60
const STUB_WIDTH = 320
const STUB_HEIGHT = 32
const CARD_MAX_SHARE = 0.7

export type Subject = { marks: Rect[]; backdrops: Array<string | null>; area: Rect; pin: Point | null; label: Rect | null; scrollTo: Element | Range | null; name: string; origin: Point | null; markIds?: string[] }

export function Card() {
  const card = useMostraState((state) => state.card)
  const subject = useSubject(card)
  const { phone } = useLayout()
  const [spotlight, setSpotlight] = useState<{ key: string; id: string } | null>(null)
  if (!card) return null
  const key = cardKey(card)
  const lit = spotlight?.key === key ? spotlight.id : null
  const body = <CardBody card={card} onSpotlight={(id) => setSpotlight(id ? { key, id } : null)} />
  return (
    <>
      {card.type === 'composer' && subject?.pin && <ComposingPin point={subject.pin} origin={subject.origin} />}
      {phone ? (
        <Sheet key={key} subject={subject} lit={lit}>
          {body}
        </Sheet>
      ) : (
        <Floating key={key} subject={subject} docked={isDocked(card)} lit={lit}>
          {body}
        </Floating>
      )}
    </>
  )
}

function ComposingPin({ point, origin }: { point: Point; origin: Point | null }) {
  const me = useMostraState((state) => state.me)
  const shape = lonePin(point, labelWidth('+'), origin)
  return (
    <div class={`${layerClass(origin)} pins`} aria-hidden="true">
      <span class={`pin composing${sideClass(shape.side)}`} style={{ ...inkStyle(me), ...labelStyle(shape) }}>
        <PinTip reach={shape.reach} />
        <span class="face">+</span>
      </span>
    </div>
  )
}

function CardBody({ card, onSpotlight }: { card: CardState; onSpotlight: (id: string | null) => void }) {
  switch (card.type) {
    case 'composer':
      return <Composer card={card} />
    case 'thread':
      return <Thread id={card.id} />
    case 'cluster':
      return <ClusterCard ids={card.ids} onSpotlight={onSpotlight} />
    case 'done':
      return <DoneCard checked={card.checked} />
    case 'welcome':
      return <WelcomeCard />
    case 'catch-up':
      return <CatchUpCard />
    case 'shortcuts':
      return <ShortcutsCard />
  }
}

function cardKey(card: CardState): string {
  switch (card.type) {
    case 'composer':
      return `composer:${card.draftKey}`
    case 'thread':
      return `thread:${card.id.replace(/^pending:/, '')}`
    case 'cluster':
      return `cluster:${card.ids.join()}`
    default:
      return card.type
  }
}

function isDocked(card: CardState): boolean {
  return card.type === 'done' || card.type === 'welcome' || card.type === 'catch-up' || card.type === 'shortcuts'
}

function useSubject(card: CardState | null): Subject | null {
  const { placements, threads, pinFaces } = useLayout()
  const me = useMostraState((state) => state.me)
  const comments = useMostraState((state) => state.comments)
  const pending = useMostraState((state) => state.pending)
  useFrame(card !== null)
  if (!card || !me) return null

  if (card.type === 'composer') {
    const { target } = card
    if (target.kind === 'element') {
      if (!target.element.isConnected) return null
      const box = toRect(target.element.getBoundingClientRect())
      const offset = target.anchor.offset ?? { x: 0, y: 0 }
      const pin = { x: box.left + offset.x * box.width, y: box.top + offset.y * box.height }
      const origin = originFor(target.element, window)
      const shape = lonePin(pin, labelWidth('+'), origin)
      return { marks: [box], backdrops: [backdropOf(target.element, window)], area: union([box, onScreen(shape.outline, origin)]), pin, label: onScreen(shape.face, origin), scrollTo: target.element, name: target.anchor.label ?? '', origin }
    }
    if (target.kind === 'selection') {
      const box = rangeBox(target.range)
      const pin = { x: box.left, y: box.top }
      const origin = originFor(target.range.commonAncestorContainer, window)
      const shape = lonePin(pin, labelWidth('+'), origin)
      return { marks: [box], backdrops: [backdropOf(target.range.commonAncestorContainer, window)], area: union([box, onScreen(shape.outline, origin)]), pin, label: onScreen(shape.face, origin), scrollTo: target.range, name: target.anchor.label ?? '', origin }
    }
    return null
  }

  const ids = card.type === 'thread' ? [card.id] : card.type === 'cluster' ? card.ids : []
  const placed = ids.flatMap((id) => {
    const placement = placements.get(id)
    const comment = comments.get(id) ?? Array.from(pending.values()).find((item) => item.comment.id === id)?.comment ?? threads.find((thread) => thread.id === id)
    if (!comment || !placement || placement.status !== 'placed' || !placement.point || !placement.box) return []
    return [{ comment, placement }]
  })
  if (placed.length === 0) return null
  const first = placed[0]!
  const marks = placed.map(({ placement }) => placement.box!)
  const drawn = (comment: Comment, placement: Placement) => {
    const known = pinFaces.current.get(comment.id)
    if (known) return known
    const shape = lonePin(placement.point!, labelWidth(comment.number === null ? '···' : String(comment.number), pinState(comment, me, false, false).done, comment.source === 'spoken' || comment.author.role === 'agent'), placement.origin, placement.surroundings)
    return { face: onScreen(shape.face, placement.origin), outline: onScreen(shape.outline, placement.origin), dot: placement.point! }
  }
  const shapes = placed.map(({ comment, placement }) => drawn(comment, placement))
  const pins = shapes.map((shape) => shape.outline)
  const markIds = placed.map(({ comment }) => comment.id)
  return { marks, backdrops: placed.map(({ placement }) => placement.backdrop), area: union([...marks, ...pins]), pin: shapes[0]!.dot, label: shapes[0]!.face, scrollTo: null, name: first.comment.anchor?.label ?? '', origin: first.placement.origin, markIds }
}

function useCardSurface() {
  const ref = useRef<HTMLElement | null>(null)
  const surface = useSurface('card')
  const cardRef = useCallback(
    (element: HTMLElement | null) => {
      ref.current = element
      surface(element)
    },
    [surface],
  )
  return [ref, cardRef] as const
}

function fullSize(card: HTMLElement): Size {
  const body = card.querySelector('.card-body')
  return { width: card.offsetWidth, height: card.offsetHeight + (body ? body.scrollHeight - body.clientHeight : 0) }
}

function Floating({ subject, docked, lit, children }: { subject: Subject | null; docked: boolean; lit: string | null; children: ComponentChildren }) {
  const controller = useController()
  const { toolbar, surfaces } = useLayout()
  const [ref, cardRef] = useCardSurface()
  const [size, setSize] = useState({ width: CARD_WIDTH, height: 240 })
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null)
  const placedAt = useRef({ left: 0, top: 0 })
  const side = useRef<Side | null>(null)
  const [pageText] = useState(() => (docked ? [] : readPageContent(document).text.map((rect) => ({ ...rect, left: rect.left + window.scrollX, top: rect.top + window.scrollY }))))
  useFocusOnOpen(ref)
  useSurfaceChanges()

  const viewport = { width: window.innerWidth, height: window.innerHeight }
  const toolbarRect = toolbar.current ? toRect(toolbar.current.getBoundingClientRect()) : { left: 16, top: viewport.height - 56, width: 320, height: 40 }
  const obstacles = surfaces.boxes('pages', 'menu', 'ticks')
  const cardSize = { width: size.width, height: Math.min(size.height, viewport.height * CARD_MAX_SHARE) }
  const text = pageText.flatMap((rect) => {
    const onScreen = { ...rect, left: rect.left - window.scrollX, top: rect.top - window.scrollY }
    return intersects(onScreen, { left: 0, top: 0, ...viewport }) ? [onScreen] : []
  })
  const placement = placeCard({ target: !docked && subject ? subject.area : null, pin: subject?.pin ?? null, card: cardSize, viewport, toolbar: toolbarRect, obstacles, text, prefer: side.current })
  if (placement.kind === 'card' && placement.side !== 'dock' && placement.side !== 'toolbar') side.current = placement.side

  useLayoutEffect(() => {
    const element = ref.current
    if (!element || placement.kind === 'stub') return
    const measure = () => {
      const { width, height } = fullSize(element)
      setSize((current) => (Math.abs(width - current.width) > 1 || Math.abs(height - current.height) > 1 ? { width, height } : current))
    }
    measure()
    const resizes = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null
    resizes?.observe(element)
    const edits = typeof MutationObserver === 'function' ? new MutationObserver(measure) : null
    edits?.observe(element, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['style', 'open'] })
    return () => {
      resizes?.disconnect()
      edits?.disconnect()
    }
  }, [placement.kind])

  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect()
    if (!box || (box.left === placedAt.current.left && box.top === placedAt.current.top)) return
    placedAt.current = { left: box.left, top: box.top }
    surfaces.changed()
  })

  if (placement.kind === 'stub') {
    const scroll = () => {
      const element = subject?.scrollTo ?? null
      const into = element && 'scrollIntoView' in element ? element : null
      if (into) into.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
      else if (subject) window.scrollBy({ top: subject.area.top - window.innerHeight / 3, behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
    }
    const edgeTop = placement.edge === 'above' ? 12 : viewport.height - 12 - STUB_HEIGHT
    const stub = { left: Math.min(placement.left, viewport.width - STUB_WIDTH - 12), top: edgeTop, width: STUB_WIDTH, height: STUB_HEIGHT }
    const spot = nearestFree(stub, screenArea(viewport), [toolbarRect, ...obstacles]) ?? stub
    return (
      <div ref={cardRef} class="layer stub" style={{ left: `${Math.round(spot.left)}px`, top: `${Math.round(spot.top)}px` }} role="status">
        <span class="stub-label">
          {subject?.name ? <span class="stub-what">{subject.name}</span> : null}
          <span class="mono">{placement.edge}</span>
        </span>
        <button type="button" class="text-button" onClick={scroll}>
          Show
        </button>
        <button type="button" class="text-button quiet" onClick={() => controller.closeCard()}>
          Close
        </button>
      </div>
    )
  }

  const height = placement.maxHeight ?? cardSize.height
  const placed = { left: placement.left + (drag?.x ?? 0), top: placement.top + (drag?.y ?? 0), width: size.width, height }
  const spot = drag ? (nearestFree(placed, screenArea(viewport), [toolbarRect, ...obstacles]) ?? placed) : placed
  const left = Math.round(spot.left)
  const top = Math.round(spot.top)
  const cardRect = { left, top, width: size.width, height }
  const leader = !docked && subject?.label && !drag ? leaderRoute(cardRect, subject.label, subject.marks, text) : []
  const origin = subject && !docked && !drag && followsTarget(placement, subject.area, cardSize) ? subject.origin : null
  const corner = inLayer({ x: left, y: top }, origin)
  const leaderPoints = leader.map((point) => `${Math.round(point.x) + 0.5},${Math.round(point.y) + 0.5}`).join(' ')

  const startDrag = (event: PointerEvent) => {
    const head = (event.target as Element).closest('.card-head')
    if (!head || (event.target as Element).closest('button, input, textarea, select, a, summary')) return
    event.preventDefault()
    const startX = event.clientX - (drag?.x ?? 0)
    const startY = event.clientY - (drag?.y ?? 0)
    followPointer(
      event.currentTarget as Element,
      event,
      (point) => setDrag({ x: point.x - startX, y: point.y - startY }),
      () => {},
    )
  }

  return (
    <>
      {!docked && subject && <Highlights subject={subject} lit={lit} />}
      {}
      <div class={`${layerClass(origin)} card-layer`}>
        {leader.length > 1 && (
          <svg class="leader" aria-hidden="true" width={viewport.width} height={viewport.height} style={origin ? { transform: `translate(${Math.round(-origin.x)}px, ${Math.round(-origin.y)}px)` } : undefined}>
            <polyline class="leader-halo" points={leaderPoints} />
            <polyline class="leader-line" points={leaderPoints} />
          </svg>
        )}
        <section
          ref={cardRef}
          class={`card${docked ? ' docked' : ''}${placement.overlaps ? ' overlapping' : ''}`}
          data-side={placement.side}
          role="dialog"
          aria-modal="false"
          aria-labelledby="mostra-card-title"
          tabIndex={-1}
          style={{ transform: `translate(${Math.round(corner.x)}px, ${Math.round(corner.y)}px)`, ...(placement.maxHeight ? { maxHeight: `${Math.round(placement.maxHeight)}px` } : {}) }}
          onPointerDown={startDrag}
        >
          {children}
        </section>
      </div>
    </>
  )
}

function Sheet({ subject, lit, children }: { subject: Subject | null; lit: string | null; children: ComponentChildren }) {
  const controller = useController()
  const [ref, cardRef] = useCardSurface()
  const [full, setFull] = useState(false)
  const [keyboard, setKeyboard] = useState(0)
  const lift = useSheetLift()
  const raised = Math.max(keyboard, lift)
  const handleDragged = useRef(false)
  useFocusOnOpen(ref)

  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return
    const update = () => setKeyboard(Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop))
    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)
    update()
    return () => {
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
    }
  }, [])

  useEffect(() => {
    const sheet = ref.current
    if (!sheet || !subject) return
    const box = subject.area
    const visible = window.innerHeight - sheet.offsetHeight - raised
    if (box.top >= 12 && box.top + box.height <= visible - 12) return
    window.scrollBy({ top: box.top - Math.max(12, (visible - box.height) / 2), behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
  }, [])

  const swipeHeader = (event: PointerEvent) => {
    if (!controller.store.get().stepper || !(event.target as Element).closest('.card-head')) return
    const startX = event.clientX
    const stop = () => {
      window.removeEventListener('pointerup', end, true)
      window.removeEventListener('pointercancel', stop, true)
    }
    const end = (endEvent: PointerEvent) => {
      stop()
      const distance = endEvent.clientX - startX
      if (Math.abs(distance) > SWIPE_DISTANCE) void controller.step(distance < 0 ? 1 : -1)
    }
    window.addEventListener('pointerup', end, true)
    window.addEventListener('pointercancel', stop, true)
  }

  const startDrag = (event: PointerEvent) => {
    const startY = event.clientY
    const startFull = full
    handleDragged.current = false
    followPointer(
      event.currentTarget as Element,
      event,
      (point) => {
        const delta = point.y - startY
        if ((delta < -40 && !startFull) || (delta > 40 && startFull)) {
          handleDragged.current = true
          setFull(!startFull)
        }
      },
      () => {},
    )
  }

  return (
    <>
      {subject && <Highlights subject={subject} lit={lit} />}
      <section
        ref={cardRef}
        class={`layer sheet${full ? ' full' : ''}`}
        role="dialog"
        aria-modal="false"
        aria-labelledby="mostra-card-title"
        tabIndex={-1}
        style={{ bottom: `${raised}px`, '--sheet-lift': `${lift}px` }}
        onPointerDown={swipeHeader}
      >
        <button type="button" class="handle" aria-label={full ? 'Shrink' : 'Expand'} onPointerDown={startDrag} onClick={() => (handleDragged.current ? (handleDragged.current = false) : setFull(!full))}>
          <span />
        </button>
        {children}
      </section>
    </>
  )
}

function Highlights({ subject, lit }: { subject: Subject; lit: string | null }) {
  return (
    <>
      {subject.marks.map((box, index) => (!lit || subject.markIds?.[index] === lit ? <Highlight key={index} box={box} origin={subject.origin} backdrop={subject.backdrops[index]} /> : null))}
    </>
  )
}

function useFocusOnOpen(ref: { current: HTMLElement | null }) {
  useEffect(() => {
    const card = ref.current
    if (!card) return
    const root = card.getRootNode() as ShadowRoot
    const pin = root.activeElement?.closest?.('.pin') as HTMLElement | null
    const previous = document.activeElement
    if (!card.querySelector('[data-autofocus]')) card.focus({ preventScroll: true })
    return () => {
      if (!card.contains(root.activeElement)) return
      if (pin?.isConnected) pin.focus({ preventScroll: true })
      else if (previous instanceof HTMLElement && previous.isConnected && previous.localName !== 'mostra-overlay') previous.focus({ preventScroll: true })
    }
  }, [])
}
