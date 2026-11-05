import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { brotliCompressSync, gzipSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'

const SCRIPT = resolve(import.meta.dirname, '../scripts/check-script.js')
const VERSION = /SPEECH_VERSION = '(.+)'/.exec(readFileSync(resolve(import.meta.dirname, '../src/speech/messages.ts'), 'utf8'))![1]!

const sha256 = (content: string | Buffer) => createHash('sha256').update(content).digest('hex')
const integrity = (content: string | Buffer) => `sha384-${createHash('sha384').update(content).digest('base64')}`
const hashName = (prefix: string, content: string) => `${prefix}-${sha256(content).slice(0, 16)}.js`

let folders: string[] = []

function write(folder: string, name: string, content: string | Buffer) {
  const file = join(folder, name)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, content)
}

function publish(folder: string, name: string, content: string) {
  write(folder, name, content)
  write(folder, `${name}.gz`, gzipSync(content))
  write(folder, `${name}.br`, brotliCompressSync(Buffer.from(content)))
}

function built() {
  const root = mkdtempSync(join(tmpdir(), 'check-script-'))
  folders.push(root)
  const script = join(root, 'script')
  const speech = join(root, 'speech')
  const worker = 'worker code'
  const worklet = 'worklet code'
  const onDevice = `on-device code ${integrity(worker)} ${integrity(worklet)}`
  const overlay = `overlay code ${integrity(onDevice)}`
  const overlayFile = hashName('overlay', overlay)
  const loader = `loader code ${overlayFile} ${integrity(overlay)}`
  const pinnedFile = hashName('mostra', loader)
  publish(script, 'mostra.js', loader)
  publish(script, pinnedFile, loader)
  publish(script, overlayFile, overlay)
  write(
    script,
    'release.json',
    JSON.stringify({
      version: '0.1.0',
      commit: null,
      loader: { file: 'mostra.js', sha256: sha256(loader), integrity: integrity(loader) },
      pinned_loader: { file: pinnedFile, sha256: sha256(loader), integrity: integrity(loader) },
      overlay: { file: overlayFile, sha256: sha256(overlay), integrity: integrity(overlay) },
    }),
  )
  for (const [name, content] of [
    ['on-device.js', onDevice],
    ['speech-worker.js', worker],
    ['capture-worklet.js', worklet],
  ] as const) {
    write(speech, `${VERSION}/${name}`, content)
    write(speech, `${VERSION}/${name}.gz`, gzipSync(content))
  }
  return { script, speech, overlayFile, pinnedFile }
}

function check(...folders: string[]) {
  const { status, stdout, stderr } = spawnSync(process.execPath, [SCRIPT, ...folders], { encoding: 'utf8' })
  return { status, output: `${stdout}${stderr}` }
}

afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})

describe('check-script.js on a folder of served files', () => {
  it('passes what a build leaves', () => {
    const { script, speech } = built()
    expect(check(script, speech)).toMatchObject({ status: 0, output: expect.stringContaining('0 wrong') })
  })

  it('refuses to check a folder without the speech folder', () => {
    const { script } = built()
    expect(check(script)).toMatchObject({ status: 1, output: expect.stringContaining('Say where the speech folder is') })
  })

  it('refuses to check nothing', () => {
    expect(check()).toMatchObject({ status: 1, output: expect.stringContaining('Say what to check') })
  })

  it('passes a file named by its hash that an earlier image left, because those never go away', () => {
    const { script, speech } = built()
    publish(script, hashName('overlay', 'an older overlay'), 'an older overlay')
    publish(script, hashName('mostra', 'an older loader'), 'an older loader')
    expect(check(script, speech).status).toBe(0)
  })

  it.each([
    ['a page with a served-looking name', 'overlay-evil.html'],
    ['a loader named by something other than a hash', 'mostra-evil.js'],
    ['an overlay named by something other than a hash', 'overlay-0123.js'],
    ['a compressed copy of a planted file', 'mostra-evil.js.br'],
    ['anything else', 'notes.txt'],
    ['a map', 'mostra.js.map'],
    ['a compressed release.json', 'release.json.gz'],
    ['a hidden file', '.htaccess'],
  ])('fails on %s', (_name, name) => {
    const { script, speech } = built()
    write(script, name, 'planted')
    const { status, output } = check(script, speech)
    expect(status).toBe(1)
    expect(output).toContain(name)
  })

  it('fails on a folder where a file should be', () => {
    const { script, speech } = built()
    mkdirSync(join(script, 'overlay-evil'))
    expect(check(script, speech)).toMatchObject({ status: 1, output: expect.stringContaining('overlay-evil') })
  })

  it('fails on a link where a file should be', () => {
    const { script, speech } = built()
    symlinkSync(join(script, 'mostra.js'), join(script, 'overlay-0123456789abcdef.js'))
    expect(check(script, speech)).toMatchObject({ status: 1, output: expect.stringContaining('overlay-0123456789abcdef.js') })
  })

  it('fails on a compressed copy with no plain file, which nothing else would look at', () => {
    const { script, speech } = built()
    write(script, 'overlay-0123456789abcdef.js.br', brotliCompressSync(Buffer.from('planted')))
    expect(check(script, speech)).toMatchObject({ status: 1, output: expect.stringContaining('compressed copy of nothing') })
  })

  it('fails on a changed copy, in any encoding', () => {
    for (const [suffix, content] of [
      ['', 'changed'],
      ['.gz', gzipSync('changed')],
      ['.br', brotliCompressSync(Buffer.from('changed'))],
    ] as const) {
      const { script, speech, overlayFile } = built()
      write(script, `${overlayFile}${suffix}`, content)
      expect(check(script, speech).status).toBe(1)
    }
  })

  it('fails when an overlay release.json names is missing', () => {
    const { script, speech, overlayFile } = built()
    rmSync(join(script, overlayFile))
    expect(check(script, speech)).toMatchObject({ status: 1, output: expect.stringContaining(`names ${overlayFile}`) })
  })

  it("fails when the loader doesn't load the overlay release.json names", () => {
    const { script, speech } = built()
    const release = JSON.parse(readFileSync(join(script, 'release.json'), 'utf8'))
    const loader = 'a loader that loads something else'
    publish(script, 'mostra.js', loader)
    release.loader.sha256 = sha256(loader)
    write(script, 'release.json', JSON.stringify(release))
    expect(check(script, speech)).toMatchObject({ status: 1, output: expect.stringContaining("doesn't load the overlay") })
  })
})

