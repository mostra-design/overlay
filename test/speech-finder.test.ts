import { describe, expect, it } from 'vitest'
import { createSpeechFinder, FRAME_MS, type Island } from '../src/speech/speech-finder'

function run(likelihoods: number[], start_ms = 0) {
  const finder = createSpeechFinder()
  const islands: Island[] = []
  likelihoods.forEach((likelihood, index) => {
    const island = finder.frame(start_ms + index * FRAME_MS, likelihood)
    if (island) islands.push(island)
  })
  return { finder, islands }
}

const frames = (milliseconds: number, likelihood: number) => Array.from({ length: Math.round(milliseconds / FRAME_MS) }, () => likelihood)

describe('createSpeechFinder', () => {
  it('starts an island on the first frame of speech, and ends it on the last', () => {
    const { islands } = run([...frames(1600, 0.02), ...frames(1600, 0.9), ...frames(1000, 0.02)])

    expect(islands).toHaveLength(1)
    expect(islands[0]!.start_ms).toBe(50 * FRAME_MS)
    expect(islands[0]!.end_ms).toBe(100 * FRAME_MS)
  })

  it('stays open across a breath, and closes on a real pause', () => {
    const breath = run([...frames(800, 0.9), ...frames(400, 0.02), ...frames(800, 0.9), ...frames(1000, 0.02)])
    const pause = run([...frames(800, 0.9), ...frames(1000, 0.02), ...frames(800, 0.9), ...frames(1000, 0.02)])

    expect(breath.islands).toHaveLength(1)
    expect(pause.islands).toHaveLength(2)
  })

  it('ignores a click on the desk', () => {
    expect(run([...frames(100, 0.9), ...frames(1500, 0.02)]).islands).toHaveLength(0)
  })

  it('keeps counting a word that fades, between the two thresholds', () => {
    const { islands } = run([...frames(500, 0.9), ...frames(500, 0.4), ...frames(1000, 0.02)])
    expect(islands[0]!.end_ms).toBe(frames(500, 0).length * 2 * FRAME_MS)
  })

  it('reports what is open, so the audio it needs is kept', () => {
    const { finder } = run([...frames(320, 0.02), ...frames(500, 0.9)])
    expect(finder.open_from_ms).toBe(10 * FRAME_MS)
  })

  it('hands over what is open when the audio ends', () => {
    const { finder, islands } = run([...frames(320, 0.02), ...frames(1000, 0.9)])

    expect(islands).toHaveLength(0)
    expect(finder.finish()).toMatchObject({ start_ms: 10 * FRAME_MS })
    expect(finder.open_from_ms).toBeNull()
  })

  it('cuts a monologue at its quietest moment, so no window overflows and the next starts there', () => {
    const quietFrame = Math.round(15_000 / FRAME_MS)
    const likelihoods = frames(30_000, 0.9)
    likelihoods[quietFrame] = 0.5
    const { finder, islands } = run(likelihoods)

    expect(islands).toHaveLength(1)
    expect(islands[0]).toEqual({ start_ms: 0, end_ms: quietFrame * FRAME_MS })
    expect(finder.open_from_ms).toBe(quietFrame * FRAME_MS)
  })
})
