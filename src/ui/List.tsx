import { useMemo } from 'preact/hooks'
import { plainBody } from '../comments'
import { matchesFilter, type ListFilter } from '../controller'
import { displayName, statusWords } from '../lifecycle'
import type { CommentSummary, Person } from '../protocol'
import { useController, useMostraState } from './hooks'
import { CheckIcon, MicIcon, PenIcon } from './icons'
import { useLayout, useSheetLift, useSurface, useSurfaceChanges } from './layout'
import { excerpt } from './Marks'
import { CloseButton, NumberTag } from './primitives'
import { commentToolName } from './Toolbar'

const FILTERS: Array<[ListFilter, string]> = [
  ['open', 'Open'],
  ['mine', 'Mine'],
  ['resolved', 'Resolved'],
]

export function List() {
  const controller = useController()
  const { phone, toolbar } = useLayout()
  const listSurface = useSurface('list')
  const sheetLift = useSheetLift()
  const state = useMostraState((current) => current)
  const { me, summaries, pageUrl, version, listFilter, listPerson, positions, unplaced, deleting, talkStatus } = state

  const sections = useMemo(() => {
    const all = Array.from(summaries?.values() ?? []).filter((comment) => !deleting.has(comment.id) && matchesFilter(comment, state))
    const notes = all.filter((comment) => comment.page_url === null && comment.version?.id === version?.id).sort((first, second) => (second.number ?? 0) - (first.number ?? 0))
    const position = (comment: CommentSummary) => positions.get(comment.id) ?? comment.anchor?.rect?.y ?? Number.MAX_SAFE_INTEGER
    const here = all.filter((comment) => comment.page_url === pageUrl)
    const placed = here.filter((comment) => !unplaced.has(comment.id)).sort((first, second) => position(first) - position(second))
    const lost = here.filter((comment) => unplaced.has(comment.id))
    const pages = new Map<string, CommentSummary[]>()
    for (const comment of all) {
      if (comment.page_url === null || comment.page_url === pageUrl) continue
      const title = comment.page_title || comment.page_url
      pages.set(title, [...(pages.get(title) ?? []), comment])
    }
    const others = Array.from(pages.entries()).sort(([first], [second]) => first.localeCompare(second))
    return { notes, placed, lost, others, total: all.length }
  }, [summaries, pageUrl, version, listFilter, listPerson, positions, unplaced, deleting, me])

  const people = useMemo(() => {
    const byId = new Map<string, Person>()
    for (const comment of summaries?.values() ?? []) if (comment.author.role !== 'agent') byId.set(comment.author.id, comment.author)
    return Array.from(byId.values()).sort((first, second) => displayName(first).localeCompare(displayName(second)))
  }, [summaries])
  useSurfaceChanges()
  if (!me) return null
  const builder = me.role === 'builder'

  const toolbarRect = toolbar.current?.getBoundingClientRect()
  const style = phone ? { bottom: `${sheetLift}px` } : toolbarRect && listStyle(toolbarRect)

  return (
    <section ref={listSurface} class={`layer ${phone ? 'sheet list-sheet' : 'list'}`} style={style} role="dialog" aria-modal="false" aria-labelledby="mostra-list-title">
      {phone && (
        <span class="handle" aria-hidden="true">
          <span />
        </span>
      )}
      <header class="list-head">
        <h2 id="mostra-list-title" class="display small">
          Comments
        </h2>
        <CloseButton onClick={() => controller.toggleList(false)} />
      </header>
      <div class="filters" role="tablist" aria-label="Show">
        {FILTERS.map(([value, label]) => (
          <button key={value} type="button" role="tab" class="filter" aria-selected={listFilter === value} onClick={() => controller.setListFilter(value, listPerson)}>
            {label}
          </button>
        ))}
        {builder && (
          <button type="button" role="tab" class="filter" aria-selected={listFilter === 'new'} onClick={() => controller.setListFilter('new', listPerson)}>
            New since I last looked
          </button>
        )}
        {builder && people.length > 1 && (
          <select class="person-filter" aria-label="Person" value={listPerson ?? ''} onChange={(event) => controller.setListFilter(listFilter, event.currentTarget.value || null)}>
            <option value="">Everyone</option>
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {displayName(person)}
              </option>
            ))}
          </select>
        )}
      </div>
      <div class="list-body">
        {summaries && sections.total === 0 ? (
          <div class="empty">
            <p class="display">Nothing here yet.</p>
            <p class="lede">
              {phone ? 'Tap' : 'Click'} {commentToolName(phone, talkStatus !== null)}, then anything on the page.{talkStatus ? ` Or ${phone ? 'tap' : 'click'} Talk and just say it.` : ''}
            </p>
            <button type="button" class="button primary" onClick={() => controller.startCommentMode()}>
              <PenIcon size={14} /> Comment
            </button>
          </div>
        ) : (
          <>
            {sections.notes.length > 0 && <Section title={`Notes on v${version?.number}`} comments={sections.notes} me={me} />}
            {sections.placed.length > 0 && <Section title="This page" comments={sections.placed} me={me} />}
            {sections.others.length > 0 && (
              <section class="list-section" aria-labelledby="mostra-other-pages">
                <h3 id="mostra-other-pages" class="section-title">
                  Other pages
                </h3>
                {sections.others.map(([title, comments]) => (
                  <div key={title} class="page-group">
                    <h4 class="page-title">{title}</h4>
                    <Rows comments={comments} me={me} />
                  </div>
                ))}
              </section>
            )}
            {sections.lost.length > 0 && <Section title="Couldn't place on this version" comments={sections.lost} me={me} lost />}
          </>
        )}
      </div>
    </section>
  )
}

