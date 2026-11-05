export type Store<State> = {
  get(): State
  update(changes: Partial<State> | ((state: State) => Partial<State>)): void
  subscribe(listener: () => void): () => void
}

export function createStore<State extends object>(initial: State): Store<State> {
  let state = initial
  const listeners = new Set<() => void>()
  return {
    get: () => state,
    update(changes) {
      state = { ...state, ...(typeof changes === 'function' ? changes(state) : changes) }
      for (const listener of listeners) listener()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
