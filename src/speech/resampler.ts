export const SPEECH_RATE = 16_000

const ZERO_CROSSINGS = 8
const PHASES = 128

export function createResampler(inputRate: number): (input: Float32Array) => Int16Array {
  const step = inputRate / SPEECH_RATE
  const cutoff = Math.min(1, 1 / step)
  const reach = Math.ceil(ZERO_CROSSINGS / cutoff)
  const table = Array.from({ length: PHASES + 1 }, (_entry, phase) => filterAt(phase / PHASES, reach, cutoff))
  let held = new Float32Array(2 * reach)
  let position = 2 * reach

  return (input) => {
    const samples = new Float32Array(held.length + input.length)
    samples.set(held)
    samples.set(input, held.length)
    const output = new Int16Array(Math.ceil(input.length / step) + 2)
    let written = 0
    while (position + reach < samples.length) {
      const whole = Math.floor(position)
      const weights = table[Math.round((position - whole) * PHASES)]!
      let sum = 0
      for (let index = 0; index < weights.length; index++) sum += weights[index]! * samples[whole - reach + 1 + index]!
      output[written++] = Math.max(-32768, Math.min(32767, Math.round(sum * 32768)))
      position += step
    }
    held = samples.slice(samples.length - 2 * reach)
    position -= samples.length - held.length
    return output.slice(0, written)
  }
}

function filterAt(fraction: number, reach: number, cutoff: number): Float32Array {
  const weights = new Float32Array(2 * reach)
  let total = 0
  for (let index = 0; index < weights.length; index++) {
    const distance = index - reach + 1 - fraction
    const x = Math.PI * cutoff * distance
    const sinc = x === 0 ? 1 : Math.sin(x) / x
    const window = 0.5 + 0.5 * Math.cos((Math.PI * distance) / reach)
    weights[index] = Math.abs(distance) < reach ? sinc * window : 0
    total += weights[index]!
  }
  return weights.map((weight) => weight / total)
}
