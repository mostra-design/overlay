export type Point = { x: number; y: number }
export type Rect = { left: number; top: number; width: number; height: number }
export type Size = { width: number; height: number }

export const CARD_WIDTH = 320
export const CARD_MARGIN = 12
const PIN_OVER_CARD = 48
const SIDE_SPACE = CARD_WIDTH + 2 * CARD_MARGIN
const DOCK_FLIP = 0.6
export const SURFACE_GAP = 8
const MIN_CARD_HEIGHT = 200
const PEEK_GAP = 4
const MIN_PEEK = 72

export type Side = 'right' | 'left' | 'below' | 'above'

export type CardPlacement =
  | { kind: 'card'; side: Side | 'dock' | 'toolbar'; left: number; top: number; overlaps: boolean; maxHeight?: number }
  | { kind: 'stub'; edge: 'above' | 'below'; left: number }

export type CardInput = {
  target: Rect | null
  pin: Point | null
  card: Size
  viewport: Size
  toolbar: Rect
  obstacles?: readonly Rect[]
  text?: readonly Rect[]
  prefer?: Side | null
}

const PIN_INSET = 24
const STAY_ON_SIDE = 1.5
const FEW_WORDS = 600

export function screenArea(viewport: Size, margin = CARD_MARGIN): Rect {
  return { left: margin, top: margin, width: viewport.width - 2 * margin, height: viewport.height - 2 * margin }
}

export function nearestFree(box: Rect, area: Rect, obstacles: readonly Rect[], options: { gap?: number; axis?: 'x' | 'y' } = {}): Rect | null {
  const { gap = SURFACE_GAP, axis } = options
  const { width, height } = box
  const lastLeft = area.left + area.width - width
  const lastTop = area.top + area.height - height
  const lefts = axis === 'y' ? [box.left] : [clamp(box.left, area.left, lastLeft), ...obstacles.flatMap((other) => [other.left - gap - width, other.left + other.width + gap])]
  const tops = axis === 'x' ? [box.top] : [clamp(box.top, area.top, lastTop), ...obstacles.flatMap((other) => [other.top - gap - height, other.top + other.height + gap])]

  let best: Rect | null = null
  let bestDistance = Infinity
  for (const left of lefts) {
    if (left < area.left || left > lastLeft) continue
    for (const top of tops) {
      if (top < area.top || top > lastTop) continue
      const spot = { left, top, width, height }
      if (obstacles.some((other) => intersects(spot, grow(other, gap)))) continue
      const distance = Math.hypot(left - box.left, top - box.top)
      if (distance < bestDistance) {
        best = spot
        bestDistance = distance
      }
    }
  }
  return best
}

function openStretches(left: number, width: number, area: Rect, obstacles: readonly Rect[], gap: number): Array<{ top: number; bottom: number }> {
  const blocked = obstacles
    .filter((other) => other.left < left + width + gap && left - gap < other.left + other.width)
    .map((other) => ({ top: other.top - gap, bottom: other.top + other.height + gap }))
    .sort((first, second) => first.top - second.top)
  const stretches: Array<{ top: number; bottom: number }> = []
  let cursor = area.top
  for (const block of blocked) {
    if (block.top > cursor) stretches.push({ top: cursor, bottom: Math.min(block.top, area.top + area.height) })
    cursor = Math.max(cursor, block.bottom)
  }
  if (cursor < area.top + area.height) stretches.push({ top: cursor, bottom: area.top + area.height })
  return stretches
}

