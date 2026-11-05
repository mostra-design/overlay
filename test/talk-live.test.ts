import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyTrack } from '../src/pointer-track'
import type { Transcription } from '../src/protocol'
import { TalkRefused, type TalkListener, type TalkRecording } from '../src/talk'
import type { OnDeviceSpeech } from '../src/talk-device'
import { canListenOnDevice } from '../src/talk-device'
import { createLiveTalk } from '../src/talk-live'

const RealWebAssembly = WebAssembly

const listener = (): TalkListener => ({ heard: vi.fn(), level: vi.fn(), words: vi.fn(), pointed: vi.fn(), ended: vi.fn() })

const recording = (transcription: Transcription | null, utterances: TalkRecording['utterances'] = []): TalkRecording => ({ timeline: [], utterances, track: emptyTrack(), durationMs: 9000, transcription })

function fakeOnDevice(spoken = [{ at_ms: 2100, text: 'the price is too small' }]) {
  return {
    record: vi.fn(async () => ({ stop: () => Promise.resolve() })),
    finish: vi.fn(async () => spoken),
    forget: vi.fn(async () => {}),
  } satisfies OnDeviceSpeech
}

function setup(onDevice = fakeOnDevice(), respond = () => new Response(JSON.stringify({ comments: [], minutes_left: 29 }), { status: 200 })) {
  const sent: FormData[] = []
  const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    sent.push(init!.body as FormData)
    return respond()
  })
  const talk = createLiveTalk({ window, fetch: fetcher as unknown as typeof fetch, endpoint: 'https://mostra.test', projectKey: 'pk', token: 'token', version: 'abc', onDevice })!
  return { talk, onDevice, sent }
}

function browserLikeFirefox() {
  class FakeAudioContext {
    get audioWorklet() {
      return {}
    }
  }
  Object.assign(window, { AudioContext: FakeAudioContext, Worker: class {}, WebAssembly: RealWebAssembly })
  Object.defineProperty(window.navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn() } })
  Object.assign(window, { MediaRecorder: Object.assign(class {}, { isTypeSupported: () => true }) })
}

beforeEach(browserLikeFirefox)

afterEach(() => {
  Object.defineProperty(window.navigator, 'mediaDevices', { configurable: true, value: undefined })
  for (const name of ['AudioContext', 'Worker', 'MediaRecorder', 'SpeechRecognition']) delete (window as unknown as Record<string, unknown>)[name]
})

describe('choosing a transcriber', () => {
  it('uses on-device speech where the browser cannot listen, like Firefox', () => {
    expect(setup().talk.pick(['browser', 'local'])).toBe('local')
  })

  it("prefers the browser's own recognition where there is one", () => {
    Object.assign(window, { SpeechRecognition: class {} })
    expect(setup().talk.pick(['browser', 'local'])).toBe('browser')
  })

  it('never reaches past `local` to the browser maker, on a project that chose it', () => {
    Object.assign(window, { SpeechRecognition: class {} })
    expect(setup().talk.pick(['local'])).toBe('local')
  })

  it('offers nothing when the engine cannot run: no Talk button and nothing to hang on', () => {
    delete (window as unknown as Record<string, unknown>).AudioContext
    expect(canListenOnDevice(window)).toBe(false)
    delete (window as unknown as Record<string, unknown>).MediaRecorder
    expect(createLiveTalk({ window, fetch, endpoint: 'https://mostra.test', projectKey: 'pk', token: 'token', version: null, onDevice: fakeOnDevice() })?.pick(['local']) ?? null).toBeNull()
  })

  it.each([
    ['WebAssembly is not there', () => delete (window as unknown as Record<string, unknown>).WebAssembly],
    ['workers are not there', () => delete (window as unknown as Record<string, unknown>).Worker],
    ['the microphone is not there', () => Object.defineProperty(window.navigator, 'mediaDevices', { configurable: true, value: undefined })],
    [
      "the page's CSP refuses WebAssembly",
      () =>
        Object.assign(window, {
          WebAssembly: {
            validate: RealWebAssembly.validate,
            Memory: RealWebAssembly.Memory,
            Module: class {
              constructor() {
                throw new RealWebAssembly.CompileError('Refused to compile')
              }
            },
          },
        }),
    ],
  ])('cannot listen on device when %s', (_case, take) => {
    take()
    expect(canListenOnDevice(window)).toBe(false)
  })
})

