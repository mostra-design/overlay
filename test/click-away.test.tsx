import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Controller } from '../src/controller'
import { useClickAway } from '../src/ui/CommentMode'
import { ControllerContext } from '../src/ui/hooks'
import { HOST_TAG } from '../src/ui/mount'

const onClick = vi.fn()
const onPress = vi.fn()
let mode: { stay: boolean } | null = null
let root: HTMLElement
let page: HTMLElement
let own: HTMLElement

function Harness() {
  useClickAway(onClick, onPress)
  return null
}

function press(target: Element, x = 10) {
  target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true, clientX: x, clientY: 10 }))
}

function click(target: Element, x = 10) {
  target.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, clientX: x, clientY: 10 }))
}

beforeEach(() => {
  onClick.mockReset()
  onPress.mockReset()
  mode = null
  document.body.innerHTML = `<button id="page">On the page</button><iframe id="frame"></iframe><${HOST_TAG}><button id="own">In the overlay</button></${HOST_TAG}><div id="root"></div>`
  page = document.querySelector('#page')!
  own = document.querySelector('#own')!
  root = document.querySelector('#root')!
  const controller = { store: { get: () => ({ mode }) } } as unknown as Controller
  act(() => {
    render(
      <ControllerContext.Provider value={controller}>
        <Harness />
      </ControllerContext.Provider>,
      root,
    )
  })
})

afterEach(() => {
  act(() => {
    render(null, root)
  })
})

describe('useClickAway', () => {
  it('reports the press at once and the click when it comes', () => {
    press(page)
    expect(onPress).toHaveBeenCalledTimes(1)
    expect(onClick).not.toHaveBeenCalled()
    click(page)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('does not count a drag as a click', () => {
    press(page, 10)
    click(page, 60)
    expect(onPress).toHaveBeenCalledTimes(1)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('ignores a press in the overlay, even one that ends on the page', () => {
    press(own)
    click(page)
    expect(onPress).not.toHaveBeenCalled()
    expect(onClick).not.toHaveBeenCalled()
  })

  it('ignores a click in the overlay', () => {
    press(page)
    click(own)
    expect(onClick).not.toHaveBeenCalled()
  })

  it("ignores the click of a pick, which arrives after comment mode has ended", () => {
    mode = { stay: false }
    press(page)
    mode = null
    click(page)
    expect(onPress).not.toHaveBeenCalled()
    expect(onClick).not.toHaveBeenCalled()
  })

  it('counts focus leaving for an iframe as a press and a click, since the window sees neither', () => {
    document.querySelector<HTMLElement>('#frame')!.focus()
    window.dispatchEvent(new Event('blur'))
    expect(onPress).toHaveBeenCalledTimes(1)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('does not count switching to another window', () => {
    page.focus()
    window.dispatchEvent(new Event('blur'))
    expect(onClick).not.toHaveBeenCalled()
  })

  it('leaves an iframe to comment mode, where a shield picks it', () => {
    mode = { stay: false }
    document.querySelector<HTMLElement>('#frame')!.focus()
    window.dispatchEvent(new Event('blur'))
    expect(onClick).not.toHaveBeenCalled()
  })
})
