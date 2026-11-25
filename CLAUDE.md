# Blatt-Reader – Hinweise für die Weiterarbeit

EPUB/PDF-Reader als PWA zum Englischlernen (bis 22.11.2026 „Vokabel-Reader“): Wort antippen → Offline-Wörterbuch
+ DeepL im Satzkontext → speichern mit Satz → Quiz mit FSRS. Anreicherung (Erklärung, Beispiel, IPA, Ablenker)
durch Claude per Copy-Paste.

Weitere Dokumente, **bei Bedarf lesen**:
- `docs/architektur.md`: ausführliche Notizen pro Modul (Gründe, Zusammenspiel). Vor Änderungen an einem Modul
  den Abschnitt lesen, danach dort nachtragen.
- `docs/stand.md`: was fertig ist, was echt geprüft wurde, Android-Testcheckliste, offene Punkte, Phase 2/3.
  Nach einem Feature oder Test dort ergänzen (nicht hier).
- `README.md` (Setup, Deploy, Bedienung), `docs/google-drive-einrichten.md`, `docs/plan.md` (Ursprungsplan, veraltet).
- `CLAUDE.local.md` (gitignored): Live-Adresse, Cloudflare-/Google-Projekte, Deploy-Befehl.

## Harte Vorgaben

- **Keine kostenpflichtigen APIs.** Die App soll ohne laufende Kosten auskommen; Chat-Abos haben keinen API-Zugang.
  Erlaubt sind DeepL API Free, Offline-Daten und Copy-Paste in claude.ai/ChatGPT. Eine Live-KI höchstens
  kostenlos (Gemini Free Tier, lokales Ollama), optional und nie als Voraussetzung.
- **Kein Code aus AGPL-Projekten** (Readest, Koodo Reader, KOReader): nur Ideen übernehmen.
- **Ding-Wörterbuch ist GPL:** bleibt eine getrennte, generierte Datendatei (`public/dict/`, gitignored,
  `npm run build:dict`). Nicht ins Repo und nicht in den Quellcode übernehmen.
- Plattformen: Linux-Desktop, Android/Tablet, Browser. Alles muss auch am Handy (Touch, ~400 px Breite) gehen.
- Oberfläche auf Deutsch, Code und Kommentare auf Englisch.
- **Das Repo ist öffentlich.** Live-Adresse, Cloudflare-Projektname (= Subdomain), Google-Cloud-Projekt, KV-ID
  und Ähnliches nur in `CLAUDE.local.md`, in committeten Dateien Platzhalter wie `<projekt>`. Keine persönlichen
  Angaben (Abos, Pfade). Die Logo-PNGs in `images/` (mit C2PA-Daten) sind gitignored.

## Befehle

```bash
npm run dev            # Vite-Dev-Server inkl. /api/translate (Key aus .env)
npm run typecheck
npm test               # Vitest
npm run e2e            # Playwright gegen Dev-Server (Port 5179), erzeugt Fixtures selbst
npm run build && E2E_PREVIEW=1 npm run e2e   # gegen Produktions-Build (Port 4179), inkl. CSP- und Passwort-Test
npm run build:dict     # Ding laden (.cache/) → public/dict/en-de/*.json
node scripts/make-icons.mjs                 # Logo-Bausteine + PWA-Icons aus images/*.svg neu erzeugen
```

Vor jedem Commit: `npm run typecheck && npm test && npm run e2e`.

## Wo was liegt

Vite 8 + React 19 + TS (strict), Hash-Router `src/router.ts`, keine UI-Bibliothek, CSS in `src/styles.css`
(CSS-Variablen, Hell/Dunkel, Palette Navy `#141f2d` / Creme `#e6dfca`).

