import type { Comment } from './protocol'
import { SPEECH_DATABASE, SPEECH_STORES } from './speech/speech-store'
import { TalkRefused, type OnPreparing, type TalkBackend, type TalkCapture, type TalkListener, type TalkOutcome, type TalkRecording } from './talk'
import { canListenOnDevice, onDeviceSpeech, speechUrl, type OnDeviceSpeech } from './talk-device'
import { canRecognizeSpeech, listenToSpeech } from './talk-speech'

type Chunk = { talk: string; offset_ms: number; mime: string; blob: Blob; at: number }
type HeldRow = { talk: string; at?: number; moment?: number }

const BITS_PER_SECOND = 32_000
const CHUNK_MS = 1000
const MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
const MAX_STRETCHES = 128
const DATABASE = 'mostra-talk'
const STORE = 'chunks'
const ABANDONED_MS = 24 * 60 * 60 * 1000

export type LiveTalkOptions = { window: Window; fetch: typeof fetch; endpoint: string; projectKey: string; token: string; version: string | null; onDevice?: OnDeviceSpeech }

export function createLiveTalk(options: LiveTalkOptions): TalkBackend | null {
  const { window: target } = options
  const mediaDevices = target.navigator.mediaDevices
  const Recorder = (target as Window & { MediaRecorder?: typeof MediaRecorder }).MediaRecorder
  const canRecord = typeof mediaDevices?.getUserMedia === 'function' && Boolean(Recorder)
  const canHear = canRecognizeSpeech(target)
  const canListen = canListenOnDevice(target)
  if (!canRecord && !canHear && !canListen) return null
  const chunks = chunkStore(target)
  const onDevice = options.onDevice ?? onDeviceSpeech(target, speechUrl(options.endpoint))
  const running = new Set<string>()

  async function recordAudio(talkId: string, offsetMs: number, listener: TalkListener): Promise<TalkCapture> {
    let stream: MediaStream
    try {
      stream = await mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
    } catch (error) {
      throw new TalkRefused((error as DOMException).name === 'NotAllowedError' ? 'denied' : 'unsupported')
    }
    void chunks.purgeAbandoned()

    const mimeType = MIME_TYPES.find((type) => Recorder!.isTypeSupported(type))
    const recorder = new Recorder!(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: BITS_PER_SECOND })
    const writes: Array<Promise<void>> = []
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) writes.push(chunks.add({ talk: talkId, offset_ms: offsetMs, mime: recorder.mimeType || mimeType || 'audio/webm', blob: event.data, at: Date.now() }))
    }
    const stopLevel = watchLevel(target, stream, listener)
    stream.getAudioTracks()[0]?.addEventListener('ended', () => listener.ended())
    recorder.start(CHUNK_MS)

    return {
      stop: () =>
        new Promise<void>((resolve) => {
          recorder.onstop = () => {
            stopLevel()
            for (const track of stream.getTracks()) track.stop()
            void Promise.allSettled(writes).then(() => resolve())
          }
          if (recorder.state === 'inactive') recorder.onstop(new Event('stop'))
          else recorder.stop()
        }),
    }
  }

  return {
    pick: (transcribers) => transcribers.find((transcription) => ({ browser: canHear, smart: canRecord, local: canListen })[transcription]) ?? null,

    record(talkId, offsetMs, transcription, listener) {
      if (transcription === 'browser') return listenToSpeech(target, offsetMs, listener)
      return transcription === 'local' ? onDevice.record(talkId, offsetMs, listener) : recordAudio(talkId, offsetMs, listener)
    },

    async submit(talkId, recording, onPreparing) {
      if (running.has(talkId)) {
        const outcome = await send(options, pollForm(talkId))
        if (outcome.status === 'processing') return outcome
        running.delete(talkId)
        if (outcome.status === 'done') return outcome
      }
      const spoken = await spokenOnDevice(talkId, recording, onPreparing)
      if (!spoken) return { status: 'failed' }
      const utterances = [...recording.utterances, ...spoken]
      const recorded = await chunks.read(talkId)
      if (recorded.length === 0 && utterances.length === 0) return { status: 'empty' }
      const outcome = await send(options, uploadForm(options, talkId, recorded, { ...recording, utterances }))
      if (outcome.status === 'processing') running.add(talkId)
      return outcome
    },

    async forget(talkId, transcription) {
      await chunks.remove(talkId)
      if (transcription === 'local') await onDevice.forget(talkId)
    },

    purgeAbandoned: (keep) => purgeAbandoned(target, keep),
  }

  async function spokenOnDevice(talkId: string, recording: TalkRecording, onPreparing?: OnPreparing) {
    if (recording.transcription !== 'local') return []
    return onDevice.finish(talkId, onPreparing).catch(() => null)
  }
}

function pollForm(talkId: string): FormData {
  const form = new FormData()
  form.set('client_id', talkId)
  form.set('poll', 'true')
  return form
}

export function uploadForm(options: Pick<LiveTalkOptions, 'version'>, talkId: string, recorded: Chunk[], { timeline, utterances, track, durationMs }: TalkRecording): FormData {
  const stretches = new Map<number, Chunk[]>()
  for (const chunk of recorded) stretches.set(chunk.offset_ms, [...(stretches.get(chunk.offset_ms) ?? []), chunk])
  const offsets = Array.from(stretches.keys())
    .sort((first, second) => first - second)
    .slice(-MAX_STRETCHES)

  const form = new FormData()
  form.set('client_id', talkId)
  form.set('duration_ms', String(Math.round(durationMs)))
  form.set('timeline', JSON.stringify(timeline))
  if (track.spans.length > 0) form.set('track', JSON.stringify(track))
  if (utterances.length > 0) form.set('utterances', JSON.stringify(utterances))
  if (offsets.length > 0) form.set('offsets', JSON.stringify(offsets))
  if (options.version) form.set('version', options.version)
  offsets.forEach((offset, index) => {
    const parts = stretches.get(offset)!
    const mime = parts[0]!.mime
    form.set(`segment_${index}`, new Blob(parts.map((chunk) => chunk.blob), { type: mime }), `segment-${index}`)
  })
  return form
}

