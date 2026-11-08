import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAnchor, createSelectionAnchor, cssIdent, cssString, elementSelectors, isCssPath } from '../src/anchor'
import type { Anchor } from '../src/protocol'
import { findTextQuote, readsPageText, resolveAnchor, textSimilarity } from '../src/resolver'
import { createAnchorTracker } from '../src/tracker'

function box(left: number, top: number, width: number, height: number): DOMRect {
  return { x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON: () => ({}) } as DOMRect
}

function layout(element: Element, rect: DOMRect | null) {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(rect ?? box(0, 0, 0, 0))
  vi.spyOn(element, 'getClientRects').mockReturnValue((rect ? [rect] : []) as unknown as DOMRectList)
}

function layoutAll() {
  Array.from(document.body.querySelectorAll('*')).forEach((element, index) => layout(element, box(0, index * 40, 200, 30)))
}

function query<Type extends Element = HTMLElement>(selector: string): Type {
  const element = document.querySelector<Type>(selector)
  if (!element) throw new Error(`No element for ${selector}`)
  return element
}

const resolved = (anchor: Anchor) => resolveAnchor(anchor, document)?.element ?? null

afterEach(() => {
  document.body.innerHTML = ''
})

describe('resolveAnchor', () => {
  it('finds the element again by test id after the markup and copy around it changed', () => {
    document.body.innerHTML = `<main><section><button data-testid="save">Save</button></section></main>`
    layoutAll()
    const anchor = createAnchor(query('button'), null)
    document.body.innerHTML = `<header>New</header><main><div class="wrapper"><section><p>Intro</p><button data-testid="save">Save changes</button></section></div></main>`
    layoutAll()

    expect(resolved(anchor)).toBe(query('[data-testid="save"]'))
  })

  it('keeps a unique id even when the text changed completely', () => {
    document.body.innerHTML = `<button id="primary-action">Start free trial</button>`
    layoutAll()
    const anchor = createAnchor(query('button'), null)
    document.body.innerHTML = `<div><button id="primary-action">Book a demo</button></div>`
    layoutAll()

    expect(resolved(anchor)).toBe(query('#primary-action'))
  })

  it('survives a small copy edit through text similarity when the structure is gone', () => {
    document.body.innerHTML = `<main><section><a href="/a">Docs</a><a href="/b">Start free trial</a></section></main>`
    layoutAll()
    const anchor = createAnchor(query('a[href="/b"]'), null)
    document.body.innerHTML = `<nav><ul><li><a href="/trial">Start a free trial</a></li><li><a href="/docs">Read the docs</a></li></ul></nav>`
    layoutAll()

    expect(resolved(anchor)).toBe(query('a[href="/trial"]'))
  })

  it('refuses a css path that now points at an unrelated element', () => {
    document.body.innerHTML = `<main><section><h2>Plans</h2><p>Pay per seat, billed monthly</p></section></main>`
    layoutAll()
    const anchor = createAnchor(query('p'), null)
    document.body.innerHTML = `<main><section><h2>Team</h2><p>Meet the people behind Lumen</p></section></main>`
    layoutAll()

    expect(anchor.selectors.some((selector) => selector.type === 'css')).toBe(true)
    expect(resolveAnchor(anchor, document)).toBeNull()
  })

  it('returns null when nothing matches', () => {
    document.body.innerHTML = `<p>Nothing here</p>`
    const anchor: Anchor = {
      selectors: [
        { type: 'testid', value: 'missing' },
        { type: 'css', value: 'main > [invalid' },
        { type: 'text', tag: 'button', value: 'Gone' },
      ],
      offset: { x: 0.5, y: 0.5 },
      rect: { x: 0, y: 0, width: 10, height: 10 },
      element_text: 'Gone',
    }
    expect(resolveAnchor(anchor, document)).toBeNull()
  })

  it('picks the match nearest to the recorded position when several match', () => {
    document.body.innerHTML = `<button>Buy</button><button>Buy</button>`
    const [first, second] = Array.from(document.querySelectorAll('button'))
    layout(first!, box(0, 0, 80, 30))
    layout(second!, box(0, 500, 80, 30))
    const anchor: Anchor = {
      selectors: [{ type: 'text', tag: 'button', value: 'Buy' }],
      offset: { x: 0.5, y: 0.5 },
      rect: { x: 0, y: 490, width: 80, height: 30 },
      element_text: 'Buy',
    }
    expect(resolved(anchor)).toBe(second)
  })

  it('does not move a short label onto the same words far away once its element is gone', () => {
    document.body.innerHTML = `<aside><span class="me">JD</span></aside><table><tr><td><span class="owner">JD</span></td></tr></table>`
    layout(query('.me'), box(20, 820, 30, 30))
    layout(query('.owner'), box(600, 280, 30, 30))
    const anchor = createAnchor(query('.owner'), null)
    query('table').remove()

    expect(resolved(anchor)).toBeNull()
  })

  it('still finds a short label that moved a little', () => {
    document.body.innerHTML = `<table><tr><td><span class="owner">JD</span></td></tr></table>`
    layout(query('.owner'), box(600, 280, 30, 30))
    const anchor = createAnchor(query('.owner'), null)
    document.body.innerHTML = `<div class="row"><span class="initials">JD</span></div>`
    layout(query('.initials'), box(620, 300, 30, 30))

    expect(resolved(anchor)).toBe(query('.initials'))
  })

  it('prefers a rendered match over a hidden one with stronger selectors', () => {
    document.body.innerHTML = `<nav class="desktop"><a data-testid="nav-pricing">Pricing</a></nav><nav class="mobile"><a>Pricing</a></nav>`
    const hidden = query('.desktop a')
    const visible = query('.mobile a')
    layout(hidden, null)
    layout(visible, box(0, 0, 60, 20))
    const anchor: Anchor = {
      selectors: [
        { type: 'testid', value: 'nav-pricing' },
        { type: 'text', tag: 'a', value: 'Pricing' },
      ],
      offset: { x: 0.5, y: 0.5 },
      rect: { x: 0, y: 0, width: 60, height: 20 },
      element_text: 'Pricing',
    }
    expect(resolved(anchor)).toBe(visible)
  })

  it('still returns a hidden match when nothing rendered matches, for the tracker to report as hidden', () => {
    document.body.innerHTML = `<div class="menu"><a data-testid="logout">Log out</a></div>`
    layout(query('a'), box(0, 0, 60, 20))
    const anchor = createAnchor(query('a'), null)
    layout(query('a'), null)

    expect(resolved(anchor)).toBe(query('a'))
  })

  describe('agent anchors with selectors only', () => {
    it('places a unique css match', () => {
      document.body.innerHTML = `<div class="plans"><div class="plan pro"><span class="price">$24</span></div></div>`
      layoutAll()
      expect(resolved({ selectors: [{ type: 'css', value: '.plan.pro > .price' }] })).toBe(query('.price'))
    })

    it('places an exact text match without a tag, choosing the smallest element', () => {
      document.body.innerHTML = `<section><div><button>Choose Pro</button></div><p>Pro is for teams</p></section>`
      layoutAll()
      expect(resolved({ selectors: [{ type: 'text', value: 'Choose Pro' }] })).toBe(query('button'))
    })

    it('places the smallest element containing the text', () => {
      document.body.innerHTML = `<section><div class="plan"><p class="price">$24 per seat / month</p></div></section>`
      layoutAll()
      expect(resolved({ selectors: [{ type: 'text', value: 'per seat' }] })).toBe(query('.price'))
    })

    it('can not be placed when nothing matches', () => {
      document.body.innerHTML = `<p>Hello</p>`
      layoutAll()
      expect(resolveAnchor({ selectors: [{ type: 'css', value: '.gone' }, { type: 'text', value: 'Goodbye' }] }, document)).toBeNull()
    })
  })

  describe('text quotes', () => {
    it('returns the range of the selected words inside the element', () => {
      document.body.innerHTML = `<p class="price">$24 <strong>per workspace</strong> / month</p>`
      layoutAll()
      const strong = query('strong')
      const range = document.createRange()
      range.setStart(strong.firstChild!, 4)
      range.setEnd(strong.firstChild!, 13)
      const anchor = createSelectionAnchor(range)

      const result = resolveAnchor(anchor, document)

      expect(result?.element).toBe(strong)
      expect(result?.range?.toString()).toBe('workspace')
    })

    it('scores lower when the quoted text is gone, without a range', () => {
      document.body.innerHTML = `<p class="price">$24 <strong>per workspace</strong> / month</p>`
      layoutAll()
      const strong = query('strong')
      const range = document.createRange()
      range.selectNodeContents(strong)
      const anchor = createSelectionAnchor(range)
      const before = resolveAnchor(anchor, document)

      strong.textContent = 'per seat'
      const after = resolveAnchor(anchor, document)

      expect(before?.range).not.toBeNull()
      expect(after?.range ?? null).toBeNull()
      if (after) expect(after.score).toBeLessThan(before!.score)
    })
  })
})

