import { normalizePageUrl } from './page-url'

const SETTLE_MS = 50

export function watchNavigation(target: Window, onChange: (pageUrl: string) => void): () => void {
  const history = target.history
  let current = normalizePageUrl(target.location)
  let active = true
  let timer: ReturnType<typeof setTimeout> | undefined

  const check = () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      const next = normalizePageUrl(target.location)
      if (!active || next === current) return
      current = next
      onChange(next)
    }, SETTLE_MS)
  }

  const originalPushState = history.pushState
  const originalReplaceState = history.replaceState
  const pushState: History['pushState'] = (...args) => {
    originalPushState.apply(history, args)
    if (active) check()
  }
  const replaceState: History['replaceState'] = (...args) => {
    originalReplaceState.apply(history, args)
    if (active) check()
  }
  history.pushState = pushState
  history.replaceState = replaceState
  target.addEventListener('popstate', check)
  target.addEventListener('hashchange', check)

  return () => {
    active = false
    clearTimeout(timer)
    if (history.pushState === pushState) history.pushState = originalPushState
    if (history.replaceState === replaceState) history.replaceState = originalReplaceState
    target.removeEventListener('popstate', check)
    target.removeEventListener('hashchange', check)
  }
}
