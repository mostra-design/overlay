import { beforeEach, describe, expect, it } from 'vitest'
import { createSpeechStore, type SpeechStore } from '../src/speech/speech-store'

const SECOND = 16_000

function audio(store: SpeechStore, talk: string, offset_ms: number, start_ms: number, seconds = 1) {
  return store.add({ talk, offset_ms, start_ms, samples: Int16Array.from({ length: seconds * SECOND }, (_sample, index) => index % 1000), at: Date.now() })
}

let store: SpeechStore

beforeEach(() => {
  store = createSpeechStore(window)
})

describe('createSpeechStore', () => {
  it('gives audio back in order, one talk at a time', async () => {
    await audio(store, 'a', 0, 0)
    await audio(store, 'b', 0, 0)
    await audio(store, 'a', 0, 1000)

    const first = await store.next('a', 0)
    const second = await store.next('a', first!.id!)

    expect(first).toMatchObject({ talk: 'a', start_ms: 0 })
    expect(second).toMatchObject({ talk: 'a', start_ms: 1000 })
    expect(await store.next('a', second!.id!)).toBeNull()
  })

  it('forgets audio once it has become text, in one step', async () => {
    await audio(store, 'a', 0, 0)
    await audio(store, 'a', 0, 1000)

    await store.settle('a', 0, 1000, { at_ms: 200, text: 'hello there' })

    expect(await store.next('a', 0)).toMatchObject({ start_ms: 1000 })
    expect(await store.spoken('a')).toEqual([{ at_ms: 200, text: 'hello there' }])
  })

  it('keeps the part of a chunk not dealt with yet, at the right time', async () => {
    await audio(store, 'a', 0, 2000)

    await store.settle('a', 0, 2250, null)

    const rest = await store.next('a', 0)
    expect(rest).toMatchObject({ start_ms: 2250 })
    expect(rest!.samples.length).toBe(SECOND * 0.75)
    expect(rest!.samples[0]).toBe((SECOND * 0.25) % 1000)
  })

  it('leaves other stretches of the talk alone', async () => {
    await audio(store, 'a', 0, 0)
    await audio(store, 'a', 9000, 0)

    await store.settle('a', 0, Number.MAX_SAFE_INTEGER, null)

    expect(await store.next('a', 0)).toMatchObject({ offset_ms: 9000 })
  })

  it('reads text back in the order it was said, whatever order it was written', async () => {
    await store.settle('a', 9000, 1000, { at_ms: 9400, text: 'later' })
    await store.settle('a', 0, 1000, { at_ms: 300, text: 'earlier' })

    expect((await store.spoken('a')).map((utterance) => utterance.text)).toEqual(['earlier', 'later'])
  })

  it('forgets a talk entirely, and only that talk', async () => {
    await audio(store, 'a', 0, 0)
    await audio(store, 'b', 0, 0)
    await store.settle('a', 0, 0, { at_ms: 1, text: 'gone' })

    await store.remove('a')

    expect(await store.next('a', 0)).toBeNull()
    expect(await store.spoken('a')).toEqual([])
    expect(await store.next('b', 0)).not.toBeNull()
  })

  it('throws out what a closed tab left behind', async () => {
    await store.add({ talk: 'old', offset_ms: 0, start_ms: 0, samples: new Int16Array(1), at: Date.now() - 25 * 60 * 60 * 1000 })
    await audio(store, 'fresh', 0, 0)

    await store.purgeAbandoned()

    expect(await store.next('old', 0)).toBeNull()
    expect(await store.next('fresh', 0)).not.toBeNull()
  })
})
