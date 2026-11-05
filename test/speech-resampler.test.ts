import { describe, expect, it } from 'vitest'
import { createResampler, SPEECH_RATE } from '../src/speech/resampler'

const tone = (rate: number, frequency: number, seconds: number) => Float32Array.from({ length: Math.round(rate * seconds) }, (_sample, index) => 0.5 * Math.sin((2 * Math.PI * frequency * index) / rate))

function loudness(samples: Int16Array): number {
  const middle = samples.subarray(200, samples.length - 200)
  return Math.sqrt(middle.reduce((sum, sample) => sum + (sample / 32768) ** 2, 0) / middle.length)
}

function frequencyOf(samples: Int16Array): number {
  let crossings = 0
  for (let index = 1; index < samples.length; index++) if (samples[index - 1]! < 0 && samples[index]! >= 0) crossings += 1
  return (crossings * SPEECH_RATE) / samples.length
}

describe('createResampler', () => {
  it.each([48_000, 44_100, 96_000, 16_000])('keeps time from %i Hz: a second in is a second out', (rate) => {
    const output = createResampler(rate)(tone(rate, 440, 1))
    expect(Math.abs(output.length - SPEECH_RATE)).toBeLessThan(30)
  })

  it.each([48_000, 44_100])('keeps a voice-range tone at %i Hz as it was', (rate) => {
    const output = createResampler(rate)(tone(rate, 1000, 1))
    expect(frequencyOf(output)).toBeCloseTo(1000, -1)
    expect(loudness(output)).toBeCloseTo(0.5 / Math.SQRT2, 2)
  })

  it.each([48_000, 44_100])('drops what 16 kHz cannot hold at %i Hz instead of folding it back', (rate) => {
    expect(loudness(createResampler(rate)(tone(rate, 12_000, 1)))).toBeLessThan(0.003)
  })

  it('joins chunks without a seam', () => {
    const input = tone(48_000, 700, 1)
    const whole = createResampler(48_000)(input)
    const resample = createResampler(48_000)
    const parts: Int16Array[] = []
    for (let start = 0; start < input.length; start += 4096) parts.push(resample(input.subarray(start, start + 4096)))
    const joined = Int16Array.from(parts.flatMap((part) => Array.from(part)))

    expect(joined.length).toBe(whole.length)
    for (let index = 0; index < joined.length; index += 97) expect(Math.abs(joined[index]! - whole[index]!)).toBeLessThanOrEqual(1)
  })

  it('has the first sample in come out first, so a position in the output is a time', () => {
    const input = new Float32Array(4800)
    input[0] = 1
    const output = createResampler(48_000)(input)
    const loudest = output.reduce((best, sample, index) => (Math.abs(sample) > Math.abs(output[best]!) ? index : best), 0)
    expect(loudest).toBe(0)
  })
})
