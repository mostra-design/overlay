export type KeyAction =
  | 'comment'
  | 'comment-selection'
  | 'talk'
  | 'list'
  | 'hide'
  | 'shortcuts'
  | 'next'
  | 'previous'
  | 'focus-toolbar'
  | 'back'
  | 'wider'
  | 'narrower'
  | 'pick'
  | 'focus-next'
  | 'focus-previous'

export type KeyPress = Pick<KeyboardEvent, 'key' | 'code' | 'altKey' | 'shiftKey' | 'metaKey' | 'ctrlKey' | 'defaultPrevented' | 'isComposing' | 'repeat'>

export type KeyContext = {
  editing: boolean
  singleKeys: boolean
  commenting: boolean
  stepping: boolean
  selection: boolean
  open: boolean
  talk: boolean
}

const SINGLE_KEYS: Record<string, KeyAction> = { c: 'comment', t: 'talk', l: 'list', h: 'hide', '?': 'shortcuts', j: 'next', k: 'previous' }

export function keyAction(press: KeyPress, context: KeyContext): KeyAction | null {
  if (press.isComposing) return null
  if (press.altKey && press.shiftKey && !press.metaKey && !press.ctrlKey && press.code === 'KeyM') return 'focus-toolbar'
  if (press.defaultPrevented) return null
  if (press.key === 'Escape') return context.open ? 'back' : null
  if (press.metaKey || press.ctrlKey || press.altKey) return null

  if (context.commenting && !context.editing) {
    if (press.key === 'ArrowUp') return 'wider'
    if (press.key === 'ArrowDown') return 'narrower'
    if (press.key === 'Enter') return 'pick'
    if (press.key === 'Tab') return press.shiftKey ? 'focus-previous' : 'focus-next'
  }

  if (context.editing || !context.singleKeys || press.repeat) return null
  const action = SINGLE_KEYS[singleKey(press)]
  if (!action || (press.shiftKey && action !== 'shortcuts')) return null
  if (action === 'comment' && context.selection) return 'comment-selection'
  if ((action === 'next' || action === 'previous') && !context.stepping) return null
  if (action === 'talk' && !context.talk) return null
  return action
}

function singleKey(press: KeyPress): string {
  const key = press.key.length === 1 ? press.key.toLowerCase() : ''
  if (key === '?' || /^[a-z]$/.test(key)) return key
  return /^Key[A-Z]$/.test(press.code) ? press.code.slice(3).toLowerCase() : key
}

export function isEditable(target: EventTarget | null | undefined): boolean {
  if (!target || typeof (target as Element).tagName !== 'string') return false
  const element = target as HTMLElement
  if (element.isContentEditable) return true
  const tag = element.tagName.toLowerCase()
  if (tag === 'textarea' || tag === 'select') return true
  if (tag !== 'input') return false
  return !['button', 'checkbox', 'radio', 'range', 'reset', 'submit', 'color', 'file', 'image'].includes((element as HTMLInputElement).type)
}