describe('findTextQuote', () => {
  it('matches across elements with whitespace collapsed', () => {
    document.body.innerHTML = `<p>Pay   per
      <em>seat</em>, not per workspace</p>`
    const range = findTextQuote({ exact: 'per seat', prefix: 'Pay', suffix: ', not' }, query('p'))
    expect(range?.toString().replace(/\s+/g, ' ')).toBe('per seat')
  })

  it('uses the prefix and suffix to choose between repeated text', () => {
    document.body.innerHTML = `<p>Starter: per seat. Pro: per seat, billed yearly.</p>`
    const range = findTextQuote({ exact: 'per seat', prefix: 'Pro:', suffix: ', billed' }, query('p'))
    const text = query('p').textContent!
    expect(range?.startOffset).toBe(text.lastIndexOf('per seat'))
  })

  it('is null when the text is absent', () => {
    document.body.innerHTML = `<p>Per seat</p>`
    expect(findTextQuote({ exact: 'per workspace', prefix: '', suffix: '' }, query('p'))).toBeNull()
  })
})

describe('textSimilarity', () => {
  it('is 1 for equal text, ignoring case and whitespace, and 0 for nothing in common', () => {
    expect(textSimilarity('Start  free trial', 'start free trial')).toBe(1)
    expect(textSimilarity('Save', 'Cancel')).toBe(0)
    expect(textSimilarity('', 'Save')).toBe(0)
    expect(textSimilarity('', '')).toBe(1)
  })

  it('stays high for a small copy edit', () => {
    expect(textSimilarity('Start free trial', 'Start a free trial')).toBeGreaterThan(0.8)
    expect(textSimilarity('Start free trial', 'Meet the people behind Lumen')).toBeLessThan(0.3)
  })
})

