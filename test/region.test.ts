import { beforeEach, describe, expect, it, vi } from 'vitest'
import { backdropOf, captureRegion, colorName, type Region } from '../src/region'

const byId = (id: string) => document.getElementById(id)!
const notOwn = (element: Element) => element.id === 'own'

function outline(region: Region, index = 0): unknown {
  const node = region.nodes[index]!
  return { tag: node.tag, ...(node.look ? { look: node.look } : {}), ...(node.cut ? { cut: true } : {}), content: node.content.map((item) => (typeof item === 'number' ? outline(region, item) : item)) }
}

beforeEach(() => {
  document.body.innerHTML = `
    <main>
      <section id="talk" style="background-color: rgb(255, 233, 77)">
        <div id="inner">
          <h2 id="title" style="font-size: 48px; font-weight: 700">Talk while you look around.</h2>
          <p id="deck">Press Talk, use the site as usual and say what you think.</p>
          <div><div><span>Wrapped words</span></div></div>
          <input id="email" placeholder="Work email" value="secret@example.com">
          <div data-mostra-mask><p>Card 4242</p></div>
          <button id="own">Toolbar</button>
        </div>
      </section>
    </main>`
})

describe('captureRegion', () => {
  it('takes the part around what the pointer is on, and the named part above it with its background', () => {
    const region = captureRegion(byId('deck'), notOwn)!

    expect(outline(region)).toEqual({
      tag: 'section',
      look: { bg: 'yellow', name: "'Talk while you look around.' section" },
      content: [
        {
          tag: 'div',
          content: [
            { tag: 'h2', look: { size: '48px', weight: 'bold' }, content: ['Talk while you look around.'] },
            { tag: 'p', content: ['Press Talk, use the site as usual and say what you think.'] },
            'Wrapped words',
            { tag: 'input', look: { name: "'Work email' field" }, content: [] },
          ],
        },
      ],
    })
    expect(region.elements[3]).toBe(byId('deck'))
    expect(region.nodes[3]!.anchor).toMatchObject({ label: '"Press Talk, use the site as usual and…"', element_text: 'Press Talk, use the site as usual and say what you think.' })
  })

  it('never takes what was typed into a field, masked text or the overlay', () => {
    const region = captureRegion(byId('deck'), notOwn)!
    const json = JSON.stringify(region)
    expect(json).not.toContain('secret')
    expect(json).not.toContain('4242')
    expect(region.elements).not.toContain(byId('own'))
    expect(JSON.stringify(region.nodes.map((node) => node.content))).not.toContain('Toolbar')
  })

  it('takes nothing around a field someone types in, which a page can copy into the elements beside it', () => {
    document.body.innerHTML = `
      <form id="reply"><h3>Reply to the thread</h3>
        <div class="mentions"><div class="highlighter" style="color: transparent">my private note to @bob</div><textarea id="field">my private note to @bob</textarea></div>
        <button id="send">Send</button>
      </form>`
    expect(captureRegion(byId('field'), notOwn)).toBeNull()
    expect(captureRegion(byId('send'), notOwn)).toBeNull()

    document.body.innerHTML = `<form><section><h3>Plan</h3><p id="plan">Pro</p></section><div contenteditable="true">typed words</div></form>`
    const region = captureRegion(byId('plan'), notOwn)!
    expect(region.nodes[0]!.tag).toBe('section')
    expect(JSON.stringify(region)).not.toContain('typed words')
  })

  it('never takes text drawn transparent', () => {
    document.body.innerHTML = `<section><h3>Card</h3><p id="seen">Seen</p><p style="color: transparent">Hidden copy</p></section>`
    expect(JSON.stringify(captureRegion(byId('seen'), notOwn)!.nodes.map((node) => node.content))).not.toContain('Hidden copy')
  })

  it('keeps to a few dozen elements, and always the one the pointer is on', () => {
    document.body.innerHTML = `<section><h2>Plans</h2><ul id="list">${Array.from({ length: 80 }, (_unused, index) => `<li id="item-${index}">Item ${index}</li>`).join('')}</ul></section>`
    const region = captureRegion(byId('item-79'), notOwn)!

    expect(region.nodes.length).toBeLessThanOrEqual(30)
    expect(region.elements).toContain(byId('item-79'))
    const list = region.nodes[region.elements.indexOf(byId('list'))]!
    expect(list.cut).toBe(true)
  })

  it('shows a background of its own on a part, and says what one further out it sits on', () => {
    document.body.innerHTML = `<div style="background-color: rgb(20, 40, 160)"><section><h2>Plans</h2><article id="card"><h3>Pro</h3><p id="price">$24</p></article></section></div>`
    expect(captureRegion(byId('price'), notOwn)!.nodes[0]).toMatchObject({ tag: 'div', look: { bg: 'blue' } })

    document.body.innerHTML = `<div style="background-color: rgb(20, 40, 160)"><section><h2>Plans</h2><section><h3>Monthly</h3><article id="card"><h4>Pro</h4><p id="price">$24</p></article></section></section></div>`
    expect(captureRegion(byId('price'), notOwn)!.nodes[0]).toMatchObject({ tag: 'section', look: { on: 'blue' } })
  })

  it('takes nothing around what is as big as the screen', () => {
    vi.spyOn(byId('talk'), 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, width: 3000, height: 3000, top: 0, left: 0, right: 3000, bottom: 3000, toJSON: () => ({}) })
    expect(captureRegion(byId('talk'), notOwn)).toBeNull()
  })
})

describe('backdropOf', () => {
  it('names the background the words sit on, from the nearest element that paints one', () => {
    expect(backdropOf(byId('deck').firstChild!, window)).toBe('yellow')
    expect(backdropOf(byId('title'), window)).toBe('yellow')
  })
  it('falls back to white where nothing paints a background', () => {
    document.body.innerHTML = '<p id="plain">Plain words</p>'
    expect(backdropOf(byId('plain').firstChild!, window)).toBe('white')
  })
})

describe('colorName', () => {
  it('names a color as a person would', () => {
    expect(colorName('rgb(255, 233, 77)')).toBe('yellow')
    expect(colorName('rgb(255, 255, 255)')).toBe('white')
    expect(colorName('rgb(17, 17, 16)')).toBe('black')
    expect(colorName('rgb(229, 72, 77)')).toBe('red')
    expect(colorName('rgb(62, 99, 221)')).toBe('blue')
    expect(colorName('rgb(220, 235, 255)')).toBe('light blue')
    expect(colorName('rgba(0, 0, 0, 0)')).toBe('black')
    expect(colorName('transparent')).toBeNull()
  })
})
