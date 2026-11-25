# Architektur im Detail

Ausführliche Notizen pro Modul: Entscheidungen, Gründe, Zusammenspiel. `CLAUDE.md` enthält nur den Überblick
und die Regeln, die man nie brechen darf. Vor Änderungen an einem Modul den passenden Abschnitt hier lesen,
nach Änderungen hier nachtragen.

- Vite 8 + React 19 + TS (strict), Hash-Router in `src/router.ts`, keine UI-Bibliothek, CSS in `src/styles.css`
  (CSS-Variablen, Hell/Dunkel).
- **Logo und Design:** Quellen in `images/*.svg` (nachgezeichnet vom Nutzer; die PNG-Vorlagen liegen nur lokal). `scripts/make-icons.mjs` macht
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
  über Zeilen hinweg). Ein PDF-Textlayer hat keine Absätze: `buildBlockText` liest sie aus der Geometrie
  (`lineStep`: andere Schriftgröße, Leerraum, Sprung gegen die Leserichtung → ` `; ein `<br>` wird dabei
  ersetzt, nicht ergänzt, damit Offsets gespeicherter Markierungen gleich bleiben). Bindestrich am Zeilenende
  bleibt, wenn der Text das Wort (oder eine verwandte Form) sonst mit Bindestrich schreibt
  (`hyphenatedWords`: „fine-⏎tuned“ → „fine-tuned“, „statis-⏎tical“ → „statistical“). `src/lookup/LookupSheet.tsx` zeigt zuerst das Wörterbuch; DeepL nur aus dem Cache
  (`cachedTranslation`, kostet nichts) oder je nach Setting `deeplMode`: `manual` (Standard, Knopf „+ DeepL“),
  `fallback` (Wort ohne Wörterbuch-Eintrag), `always`. Das Setting wird im Popup per `getSettings()` gelesen, weil
  `useSettings()` direkt nach dem Mounten noch die Defaults liefert. Kommt DeepL erst nach dem Speichern
  (Auto-Speichern), zieht `applyContextTranslation` (`src/db/repo.ts`, auch von `pending.ts` genutzt) Kontext und
  Wort nach, solange dort noch der Wörterbuch-Ersatz steht.
- **Satz übersetzen:** Im Übersetzen-Modus wird eine Auswahl über 6 Wörter/80 Zeichen zur Passage
  (`passageFromSelection` in `selection.ts`, Kontext = bis 800 Zeichen davor/danach) und öffnet
  `src/lookup/PassageSheet.tsx`: DeepL auf Knopfdruck (bei `always` sofort), max. 1500 Zeichen (Server-Grenze),
  nichts in die Vokabeln. „Markieren“ speichert die Auswahl als Markierung mit der Übersetzung als Notiz
  (`saveMark(…, note)` in `ReaderView.tsx`). Mit der Maus bleibt die native Auswahl stehen, solange das Popup offen
  ist; am Touch-Gerät gibt es keine native Auswahl (siehe Reader-Modi).
- **Rückmeldung beim Speichern:** `LookupSheet` ersetzt „Speichern“ durch das grüne Abzeichen „✓ Gespeichert“
  (`saved-state`) und meldet Speichern/Ignorieren per Knopf über `onSaved` an den Toast des Readers
  (`reader-toast`); Auto-Speichern toastet absichtlich nicht. Fehler beim Speichern stehen im Popup.
- **Popups beim Zoomen:** Alle Sheets und der Toast des Readers liegen in `.overlay-layer`, das per
  `--vv-*`-Variablen (`trackVisualViewport` in `src/util/visualViewport.ts`) genau den sichtbaren Ausschnitt
  (Visual Viewport) abdeckt und mit `scale(1 / --vv-scale)` die Pinch-Zoom-Vergrößerung aufhebt. `.sheet` ist darum
  `position: absolute` (nicht `fixed`) mit Höhen in `%`. Nebeneffekt: Die Android-Tastatur (verkleinert seit
  Chrome 108 nur den Visual Viewport) verdeckt das Popup nicht. Neue Sheets im Reader in diese Ebene legen.
- **Grundform:** `src/nlp/lemmatize.ts` mit compromise, **asynchron** (compromise wird erst beim ersten
  Nachschlagen geladen, spart ~340 kB beim Start).
- **DeepL:** Browser → `/api/translate` → `server/translate.ts` → DeepL. Derselbe Handler läuft als
  Cloudflare Pages Function (`functions/api/translate.ts`) und als Vite-Middleware (dev und preview,
  `vite.config.ts`). Wort geht als `text`, Satz als `context` (wird nicht abgerechnet). Free-Keys enden
  auf `:fx` → `api-free.deepl.com`. Optionales `APP_TOKEN` als Header `x-app-token`.
  Client `src/translate/deepl.ts` cached in `translationCache` und fasst gleichzeitige gleiche Anfragen zusammen.
  **Eigener Key pro Gerät:** Setting `deeplKey` (in `LOCAL_SETTING_KEYS`, also nie in Sicherung/Drive) geht als
  Header `x-deepl-key` mit und ersetzt auf dem Server `DEEPL_API_KEY` (Formatprüfung, sonst 400). Antwort sagt
  `keySource: 'own' | 'server'`. `DEEPL_REQUIRE_OWN_KEY=1` → ohne eigenen Key 403, der Server-Key wird nie benutzt.
  Der Übersetzungs-Cache ist davon unabhängig.
  Scheitert DeepL beim Speichern, bekommt der Kontext `deeplPending: true` (kein Index, daher ohne
  Schema-Version); `src/translate/pending.ts` holt das nach (App-Start, `online`-Event, nächster
  erfolgreicher Lookup, Knopf in den Einstellungen) und ersetzt `Term.translation` nur, solange dort
  noch der Wörterbuch-Ersatz von damals steht.
