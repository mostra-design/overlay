import { createResampler, SPEECH_RATE } from './resampler'

export type HeardChunk = { start_ms: number; samples: Int16Array }

export type MicrophoneEvents = {
  chunk(chunk: HeardChunk): void
  level(value: number): void
}

const CHUNK_SAMPLES = SPEECH_RATE
const FIRST_SOUND_WAIT_MS = 1500
const GAP_MS = 1000

export async function openMicrophone(target: Window, stream: MediaStream, workletUrl: string, events: MicrophoneEvents) {
  const context = new (target as Window & { AudioContext: typeof AudioContext }).AudioContext()
  await context.audioWorklet.addModule(workletUrl)
  const source = context.createMediaStreamSource(stream)
  const capture = new AudioWorkletNode(context, 'mostra-capture')
  source.connect(capture).connect(context.destination)

  const resample = createResampler(context.sampleRate)
  const perMillisecond = context.sampleRate / 1000
  let held: Int16Array[] = []
  let heldSamples = 0
  let heldFrom = 0
  let firstFrame: number | null = null
  let skippedMs = 0
  let openedAt: number | null = null
  let sounding: () => void = () => {}
  const soundArrives = new Promise<void>((resolve) => (sounding = resolve))

  function open(): number {
    openedAt ??= Date.now()
    sounding()
    return openedAt
  }

  function emit() {
    if (heldSamples === 0) return
    const samples = new Int16Array(heldSamples)
    let position = 0
    for (const part of held) {
      samples.set(part, position)
      position += part.length
    }
    events.chunk({ start_ms: heldFrom, samples })
    held = []
    heldSamples = 0
  }

  capture.port.onmessage = ({ data }: MessageEvent<{ frame: number; at: number; samples: Float32Array }>) => {
    const sinceOpened = data.at - open()
    firstFrame ??= data.frame - sinceOpened * perMillisecond
    let startMs = (data.frame - firstFrame) / perMillisecond + skippedMs
    if (sinceOpened - startMs > GAP_MS) {
      emit()
      skippedMs += sinceOpened - startMs
      startMs = sinceOpened
    }
    const samples = resample(data.samples)
    if (heldSamples === 0) heldFrom = Math.round(startMs)
    held.push(samples)
    heldSamples += samples.length
    if (heldSamples >= CHUNK_SAMPLES) emit()
    const power = data.samples.reduce((sum, sample) => sum + sample * sample, 0) / data.samples.length
    events.level(Math.min(1, Math.sqrt(power) * 4))
  }

  await context.resume().catch(() => {})
  target.setTimeout(open, FIRST_SOUND_WAIT_MS)
  await soundArrives
  const wake = () => void context.resume()
  target.addEventListener('pointerdown', wake, { capture: true, passive: true })
  target.addEventListener('keydown', wake, { capture: true, passive: true })

  return {
    flush: emit,
    async stop() {
      target.removeEventListener('pointerdown', wake, { capture: true })
      target.removeEventListener('keydown', wake, { capture: true })
      for (const track of stream.getTracks()) track.stop()
      source.disconnect()
      capture.disconnect()
      capture.port.onmessage = null
      emit()
      await context.close().catch(() => {})
    },
  }
}
