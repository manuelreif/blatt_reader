# Vokabel-Reader

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
| DeepL API Free | Übersetzung im Kontext (500.000 Zeichen/Monat gratis; der Kontext-Satz zählt nicht) | – |
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

```bash
npx wrangler login
npm run build:dict && npm run build
npx wrangler pages deploy dist --project-name <projekt>
npx wrangler pages secret put DEEPL_API_KEY --project-name <projekt>
npx wrangler pages secret put APP_TOKEN --project-name <projekt>   # beliebiges langes Passwort
```

`wrangler pages deploy` im Projektordner lädt den Ordner `functions/` automatisch mit hoch.
Danach in der App unter **Einstellungen → App-Token** dasselbe Passwort eintragen und **DeepL testen**
drücken. Ohne Token könnte jeder, der die Adresse kennt, dein DeepL-Kontingent verbrauchen.

**Auf Android installieren:** die `https://….pages.dev`-Adresse in Chrome öffnen → Menü →
„App installieren“. Bücher und Vokabeln liegen pro Gerät im Browser-Speicher; mit
**Einstellungen → Sicherung herunterladen / einspielen** überträgst du den Lernstand.

## Mit Claude anreichern (ohne API)

1. **Anreichern → Prompt kopieren & Claude öffnen**: Die App kopiert einen Prompt mit bis zu 30 neuen Wörtern samt Satz.
2. In Claude.ai (oder ChatGPT) einfügen und abschicken.
3. Claudes Antwort (den ```json-Block) kopieren, in der App einfügen, **Prüfen**, dann **Übernehmen**.

Fehlerhafte oder fehlende Einträge zeigt die App an; „Korrektur-Prompt kopieren“ fragt Claude
gezielt nach genau diesen. Abgeschnittene Antworten werden repariert, soweit die Einträge vollständig sind.

## Bedienung

- **Wort antippen/anklicken**: nachschlagen. **Mehrere Wörter markieren**: Phrase nachschlagen (z. B. Phrasal Verbs).
- **Speichern** legt das Wort mit Satz an; erneutes Nachschlagen in einem anderen Satz fügt einen weiteren Kontext hinzu.
- **Ignorieren** für Namen u. Ä.: Das Wort kommt nicht ins Quiz.
- Blättern: Pfeiltasten, Wischen oder die Pfeile am Rand. Bei PDFs schaltet ⇔ zwischen ganzer Seite und voller Breite um.
- **Quiz**: Leertaste zeigt die Antwort, 1–4 bewerten (Nochmal/Schwer/Gut/Einfach). Kartentypen in den Einstellungen.
- **Einstellungen → Wiederholungen als CSV**: ein Review pro Zeile, z. B. für Vergessenskurven in R.

## Tests

```bash
npm test                          # Unit-Tests (Vitest)
npm run e2e                       # End-to-End gegen den Dev-Server (Playwright, Test-EPUB/-PDF werden erzeugt)
npm run build && E2E_PREVIEW=1 npm run e2e   # dasselbe gegen den Produktions-Build, inkl. CSP-Test
```

Einmalig vorher: `npx playwright install chromium`.

## Sicherheit

EPUBs können JavaScript enthalten. Im Produktions-Build verhindert eine Content-Security-Policy,
dass solche Skripte laufen (ein Test prüft das). Im Dev-Modus gibt es diese Sperre nicht,
dort also nur Bücher aus vertrauenswürdigen Quellen öffnen.

## Aufbau

```
functions/api/translate.ts   Cloudflare Pages Function → server/translate.ts (auch im Vite-Dev-Server)
scripts/build-dictionary.mjs Ding → public/dict/en-de/<shard>.json
src/reader/                  foliate-js einbinden, Wort/Satz unter dem Finger finden
src/lookup/                  Popup: Wörterbuch + DeepL, Speichern
src/enrich/                  Prompt bauen, Claude-Antwort prüfen und übernehmen
src/quiz/                    FSRS-Planung und Quiz
src/db/                      Dexie-Schema und Datenzugriff
```
