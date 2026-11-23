import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState } from 'react'
import { Lockup } from '../brand/Logo'
import { InstallSection } from '../pwa/InstallButton'
import { CARD_TYPES, type CardType } from '../db/schema'
import { DriveSettings } from '../drive/DriveSettings'
import {
  DictDownloadError,
  downloadDictionary,
  loadIndex,
  offlineStatus,
  type DictIndex,
  type OfflineStatus,
} from '../dict/dictionary'
import { translateInContext, TranslateError } from '../translate/deepl'
import { countPendingTranslations, retryPendingTranslations } from '../translate/pending'
import { backupJson, download, restoreBackup, reviewLogCsv, vocabCsv } from '../vocab/export'
import { setSetting, useSettings, type DeeplMode } from './settings'

const CARD_LABEL: Record<CardType, string> = {
  'en-de': 'Englisch → Deutsch',
  'de-en': 'Deutsch → Englisch',
  cloze: 'Lückentext mit deinem Satz',
}

const today = () => new Date().toISOString().slice(0, 10)

const mb = (bytes: number) => `${Math.round(bytes / 1e6)} MB`

const LoginLink = ({ show }: { show: boolean }) => (show ? <> · <a href="/login">Anmelden</a></> : null)

function DictionarySection() {
  const [index, setIndex] = useState<DictIndex | null | undefined>(undefined)
  const [status, setStatus] = useState<OfflineStatus | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<{ message: string; login: boolean } | null>(null)

  const refresh = () => void offlineStatus().then(setStatus)
  useEffect(() => {
    void loadIndex().then(setIndex)
    refresh()
  }, [])

  async function download() {
    setError(null)
    setProgress({ done: 0, total: status?.total ?? 0 })
    try {
      await downloadDictionary((done, total) => setProgress({ done, total }))
      void navigator.storage?.persist?.().catch(() => {})
    } catch (e) {
      setError({ message: (e as Error).message, login: e instanceof DictDownloadError && e.login })
    } finally {
      setProgress(null)
      refresh()
    }
  }

  if (index === undefined) return <p className="muted">Offline-Wörterbuch: …</p>
  if (index === null)
    return <p className="muted">Offline-Wörterbuch: fehlt oder nicht erreichbar (lokal: „npm run build:dict“ ausführen)</p>
  const complete = !!status && status.total > 0 && status.stored === status.total
  return (
    <div data-testid="dict-offline">
      <p className="muted">
        Offline-Wörterbuch: {index.source.split(' — ')[0]}, {index.entries.toLocaleString('de-DE')} Stichwörter, Lizenz GPL.
      </p>
      {status && !status.supported && (
        <p className="muted">Komplett offline speichern geht nur, wenn die App über https läuft (nicht über http://192.168…).</p>
      )}
      {status?.supported && complete && <p className="ok">✓ Komplett offline gespeichert</p>}
      {status?.supported && !complete && !progress && (
        <>
          <p className="muted">
            Offline gespeichert: {status.stored} von {status.total} Teilen. Ohne Download lädt die App nur die Teile, die du beim
            Nachschlagen brauchst; offline fehlen dann Wörter mit neuen Anfangsbuchstaben.
          </p>
          <div className="row">
            <button onClick={() => void download()} data-testid="dict-download">
              Ganzes Wörterbuch offline speichern{status.bytes ? ` (ca. ${mb(status.bytes)})` : ''}
            </button>
            <span className="muted">am besten im WLAN</span>
          </div>
        </>
      )}
      {progress && (
        <div className="row">
          <progress value={progress.done} max={progress.total || 1} />
          <span>
            Lade … {progress.done} / {progress.total}
          </span>
        </div>
      )}
      {error && (
        <p className="warn">
          {error.message}
          <LoginLink show={error.login} />
          {status && status.stored > 0 ? ' – ein erneuter Versuch macht dort weiter, wo er aufgehört hat.' : ''}
        </p>
      )}
    </div>
  )
}

function PendingTranslations() {
  const pending = useLiveQuery(countPendingTranslations, [], 0)
  const [msg, setMsg] = useState<{ text: string; login?: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  if (!pending && !msg) return null
  async function retry() {
    setBusy(true)
    const r = await retryPendingTranslations()
    setBusy(false)
    setMsg(r.failed ? { text: `${r.done} nachgeholt, dann Fehler: ${r.failed}`, login: /angemeldet/.test(r.failed) } : { text: `${r.done} nachgeholt.` })
  }
  return (
    <div className="row" data-testid="deepl-pending-settings">
      {pending > 0 && <span>{pending} gespeicherte Wörter warten auf die DeepL-Übersetzung.</span>}
      {pending > 0 && (
        <button disabled={busy} onClick={() => void retry()}>
          Jetzt nachholen
        </button>
      )}
      {msg && (
        <span className={msg.text.includes('Fehler') ? 'warn' : 'ok'}>
          {msg.text}
          <LoginLink show={!!msg.login} />
        </span>
      )}
    </div>
  )
}

function PersistentStorage() {
  const [persisted, setPersisted] = useState<boolean | null>(null)
  const [denied, setDenied] = useState(false)
  useEffect(() => {
    void navigator.storage?.persisted?.().then(setPersisted, () => {})
  }, [])
  if (persisted === null) return null
  if (persisted)
    return <p className="ok">✓ Dauerhafter Speicher: Der Browser löscht diese Daten nicht von sich aus, auch nicht bei Platzmangel.</p>
  return (
    <div data-testid="storage-persist">
      <p className="warn">
        Speicher nicht dauerhaft: Wird der Platz knapp, darf der Browser Bücher und Vokabeln löschen. Chrome erlaubt dauerhaften
        Speicher meist erst, wenn die App installiert ist.
      </p>
      <div className="row">
        <button
          onClick={() =>
            void navigator.storage.persist().then(ok => {
              setPersisted(ok)
              setDenied(!ok)
            })
          }
        >
          Dauerhaften Speicher anfordern
        </button>
        {denied && <span className="muted">Abgelehnt. Installiere die App (Chrome-Menü → App installieren) und versuch es dann noch einmal.</span>}
      </div>
    </div>
  )
}

export function SettingsView() {
  const s = useSettings()
  const [test, setTest] = useState<{ text: string; login?: boolean }>({ text: '' })
  const [storage, setStorage] = useState('')
  const [msg, setMsg] = useState('')
  const restoreInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void navigator.storage?.estimate?.().then(e => {
      if (e.usage !== undefined) setStorage(`${(e.usage / 1e6).toFixed(0)} MB belegt`)
    })
  }, [])

  async function testDeepl() {
    setTest({ text: 'Teste …' })
    try {
      const r = await translateInContext('bank', 'We had a picnic on the bank of the river.', { useCache: false })
      const notes = [
        r.billedCharacters !== undefined ? `abgerechnet: ${r.billedCharacters} Zeichen` : '',
        r.keySource === 'own' ? 'eigener Key' : r.keySource === 'server' ? 'Key des Servers' : '',
      ].filter(Boolean)
      setTest({ text: `OK: „bank“ → „${r.translation}“${notes.length ? ` (${notes.join(', ')})` : ''}` })
    } catch (e) {
      setTest({ text: `Fehler: ${(e as Error).message}`, login: e instanceof TranslateError && e.login })
    }
  }

  return (
    <section className="settings">
      <h1>Einstellungen</h1>

      <h2>App</h2>
      <InstallSection />

      <h2>Übersetzung</h2>
      <p className="muted">
        DeepL läuft über <code>/api/translate</code> (lokal: Vite-Dev-Server mit <code>DEEPL_API_KEY</code> in <code>.env</code>;
        online: Cloudflare Pages Function). Das Wort geht als Text an DeepL, der Satz als Kontext; abgerechnet wird nur das Wort.
        Markierst du im Übersetzen-Modus einen ganzen Satz oder mehr, wird dieser Text voll abgerechnet. Schon einmal
        Übersetztes kommt immer kostenlos aus dem Cache.
      </p>
      <label className="field">
        <span className="label">DeepL abfragen</span>
        <select
          value={s.deeplMode}
          onChange={e => void setSetting('deeplMode', e.target.value as DeeplMode)}
          data-testid="deepl-mode"
        >
          <option value="manual">Nur auf Knopfdruck (+ DeepL), sonst nur das Wörterbuch</option>
          <option value="fallback">Automatisch, wenn das Wörterbuch nichts findet (nur Wörter)</option>
          <option value="always">Immer automatisch (Wörter und Sätze)</option>
        </select>
      </label>
      <label className="field">
        <span className="label">Eigener DeepL-Key (optional)</span>
        <input
          type="password"
          value={s.deeplKey}
          onChange={e => void setSetting('deeplKey', e.target.value)}
          autoComplete="off"
          spellCheck={false}
          placeholder="leer = Key des Servers"
          data-testid="deepl-key"
        />
      </label>
      <p className="muted">
        Mit eigenem Key zahlt dein DeepL-Konto statt das des Servers (kostenlos: „DeepL API Free“ unter deepl.com/pro-api,
        Free-Keys enden auf „:fx“). Der Key bleibt auf diesem Gerät, kommt in keine Sicherung und nicht in den Drive-Abgleich,
        auf jedem Gerät also neu eintragen. Bei jeder Übersetzung geht er über den Server dieser App an DeepL; der reicht
        ihn nur weiter und speichert ihn nicht.
      </p>
      <label className="field">
        <span className="label">
          App-Token (nur nötig, wenn auf dem Server APP_TOKEN gesetzt ist; mit Passwortschutz überflüssig)
        </span>
        <input type="password" value={s.appToken} onChange={e => void setSetting('appToken', e.target.value)} autoComplete="off" />
      </label>
      <div className="row">
        <button onClick={() => void testDeepl()}>DeepL testen</button>
        <span>
          {test.text}
          <LoginLink show={!!test.login} />
        </span>
      </div>
      <PendingTranslations />

      <h2>Wörterbuch</h2>
      <DictionarySection />

      <h2>Lesen & Speichern</h2>
      <label className="check">
        <input type="checkbox" checked={s.autoSave} onChange={e => void setSetting('autoSave', e.target.checked)} />
        Nachgeschlagene Wörter automatisch speichern
      </label>

      <h2>Quiz</h2>
      <span className="label">Kartentypen für neue Wörter</span>
      {CARD_TYPES.map(t => (
        <label className="check" key={t}>
          <input
            type="checkbox"
            checked={s.cardTypes.includes(t)}
            onChange={e =>
              void setSetting(
                'cardTypes',
                e.target.checked ? [...s.cardTypes, t] : s.cardTypes.filter(x => x !== t).length ? s.cardTypes.filter(x => x !== t) : s.cardTypes,
              )
            }
          />
          {CARD_LABEL[t]}
        </label>
      ))}
      <label className="field inline">
        <span className="label">Neue Karten pro Tag</span>
        <input
          type="number"
          min={0}
          max={200}
          value={s.newCardsPerDay}
          onChange={e => void setSetting('newCardsPerDay', Math.max(0, Math.min(200, Number(e.target.value) || 0)))}
        />
      </label>

      <h2>Google Drive</h2>
      <DriveSettings />

      <h2>Daten</h2>
      <p className="muted">
        Alles liegt lokal in diesem Browser{storage ? ` (${storage})` : ''}. Sicherungen enthalten Vokabeln, Kontexte und
        Lernstand, aber keine Bücher. So kannst du den Stand auch auf ein anderes Gerät übertragen.
      </p>
      <PersistentStorage />
      <div className="row">
        <button onClick={() => void backupJson().then(j => download(`vokabeln-backup-${today()}.json`, j, 'application/json'))}>
          Sicherung herunterladen
        </button>
        <button onClick={() => restoreInput.current?.click()}>Sicherung einspielen</button>
        <input
          ref={restoreInput}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={e => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f)
              void f
                .text()
                .then(restoreBackup)
                .then(r => setMsg(`${r.terms} Wörter eingespielt.`))
                .catch(err => setMsg(`Fehler: ${(err as Error).message}`))
          }}
        />
      </div>
      <div className="row">
        <button onClick={() => void vocabCsv().then(c => download(`vokabeln-${today()}.csv`, c, 'text/csv'))}>Vokabeln als CSV</button>
        <button onClick={() => void reviewLogCsv().then(c => download(`wiederholungen-${today()}.csv`, c, 'text/csv'))}>
          Wiederholungen als CSV (z. B. für R)
        </button>
      </div>
      {msg && <p className="ok">{msg}</p>}

      <footer className="about">
        <Lockup />
        <p className="muted">EPUB und PDF lesen, Wörter im Satz nachschlagen, mit FSRS wiederholen.</p>
      </footer>
    </section>
  )
}
