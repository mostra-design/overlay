import { SPEECH_RATE } from './resampler'
import { createSpeechFinder, FRAME_MS, type Island } from './speech-finder'
import type { Spoken } from './whisper'

export type Settled = { offset_ms: number; consumed_ms: number; heard: { at_ms: number; end_ms: number; text: string; words_ms?: number[] } | null }

export type HearingOptions = {
  newDetector(): (frame: Float32Array) => Promise<number>
  transcribe(audio: Float32Array): Promise<Spoken>
  settled(settled: Settled): void
}

type Kept = { start_ms: number; samples: Float32Array }

const SAMPLES_PER_MS = SPEECH_RATE / 1000
const FRAME_SAMPLES = SAMPLES_PER_MS * FRAME_MS
const LEAD_MS = 200
const TRAIL_MS = 300

export function createHearing({ newDetector, transcribe, settled }: HearingOptions) {
  let stretch: ReturnType<typeof newStretch> | null = null

  function newStretch(offset_ms: number) {
    return { offset_ms, finder: createSpeechFinder(), detect: newDetector(), spare: new Float32Array(0), kept: [] as Kept[], consumed_ms: -Infinity }
  }

  async function speak(current: NonNullable<typeof stretch>, island: Island) {
    const from = Math.max(island.start_ms - LEAD_MS, current.kept[0]?.start_ms ?? 0)
    const { text, words_ms } = await transcribe(audioBetween(current.kept, from, island.end_ms + TRAIL_MS))
    current.consumed_ms = island.end_ms
    const at_ms = Math.max(0, Math.round(current.offset_ms + island.start_ms))
    const end_ms = Math.max(0, Math.round(current.offset_ms + island.end_ms))
    const timed = words_ms?.map((word) => Math.min(end_ms, Math.max(at_ms, Math.round(current.offset_ms + from + word))))
    settled({ offset_ms: current.offset_ms, consumed_ms: island.end_ms, heard: text ? { at_ms, end_ms, text, ...(timed ? { words_ms: timed } : {}) } : null })
  }

  async function finish() {
    if (!stretch) return
    const closing = stretch
    stretch = null
    const island = closing.finder.finish()
    if (island) await speak(closing, island)
    settled({ offset_ms: closing.offset_ms, consumed_ms: Number.MAX_SAFE_INTEGER, heard: null })
  }

  return {
    finish,

    async hear(offsetMs: number, startMs: number, samples: Int16Array) {
      if (stretch?.offset_ms !== offsetMs) {
        await finish()
        stretch = newStretch(offsetMs)
      }
      const current = stretch!
      const floats = Float32Array.from(samples, (sample) => sample / 32768)
      current.kept.push({ start_ms: startMs, samples: floats })

      const joined = new Float32Array(current.spare.length + floats.length)
      joined.set(current.spare)
      joined.set(floats, current.spare.length)
      const joinedFrom = startMs - current.spare.length / SAMPLES_PER_MS
      let position = 0
      for (; position + FRAME_SAMPLES <= joined.length; position += FRAME_SAMPLES) {
        const likelihood = await current.detect(joined.subarray(position, position + FRAME_SAMPLES))
        const island = current.finder.frame(joinedFrom + position / SAMPLES_PER_MS, likelihood)
        if (island) await speak(current, island)
      }
      current.spare = joined.slice(position)

      const neededFrom = (current.finder.open_from_ms ?? joinedFrom + position / SAMPLES_PER_MS) - LEAD_MS
      current.kept = current.kept.filter((kept) => kept.start_ms + kept.samples.length / SAMPLES_PER_MS > neededFrom)
      if (neededFrom > current.consumed_ms) {
        current.consumed_ms = neededFrom
        settled({ offset_ms: current.offset_ms, consumed_ms: neededFrom, heard: null })
      }
    },
  }
}

export type Hearing = ReturnType<typeof createHearing>

function audioBetween(kept: Kept[], fromMs: number, toMs: number): Float32Array {
  const parts = kept.map(({ start_ms, samples }) => samples.subarray(Math.max(0, Math.round((fromMs - start_ms) * SAMPLES_PER_MS)), Math.max(0, Math.round((toMs - start_ms) * SAMPLES_PER_MS))))
  const audio = new Float32Array(parts.reduce((total, part) => total + part.length, 0))
  let position = 0
  for (const part of parts) {
    audio.set(part, position)
    position += part.length
  }
  return audio
}
