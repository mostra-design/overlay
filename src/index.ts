import { detectVersion } from './config'
import { createMostra } from './loader'

export type InitOptions = {
  project: string
  version?: string | null
  theme?: 'light' | 'dark' | null
}

export type MostraApi = {
  enable(invite?: string): Promise<boolean>
  disable(): void
  readonly version: string | null
}

declare global {
  interface Window {
    Mostra?: MostraApi
  }
}

export function init(options: InitOptions): MostraApi {
  const mostra = createMostra(
    {
      projectKey: options.project,
      endpoint: __MOSTRA_ENDPOINT__,
      version: options.version ?? detectVersion(null, document),
      theme: options.theme ?? null,
    },
    () => import('./overlay'),
  )
  window.Mostra = mostra
  return mostra
}