describe('what the server answers', () => {
  const said = recording('browser', [{ at_ms: 10, text: 'too small' }])

  it('hands over the comments the pass posted', async () => {
    const posted = [{ id: 'c1', number: 41, body: 'Too small.' }]
    const { talk } = setup(fakeOnDevice(), () => new Response(JSON.stringify({ comments: posted, minutes_left: 28 }), { status: 200 }))

    expect(await talk.submit('t1', said)).toEqual({ status: 'done', comments: posted, minutes_left: 28 })
  })

  it('hears a guest with no name as asking for one, not as a failure', async () => {
    const { talk } = setup(fakeOnDevice(), () => new Response(JSON.stringify({ reason: 'name_required' }), { status: 422 }))

    expect(await talk.submit('t1', said)).toEqual({ status: 'name_required' })
  })

  it('takes anything else it refuses as worth sending again', async () => {
    const { talk } = setup(fakeOnDevice(), () => new Response(JSON.stringify({ reason: 'invalid' }), { status: 422 }))

    expect(await talk.submit('t1', said)).toEqual({ status: 'failed' })
  })
})

describe('on-device speech in the live backend', () => {
  it('records through the on-device engine, with the offset on the talk clock', async () => {
    const { talk, onDevice } = setup()
    const heard = listener()

    await talk.record('t1', 41_000, 'local', heard)

    expect(onDevice.record).toHaveBeenCalledWith('t1', 41_000, heard)
  })

  it('sends what it heard as text, and never any audio', async () => {
    const { talk, sent } = setup()

    const outcome = await talk.submit('t1', recording('local'))

    expect(outcome).toMatchObject({ status: 'done' })
    expect(JSON.parse(sent[0]!.get('utterances') as string)).toEqual([{ at_ms: 2100, text: 'the price is too small' }])
    expect(sent[0]!.get('offsets')).toBeNull()
    expect(Array.from(sent[0]!.keys()).filter((key) => key.startsWith('segment'))).toEqual([])
  })

  it('leaves the engine alone for a pass the browser heard', async () => {
    const { talk, onDevice } = setup()

    await talk.submit('t1', recording('browser', [{ at_ms: 10, text: 'hello' }]))

    expect(onDevice.finish).not.toHaveBeenCalled()
  })

  it('passes the first download along to the bar', async () => {
    const { talk, onDevice } = setup()
    const onPreparing = vi.fn()

    await talk.submit('t1', recording('local'), onPreparing)

    expect(onDevice.finish).toHaveBeenCalledWith('t1', onPreparing)
  })

  it('keeps everything for Try again when the engine fails', async () => {
    const onDevice = fakeOnDevice()
    onDevice.finish.mockRejectedValueOnce(new Error('The model did not download.'))
    const { talk, sent } = setup(onDevice)

    expect(await talk.submit('t1', recording('local'))).toEqual({ status: 'failed' })
    expect(sent).toEqual([])
    expect(onDevice.forget).not.toHaveBeenCalled()

    expect(await talk.submit('t1', recording('local'))).toMatchObject({ status: 'done' })
  })

  it('says nothing was heard when nothing was', async () => {
    const { talk, sent } = setup(fakeOnDevice([]))

    expect(await talk.submit('t1', recording('local'))).toEqual({ status: 'empty' })
    expect(sent).toEqual([])
  })

  it('forgets the audio on the device, and only asks the engine when there is any', async () => {
    const { talk, onDevice } = setup()

    await talk.forget('t1', 'browser')
    expect(onDevice.forget).not.toHaveBeenCalled()

    await talk.forget('t1', 'local')
    expect(onDevice.forget).toHaveBeenCalledWith('t1')
  })

  it('lets a refusal through as it came', async () => {
    const onDevice = fakeOnDevice()
    onDevice.record.mockRejectedValueOnce(new TalkRefused('blocked'))
    const { talk } = setup(onDevice)

    await expect(talk.record('t1', 0, 'local', listener())).rejects.toMatchObject({ reason: 'blocked' })
  })
})

