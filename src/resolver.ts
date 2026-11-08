import { collapse, elementTextContent, idQuery, isCssPath, isRendered, QUOTE_CONTEXT_LENGTH, testIdQuery } from './anchor'
import type { Anchor, Selector, TextQuote } from './protocol'

export type Resolved = { element: Element; range: Range | null; score: number }

const TEXT_SCAN_LIMIT = 4000
const CANDIDATE_LIMIT = 50
const TEXT_MATCH_MIN = 0.6
const ELEMENT_TEXT_LENGTH = 120
const TEXT_VALUE_LENGTH = 200
const TEXT_LENGTH_REACH = 3
const QUOTE_CANDIDATE_LIMIT = 3
const QUOTE_OCCURRENCE_LIMIT = 200
const SELECTOR_LIMIT = 8

const WEIGHTS = { testid: 6, id: 5, css: 3, text: 3, tag: 1, elementText: 4, quote: 2, distance: 0.5 }
const THRESHOLD_WITH_TEXT = 4
const THRESHOLD_WITHOUT_TEXT = 3
const DISTINCT_TEXT_LENGTH = 12
const NEAR_SHARE = 0.25

type Candidate = { element: Element; score: number; range: Range | null; structural: boolean; distance: number | null }

export function resolveAnchor(anchor: Anchor, document: Document, readText = true): Resolved | null {
  try {
    return bestMatch(anchor, document, readText)
  } catch {
    return null
  }
}

export function readsPageText(anchor: Anchor): boolean {
  return Boolean(anchor.text_quote) || (Array.isArray(anchor.selectors) && anchor.selectors.some((selector) => selector?.type === 'text'))
}

function bestMatch(anchor: Anchor, document: Document, readText: boolean): Resolved | null {
  if (!readText && anchor.text_quote) return null
  const candidates = new Map<Element, Candidate>()
  const vote = (element: Element, points: number, structural: boolean) => {
    const known = candidates.get(element)
    if (known) {
      known.score += points
      known.structural ||= structural
    } else if (candidates.size < CANDIDATE_LIMIT) candidates.set(element, { element, score: points, range: null, structural, distance: null })
  }

  for (const selector of selectorsToTry(anchor.selectors)) {
    if (readText || selector.type !== 'text') for (const [element, points] of proposals(selector, document, anchor)) vote(element, points, selector.type !== 'text')
  }
  if (candidates.size === 0) return null

  const recordedText = truncate(collapse(anchor.element_text), ELEMENT_TEXT_LENGTH)
  const tag = originalTag(anchor.selectors)
  const view = document.defaultView
  const diagonal = Math.hypot(view?.innerWidth ?? 1280, view?.innerHeight ?? 800) || 1
  const center = anchor.rect ? { x: anchor.rect.x + anchor.rect.width / 2, y: anchor.rect.y + anchor.rect.height / 2 } : null

  for (const candidate of candidates.values()) {
    const { element } = candidate
    if (tag && element.localName === tag) candidate.score += WEIGHTS.tag
    if (recordedText) {
      const similarity = textSimilarity(truncate(elementTextContent(element), ELEMENT_TEXT_LENGTH), recordedText)
      candidate.score += WEIGHTS.elementText * similarity - WEIGHTS.elementText / 2
    }
    if (center && isRendered(element)) {
      const box = element.getBoundingClientRect()
      const distance = Math.hypot(box.left + (view?.scrollX ?? 0) + box.width / 2 - center.x, box.top + (view?.scrollY ?? 0) + box.height / 2 - center.y)
      candidate.distance = distance
      candidate.score += WEIGHTS.distance * Math.max(0, 1 - distance / diagonal)
    }
  }

  if (anchor.text_quote) {
    const likeliest = Array.from(candidates.values()).sort((first, second) => second.score - first.score).slice(0, QUOTE_CANDIDATE_LIMIT)
    for (const candidate of likeliest) {
      candidate.range = findTextQuote(anchor.text_quote, candidate.element)
      if (candidate.range) candidate.score += WEIGHTS.quote
    }
  }

  const threshold = recordedText ? THRESHOLD_WITH_TEXT : THRESHOLD_WITHOUT_TEXT
  const distinct = recordedText.length >= DISTINCT_TEXT_LENGTH
  const trusted = (candidate: Candidate) => !center || distinct || candidate.structural || candidate.range !== null || (candidate.distance !== null && candidate.distance <= diagonal * NEAR_SHARE)
  const ranked = Array.from(candidates.values())
    .filter((candidate) => candidate.score >= threshold && trusted(candidate))
    .map((candidate) => ({ candidate, rendered: isRendered(candidate.element) }))
    .sort((first, second) => Number(second.rendered) - Number(first.rendered) || second.candidate.score - first.candidate.score || deeperFirst(first.candidate.element, second.candidate.element))
  const best = ranked[0]?.candidate
  if (!best) return null
  const said = readText ? null : anchor.selectors.find((selector) => selector.type === 'text')
  if (said && !(ranked[0]!.rendered && elementTextContent(best.element) === collapse(said.value))) return null
  return { element: best.element, range: best.range, score: Math.round(best.score * 100) / 100 }
}

