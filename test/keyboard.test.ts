import { describe, expect, it } from 'vitest'
import { isEditable, keyAction, type KeyContext, type KeyPress } from '../src/keyboard'

const idle: KeyContext = { editing: false, singleKeys: true, commenting: false, stepping: false, selection: false, open: false, talk: true }

function press(key: string, overrides: Partial<KeyPress> = {}): KeyPress {
  const code = /^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : key
  return { key, code, altKey: false, shiftKey: false, metaKey: false, ctrlKey: false, defaultPrevented: false, isComposing: false, repeat: false, ...overrides }
}

describe('keyAction (ux.md 8)', () => {
  it('T talks, only where talking exists', () => {
    expect(keyAction(press('t'), idle)).toBe('talk')
    expect(keyAction(press('t'), { ...idle, talk: false })).toBeNull()
    expect(keyAction(press('t'), { ...idle, editing: true })).toBeNull()
  })

  it('maps the single keys', () => {
    expect(keyAction(press('c'), idle)).toBe('comment')
    expect(keyAction(press('l'), idle)).toBe('list')
    expect(keyAction(press('h'), idle)).toBe('hide')
    expect(keyAction(press('?', { shiftKey: true, code: 'Slash' }), idle)).toBe('shortcuts')
  })

  it('comments on the selection when text is selected', () => {
    expect(keyAction(press('c'), { ...idle, selection: true })).toBe('comment-selection')
  })

  it('steps with J and K only while the card, the list or a stepper is open', () => {
    expect(keyAction(press('j'), idle)).toBeNull()
    expect(keyAction(press('j'), { ...idle, stepping: true })).toBe('next')
    expect(keyAction(press('k'), { ...idle, stepping: true })).toBe('previous')
  })

  it('never fires single keys in a field, when the host handled the key, or with shortcuts off (WCAG 2.1.4)', () => {
    expect(keyAction(press('c'), { ...idle, editing: true })).toBeNull()
    expect(keyAction(press('c', { defaultPrevented: true }), idle)).toBeNull()
    expect(keyAction(press('c'), { ...idle, singleKeys: false })).toBeNull()
    expect(keyAction(press('c', { metaKey: true }), idle)).toBeNull()
    expect(keyAction(press('c', { ctrlKey: true }), idle)).toBeNull()
    expect(keyAction(press('C', { shiftKey: true }), idle)).toBeNull()
    expect(keyAction(press('c', { repeat: true }), idle)).toBeNull()
    expect(keyAction(press('c', { isComposing: true }), idle)).toBeNull()
  })

  it('reads the key position on non-Latin layouts', () => {
    expect(keyAction(press('с', { code: 'KeyC' }), idle)).toBe('comment')
  })

  it('moves focus to the toolbar with Alt+Shift+M, always, even in a field', () => {
    expect(keyAction(press('Â', { code: 'KeyM', altKey: true, shiftKey: true }), { ...idle, editing: true, singleKeys: false })).toBe('focus-toolbar')
  })

  it('consumes Esc only when something is open', () => {
    expect(keyAction(press('Escape'), idle)).toBeNull()
    expect(keyAction(press('Escape'), { ...idle, open: true })).toBe('back')
    expect(keyAction(press('Escape'), { ...idle, open: true, editing: true })).toBe('back')
    expect(keyAction(press('Escape', { defaultPrevented: true }), { ...idle, open: true })).toBeNull()
  })

  it('walks and picks elements in comment mode, even with single keys off', () => {
    const commenting = { ...idle, commenting: true, open: true, singleKeys: false }
    expect(keyAction(press('ArrowUp'), commenting)).toBe('wider')
    expect(keyAction(press('ArrowDown'), commenting)).toBe('narrower')
    expect(keyAction(press('Enter'), commenting)).toBe('pick')
    expect(keyAction(press('Tab'), commenting)).toBe('focus-next')
    expect(keyAction(press('Tab', { shiftKey: true }), commenting)).toBe('focus-previous')
    expect(keyAction(press('ArrowUp'), idle)).toBeNull()
    expect(keyAction(press('Tab'), idle)).toBeNull()
  })

  it('has no destructive single key', () => {
    for (const key of ['Delete', 'Backspace', 'd', 'x']) expect(keyAction(press(key), { ...idle, stepping: true, open: true })).toBeNull()
  })
})

describe('isEditable', () => {
  it('knows text fields from buttons', () => {
    const input = document.createElement('input')
    const checkbox = Object.assign(document.createElement('input'), { type: 'checkbox' })
    const editable = document.createElement('div')
    editable.contentEditable = 'true'
    document.body.append(input, checkbox, editable)
    expect(isEditable(input)).toBe(true)
    expect(isEditable(document.createElement('textarea'))).toBe(true)
    expect(isEditable(checkbox)).toBe(false)
    expect(isEditable(document.createElement('button'))).toBe(false)
    expect(isEditable(null)).toBe(false)
    document.body.innerHTML = ''
  })
})
