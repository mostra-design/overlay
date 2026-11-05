import { describe, expect, it } from 'vitest'
import { normalizePageUrl, readDeepLink, readInvite, urlOnThisSite, urlWithoutMostra } from '../src/page-url'

const page = (pathname: string, search = '', hash = '') => ({ pathname, search, hash })

describe('normalizePageUrl', () => {
  it('keeps the path and drops an empty query', () => {
    expect(normalizePageUrl(page('/pricing'))).toBe('/pricing')
    expect(normalizePageUrl(page('/pricing', '?'))).toBe('/pricing')
  })

  it('removes the mostra and mostra_comment parameters', () => {
    expect(normalizePageUrl(page('/', '?mostra=invite-token'))).toBe('/')
    expect(normalizePageUrl(page('/reports', '?mostra=x&status=open'))).toBe('/reports?status=open')
    expect(normalizePageUrl(page('/pricing', '?mostra_comment=38&plan=pro'))).toBe('/pricing?plan=pro')
  })

  it('sorts the remaining parameters, keeping repeated keys in order', () => {
    expect(normalizePageUrl(page('/reports', '?status=open&page=2&a=1'))).toBe('/reports?a=1&page=2&status=open')
    expect(normalizePageUrl(page('/search', '?tag=b&q=x&tag=a'))).toBe('/search?q=x&tag=b&tag=a')
  })

  it('ignores ordinary hashes but keeps hash-router paths', () => {
    expect(normalizePageUrl(page('/docs', '', '#install'))).toBe('/docs')
    expect(normalizePageUrl(page('/', '', '#/settings/team'))).toBe('/#/settings/team')
    expect(normalizePageUrl(page('/', '?mostra=x&b=2&a=1', '#/inbox'))).toBe('/?a=1&b=2#/inbox')
  })

  it('treats an empty pathname as the root', () => {
    expect(normalizePageUrl(page(''))).toBe('/')
  })

  it.each(['email', 'userEmail', 'user_email', 'E-Mail', 'emails', 'phone', 'tel', 'password', 'pwd', 'secret', 'token', 'access_token', 'id_token', 'pageToken', 'jwt', 'auth', 'session_id', 'sessionId', 'PHPSESSID', 'sid', 'otp', 'code', 'signature', 'X-Amz-Signature', 'X-Amz-Security-Token', 'X-Amz-Credential', 'AWSAccessKeyId', 'api_key', 'apiKey', 'apikey', 'username', 'first_name', 'lastName', 'address', 'ssn', 'card_number', 'cvv'])('leaves out %s, which holds who someone is or what lets them in', (name) => {
    expect(normalizePageUrl(page('/signup', `?${name}=some-value&plan=pro`))).toBe('/signup?plan=pro')
    expect(normalizePageUrl(page('/signup', `?${name}=some-value`))).toBe('/signup')
  })

  it.each(['plan', 'status', 'page', 'q', 'id', 'tab', 'name', 'key', 'card', 'author', 'hotel', 'country_code', 'zip_code', 'passenger', 'tokenizer', 'mailbox'])('keeps %s, which can be what tells two pages apart', (name) => {
    expect(normalizePageUrl(page('/reports', `?${name}=one`))).toBe(`/reports?${name}=one`)
  })

  it('leaves out a value that is plainly private, whatever its name', () => {
    expect(normalizePageUrl(page('/a', '?ref=jane%40example.com&x=1'))).toBe('/a?x=1')
    expect(normalizePageUrl(page('/a', '?ref=jane+doe@example.co.uk'))).toBe('/a')
    expect(normalizePageUrl(page('/a', '?t=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc-def_123&x=1'))).toBe('/a?x=1')
  })

  it('keeps values that only look a little like that', () => {
    expect(normalizePageUrl(page('/a', '?handle=%40jane'))).toBe('/a?handle=%40jane')
    expect(normalizePageUrl(page('/a', '?package=react%4018.3'))).toBe('/a?package=react%4018.3')
    expect(normalizePageUrl(page('/a', '?version=1.2.3'))).toBe('/a?version=1.2.3')
    expect(normalizePageUrl(page('/a', '?id=550e8400-e29b-41d4-a716-446655440000'))).toBe('/a?id=550e8400-e29b-41d4-a716-446655440000')
  })

  it("does the same for a hash router's own query", () => {
    expect(normalizePageUrl(page('/', '', '#/reset?token=abc&step=2'))).toBe('/#/reset?step=2')
    expect(normalizePageUrl(page('/', '', '#/reset?token=abc'))).toBe('/#/reset')
    expect(normalizePageUrl(page('/', '', '#/inbox?b=2&a=1'))).toBe('/#/inbox?b=2&a=1')
    expect(normalizePageUrl(page('/', '', '#/inbox?'))).toBe('/#/inbox')
  })
})