export function findTextQuote(quote: TextQuote, root: Element): Range | null {
  const exact = collapse(quote.exact)
  if (!exact || !collapse(root.textContent).includes(exact)) return null
  const { text, positions } = flatten(root)
  const occurrences: number[] = []
  for (let index = text.indexOf(exact); index !== -1 && occurrences.length < QUOTE_OCCURRENCE_LIMIT; index = text.indexOf(exact, index + 1)) occurrences.push(index)
  if (occurrences.length === 0) return null

  let best = occurrences[0]!
  if (occurrences.length > 1) {
    let bestScore = -1
    const prefix = collapse(quote.prefix).slice(-QUOTE_CONTEXT_LENGTH)
    const suffix = collapse(quote.suffix).slice(0, QUOTE_CONTEXT_LENGTH)
    for (const index of occurrences) {
      const before = text.slice(Math.max(0, index - prefix.length - 1), index).trim()
      const after = text.slice(index + exact.length, index + exact.length + suffix.length + 1).trim()
      const score = textSimilarity(before.slice(-prefix.length), prefix) + textSimilarity(after.slice(0, suffix.length), suffix)
      if (score > bestScore) {
        bestScore = score
        best = index
      }
    }
  }

  const start = positions[best]
  const end = positions[best + exact.length - 1]
  if (!start || !end) return null
  const range = root.ownerDocument.createRange()
  range.setStart(start.node, start.offset)
  range.setEnd(end.node, end.offset + 1)
  return range
}

export function textSimilarity(first: string, second: string): number {
  const left = collapse(first).toLowerCase()
  const right = collapse(second).toLowerCase()
  if (left === right) return 1
  if (left.length < 2 || right.length < 2) return 0
  const pairs = new Map<string, number>()
  for (let index = 0; index < left.length - 1; index++) {
    const pair = left.slice(index, index + 2)
    pairs.set(pair, (pairs.get(pair) ?? 0) + 1)
  }
  let shared = 0
  for (let index = 0; index < right.length - 1; index++) {
    const pair = right.slice(index, index + 2)
    const count = pairs.get(pair) ?? 0
    if (count > 0) {
      pairs.set(pair, count - 1)
      shared++
    }
  }
  return (2 * shared) / (left.length - 1 + (right.length - 1))
}

function selectorsToTry(selectors: Selector[]): Selector[] {
  const kinds = new Set<string>()
  return selectors.filter((selector) => selector.type === 'testid' || (!kinds.has(selector.type) && kinds.add(selector.type))).slice(0, SELECTOR_LIMIT)
}

function proposals(selector: Selector, document: Document, anchor: Anchor): Array<[Element, number]> {
  try {
    switch (selector.type) {
      case 'testid':
        return capped(document.querySelectorAll(testIdQuery(selector.value))).map((element) => [element, WEIGHTS.testid])
      case 'id':
        return capped(document.querySelectorAll(idQuery(selector.value))).map((element) => [element, WEIGHTS.id])
      case 'css':
        return isCssPath(selector.value) ? capped(document.querySelectorAll(selector.value)).map((element) => [element, WEIGHTS.css]) : []
      case 'text':
        return textProposals(selector, document, anchor)
      default:
        return []
    }
  } catch {
    return []
  }
}

function textProposals(selector: Extract<Selector, { type: 'text' }>, document: Document, anchor: Anchor): Array<[Element, number]> {
  const value = collapse(selector.value).slice(0, TEXT_VALUE_LENGTH)
  if (!value) return []
  const scanned = Array.from(selector.tag ? document.getElementsByTagName(selector.tag) : (document.body ?? document.documentElement).getElementsByTagName('*')).slice(0, TEXT_SCAN_LIMIT)
  const found: Array<[Element, number]> = []
  const containing: Element[] = []
  const needle = value.toLowerCase()
  for (const element of scanned) {
    const text = elementTextContent(element)
    const inReach = text.length <= value.length * TEXT_LENGTH_REACH && value.length <= text.length * TEXT_LENGTH_REACH
    const similarity = inReach ? textSimilarity(text, value) : 0
    if (similarity >= TEXT_MATCH_MIN) found.push([element, WEIGHTS.text * similarity])
    else if (!selector.tag && !anchor.rect && text.toLowerCase().includes(needle)) containing.push(element)
    if (found.length >= CANDIDATE_LIMIT) break
  }
  if (found.length > 0 || containing.length === 0) return found
  const smallest = containing.filter((element) => !Array.from(element.children).some((child) => elementTextContent(child).toLowerCase().includes(needle)))
  return capped(smallest).map((element) => [element, WEIGHTS.text])
}

function originalTag(selectors: Selector[]): string | null {
  for (const selector of selectors) if (selector.type === 'text' && selector.tag) return selector.tag
  const css = selectors.find((selector) => selector.type === 'css')?.value
  const last = css?.split('>').pop()?.trim()
  return last ? (/^[a-z][a-z0-9-]*/i.exec(last)?.[0]?.toLowerCase() ?? null) : null
}

function flatten(root: Element): { text: string; positions: Array<{ node: Text; offset: number }> } {
  const walker = root.ownerDocument.createTreeWalker(root, 4)
  let text = ''
  const positions: Array<{ node: Text; offset: number }> = []
  let lastWasSpace = true
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    if (node.parentElement?.closest('script, style, noscript, template, textarea')) continue
    const data = node.data
    for (let offset = 0; offset < data.length; offset++) {
      const character = data.charAt(offset)
      if (/\s/.test(character)) {
        if (lastWasSpace) continue
        text += ' '
        lastWasSpace = true
      } else {
        text += character
        lastWasSpace = false
      }
      positions.push({ node, offset })
    }
  }
  return { text, positions }
}

function deeperFirst(first: Element, second: Element): number {
  if (first.contains(second)) return 1
  if (second.contains(first)) return -1
  return 0
}

function capped(elements: ArrayLike<Element>): Element[] {
  return Array.from(elements).slice(0, CANDIDATE_LIMIT)
}

function truncate(text: string, length: number): string {
  return text.length > length ? text.slice(0, length).trimEnd() : text
}
