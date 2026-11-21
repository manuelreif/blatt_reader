# Vokabel-Reader – Hinweise für die Weiterarbeit

EPUB/PDF-Reader als PWA zum Englischlernen: Wort antippen → Offline-Wörterbuch + DeepL-Übersetzung
im Satzkontext → speichern mit Satz → Quiz mit FSRS. Anreicherung (Erklärung, Beispiel, IPA,
Ablenker) durch Claude per Copy-Paste. Setup, Deploy und Bedienung: siehe `README.md`.

## Harte Vorgaben

- **Keine kostenpflichtigen APIs.** Die App soll ohne laufende Kosten auskommen; Chat-Abos haben keinen API-Zugang.
  Erlaubt sind DeepL API Free, Offline-Daten und Copy-Paste in claude.ai/ChatGPT. Eine Live-KI höchstens
  kostenlos (Gemini Free Tier, lokales Ollama), optional und nie als Voraussetzung.
- **Kein Code aus AGPL-Projekten** (Readest, Koodo Reader, KOReader): nur Ideen übernehmen.
- **Ding-Wörterbuch ist GPL:** bleibt eine getrennte, generierte Datendatei (`public/dict/`, gitignored,
  `npm run build:dict`). Nicht ins Repo und nicht in den Quellcode übernehmen.
- Plattformen: Linux-Desktop, Android/Tablet, Browser. Alles muss auch am Handy (Touch, ~400 px Breite) gehen.
- Oberfläche auf Deutsch, Code und Kommentare auf Englisch.

## Befehle

```bash
npm run dev            # Vite-Dev-Server inkl. /api/translate (Key aus .env)
npm run typecheck
npm test               # Vitest, 57 Tests
npm run e2e            # Playwright gegen Dev-Server (Port 5179), erzeugt Fixtures selbst
npm run build && E2E_PREVIEW=1 npm run e2e   # gegen Produktions-Build (Port 4179), inkl. CSP-Test
npm run build:dict     # Ding laden (.cache/) → public/dict/en-de/*.json
node scripts/make-icons.mjs                 # PWA-Icons neu erzeugen
```

Vor jedem Commit: `npm run typecheck && npm test && npm run e2e`.

## Architektur in Kürze

- Vite 8 + React 19 + TS (strict), Hash-Router in `src/router.ts`, keine UI-Bibliothek, CSS in `src/styles.css`
  (CSS-Variablen, Hell/Dunkel).
- **Daten:** Dexie in `src/db/schema.ts` (DB `vokabel-reader`, Version 1). Zugriff zentral über
  `src/db/repo.ts` (`saveLookup`, `recordReview`, `loadQuizSession` …). Schema ändern = neue
  `this.version(n)` mit Upgrade, nie Version 1 umschreiben (Nutzerdaten liegen schon im Browser).
- **IDs:** `Term.id` = Lemma-Schlüssel (`termKey`), `CardRow.id` = `${termId}|${type}`,
  `Book.id` = `fileId()` aus Größe und den ersten/letzten 256 KB (absichtlich ohne `crypto.subtle`,
  das fehlt über plain http im LAN).
- **Einstellungen** liegen in `db.settings` (`src/settings/settings.ts`); der offene Anreicherungs-Durchgang
  unter dem Schlüssel `enrichBatch`.
- **Nachschlagen:** `src/reader/selection.ts` findet Wort und Satz unter Finger/Maus
  (`caretPositionFromPoint`, `Intl.Segmenter`, Blocktext mit ` ` als Absatzgrenze, Silbentrennung
  über Zeilen hinweg). `src/lookup/LookupSheet.tsx` fragt Wörterbuch und DeepL parallel ab.
- **Grundform:** `src/nlp/lemmatize.ts` mit compromise, **asynchron** (compromise wird erst beim ersten
  Nachschlagen geladen, spart ~340 kB beim Start).
- **DeepL:** Browser → `/api/translate` → `server/translate.ts` → DeepL. Derselbe Handler läuft als
  Cloudflare Pages Function (`functions/api/translate.ts`) und als Vite-Middleware (dev und preview,
  `vite.config.ts`). Wort geht als `text`, Satz als `context` (wird nicht abgerechnet). Free-Keys enden
  auf `:fx` → `api-free.deepl.com`. Optionales `APP_TOKEN` als Header `x-app-token`.
  Client `src/translate/deepl.ts` cached in `translationCache` und fasst gleichzeitige gleiche Anfragen zusammen.
- **Claude-Anreicherung:** `src/enrich/templates.ts` (Prompt + zod-Schema), `importResponse.ts`
  (JSON aus Antwort holen, abgeschnittene Arrays reparieren, pro Eintrag prüfen), `apply.ts`.
