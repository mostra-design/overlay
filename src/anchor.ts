import { captureSpec, captureState } from './capture'
import type { Anchor, Selector } from './protocol'

const TEST_ID_ATTRIBUTES = ['data-testid', 'data-test', 'data-mostra-id']
const MASK_ATTRIBUTE = 'data-mostra-mask'
export const MASKED = '[masked]'
const TEXT_SELECTOR_MAX_LENGTH = 80
const ELEMENT_TEXT_MAX_LENGTH = 120
const LABEL_MAX_LENGTH = 40
export const QUOTE_CONTEXT_LENGTH = 32
const MIN_PATH_SEGMENTS = 2
const CSS_PATH_MAX_BYTES = 1024
const DOCUMENT_FRAGMENT = 11
let parentElementGetter: (() => unknown) | undefined
const HEADINGS = 'h1, h2, h3, h4, h5, h6, [role="heading"], legend'
const SECTION_DEPTH = 6
const EDITABLE = '[contenteditable]:not([contenteditable="false"])'
const CODE_EDITORS = '.monaco-editor, .CodeMirror, .ace_editor'
export const TYPED_TEXT = `textarea, ${EDITABLE}, [role="textbox"], [role="searchbox"], ${CODE_EDITORS}`
const SKIPPED_TEXT = `script, style, noscript, template, ${TYPED_TEXT}`
const CSS_IDENT = String.raw`(?:[\w-]|[^\x00-\x7f]|\\[0-9a-fA-F]{1,6}(?![0-9a-fA-F]) ?|\\[^0-9a-fA-F\n\r\f])+`
const CSS_VALUE = String.raw`"(?:[^"\\\n\r\f]|\\[^\n\r\f])*"`
const CSS_PATH_PIECE = String.raw`(?:\.${CSS_IDENT}|#${CSS_IDENT}|\[data-[\w-]+=${CSS_VALUE}\]|:nth-of-type\(\d{1,9}\))`
const CSS_PATH_PART = `(?:${CSS_IDENT}${CSS_PATH_PIECE}*|${CSS_PATH_PIECE}+)`
const CSS_PATH = new RegExp(`^${CSS_PATH_PART}(?: > ${CSS_PATH_PART})*$`)
const STATE_CLASS = /^(is|has)-|^(active|selected|hover|hovered|focus|focused|open|opened|closed|show|shown|hidden|visible|disabled|current|checked|expanded|collapsed|loading|loaded)$/
const LIBRARY_PREFIX = /^(css|sc|jsx|svelte|astro|emotion|radix|headlessui|react-aria|mui|ng|tw)-|^ember\d|^_r_/i
const TEXT_TAGS = new Set(['p', 'span', 'li', 'td', 'th', 'label', 'strong', 'em', 'b', 'i', 'u', 's', 'small', 'blockquote', 'dd', 'dt', 'figcaption', 'code', 'pre', 'caption', 'q', 'cite', 'mark', 'time', 'abbr', 'sup', 'sub', 'legend', 'del', 'ins', 'kbd', 'samp', 'var', 'address'])
const TEXT_ROLES = new Set(['listitem', 'cell', 'gridcell', 'rowheader', 'columnheader', 'paragraph', 'row', 'term', 'definition', 'note', 'status', 'generic'])
const BLOCK_TAGS = new Set(['p', 'div', 'li', 'td', 'th', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'section', 'article', 'aside', 'main', 'header', 'footer', 'nav', 'blockquote', 'dd', 'dt', 'figcaption', 'pre', 'form', 'fieldset', 'body', 'table', 'ul', 'ol', 'dialog', 'details', 'summary', 'figure'])

