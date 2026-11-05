import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyTrack, MAX_TRACK_ELEMENTS, recordPointer, type PointerRecording, type PointerTrack } from '../src/pointer-track'

let clock = 0
let recording: PointerRecording | null = null

function record(track: PointerTrack = emptyTrack()) {
  recording = recordPointer(window, track, {
    isOwnEvent: (event) => (event.target as Element)?.id === 'own',
    isOwnElement: (element) => element.id === 'own',
    now: () => clock,
    pageUrl: () => '/pricing',
    pageTitle: () => 'Pricing',
  })
  return track
}

function move(element: Element, at: number, x = 10, y = 10, pointerType = 'mouse') {
  clock = at
  element.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, composed: true, pointerType, clientX: x, clientY: y }))
}

async function wait(ms: number) {
  clock += ms
  await vi.advanceTimersByTimeAsync(ms)
}

const byId = (id: string) => document.getElementById(id)!

beforeEach(() => {
  vi.useFakeTimers()
  clock = 0
  document.body.innerHTML = `
    <section><h2>Pro</h2><button id="pro">Get started</button></section>
    <section><h2>Team</h2><button id="team">Get started</button></section>
    <p id="text">Plain words</p>
    <button id="own">Toolbar</button>`
})

afterEach(() => {
  recording?.stop()
  recording = null
  vi.useRealTimers()
})

describe('recordPointer', () => {
  it('names what the pointer stays on, with the section it sits in', async () => {
    const track = record()

    move(byId('pro'), 1000)
    await wait(100)

    expect(track.elements).toHaveLength(1)
    expect(track.elements[0]).toMatchObject({ page_url: '/pricing', page_title: 'Pricing', context: 'Pro', anchor: { element_text: 'Get started' } })
    expect(track.spans).toEqual([[1000, 0, 'm']])
  })

  it('keeps the part of the page around what it names, once for everything named in it', async () => {
    const track = record()

    move(byId('pro'), 1000)
    await wait(100)
    move(document.querySelector('section h2')!, 1200)
    await wait(100)
    move(byId('team'), 1400)
    await wait(100)

    expect(track.regions.map((region) => region.nodes.map((node) => node.tag))).toEqual([
      ['section', 'h2', 'button'],
      ['section', 'h2', 'button'],
    ])
    expect(track.regions[0]!.page_url).toBe('/pricing')
    expect(track.elements.map((element) => element.region)).toEqual([
      [0, 2],
      [0, 1],
      [1, 2],
    ])
  })

  it('tells same-named elements apart by their section', async () => {
    const track = record()

    move(byId('pro'), 0)
    await wait(100)
    move(byId('team'), 1000)
    await wait(100)

    expect(track.elements.map((element) => element.context)).toEqual(['Pro', 'Team'])
  })

  it('keeps passing over something as nothing, and names nothing for it', async () => {
    const track = record()

    move(byId('pro'), 0)
    await wait(30)
    move(byId('text'), 30)
    await wait(100)

    expect(track.elements.map((element) => element.anchor.element_text)).toEqual(['Plain words'])
    expect(track.spans).toEqual([
      [0, null, 'm'],
      [30, 0, 'm'],
    ])
  })

  it('names an element once, however often the pointer comes back', async () => {
    const track = record()

    move(byId('pro'), 0)
    await wait(100)
    move(byId('text'), 1000)
    await wait(100)
    move(byId('pro'), 2000)

    expect(track.elements).toHaveLength(2)
    expect(track.spans.map(([at, element]) => [at, element])).toEqual([
      [0, 0],
      [1000, 1],
      [2000, 0],
    ])
  })

  it('takes the overlay, the page itself and touch as nothing', async () => {
    const track = record()

    move(byId('pro'), 0)
    await wait(100)
    move(byId('own'), 500)
    await wait(100)
    move(document.body, 1000)
    await wait(100)
    move(byId('text'), 2000, 10, 10, 'touch')
    await wait(100)

    expect(track.elements).toHaveLength(1)
    expect(track.spans).toEqual([
      [0, 0, 'm'],
      [500, null, 'm'],
    ])
  })

  it('keeps the path while the pointer moves, at most every 50 ms', async () => {
    const track = record()

    move(byId('pro'), 0, 1, 1)
    move(byId('pro'), 20, 2, 2)
    move(byId('pro'), 60, 3, 3)
    move(byId('pro'), 900, 4, 4)

    expect(track.path).toEqual([
      [0, 1, 1],
      [60, 3, 3],
      [900, 4, 4],
    ])
  })

  it('sees what a scroll brought under a still pointer, and the heading being read', async () => {
    const track = record()
    move(byId('pro'), 0, 40, 40)
    await wait(100)
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(byId('team'))
    vi.spyOn(byId('team').previousElementSibling!, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 10, 100, 20))

    clock = 1000
    window.dispatchEvent(new Event('scroll'))
    await wait(300)

    expect(track.scrolls.map(([at, , heading]) => [at, heading])).toEqual([
      [1000, null],
      [1300, 'Team'],
    ])
    expect(track.spans.at(-1)).toEqual([1300, 1, 's'])
  })

  it('ends the last span when the pointer leaves the page or the page goes away', async () => {
    const track = record()

    move(byId('pro'), 0)
    await wait(100)
    clock = 800
    recording!.leave()
    move(byId('pro'), 1500)

    expect(track.spans).toEqual([
      [0, 0, 'm'],
      [800, null, 'm'],
      [1500, 0, 'm'],
    ])
  })

  it('stops naming past the cap, and keeps recording where the pointer goes', async () => {
    const track = record({ ...emptyTrack(), elements: Array.from({ length: MAX_TRACK_ELEMENTS }, () => ({ page_url: '/', page_title: null, anchor: { selectors: [] }, context: null })) })

    move(byId('pro'), 0)
    await wait(100)

    expect(track.elements).toHaveLength(MAX_TRACK_ELEMENTS)
    expect(track.spans).toEqual([[0, null, 'm']])
    expect(track.path).toHaveLength(1)
  })
})