- **Quiz:** `src/quiz/scheduler.ts` (ts-fsrs, Retention 0.9, Fuzz an), Kartentypen `en-de`, `de-en`,
  `cloze`. Term-Status 1–5 ergibt sich aus der kleinsten Stabilität der Karten; 0 = ignoriert, 6 = bekannt.

## Stolperfallen (alle schon einmal passiert)

- **foliate-js** ist Git-Submodule in `public/foliate-js` (gepinnt auf 78914ae, API laut Autor instabil)
  und wird **ungebündelt** geladen, weil der PDF-Adapter PDF.js über `import.meta.url` aus `vendor/pdfjs`
  holt. Laden nur über `loadFoliate()` in `src/reader/foliate.ts` mit **absoluter URL**; eine relative
  URL bekommt in Vite ein `?import` angehängt und schlägt mit 500 fehl. Nie aus `src/` per `import` einbinden.
- foliate-js nutzt **geschlossene Shadow Roots**. Playwright kommt an den Buchtext nur über
  `page.frames()` (Frames mit `blob:`-URL), Klickpositionen = Rechteck im Frame + `frameElement().boundingBox()`.
  Hilfsfunktionen `bookFrame`/`clickWord` in `e2e/app.spec.ts`.
- Eine `FileList` aus `<input type=file>` wird leer, sobald man das Input zurücksetzt. Erst
  `Array.from(files)`, dann weiterarbeiten (`LibraryView.tsx`).
- **CSP nur im Produktions-Build** (`cspPlugin` in `vite.config.ts`). Im Dev-Modus laufen Skripte aus
  EPUBs wirklich; der Test `production build: scripts inside an EPUB are blocked` belegt die Sperre.
  Neue externe Quellen (z. B. eine Live-KI) brauchen einen passenden `connect-src`-Eintrag.
- PDFs werden absichtlich einseitig angezeigt (`rendition.spread = 'none'` in `ReaderView.tsx`).
- `Intl.Segmenter` beendet Sätze an jedem `\n`; `findSentence` ersetzt Zeilenumbrüche vorher durch Leerzeichen.
- Unit-Tests laufen in `node`; DOM-Tests brauchen `// @vitest-environment jsdom` am Dateianfang,
  DB-Tests `fake-indexeddb/auto`.
- Playwright-Browser einmalig: `npx playwright install chromium`.

## Stand (21.11.2026)

**Fertig (Phase 0 + MVP):** Bibliothek (Import, Cover, Fortschritt), Reader für EPUB und PDF (TOC,
Schriftgröße, Zoom, Positionsregler), Nachschlage-Popup (Wörterbuch + DeepL, Vorlesen, Speichern,
Ignorieren, Auto-Speichern), Vokabelliste mit Detailansicht und „im Buch zeigen“, Claude-Anreicherung,
FSRS-Quiz (EN→DE, DE→EN, Lückentext), Einstellungen, Backup/Restore, CSV-Export (Vokabeln und
Review-Log für R), PWA mit Offline-Cache.

**Noch nie echt getestet** (nur simuliert bzw. mit generierten Fixtures):
- echter DeepL-Key (es gibt noch kein `.env`), Abrechnung nur des Worts per `show_billed_characters` prüfen
- echter Copy-Paste-Durchgang mit claude.ai
- echtes zweispaltiges PDF-Paper (Phase-0-Entscheidung: foliate-js-PDF reicht vorerst; Ausweg wäre
  `pdfjs-dist` hinter einem Reader-Adapter)
- Deploy auf Cloudflare Pages und Installation als PWA auf Android

**Phase 2 (offen):**
- gespeicherte Wörter im Text farbig markieren (CSS Custom Highlight API, Status-Farben wie LingQ)
- Quiz-Typen Multiple Choice (nutzt `distractors` von Claude, sonst Wörter gleicher Wortart),
  Eintippen mit Levenshtein-Toleranz
- weitere Claude-Vorlagen (Quizrunde, Fachglossar pro Paper, Mini-Geschichte, „Satz erklären“)
- Dubletten zusammenführen, Anki-Export
- Cloudflare-Deploy + Android

**Phase 3:** Statistik (Vergessenskurven, Serien), Kapitel-Vorschau (unbekannte Wörter vorab lernen),
Schwierigkeitswert pro Buch, Sync (JSON/WebDAV), optionale kostenlose Live-KI.

Der ausführliche ursprüngliche Plan mit Recherche, Quellen und Feature-Ideen: `docs/plan.md`
(Stand bei Projektstart; die Abschnitte oben sind aktueller).
