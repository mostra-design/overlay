import { collapse, describeElement, elementSelectors, elementText, isElement, isMasked, isRendered, MASKED, parentOf, TYPED_TEXT } from './anchor'
import type { Anchor } from './protocol'

export type RegionNode = {
  tag: string
  content: Array<string | number>
  look?: Record<string, string>
  anchor: Pick<Anchor, 'selectors' | 'label' | 'element_text'>
  cut?: true
}

export type Region = { nodes: RegionNode[]; elements: Element[] }

const MAX_NODES = 30
const MAX_TEXT = 1500
const TEXT_LENGTH = 160
const PARTS_ABOVE = 2
const OWN_TAGS = new Set(['section', 'article', 'aside', 'nav', 'header', 'footer', 'main', 'form', 'fieldset', 'dialog', 'details', 'summary', 'figure', 'figcaption', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'caption', 'a', 'button', 'label', 'img', 'svg', 'video', 'audio', 'canvas', 'iframe', 'input', 'select', 'textarea', 'pre', 'code', 'hr'])
const PART_TAGS = new Set(['section', 'article', 'aside', 'nav', 'header', 'footer', 'form', 'fieldset', 'dialog', 'details', 'figure', 'li', 'tr', 'table', 'blockquote'])
const LEAVES = new Set(['img', 'svg', 'video', 'audio', 'canvas', 'iframe', 'input', 'select', 'textarea', 'hr'])
const SKIPPED = new Set(['script', 'style', 'noscript', 'template', 'link', 'meta'])
const HEADINGS = 'h1, h2, h3, h4, h5, h6, [role="heading"]'

export function captureRegion(element: Element, isOwnElement: (element: Element) => boolean): Region | null {
  const view = element.ownerDocument.defaultView
  if (!view) return null
  const box = element.getBoundingClientRect()
  if (box.width * box.height > view.innerWidth * view.innerHeight) return null

  const root = partAround(element)
  if (holdsTypedText(root)) return null
  const above = partsAbove(root).filter((part) => !holdsTypedText(part))
  const path = new Set<Element>()
  for (let current: Element | null = element; current && current !== parentOf(root); current = parentOf(current)) path.add(current)

  const nodes: RegionNode[] = []
  const elements: Element[] = []
  let pending = path.size
  let text = 0
  const style = (target: Element) => view.getComputedStyle(target)

  const add = (target: Element, look: Record<string, string>): number => {
    nodes.push({ tag: target.localName, content: [], ...(Object.keys(look).length > 0 ? { look } : {}), anchor: { selectors: elementSelectors(target), label: describeElement(target), element_text: elementText(target) } })
    elements.push(target)
    if (path.has(target)) pending -= 1
    return nodes.length - 1
  }
  const full = () => text >= MAX_TEXT || nodes.length + pending >= MAX_NODES
  const words = (value: string): string => {
    const left = Math.max(0, Math.min(TEXT_LENGTH, MAX_TEXT - text))
    const kept = value.length > left ? `${value.slice(0, left).trimEnd()}…` : value
    text += kept.length
    return kept
  }

  const visit = (target: Element, context: Look): Array<string | number> | null => {
    if (SKIPPED.has(target.localName) || isOwnElement(target) || !isRendered(target)) return []
    const computed = style(target)
    if (computed.visibility === 'hidden') return []
    const own = lookOf(computed)
    const look = differences(own, context)
    const onPath = path.has(target)
    const isNode = onPath || target === root || OWN_TAGS.has(target.localName) || target.hasAttribute('role') || target.hasAttribute('aria-label') || 'bg' in look || hasFrame(computed)
    if (isNode && !onPath && full()) return null
    const index = isNode ? add(target, look) : null
    const content: Array<string | number> = []
    let cut = false

    if (LEAVES.has(target.localName) || isMasked(target)) {
      if (index !== null && isMasked(target) && !LEAVES.has(target.localName)) content.push(MASKED)
      else if (index !== null) nodes[index]!.look = { ...nodes[index]!.look, name: describeElement(target) }
      if (index !== null && target.localName === 'svg') content.push(words(elementText(target)))
    } else {
      const inner = { ...own, bg: own.bg ?? context.bg }
      const transparent = clear(computed.color)
      for (const child of Array.from(target.childNodes)) {
        if (full() && !(isElement(child) && path.has(child))) {
          cut ||= child.nodeType === 3 ? Boolean(collapse(child.nodeValue)) : isElement(child)
          continue
        }
        if (child.nodeType === 3) {
          const value = transparent ? '' : collapse(child.nodeValue)
          if (value) content.push(words(value))
        } else if (isElement(child)) {
          const added = visit(child, inner)
          if (added === null) cut = true
          else content.push(...added)
        }
      }
    }
    if (index === null) return content
    nodes[index]!.content = merge(content)
    if (cut) nodes[index]!.cut = true
    return [index]
  }

  let parent: number | null = null
  let context = effectiveLook(parentOf(above[0] ?? root) ?? root, view)
  const behind = context.bg
  for (const part of above) {
    const own = lookOf(style(part))
    const index = add(part, { ...differences(own, context), name: describeElement(part) })
    if (parent !== null) nodes[parent]!.content.push(index)
    parent = index
    context = { ...own, bg: own.bg ?? context.bg }
  }
  const inside = visit(root, context) ?? []
  if (parent !== null) nodes[parent]!.content.push(...inside)
  const outermost = nodes[0]
  if (outermost && !outermost.look?.bg && behind && behind !== pageBackground(view)) outermost.look = { ...outermost.look, on: behind }
  return nodes.length > 0 ? { nodes, elements } : null
}

