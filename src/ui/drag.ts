export type DragPoint = { x: number; y: number }

export function followPointer(element: Element, start: PointerEvent, onMove: (point: DragPoint) => void, onEnd: (point: DragPoint) => void): () => void {
  const target = element.ownerDocument.defaultView ?? window
  const pointerId = start.pointerId
  let last: DragPoint = { x: start.clientX, y: start.clientY }

  const mine = (event: PointerEvent) => event.pointerId === pointerId
  const move = (event: PointerEvent) => {
    if (!mine(event)) return
    if (event.pointerType === 'mouse' && event.buttons === 0) return finish()
    last = { x: event.clientX, y: event.clientY }
    onMove(last)
  }
  const release = (event: PointerEvent) => {
    if (!mine(event)) return
    if (event.type === 'pointerup') last = { x: event.clientX, y: event.clientY }
    finish()
  }
  const finish = () => {
    stop()
    onEnd(last)
  }
  const stop = () => {
    target.removeEventListener('pointermove', move, true)
    target.removeEventListener('pointerup', release, true)
    target.removeEventListener('pointercancel', release, true)
    target.removeEventListener('blur', finish)
    element.removeEventListener('lostpointercapture', release as EventListener)
    try {
      element.releasePointerCapture?.(pointerId)
    } catch {
    }
  }

  try {
    element.setPointerCapture?.(pointerId)
  } catch {
  }
  target.addEventListener('pointermove', move, true)
  target.addEventListener('pointerup', release, true)
  target.addEventListener('pointercancel', release, true)
  target.addEventListener('blur', finish)
  element.addEventListener('lostpointercapture', release as EventListener)
  return stop
}
