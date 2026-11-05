import type { OnPreparing, TalkListener } from '../talk'
import type { OnDeviceSpeech } from '../talk-device'
import type { FromEngine, ToEngine } from './messages'
import { openMicrophone } from './microphone'
import { createSpeechStore } from './speech-store'

const LAST_WORDS = 6
const STALLED_MS = 120_000
const WORKER_CHECK_MS = 3000
const WORKER_CHECK = 'postMessage(1)'

type Waiting = { resolve(): void; reject(error: Error): void }

function refusal(reason: 'denied' | 'unsupported' | 'blocked'): Error {
  return Object.assign(new Error(reason), { reason })
}

type Pass = {
  id: string
  listener: TalkListener | null
  closing: boolean
  pumping: Promise<void> | null
  wake: (() => void) | null
  onPreparing: OnPreparing | null
}

export function createOnDevice({ window: target, base }: { window: Window; base: string }): OnDeviceSpeech {
  const { Worker: EngineWorker } = target as Window & typeof globalThis
  const store = createSpeechStore(target)
  const passes = new Map<string, Pass>()
  let worker: Worker | null = null
  let engineReady: Promise<void> | null = null
  let readyWaiting: Waiting | null = null
  let idleWaiting: Waiting | null = null
  let settling: Promise<void> = Promise.resolve()
  let current: Pass | null = null
  let lastSign = 0

  function passFor(id: string): Pass {
    let pass = passes.get(id)
    if (!pass) {
      pass = { id, listener: null, closing: false, pumping: null, wake: null, onPreparing: null }
      passes.set(id, pass)
    }
    return pass
  }

  function stopEngine(error: Error) {
    worker?.terminate()
    worker = null
    engineReady = null
    readyWaiting?.reject(error)
    readyWaiting = null
    idleWaiting?.reject(error)
    idleWaiting = null
  }

  function onEngineMessage({ data }: MessageEvent<FromEngine>) {
    lastSign = Date.now()
    switch (data.kind) {
      case 'preparing':
        current?.onPreparing?.(data.fraction)
        return
      case 'ready':
        current?.onPreparing?.(null)
        readyWaiting?.resolve()
        readyWaiting = null
        return
      case 'settled': {
        const pass = current
        if (!pass) return
        settling = settling.catch(() => {}).then(() => store.settle(pass.id, data.offset_ms, data.consumed_ms, data.heard))
        if (data.heard) pass.listener?.words(data.heard.text.split(/\s+/).slice(-LAST_WORDS).join(' '))
        return
      }
      case 'idle': {
        const waiting = idleWaiting
        idleWaiting = null
        void settling.then(() => waiting?.resolve(), (error: Error) => waiting?.reject(error))
        return
      }
      case 'failed':
        stopEngine(new Error(data.message))
    }
  }

  function startEngine(): Promise<void> {
    engineReady ??= new Promise<void>((resolve, reject) => {
      readyWaiting = { resolve, reject }
      void (async () => {
        const response = await target.fetch(`${base}speech-worker.js`, { credentials: 'omit', integrity: __MOSTRA_SPEECH_WORKER_INTEGRITY__ })
        if (!response.ok) throw new Error(`speech-worker.js answered ${response.status}`)
        const url = URL.createObjectURL(new Blob([await response.arrayBuffer()], { type: 'text/javascript' }))
        const started = new EngineWorker(url, { type: 'module' })
        started.onmessage = onEngineMessage
        started.onerror = (event) => stopEngine(new Error(event.message || "The speech engine didn't start."))
        worker = started
        send({ kind: 'prepare', base, language: target.navigator.language || 'en-US' })
        target.setTimeout(() => URL.revokeObjectURL(url), WORKER_CHECK_MS)
      })().catch((error: Error) => stopEngine(error))
    })
    return engineReady
  }

  function send(message: ToEngine) {
    worker?.postMessage(message, message.kind === 'audio' ? [message.samples.buffer as ArrayBuffer] : [])
  }

  function exchange(message: ToEngine): Promise<void> {
    if (!worker) return Promise.reject(new Error('The speech engine has stopped.'))
    return new Promise((resolve, reject) => {
      idleWaiting = { resolve, reject }
      send(message)
    })
  }

  async function pump(pass: Pass) {
    current = pass
    await startEngine()
    let lastId = 0
    for (;;) {
      const row = await store.next(pass.id, lastId)
      if (row) {
        lastId = row.id!
        await exchange({ kind: 'audio', offset_ms: row.offset_ms, start_ms: row.start_ms, samples: row.samples.slice() })
      } else if (pass.closing) {
        await exchange({ kind: 'end' })
        return
      } else {
        await new Promise<void>((resolve) => (pass.wake = resolve))
      }
    }
  }

  function startPump(pass: Pass): Promise<void> {
    pass.pumping ??= pump(pass).finally(() => {
      pass.pumping = null
    })
    return pass.pumping
  }

  function wakePump(pass: Pass) {
    pass.wake?.()
    pass.wake = null
  }

  function checkWorkers(): Promise<void> {
    return new Promise((resolve, reject) => {
      const refused = () => reject(refusal('blocked'))
      const url = URL.createObjectURL(new Blob([WORKER_CHECK], { type: 'text/javascript' }))
      const timer = target.setTimeout(refused, WORKER_CHECK_MS)
      try {
        const check = new EngineWorker(url, { type: 'module' })
        const finished = (settle: () => void) => {
          target.clearTimeout(timer)
          check.terminate()
          URL.revokeObjectURL(url)
          settle()
        }
        check.onmessage = () => finished(resolve)
        check.onerror = () => finished(refused)
      } catch {
        target.clearTimeout(timer)
        refused()
      }
    })
  }

  return {
    async record(talkId, offsetMs, listener) {
      await checkWorkers()
      let stream: MediaStream
      try {
        stream = await target.navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      } catch (error) {
        throw refusal((error as DOMException).name === 'NotAllowedError' ? 'denied' : 'unsupported')
      }
      void store.purgeAbandoned()
      const pass = passFor(talkId)
      pass.listener = listener
      const writes: Array<Promise<void>> = []
      const write = (start_ms: number, samples: Int16Array) => {
        const writing = store.add({ talk: talkId, offset_ms: offsetMs, start_ms, samples, at: Date.now() }).then(() => wakePump(pass))
        writes.push(writing)
      }
      const workletUrl = `${base}capture-worklet.js`
      const microphone = await target
        .fetch(workletUrl, { credentials: 'omit', integrity: __MOSTRA_SPEECH_WORKLET_INTEGRITY__ })
        .then(() =>
          openMicrophone(target, stream, workletUrl, {
            chunk: ({ start_ms, samples }) => write(start_ms, samples),
            level: (value) => listener.level(value),
          }),
        )
        .catch(() => {
          for (const track of stream.getTracks()) track.stop()
          throw refusal('unsupported')
        })
      stream.getAudioTracks()[0]?.addEventListener('ended', () => listener.ended())
      startPump(pass).catch(() => {})
      return {
        flush: () => microphone.flush(),
        async stop() {
          await microphone.stop()
          await Promise.allSettled(writes)
        },
      }
    },

    async finish(talkId, onPreparing) {
      const pass = passFor(talkId)
      pass.closing = true
      pass.onPreparing = onPreparing ?? null
      wakePump(pass)
      if (pass.pumping || (await store.next(talkId, 0))) await watched(startPump(pass))
      pass.onPreparing = null
      await settling
      return store.spoken(talkId)
    },

    async forget(talkId) {
      const pass = passes.get(talkId)
      passes.delete(talkId)
      if (current?.id === talkId) {
        current = null
        stopEngine(new Error('The talk is over.'))
      }
      if (pass) {
        pass.closing = true
        wakePump(pass)
      }
      await store.remove(talkId)
    },
  }

  function watched(work: Promise<void>): Promise<void> {
    lastSign = Date.now()
    return new Promise((resolve, reject) => {
      const check = target.setInterval(() => {
        if (Date.now() - lastSign > STALLED_MS) stopEngine(new Error('The speech engine stopped answering.'))
      }, 1000)
      work.then(resolve, reject).finally(() => target.clearInterval(check))
    })
  }
}
