import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveAnchor } from '../src/resolver'
import { anchorTarget, createAnchor, createSelectionAnchor, cssIdent, describeElement, elementText, isMasked, parentOf, sectionName } from '../src/anchor'
import { documentTitle } from '../src/page-url'

function box(left: number, top: number, width: number, height: number): DOMRect {
  return { x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON: () => ({}) } as DOMRect
}

function layout(element: Element, rect: DOMRect | null) {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(rect ?? box(0, 0, 0, 0))
  vi.spyOn(element, 'getClientRects').mockReturnValue((rect ? [rect] : []) as unknown as DOMRectList)
}

function query<Type extends Element = HTMLElement>(selector: string): Type {
  const element = document.querySelector<Type>(selector)
  if (!element) throw new Error(`No element for ${selector}`)
  return element
}

function label(html: string, selector: string): string {
  document.body.innerHTML = html
  return describeElement(query(selector))
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('createAnchor', () => {
  it('records test id, id, css path and text selectors with offset, rect, text and label', () => {
    document.body.innerHTML = `
      <main>
        <section><h2>Plans</h2></section>
        <section class="pricing">
          <a id="start-trial" class="button" data-testid="pricing-cta" href="#">  Start free
            trial </a>
        </section>
      </main>`
    const link = query('a')
    layout(link, box(120, 430, 180, 44))
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(1000)
    vi.spyOn(window, 'scrollX', 'get').mockReturnValue(0)

    const anchor = createAnchor(link, { x: 120 + 0.42 * 180, y: 430 + 22 })

    expect(anchor.selectors).toEqual([
      { type: 'testid', value: 'pricing-cta' },
      { type: 'id', value: 'start-trial' },
      { type: 'css', value: 'section.pricing > a' },
      { type: 'text', tag: 'a', value: 'Start free trial' },
    ])
    expect(anchor.offset).toEqual({ x: 0.42, y: 0.5 })
    expect(anchor.rect).toEqual({ x: 120, y: 1430, width: 180, height: 44 })
    expect(anchor.element_text).toBe('Start free trial')
    expect(anchor.label).toBe("'Start free trial' link")
    expect(anchor.text_quote).toBeUndefined()
    expect(anchor.state).toEqual({})
    expect(typeof anchor.spec).toBe('object')
  })

  it('puts the pin at the top left corner when there is no pointer position', () => {
    document.body.innerHTML = `<button>Save</button>`
    layout(query('button'), box(10, 10, 80, 30))
    expect(createAnchor(query('button'), null).offset).toEqual({ x: 0, y: 0 })
  })

  it('leaves out generated ids and class names', () => {
    document.body.innerHTML = `
      <ul>
        <li class="css-1n7v3ny item"><button id=":r1:" class="sc-bdVaJa Button_root__x7d2a">Save</button></li>
        <li class="css-9a8b7cq item"><button id="radix-:r2:" class="active">Save</button></li>
      </ul>`
    const anchor = createAnchor(query('button'), { x: 0, y: 0 })
    const css = anchor.selectors.find((selector) => selector.type === 'css')?.value ?? ''

    expect(anchor.selectors.map((selector) => selector.type)).toEqual(['css', 'text'])
    expect(css).toBe('li:nth-of-type(1) > button')
    expect(document.querySelector(css)).toBe(query('button'))
  })

  it('anchors the css path at the nearest ancestor with a stable unique id', () => {
    document.body.innerHTML = `
      <div id="app"><div><div><p>One</p><p>Two</p></div></div></div>
      <div><div><div><p>One</p><p>Two</p></div></div></div>`
    const second = query('#app p:nth-of-type(2)')
    const css = createAnchor(second, { x: 0, y: 0 }).selectors.find((selector) => selector.type === 'css')?.value

    expect(css).toBe('#app > div > div > p:nth-of-type(2)')
    expect(document.querySelectorAll(css!)).toHaveLength(1)
  })

  it('skips a test id that is not unique', () => {
    document.body.innerHTML = `<div data-testid="row">A</div><div data-testid="row">B</div>`
    const anchor = createAnchor(query('div'), { x: 0, y: 0 })
    expect(anchor.selectors.some((selector) => selector.type === 'testid')).toBe(false)
  })

  it('caps element text at 120 characters and leaves long text out of the selectors', () => {
    document.body.innerHTML = `<p>${'word '.repeat(60)}</p>`
    const anchor = createAnchor(query('p'), { x: 0, y: 0 })
    expect(anchor.element_text!.length).toBeLessThanOrEqual(120)
    expect(anchor.selectors.some((selector) => selector.type === 'text')).toBe(false)
  })
})

describe('text someone typed', () => {
  const SECRET = 'my card is 4242 4242'

  const captured = (element: Element) => JSON.stringify([createAnchor(element, { x: 1, y: 1 }), elementText(element), describeElement(element)])

  const FIELDS: Array<[string, string]> = [
    ['a textarea mirroring its value, as React does', `<textarea id="field">${SECRET}</textarea>`],
    ['a contenteditable', `<div id="field" contenteditable="true">${SECRET}</div>`],
    ['an empty contenteditable attribute', `<div id="field" contenteditable>${SECRET}</div>`],
    ['a plaintext contenteditable', `<div id="field" contenteditable="plaintext-only">${SECRET}</div>`],
    ['a textbox role', `<div id="field" role="textbox">${SECRET}</div>`],
    ['a searchbox role', `<div id="field" role="searchbox">${SECRET}</div>`],
    ['a CodeMirror 5 editor', `<div id="field" class="CodeMirror"><textarea></textarea><div class="CodeMirror-code"><pre>${SECRET}</pre></div></div>`],
    ['a Monaco editor', `<div id="field" class="monaco-editor"><textarea class="inputarea"></textarea><div class="view-lines"><div class="view-line">${SECRET}</div></div></div>`],
    ['an Ace editor', `<div id="field" class="ace_editor"><textarea class="ace_text-input"></textarea><div class="ace_line">${SECRET}</div></div>`],
  ]

  it.each(FIELDS)('stays out of %s', (_name, html) => {
    document.body.innerHTML = html
    const field = query('#field')
    const anchor = createAnchor(field, null)

    expect(captured(field)).not.toContain('4242')
    expect(isMasked(field)).toBe(true)
    expect(anchor.selectors.some((selector) => selector.type === 'text')).toBe(false)
    expect(anchor.element_text).toBe('[masked]')
  })

  it('stays out of a line inside a code editor, where a click lands', () => {
    document.body.innerHTML = `<div class="monaco-editor"><textarea class="inputarea"></textarea><div class="view-lines"><div class="view-line"><span id="token">${SECRET}</span></div></div></div>`
    const token = query('#token')

    expect(isMasked(token)).toBe(true)
    expect(captured(token)).not.toContain('4242')
    expect(createAnchor(token, null).element_text).toBe('[masked]')
  })

  it.each(FIELDS)('stays out of what holds %s', (_name, html) => {
    document.body.innerHTML = `<section id="around"><h2>Your reply</h2><div id="inner">${html}</div></section>`

    for (const selector of ['#around', '#inner']) {
      expect(captured(query(selector))).not.toContain('4242')
      expect(isMasked(query(selector))).toBe(false)
    }
    expect(createAnchor(query('#around'), null).element_text).toBe('Your reply')
    expect(createAnchor(query('#around'), null).selectors).toContainEqual({ type: 'text', tag: 'section', value: 'Your reply' })
  })

  it('stays out when it arrives after the page does, through textContent', () => {
    document.body.innerHTML = `<div id="around">Notes <textarea id="field"></textarea></div>`
    query('#field').textContent = SECRET
    query<HTMLTextAreaElement>('#field').value = SECRET
    expect(captured(query('#field'))).not.toContain('4242')
    expect(captured(query('#around'))).not.toContain('4242')
  })

  it('stays out of what is inside an editor, down to a mention set not to be edited', () => {
    document.body.innerHTML = `<div contenteditable="true"><p id="line">${SECRET}</p><span id="mention" contenteditable="false">Maya Lopez</span></div>`
    for (const selector of ['#line', '#mention']) {
      expect(captured(query(selector))).not.toMatch(/4242|Maya/)
      expect(createAnchor(query(selector), null).element_text).toBe('[masked]')
      expect(createAnchor(query(selector), null).label).toBe('"[masked]"')
    }
  })

  it('stays out of the selection text, whichever way the selection runs', () => {
    document.body.innerHTML = `<div id="around"><p id="before">Before the field</p><div id="editor" contenteditable="true">${SECRET}</div><p id="after">After the field</p></div>`
    const editor = query('#editor').firstChild!

    const inside = document.createRange()
    inside.setStart(editor, 0)
    inside.setEnd(editor, 5)
    const across = document.createRange()
    across.setStart(query('#before').firstChild!, 0)
    across.setEnd(query('#after').firstChild!, 5)

    expect(JSON.stringify(createSelectionAnchor(inside))).not.toContain('4242')
    expect(createSelectionAnchor(inside).text_quote?.exact).toBe('[masked]')
    expect(JSON.stringify(createSelectionAnchor(across))).not.toContain('4242')
    expect(createSelectionAnchor(across).text_quote?.exact).toBe('Before the fieldAfter')
  })

  it('stays out of what names something else', () => {
    document.body.innerHTML = `<div id="name" contenteditable="true">${SECRET}</div><button id="button" aria-labelledby="name"></button><section><h2 contenteditable="true">${SECRET}</h2><button id="under">Save</button></section>`
    expect(captured(query('#button'))).not.toContain('4242')
    expect(sectionName(query('#under'))).toBe('[masked]')
  })

  it('still names the field, from its label and never its text', () => {
    document.body.innerHTML = `
      <label for="note">Note</label><textarea id="note">${SECRET}</textarea>
      <label>Around<textarea id="wrapped">${SECRET}</textarea></label>
      <textarea id="hint" placeholder="Say something">${SECRET}</textarea>
      <div id="aria" role="textbox" contenteditable="true" aria-label="Reply">${SECRET}</div>
      <div id="labelled" contenteditable="true" aria-labelledby="heading">${SECRET}</div><h3 id="heading">Bio</h3>
      <div id="titled" contenteditable="true" title="Bio">${SECRET}</div>
      <div id="bare" contenteditable="true">${SECRET}</div>
      <div id="searching" role="searchbox">${SECRET}</div>`
    expect(describeElement(query('#note'))).toBe("'Note' field")
    expect(describeElement(query('#wrapped'))).toBe("'Around' field")
    expect(describeElement(query('#hint'))).toBe("'Say something' field")
    expect(describeElement(query('#aria'))).toBe("'Reply' field")
    expect(describeElement(query('#labelled'))).toBe("'Bio' field")
    expect(describeElement(query('#titled'))).toBe("'Bio' field")
    expect(describeElement(query('#bare'))).toBe('Field')
    expect(describeElement(query('#searching'))).toBe('Field')
  })

  it('leaves the label to a mark, on the field or around it', () => {
    document.body.innerHTML = `<div data-mostra-mask><textarea id="inside" aria-label="Maya's notes"></textarea></div><textarea id="marked" aria-label="Maya's notes" data-mostra-mask></textarea>`
    expect(describeElement(query('#inside'))).toBe("'[masked]' field")
    expect(describeElement(query('#marked'))).toBe("'[masked]' field")
  })

  it('leaves an element set not to be edited alone, when it is not inside an editor', () => {
    document.body.innerHTML = `<p id="plain" contenteditable="false">Per seat, billed yearly</p>`
    expect(isMasked(query('#plain'))).toBe(false)
    expect(createAnchor(query('#plain'), null).element_text).toBe('Per seat, billed yearly')
  })

  it('finds a pin on a field again whatever is typed there by then', () => {
    document.body.innerHTML = `<form><label for="note">Note</label><textarea id="note">${SECRET}</textarea></form>`
    const anchor = createAnchor(query('#note'), null)
    query('#note').textContent = 'something else entirely'
    expect(resolveAnchor(anchor, document)?.element).toBe(query('#note'))
  })
})

describe('a page that has taken the names of things', () => {
  function takenBy(owner: object, name: string, value: unknown) {
    let reads = 0
    Object.defineProperty(owner, name, {
      configurable: true,
      get() {
        if (++reads > 100) throw new Error(`Round in circles through ${name}`)
        return value
      },
    })
    return () => delete (owner as Record<string, unknown>)[name]
  }
  let release: Array<() => void> = []
  afterEach(() => {
    for (const undo of release.splice(0)) undo()
  })

  it.each([
    ['a form', () => document.createElement('form')],
    ['an image', () => document.createElement('img')],
  ])('ends a look for a mark when %s is called host', (_name, make) => {
    document.body.innerHTML = '<p id="plain">Plain words</p>'
    const named = document.body.appendChild(make())
    named.setAttribute('name', 'host')
    release.push(takenBy(document, 'host', named))

    expect(isMasked(query('#plain'))).toBe(false)
    expect(createAnchor(query('#plain'), null).element_text).toBe('Plain words')
    expect(isMasked(named)).toBe(false)
  })

  it('ends it when a frame is called host, which makes it a window', () => {
    document.body.innerHTML = '<p id="plain">Plain words</p>'
    release.push(takenBy(document, 'host', window))
    expect(isMasked(query('#plain'))).toBe(false)
    expect(createAnchor(query('#plain'), null).element_text).toBe('Plain words')
  })

  it('ends it on a detached link, which is its own root and has a host of its own', () => {
    const link = document.createElement('a')
    link.href = 'https://example.com/'
    expect((link.getRootNode() as unknown as { host: unknown }).host).toBeTruthy()
    expect(isMasked(link)).toBe(false)
    expect(isMasked(document.createTextNode('words'))).toBe(false)
  })

  it('still goes through a real shadow root, and past a fragment with no host', () => {
    document.body.innerHTML = '<div data-mostra-mask><my-card></my-card></div>'
    const shadow = query('my-card').attachShadow({ mode: 'open' })
    shadow.innerHTML = '<p>Inside</p>'
    expect(isMasked(shadow.querySelector('p')!)).toBe(true)
    const fragment = document.createDocumentFragment()
    expect(isMasked(fragment.appendChild(document.createElement('p')))).toBe(false)
  })

  it('asks a form for its parent past a field that has taken the name', () => {
    document.body.innerHTML = '<main><form id="form"><input name="parentElement" id="field"></form></main>'
    Object.defineProperty(query('#form'), 'parentElement', { configurable: true, value: query('#field') })
    expect(parentOf(query('#form'))).toBe(query('main'))
    expect(parentOf(query('#field'))).toBe(query('#form'))
    expect(parentOf(document.createElement('p'))).toBeNull()
  })

  it('never walks up the page through parentElement itself', () => {
    const source = resolve(import.meta.dirname, '../src')
    const walks: string[] = []
    for (const name of readdirSync(source, { recursive: true, encoding: 'utf8' }).filter((file) => /\.tsx?$/.test(file) && !file.startsWith('speech'))) {
      for (const line of readFileSync(resolve(source, name), 'utf8').split('\n')) if (/^\s*for \(.*\.parentElement/.test(line)) walks.push(`${name}: ${line.trim()}`)
    }
    expect(walks).toEqual([])
  })

  it('keeps a name it has no title for out of what goes out', () => {
    expect(documentTitle(document)).toBe(document.title)
    release.push(takenBy(document, 'title', document.createElement('form')))
    expect(documentTitle(document)).toBe('')
    release.push(takenBy(document, 'title', window))
    expect(documentTitle(document)).toBe('')
  })
})

describe('masking inside a shadow root', () => {
  const SECRET = 'Maya Lopez, card 4242'

  function component(attributes: string, inner: string) {
    document.body.innerHTML = `<section><h2>Account</h2><my-card ${attributes}></my-card></section>`
    const host = query('my-card')
    host.attachShadow({ mode: 'open' }).innerHTML = inner
    return host.shadowRoot!
  }

  const captured = (element: Element) => JSON.stringify([createAnchor(element, { x: 1, y: 1 }), elementText(element), describeElement(element), sectionName(element)])

  it('reaches from the mark on the host to what is inside it', () => {
    const shadow = component('data-mostra-mask', `<div class="inner"><p>${SECRET}</p><button>Pay ${SECRET}</button></div>`)
    for (const selector of ['p', 'button', '.inner']) {
      const element = shadow.querySelector(selector)!
      expect(isMasked(element), selector).toBe(true)
      expect(captured(element), selector).not.toContain('4242')
      expect(elementText(element)).toBe('[masked]')
    }
    expect(shadow.querySelector('button') && describeElement(shadow.querySelector('button')!)).toBe("'[masked]' button")
  })

  it('reaches from a mark above the host', () => {
    component('', `<p>${SECRET}</p>`)
    const wrapper = document.createElement('div')
    wrapper.setAttribute('data-mostra-mask', '')
    query('my-card').before(wrapper)
    wrapper.appendChild(query('my-card'))
    const inner = query('my-card').shadowRoot!.querySelector('p')!
    expect(isMasked(inner)).toBe(true)
    expect(captured(inner)).not.toContain('4242')
  })

  it('reaches through a component inside a component', () => {
    const shadow = component('data-mostra-mask', `<my-inner></my-inner>`)
    const deeper = shadow.querySelector('my-inner')!.attachShadow({ mode: 'open' })
    deeper.innerHTML = `<p>${SECRET}</p>`
    expect(isMasked(deeper.querySelector('p')!)).toBe(true)
    expect(captured(deeper.querySelector('p')!)).not.toContain('4242')
  })

  it('reaches to text sitting straight under the shadow root', () => {
    const shadow = component('data-mostra-mask', SECRET)
    const text = shadow.firstChild!
    expect(isMasked(text)).toBe(true)
    const range = document.createRange()
    range.setStart(text, 0)
    range.setEnd(text, 5)
    expect(createSelectionAnchor(range).text_quote?.exact).toBe('[masked]')
    expect(JSON.stringify(createSelectionAnchor(range))).not.toContain('4242')
  })

  it('still hides a field straight under the shadow root of a marked host', () => {
    const shadow = component('data-mostra-mask', `<textarea aria-label="Maya's notes">${SECRET}</textarea>`)
    expect(describeElement(shadow.querySelector('textarea')!)).toBe("'[masked]' field")
  })

  it('counts what someone typed in a shadow root, and in an editor around the host', () => {
    const shadow = component('', `<div contenteditable="true"><p>${SECRET}</p></div>`)
    expect(captured(shadow.querySelector('p')!)).not.toContain('4242')
    component('contenteditable="true"', `<p>${SECRET}</p>`)
    expect(captured(query('my-card').shadowRoot!.querySelector('p')!)).not.toContain('4242')
  })

  it('leaves an unmarked component alone', () => {
    const shadow = component('', `<button>Choose Pro</button>`)
    const button = shadow.querySelector('button')!
    expect(isMasked(button)).toBe(false)
    expect(elementText(button)).toBe('Choose Pro')
  })
})

describe('masking', () => {
  it('stores text inside [data-mostra-mask] as [masked] in the text, the label and the text selector', () => {
    document.body.innerHTML = `<p class="greeting">Signed in as <span data-mostra-mask>maya@lumen.app</span></p>`
    const anchor = createAnchor(query('p'), { x: 0, y: 0 })

    expect(anchor.element_text).toBe('Signed in as [masked]')
    expect(anchor.label).toBe('"Signed in as [masked]"')
    expect(anchor.selectors).toContainEqual({ type: 'text', tag: 'p', value: 'Signed in as [masked]' })
    expect(JSON.stringify(anchor)).not.toContain('maya@lumen.app')
  })

  it('leaves the text selector out for a masked element and labels it [masked]', () => {
    document.body.innerHTML = `<div data-mostra-mask><button>Pay Maya Lopez</button></div>`
    const button = query('button')
    const anchor = createAnchor(button, { x: 0, y: 0 })

    expect(isMasked(button)).toBe(true)
    expect(anchor.selectors.some((selector) => selector.type === 'text')).toBe(false)
    expect(anchor.element_text).toBe('[masked]')
    expect(anchor.label).toBe("'[masked]' button")
    expect(JSON.stringify(anchor)).not.toContain('Maya')
  })

  it('never captures what is typed into a field', () => {
    document.body.innerHTML = `<form><label for="note">Note</label><textarea id="note">draft text</textarea><input id="email" placeholder="Email"></form>`
    query<HTMLTextAreaElement>('textarea').value = 'secret typed words'
    query<HTMLInputElement>('input').value = 'maya@lumen.app'

    const form = createAnchor(query('form'), null)
    const field = createAnchor(query('input'), null)

    expect(JSON.stringify(form)).not.toMatch(/secret|draft text|maya@/)
    expect(JSON.stringify(field)).not.toContain('maya@')
    expect(field.label).toBe("'Email' field")
  })
})

describe('describeElement', () => {
  it('names controls by their accessible name and a noun', () => {
    expect(label(`<button>Choose Pro</button>`, 'button')).toBe("'Choose Pro' button")
    expect(label(`<button aria-label="Close dialog"><svg></svg></button>`, 'button')).toBe("'Close dialog' button")
    expect(label(`<a href="/pricing">Pricing</a>`, 'a')).toBe("'Pricing' link")
    expect(label(`<h2>Simple pricing</h2>`, 'h2')).toBe("'Simple pricing' heading")
    expect(label(`<img alt="Team photo" src="x.png">`, 'img')).toBe("'Team photo' image")
    expect(label(`<span id="l">Billing</span><div role="tab" aria-labelledby="l">B</div>`, '[role="tab"]')).toBe("'Billing' tab")
    expect(label(`<div role="menuitem">Log out</div>`, '[role="menuitem"]')).toBe("'Log out' menu item")
    expect(label(`<div role="switch">Dark mode</div>`, '[role="switch"]')).toBe("'Dark mode' switch")
    expect(label(`<div role="dialog" aria-label="Invite people"><p>Hi</p></div>`, '[role="dialog"]')).toBe("'Invite people' dialog")
    expect(label(`<input type="submit" value="Sign up">`, 'input')).toBe("'Sign up' button")
  })

  it('names form fields by their label or placeholder, never their value', () => {
    expect(label(`<label>Email <input type="email" value="maya@lumen.app"></label>`, 'input')).toBe("'Email' field")
    expect(label(`<label for="plan">Plan</label><select id="plan"><option>Pro</option></select>`, 'select')).toBe("'Plan' dropdown")
    expect(label(`<label><input type="checkbox"> Remember me</label>`, 'input')).toBe("'Remember me' checkbox")
    expect(label(`<select><option>Monthly</option></select>`, 'option')).toBe("'Monthly' option")
    expect(label(`<input placeholder="Search docs" value="private query">`, 'input')).toBe("'Search docs' field")
    expect(label(`<input value="private query">`, 'input')).toBe('Field')
  })

  it('names sections by their label or first heading', () => {
    expect(label(`<section><h2>Plans</h2><p>Pick one</p></section>`, 'section')).toBe("'Plans' section")
    expect(label(`<nav aria-label="Main"><a href="/">Home</a></nav>`, 'nav')).toBe("'Main' navigation")
    expect(label(`<div class="plan"><h3>Pro</h3><p>Unlimited dashboards, daily reports and alerts for everyone</p></div>`, '.plan')).toBe("'Pro' section")
  })

  it('quotes plain text', () => {
    expect(label(`<p>$24 per seat / month</p>`, 'p')).toBe('"$24 per seat / month"')
    expect(label(`<li>Unlimited dashboards</li>`, 'li')).toBe('"Unlimited dashboards"')
    expect(label(`<div>Free for small teams</div>`, 'div')).toBe('"Free for small teams"')
  })

  it('calls a large svg a diagram when it has words in it, and an image when not', () => {
    const large = (html: string) => {
      document.body.innerHTML = html
      const svg = document.querySelector('svg')!
      svg.getBoundingClientRect = () => ({ width: 800, height: 400 }) as DOMRect
      return describeElement(svg)
    }
    expect(large(`<svg><text>Your live site</text></svg>`)).toBe('Diagram')
    expect(large(`<svg><circle r="4"></circle></svg>`)).toBe('Image')
  })

  it('falls back to the noun alone', () => {
    expect(label(`<img src="x.png">`, 'img')).toBe('Image')
    expect(label(`<svg></svg>`, 'svg')).toBe('Icon')
    expect(label(`<nav><a href="/">Home</a></nav>`, 'nav')).toBe('Navigation')
    expect(label(`<header><a href="/">Home</a></header>`, 'header')).toBe('Header')
    expect(label(`<footer>© Lumen</footer>`, 'footer')).toBe('Footer')
    expect(label(`<main><p>Hi</p></main>`, 'main')).toBe('Main content')
    expect(label(`<form><input></form>`, 'form')).toBe('Form')
    expect(label(`<ul><li>One</li></ul>`, 'ul')).toBe('List')
    expect(label(`<table><tr><td>1</td></tr></table>`, 'table')).toBe('Table')
    expect(label(`<section><p>Text only</p></section>`, 'section')).toBe('Section')
    expect(label(`<div class="spacer"></div>`, 'div')).toBe('Area')
  })

  it('cuts long names at a word boundary with an ellipsis', () => {
    const text = 'Analytics your whole team actually reads every single Monday morning'
    expect(label(`<h1>${text}</h1>`, 'h1')).toBe("'Analytics your whole team actually reads…' heading")
    expect(label(`<p>${text}</p>`, 'p')).toBe('"Analytics your whole team actually reads…"')
  })
})

describe('createSelectionAnchor', () => {
  it('quotes the selected text with up to 32 characters of context from the same block', () => {
    document.body.innerHTML = `<div class="plan"><p class="price">$24 <strong>per workspace</strong> / month, billed yearly to your card on file</p></div>`
    const strong = query('strong')
    layout(strong, box(100, 200, 120, 20))
    const range = document.createRange()
    range.setStart(strong.firstChild!, 4)
    range.setEnd(strong.firstChild!, 13)

    const anchor = createSelectionAnchor(range)

    expect(anchor.text_quote).toEqual({ exact: 'workspace', prefix: '$24 per', suffix: '/ month, billed yearly to your c' })
    expect(anchor.label).toBe('"workspace"')
    expect(anchor.selectors).toContainEqual({ type: 'text', tag: 'strong', value: 'per workspace' })
  })

  it('masks a selection inside a masked area', () => {
    document.body.innerHTML = `<p>Account <span data-mostra-mask>4242 4242</span></p>`
    const span = query('span')
    const range = document.createRange()
    range.selectNodeContents(span)

    const anchor = createSelectionAnchor(range)

    expect(anchor.text_quote?.exact).toBe('[masked]')
    expect(JSON.stringify(anchor)).not.toContain('4242')
  })
})

describe('anchorTarget', () => {
  it('pins icon internals to the control around them', () => {
    document.body.innerHTML = `<button><svg><g><path d="M0 0"></path></g></svg> Save</button>`
    expect(anchorTarget(query('path'))).toBe(query('button'))
  })

  it('pins standalone graphics to the outermost svg', () => {
    document.body.innerHTML = `<figure><svg class="chart"><svg><circle r="2"></circle></svg></svg></figure>`
    expect(anchorTarget(query('circle'))).toBe(query('svg.chart'))
  })

  it('leaves ordinary elements alone', () => {
    document.body.innerHTML = `<p><span>Hi</span></p>`
    expect(anchorTarget(query('span'))).toBe(query('span'))
  })
})

describe('helpers', () => {
  it('escapes identifiers like CSS.escape', () => {
    expect(cssIdent('1st')).toBe('\\31 st')
    expect(cssIdent('-2x')).toBe('-\\32 x')
    expect(cssIdent('a.b')).toBe('a\\.b')
    expect(cssIdent('-')).toBe('\\-')
  })

  it('collapses whitespace in element text', () => {
    document.body.innerHTML = `<p>  Hello
      <b>world</b>  </p>`
    expect(elementText(query('p'))).toBe('Hello world')
  })
})

describe('sectionName', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <main>
        <h1>Simple pricing</h1>
        <div class="plans">
          <article id="starter"><h3>Starter</h3><p id="starter-price">$29</p><a id="starter-link" href="#">Start</a></article>
          <article id="growth"><h3 id="growth-title">Growth</h3><p id="growth-price">$99</p></article>
        </div>
        <section id="faq"><h2 id="faq-title">Questions</h2><h3 id="question">Can I switch?</h3><p id="answer">Yes.</p></section>
      </main>`
  })

  const section = (selector: string) => sectionName(query(selector))

  it('names the heading over a plain element, so three buttons read differently', () => {
    expect(section('#starter-link')).toBe('Starter')
    expect(section('#growth-price')).toBe('Growth')
    expect(section('#answer')).toBe('Can I switch?')
  })

  it('does not put a part under the part before it', () => {
    expect(section('#growth')).toBe('Simple pricing')
    expect(section('#growth-title')).toBe('Simple pricing')
    expect(section('#faq')).toBe('Simple pricing')
    expect(section('#faq-title')).toBe('Simple pricing')
  })

  it('puts a lower heading under the one above its level', () => {
    expect(section('#question')).toBe('Questions')
  })

  it('reads an aria-level', () => {
    document.body.innerHTML = '<main><h2>Plans</h2><div><div id="sub" role="heading" aria-level="3">Growth</div><div id="peer" role="heading" aria-level="2">FAQ</div></div></main>'
    expect(section('#sub')).toBe('Plans')
    expect(section('#peer')).toBeNull()
  })
})
