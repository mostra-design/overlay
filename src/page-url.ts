export const INVITE_PARAMETER = 'mostra'
export const COMMENT_PARAMETER = 'mostra_comment'

const PRIVATE_NAME = /^code$|\b(e?mail|phone|tel|mobile|password|passwd|pwd|pass|passcode|secret|token|jwt|auth|authorization|oauth|bearer|session|sessionid|phpsessid|jsessionid|sid|otp|signature|sig|credential|apikey|username|ssn|dob|birthdate|birthday|iban|cvv|cvc|cardnumber|address|(api|access|secret|private) key|(first|last|full|given|family|middle|user) name|card number)s?\b/
const PRIVATE_VALUE = /[^\s@/?&=]+@[^\s@/?&=]+\.[a-z]{2,}|\beyJ[\w-]+\.[\w-]+\.[\w-]+/i

const PATH_ON_THE_SITE = /^\/(?![/\\])[^\x00-\x1f\x7f]*$/

type LocationParts = { pathname: string; search: string; hash: string }

export function normalizePageUrl(location: LocationParts): string {
  const params = pageParameters(location.search)
  params.sort()
  const query = params.toString()
  const path = location.pathname.replace(/^[/\\]*/, '/')
  return `${path}${query ? `?${query}` : ''}${hashRoute(location.hash)}`
}

export function urlOnThisSite(pageUrl: string, origin: string): string | null {
  if (!PATH_ON_THE_SITE.test(pageUrl)) return null
  try {
    const url = new URL(pageUrl, origin)
    return url.origin === origin ? url.href : null
  } catch {
    return null
  }
}

function hashRoute(hash: string): string {
  if (!hash.startsWith('#/')) return ''
  const [route = '', query = ''] = hash.split(/\?(.*)/s)
  const kept = pageParameters(query).toString()
  return kept ? `${route}?${kept}` : route
}

function pageParameters(query: string): URLSearchParams {
  return new URLSearchParams(Array.from(new URLSearchParams(query)).filter(([name, value]) => name !== INVITE_PARAMETER && name !== COMMENT_PARAMETER && !PRIVATE_NAME.test(parameterWords(name)) && !PRIVATE_VALUE.test(value)))
}

function parameterWords(name: string): string {
  return name
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[^a-z\d]+/g, ' ')
    .trim()
}

export function documentTitle(document: Document): string {
  const { title } = document
  return typeof title === 'string' ? title : ''
}

export function readInvite(search: string): string | null {
  const invite = new URLSearchParams(search).get(INVITE_PARAMETER)
  return invite ? invite : null
}

export function readDeepLink(search: string): number | null {
  const number = Number(new URLSearchParams(search).get(COMMENT_PARAMETER)?.replace(/^#/, ''))
  return Number.isInteger(number) && number > 0 ? number : null
}

export function urlWithoutMostra(href: string): string {
  const url = new URL(href)
  const pairs = url.search
    .slice(1)
    .split('&')
    .filter((pair) => pair !== '' && parameterName(pair) !== INVITE_PARAMETER && parameterName(pair) !== COMMENT_PARAMETER)
  const path = url.pathname.replace(/^\/\//, '/.//')
  return `${path}${pairs.length ? `?${pairs.join('&')}` : ''}${url.hash}`
}

export function stripMostraParameters(target: Window): void {
  try {
    target.history.replaceState(target.history.state, '', urlWithoutMostra(target.location.href))
  } catch {
  }
}

function parameterName(pair: string): string {
  const name = pair.split('=')[0] ?? ''
  try {
    return decodeURIComponent(name.replace(/\+/g, ' '))
  } catch {
    return name
  }
}
