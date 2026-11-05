import { useRef, useState } from 'preact/hooks'
import { plainBody } from '../comments'
import type { Card } from '../controller'
import { displayName } from '../lifecycle'
import { documentTitle } from '../page-url'
import { narrower, wider } from '../picker'
import { useClickAway } from './CommentMode'
import { useAutosize, useController, useDraft, useFocusOnMount, useMostraState } from './hooks'
import { useLayout } from './layout'
import { excerpt } from './Marks'
import { CloseButton, isSendKey, NumberTag } from './primitives'

type ComposerCard = Extract<Card, { type: 'composer' }>

export function Composer({ card }: { card: ComposerCard }) {
  const controller = useController()
  const { tracker, threads, phone } = useLayout()
  const me = useMostraState((state) => state.me)
  const [body, setBody] = useDraft(card.draftKey)
  const [suggestion, setSuggestion] = useState<string | null>(null)
  const [team, setTeam] = useState(false)
  const [name, setName] = useState('')
  const field = useRef<HTMLTextAreaElement>(null)
  useAutosize(field, body, phone ? 160 : 220)
  useFocusOnMount(field)
  useClickAway(() => {
    if (!body.trim() && suggestion === null) controller.closeCard()
  })
  if (!me) return null

  const { target } = card
  const needsName = !me.display_name
  const ready = body.trim().length > 0 && (!needsName || name.trim().length > 0)
  const here = target.kind === 'element' ? threads.filter((thread) => thread.number !== null && tracker.element(thread.id) === target.element) : []
  const title = target.kind === 'page' ? `On this page (${documentTitle(document) || 'this page'})` : `On ${target.anchor.label ?? 'this element'}`

  const send = () => {
    if (!ready) return
    void controller.createComment({ body: body.trim(), suggestedText: suggestion, visibility: team ? 'team' : 'everyone', name: needsName ? name.trim() : null })
  }
  const walk = (next: Element | null, trail: Element[]) => {
    if (next) controller.retarget(next, trail)
  }

  return (
    <>
      <header class="card-head">
        <h2 id="mostra-card-title" class="card-title" title={title}>
          {title}
        </h2>
        {!phone && target.kind === 'element' && (
          <span class="walk">
            <button type="button" class="text-button" onClick={() => walk(wider(target.element), [...target.trail, target.element])} disabled={!wider(target.element)}>
              Wider
            </button>
            <button type="button" class="text-button" onClick={() => walk(narrower(target.element, target.trail), target.trail)} disabled={!narrower(target.element, target.trail)}>
              Narrower
            </button>
          </span>
        )}
        <CloseButton onClick={() => controller.closeCard()} />
      </header>
      {phone && target.kind === 'element' && (
        <div class="walk-row">
          <button type="button" class="button secondary" onClick={() => walk(wider(target.element), [...target.trail, target.element])} disabled={!wider(target.element)}>
            Wider
          </button>
          <button type="button" class="button secondary" onClick={() => walk(narrower(target.element, target.trail), target.trail)} disabled={!narrower(target.element, target.trail)}>
            Narrower
          </button>
        </div>
      )}
      <div class="card-body">
        {here.length > 0 && (
          <ul class="already" aria-label="Already on this element">
            {here.map((thread) => (
              <li key={thread.id}>
                <button type="button" class="already-row" onClick={() => controller.openThread(thread.id)}>
                  <NumberTag comment={thread} />
                  <span class="already-who">{displayName(thread.author)}</span>
                  <span class="already-text">{excerpt(plainBody(thread), 60)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {needsName && (
          <label class="field">
            <span class="field-label">Your name</span>
            <input class="input" value={name} maxLength={60} autoComplete="name" onInput={(event) => setName(event.currentTarget.value)} />
          </label>
        )}
        <textarea
          ref={field}
          class="input compose"
          rows={phone ? 2 : 3}
          value={body}
          placeholder={here.length > 0 ? 'Or add a new comment' : 'Write a comment'}
          aria-label="Comment"
          data-autofocus
          onInput={(event) => setBody(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (isSendKey(event, phone)) {
              event.preventDefault()
              send()
            }
          }}
        />
        {target.kind === 'selection' && suggestion !== null && (
          <label class="field">
            <span class="field-label">New text</span>
            <textarea class="input" rows={2} value={suggestion} onInput={(event) => setSuggestion(event.currentTarget.value)} />
          </label>
        )}
        <div class="compose-foot">
          <span class="chips">
            {target.kind === 'selection' && suggestion === null && (
              <button type="button" class="chip-button" onClick={() => setSuggestion(target.anchor.text_quote?.exact ?? '')}>
                Suggest new text
              </button>
            )}
            {me.role === 'builder' && (
              <button type="button" class={`chip-button${team ? ' pressed' : ''}`} aria-pressed={team} onClick={() => setTeam(!team)}>
                Team only
              </button>
            )}
          </span>
          {!phone && <span class="hint">Enter to send</span>}
          <button type="button" class="button primary" disabled={!ready} onClick={send}>
            Send
          </button>
        </div>
      </div>
    </>
  )
}
