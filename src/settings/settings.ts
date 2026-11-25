import { useLiveQuery } from 'dexie-react-hooks'
import { db, type CardType, type HighlightColor } from '../db/schema'
import type { ReaderMode } from '../reader/modes'
import { DEFAULT_GEMINI_MODEL } from '../enrich/gemini'

/** when DeepL is asked without a tap on "+ DeepL" (cached translations always show) */
export type DeeplMode = 'manual' | 'fallback' | 'always'

export interface AppSettings {
  /** sent as X-App-Token to /api/translate */
  appToken: string
  /** this device's own DeepL key, sent as x-deepl-key; empty = the server's key */
  deeplKey: string
  /** this device's own Gemini API key (free tier); empty = no live AI */
  geminiKey: string
  /** Gemini model for "Mit Gemini anreichern" */
  geminiModel: string
  /** manual: only on "+ DeepL"; fallback: words without a dictionary entry; always: words and passages */
  deeplMode: DeeplMode
  /** save every lookup to the vocabulary without asking */
  autoSave: boolean
  /** card types created for new words */
  cardTypes: CardType[]
  newCardsPerDay: number
  /** words per "Mit Claude anreichern" batch */
  enrichBatchSize: number
  readerFontScale: number
  /** what a tap in the book does (per device) */
  readerMode: ReaderMode
  /** color for the next mark */
  highlightColor: HighlightColor
}

export const DEFAULT_SETTINGS: AppSettings = {
  appToken: '',
  deeplKey: '',
  geminiKey: '',
  geminiModel: DEFAULT_GEMINI_MODEL,
  deeplMode: 'manual',
  autoSave: false,
  cardTypes: ['en-de', 'cloze'],
  newCardsPerDay: 20,
  enrichBatchSize: 30,
  readerFontScale: 1,
  readerMode: 'translate',
  highlightColor: 'yellow',
}

/**
 * Rows in db.settings that belong to this device only: never part of a backup and
 * never overwritten by one (open enrichment batch, Google Drive connection, reader mode:
 * reading on the tablet, translating on the desktop is fine; own DeepL and Gemini keys: secrets,
 * never written to a backup file or Google Drive).
 */
export const LOCAL_SETTING_KEYS: ReadonlySet<string> = new Set(['enrichBatch', 'drive', 'readerMode', 'deeplKey', 'geminiKey'])

export async function getSettings(): Promise<AppSettings> {
  const rows = await db.settings.toArray()
  const stored = Object.fromEntries(rows.map(r => [r.key, r.value]))
  return { ...DEFAULT_SETTINGS, ...stored } as AppSettings
}

export async function setSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
  await db.settings.put({ key, value })
}

export function useSettings(): AppSettings {
  return useLiveQuery(getSettings, [], DEFAULT_SETTINGS)
}
