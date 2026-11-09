import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import { legalUrls } from '../config'
import { displayName, isUnresolved, presenceWords } from '../lifecycle'
import type { Rect, Size } from '../placement'
import type { TalkState } from '../talk'
import { restToolbar, snapToolbar, toolbarBox } from '../toolbar-position'
import { useClickAway, useSelection } from './CommentMode'
import { followPointer, type DragPoint } from './drag'
import { useController, useFocusOnMount, useMostraState, useViewportSize, viewportSize } from './hooks'
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon, GripIcon, MenuIcon, MicIcon, PenIcon } from './icons'
import { useLayout, useSurface, useSurfaceChanges } from './layout'
import { PagePins } from './Marks'
import { Avatar } from './primitives'
import { copy } from './Thread'

export function Toolbar() {
  const controller = useController()
  const { toolbar, surfaces, phone, threads } = useLayout()
  const me = useMostraState((state) => state.me)
  const version = useMostraState((state) => state.version)
  const mode = useMostraState((state) => state.mode)
  const stepper = useMostraState((state) => state.stepper)
  const connection = useMostraState((state) => state.connection)
  const hidden = useMostraState((state) => state.hidden)
  const position = useMostraState((state) => state.toolbar)
  const list = useMostraState((state) => state.list)
  const card = useMostraState((state) => state.card)
  const menu = useMostraState((state) => state.menu)
  const verdict = useMostraState((state) => state.verdict)
  const summaries = useMostraState((state) => state.summaries)
  const presence = useMostraState((state) => state.presence)
  const pending = useMostraState((state) => state.pending)
  const talkStatus = useMostraState((state) => state.talkStatus)
  const talk = useMostraState((state) => state.talk)
  const selection = useSelection()
  const away = useHideOnScroll(phone && !mode && !stepper && !card && !list && (!talk || talk.phase === 'failed'))
  const [peopleOpen, setPeopleOpen] = useState(false)
  useEffect(() => {
    if (list || menu) setPeopleOpen(false)
  }, [list, menu])
  useClickAway(() => setPeopleOpen(false))
  const viewport = useViewportSize()
  const [size, setSize] = useState<Size>({ width: 0, height: 0 })
  const [dragged, setDragged] = useState<Rect | null>(null)
  const menuSurface = useSurface('menu')
  const box = phone ? null : (dragged ?? toolbarBox(position, size, viewport))
  useSurfaceChanges()

  useLayoutEffect(() => {
    const element = toolbar.current
    if (element && (element.offsetWidth !== size.width || element.offsetHeight !== size.height)) setSize({ width: element.offsetWidth, height: element.offsetHeight })
  })

  useLayoutEffect(() => {
    surfaces.set('toolbar', toolbar.current)
    surfaces.changed()
  }, [surfaces, box?.left, box?.top, phone, hidden, !me])

  const openCount = useMemo(() => {
    if (summaries) return Array.from(summaries.values()).filter((comment) => comment.page_url !== null && isUnresolved(comment)).length
    return threads.filter((thread) => thread.number !== null && isUnresolved(thread)).length
  }, [summaries, threads])
  const myCount = useMemo(() => {
    if (!me || !version) return 0
    const fromList = summaries ? Array.from(summaries.values()).filter((comment) => comment.author.id === me.id && comment.page_url !== null && comment.version?.id === version.id).length : 0
    return Math.max(fromList, pending.size, threads.filter((thread) => thread.author.id === me.id && thread.version?.id === version.id).length)
  }, [summaries, threads, pending, me, version])

  if (!me) return null
  const builder = me.role === 'builder'
  const style = box ? { left: `${Math.round(box.left)}px`, top: `${Math.round(box.top)}px`, right: 'auto', bottom: 'auto' } : undefined

  const talking = talk !== null && talk.phase !== 'failed'

  if (hidden && !talking) {
    return (
      <div ref={toolbar} class="layer toolbar collapsed" role="toolbar" aria-label="Review" style={style}>
        <button type="button" class="tool dot" aria-label={`Show comments (${openCount})`} onClick={() => controller.setHidden(false)}>
          <span class="ink-dot" aria-hidden="true" />
          <span class="mono">{openCount}</span>
        </button>
      </div>
    )
  }

  const startDrag = (event: PointerEvent) => {
    if (phone) return
    const element = toolbar.current
    if (!element) return
    event.preventDefault()
    const { left, top, width, height } = element.getBoundingClientRect()
    const offsetX = event.clientX - left
    const offsetY = event.clientY - top
    const under = (point: DragPoint) => snapToolbar({ left: point.x - offsetX, top: point.y - offsetY, width, height }, viewportSize())
    followPointer(
      event.currentTarget as Element,
      event,
      (point) => setDragged(under(point)),
      (point) => {
        setDragged(null)
        controller.setToolbar(restToolbar(under(point), viewportSize()))
      },
    )
  }

  const verb = phone ? 'Tap' : 'Click'
  const doneLabel = verdict?.verdict === 'approved' ? 'Approved' : verdict?.verdict === 'changes_requested' ? 'Changes requested' : 'Done'
  const checking = stepper?.kind === 'check'

  let content
  if (talking) {
    content = <TalkBar />
  } else if (mode) {
    content = (
      <div class="mode" role="status">
        <span class="mode-mark" aria-hidden="true" />
        <span class="mode-text">{mode.repin ? `${verb} the element this comment is about` : `${verb} what you want to comment on`}</span>
        {!mode.repin && (
          <>
            <span class="sep" aria-hidden="true">
              ·
            </span>
            <button type="button" class="tool text" onClick={() => controller.pickPage()}>
              {phone ? 'Whole page' : 'or the whole page'}
            </button>
          </>
        )}
        <span class="sep" aria-hidden="true">
          ·
        </span>
        {phone ? (
          <button type="button" class="tool text" onClick={() => controller.stopCommentMode()}>
            Cancel
          </button>
        ) : (
          <>
            <span class="mode-hint">Esc to cancel</span>
            <button type="button" class="tool icon" aria-label="Cancel" onClick={() => controller.stopCommentMode()}>
              <CloseIcon />
            </button>
          </>
        )}
      </div>
    )
  } else if (stepper) {
    content = (
      <div class="mode" role="status">
        {checking && version && <span class="mode-text">Checking v{version.number}</span>}
        {checking && (
          <span class="sep" aria-hidden="true">
            ·
          </span>
        )}
        <button type="button" class="tool icon" aria-label="Previous" disabled={stepper.index === 0} onClick={() => void controller.step(-1)}>
          <ChevronLeftIcon />
        </button>
        <span class="mono step">
          {stepper.index + 1} of {stepper.numbers.length}
        </span>
        <button type="button" class="tool icon" aria-label="Next" disabled={stepper.index >= stepper.numbers.length - 1} onClick={() => void controller.step(1)}>
          <ChevronRightIcon />
        </button>
        <span class="sep" aria-hidden="true">
          ·
        </span>
        <button type="button" class="tool text" onClick={() => controller.stopStepper()}>
          Exit
        </button>
      </div>
    )
  } else {
    const talkOffered = talkStatus !== null && !talk
    const talkLeads = talkOffered && !(phone && selection)
    const penOnly = phone && talkLeads
    content = (
      <>
        <button type="button" class="tool icon" aria-label="Menu" aria-haspopup="menu" aria-expanded={menu} onClick={() => controller.toggleMenu()}>
          <MenuIcon />
        </button>
        <span class="rule" aria-hidden="true" />
        {talk?.phase === 'failed' && <TalkFailed />}
        {talkOffered && (
          <button type="button" class={`tool ${talkLeads ? 'labelled primary' : 'icon'}`} aria-label={talkLeads ? undefined : 'Talk'} onClick={() => void controller.toggleTalk()} title={phone ? undefined : 'Talk (T)'}>
            <MicIcon /> {talkLeads && 'Talk'}
          </button>
        )}
        {phone && selection ? (
          <button type="button" class="tool labelled primary" onClick={() => controller.pickSelection(selection)}>
            <PenIcon /> Comment on selected text
          </button>
        ) : (
          <button type="button" class={`tool ${penOnly ? 'icon' : 'labelled'}${talkLeads ? '' : ' primary'}`} aria-label={penOnly ? 'Comment' : undefined} aria-pressed={false} onClick={() => controller.startCommentMode()} title={phone ? undefined : 'Comment (C)'}>
            <PenIcon /> {!penOnly && 'Comment'}
          </button>
        )}
        {}
        {talkLeads && <span class="rule" aria-hidden="true" />}
        {connection === 'offline' ? (
          <span class="offline" role="status">
            <span class="offline-dot" aria-hidden="true" />
            {phone ? 'Offline' : "Offline. Comments will send when you're back."}
          </span>
        ) : (
          <button type="button" class="tool labelled" aria-expanded={list} onClick={() => controller.toggleList()} title={phone ? undefined : 'List (L)'}>
            <span class="mono count">{openCount}</span>
            {!phone && <span>{openCount === 1 ? 'comment' : 'comments'}</span>}
          </button>
        )}
        {presence.length > 0 && !phone && (
          <span class="menu-anchor">
            <button type="button" class="tool labelled people" aria-expanded={peopleOpen} onClick={() => {
                controller.toggleList(false)
                setPeopleOpen(!peopleOpen)
              }}>
              <span class="faces" aria-hidden="true">
                {presence.slice(0, 3).map((person) => (
                  <Avatar key={person.id} person={person} size="small" />
                ))}
              </span>
              {presenceWords(presence)}
            </button>
            {peopleOpen && (
              <span ref={menuSurface} class="menu up people-list" role="dialog" aria-label="Who's here">
                {presence.map((person) => (
                  <span key={person.id} class="person">
                    <Avatar person={person} size="small" />
                    <span class="person-name">{displayName(person)}</span>
                    <span class="person-page">{person.page_title || person.page_url}</span>
                  </span>
                ))}
              </span>
            )}
          </span>
        )}
        <span class="rule" aria-hidden="true" />
        {builder && !phone && (version ? <span class="version-chip mono">v{version.number} · {version.label}</span> : <span class="version-chip mono">no version</span>)}
        {(version || builder) && (
          <button
            type="button"
            class={`tool labelled done${verdict ? ` ${verdict.verdict === 'approved' ? 'approved' : 'changes'}` : ''}`}
            aria-expanded={card?.type === 'done'}
            onClick={() => (card?.type === 'done' ? controller.closeCard() : void controller.openDone())}
          >
            {verdict && <span class="verdict-dot" aria-hidden="true" />}
            {doneLabel}
            {!verdict && myCount > 0 && <span class="dot" aria-label="(you have comments on this version)" />}
          </button>
        )}
      </>
    )
  }

  return (
    <div
      ref={toolbar}
      class={`layer toolbar${away || (phone && (card || list) && !mode && !talking) ? ' away' : ''}${dragged ? ' dragging' : ''}${mode || stepper || talking ? ' moded' : ''}${box ? menuSides(box, viewport) : ''}`}
      role="toolbar"
      aria-label="Review"
      style={style}
    >
      {!phone && (
        <span class="grip" aria-hidden="true" onPointerDown={startDrag} onMouseDown={(event) => event.preventDefault()} onDragStart={(event) => event.preventDefault()}>
          <GripIcon size={14} />
        </span>
      )}
      {content}
      {menu && !mode && !stepper && !talking && <ToolbarMenu builder={builder} />}
      <PagePins />
    </div>
  )
}

