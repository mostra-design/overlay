import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FAMILIES, installFonts } from '../src/fonts'

const styles = readFileSync('src/ui/styles.css', 'utf8')

class FakeFontFace {
  constructor(
    readonly family: string,
    readonly source: string,
  ) {}
}

function fakeDocument() {
  const added = new Set<FakeFontFace>()
  const fonts = { add: (face: FakeFontFace) => added.add(face), delete: (face: FakeFontFace) => added.delete(face) }
  return { document: { fonts } as unknown as Document, added }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('installFonts', () => {
  it("adds its faces under its own names, so a page that uses Schibsted Grotesk or IBM Plex Mono keeps its own", () => {
    vi.stubGlobal('FontFace', FakeFontFace)
    const { document, added } = fakeDocument()

    const uninstall = installFonts(document, 'https://mostra.example')

    const families = new Set([...added].map((face) => face.family))
    expect(families).toEqual(new Set([FAMILIES.sans, FAMILIES.mono]))
    expect([...added].every((face) => face.source.startsWith('url("https://mostra.example/fonts/'))).toBe(true)

    uninstall()
    expect(added.size).toBe(0)
  })

  it('is what the overlay asks for: its font tokens name the same families first', () => {
    expect(styles).toContain(`--font-sans: "${FAMILIES.sans}",`)
    expect(styles).toContain(`--font-mono: "${FAMILIES.mono}",`)
  })
})
