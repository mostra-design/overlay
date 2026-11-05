import { readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'

const LOADER_BUDGET = 2048

const files = [
  { file: 'dist/script/mostra.js', role: 'loader, script tag', budget: LOADER_BUDGET },
  { file: 'dist/mostra.mjs', role: 'loader, npm entry', budget: LOADER_BUDGET },
  { file: 'dist/overlay.js', role: 'overlay, reviewers only', budget: null },
]

const kibibytes = (bytes) => `${(bytes / 1024).toFixed(2)} KiB`

let overBudget = false
for (const { file, role, budget } of files) {
  const source = readFileSync(new URL(`../${file}`, import.meta.url))
  const gzipped = gzipSync(source, { level: 9 }).length
  const verdict = budget === null ? '' : gzipped <= budget ? `ok, budget ${kibibytes(budget)} gzip` : `OVER BUDGET ${kibibytes(budget)} gzip`
  overBudget ||= budget !== null && gzipped > budget
  console.log(`${file.padEnd(21)} ${kibibytes(source.length).padStart(11)} raw ${kibibytes(gzipped).padStart(11)} gzip   ${role.padEnd(24)} ${verdict}`)
}

if (overBudget) {
  console.error('\nA loader file is over its gzip budget. Move code behind the overlay import (src/overlay.ts).')
  process.exit(1)
}
