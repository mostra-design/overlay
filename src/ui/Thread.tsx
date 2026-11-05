import { useMemo, useRef, useState } from 'preact/hooks'
import { captureSpec, specChanges } from '../capture'
import { repliesTo } from '../comments'
import { displayName, eventWords, isUnread, nextLine, replyActions, threadActions, threadStatusWords, type MenuAction, type Transition } from '../lifecycle'
import type { Comment, Person } from '../protocol'
import { useAutosize, useController, useDraft, useFocusOnMount, useMostraState } from './hooks'
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, MicIcon, MoreIcon } from './icons'
import { useLayout } from './layout'
import { Avatar, Body, Byline, CloseButton, isSendKey, NumberTag, Time } from './primitives'

export function Thread({ id }: { id: string }) {
  const controller = useController()
  const { placements, tracker, phone } = useLayout()
  const comments = useMostraState((state) => state.comments)
  const pending = useMostraState((state) => state.pending)
  const me = useMostraState((state) => state.me)
  const project = useMostraState((state) => state.project)
  const version = useMostraState((state) => state.version)
  const stepper = useMostraState((state) => state.stepper)
  const lastSeenAt = useMostraState((state) => state.lastSeenAt)
  const arrived = useMostraState((state) => state.arrived)
  const deleting = useMostraState((state) => state.deleting)
  const pendingList = Array.from(pending.values(), (item) => item.comment)
  const comment = comments.get(id) ?? pendingList.find((item) => item.id === id)
  const replies = useMemo(
    () => [...repliesTo(comments, id), ...pendingList.filter((item) => item.parent_id === id)].filter((reply) => !deleting.has(reply.id)),
    [comments, pending, deleting, id],
  )
  if (!comment || !me) return null

  const placement = placements.get(comment.id)
  const sending = comment.number === null
  const checking = stepper?.kind === 'check' && stepper.numbers[stepper.index] === comment.number
  const othersReplied = replies.some((reply) => reply.author.id !== comment.author.id)
  const actions = sending ? { transitions: [], menu: [] } : threadActions(comment, me, othersReplied)
  const closingNote = [...replies].reverse().find((reply) => reply.event?.status === 'resolved')?.body ?? null
  const unplaced = comment.page_url !== null && comment.anchor !== null && placement?.status === 'unplaced'
  const title = comment.page_url === null ? `Note on v${comment.version?.number ?? ''}` : comment.anchor ? `On ${comment.anchor.label ?? comment.anchor.element_text ?? 'an element'}` : `On this page${comment.page_title ? ` (${comment.page_title})` : ''}`

  return (
    <>
      <header class="card-head">
        {sending ? <span class="number-tag sending" aria-hidden="true" /> : <NumberTag comment={comment} />}
        <h2 id="mostra-card-title" class="card-title" title={title}>
          {checking && version ? `Checking v${version.number}` : title}
          <span class="visually-hidden">{sending ? ', sending' : `, comment ${comment.number}`}</span>
        </h2>
        {stepper && (phone || checking) && <StepButtons />}
        {actions.menu.length > 0 && !checking && <ThreadMenu comment={comment} actions={actions.menu} />}
        <CloseButton onClick={() => controller.closeCard()} />
      </header>
      <div class="card-body thread">
        {checking ? (
          <CheckStep comment={comment} replies={replies} unplaced={unplaced} />
        ) : (
          <>
            <Message comment={comment} me={me} />
            {comment.talk_id && <VoicePassLine comment={comment} />}
            {placement?.onTrigger && <p class="aside">Left with the menu open</p>}
            {unplaced && (
              <div class="unplaced">
                <p class="aside">Couldn't place on this version.</p>
                {comment.anchor?.element_text && <blockquote class="quote">{comment.anchor.element_text}</blockquote>}
                {actions.menu.includes('repin') && (
                  <button type="button" class="button secondary" onClick={() => controller.startCommentMode(comment.id)}>
                    Re-pin
                  </button>
                )}
              </div>
            )}
            {replies.map((reply) => (
              <Reply key={reply.id} reply={reply} thread={comment} me={me} unread={isUnread(reply, me, lastSeenAt, arrived)} />
            ))}
            <Status comment={comment} me={me} replies={replies} closingNote={closingNote} transitions={actions.transitions} projectName={project?.name ?? 'project'} />
            {!sending && <ReplyBox thread={comment} me={me} />}
            {me.role === 'builder' && !sending && <Details comment={comment} element={tracker.element(comment.id)} />}
          </>
        )}
      </div>
    </>
  )
}

