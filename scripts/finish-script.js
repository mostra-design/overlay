import { copyFileSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const distribution = resolve(root, 'dist')
const script = resolve(distribution, 'script')

const digest = (algorithm, file, encoding) => createHash(algorithm).update(readFileSync(file)).digest(encoding)
const shortHash = (file) => digest('sha256', file, 'hex').slice(0, 16)

function describe(name, file) {
  return { file: name, sha256: digest('sha256', file, 'hex'), integrity: `sha384-${digest('sha384', file, 'base64')}` }
}

function publishAs(source, name) {
  for (const suffix of ['', '.gz', '.br']) copyFileSync(`${source}${suffix}`, resolve(script, `${name}${suffix}`))
  return describe(name, resolve(script, name))
}

renameSync(resolve(script, 'mostra.js.map'), resolve(distribution, 'mostra.js.map'))

const overlay = publishAs(resolve(distribution, 'overlay.js'), `overlay-${shortHash(resolve(distribution, 'overlay.js'))}.js`)
const loaderFile = resolve(script, 'mostra.js')
if (!readFileSync(loaderFile, 'utf8').includes(overlay.file)) throw new Error(`mostra.js doesn't load ${overlay.file}: the loader was built from another overlay.`)

const release = {
  version: JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version,
  commit: process.env.OVERLAY_COMMIT || null,
  loader: describe('mostra.js', loaderFile),
  pinned_loader: publishAs(loaderFile, `mostra-${shortHash(loaderFile)}.js`),
  overlay,
}
writeFileSync(resolve(script, 'release.json'), `${JSON.stringify(release, null, 2)}\n`)
console.log(`Finished ${script}`)
