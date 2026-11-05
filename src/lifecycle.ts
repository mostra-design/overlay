import type { Comment, Person, Resolution, Status } from './protocol'

export type Transition = {
  label: string
  to: Status
  resolution?: Resolution
  text: 'none' | 'optional' | 'required'
  prompt?: string
  under?: 'close'
}

export type MenuAction = 'edit' | 'delete' | 'withdraw' | 'show_to_everyone' | 'copy_for_agent' | 'repin'

export type ThreadActions = { transitions: Transition[]; menu: MenuAction[] }

const STILL_WRONG = "What's still wrong?"

export function threadActions(comment: Comment, viewer: Person, othersReplied: boolean): ThreadActions {
  const mine = comment.author.id === viewer.id
  const builder = viewer.role === 'builder'
  const transitions: Transition[] = []
  const menu: MenuAction[] = []
  const status = comment.status

  if (builder) {
    if (status === 'open') {
      transitions.push(
        { label: 'Mark fixed', to: 'fixed', text: 'optional', prompt: 'What changed? (optional)' },
        { label: 'Mark answered', to: 'answered', text: 'required', prompt: 'The answer' },
        { label: "Won't fix…", to: 'resolved', resolution: 'wont_fix', text: 'required', prompt: 'Why not? The author sees this.', under: 'close' },
        { label: 'Duplicate of…', to: 'resolved', resolution: 'duplicate', text: 'none', under: 'close' },
      )
    } else if (status === 'fixed' || status === 'answered') {
      transitions.push({ label: 'Confirm', to: 'resolved', resolution: 'confirmed', text: 'none' }, reopen('Reopen'))
    } else if (status === 'resolved') {
      transitions.push(reopen('Reopen'))
    }
  } else if (mine && status && viewer.role !== 'agent') {
    if (status === 'fixed' && comment.checkable) {
      transitions.push({ label: 'Looks fixed', to: 'resolved', resolution: 'confirmed', text: 'none' }, reopen('Not yet'))
    } else if (status === 'answered') {
      transitions.push({ label: 'Got it', to: 'resolved', resolution: 'confirmed', text: 'none' }, reopen('Follow up'))
    } else if (status === 'resolved' && (comment.resolution === 'confirmed' || comment.resolution === 'withdrawn')) {
      transitions.push(reopen('Reopen'))
    }
  }

  if (mine) menu.push('edit')
  if (comment.anchor && comment.page_url && (mine || builder)) menu.push('repin')
  if (builder && comment.visibility === 'team') menu.push('show_to_everyone')
  if (builder && comment.number !== null) menu.push('copy_for_agent')
  if (builder || (mine && !othersReplied)) menu.push('delete')
  else if (mine && status === 'open') menu.push('withdraw')
  return { transitions, menu }
}

export function replyActions(reply: Comment, thread: Comment, viewer: Person): MenuAction[] {
  const menu: MenuAction[] = []
  if (reply.author.id === viewer.id) menu.push('edit')
  if (viewer.role === 'builder' && reply.visibility === 'team' && thread.visibility === 'everyone') menu.push('show_to_everyone')
  if (viewer.role === 'builder' || reply.author.id === viewer.id) menu.push('delete')
  return menu
}

function reopen(label: string): Transition {
  return { label, to: 'open', text: 'required', prompt: label === 'Reopen' ? 'Why reopen it?' : STILL_WRONG }
}

export function statusWords(comment: Comment, viewer: Person, closingNote: string | null): string | null {
  const mine = comment.author.id === viewer.id
  switch (comment.status) {
    case 'fixed':
      if (!mine) return 'Marked fixed'
      return comment.checkable ? 'Fixed - check it' : 'Marked fixed. Not on this version yet.'
    case 'answered':
      return 'Answered'
    case 'resolved':
      if (comment.resolution === 'wont_fix') return closingNote ? `Won't fix: ${closingNote}` : "Won't fix"
      if (comment.resolution === 'duplicate' && comment.duplicate_of !== null) return `Same as #${comment.duplicate_of}`
      if (comment.resolution === 'withdrawn') return 'Withdrawn'
      return 'Resolved'
    default:
      return null
  }
}