export function placeCard({ target, pin, card, viewport, toolbar, obstacles = [], text = [], prefer = null }: CardInput): CardPlacement {
  const surfaces = [toolbar, ...obstacles]
  if (!target) return dockByToolbar(card, viewport, toolbar, obstacles)

  const area = screenArea(viewport)
  const clampLeft = (left: number) => clamp(left, CARD_MARGIN, viewport.width - card.width - CARD_MARGIN)
  const underPin = (fallback: number) => (pin ? pin.x + PIN_OVER_CARD - card.width : fallback)
  if (target.top + target.height <= 0) return { kind: 'stub', edge: 'above', left: clampLeft(target.left) }
  if (target.top >= viewport.height) return { kind: 'stub', edge: 'below', left: clampLeft(target.left) }

  const right = target.left + target.width
  const bottom = target.top + target.height
  const sides: Side[] = target.width > viewport.width - 2 * SIDE_SPACE ? ['below', 'above'] : ['right', 'left', 'below', 'above']

  const fits = sides.flatMap((side) => {
    const spot = whole(side)
    return spot ? [{ side, spot, words: text.reduce((sum, rect) => sum + overlapArea(spot, rect), 0) }] : []
  })
  const fewest = fits.reduce<(typeof fits)[number] | null>((best, fit) => (!best || fit.words + FEW_WORDS < best.words ? fit : best), null)
  const staying = fits.find((fit) => fit.side === prefer)
  const chosen = staying && fewest && staying.words <= fewest.words * STAY_ON_SIDE + FEW_WORDS ? staying : fewest
  if (chosen) return { kind: 'card', side: chosen.side, left: chosen.spot.left, top: chosen.spot.top, overlaps: false }

  const anchor = pin ?? { x: target.left + target.width / 2, y: target.top }
  const nearEdge = anchor.x > viewport.width * DOCK_FLIP ? CARD_MARGIN : viewport.width - card.width - CARD_MARGIN
  const farEdge = viewport.width - card.width - nearEdge
  for (const left of [nearEdge, farEdge]) {
    const spot = nearestFree({ left, top: anchor.y - CARD_MARGIN, ...card }, area, surfaces)
    if (spot && !intersects(spot, target)) return { kind: 'card', side: 'dock', left: spot.left, top: spot.top, overlaps: false }
  }
  for (const side of sides) {
    const spot = shortened(side, MIN_CARD_HEIGHT)
    if (spot) return { kind: 'card', side, ...spot, overlaps: false }
  }
  for (const left of [nearEdge, farEdge]) {
    const spot = nearestFree({ left, top: anchor.y - CARD_MARGIN, ...card }, area, surfaces, { axis: 'y' })
    if (spot) return { kind: 'card', side: 'dock', left, top: spot.top, overlaps: intersects(spot, target) }
  }
  for (const left of [nearEdge, farEdge]) {
    const spot = inColumn(left, 0, anchor.y - CARD_MARGIN, Infinity, 1)
    if (spot) return { kind: 'card', side: 'dock', ...spot, overlaps: intersects({ ...spot, width: card.width, height: spot.maxHeight ?? card.height }, target) }
  }
  return { kind: 'card', side: 'dock', left: nearEdge, top: CARD_MARGIN, maxHeight: viewport.height - 2 * CARD_MARGIN, overlaps: true }

  function whole(side: Side): Rect | null {
    switch (side) {
      case 'right':
        return nearestFree({ left: right + CARD_MARGIN, top: target!.top, ...card }, area, surfaces, { axis: 'y' })
      case 'left':
        return nearestFree({ left: target!.left - CARD_MARGIN - card.width, top: target!.top, ...card }, area, surfaces, { axis: 'y' })
      case 'below':
        return clearOfWords(bottom + CARD_MARGIN)
      case 'above':
        return clearOfWords(target!.top - CARD_MARGIN - card.height)
    }
  }

  function clearOfWords(top: number): Rect | null {
    const lined = nearestFree({ left: underPin(target!.left), top, ...card }, area, surfaces, { axis: 'x' })
    if (!lined || !pin) return lined
    const band = text.filter((rect) => rect.top < top + card.height && top < rect.top + rect.height)
    const covered = (spot: Rect) => band.reduce((sum, rect) => sum + overlapArea(spot, rect), 0)
    const overPin = (left: number) => left <= pin.x - PIN_INSET && left + card.width >= pin.x + PIN_INSET
    const spots = band
      .flatMap((rect) => [rect.left + rect.width + SURFACE_GAP, rect.left - SURFACE_GAP - card.width])
      .filter(overPin)
      .flatMap((left) => nearestFree({ left, top, ...card }, area, surfaces, { axis: 'x' }) ?? [])
      .filter((spot) => overPin(spot.left))
    return [lined, ...spots].reduce((best, spot) => {
      const difference = covered(spot) - covered(best)
      return difference < 0 || (difference === 0 && Math.abs(spot.left - lined.left) < Math.abs(best.left - lined.left)) ? spot : best
    })
  }

  function shortened(side: Side, shortest: number): { left: number; top: number; maxHeight: number } | null {
    if (side === 'right' || side === 'left') {
      const left = side === 'right' ? right + CARD_MARGIN : target!.left - CARD_MARGIN - card.width
      if (left < CARD_MARGIN || left > viewport.width - card.width - CARD_MARGIN) return null
      return inColumn(left, -Infinity, target!.top, Infinity, shortest)
    }
    const lefts = [clampLeft(underPin(target!.left)), ...surfaces.flatMap((other) => [other.left - SURFACE_GAP - card.width, other.left + other.width + SURFACE_GAP])]
    const spots = lefts.flatMap((left) => {
      if (left < CARD_MARGIN || left > viewport.width - card.width - CARD_MARGIN) return []
      const spot = side === 'below' ? inColumn(left, bottom + CARD_MARGIN, bottom + CARD_MARGIN, Infinity, shortest) : inColumn(left, -Infinity, -Infinity, target!.top - CARD_MARGIN, shortest)
      return spot ? [spot] : []
    })
    return spots.reduce<(typeof spots)[number] | null>((best, spot) => (best && best.maxHeight >= spot.maxHeight ? best : spot), null)
  }

  function inColumn(left: number, from: number, wanted: number, to: number, shortest: number): { left: number; top: number; maxHeight: number } | null {
    const stretches = openStretches(left, card.width, area, surfaces, SURFACE_GAP)
      .map((stretch) => ({ top: Math.max(stretch.top, from), bottom: Math.min(stretch.bottom, to) }))
      .filter((stretch) => stretch.bottom - stretch.top >= Math.min(shortest, card.height))
      .sort((first, second) => second.bottom - second.top - (first.bottom - first.top))
    const stretch = stretches[0]
    if (!stretch) return null
    const maxHeight = Math.min(card.height, stretch.bottom - stretch.top)
    return { left, top: clamp(wanted, stretch.top, stretch.bottom - maxHeight), maxHeight }
  }
}

