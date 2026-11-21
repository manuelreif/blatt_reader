import { useLiveQuery } from 'dexie-react-hooks'
import { db, type CardType } from '../db/schema'

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
}

export const DEFAULT_SETTINGS: AppSettings = {
  appToken: '',
  autoSave: false,
  cardTypes: ['en-de', 'cloze'],
  newCardsPerDay: 20,
  enrichBatchSize: 30,
  readerFontScale: 1,
}

/**
 * Rows in db.settings that belong to this device only: never part of a backup and
 * never overwritten by one (open enrichment batch, Google Drive connection).
 */
export const LOCAL_SETTING_KEYS: ReadonlySet<string> = new Set(['enrichBatch', 'drive'])

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
