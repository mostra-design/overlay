import { describe, expect, it } from 'vitest'
import { cleanedText, untilRepeat, whisperLanguage, withoutRestart } from '../src/speech/transcript'

describe('withoutRestart', () => {
  it('cuts an ending that says the beginning again, once, which the long repeat lets through', () => {
    expect(withoutRestart([1, 2, 3, 4, 5, 6, 7, 1, 2, 3, 4, 5, 6, 7])).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(withoutRestart([1, 2, 3, 4, 5, 6, 7, 1, 2, 3, 4, 5])).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('keeps a beginning said again when something else follows, as a person does', () => {
    expect(withoutRestart([1, 2, 3, 4, 5, 1, 2, 3, 4, 5, 9, 9])).toEqual([1, 2, 3, 4, 5, 1, 2, 3, 4, 5, 9, 9])
  })

  it('keeps a short ending that only happens to match', () => {
    expect(withoutRestart([1, 2, 3, 8, 1, 2])).toEqual([1, 2, 3, 8, 1, 2])
  })
})

describe('untilRepeat', () => {
  const sentence = Array.from({ length: 9 }, (_unused, index) => index + 1)

  it('cuts where the decoder starts the sentence again', () => {
    expect(untilRepeat([...sentence, ...sentence, ...sentence.slice(0, 5)])).toEqual(sentence)
  })

  it('cuts a phrase going round and round, keeping one', () => {
    expect(untilRepeat([40, 41, ...Array.from({ length: 20 }, (_unused, index) => 50 + (index % 3))])).toEqual([40, 41, 50, 51, 52])
  })

  it('leaves a sentence alone', () => {
    expect(untilRepeat([1, 2, 3, 4, 5, 6, 7, 8, 9])).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  it('keeps a phrase someone says twice, and what they say after', () => {
    const phrase = [20, 21, 22, 23, 24, 25, 26]
    const after = [30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41]
    expect(untilRepeat([10, 11, ...phrase, ...phrase, ...after])).toEqual([10, 11, ...phrase, ...phrase, ...after])
  })

  it('leaves a short phrase said twice alone', () => {
    expect(untilRepeat([1, 2, 3, 9, 1, 2, 3, 8])).toEqual([1, 2, 3, 9, 1, 2, 3, 8])
  })
})

describe('cleanedText', () => {
  it.each(['[Music]', '(wind blowing)', '...', '  ', '♪ ♪', '[BLANK_AUDIO]'])('takes %j for noise', (text) => {
    expect(cleanedText(text)).toBe('')
  })

  it.each(['Why is this so small?', 'Ten nagłówek jest za długi.', '¿Qué incluye?', '12 dollars'])('keeps %j', (text) => {
    expect(cleanedText(` ${text} `)).toBe(text)
  })
})

describe('whisperLanguage', () => {
  const known = { '<|en|>': 1, '<|pl|>': 2, '<|de|>': 3 }

  it('takes the language from a browser locale', () => {
    expect(whisperLanguage('pl-PL', known)).toBe('pl')
    expect(whisperLanguage('DE', known)).toBe('de')
  })

  it('falls back to English for one Whisper has never heard of', () => {
    expect(whisperLanguage('tlh', known)).toBe('en')
  })
})
