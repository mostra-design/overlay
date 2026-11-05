import { render } from 'preact'
import type { JoinProblem } from '../api'
import type { Theme } from '../config'
import { isPhone } from './hooks'
import { createHost } from './mount'
import { CloseButton } from './primitives'

export function showJoinProblem(target: Window, theme: Theme | null, problem: JoinProblem, onClose: () => void) {
  const host = createHost(target.document, theme)
  const close = () => {
    target.removeEventListener('keydown', onKey)
    host.destroy()
    onClose()
  }
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && !event.defaultPrevented) close()
  }
  target.addEventListener('keydown', onKey)
  const phone = isPhone(target)
  render(
    <div class={phone ? 'layer sheet notice-sheet' : 'layer card docked notice-card'} role="alertdialog" aria-modal="false" aria-labelledby="mostra-card-title" aria-describedby="mostra-card-detail">
      <span class="card-close">
        <CloseButton onClick={close} />
      </span>
      <div class="card-body notice">
        <h2 id="mostra-card-title" class="display">
          {headline(problem)}
        </h2>
        <p id="mostra-card-detail" class="lede">
          {detail(problem)}
        </p>
      </div>
    </div>,
    host.root,
  )
}

function headline(problem: JoinProblem): string {
  switch (problem.reason) {
    case 'expired':
      return 'This link has expired.'
    case 'revoked':
      return 'This link was turned off.'
    case 'unknown_project':
      return "This site's mostra tag doesn't match any project."
    default:
      return "This link doesn't work."
  }
}

function detail(problem: JoinProblem): string {
  switch (problem.reason) {
    case 'unknown_project':
      return 'Copy the tag from Setup in the dashboard, or pass this on to whoever invited you.'
    default:
      return problem.fromName ? `Ask ${problem.fromName} for a new one.` : 'Ask the person who sent it for a new one.'
  }
}
