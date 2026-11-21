import {
  db,
  STATUS_IGNORED,
  STATUS_KNOWN,
  type CardRow,
  type Context,
  type ReviewLogRow,
  type Setting,
  type Term,
  type Tombstone,
} from '../db/schema'
import { LOCAL_SETTING_KEYS } from '../settings/settings'

export function toCsv(rows: (string | number | undefined | null)[][]): string {
  const cell = (v: string | number | undefined | null) => {
    const s = v === undefined || v === null ? '' : String(v)
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return rows.map(r => r.map(cell).join(',')).join('\n') + '\n'
}

export function download(filename: string, content: string, mime = 'text/plain') {
  const url = URL.createObjectURL(new Blob([content], { type: `${mime};charset=utf-8` }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const iso = (ms?: number) => (ms ? new Date(ms).toISOString() : '')

export async function vocabCsv(): Promise<string> {
  const terms = await db.terms.toArray()
  const contexts = await db.contexts.toArray()
  const first = new Map<string, Context>()
  for (const c of contexts.sort((a, b) => a.createdAt - b.createdAt)) if (!first.has(c.termId)) first.set(c.termId, c)
  return toCsv([
    ['lemma', 'translation', 'pos', 'status', 'explanation', 'example', 'ipa', 'mnemonic', 'sentence', 'book', 'created'],
    ...terms.map(t => {
      const c = first.get(t.id)
      return [t.lemma, t.translation, t.pos, t.status, t.explanationDe, t.exampleEn, t.ipa, t.mnemonic, c?.sentence, c?.bookTitle, iso(t.createdAt)]
    }),
  ])
}

/** One row per review, e.g. for forgetting curves in R. */
export async function reviewLogCsv(): Promise<string> {
  const logs = await db.reviewLogs.orderBy('reviewedAt').toArray()
  return toCsv([
    ['reviewed_at', 'term', 'card_type', 'rating', 'state_before', 'scheduled_days', 'stability', 'difficulty', 'answer_ms'],
    ...logs.map(l => [iso(l.reviewedAt), l.termId, l.cardType, l.rating, l.state, l.scheduledDays, l.stability.toFixed(3), l.difficulty.toFixed(3), l.answerMs]),
  ])
}

/** Reading position of a book; book ids come from the file content, so they match across devices. */
export interface BookProgress {
  id: string
  lastLocation?: string
  progress?: number
  progressAt: number
}

export interface Backup {
  app: 'vokabel-reader'
  version: 1
  exportedAt: string
  terms: Term[]
  contexts: Context[]
  cards: CardRow[]
  reviewLogs: ReviewLogRow[]
  settings: Setting[]
  /** deleted words, so that a merge does not bring them back (optional: older backups lack it) */
  tombstones?: Tombstone[]
  /** reading positions (optional: older backups lack it) */
  bookProgress?: BookProgress[]
}

export async function backupJson(): Promise<string> {
  const bookProgress: BookProgress[] = []
  await db.books.each(b => {
    if (b.lastLocation)
      bookProgress.push({ id: b.id, lastLocation: b.lastLocation, progress: b.progress, progressAt: b.progressAt ?? 0 })
  })
  const backup: Backup = {
    app: 'vokabel-reader',
    version: 1,
    exportedAt: new Date().toISOString(),
    terms: await db.terms.toArray(),
    contexts: await db.contexts.toArray(),
    cards: await db.cards.toArray(),
    reviewLogs: await db.reviewLogs.toArray(),
    settings: (await db.settings.toArray()).filter(s => !LOCAL_SETTING_KEYS.has(s.key)),
    tombstones: await db.tombstones.toArray(),
    bookProgress,
  }
  return JSON.stringify(backup)
}

/** Parses and checks a backup file (also the Drive sync file). */
export function parseBackup(text: string): Partial<Backup> & { terms: Term[] } {
  let data: Partial<Backup>
  try {
    data = JSON.parse(text) as Partial<Backup>
  } catch {
    throw new Error('Keine gültige Sicherungsdatei')
  }
  if (data?.app !== 'vokabel-reader' || !Array.isArray(data.terms)) throw new Error('Keine gültige Sicherungsdatei')
  return data as Partial<Backup> & { terms: Term[] }
}

export interface MergeStats {
  /** words in the backup */
  terms: number
  /** words new on this device */
  added: number
  /** words replaced by a newer version from the backup */
  updated: number
  /** words removed because they were deleted elsewhere */
  removed: number
}

const reviveCard = (c: CardRow): CardRow => ({
  ...c,
  fsrs: { ...c.fsrs, due: new Date(c.fsrs.due), last_review: c.fsrs.last_review ? new Date(c.fsrs.last_review) : undefined },
})

const reviewedAt = (c: CardRow) => (c.fsrs.last_review ? new Date(c.fsrs.last_review).getTime() : 0)

/** true if card `a` has seen more learning than `b` (later review, then more repetitions) */
const isNewerCard = (a: CardRow, b: CardRow) =>
  reviewedAt(a) !== reviewedAt(b) ? reviewedAt(a) > reviewedAt(b) : a.fsrs.reps > b.fsrs.reps

/**
 * Merges a backup into the database without losing newer local data: the newer word
 * (`updatedAt`) and the further learned card win, contexts and reviews are combined,
 * words deleted on either side stay deleted unless changed after the deletion.
 * Books are not part of backups, only their reading positions.
 */
export async function mergeBackup(data: Partial<Backup> & { terms: Term[] }, opts: { settings?: boolean } = {}): Promise<MergeStats> {
  const stats: MergeStats = { terms: data.terms.length, added: 0, updated: 0, removed: 0 }
  const tables = [db.terms, db.contexts, db.cards, db.reviewLogs, db.settings, db.tombstones, db.books]
  await db.transaction('rw', tables, async () => {
    // deletions from both sides; the later one counts
    const deletedAt = new Map((await db.tombstones.toArray()).map(t => [t.id, t.at]))
    for (const t of data.tombstones ?? [])
      if (!(deletedAt.get(t.id)! >= t.at)) {
        deletedAt.set(t.id, t.at)
        await db.tombstones.put(t)
      }
    const local = new Map((await db.terms.toArray()).map(t => [t.id, t]))
    const incoming = new Map(data.terms.map(t => [t.id, t]))
    const deadIds = new Set<string>()
    for (const id of new Set([...local.keys(), ...incoming.keys()])) {
      const mine = local.get(id)
      const theirs = incoming.get(id)
      const winner = mine && (!theirs || mine.updatedAt >= theirs.updatedAt) ? mine : theirs!
      // deleted after its last change on either device
      if ((deletedAt.get(id) ?? -Infinity) >= winner.updatedAt) {
        deadIds.add(id)
        if (mine) {
          stats.removed++
          local.delete(id)
          await db.terms.delete(id)
          await db.contexts.where('termId').equals(id).delete()
          await db.cards.where('termId').equals(id).delete()
          await db.reviewLogs.where('termId').equals(id).delete()
        }
        continue
      }
      if (winner === mine) continue
      await db.terms.put(winner)
      local.set(id, winner)
      if (mine) stats.updated++
      else stats.added++
    }
    const alive = (termId: string) => !deadIds.has(termId)

    if (data.contexts) {
      const existing = new Map((await db.contexts.toArray()).map(c => [`${c.termId}\u0000${c.sentence}`, c]))
      const fresh: Context[] = []
      for (const { id: _id, ...c } of data.contexts) {
        if (!alive(c.termId)) continue
        const mine = existing.get(`${c.termId}\u0000${c.sentence}`)
        if (!mine) fresh.push(c)
        // saved offline here, translated by DeepL on the other device
        else if (mine.deeplPending && !c.deeplPending && c.translation)
          await db.contexts.update(mine.id!, { translation: c.translation, deeplPending: undefined })
      }
      await db.contexts.bulkAdd(fresh)
    }

    if (data.cards) {
      const mine = new Map((await db.cards.toArray()).map(c => [c.id, c]))
      const winners = data.cards.map(reviveCard).filter(c => alive(c.termId) && (!mine.has(c.id) || isNewerCard(c, mine.get(c.id)!)))
      await db.cards.bulkPut(winners)
    }
    // cards are suspended exactly when their word is ignored or known
    await db.cards.toCollection().modify(c => {
      const term = local.get(c.termId)
      if (!term) return
      const suspended = term.status === STATUS_IGNORED || term.status === STATUS_KNOWN
      if (!!c.suspended !== suspended) c.suspended = suspended
    })

    if (data.reviewLogs) {
      const seen = new Set((await db.reviewLogs.toArray()).map(l => `${l.cardId}\u0000${l.reviewedAt}`))
      await db.reviewLogs.bulkAdd(
        data.reviewLogs.filter(l => alive(l.termId) && !seen.has(`${l.cardId}\u0000${l.reviewedAt}`)).map(({ id: _id, ...l }) => l),
      )
    }

    for (const p of data.bookProgress ?? []) {
      const book = await db.books.get(p.id)
      if (book && p.lastLocation && p.progressAt > (book.progressAt ?? 0))
        await db.books.update(p.id, { lastLocation: p.lastLocation, progress: p.progress, progressAt: p.progressAt })
    }

    if (opts.settings !== false && data.settings) await db.settings.bulkPut(data.settings.filter(s => !LOCAL_SETTING_KEYS.has(s.key)))
  })
  return stats
}

/** Merges a backup file into the database (books are not part of backups). */
export async function restoreBackup(text: string): Promise<{ terms: number }> {
  const stats = await mergeBackup(parseBackup(text))
  return { terms: stats.terms }
}
