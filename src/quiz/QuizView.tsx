import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { loadQuizSession, recordReview, type QuizItem } from '../db/repo'
import { db } from '../db/schema'
import { href } from '../router'
import { useSettings } from '../settings/settings'
import { Highlighted } from '../util/Highlighted'
import { canSpeak, speak } from '../util/speech'
import { formatInterval, preview, Rating, type Grade } from './scheduler'

const SESSION_SIZE = 20

const BUTTONS: { grade: Grade; label: string; key: string; cls: string }[] = [
  { grade: Rating.Again as Grade, label: 'Nochmal', key: '1', cls: 'again' },
  { grade: Rating.Hard as Grade, label: 'Schwer', key: '2', cls: 'hard' },
  { grade: Rating.Good as Grade, label: 'Gut', key: '3', cls: 'good' },
  { grade: Rating.Easy as Grade, label: 'Einfach', key: '4', cls: 'easy' },
]

/** Sentence for a cloze card: the reading context, else Claude's example sentence. */
function clozeSource(item: QuizItem): { sentence: string; answer: string } | null {
  const c = item.context
  if (c && c.sentence.toLowerCase().includes(c.surface.toLowerCase())) return { sentence: c.sentence, answer: c.surface }
  const ex = item.term.exampleEn
  if (ex && ex.toLowerCase().includes(item.term.lemma.toLowerCase())) return { sentence: ex, answer: item.term.lemma }
  return null
}

function Front({ item }: { item: QuizItem }) {
  const { term, card } = item
  if (card.type === 'de-en')
    return (
      <div className="card-front">
        <span className="card-kind">Deutsch → Englisch</span>
        <p className="card-prompt">{term.translation || '(keine Übersetzung)'}</p>
        {term.explanationDe && <p className="muted">{term.explanationDe}</p>}
      </div>
    )
  const cloze = card.type === 'cloze' ? clozeSource(item) : null
  if (cloze)
    return (
      <div className="card-front">
        <span className="card-kind">Lückentext{item.context ? ` · ${item.context.bookTitle}` : ''}</span>
        <p className="card-sentence">
          <Highlighted text={cloze.sentence} word={cloze.answer} blank />
        </p>
        <p className="muted">Hinweis: {term.translation}</p>
      </div>
    )
  return (
    <div className="card-front">
      <span className="card-kind">Englisch → Deutsch</span>
      <p className="card-prompt">
        {term.lemma}
        {canSpeak() && (
          <button className="icon" onClick={() => speak(term.lemma)} title="Vorlesen">
            🔊
          </button>
        )}
      </p>
    </div>
  )
}

function Back({ item }: { item: QuizItem }) {
  const { term, card, context } = item
  const cloze = card.type === 'cloze' ? clozeSource(item) : null
  return (
    <div className="card-back" data-testid="card-back">
      {card.type !== 'en-de' && (
        <p className="card-answer">
          {cloze ? cloze.answer : term.lemma}
          {canSpeak() && (
            <button className="icon" onClick={() => speak(cloze ? cloze.answer : term.lemma)} title="Vorlesen">
              🔊
            </button>
          )}
        </p>
      )}
      {card.type !== 'de-en' && <p className="card-answer">{term.translation}</p>}
      {term.ipa && <p className="muted">{term.ipa}</p>}
      {term.explanationDe && <p>{term.explanationDe}</p>}
      {context && card.type !== 'cloze' && (
        <p className="card-sentence">
          <Highlighted text={context.sentence} word={context.surface} />
          <span className="muted"> — {context.bookTitle}</span>
        </p>
      )}
      {term.exampleEn && <p className="muted">Beispiel: {term.exampleEn}</p>}
      {term.mnemonic && <p className="muted">Eselsbrücke: {term.mnemonic}</p>}
    </div>
  )
}

export function QuizView() {
  const settings = useSettings()
  const [items, setItems] = useState<QuizItem[] | null>(null)
  const [index, setIndex] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [done, setDone] = useState(0)
  const shownAt = useRef(Date.now())
  const [nextDue, setNextDue] = useState<number | null>(null)

  const load = useCallback(async () => {
    const session = await loadQuizSession({ limit: SESSION_SIZE, newPerDay: settings.newCardsPerDay })
    setItems(session)
    setIndex(0)
    setRevealed(false)
    shownAt.current = Date.now()
    if (!session.length) {
      const first = await db.cards.orderBy('due').filter(c => !c.suspended).first()
      setNextDue(first?.due ?? null)
    }
  }, [settings.newCardsPerDay])

  useEffect(() => {
    void load()
  }, [load])

  const item = items?.[index]
  const intervals = useMemo(() => (item ? preview(item.card.fsrs) : null), [item])

  const rate = useCallback(
    async (grade: Grade) => {
      if (!item || !revealed) return
      await recordReview(item.card, grade, { answerMs: Date.now() - shownAt.current })
      setDone(d => d + 1)
      const rest = items!.slice(index + 1)
      // "Nochmal" brings the card back at the end of this session
      if (grade === Rating.Again) {
        const fresh = await db.cards.get(item.card.id)
        if (fresh) rest.push({ ...item, card: fresh })
      }
      setItems([...items!.slice(0, index + 1), ...rest])
      setIndex(i => i + 1)
      setRevealed(false)
      shownAt.current = Date.now()
    },
    [item, revealed, items, index],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.('input, textarea, select')) return
      if (!revealed && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault()
        setRevealed(true)
      } else if (revealed) {
        const b = BUTTONS.find(x => x.key === e.key)
        if (b) void rate(b.grade)
      }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [revealed, rate])

  if (!items) return <p className="muted">Lade …</p>

  if (!item)
    return (
      <section className="quiz-done">
        <h1>{done ? 'Geschafft!' : 'Nichts fällig'}</h1>
        {done > 0 && <p>{done} Karten wiederholt.</p>}
        {nextDue && <p className="muted">Nächste Karte fällig: {new Date(nextDue).toLocaleString('de-AT', { dateStyle: 'medium', timeStyle: 'short' })}</p>}
        {!nextDue && !done && (
          <p className="muted">
            Noch keine Karten. Speichere beim <a href={href({ name: 'library' })}>Lesen</a> ein paar Wörter.
          </p>
        )}
        <button onClick={() => void load()}>Erneut prüfen</button>
      </section>
    )

  const remaining = items.length - index
  return (
    <section className="quiz" data-testid="quiz">
      <header className="page-head">
        <h1>Quiz</h1>
        <span className="muted">
          noch {remaining} · {done} erledigt
        </span>
      </header>
      <div className="quiz-card">
        <Front item={item} />
        {revealed ? (
          <Back item={item} />
        ) : (
          <button className="primary reveal" onClick={() => setRevealed(true)} data-testid="reveal">
            Antwort zeigen <span className="kbd">Leertaste</span>
          </button>
        )}
      </div>
      {revealed && intervals && (
        <div className="ratings">
          {BUTTONS.map(b => (
            <button key={b.grade} className={`rating ${b.cls}`} onClick={() => void rate(b.grade)} data-testid={`rate-${b.cls}`}>
              {b.label}
              <span className="muted">{formatInterval(new Date(), intervals[b.grade])}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
