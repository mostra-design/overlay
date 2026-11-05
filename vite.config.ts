import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { brotliCompressSync, gzipSync } from 'node:zlib'
import { defineConfig, transformWithEsbuild, type InlineConfig, type Plugin } from 'vite'
import { SPEECH_VERSION } from './src/speech/messages'

export const root = import.meta.dirname
const distDir = resolve(root, 'dist')
const scriptDir = resolve(distDir, 'script')
const overlayEntry = resolve(root, 'src/overlay.ts')
const mostraEndpoint = 'https://mostra.design'
export const jsx = { esbuild: { jsx: 'automatic' as const, jsxImportSource: 'preact' } }

export type BuildOptions = { minify: boolean; outDir: string; watch?: boolean }
type OverlayFile = { file: string; integrity: string }

function libraryBuild(options: BuildOptions, lib: NonNullable<NonNullable<InlineConfig['build']>['lib']>): InlineConfig {
  return {
    configFile: false,
    root,
    ...jsx,
    logLevel: options.watch ? 'warn' : 'info',
    plugins: options.watch ? [] : [precompress()],
    build: {
      outDir: options.outDir,
      emptyOutDir: false,
      target: 'es2022',
      minify: options.minify,
      sourcemap: options.watch ? true : 'hidden',
      watch: options.watch ? {} : null,
      lib,
    },
  }
}

export function scriptBuild(options: BuildOptions, overlay: OverlayFile, endpoint = mostraEndpoint): InlineConfig {
  return {
    ...libraryBuild(options, { entry: resolve(root, 'src/auto.ts'), name: '__mostraBundle', formats: ['iife'], fileName: () => 'mostra.js' }),
    define: { __MOSTRA_ENDPOINT__: JSON.stringify(endpoint), __MOSTRA_OVERLAY_FILE__: JSON.stringify(overlay.file), __MOSTRA_OVERLAY_INTEGRITY__: JSON.stringify(overlay.integrity) },
  }
}

export function overlayBuild(options: BuildOptions, onDeviceIntegrity: string): InlineConfig {
  const config = { ...libraryBuild(options, { entry: overlayEntry, formats: ['es'], fileName: () => 'overlay.js' }), define: { __MOSTRA_ON_DEVICE_INTEGRITY__: JSON.stringify(onDeviceIntegrity) } }
  return options.minify ? { ...config, plugins: [minifyWhitespace(), ...(config.plugins ?? [])] } : config
}

const integrityOf = (file: string) => `sha384-${createHash('sha384').update(readFileSync(file)).digest('base64')}`

function builtOverlay(): OverlayFile {
  const overlay = resolve(distDir, 'overlay.js')
  if (!existsSync(overlay)) throw new Error('dist/overlay.js is missing: the loader needs its hash. Run `vite build --mode overlay` first.')
  return { file: `overlay-${createHash('sha256').update(readFileSync(overlay)).digest('hex').slice(0, 16)}.js`, integrity: integrityOf(overlay) }
}

function builtOnDeviceIntegrity(): string {
  const onDevice = resolve(distDir, 'speech', SPEECH_VERSION, 'on-device.js')
  if (!existsSync(onDevice)) throw new Error(`${onDevice} is missing: the overlay needs its hash. Run scripts/build-speech.js first.`)
  return integrityOf(onDevice)
}

function minifyWhitespace(): Plugin {
  return {
    name: 'mostra:minify-whitespace',
    renderChunk: {
      order: 'post',
      async handler(code, chunk) {
        const result = await transformWithEsbuild(code, chunk.fileName, { minifyWhitespace: true, format: 'esm', target: 'es2022', sourcemap: true })
        return { code: result.code.replaceAll(/\bimport\((?=[\w$]+\))/g, 'import(/* @vite-ignore */ /* webpackIgnore: true */ '), map: JSON.stringify(result.map) }
      },
    },
  }
}

function precompress(): Plugin {
  return {
    name: 'mostra:precompress',
    writeBundle(output, bundle) {
      for (const fileName of Object.keys(bundle).filter((name) => name.endsWith('.js'))) {
        const file = resolve(output.dir ?? distDir, fileName)
        const source = readFileSync(file)
        writeFileSync(`${file}.gz`, gzipSync(source, { level: 9 }))
        writeFileSync(`${file}.br`, brotliCompressSync(source))
      }
    },
  }
}

export default defineConfig(({ mode }) => {
  if (mode === 'esm') {
    return {
      ...jsx,
      define: { __MOSTRA_ENDPOINT__: JSON.stringify(mostraEndpoint) },
      build: {
        emptyOutDir: false,
        target: 'es2022',
        minify: false,
        sourcemap: true,
        lib: { entry: resolve(root, 'src/index.ts'), formats: ['es'], fileName: () => 'mostra.mjs' },
        rollupOptions: { external: [overlayEntry], output: { paths: { [overlayEntry]: './overlay.js' } } },
      },
    }
  }
  const { configFile: _configFile, ...config } =
    mode === 'overlay' ? overlayBuild({ minify: true, outDir: distDir }, builtOnDeviceIntegrity()) : scriptBuild({ minify: true, outDir: scriptDir }, builtOverlay())
  return config
})
