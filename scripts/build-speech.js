import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { build } from 'vite'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { SPEECH_VERSION } = await readVersion()
const target = resolve(root, process.argv[2] ?? 'dist/speech', SPEECH_VERSION)
const modelDirectory = resolve(root, 'speech-model')
const runtimeDirectory = resolve(root, 'node_modules/onnxruntime-web/dist')

async function readVersion() {
  const source = readFileSync(resolve(root, 'src/speech/messages.ts'), 'utf8')
  return { SPEECH_VERSION: /SPEECH_VERSION = '(.+)'/.exec(source)[1] }
}

const leaveRuntimeOut = {
  name: 'mostra:leave-runtime-out',
  enforce: 'pre',
  transform(code, id) {
    if (id.includes('onnxruntime-web')) return code.replaceAll('new URL("ort-wasm-simd-threaded.wasm",import.meta.url).href', '"ort-wasm-simd-threaded.wasm"')
  },
}

const integrityOf = (name) => JSON.stringify(`sha384-${createHash('sha384').update(readFileSync(resolve(target, name))).digest('base64')}`)

for (const script of ['capture-worklet', 'speech-worker', 'on-device']) {
  await build({
    configFile: false,
    root,
    logLevel: 'warn',
    plugins: [leaveRuntimeOut],
    define: script === 'on-device' ? { __MOSTRA_SPEECH_WORKER_INTEGRITY__: integrityOf('speech-worker.js'), __MOSTRA_SPEECH_WORKLET_INTEGRITY__: integrityOf('capture-worklet.js') } : {},
    resolve: { alias: { 'onnxruntime-web/webgpu': 'onnxruntime-web/wasm', 'onnxruntime-common': 'onnxruntime-web/wasm' } },
    build: {
      outDir: target,
      emptyOutDir: false,
      target: 'es2022',
      minify: true,
      lib: { entry: resolve(root, `src/speech/${script}.ts`), formats: ['es'], fileName: () => `${script}.js` },
    },
  })
}

mkdirSync(target, { recursive: true })
cpSync(resolve(runtimeDirectory, 'ort-wasm-simd-threaded.wasm'), resolve(target, 'ort-wasm-simd-threaded.wasm'))
if (existsSync(modelDirectory)) cpSync(modelDirectory, target, { recursive: true })
else console.warn('No model yet: run `uv run scripts/fetch-speech-model.py`, then build again.')

const pinned = [...readFileSync(resolve(root, 'src/speech/speech-files.ts'), 'utf8').matchAll(/'([^']+)': '([0-9a-f]{64})'/g)]
for (const [, name, expected] of pinned) {
  const file = resolve(target, name)
  if (!existsSync(file)) continue
  const actual = createHash('sha256').update(readFileSync(file)).digest('hex')
  if (actual !== expected) throw new Error(`${name} has SHA-256 ${actual}, but src/speech/speech-files.ts says ${expected}.`)
}

function compress(directory) {
  for (const entry of readdirSync(directory, { recursive: true })) {
    const file = resolve(directory, entry)
    if (statSync(file).isFile() && !file.endsWith('.gz')) writeFileSync(`${file}.gz`, gzipSync(readFileSync(file), { level: 9 }))
  }
}

compress(target)
console.log(`Built ${target}`)
