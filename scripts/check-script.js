import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { get as getOverHttp } from 'node:http'
import { get as getOverHttps } from 'node:https'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { brotliDecompressSync, gunzipSync } from 'node:zlib'

const HASH_NAMED = /^(?:mostra|overlay)-([0-9a-f]{16})\.js$/
const SERVED_NAME = /^(?:(?:mostra|(?:mostra|overlay)-[0-9a-f]{16})\.js(?:\.br|\.gz)?|release\.json)$/
const SPEECH_FOLDER = /^v\d+(?:\/whisper-[a-z0-9-]+(?:\/onnx)?)?$/
const SPEECH_NAME = /^v\d+\/(?:(?:capture-worklet|on-device|speech-worker)\.js|ort-wasm-simd-threaded\.wasm|silero-vad\.onnx|whisper-[a-z0-9-]+\/(?:(?:config|generation_config|preprocessor_config|tokenizer|tokenizer_config)\.json|onnx\/(?:decoder_model_merged|encoder_model)_int8\.onnx))(?:\.gz)?$/

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = process.argv[2]
const speechSource = process.argv[3]
const problems = []
let checked = 0

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const integrity = (bytes) => `sha384-${createHash('sha384').update(bytes).digest('base64')}`

function compare(what, bytes, expected) {
  checked++
  if (sha256(bytes) !== expected) problems.push(`${what} has SHA-256 ${sha256(bytes)}, expected ${expected}`)
}

function checkFolder(folder) {
  const entries = readdirSync(folder, { withFileTypes: true })
  const names = new Set(entries.map((entry) => entry.name))
  for (const entry of entries) {
    if (!entry.isFile() || !SERVED_NAME.test(entry.name)) problems.push(`${entry.name} isn't something a build makes.`)
    else if (/\.(?:br|gz)$/.test(entry.name) && !names.has(entry.name.replace(/\.(?:br|gz)$/, ''))) problems.push(`${entry.name} is a compressed copy of nothing here.`)
  }

  const { loader, pinned_loader: pinnedLoader, overlay } = JSON.parse(readFileSync(resolve(folder, 'release.json'), 'utf8'))
  for (const { file } of [loader, pinnedLoader, overlay]) if (!names.has(file)) problems.push(`release.json names ${file}, which isn't here.`)
  if (names.has(loader.file)) {
    const loaderBytes = readFileSync(resolve(folder, loader.file))
    if (!loaderBytes.includes(overlay.file) || !loaderBytes.includes(overlay.integrity)) problems.push(`${loader.file} doesn't load the overlay release.json names.`)
  }

  const wanted = readdirSync(folder).flatMap((name) => {
    if (name === 'mostra.js') return [[name, loader.sha256]]
    const hash = HASH_NAMED.exec(name)?.[1]
    return hash ? [[name, hash]] : []
  })
  for (const [name, expected] of wanted) {
    const file = resolve(folder, name)
    const copies = [
      [name, readFileSync(file)],
      ...(existsSync(`${file}.br`) ? [[`${name}.br`, brotliDecompressSync(readFileSync(`${file}.br`))]] : []),
      ...(existsSync(`${file}.gz`) ? [[`${name}.gz`, gunzipSync(readFileSync(`${file}.gz`))]] : []),
    ]
    for (const [copy, bytes] of copies) {
      if (expected.length === 64) compare(copy, bytes, expected)
      else {
        checked++
        if (!sha256(bytes).startsWith(expected)) problems.push(`${copy} doesn't match the hash in its name: ${sha256(bytes)}`)
      }
    }
  }
  return names.has(overlay.file) ? readFileSync(resolve(folder, overlay.file)) : Buffer.alloc(0)
}

function checkSpeech(folder, overlayBytes) {
  const [, version] = /SPEECH_VERSION = '(.+)'/.exec(readFileSync(resolve(root, 'src/speech/messages.ts'), 'utf8'))
  for (const entry of readdirSync(folder, { recursive: true, withFileTypes: true })) {
    const path = relative(folder, resolve(entry.parentPath, entry.name))
    if (entry.isDirectory() ? !SPEECH_FOLDER.test(path) : !entry.isFile() || !SPEECH_NAME.test(path)) problems.push(`${path} isn't something a speech build makes.`)
    else if (entry.isFile() && path.endsWith('.gz')) {
      const plain = resolve(folder, path.slice(0, -'.gz'.length))
      checked++
      if (!existsSync(plain)) problems.push(`${path} is a compressed copy of nothing here.`)
      else if (sha256(gunzipSync(readFileSync(resolve(folder, path)))) !== sha256(readFileSync(plain))) problems.push(`${path} isn't a copy of the file next to it.`)
    }
  }

  const current = resolve(folder, version)
  const pinned = [...readFileSync(resolve(root, 'src/speech/speech-files.ts'), 'utf8').matchAll(/'([^']+)': '([0-9a-f]{64})'/g)]
  for (const [, name, expected] of pinned) if (existsSync(resolve(current, name))) compare(`${version}/${name}`, readFileSync(resolve(current, name)), expected)

  const script = (name) => (existsSync(resolve(current, name)) ? readFileSync(resolve(current, name)) : Buffer.alloc(0))
  const chain = [
    ['the overlay', overlayBytes, 'on-device.js'],
    ['on-device.js', script('on-device.js'), 'speech-worker.js'],
    ['on-device.js', script('on-device.js'), 'capture-worklet.js'],
  ]
  for (const [holder, bytes, name] of chain) {
    checked++
    if (!bytes.includes(integrity(script(name)))) problems.push(`${holder} doesn't hold the hash of ${version}/${name}.`)
  }
}

function fetchRaw(url, encoding) {
  const get = url.startsWith('https:') ? getOverHttps : getOverHttp
  return new Promise((resolved, rejected) => {
    get(url, { headers: { 'accept-encoding': encoding, 'cache-control': 'no-cache' } }, (response) => {
      const parts = []
      response.on('data', (part) => parts.push(part))
      response.on('end', () => resolved({ status: response.statusCode, sentAs: response.headers['content-encoding'], body: Buffer.concat(parts) }))
      response.on('error', rejected)
    }).on('error', rejected)
  })
}

function decoded({ sentAs, body }) {
  if (sentAs === 'br') return brotliDecompressSync(body)
  if (sentAs === 'gzip') return gunzipSync(body)
  return body
}

async function checkServer(base) {
  const release = JSON.parse(readFileSync(resolve(root, 'dist/script/release.json'), 'utf8'))
  for (const { file, sha256: expected } of [release.loader, release.pinned_loader, release.overlay]) {
    for (const encoding of ['identity', 'gzip', 'br']) {
      const response = await fetchRaw(new URL(file, base).href, encoding)
      if (response.status === 200) compare(`${file} sent for ${encoding}, as ${response.sentAs ?? 'plain'}`, decoded(response), expected)
      else problems.push(`${file} answered ${response.status} for ${encoding}`)
    }
  }
}

if (!source) throw new Error('Say what to check: a folder of served files and the speech folder, or a server URL.')
if (/^https?:/.test(source)) await checkServer(source)
else {
  if (!speechSource) throw new Error(`Say where the speech folder is too: node scripts/check-script.js ${source} <speech folder>`)
  checkSpeech(resolve(speechSource), checkFolder(resolve(source)))
}

for (const problem of problems) console.error(problem)
if (checked === 0) problems.push('Nothing to check.')
console.log(`${checked} copies checked, ${problems.length} wrong.`)
if (problems.length > 0) process.exit(1)