describe('a css selector nobody made with cssPath', () => {
  const nested = (levels: number) => `${':nth-child(n of '.repeat(levels)}*${')'.repeat(levels)}`
  const HOSTILE: Array<[string, string]> = [
    ['nested :nth-child of', nested(20)],
    [':has', 'div:has(p)'],
    [':is', ':is(div, p) > a'],
    [':not', 'div:not(.a)'],
    [':where', ':where(div)'],
    ['the universal selector', '*'],
    ['a list', 'div, p'],
    ['a descendant', 'main button'],
    ['a sibling', 'div + p'],
    ['a general sibling', 'div ~ p'],
    ['a pseudo-class', 'a:hover'],
    ['a pseudo-element', 'a::before'],
    ['any other attribute', 'a[href="/"]'],
    ['an attribute match that is not exact', '[data-testid^="a"]'],
    ['an attribute with no value', '[data-testid]'],
    ['another nth', 'div:nth-child(2)'],
    ['nth with a formula', 'div:nth-of-type(2n)'],
    ['nth with of', 'div:nth-of-type(1 of .a)'],
    ['no spaces around the combinator', 'div>p'],
    ['a quote left open', '[data-testid="a]'],
    ['a line break in a value', '[data-testid="a\nb"]'],
    ['an empty part', 'div >  > p'],
    ['a part with no combinator', 'div > p '],
    ['nothing', ''],
    ['too much', `${'div > '.repeat(200)}div`],
    ['too many bytes in few characters', `div.${'\u00e9'.repeat(600)}`],
  ]

  it.each(HOSTILE)('never runs %s, and the comment is not placed by it', (_name, value) => {
    document.body.innerHTML = `<div><p>Words</p><a href="/" data-testid="a">Link</a></div>`
    layoutAll()
    const run = vi.spyOn(document, 'querySelectorAll')

    expect(resolved({ selectors: [{ type: 'css', value }] })).toBeNull()

    expect(run).not.toHaveBeenCalled()
  })

  it('is not run from where a menu was opened either', () => {
    document.body.innerHTML = `<button id="opener">Open</button><div id="gone" hidden>Item</div>`
    const run = vi.spyOn(document, 'querySelectorAll')

    expect(resolved({ selectors: [{ type: 'css', value: nested(20) }] })).toBeNull()
    const tracker = createAnchorTracker(window, () => {})
    tracker.track(new Map([['hostile', { selectors: [{ type: 'id', value: 'gone' }], state: { opened_by: [{ type: 'css', value: nested(20) }] } }]]))

    expect(run.mock.calls.flat()).not.toContain(nested(20))
    tracker.destroy()
  })

  it('still votes with the selectors around it', () => {
    document.body.innerHTML = `<button id="good">Good</button>`
    expect(resolved({ selectors: [{ type: 'css', value: nested(20) }, { type: 'id', value: 'good' }] })).toBe(query('#good'))
  })

  it.each([
    ['a tag', 'main'],
    ['a path', 'main > section > a'],
    ['a class', 'a.button'],
    ['the example in the contract', 'main > section:nth-of-type(2) > a.button'],
    ['an id', '#pricing > a'],
    ['a test id', '[data-testid="plan-pro"] > a'],
  ])('runs %s', (_name, value) => {
    document.body.innerHTML = `<main><section></section><section id="pricing" data-testid="plan-pro"><a class="button">Buy</a></section></main>`
    const run = vi.spyOn(document, 'querySelectorAll')
    resolved({ selectors: [{ type: 'css', value }] })
    expect(run).toHaveBeenCalledWith(value)
  })

  it('answers at once whatever the text, because the check itself must not be slow', () => {
    const inputs = [
      `${'\\31 '.repeat(250)}!`,
      `${'\\31'.repeat(300)}!`,
      `${'\\aaaaaa'.repeat(140)}!`,
      `${'a.'.repeat(500)}!`,
      `[data-a="${'a'.repeat(1000)}`,
      `[data-a="${'\\a'.repeat(500)}`,
      `${'[data-a="a"]'.repeat(80)}!`,
      `${'\\'.repeat(999)}`,
      `${'a > '.repeat(250)}!`,
      `${':nth-of-type(1)'.repeat(60)}!`,
    ]
    const started = performance.now()
    for (const input of inputs) expect(isCssPath(input), input.slice(0, 20)).toBe(false)
    expect(performance.now() - started).toBeLessThan(50)
  })
})

