import { useEffect } from 'preact/hooks'
import { useController, useMostraState } from './hooks'
import { useLayout } from './layout'
import { CloseButton } from './primitives'
import { commentToolName } from './Toolbar'

export function WelcomeCard() {
  const controller = useController()
  const { phone } = useLayout()
  const invite = useMostraState((state) => state.invite)
  const project = useMostraState((state) => state.project)
  const talkStatus = useMostraState((state) => state.talkStatus)
  useFoldOnScroll(() => controller.dismissNotice())
  const verb = phone ? 'Tap' : 'Click'
  const name = project?.name ?? 'this site'
  return (
    <>
      <span class="card-close">
        <CloseButton onClick={() => controller.dismissNotice()} />
      </span>
      <div class="card-body notice">
        <h2 id="mostra-card-title" class="display">
          {invite?.from_name ? `${invite.from_name} asked for your review of ${name}` : `You're invited to review ${name}`}
        </h2>
        {invite?.note && <blockquote class="quote note">{invite.note}</blockquote>}
        <p class="lede">
          {verb} {commentToolName(phone, talkStatus !== null)}, then anything on the page. {verb} Done when you've seen enough.
        </p>
        <div class="row-actions start">
          <button type="button" class="button primary" onClick={() => controller.dismissNotice()}>
            Start
          </button>
        </div>
      </div>
    </>
  )
}

export function CatchUpCard() {
  const controller = useController()
  const catchUp = useMostraState((state) => state.catchUp)
  const toCheck = catchUp.to_check.length
  const replied = catchUp.replied.length
  return (
    <>
      <span class="card-close">
        <CloseButton label="Not now" onClick={() => controller.dismissNotice()} />
      </span>
      <div class="card-body notice">
        {toCheck > 0 ? (
          <>
            <h2 id="mostra-card-title" class="display">
              Updated since you last looked.
            </h2>
            <p class="lede">
              {toCheck} of your comments {toCheck === 1 ? 'was' : 'were'} fixed or answered.
            </p>
            <div class="row-actions start">
              <button type="button" class="button primary" onClick={() => void controller.checkFixes()}>
                Check them
              </button>
              <button type="button" class="button ghost" onClick={() => controller.dismissNotice()}>
                Not now
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 id="mostra-card-title" class="display">
              {replied} new {replied === 1 ? 'reply' : 'replies'} on your comments.
            </h2>
            <div class="row-actions start">
              <button type="button" class="button primary" onClick={() => void controller.showReplies()}>
                Show
              </button>
            </div>
          </>
        )}
      </div>
    </>
  )
}

const TALK_SHORTCUT: [string, string] = ['T', 'Talk, or stop talking']

const SHORTCUTS: Array<[string, string]> = [
  ['C', 'Comment; with text selected, comment on it'],
  ['L', 'Open or close the list'],
  ['H', 'Hide or show comments'],
  ['J / K', 'Next or previous comment'],
  ['?', 'These shortcuts'],
  ['Esc', 'Back one step'],
  ['Alt Shift M', 'Move focus to the toolbar'],
]

const COMMENT_MODE: Array<[string, string]> = [
  ['↑ / ↓', 'Wider or narrower element'],
  ['Tab', 'Next element, heading or landmark'],
  ['Enter', 'Comment on it'],
]

export function ShortcutsCard() {
  const controller = useController()
  const singleKeys = useMostraState((state) => state.singleKeys)
  const talkStatus = useMostraState((state) => state.talkStatus)
  const shortcuts = talkStatus ? [SHORTCUTS[0]!, TALK_SHORTCUT, ...SHORTCUTS.slice(1)] : SHORTCUTS
  return (
    <>
      <span class="card-close">
        <CloseButton onClick={() => controller.closeCard()} />
      </span>
      <div class="card-body notice">
        <h2 id="mostra-card-title" class="display small">
          Keyboard shortcuts
        </h2>
        <dl class="keys">
          {shortcuts.map(([key, action]) => (
            <div key={key} class={`key-row${!singleKeys && key.length === 1 ? ' off' : ''}`}>
              <dt>
                <kbd>{key}</kbd>
              </dt>
              <dd>{action}</dd>
            </div>
          ))}
        </dl>
        <p class="eyebrow">In comment mode</p>
        <dl class="keys">
          {COMMENT_MODE.map(([key, action]) => (
            <div key={key} class="key-row">
              <dt>
                <kbd>{key}</kbd>
              </dt>
              <dd>{action}</dd>
            </div>
          ))}
        </dl>
        <label class="toggle">
          <input type="checkbox" checked={singleKeys} onChange={(event) => controller.setSingleKeys(event.currentTarget.checked)} />
          <span>Single-key shortcuts</span>
        </label>
      </div>
    </>
  )
}

function useFoldOnScroll(fold: () => void) {
  useEffect(() => {
    const start = window.scrollY
    const onScroll = () => {
      if (Math.abs(window.scrollY - start) > 48) fold()
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
}
