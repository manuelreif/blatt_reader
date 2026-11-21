import Dexie, { type EntityTable } from 'dexie'
import type { Card as FsrsCard } from 'ts-fsrs'

export type BookFormat = 'epub' | 'pdf' | 'mobi' | 'fb2' | 'cbz' | 'other'

export interface Book {
  id: string
  title: string
  author: string
  format: BookFormat
  fileName: string
  file: Blob
  cover?: Blob
  addedAt: number
  openedAt?: number
  /** foliate-js CFI of the last reading position */
  lastLocation?: string
  /** 0..1 */
  progress?: number
  /** when the reading position last moved; the newer position wins when syncing devices */
  progressAt?: number
}

/** 0 = ignoriert, 1–5 = Lernstufen, 6 = bekannt */
export const STATUS_IGNORED = 0
export const STATUS_KNOWN = 6

export interface DictSense {
  de: string
  pos?: string
}

export interface Term {
  /** normalized lemma, unique */
  id: string
  lemma: string
  /** surface forms seen while reading (lowercase) */
  forms: string[]
  translation: string
  dictSenses: DictSense[]
  pos?: string
  status: number
  tags: string[]
  createdAt: number
  updatedAt: number
  // filled by "Mit Claude anreichern"
  explanationDe?: string
  exampleEn?: string
  ipa?: string
  mnemonic?: string
  confusables?: string[]
  distractors?: string[]
  enrichedAt?: number
}

export interface Context {
  id?: number
  termId: string
  bookId: string
  bookTitle: string
  /** the word as it appeared in the text, e.g. "went" */
  surface: string
  sentence: string
  cfi?: string
  /** DeepL translation of the word in this sentence */
  translation?: string
  /** saved while DeepL was unreachable; retried later (src/translate/pending.ts) */
  deeplPending?: boolean
  createdAt: number
}

export type CardType = 'en-de' | 'de-en' | 'cloze'
export const CARD_TYPES: CardType[] = ['en-de', 'de-en', 'cloze']

export interface CardRow {
  /** `${termId}|${type}` */
  id: string
  termId: string
  type: CardType
  /** fsrs.due as epoch ms, indexed */
  due: number
  fsrs: FsrsCard
  suspended?: boolean
}

export interface ReviewLogRow {
  id?: number
  cardId: string
  termId: string
  cardType: CardType
  rating: number
  /** FSRS state before the review */
  state: number
  reviewedAt: number
  scheduledDays: number
  stability: number
  difficulty: number
  /** time from showing the card to rating it */
  answerMs?: number
}

export interface TranslationCacheRow {
  key: string
  translation: string
  createdAt: number
}

export interface Setting {
  key: string
  value: unknown
}

/** A book file in the Google Drive books folder that the sync has dealt with (src/drive/syncBooks.ts). */
export interface DriveFileRow {
  /** Google Drive file id */
  id: string
  name: string
  size?: number
  md5?: string
  /** library entry the file was imported as */
  bookId?: string
  /** dismissed = the book was removed from the library, so it is not downloaded again */
  state: 'imported' | 'dismissed' | 'error'
  error?: string
  updatedAt: number
}

/** A deleted word, kept so that syncing with another device does not bring it back. */
export interface Tombstone {
  /** the deleted term's id */
  id: string
  at: number
}

export const HIGHLIGHT_COLORS = ['yellow', 'green', 'blue', 'pink'] as const
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number]

/** A passage marked in a book (src/reader/highlights.ts). */
export interface Highlight {
  /** random, not crypto.randomUUID (missing over plain http in the LAN) */
  id: string
  bookId: string
  bookTitle: string
  /** foliate section index (PDF: page) */
  section: number
  /** offsets in buildBlockText(doc.body).text of that section */
  start: number
  end: number
  text: string
  /** only for jumping there, like Context.cfi */
  cfi?: string
  color: HighlightColor
  note?: string
  createdAt: number
  updatedAt: number
  /** soft delete, so that syncing with another device does not bring it back */
  deleted?: boolean
}

export class AppDB extends Dexie {
  books!: EntityTable<Book, 'id'>
  terms!: EntityTable<Term, 'id'>
  contexts!: EntityTable<Context, 'id'>
  cards!: EntityTable<CardRow, 'id'>
  reviewLogs!: EntityTable<ReviewLogRow, 'id'>
  translationCache!: EntityTable<TranslationCacheRow, 'key'>
  settings!: EntityTable<Setting, 'key'>
  driveFiles!: EntityTable<DriveFileRow, 'id'>
  tombstones!: EntityTable<Tombstone, 'id'>
  highlights!: EntityTable<Highlight, 'id'>

  constructor(name = 'vokabel-reader') {
    super(name)
    this.version(1).stores({
      books: 'id, addedAt, openedAt',
      terms: 'id, status, createdAt, updatedAt',
      contexts: '++id, termId, bookId, createdAt',
      cards: 'id, termId, due, type',
      reviewLogs: '++id, cardId, termId, reviewedAt',
      translationCache: 'key',
      settings: 'key',
    })
    // Google Drive sync; only new tables, the existing data stays as it is
    this.version(2).stores({
      driveFiles: 'id, bookId, state',
      tombstones: 'id, at',
    })
    // highlights; only a new table
    this.version(3).stores({
      highlights: 'id, bookId, updatedAt',
    })
  }
}

export const db = new AppDB()
