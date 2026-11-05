import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TalkRefused, type TalkListener } from '../src/talk'
import { canRecognizeSpeech, FIRST_WORDS_DELAY_MS, LATER_WORDS_DELAY_MS, listenToSpeech, timeWords } from '../src/talk-speech'

class FakeRecognition {
  static last: FakeRecognition
  static failWith: string | null = null
  static trailing: string | null = null
  static hangs = false
  continuous = false
  interimResults = false
  lang = ''
  onstart: (() => void) | null = null
  onresult: ((event: unknown) => void) | null = null
  onerror: ((event: { error: string }) => void) | null = null
  onend: (() => void) | null = null
  starts = 0
  stops = 0

  constructor() {
    FakeRecognition.last = this
  }

  start() {
    this.starts += 1
    queueMicrotask(() => (FakeRecognition.failWith ? this.onerror?.({ error: FakeRecognition.failWith }) : this.onstart?.()))
  }

  stop() {
    this.stops += 1
    setTimeout(() => {
      if (FakeRecognition.trailing) this.say(FakeRecognition.trailing)
      if (!FakeRecognition.hangs) this.onend?.()
    }, 250)
  }

  say(text: string, isFinal = true, resultIndex = 0) {
    const result = Object.assign([{ transcript: text }], { isFinal })
    const results = Array.from({ length: resultIndex + 1 }, () => result)
    this.onresult?.({ resultIndex, results })
  }
}

const listener = (): TalkListener => ({ heard: vi.fn(), level: vi.fn(), words: vi.fn(), pointed: vi.fn(), ended: vi.fn() })

beforeEach(() => {
  FakeRecognition.failWith = null
  FakeRecognition.trailing = null
  FakeRecognition.hangs = false
  Object.assign(window, { SpeechRecognition: FakeRecognition })
})

afterEach(() => {
  vi.useRealTimers()
  delete (window as Window & { SpeechRecognition?: unknown }).SpeechRecognition
})