function Message({ comment, me }: { comment: Comment; me: Person }) {
  const controller = useController()
  const [editing, setEditing] = useState(false)
  const own = comment.author.id === me.id
  return (
    <article class="message">
      <Byline comment={comment} />
      {editing && own ? (
        <EditBox text={comment.body} onCancel={() => setEditing(false)} onSave={(body) => controller.edit(comment.id, body).then(() => setEditing(false))} />
      ) : (
        <>
          <Body comment={comment} />
          {comment.suggested_text && (
            <p class="suggestion">
              <del>{comment.suggested_text.old_text}</del> <span aria-hidden="true">→</span> <ins>{comment.suggested_text.new_text}</ins>
            </p>
          )}
        </>
      )}
      <Facts comment={comment} />
      {own && !editing && comment.number !== null && (
        <button type="button" class="text-button quiet edit" onClick={() => setEditing(true)}>
          Edit
        </button>
      )}
    </article>
  )
}

function Facts({ comment }: { comment: Comment }) {
  const facts = [comment.edited_at && 'edited', comment.visibility === 'team' && 'Team only'].filter(Boolean)
  if (facts.length === 0) return null
  return (
    <p class="facts">
      {facts.map((fact) => (
        <span key={String(fact)} class={fact === 'Team only' ? 'team' : ''}>
          {fact}
        </span>
      ))}
    </p>
  )
}

function Reply({ reply, thread, me, unread }: { reply: Comment; thread: Comment; me: Person; unread: boolean }) {
  const controller = useController()
  const [editing, setEditing] = useState(false)
  const menu = reply.number === null && reply.id.startsWith('pending:') ? [] : replyActions(reply, thread, me)
  const sending = reply.id.startsWith('pending:')
  return (
    <article class={`message reply${unread ? ' unread' : ''}${sending ? ' sending' : ''}`}>
      {reply.event ? (
        <div class="byline event">
          <Avatar person={reply.author} />
          <span class="who">
            <span class="name">{displayName(reply.author)}</span>
            {reply.author.role === 'agent' && <span class="label">Agent</span>}
            <span class="event-words">
              {' '}
              {eventWords(reply.event, thread.number)}
              {reply.version ? ` · v${reply.version.number}` : ''}
              {reply.event.status === 'fixed' && thread.fixed?.commit && thread.fixed.at <= reply.inserted_at ? ` · ${thread.fixed.commit}` : ''}
            </span>
          </span>
          <Time iso={reply.inserted_at} />
        </div>
      ) : (
        <Byline comment={reply}>{unread && <span class="new">new</span>}</Byline>
      )}
      {editing ? (
        <EditBox text={reply.body} onCancel={() => setEditing(false)} onSave={(body) => controller.edit(reply.id, body).then(() => setEditing(false))} />
      ) : (
        <Body comment={reply} />
      )}
      <Facts comment={reply} />
      {sending && <p class="facts">Sending</p>}
      {menu.length > 0 && !editing && (
        <span class="reply-actions">
          {menu.includes('edit') && (
            <button type="button" class="text-button quiet" onClick={() => setEditing(true)}>
              Edit
            </button>
          )}
          {menu.includes('show_to_everyone') && (
            <button type="button" class="text-button quiet" onClick={() => void controller.showToEveryone(reply.id)}>
              Show to everyone
            </button>
          )}
          {menu.includes('delete') && (
            <button type="button" class="text-button quiet" onClick={() => controller.remove(reply)}>
              Delete
            </button>
          )}
        </span>
      )}
    </article>
  )
}

