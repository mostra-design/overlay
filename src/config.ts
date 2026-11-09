export type Theme = 'light' | 'dark'

export type MostraConfig = {
  projectKey: string
  endpoint: string
  version: string | null
  theme?: Theme | null
}

export function readScriptConfig(script: HTMLScriptElement | null, document: Document): MostraConfig | null {
  if (!script) return null
  const projectKey = script.dataset.project?.trim()
  if (!projectKey) return null
  return { projectKey, endpoint: __MOSTRA_ENDPOINT__, version: detectVersion(script, document), theme: parseTheme(script.dataset.theme) }
}

export function parseTheme(value: string | null | undefined): Theme | null {
  return value === 'light' || value === 'dark' ? value : null
}

export function detectVersion(script: HTMLScriptElement | null, document: Document): string | null {
  const fromScript = script?.dataset.version?.trim()
  if (fromScript) return fromScript
  const fromMeta = document.querySelector<HTMLMetaElement>('meta[name="mostra-version"]')?.content.trim()
  return fromMeta || null
}

export function overlayUrl(scriptSrc: string, overlayFile: string): string {
  return new URL(overlayFile, scriptSrc).href
}

export const legalUrls = { terms: 'https://mostra.design/terms', privacy: 'https://mostra.design/privacy#reviewers' }

export function socketUrl(endpoint: string): string {
  return `${endpoint.replace(/^http/, 'ws')}/socket`
}
