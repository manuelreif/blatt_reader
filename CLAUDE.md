# Blatt-Reader – Hinweise für die Weiterarbeit

EPUB/PDF-Reader als PWA zum Englischlernen (bis 22.11.2026 „Vokabel-Reader“): Wort antippen → Offline-Wörterbuch + DeepL-Übersetzung
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
npm test               # Vitest, 117 Tests
npm run e2e            # Playwright gegen Dev-Server (Port 5179), erzeugt Fixtures selbst
npm run build && E2E_PREVIEW=1 npm run e2e   # gegen Produktions-Build (Port 4179), inkl. CSP- und Passwort-Test
npm run build:dict     # Ding laden (.cache/) → public/dict/en-de/*.json
node scripts/make-icons.mjs                 # Logo-Bausteine + PWA-Icons aus images/*.svg neu erzeugen
```

Vor jedem Commit: `npm run typecheck && npm test && npm run e2e`.

## Architektur in Kürze

- Vite 8 + React 19 + TS (strict), Hash-Router in `src/router.ts`, keine UI-Bibliothek, CSS in `src/styles.css`
  (CSS-Variablen, Hell/Dunkel).
- **Logo und Design:** Quellen in `images/` (nachgezeichnete SVGs vom Nutzer). `scripts/make-icons.mjs` macht
  daraus `src/brand/logoPaths.ts` (Pfade, generiert), Favicon, PWA-Icons (rund; maskable und Apple randlos navy),
  `public/brand/pattern.svg` (Wasserzeichen-Kachel) und `public/brand/blatt-reader.svg` (Logo mit Schriftzug).
  Kreis und Ring sind dabei exakte Kreise, nur Blatt-Symbol und Schriftzug kommen aus der Vorlage.
  Komponenten in `src/brand/Logo.tsx` (`Emblem`, `Glyph`, `Lettering`, `Lockup`), Farben über `--logo-disc`/`--logo-ink`.
  Palette: Navy `#141f2d` + Creme `#e6dfca`, hell = Creme-Papier mit Navy-Schrift, dunkel = Navy mit Creme.
  Platzierung: rundes Emblem = Favicon/App-Icon, Reader-Leiste (zurück zur Bibliothek), leere Bibliothek,
  Ladeanzeige im Reader, Cover-Platzhalter (nur Blatt); Logo mit Schriftzug = Kopfleiste (unter 720 px nur Emblem),
  Anmeldeseite, Fuß der Einstellungen, README. Wasserzeichen = `.app::before` (CSS-Maske, Farbe `--watermark`),
  bewusst nicht im Reader, damit der Buchtext ruhig bleibt. Die Anmeldeseite (`server/auth.ts`) bringt ihre
  Farben selbst mit; Palette dort mitziehen.
- **Name:** sichtbar überall „Blatt-Reader“. Interne Kennungen heißen absichtlich weiter `vokabel-reader`:
  DB-Name, `app` in Sicherungen, Sync-Datei `vokabel-reader-sync.json`, `appProperties.vokabelReader`,
  verstecktes Benutzerfeld der Anmeldeseite (Passwortmanager). Nicht umbenennen, sonst passen alte Daten nicht mehr.
- **Daten:** Dexie in `src/db/schema.ts` (DB `vokabel-reader`, Version 2: v1 + Tabellen `driveFiles`,
  `tombstones`; Version 3: + `highlights`). Zugriff zentral über `src/db/repo.ts` (`saveLookup`, `recordReview`, `loadQuizSession` …).
  Schema ändern = neue `this.version(n)` mit Upgrade, nie ältere Versionen umschreiben (Nutzerdaten liegen
  schon im Browser). Jede Änderung an einem Wort setzt `updatedAt` (auch `recordReview`), davon lebt der Sync.
- **IDs:** `Term.id` = Lemma-Schlüssel (`termKey`), `CardRow.id` = `${termId}|${type}`,
  `Book.id` = `fileId()` aus Größe und den ersten/letzten 256 KB (absichtlich ohne `crypto.subtle`,
  das fehlt über plain http im LAN).
