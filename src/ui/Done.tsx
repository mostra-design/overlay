import { useState } from 'preact/hooks'
import type { VerdictValue } from '../protocol'
import { useController, useDraft, useMostraState } from './hooks'
import { CloseButton, VerdictBadge } from './primitives'

export function DoneCard({ checked }: { checked: number | null }) {
  const controller = useController()
  const version = useMostraState((state) => state.version)
  const verdict = useMostraState((state) => state.verdict)
  const me = useMostraState((state) => state.me)
  const invite = useMostraState((state) => state.invite)
  const project = useMostraState((state) => state.project)
  const summaries = useMostraState((state) => state.summaries)
  const [note, setNote] = useDraft('verdict')
  const [changing, setChanging] = useState(false)
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState<VerdictValue | null>(null)
  if (!me) return null

  const builder = invite?.from_name ?? null
  const team = builder ? `${builder}'s team` : `the ${project?.name ?? ''} team`
  const close = <CloseButton onClick={() => controller.closeCard()} />

  if (!version) {
    return (
      <>
        <span class="card-close">{close}</span>
        <div class="card-body notice">
          <h2 id="mostra-card-title" class="display">This site doesn't report a version.</h2>
          <p class="lede">Add data-version to get versions, verdicts and Check fixes.</p>
        </div>
      </>
    )
  }

  const mine = summaries ? Array.from(summaries.values()).filter((comment) => comment.author.id === me.id && comment.page_url !== null && comment.version?.id === version.id).length : null

  if (sent && verdict) {
    return (
      <>
        <span class="card-close">{close}</span>
        <div class="card-body notice">
          <VerdictBadge verdict={verdict} />
          <h2 id="mostra-card-title" class="display" aria-live="polite">
            Thanks.
          </h2>
        </div>
      </>
    )
  }

  if (verdict && !changing) {
    return (
      <>
        <span class="card-close">{close}</span>
        <div class="card-body notice">
          <VerdictBadge verdict={verdict} />
          <h2 id="mostra-card-title" class="display">
            You {verdict.verdict === 'approved' ? 'approved' : 'requested changes on'} v{verdict.version.number}.
          </h2>
          {verdict.note && <blockquote class="quote">{verdict.note}</blockquote>}
          <div class="row-actions start">
            <button type="button" class="button secondary" onClick={() => setChanging(true)}>
              Change verdict
            </button>
            <button type="button" class="button ghost" onClick={() => void controller.setVerdict(null, '')}>
              Withdraw verdict
            </button>
          </div>
        </div>
      </>
    )
  }

  const give = async (value: VerdictValue) => {
    setBusy(value)
    try {
      await controller.setVerdict(value, note)
      setSent(true)
      setChanging(false)
    } catch {
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <span class="card-close">{close}</span>
      <div class="card-body notice">
        {checked !== null && <p class="eyebrow">That's all {checked}.</p>}
        <h2 id="mostra-card-title" class="display">
          How does v{version.number} look?
        </h2>
        <textarea class="input" rows={2} value={note} placeholder="Add a note (optional)" aria-label="Add a note (optional)" onInput={(event) => setNote(event.currentTarget.value)} />
        <div class="choices">
          <button type="button" class="choice" disabled={busy !== null} onClick={() => void give('approved')}>
            <span class="choice-label approve">Approve</span>
            <span class="choice-note">Tells {builder ?? 'the team'} this version is ready.</span>
          </button>
          <button type="button" class="choice" disabled={busy !== null} onClick={() => void give('changes_requested')}>
            <span class="choice-label changes">Request changes</span>
            <span class="choice-note">{builder ?? 'The team'} will ask you to look again on a newer version.</span>
          </button>
        </div>
        {mine !== null && mine > 0 && (
          <p class="aside">
            Your {mine} {mine === 1 ? 'comment is' : 'comments are'} already with {team}.
          </p>
        )}
      </div>
    </>
  )
}
