import { render } from 'preact'
import type { Theme } from '../config'
import type { Controller } from '../controller'
import { App } from './App'
import { stylesheet } from './theme'

export const HOST_TAG = 'mostra-overlay'

export function peekDuration(target: Window): number | null {
  const host = target.document.querySelector(HOST_TAG)
  if (!host) return null
  const style = target.getComputedStyle(host)
  const delay = milliseconds(style.getPropertyValue('--peek-delay'))
  const time = milliseconds(style.getPropertyValue('--peek-time'))
  return delay === null || time === null ? null : delay + time
}

function milliseconds(value: string): number | null {
  const match = /^\s*(\d*\.?\d+)(ms|s)\s*$/.exec(value)
  return match ? Number(match[1]) * (match[2] === 's' ? 1000 : 1) : null
}

const HOST_STYLE = 'all: initial !important; display: contents !important;'

const ISOLATED_EVENTS = [
  'keydown',
  'keyup',
  'keypress',
  'beforeinput',
  'input',
  'change',
  'submit',
  'click',
  'dblclick',
  'auxclick',
  'contextmenu',
  'mousedown',
  'mouseup',
  'pointerdown',
  'pointerup',
  'touchstart',
  'touchend',
  'wheel',
  'focusin',
  'focusout',
  'copy',
  'cut',
  'paste',
]

let sharedSheet: CSSStyleSheet | null = null

export function createHost(document: Document, theme: Theme | null): { root: HTMLElement; destroy(): void } {
  const host = document.createElement(HOST_TAG)
  host.style.cssText = HOST_STYLE
  if (theme) host.setAttribute('data-theme', theme)
  const shadow = host.attachShadow({ mode: 'open' })
  if ('adoptedStyleSheets' in shadow && typeof CSSStyleSheet === 'function' && 'replaceSync' in CSSStyleSheet.prototype) {
    sharedSheet ??= new CSSStyleSheet()
    if (sharedSheet.cssRules.length === 0) sharedSheet.replaceSync(stylesheet)
    shadow.adoptedStyleSheets = [sharedSheet]
  } else {
    const style = document.createElement('style')
    style.textContent = stylesheet
    shadow.appendChild(style)
  }
  const root = document.createElement('div')
  root.className = 'mostra'
  for (const type of ISOLATED_EVENTS) root.addEventListener(type, (event) => event.stopPropagation())
  shadow.appendChild(root)
  document.documentElement.appendChild(host)

  return {
    root,
    destroy() {
      render(null, root)
      host.remove()
    },
  }
}

export function mountOverlay(controller: Controller, target: Window, theme: Theme | null): () => void {
  const host = createHost(target.document, theme)
  render(<App controller={controller} />, host.root)
  return host.destroy
}