export function followsTarget(placement: CardPlacement, target: Rect, card: Size): boolean {
  if (placement.kind !== 'card' || placement.maxHeight !== undefined) return false
  const at = (left: number, top: number) => Math.abs(placement.left - left) <= 0.5 && Math.abs(placement.top - top) <= 0.5
  switch (placement.side) {
    case 'right':
      return at(target.left + target.width + CARD_MARGIN, target.top)
    case 'left':
      return at(target.left - CARD_MARGIN - card.width, target.top)
    case 'below':
      return at(placement.left, target.top + target.height + CARD_MARGIN)
    case 'above':
      return at(placement.left, target.top - CARD_MARGIN - card.height)
    default:
      return false
  }
}

export function dockByToolbar(card: Size, viewport: Size, toolbar: Rect, obstacles: readonly Rect[] = []): CardPlacement {
  const center = toolbar.left + toolbar.width / 2
  const alignedLeft =
    Math.abs(center - viewport.width / 2) < CARD_MARGIN * 4
      ? center - card.width / 2
      : center > viewport.width / 2
        ? toolbar.left + toolbar.width - card.width
        : toolbar.left
  const left = clamp(alignedLeft, CARD_MARGIN, viewport.width - card.width - CARD_MARGIN)
  const above = toolbar.top + toolbar.height / 2 > viewport.height / 2
  const room = above ? toolbar.top - SURFACE_GAP - CARD_MARGIN : viewport.height - CARD_MARGIN - (toolbar.top + toolbar.height + SURFACE_GAP)
  const height = Math.min(card.height, room)
  const top = above ? toolbar.top - SURFACE_GAP - height : toolbar.top + toolbar.height + SURFACE_GAP
  const spot = nearestFree({ left, top, width: card.width, height }, screenArea(viewport), [toolbar, ...obstacles], { axis: 'x' })
  return { kind: 'card', side: 'toolbar', left: spot?.left ?? left, top, overlaps: false, ...(height < card.height ? { maxHeight: height } : {}) }
}

export const LABEL_HEIGHT = 24
export const LABEL_OFFSET = 8
const PIN_MARGIN_LEFT = 4
const PIN_MARGIN_RIGHT = 20
const PIN_MARGIN_TOP = 4
const DOT_GAP = 6
const DOT_RADIUS = 3
const LABEL_ROOM = LABEL_OFFSET + 32
const COLUMN_GAP = 24
const CONTROL_WEIGHT = 1
const CONTROL_CLEARANCE = 8
const WORDS_TOLERANCE = 16
const WRONG_SIDE_WORDS = WORDS_TOLERANCE + 4
const REACH_X = 200
const REACH_Y = 120
const LABEL_REACH = 120
const LABEL_REACH_PHONE = 64
const PHONE_WIDTH = 640
const REACH_STEPS_ACROSS = [8, 16, 28, 44, 64, 88, 120]
const REACH_STEPS_DOWN = [8, 12, 16, 20, 24, 28, 36, 44, 54, 64]
const LINE_THROUGH_WORDS = 400
const SIDE_COST: Record<string, number> = { 'up-right': 0, 'down-right': 6, 'up-left': 10, 'down-left': 16 }

export type PinSide = 'up-right' | 'up-left' | 'down-right' | 'down-left'
const PIN_SIDES: readonly PinSide[] = ['up-right', 'down-right', 'up-left', 'down-left']

