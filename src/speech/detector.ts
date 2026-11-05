import { InferenceSession, Tensor } from 'onnxruntime-web/wasm'
import { SPEECH_RATE } from './resampler'

const CONTEXT_SAMPLES = 64

export function likelihoodOfSpeech(detector: InferenceSession) {
  let state: Tensor = new Tensor('float32', new Float32Array(2 * 128), [2, 1, 128])
  let context = new Float32Array(CONTEXT_SAMPLES)
  return async (frame: Float32Array): Promise<number> => {
    const input = new Float32Array(CONTEXT_SAMPLES + frame.length)
    input.set(context)
    input.set(frame, CONTEXT_SAMPLES)
    context = frame.slice(-CONTEXT_SAMPLES)
    const output = await detector.run({ input: new Tensor('float32', input, [1, input.length]), state, sr: new Tensor('int64', BigInt64Array.of(BigInt(SPEECH_RATE)), [1]) })
    state = output.stateN as Tensor
    return (output.output as Tensor).data[0] as number
  }
}