- **Einstellungen** liegen in `db.settings` (`src/settings/settings.ts`); der offene Anreicherungs-Durchgang
  unter dem Schlüssel `enrichBatch`, die Drive-Verbindung unter `drive`. Beide stehen in `LOCAL_SETTING_KEYS`:
  nie in einer Sicherung, nie von einer überschrieben.
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
  Scheitert DeepL beim Speichern, bekommt der Kontext `deeplPending: true` (kein Index, daher ohne
  Schema-Version); `src/translate/pending.ts` holt das nach (App-Start, `online`-Event, nächster
  erfolgreicher Lookup, Knopf in den Einstellungen) und ersetzt `Term.translation` nur, solange dort
  noch der Wörterbuch-Ersatz von damals steht.
- **Passwortschutz:** `server/auth.ts` (`authGate`), als Pages-Middleware `functions/_middleware.ts` vor
  allen Anfragen und in `vite.config.ts` vor dev/preview. Aus, solange `APP_PASSWORD` fehlt. Cookie
  `vr_session` = `v1.<ablauf>.<HMAC mit dem Passwort>`, 400 Tage, verlängert sich unter 200 Tagen Rest.
  Seiten ohne Sitzung → 303 auf `/login`, alles andere → 401-JSON mit `login: '/login'` (Client zeigt
  „Anmelden“-Link). Manifest und Icons bleiben öffentlich (Chrome holt das Manifest ohne Cookies).
- **Wörterbuch:** `src/dict/dictionary.ts` lädt Shards nach Bedarf; `index.json` listet alle Shards, ein
  Wort aus einem nicht gelisteten Shard ist also „kein Eintrag“, ein nicht ladbarer Shard „nicht
  verfügbar“ (`lookupKey` → `null`, Popup zeigt Hinweis). `downloadDictionary` legt alles in den Cache
  `dict`, denselben, den der Service Worker für `/dict/` nutzt (Namen synchron halten). Ohne aktiven
  Service Worker (dev, erster Besuch) liest `fetchJson` offline direkt über `caches.match`.
- **Reader-Modi** (`src/reader/modes.ts`): `read` / `translate` / `mark`, Setting `readerMode` (in
  `LOCAL_SETTING_KEYS`, also pro Gerät). `attachReaderHandlers` in `selection.ts` verteilt Tippen/Auswahl nach Modus;
  Zwei-Finger-Tipp über den reinen `createGestureTracker` (Taps der beteiligten Finger werden verworfen).
  Lesemodus blättert per Drittel (`tapZone`, x über `frameElement` in Fensterkoordinaten umgerechnet).
- **Markierungen** (`src/reader/highlights.ts`, Tabelle `highlights`): verankert über Offsets im Text von
  `buildBlockText(doc.body)` der Sektion (PDF: Seite) plus `text`; passt der Text nicht mehr, gilt das nächste
  Vorkommen. `cfi` nur zum Hinspringen. Gezeichnet mit der CSS Custom Highlight API (`vr-hl-<farbe>`,
  `vr-hl-note`), **nicht** mit foliates Overlayer (den hat der PDF-Renderer nicht). Ein `MutationObserver` malt
  neu, weil der PDF-Textlayer erst nach `load` (und bei jedem Zoom neu) entsteht. `renderer.getContents()` liefert
  bei PDFs keinen Index, darum merkt sich `ReaderView` Dokument → Sektion selbst. Löschen = `deleted: true` +
  `updatedAt` (kein Grabstein), `mergeBackup` nimmt je `id` das neuere `updatedAt`.
- **Claude-Anreicherung:** `src/enrich/templates.ts` (Prompt + zod-Schema), `importResponse.ts`
  (JSON aus Antwort holen, abgeschnittene Arrays reparieren, pro Eintrag prüfen), `apply.ts`.