function EditBox({ text, onSave, onCancel }: { text: string; onSave: (body: string) => Promise<unknown>; onCancel: () => void }) {
  const [value, setValue] = useState(text)
  const { phone } = useLayout()
  const field = useRef<HTMLTextAreaElement>(null)
  useAutosize(field, value, 200)
  useFocusOnMount(field)
  const save = () => {
    if (value.trim() && value.trim() !== text) void onSave(value.trim()).catch(() => {})
    else onCancel()
  }
  return (
    <div class="edit-box">
      <textarea
        ref={field}
        class="input"
        value={value}
        aria-label="Edit comment"
        onInput={(event) => setValue(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (isSendKey(event, phone)) {
            event.preventDefault()
            save()
          }
        }}
      />
      <span class="row-actions">
        <button type="button" class="button ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" class="button primary" onClick={save}>
          Save
        </button>
      </span>
    </div>
  )
}

function Status(props: { comment: Comment; me: Person; replies: Comment[]; closingNote: string | null; transitions: Transition[]; projectName: string }) {
  const { comment, me, replies, closingNote, transitions, projectName } = props
  if (comment.number === null) return <p class="status-line sending">Sending</p>
  const words = me.role === 'builder' ? nextLine(comment, projectName) : threadStatusWords(comment, me, closingNote, replies)
  if (!words && transitions.length === 0) return null
  const checkIt = me.role !== 'builder' && comment.author.id === me.id && comment.status === 'fixed' && comment.checkable
  return (
    <div class="status">
      {words && (
        <p class={`status-line${me.role === 'builder' ? ' next' : ''}`}>
          {checkIt ? (
            <>
              Fixed - <mark>check it</mark>
            </>
          ) : (
            words
          )}
        </p>
      )}
      {transitions.length > 0 && <Transitions comment={comment} transitions={transitions} />}
    </div>
  )
}

