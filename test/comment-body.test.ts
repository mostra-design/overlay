import { describe, expect, it } from 'vitest'
import { parseBody, plainBody } from '../src/comments'
import type { Comment } from '../src/protocol'

const by = (role: Comment['author']['role'], body: string) => ({ body, author: { id: 'a', display_name: 'A', role, ink: null } }) as Pick<Comment, 'body' | 'author'>

describe('parseBody', () => {
  it('leaves plain words alone', () => {
    expect(parseBody(by('reviewer', 'Too small on phones.'))).toEqual([{ type: 'text', text: 'Too small on phones.' }])
  })
  it('finds references, as before', () => {
    expect(parseBody(by('reviewer', 'Same as #38, not &#39;'))).toEqual([{ type: 'text', text: 'Same as ' }, { type: 'reference', number: 38 }, { type: 'text', text: ', not &#39;' }])
  })
  it('keeps what is inside code literal', () => {
    expect(parseBody(by('reviewer', 'Set `#38 https://a.example`.'))).toEqual([{ type: 'text', text: 'Set ' }, { type: 'code', text: '#38 https://a.example' }, { type: 'text', text: '.' }])
  })
  it('leaves underscores to mean underscores', () => {
    expect(parseBody(by('agent', 'Use VERCEL_GIT_COMMIT_SHA here'))).toEqual([{ type: 'text', text: 'Use VERCEL_GIT_COMMIT_SHA here' }])
  })
  it('links a bare https address and leaves the sentence its punctuation', () => {
    expect(parseBody(by('reviewer', 'See https://a.example/b?c=1.'))).toEqual([{ type: 'text', text: 'See ' }, { type: 'link', url: 'https://a.example/b?c=1', label: 'https://a.example/b?c=1' }, { type: 'text', text: '.' }])
  })
  it('never links anything but https', () => {
    for (const body of ['javascript:alert(1)', 'http://a.example', 'data:text/html,hi', 'https://']) expect(parseBody(by('agent', body))).toEqual([{ type: 'text', text: body }])
    expect(parseBody(by('agent', '[x](javascript:alert(1))'))).toEqual([{ type: 'text', text: '[x](javascript:alert(1))' }])
  })
  it.each([
    ['a user name before the host', 'https://bank.example@evil.example/'],
    ['a user name and a password before the host', 'https://bank.example:login@evil.example/'],
    ['an empty user name', 'https://@evil.example/'],
    ['a user name and nothing after the host', 'https://bank.example@evil.example'],
    ['a backslash', 'https://evil.example\\@bank.example/'],
    ['a backslash in the path', 'https://bank.example/a\\b'],
    ['a look-alike letter', 'https://b\u0430nk.example/'],
    ['a letter from outside ASCII in the path', 'https://bank.example/caf\u00e9'],
    ['a right-to-left override', 'https://bank.example/\u202Eevil'],
    ['a zero-width space', 'https://bank\u200B.example/'],
    ['a delete character', 'https://bank.example/\u007F'],
    ['a control character', 'https://bank.example/\u0001'],
  ])('leaves %s as literal text, for everyone', (_name, url) => {
    for (const role of ['reviewer', 'builder', 'agent'] as const) expect(parseBody(by(role, `See ${url} now`))).toEqual([{ type: 'text', text: `See ${url} now` }])
    expect(plainBody(by('reviewer', `See ${url} now`))).toBe(`See ${url} now`)
  })
  it.each([
    ['an @ in the path', 'https://medium.example/@maya/post'],
    ['an @ in the query', 'https://a.example/b?who=maya@c.example'],
    ['an @ in the fragment', 'https://a.example/#@maya'],
    ['a port', 'https://a.example:8443/b'],
    ['escaped letters', 'https://a.example/caf%C3%A9'],
    ['everything else ASCII has', "https://a.example/~a-b_c.d!$&'*+,;=:@%20?e=[f]{g}|^`#h"],
  ])('still links %s', (_name, url) => {
    expect(parseBody(by('reviewer', url)).filter((part) => part.type === 'link')).toHaveLength(1)
  })
  it('reads the rule after the sentence has its punctuation back', () => {
    expect(parseBody(by('reviewer', 'See https://a.example/b.'))).toEqual([{ type: 'text', text: 'See ' }, { type: 'link', url: 'https://a.example/b', label: 'https://a.example/b' }, { type: 'text', text: '.' }])
  })
  it('leaves the labelled syntax as it was', () => {
    expect(parseBody(by('agent', '[Setup](https://a.example/setup)'))).toEqual([{ type: 'link', url: 'https://a.example/setup', label: 'Setup' }])
  })
  it('keeps other things in the body going after a look-alike', () => {
    expect(parseBody(by('reviewer', 'See https://b\u0430nk.example/ and #38 and https://a.example'))).toEqual([{ type: 'text', text: 'See https://b\u0430nk.example/ and ' }, { type: 'reference', number: 38 }, { type: 'text', text: ' and ' }, { type: 'link', url: 'https://a.example', label: 'https://a.example' }])
  })
  it('lets builders and agents label a link', () => {
    for (const role of ['builder', 'agent'] as const) {
      expect(parseBody(by(role, 'On the [Setup page](https://a.example/setup).'))).toEqual([{ type: 'text', text: 'On the ' }, { type: 'link', url: 'https://a.example/setup', label: 'Setup page' }, { type: 'text', text: '.' }])
    }
  })
  it('shows a reviewer the real address, so a label cannot hide it', () => {
    expect(parseBody(by('reviewer', '[bank](https://evil.example)'))).toEqual([{ type: 'text', text: '[bank](' }, { type: 'link', url: 'https://evil.example', label: 'https://evil.example' }, { type: 'text', text: ')' }])
  })
  it('ignores markdown it does not support', () => {
    const body = '**bold** ![image](https://a.example/pixel.png)'
    expect(parseBody(by('reviewer', '**bold**'))).toEqual([{ type: 'text', text: '**bold**' }])
    expect(parseBody(by('agent', body)).filter((part) => part.type === 'link')).toEqual([{ type: 'link', url: 'https://a.example/pixel.png', label: 'image' }])
  })
})

describe('plainBody', () => {
  it('drops the syntax and keeps the words', () => {
    expect(plainBody(by('agent', 'On the [Setup page](https://a.example), set `data-version`. See #3.'))).toBe('On the Setup page, set data-version. See #3.')
  })
})
