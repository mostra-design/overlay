export type SafeStorage = {
  get(key: string): string | null
  set(key: string, value: string): void
  remove(key: string): void
}

export function safeStorage(target: Window, kind: 'localStorage' | 'sessionStorage'): SafeStorage {
  const storage = (): Storage | null => {
    try {
      return target[kind]
    } catch {
      return null
    }
  }

  return {
    get(key) {
      try {
        return storage()?.getItem(key) ?? null
      } catch {
        return null
      }
    },
    set(key, value) {
      try {
        storage()?.setItem(key, value)
      } catch {
      }
    },
    remove(key) {
      try {
        storage()?.removeItem(key)
      } catch {
      }
    },
  }
}

export function storageKeys(projectKey: string) {
  const prefix = `mostra:${projectKey}:`
  return {
    token: `${prefix}token`,
    collapsed: `${prefix}collapsed`,
    toolbar: `${prefix}toolbar`,
    shortcuts: `${prefix}shortcuts`,
    player: `${prefix}player`,
    pendingFocus: `${prefix}focus`,
    drafts: `${prefix}drafts`,
    talk: `${prefix}talk`,
  }
}

export type StorageKeys = ReturnType<typeof storageKeys>
