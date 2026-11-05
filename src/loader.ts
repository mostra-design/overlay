import type { MostraConfig } from './config'
import type { MostraApi } from './index'
import type { createOverlay, Overlay } from './overlay'
import { readDeepLink, readInvite, stripMostraParameters } from './page-url'
import { safeStorage, storageKeys } from './storage'

export type OverlayModule = { createOverlay: typeof createOverlay }

export function createMostra(config: MostraConfig, importOverlay: () => Promise<OverlayModule>, target: Window = window): MostraApi {
  const local = safeStorage(target, 'localStorage')
  const session = safeStorage(target, 'sessionStorage')
  const keys = storageKeys(config.projectKey)
  let overlay: Overlay | null = null
  let loading: Promise<Overlay | null> | null = null
  let deepLink: number | null = null

  const load = () =>
    (loading ??= Promise.resolve()
      .then(importOverlay)
      .then(
        (module) => (overlay = module.createOverlay(config, { window: target, deepLink })),
        (error: unknown) => {
          console.warn('[mostra] Could not load the overlay.', error)
          return null
        },
      ))

  function enable(invite?: string): Promise<boolean> {
    if (!invite && !loading && !local.get(keys.token)) return Promise.resolve(false)
    return load().then((loaded) => (loaded ? loaded.enable(invite ?? null) : false))
  }

  const invite = readInvite(target.location.search)
  if (invite || local.get(keys.token)) {
    deepLink = readDeepLink(target.location.search)
    stripMostraParameters(target)
    void enable(invite ?? undefined)
  }

  return {
    enable,
    disable() {
      overlay?.stop()
      local.remove(keys.token)
      session.remove(keys.player)
      session.remove(keys.pendingFocus)
    },
    get version() {
      return config.version
    },
  }
}
