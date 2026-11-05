import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyTrack, type PointerTrack } from '../src/pointer-track'
import { safeStorage } from '../src/storage'
import type { TalkStatus, Transcription } from '../src/protocol'
import { createTalk, TalkRefused, type OnPreparing, type Talk, type TalkBackend, type TalkCapture, type TalkEvent, type TalkListener, type TalkOutcome, type TalkState, type Utterance } from '../src/talk'
import { flush, makeComment, setUrl } from './helpers'

const KEY = 'mostra:test:talk'
const running: Talk[] = []

const ME = 'person-me'

function fakeBackend(outcomes: TalkOutcome[] = [{ status: 'done', comments: [], minutes_left: 29 }]) {
  const calls = { record: [] as Array<{ id: string; offset: number }>, submit: [] as Array<{ id: string; timeline: TalkEvent[]; utterances: Utterance[]; track: PointerTrack; duration: number; transcription: Transcription | null }>, forget: [] as string[], forgotten: [] as Array<Transcription | null>, stop: 0 }
  let listener: TalkListener | null = null
  let refuse: unknown = null
  let duringSubmit: ((onPreparing: OnPreparing) => void) | null = null
  const backend: TalkBackend = {
    pick: (transcribers) => transcribers[0] ?? null,
    async record(id, offset, _transcription, given) {
      if (refuse) throw refuse
      calls.record.push({ id, offset })
      listener = given
      return {
        stop() {
          calls.stop += 1
          return Promise.resolve()
        },
      }
    },
    async submit(id, { timeline, utterances, track, durationMs, transcription }, onPreparing) {
      calls.submit.push({ id, timeline: [...timeline], utterances: [...utterances], track: structuredClone(track), duration: durationMs, transcription })
      duringSubmit?.(onPreparing!)
      return outcomes.length > 1 ? outcomes.shift()! : outcomes[0]!
    },
    async forget(id, transcription) {
      calls.forget.push(id)
      calls.forgotten.push(transcription)
    },
  }
  return { backend, calls, listener: () => listener!, refuseWith: (error: unknown) => (refuse = error), whileSubmitting: (work: (onPreparing: OnPreparing) => void) => (duringSubmit = work) }
}

function setup(backend: TalkBackend, status: TalkStatus | null = { minutes_left: 30, max_duration_ms: 60_000, transcribers: ['browser'] }, named = () => true, reviewerId = ME) {
  const states: Array<TalkState | null> = []
  const notify = vi.fn()
  const onDone = vi.fn()
  const talk = createTalk({
    window,
    backend,
    session: safeStorage(window, 'sessionStorage'),
    key: KEY,
    isOwnEvent: (event) => (event.target as Element)?.id === 'own',
    isOwnElement: (element) => element.id === 'own',
    viewport: () => ({ width: 1440, height: 900, scroll_x: 0, scroll_y: 0, device_pixel_ratio: 1 }),
    status: () => status,
    named,
    reviewerId: () => reviewerId,
    onChange: (state) => states.push(state),
    onDone,
    notify,
  })
  running.push(talk)
  return { talk, states, notify, onDone, last: () => states.at(-1) }
}

beforeEach(() => {
  setUrl('/pricing')
  window.sessionStorage.clear()
  document.body.innerHTML = '<button id="buy">Buy</button><button id="own">Toolbar</button>'
})

afterEach(() => {
  vi.useRealTimers()
  for (const talk of running.splice(0)) talk.destroy()
})

const done = (timeline: TalkEvent[]) => timeline.filter((event) => event.type !== 'element')

const hover = (id: string) => document.getElementById(id)!.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, composed: true, pointerType: 'mouse', clientX: 5, clientY: 5 }))

function savedPass(_page: ReturnType<typeof setup>): string {
  window.dispatchEvent(new Event('pagehide'))
  return window.sessionStorage.getItem(KEY)!
}

