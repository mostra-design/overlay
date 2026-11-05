import { createContext, type RefObject } from 'preact'
import { useContext, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'preact/hooks'
import type { Controller, MostraState } from '../controller'
import type { Size } from '../placement'

export const ControllerContext = createContext<Controller | null>(null)

export function useController(): Controller {
  const controller = useContext(ControllerContext)
  if (!controller) throw new Error('mostra UI rendered outside of its controller')
  return controller
}

export function useMostraState<Selected>(selector: (state: MostraState) => Selected): Selected {
  const { store } = useController()
  const [, rerender] = useReducer((count: number) => count + 1, 0)
  const selected = selector(store.get())
  const latest = useRef({ selector, selected })
  latest.current = { selector, selected }
  useLayoutEffect(() => {
    const check = () => {
      if (!Object.is(latest.current.selector(store.get()), latest.current.selected)) rerender(0)
    }
    const unsubscribe = store.subscribe(check)
    check()
    return () => void unsubscribe()
  }, [store])
  return selected
}

export function isPhone(view: Window): boolean {
  const width = view.innerWidth
  const coarse = view.matchMedia?.('(pointer: coarse)').matches ?? false
  return width < 640 || (coarse && width < 900)
}

export function usePhone(): boolean {
  const [phone, setPhone] = useState(() => isPhone(window))
  useEffect(() => {
    const update = () => setPhone(isPhone(window))
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  return phone
}

export function viewportSize(view: Window = window): Size {
  return { width: view.document.documentElement.clientWidth || view.innerWidth, height: view.innerHeight }
}

export function useViewportSize(): Size {
  const [size, setSize] = useState(() => viewportSize())
  useEffect(() => {
    const update = () => setSize(viewportSize())
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  return size
}

export function useFrame(active = true): number {
  const [frame, setFrame] = useState(0)
  useEffect(() => {
    if (!active) return
    let pending = 0
    const schedule = () => {
      if (pending) return
      pending = requestAnimationFrame(() => {
        pending = 0
        setFrame((count) => count + 1)
      })
    }
    const options = { capture: true, passive: true }
    window.addEventListener('scroll', schedule, options)
    window.addEventListener('resize', schedule, options)
    window.visualViewport?.addEventListener('resize', schedule)
    window.visualViewport?.addEventListener('scroll', schedule)
    return () => {
      cancelAnimationFrame(pending)
      window.removeEventListener('scroll', schedule, options)
      window.removeEventListener('resize', schedule, options)
      window.visualViewport?.removeEventListener('resize', schedule)
      window.visualViewport?.removeEventListener('scroll', schedule)
    }
  }, [active])
  return frame
}

export function useAutosize(ref: RefObject<HTMLTextAreaElement | null>, value: string, maxHeight: number) {
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${Math.min(element.scrollHeight, maxHeight)}px`
  }, [value, maxHeight])
}

export function useDraft(key: string): [string, (text: string) => void] {
  const controller = useController()
  const [text, setText] = useState(() => controller.drafts.get(key))
  const keyRef = useRef(key)
  useEffect(() => {
    if (keyRef.current === key) return
    keyRef.current = key
    setText(controller.drafts.get(key))
  }, [key])
  return [
    text,
    (next) => {
      setText(next)
      controller.drafts.set(key, next)
    },
  ]
}

export function useFocusOnMount<Target extends HTMLElement>(ref?: RefObject<Target | null>): RefObject<Target | null> {
  const own = useRef<Target>(null)
  const target = ref ?? own
  useEffect(() => {
    target.current?.focus({ preventScroll: true })
  }, [])
  return target
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}
