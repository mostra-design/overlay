import { anchorTarget, isRendered, parentOf } from './anchor'
import type { Point } from './placement'

const CAPTURED = [
  'pointerdown',
  'pointerup',
  'pointermove',
  'pointerover',
  'pointerout',
  'pointerenter',
  'pointerleave',
  'pointercancel',
  'mousedown',
  'mouseup',
  'mousemove',
  'mouseover',
  'mouseout',
  'mouseenter',
  'mouseleave',
  'click',
  'dblclick',
  'auxclick',
  'contextmenu',
] as const
const PREVENTED = new Set(['mousedown', 'click'])
export const TAP_SLOP = 10
const TRAILING_MS = 800

export type PickerOptions = {
  window: Window
  isOwn(event: Event): boolean
  shieldTarget(event: Event): Element | null
  onHover(element: Element, point: Point): void
  onPick(element: Element, point: Point, stay: boolean): void
}

export type Picker = { stop(): void }

export function createPicker(options: PickerOptions): Picker {
  const target = options.window
  let press: { id: number; x: number; y: number } | null = null
  let pickedAt = -Infinity
  let stopped = false
  let finishTrailing: (() => void) | null = null
  const recentlyPicked = () => Date.now() - pickedAt < TRAILING_MS

  const listener = (event: Event) => {
    const shielded = options.shieldTarget(event)
    if (!shielded && options.isOwn(event)) return
    event.stopImmediatePropagation()
    if (PREVENTED.has(event.type)) event.preventDefault()
    if (stopped) {
      if (event.type === 'click') finishTrailing?.()
      return
    }
    if (event.type === 'click') pickedAt = -Infinity
    if (!isPointer(event)) return

    const element = shielded ?? pageElement(event)
    switch (event.type) {
      case 'pointerdown':
        press = { id: event.pointerId, x: event.clientX, y: event.clientY }
        return
      case 'pointermove':
        if (press?.id === event.pointerId && Math.hypot(event.clientX - press.x, event.clientY - press.y) >= TAP_SLOP) press = null
        if (event.pointerType !== 'touch' && element) options.onHover(anchorTarget(element), { x: event.clientX, y: event.clientY })
        return
      case 'pointercancel':
        press = null
        return
      case 'pointerup': {
        const tap = press?.id === event.pointerId && Math.hypot(event.clientX - press.x, event.clientY - press.y) < TAP_SLOP
        press = null
        if (!tap || !element) return
        pickedAt = Date.now()
        options.onPick(anchorTarget(element), { x: event.clientX, y: event.clientY }, event.shiftKey)
      }
    }
  }

  const touchEnd = (event: Event) => {
    if (!recentlyPicked() || options.isOwn(event)) return
    event.stopImmediatePropagation()
    if (event.cancelable) event.preventDefault()
  }

  const listenerOptions = { capture: true, passive: false }
  for (const type of CAPTURED) target.addEventListener(type, listener, listenerOptions)
  target.addEventListener('touchend', touchEnd, listenerOptions)

  return {
    stop() {
      if (stopped) return
      stopped = true
      const remove = () => {
        for (const type of CAPTURED) target.removeEventListener(type, listener, listenerOptions)
        target.removeEventListener('touchend', touchEnd, listenerOptions)
      }
      if (!recentlyPicked()) return remove()
      const timer = setTimeout(() => finishTrailing?.(), TRAILING_MS)
      finishTrailing = () => {
        finishTrailing = null
        clearTimeout(timer)
        setTimeout(remove, 0)
      }
    },
  }
}

function isPointer(event: Event): event is PointerEvent {
  return typeof (event as PointerEvent).pointerId === 'number' && event.type.startsWith('pointer')
}

function pageElement(event: Event): Element | null {
  const first = event.composedPath()[0]
  if (!first || !(first as Node).nodeType) return null
  const node = first as Node
  const element = node.nodeType === 1 ? (node as Element) : node.parentElement
  if (!element || element === element.ownerDocument.documentElement) return null
  return element
}

export function wider(element: Element): Element | null {
  const parent = element.parentElement
  if (!parent || parent === element.ownerDocument.body || parent === element.ownerDocument.documentElement) return null
  return parent
}

export function narrower(element: Element, trail: readonly Element[]): Element | null {
  const back = [...trail].reverse().find((candidate) => candidate !== element && element.contains(candidate))
  if (back) {
    for (let current: Element | null = back; current; current = parentOf(current)) {
      if (parentOf(current) === element) return current
    }
  }
  return Array.from(element.children).find((child) => isRendered(child) && !['script', 'style', 'template'].includes(child.localName)) ?? null
}

const NAVIGABLE =
  'a[href], button, input:not([type="hidden"]), select, textarea, summary, [tabindex]:not([tabindex="-1"]), [contenteditable="true"], h1, h2, h3, h4, h5, h6, main, nav, header, footer, aside, form, section[aria-label], section[aria-labelledby], [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="region"], [role="navigation"], [role="main"], [role="banner"], [role="contentinfo"]'

export function nextNavigable(document: Document, from: Element | null, direction: 1 | -1, isOwn: (element: Element) => boolean): Element | null {
  const elements = Array.from(document.querySelectorAll(NAVIGABLE)).filter((element) => isRendered(element) && !isOwn(element))
  if (elements.length === 0) return null
  let index = from ? elements.indexOf(from) : -1
  if (index === -1 && from) {
    const following = elements.findIndex((element) => from.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING)
    index = following === -1 ? elements.length : following
    if (direction === 1) index--
  }
  const next = (index + direction + elements.length) % elements.length
  return elements[next] ?? null
}