describe('what closed tabs left behind', () => {
  const HOUR = 60 * 60 * 1000
  const now = Date.now()
  type Rows = Record<string, Array<{ talk: string; at?: number; moment?: number }>>

  function fakeIndexedDB(databases: Record<string, Rows>) {
    const closed: string[] = []
    const connection = (name: string) => ({
      close: () => closed.push(name),
      transaction(stores: string[]) {
        const transaction = {
          oncomplete: null as (() => void) | null,
          onabort: null as (() => void) | null,
          objectStore: (store: string) => ({
            openCursor() {
              const rows = databases[name]![store]!
              const request = { result: null as unknown, onsuccess: null as (() => void) | null }
              let index = -1
              const step = () => {
                index += 1
                const row = rows[index]
                request.result = row ? { value: row, delete: () => void rows.splice(index--, 1), continue: () => queueMicrotask(step) } : null
                request.onsuccess?.()
              }
              queueMicrotask(step)
              return request
            },
          }),
        }
        setTimeout(() => transaction.oncomplete?.(), 0)
        expect(stores.every((store) => databases[name]![store])).toBe(true)
        return transaction
      },
    })
    const indexedDB = {
      open(name: string) {
        const request = {
          result: null as unknown,
          transaction: null as unknown,
          onupgradeneeded: null as (() => void) | null,
          onsuccess: null as (() => void) | null,
          onerror: null as ((event: { preventDefault(): void }) => void) | null,
        }
        queueMicrotask(() => {
          if (databases[name]) {
            request.result = connection(name)
            request.onsuccess?.()
            return
          }
          let aborted = false
          request.transaction = { abort: () => (aborted = true) }
          request.onupgradeneeded?.()
          if (!aborted) throw new Error('This would have made a database with none of its stores.')
          request.onerror?.({ preventDefault() {} })
        })
        return request
      },
    }
    Object.assign(window, { indexedDB })
    return { closed }
  }

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).indexedDB
  })

  it('deletes audio and words from every store past a day old, and nothing newer', async () => {
    const databases: Record<string, Rows> = {
      'mostra-talk': { chunks: [{ talk: 'gone', at: now - 25 * HOUR }, { talk: 'another-tab', at: now - HOUR }] },
      'mostra-talk-speech': {
        audio: [{ talk: 'gone', at: now - 25 * HOUR }, { talk: 'another-tab', at: now - HOUR }],
        text: [{ talk: 'gone', moment: now - 25 * HOUR }, { talk: 'another-tab', moment: now - HOUR }],
      },
    }
    const { closed } = fakeIndexedDB(databases)

    await setup().talk.purgeAbandoned!(null)

    expect(databases).toEqual({
      'mostra-talk': { chunks: [{ talk: 'another-tab', at: now - HOUR }] },
      'mostra-talk-speech': { audio: [{ talk: 'another-tab', at: now - HOUR }], text: [{ talk: 'another-tab', moment: now - HOUR }] },
    })
    expect(closed.sort()).toEqual(['mostra-talk', 'mostra-talk-speech'])
  })

  it("keeps this tab's own pass however old, because it stays until the tab closes or discards it", async () => {
    const databases: Record<string, Rows> = {
      'mostra-talk': { chunks: [{ talk: 'mine', at: now - 50 * HOUR }, { talk: 'gone', at: now - 50 * HOUR }] },
      'mostra-talk-speech': { audio: [{ talk: 'mine', at: now - 50 * HOUR }], text: [{ talk: 'mine', moment: now - 50 * HOUR }] },
    }
    fakeIndexedDB(databases)

    await setup().talk.purgeAbandoned!('mine')

    expect(databases).toEqual({
      'mostra-talk': { chunks: [{ talk: 'mine', at: now - 50 * HOUR }] },
      'mostra-talk-speech': { audio: [{ talk: 'mine', at: now - 50 * HOUR }], text: [{ talk: 'mine', moment: now - 50 * HOUR }] },
    })
  })

  it('makes no database for someone who has never talked, so the engine can still set its own up', async () => {
    const databases: Record<string, Rows> = {}
    fakeIndexedDB(databases)

    await setup().talk.purgeAbandoned!(null)

    expect(databases).toEqual({})
  })

  it('is quiet where IndexedDB is blocked', async () => {
    await expect(setup().talk.purgeAbandoned!(null)).resolves.toBeUndefined()
    Object.defineProperty(window, 'indexedDB', {
      configurable: true,
      get() {
        throw new DOMException('Blocked', 'SecurityError')
      },
    })
    await expect(setup().talk.purgeAbandoned!(null)).resolves.toBeUndefined()
  })

  it('never loads the on-device engine to do it', async () => {
    fakeIndexedDB({})
    const onDevice = fakeOnDevice()
    await setup(onDevice).talk.purgeAbandoned!(null)
    expect(onDevice.record).not.toHaveBeenCalled()
    expect(onDevice.finish).not.toHaveBeenCalled()
    expect(onDevice.forget).not.toHaveBeenCalled()
  })
})