describe('what cssPath makes', () => {
  const cssOf = (element: Element) => elementSelectors(element).find((selector) => selector.type === 'css')!.value

  it('passes the check for every id and class it keeps, escaped ones too', () => {
    const tokens = ['plain', 'with-dash', 'with_underscore', '1leading-digit', '-1dash-digit', '--custom', '_private', 'Upper', '123', '9']
    document.body.innerHTML = `<main>${tokens.map((token) => `<section id="${token}"><b></b><b></b></section><div class="row"><i class="${token}"></i><i></i></div>`).join('')}</main>`
    for (const element of document.querySelectorAll('b, i')) expect(isCssPath(cssOf(element)), cssOf(element)).toBe(true)
  })

  it("passes the check for what the server's own test lists", () => {
    for (const selector of ['a', 'section.pricing > a', 'li:nth-of-type(1) > button', '#app > div > div > p:nth-of-type(2)', '#faq-question-limit', 'button:nth-of-type(2) > span', '[data-testid="pricing-cta"] > a', '[data-mostra-id="a \\"quoted\\" > value"] > span', '[data-test="back\\\\slash"]', '#\\31 23abc > span', '.\\-1 > a.b', 'o\\:p > x-custom-element.card', 'section.pr\u00e9f\u00e9rences > a', 'div:nth-of-type(12) > a.button:nth-of-type(3)']) {
      expect(isCssPath(selector), selector).toBe(true)
    }
  })

  it('passes the check for anything cssIdent can write', () => {
    for (let code = 1; code < 0x180; code++) {
      const character = String.fromCharCode(code)
      for (const name of [character, `a${character}`, `${character}a`, `a${character}b`, `-${character}`]) {
        expect(isCssPath(cssIdent(name)), JSON.stringify(name)).toBe(true)
        expect(isCssPath(`${cssIdent(name)}.${cssIdent(name)}:nth-of-type(12) > #${cssIdent(name)}`), JSON.stringify(name)).toBe(true)
      }
    }
  })

  it('passes the check for anything cssString can write', () => {
    for (const value of ['plain', 'with space', 'with"quote', 'with\\backslash', 'with\nline', 'caf\u00e9', '> a', 'a, b', ':has(*)', '*', ']', '"]', '\\"']) {
      for (const attribute of ['data-testid', 'data-test', 'data-mostra-id']) expect(isCssPath(`[${attribute}="${cssString(value)}"] > a`), value).toBe(true)
    }
  })

  function towers(part: string, levels: number) {
    const tower = `${`<${part}>`.repeat(levels)}<b></b>${`</${part}>`.repeat(levels)}`
    document.body.innerHTML = `<main><div>${tower}</div><div>${tower}</div></main>`
    return document.querySelector('b')!
  }

  it('stays under the limit on a page nested too deep to say it all', () => {
    const element = towers('section', 150)
    const path = cssOf(element)
    expect(new TextEncoder().encode(path).length).toBeLessThanOrEqual(1024)
    expect(isCssPath(path)).toBe(true)
    expect(Array.from(document.querySelectorAll(path))).toContain(element)
  })

  it('counts bytes, as the server does, not characters', () => {
    const path = cssOf(towers('x-\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9', 120))
    expect(path).toContain('\u00e9')
    expect(new TextEncoder().encode(path).length).toBeLessThanOrEqual(1024)
    expect(isCssPath(path)).toBe(true)
  })

  it('leaves out a test id too long to say', () => {
    const tower = '<div><b></b><b></b></div>'
    document.body.innerHTML = `<section data-testid="${'a'.repeat(2000)}">${tower}</section><section>${tower}</section>`
    const element = document.querySelectorAll('b')[1]!
    expect(cssOf(element)).toBe('div > b:nth-of-type(2)')
    expect(isCssPath(cssOf(element))).toBe(true)
  })

  it('says something runnable even for a tag too long to say', () => {
    document.body.innerHTML = `<main><x-${'a'.repeat(1100)}></x-${'a'.repeat(1100)}></main>`
    const path = cssOf(document.querySelector('main')!.firstElementChild!)
    expect(isCssPath(path)).toBe(true)
    expect(path).toBe('body')
  })

  it('finds its element again through the resolver', () => {
    document.body.innerHTML = '<main><section id="plans"><a class="button">Buy</a><a>Other</a></section></main>'
    layoutAll()
    expect(resolved(createAnchor(document.querySelectorAll('a')[0]!, null))).toBe(document.querySelectorAll('a')[0]!)
  })
})

