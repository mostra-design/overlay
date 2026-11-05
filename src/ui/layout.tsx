import { createContext, type ComponentChildren, type RefObject } from 'preact'
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { Point, Rect } from '../placement'
import type { Comment } from '../protocol'
import { SURFACE_GAP } from '../placement'
import { createAnchorTracker, type AnchorTracker, type Placement } from '../tracker'
import { isRendered } from '../anchor'
import { prefersReducedMotion, useController, useMostraState, usePhone } from './hooks'
import { createSurfaces, type SurfaceName, type Surfaces } from './surfaces'

export type DrawnFace = { face: Rect; outline: Rect; dot: Point }

export type Layout = {
  placements: ReadonlyMap<string, Placement>
  tracker: AnchorTracker
  toolbar: RefObject<HTMLDivElement | null>
  pinFaces: RefObject<ReadonlyMap<string, DrawnFace>>
  surfaces: Surfaces
  phone: boolean
  threads: Comment[]
}

const LayoutContext = createContext<Layout | null>(null)

export function useLayout(): Layout {
  const layout = useContext(LayoutContext)
  if (!layout) throw new Error('mostra UI rendered outside of its layout')
  return layout
}

export function useSurface(name: SurfaceName) {
  const { surfaces } = useLayout()
  return useCallback((element: Element | null) => surfaces.set(name, element), [surfaces, name])
}

export function useSurfaceChanges() {
  const { surfaces } = useLayout()
  const [, setChanges] = useState(0)
  useEffect(() => surfaces.subscribe(() => setChanges((count) => count + 1)), [surfaces])
}

export function useSheetLift(): number {
  const { surfaces } = useLayout()
  const talking = useMostraState((state) => state.talk !== null && state.talk.phase !== 'failed')
  useSurfaceChanges()
  const bar = talking ? surfaces.boxes('toolbar')[0] : undefined
  return bar ? window.innerHeight - bar.top + SURFACE_GAP : 0
}

const SETTLE_MS = 3000
const SETTLE_CHECK_MS = 150
const VIEW_MARGIN = 48
const TAKING_OVER = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const

function useScrollToFocus(tracker: AnchorTracker, placements: { current: ReadonlyMap<string, Placement> }, phone: boolean) {
  const focus = useMostraState((state) => state.focus)
  useEffect(() => {
    if (!focus || phone) return
    const started = Date.now()
    let timer: ReturnType<typeof setTimeout> | undefined
    let scrolled = false
    let lastY: number | null = null
    const stop = () => {
      clearTimeout(timer)
      for (const type of TAKING_OVER) window.removeEventListener(type, stop, true)
    }
    const check = () => {
      const settled = lastY === window.scrollY
      lastY = window.scrollY
      const element = tracker.element(focus.id)
      const placement = placements.current.get(focus.id)
      if (element && isRendered(element) && (!scrolled || settled)) {
        const behavior = scrolled || prefersReducedMotion() ? 'instant' : 'smooth'
        const point = placement?.status === 'placed' ? placement.point : null
        if (point && (point.y < VIEW_MARGIN || point.y > window.innerHeight - 2 * VIEW_MARGIN)) {
          window.scrollBy({ top: point.y - window.innerHeight / 3, behavior })
          scrolled = true
        } else if (placement?.status === 'hidden') {
          element.scrollIntoView({ block: 'center', inline: 'nearest', behavior })
          scrolled = true
        }
      }
      if (Date.now() - started < SETTLE_MS) timer = setTimeout(check, SETTLE_CHECK_MS)
      else stop()
    }
    for (const type of TAKING_OVER) window.addEventListener(type, stop, { capture: true, passive: true })
    check()
    return stop
  }, [focus?.nonce])
}

export function LayoutProvider({ children }: { children: ComponentChildren }) {
  const controller = useController()
  const comments = useMostraState((state) => state.comments)
  const pending = useMostraState((state) => state.pending)
  const deleting = useMostraState((state) => state.deleting)
  const pageUrl = useMostraState((state) => state.pageUrl)
  const phone = usePhone()
  const toolbar = useRef<HTMLDivElement>(null)
  const pinFaces = useRef<ReadonlyMap<string, DrawnFace>>(new Map())
  const [placements, setPlacements] = useState<ReadonlyMap<string, Placement>>(new Map())
  const latestPlacements = useRef(placements)
  latestPlacements.current = placements
  const [tracker] = useState(() => createAnchorTracker(window, setPlacements))
  const [surfaces] = useState(createSurfaces)

  const threads = useMemo(() => {
    const sent = Array.from(comments.values()).filter((comment) => comment.parent_id === null && comment.page_url === pageUrl && !deleting.has(comment.id))
    const sending = Array.from(pending.values(), (item) => item.comment).filter((comment) => comment.parent_id === null && comment.page_url === pageUrl)
    return [...sent, ...sending].sort((first, second) => (first.number ?? Infinity) - (second.number ?? Infinity))
  }, [comments, pending, deleting, pageUrl])

  useEffect(
    () => () => {
      tracker.destroy()
      surfaces.destroy()
    },
    [tracker, surfaces],
  )

  useEffect(() => {
    const anchors = new Map()
    for (const thread of threads) if (thread.anchor) anchors.set(thread.id, thread.anchor)
    tracker.track(anchors)
  }, [tracker, threads])

  useEffect(() => {
    const positions = new Map<string, number>()
    const unplaced = new Set<string>()
    for (const [id, placement] of placements) {
      if (placement.documentY !== null) positions.set(id, placement.documentY)
      if (placement.status === 'unplaced') unplaced.add(id)
    }
    controller.setLayout(positions, unplaced)
  }, [placements])

  useScrollToFocus(tracker, latestPlacements, phone)

  const layout = useMemo(() => ({ placements, tracker, toolbar, pinFaces, surfaces, phone, threads }), [placements, tracker, surfaces, phone, threads])
  return <LayoutContext.Provider value={layout}>{children}</LayoutContext.Provider>
}
