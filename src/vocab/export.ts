import { db, type CardRow, type Context, type ReviewLogRow, type Setting, type Term } from '../db/schema'

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

export interface Backup {
  app: 'vokabel-reader'
  version: 1
  exportedAt: string
  terms: Term[]
  contexts: Context[]
  cards: CardRow[]
  reviewLogs: ReviewLogRow[]
  settings: Setting[]
}

export async function backupJson(): Promise<string> {
  const backup: Backup = {
    app: 'vokabel-reader',
    version: 1,
    exportedAt: new Date().toISOString(),
    terms: await db.terms.toArray(),
    contexts: await db.contexts.toArray(),
    cards: await db.cards.toArray(),
    reviewLogs: await db.reviewLogs.toArray(),
    settings: (await db.settings.toArray()).filter(s => s.key !== 'enrichBatch'),
  }
  return JSON.stringify(backup)
}

/** Merges a backup into the database (books are not part of backups). */
export async function restoreBackup(text: string): Promise<{ terms: number }> {
  const data = JSON.parse(text) as Partial<Backup>
  if (data.app !== 'vokabel-reader' || !Array.isArray(data.terms)) throw new Error('Keine gültige Sicherungsdatei')
  const reviveCard = (c: CardRow): CardRow => ({
    ...c,
    fsrs: { ...c.fsrs, due: new Date(c.fsrs.due), last_review: c.fsrs.last_review ? new Date(c.fsrs.last_review) : undefined },
  })
  await db.transaction('rw', [db.terms, db.contexts, db.cards, db.reviewLogs, db.settings], async () => {
    await db.terms.bulkPut(data.terms!)
    if (data.contexts) {
      const existing = new Set((await db.contexts.toArray()).map(c => `${c.termId}\u0000${c.sentence}`))
      await db.contexts.bulkAdd(
        data.contexts.filter(c => !existing.has(`${c.termId}\u0000${c.sentence}`)).map(({ id: _id, ...c }) => c),
      )
    }
    if (data.cards) await db.cards.bulkPut(data.cards.map(reviveCard))
    if (data.reviewLogs) {
      const seen = new Set((await db.reviewLogs.toArray()).map(l => `${l.cardId}\u0000${l.reviewedAt}`))
      await db.reviewLogs.bulkAdd(
        data.reviewLogs.filter(l => !seen.has(`${l.cardId}\u0000${l.reviewedAt}`)).map(({ id: _id, ...l }) => l),
      )
    }
    if (data.settings) await db.settings.bulkPut(data.settings)
  })
  return { terms: data.terms.length }
}