export function threadStatusWords(comment: Comment, viewer: Person, closingNote: string | null, replies: Comment[]): string | null {
  if (comment.status === 'answered') return null
  const announced = [...replies].reverse().find((reply) => reply.event)?.event?.status === 'fixed'
  if (comment.status === 'fixed' && comment.author.id !== viewer.id && announced) return null
  return statusWords(comment, viewer, closingNote)
}

export function nextLine(comment: Comment, projectName: string): string | null {
  const team = `the ${projectName} team`
  const author = comment.author.role === 'agent' ? team : displayName(comment.author)
  switch (comment.status) {
    case 'open':
      return `Next: ${team}`
    case 'fixed':
      return comment.checkable ? `Next: ${author} checks the fix` : `Next: ${author} checks it on a newer version`
    case 'answered':
      return `Next: ${author} reads the answer`
    case 'resolved': {
      const by = comment.resolved ? displayName(comment.resolved.by) : null
      const on = comment.resolved?.version ? ` on v${comment.resolved.version.number}` : ''
      switch (comment.resolution) {
        case 'wont_fix':
          return `Resolved · won't fix${by ? `, by ${by}` : ''}${on}`
        case 'duplicate':
          return `Resolved · same as #${comment.duplicate_of}${by ? `, by ${by}` : ''}`
        case 'withdrawn':
          return `Resolved · withdrawn${by ? ` by ${by}` : ''}`
        default:
          return `Resolved${by ? ` · confirmed by ${by}${on}` : ''}`
      }
    }
    default:
      return null
  }
}

export type PinState = {
  visible: boolean
  sending: boolean
  done: boolean
  checkIt: boolean
  unread: boolean
}

export function pinState(comment: Comment, viewer: Person, sending: boolean, unread: boolean): PinState {
  const settled = comment.status === 'fixed' || comment.status === 'answered'
  const mine = comment.author.id === viewer.id
  return {
    visible: comment.status !== 'resolved',
    sending,
    done: comment.status === 'fixed',
    checkIt: mine && settled && comment.checkable,
    unread,
  }
}

export function presenceWords(people: ReadonlyArray<Person>): string {
  const [first, second] = people
  if (!first) return ''
  if (people.length === 1) return `${displayName(first)} is here`
  if (people.length === 2) return `${displayName(first)} and ${displayName(second!)} are here`
  return `${displayName(first)} and ${people.length - 1} others are here`
}

export function pinName(comment: Comment, state: PinState): string {
  const on = comment.anchor?.label ? ` on ${comment.anchor.label}` : ''
  const subject = state.sending ? `Your comment${on}, sending` : `Comment ${comment.number} by ${displayName(comment.author)}${on}`
  const status = state.checkIt
    ? comment.status === 'answered'
      ? 'Answered, read it.'
      : 'Fixed, check it.'
    : comment.status === 'fixed'
      ? 'Fixed.'
      : comment.status === 'answered'
        ? 'Answered.'
        : ''
  return [`${subject}.`, status, state.unread ? 'New replies.' : ''].filter(Boolean).join(' ')
}

export function isUnread(reply: Comment, viewer: Person, lastSeenAt: string | null, arrived: ReadonlySet<string> = new Set()): boolean {
  if (reply.author.id === viewer.id) return false
  if (arrived.has(reply.id)) return true
  return lastSeenAt !== null && Date.parse(reply.inserted_at) > Date.parse(lastSeenAt)
}

export function isUnresolved(comment: Comment): boolean {
  return comment.status === 'open' || comment.status === 'fixed' || comment.status === 'answered'
}

export function displayName(person: Person): string {
  return person.display_name ?? 'Guest'
}

export function eventWords(event: NonNullable<Comment['event']>, number: number | null): string {
  const target = number === null ? 'it' : `#${number}`
  switch (event.status) {
    case 'fixed':
      return `marked ${target} fixed`
    case 'answered':
      return `marked ${target} answered`
    case 'open':
      return `reopened ${target}`
    case 'resolved':
      switch (event.resolution) {
        case 'wont_fix':
          return `closed ${target} as won't fix`
        case 'duplicate':
          return `closed ${target} as a duplicate`
        case 'withdrawn':
          return `withdrew ${target}`
        default:
          return `confirmed ${target}`
      }
  }
}
