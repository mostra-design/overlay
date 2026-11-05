import { createReviewerSession, fetchProject, type JoinProblem } from './api'
import type { MostraConfig } from './config'
import { createController } from './controller'
import { installFonts } from './fonts'
import { readDeepLink, stripMostraParameters } from './page-url'
import type { Connection, Project } from './protocol'
import { connectRealtime, type RealtimeOptions } from './realtime'
import { safeStorage, storageKeys, type SafeStorage } from './storage'
import type { TalkBackend } from './talk'
import { createLiveTalk } from './talk-live'
import { isOwnElement, isOwnEvent } from './ui/CommentMode'
import { mountOverlay, peekDuration } from './ui/mount'
import { showJoinProblem } from './ui/notice'

export type Environment = {
  window: Window
  fetch: typeof fetch
  connect: (options: RealtimeOptions) => Connection
  local: SafeStorage
  session: SafeStorage
  fonts: string | null
  navigate: (url: string) => void
  talk: (token: string) => TalkBackend | null
  deepLink: number | null
}

export type Overlay = {
  enable(invite: string | null): Promise<boolean>
  stop(): void
}

type StartOutcome = 'started' | 'rejected' | 'unavailable'

export function createOverlay(config: MostraConfig, environment: Partial<Environment> = {}): Overlay {
  const target = environment.window ?? window
  const fetcher: typeof fetch = environment.fetch ?? ((input, init) => target.fetch(input, init))
  const connect = environment.connect ?? connectRealtime
  const local = environment.local ?? safeStorage(target, 'localStorage')
  const session = environment.session ?? safeStorage(target, 'sessionStorage')
  const navigate = environment.navigate ?? ((url: string) => target.location.assign(url))
  const talk = environment.talk ?? ((token: string) => createLiveTalk({ window: target, fetch: fetcher, endpoint: config.endpoint, projectKey: config.projectKey, token, version: config.version }))
  const fonts = environment.fonts === undefined ? config.endpoint : environment.fonts
  const keys = storageKeys(config.projectKey)
  const theme = config.theme ?? null
  let running: { stop(): void } | null = null
  let activation: Promise<boolean> | null = null
  let uninstallFonts: (() => void) | null = null
  let deepLinkFromLoader = environment.deepLink ?? null

  const loadFonts = () => {
    if (fonts !== null) uninstallFonts ??= installFonts(target.document, fonts)
  }

  function forgetToken(token: string) {
    if (local.get(keys.token) === token) local.remove(keys.token)
  }

  function stop() {
    running?.stop()
    running = null
    uninstallFonts?.()
    uninstallFonts = null
  }

  async function activate(invite: string | null): Promise<boolean> {
    if (running) return true
    await documentReady(target.document)
    const deepLink = deepLinkFromLoader ?? readDeepLink(target.location.search)
    deepLinkFromLoader = null
    const token = local.get(keys.token)
    if (token) {
      stripMostraParameters(target)
      const renewed = invite ? await builderSession(invite) : null
      if (renewed) {
        local.set(keys.token, renewed.token)
        return (await start(renewed.token, deepLink, renewed.project)) === 'started'
      }
      const outcome = await start(token, deepLink)
      if (outcome !== 'rejected' || !invite) return outcome === 'started'
    }
    if (!invite) return false

    const result = await createReviewerSession(fetcher, config.endpoint, { projectKey: config.projectKey, invite })
    stripMostraParameters(target)
    if (result.ok) {
      local.set(keys.token, result.session.token)
      return (await start(result.session.token, deepLink, result.session.project)) === 'started'
    }
    if (result.error === 'refused') showProblem(result.problem)
    else console.warn(`[mostra] Could not open the review link (${result.error}).`)
    return false
  }

  async function builderSession(invite: string) {
    const result = await createReviewerSession(fetcher, config.endpoint, { projectKey: config.projectKey, invite, builderOnly: true }).catch(() => null)
    return result?.ok ? result.session : null
  }

  function showProblem(problem: JoinProblem) {
    loadFonts()
    showJoinProblem(target, theme, problem, () => {
      uninstallFonts?.()
      uninstallFonts = null
    })
  }

  async function start(token: string, deepLink: number | null, knownProject?: Project): Promise<StartOutcome> {
    let project = knownProject ?? null
    if (!project) {
      let found: Awaited<ReturnType<typeof fetchProject>>
      try {
        found = await fetchProject(fetcher, config.endpoint, config.projectKey)
      } catch {
        return 'unavailable'
      }
      if (found === 'unknown_project') {
        forgetToken(token)
        return 'rejected'
      }
      project = found
    }
    const projectId = project.id

    let settle: (outcome: StartOutcome) => void = () => {}
    const outcome = new Promise<StartOutcome>((resolve) => (settle = resolve))
    let unmount: (() => void) | null = null
    const controller = createController({
      window: target,
      version: config.version,
      local,
      session,
      keys,
      navigate,
      deepLink,
      talk: talk(token),
      isOwnEvent,
      isOwnElement,
      peekMs: () => peekDuration(target),
      connect: (joinPayload) => connect({ endpoint: config.endpoint, token, projectId, joinPayload, sessionStorage: session }),
      onRejected(reason) {
        if (reason === 'unauthorized') forgetToken(token)
        stop()
        settle(reason === 'unauthorized' ? 'rejected' : 'unavailable')
      },
      onStop() {
        stop()
        local.remove(keys.token)
        session.remove(keys.player)
        session.remove(keys.pendingFocus)
      },
    })
    const handle = {
      stop() {
        controller.destroy()
        unmount?.()
        unmount = null
      },
    }
    running = handle
    void controller.ready.then(() => {
      if (running !== handle) return
      loadFonts()
      unmount = mountOverlay(controller, target, theme)
      settle('started')
    })
    return outcome
  }

  return {
    enable(invite) {
      activation ??= activate(invite).finally(() => {
        activation = null
      })
      return activation
    },
    stop,
  }
}

function documentReady(document: Document): Promise<void> {
  if (document.readyState !== 'loading') return Promise.resolve()
  return new Promise((resolve) => document.addEventListener('DOMContentLoaded', () => resolve(), { once: true }))
}
