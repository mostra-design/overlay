import { TalkRefused, type TalkCapture, type TalkListener, type Utterance } from './talk'

type SpeechResultEvent = { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }

type SpeechRecognizer = {
  continuous: boolean
  interimResults: boolean
  lang: string
  onstart: (() => void) | null
  onresult: ((event: SpeechResultEvent) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
}

type SpeechWindow = Window & { SpeechRecognition?: new () => SpeechRecognizer; webkitSpeechRecognition?: new () => SpeechRecognizer }

const LAST_WORDS = 6
const HARMLESS = new Set(['no-speech', 'aborted'])
const STOP_WAIT_MS = 2000
export const FIRST_WORDS_DELAY_MS = 600
export const LATER_WORDS_DELAY_MS = 1100
const WORD_MS = 400
const HEARD_LEVEL = 0.8
const LEVEL_FADE = 0.7
const LEVEL_EVERY_MS = 100
const LEVEL_SILENT = 0.05

export type Arriving = { text: string; arrivals: number[] }

export function canRecognizeSpeech(target: Window): boolean {
  const speech = target as SpeechWindow
  return Boolean(speech.SpeechRecognition ?? speech.webkitSpeechRecognition)
}

export function listenToSpeech(target: Window, offsetMs: number, listener: TalkListener): Promise<TalkCapture> {
  const speech = target as SpeechWindow
  const Recognition = speech.SpeechRecognition ?? speech.webkitSpeechRecognition
  if (!Recognition) return Promise.reject(new TalkRefused('unsupported'))

  const recognition = new Recognition()
  const started = Date.now()
  const unfinished = new Map<number, Arriving>()
  let stopped = false
  let opened = false
  let ending: (() => void) | null = null
  let level = 0
  let settling: ReturnType<typeof setInterval> | undefined

  function liftLevel() {
    level = HEARD_LEVEL
    listener.level(level)
    settling ??= setInterval(() => {
      level = level * LEVEL_FADE < LEVEL_SILENT ? 0 : level * LEVEL_FADE
      listener.level(level)
      if (level > 0) return
      clearInterval(settling)
      settling = undefined
    }, LEVEL_EVERY_MS)
  }

  function flush() {
    for (const arriving of unfinished.values()) listener.heard(timeWords(arriving, offsetMs))
    unfinished.clear()
  }

  return new Promise((resolve, reject) => {
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = target.navigator.language || 'en-US'
    recognition.onstart = () => {
      if (opened) return
      opened = true
      resolve({
        flush,
        stop: () =>
          new Promise<void>((done) => {
            const timer = setTimeout(() => ending?.(), STOP_WAIT_MS)
            ending = () => {
              ending = null
              clearTimeout(timer)
              flush()
              done()
            }
            stopped = true
            recognition.stop()
          }),
      })
    }
    recognition.onresult = (event) => {
      for (let index = event.resultIndex; index < event.results.length; index++) {
        const result = event.results[index]!
        const text = result[0]?.transcript.trim() ?? ''
        if (!text) continue
        const words = text.split(/\s+/)
        const arrivals = unfinished.get(index)?.arrivals ?? []
        while (arrivals.length < words.length) arrivals.push(offsetMs + (Date.now() - started))
        listener.words(words.slice(-LAST_WORDS).join(' '))
        liftLevel()
        if (result.isFinal) {
          unfinished.delete(index)
          listener.heard(timeWords({ text, arrivals }, offsetMs))
        } else {
          unfinished.set(index, { text, arrivals })
        }
      }
      for (const index of unfinished.keys()) if (index >= event.results.length) unfinished.delete(index)
    }
    recognition.onerror = ({ error }) => {
      if (HARMLESS.has(error) || stopped) return
      stopped = true
      if (opened) {
        flush()
        listener.ended()
      } else {
        reject(new TalkRefused(error === 'not-allowed' ? 'denied' : 'unsupported'))
      }
    }
    recognition.onend = () => {
      if (stopped) return void ending?.()
      flush()
      recognition.start()
    }
    recognition.start()
  })
}

export function timeWords({ text, arrivals }: Arriving, startMs: number): Utterance {
  const arrival = (word: number) => arrivals[Math.min(word, arrivals.length - 1)] ?? startMs
  const said = (word: number) => Math.max(startMs, arrival(word) - (arrival(word) === arrival(0) ? FIRST_WORDS_DELAY_MS : LATER_WORDS_DELAY_MS))
  const count = text.split(/\s+/).length
  const words_ms: number[] = []
  for (let first = 0; first < count; ) {
    const previous = words_ms.at(-1)
    const at = Math.max(said(first), previous ?? -Infinity)
    let last = first
    while (last + 1 < count && arrival(last + 1) === arrival(first)) last++
    const bunch = last - first + 1
    if (previous === undefined) {
      const next = last + 1 < count ? said(last + 1) : Infinity
      const step = Math.max(0, Math.min(WORD_MS, ((next > at ? next : arrival(first)) - at) / bunch))
      for (let word = 0; word < bunch; word++) words_ms.push(Math.round(at + word * step))
    } else {
      for (let word = 1; word <= bunch; word++) words_ms.push(Math.round(previous + (word * (at - previous)) / bunch))
    }
    first = last + 1
  }
  return { at_ms: words_ms[0] ?? startMs, text, words_ms }
}
