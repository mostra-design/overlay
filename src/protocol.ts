export type Role = 'reviewer' | 'builder' | 'agent'

export type Person = { id: string; display_name: string | null; role: Role; ink: number | null }

export type Version = { id: string; label: string; number: number }

export type Project = {
  id: string
  name: string
  invite_url?: string | null
  dashboard_url?: string | null
}

export type Selector =
  | { type: 'testid'; value: string }
  | { type: 'id'; value: string }
  | { type: 'css'; value: string }
  | { type: 'text'; tag?: string; value: string }

export type TextQuote = { exact: string; prefix: string; suffix: string }

export type CapturedState = {
  hover?: boolean
  focus_visible?: boolean
  checked?: boolean
  disabled?: boolean
  aria_expanded?: string
  aria_selected?: string
  aria_checked?: string
  aria_current?: string
  data_state?: string
  ancestors?: Array<Omit<CapturedState, 'ancestors' | 'opened_by'> & { depth: number; label: string }>
  opened_by?: Selector[]
}

export type Anchor = {
  selectors: Selector[]
  offset?: { x: number; y: number }
  rect?: { x: number; y: number; width: number; height: number }
  element_text?: string
  label?: string
  text_quote?: TextQuote | null
  state?: CapturedState
  spec?: Record<string, string>
}

export type Viewport = { width: number; height: number; scroll_x: number; scroll_y: number; device_pixel_ratio: number }

export type Environment = { color_scheme: 'light' | 'dark'; pointer: 'fine' | 'coarse' | 'none'; zoom: number; user_agent: string }

export type Status = 'open' | 'fixed' | 'answered' | 'resolved'
export type Resolution = 'confirmed' | 'wont_fix' | 'duplicate' | 'withdrawn'
export type Kind = 'change'
export type Visibility = 'everyone' | 'team'

export type Comment = {
  id: string
  number: number | null
  parent_id: string | null
  kind: Kind | null
  status: Status | null
  resolution: Resolution | null
  duplicate_of: number | null
  visibility: Visibility
  body: string
  author: Person
  attribution: { name: string; source: string } | null
  page_url: string | null
  page_title: string | null
  version: Version | null
  anchor: Anchor | null
  viewport: Viewport | null
  environment: Environment | null
  suggested_text: { old_text: string; new_text: string } | null
  source: 'typed' | 'spoken'
  talk_id: string | null
  client_id: string | null
  fixed: { by: Person; version: Version | null; commit: string | null; at: string } | null
  resolved: { by: Person; version: Version | null; at: string } | null
  event: { status: Status; resolution: Resolution | null } | null
  checkable: boolean
  link: string | null
  edited_at: string | null
  inserted_at: string
  updated_at: string
}

export type CommentSummary = Comment & { reply_count: number; last_activity_at: string }

export type VerdictValue = 'approved' | 'changes_requested'

export type Verdict = { reviewer: Person; version: Version; verdict: VerdictValue | null; note: string | null; updated_at: string }

export type Invite = { from_name: string | null; note: string | null }

export type Transcription = 'browser' | 'smart' | 'local'

export type TalkStatus = { minutes_left: number; max_duration_ms: number; transcribers: Transcription[] }

export type JoinReply = {
  reviewer: Person
  project: Project
  version: Version | null
  comments: Comment[]
  verdict: Verdict | null
  catch_up: { to_check: number[]; replied: number[] }
  last_seen_at: string | null
  invite: Invite | null
  talk: TalkStatus | null
}

export type PresentPerson = Person & { page_url: string | null; page_title: string | null }

export type ListFilter = 'all' | 'mine' | 'to_check' | 'new'

export type PushStatus = 'ok' | 'error' | 'timeout'

export interface PushLike {
  receive(status: PushStatus, callback: (response?: any) => any): PushLike
}

export interface ChannelLike {
  on(event: string, callback: (payload?: any) => void): number
  push(event: string, payload: object, timeout?: number): PushLike
}

export type ConnectionStatus = 'connecting' | 'online' | 'offline'

export type Rejection = 'unauthorized' | 'failed'

export interface Connection {
  channel: ChannelLike
  onJoin(callback: (reply: JoinReply) => void): void
  onPresence(callback: (people: PresentPerson[]) => void): void
  onStatus(callback: (status: ConnectionStatus) => void): void
  onRejected(callback: (reason: Rejection) => void): void
  disconnect(): void
}

export class RequestError extends Error {
  readonly reason: string
  readonly errors: Record<string, string[]>

  constructor(reason: string, errors: Record<string, string[]> = {}) {
    super(reason)
    this.reason = reason
    this.errors = errors
  }
}

export const RETRYABLE = new Set(['timeout', 'not_joined'])

export function request<Reply>(channel: ChannelLike, event: string, payload: object = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    try {
      channel
        .push(event, payload)
        .receive('ok', (reply) => resolve(reply as Reply))
        .receive('error', (reply) => reject(new RequestError(reply?.reason ?? 'error', reply?.errors)))
        .receive('timeout', () => reject(new RequestError('timeout')))
    } catch {
      reject(new RequestError('not_joined'))
    }
  })
}