export function commentToolName(phone: boolean, talkOffered: boolean): string {
  return phone && talkOffered ? 'the pen' : 'Comment'
}

function TalkFailed() {
  const controller = useController()
  const { phone } = useLayout()
  return (
    <span class="talk-failed" role="alert">
      <span>{phone ? 'Not sent' : "Couldn't turn that into comments"}</span>
      <button type="button" class="tool text" onClick={() => void controller.retryTalk()}>
        Try again
      </button>
      <button type="button" class="tool text" onClick={() => void controller.dropTalk()}>
        Discard
      </button>
    </span>
  )
}

function TalkBar() {
  const controller = useController()
  const talk = useMostraState((state) => state.talk)
  if (talk?.phase === 'naming') return <TalkNaming />
  if (talk?.phase === 'turning' || talk?.phase === 'opening') {
    return (
      <div class="mode waiting" role="status">
        <span class="talk-dot quiet" aria-hidden="true" />
        <span class="mode-text">{talkWaitText(talk)}</span>
      </div>
    )
  }
  if (talk?.phase !== 'recording') return null
  return (
    <div class="mode talking" role="status">
      <span class={`talk-dot${talk.example ? ' quiet' : ''}`} aria-hidden="true" />
      <span class="mode-text">{talk.example ? 'Example' : 'Recording'}</span>
      <span class="mono talk-time" aria-hidden="true">
        {formatTime(talk.elapsedMs)}
      </span>
      {}
      {!talk.example && (
        <span class="talk-level" aria-hidden="true" style={{ '--level': talk.level.toFixed(2) }}>
          <span />
          <span />
          <span />
        </span>
      )}
      <button type="button" class="tool labelled primary" onClick={() => void controller.toggleTalk()}>
        Stop
      </button>
    </div>
  )
}

