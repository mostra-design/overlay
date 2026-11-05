import { describe, expect, it, vi } from 'vitest'
import { createHearing, type Settled } from '../src/speech/hearing'

const SAMPLES_PER_MS = 16
const CHUNK_MS = 1000

function recording(script: Array<[number, number]>, durationMs: number): Int16Array {
  const samples = new Int16Array(durationMs * SAMPLES_PER_MS)
  for (const [start, end] of script) samples.fill(12_000, start * SAMPLES_PER_MS, end * SAMPLES_PER_MS)
  return samples
}

function chunksOf(samples: Int16Array, fromMs = 0) {
  const chunks: Array<{ start_ms: number; samples: Int16Array }> = []
  for (let start = fromMs; start * SAMPLES_PER_MS < samples.length; start += CHUNK_MS) chunks.push({ start_ms: start, samples: samples.slice(start * SAMPLES_PER_MS, (start + CHUNK_MS) * SAMPLES_PER_MS) })
  return chunks
}

function setup(words_ms: number[] | null = null) {
  const settled: Settled[] = []
  const spoken: Float32Array[] = []
  const hearing = createHearing({
    newDetector: () => async (frame) => (frame.some((sample) => Math.abs(sample) > 0.1) ? 0.95 : 0.01),
    transcribe: async (audio) => {
      spoken.push(audio.slice())
      return { text: words_ms ? words_ms.map((_at, index) => `word${index + 1}`).join(' ') : `sentence ${spoken.length}`, words_ms }
    },
    settled: (entry) => settled.push(entry),
  })
  return { hearing, settled, spoken, heard: () => settled.flatMap((entry) => (entry.heard ? [entry.heard] : [])) }
}

async function play(hearing: ReturnType<typeof setup>['hearing'], offsetMs: number, chunks: Array<{ start_ms: number; samples: Int16Array }>) {
  for (const chunk of chunks) await hearing.hear(offsetMs, chunk.start_ms, chunk.samples.slice())
}

describe('createHearing, the talk clock', () => {
  it('places an utterance where its first word starts, within a frame', async () => {
    const { hearing, heard } = setup()
    await play(hearing, 0, chunksOf(recording([[3400, 6100]], 9000)))

    expect(heard()).toHaveLength(1)
    expect(Math.abs(heard()[0]!.at_ms - 3400)).toBeLessThanOrEqual(32)
  })

  it("doesn't place it at the padded audio or when the text came back", async () => {
    const { hearing, heard, spoken } = setup()
    await play(hearing, 0, chunksOf(recording([[3400, 6100]], 9000)))

    expect(spoken[0]!.length / SAMPLES_PER_MS).toBeGreaterThan(2700 + 400)
    expect(spoken[0]!.subarray(0, 150 * SAMPLES_PER_MS).every((sample) => sample === 0)).toBe(true)
    expect(heard()[0]!.at_ms).toBeGreaterThanOrEqual(3400 - 32)
  })

  it("times each word from where it is in the audio Whisper got, which starts before the speech", async () => {
    const { hearing, heard } = setup([150, 900, 2400])
    await play(hearing, 10_000, chunksOf(recording([[3400, 6100]], 9000)))

    expect(heard()[0]!.words_ms).toHaveLength(3)
    const [first, second, third] = heard()[0]!.words_ms!
    expect(Math.abs(first! - 13_400)).toBeLessThanOrEqual(32)
    expect(Math.abs(second! - (10_000 + 3_200 + 900))).toBeLessThanOrEqual(32)
    expect(Math.abs(third! - (10_000 + 3_200 + 2400))).toBeLessThanOrEqual(32)
  })

  it('adds the offset of a later stretch, on the talk clock and not the page clock', async () => {
    const { hearing, heard } = setup()
    await play(hearing, 0, chunksOf(recording([[1000, 2500]], 5000)))
    await play(hearing, 41_250, chunksOf(recording([[2000, 3500]], 6000)))
    await hearing.finish()

    expect(heard().map((utterance) => utterance.at_ms)).toEqual([expect.closeTo(1000, -2), expect.closeTo(43_250, -2)])
  })

  it('keeps stretches apart: a stretch cut off mid-sentence ends there', async () => {
    const { hearing, heard } = setup()
    await play(hearing, 0, chunksOf(recording([[1000, 3000]], 3000)))
    await play(hearing, 3000, chunksOf(recording([[500, 2000]], 4000)))
    await hearing.finish()

    expect(heard()).toHaveLength(2)
    expect(Math.abs(heard()[0]!.at_ms - 1000)).toBeLessThanOrEqual(32)
    expect(Math.abs(heard()[1]!.at_ms - 3500)).toBeLessThanOrEqual(32)
  })

  it('stays right when the audio has a real gap', async () => {
    const { hearing, heard } = setup()
    const before = chunksOf(recording([], 2000))
    const after = chunksOf(recording([[1000, 3000]], 5000)).map((chunk) => ({ ...chunk, start_ms: chunk.start_ms + 9000 }))
    await play(hearing, 0, [...before, ...after])

    expect(Math.abs(heard()[0]!.at_ms - 10_000)).toBeLessThanOrEqual(32)
  })

  it('tells a sentence from a chunk boundary running through it', async () => {
    const { hearing, heard } = setup()
    await play(hearing, 0, chunksOf(recording([[900, 3100]], 6000)))
    expect(heard()).toHaveLength(1)
  })

  it('reports nothing for silence, and lets that audio go', async () => {
    const { hearing, heard, settled } = setup()
    await play(hearing, 0, chunksOf(recording([], 5000)))

    expect(heard()).toHaveLength(0)
    expect(settled.at(-1)!.consumed_ms).toBeGreaterThan(4000)
  })

  it('drops what Whisper found no words in, without losing its place', async () => {
    const settled: Settled[] = []
    const hearing = createHearing({ newDetector: () => async () => 0.95, transcribe: async () => ({ text: '', words_ms: null }), settled: (entry) => settled.push(entry) })
    await hearing.hear(0, 0, recording([[0, 1000]], 1000))
    await hearing.finish()

    expect(settled.flatMap((entry) => (entry.heard ? [entry.heard] : []))).toEqual([])
    expect(settled.at(-1)!.consumed_ms).toBe(Number.MAX_SAFE_INTEGER)
  })
})

