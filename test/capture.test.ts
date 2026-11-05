import { afterEach, describe, expect, it, vi } from 'vitest'
import { captureEnvironment, captureSpec, captureState, SPEC_PROPERTIES, specChanges } from '../src/capture'

function query<Type extends Element = HTMLElement>(selector: string): Type {
  const element = document.querySelector<Type>(selector)
  if (!element) throw new Error(`No element for ${selector}`)
  return element
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('captureState', () => {
  it('records ARIA states and data-state on the element and up to 3 ancestors', () => {
    document.body.innerHTML = `
      <div data-state="active" class="far">
        <div class="tabs">
          <div role="tablist" aria-current="page">
            <div class="wrap">
              <button role="tab" aria-selected="true" data-state="active" disabled>Billing</button>
            </div>
          </div>
        </div>
      </div>`
    const state = captureState(query('button'))

    expect(state).toMatchObject({ aria_selected: 'true', data_state: 'active', disabled: true })
    expect(state.hover).toBeUndefined()
    expect(state.ancestors).toEqual([{ depth: 2, label: 'Tabs', aria_current: 'page' }])
  })

  it('records a checked checkbox without its value', () => {
    document.body.innerHTML = `<label><input type="checkbox" value="secret" checked> Remember me</label>`
    const state = captureState(query('input'))
    expect(state.checked).toBe(true)
    expect(JSON.stringify(state)).not.toContain('secret')
  })

  it('finds the trigger of the open menu holding the element', () => {
    document.body.innerHTML = `
      <button id="account" data-testid="account-menu" aria-haspopup="menu" aria-expanded="true" aria-controls="account-items">Account</button>
      <div id="account-items" role="menu" data-state="open">
        <div role="menuitem">Settings</div>
        <div role="menuitem">Log out</div>
      </div>`
    const state = captureState(query('[role="menuitem"]:last-child'))

    expect(state.opened_by?.[0]).toEqual({ type: 'testid', value: 'account-menu' })
    expect(document.querySelector(`[data-testid="${(state.opened_by?.[0] as { value: string }).value}"]`)).toBe(query('#account'))
  })

  it('falls back to the menu labelled by its trigger, or the nearest expanded control before it', () => {
    document.body.innerHTML = `
      <button id="more" aria-haspopup="true" aria-expanded="true">More</button>
      <ul role="listbox" aria-labelledby="more"><li role="option">Weekly</li></ul>`
    expect(captureState(query('li')).opened_by).toContainEqual({ type: 'id', value: 'more' })

    document.body.innerHTML = `
      <nav><button class="toggle" aria-expanded="true">Menu</button></nav>
      <div data-state="open"><a href="/docs">Docs</a></div>`
    const css = captureState(query('a')).opened_by?.find((selector) => selector.type === 'css')
    expect(document.querySelector((css as { value: string }).value)).toBe(query('.toggle'))
  })

  it('has no opened_by outside a menu, and treats a trigger as a trigger, not a menu', () => {
    document.body.innerHTML = `<button aria-expanded="true" data-state="open">Account</button><p>Text</p>`
    expect(captureState(query('p')).opened_by).toBeUndefined()
    expect(captureState(query('button')).opened_by).toBeUndefined()
  })
})

describe('captureSpec', () => {
  it('keeps only the whitelisted computed styles', () => {
    document.body.innerHTML = `<h1 style="font-size: 48px; color: rgb(17, 17, 16); cursor: pointer; transform: rotate(1deg)">Pricing</h1>`
    const spec = captureSpec(query('h1'))

    expect(spec['font-size']).toBe('48px')
    expect(spec.color).toBe('rgb(17, 17, 16)')
    for (const property of Object.keys(spec)) expect(SPEC_PROPERTIES).toContain(property)
    expect(spec).not.toHaveProperty('cursor')
    expect(spec).not.toHaveProperty('transform')
  })

  it('lists exactly 18 properties', () => {
    expect(SPEC_PROPERTIES).toHaveLength(18)
  })
})

describe('specChanges', () => {
  it('lists changed properties in spec order', () => {
    const then = { 'font-size': '48px', color: 'rgb(0, 0, 0)', 'font-weight': '700', padding: '8px' }
    const now = { color: 'rgb(17, 17, 16)', 'font-size': '40px', 'font-weight': '700', margin: '0px' }

    expect(specChanges(then, now)).toEqual([
      { property: 'font-size', then: '48px', now: '40px' },
      { property: 'color', then: 'rgb(0, 0, 0)', now: 'rgb(17, 17, 16)' },
    ])
    expect(specChanges(undefined, now)).toEqual([])
  })
})

describe('captureEnvironment', () => {
  it('reports color scheme, pointer, zoom and user agent', () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) => ({ matches: query === '(prefers-color-scheme: dark)' || query === '(pointer: coarse)' }) as MediaQueryList,
    )
    const environment = captureEnvironment(window)

    expect(environment).toEqual({ color_scheme: 'dark', pointer: 'coarse', zoom: expect.any(Number), user_agent: window.navigator.userAgent })
  })

  it('falls back to light, no pointer and zoom 1 when nothing matches', () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(() => ({ matches: false }) as MediaQueryList)
    const environment = captureEnvironment(window)
    expect(environment.color_scheme).toBe('light')
    expect(environment.pointer).toBe('none')
    expect(environment.zoom).toBe(1)
  })
})
