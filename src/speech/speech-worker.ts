import { env as transformers } from '@huggingface/transformers'
import { env as runtime, InferenceSession } from 'onnxruntime-web/wasm'
import { likelihoodOfSpeech } from './detector'
import { createHearing, type Hearing } from './hearing'
import type { FromEngine, ToEngine } from './messages'
import { SPEECH_VERSION } from './messages'
import { checkedFetch } from './speech-files'
import { loadWhisper, MODEL_BYTES } from './whisper'

type WorkerScope = { postMessage(message: FromEngine): void; onmessage: ((event: MessageEvent<ToEngine>) => void) | null }

const CACHE = `mostra-speech-${SPEECH_VERSION}`
const RUNTIME_FILE = 'ort-wasm-simd-threaded.wasm'
const DETECTOR_FILE = 'silero-vad.onnx'
const RUNTIME_BYTES = 14_800_000
const DETECTOR_BYTES = 2_327_524

const scope = self as unknown as WorkerScope
const post = (message: FromEngine) => scope.postMessage(message)
let hearing: Hearing
let downloaded = 0
let download: ReturnType<typeof checkedFetch>

const cacheAvailable = () => typeof caches !== 'undefined'

async function dropOldCaches() {
  if (!cacheAvailable()) return
  try {
    for (const name of await caches.keys()) if (name.startsWith('mostra-speech-') && name !== CACHE) await caches.delete(name)
  } catch {
  }
}

async function fetchFile(url: string, onBytes: (bytes: number) => void): Promise<Uint8Array> {
  const cache = cacheAvailable() ? await caches.open(CACHE).catch(() => null) : null
  const cached = await cache?.match(url)
  if (cached) return new Uint8Array(await cached.arrayBuffer())
  const response = await download(url, { credentials: 'omit' })
  if (!response.ok || !response.body) throw new Error(`${url} answered ${response.status}`)
  const reader = response.clone().body!.getReader()
  const parts: Uint8Array[] = []
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    parts.push(value)
    onBytes(value.length)
  }
  await cache?.put(url, response).catch(() => {})
  const bytes = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let position = 0
  for (const part of parts) {
    bytes.set(part, position)
    position += part.length
  }
  return bytes
}

async function prepare(base: string, wanted: string) {
  const report = (bytes: number) => post({ kind: 'preparing', fraction: Math.min(1, bytes / (RUNTIME_BYTES + DETECTOR_BYTES + MODEL_BYTES)) })
  const counted = (bytes: number) => report((downloaded += bytes))
  await dropOldCaches()
  download = checkedFetch(base, fetch.bind(self))
  transformers.fetch = download
  transformers.useBrowserCache = cacheAvailable()
  transformers.cacheKey = CACHE
  runtime.logLevel = 'error'
  runtime.wasm.numThreads = 1
  runtime.wasm.proxy = false
  delete runtime.wasm.wasmPaths
  const [runtimeFile, detectorFile] = await Promise.all([fetchFile(`${base}${RUNTIME_FILE}`, counted), fetchFile(`${base}${DETECTOR_FILE}`, counted)])
  runtime.wasm.wasmBinary = runtimeFile.slice().buffer
  const detector = await InferenceSession.create(detectorFile, { executionProviders: ['wasm'] })
  const before = downloaded
  const whisper = await loadWhisper(base, (bytes) => report(before + bytes))
  const language = whisper.language(wanted)
  hearing = createHearing({
    newDetector: () => likelihoodOfSpeech(detector),
    transcribe: (audio) => whisper.transcribe(audio, language),
    settled: (settled) => post({ kind: 'settled', ...settled }),
  })
  post({ kind: 'ready' })
}

let turn: Promise<void> = Promise.resolve()

scope.onmessage = ({ data }) => {
  if (data.kind === 'prepare') {
    prepare(data.base, data.language).catch(fail)
    return
  }
  turn = turn
    .then(async () => {
      if (data.kind === 'audio') await hearing.hear(data.offset_ms, data.start_ms, data.samples)
      else await hearing.finish()
      post({ kind: 'idle' })
    })
    .catch(fail)
}

function fail(error: unknown) {
  post({ kind: 'failed', message: String(error) })
}