function effectiveLook(element: Element, view: Window): Look {
  const look = lookOf(view.getComputedStyle(element))
  for (let current: Element | null = element; current && !look.bg; current = parentOf(current)) {
    const background = view.getComputedStyle(current).backgroundColor
    if (opaque(background)) look.bg = colorName(background)
  }
  return { ...look, bg: look.bg ?? 'white' }
}

export function backdropOf(node: Node, view: Window): string {
  const element = isElement(node) ? node : node.parentElement
  return (element && effectiveLook(element, view).bg) || 'white'
}

function pageBackground(view: Window): string {
  return effectiveLook(view.document.body, view).bg ?? 'white'
}

function partAround(element: Element): Element {
  const body = element.ownerDocument.body
  for (let current = parentOf(element); current && current !== body; current = parentOf(current)) {
    if (isPart(current)) return current
  }
  return parentOf(element) && parentOf(element) !== body ? parentOf(element)! : element
}

function partsAbove(root: Element): Element[] {
  const body = root.ownerDocument.body
  const found: Element[] = []
  for (let current = parentOf(root); current && current !== body && found.length < PARTS_ABOVE; current = parentOf(current)) {
    if (current.localName !== 'main' && isPart(current)) found.unshift(current)
  }
  return found
}

function holdsTypedText(element: Element): boolean {
  return element.matches(TYPED_TEXT) || element.querySelector(TYPED_TEXT) !== null
}

function isPart(element: Element): boolean {
  if (PART_TAGS.has(element.localName) || element.getAttribute('role') === 'region') return true
  const style = element.ownerDocument.defaultView?.getComputedStyle(element)
  return Boolean(element.querySelector(`:scope > ${HEADINGS.split(', ').join(', :scope > ')}`)) || (style !== undefined && (opaque(style.backgroundColor) || hasFrame(style)))
}

type Look = { bg: string | null; color: string | null; size: number; weight: number }

function lookOf(style: CSSStyleDeclaration): Look {
  return { bg: opaque(style.backgroundColor) ? colorName(style.backgroundColor) : null, color: colorName(style.color), size: Number.parseFloat(style.fontSize) || 16, weight: Number(style.fontWeight) || 400 }
}

function differences(own: Look, context: Look): Record<string, string> {
  const look: Record<string, string> = {}
  if (own.bg && own.bg !== context.bg) look.bg = own.bg
  if (own.color && own.color !== context.color) look.color = own.color
  if (Math.abs(own.size - context.size) >= 2) look.size = `${Math.round(own.size)}px`
  if (own.weight >= 600 && context.weight < 600) look.weight = 'bold'
  return look
}

function hasFrame(style: CSSStyleDeclaration): boolean {
  return (Number.parseFloat(style.borderTopWidth) > 0 && opaque(style.borderTopColor)) || (style.boxShadow !== '' && style.boxShadow !== 'none')
}

function merge(content: Array<string | number>): Array<string | number> {
  const merged: Array<string | number> = []
  for (const item of content) {
    const last = merged.at(-1)
    if (typeof item === 'string' && typeof last === 'string') merged[merged.length - 1] = `${last} ${item}`
    else merged.push(item)
  }
  return merged
}

function channels(color: string): [number, number, number, number] | null {
  const match = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)/.exec(color)
  if (!match) return null
  const alpha = match[4] === undefined ? 1 : match[4].endsWith('%') ? Number.parseFloat(match[4]) / 100 : Number(match[4])
  return [Number(match[1]), Number(match[2]), Number(match[3]), alpha]
}

function clear(color: string): boolean {
  if (color.trim() === 'transparent') return true
  const parts = channels(color)
  return parts !== null && parts[3] <= 0.1
}

function opaque(color: string): boolean {
  const parts = channels(color)
  return parts !== null && parts[3] > 0.1
}

export function colorName(color: string): string | null {
  const parts = channels(color)
  if (!parts) return null
  const [red, green, blue] = parts.map((channel) => channel / 255) as [number, number, number]
  const highest = Math.max(red, green, blue)
  const lowest = Math.min(red, green, blue)
  const lightness = (highest + lowest) / 2
  const chroma = highest - lowest
  const saturation = chroma === 0 ? 0 : chroma / (1 - Math.abs(2 * lightness - 1))
  if (saturation < 0.15 || chroma < 0.08) {
    if (lightness > 0.93) return 'white'
    if (lightness > 0.7) return 'light gray'
    if (lightness > 0.35) return 'gray'
    if (lightness > 0.12) return 'dark gray'
    return 'black'
  }
  let hue = chroma === 0 ? 0 : highest === red ? ((green - blue) / chroma) % 6 : highest === green ? (blue - red) / chroma + 2 : (red - green) / chroma + 4
  hue = (hue * 60 + 360) % 360
  const name = hue < 15 || hue >= 345 ? 'red' : hue < 40 ? (lightness < 0.35 ? 'brown' : 'orange') : hue < 66 ? 'yellow' : hue < 160 ? 'green' : hue < 190 ? 'teal' : hue < 250 ? 'blue' : hue < 290 ? 'purple' : 'pink'
  if (lightness > 0.8) return `light ${name}`
  if (lightness < 0.28 && name !== 'brown') return `dark ${name}`
  return name
}