describe('createHearing across a page load', () => {
  async function loadPageAt(leftMs: number, script: Array<[number, number]>, durationMs: number) {
    const samples = recording(script, durationMs)
    const before = setup()
    await play(before.hearing, 0, chunksOf(samples).filter((chunk) => chunk.start_ms < leftMs))
    const consumedMs = Math.max(0, ...before.settled.filter((entry) => entry.consumed_ms !== Number.MAX_SAFE_INTEGER).map((entry) => entry.consumed_ms))

    const after = setup()
    const rest = samples.slice(Math.round(consumedMs * SAMPLES_PER_MS))
    const replay = chunksOf(rest).map((chunk) => ({ ...chunk, start_ms: chunk.start_ms + consumedMs }))
    await play(after.hearing, 0, replay)
    await after.hearing.finish()
    return { heard: [...before.heard(), ...after.heard()], consumedMs }
  }

  it('picks a sentence up from the start when the page went away halfway through it', async () => {
    const { heard, consumedMs } = await loadPageAt(4000, [[3000, 6000]], 9000)

    expect(consumedMs).toBeLessThan(3000)
    expect(heard).toHaveLength(1)
    expect(Math.abs(heard[0]!.at_ms - 3000)).toBeLessThanOrEqual(32)
  })

  it("doesn't say a finished sentence twice", async () => {
    const { heard } = await loadPageAt(6000, [[1000, 3000]], 9000)

    expect(heard).toHaveLength(1)
    expect(Math.abs(heard[0]!.at_ms - 1000)).toBeLessThanOrEqual(32)
  })

  it('keeps later sentences on the clock', async () => {
    const { heard } = await loadPageAt(5000, [[1000, 3000], [6000, 8000]], 11_000)

    expect(heard).toHaveLength(2)
    expect(Math.abs(heard[1]!.at_ms - 6000)).toBeLessThanOrEqual(32)
  })
})

describe('createHearing, when transcription fails', () => {
  it('leaves that audio unsettled, for the next try', async () => {
    const settled = vi.fn()
    const hearing = createHearing({ newDetector: () => async (frame) => (frame.some((sample) => Math.abs(sample) > 0.1) ? 0.95 : 0.01), transcribe: () => Promise.reject(new Error('out of memory')), settled })
    const chunks = chunksOf(recording([[1000, 2000]], 4000))

    await expect(play(hearing, 0, chunks)).rejects.toThrow('out of memory')
    expect(Math.max(...settled.mock.calls.map(([entry]) => (entry as Settled).consumed_ms))).toBeLessThan(1000)
  })
})