export type Surroundings = { text: readonly Rect[]; controls: readonly Rect[] }
export type PinRequest = { id: string; dot: Point; width: number; surroundings: Surroundings | null; peek?: PeekWish | null }
export type PinBounds = { left: number; right: number; top: number; reach?: number }

export function pinBounds(viewportWidth: number, scrollY: number): PinBounds {
  return { left: PIN_MARGIN_LEFT, right: viewportWidth - PIN_MARGIN_RIGHT, top: PIN_MARGIN_TOP - scrollY, reach: viewportWidth < PHONE_WIDTH ? LABEL_REACH_PHONE : LABEL_REACH }
}

export function pinBoundsIn(viewportWidth: number, origin: Point | null): PinBounds {
  const across = origin ? origin.x : 0
  return { left: PIN_MARGIN_LEFT - across, right: viewportWidth - PIN_MARGIN_RIGHT - across, top: PIN_MARGIN_TOP, reach: viewportWidth < PHONE_WIDTH ? LABEL_REACH_PHONE : LABEL_REACH }
}

export function textLines(rects: readonly Rect[]): Rect[] {
  const lines: Rect[] = []
  const sorted = rects.filter((rect) => rect.width > 0 && rect.height > 0).sort((first, second) => first.top - second.top || first.left - second.left)
  for (const rect of sorted) {
    const index = lines.findIndex((line) => sameLine(line, rect))
    if (index === -1) lines.push(rect)
    else lines[index] = union([lines[index]!, rect])
  }
  return lines
}

function sameLine(line: Rect, rect: Rect): boolean {
  const shared = Math.min(line.top + line.height, rect.top + rect.height) - Math.max(line.top, rect.top)
  const apart = Math.max(rect.left - (line.left + line.width), line.left - (rect.left + rect.width))
  return shared >= Math.min(line.height, rect.height) / 2 && apart <= Math.max(COLUMN_GAP, Math.min(line.height, rect.height))
}

export function dotOnText(lines: readonly Rect[], wanted: Point | null, viewportWidth: number): Point | null {
  if (lines.length === 0) return null
  const distance = (line: Rect) => (wanted ? Math.max(0, line.top - wanted.y, wanted.y - (line.top + line.height)) : 0)
  const byDistance = lines.map((line, order) => ({ line, order })).sort((first, second) => distance(first.line) - distance(second.line) || first.order - second.order)
  const roomy = byDistance.find(({ line }) => line.left + line.width + DOT_GAP + LABEL_ROOM <= viewportWidth - PIN_MARGIN_RIGHT)
  const line = (roomy ?? byDistance[0]!).line
  const past = line.left + line.width + DOT_GAP
  const y = line.top + line.height / 2
  if (past + LABEL_ROOM <= viewportWidth - PIN_MARGIN_RIGHT) return { x: past, y }
  if (line.left - DOT_GAP >= DOT_RADIUS + PIN_MARGIN_LEFT) return { x: line.left - DOT_GAP, y }
  return { x: Math.min(past, viewportWidth - DOT_RADIUS - PIN_MARGIN_LEFT), y: line.top - DOT_GAP }
}

export function dotAfterWords(words: readonly Rect[], taken: readonly Rect[], viewportWidth: number): Point | null {
  const end = words.filter((rect) => rect.width > 0 && rect.height > 0).at(-1)
  if (!end) return null
  const right = end.left + end.width
  const spots = [
    { x: right + DOT_GAP, y: end.top + end.height / 2 },
    { x: right, y: end.top - DOT_GAP },
    { x: right, y: end.top + end.height + DOT_GAP },
  ]
  return spots.find((spot) => spot.x + LABEL_ROOM <= viewportWidth - PIN_MARGIN_RIGHT && !taken.some((rect) => intersects(grow(dotBox(spot), 1), rect))) ?? null
}

export function faceBox(dot: Point, width: number, side: PinSide, bounds?: PinBounds, reach: Point = { x: LABEL_OFFSET, y: LABEL_OFFSET }): Rect {
  const right = side.endsWith('right')
  const up = side.startsWith('up')
  let left = right ? dot.x + reach.x : dot.x - reach.x - width
  let top = up ? dot.y - reach.y - LABEL_HEIGHT : dot.y + reach.y
  if (bounds) {
    left = right ? Math.max(left, bounds.left) : Math.min(left, bounds.right - width)
    if (!up) top = Math.max(top, bounds.top)
  }
  return { left, top, width, height: LABEL_HEIGHT }
}

export function faceCorner(face: Rect, side: PinSide): Point {
  return { x: side.endsWith('right') ? face.left : face.left + face.width, y: side.startsWith('up') ? face.top + face.height : face.top }
}

