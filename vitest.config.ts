import { defineConfig } from 'vitest/config'

export default defineConfig({
  esbuild: { jsx: 'automatic', jsxImportSource: 'preact' },
  define: { __MOSTRA_ENDPOINT__: JSON.stringify('https://mostra.design'), __MOSTRA_OVERLAY_FILE__: JSON.stringify('overlay.js'), __MOSTRA_OVERLAY_INTEGRITY__: JSON.stringify(''), __MOSTRA_ON_DEVICE_INTEGRITY__: JSON.stringify(''), __MOSTRA_SPEECH_WORKER_INTEGRITY__: JSON.stringify(''), __MOSTRA_SPEECH_WORKLET_INTEGRITY__: JSON.stringify('') },
  test: {
    environment: 'happy-dom',
    include: ['test/**/*.test.{ts,tsx}'],
    restoreMocks: true,
    poolOptions: { forks: { execArgv: ['--no-experimental-webstorage'] } },
  },
})
