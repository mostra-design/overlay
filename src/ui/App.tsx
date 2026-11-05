import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import type { Controller } from '../controller'
import { isEditable, keyAction, type KeyAction } from '../keyboard'
import { nearestFree, screenArea } from '../placement'
import { narrower, nextNavigable, wider } from '../picker'
import { Card } from './Card'
import { CommentMode, isOwnElement, isOwnEvent, sameRange, SelectionChip, useClickAway, useSelection } from './CommentMode'
import { ControllerContext, useController, useMostraState } from './hooks'
import { LayoutProvider, useLayout, useSurfaceChanges } from './layout'
import { List } from './List'
import { Marks } from './Marks'
import { Toolbar } from './Toolbar'

export function App({ controller }: { controller: Controller }) {
  return (
    <ControllerContext.Provider value={controller}>
      <LayoutProvider>
        <Overlay />
      </LayoutProvider>
    </ControllerContext.Provider>
  )
}

function Overlay() {
  const controller = useController()
  const { phone } = useLayout()
  const hidden = useMostraState((state) => state.hidden)
  const mode = useMostraState((state) => state.mode)
  const list = useMostraState((state) => state.list)
  const card = useMostraState((state) => state.card)
  const selection = useSelection()
  const onKeyDown = useKeyboard(selection)
  const [turnedDown, setTurnedDown] = useState<Range | null>(null)
  useClickAway(
    () => controller.clickAway(),
    () => {
      controller.toggleMenu(false)
      setTurnedDown(selection)
    },
  )

  useEffect(() => {
    const timer = setTimeout(() => void controller.loadSummaries(), 400)
    return () => clearTimeout(timer)
  }, [])

  return (
    <div class="mostra-ui" onKeyDown={onKeyDown}>
      {!hidden && <Marks />}
      {!hidden && <CommentMode />}
      {!hidden && !phone && selection && !sameRange(selection, turnedDown) && !mode && card?.type !== 'composer' && <SelectionChip range={selection} />}
      {!hidden && <Card />}
      {!hidden && list && <List />}
      <Toasts />
      <Toolbar />
      <LiveRegion />
    </div>
  )
}

function useKeyboard(selection: Range | null) {
  const controller = useController()
  const { toolbar } = useLayout()
  const selectionRef = useRef(selection)
  selectionRef.current = selection

  const handle = (event: KeyboardEvent) => {
    const state = controller.store.get()
    const action = keyAction(event, {
      editing: isEditable(event.composedPath()[0]),
      singleKeys: state.singleKeys,
      commenting: state.mode !== null,
      stepping: state.card !== null || state.list || state.stepper !== null,
      selection: selectionRef.current !== null,
      open: state.card !== null || state.list || state.mode !== null || state.menu || state.stepper !== null,
      talk: state.talkStatus !== null,
    })
    if (!action) return
    event.preventDefault()
    perform(action)
  }

  function perform(action: KeyAction) {
    const state = controller.store.get()
    const aim = state.aim
    switch (action) {
      case 'comment':
        if (state.hidden) controller.setHidden(false)
        if (state.mode) controller.stopCommentMode()
        else controller.startCommentMode()
        return
      case 'comment-selection':
        if (selectionRef.current) controller.pickSelection(selectionRef.current)
        return
      case 'talk':
        void controller.toggleTalk()
        return
      case 'list':
        controller.toggleList()
        return
      case 'hide':
        controller.setHidden(!state.hidden)
        return
      case 'shortcuts':
        if (state.card?.type === 'shortcuts') controller.closeCard()
        else controller.openShortcuts()
        return
      case 'next':
      case 'previous':
        void controller.step(action === 'next' ? 1 : -1)
        return
      case 'focus-toolbar':
        toolbar.current?.querySelector<HTMLElement>('button:not([disabled])')?.focus()
        return
      case 'back':
        if (state.menu) controller.toggleMenu(false)
        else if (state.card) controller.closeCard()
        else if (state.list) controller.toggleList(false)
        else if (state.mode) controller.stopCommentMode()
        else if (state.stepper) controller.stopStepper()
        return
      case 'wider':
        if (aim) {
          const parent = wider(aim.element)
          if (parent) controller.aimAt(parent, [...aim.trail, aim.element])
        }
        return
      case 'narrower':
        if (aim) {
          const child = narrower(aim.element, aim.trail)
          if (child) controller.aimAt(child, aim.trail)
        }
        return
      case 'pick':
        if (aim) {
          const box = aim.element.getBoundingClientRect()
          controller.pick(aim.element, { x: box.left + box.width / 2, y: box.top + box.height / 2 })
        }
        return
      case 'focus-next':
      case 'focus-previous': {
        const next = nextNavigable(document, aim?.element ?? null, action === 'focus-next' ? 1 : -1, isOwnElement)
        if (next) {
          next.scrollIntoView({ block: 'nearest', inline: 'nearest' })
          controller.aimAt(next)
        }
        return
      }
    }
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isOwnEvent(event)) handle(event)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return handle
}

const TOAST_WIDTH = 320

function Toasts() {
  const controller = useController()
  const { toolbar, surfaces } = useLayout()
  const toasts = useMostraState((state) => state.toasts)
  const stack = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(48)
  useSurfaceChanges()
  useLayoutEffect(() => {
    surfaces.set('toasts', stack.current)
    if (stack.current) setHeight(stack.current.offsetHeight)
  }, [toasts.length])
  if (toasts.length === 0) return null
  const rect = toolbar.current?.getBoundingClientRect()
  const viewport = { width: window.innerWidth, height: window.innerHeight }
  const fromTop = rect ? rect.top < viewport.height / 2 : false
  const wanted = rect
    ? { left: rect.left, top: fromTop ? rect.bottom + 8 : rect.top - 8 - height, width: TOAST_WIDTH, height }
    : { left: 12, top: viewport.height - 12 - height, width: TOAST_WIDTH, height }
  const spot = nearestFree(wanted, screenArea(viewport), surfaces.boxes('toolbar', 'pages', 'menu', 'ticks', 'card', 'list')) ?? wanted
  return (
    <div ref={stack} class="layer toasts" style={{ left: `${Math.round(spot.left)}px`, top: `${Math.round(spot.top)}px`, width: `${TOAST_WIDTH}px` }}>
      {toasts.map((toast) => (
        <div key={toast.id} class={`toast ${toast.tone}`} role={toast.tone === 'error' ? 'alert' : 'status'}>
          <span>{toast.message}</span>
          {toast.undo && (
            <>
              <span class="sep" aria-hidden="true">
                ·
              </span>
              <button
                type="button"
                class="toast-action"
                onClick={() => {
                  toast.undo?.()
                  controller.dismissToast(toast.id)
                }}
              >
                Undo
              </button>
            </>
          )}
        </div>
      ))}
    </div>
  )
}

function LiveRegion() {
  const announcement = useMostraState((state) => state.announcement)
  return (
    <div class="visually-hidden" aria-live="polite" aria-atomic="true">
      {announcement && <span key={announcement.nonce}>{announcement.text}</span>}
    </div>
  )
}