export function Transitions({ comment, transitions }: { comment: Comment; transitions: Transition[] }) {
  const controller = useController()
  const [open, setOpen] = useState<Transition | null>(null)
  const [closeMenu, setCloseMenu] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const standing = transitions.filter((transition) => !transition.under)
  const closing = transitions.filter((transition) => transition.under === 'close')

  const run = async (transition: Transition, body: string) => {
    const duplicate = transition.resolution === 'duplicate' ? Number(body.replace(/^#/, '')) : null
    if (transition.resolution === 'duplicate' && !(duplicate && duplicate > 0)) return
    setBusy(true)
    try {
      await controller.transition(comment, transition, transition.resolution === 'duplicate' ? '' : body, duplicate)
      setOpen(null)
      setText('')
    } catch {
    } finally {
      setBusy(false)
    }
  }
  const choose = (transition: Transition) => {
    setCloseMenu(false)
    if (transition.text === 'none' && transition.resolution !== 'duplicate') void run(transition, '')
    else setOpen(transition)
  }

  if (open) {
    const duplicate = open.resolution === 'duplicate'
    const required = open.text === 'required' || duplicate
    return (
      <form
        class="transition-form"
        onSubmit={(event) => {
          event.preventDefault()
          if (!required || text.trim()) void run(open, text.trim())
        }}
      >
        <label class="field">
          <span class="field-label">{duplicate ? 'Same as which comment?' : open.prompt}</span>
          <TransitionField
            value={text}
            inputMode={duplicate ? 'numeric' : undefined}
            placeholder={duplicate ? '#12' : undefined}
            onInput={setText}
          />
        </label>
        <span class="row-actions">
          <button type="button" class="button ghost" onClick={() => setOpen(null)}>
            Cancel
          </button>
          <button type="submit" class="button primary" disabled={busy || (required && !text.trim())}>
            {open.label.replace(/…$/, '')}
          </button>
        </span>
      </form>
    )
  }

  return (
    <div class="transitions">
      {standing.map((transition, index) => (
        <button key={transition.label} type="button" class={`button ${index === 0 ? 'primary' : 'secondary'}`} disabled={busy} onClick={() => choose(transition)}>
          {transition.label}
        </button>
      ))}
      {closing.length > 0 && (
        <span class="menu-anchor">
          <button type="button" class="button secondary" aria-expanded={closeMenu} aria-haspopup="menu" onClick={() => setCloseMenu(!closeMenu)}>
            Close <ChevronDownIcon size={14} />
          </button>
          {closeMenu && (
            <span class="menu" role="menu">
              {closing.map((transition) => (
                <button key={transition.label} type="button" role="menuitem" class="menu-item" onClick={() => choose(transition)}>
                  {transition.label}
                </button>
              ))}
            </span>
          )}
        </span>
      )}
    </div>
  )
}

function TransitionField(props: { value: string; inputMode?: 'numeric'; placeholder?: string; onInput: (value: string) => void }) {
  const field = useFocusOnMount<HTMLInputElement>()
  return <input ref={field} class="input" value={props.value} inputMode={props.inputMode} placeholder={props.placeholder} onInput={(event) => props.onInput(event.currentTarget.value)} />
}

function ReplyBox({ thread, me }: { thread: Comment; me: Person }) {
  const controller = useController()
  const { phone } = useLayout()
  const [body, setBody] = useDraft(`reply:${thread.id}`)
  const [team, setTeam] = useState(thread.visibility === 'team')
  const [name, setName] = useState('')
  const field = useRef<HTMLTextAreaElement>(null)
  useAutosize(field, body, 160)
  const needsName = !me.display_name
  const ready = body.trim().length > 0 && (!needsName || name.trim().length > 0)
  const send = () => {
    if (!ready) return
    void controller.reply(thread, body.trim(), team ? 'team' : 'everyone', needsName ? name.trim() : null)
  }
  return (
    <div class="reply-box">
      {needsName && body.trim() && (
        <label class="field">
          <span class="field-label">Your name</span>
          <input class="input" value={name} maxLength={60} autoComplete="name" onInput={(event) => setName(event.currentTarget.value)} />
        </label>
      )}
      <textarea
        ref={field}
        class="input"
        rows={1}
        value={body}
        placeholder="Reply"
        aria-label={`Reply to #${thread.number}`}
        onInput={(event) => setBody(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (isSendKey(event, phone)) {
            event.preventDefault()
            send()
          }
        }}
      />
      {(body.trim() || phone) && (
        <span class="row-actions">
          {me.role === 'builder' && thread.visibility === 'everyone' && (
            <button type="button" class={`chip-button${team ? ' pressed' : ''}`} aria-pressed={team} onClick={() => setTeam(!team)}>
              Team only
            </button>
          )}
          <button type="button" class="button primary" disabled={!ready} onClick={send}>
            Send
          </button>
        </span>
      )}
    </div>
  )
}

function ThreadMenu({ comment, actions }: { comment: Comment; actions: MenuAction[] }) {
  const controller = useController()
  const [open, setOpen] = useState(false)
  const items: Array<{ label: string; run: () => void }> = []
  for (const action of actions) {
    switch (action) {
      case 'repin':
        items.push({ label: 'Re-pin', run: () => controller.startCommentMode(comment.id) })
        break
      case 'show_to_everyone':
        items.push({ label: 'Show to everyone', run: () => void controller.showToEveryone(comment.id) })
        break
      case 'copy_for_agent':
        items.push({ label: 'Copy for agent', run: () => copy(controller, `Fix review comment #${comment.number}`) })
        break
      case 'withdraw':
        items.push({ label: 'Withdraw', run: () => void controller.transition(comment, { label: 'Withdraw', to: 'resolved', resolution: 'withdrawn', text: 'none' }, '') })
        break
      case 'delete':
        items.push({ label: 'Delete', run: () => controller.remove(comment) })
        break
    }
  }
  if (items.length === 0) return null
  return (
    <span class="menu-anchor">
      <button type="button" class="icon-button" aria-label="More" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <MoreIcon />
      </button>
      {open && (
        <span class="menu end" role="menu">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              class={`menu-item${item.label === 'Delete' ? ' danger' : ''}`}
              onClick={() => {
                setOpen(false)
                item.run()
              }}
            >
              {item.label}
            </button>
          ))}
        </span>
      )}
    </span>
  )
}