const ICON_MAX_SIZE = 64
const NOUNS: Record<string, string> = {
  button: 'button',
  link: 'link',
  heading: 'heading',
  img: 'image',
  image: 'image',
  graphics: 'icon',
  textbox: 'field',
  searchbox: 'field',
  spinbutton: 'field',
  combobox: 'dropdown',
  listbox: 'dropdown',
  checkbox: 'checkbox',
  radio: 'radio button',
  switch: 'switch',
  slider: 'slider',
  option: 'option',
  tab: 'tab',
  menuitem: 'menu item',
  menuitemcheckbox: 'menu item',
  menuitemradio: 'menu item',
  dialog: 'dialog',
  alertdialog: 'dialog',
  navigation: 'navigation',
  form: 'form',
  region: 'section',
  banner: 'header',
  contentinfo: 'footer',
  frame: 'frame',
  main: 'main content',
  list: 'list',
  table: 'table',
  grid: 'table',
  menu: 'menu',
  menubar: 'menu',
  tablist: 'tabs',
  tooltip: 'tooltip',
}
const NAME_FROM_CONTENT = new Set(['button', 'link', 'heading', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'switch', 'tooltip'])
const FORM_FIELDS = new Set(['textbox', 'searchbox', 'spinbutton', 'combobox', 'listbox', 'checkbox', 'radio', 'slider', 'switch'])
const NAMED_BY_HEADING = new Set(['region', 'navigation', 'form', 'dialog', 'alertdialog', 'list', 'menu', 'tablist'])
const NAMED_BY_LABEL_ONLY = new Set(['banner', 'contentinfo', 'main'])

export function createAnchor(element: Element, point: { x: number; y: number } | null): Anchor {
  const view = element.ownerDocument.defaultView
  const box = element.getBoundingClientRect()
  return {
    selectors: elementSelectors(element),
    offset: point ? { x: ratio(point.x - box.left, box.width), y: ratio(point.y - box.top, box.height) } : { x: 0, y: 0 },
    rect: {
      x: Math.round(box.left + (view?.scrollX ?? 0)),
      y: Math.round(box.top + (view?.scrollY ?? 0)),
      width: Math.round(box.width),
      height: Math.round(box.height),
    },
    element_text: elementText(element),
    label: describeElement(element),
    state: captureState(element),
    spec: captureSpec(element),
  }
}

export function createSelectionAnchor(range: Range): Anchor {
  const container = range.commonAncestorContainer
  const element = anchorTarget(isElement(container) ? container : (container.parentElement ?? container.ownerDocument!.body))
  const anchor = createAnchor(element, null)
  const exact = rangeText(range, element)
  const first = range.getClientRects()[0] ?? range.getBoundingClientRect()
  const box = element.getBoundingClientRect()
  const block = blockAround(element)
  const document = element.ownerDocument

  const before = document.createRange()
  before.setStart(block, 0)
  before.setEnd(range.startContainer, range.startOffset)
  const after = document.createRange()
  after.setStart(range.endContainer, range.endOffset)
  after.setEnd(block, block.childNodes.length)

  return {
    ...anchor,
    offset: first ? { x: ratio(first.left - box.left, box.width), y: ratio(first.top - box.top, box.height) } : { x: 0, y: 0 },
    label: `"${shorten(exact)}"`,
    text_quote: {
      exact,
      prefix: rangeText(before, block).slice(-QUOTE_CONTEXT_LENGTH).trimStart(),
      suffix: rangeText(after, block).slice(0, QUOTE_CONTEXT_LENGTH).trimEnd(),
    },
  }
}

export function elementSelectors(element: Element): Selector[] {
  const document = element.ownerDocument
  const selectors: Selector[] = []

  const testId = testIdOf(element)
  if (testId && isUnique(document, testIdQuery(testId))) selectors.push({ type: 'testid', value: testId })

  if (element.id && isStableToken(element.id) && isUnique(document, idQuery(element.id))) {
    selectors.push({ type: 'id', value: element.id })
  }

  selectors.push({ type: 'css', value: cssPath(element) })

  const text = isMasked(element) ? '' : elementTextContent(element)
  if (text && text.length <= TEXT_SELECTOR_MAX_LENGTH) selectors.push({ type: 'text', tag: element.localName, value: text })
  return selectors
}

