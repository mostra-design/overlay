import { afterEach, describe, expect, it } from 'vitest'
import { verifiedImport } from '../src/verified-import'

const url = 'https://mostra.test/overlay-abc.js'

afterEach(() => {
  document.head.replaceChildren()
})

function addedTag() {
  return document.head.querySelector('script') as HTMLScriptElement
}

describe('verifiedImport', () => {
  it('asks a module tag for the file, with its hash', () => {
    void verifiedImport(url, 'sha384-abc', document, 'a-nonce').catch(() => {})
    const tag = addedTag()

    expect(tag.type).toBe('module')
    expect(tag.crossOrigin).toBe('anonymous')
    expect(tag.integrity).toBe('sha384-abc')
    expect(tag.nonce).toBe('a-nonce')
    expect(tag.src).toBe(url)
  })

  it('never imports when the tag refuses the file', async () => {
    const importing = verifiedImport(url, 'sha384-abc', document, '')
    addedTag().dispatchEvent(new Event('error'))

    await expect(importing).rejects.toBeInstanceOf(Event)
  })
})
