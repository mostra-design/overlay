import type { Comment, CommentSummary, Person } from './protocol'

export type CommentMap = ReadonlyMap<string, Comment>

export function mergeComments(comments: CommentMap, incoming: readonly Comment[], deleted?: ReadonlySet<string>): CommentMap {
  let next: Map<string, Comment> | null = null
  for (const comment of incoming) {
    if (deleted?.has(comment.id)) continue
    const known = (next ?? comments).get(comment.id)
    if (known === comment || (known && Date.parse(known.updated_at) > Date.parse(comment.updated_at))) continue
    next ??= new Map(comments)
    next.set(comment.id, comment)
  }
  return next ?? comments
}

export function withoutComment(comments: CommentMap, id: string): CommentMap {
  if (!comments.has(id)) return comments
  const next = new Map(comments)
  for (const comment of comments.values()) {
    if (comment.id === id || comment.parent_id === id) next.delete(comment.id)
  }
  return next
}

export function replacePageComments(comments: CommentMap, pageUrl: string, incoming: readonly Comment[], deleted?: ReadonlySet<string>): CommentMap {
  const onPage = new Set(Array.from(comments.values(), (comment) => (comment.parent_id === null && comment.page_url === pageUrl ? comment.id : null)))
  const next = new Map(Array.from(comments).filter(([, comment]) => !onPage.has(comment.parent_id ?? comment.id)))
  return mergeComments(next, incoming, deleted)
}

export function threadsOnPage(comments: CommentMap, pageUrl: string): Comment[] {
  return Array.from(comments.values())
    .filter((comment) => comment.parent_id === null && comment.page_url === pageUrl)
    .sort(byInsertion)
}

export function repliesTo(comments: CommentMap, id: string): Comment[] {
  return Array.from(comments.values())
    .filter((comment) => comment.parent_id === id)
    .sort(byInsertion)
}

export function byInsertion(first: Comment, second: Comment): number {
  return Date.parse(first.inserted_at) - Date.parse(second.inserted_at)
}

export function withSummaryPage(known: ReadonlyMap<string, CommentSummary> | null, page: readonly CommentSummary[], after: number | null, upTo: number | null): ReadonlyMap<string, CommentSummary> {
  const next = new Map(known)
  for (const [id, { number }] of next) {
    if (number !== null && number > (after ?? -Infinity) && number <= (upTo ?? Infinity)) next.delete(id)
  }
  for (const summary of page) next.set(summary.id, summary)
  return next
}

export function applyToSummaries(summaries: ReadonlyMap<string, CommentSummary>, comment: Comment, known: boolean): ReadonlyMap<string, CommentSummary> {
  const next = new Map(summaries)
  if (comment.parent_id === null) {
    const previous = summaries.get(comment.id)
    next.set(comment.id, { ...comment, reply_count: previous?.reply_count ?? 0, last_activity_at: latest(previous?.last_activity_at, comment.updated_at) })
    return next
  }
  const thread = summaries.get(comment.parent_id)
  if (!thread) return summaries
  next.set(thread.id, { ...thread, reply_count: thread.reply_count + (known ? 0 : 1), last_activity_at: latest(thread.last_activity_at, comment.inserted_at) })
  return next
}

function latest(first: string | undefined, second: string): string {
  return first && Date.parse(first) > Date.parse(second) ? first : second
}

export type BodyPart =
  | { type: 'text'; text: string }
  | { type: 'reference'; number: number }
  | { type: 'code'; text: string }
  | { type: 'link'; url: string; label: string }

const CODE = '`(?<code>[^`\\n]+)`'
const LABELLED_LINK = '\\[(?<label>[^\\]\\n]+)\\]\\((?<target>https://[^\\s)]+)\\)'
const BARE_LINK = '(?<bare>https://[^\\s<>]+)'
const REFERENCE = '(?<before>^|[^\\w&])#(?<number>\\d{1,7})\\b'
const BODY_SYNTAX = new RegExp([CODE, BARE_LINK, REFERENCE].join('|'), 'g')
const BODY_SYNTAX_WITH_LABELS = new RegExp([CODE, LABELLED_LINK, BARE_LINK, REFERENCE].join('|'), 'g')
const AFTER_LINK = /[.,;:!?'")\]]+$/
const READS_AS_WRITTEN = /^[!-[\]-~]+$/
const USER_NAME = /^https:\/\/[^/?#]*@/

function isLinkable(url: string): boolean {
  return url !== 'https://' && READS_AS_WRITTEN.test(url) && !USER_NAME.test(url)
}

function writesLabelledLinks(author: Pick<Person, 'role'>): boolean {
  return author.role !== 'reviewer'
}

export function parseBody({ body, author }: Pick<Comment, 'body' | 'author'>): BodyPart[] {
  const parts: BodyPart[] = []
  let last = 0
  for (const match of body.matchAll(writesLabelledLinks(author) ? BODY_SYNTAX_WITH_LABELS : BODY_SYNTAX)) {
    const { code, label, target, bare, before, number } = match.groups!
    const start = (match.index ?? 0) + (before?.length ?? 0)
    const url = bare?.replace(AFTER_LINK, '')
    if (url !== undefined && !isLinkable(url)) continue
    if (start > last) parts.push({ type: 'text', text: body.slice(last, start) })
    if (code !== undefined) parts.push({ type: 'code', text: code })
    else if (target !== undefined) parts.push({ type: 'link', url: target, label: label! })
    else if (url !== undefined) parts.push({ type: 'link', url, label: url })
    else parts.push({ type: 'reference', number: Number(number) })
    last = url !== undefined ? start + url.length : (match.index ?? 0) + match[0].length
  }
  if (last < body.length) parts.push({ type: 'text', text: body.slice(last) })
  return parts
}

export function plainBody(comment: Pick<Comment, 'body' | 'author'>): string {
  return parseBody(comment)
    .map((part) => (part.type === 'reference' ? `#${part.number}` : part.type === 'link' ? part.label : part.text))
    .join('')
}