describe('normalizePageUrl outside an ordinary address', () => {
  it('still reports a path the server takes', () => {
    expect(normalizePageUrl(page('srcdoc'))).toBe('/srcdoc')
    expect(normalizePageUrl(page('blank', '?a=1'))).toBe('/blank?a=1')
    expect(normalizePageUrl(page(''))).toBe('/')
    expect(normalizePageUrl(page('//a/b'))).toBe('/a/b')
    expect(normalizePageUrl(page('\\\\a'))).toBe('/a')
    for (const pathname of ['srcdoc', 'blank', '', '//a/b', '\\\\a', '/ordinary/page']) expect(urlOnThisSite(normalizePageUrl(page(pathname)), 'https://customer.example')).toMatch(/^https:\/\/customer\.example\//)
  })
})

describe('urlOnThisSite', () => {
  const origin = 'https://customer.example'

  it('gives the full address of a path on the site', () => {
    expect(urlOnThisSite('/', origin)).toBe('https://customer.example/')
    expect(urlOnThisSite('/pricing/?plan=pro', origin)).toBe('https://customer.example/pricing/?plan=pro')
    expect(urlOnThisSite('/#/inbox?a=1', origin)).toBe('https://customer.example/#/inbox?a=1')
    expect(urlOnThisSite('/caf%C3%A9', origin)).toBe('https://customer.example/caf%C3%A9')
    expect(urlOnThisSite('/a//b', origin)).toBe('https://customer.example/a//b')
    expect(urlOnThisSite('/a\\b', origin)).toBe('https://customer.example/a/b')
    expect(urlOnThisSite('/.//host', origin)).toBe('https://customer.example//host')
  })

  it.each([
    ['a script', 'javascript:alert(1)'],
    ['the script from the audit', "javascript:/pricing/?fetch('https://evil.example'):0"],
    ['a script in other case', 'JaVaScRiPt:alert(1)'],
    ['a script behind a space', ' javascript:alert(1)'],
    ['a script behind a tab', 'java\tscript:alert(1)'],
    ['a data address', 'data:text/html,<script>alert(1)</script>'],
    ['a blob address', 'blob:https://customer.example/1'],
    ['another host, by two slashes', '//evil.example/'],
    ['another host, by a backslash', '/\\evil.example/'],
    ['another host, by a backslash first', '\\\\evil.example/'],
    ['another host, spelled out', 'https://evil.example/'],
    ['this host, spelled out', 'https://customer.example/'],
    ['a bare word', 'pricing'],
    ['a relative path', '../pricing'],
    ['nothing', ''],
    ['another host, by a tab browsers drop', '/\t/evil.example/'],
    ['another host, by a newline browsers drop', '/\n/evil.example/'],
    ['another host, by a carriage return browsers drop', '/\r/evil.example/'],
    ['a null character', '/a\u0000b'],
    ['a delete character', '/a\u007fb'],
    ['a newline at the end', '/pricing\n'],
  ])('refuses %s', (_name, pageUrl) => {
    expect(urlOnThisSite(pageUrl, origin)).toBeNull()
  })

  it('has nowhere to go from a document with no origin', () => {
    expect(urlOnThisSite('/pricing/', 'null')).toBeNull()
  })
})

describe('readInvite', () => {
  it('reads the mostra parameter', () => {
    expect(readInvite('?mostra=demo-invite-token&x=1')).toBe('demo-invite-token')
    expect(readInvite('?x=1')).toBeNull()
    expect(readInvite('?mostra=')).toBeNull()
  })
})

describe('readDeepLink', () => {
  it('reads a comment number from mostra_comment', () => {
    expect(readDeepLink('?mostra_comment=38')).toBe(38)
    expect(readDeepLink('?mostra_comment=%2338')).toBe(38)
    expect(readDeepLink('?mostra_comment=abc')).toBeNull()
    expect(readDeepLink('?x=1')).toBeNull()
  })
})

describe('urlWithoutMostra', () => {
  it('removes only the mostra parameters and leaves the rest of the URL untouched', () => {
    expect(urlWithoutMostra('http://localhost:5174/pricing?mostra=abc')).toBe('/pricing')
    expect(urlWithoutMostra('http://localhost:5174/a?q=hello%20world&mostra=abc&z=1#top')).toBe('/a?q=hello%20world&z=1#top')
    expect(urlWithoutMostra('http://localhost:5174/a?mostra_comment=38&z=1')).toBe('/a?z=1')
    expect(urlWithoutMostra('http://localhost:5174/?b=2&a=1')).toBe('/?b=2&a=1')
  })

  it('stays on this site from a path that starts with two slashes', () => {
    const relative = urlWithoutMostra('http://localhost:5174//a?mostra=abc&z=1')
    expect(new URL(relative, 'http://localhost:5174').href).toBe('http://localhost:5174//a?z=1')
  })
})
