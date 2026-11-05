import { afterEach, describe, expect, it } from 'vitest'
import { detectVersion, overlayUrl, readScriptConfig, socketUrl } from '../src/config'

function script(attributes: Record<string, string>): HTMLScriptElement {
  const element = document.createElement('script')
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value)
  return element
}

function addVersionMeta(content: string) {
  const meta = document.createElement('meta')
  meta.name = 'mostra-version'
  meta.content = content
  document.head.appendChild(meta)
}

afterEach(() => {
  document.head.innerHTML = ''
})

describe('version detection', () => {
  it('prefers data-version on the script tag', () => {
    addVersionMeta('from-meta')
    expect(detectVersion(script({ 'data-version': 'abc1234' }), document)).toBe('abc1234')
  })

  it('falls back to the mostra-version meta tag', () => {
    addVersionMeta(' build-42 ')
    expect(detectVersion(script({}), document)).toBe('build-42')
    expect(detectVersion(null, document)).toBe('build-42')
  })

  it('is null when neither exists or both are blank', () => {
    expect(detectVersion(script({}), document)).toBeNull()
    addVersionMeta('  ')
    expect(detectVersion(script({ 'data-version': '' }), document)).toBeNull()
  })
})

describe('readScriptConfig', () => {
  it('reads project and version from data attributes and talks to mostra.design', () => {
    const element = script({ 'data-project': 'pk_demo00000000000000000000', 'data-version': 'abc1234', src: 'https://cdn.example.com/mostra.js' })
    expect(readScriptConfig(element, document)).toEqual({
      projectKey: 'pk_demo00000000000000000000',
      endpoint: 'https://mostra.design',
      version: 'abc1234',
      theme: null,
    })
  })

  it('accepts an optional light or dark theme', () => {
    const dark = script({ 'data-project': 'pk_demo00000000000000000000', 'data-theme': 'dark' })
    const unknown = script({ 'data-project': 'pk_demo00000000000000000000', 'data-theme': 'sepia' })
    expect(readScriptConfig(dark, document)?.theme).toBe('dark')
    expect(readScriptConfig(unknown, document)?.theme).toBeNull()
  })

  it('is null without a project key or without a script', () => {
    expect(readScriptConfig(script({ 'data-project': ' ' }), document)).toBeNull()
    expect(readScriptConfig(null, document)).toBeNull()
  })
})

describe('overlayUrl', () => {
  it('finds the overlay file next to the script, wherever that is', () => {
    expect(overlayUrl('https://cdn.jsdelivr.net/npm/@scope/overlay@0.1.0/dist/script/mostra.js', 'overlay-3f9a0c1e.js')).toBe(
      'https://cdn.jsdelivr.net/npm/@scope/overlay@0.1.0/dist/script/overlay-3f9a0c1e.js',
    )
    expect(overlayUrl('http://localhost:5175/mostra.js?cache=1', 'overlay.js')).toBe('http://localhost:5175/overlay.js')
  })
})

describe('socketUrl', () => {
  it('derives the websocket URL from the endpoint', () => {
    expect(socketUrl('http://localhost:4000')).toBe('ws://localhost:4000/socket')
    expect(socketUrl('https://api.mostra.design')).toBe('wss://api.mostra.design/socket')
  })
})
