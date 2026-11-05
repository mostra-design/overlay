import type { Rect } from '../placement'

export type SurfaceName = 'toolbar' | 'pages' | 'menu' | 'ticks' | 'card' | 'list' | 'toasts'

export type Surfaces = ReturnType<typeof createSurfaces>

export function createSurfaces() {
  const elements = new Map<SurfaceName, Element>()
  const listeners = new Set<() => void>()
  const changed = () => {
    for (const listener of listeners) listener()
  }
  const resizes = typeof ResizeObserver === 'function' ? new ResizeObserver(changed) : null

  return {
    set(name: SurfaceName, element: Element | null) {
      const current = elements.get(name) ?? null
      if (current === element) return
      if (current) resizes?.unobserve(current)
      if (element) {
        elements.set(name, element)
        resizes?.observe(element)
      } else {
        elements.delete(name)
      }
      changed()
    },
    boxes(...names: SurfaceName[]): Rect[] {
      return names.flatMap((name) => {
        const box = elements.get(name)?.getBoundingClientRect()
        return box && box.width > 0 && box.height > 0 ? [{ left: box.left, top: box.top, width: box.width, height: box.height }] : []
      })
    },
    changed,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    destroy() {
      resizes?.disconnect()
      listeners.clear()
    },
  }
}
