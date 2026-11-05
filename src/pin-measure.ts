import { aroundDot, dotAfterWords, dotOnText, textLines, type Point, type Rect, type Surroundings } from './placement'

const MEDIA = 'img, picture, video, canvas, svg, iframe, embed, object, audio'
const TEXT_ELEMENTS = 'p, h1, h2, h3, h4, h5, h6, a, button, label, li, td, th, dt, dd, span, strong, em, b, i, small, code, blockquote, figcaption, summary, legend, caption'
const CONTROLS = 'a[href], button, input, select, textarea, summary, [role="button"], [role="link"], img, picture, video, canvas, iframe'
const NOT_TEXT = 'script, style, noscript, template'
const TEXT_COVERAGE = 0.15

export type PageContent = { text: Rect[]; controls: Rect[] }

function textNodes(root: Node, document: Document): Text[] {
  const walker = document.createTreeWalker(root, 4)
  const nodes: Text[] = []
  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    if (node.data.trim() && !node.parentElement?.closest(NOT_TEXT)) nodes.push(node)
  }
  return nodes
}

function textRects(nodes: readonly Text[], document: Document): Rect[] {
  const range = document.createRange()
  return nodes.flatMap((node) => {
    range.selectNodeContents(node)
    return Array.from(range.getClientRects?.() ?? [], (rect) => ({ left: rect.left, top: rect.top, width: rect.width, height: rect.height }))
  })
}

export function readPageContent(document: Document): PageContent {
  const text = document.body ? textRects(textNodes(document.body, document), document) : []
  const controls = Array.from(document.querySelectorAll(CONTROLS), (element) => {
    const { left, top, width, height } = element.getBoundingClientRect()
    return { left, top, width, height }
  }).filter((rect) => rect.width > 0 && rect.height > 0)
  return { text, controls }
}

function ownText(element: Element): boolean {
  return Array.from(element.childNodes).some((node) => node.nodeType === 3 && node.nodeValue?.trim())
}

function coverage(lines: readonly Rect[], box: Rect): number {
  const area = box.width * box.height
  return area > 0 ? lines.reduce((sum, line) => sum + line.width * line.height, 0) / area : 0
}

function isText(element: Element, lines: readonly Rect[], box: Rect): boolean {
  if (lines.length === 0 || element.matches(MEDIA)) return false
  return element.matches(TEXT_ELEMENTS) || ownText(element) || coverage(lines, box) >= TEXT_COVERAGE
}

export type MeasuredPin = { dot: Point; surroundings: Surroundings }

export function measurePin(element: Element, box: Rect, wanted: Point | null, selected: readonly Rect[] | null, page: PageContent, view: Window): MeasuredPin {
  const document = element.ownerDocument
  const lines = textLines(textRects(textNodes(element, document), document))
  const viewportWidth = document.documentElement.clientWidth || view.innerWidth
  const first = selected?.[0]
  const aim = first ? { x: first.left, y: first.top + first.height / 2 } : wanted
  const onText = first !== undefined || wanted === null || isText(element, lines, box)
  const afterWords = selected ? dotAfterWords(selected, [...page.text, ...page.controls], viewportWidth) : null
  const dot = afterWords ?? (onText ? dotOnText(lines, aim, viewportWidth) : null) ?? wanted ?? { x: box.left, y: box.top }
  return { dot, surroundings: aroundDot(dot, page.text, page.controls) }
}
