import type { Utterance } from '../talk'

export type HeldAudio = { id?: number; talk: string; offset_ms: number; start_ms: number; samples: Int16Array; at: number }

type HeardText = Utterance & { talk: string; moment: number }

export const SPEECH_DATABASE = 'mostra-talk-speech'
const AUDIO = 'audio'
const TEXT = 'text'
export const SPEECH_STORES = [AUDIO, TEXT]
const ABANDONED_MS = 24 * 60 * 60 * 1000
const SAMPLES_PER_MS = 16
const FIRST_MEMORY_ID = 2 ** 40

export function createSpeechStore(target: Window) {
  const memoryAudio: HeldAudio[] = []
  const memoryText: HeardText[] = []
  let opened: IDBDatabase | null = null
  let opening: Promise<IDBDatabase | null> | null = null
  let memoryOnly = false
  let nextMemoryId = FIRST_MEMORY_ID

  function database(): Promise<IDBDatabase | null> {
    opening ??= new Promise((resolve) => {
      try {
        const request = target.indexedDB.open(SPEECH_DATABASE, 1)
        request.onupgradeneeded = () => {
          request.result.createObjectStore(AUDIO, { keyPath: 'id', autoIncrement: true })
          request.result.createObjectStore(TEXT, { autoIncrement: true })
        }
        request.onsuccess = () => resolve((opened = request.result))
        request.onerror = () => resolve(null)
      } catch {
        resolve(null)
      }
    })
    return opening
  }

  function completed(transaction: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
  }

  function walk<Row>(transaction: IDBTransaction, name: string, visit: (row: Row, cursor: IDBCursorWithValue) => void) {
    const request = transaction.objectStore(name).openCursor()
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) return
      visit(cursor.value as Row, cursor)
      cursor.continue()
    }
  }

  function addNow(database: IDBDatabase, row: Omit<HeldAudio, 'id'>): Promise<void> {
    const transaction = database.transaction(AUDIO, 'readwrite')
    transaction.objectStore(AUDIO).add(row)
    return completed(transaction)
  }

  function addToMemory(row: Omit<HeldAudio, 'id'>) {
    memoryAudio.push({ ...row, id: nextMemoryId++ })
  }

  function trimmed(row: HeldAudio, consumedMs: number): HeldAudio {
    return { ...row, start_ms: consumedMs, samples: row.samples.slice(Math.round((consumedMs - row.start_ms) * SAMPLES_PER_MS)) }
  }

  const endOf = (row: HeldAudio) => row.start_ms + row.samples.length / SAMPLES_PER_MS

  return {
    async add(row: Omit<HeldAudio, 'id'>): Promise<void> {
      try {
        const ready = memoryOnly ? null : (opened ?? (await database()))
        if (ready) return await addNow(ready, row)
      } catch {
        memoryOnly = true
      }
      addToMemory(row)
    },

    async next(talk: string, afterId: number): Promise<HeldAudio | null> {
      const ready = await database()
      if (!ready) return memoryAudio.find((row) => row.talk === talk && row.id! > afterId) ?? null
      const stored = await new Promise<HeldAudio | null>((resolve, reject) => {
        const request = ready.transaction(AUDIO).objectStore(AUDIO).openCursor(IDBKeyRange.lowerBound(afterId, true))
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const cursor = request.result
          if (!cursor) return resolve(null)
          if ((cursor.value as HeldAudio).talk === talk) return resolve(cursor.value as HeldAudio)
          cursor.continue()
        }
      })
      return stored ?? memoryAudio.find((row) => row.talk === talk && row.id! > afterId) ?? null
    },

    async settle(talk: string, offsetMs: number, consumedMs: number, heard: Utterance | null): Promise<void> {
      const inStretch = (row: HeldAudio) => row.talk === talk && row.offset_ms === offsetMs
      for (let index = memoryAudio.length - 1; index >= 0; index--) {
        const row = memoryAudio[index]!
        if (!inStretch(row) || row.start_ms >= consumedMs) continue
        if (endOf(row) <= consumedMs) memoryAudio.splice(index, 1)
        else memoryAudio[index] = trimmed(row, consumedMs)
      }
      const ready = await database()
      if (!ready) {
        if (heard) memoryText.push({ ...heard, talk, moment: Date.now() })
        return
      }
      const transaction = ready.transaction([AUDIO, TEXT], 'readwrite')
      if (heard) transaction.objectStore(TEXT).add({ ...heard, talk, moment: Date.now() })
      walk<HeldAudio>(transaction, AUDIO, (row, cursor) => {
        if (!inStretch(row) || row.start_ms >= consumedMs) return
        if (endOf(row) <= consumedMs) cursor.delete()
        else cursor.update(trimmed(row, consumedMs))
      })
      await completed(transaction)
    },

    async spoken(talk: string): Promise<Utterance[]> {
      const ready = await database()
      const stored = ready
        ? await new Promise<HeardText[]>((resolve, reject) => {
            const request = ready.transaction(TEXT).objectStore(TEXT).getAll()
            request.onsuccess = () => resolve(request.result as HeardText[])
            request.onerror = () => reject(request.error)
          })
        : []
      return [...stored, ...memoryText]
        .filter((row) => row.talk === talk)
        .sort((first, second) => first.at_ms - second.at_ms)
        .map(({ at_ms, end_ms, text, words_ms }) => ({ at_ms, text, ...(end_ms === undefined ? {} : { end_ms }), ...(words_ms ? { words_ms } : {}) }))
    },

    async remove(talk: string): Promise<void> {
      await clearWhere((row) => row.talk === talk)
    },

    purgeAbandoned(): Promise<void> {
      return clearWhere((row) => Date.now() - ('at' in row ? row.at : row.moment) > ABANDONED_MS)
    },
  }

  async function clearWhere(matches: (row: HeldAudio | HeardText) => boolean): Promise<void> {
    for (const rows of [memoryAudio, memoryText]) {
      for (let index = rows.length - 1; index >= 0; index--) if (matches(rows[index]!)) rows.splice(index, 1)
    }
    const ready = await database()
    if (!ready) return
    const transaction = ready.transaction([AUDIO, TEXT], 'readwrite')
    for (const name of [AUDIO, TEXT]) {
      walk<HeldAudio | HeardText>(transaction, name, (row, cursor) => {
        if (matches(row)) cursor.delete()
      })
    }
    await completed(transaction)
  }
}

export type SpeechStore = ReturnType<typeof createSpeechStore>