describe('an anchor that is not the shape it should be', () => {
  const HOSTILE: Array<[string, unknown]> = [
    ['element text that is a number', { selectors: [{ type: 'css', value: '#good' }], element_text: 123 }],
    ['element text that is an object', { selectors: [{ type: 'css', value: '#good' }], element_text: { a: 1 } }],
    ['selectors that are a string', { selectors: 'abc' }],
    ['no selectors', {}],
    ['a selector that is null', { selectors: [null] }],
    ['a selector that is a number', { selectors: [5] }],
    ['a value that is a number', { selectors: [{ type: 'testid', value: 5 }, { type: 'id', value: 5 }, { type: 'css', value: 5 }, { type: 'text', value: 5 }] }],
    ['a tag that is a number', { selectors: [{ type: 'text', tag: 5, value: 'Good' }] }],
    ['a css selector that does not parse', { selectors: [{ type: 'css', value: '][' }] }],
    ['a quote that is a number', { selectors: [{ type: 'css', value: '#good' }], text_quote: 5 }],
    ['a quote with a number in it', { selectors: [{ type: 'css', value: '#good' }], text_quote: { exact: 5, prefix: 6, suffix: 7 } }],
    ['a rect that is a string', { selectors: [{ type: 'css', value: '#good' }], rect: 'here' }],
    ['a state with a number for its trigger', { selectors: [{ type: 'css', value: '#nothing' }], state: { opened_by: 5 } }],
    ['a state with a string for its trigger', { selectors: [{ type: 'css', value: '#nothing' }], state: { opened_by: 'abc' } }],
  ]

  it.each(HOSTILE)('never throws for %s', (_name, anchor) => {
    document.body.innerHTML = `<button id="good">Good</button>`
    expect(() => resolved(anchor as Anchor)).not.toThrow()
  })

  it.each(HOSTILE)('costs only its own pin, for %s', (_name, anchor) => {
    document.body.innerHTML = `<button id="good">Good</button><button id="other">Other</button>`
    layoutAll()
    const onChange = vi.fn()
    const tracker = createAnchorTracker(window, onChange)
    const honest: Anchor = { selectors: [{ type: 'id', value: 'other' }], element_text: 'Other' }

    expect(() => tracker.track(new Map([['hostile', anchor as Anchor], ['honest', honest]]))).not.toThrow()

    expect(tracker.element('honest')).toBe(query('#other'))
    expect(onChange.mock.calls.at(-1)?.[0].get('honest').status).toBe('placed')
    tracker.destroy()
  })

  it('still votes with the selectors it knows, beside one it does not', () => {
    document.body.innerHTML = `<button id="good">Good</button>`
    expect(resolved({ selectors: [{ type: 'nonsense' } as never, { type: 'id', value: 'good' }] })).toBe(query('#good'))
  })

  it('tries only the first selector of each kind, as an anchor only ever has one', () => {
    document.body.innerHTML = `<button id="good">Good</button>`
    expect(resolved({ selectors: [{ type: 'id', value: 'good' }, { type: 'id', value: 'missing' }] })).toBe(query('#good'))
    expect(resolved({ selectors: [{ type: 'id', value: 'missing' }, { type: 'id', value: 'good' }] })).toBeNull()
    const run = vi.spyOn(document, 'querySelectorAll')
    resolved({ selectors: Array.from({ length: 8 }, () => ({ type: 'css' as const, value: 'main > a' })) })
    expect(run).toHaveBeenCalledOnce()
  })

  it('reads the page for one text selector, however many it brings', () => {
    document.body.innerHTML = `<p>Words</p>`.repeat(50)
    const read = vi.spyOn(document.body, 'getElementsByTagName')
    const byTag = vi.spyOn(document, 'getElementsByTagName')

    resolved({ selectors: Array.from({ length: 320 }, (_unused, index) => ({ type: 'text' as const, value: `nothing like it ${index}` })) })
    resolved({ selectors: Array.from({ length: 320 }, (_unused, index) => ({ type: 'text' as const, tag: 'p', value: `nothing like it ${index}` })) })

    expect(read).toHaveBeenCalledOnce()
    expect(byTag).toHaveBeenCalledOnce()
  })
})