function TalkNaming() {
  const controller = useController()
  const menuSurface = useSurface('menu')
  const [name, setName] = useState('')
  const [posting, setPosting] = useState(false)
  const post = (event: Event) => {
    event.preventDefault()
    if (!name.trim() || posting) return
    setPosting(true)
    void controller
      .postTalkAs(name)
      .catch(() => {})
      .finally(() => setPosting(false))
  }
  return (
    <div class="mode">
      <span class="talk-dot quiet" aria-hidden="true" />
      <span class="mode-text">Your name goes on these comments</span>
      <div ref={menuSurface} class="menu up toolbar-menu" role="dialog" aria-label="Your name">
        <form class="name-form" onSubmit={post}>
          <label class="field">
            <span class="field-label">Your name</span>
            <NameField value={name} onInput={setName} />
          </label>
          <button type="submit" class="button primary" disabled={!name.trim() || posting}>
            Post
          </button>
        </form>
      </div>
      <button type="button" class="tool text" onClick={() => void controller.dropTalk()}>
        Discard
      </button>
    </div>
  )
}

function talkWaitText(talk: TalkState): string {
  if (talk.phase === 'opening') return 'Opening the microphone'
  if (talk.phase === 'turning' && talk.preparing !== undefined) return `Downloading the speech model, ${Math.round(talk.preparing * 100)}%`
  return 'Turning that into comments'
}