function Section({ title, comments, me, lost = false }: { title: string; comments: CommentSummary[]; me: Person; lost?: boolean }) {
  const id = `mostra-section-${title.replace(/\W+/g, '-').toLowerCase()}`
  return (
    <section class="list-section" aria-labelledby={id}>
      <h3 id={id} class="section-title">
        {title} <span class="count">{comments.length}</span>
      </h3>
      <Rows comments={comments} me={me} lost={lost} />
    </section>
  )
}

function Rows({ comments, me, lost = false }: { comments: CommentSummary[]; me: Person; lost?: boolean }) {
  const controller = useController()
  return (
    <ul class="rows">
      {comments.map((comment) => {
        const words = statusWords(comment, me, null)
        const done = comment.status === 'fixed' || comment.status === 'answered'
        return (
          <li key={comment.id} class={lost ? 'lost' : undefined}>
            <button type="button" class="row" onClick={() => void controller.open(comment.number!)}>
              <NumberTag comment={comment} />
              <span class="row-main">
                <span class="row-who">
                  {comment.attribution ? `${comment.attribution.name}, from ${comment.attribution.source}` : displayName(comment.author)}
                  {comment.source === 'spoken' && <MicIcon size={12} />}
                  {comment.talk_id && <span class="visually-hidden">Voice pass</span>}
                  {comment.visibility === 'team' && <span class="team"> · Team only</span>}
                </span>
                <span class="row-text">{lost && typeof comment.anchor?.element_text === 'string' && comment.anchor.element_text ? `"${excerpt(comment.anchor.element_text, 60)}"` : excerpt(plainBody(comment), 90)}</span>
              </span>
              <span class="row-meta">
                {done && <CheckIcon size={12} />}
                {words && comment.status !== 'open' && <span class="sr-status">{words}</span>}
                {comment.reply_count > 0 && <span class="mono">{comment.reply_count}</span>}
              </span>
            </button>
            {lost && (comment.author.id === me.id || me.role === 'builder') && (
              <button type="button" class="text-button repin" onClick={() => controller.startCommentMode(comment.id)}>
                Re-pin
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )
}

const LIST_HEIGHT = 520

function listStyle(toolbar: DOMRect): Record<string, string> {
  const width = Math.min(360, window.innerWidth - 24)
  const center = toolbar.left + toolbar.width / 2
  const left = Math.abs(center - window.innerWidth / 2) < 48 ? center - width / 2 : center > window.innerWidth / 2 ? toolbar.right - width : toolbar.left
  const fromTop = toolbar.top < window.innerHeight / 2
  const room = fromTop ? window.innerHeight - toolbar.bottom - 8 - 12 : toolbar.top - 8 - 12
  return {
    left: `${Math.round(Math.max(12, Math.min(left, window.innerWidth - width - 12)))}px`,
    height: `${Math.round(Math.min(room, window.innerHeight * 0.6, LIST_HEIGHT))}px`,
    ...(fromTop ? { top: `${Math.round(toolbar.bottom + 8)}px` } : { bottom: `${Math.round(window.innerHeight - toolbar.top + 8)}px` }),
  }
}