export function tipReach(dot: Point, face: Rect, side: PinSide): Point {
  const corner = faceCorner(face, side)
  return { x: Math.abs(corner.x - dot.x), y: Math.abs(corner.y - dot.y) }
}

export function pinOutline(dot: Point, width: number, side: PinSide, bounds?: PinBounds, reach?: Point): Rect {
  return union([faceBox(dot, width, side, bounds, reach), { left: dot.x - DOT_RADIUS, top: dot.y - DOT_RADIUS, width: 2 * DOT_RADIUS, height: 2 * DOT_RADIUS }])
}

export function aroundDot(dot: Point, text: readonly Rect[], controls: readonly Rect[]): Surroundings {
  const reachable = (rect: Rect) => rect.left < dot.x + REACH_X && rect.left + rect.width > dot.x - REACH_X && rect.top < dot.y + REACH_Y && rect.top + rect.height > dot.y - REACH_Y
  const fromDot = (rect: Rect) => ({ left: rect.left - dot.x, top: rect.top - dot.y, width: rect.width, height: rect.height })
  return { text: text.filter(reachable).map(fromDot), controls: controls.filter(reachable).map(fromDot) }
}

function overlapArea(first: Rect, second: Rect): number {
  const width = Math.min(first.left + first.width, second.left + second.width) - Math.max(first.left, second.left)
  const height = Math.min(first.top + first.height, second.top + second.height) - Math.max(first.top, second.top)
  return width > 0 && height > 0 ? width * height : 0
}

function linesThrough(from: Point, to: Point, rects: readonly Rect[]): number {
  const length = Math.hypot(to.x - from.x, to.y - from.y)
  const steps = Math.max(1, Math.ceil(length / 3))
  const reach = { left: Math.min(from.x, to.x), top: Math.min(from.y, to.y), width: Math.abs(to.x - from.x) + 0.01, height: Math.abs(to.y - from.y) + 0.01 }
  let count = 0
  for (const rect of rects) {
    if (!intersects(reach, rect)) continue
    for (let step = 1; step < steps; step++) {
      const x = from.x + ((to.x - from.x) * step) / steps
      const y = from.y + ((to.y - from.y) * step) / steps
      if (x > rect.left + 1 && x < rect.left + rect.width - 1 && y > rect.top + 2 && y < rect.top + rect.height - 2) {
        count++
        break
      }
    }
  }
  return count
}

export type PeekWish = { wanted: number; minimum: number }
export type PeekPlace = { left: boolean; room: number }
export type LabelPlace = { side: PinSide; reach: Point; peek?: PeekPlace }

export type FaceOptions = {
  previous?: ReadonlyMap<string, LabelPlace>
  peekObstacles?: readonly Rect[]
}

export const CLUSTER_DISTANCE = 24

type Cost = [number, number, number, number, number, number]
type Judged = { place: LabelPlace; face: Rect; cost: Cost }
const COST_TOLERANCE: Cost = [0.5, 0, WORDS_TOLERANCE, 0, 0, 0.5]

function worse(first: Cost, second: Cost): boolean {
  const index = first.findIndex((value, position) => Math.abs(value - second[position]!) > COST_TOLERANCE[position]!)
  return index !== -1 && first[index]! > second[index]!
}

function free(cost: Cost): boolean {
  return cost[0] <= COST_TOLERANCE[0] && cost[1] === 0 && cost[2] <= COST_TOLERANCE[2] && cost[3] === 0 && cost[4] === 0
}

const candidateLists = new Map<number, LabelPlace[]>()
function candidatesWithin(furthest: number): readonly LabelPlace[] {
  let list = candidateLists.get(furthest)
  if (!list) {
    list = PIN_SIDES.flatMap((side) => REACH_STEPS_ACROSS.flatMap((across) => REACH_STEPS_DOWN.flatMap((down) => (across <= furthest && down <= furthest ? [{ side, reach: { x: across, y: down } }] : []))))
    candidateLists.set(furthest, list)
  }
  return list
}

function dotBox(dot: Point): Rect {
  return grow({ left: dot.x, top: dot.y, width: 0, height: 0 }, DOT_RADIUS)
}

