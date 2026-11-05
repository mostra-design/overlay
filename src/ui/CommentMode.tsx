import { useEffect, useRef, useState } from 'preact/hooks'
import { describeElement, isRendered } from '../anchor'
import { createPicker, TAP_SLOP } from '../picker'
import { nearestFree, screenArea, type Point } from '../placement'
import { backdropOf } from '../region'
import { originFor, rangeBox, toRect } from '../tracker'
import { useController, useFrame, useMostraState } from './hooks'
import { PenIcon } from './icons'
import { useLayout } from './layout'
import { Highlight } from './Marks'
import { HOST_TAG } from './mount'

export function isOwnEvent(event: Event): boolean {
  return event.composedPath().some((node) => (node as Element).localName === HOST_TAG)
}

export function isOwnElement(element: Element): boolean {
  return element.localName === HOST_TAG || element.closest(HOST_TAG) !== null
}

export function useClickAway(onClick: () => void, onPress?: () => void) {
  const controller = useController()
  const latest = useRef({ onClick, onPress })
  latest.current = { onClick, onPress }
  useEffect(() => {
    let press: Point | null = null
    const commenting = () => controller.store.get().mode !== null
    const onPointerDown = (event: PointerEvent) => {
      press = isOwnEvent(event) || commenting() ? null : { x: event.clientX, y: event.clientY }
      if (press) latest.current.onPress?.()
    }
    const onWindowClick = (event: MouseEvent) => {
      const tap = press && Math.hypot(event.clientX - press.x, event.clientY - press.y) < TAP_SLOP
      press = null
      if (tap && !isOwnEvent(event)) latest.current.onClick()
    }
    const onBlur = () => {
      if (document.activeElement?.localName !== 'iframe' || commenting()) return
      latest.current.onPress?.()
      latest.current.onClick()
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('click', onWindowClick, true)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('click', onWindowClick, true)
      window.removeEventListener('blur', onBlur)
    }
  }, [])
}

export function CommentMode() {
  const controller = useController()
  const { tracker, threads } = useLayout()
  const commenting = useMostraState((state) => state.mode !== null)
  const aim = useMostraState((state) => state.aim)
  const [frames, setFrames] = useState<HTMLIFrameElement[]>([])
  useFrame(commenting)

  useEffect(() => {
    if (!commenting) return
    setFrames(Array.from(document.querySelectorAll('iframe')).filter((frame) => isRendered(frame)))
    const picker = createPicker({
      window,
      isOwn: isOwnEvent,
      shieldTarget(event) {
        const shield = event.composedPath().find((node) => (node as HTMLElement).dataset?.mostraShield !== undefined) as HTMLElement | undefined
        return shield ? (document.querySelectorAll('iframe')[Number(shield.dataset.mostraShield)] ?? null) : null
      },
      onHover: (element) => controller.aimAt(element),
      onPick: (element, point, stay) => controller.pick(element, point, stay),
    })
    return () => picker.stop()
  }, [commenting])

  if (!commenting) return null
  const box = aim && aim.element.isConnected ? toRect(aim.element.getBoundingClientRect()) : null
  const count = aim ? threads.filter((thread) => tracker.element(thread.id) === aim.element).length : 0
  const label = aim ? `${describeElement(aim.element)}${count ? ` · ${count} ${count === 1 ? 'comment' : 'comments'}` : ''}` : null

  return (
    <>
      {frames.map((frame, index) => {
        const rect = frame.getBoundingClientRect()
        return (
          <div
            key={index}
            class="layer shield"
            data-mostra-shield={String(Array.from(document.querySelectorAll('iframe')).indexOf(frame))}
            style={{ transform: `translate(${Math.round(rect.left)}px, ${Math.round(rect.top)}px)`, width: `${Math.round(rect.width)}px`, height: `${Math.round(rect.height)}px` }}
          />
        )
      })}
      {box && aim && <Highlight box={box} origin={originFor(aim.element, window)} label={label} backdrop={backdropOf(aim.element, window)} />}
    </>
  )
}

export function useSelection(): Range | null {
  const [range, setRange] = useState<Range | null>(null)
  useEffect(() => {
    const update = () => {
      const selection = document.getSelection()
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) return setRange(null)
      const current = selection.getRangeAt(0)
      const container = current.commonAncestorContainer
      const element = container.nodeType === 1 ? (container as Element) : container.parentElement
      if (!element || isOwnElement(element) || element.closest('input, textarea, [contenteditable="true"]') || !current.toString().trim()) return setRange(null)
      setRange(current.cloneRange())
    }
    document.addEventListener('selectionchange', update)
    return () => document.removeEventListener('selectionchange', update)
  }, [])
  return range
}

export function sameRange(first: Range, second: Range | null): boolean {
  return second !== null && first.startContainer === second.startContainer && first.startOffset === second.startOffset && first.endContainer === second.endContainer && first.endOffset === second.endOffset
}

const CHIP_WIDTH = 112
const CHIP_HEIGHT = 32

export function SelectionChip({ range }: { range: Range }) {
  const controller = useController()
  const { surfaces } = useLayout()
  useFrame()
  const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0)
  const last = rects[rects.length - 1] ?? range.getBoundingClientRect()
  const box = rangeBox(range)
  if (box.top + box.height < 0 || box.top > window.innerHeight) return null
  const wanted = { left: last.right + 6, top: last.bottom + 6, width: CHIP_WIDTH, height: CHIP_HEIGHT }
  const viewport = { width: window.innerWidth, height: window.innerHeight }
  const { left, top } = nearestFree(wanted, screenArea(viewport), surfaces.boxes('toolbar', 'pages', 'card', 'list'), { gap: 4 }) ?? wanted
  return (
    <button
      type="button"
      class="layer selection-chip"
      style={{ transform: `translate(${Math.round(left)}px, ${Math.round(top)}px)` }}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => controller.pickSelection(range)}
    >
      <PenIcon size={14} />
      Comment
    </button>
  )
}
