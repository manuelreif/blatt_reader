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

export class AppDB extends Dexie {
  books!: EntityTable<Book, 'id'>
  terms!: EntityTable<Term, 'id'>
  contexts!: EntityTable<Context, 'id'>
  cards!: EntityTable<CardRow, 'id'>
  reviewLogs!: EntityTable<ReviewLogRow, 'id'>
  translationCache!: EntityTable<TranslationCacheRow, 'key'>
  settings!: EntityTable<Setting, 'key'>

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
  }
}

export const db = new AppDB()
