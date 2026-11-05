import { clamp, type Rect, type Size } from './placement'

export type ToolbarPosition = { horizontal: 'left' | 'center' | 'right'; x: number; vertical: 'top' | 'bottom'; y: number }

export const TOOLBAR_MARGIN = 16
export const SNAP_DISTANCE = 14

export function parseToolbarPosition(stored: string | null): ToolbarPosition {
  try {
    const { horizontal, x, vertical, y } = JSON.parse(stored ?? 'null') as ToolbarPosition
    if (['left', 'center', 'right'].includes(horizontal) && ['top', 'bottom'].includes(vertical) && Number.isFinite(x) && Number.isFinite(y)) return { horizontal, x, vertical, y }
  } catch {
  }
  return { horizontal: 'left', x: TOOLBAR_MARGIN, vertical: 'bottom', y: TOOLBAR_MARGIN }
}

export function toolbarBox(position: ToolbarPosition, size: Size, viewport: Size): Rect {
  const lines = { left: position.x, center: (viewport.width - size.width) / 2 + position.x, right: viewport.width - size.width - position.x }
  const left = lines[position.horizontal]
  const top = position.vertical === 'top' ? position.y : viewport.height - size.height - position.y
  return onScreen({ left, top, ...size }, viewport)
}

export function snapToolbar(wanted: Rect, viewport: Size): Rect {
  const { width, height } = wanted
  const left = settle(wanted.left, [TOOLBAR_MARGIN, (viewport.width - width) / 2, viewport.width - width - TOOLBAR_MARGIN])
  const top = settle(wanted.top, [TOOLBAR_MARGIN, viewport.height - height - TOOLBAR_MARGIN])
  return onScreen({ left, top, width, height }, viewport)
}

export function restToolbar(box: Rect, viewport: Size): ToolbarPosition {
  const fromLeft = box.left
  const fromRight = viewport.width - box.left - box.width
  const fromCenter = box.left + box.width / 2 - viewport.width / 2
  const nearest = Math.min(fromLeft, fromRight, Math.abs(fromCenter))
  const fromTop = box.top
  const fromBottom = viewport.height - box.top - box.height
  return {
    ...(nearest === Math.abs(fromCenter) ? { horizontal: 'center', x: fromCenter } : nearest === fromLeft ? { horizontal: 'left', x: fromLeft } : { horizontal: 'right', x: fromRight }),
    ...(fromTop < fromBottom ? { vertical: 'top', y: fromTop } : { vertical: 'bottom', y: fromBottom }),
  }
}

function settle(value: number, lines: readonly number[]): number {
  const nearest = lines.reduce((best, line) => (Math.abs(line - value) < Math.abs(best - value) ? line : best))
  return Math.abs(nearest - value) <= SNAP_DISTANCE ? nearest : value
}

function onScreen(box: Rect, viewport: Size): Rect {
  return { ...box, left: clamp(box.left, TOOLBAR_MARGIN, viewport.width - box.width - TOOLBAR_MARGIN), top: clamp(box.top, TOOLBAR_MARGIN, viewport.height - box.height - TOOLBAR_MARGIN) }
}
