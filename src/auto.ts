import { overlayUrl, readScriptConfig } from './config'
import type { MostraApi } from './index'
import { createMostra, type OverlayModule } from './loader'
import { verifiedImport } from './verified-import'

const dormant: MostraApi = { enable: async () => false, disable() {}, version: null }

const script =
  document.currentScript instanceof HTMLScriptElement && document.currentScript.dataset.project !== undefined
    ? document.currentScript
    : document.querySelector<HTMLScriptElement>('script[data-project]')

if (!window.Mostra) {
  const config = readScriptConfig(script, document)
  if (!config && script) console.warn('[mostra] The script tag needs a data-project attribute.')
  window.Mostra =
    config && script
      ? createMostra(config, () => verifiedImport<OverlayModule>(overlayUrl(script.src, __MOSTRA_OVERLAY_FILE__), __MOSTRA_OVERLAY_INTEGRITY__, document, script.nonce ?? ''))
      : dormant
}