- **Sicherung/Merge:** `src/vocab/export.ts`. `backupJson` (Format `version: 1`, optional `tombstones` und
  `bookProgress`), `mergeBackup` (neueres `updatedAt` gewinnt, Karte mit späterem `last_review` gewinnt,
  Kontexte/Reviews vereinigt, Grabstein neuer als `updatedAt` → Wort samt Zeilen weg, `suspended` folgt dem
  Status, Lesefortschritt nach `progressAt`). Auch „Sicherung einspielen“ läuft über `mergeBackup`.
- **Google Drive** (`src/drive/`, optional, nur mit `VITE_GOOGLE_CLIENT_ID` beim Build):
  - `googleAuth.ts`: Google Identity Services, Token-Modell, nur im Browser, kein Secret. Scopes
    `drive.readonly` + `drive.file`. Token ca. 1 h in `localStorage` (`vr_google_token`), ein neues braucht
    eine Nutzergeste (Popup).
  - `driveApi.ts`: REST v3 mit injizierbarem `fetchImpl`. Uploads resumable (kein 5-MB-Limit).
  - `driveSync.ts` (`syncDrive`): App-Ordner „Blatt-Reader“ (gefunden über `appProperties.vokabelReader=root`,
    nicht über den Namen; vor der Umbenennung angelegte Ordner heißen „Vokabel-Reader“ und bleiben in Gebrauch,
    angezeigt wird der echte Name aus `DriveState.appFolderName`,
    gewählter Bücherordner in `appProperties.booksFolderId`) → `syncBooks.ts` (neue Drive-IDs herunterladen →
    `importBook`; `driveFiles.state` `imported`/`dismissed`/`error`, `deleteBook` setzt `dismissed`) →
    `syncVocab.ts` (`vokabel-reader-sync.json` laden, `mergeBackup` ohne Einstellungen, Stand hochladen).
  - Läuft beim Start, bei `online`, nach einer Quizrunde und per Knopf. Ohne gültiges Token setzt ein
    Hintergrundlauf nur `needsLogin`, dann zeigt `DriveBar` in der Bibliothek den Knopf.
- **Quiz:** `src/quiz/scheduler.ts` (ts-fsrs, Retention 0.9, Fuzz an), Kartentypen `en-de`, `de-en`,
  `cloze`. Term-Status 1–5 ergibt sich aus der kleinsten Stabilität der Karten; 0 = ignoriert, 6 = bekannt.
- **Quiz pro Buch:** Route `#/quiz/<bookId>`. Ein Wort gehört zu einem Buch, wenn es dort einen Kontext hat
  (`termIdsForBook`, Index `contexts.bookId`, kein eigenes Feld, also kein Schema-Update). Nur ein Filter:
  Karten, FSRS-Stand und Tageslimit für neue Karten bleiben gemeinsam. `quizBooks()` liefert Bücher mit
  Wörtern im Quiz und fälligen Karten (Auswahl im Quiz, Link „Quiz · n fällig“ in der Bibliothek),
  `booksWithWords()` den Buchfilter der Vokabelliste. Titel kommen aus den Kontexten, damit auch aus der
  Bibliothek entfernte Bücher erscheinen. Wörter ohne Satz gehören zu keinem Buch, nur zu „Alle Bücher“.

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
- `page.route('**/dict/**')` trifft im Dev-Modus auch `/src/dict/dictionary.ts`, die App startet dann
  nicht. Muster wie `**/dict/en-de/**` nehmen.
- Mit aktivem Service Worker sieht `page.route` dessen Anfragen nicht; Offline-Tests laufen deshalb mit
  `test.use({ serviceWorkers: 'block' })`.
- **Google-Popup nur nach einem Tippen:** `requestToken()` muss direkt im Klick-Handler starten. Darum lädt
  `preloadGis()` das Google-Skript schon beim Anzeigen der Drive-Knöpfe. Google erlaubt als JavaScript-Quelle
  nur https und `localhost`, keine LAN-IP.