describe('a quote or a text selector far longer than any the overlay makes', () => {
  const sentence = (length: number) => 'the quick brown fox jumps over the lazy dog '.repeat(Math.ceil(length / 44)).slice(0, length)
  const hostileQuote = { exact: 'e', prefix: sentence(7800), suffix: sentence(7800) }

  it('takes no time over a word on every line of a page', () => {
    document.body.innerHTML = Array.from({ length: 50 }, () => `<div>${'e'.repeat(200)}</div>`).join('')
    layoutAll()
    const started = performance.now()
    resolved({ selectors: [{ type: 'css', value: 'div' }], text_quote: hostileQuote })
    expect(performance.now() - started).toBeLessThan(800)
  })

  it('looks for it in only the likeliest few candidates', () => {
    document.body.innerHTML = Array.from({ length: 50 }, (_unused, index) => `<div id="d${index}">Words here</div>`).join('')
    layoutAll()
    const walked = vi.spyOn(document, 'createTreeWalker')
    resolved({ selectors: [{ type: 'css', value: 'div' }], text_quote: { exact: 'Words', prefix: '', suffix: '' } })
    expect(walked.mock.calls.length).toBeLessThanOrEqual(3)
  })

  it('reads nothing for a word the element does not hold', () => {
    document.body.innerHTML = '<div>Words here</div>'
    const walked = vi.spyOn(document, 'createTreeWalker')
    expect(findTextQuote({ exact: 'nowhere', prefix: '', suffix: '' }, query('div'))).toBeNull()
    expect(walked).not.toHaveBeenCalled()
  })

  it('tells places apart by the words right next to them, however much more was sent', () => {
    document.body.innerHTML = '<p>Free plan per seat and Pro plan per seat</p>'
    const range = findTextQuote({ exact: 'per seat', prefix: `${'nothing like it '.repeat(500)}Pro plan`, suffix: '' }, query('p'))
    expect(range?.startOffset).toBe('Free plan per seat and Pro plan '.length)
  })

  it('still finds the word when it is everywhere, past where it stops comparing', () => {
    document.body.innerHTML = `<p>${'e'.repeat(1000)}</p>`
    expect(findTextQuote({ exact: 'e', prefix: 'x', suffix: 'y' }, query('p'))?.toString()).toBe('e')
  })

  it('leaves a quote out of a quick look, as finding it is reading', () => {
    document.body.innerHTML = '<div>Words here</div>'
    layoutAll()
    const walked = vi.spyOn(document, 'createTreeWalker')
    const anchor: Anchor = { selectors: [{ type: 'css', value: 'body > div' }], text_quote: { exact: 'Words', prefix: '', suffix: '' } }

    expect(readsPageText(anchor)).toBe(true)
    expect(resolveAnchor(anchor, document, false)).toBeNull()
    expect(walked).not.toHaveBeenCalled()
    expect(resolveAnchor(anchor, document, true)?.range?.toString()).toBe('Words')
  })

  it('places a comment on selected words at once on a quiet page', () => {
    document.body.innerHTML = '<p id="words">Per seat, billed yearly</p>'
    layoutAll()
    const tracker = createAnchorTracker(window, () => {})
    tracker.track(new Map<string, Anchor>([['selected', { selectors: [{ type: 'css', value: 'body > p' }, { type: 'text', tag: 'p', value: 'Per seat, billed yearly' }], element_text: 'Per seat, billed yearly', text_quote: { exact: 'billed yearly', prefix: 'Per seat, ', suffix: '' } }]]))
    expect(tracker.element('selected')).toBe(query('#words'))
    tracker.destroy()
  })

  it('cuts a text selector to what a comparison can use, so an agent can still give a long one', () => {
    const start = sentence(200).trimEnd()
    document.body.innerHTML = `<p>${start}</p><p>Something else</p>`
    layoutAll()
    expect(resolved({ selectors: [{ type: 'text', tag: 'p', value: sentence(15000) }] })).toBe(query('p'))
  })

  it('cuts recorded element text as it was cut when it was made', () => {
    const words = sentence(300).trimEnd()
    document.body.innerHTML = `<p>${words}</p>`
    layoutAll()
    expect(resolveAnchor({ selectors: [{ type: 'css', value: 'body > p' }], element_text: words }, document)!.score).toBeGreaterThanOrEqual(6)
  })

  it('skips only comparisons that could never have reached a match', () => {
    const pieces = ['ab', 'a b', 'abc', 'the quick', 'aaaa', 'xyzzy plugh', 'Choose Pro', 'e', 'ee', 'one two three']
    for (const piece of pieces) {
      for (let times = 4; times < 20; times++) expect(textSimilarity(piece, `${piece} `.repeat(times)), `${piece} x ${times}`).toBeLessThan(0.6)
    }
  })
})