export function anchorTarget(element: Element): Element {
  let target = element
  for (let svg = target.closest('svg'); svg; svg = parentOf(svg)?.closest('svg') ?? null) target = svg
  if (target.localName === 'svg') {
    const control = target.parentElement?.closest('a, button, [role="button"], label, summary')
    if (control && control.contains(target) && depthBetween(control, target) <= 2) return control
  }
  return target
}

export function isRendered(element: Element): boolean {
  return element.getClientRects().length > 0
}

export function isMasked(node: Node): boolean {
  for (let current = isElement(node) ? node : around(node); current; current = hostOf(current)) {
    if (current.closest(`[${MASK_ATTRIBUTE}], ${TYPED_TEXT}`)) return true
  }
  return false
}

function around(node: Node): Element | null {
  return node.parentElement ?? hostOf(node)
}

function hostOf(node: Node): Element | null {
  const root = node.getRootNode()
  return root.nodeType === DOCUMENT_FRAGMENT ? ((root as ShadowRoot).host ?? null) : null
}

export function parentOf(node: Node): Element | null {
  parentElementGetter ??= Object.getOwnPropertyDescriptor(Node.prototype, 'parentElement')!.get!
  return parentElementGetter.call(node) as Element | null
}

function isNameMasked(element: Element): boolean {
  if (!element.matches(TYPED_TEXT) || element.hasAttribute(MASK_ATTRIBUTE)) return isMasked(element)
  const holder = around(element)
  return holder ? isMasked(holder) : false
}

export function elementText(element: Element): string {
  if (isMasked(element)) return MASKED
  const plain = isHtmlElement(element) && typeof element.innerText === 'string' && !element.querySelector(`[${MASK_ATTRIBUTE}], ${SKIPPED_TEXT}`)
  return truncate(plain ? collapse((element as HTMLElement).innerText) : elementTextContent(element), ELEMENT_TEXT_MAX_LENGTH)
}

export function elementTextContent(element: Element): string {
  if (isMasked(element)) return MASKED
  if (!element.querySelector(`[${MASK_ATTRIBUTE}], ${SKIPPED_TEXT}`)) return collapse(element.textContent)
  let text = ''
  const visit = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) text += child.nodeValue ?? ''
      else if (isElement(child)) {
        if (child.hasAttribute(MASK_ATTRIBUTE)) text += ` ${MASKED} `
        else if (!child.matches(SKIPPED_TEXT)) visit(child)
      }
    }
  }
  visit(element)
  return collapse(text)
}

export function isElement(node: Node | null | undefined): node is Element {
  return node?.nodeType === 1
}

function isHtmlElement(element: Element): element is HTMLElement {
  return element.namespaceURI === 'http://www.w3.org/1999/xhtml'
}

export function describeElement(element: Element): string {
  const role = roleOf(element)
  const noun = role === 'graphics' && largerThanIcon(element) ? (visibleText(element) ? 'diagram' : 'image') : role ? NOUNS[role] : undefined
  const masked = isNameMasked(element)
  const name = masked ? MASKED : accessibleName(element, role)

  if (!noun) {
    const text = masked ? MASKED : visibleText(element)
    if (!text) return 'Area'
    if (!TEXT_TAGS.has(element.localName) && !(role && TEXT_ROLES.has(role)) && text.length > LABEL_MAX_LENGTH) {
      const heading = element.querySelector('h1, h2, h3, h4, h5, h6, [role="heading"]')
      const title = heading ? visibleText(heading) : ''
      if (title) return `'${shorten(title)}' section`
    }
    return `"${shorten(text)}"`
  }
  return name ? `'${shorten(name)}' ${noun}` : capitalize(noun)
}

function largerThanIcon(element: Element): boolean {
  const { width, height } = element.getBoundingClientRect()
  return Math.max(width, height) > ICON_MAX_SIZE
}