- `progressAt` nur setzen, wenn sich die Position wirklich bewegt (`ReaderView.tsx`), sonst schlägt bloßes
  Öffnen auf Gerät B den echten Fortschritt von Gerät A.
- Ein `Blob` als Request-Body ist für `page.route` unsichtbar (`postDataBuffer()` leer), darum schickt
  `driveApi.ts` Uploads als ArrayBuffer. Der Drive-E2E-Test nutzt `tests/fake-drive.ts` (auch in den
  Unit-Tests) und einen GIS-Stub. Er wird übersprungen, wenn der Build keine `VITE_GOOGLE_CLIENT_ID` hat:
  für `E2E_PREVIEW=1` also mit `VITE_GOOGLE_CLIENT_ID=e2e-client.apps.googleusercontent.com npm run build`
  bauen und danach **ohne** die Test-ID neu bauen, bevor deployt wird.
- `/login` und `/logout` stehen in `navigateFallbackDenylist`, sonst beantwortet der Service Worker sie
  mit der gecachten App und die Anmeldeseite erscheint nie. Der Preview-Server für E2E läuft mit
  `APP_PASSWORD=e2e-password` (`playwright.config.ts`), die Tests melden sich in `beforeEach` an.

## Stand (22.11.2026)

**Fertig (Phase 0 + MVP):** Bibliothek (Import, Cover, Fortschritt), Reader für EPUB und PDF (TOC,
Schriftgröße, Zoom, Positionsregler), Nachschlage-Popup (Wörterbuch + DeepL, Vorlesen, Speichern,
Ignorieren, Auto-Speichern), Vokabelliste mit Detailansicht und „im Buch zeigen“, Claude-Anreicherung,
FSRS-Quiz (EN→DE, DE→EN, Lückentext), Einstellungen, Backup/Restore, CSV-Export (Vokabeln und
Review-Log für R), PWA mit Offline-Cache.

**Echt getestet (21.11.2026):** DeepL-Free-Key in `.env` über `/api/translate`: „bank“ wird je nach
Satz zu „Ufer“ bzw. „Bank“, abgerechnet werden nur 4 Zeichen (der Kontext zählt nicht).

**Neu (21.11.2026):** Passwortschutz, Wörterbuch komplett offline speichern, Offline-Hinweis im Popup,
DeepL für offline gespeicherte Wörter nachholen, Anzeige „dauerhafter Speicher“ in den Einstellungen.

**Neu (21.11.2026):** Google-Drive-Abgleich: Bücherordner automatisch laden, Vokabeln/Lernstand/Lesefortschritt
zwischen Geräten zusammenführen (Grabsteine für gelöschte Wörter), Merge auch beim manuellen Einspielen.

**Neu (21.11.2026):** Reader-Modi Lesen/Übersetzen/Markieren (Knopf, Tasten l/u/m, Zwei-Finger-Tipp) und
Markierungen mit Farben, Notizen und Liste pro Buch, mit Sicherung und Drive-Abgleich.

**Neu (21.11.2026):** Quiz pro Buch (Auswahl im Quiz, Link in der Bibliothek), Buchfilter in der Vokabelliste.

**Neu (22.11.2026):** Umbenennung in „Blatt-Reader“, Logo (App-Icons, Kopfleiste, Reader, Anmeldeseite,
Einstellungen), Farbschema Navy/Creme aus dem Logo, Blatt-Muster als Wasserzeichen im Hintergrund.
Reader-Leiste läuft am Handy nicht mehr über den Bildschirmrand hinaus.

**Live (22.11.2026):** https://<projekt>.pages.dev (Cloudflare Pages, Projekt `<projekt>`, Branch `main`,
Secrets `DEEPL_API_KEY` und `APP_PASSWORD`). Deploy: `npm run build && npx wrangler pages deploy dist
--project-name <projekt> --branch main`. Echt geprüft: Passwortschutz in der Cloudflare-Laufzeit (lokal mit
`wrangler pages dev` und live), DeepL über die Pages Function, App am Desktop, Google-Login am Desktop.
Die Google-Client-ID (siehe `CLAUDE.local.md`) hat als JavaScript-Quellen die drei
localhost-Ports, `https://<projekt>.pages.dev`.
Eine neue Domain dort eintragen, sonst `origin_mismatch`.

