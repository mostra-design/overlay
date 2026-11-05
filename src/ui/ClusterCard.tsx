import { plainBody } from '../comments'
import { displayName } from '../lifecycle'
import { useController, useMostraState } from './hooks'
import { MicIcon } from './icons'
import { useLayout } from './layout'
import { excerpt } from './Marks'
import { CloseButton, NumberTag } from './primitives'

export function ClusterCard({ ids, onSpotlight }: { ids: string[]; onSpotlight: (id: string | null) => void }) {
  const controller = useController()
  const { threads } = useLayout()
  const comments = useMostraState((state) => state.comments)
  const members = ids.flatMap((id) => {
    const comment = comments.get(id) ?? threads.find((thread) => thread.id === id)
    return comment ? [comment] : []
  })
  return (
    <>
      <header class="card-head">
        <h2 id="mostra-card-title" class="card-title">
          {members.length} comments here
        </h2>
        <CloseButton onClick={() => controller.closeCard()} />
      </header>
      <ul class="card-body rows" onPointerLeave={() => onSpotlight(null)}>
        {members.map((comment) => (
          <li key={comment.id}>
            <button type="button" class="row" onClick={() => controller.openThread(comment.id)} onPointerEnter={() => onSpotlight(comment.id)} onFocus={() => onSpotlight(comment.id)} onBlur={() => onSpotlight(null)}>
              <NumberTag comment={comment} />
              <span class="row-main">
                <span class="row-who">
                  {displayName(comment.author)}
                  {comment.source === 'spoken' && <MicIcon size={12} />}
                </span>
                <span class="row-text">{excerpt(plainBody(comment), 90)}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
  )
}
