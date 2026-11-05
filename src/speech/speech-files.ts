export const SPEECH_FILES: Record<string, string> = {
  'ort-wasm-simd-threaded.wasm': '06ba057753da3847e4c24f02d91ab133455b0817c69a44993a9a53a2146df9e3',
  'silero-vad.onnx': '1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3',
  'whisper-base/config.json': 'f4d0608f7d918166da7edb3e188de5ef1bfe70d9802e785d271fd88111e9cf4b',
  'whisper-base/generation_config.json': '61070cf8de25b1e9256e8e102ded49d8d24a8369ed36ef84fdf21549e68125a0',
  'whisper-base/preprocessor_config.json': 'a6a76d28c93edb273669eb9e0b0636a2bddbb1272c3261e47b7ca6dfdbac1b8d',
  'whisper-base/tokenizer.json': '27fc476bfe7f17299480be2273fc0608e4d5a99aba2ab5dec5374b4482d1a566',
  'whisper-base/tokenizer_config.json': '2e036e4dbacfdeb7242c7d4ec4149f4a16e86026048f94d1637e3a8ee9c6a573',
  'whisper-base/onnx/encoder_model_int8.onnx': '48cf021ce72f719b4e42c1922aede8617fdf2c22348079f46657c6e0905326f2',
  'whisper-base/onnx/decoder_model_merged_int8.onnx': 'cf9a8d5bcddc0917a0078135b484cedcaf44f28909cd91910abd29dced9171db',
}

const hex = (digest: ArrayBuffer) => Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')

export function checkedFetch(base: string, request: typeof fetch = fetch) {
  return async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input)
    const expected = url.startsWith(base) ? SPEECH_FILES[url.slice(base.length)] : undefined
    if (!expected) return new Response(null, { status: 404 })
    const response = await request(url, init)
    if (!response.ok || !response.body) return response
    const reader = response.body.getReader()
    const parts: Uint8Array<ArrayBuffer>[] = []
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const { done, value } = await reader.read()
        if (!done) {
          parts.push(value)
          controller.enqueue(value)
          return
        }
        const digest = await crypto.subtle.digest('SHA-256', await new Blob(parts).arrayBuffer())
        if (hex(digest) === expected) controller.close()
        else controller.error(new Error(`${url} isn't the file this build was made with.`))
      },
    })
    const headers = new Headers(response.headers)
    headers.delete('content-encoding')
    return new Response(body, { status: response.status, statusText: response.statusText, headers })
  }
}