export function sectionName(element: Element): string | null {
  const body = element.ownerDocument.body
  const own = ownLevel(element)
  let current = parentOf(element)
  for (let depth = 0; current && current !== body && depth < SECTION_DEPTH; depth++, current = parentOf(current)) {
    const before = Array.from(current.querySelectorAll(HEADINGS)).filter((heading) => !heading.contains(element) && heading.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING && headingLevel(heading) < own)
    const heading = before.at(-1)
    if (heading) return isMasked(heading) ? MASKED : shorten(visibleText(heading)) || null
  }
  return null
}

function ownLevel(element: Element): number {
  const inside = [...(element.matches(HEADINGS) ? [element] : []), ...element.querySelectorAll(HEADINGS)]
  return Math.min(Infinity, ...inside.map(headingLevel))
}

function headingLevel(heading: Element): number {
  const tag = /^h([1-6])$/.exec(heading.localName)?.[1]
  return Number(tag ?? heading.getAttribute('aria-level') ?? 2)
}

export function cssIdent(value: string): string {
  let result = ''
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    const character = value.charAt(index)
    const isDigit = code >= 0x30 && code <= 0x39
    if (code === 0) {
      result += '\uFFFD'
    } else if ((code >= 0x1 && code <= 0x1f) || code === 0x7f || (index === 0 && isDigit) || (index === 1 && isDigit && value.charCodeAt(0) === 0x2d)) {
      result += `\\${code.toString(16)} `
    } else if (index === 0 && value.length === 1 && code === 0x2d) {
      result += `\\${character}`
    } else if (code >= 0x80 || code === 0x2d || code === 0x5f || isDigit || (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) {
      result += character
    } else {
      result += `\\${character}`
    }
  }
  return result
}

export function testIdQuery(value: string): string {
  return TEST_ID_ATTRIBUTES.map((attribute) => `[${attribute}="${cssString(value)}"]`).join(',')
}

export function idQuery(value: string): string {
  return `[id="${cssString(value)}"]`
}

