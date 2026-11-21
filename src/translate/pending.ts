// Words saved while DeepL was unreachable (offline, logged out, quota) get their
// context translation later: on app start, when the device comes back online and
// after the next successful lookup.
import { db } from '../db/schema'
import { translateInContext } from './deepl'

export interface RetryResult {
  done: number
  /** error message of the request that stopped the run */
  failed?: string
}

export function countPendingTranslations(): Promise<number> {
  return db.contexts.filter(c => !!c.deeplPending).count()
}

let running: Promise<RetryResult> | null = null

/** Translates pending contexts one by one and stops at the first failure. Concurrent calls share one run. */
export function retryPendingTranslations(opts: { fetchImpl?: typeof fetch } = {}): Promise<RetryResult> {
  running ??= run(opts.fetchImpl).finally(() => {
    running = null
  })
  return running
}

async function run(fetchImpl?: typeof fetch): Promise<RetryResult> {
  const pending = await db.contexts.filter(c => !!c.deeplPending).toArray()
  let done = 0
  for (const ctx of pending) {
    let translation: string
    try {
      translation = (await translateInContext(ctx.surface, ctx.sentence, { fetchImpl })).translation
    } catch (e) {
      return { done, failed: (e as Error).message }
    }
    await db.transaction('rw', db.contexts, db.terms, async () => {
      const fresh = await db.contexts.get(ctx.id!)
      if (!fresh?.deeplPending) return
      const term = await db.terms.get(fresh.termId)
      // replace the word's translation only while it is still the fallback saved with this context
      if (term && term.translation === (fresh.translation ?? ''))
        await db.terms.update(term.id, { translation, updatedAt: Date.now() })
      await db.contexts.update(fresh.id!, { translation, deeplPending: undefined })
    })
    done++
  }
  return { done }
}
