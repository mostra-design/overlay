import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPicker, narrower, nextNavigable, wider, type Picker } from '../src/picker'

let picker: Picker | null = null
const hovered: Element[] = []
const picks: Array<{ element: Element; stay: boolean }> = []
let pageHandler = vi.fn()

function start(options: { isOwn?: (event: Event) => boolean; shieldTarget?: (event: Event) => Element | null } = {}) {
  picker = createPicker({
    window,
    isOwn: options.isOwn ?? (() => false),
    shieldTarget: options.shieldTarget ?? (() => null),
    onHover: (element) => hovered.push(element),
    onPick: (element, _point, stay) => picks.push({ element, stay }),
  })
}

function pointer(type: string, target: Element, init: { x?: number; y?: number; id?: number; pointerType?: string; shiftKey?: boolean } = {}) {
  const event = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: init.x ?? 10,
    clientY: init.y ?? 10,
    pointerId: init.id ?? 1,
    pointerType: init.pointerType ?? 'mouse',
    shiftKey: init.shiftKey ?? false,
  })
  target.dispatchEvent(event)
  return event
}

function mouse(type: string, target: Element) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, composed: true })
  target.dispatchEvent(event)
  return event
}

let button: HTMLButtonElement

beforeEach(() => {
  document.body.innerHTML = '<main><section id="plans"><button id="cta"><span id="label">Choose Pro</span></button></section></main>'
  button = document.querySelector('#cta')!
  pageHandler = vi.fn()
  for (const type of ['pointerdown', 'pointerup', 'pointermove', 'mousedown', 'mouseup', 'mouseover', 'mouseout', 'click', 'contextmenu', 'dblclick']) {
    document.addEventListener(type, pageHandler)
    button.addEventListener(type, pageHandler)
  }
  hovered.length = 0
  picks.length = 0
})

afterEach(async () => {
  picker?.stop()
  picker = null
  document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await new Promise((resolve) => setTimeout(resolve, 0))
  document.body.innerHTML = ''
})

describe('createPicker', () => {
  it('stops pointer, mouse, click and context-menu events before the page sees them', () => {
    start()
    for (const type of ['pointerdown', 'pointermove', 'pointerup']) pointer(type, button)
    for (const type of ['mousedown', 'mouseup', 'mouseover', 'mouseout', 'click', 'dblclick', 'contextmenu']) mouse(type, button)
    expect(pageHandler).not.toHaveBeenCalled()
  })

  it('prevents the default only on mousedown and click', () => {
    start()
    expect(mouse('mousedown', button).defaultPrevented).toBe(true)
    expect(mouse('click', button).defaultPrevented).toBe(true)
    expect(mouse('mouseup', button).defaultPrevented).toBe(false)
    expect(pointer('pointerdown', button).defaultPrevented).toBe(false)
  })

  it('never cancels touchstart, so the page still scrolls', () => {
    start()
    const touch = new Event('touchstart', { bubbles: true, cancelable: true })
    button.dispatchEvent(touch)
    expect(touch.defaultPrevented).toBe(false)
  })

  it('picks on a pointerup under 10px from the press, with composedPath()[0] as the target', () => {
    start()
    const label = document.querySelector('#label')!
    pointer('pointerdown', label, { x: 100, y: 100 })
    pointer('pointerup', label, { x: 106, y: 104 })
    expect(picks).toEqual([{ element: label, stay: false }])
  })

  it('treats a move of 10px or more as a scroll or drag, not a pick', () => {
    start()
    pointer('pointerdown', button, { x: 100, y: 100 })
    pointer('pointermove', button, { x: 100, y: 112, pointerType: 'touch' })
    pointer('pointerup', button, { x: 100, y: 112 })
    expect(picks).toEqual([])
  })

  it('drops the press on pointercancel', () => {
    start()
    pointer('pointerdown', button, { pointerType: 'touch' })
    pointer('pointercancel', button, { pointerType: 'touch' })
    pointer('pointerup', button, { pointerType: 'touch' })
    expect(picks).toEqual([])
  })

  it('keeps comment mode with Shift', () => {
    start()
    pointer('pointerdown', button)
    pointer('pointerup', button, { shiftKey: true })
    expect(picks[0]?.stay).toBe(true)
  })

  it('reports hover for mouse and pen, never for touch', () => {
    start()
    pointer('pointermove', button, { pointerType: 'mouse' })
    pointer('pointermove', button, { pointerType: 'touch' })
    expect(hovered).toEqual([button])
  })

  it('leaves events inside the overlay alone', () => {
    start({ isOwn: () => true })
    pointer('pointerdown', button)
    pointer('pointerup', button)
    mouse('click', button)
    expect(pageHandler).toHaveBeenCalled()
    expect(picks).toEqual([])
  })

  it('maps a shield over an iframe to the iframe', () => {
    const frame = document.createElement('iframe')
    start({ isOwn: () => true, shieldTarget: () => frame })
    pointer('pointerdown', button)
    pointer('pointerup', button)
    expect(picks[0]?.element).toBe(frame)
  })

  it('keeps swallowing the click that follows a pick after comment mode ends', () => {
    start()
    pointer('pointerdown', button)
    pointer('pointerup', button)
    picker!.stop()
    mouse('mouseup', button)
    const click = mouse('click', button)
    expect(click.defaultPrevented).toBe(true)
    expect(pageHandler).not.toHaveBeenCalled()
  })

  it("lets the next click through when the pick's own click came before comment mode ended", () => {
    start()
    pointer('pointerdown', button)
    pointer('pointerup', button)
    mouse('mouseup', button)
    mouse('click', button)
    picker!.stop()
    expect(pageHandler).not.toHaveBeenCalled()
    mouse('click', button)
    expect(pageHandler).toHaveBeenCalled()
  })

  it('lets everything through once stopped without a pick', () => {
    start()
    picker!.stop()
    mouse('click', button)
    expect(pageHandler).toHaveBeenCalled()
  })
})

describe('walking elements', () => {
  it('goes wider to the parent and back narrower the same way', () => {
    const label = document.querySelector('#label')!
    const section = document.querySelector('#plans')!
    expect(wider(label)).toBe(button)
    expect(wider(button)).toBe(section)
    expect(narrower(section, [label, button])).toBe(button)
    expect(narrower(button, [label])).toBe(label)
  })

  it('stops below body', () => {
    expect(wider(document.querySelector('main')!)).toBeNull()
  })

  it('tabs through focusable elements, headings and landmarks in document order', () => {
    document.body.innerHTML = '<nav id="nav"><a href="#">Home</a></nav><main><h1 id="title">Pricing</h1><button id="go">Go</button></main>'
    for (const element of document.querySelectorAll('*')) {
      Object.defineProperty(element, 'getClientRects', { value: () => [{ width: 1, height: 1 }] })
    }
    const order = ['nav', 'a', 'main', 'h1', 'button'].map((selector) => document.querySelector(selector))
    expect(nextNavigable(document, null, 1, () => false)).toBe(order[0])
    expect(nextNavigable(document, order[0]!, 1, () => false)).toBe(order[1])
    expect(nextNavigable(document, order[3]!, 1, () => false)).toBe(order[4])
    expect(nextNavigable(document, order[0]!, -1, () => false)).toBe(order[4])
  })
})
