import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { checkedFetch, SPEECH_FILES } from '../src/speech/speech-files'

const base = 'https://mostra.test/speech/v1/'
const name = 'silero-vad.onnx'
const expected = SPEECH_FILES[name]!

function withFile(content: string, work: () => Promise<void>) {
  const original = SPEECH_FILES[name]!
  SPEECH_FILES[name] = createHash('sha256').update(content).digest('hex')
  return work().finally(() => {
    SPEECH_FILES[name] = original
  })
}

describe('checkedFetch', () => {
  it('hands over a file that matches', async () => {
    await withFile('the right bytes', async () => {
      const request = vi.fn(async () => new Response('the right bytes', { headers: { 'content-encoding': 'gzip' } }))
      const response = await checkedFetch(base, request as unknown as typeof fetch)(`${base}${name}`)

      expect(await response.text()).toBe('the right bytes')
      expect(response.headers.has('content-encoding')).toBe(false)
    })
  })

  it('fails the read of a file that does not match', async () => {
    const request = vi.fn(async () => new Response('other bytes'))
    const response = await checkedFetch(base, request as unknown as typeof fetch)(`${base}${name}`)

    expect(expected).not.toBe(createHash('sha256').update('other bytes').digest('hex'))
    await expect(response.text()).rejects.toThrow()
  })

  it('never asks the network for a file outside the table', async () => {
    const request = vi.fn(async () => new Response('anything'))
    const check = checkedFetch(base, request as unknown as typeof fetch)

    expect((await check(`${base}whisper-base/onnx/other.onnx`)).status).toBe(404)
    expect((await check('https://huggingface.co/whisper-base/config.json')).status).toBe(404)
    expect(request).not.toHaveBeenCalled()
  })

  it('passes a failed request along as it is', async () => {
    const request = vi.fn(async () => new Response(null, { status: 503 }))
    const response = await checkedFetch(base, request as unknown as typeof fetch)(`${base}${name}`)

    expect(response.status).toBe(503)
  })
})