**Als Nächstes (geplant ab 23.11.2026): Praxistest auf Android**, in Chrome https://<projekt>.pages.dev
öffnen, anmelden, Menü → „App installieren“, dann in der installierten App:
- [ ] Icon und Start ohne Browserleiste; Anmeldung bleibt nach Neustart erhalten
- [ ] Buch importieren (vom Gerät und über Drive)
- [ ] Wort antippen: Popup passt auf den Bildschirm, Wörterbuch + DeepL, speichern, Quizrunde
- [ ] Reader-Leiste läuft nicht über den Rand
- [ ] Lesemodus: Blättern per Tippen links/rechts
- [ ] Zwei-Finger-Tipp wechselt den Modus
- [ ] Markieren mit den Auswahl-Griffen, Farbe, Notiz
- [ ] Einstellungen → Wörterbuch offline speichern, „dauerhafter Speicher“ ansehen
- [ ] Flugmodus: App startet, Buch lesbar, Nachschlagen nur Wörterbuch mit Hinweis, Wort speichern;
      wieder online → DeepL wird nachgeholt
- [ ] „Mit Google verbinden“ in der installierten PWA: Popup geht auf, zurück in die App
- [ ] Abgleich Desktop ↔ Handy: Wort am Desktop speichern, auf beiden „Jetzt abgleichen“
- [ ] Drive lädt ein Buch aus dem Ordner wirklich herunter (auch am Desktop noch offen); scheitert es an
      der CSP, Ziel-Domain von `alt=media` in `connect-src` aufnehmen
Gefundene Fehler hier ergänzen, erledigte Punkte nach oben in den Stand übernehmen.

**Noch nie echt getestet** (nur simuliert bzw. mit generierten Fixtures):
- Google Drive mit echtem Google: Login-Popup in der installierten Android-PWA, Verhalten nach mehr als
  1 h, ob `alt=media`-Downloads auf eine andere Domain umleiten (dann in die CSP `connect-src`), ob Google im
  Status „Testen“ alle 7 Tage neu fragt
- Zwei-Finger-Tipp und Markieren per Auswahl-Griffen auf einem echten Android-Tablet (nur Unit-Test des
  Gesten-Automaten bzw. Desktop-Chrome)
- echter Copy-Paste-Durchgang mit claude.ai
- echtes zweispaltiges PDF-Paper (Phase-0-Entscheidung: foliate-js-PDF reicht vorerst; Ausweg wäre
  `pdfjs-dist` hinter einem Reader-Adapter)
- Installation als PWA auf Android

**Phase 2 (offen):**
- gespeicherte Wörter im Text farbig markieren (CSS Custom Highlight API wie bei den Markierungen, Status-Farben
  wie LingQ)
- Quiz-Typen Multiple Choice (nutzt `distractors` von Claude, sonst Wörter gleicher Wortart),
  Eintippen mit Levenshtein-Toleranz
- weitere Claude-Vorlagen (Quizrunde, Fachglossar pro Paper, Mini-Geschichte, „Satz erklären“)
- Dubletten zusammenführen, Anki-Export
- Drive: geänderte Dateien neu laden, Einstellungen mit Zeitstempel abgleichen, Abgleich ohne Tippen
  (Refresh-Token über eine Server-Funktion)

**Phase 3:** Statistik (Vergessenskurven, Serien), Kapitel-Vorschau (unbekannte Wörter vorab lernen),
Schwierigkeitswert pro Buch, Sync (JSON/WebDAV), optionale kostenlose Live-KI.

Der ausführliche ursprüngliche Plan mit Recherche, Quellen und Feature-Ideen: `docs/plan.md`
(Stand bei Projektstart; die Abschnitte oben sind aktueller).
