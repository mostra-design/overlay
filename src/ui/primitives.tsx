import type { ComponentChildren } from 'preact'
import { parseBody } from '../comments'
import { displayName } from '../lifecycle'
import type { Comment, Person, Verdict } from '../protocol'
import { useController } from './hooks'
import { AgentIcon, CloseIcon, MicIcon } from './icons'
import { inkStyle } from './theme'

export function Avatar({ person, size = 'normal' }: { person: Person; size?: 'normal' | 'small' }) {
  const agent = person.role === 'agent'
  return (
    <span class={`avatar ${size}${agent ? ' agent' : ''}`} style={inkStyle(person)} aria-hidden="true">
      {agent ? <AgentIcon size={size === 'small' ? 12 : 14} /> : initial(displayName(person))}
    </span>
  )
}

export function initial(name: string): string {
  return Array.from(name.trim())[0]?.toUpperCase() ?? '?'
}

export function Byline({ comment, children }: { comment: Comment; children?: ComponentChildren }) {
  const author = comment.author
  return (
    <div class="byline">
      <Avatar person={author} />
      <span class="who">
        {comment.attribution ? (
          <>
            <span class="name">
              {comment.attribution.name}, from {comment.attribution.source}
            </span>
            <span class="added-by"> · added by {displayName(author)}</span>
          </>
        ) : (
          <span class="name">{displayName(author)}</span>
        )}
        {author.role === 'agent' && !comment.attribution && <span class="label">Agent</span>}
        {comment.source === 'spoken' && (
          <span class="said" title="Said out loud">
            <MicIcon size={14} />
            <span class="visually-hidden">Said out loud</span>
          </span>
        )}
      </span>
      <Time iso={comment.inserted_at} />
      {children}
    </div>
  )
}

export function Time({ iso, now = Date.now() }: { iso: string; now?: number }) {
  return (
    <time class="time" dateTime={iso} title={new Date(iso).toLocaleString()}>
      {shortTime(iso, now)}
    </time>
  )
}

export function shortTime(iso: string, now = Date.now()): string {
  const date = new Date(iso)
  const today = new Date(now)
  const days = Math.round((startOfDay(today) - startOfDay(date)) / 86_400_000)
  if (days <= 0) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (days === 1) return 'yesterday'
  if (days < 7) return date.toLocaleDateString([], { weekday: 'short' })
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

export function Body({ comment, class: className = 'body' }: { comment: Pick<Comment, 'body' | 'author'>; class?: string }) {
  const controller = useController()
  return (
    <p class={className}>
      {parseBody(comment).map((part, index) => {
        if (part.type === 'text') return part.text
        if (part.type === 'code') return <code key={index}>{part.text}</code>
        if (part.type === 'link') {
          return (
            <a key={index} href={part.url} target="_blank" rel="noopener noreferrer nofollow ugc">
              {part.label}
            </a>
          )
        }
        return (
          <button key={index} type="button" class="reference" onClick={() => void controller.open(part.number)}>
            #{part.number}
          </button>
        )
      })}
    </p>
  )
}

export function NumberTag({ comment }: { comment: Comment }) {
  return (
    <span class={`number-tag${comment.number === null ? ' sending' : ''}`} style={inkStyle(comment.author)} aria-hidden="true">
      {comment.number ?? ''}
    </span>
  )
}

export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  const approved = verdict.verdict === 'approved'
  return (
    <span class={`verdict ${approved ? 'approved' : 'changes'}`}>
      <span class="dot" aria-hidden="true" />
      {approved ? 'Approved' : 'Changes requested'}
      <span class="on">v{verdict.version.number}</span>
    </span>
  )
}

export function CloseButton({ label = 'Close', onClick }: { label?: string; onClick: () => void }) {
  return (
    <button type="button" class="icon-button" aria-label={label} onClick={onClick}>
      <CloseIcon />
    </button>
  )
}

export function isSendKey(event: KeyboardEvent, phone: boolean): boolean {
  if (event.key !== 'Enter' || event.isComposing) return false
  if (event.metaKey || event.ctrlKey) return true
  return !event.shiftKey && !phone
}