export function copy(controller: ReturnType<typeof useController>, text: string) {
  navigator.clipboard?.writeText(text).then(
    () => controller.notify(`Copied "${text}"`),
    () => controller.notify("Couldn't copy. Your browser blocked it.", 'error'),
  )
}

function Details({ comment, element }: { comment: Comment; element: Element | null }) {
  const anchor = comment.anchor
  const rows: Array<[string, string]> = []
  const addRow = (term: string, describe: () => string) => {
    try {
      rows.push([term, describe()])
    } catch {}
  }
  if (anchor?.label) rows.push(['Label', anchor.label])
  if (anchor?.selectors?.length) addRow('Selectors', () => anchor.selectors.map((selector) => `${selector.type}: ${selector.value}`).join('\n'))
  if (anchor?.state && Object.keys(anchor.state).length) addRow('State', () => describeState(anchor.state))
  if (anchor?.spec && Object.keys(anchor.spec).length) rows.push(['Spec', Object.entries(anchor.spec).map(([property, value]) => `${property} ${value}`).join('\n')])
  if (comment.viewport) rows.push(['Viewport', `${comment.viewport.width} × ${comment.viewport.height} @${comment.viewport.device_pixel_ratio}x, scrolled ${comment.viewport.scroll_y}px`])
  if (comment.environment) rows.push(['Environment', `${comment.environment.color_scheme}, ${comment.environment.pointer} pointer, zoom ${comment.environment.zoom}\n${comment.environment.user_agent}`])
  if (comment.version) rows.push(['Version', `v${comment.version.number} · ${comment.version.label}`])
  if (anchor && !element && comment.page_url) rows.push(['Placed', 'not on this version'])
  if (rows.length === 0) return null
  return (
    <details class="details">
      <summary>Details</summary>
      <dl>
        {rows.map(([term, value]) => (
          <div key={term} class="detail">
            <dt>{term}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </details>
  )
}

function describeState(state: NonNullable<Comment['anchor']>['state']): string {
  if (!state) return ''
  const own = Object.entries(state)
    .filter(([key]) => key !== 'ancestors' && key !== 'opened_by')
    .map(([key, value]) => (value === true ? key.replace(/_/g, '-') : `${key.replace(/_/g, '-')}=${value}`))
  const lines = own.length ? [own.join(', ')] : []
  for (const ancestor of state.ancestors ?? []) {
    const flags = Object.entries(ancestor)
      .filter(([key]) => key !== 'depth' && key !== 'label')
      .map(([key, value]) => (value === true ? key.replace(/_/g, '-') : `${key.replace(/_/g, '-')}=${value}`))
    lines.push(`${'↑'.repeat(ancestor.depth)} ${ancestor.label}: ${flags.join(', ')}`)
  }
  if (state.opened_by?.length) lines.push(`opened by ${state.opened_by[0]?.value ?? ''}`)
  return lines.join('\n')
}

function StepButtons() {
  const controller = useController()
  const stepper = useMostraState((state) => state.stepper)
  if (!stepper) return null
  return (
    <span class="step-buttons">
      <button type="button" class="icon-button" aria-label="Previous" disabled={stepper.index === 0} onClick={() => void controller.step(-1)}>
        <ChevronLeftIcon />
      </button>
      <span class="mono step-count">
        {stepper.index + 1} of {stepper.numbers.length}
      </span>
      <button type="button" class="icon-button" aria-label="Next" disabled={stepper.index >= stepper.numbers.length - 1} onClick={() => void controller.step(1)}>
        <ChevronRightIcon />
      </button>
    </span>
  )
}

function CheckStep({ comment, replies, unplaced }: { comment: Comment; replies: Comment[]; unplaced: boolean }) {
  const controller = useController()
  const { tracker } = useLayout()
  const me = useMostraState((state) => state.me)!
  const version = useMostraState((state) => state.version)
  const element = tracker.element(comment.id)
  const answer = [...replies].reverse().find((reply) => reply.event && (reply.event.status === 'fixed' || reply.event.status === 'answered'))
  const changes = element && comment.anchor?.spec ? specChanges(comment.anchor.spec, captureSpec(element)) : []
  const suggestion = comment.suggested_text
  const precheck = suggestion && element ? ((element.textContent ?? '').replace(/\s+/g, ' ').includes(suggestion.new_text.replace(/\s+/g, ' ').trim()) ? 'New text found here.' : 'New text not found here.') : null
  const transitions = threadActions(comment, me, true).transitions
  const stale = comment.status === 'fixed' && !comment.checkable

  return (
    <div class="check">
      <p class="eyebrow">You, on v{comment.version?.number ?? '?'}</p>
      <blockquote class="quote">
        <Body comment={comment} class="quote-text" />
      </blockquote>
      {answer && (
        <article class="message">
          <div class="byline event">
            <Avatar person={answer.author} />
            <span class="who">
              <span class="name">{displayName(answer.author)}</span>
              {answer.author.role === 'agent' && <span class="label">Agent</span>}
              <span class="event-words"> {eventWords(answer.event!, comment.number)}</span>
            </span>
            <Time iso={answer.inserted_at} />
          </div>
          <Body comment={answer} />
        </article>
      )}
      {stale ? (
        <div class="check-note">
          <p>This page still shows v{version?.number}. The fix is marked for a newer version.</p>
          <button type="button" class="button secondary" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      ) : unplaced ? (
        <div class="check-note">
          <p>Couldn't find this on v{version?.number}.</p>
          {comment.anchor?.element_text && <blockquote class="quote small">{comment.anchor.element_text}</blockquote>}
          <button type="button" class="button secondary" onClick={() => controller.startCommentMode(comment.id)}>
            Re-pin
          </button>
        </div>
      ) : (
        <>
          {precheck && <p class={`precheck${precheck.startsWith('New text found') ? ' found' : ''}`}>{precheck}</p>}
          {comment.anchor && element && (
            <details class="details changes">
              <summary>What changed on this element</summary>
              {changes.length > 0 ? (
                <ul class="spec-changes">
                  {changes.map((change) => (
                    <li key={change.property}>
                      {change.property} <span class="then">{change.then}</span> → <span class="now">{change.now}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p class="aside">No style changes on this element.</p>
              )}
            </details>
          )}
        </>
      )}
      {!stale && transitions.length > 0 && <Transitions comment={comment} transitions={transitions} />}
    </div>
  )
}

function VoicePassLine({ comment }: { comment: Comment }) {
  const controller = useController()
  const summaries = useMostraState((state) => state.summaries)
  const others = Array.from(summaries?.values() ?? [])
    .filter((other) => other.talk_id === comment.talk_id && other.id !== comment.id && other.number !== null)
    .sort((first, second) => first.number! - second.number!)
  return (
    <p class="aside voice-pass-line">
      <MicIcon size={14} />
      {others.length > 0 ? 'From a voice pass with' : 'From a voice pass'}
      {others.map((other) => (
        <button key={other.id} type="button" class="text-button" onClick={() => void controller.open(other.number!)}>
          #{other.number}
        </button>
      ))}
    </p>
  )
}