export function placeFaces(requests: readonly PinRequest[], bounds: PinBounds, { previous, peekObstacles = [] }: FaceOptions = {}): ReadonlyMap<string, LabelPlace> {
  const places = new Map<string, LabelPlace>()
  const taken: Rect[] = requests.map(({ dot }) => dotBox(dot))
  const peeks: Rect[] = []
  const outlines = new Map(requests.map(({ id, dot }) => [id, dotBox(dot)]))
  const furthest = bounds.reach ?? LABEL_REACH
  const candidates = candidatesWithin(furthest)
  const nearestFirst = [...candidates].sort((first, second) => reachCost(first) - reachCost(second))
  for (const request of requests) {
    const { id, dot, width, peek: wish } = request
    const span = furthest + width + CLUSTER_DISTANCE + 8
    const reachable = { left: dot.x - span, top: dot.y - furthest - LABEL_HEIGHT - CLUSTER_DISTANCE - 8, width: 2 * span, height: 2 * (furthest + LABEL_HEIGHT + CLUSTER_DISTANCE + 8) }
    const near = taken.filter((box) => intersects(box, reachable))
    const nearPeeks = peeks.filter((box) => intersects(box, reachable))
    const ownDot = dotBox(dot)
    const neighbours = [...outlines].flatMap(([other, outline]) => (other !== id && intersects(outline, reachable) && gapBetween(ownDot, outline) > CLUSTER_DISTANCE ? [outline] : []))
    const around = (rects: readonly Rect[] | undefined) => (rects ?? []).map((rect) => ({ ...rect, left: rect.left + dot.x, top: rect.top + dot.y }))
    const text = around(request.surroundings?.text)
    const controls = around(request.surroundings?.controls)
    const crossable = controls.filter((rect) => !(dot.x > rect.left && dot.x < rect.left + rect.width && dot.y > rect.top && dot.y < rect.top + rect.height))
    const spacedControls = controls.map((rect) => grow(rect, CONTROL_CLEARANCE))
    const opensRight = dot.x + LABEL_OFFSET + width <= bounds.right

    const judge = (place: LabelPlace, quick = false): Judged => {
      const face = faceBox(dot, width, place.side, bounds, place.reach)
      const corner = faceCorner(face, place.side)
      const off = Math.max(0, bounds.left - face.left) + Math.max(0, face.left + width - bounds.right) + Math.max(0, bounds.top - face.top)
      const onPins = near.filter((box) => intersects(face, box)).length
      const underPeeks = nearPeeks.filter((box) => intersects(face, box)).length
      const outline = union([face, ownDot])
      const crowding = neighbours.filter((other) => gapBetween(outline, other) <= CLUSTER_DISTANCE).length
      const distance = Math.abs(corner.x - dot.x) + Math.abs(corner.y - dot.y) + SIDE_COST[place.side]!
      if (quick) return { place, face, cost: [off, onPins, off > COST_TOLERANCE[0] || onPins > 0 || underPeeks > 0 || crowding > 0 ? Infinity : 0, underPeeks, crowding, distance] }
      const wrongSide = opensRight && place.side.endsWith('left') ? WRONG_SIDE_WORDS : 0
      const words = text.reduce((sum, rect) => sum + overlapArea(face, rect), 0) + (linesThrough(dot, corner, text) + linesThrough(dot, corner, crossable)) * LINE_THROUGH_WORDS + spacedControls.reduce((sum, rect) => sum + overlapArea(face, rect), 0) * CONTROL_WEIGHT + wrongSide
      return { place, face, cost: [off, onPins, words, underPeeks, crowding, distance] }
    }

    const rows = { top: dot.y - furthest - LABEL_HEIGHT - 2, bottom: dot.y + furthest + LABEL_HEIGHT + 2 }
    const inRows = (rect: Rect) => rect.top < rows.bottom && rows.top < rect.top + rect.height
    const blockers = wish ? [...peekObstacles.filter(inRows), ...[...taken, ...peeks].map((box) => ({ ...box, top: box.top - 2, height: box.height + 4 }))] : []
    const roomFor = (face: Rect, left: boolean) => runBeside(face, left, blockers, bounds)

    const chosen = keep(previous?.get(id)) ?? search()
    places.set(id, chosen.place)
    taken.push(chosen.face)
    if (chosen.place.peek) peeks.push(wordsBox(chosen.face, chosen.place.peek))
    outlines.set(id, union([chosen.face, ownDot]))

    function keep(before: LabelPlace | undefined): Judged | null {
      if (!before || before.reach.x > furthest || before.reach.y > furthest) return null
      const judged = judge({ side: before.side, reach: before.reach })
      if (!free(judged.cost)) return null
      if (!wish) return judged
      if (before.peek) return roomFor(judged.face, before.peek.left) >= before.peek.room ? { ...judged, place: { ...judged.place, peek: before.peek } } : null
      const peek = wholeWords(judged)
      return peek ? { ...judged, place: { ...judged.place, peek } } : null
    }

    function wholeWords({ face, place }: Judged): PeekPlace | null {
      const outward = place.side.endsWith('left')
      for (const left of [outward, !outward]) if (roomFor(face, left) >= wish!.wanted) return { left, room: Math.round(wish!.wanted) }
      return null
    }

    function withWords(judged: Judged, left: boolean, room: number): Judged {
      return { ...judged, place: { ...judged.place, peek: { left, room: Math.round(Math.min(wish!.wanted, room)) } } }
    }

    function search(): Judged {
      if (!wish) {
        let found: Judged | null = null
        for (const place of nearestFirst) {
          if (found && reachCost(place) >= found.cost[5]) break
          const quick = judge(place, true)
          if (!free(quick.cost) || (found && quick.cost[5] >= found.cost[5])) continue
          const judged = judge(place)
          if (free(judged.cost)) found = judged
        }
        return found ?? leastCovered()
      }
      const order = candidates.map((place) => judge(place, true)).sort((first, second) => first.cost[5] - second.cost[5])
      const frees: Judged[] = []
      for (const quick of order) {
        if (!free(quick.cost)) continue
        const judged = judge(quick.place)
        if (!free(judged.cost)) continue
        if (!wish) return judged
        frees.push(judged)
        const outward = judged.place.side.endsWith('left')
        if (roomFor(judged.face, outward) >= wish.wanted) return withWords(judged, outward, wish.wanted)
      }
      if (wish) {
        for (const judged of frees) {
          const inward = !judged.place.side.endsWith('left')
          if (roomFor(judged.face, inward) >= wish.wanted) return withWords(judged, inward, wish.wanted)
        }
        const enough = Math.min(wish.wanted, Math.max(MIN_PEEK, wish.minimum))
        for (const judged of frees) {
          const outward = judged.place.side.endsWith('left')
          const rooms = [outward, !outward].map((left) => ({ left, room: roomFor(judged.face, left) }))
          const roomier = rooms[1]!.room > rooms[0]!.room ? rooms[1]! : rooms[0]!
          if (roomier.room >= enough) return withWords(judged, roomier.left, roomier.room)
        }
      }
      return frees[0] ?? leastCovered()
    }

    function leastCovered(): Judged {
      return candidates.map((place) => judge(place)).reduce((best, judged) => (worse(best.cost, judged.cost) ? judged : best))
    }
  }
  return places
}

