import { useEffect, useRef, useState } from 'react'
import { CARD_TYPES, type CardType } from '../db/schema'
import { dictionaryAvailable } from '../dict/dictionary'
import { translateInContext } from '../translate/deepl'
import { backupJson, download, restoreBackup, reviewLogCsv, vocabCsv } from '../vocab/export'
import { setSetting, useSettings } from './settings'

const CARD_LABEL: Record<CardType, string> = {
  'en-de': 'Englisch → Deutsch',
  'de-en': 'Deutsch → Englisch',
  cloze: 'Lückentext mit deinem Satz',
}

const today = () => new Date().toISOString().slice(0, 10)

export function SettingsView() {
  const s = useSettings()
  const [test, setTest] = useState('')
  const [dictOk, setDictOk] = useState<boolean | null>(null)
  const [storage, setStorage] = useState('')
  const [msg, setMsg] = useState('')
  const restoreInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void dictionaryAvailable().then(setDictOk)
    void navigator.storage?.estimate?.().then(e => {
      if (e.usage !== undefined) setStorage(`${(e.usage / 1e6).toFixed(0)} MB belegt`)
    })
  }, [])

  async function testDeepl() {
    setTest('Teste …')
    try {
      const r = await translateInContext('bank', 'We had a picnic on the bank of the river.', { useCache: false })
      setTest(`OK: „bank“ → „${r.translation}“${r.billedCharacters !== undefined ? ` (abgerechnet: ${r.billedCharacters} Zeichen)` : ''}`)
    } catch (e) {
      setTest(`Fehler: ${(e as Error).message}`)
    }
  }

  return (
    <section className="settings">
      <h1>Einstellungen</h1>

      <h2>Übersetzung</h2>
      <p className="muted">
        DeepL läuft über <code>/api/translate</code> (lokal: Vite-Dev-Server mit <code>DEEPL_API_KEY</code> in <code>.env</code>;
        online: Cloudflare Pages Function). Das Wort geht als Text an DeepL, der Satz als Kontext; abgerechnet wird nur das Wort.
      </p>
      <label className="field">
        <span className="label">App-Token (nur nötig, wenn auf dem Server APP_TOKEN gesetzt ist)</span>
        <input type="password" value={s.appToken} onChange={e => void setSetting('appToken', e.target.value)} autoComplete="off" />
      </label>
      <div className="row">
        <button onClick={() => void testDeepl()}>DeepL testen</button>
        <span>{test}</span>
      </div>
      <p className="muted">
        Offline-Wörterbuch:{' '}
        {dictOk === null ? '…' : dictOk ? 'vorhanden (Ding, TU Chemnitz, GPL)' : 'fehlt – „npm run build:dict“ ausführen'}
      </p>

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

      <h2>Daten</h2>
      <p className="muted">
        Alles liegt lokal in diesem Browser{storage ? ` (${storage})` : ''}. Sicherungen enthalten Vokabeln, Kontexte und
        Lernstand, aber keine Bücher. So kannst du den Stand auch auf ein anderes Gerät übertragen.
      </p>
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
    </section>
  )
}