- **App installieren:** `src/pwa/install.ts` fängt `beforeinstallprompt` ab (`initInstallPrompt()` in `main.tsx`,
  vor dem ersten Render, sonst ist das Ereignis schon vorbei), unterdrückt damit Chromes eigenes Banner und spielt
  den Dialog per Knopf ab (`InstallButton`: leere Bibliothek, Einstellungen → „App“). Ein Ereignis taugt nur für einen
  Dialog; lehnt man ab, schickt Chrome später ein neues. Installiert erkennt die App an `display-mode: standalone`
  bzw. `appinstalled`. Firefox und Safari kennen das Ereignis nicht, dort steht nur ein Hinweis auf das Browsermenü.
- **Updates übernehmen:** `src/pwa/update.ts` (`initAutoUpdate()` in `main.tsx`) registriert den Service Worker
  über `virtual:pwa-register` statt über das von vite-plugin-pwa eingefügte `registerSW.js` (`injectRegister: false`).
  Dieses Skript registrierte nur: Der neue Worker übernahm im Hintergrund, die offene Seite lief aber mit altem Code
  weiter, bis sie neu geladen wurde, und Android hält Tab und installierte App tagelang am Leben (so ein Handytest
  am 24.11.2026 mit dem alten, abgeschnittenen Popup). Jetzt: Update-Prüfung beim Zurückkehren in die App
  (`visibilitychange`, höchstens einmal pro Minute) und stündlich, danach neu laden, sobald die neue Version aktiv
  ist (`onNeedReload`). Neu geladen wird sofort, wenn die App im Hintergrund liegt oder höchstens 10 s geöffnet bzw.
  zurück ist und kein Eingabefeld den Fokus hat, sonst erst beim nächsten Wechsel in den Hintergrund. 1 s Verzögerung,
  damit die Leseposition (600 ms entprellt) noch gespeichert wird. **Achtung:** Mit `injectRegister: false` setzt das
  Plugin `skipWaiting`/`clientsClaim` nicht mehr selbst, darum stehen sie ausdrücklich unter `workbox` in
  `vite.config.ts`; ohne sie würde eine neue Version nie aktiv.
- **Passwortschutz:** `server/auth.ts` (`authGate`), als Pages-Middleware `functions/_middleware.ts` vor
  allen Anfragen und in `vite.config.ts` vor dev/preview. Aus, solange `APP_PASSWORD` fehlt. Cookie
  `vr_session` = `v1.<ablauf>.<HMAC mit dem Passwort>`, 400 Tage, verlängert sich unter 200 Tagen Rest.
  Seiten ohne Sitzung → 303 auf `/login`, alles andere → 401-JSON mit `login: '/login'` (Client zeigt
  „Anmelden“-Link). Manifest und Icons bleiben öffentlich (Chrome holt das Manifest ohne Cookies).
  `/datenschutz` (`privacyPage()`) liefert das Gate immer selbst aus, auch ohne `APP_PASSWORD`: Google braucht
  die URL, um die OAuth-App auf „In Produktion“ zu stellen. In der App absichtlich nirgends verlinkt, ohne
  persönliche Angaben (Repo öffentlich). Bei neuen Datenflüssen den Text anpassen (Gemini steht schon drin).
  **Fehlversuche** begrenzt `server/loginLimit.ts` (`loginLimiter`): 5 pro Stunde ab dem ersten, pro IPv4 bzw.
  IPv6-/64 (`clientKey`), dann 429 + `Retry-After` ohne Passwortprüfung, Erfolg löscht den Zähler. IP aus
  `cf-connecting-ip` (Cloudflare) bzw. `opts.ip` = Socket-Adresse (Vite). Zähler in KV (Binding `LOGIN_ATTEMPTS`,
  nur im Dashboard gebunden, kein `wrangler.toml`), im Vite-Server `memoryAttemptStore()`. Fehlt der Store oder
  wirft KV (Free: 1000 Schreibvorgänge/Tag), geht es ohne Begrenzung weiter: nie den Besitzer aussperren.
- **Wörterbuch:** `src/dict/dictionary.ts` lädt Shards nach Bedarf; `index.json` listet alle Shards, ein
  Wort aus einem nicht gelisteten Shard ist also „kein Eintrag“, ein nicht ladbarer Shard „nicht
  verfügbar“ (`lookupKey` → `null`, Popup zeigt Hinweis). `downloadDictionary` legt alles in den Cache
  `dict`, denselben, den der Service Worker für `/dict/` nutzt (Namen synchron halten). Ohne aktiven
  Service Worker (dev, erster Besuch) liest `fetchJson` offline direkt über `caches.match`.
