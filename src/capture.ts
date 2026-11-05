import { cssString, describeElement, elementSelectors, parentOf } from './anchor'
import type { CapturedState, Environment } from './protocol'

export const SPEC_PROPERTIES: readonly string[] = [
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'letter-spacing',
  'color',
  'background-color',
  'padding',
  'margin',
  'gap',
  'border',
  'border-radius',
  'width',
  'height',
  'display',
  'opacity',
  'text-align',
  'text-transform',
]

const SHORTHANDS: Record<string, string[]> = {
  padding: ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'],
  margin: ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'],
  'border-radius': ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius'],
  gap: ['row-gap', 'column-gap'],
  border: ['border-top-width', 'border-top-style', 'border-top-color'],
}

const ANCESTOR_DEPTH = 3
const ARIA_STATES = ['expanded', 'selected', 'checked', 'current'] as const
const OPEN_CONTAINER = '[role="menu"], [role="listbox"], [role="dialog"], [role="alertdialog"], [role="tooltip"], [data-state="open"], dialog[open]'

type OwnState = Omit<CapturedState, 'ancestors' | 'opened_by'>

export function captureSpec(element: Element): Record<string, string> {
  const view = element.ownerDocument.defaultView
  const spec: Record<string, string> = {}
  if (!view) return spec
  let style: CSSStyleDeclaration
  try {
    style = view.getComputedStyle(element)
  } catch {
    return spec
  }
  for (const property of SPEC_PROPERTIES) {
    const value = style.getPropertyValue(property).trim() || shorthand(style, property)
    if (value) spec[property] = value
  }
  return spec
}

export function captureState(element: Element): CapturedState {
  const state: CapturedState = ownState(element)
  const ancestors: NonNullable<CapturedState['ancestors']> = []
  let current = parentOf(element)
  for (let depth = 1; depth <= ANCESTOR_DEPTH && current && current !== current.ownerDocument.body; depth++, current = parentOf(current)) {
    const found = ownState(current)
    if (Object.keys(found).length > 0) ancestors.push({ depth, label: describeElement(current), ...found })
  }
  if (ancestors.length > 0) state.ancestors = ancestors

  const trigger = openedBy(element)
  if (trigger) state.opened_by = elementSelectors(trigger)
  return state
}

export function captureEnvironment(window: Window): Environment {
  const matches = (query: string) => {
    try {
      return window.matchMedia?.(query).matches ?? false
    } catch {
      return false
    }
  }
  return {
    color_scheme: matches('(prefers-color-scheme: dark)') ? 'dark' : 'light',
    pointer: matches('(pointer: coarse)') ? 'coarse' : matches('(pointer: fine)') ? 'fine' : 'none',
    zoom: Math.round((window.visualViewport?.scale ?? 1) * 100) / 100,
    user_agent: window.navigator.userAgent,
  }
}

export function specChanges(then: Record<string, string> | undefined, now: Record<string, string>): Array<{ property: string; then: string; now: string }> {
  if (!then) return []
  const changes: Array<{ property: string; then: string; now: string }> = []
  for (const property of SPEC_PROPERTIES) {
    const before = then[property]
    const after = now[property]
    if (before !== undefined && after !== undefined && before !== after) changes.push({ property, then: before, now: after })
  }
  return changes
}

function ownState(element: Element): OwnState {
  const state: OwnState = {}
  if (matchesSafely(element, ':hover')) state.hover = true
  if (matchesSafely(element, ':focus-visible')) state.focus_visible = true
  if (matchesSafely(element, ':checked') || (element as HTMLInputElement).checked === true) state.checked = true
  if (matchesSafely(element, ':disabled')) state.disabled = true
  for (const name of ARIA_STATES) {
    const value = element.getAttribute(`aria-${name}`)
    if (value !== null) state[`aria_${name}`] = value
  }
  const dataState = element.getAttribute('data-state')
  if (dataState !== null) state.data_state = dataState
  return state
}

function openedBy(element: Element): Element | null {
  const container = openContainer(element)
  if (!container) return null
  const document = element.ownerDocument
  const outside = (candidate: Element | null): Element | null => (candidate && !container.contains(candidate) ? candidate : null)

  if (container.id) {
    const controls = Array.from(document.querySelectorAll(`[aria-controls~="${cssString(container.id)}"]`))
    const found = outside(controls.find((candidate) => candidate.getAttribute('aria-expanded') === 'true') ?? controls[0] ?? null)
    if (found) return found
  }
  const labelledBy = container.getAttribute('aria-labelledby')?.trim().split(/\s+/)[0]
  const labelling = outside(labelledBy ? document.getElementById(labelledBy) : null)
  if (labelling && isTrigger(labelling)) return labelling

  const expanded = Array.from(document.querySelectorAll('[aria-expanded="true"]')).filter((candidate) => !container.contains(candidate))
  const preceding = expanded.filter((candidate) => candidate.compareDocumentPosition(container) & 4)
  return preceding[preceding.length - 1] ?? expanded[0] ?? null
}

function openContainer(element: Element): Element | null {
  for (let current: Element | null = element; current; current = parentOf(current)) {
    if (isTrigger(current)) continue
    if (matchesSafely(current, OPEN_CONTAINER) || (current.hasAttribute('popover') && matchesSafely(current, ':popover-open'))) return current
  }
  return null
}

function isTrigger(element: Element): boolean {
  return element.hasAttribute('aria-expanded') || element.hasAttribute('aria-haspopup')
}

function matchesSafely(element: Element, selector: string): boolean {
  try {
    return element.matches(selector)
  } catch {
    return false
  }
}

function shorthand(style: CSSStyleDeclaration, property: string): string {
  const parts = SHORTHANDS[property]?.map((longhand) => style.getPropertyValue(longhand).trim())
  if (!parts || parts.some((part) => !part)) return ''
  if (property === 'border') return parts.join(' ')
  return parts.every((part) => part === parts[0]) ? (parts[0] ?? '') : parts.join(' ')
}
