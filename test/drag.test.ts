import { afterEach, describe, expect, it, vi } from 'vitest'
import { followPointer } from '../src/ui/drag'

const pointer = (type: string, init: { pointerId?: number; x?: number; y?: number; buttons?: number; pointerType?: string } = {}) => {
  const event = new MouseEvent(type, { bubbles: true, composed: true, clientX: init.x ?? 0, clientY: init.y ?? 0, buttons: init.buttons ?? 1 })
  return Object.assign(event, { pointerId: init.pointerId ?? 1, pointerType: init.pointerType ?? 'mouse' }) as unknown as PointerEvent
}

function start() {
  const element = document.createElement('span')
  document.body.appendChild(element)
  const onMove = vi.fn()
  const onEnd = vi.fn()
  followPointer(element, pointer('pointerdown', { x: 10, y: 10 }), onMove, onEnd)
  return { element, onMove, onEnd }
}

describe('followPointer', () => {
  afterEach(() => void (document.body.innerHTML = ''))

  it('hears a release that the overlay stops from leaving the shadow root', () => {
    const { element, onEnd } = start()
    element.addEventListener('pointerup', (event) => event.stopPropagation())
    element.dispatchEvent(pointer('pointerup', { x: 40, y: 50 }))
    expect(onEnd).toHaveBeenCalledTimes(1)
    expect(onEnd).toHaveBeenCalledWith({ x: 40, y: 50 })
  })

  it('follows moves and ends at the last real position when the pointer is cancelled', () => {
    const { onMove, onEnd } = start()
    window.dispatchEvent(pointer('pointermove', { x: 20, y: 30 }))
    expect(onMove).toHaveBeenCalledWith({ x: 20, y: 30 })
    window.dispatchEvent(pointer('pointercancel', { x: 0, y: 0 }))
    expect(onEnd).toHaveBeenCalledWith({ x: 20, y: 30 })
  })

  it.each(['lostpointercapture', 'blur', 'no buttons'])('lets go on %s, and only once', (how) => {
    const { element, onMove, onEnd } = start()
    if (how === 'lostpointercapture') element.dispatchEvent(pointer('lostpointercapture'))
    if (how === 'blur') window.dispatchEvent(new Event('blur'))
    if (how === 'no buttons') window.dispatchEvent(pointer('pointermove', { x: 90, y: 90, buttons: 0 }))
    expect(onEnd).toHaveBeenCalledTimes(1)
    window.dispatchEvent(pointer('pointerup'))
    window.dispatchEvent(pointer('pointermove', { x: 99, y: 99 }))
    expect(onEnd).toHaveBeenCalledTimes(1)
    expect(onMove).not.toHaveBeenCalled()
  })

  it('ignores other pointers', () => {
    const { onMove, onEnd } = start()
    window.dispatchEvent(pointer('pointermove', { pointerId: 2, x: 5, y: 5 }))
    window.dispatchEvent(pointer('pointerup', { pointerId: 2 }))
    expect(onMove).not.toHaveBeenCalled()
    expect(onEnd).not.toHaveBeenCalled()
  })
})