describe('listenToSpeech', () => {
  it('finds the prefixed Chrome and Safari engine too', () => {
    delete (window as Window & { SpeechRecognition?: unknown }).SpeechRecognition
    expect(canRecognizeSpeech(window)).toBe(false)
    Object.assign(window, { webkitSpeechRecognition: FakeRecognition })
    expect(canRecognizeSpeech(window)).toBe(true)
    delete (window as Window & { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition
  })

  it('shows the last few words while speaking and reports finished speech', async () => {
    const heard = listener()
    await listenToSpeech(window, 0, heard)

    FakeRecognition.last.say('one two three four five six seven eight', false)
    expect(heard.words).toHaveBeenCalledWith('three four five six seven eight')
    expect(heard.heard).not.toHaveBeenCalled()

    FakeRecognition.last.say('one two three four five six seven eight')
    expect(heard.heard).toHaveBeenCalledOnce()
  })

  it('moves the meter as words are heard, with no audio to measure, and settles when they stop', async () => {
    vi.useFakeTimers()
    const heard = listener()
    const listening = listenToSpeech(window, 0, heard)
    await vi.advanceTimersByTimeAsync(0)
    await listening
    const level = () => vi.mocked(heard.level).mock.lastCall?.[0]
    expect(level()).toBeUndefined()

    FakeRecognition.last.say('the headline', false)
    const lifted = level()!
    expect(lifted).toBeGreaterThan(0.5)
    expect(lifted).toBeLessThanOrEqual(1)

    await vi.advanceTimersByTimeAsync(100)
    expect(level()).toBeLessThan(lifted)
    expect(level()).toBeGreaterThan(0)

    FakeRecognition.last.say('the headline is', false)
    expect(level()).toBe(lifted)

    await vi.advanceTimersByTimeAsync(2000)
    expect(level()).toBe(0)

    const calls = vi.mocked(heard.level).mock.calls.length
    await vi.advanceTimersByTimeAsync(2000)
    expect(vi.mocked(heard.level).mock.calls.length).toBe(calls)
  })

  it('leaves the meter alone when a result holds no words', async () => {
    const heard = listener()
    await listenToSpeech(window, 0, heard)

    FakeRecognition.last.say('   ', false)

    expect(heard.level).not.toHaveBeenCalled()
  })

  it('times every word from when it first showed up, less the delay, the first words\' shorter, on the talk clock', async () => {
    vi.useFakeTimers()
    const heard = listener()
    const listening = listenToSpeech(window, 60_000, heard)
    await vi.advanceTimersByTimeAsync(0)
    await listening

    await vi.advanceTimersByTimeAsync(1000)
    FakeRecognition.last.say('this button', false)
    await vi.advanceTimersByTimeAsync(4000)
    FakeRecognition.last.say('this button is too quiet')

    const start = 61_000 - FIRST_WORDS_DELAY_MS
    const last = 65_000 - LATER_WORDS_DELAY_MS
    const step = (last - (start + 400)) / 3
    expect(heard.heard).toHaveBeenCalledWith({ at_ms: start, text: 'this button is too quiet', words_ms: [start, start + 400, Math.round(start + 400 + step), Math.round(start + 400 + 2 * step), last] })
  })

  it('never times words backwards when the next bunch shows up soon after the first', () => {
    for (const arrivals of [
      [5000, 5000, 5000, 5250, 5250],
      [5000, 5000, 5300, 5300, 5600],
    ]) {
      const words_ms = timeWords({ text: 'one two three four five', arrivals }, 0).words_ms!
      expect(words_ms[0]).toBe(5000 - FIRST_WORDS_DELAY_MS)
      for (let index = 1; index < words_ms.length; index++) expect(words_ms[index]).toBeGreaterThanOrEqual(words_ms[index - 1]!)
      expect(Math.max(...words_ms)).toBeLessThanOrEqual(Math.max(...arrivals))
    }
  })

  it('never times a word before the listening began', () => {
    expect(timeWords({ text: 'hello there', arrivals: [60_100, 60_100] }, 60_000)).toEqual({ at_ms: 60_000, text: 'hello there', words_ms: [60_000, 60_400] })
  })

  it('times words the final text has beyond what arrived with the last of them', () => {
    expect(timeWords({ text: 'the price is too small', arrivals: [5000, 6000] }, 0).words_ms).toHaveLength(5)
  })

  it('carries on through the silences browsers end recognition on', async () => {
    await listenToSpeech(window, 0, listener())

    FakeRecognition.last.onend?.()

    expect(FakeRecognition.last.starts).toBe(2)
  })

  it('stops for good on Stop', async () => {
    vi.useFakeTimers()
    const listening = listenToSpeech(window, 0, listener())
    await vi.advanceTimersByTimeAsync(0)
    const capture = await listening

    const stopping = capture.stop()
    await vi.advanceTimersByTimeAsync(300)
    await stopping

    expect(FakeRecognition.last.stops).toBe(1)
    expect(FakeRecognition.last.starts).toBe(1)
  })

  it('waits at Stop for the words the browser is still finishing', async () => {
    vi.useFakeTimers()
    FakeRecognition.trailing = 'the headline is too long'
    const heard = listener()
    const listening = listenToSpeech(window, 0, heard)
    await vi.advanceTimersByTimeAsync(0)
    const capture = await listening
    FakeRecognition.last.say('the headline', false)

    let stopped = false
    void capture.stop().then(() => (stopped = true))
    await vi.advanceTimersByTimeAsync(100)
    expect(stopped).toBe(false)

    await vi.advanceTimersByTimeAsync(200)
    expect(stopped).toBe(true)
    expect(vi.mocked(heard.heard).mock.calls.map(([utterance]) => utterance.text)).toEqual(['the headline is too long'])
  })

  it('keeps the unfinished words when the browser never answers Stop', async () => {
    vi.useFakeTimers()
    FakeRecognition.hangs = true
    const heard = listener()
    const listening = listenToSpeech(window, 0, heard)
    await vi.advanceTimersByTimeAsync(0)
    const capture = await listening
    FakeRecognition.last.say('and the price is wrong', false)

    const stopping = capture.stop()
    await vi.advanceTimersByTimeAsync(2100)
    await stopping

    expect(vi.mocked(heard.heard).mock.calls.map(([utterance]) => utterance.text)).toEqual(['and the price is wrong'])
  })

  it('forgets interim words a shorter final replaced', async () => {
    const heard = listener()
    const capture = await listenToSpeech(window, 0, heard)
    const results = (...parts: Array<[string, boolean]>) => parts.map(([transcript, isFinal]) => Object.assign([{ transcript }], { isFinal }))

    FakeRecognition.last.onresult?.({ resultIndex: 0, results: results(['the price is', false], ['wrong', false]) })
    FakeRecognition.last.onresult?.({ resultIndex: 0, results: results(['the price is wrong', true]) })
    capture.flush!()

    expect(vi.mocked(heard.heard).mock.calls.map(([utterance]) => utterance.text)).toEqual(['the price is wrong'])
  })

  it('flush reports a sentence a page load cut off, once', async () => {
    const heard = listener()
    const capture = await listenToSpeech(window, 0, heard)
    FakeRecognition.last.say('first point', false)

    capture.flush!()
    capture.flush!()

    expect(heard.heard).toHaveBeenCalledOnce()
    expect(heard.heard).toHaveBeenCalledWith(expect.objectContaining({ text: 'first point' }))
  })

  it('keeps unfinished words across a restart after silence', async () => {
    const heard = listener()
    await listenToSpeech(window, 0, heard)
    FakeRecognition.last.say('cut off by silence', false)

    FakeRecognition.last.onend?.()

    expect(heard.heard).toHaveBeenCalledWith(expect.objectContaining({ text: 'cut off by silence' }))
  })

  it('ignores silence reported as an error', async () => {
    const heard = listener()
    await listenToSpeech(window, 0, heard)

    FakeRecognition.last.onerror?.({ error: 'no-speech' })

    expect(heard.ended).not.toHaveBeenCalled()
  })

  it('says when the microphone is denied, and when the service is missing', async () => {
    FakeRecognition.failWith = 'not-allowed'
    await expect(listenToSpeech(window, 0, listener())).rejects.toMatchObject(new TalkRefused('denied'))

    FakeRecognition.failWith = 'network'
    await expect(listenToSpeech(window, 0, listener())).rejects.toMatchObject(new TalkRefused('unsupported'))
  })

  it('ends the talk when recognition breaks partway', async () => {
    const heard = listener()
    await listenToSpeech(window, 0, heard)

    FakeRecognition.last.onerror?.({ error: 'network' })

    expect(heard.ended).toHaveBeenCalled()
  })
})