export function formatTime(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

function ToolbarMenu({ builder }: { builder: boolean }) {
  const controller = useController()
  const me = useMostraState((state) => state.me)!
  const project = useMostraState((state) => state.project)
  const singleKeys = useMostraState((state) => state.singleKeys)
  const pageUrl = useMostraState((state) => state.pageUrl)
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState(me.display_name ?? '')
  const close = () => controller.toggleMenu(false)
  const inviteUrl = project?.invite_url ? pageInviteUrl(project.invite_url, pageUrl) : null
  const menuSurface = useSurface('menu')

  return (
    <div ref={menuSurface} class="menu up toolbar-menu" role="menu" aria-label="Menu">
      {naming ? (
        <form
          class="name-form"
          onSubmit={(event) => {
            event.preventDefault()
            if (name.trim()) void controller.setName(name).then(() => setNaming(false), () => {})
          }}
        >
          <label class="field">
            <span class="field-label">Your name</span>
            <NameField value={name} onInput={setName} />
          </label>
          <button type="submit" class="button primary" disabled={!name.trim()}>
            Save
          </button>
        </form>
      ) : (
        <button type="button" role="menuitem" class="menu-item" onClick={() => setNaming(true)}>
          Your name <span class="menu-value">{displayName(me)}</span>
        </button>
      )}
      <button
        type="button"
        role="menuitem"
        class="menu-item"
        onClick={() => {
          close()
          controller.setHidden(true)
        }}
      >
        Hide comments <kbd>H</kbd>
      </button>
      <button
        type="button"
        role="menuitem"
        class="menu-item"
        onClick={() => {
          close()
          controller.openShortcuts()
        }}
      >
        Keyboard shortcuts <kbd>?</kbd>
      </button>
      <button type="button" role="menuitemcheckbox" aria-checked={singleKeys} class="menu-item" onClick={() => controller.setSingleKeys(!singleKeys)}>
        Single-key shortcuts <span class="menu-value">{singleKeys ? 'On' : 'Off'}</span>
      </button>
      {builder && inviteUrl && (
        <button
          type="button"
          role="menuitem"
          class="menu-item"
          onClick={() => {
            close()
            copy(controller, inviteUrl)
          }}
        >
          Copy invite link for this page
        </button>
      )}
      {builder && project?.dashboard_url && (
        <a role="menuitem" class="menu-item" href={project.dashboard_url} target="_blank" rel="noopener" onClick={close}>
          Open dashboard
        </a>
      )}
      <a role="menuitem" class="menu-item" href={legalUrls.terms} target="_blank" rel="noopener" onClick={close}>
        Terms and privacy
      </a>
      <span class="menu-rule" aria-hidden="true" />
      <button type="button" role="menuitem" class="menu-item" onClick={() => controller.stopReviewing()}>
        Stop reviewing on this device
      </button>
    </div>
  )
}

function NameField({ value, onInput }: { value: string; onInput: (value: string) => void }) {
  const field = useFocusOnMount<HTMLInputElement>()
  return <input ref={field} class="input" value={value} maxLength={60} autoComplete="name" onInput={(event) => onInput(event.currentTarget.value)} />
}

export function pageInviteUrl(inviteUrl: string, pageUrl: string): string {
  try {
    const invite = new URL(inviteUrl)
    const page = new URL(pageUrl, invite.origin)
    page.searchParams.set('mostra', invite.searchParams.get('mostra') ?? '')
    return page.href
  } catch {
    return inviteUrl
  }
}

function menuSides(box: Rect, viewport: Size): string {
  const down = box.top + box.height / 2 < viewport.height / 2
  const leftwards = box.left + box.width / 2 > viewport.width / 2 + 1
  return `${down ? ' opens-down' : ''}${leftwards ? ' opens-left' : ''}`
}

function useHideOnScroll(active: boolean): boolean {
  const [away, setAway] = useState(false)
  const last = useRef(0)
  useEffect(() => {
    if (!active) return setAway(false)
    last.current = window.scrollY
    const onScroll = () => {
      const y = window.scrollY
      if (Math.abs(y - last.current) < 8) return
      setAway(y > last.current && y > 48)
      last.current = y
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [active])
  return away
}
