import type { ComponentChild } from 'preact'
import { useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import { plainBody, repliesTo } from '../comments'
import { displayName, isUnread, isUnresolved, pinName, pinState, type PinState } from '../lifecycle'
import { CLUSTER_DISTANCE, clusterPins, faceBox, wordsBox, intersects, LABEL_HEIGHT, nearestFree, pinBoundsIn, pinOutline, placeFaces, screenArea, tickTop, tipReach, type LabelPlace, type PeekPlace, type PeekWish, type PinBounds, type PinBox, type PinRequest, type PinSide, type Point, type Rect, type Surroundings } from '../placement'
import { readPageContent } from '../pin-measure'
import type { Comment } from '../protocol'
import type { Placement } from '../tracker'
import { prefersReducedMotion, useController, useMostraState, useViewportSize, viewportSize } from './hooks'
import { AgentIcon, CheckIcon, MicIcon } from './icons'
import { useLayout, useSurface, useSurfaceChanges } from './layout'
import { inkStyle } from './theme'

const PEEK_WORDS = 120
const PEEK_CHARACTER = 7
const PEEK_PADDING = 18
const PEEK_FEW_WORDS = 16
const PEEK_FONT_SIZE = 12
const GLIDE_MS = 180
const MAX_PAGE_PINS = 3

export function labelWidth(text: string, done = false, spoken = false): number {
  return Math.max(LABEL_HEIGHT, 12 + text.length * 7 + (done ? 14 : 0) + (spoken ? 15 : 0))
}

export type PinShape = { side: PinSide; face: Rect; outline: Rect; reach: Point }

function shapeOf(dot: Point, width: number, { side, reach }: LabelPlace, bounds: PinBounds): PinShape {
  const face = faceBox(dot, width, side, bounds, reach)
  return { side, face, outline: pinOutline(dot, width, side, bounds, reach), reach: tipReach(dot, face, side) }
}

export function onScreen(rect: Rect, origin: Point | null): Rect {
  return origin ? { ...rect, left: rect.left + origin.x, top: rect.top + origin.y } : rect
}

export function lonePin(point: Point, width: number, origin: Point | null, surroundings: Surroundings | null = null): PinShape {
  const dot = inLayer(point, origin)
  const bounds = pinBoundsIn(viewportSize().width, origin)
  return shapeOf(dot, width, placeFaces([{ id: 'lone', dot, width, surroundings }], bounds).get('lone')!, bounds)
}

export function sideClass(side: PinSide): string {
  return `${side.endsWith('left') ? ' flipped' : ''}${side.startsWith('down') ? ' below' : ''}`
}

export function layerClass(origin: Point | null): string {
  return origin ? 'page' : 'layer'
}

export function inLayer(point: Point, origin: Point | null): Point {
  return origin ? { x: point.x - origin.x, y: point.y - origin.y } : point
}

function inLayerBox(rect: Rect, origin: Point | null): Rect {
  return origin ? { ...rect, left: rect.left - origin.x, top: rect.top - origin.y } : rect
}

export function labelStyle({ side, face, reach }: PinShape): Record<string, string> {
  const left = side.endsWith('left') ? `calc(${Math.round(face.left + face.width)}px - 100%)` : `${Math.round(face.left)}px`
  return { transform: `translate(${left}, ${Math.round(face.top)}px)`, '--tip-x': `${Math.round(reach.x) + 3}px`, '--tip-y': `${Math.round(reach.y) + 3}px` }
}

export function PinTip({ reach = { x: 8, y: 8 } }: { reach?: Point }) {
  const across = Math.round(reach.x)
  const down = Math.round(reach.y)
  const line = `M3 ${down + 3} ${across + 3} 3`
  return (
    <svg class="tip" width={across + 6} height={down + 6} viewBox={`0 0 ${across + 6} ${down + 6}`} aria-hidden="true">
      <path class="tip-halo" d={line} />
      <path class="tip-line" d={line} pathLength={12} />
      <circle class="tip-dot" cx="3" cy={down + 3} r="3" />
    </svg>
  )
}

const LEADING = 0.15

function pageObstacles(): Rect[] {
  const { text, controls } = readPageContent(document)
  return [...text.map((rect) => ({ ...rect, top: rect.top + rect.height * LEADING, height: rect.height * (1 - 2 * LEADING) })), ...controls]
}

const surroundingsNumbers = new WeakMap<object, number>()
let lastSurroundingsNumber = 0
function surroundingsNumber(surroundings: Surroundings | null): number {
  if (!surroundings) return 0
  let number = surroundingsNumbers.get(surroundings)
  if (number === undefined) surroundingsNumbers.set(surroundings, (number = ++lastSurroundingsNumber))
  return number
}

type DrawnPin = { comment: Comment; placement: Placement; state: PinState; box: Rect; face: Rect; width: number; shape: PinShape; bounds: PinBounds; peek: PeekPlace | null }

export function Marks() {
  const controller = useController()
  const { placements, threads, phone, surfaces, pinFaces, toolbar } = useLayout()
  const me = useMostraState((state) => state.me)
  const comments = useMostraState((state) => state.comments)
  const read = useMostraState((state) => state.read)
  const lastSeenAt = useMostraState((state) => state.lastSeenAt)
  const arrived = useMostraState((state) => state.arrived)
  const card = useMostraState((state) => state.card)
  const arrivals = useMostraState((state) => state.arrivals)
  const [hovered, setHovered] = useState<string[] | null>(null)
  const viewport = useViewportSize()
  const previousPlaces = useRef<ReadonlyMap<string, LabelPlace>>(new Map())
  const previousFaces = useRef<ReadonlyMap<string, { face: Rect; riding: boolean }>>(new Map())
  const layers = useRef<HTMLDivElement[]>([])

  const placed = useMemo(() => {
    if (!me) return []
    const placed: Array<Pick<DrawnPin, 'comment' | 'placement' | 'state' | 'width'>> = []
    for (const comment of threads) {
      const placement = placements.get(comment.id)
      if (!placement || placement.status !== 'placed' || !placement.point) continue
      if (placement.point.x < 0 || placement.point.x > viewportSize().width) continue
      const sending = comment.number === null
      const unread = !read.has(comment.id) && repliesTo(comments, comment.id).some((reply) => isUnread(reply, me, lastSeenAt, arrived))
      const state = pinState(comment, me, sending, unread)
      if (!state.visible) continue
      const width = labelWidth(sending ? '···' : String(comment.number), state.done || state.unread, comment.source === 'spoken' || comment.author.role === 'agent')
      placed.push({ comment, placement, state, width })
    }
    return placed
  }, [threads, placements, me, comments, read, lastSeenAt, arrived])

  const openIds = card?.type === 'thread' ? [card.id] : card?.type === 'cluster' ? card.ids : []
  const peeking = placed.flatMap((pin) => (arrivals.has(pin.comment.id) && !openIds.includes(pin.comment.id) ? [pin.comment.id] : []))

  const layered = placed.map((pin) => ({ pin, dot: inLayer(pin.placement.point!, pin.placement.origin) }))
  const across = placed.find((pin) => pin.placement.origin)?.placement.origin?.x ?? 0
  const shapesKey = `${viewport.width}|${Math.round(across)}|${peeking.join()}|${layered.map(({ pin, dot }) => `${pin.comment.id},${Math.round(dot.x)},${Math.round(dot.y)},${pin.width},${pin.placement.origin ? 'page' : 'screen'},${surroundingsNumber(pin.placement.surroundings)}`).join(';')}`
  const shapes = useMemo(() => {
    const result = new Map<string, { shape: PinShape; bounds: PinBounds; peek: PeekPlace | null }>()
    const places = new Map<string, LabelPlace>()
    const faces = new Map<string, { face: Rect; riding: boolean }>()
    const moves = new Map<string, Point>()
    const inTheWay = peeking.length ? [...pageObstacles(), ...surfaces.boxes('toolbar', 'pages', 'menu', 'ticks', 'card', 'list', 'toasts')] : []
    for (const riding of [true, false]) {
      const group = layered.filter(({ pin }) => Boolean(pin.placement.origin) === riding)
      if (group.length === 0) continue
      const origin = riding ? group[0]!.pin.placement.origin : null
      const bounds = pinBoundsIn(viewport.width, origin)
      const family = toolbar.current ? getComputedStyle(toolbar.current).fontFamily : null
      const requests = group.map(({ pin, dot }): PinRequest => ({ id: pin.comment.id, dot, width: pin.width, surroundings: pin.placement.surroundings, peek: peeking.includes(pin.comment.id) ? peekWish(pin.comment, family) : null }))
      const groupPlaces = placeFaces(requests, bounds, { previous: previousPlaces.current, peekObstacles: inTheWay.map((rect) => inLayerBox(rect, origin)) })
      for (const { pin, dot } of group) {
        const id = pin.comment.id
        const place = groupPlaces.get(id)!
        const shape = shapeOf(dot, pin.width, place, bounds)
        places.set(id, place)
        faces.set(id, { face: shape.face, riding })
        result.set(id, { shape, bounds, peek: place.peek ?? null })
        const before = previousPlaces.current.get(id)
        const stood = previousFaces.current.get(id)
        if (before && stood?.riding === riding && (before.side !== place.side || before.reach.x !== place.reach.x || before.reach.y !== place.reach.y)) moves.set(id, { x: stood.face.left - shape.face.left, y: stood.face.top - shape.face.top })
      }
    }
    previousPlaces.current = places
    previousFaces.current = faces
    return { result, moves }
  }, [shapesKey])

  useLayoutEffect(() => {
    if (shapes.moves.size === 0 || prefersReducedMotion()) return
    for (const layer of layers.current) {
      for (const pin of Array.from(layer.querySelectorAll<HTMLElement>('[data-mostra-pin]'))) {
        const offset = shapes.moves.get(pin.dataset.mostraPin ?? '')
        if (!offset) continue
        const easing = getComputedStyle(pin).getPropertyValue('--easing').trim() || 'ease-out'
        for (const part of Array.from(pin.querySelectorAll<HTMLElement>('.face, .peek-bubble'))) part.animate?.([{ transform: `translate(${offset.x}px, ${offset.y}px)` }, { transform: 'none' }], { duration: GLIDE_MS, easing })
      }
    }
  }, [shapes])
  const pins = placed.map((pin): DrawnPin => {
    const { shape, bounds, peek } = shapes.result.get(pin.comment.id)!
    return { ...pin, shape, bounds, peek, face: onScreen(shape.face, pin.placement.origin), box: onScreen(shape.outline, pin.placement.origin) }
  })
  const showing = (pin: DrawnPin) => pin.peek !== null && peeking.includes(pin.comment.id)
  const clusters = [...clusterPins(pins.filter((pin) => !showing(pin)).map((pin): PinBox => ({ id: pin.comment.id, ...pin.box })), CLUSTER_DISTANCE), ...pins.filter(showing).map((pin) => ({ ids: [pin.comment.id], box: pin.box }))]
  const openWords = pins.filter(showing).map((pin) => wordsBox(pin.face, pin.peek!))
  const tucked = (pin: DrawnPin) => !showing(pin) && openWords.some((box) => intersects(box, pin.face))
  const byId = new Map(pins.map((pin) => [pin.comment.id, pin]))
  const drawnFaces = new Map(pins.map((pin) => [pin.comment.id, { face: pin.face, outline: pin.box, dot: pin.placement.point! }]))
  pinFaces.current = drawnFaces
  const highlighted = (hovered ?? []).filter((id) => !openIds.includes(id))
  const highlightPlacements = highlighted.flatMap((id) => {
    const placement = byId.get(id)?.placement
    return placement?.box ? [placement] : []
  })
  useSurfaceChanges()
  const arriving = clusters.flatMap((cluster) => (cluster.ids.length === 1 && peeking.includes(cluster.ids[0]!) ? cluster.ids : []))
  const covering = surfaces.boxes('toolbar', 'pages', 'menu', 'ticks', 'card', 'list', 'toasts')
  const covered = (pin: DrawnPin) => covering.some((box) => intersects(box, pin.face) || (pin.peek !== null && intersects(box, wordsBox(pin.face, pin.peek))))
  const peekOf = (pin: DrawnPin) => (arriving.includes(pin.comment.id) && !covered(pin) ? pin.peek : null)

  return (
    <>
      {highlightPlacements.map((placement, index) => (
        <Highlight key={index} box={placement.box!} origin={placement.origin} backdrop={placement.backdrop} />
      ))}
      {arriving.flatMap((id) => {
        const placement = byId.get(id)?.placement
        return placement?.box ? [<Highlight key={`arrival:${id}`} box={placement.box} origin={placement.origin} backdrop={placement.backdrop} arrival />] : []
      })}
      <PinLayers
        layers={layers}
        label="Comments on this page"
        pins={clusters.map((cluster) => {
          const members = cluster.ids.map((id) => byId.get(id)!).filter(Boolean)
          const hover = {
            onPointerEnter: () => setHovered(cluster.ids),
            onPointerLeave: () => setHovered(null),
            onFocus: () => setHovered(cluster.ids),
            onBlur: () => setHovered(null),
          }
          if (members.length === 1) {
            const pin = members[0]!
            const open = openIds.includes(pin.comment.id)
            const peek = peekOf(pin)
            const { origin } = pin.placement
            return {
              origin,
              element: (
                <button
                  key={pin.comment.id}
                  type="button"
                  class={`${pinClass(pin.state, open)}${sideClass(pin.shape.side)}${peek ? ` peeking${peek.left ? ' peek-left' : ''}` : ''}${tucked(pin) ? ' tucked' : ''}`}
                  style={{ ...inkStyle(pin.comment.author), ...labelStyle(pin.shape) }}
                  aria-label={pinName(pin.comment, pin.state)}
                  aria-expanded={open}
                  data-mostra-pin={pin.comment.id}
                  onClick={() => (open ? controller.closeCard() : controller.openThread(pin.comment.id))}
                  {...hover}
                >
                  <PinTip reach={pin.shape.reach} />
                  {
}
                  <PinFace key={peek ? 'peeking' : 'still'} comment={pin.comment} state={pin.state} />
                  {peek && <Peek comment={pin.comment} room={peek.room} />}
                </button>
              ),
            }
          }
          const open = openIds.length > 1 && cluster.ids.every((id) => openIds.includes(id))
          const countWidth = labelWidth(String(members.length))
          const first = members.reduce((top, pin) => (pin.placement.point!.y < top.placement.point!.y || (pin.placement.point!.y === top.placement.point!.y && pin.placement.point!.x < top.placement.point!.x) ? pin : top))
          const { origin } = first.placement
          const shape = shapeOf(inLayer(first.placement.point!, origin), countWidth, { side: first.shape.side, reach: first.shape.reach }, first.bounds)
          for (const id of cluster.ids) drawnFaces.set(id, { face: onScreen(shape.face, origin), outline: onScreen(shape.outline, origin), dot: first.placement.point! })
          return {
            origin,
            element: (
              <button
                key={cluster.ids.join()}
                type="button"
                class={`pin cluster${open ? ' open' : ''}${members.some((pin) => pin.state.unread) ? ' unread' : ''}${sideClass(shape.side)}`}
                style={labelStyle(shape)}
                aria-label={`${members.length} comments here: ${members.map((pin) => `#${pin.comment.number ?? 'sending'}`).join(', ')}`}
                aria-expanded={open}
                data-mostra-pin={cluster.ids.join(' ')}
                onClick={() => (open ? controller.closeCard() : controller.openCluster(cluster.ids))}
                {...hover}
              >
                <PinTip reach={shape.reach} />
                <span class="face">{members.length}</span>
              </button>
            ),
          }
        })}
      />
      <EdgeTicks openIds={openIds} passive={phone} />
    </>
  )
}

export function PagePins() {
  const controller = useController()
  const { threads } = useLayout()
  const me = useMostraState((state) => state.me)
  const comments = useMostraState((state) => state.comments)
  const read = useMostraState((state) => state.read)
  const lastSeenAt = useMostraState((state) => state.lastSeenAt)
  const arrived = useMostraState((state) => state.arrived)
  const card = useMostraState((state) => state.card)
  const pagesSurface = useSurface('pages')

  const pins = useMemo(() => {
    if (!me) return []
    return threads.flatMap((comment) => {
      if (comment.anchor) return []
      const unread = !read.has(comment.id) && repliesTo(comments, comment.id).some((reply) => isUnread(reply, me, lastSeenAt, arrived))
      const state = pinState(comment, me, comment.number === null, unread)
      return state.visible ? [{ comment, state }] : []
    })
  }, [threads, me, comments, read, lastSeenAt])

  if (pins.length === 0) return null
  const openIds = card?.type === 'thread' ? [card.id] : card?.type === 'cluster' ? card.ids : []

  return (
    <div ref={pagesSurface} class="page-pins" role="group" aria-label="Comments on the whole page">
      {pins.length > MAX_PAGE_PINS ? (
        <button
          type="button"
          class={`pin cluster${pins.every(({ comment }) => openIds.includes(comment.id)) ? ' open' : ''}${pins.some(({ state }) => state.unread) ? ' unread' : ''}`}
          aria-label={`${pins.length} comments on the whole page: ${pins.map(({ comment }) => `#${comment.number ?? 'sending'}`).join(', ')}`}
          onClick={() => controller.openCluster(pins.map(({ comment }) => comment.id))}
        >
          <span class="face">{pins.length}</span>
        </button>
      ) : (
        pins.map(({ comment, state }) => {
          const open = openIds.includes(comment.id)
          return (
            <button
              key={comment.id}
              type="button"
              class={pinClass(state, open)}
              style={inkStyle(comment.author)}
              aria-label={pinName(comment, state)}
              aria-expanded={open}
              onClick={() => (open ? controller.closeCard() : controller.openThread(comment.id))}
            >
              <PinFace comment={comment} state={state} />
            </button>
          )
        })
      )}
    </div>
  )
}

function PinLayers({ label, pins, layers }: { label: string; pins: Array<{ origin: Point | null; element: ComponentChild }>; layers: { current: HTMLDivElement[] } }) {
  const fixed = pins.filter((pin) => !pin.origin)
  layers.current = []
  const keep = (layer: HTMLDivElement | null) => {
    if (layer) layers.current.push(layer)
  }
  return (
    <>
      <div ref={keep} class="page pins" role="group" aria-label={label}>
        {pins.filter((pin) => pin.origin).map((pin) => pin.element)}
      </div>
      {fixed.length > 0 && (
        <div ref={keep} class="layer pins" role="group" aria-label={label}>
          {fixed.map((pin) => pin.element)}
        </div>
      )}
    </>
  )
}

function pinClass(state: PinState, open: boolean): string {
  return ['pin', state.sending && 'sending', state.done && 'done', state.checkIt && 'check-it', state.unread && 'unread', open && 'open'].filter(Boolean).join(' ')
}

function PinFace({ comment, state }: { comment: Comment; state: PinState }) {
  if (state.sending) {
    return (
      <span class="face" aria-hidden="true">
        <span class="sending-dots" />
      </span>
    )
  }
  return (
    <span class="face" aria-hidden="true">
      {comment.source === 'spoken' && <MicIcon size={12} />}
      {comment.author.role === 'agent' && <AgentIcon size={12} />}
      {comment.number}
      {state.done && <CheckIcon size={12} />}
    </span>
  )
}

function peekWish(comment: Comment, family: string | null): PeekWish {
  const name = displayName(comment.author)
  const width = (text: string, weight: number) => (family ? textWidth(text, weight, family) : null) ?? text.length * PEEK_CHARACTER
  const named = PEEK_PADDING + width(name, 600)
  const body = plainBody(comment)
  return { wanted: Math.ceil(named + width(excerpt(body, PEEK_WORDS), 400)), minimum: Math.ceil(named + width(body.slice(0, PEEK_FEW_WORDS), 400)) }
}

let measuring: CanvasRenderingContext2D | null | undefined
function textWidth(text: string, weight: number, family: string): number | null {
  if (measuring === undefined) {
    try {
      measuring = document.createElement('canvas').getContext('2d')
    } catch {
      measuring = null
    }
  }
  if (!measuring) return null
  measuring.font = `${weight} ${PEEK_FONT_SIZE}px ${family}`
  return measuring.measureText(text).width
}

function Peek({ comment, room }: { comment: Comment; room: number }) {
  return (
    <span class="peek-bubble" aria-hidden="true" style={{ '--peek-room': `${room}px` }}>
      <span class="peek-who">{displayName(comment.author)}</span>
      <span class="peek-quote">{excerpt(plainBody(comment), PEEK_WORDS)}</span>
    </span>
  )
}

export function Highlight({ box, origin = null, label, arrival = false, backdrop = null }: { box: Rect; origin?: Point | null; label?: string | null; arrival?: boolean; backdrop?: string | null }) {
  const pad = 2
  const corner = inLayer({ x: box.left - pad, y: box.top - pad }, origin)
  return (
    <>
      <div class={`${layerClass(origin)} mark`} aria-hidden="true">
        <div
          class={`highlight${arrival ? ' arrival' : ''}${backdrop === 'yellow' ? ' inked' : ''}`}
          style={{ transform: `translate(${Math.round(corner.x)}px, ${Math.round(corner.y)}px)`, width: `${Math.round(box.width + pad * 2)}px`, height: `${Math.round(box.height + pad * 2)}px` }}
        />
      </div>
      {label && <AimLabel box={box} label={label} />}
    </>
  )
}

const AIM_LABEL_WIDTH = 240
const AIM_LABEL_HEIGHT = 20

function AimLabel({ box, label }: { box: Rect; label: string }) {
  const { surfaces } = useLayout()
  const pad = 2
  const above = box.top - pad > 24
  const wanted = { left: box.left - pad, top: above ? box.top - pad - AIM_LABEL_HEIGHT : box.top + box.height + pad, width: AIM_LABEL_WIDTH, height: AIM_LABEL_HEIGHT }
  const spot = nearestFree(wanted, screenArea(viewportSize(), 0), surfaces.boxes('toolbar', 'pages', 'card'), { gap: 4 }) ?? wanted
  return (
    <div class="layer aim-label" aria-hidden="true" style={{ transform: `translate(${Math.round(spot.left)}px, ${Math.round(spot.top)}px)`, ...(above ? {} : { borderRadius: '0 0 var(--radius-small) var(--radius-small)' }) }}>
      {label}
    </div>
  )
}

function EdgeTicks({ openIds, passive = false }: { openIds: string[]; passive?: boolean }) {
  const controller = useController()
  const { placements, threads, surfaces } = useLayout()
  const ticksSurface = useSurface('ticks')
  const [tip, setTip] = useState<{ id: string; top: number } | null>(null)
  const documentHeight = document.documentElement.scrollHeight
  const viewportHeight = window.innerHeight
  if (documentHeight <= viewportHeight + 1) return null

  const ticks = threads.flatMap((comment) => {
    const placement = placements.get(comment.id)
    if (!isUnresolved(comment) || comment.number === null || !placement || placement.documentY === null) return []
    return [{ comment, top: tickTop(placement.documentY, documentHeight, viewportHeight) }]
  })
  const tipped = tip ? ticks.find((tick) => tick.comment.id === tip.id) : null

  return (
    <div ref={ticksSurface} class={`layer ticks${passive ? ' passive' : ''}`} aria-hidden={passive ? 'true' : undefined}>
      {ticks.map(({ comment, top }) =>
        passive ? (
          <span key={comment.id} class={`tick${openIds.includes(comment.id) ? ' open' : ''}`} style={{ ...inkStyle(comment.author), top: `${top}px` }} />
        ) : (
          <button
            key={comment.id}
            type="button"
            tabIndex={-1}
            class={`tick${openIds.includes(comment.id) ? ' open' : ''}`}
            style={{ ...inkStyle(comment.author), top: `${top}px` }}
            aria-label={`#${comment.number} · ${displayName(comment.author)}`}
            onPointerEnter={() => setTip({ id: comment.id, top })}
            onPointerLeave={() => setTip(null)}
            onClick={() => controller.openThread(comment.id)}
          />
        ),
      )}
      {tipped && !passive && (
        <div class="tick-tip" style={{ top: `${tipTop(tipped.top, surfaces.boxes('toolbar', 'pages', 'card', 'list'))}px` }}>
          <span class="mono">#{tipped.comment.number}</span> · {displayName(tipped.comment.author)} · {excerpt(plainBody(tipped.comment), 18)}
        </div>
      )}
    </div>
  )
}

const TICK_TIP_WIDTH = 320
const TICK_TIP_HEIGHT = 24

function tipTop(tickTopAt: number, obstacles: Rect[]): number {
  const wanted = { left: window.innerWidth - 20 - TICK_TIP_WIDTH, top: tickTopAt - 12, width: TICK_TIP_WIDTH, height: TICK_TIP_HEIGHT }
  return Math.round((nearestFree(wanted, screenArea(viewportSize(), 4), obstacles, { gap: 4, axis: 'y' }) ?? wanted).top)
}

export function excerpt(text: string, length: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= length) return flat
  const cut = flat.slice(0, length)
  return `${cut.slice(0, cut.lastIndexOf(' ') > length / 2 ? cut.lastIndexOf(' ') : length).trimEnd()}…`
}