describe('check-script.js with the speech folder', () => {
  it('passes an older version, which keeps its own names', () => {
    const { script, speech } = built()
    write(speech, 'v0/whisper-tiny/config.json', '{}')
    write(speech, 'v0/whisper-tiny/config.json.gz', gzipSync('{}'))
    write(speech, 'v0/on-device.js', 'older')
    expect(check(script, speech).status).toBe(0)
  })

  it.each([
    ['a script beside the engine', `${VERSION}/evil.js`],
    ['a page beside the engine', `${VERSION}/on-device.html`],
    ['a file above the versions', 'overlay-evil.html'],
    ['a folder that is not a version', 'evil/on-device.js'],
    ['a planted file in an older version', 'v0/evil.js'],
    ['a planted file with the model', `${VERSION}/whisper-base/evil.onnx`],
    ['a brotli copy, which a speech build never makes', `${VERSION}/on-device.js.br`],
  ])('fails on %s', (_name, name) => {
    const { script, speech } = built()
    write(speech, name, 'planted')
    const { status, output } = check(script, speech)
    expect(status).toBe(1)
    expect(output).toContain(name.split('/').at(-1))
  })

  it('fails on a folder with no reason to be there, even empty', () => {
    const { script, speech } = built()
    mkdirSync(join(speech, VERSION, 'evil'))
    expect(check(script, speech)).toMatchObject({ status: 1, output: expect.stringContaining('evil') })
  })

  it('fails on a compressed copy that holds something else, or of nothing', () => {
    const changed = built()
    write(changed.speech, `${VERSION}/on-device.js.gz`, gzipSync('changed'))
    expect(check(changed.script, changed.speech)).toMatchObject({ status: 1, output: expect.stringContaining('on-device.js.gz') })

    const orphan = built()
    write(orphan.speech, `${VERSION}/silero-vad.onnx.gz`, gzipSync('model'))
    expect(check(orphan.script, orphan.speech)).toMatchObject({ status: 1, output: expect.stringContaining('compressed copy of nothing') })
  })

  it('fails on a model file that is not the one the worker pins', () => {
    const { script, speech } = built()
    write(speech, `${VERSION}/silero-vad.onnx`, 'another model')
    expect(check(script, speech)).toMatchObject({ status: 1, output: expect.stringContaining('silero-vad.onnx') })
  })

  it.each([
    ['on-device.js', 'the overlay'],
    ['speech-worker.js', 'on-device.js'],
    ['capture-worklet.js', 'on-device.js'],
  ])('fails when %s is not the one %s holds the hash of', (name, holder) => {
    const { script, speech } = built()
    write(speech, `${VERSION}/${name}`, 'changed')
    write(speech, `${VERSION}/${name}.gz`, gzipSync('changed'))
    expect(check(script, speech)).toMatchObject({ status: 1, output: expect.stringContaining(`${holder} doesn't hold the hash of ${VERSION}/${name}`) })
  })

  it('fails when the engine is missing altogether', () => {
    const { script, speech } = built()
    rmSync(join(speech, VERSION), { recursive: true })
    expect(check(script, speech)).toMatchObject({ status: 1, output: expect.stringContaining('on-device.js') })
  })
})