describe('createTalk (ux.md 4.7)', () => {
  it('records from Talk to Stop, then hands over the posted comments and forgets the audio', async () => {
    const comment = makeComment({ id: 'c1', number: 41, body: 'Too small.', source: 'spoken', talk_id: 't1' })
    const fake = fakeBackend([{ status: 'done', comments: [comment], minutes_left: 27 }])
    const { talk, last, onDone } = setup(fake.backend)

    await talk.start()
    expect(last()).toMatchObject({ phase: 'recording' })

    await talk.stop()
    await flush()

    expect(last()).toBeNull()
    expect(onDone).toHaveBeenCalledWith([comment], 27)
    expect(fake.calls.stop).toBe(1)
    expect(fake.calls.forget).toEqual([fake.calls.record[0]!.id])
    expect(window.sessionStorage.getItem(KEY)).toBeNull()
  })

  it('waits for a guest to give a name before sending anything, across a page load', async () => {
    const fake = fakeBackend()
    let named = false
    const first = setup(fake.backend, undefined, () => named)

    await first.talk.start()
    await first.talk.stop()

    expect(first.last()).toEqual({ phase: 'naming' })
    expect(fake.calls.submit).toEqual([])
    const saved = savedPass(first)
    first.talk.destroy()

    window.sessionStorage.setItem(KEY, saved)
    const next = setup(fake.backend, undefined, () => named)
    await next.talk.resume()
    expect(next.last()).toEqual({ phase: 'naming' })
    expect(fake.calls.submit).toEqual([])

    named = true
    await next.talk.retry()

    expect(fake.calls.submit).toHaveLength(1)
    expect(next.last()).toBeNull()
    expect(next.onDone).toHaveBeenCalledWith([], 29)
  })

  it('asks for a name when the server says the guest has none', async () => {
    const fake = fakeBackend([{ status: 'name_required' }, { status: 'done', comments: [], minutes_left: 29 }])
    const { talk, last } = setup(fake.backend)

    await talk.start()
    await talk.stop()
    expect(last()).toEqual({ phase: 'naming' })

    await talk.retry()
    expect(last()).toBeNull()
    expect(fake.calls.submit).toHaveLength(2)
  })

  it('lets a guest discard the recording instead of giving a name', async () => {
    const fake = fakeBackend()
    const { talk, last } = setup(fake.backend, undefined, () => false)

    await talk.start()
    await talk.stop()
    await talk.drop()

    expect(last()).toBeNull()
    expect(fake.calls.forget).toEqual([fake.calls.record[0]!.id])
    expect(window.sessionStorage.getItem(KEY)).toBeNull()
  })

  it('records clicks and pages on the talk clock, and ignores the overlay', async () => {
    const fake = fakeBackend()
    const { talk } = setup(fake.backend)

    await talk.start()
    document.getElementById('buy')!.click()
    document.getElementById('own')!.click()
    setUrl('/about')
    talk.pageChanged()
    await talk.stop()

    const timeline = done(fake.calls.submit[0]!.timeline)
    expect(timeline.map((event) => event.type)).toEqual(['page', 'click', 'page'])
    expect(timeline[0]!.page_url).toBe('/pricing')
    expect(timeline[1]!.anchor?.element_text).toBe('Buy')
    expect(timeline[2]!.page_url).toBe('/about')
  })

  it('sends nothing typed into a field to the model, whether clicked on or in the outline', async () => {
    document.body.innerHTML = `
      <label>Note <textarea data-testid="note">my card is 4242</textarea></label>
      <div data-testid="reply" contenteditable="true" aria-label="Reply">my card is 4242</div>`
    Object.defineProperty(HTMLElement.prototype, 'innerText', { configurable: true, get() { return this.textContent } })
    for (const element of document.querySelectorAll('label, textarea, div')) vi.spyOn(element, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList)
    const fake = fakeBackend()
    const { talk } = setup(fake.backend)

    await talk.start()
    document.querySelector('textarea')!.click()
    document.querySelector('div')!.click()
    await talk.stop()

    const { timeline } = fake.calls.submit[0]!
    expect(timeline.filter((event) => event.type === 'click')).toHaveLength(2)
    expect(timeline.filter((event) => event.type === 'element').map((event) => event.anchor?.element_text)).toEqual(['Note'])
    expect(JSON.stringify(timeline)).not.toContain('4242')
  })

  it('sends an outline of the page, so the model can place what wasn\'t pointed at', async () => {
    document.body.innerHTML = `
      <h1>Pricing that grows</h1>
      <button>Buy</button>
      <button hidden>Hidden</button>
      <p>Plain text is not an element worth naming.</p>
      <h2 data-mostra-mask>Acme Corp secret plan</h2>`
    Object.defineProperty(HTMLElement.prototype, 'innerText', { configurable: true, get() { return this.textContent } })
    const fake = fakeBackend()
    const { talk } = setup(fake.backend)

    await talk.start()
    await talk.stop()

    const outline = fake.calls.submit[0]!.timeline.filter((event) => event.type === 'element')
    const names = outline.map((event) => event.anchor?.element_text)
    expect(names).toContain('Pricing that grows')
    expect(names).toContain('Buy')
    expect(names).not.toContain('Plain text is not an element worth naming.')
    expect(JSON.stringify(outline)).not.toContain('secret')
    expect(outline[0]!.anchor?.spec).toBeUndefined()
    delete (HTMLElement.prototype as { innerText?: string }).innerText
  })

  it('keeps same-named elements in the outline when they sit under different headings', async () => {
    document.body.innerHTML = '<section><h2>Pro</h2><button>Get started</button></section><section><h2>Team</h2><button>Get started</button></section>'
    Object.defineProperty(HTMLElement.prototype, 'innerText', { configurable: true, get() { return this.textContent } })
    const fake = fakeBackend()
    const { talk } = setup(fake.backend)

    await talk.start()
    await talk.stop()

    const started = fake.calls.submit[0]!.timeline.filter((event) => event.type === 'element' && event.anchor?.element_text === 'Get started')
    expect(started.map((event) => event.context)).toEqual(['Pro', 'Team'])
    delete (HTMLElement.prototype as { innerText?: string }).innerText
  })

  it('sends everything the pointer did with the pass', async () => {
    vi.useFakeTimers()
    const fake = fakeBackend()
    const { talk } = setup(fake.backend)

    await talk.start()
    hover('buy')
    await vi.advanceTimersByTimeAsync(500)
    await talk.stop()

    const { track } = fake.calls.submit[0]!
    expect(track.elements.map((element) => element.anchor.element_text)).toEqual(['Buy'])
    expect(track.spans.map(([, element]) => element)).toEqual([0, null])
    expect(track.path).toHaveLength(1)
  })

  it('carries the pointer track across a full page load, with nothing under the pointer in between', async () => {
    vi.useFakeTimers()
    const fake = fakeBackend()
    const first = setup(fake.backend)
    await first.talk.start()
    hover('buy')
    await vi.advanceTimersByTimeAsync(500)
    window.dispatchEvent(new Event('pagehide'))
    first.talk.destroy = () => {}
    running.length = 0
    setUrl('/about')
    document.body.innerHTML = '<a id="story" href="#story">Our story</a>'

    const second = setup(fake.backend)
    await second.talk.resume()
    await vi.advanceTimersByTimeAsync(300)
    hover('story')
    await vi.advanceTimersByTimeAsync(500)
    await second.talk.stop()

    const { track } = fake.calls.submit[0]!
    expect(track.elements.map((element) => [element.page_url, element.anchor.element_text])).toEqual([
      ['/pricing', 'Buy'],
      ['/about', 'Our story'],
    ])
    expect(track.spans.map(([, element]) => element)).toEqual([0, null, 1, null])
  })

  it('gives every event its own id, outline included', async () => {
    const fake = fakeBackend()
    const { talk } = setup(fake.backend)

    await talk.start()
    await talk.stop()

    const ids = fake.calls.submit[0]!.timeline.map((event) => event.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('refuses when this browser can do none of the transcribers', async () => {
    const fake = fakeBackend()
    const { talk, notify } = setup({ ...fake.backend, pick: () => null })

    await talk.start()

    expect(fake.calls.record).toHaveLength(0)
    expect(notify).toHaveBeenCalledWith("This browser can't record here. Comment works without it.", 'error')
  })

  it('never stops the click reaching the site', async () => {
    const fake = fakeBackend()
    const { talk } = setup(fake.backend)
    const siteHandler = vi.fn()
    document.getElementById('buy')!.addEventListener('click', siteHandler)

    await talk.start()
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    document.getElementById('buy')!.dispatchEvent(click)

    expect(siteHandler).toHaveBeenCalledOnce()
    expect(click.defaultPrevented).toBe(false)
  })

  it('tells the page where its clock is as recording starts, waits for the next page and stops', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const heard: unknown[] = []
    const listen = (event: Event) => heard.push((event as CustomEvent).detail)
    window.addEventListener('mostra:talk', listen)
    try {
      const fake = fakeBackend()
      const first = setup(fake.backend)
      await first.talk.start()
      const id = fake.calls.record[0]!.id
      vi.advanceTimersByTime(2000)
      window.dispatchEvent(new Event('pagehide'))
      first.talk.destroy = () => {}
      running.length = 0

      vi.advanceTimersByTime(700)
      const second = setup(fake.backend)
      await second.talk.resume()
      vi.advanceTimersByTime(1000)
      await second.talk.stop()

      expect(heard.filter((detail) => (detail as { id: string }).id === id)).toEqual([
        { id, state: 'recording', at_ms: 0 },
        { id, state: 'paused', at_ms: 2000 },
        { id, state: 'recording', at_ms: 2000 },
        { id, state: 'stopped', at_ms: 3000 },
      ])
    } finally {
      window.removeEventListener('mostra:talk', listen)
    }
  })

  describe('text selected while talking', () => {
    const LINES = '<p id="first">That’s mostra in the bar at the bottom.</p>\n<p id="second">One script tag adds mostra to your site.</p>\n<p id="far">Pricing</p>'

    async function select(from: string, start: number, to: string, end: number) {
      const range = document.createRange()
      range.setStart(document.getElementById(from)!.firstChild!, start)
      range.setEnd(document.getElementById(to)!.firstChild!, end)
      const selection = window.getSelection()!
      selection.removeAllRanges()
      selection.addRange(range)
      document.dispatchEvent(new Event('selectionchange'))
      await vi.advanceTimersByTimeAsync(500)
    }

    async function selections(steps: (talk: Talk) => Promise<void>) {
      vi.useFakeTimers()
      document.body.innerHTML = LINES
      const fake = fakeBackend()
      const { talk } = setup(fake.backend)
      await talk.start()
      await steps(talk)
      await talk.stop()
      return fake.calls.submit[0]!.timeline.filter((event) => event.type === 'select').map((event) => ({ id: event.id, at_ms: event.at_ms, exact: event.anchor?.text_quote?.exact }))
    }

    it('takes a selection made in steps as the one it became, from the moment it began', async () => {
      const found = await selections(async () => {
        await vi.advanceTimersByTimeAsync(1000)
        await select('first', 2, 'second', 40)
        await vi.advanceTimersByTimeAsync(300)
        await select('first', 0, 'second', 40)
      })
      expect(found).toEqual([{ id: expect.any(String), at_ms: 1500, exact: 'That’s mostra in the bar at the bottom. One script tag adds mostra to your site.' }])
    })

    it('keeps a selection somewhere else as its own, however soon', async () => {
      const found = await selections(async () => {
        await select('first', 0, 'first', 6)
        await select('far', 0, 'far', 7)
      })
      expect(found.map((selection) => selection.exact)).toEqual(['That’s', 'Pricing'])
    })

    it('keeps the same words selected again later as a new selection', async () => {
      const found = await selections(async () => {
        await select('first', 0, 'first', 6)
        await vi.advanceTimersByTimeAsync(3000)
        await select('first', 0, 'first', 13)
      })
      expect(found.map((selection) => selection.exact)).toEqual(['That’s', 'That’s mostra'])
    })
  })

  it('carries on after a full page load, on the same clock', async () => {
    const fake = fakeBackend()
    const first = setup(fake.backend)
    await first.talk.start()
    const id = fake.calls.record[0]!.id
    window.dispatchEvent(new Event('pagehide'))
    first.talk.destroy = () => {}
    running.length = 0

    fake.listener().heard({ at_ms: 500, text: 'on the first page' })
    window.dispatchEvent(new Event('pagehide'))
    const saved = JSON.parse(window.sessionStorage.getItem(KEY)!)
    window.sessionStorage.setItem(KEY, JSON.stringify({ ...saved, elapsed_ms: 8000 }))
    setUrl('/about')

    const second = setup(fake.backend)
    await second.talk.resume()

    expect(fake.calls.record[1]).toEqual({ id, offset: 8000 })
    expect(second.last()).toMatchObject({ phase: 'recording' })

    fake.listener().heard({ at_ms: 9000, text: 'on the second page' })
    await second.talk.stop()
    expect(fake.calls.submit[0]!.utterances.map((utterance) => utterance.text)).toEqual(['on the first page', 'on the second page'])
    const timeline = done(fake.calls.submit[0]!.timeline)
    expect(timeline.map((event) => event.page_url)).toEqual(['/pricing', '/about'])
    expect(timeline[1]!.at_ms).toBeGreaterThanOrEqual(8000)
  })

  it('takes something that is not a pass for nothing', async () => {
    window.sessionStorage.setItem(KEY, JSON.stringify({ id: 't-1', reviewer_id: ME, phase: 'recording', elapsed_ms: 5000, events: [] }))
    const fake = fakeBackend()
    const { talk } = setup(fake.backend)

    await talk.resume()

    expect(fake.calls.record).toHaveLength(0)
  })

  it('clears what closed tabs left as soon as the overlay starts, with no pass here to resume', async () => {
    const fake = fakeBackend()
    const purgeAbandoned = vi.fn(async () => {})
    const { talk } = setup({ ...fake.backend, purgeAbandoned })

    await talk.resume()

    expect(purgeAbandoned).toHaveBeenCalledExactlyOnceWith(null)
    expect(fake.calls.record).toHaveLength(0)
  })

  it('keeps the pass it is resuming out of that, and still carries it on', async () => {
    window.sessionStorage.setItem(KEY, JSON.stringify({ id: 't-1', reviewer_id: ME, phase: 'recording', elapsed_ms: 5000, events: [], utterances: [], transcription: null }))
    const fake = fakeBackend()
    const purgeAbandoned = vi.fn(async () => {})
    const { talk, last } = setup({ ...fake.backend, purgeAbandoned })

    await talk.resume()

    expect(purgeAbandoned).toHaveBeenCalledExactlyOnceWith('t-1')
    expect(fake.calls.record).toEqual([{ id: 't-1', offset: 5000 }])
    expect(last()).toMatchObject({ phase: 'recording' })
  })

  describe('a pass somebody else left in this tab', () => {
    const pass = (phase: string, reviewer_id: string | null = 'person-before') => ({ id: 't-1', reviewer_id, phase, elapsed_ms: 5000, events: [], utterances: [{ at_ms: 1, text: 'what they said' }], transcription: 'local' })

    it.each(['recording', 'turning', 'naming', 'failed'])('is not resumed, offered or sent from %s, and it goes with its audio', async (phase) => {
      window.sessionStorage.setItem(KEY, JSON.stringify(pass(phase)))
      window.sessionStorage.setItem(`${KEY}:track`, JSON.stringify(emptyTrack()))
      const fake = fakeBackend()
      const { talk, last, states } = setup(fake.backend)

      await talk.resume()
      await talk.retry()
      await flush()

      expect(fake.calls.record).toEqual([])
      expect(fake.calls.submit).toEqual([])
      expect(states).toEqual([])
      expect(last()).toBeUndefined()
      expect(fake.calls.forget).toEqual(['t-1'])
      expect(fake.calls.forgotten).toEqual(['local'])
      expect(window.sessionStorage.getItem(KEY)).toBeNull()
      expect(window.sessionStorage.getItem(`${KEY}:track`)).toBeNull()
    })

    it('is not kept out of the clearing of what closed tabs left', async () => {
      window.sessionStorage.setItem(KEY, JSON.stringify(pass('failed')))
      const fake = fakeBackend()
      const purgeAbandoned = vi.fn(async () => {})
      const { talk } = setup({ ...fake.backend, purgeAbandoned })
      await talk.resume()
      expect(purgeAbandoned).toHaveBeenCalledExactlyOnceWith(null)
    })

    it('goes the same way when it says nothing of who said it', async () => {
      const { reviewer_id: _reviewer, ...nameless } = pass('failed')
      window.sessionStorage.setItem(KEY, JSON.stringify(nameless))
      const fake = fakeBackend()
      const { talk } = setup(fake.backend)
      await talk.resume()
      expect(fake.calls.forget).toEqual(['t-1'])
    })

    it('leaves the person free to start their own', async () => {
      window.sessionStorage.setItem(KEY, JSON.stringify(pass('failed')))
      const fake = fakeBackend()
      const { talk, last } = setup(fake.backend)
      await talk.resume()
      await talk.start()
      expect(last()).toMatchObject({ phase: 'recording' })
      expect(fake.calls.record[0]!.id).not.toBe('t-1')
    })

    it('does not matter if the audio cannot be reached to forget', async () => {
      window.sessionStorage.setItem(KEY, JSON.stringify(pass('failed')))
      const fake = fakeBackend()
      const { talk } = setup({ ...fake.backend, forget: () => Promise.reject(new Error('The engine did not load')) })
      await expect(talk.resume()).resolves.toBeUndefined()
      await flush()
      expect(window.sessionStorage.getItem(KEY)).toBeNull()
    })

    it('still comes back to the person who said it', async () => {
      const fake = fakeBackend()
      const first = setup(fake.backend)
      await first.talk.start()
      fake.listener().heard({ at_ms: 1000, text: 'mine' })
      first.talk.keep()
      first.talk.destroy()
      await flush()
      expect(JSON.parse(window.sessionStorage.getItem(KEY)!).reviewer_id).toBe(ME)

      const again = setup(fake.backend)
      await again.talk.resume()
      expect(again.last()).toEqual({ phase: 'failed' })
      expect(fake.calls.forget).toEqual([])
    })

    it('is what a pass kept when a token ended becomes, for the next person in the tab', async () => {
      const fake = fakeBackend()
      const first = setup(fake.backend, undefined, undefined, 'person-before')
      await first.talk.start()
      fake.listener().heard({ at_ms: 1000, text: 'what they said' })
      first.talk.keep()
      first.talk.destroy()
      await flush()

      const next = setup(fake.backend)
      await next.talk.resume()
      await next.talk.retry()
      expect(fake.calls.submit).toEqual([])
      expect(fake.calls.forget).toHaveLength(1)
      expect(next.last()).toBeUndefined()
    })
  })

  describe('when the token ends in the middle of a pass', () => {
    it('stops the microphone and keeps what was said, with nothing thrown away', async () => {
      const fake = fakeBackend()
      const { talk, last } = setup(fake.backend)
      await talk.start()
      fake.listener().heard({ at_ms: 1000, text: 'the price is too small' })

      talk.keep()
      talk.destroy()

      expect(fake.calls.stop).toBe(1)
      expect(fake.calls.forget).toEqual([])
      expect(last()).toEqual({ phase: 'failed' })
      expect(JSON.parse(window.sessionStorage.getItem(KEY)!)).toMatchObject({ phase: 'failed', utterances: [{ text: 'the price is too small' }] })
    })

    it('lets the next session in this tab send it, as the same pass', async () => {
      const fake = fakeBackend()
      const first = setup(fake.backend)
      await first.talk.start()
      fake.listener().heard({ at_ms: 1000, text: 'the price is too small' })
      first.talk.keep()
      first.talk.destroy()
      await flush()
      expect(fake.calls.submit).toHaveLength(0)
      const id = fake.calls.record[0]!.id

      const next = setup(fake.backend)
      await next.talk.resume()
      expect(next.last()).toEqual({ phase: 'failed' })
      expect(fake.calls.record).toHaveLength(1)

      await next.talk.retry()
      expect(fake.calls.submit[0]).toMatchObject({ id, utterances: [{ text: 'the price is too small' }] })
      expect(next.last()).toBeNull()
    })

    it('also keeps the last words, which arrive after the microphone stops', async () => {
      const fake = fakeBackend()
      let listener: TalkListener | null = null
      const backend: TalkBackend = {
        ...fake.backend,
        async record(_id, _offset, _transcription, given) {
          listener = given
          return {
            stop: async () => {
              await Promise.resolve()
              listener!.heard({ at_ms: 1500, text: 'and the last words' })
            },
          }
        },
      }
      const { talk } = setup(backend)
      await talk.start()

      talk.keep()
      talk.destroy()
      await flush()

      expect(JSON.parse(window.sessionStorage.getItem(KEY)!).utterances).toEqual([{ at_ms: 1500, text: 'and the last words' }])
    })

    it('still sends nothing for a pass that never began', async () => {
      const fake = fakeBackend()
      let open: (capture: TalkCapture) => void = () => {}
      const backend: TalkBackend = { ...fake.backend, record: () => new Promise((resolve) => (open = resolve)) }
      const { talk } = setup(backend)
      void talk.start()

      talk.keep()
      talk.destroy()
      const stop = vi.fn(async () => {})
      open({ stop })
      await flush()

      expect(window.sessionStorage.getItem(KEY)).toBeNull()
      expect(stop).toHaveBeenCalledOnce()
    })

    it('leaves a pass that already failed as it is', async () => {
      window.sessionStorage.setItem(KEY, JSON.stringify({ id: 't-1', reviewer_id: ME, phase: 'failed', elapsed_ms: 5000, events: [], utterances: [{ at_ms: 1, text: 'kept' }], transcription: 'browser' }))
      const fake = fakeBackend()
      const { talk } = setup(fake.backend)
      await talk.resume()

      talk.keep()
      talk.destroy()

      expect(fake.calls.forget).toEqual([])
      expect(JSON.parse(window.sessionStorage.getItem(KEY)!)).toMatchObject({ id: 't-1', phase: 'failed', elapsed_ms: 5000 })
    })
  })

  it('throws the recording away when the person stops reviewing', async () => {
    const fake = fakeBackend()
    const { talk } = setup(fake.backend)
    await talk.start()
    fake.listener().heard({ at_ms: 1000, text: 'never mind' })

    talk.destroy()

    expect(fake.calls.forget).toHaveLength(1)
    expect(window.sessionStorage.getItem(KEY)).toBeNull()
  })

  it('closes a microphone that finishes opening after the overlay has gone, with nothing on screen to say it is on', async () => {
    const fake = fakeBackend()
    let open: (capture: TalkCapture) => void = () => {}
    const backend: TalkBackend = { ...fake.backend, record: () => new Promise((resolve) => (open = resolve)) }
    const { talk } = setup(backend)
    void talk.start()

    talk.destroy()
    const stop = vi.fn(async () => {})
    open({ stop })
    await flush()

    expect(stop).toHaveBeenCalledOnce()
  })

  it('sends a recording the last page left on its way out', async () => {
    window.sessionStorage.setItem(KEY, JSON.stringify({ id: 't-1', reviewer_id: ME, phase: 'turning', elapsed_ms: 5000, events: [], utterances: [], transcription: null }))
    const fake = fakeBackend()
    const { talk } = setup(fake.backend)

    await talk.resume()

    expect(fake.calls.submit).toHaveLength(1)
    expect(fake.calls.submit[0]).toMatchObject({ id: 't-1', duration: 5000 })
  })

  it('still sends what it has when the next page gets no microphone', async () => {
    window.sessionStorage.setItem(KEY, JSON.stringify({ id: 't-1', reviewer_id: ME, phase: 'recording', elapsed_ms: 5000, events: [], utterances: [], transcription: null }))
    const fake = fakeBackend()
    fake.refuseWith(new TalkRefused('denied'))
    const { talk, notify } = setup(fake.backend)

    await talk.resume()

    expect(fake.calls.submit).toHaveLength(1)
    expect(notify).not.toHaveBeenCalledWith(expect.stringContaining('microphone'), 'error')
  })

  it('tells the backend how a pass was heard, even after a page load', async () => {
    const fake = fakeBackend()
    const status: TalkStatus = { minutes_left: 30, max_duration_ms: 60_000, transcribers: ['local'] }
    const first = setup(fake.backend, status)
    await first.talk.start()
    window.dispatchEvent(new Event('pagehide'))

    const second = setup(fake.backend, status)
    await second.talk.resume()
    await second.talk.stop()

    expect(fake.calls.submit[0]!.transcription).toBe('local')
    expect(fake.calls.forgotten).toEqual(['local'])
  })

  it('stays marked as on-device when a later page uses something else, because its audio is still there', async () => {
    const fake = fakeBackend()
    const first = setup(fake.backend, { minutes_left: 30, max_duration_ms: 60_000, transcribers: ['local'] })
    await first.talk.start()
    window.dispatchEvent(new Event('pagehide'))

    const second = setup(fake.backend, { minutes_left: 30, max_duration_ms: 60_000, transcribers: ['browser'] })
    await second.talk.resume()
    await second.talk.stop()

    expect(fake.calls.submit[0]!.transcription).toBe('local')
  })

  it('finishes a pass turned in on the last page, with the audio still on the device', async () => {
    const fake = fakeBackend()
    const status: TalkStatus = { minutes_left: 30, max_duration_ms: 60_000, transcribers: ['local'] }
    const first = setup(fake.backend, status)
    await first.talk.start()
    window.sessionStorage.setItem(KEY, JSON.stringify({ ...JSON.parse(savedPass(first)), phase: 'turning' }))

    const second = setup(fake.backend, status)
    await second.talk.resume()

    expect(fake.calls.submit[0]!.transcription).toBe('local')
  })

  it('shows the first download while Stop waits for it, then goes back to the usual words', async () => {
    const fake = fakeBackend()
    const seen: Array<number | undefined> = []
    const { talk, states } = setup(fake.backend)
    fake.whileSubmitting((onPreparing) => {
      onPreparing(0.25)
      onPreparing(0.5)
      onPreparing(null)
    })
    await talk.start()
    await talk.stop()

    for (const state of states) if (state?.phase === 'turning') seen.push(state.preparing)
    expect(seen.filter((preparing) => preparing !== undefined)).toEqual([0.25, 0.5])
    expect(seen.at(-1)).toBeUndefined()
  })

  it('says so when the site itself forbids on-device speech', async () => {
    const fake = fakeBackend()
    fake.refuseWith(new TalkRefused('blocked'))
    const { talk, notify, last } = setup(fake.backend)

    await talk.start()

    expect(notify).toHaveBeenCalledWith("This site's security settings block on-device speech. Comment works without it.", 'error')
    expect(last()).toBeNull()
  })

  it("doesn't blame the site when on-device speech just didn't load", async () => {
    const fake = fakeBackend()
    fake.refuseWith(new TalkRefused('unavailable'))
    const { talk, notify, last } = setup(fake.backend)

    await talk.start()

    expect(notify).toHaveBeenCalledWith("On-device speech didn't load. Try again, or use Comment.", 'error')
    expect(last()).toBeNull()
  })

  it('explains a denied microphone and leaves nothing behind', async () => {
    const fake = fakeBackend()
    fake.refuseWith(new TalkRefused('denied'))
    const { talk, notify, last } = setup(fake.backend)

    await talk.start()

    expect(last()).toBeNull()
    expect(notify).toHaveBeenCalledWith('Allow the microphone to talk. Comment works without it.', 'error')
    expect(fake.calls.submit).toHaveLength(0)
  })

  it('keeps the recording when sending fails, until Try again or Discard', async () => {
    const fake = fakeBackend([{ status: 'failed' }, { status: 'done', comments: [], minutes_left: 29 }])
    const { talk, last } = setup(fake.backend)

    await talk.start()
    await talk.stop()
    expect(last()).toEqual({ phase: 'failed' })
    expect(fake.calls.forget).toEqual([])
    expect(JSON.parse(window.sessionStorage.getItem(KEY)!).phase).toBe('failed')

    await talk.retry()
    expect(last()).toBeNull()
    expect(fake.calls.submit).toHaveLength(2)
  })

  it('Discard after a failure drops the audio', async () => {
    const fake = fakeBackend([{ status: 'failed' }])
    const { talk, last } = setup(fake.backend)

    await talk.start()
    await talk.stop()
    await talk.drop()

    expect(last()).toBeNull()
    expect(fake.calls.forget).toHaveLength(1)
    expect(window.sessionStorage.getItem(KEY)).toBeNull()
  })

  it('waits while the same upload is still running', async () => {
    vi.useFakeTimers()
    const fake = fakeBackend([{ status: 'processing' }, { status: 'done', comments: [], minutes_left: 29 }])
    const { talk, last } = setup(fake.backend)

    await talk.start()
    const stopping = talk.stop()
    await vi.advanceTimersByTimeAsync(3100)
    await stopping

    expect(fake.calls.submit).toHaveLength(2)
    expect(last()).toBeNull()
  })

  it('keeps the recording when minutes run out at Stop', async () => {
    const fake = fakeBackend([{ status: 'out_of_minutes' }])
    const { talk, notify, last } = setup(fake.backend)

    await talk.start()
    await talk.stop()

    expect(notify).toHaveBeenCalledWith('No talking minutes left this month. Your recording stays in this tab until you close it or discard it.', 'error')
    expect(last()).toEqual({ phase: 'failed' })
    expect(fake.calls.forget).toEqual([])
  })

  it('outlines each page while recording, because an SPA has no page load', async () => {
    vi.useFakeTimers()
    document.body.innerHTML = '<h1>Pricing</h1>'
    Object.defineProperty(HTMLElement.prototype, 'innerText', { configurable: true, get() { return this.textContent } })
    const fake = fakeBackend()
    const { talk } = setup(fake.backend)

    await talk.start()
    await vi.advanceTimersByTimeAsync(4100)
    document.body.innerHTML = '<h1>About</h1>'
    setUrl('/about')
    talk.pageChanged()
    await vi.advanceTimersByTimeAsync(4100)
    await talk.stop()

    const outline = fake.calls.submit[0]!.timeline.filter((event) => event.type === 'element')
    expect(outline.map((event) => [event.page_url, event.anchor?.element_text])).toEqual([
      ['/pricing', 'Pricing'],
      ['/about', 'About'],
    ])
    delete (HTMLElement.prototype as { innerText?: string }).innerText
  })

  it('stays within the server limits on a very long walk', async () => {
    vi.useFakeTimers()
    Object.defineProperty(HTMLElement.prototype, 'innerText', { configurable: true, get() { return this.textContent } })
    const fake = fakeBackend()
    const { talk } = setup(fake.backend)

    await talk.start()
    for (let page = 0; page < 40; page++) {
      document.body.innerHTML = Array.from({ length: 150 }, (_item, index) => `<a href="#${index}">Page ${page} link ${index}</a>`).join('')
      setUrl(`/page-${page}`)
      await vi.advanceTimersByTimeAsync(4000)
    }
    await talk.stop()

    const outline = fake.calls.submit[0]!.timeline.filter((event) => event.type === 'element')
    expect(outline.length).toBe(1500)
    expect(outline.filter((event) => event.page_url === '/page-0')).toHaveLength(120)
    delete (HTMLElement.prototype as { innerText?: string }).innerText
  })

  it('a page load right after Stop still sends the pass', async () => {
    let finish = () => {}
    const fake = fakeBackend()
    const backend: TalkBackend = {
      ...fake.backend,
      record: async (id, offset, transcription, given) => {
        await fake.backend.record(id, offset, transcription, given)
        return { stop: () => new Promise<void>((resolve) => (finish = resolve)), flush: () => given.heard({ at_ms: 10, text: 'last words' }) }
      },
    }
    const { talk } = setup(backend)

    await talk.start()
    void talk.stop()
    await flush()
    window.dispatchEvent(new Event('pagehide'))

    const saved = JSON.parse(window.sessionStorage.getItem(KEY)!)
    expect(saved.phase).toBe('turning')
    expect(saved.utterances).toEqual([{ at_ms: 10, text: 'last words' }])
    finish()
  })

  it('keeps recording what was pointed at however big the outline gets', async () => {
    vi.useFakeTimers()
    Object.defineProperty(HTMLElement.prototype, 'innerText', { configurable: true, get() { return this.textContent } })
    const fake = fakeBackend()
    const { talk } = setup(fake.backend)

    await talk.start()
    for (let page = 0; page < 12; page++) {
      document.body.innerHTML = Array.from({ length: 150 }, (_item, index) => `<a href="#${index}">Page ${page} link ${index}</a>`).join('')
      setUrl(`/page-${page}`)
      await vi.advanceTimersByTimeAsync(4000)
    }
    document.querySelector('a')!.click()
    await talk.stop()

    expect(fake.calls.submit[0]!.timeline.filter((event) => event.type === 'click')).toHaveLength(1)
    delete (HTMLElement.prototype as { innerText?: string }).innerText
  })

  it('saves a sentence cut off by a page load', async () => {
    const fake = fakeBackend()
    const { talk } = setup({ ...fake.backend, record: async (id, offset, transcription, given) => ({ ...(await fake.backend.record(id, offset, transcription, given)), flush: () => given.heard({ at_ms: 10, text: 'cut off' }) }) })

    await talk.start()
    window.dispatchEvent(new Event('pagehide'))

    expect(JSON.parse(window.sessionStorage.getItem(KEY)!).utterances).toEqual([{ at_ms: 10, text: 'cut off' }])
  })

  it('tells the person when nothing they said was feedback', async () => {
    const fake = fakeBackend()
    const { talk, notify } = setup(fake.backend)

    await talk.start()
    await talk.stop()

    expect(notify).toHaveBeenCalledWith("We didn't catch any feedback in that. Try again, or use Comment.")
  })

  it('stops by itself at the length limit', async () => {
    vi.useFakeTimers()
    const fake = fakeBackend()
    const { talk } = setup(fake.backend, { minutes_left: 30, max_duration_ms: 1000, transcribers: ['browser'] })

    await talk.start()
    await vi.advanceTimersByTimeAsync(1300)

    expect(fake.calls.stop).toBe(1)
    expect(fake.calls.submit).toHaveLength(1)
  })

  it('stops when the microphone goes away', async () => {
    const fake = fakeBackend()
    const { talk } = setup(fake.backend)

    await talk.start()
    fake.listener().ended()
    await flush()

    expect(fake.calls.submit).toHaveLength(1)
  })

  it('shows the words and loudness the engine reports', async () => {
    vi.useFakeTimers()
    const fake = fakeBackend()
    const { talk, last } = setup(fake.backend)

    await talk.start()
    fake.listener().words('this button')
    fake.listener().level(0.5)
    await vi.advanceTimersByTimeAsync(300)

    expect(last()).toMatchObject({ phase: 'recording', words: 'this button', level: 0.5 })
  })

  it('stopping the review closes the microphone and forgets the audio', async () => {
    const fake = fakeBackend()
    const { talk } = setup(fake.backend)

    await talk.start()
    talk.destroy()
    await flush()

    expect(fake.calls.stop).toBe(1)
    expect(fake.calls.forget).toHaveLength(1)
    expect(window.sessionStorage.getItem(KEY)).toBeNull()
  })
})