| Bereich | Dateien |
|---|---|
| Daten (Dexie) | `src/db/schema.ts`, Zugriff zentral über `src/db/repo.ts` |
| Reader, Modi, Auswahl | `src/reader/ReaderView.tsx`, `selection.ts`, `modes.ts`, `highlights.ts`, `pdfLayers.ts`, `foliate.ts` |
| Nachschlagen | `src/lookup/LookupSheet.tsx`, `PassageSheet.tsx`, `src/dict/dictionary.ts`, `src/nlp/lemmatize.ts` |
| DeepL | `server/translate.ts` (Handler) ← `functions/api/translate.ts` (Pages) und `vite.config.ts` (dev/preview); Client `src/translate/deepl.ts`, `pending.ts` |
| Passwortschutz | `server/auth.ts`, `server/loginLimit.ts` ← `functions/_middleware.ts` und `vite.config.ts` |
| Claude-Anreicherung | `src/enrich/` (`templates.ts`, `importResponse.ts`, `apply.ts`), optional Gemini `gemini.ts` |
| Sicherung/Merge | `src/vocab/export.ts` (`backupJson`, `mergeBackup`) |
| Google Drive | `src/drive/` (`googleAuth.ts`, `driveApi.ts`, `driveSync.ts`, `syncBooks.ts`, `syncVocab.ts`) |
| Quiz | `src/quiz/scheduler.ts` (ts-fsrs) |
| Einstellungen | `src/settings/settings.ts` (`db.settings`) |
| Logo | `images/*.svg` → `scripts/make-icons.mjs` → `src/brand/logoPaths.ts` (generiert), `src/brand/Logo.tsx` |

## Regeln, die man nicht aus dem Code sieht

- **Interne Kennungen heißen absichtlich weiter `vokabel-reader`** (DB-Name, `app` in Sicherungen,
  `vokabel-reader-sync.json`, `appProperties.vokabelReader`, verstecktes Benutzerfeld der Anmeldeseite).
  Nicht umbenennen, sonst passen alte Daten nicht mehr. Sichtbar heißt alles „Blatt-Reader“.
- **Schema ändern** = neue `this.version(n)` mit Upgrade, nie ältere Versionen umschreiben (Nutzerdaten liegen
  schon im Browser). Jede Änderung an einem Wort setzt `updatedAt` (auch `recordReview`), davon lebt der Sync.
  Gelöschte Markierungen: `deleted: true` + `updatedAt`, gelöschte Wörter: Grabstein.
- **IDs:** `Term.id` = `termKey` (Lemma), `CardRow.id` = `${termId}|${type}`, `Book.id` = `fileId()` aus Größe und
  ersten/letzten 256 KB, absichtlich ohne `crypto.subtle` (fehlt über plain http im LAN).
- **`LOCAL_SETTING_KEYS`** (`enrichBatch`, `drive`, `readerMode`, `deeplKey` …): nie in einer Sicherung, nie im
  Drive-Abgleich, nie von einer Sicherung überschrieben. Neue gerätebezogene Settings dort eintragen.
- **Sheets und Toasts im Reader** gehören in `.overlay-layer` (`position: absolute`, Höhen in `%`), sonst
  stimmen sie beim Pinch-Zoom nicht (`src/util/visualViewport.ts`).
- **Touch-Auswahl ist selbst gebaut**: außerhalb des Lesemodus keine native Auswahl am Touch-Gerät (Chromes
  „Touch to Search“ ließe sich sonst nicht verhindern). Links gelten nur im Lesemodus.
- **Markierungen** zeichnet die CSS Custom Highlight API, nicht foliates Overlayer (den hat der PDF-Renderer
  nicht). Verankert über Offsets in `buildBlockText(doc.body)`; diese Offsets dürfen sich nicht verschieben.
- **compromise** (Grundform) wird erst beim ersten Nachschlagen geladen, `lemmatize` ist asynchron.
- **Neue externe Quellen** (z. B. Live-KI) brauchen einen `connect-src`-Eintrag in der CSP (`cspPlugin` in
  `vite.config.ts`, nur im Produktions-Build aktiv) und eine Ergänzung der Datenschutzseite (`privacyPage()`
  in `server/auth.ts`). Die Anmeldeseite in `server/auth.ts` bringt ihre Farben selbst mit; Palette dort mitziehen.
