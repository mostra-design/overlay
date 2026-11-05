export type Island = { start_ms: number; end_ms: number }

export const FRAME_MS = 32

const OPENS_AT = 0.5
const CLOSES_UNDER = 0.35
const PAUSE_MS = 700
const SHORTEST_SPEECH_MS = 250
const LONGEST_MS = 24_000
const CUT_SEARCH_FROM_MS = 12_000

type Open = { start_ms: number; last_voice_ms: number; voiced_ms: number; quietest_ms: number; quietest: number }

export function createSpeechFinder() {
  let open: Open | null = null

  function close(): Island | null {
    const closing = open
    open = null
    return closing && closing.voiced_ms >= SHORTEST_SPEECH_MS ? { start_ms: closing.start_ms, end_ms: closing.last_voice_ms + FRAME_MS } : null
  }

  return {
    frame(start_ms: number, probability: number): Island | null {
      if (!open) {
        if (probability >= OPENS_AT) open = { start_ms, last_voice_ms: start_ms, voiced_ms: FRAME_MS, quietest_ms: start_ms, quietest: 1 }
        return null
      }
      if (probability >= CLOSES_UNDER) {
        open.last_voice_ms = start_ms
        open.voiced_ms += FRAME_MS
      }
      if (start_ms - open.start_ms >= CUT_SEARCH_FROM_MS && probability <= open.quietest) {
        open.quietest = probability
        open.quietest_ms = start_ms
      }
      if (start_ms - open.last_voice_ms >= PAUSE_MS) return close()
      if (start_ms - open.start_ms < LONGEST_MS) return null
      const cut = open.quietest_ms > open.start_ms ? open.quietest_ms : start_ms
      const island = { start_ms: open.start_ms, end_ms: cut }
      open = { start_ms: cut, last_voice_ms: start_ms, voiced_ms: start_ms - cut, quietest_ms: cut, quietest: 1 }
      return island
    },
    finish: close,
    get open_from_ms() {
      return open?.start_ms ?? null
    },
  }
}
