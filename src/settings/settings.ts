import { useLiveQuery } from 'dexie-react-hooks'
import { db, type CardType, type HighlightColor } from '../db/schema'
import type { ReaderMode } from '../reader/modes'

export interface AppSettings {
  /** sent as X-App-Token to /api/translate */
  appToken: string
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
 * reading on the tablet, translating on the desktop is fine).
 */
export const LOCAL_SETTING_KEYS: ReadonlySet<string> = new Set(['enrichBatch', 'drive', 'readerMode'])

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
