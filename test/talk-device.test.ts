import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TalkRefused, type TalkListener } from '../src/talk'
import { onDeviceSpeech, speechUrl } from '../src/talk-device'
import { verifiedImport } from '../src/verified-import'

vi.mock('../src/verified-import', () => ({ verifiedImport: vi.fn() }))

const base = speechUrl('https://mostra.test')
const listener = (): TalkListener => ({ heard: vi.fn(), level: vi.fn(), words: vi.fn(), pointed: vi.fn(), ended: vi.fn() })

function violation(blockedURI: string) {
  return Object.assign(new Event('securitypolicyviolation'), { blockedURI })
}

function failsWith(before: () => void = () => {}) {
  vi.mocked(verifiedImport).mockImplementationOnce(async () => {
    before()
    throw new Event('error')
  })
}

async function refusal(work: Promise<unknown>) {
  const settled = work.catch((error: unknown) => error)
  await vi.advanceTimersByTimeAsync(1000)
  return settled
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.mocked(verifiedImport).mockReset()
})

describe('onDeviceSpeech', () => {
  it("doesn't blame the site when the engine just didn't load", async () => {
    failsWith()

    const error = await refusal(onDeviceSpeech(window, base).record('t1', 0, listener()))

    expect(error).toBeInstanceOf(TalkRefused)
    expect(error).toMatchObject({ reason: 'unavailable' })
  })

  it("blames the site when its security policy refused the engine's own file", async () => {
    failsWith(() => document.dispatchEvent(violation(`${base}on-device.js`)))

    const error = await refusal(onDeviceSpeech(window, base).record('t1', 0, listener()))

    expect(error).toMatchObject({ reason: 'blocked' })
  })

  it('still hears a refusal that arrives just after the script says it failed', async () => {
    failsWith(() => void setTimeout(() => document.dispatchEvent(violation(`${base}on-device.js`)), 10))

    const error = await refusal(onDeviceSpeech(window, base).record('t1', 0, listener()))

    expect(error).toMatchObject({ reason: 'blocked' })
  })

  it('accepts a refusal that names only the origin, as some browsers report it', async () => {
    failsWith(() => document.dispatchEvent(violation('https://mostra.test')))

    const error = await refusal(onDeviceSpeech(window, base).record('t1', 0, listener()))

    expect(error).toMatchObject({ reason: 'blocked' })
  })

  it("ignores the policy refusing something else on the page", async () => {
    failsWith(() => document.dispatchEvent(violation('https://ads.example.com/tracker.js')))

    const error = await refusal(onDeviceSpeech(window, base).record('t1', 0, listener()))

    expect(error).toMatchObject({ reason: 'unavailable' })
  })

  it('stops listening for refusals once the import has failed', async () => {
    const removed = vi.spyOn(document, 'removeEventListener')
    failsWith()

    await refusal(onDeviceSpeech(window, base).record('t1', 0, listener()))

    expect(removed).toHaveBeenCalledWith('securitypolicyviolation', expect.any(Function))
  })

  it('lets the engine say why it refused', async () => {
    const record = vi.fn().mockRejectedValue(Object.assign(new Error('denied'), { reason: 'denied' }))
    vi.mocked(verifiedImport).mockResolvedValueOnce({ createOnDevice: () => ({ record }) })

    const error = await refusal(onDeviceSpeech(window, base).record('t1', 0, listener()))

    expect(error).toBeInstanceOf(TalkRefused)
    expect(error).toMatchObject({ reason: 'denied' })
  })

  it('tries the import again on the next Talk', async () => {
    const speech = onDeviceSpeech(window, base)
    failsWith()
    await refusal(speech.record('t1', 0, listener()))

    const capture = { stop: vi.fn() }
    vi.mocked(verifiedImport).mockResolvedValueOnce({ createOnDevice: () => ({ record: vi.fn().mockResolvedValue(capture) }) })

    await expect(speech.record('t1', 0, listener())).resolves.toBe(capture)
    expect(verifiedImport).toHaveBeenCalledTimes(2)
  })
})
