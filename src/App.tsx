import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect } from 'react'
import { countDue } from './db/repo'
import { db } from './db/schema'
import { EnrichView } from './enrich/EnrichView'
import { LibraryView } from './library/LibraryView'
import { QuizView } from './quiz/QuizView'
import { ReaderView } from './reader/ReaderView'
import { href, useRoute, type Route } from './router'
import { SettingsView } from './settings/SettingsView'
import { VocabView } from './vocab/VocabView'

function Nav({ route }: { route: Route }) {
  const due = useLiveQuery(() => countDue(), [], 0)
  const unenriched = useLiveQuery(() => db.terms.filter(t => !t.enrichedAt && t.status !== 0).count(), [], 0)
  const items: { route: Route; label: string; badge?: number }[] = [
    { route: { name: 'library' }, label: 'Bibliothek' },
    { route: { name: 'vocab' }, label: 'Vokabeln' },
    { route: { name: 'quiz' }, label: 'Quiz', badge: due },
    { route: { name: 'enrich' }, label: 'Anreichern', badge: unenriched },
    { route: { name: 'settings' }, label: 'Einstellungen' },
  ]
  return (
    <nav className="nav">
      <span className="brand">Vokabel-Reader</span>
      {items.map(it => (
        <a key={it.route.name} href={href(it.route)} className={route.name === it.route.name ? 'active' : ''}>
          {it.label}
          {it.badge ? <span className="badge">{it.badge}</span> : null}
        </a>
      ))}
    </nav>
  )
}

export function App() {
  const route = useRoute()
  useEffect(() => {
    // ask the browser not to evict books and vocabulary under storage pressure
    navigator.storage?.persist?.().catch(() => {})
  }, [])
  if (route.name === 'read') return <ReaderView key={route.bookId} bookId={route.bookId} cfi={route.cfi} />
  return (
    <div className="app">
      <Nav route={route} />
      <main className="page">
        {route.name === 'library' && <LibraryView />}
        {route.name === 'vocab' && <VocabView termId={route.termId} />}
        {route.name === 'quiz' && <QuizView />}
        {route.name === 'enrich' && <EnrichView />}
        {route.name === 'settings' && <SettingsView />}
      </main>
    </div>
  )
}
