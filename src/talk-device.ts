import { TalkRefused, type OnPreparing, type TalkCapture, type TalkListener, type Utterance } from './talk'
import { SPEECH_VERSION } from './speech/messages'
import { verifiedImport } from './verified-import'

export type OnDeviceSpeech = {
  record(talkId: string, offsetMs: number, listener: TalkListener): Promise<TalkCapture>
  finish(talkId: string, onPreparing?: OnPreparing): Promise<Utterance[]>
  forget(talkId: string): Promise<void>
}

const EMPTY_MODULE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])
const SIMD_MODULE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 10, 30, 1, 28, 0, 65, 0, 253, 15, 253, 12, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 253, 186, 1, 26, 11])
const REFUSAL_REPORT_MS = 100

export function canListenOnDevice(target: Window): boolean {
  const scope = target as Window & typeof globalThis
  try {
    if (typeof target.navigator.mediaDevices?.getUserMedia !== 'function' || !scope.Worker || !scope.AudioContext || !('audioWorklet' in scope.AudioContext.prototype)) return false
    new scope.WebAssembly.Module(EMPTY_MODULE)
    new scope.WebAssembly.Memory({ initial: 1, maximum: 1, shared: true })
    return scope.WebAssembly.validate(SIMD_MODULE)
  } catch {
    return false
  }
}

export function speechUrl(endpoint: string): string {
  return `${endpoint}/speech/${SPEECH_VERSION}/`
}

async function importEngine(target: Window, url: string) {
  const { document } = target
  const { origin } = new URL(url, document.baseURI)
  let refused = false
  const onRefusal = (event: SecurityPolicyViolationEvent) => {
    if (event.blockedURI.startsWith(origin)) refused = true
  }
  document.addEventListener('securitypolicyviolation', onRefusal)
  try {
    const nonce = document.querySelector<HTMLScriptElement>('script[nonce]')?.nonce ?? ''
    return await verifiedImport<typeof import('./speech/on-device')>(url, __MOSTRA_ON_DEVICE_INTEGRITY__, document, nonce)
  } catch {
    await new Promise((settled) => target.setTimeout(settled, REFUSAL_REPORT_MS))
    throw new TalkRefused(refused ? 'blocked' : 'unavailable')
  } finally {
    document.removeEventListener('securitypolicyviolation', onRefusal)
  }
}

export function onDeviceSpeech(target: Window, base: string): OnDeviceSpeech {
  let loading: Promise<OnDeviceSpeech> | null = null

  function load(): Promise<OnDeviceSpeech> {
    loading ??= importEngine(target, `${base}on-device.js`).then(
      ({ createOnDevice }) => createOnDevice({ window: target, base }),
      (error: unknown) => {
        loading = null
        throw error
      },
    )
    return loading
  }

  return {
    async record(talkId, offsetMs, listener) {
      try {
        return await (await load()).record(talkId, offsetMs, listener)
      } catch (error) {
        throw new TalkRefused((error as { reason?: TalkRefused['reason'] }).reason ?? 'unavailable')
      }
    },
    finish: async (talkId, onPreparing) => (await load()).finish(talkId, onPreparing),
    forget: async (talkId) => (await load()).forget(talkId),
  }
}
