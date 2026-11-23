<p align="center"><img src="public/brand/blatt-reader.svg" alt="Blatt-Reader" width="420"></p>

# Blatt-Reader

EPUB- und PDF-Reader zum Englischlernen. Ein Tipp auf ein Wort zeigt den Eintrag aus dem
Offline-Wörterbuch und die DeepL-Übersetzung im Satzkontext. Gespeicherte Wörter landen mit dem
Originalsatz in einer lokalen Datenbank und werden per Quiz mit Spaced Repetition (FSRS) abgefragt.
Erklärungen, Beispielsätze und Quiz-Ablenker ergänzt Claude per Copy-Paste, ganz ohne API-Kosten.

Läuft als installierbare Web-App (PWA) am Linux-Desktop, auf Android und im Browser.

## Bausteine

| Teil | Wofür | Lizenz |
|---|---|---|
| [foliate-js](https://github.com/johnfactotum/foliate-js) (Git-Submodule in `public/foliate-js`) | EPUB/MOBI/FB2/CBZ/PDF anzeigen | MIT (PDF.js: Apache-2.0) |
| Ding EN↔DE ([TU Chemnitz](https://dict.tu-chemnitz.de/)) | Offline-Wörterbuch, wird lokal erzeugt, nicht im Repo | GPL-2.0+ |
| DeepL API Free | Übersetzung im Kontext (500.000 Zeichen/Monat gratis; der Kontext-Satz zählt nicht, ein übersetzter Satz zählt voll) | – |
| Google Drive API (optional) | Bücherordner und Lernstand zwischen Geräten abgleichen (gratis, ohne Abrechnungskonto) | – |
| ts-fsrs, Dexie, compromise, zod, React | Quiz-Planung, Datenbank, Grundformen, Prüfung der Claude-Antworten, Oberfläche | MIT / Apache-2.0 |

## Lokal starten

```bash
git submodule update --init      # foliate-js holen
npm install
npm run build:dict               # Ding-Wörterbuch laden und nach public/dict/ umwandeln (~30 MB)
cp .env.example .env             # DEEPL_API_KEY eintragen (Free-Keys enden auf ":fx")
npm run dev                      # http://localhost:5173
```

Ohne DeepL-Key funktioniert alles außer der Kontext-Übersetzung; das Popup zeigt dann nur das
Wörterbuch. Den Key bekommst du unter <https://www.deepl.com/pro-api> (Plan „DeepL API Free“).

**Am Handy im WLAN testen:** `npm run dev` zeigt eine „Network“-Adresse (z. B. `http://192.168.1.135:5173`).
Über plain http gibt es keine Installation als App und keinen Zugriff auf die Zwischenablage;
dafür die Online-Variante unten nehmen.

## Online stellen (Cloudflare Pages, kostenlos)

DeepL blockiert Aufrufe direkt aus dem Browser. Darum läuft `/api/translate` als kleine
Cloudflare Pages Function (`functions/api/translate.ts`), die den Key geheim hält.
Davor sitzt ein Passwortschutz für die ganze App (`functions/_middleware.ts`).

Einmal einrichten, und zwar in dieser Reihenfolge: erst Projekt und Secrets, dann hochladen. So ist
die App nie ohne Passwort online. `<projekt>` ist ein frei gewählter Name, die App liegt danach unter
`https://<projekt>.pages.dev`.

```bash
npx wrangler login
npx wrangler pages project create <projekt> --production-branch main
npx wrangler pages secret put DEEPL_API_KEY --project-name <projekt>
npx wrangler pages secret put APP_PASSWORD --project-name <projekt>   # langes Passwort, z. B. vier Wörter
npx wrangler kv namespace create LOGIN_ATTEMPTS                        # zählt Fehlversuche beim Anmelden
```

Den KV-Namespace dann im Cloudflare-Dashboard ans Projekt binden: **Workers & Pages → `<projekt>` →
Einstellungen → Bindungen → Hinzufügen → KV-Namespace**, Variablenname `LOGIN_ATTEMPTS`, Namespace
`LOGIN_ATTEMPTS`. Ohne diese Bindung läuft alles, nur ohne Begrenzung der Anmeldeversuche.

Danach bei jedem neuen Stand:

```bash
npm run build:dict && npm run build      # build:dict nur beim ersten Mal bzw. nach neuem Ding
npx wrangler pages deploy dist --project-name <projekt> --branch main
```

`wrangler pages deploy` im Projektordner lädt den Ordner `functions/` automatisch mit hoch. Ein
geändertes Secret gilt erst ab dem nächsten Deploy.

Vor dem ersten Deploy lässt sich alles lokal in der echten Cloudflare-Laufzeit prüfen:
`npx wrangler pages dev dist --binding APP_PASSWORD=test --kv LOGIN_ATTEMPTS` (DeepL-Key und `APP_TOKEN` liest
wrangler aus `.env`).

**Passwortschutz:** Ist `APP_PASSWORD` gesetzt, liefert Cloudflare ohne Anmeldung nur eine
Anmeldeseite aus, keine App, kein Wörterbuch und keine Übersetzung. Nach der Anmeldung bleibt das
Gerät 400 Tage angemeldet; bei Benutzung verlängert sich das von selbst. Abmelden: `/logout` aufrufen.
Ein neues Passwort meldet alle Geräte ab. Öffentlich bleiben nur Manifest und Icons, die Chrome zum
Installieren braucht, und das Hintergrundmuster der Anmeldeseite. Ohne `APP_PASSWORD` ist die App für jeden offen, der die Adresse kennt; dann
wenigstens `APP_TOKEN` setzen (und in der App unter **Einstellungen → App-Token** eintragen), damit
niemand dein DeepL-Kontingent verbraucht.

**Eigener DeepL-Key pro Gerät:** Wer die App mitbenutzt, kann unter **Einstellungen → Übersetzung →
Eigener DeepL-Key** einen eigenen (kostenlosen) Key eintragen. Dann übersetzt DeepL auf diesem Gerät mit
diesem Key und rechnet bei dessen Konto ab, nicht beim Server-Key. Der Key liegt nur auf dem Gerät (nicht in
Sicherungen, nicht im Drive-Abgleich) und geht bei jeder Übersetzung als Kopfzeile `x-deepl-key` an
`/api/translate`, das ihn an DeepL weiterreicht, ohne ihn zu speichern. Mit dem Secret
`DEEPL_REQUIRE_OWN_KEY=1` nimmt der Server seinen eigenen Key nie: Jedes Gerät braucht dann einen eigenen,
und `DEEPL_API_KEY` kann ganz fehlen.

**Fehlversuche:** Pro IP-Adresse (bei IPv6 pro /64-Netz) sind 5 falsche Passwörter in einer Stunde
erlaubt, gezählt ab dem ersten Fehlversuch. Danach lehnt die Anmeldeseite bis zum Ende dieser Stunde
alles ab, auch das richtige Passwort, ohne es zu prüfen (Antwort 429). Eine erfolgreiche Anmeldung setzt
den Zähler zurück. Alle Geräte im selben WLAN teilen sich meist eine Adresse; schon angemeldete Geräte
merken von einer Sperre nichts. Cloudflares eigene Rate-Limiting-Regeln gibt es nur für eigene Domains,
nicht für `….pages.dev`, darum zählt die App selbst (`server/loginLimit.ts`, KV-Namespace `LOGIN_ATTEMPTS`).

Immer mit `--branch main` deployen: Andere Branches landen als Vorschau unter einer eigenen Adresse,
und dort fehlen die Secrets, also auch der Passwortschutz.

**Auf Android installieren:** die `https://…`-Adresse in Chrome öffnen, anmelden → Menü →
„App installieren“. Bücher und Vokabeln liegen pro Gerät im Browser-Speicher; abgleichen geht
automatisch über [Google Drive](#google-drive-optional) oder von Hand mit
**Einstellungen → Sicherung herunterladen / einspielen**.
Die Daten hängen an der Adresse: Wer später von `….pages.dev` auf eine eigene Domain wechselt,
nimmt den Lernstand per Sicherung mit.

## Google Drive (optional)

Ein Ordner in Google Drive wird zur Quelle für Bücher, und Vokabeln, Lernstand und Lesefortschritt
bleiben auf allen Geräten gleich:

- **Bücher:** Neue EPUBs und PDFs im Ordner (auch in Unterordnern) lädt die App beim Abgleich
  automatisch herunter. Danach liegen sie komplett auf dem Gerät und sind auch offline und ohne Drive
  lesbar. In Drive löschen ändert in der App nichts. Ein in der App entferntes Buch kommt nicht wieder,
  bis du **Einstellungen → Google Drive → Wieder laden** tippst. Ändert sich eine Datei in Drive nach dem
  Import, lädt die App sie nicht neu.
- **Lernstand:** liegt als `vokabel-reader-sync.json` im Ordner „Blatt-Reader“ (vor der Umbenennung angelegt: „Vokabel-Reader“, der Ordner wird weiter benutzt). Beim Abgleich wird
  zusammengeführt: das zuletzt geänderte Wort und die zuletzt geübte Karte gewinnen, Sätze und
  Wiederholungen werden vereinigt, gelöschte Wörter bleiben gelöscht. Einstellungen bleiben pro Gerät.
- **Wann:** beim Start der App, wenn das Gerät wieder online ist, nach einer Quizrunde und mit
  **Jetzt abgleichen**. Google gibt der App nur für etwa eine Stunde Zugriff; danach zeigt die Bibliothek
  **Mit Google Drive abgleichen**. Ein Tippen genügt (das Google-Fenster schließt sich meist von selbst).
- **Berechtigungen:** Die App darf deine Drive-Dateien lesen und nur Dateien ändern, die sie selbst
  angelegt hat (Ordner „Blatt-Reader“, Sync-Datei). Löschen kann sie nichts.

**Einmal einrichten (ca. 10 Minuten, kostenlos).** Ausführlich und mit Hilfe bei Fehlermeldungen in
[`docs/google-drive-einrichten.md`](docs/google-drive-einrichten.md), hier die Kurzfassung:

1. <https://console.cloud.google.com> → neues Projekt (z. B. „Blatt-Reader“) → **APIs & Dienste →
   Bibliothek → „Google Drive API“ aktivieren**. Ein Abrechnungskonto ist nicht nötig.
2. **Google Auth Platform → Branding / Zielgruppe:** App-Name eintragen, Nutzertyp **Extern**, Status
   **Testen**, unter „Testnutzer“ die eigene Google-Adresse eintragen.
3. **Clients → Client erstellen → Webanwendung.** Unter „Autorisierte JavaScript-Quellen“:
   `https://<projekt>.pages.dev` (bzw. die eigene Domain), `http://localhost:5173`,
   `http://localhost:5179`, `http://localhost:4179`. Weiterleitungs-URIs braucht es keine.
4. Die Client-ID (`….apps.googleusercontent.com`) in `.env` als `VITE_GOOGLE_CLIENT_ID=…` eintragen.
   Sie ist öffentlich und kein Secret; `npm run build` baut sie in die App ein, also danach neu bauen
   und deployen.
5. In der App: **Einstellungen → Google Drive → Mit Google verbinden**. Google warnt „Diese App wurde
   nicht von Google überprüft“: **Erweitert → Weiter zu …** und beide Häkchen setzen. Das ist bei
   privaten Projekten normal.

Danach legt die App in „Meine Ablage“ den Ordner **Blatt-Reader** an; Bücher einfach dort hineinlegen.
Einen anderen Ordner wählst du unter **Einstellungen → Google Drive** über seinen Namen (genau wie in
Drive geschrieben) oder seinen Link (in Drive: Ordner → Teilen → Link kopieren). Gibt es mehrere Ordner
mit dem Namen, braucht es den Link. Die anderen Geräte übernehmen die Wahl beim nächsten Abgleich.

Grenzen: Eine LAN-Adresse wie `http://192.168.…` lässt Google nicht zu, am Handy also erst nach dem
Deploy. Fragt Google im Status „Testen“ alle 7 Tage neu nach, den Status auf **In Produktion** stellen
(geht ohne Überprüfung, die Warnung bleibt).

## Offline

Nach dem ersten Öffnen startet die App auch ohne Netz. Lesen, Quiz, Speichern und die Vokabelliste
laufen lokal. Ohne Netz fehlen nur:

- **DeepL**: Wörter, die du offline speicherst, bekommen ihre Übersetzung später automatisch
  (beim nächsten Start, sobald das Gerät wieder online ist, oder unter **Einstellungen → Jetzt nachholen**).
- **Teile des Wörterbuchs**, die noch nie geladen wurden. **Einstellungen → Ganzes Wörterbuch offline
  speichern** lädt alles auf einmal (ca. 30 MB, am besten im WLAN; geht nur über https).

Unter **Einstellungen → Daten** steht, ob der Browser den Speicher als dauerhaft führt. Sonst darf er
Bücher und Vokabeln bei Platzmangel löschen; Chrome erlaubt das meist erst bei installierter App.

## Mit Claude anreichern (ohne API)

1. **Anreichern → Prompt kopieren & Claude öffnen**: Die App kopiert einen Prompt mit bis zu 30 neuen Wörtern samt Satz.
2. In Claude.ai (oder ChatGPT) einfügen und abschicken.
3. Claudes Antwort (den ```json-Block) kopieren, in der App einfügen, **Prüfen**, dann **Übernehmen**.

Claudes Übersetzung im Satzkontext ersetzt eine Übersetzung, die nur aus dem Wörterbuch stammt (gespeichert
ohne „+ DeepL“), automatisch. DeepL- oder selbst getippte Übersetzungen bleiben, außer du hakst „Claudes Übersetzung
auch übernehmen …“ an; die Vorschau zeigt, was ersetzt wird.

Fehlerhafte oder fehlende Einträge zeigt die App an; „Korrektur-Prompt kopieren“ fragt Claude
gezielt nach genau diesen. Abgeschnittene Antworten werden repariert, soweit die Einträge vollständig sind.

## Bedienung

- **Modi** (Knopf oben rechts zeigt den aktuellen, ein Tipp schaltet weiter; Tasten `l` / `u` / `m`; am Tablet ein
  Tipp mit **zwei Fingern** ins Buch; der farbige Rand oben zeigt den Modus):
  - 🔤 **Übersetzen** (Standard): **Wort antippen/anklicken** schlägt im Offline-Wörterbuch nach, sofort und
    gratis. **„+ DeepL“** holt die Übersetzung im Satzkontext dazu. **Mehrere Wörter auswählen** (bis 6): Phrase
    nachschlagen (z. B. Phrasal Verbs). **Einen Satz oder mehr auswählen**: eigenes Popup, „+ Mit DeepL übersetzen“
    zeigt die Übersetzung (kommt nicht in die Vokabeln), „Markieren“ legt sie als Notiz einer Markierung ab.
  - Wann DeepL von selbst fragt, steht unter **Einstellungen → DeepL abfragen**: nur auf Knopfdruck (Standard),
    wenn das Wörterbuch nichts findet, oder immer (dann auch für Sätze). Schon einmal Übersetztes kommt immer
    kostenlos aus dem Cache.
  - 📖 **Lesen**: Tippen löst nichts aus, nur das linke bzw. rechte Drittel blättert zurück/weiter.
  - 🖍 **Markieren**: Wort antippen markiert es sofort; Text auswählen (beliebig lang, auch über Absätze) und dann
    eine Farbe antippen. Eine Markierung antippen: Farbe ändern, Notiz, Löschen, Nachschlagen. ☰ oben listet alle
    Markierungen des Buchs, ein Tipp springt hin. Markierungen kommen mit in die Sicherung und den Drive-Abgleich.
- **Speichern** legt das Wort mit Satz an; erneutes Nachschlagen in einem anderen Satz fügt einen weiteren Kontext hinzu.
- **Ignorieren** für Namen u. Ä.: Das Wort kommt nicht ins Quiz.
- Blättern: Pfeiltasten, Wischen oder die Pfeile am Rand. Bei PDFs schaltet ⇔ zwischen ganzer Seite und voller Breite um.
- **Quiz**: Leertaste zeigt die Antwort, 1–4 bewerten (Nochmal/Schwer/Gut/Einfach). Kartentypen in den Einstellungen.
- **Quiz pro Buch**: oben im Quiz ein Buch wählen oder in der Bibliothek unter dem Buch auf „Quiz“ tippen.
  Abgefragt werden nur Wörter, die du in diesem Buch gespeichert hast. Der Lernstand bleibt pro Wort gemeinsam:
  Ein Wort aus zwei Büchern, das du über Buch A wiederholt hast, ist auch in Buch B erst später wieder dran.
  Das Tageslimit für neue Karten gilt für alle Quizze zusammen. Die Vokabelliste lässt sich ebenso nach Buch filtern.
- **Einstellungen → Wiederholungen als CSV**: ein Review pro Zeile, z. B. für Vergessenskurven in R.

## Tests

```bash
npm test                          # Unit-Tests (Vitest)
npm run e2e                       # End-to-End gegen den Dev-Server (Playwright, Test-EPUB/-PDF werden erzeugt)
npm run build && E2E_PREVIEW=1 npm run e2e   # dasselbe gegen den Produktions-Build, inkl. CSP- und Passwort-Test
```

Einmalig vorher: `npx playwright install chromium`.

## Sicherheit

EPUBs können JavaScript enthalten. Im Produktions-Build verhindert eine Content-Security-Policy,
dass solche Skripte laufen (ein Test prüft das). Im Dev-Modus gibt es diese Sperre nicht,
dort also nur Bücher aus vertrauenswürdigen Quellen öffnen.

## Logo und Design

Die Originale liegen in `images/`: rundes Logo und Logo mit Schriftzug, je als SVG. Daraus erzeugt

```bash
node scripts/make-icons.mjs
```

alles, was die App braucht (Kreis und Ring dabei als exakte Kreise, Blatt und Schriftzug aus der Vorlage):

| Datei | Wofür |
|---|---|
| `src/brand/logoPaths.ts` | Pfade für die Logo-Komponenten in `src/brand/Logo.tsx` (generiert, nicht von Hand ändern) |
| `public/icon.svg` | Symbol im Browser-Tab |
| `public/icon-192.png`, `icon-512.png` | App-Icon, rund |
| `public/icon-maskable-512.png`, `apple-touch-icon.png` | randlos navy, Android und iOS schneiden selbst zu |
| `public/brand/pattern.svg` | Kachel für das Blatt-Wasserzeichen im Hintergrund |
| `public/brand/blatt-reader.svg` | Logo mit Schriftzug (README, zum Teilen) |

**Farben:** Navy `#141f2d` und Creme `#e6dfca` aus dem Logo. Hell: Creme-Papier (`#f4efe3`) mit Navy-Schrift,
dunkel: Navy (`#0f1722`) mit Creme-Schrift. Alle Farben stehen als CSS-Variablen oben in `src/styles.css`;
die Anmeldeseite (`server/auth.ts`) hat eine eigene Kopie der Palette.

**Wo das Logo steht:**

- Rundes Logo: App-Icon und Browser-Tab, Reader-Leiste links (führt zur Bibliothek), leere Bibliothek,
  Ladeanzeige beim Öffnen eines Buchs. Bücher ohne Cover bekommen einen Navy-Einband mit dem Blatt.
- Logo mit Schriftzug: Kopfleiste (am Handy nur das runde Logo), Anmeldeseite, Fuß der Einstellungen, diese README.
- Wasserzeichen: das Blatt, sehr blass und gekachelt, hinter allen Seiten und der Anmeldeseite. Im Reader
  absichtlich nicht, damit der Buchtext ruhig bleibt.

**Name:** Bis November 2026 hieß die App „Vokabel-Reader“. Interne Kennungen (Datenbank im Browser, Kennung in
Sicherungsdateien, `vokabel-reader-sync.json` in Drive) heißen weiter so, damit vorhandene Daten und
Sicherungen passen. Ein schon angelegter Drive-Ordner „Vokabel-Reader“ wird weiter benutzt.

## Aufbau

```
functions/_middleware.ts     Passwortschutz → server/auth.ts + loginLimit.ts (auch im Vite-Dev-/Preview-Server)
functions/api/translate.ts   Cloudflare Pages Function → server/translate.ts (auch im Vite-Dev-Server)
scripts/build-dictionary.mjs Ding → public/dict/en-de/<shard>.json
scripts/make-icons.mjs       images/*.svg → Logo-Pfade, Icons, Wasserzeichen
src/brand/                   Logo-Komponenten (rund, Schriftzug, Blatt)
src/reader/                  foliate-js einbinden, Wort/Satz unter dem Finger finden, Modi, Markierungen
src/dict/                    Wörterbuch nachschlagen, komplett offline speichern
src/lookup/                  Popup: Wörterbuch + DeepL, Speichern
src/translate/               DeepL-Client, offline gespeicherte Wörter nachübersetzen
src/drive/                   Google-Login, Drive-Client, Bücher laden, Lernstand abgleichen
src/enrich/                  Prompt bauen, Claude-Antwort prüfen und übernehmen
src/quiz/                    FSRS-Planung und Quiz
src/db/                      Dexie-Schema und Datenzugriff
```

## Lizenz

Der Code dieses Repos steht unter der [MIT-Lizenz](LICENSE). Nicht darunter fallen:

- foliate-js: eigenes Repo, als Git-Submodule eingebunden (MIT, das enthaltene PDF.js Apache-2.0).
- Das Ding-Wörterbuch (GPL-2.0+, Frank Richter, TU Chemnitz): `npm run build:dict` lädt es herunter und
  erzeugt daraus lokal `public/dict/`; es ist nicht im Repo.
- Abhängigkeiten aus npm: jeweils eigene Lizenz (MIT bzw. Apache-2.0, siehe Tabelle oben).