- `progressAt` nur setzen, wenn sich die Position wirklich bewegt, sonst schlägt bloßes Öffnen auf Gerät B
  den echten Fortschritt von Gerät A.

## Stolperfallen (alle schon einmal passiert)

- **foliate-js** ist Git-Submodule in `public/foliate-js` (gepinnt auf 78914ae, API laut Autor instabil) und wird
  **ungebündelt** geladen (PDF-Adapter holt PDF.js über `import.meta.url`). Nur über `loadFoliate()` in
  `src/reader/foliate.ts` mit **absoluter URL** laden; relativ hängt Vite `?import` an → 500. Nie aus `src/`
  importieren. foliate-js selbst nicht ändern.
- **foliate stapelt PDF-Textlayer** (`render()` leert die Layer nie und läuft parallel): `guardPdfLayers`
  (`src/reader/pdfLayers.ts`) serialisiert und leert. Nicht entfernen.
- PDFs absichtlich einseitig (`rendition.spread = 'none'`). `renderer.getContents()` liefert bei PDFs keinen
  Index, `ReaderView` merkt sich Dokument → Sektion selbst.
- `Intl.Segmenter` beendet Sätze an jedem `\n`; `findSentence` ersetzt Zeilenumbrüche vorher durch Leerzeichen.
- `useSettings()` liefert direkt nach dem Mounten noch Defaults; wo es sofort zählt (Popup), `getSettings()` lesen.
- Eine `FileList` aus `<input type=file>` wird leer, sobald man das Input zurücksetzt: erst `Array.from(files)`.
- **Google-Popup nur nach einem Tippen:** `requestToken()` direkt im Klick-Handler starten (`preloadGis()` lädt
  vorher). Google erlaubt als JavaScript-Quelle nur https und `localhost`, keine LAN-IP.
- `/login`, `/logout`, `/datenschutz` müssen in `navigateFallbackDenylist` bleiben, sonst liefert der Service
  Worker die gecachte App statt der Seite. Manifest und Icons bleiben ohne Login erreichbar.
- Wörterbuch-Cache `dict` teilen sich `downloadDictionary` und der Service Worker: Namen synchron halten.

### Tests

- Unit-Tests laufen in `node`; DOM-Tests brauchen `// @vitest-environment jsdom`, DB-Tests `fake-indexeddb/auto`.
- Playwright-Browser einmalig: `npx playwright install chromium`.
- foliate nutzt **geschlossene Shadow Roots**: an den Buchtext nur über `page.frames()` (`blob:`-URLs);
  Hilfsfunktionen `bookFrame`/`clickWord` in `e2e/app.spec.ts`.
- `page.route('**/dict/**')` trifft im Dev-Modus auch `/src/dict/dictionary.ts` → `**/dict/en-de/**` nehmen.
- Mit aktivem Service Worker sieht `page.route` dessen Anfragen nicht: `test.use({ serviceWorkers: 'block' })`.
- Ein `Blob` als Request-Body ist für `page.route` unsichtbar, darum lädt `driveApi.ts` als ArrayBuffer hoch.
- Headless-Chromium wählt bei CDP-Touch-Gedrückthalten nicht aus; der E2E-Test schickt `selectstart`/`contextmenu`
  direkt und prüft `defaultPrevented`.
- Drive-E2E-Test (`tests/fake-drive.ts` + GIS-Stub) läuft nur mit `VITE_GOOGLE_CLIENT_ID` im Build:
  `VITE_GOOGLE_CLIENT_ID=e2e-client.apps.googleusercontent.com npm run build`, danach **ohne** Test-ID neu
  bauen, bevor deployt wird.
- Preview-E2E läuft mit `APP_PASSWORD=e2e-password`, Login in `beforeEach`. Alle Anfragen kommen von derselben
  IP: höchstens 4 Fehlversuche ohne Erfolg dazwischen, sonst sperrt die Login-Bremse den Rest aus.
