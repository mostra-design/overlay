const REPEAT_TOKENS = 12
const NOT_WORDS = /^\s*(?:[[(].*[\])]|[\p{P}\p{S}\s]*)\s*$/su

export function untilRepeat(tokens: number[]): number[] {
  for (let at = 1; at + REPEAT_TOKENS <= tokens.length; at++) {
    for (let from = 0; from < at; from++) {
      if (tokens[from] !== tokens[at]) continue
      let length = 1
      while (length < REPEAT_TOKENS && tokens[from + length] === tokens[at + length]) length++
      if (length === REPEAT_TOKENS) return tokens.slice(0, at)
    }
  }
  return tokens
}

const RESTART_TOKENS = 5

export function withoutRestart(tokens: number[]): number[] {
  for (let at = 1; at + RESTART_TOKENS <= tokens.length; at++) {
    if (tokens.slice(at).every((token, index) => token === tokens[index])) return tokens.slice(0, at)
  }
  return tokens
}

export function cleanedText(text: string): string {
  const trimmed = text.trim()
  return NOT_WORDS.test(trimmed) ? '' : trimmed
}

export function whisperLanguage(language: string, known: Record<string, number>): string {
  const code = language.split('-')[0]!.toLowerCase()
  return `<|${code}|>` in known ? code : 'en'
}