async function send(options: LiveTalkOptions, form: FormData): Promise<TalkOutcome> {
  let response: Response
  try {
    response = await options.fetch(`${options.endpoint}/api/v1/projects/${encodeURIComponent(options.projectKey)}/talks`, {
      method: 'POST',
      headers: { authorization: `Bearer ${options.token}`, accept: 'application/json' },
      credentials: 'omit',
      body: form,
    })
  } catch {
    return { status: 'failed' }
  }

  if (response.status === 200) {
    const body = (await response.json()) as { comments: Comment[]; minutes_left: number }
    return { status: 'done', comments: body.comments, minutes_left: body.minutes_left }
  }
  if (response.status === 202) return { status: 'processing' }
  if (response.status === 429) return { status: 'out_of_minutes' }
  if (response.status === 422 && (await reasonOf(response)) === 'name_required') return { status: 'name_required' }
  return { status: 'failed' }
}

async function reasonOf(response: Response): Promise<string | null> {
  try {
    return ((await response.json()) as { reason?: string }).reason ?? null
  } catch {
    return null
  }
}

function watchLevel(target: Window, stream: MediaStream, listener: TalkListener): () => void {
  try {
    const context = new (target as Window & { AudioContext: typeof AudioContext }).AudioContext()
    const analyser = context.createAnalyser()
    analyser.fftSize = 256
    context.createMediaStreamSource(stream).connect(analyser)
    const samples = new Uint8Array(analyser.fftSize)
    const timer = setInterval(() => {
      analyser.getByteTimeDomainData(samples)
      const power = samples.reduce((sum, sample) => sum + ((sample - 128) / 128) ** 2, 0) / samples.length
      listener.level(Math.min(1, Math.sqrt(power) * 4))
    }, 100)
    return () => {
      clearInterval(timer)
      void context.close()
    }
  } catch {
    return () => {}
  }
}

async function purgeAbandoned(target: Window, keep: string | null): Promise<void> {
  const abandoned = (row: HeldRow) => row.talk !== keep && Date.now() - (row.at ?? row.moment ?? 0) > ABANDONED_MS
  await Promise.allSettled([purgeRows(target, DATABASE, [STORE], abandoned), purgeRows(target, SPEECH_DATABASE, SPEECH_STORES, abandoned)])
}

function purgeRows(target: Window, name: string, stores: string[], abandoned: (row: HeldRow) => boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = target.indexedDB.open(name)
    request.onupgradeneeded = () => request.transaction!.abort()
    request.onerror = (event) => {
      event.preventDefault()
      resolve()
    }
    request.onsuccess = () => {
      const database = request.result
      const finished = () => {
        database.close()
        resolve()
      }
      try {
        const transaction = database.transaction(stores, 'readwrite')
        transaction.oncomplete = finished
        transaction.onabort = finished
        for (const store of stores) {
          const cursor = transaction.objectStore(store).openCursor()
          cursor.onsuccess = () => {
            const current = cursor.result
            if (!current) return
            if (abandoned(current.value as HeldRow)) current.delete()
            current.continue()
          }
        }
      } catch (error) {
        database.close()
        reject(error)
      }
    }
  })
}

function chunkStore(target: Window) {
  const memory: Chunk[] = []
  let opening: Promise<IDBDatabase> | null = null

  function database(): Promise<IDBDatabase> {
    opening ??= new Promise((resolve, reject) => {
      const request = target.indexedDB.open(DATABASE, 1)
      request.onupgradeneeded = () => request.result.createObjectStore(STORE, { autoIncrement: true })
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    return opening
  }

  async function transaction<Result>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<Result>): Promise<Result> {
    const store = (await database()).transaction(STORE, mode).objectStore(STORE)
    return new Promise((resolve, reject) => {
      const request = work(store)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  async function removeWhere(matches: (chunk: Chunk) => boolean): Promise<void> {
    const store = (await database()).transaction(STORE, 'readwrite').objectStore(STORE)
    await new Promise<void>((resolve, reject) => {
      const cursor = store.openCursor()
      cursor.onerror = () => reject(cursor.error)
      cursor.onsuccess = () => {
        const current = cursor.result
        if (!current) return resolve()
        if (matches(current.value as Chunk)) current.delete()
        current.continue()
      }
    })
  }

  return {
    async add(chunk: Chunk): Promise<void> {
      try {
        await transaction('readwrite', (store) => store.add(chunk))
      } catch {
        memory.push(chunk)
      }
    },
    async read(talk: string): Promise<Chunk[]> {
      const stored = await transaction('readonly', (store) => store.getAll() as IDBRequest<Chunk[]>).catch(() => [] as Chunk[])
      return [...stored, ...memory].filter((chunk) => chunk.talk === talk)
    },
    async remove(talk: string): Promise<void> {
      for (let index = memory.length - 1; index >= 0; index--) if (memory[index]!.talk === talk) memory.splice(index, 1)
      await removeWhere((chunk) => chunk.talk === talk).catch(() => {})
    },
    purgeAbandoned: () => removeWhere((chunk) => Date.now() - chunk.at > ABANDONED_MS).catch(() => {}),
  }
}