function reachCost({ side, reach }: LabelPlace): number {
  return reach.x + reach.y + SIDE_COST[side]!
}

function runBeside(face: Rect, left: boolean, blockers: readonly Rect[], bounds: PinBounds): number {
  const bottom = face.top + face.height
  const right = face.left + face.width
  let edge = left ? bounds.left : bounds.right
  for (const other of blockers) {
    if (other.top >= bottom || other.top + other.height <= face.top) continue
    if (left) {
      if (other.left < face.left) edge = Math.max(edge, other.left + other.width + PEEK_GAP)
    } else if (other.left + other.width > right) edge = Math.min(edge, other.left - PEEK_GAP)
  }
  return left ? face.left - edge : edge - right
}

export function wordsBox(face: Rect, { left, room }: PeekPlace): Rect {
  return { left: left ? face.left - room : face.left + face.width, top: face.top, width: room, height: face.height }
}

export function leaderCrosses(line: Point[], marks: Rect[], margin = 12): boolean {
  const lengths = line.slice(1).map((point, index) => Math.hypot(point.x - line[index]!.x, point.y - line[index]!.y))
  const total = lengths.reduce((sum, length) => sum + length, 0)
  let walked = 0
  for (const [index, length] of lengths.entries()) {
    const from = line[index]!
    const to = line[index + 1]!
    for (let along = 0; along <= length; along += 4) {
      const distance = walked + along
      if (distance < margin || distance > total - margin) continue
      const x = from.x + ((to.x - from.x) * along) / length
      const y = from.y + ((to.y - from.y) * along) / length
      if (marks.some((mark) => x > mark.left && x < mark.left + mark.width && y > mark.top && y < mark.top + mark.height)) return true
    }
    walked += length
  }
  return false
}

export function leaderRoute(card: Rect, pin: Rect, marks: Rect[], words: readonly Rect[] = []): Point[] {
  const direct = leaderLine(card, pin)
  if (direct.length < 2) return direct
  const avoided = [...marks, ...words]
  if (!routeCrosses(direct, avoided)) return direct
  const bracket = sideBracket(card, pin)
  if (bracket.length > 1 && !routeCrosses(bracket, avoided)) return bracket
  return routeCrosses(direct, words) ? [] : direct
}