export function cssString(value: string): string {
  return value.replace(/["\\]/g, '\\$&').replace(/\n/g, '\\a ')
}

export function collapse(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim()
}

function roleOf(element: Element): string | null {
  const explicit = element.getAttribute('role')?.trim().split(/\s+/)[0]
  if (explicit) return explicit.toLowerCase()
  switch (element.localName) {
    case 'button':
    case 'summary':
      return 'button'
    case 'a':
      return element.hasAttribute('href') ? 'link' : null
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6':
      return 'heading'
    case 'img':
      return 'img'
    case 'svg':
      return 'graphics'
    case 'input':
      return inputRole(element.getAttribute('type')?.toLowerCase() ?? 'text')
    case 'iframe':
      return 'frame'
    case 'textarea':
      return 'textbox'
    case 'select':
      return 'combobox'
    case 'option':
      return 'option'
    case 'nav':
      return 'navigation'
    case 'form':
      return 'form'
    case 'section':
    case 'article':
    case 'aside':
      return 'region'
    case 'header':
      return 'banner'
    case 'footer':
      return 'contentinfo'
    case 'main':
      return 'main'
    case 'ul':
    case 'ol':
      return 'list'
    case 'table':
      return 'table'
    case 'dialog':
      return 'dialog'
    default:
      return element.matches(EDITABLE) ? 'textbox' : null
  }
}

function inputRole(type: string): string | null {
  if (['button', 'submit', 'reset', 'image'].includes(type)) return 'button'
  if (type === 'checkbox') return 'checkbox'
  if (type === 'radio') return 'radio'
  if (type === 'range') return 'slider'
  if (type === 'hidden') return null
  return 'textbox'
}

function accessibleName(element: Element, role: string | null): string {
  const label = collapse(element.getAttribute('aria-label'))
  if (label) return label
  const labelledBy = labelledByText(element)
  if (labelledBy) return labelledBy

  if (element.localName === 'input' && role === 'button') {
    const type = element.getAttribute('type')?.toLowerCase()
    const printed = collapse(type === 'image' ? element.getAttribute('alt') : element.getAttribute('value'))
    return printed || (type === 'submit' ? 'Submit' : type === 'reset' ? 'Reset' : '')
  }
  if (role === 'img' || role === 'image') return collapse(element.getAttribute('alt')) || collapse(element.getAttribute('title'))
  if (role === 'frame') return collapse(element.getAttribute('title'))
  if (role === 'graphics') {
    const title = Array.from(element.children).find((child) => child.localName === 'title')
    return collapse(title?.textContent) || collapse(element.getAttribute('title'))
  }
  if (role && FORM_FIELDS.has(role) && (isFormControl(element) || element.matches(TYPED_TEXT))) {
    return fieldLabel(element) || collapse(element.getAttribute('placeholder')) || collapse(element.getAttribute('title'))
  }
  if (role === 'table') {
    const caption = element.querySelector('caption')
    if (caption) return visibleText(caption)
  }
  if (role && NAMED_BY_LABEL_ONLY.has(role)) return ''
  if (role && NAMED_BY_HEADING.has(role)) {
    const heading = element.querySelector('h1, h2, h3, h4, h5, h6, [role="heading"]')
    return heading ? visibleText(heading) : ''
  }
  if (role && (NAME_FROM_CONTENT.has(role) || FORM_FIELDS.has(role))) {
    const text = visibleText(element)
    if (text) return text
    const image = element.querySelector('img[alt]')
    return collapse(element.getAttribute('title')) || collapse(image?.getAttribute('alt'))
  }
  return collapse(element.getAttribute('title'))
}

function isFormControl(element: Element): boolean {
  return ['input', 'select', 'textarea'].includes(element.localName)
}

function fieldLabel(element: Element): string {
  const labels = (element as HTMLInputElement).labels
  const found = labels && labels.length > 0 ? Array.from(labels) : []
  if (found.length === 0) {
    if (element.id) {
      const byFor = element.ownerDocument.querySelector(`label[for="${cssString(element.id)}"]`)
      if (byFor) found.push(byFor as HTMLLabelElement)
    }
    const wrapping = element.closest('label')
    if (wrapping && !found.includes(wrapping)) found.push(wrapping)
  }
  return collapse(found.map((label) => visibleText(label)).join(' '))
}

function labelledByText(element: Element): string {
  const ids = element.getAttribute('aria-labelledby')?.trim().split(/\s+/) ?? []
  const document = element.ownerDocument
  return collapse(
    ids
      .map((id) => document.getElementById(id))
      .filter((labelling): labelling is HTMLElement => labelling !== null)
      .map((labelling) => (isMasked(labelling) ? MASKED : elementTextContent(labelling)))
      .join(' '),
  )
}

function visibleText(element: Element): string {
  if (isMasked(element)) return MASKED
  const plain = isHtmlElement(element) && typeof element.innerText === 'string' && !element.querySelector(`[${MASK_ATTRIBUTE}], ${SKIPPED_TEXT}`)
  return plain ? collapse((element as HTMLElement).innerText) : elementTextContent(element)
}

function rangeText(range: Range, holder: Element): string {
  if (isMasked(holder) || isMasked(range.commonAncestorContainer)) return MASKED
  const fragment = range.cloneContents()
  for (const masked of Array.from(fragment.querySelectorAll(`[${MASK_ATTRIBUTE}]`))) masked.replaceWith(` ${MASKED} `)
  for (const skipped of Array.from(fragment.querySelectorAll(SKIPPED_TEXT))) skipped.remove()
  const start = range.startContainer
  if (start.nodeType === 3 && isMasked(start)) return MASKED
  return collapse(fragment.textContent)
}

function blockAround(element: Element): Element {
  for (let current: Element | null = element; current; current = parentOf(current)) {
    if (BLOCK_TAGS.has(current.localName)) return current
  }
  return element.ownerDocument.body
}

function cssPath(element: Element): string {
  const document = element.ownerDocument
  const segments: string[] = []
  for (let current: Element | null = element; current && current !== document.documentElement; current = parentOf(current)) {
    const boundary = current === element ? null : uniqueAncestorSelector(current)
    if (boundary) {
      segments.unshift(boundary)
      break
    }
    segments.unshift(pathSegment(current))
    if (current === document.body) break
  }

  for (let length = Math.min(MIN_PATH_SEGMENTS, segments.length); length < segments.length; length++) {
    const selector = segments.slice(-length).join(' > ')
    if (byteLength(selector) > CSS_PATH_MAX_BYTES) break
    if (pointsOnlyAt(document, selector, element)) return selector
  }
  while (segments.length > 0 && byteLength(segments.join(' > ')) > CSS_PATH_MAX_BYTES) segments.shift()
  return segments.join(' > ') || 'body'
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length
}

export function isCssPath(selector: unknown): boolean {
  return typeof selector === 'string' && byteLength(selector) <= CSS_PATH_MAX_BYTES && CSS_PATH.test(selector)
}

function pathSegment(element: Element): string {
  const tag = cssIdent(element.localName)
  const parent = element.parentElement
  if (!parent) return tag
  const sameTag = Array.from(parent.children).filter((sibling) => sibling.localName === element.localName)
  if (sameTag.length === 1) return tag
  for (const className of stableClasses(element)) {
    if (sameTag.filter((sibling) => sibling.classList.contains(className)).length === 1) return `${tag}.${cssIdent(className)}`
  }
  return `${tag}:nth-of-type(${sameTag.indexOf(element) + 1})`
}

function uniqueAncestorSelector(element: Element): string | null {
  const document = element.ownerDocument
  if (element.id && isStableToken(element.id) && isUnique(document, idQuery(element.id))) return `#${cssIdent(element.id)}`
  for (const attribute of TEST_ID_ATTRIBUTES) {
    const value = element.getAttribute(attribute)
    const selector = `[${attribute}="${cssString(value ?? '')}"]`
    if (value && isUnique(document, selector)) return selector
  }
  return null
}

function stableClasses(element: Element): string[] {
  return Array.from(element.classList).filter((className) => isStableToken(className) && !STATE_CLASS.test(className))
}

function isStableToken(token: string): boolean {
  if (token.length > 40 || /[^\w-]/.test(token) || LIBRARY_PREFIX.test(token)) return false
  return token.split(/[-_]+/).every((part) => !isHashLike(part))
}

function isHashLike(part: string): boolean {
  if (part.length >= 5 && /\d/.test(part) && /[a-z]/i.test(part)) return true
  return part.length >= 5 && part.length <= 8 && /^[a-z]*[A-Z][a-z]*[A-Z]/.test(part) && /[a-z]/.test(part)
}

function testIdOf(element: Element): string | null {
  for (const attribute of TEST_ID_ATTRIBUTES) {
    const value = element.getAttribute(attribute)
    if (value) return value
  }
  return null
}

function isUnique(document: Document, selector: string): boolean {
  try {
    return document.querySelectorAll(selector).length === 1
  } catch {
    return false
  }
}

function pointsOnlyAt(document: Document, selector: string, element: Element): boolean {
  try {
    const matches = document.querySelectorAll(selector)
    return matches.length === 1 && matches[0] === element
  } catch {
    return false
  }
}

function depthBetween(ancestor: Element, descendant: Element): number {
  let depth = 0
  for (let current: Element | null = descendant; current && current !== ancestor; current = parentOf(current)) depth++
  return depth
}

function shorten(text: string): string {
  if (text.length <= LABEL_MAX_LENGTH) return text
  const cut = text.slice(0, LABEL_MAX_LENGTH + 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > LABEL_MAX_LENGTH / 2 ? cut.slice(0, space) : cut.slice(0, LABEL_MAX_LENGTH)).trimEnd()}…`
}

function capitalize(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`
}

function truncate(text: string, length: number): string {
  return text.length > length ? text.slice(0, length).trimEnd() : text
}

function ratio(distance: number, size: number): number {
  if (!(size > 0)) return 0.5
  return Math.round(Math.min(1, Math.max(0, distance / size)) * 10000) / 10000
}
