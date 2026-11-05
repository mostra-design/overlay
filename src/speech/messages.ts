export type ToEngine =
  | { kind: 'prepare'; base: string; language: string }
  | { kind: 'audio'; offset_ms: number; start_ms: number; samples: Int16Array }
  | { kind: 'end' }

export type FromEngine =
  | { kind: 'ready' }
  | { kind: 'preparing'; fraction: number }
  | { kind: 'failed'; message: string }
  | { kind: 'settled'; offset_ms: number; consumed_ms: number; heard: { at_ms: number; end_ms: number; text: string; words_ms?: number[] } | null }
  | { kind: 'idle' }

export const SPEECH_VERSION = 'v2'