- **Reader-Modi** (`src/reader/modes.ts`): `read` / `translate` / `mark`, Setting `readerMode` (in
  `LOCAL_SETTING_KEYS`, also pro Gerät). `attachReaderHandlers` in `selection.ts` verteilt Tippen/Auswahl nach Modus;
  Zwei-Finger-Tipp über den reinen `createGestureTracker` (Taps der beteiligten Finger werden verworfen).
  Lesemodus blättert per Drittel (`tapZone`, x über `frameElement` in Fensterkoordinaten umgerechnet).
  **Links gelten nur im Lesemodus:** sonst schlägt ein Tipp auf einen Link das Wort nach. `ReaderView` bricht
  foliates abbrechbare Ereignisse `link`/`external-link` ab; im PDF liegt der Link als leere Box über dem Text,
  darum macht `prepareDocument` den `.annotationLayer` durchlässig, solange `html[data-vr-mode]`
  (`setDocumentMode`, folgt dem Setting) nicht `read` ist.
  **Eigene Touch-Auswahl:** Nach einem Finger-`pointerdown` lehnt `attachReaderHandlers` außerhalb des Lesemodus
  `selectstart` und `contextmenu` ab (keine native Auswahl, also keine Griffe, kein Android-Menü mit „Websuche“,
  kein Chrome „Touch to Search“). Stattdessen: Wort 450 ms gedrückt halten (`LONG_PRESS_MS`, Automat
  `createPressTracker`), dann ziehen; `extendSelection` erweitert wortweise im Sektionstext, gezeichnet mit dem
  Highlight `vr-lookup`. Der `touchmove`-Listener sitzt in der Capture-Phase am Fenster des Buchs und stoppt das
  Ereignis, sonst blättert foliates Paginator mit. Loslassen → `hitFromRange` bzw. `passageFromRange` bzw.
  `onMarkSelection(span)`. Maus, programmatische Auswahl und Lesemodus behalten die native Auswahl.
  Welcher Bereich gerade `vr-lookup` trägt (Wort, Passage, wartende Markierung), setzt ein Effekt in
  `ReaderView` aus dem Zustand, nicht die einzelnen Handler.
- **Markierungen** (`src/reader/highlights.ts`, Tabelle `highlights`): verankert über Offsets im Text von
  `buildBlockText(doc.body)` der Sektion (PDF: Seite) plus `text`; passt der Text nicht mehr, gilt das nächste
  Vorkommen. `cfi` nur zum Hinspringen. Gezeichnet mit der CSS Custom Highlight API (`vr-hl-<farbe>`,
  `vr-hl-note`), **nicht** mit foliates Overlayer (den hat der PDF-Renderer nicht). Ein `MutationObserver` malt
  neu, weil der PDF-Textlayer erst nach `load` (und bei jedem Zoom neu) entsteht. `renderer.getContents()` liefert
  bei PDFs keinen Index, darum merkt sich `ReaderView` Dokument → Sektion selbst. Löschen = `deleted: true` +
  `updatedAt` (kein Grabstein), `mergeBackup` nimmt je `id` das neuere `updatedAt`.
- **Claude-Anreicherung:** `src/enrich/templates.ts` (Prompt + zod-Schema), `importResponse.ts`
  (JSON aus Antwort holen, abgeschnittene Arrays reparieren, pro Eintrag prüfen), `apply.ts`. `applyEnrichment`
  ersetzt `Term.translation` automatisch, wenn sie leer ist oder einem Wörterbuch-Sinn aus `dictSenses` gleicht
  (`translationFromDictionary`, roh oder per `plainSense`); sonst nur mit dem Haken „auch übernehmen“.
  Kein eigenes Herkunftsfeld, damit greift es auch für alte Wörter.
  **Gemini (optional)**: `gemini.ts` (`askGemini`) ruft `generateContent` der Gemini-API direkt aus dem Browser
  (CORS erlaubt, kein Proxy) mit dem Gerät-Key `geminiKey` (in `LOCAL_SETTING_KEYS`) als Header
  `x-goog-api-key`, nie als `?key=`. Modell aus `geminiModel` (Standard `gemini-flash-lite-latest`, größtes
  Gratis-Kontingent), `responseMimeType: application/json`. `EnrichView` baut den Prompt für „Mit Gemini
  anreichern“ jedes Mal neu aus den ids des offenen Durchgangs (nach teilweisem Übernehmen geht nur der Rest
  raus) und prüft die Antwort mit demselben `parseEnrichResponse` wie eine eingefügte; der packt auch
  `{"words": [...]}` aus. Fehlertexte (429 Kontingent, Key, Modell) auf Deutsch in `gemini.ts`. Bewusst kein
  Server-Key: Googles Bedingungen verlangen für Apps mit Nutzern im EWR den bezahlten Tarif. CSP `connect-src`
  und `privacyPage()` sind ergänzt.
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