describe('test ids a fix has added', () => {
  const copyChanged = { element_text: 'What this used to say', offset: { x: 0.5, y: 0.5 } }

  beforeEach(() => {
    document.body.innerHTML = `<main><div data-testid="plan-pro">Pro, reworded</div></main>`
    layoutAll()
  })

  it("still finds the element by its own id before the agent's new one has shipped", () => {
    expect(resolved({ selectors: [{ type: 'testid', value: 'c3' }, { type: 'testid', value: 'plan-pro' }, { type: 'css', value: 'main > section' }], ...copyChanged })).toBe(query('[data-testid]'))
  })

  it('finds it by the new one once that has shipped, and the old one has gone', () => {
    query('[data-testid]').setAttribute('data-testid', 'c3')
    expect(resolved({ selectors: [{ type: 'testid', value: 'c3' }, { type: 'testid', value: 'plan-pro' }], ...copyChanged })).toBe(query('[data-testid]'))
  })

  it('reaches past two fixes that have not shipped', () => {
    expect(resolved({ selectors: [{ type: 'testid', value: 'second-fix' }, { type: 'testid', value: 'first-fix' }, { type: 'testid', value: 'plan-pro' }], ...copyChanged })).toBe(query('[data-testid]'))
  })

  it('stops at the most any anchor can hold', () => {
    const run = vi.spyOn(document, 'querySelectorAll')
    resolved({ selectors: Array.from({ length: 300 }, (_unused, index) => ({ type: 'testid' as const, value: `missing-${index}` })) })
    expect(run).toHaveBeenCalledTimes(8)
  })

  it('still takes one of every other kind', () => {
    const run = vi.spyOn(document, 'querySelectorAll')
    resolved({ selectors: [{ type: 'id', value: 'a' }, { type: 'id', value: 'b' }, { type: 'css', value: 'main' }, { type: 'css', value: 'div' }] })
    expect(run.mock.calls.map(([selector]) => selector)).toEqual(['[id="a"]', 'main'])
  })
})