function routeCrosses(route: Point[], rects: readonly Rect[]): boolean {
  const reach = grow(union(route.map((point) => ({ left: point.x, top: point.y, width: 0, height: 0 }))), 1)
  return leaderCrosses(route, rects.filter((rect) => intersects(reach, rect)))
}

function sideBracket(card: Rect, pin: Rect): Point[] {
  const center = { x: pin.left + pin.width / 2, y: pin.top + pin.height / 2 }
  const fromRight = center.x > card.left + card.width / 2
  const startX = fromRight ? card.left + card.width : card.left
  if (fromRight ? center.x <= startX : center.x >= startX) return []
  const y = clamp(center.y, card.top + 16, card.top + card.height - 16)
  if (y >= pin.top && y <= pin.top + pin.height) return [{ x: startX, y }, { x: fromRight ? pin.left : pin.left + pin.width, y }]
  return [{ x: startX, y }, { x: center.x, y }, { x: center.x, y: y < pin.top ? pin.top : pin.top + pin.height }]
}

export function leaderLine(card: Rect, pin: Rect): Point[] {
  const cardRight = card.left + card.width
  const cardBottom = card.top + card.height
  const pinRight = pin.left + pin.width
  const pinBottom = pin.top + pin.height
  const center = { x: pin.left + pin.width / 2, y: pin.top + pin.height / 2 }
  const inset = 16

  if (card.left >= pinRight || cardRight <= pin.left) {
    const startX = card.left >= pinRight ? card.left : cardRight
    const endX = card.left >= pinRight ? pinRight : pin.left
    const y = clamp(center.y, card.top + inset, cardBottom - inset)
    if (y >= pin.top && y <= pinBottom) return [{ x: startX, y }, { x: endX, y }]
    return [{ x: startX, y }, { x: center.x, y }, { x: center.x, y: y < pin.top ? pin.top : pinBottom }]
  }
  if (card.top >= pinBottom || cardBottom <= pin.top) {
    const startY = card.top >= pinBottom ? card.top : cardBottom
    const endY = card.top >= pinBottom ? pinBottom : pin.top
    const x = clamp(center.x, card.left + inset, cardRight - inset)
    if (x >= pin.left && x <= pinRight) return [{ x, y: startY }, { x, y: endY }]
    return [{ x, y: startY }, { x, y: center.y }, { x: x < pin.left ? pin.left : pinRight, y: center.y }]
  }
  return []
}

export type PinBox = { id: string } & Rect

export type Cluster = { ids: string[]; box: Rect }

export function clusterPins(pins: readonly PinBox[], distance = 24): Cluster[] {
  const parent = pins.map((_, index) => index)
  const find = (index: number): number => {
    while (parent[index] !== index) index = parent[index] = parent[parent[index]!]!
    return index
  }
  for (let first = 0; first < pins.length; first++) {
    for (let second = first + 1; second < pins.length; second++) {
      if (gapBetween(pins[first]!, pins[second]!) <= distance) parent[find(second)] = find(first)
    }
  }
  const groups = new Map<number, PinBox[]>()
  pins.forEach((pin, index) => {
    const root = find(index)
    groups.set(root, [...(groups.get(root) ?? []), pin])
  })
  return Array.from(groups.values(), (members) => ({ ids: members.map((member) => member.id), box: union(members) }))
}

export const TICK_HEIGHT = 3

export function tickTop(documentY: number, documentHeight: number, viewportHeight: number): number {
  const track = viewportHeight - TICK_HEIGHT
  if (!(documentHeight > 0)) return 0
  return Math.round(clamp((documentY / documentHeight) * viewportHeight, 0, track))
}

export function union(rects: readonly Rect[]): Rect {
  const left = Math.min(...rects.map((rect) => rect.left))
  const top = Math.min(...rects.map((rect) => rect.top))
  const right = Math.max(...rects.map((rect) => rect.left + rect.width))
  const bottom = Math.max(...rects.map((rect) => rect.top + rect.height))
  return { left, top, width: right - left, height: bottom - top }
}

export function intersects(first: Rect, second: Rect): boolean {
  return first.left < second.left + second.width && second.left < first.left + first.width && first.top < second.top + second.height && second.top < first.top + first.height
}

function gapBetween(first: Rect, second: Rect): number {
  const horizontal = Math.max(0, second.left - (first.left + first.width), first.left - (second.left + second.width))
  const vertical = Math.max(0, second.top - (first.top + first.height), first.top - (second.top + second.height))
  return Math.hypot(horizontal, vertical)
}

function grow(rect: Rect, by: number): Rect {
  return { left: rect.left - by, top: rect.top - by, width: rect.width + 2 * by, height: rect.height + 2 * by }
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(value, Math.max(minimum, maximum)))
}
