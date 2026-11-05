const SUBSETS = [
  [
    'latin',
    'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
  ],
  [
    'latin-ext',
    'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF',
  ],
] as const

export const FAMILIES = { sans: 'mostra-overlay-sans', mono: 'mostra-overlay-mono' } as const

const FACES = [
  { family: FAMILIES.sans, weight: '400 700', style: 'normal', file: 'schibsted-grotesk-normal-400-700' },
  { family: FAMILIES.mono, weight: '400', style: 'normal', file: 'ibm-plex-mono-normal-400' },
  { family: FAMILIES.mono, weight: '500', style: 'normal', file: 'ibm-plex-mono-normal-500' },
]

export function installFonts(document: Document, endpoint: string): () => void {
  if (typeof FontFace !== 'function' || !document.fonts) return () => {}
  const faces: FontFace[] = []
  for (const { family, weight, style, file } of FACES) {
    for (const [subset, unicodeRange] of SUBSETS) {
      faces.push(new FontFace(family, `url("${endpoint}/fonts/${file}-${subset}.woff2") format("woff2")`, { weight, style, display: 'swap', unicodeRange }))
    }
  }
  for (const face of faces) document.fonts.add(face)
  return () => {
    for (const face of faces) document.fonts.delete(face)
  }
}