describe('a page full of comments that find nothing', () => {
  function slowReads(msPerRead: number) {
    let now = 0
    vi.spyOn(window.performance, 'now').mockImplementation(() => now)
    const read = vi.spyOn(document.body, 'getElementsByTagName').mockImplementation(() => {
      now += msPerRead
      return document.querySelectorAll('*') as unknown as HTMLCollectionOf<Element>
    })
    return read
  }

  const lost = (count: number): Array<[string, Anchor]> => Array.from({ length: count }, (_unused, index) => [`lost-${index}`, { selectors: [{ type: 'text', value: `words nobody wrote ${index}` }] }])
  let trackers: Array<{ destroy(): void }> = []
  function tracked(onChange: (placements: ReadonlyMap<string, unknown>) => void = () => {}) {
    const tracker = createAnchorTracker(window, onChange)
    trackers.push(tracker)
    return tracker
  }

  afterEach(() => {
    for (const tracker of trackers.splice(0)) tracker.destroy()
    vi.useRealTimers()
  })

  it('reads the page for only some of them in one pass', () => {
    document.body.innerHTML = '<p>Words</p>'
    const read = slowReads(11)
    tracked().track(new Map(lost(320)))
    expect(read.mock.calls.length).toBeLessThanOrEqual(1)
  })

  it('places real pins in that same pass, wherever they are in the list', () => {
    document.body.innerHTML = '<button id="real">Choose Pro</button><a id="named">Named</a>'
    layoutAll()
    slowReads(60)
    const real: Anchor = { selectors: [{ type: 'css', value: 'body > button' }, { type: 'text', tag: 'button', value: 'Choose Pro' }], element_text: 'Choose Pro' }
    const named: Anchor = { selectors: [{ type: 'id', value: 'named' }], element_text: 'Named' }
    const tracker = tracked()

    tracker.track(new Map<string, Anchor>([...lost(160), ['real', real], ['named', named], ...lost(160).map(([id, anchor]): [string, Anchor] => [`${id}-more`, anchor])]))

    expect(tracker.element('real')).toBe(query('#real'))
    expect(tracker.element('named')).toBe(query('#named'))
  })

  it('gets round to every one of them in the end, and then a real pin that needs reading is found', async () => {
    vi.useFakeTimers()
    document.body.innerHTML = '<p>Only words here</p>'
    layoutAll()
    slowReads(11)
    const needsReading: Anchor = { selectors: [{ type: 'text', value: 'Only words here' }] }
    const tracker = tracked()

    tracker.track(new Map<string, Anchor>([...lost(20), ['needs reading', needsReading]]))
    expect(tracker.element('needs reading')).toBeNull()

    await vi.advanceTimersByTimeAsync(2000)
    expect(tracker.element('needs reading')).toBe(query('p'))
  })

  it("doesn't count waiting for a read as having failed to place it", async () => {
    vi.useFakeTimers()
    document.body.innerHTML = '<p>Words</p>'
    layoutAll()
    slowReads(11)
    const statuses: string[] = []
    const onChange = (placements: ReadonlyMap<string, any>) => void statuses.push(placements.get('lost-19').status)
    tracked(onChange).track(new Map(lost(20)))

    await vi.advanceTimersByTimeAsync(1000)

    expect(statuses.length).toBeGreaterThan(0)
    expect(statuses).not.toContain('unplaced')
  })

  it('rests between passes for longer the longer a pass took, however much is waiting', async () => {
    vi.useFakeTimers()
    document.body.innerHTML = '<p>Words</p>'
    const read = slowReads(300)
    tracked().track(new Map(lost(50)))
    expect(read).toHaveBeenCalledOnce()

    await vi.advanceTimersByTimeAsync(899)
    expect(read).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(2)
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('never takes a quick answer that reading could beat', () => {
    document.body.innerHTML = '<ul><li>Per seat</li><li>Per seat, billed yearly</li></ul>'
    layoutAll()
    const anchor: Anchor = { selectors: [{ type: 'css', value: 'ul > li:nth-of-type(1)' }, { type: 'text', tag: 'li', value: 'Per seat, billed yearly' }], element_text: 'Per seat, billed yearly', rect: { x: 0, y: 40, width: 200, height: 30 } }

    expect(resolveAnchor(anchor, document, false)).toBeNull()
    expect(resolveAnchor(anchor, document, true)?.element).toBe(document.querySelectorAll('li')[1])
    expect(resolveAnchor({ ...anchor, selectors: [anchor.selectors[0]!] }, document, false)?.element).toBe(document.querySelectorAll('li')[0])
  })

  it('reads nothing when it was told not to', () => {
    document.body.innerHTML = '<p>Words</p>'
    const read = vi.spyOn(document.body, 'getElementsByTagName')
    expect(resolveAnchor({ selectors: [{ type: 'text', value: 'Words' }] }, document, false)).toBeNull()
    expect(read).not.toHaveBeenCalled()
  })
})
