# Plan: Lese-App mit Übersetzung und Vokabeltrainer (EPUB + PDF)

## Kontext

Ziel ist ein Reader für EPUB und PDF. Man tippt ein englisches Wort oder einen Begriff an und bekommt eine deutsche Übersetzung, die zum Satz passt. Die App merkt sich die Wörter in einer lokalen Datenbank, zeigt sie als Vokabelliste und fragt sie in Quizrunden mit Spaced Repetition ab.

- **Plattformen:** Linux-Desktop, Android/Tablet und Browser.
- **Lesestoff:** EPUB (Bücher) und PDF (Fachliteratur), beide gleich wichtig.
- **Kosten:** keine laufenden Kosten. Chat-Abos enthalten keinen API-Zugang, die API wird separat und im Voraus bezahlt.
- **Ausgangslage:** Der Projektordner ist leer und noch kein Git-Repo.

## Recherche: Worauf aufbauen?

| Projekt | Lizenz / Stack | Was es schon kann | Fazit |
|---|---|---|---|
| **Readest** | AGPL-3, Next.js 16 + Tauri v2, ~26k ★ | Liest EPUB, PDF, MOBI u. a. Hat ein Wörterbuch und Übersetzung über DeepL/Yandex. Läuft auf allen Plattformen. | Es fehlen ein Vokabeltrainer und eine LLM-Anbindung, die Codebasis ist groß. Daher nur als Ideenquelle. |
| **foliate-js** | MIT, reines JS | Die Render-Engine hinter Readest und Foliate: EPUB, MOBI, FB2, CBZ und PDF (über PDF.js, laut README „experimentell“) | **Basis der App** |
| Koodo Reader | AGPL, Electron/React | KI-Übersetzung und KI-Wörterbuch | Kein Vokabelheft gefunden |
| KOReader + assistant.koplugin | AGPL, Lua | Vocabulary Builder mit SRS und KI-Übersetzung | Nur für E-Ink-Reader |
| Jorkens | Electron, epub.js | Reader für Sprachlernende mit Anki-Export | Nur EPUB, kein SRS |
| Lute v3 | MIT, Python/Flask | Begriffs-Datenbank mit Status-Stufen (LingQ-Stil) | Inspiration für den Wort-Status |
| **ts-fsrs** | MIT | FSRS-v6-Scheduler, derselbe Algorithmus wie in Anki | **Für das Quiz** |

**Entscheidung:** eine eigene App auf Basis von foliate-js. Aus den AGPL-Projekten übernehmen wir nur Ideen, keinen Code. Sonst würde die AGPL-Lizenz auf das ganze Projekt übergehen.

## Übersetzen ohne Zusatzkosten: drei Bausteine

Die drei Bausteine arbeiten zusammen. Alles ist kostenlos.

### 1. Offline-Wörterbuch: Grundform, Wortart, mehrere Bedeutungen

- **Quelle:** Ding EN↔DE (TU Chemnitz, GPL) oder der Wiktionary-Auszug von kaikki.org (CC BY-SA).
- **Aufbereitung:** Ein Skript macht daraus einmalig eine kompakte JSON-Datei. Die App lädt sie beim ersten Start in IndexedDB.
- **Grundform:** `compromise` bildet sie („went“ → „go“), damit das Wort im Wörterbuch gefunden wird.
- Die Antwort ist sofort da und funktioniert offline.

### 2. DeepL API Free: Übersetzung im Kontext, beim Lesen sofort

- **Kontingent:** 500.000 Zeichen pro Monat kostenlos.
- **Kontext:** Die App schickt das Wort als `text` und den ganzen Satz als `context`. DeepL wählt damit die passende Bedeutung. Laut DeepL zählen die Zeichen in `context` **nicht** zum Kontingent. Abgerechnet wird also nur das Wort selbst, rund 8 Zeichen. Das reicht für etwa 60.000 Nachschlagungen pro Monat, praktisch unbegrenzt. Ganze Sätze übersetzen geht auch (rund 3.000 Sätze pro Monat).
- **Haken – CORS:** DeepL blockiert Aufrufe direkt aus dem Browser. Es braucht deshalb einen kleinen Vermittler.
- **Lösung:** Die App liegt auf **Cloudflare Pages** (kostenlos). Dazu kommt eine Pages Function `functions/api/translate.ts` mit etwa 30 Zeilen. Sie hält den DeepL-Key geheim auf dem Server und leitet die Anfrage weiter. Weil App und Funktion unter derselben Adresse laufen, gibt es kein CORS-Problem. Ein geheimes App-Token (lokal in den Einstellungen) verhindert, dass Fremde dein Kontingent verbrauchen.
- **Lokale Entwicklung:** Der Vite-Dev-Proxy setzt den Key aus der `.env`-Datei.
- **Was DeepL nicht liefert:** Grundform, Wortart, weitere Bedeutungen, Erklärungen und Beispielsätze. Das übernehmen das Wörterbuch (Baustein 1) und Claude (Baustein 3).

### 3. Mit Claude anreichern per Copy-Paste: ohne API

Das ist ein allgemeiner Mechanismus aus Prompt-Vorlage, Zwischenablage und Rückimport:

1. In der Vokabelliste klickst du „Mit Claude anreichern“. Die App nimmt bis zu 50 Begriffe, die noch nicht angereichert sind. Daraus baut sie einen Prompt: Anweisung, JSON-Schema und eine Liste von `{id, begriff, satz, buch, deepl_übersetzung}`.
2. Die App kopiert den Prompt per `navigator.clipboard.writeText` in die Zwischenablage und öffnet claude.ai in einem neuen Tab. Ob sich der Prompt auch per URL-Parameter vorbefüllen lässt, testen wir. Sonst bleibt es bei der Zwischenablage.
3. Claude antwortet mit einem JSON-Codeblock. Den kopierst du mit Claudes Kopier-Button und fügst ihn in der App in das Feld „Antwort einfügen“ ein.
4. Die App verarbeitet die Antwort:
   - Codeblock-Markierungen und Begleittext entfernen.
   - Jeden Eintrag mit zod prüfen und über die `id` dem richtigen Begriff zuordnen.
   - Eine Vorschau zeigen, z. B. „47 aktualisiert, 3 fehlerhaft“, und nur die gültigen Einträge übernehmen.
   - Für fehlerhafte Einträge gibt es den Button „Korrektur-Prompt kopieren“.

**Felder für die Anreicherung:** Erklärung (DE), Beispielsatz (EN), Aussprache (IPA), Eselsbrücke, typische Verwechslungen und drei plausible falsche Antworten für Multiple Choice.

**Weitere Vorlagen mit demselben Mechanismus:**
- Quizrunde generieren
- Fachglossar für ein Paper
- Mini-Geschichte aus den neuesten Wörtern
- „Erklär mir diesen Satz“

**Tipps:**
- Funktioniert genauso mit ChatGPT.
- Ein Claude-Projekt „Vokabeltrainer“ mit den Anweisungen als Projekt-Instruktionen spart Tipparbeit. Der Prompt der App bleibt trotzdem vollständig, also auch ohne Projekt nutzbar.

**Optional später:** eine Live-KI für „Satz erklären“ direkt im Popup (Gemini Free Tier oder lokales Ollama). Sie wäre über dasselbe Provider-Interface angebunden, gehört aber nicht zum MVP.

## Architektur

**Stack:** Vite + TypeScript + React als **PWA**. Eine PWA lässt sich auf Android und am Desktop installieren und funktioniert offline (über `vite-plugin-pwa`). Gehostet wird sie auf Cloudflare Pages, zusammen mit der DeepL-Funktion.

- **Rendering:** foliate-js als Git-Submodule in `vendor/foliate-js`, auf einen festen Commit gepinnt, weil die API laut README nicht stabil ist.
- **Speicher:** Dexie.js (IndexedDB), lokal auf dem Gerät.
- **SRS:** ts-fsrs.
- **Sprachverarbeitung:** `Intl.Segmenter` für Wort- und Satzgrenzen, `compromise` für die Grundform.
- **Prüfung von Claudes Antworten:** zod.
- **Tests:** Vitest und Playwright.

**Geplante Projektstruktur**
```
functions/api/translate.ts   Cloudflare Pages Function: DeepL-Vermittler (Key als Secret, App-Token-Prüfung)
scripts/build-dictionary.ts  Ding/Wiktionary → kompakte JSON.gz
src/
  reader/    ReaderView.tsx (<foliate-view>), selection.ts (Tippen/Markieren → Wort + Satz + Position), highlights.ts
  library/   Bibliothek, Import, Lesefortschritt
  lookup/    LookupPopup.tsx, lookupService.ts (Wörterbuch + DeepL parallel, Cache)
  translate/ deepl.ts (Client für /api/translate)
  enrich/    templates.ts (Prompt-Vorlagen + zod-Schemas), clipboard.ts, importResponse.ts (JSON extrahieren, prüfen, zuordnen)
  dict/      Offline-Wörterbuch laden und abfragen
  nlp/       lemmatize.ts, sentence.ts (inkl. PDF-Silbentrennung „statis-\ntical“)
  db/        schema.ts (Dexie) und Funktionen für den Datenzugriff
  vocab/     Vokabelliste, Detailansicht, Export (CSV/JSON/Anki)
  quiz/      scheduler.ts (ts-fsrs), QuizView.tsx, Quiz-Typen
  stats/  settings/
```

**Reader-Adapter:** Ein Interface `ReaderAdapter` kapselt den Reader mit den Methoden `onWordSelected`, `highlightTerms` und `goTo`. Zuerst gibt es eine Implementierung für foliate-js. Reicht die PDF-Darstellung von foliate-js nicht aus, kommt eine zweite Implementierung mit `pdfjs-dist` dazu.

**Datenmodell (Dexie)**
- `books`: id (Hash der Datei), title, author, format, file (Blob), lastLocation (CFI), progress
- `terms`: id, lemma, forms[], translation (DeepL), dictSenses[], pos, status (1–5, known oder ignored), tags, createdAt, und aus der Anreicherung: explanationDe, exampleEn, ipa, mnemonic, confusables[], distractors[], enrichedAt
- `contexts`: termId, bookId, location (CFI oder Seite), sentence. Ein Begriff kann mehrere Kontexte haben, sie liefern die Sätze für die Lückentexte.
- `cards`: termId, type (en→de, de→en, cloze), FSRS-Felder (due, stability, difficulty, reps, lapses, state)
- `reviewLogs`: cardId, rating, reviewedAt
- `translationCache`: Schlüssel ist ein Hash aus Wort und Satz, Wert ist das DeepL-Ergebnis
- `settings`

**Ablauf beim Nachschlagen**
1. Du tippst oder doppelklickst auf ein Wort. Die Wortgrenze ergibt sich aus `caretPositionFromPoint` und `Intl.Segmenter`. Alternativ markierst du mehrere Wörter, etwa für Phrasal Verbs oder Fachbegriffe.
2. Das Popup zeigt sofort den Wörterbuch-Eintrag (Grundform, Wortart, Bedeutungen). Gleichzeitig kommt die DeepL-Übersetzung im Kontext, typischerweise in unter einer Sekunde.
3. Mit „Speichern“ (oder automatisch, einstellbar) legt die App `term`, `context` und die Karten an. Ist der Begriff schon bekannt, bekommt er nur einen weiteren Kontext. Die Anreicherung durch Claude folgt später im Stapel.

**Quiz:** FSRS plant, wann eine Karte wieder fällig ist. Du bewertest jede Antwort mit Again, Hard, Good oder Easy.
- Karteikarte EN→DE, oder DE→EN mit Eintippen (tolerant gegenüber Tippfehlern über die Levenshtein-Distanz)
- Multiple Choice mit den falschen Antworten von Claude. Fehlen diese, nimmt die App ersatzweise Wörter gleicher Wortart aus der eigenen Datenbank.
- **Lückentext mit dem Originalsatz aus deinem Buch** (bringt den größten Lerneffekt)
- Hören über die Web Speech API (kostenlos)

## Roadmap

- **Phase 0 – Grundgerüst und Machbarkeit:**
  - `git init` (Commits ohne Co-Authored-By-Zeile), Vite + React + TS aufsetzen, foliate-js einbinden.
  - Ein Beispiel-EPUB und ein zweispaltiges PDF-Paper öffnen und das Auswahl-Event abgreifen.
  - Entscheidungspunkt: Reicht die PDF-Qualität von foliate-js?
- **Phase 1 – MVP:**
  - Bibliothek mit Import und Lesefortschritt.
  - Popup mit Offline-Wörterbuch und DeepL (Pages Function, im Dev-Modus über den Vite-Proxy).
  - Speichern mit Kontext, Vokabelliste mit Suchen, Bearbeiten und Löschen.
  - „Mit Claude anreichern“ (Copy-Paste).
  - Karteikarten-Quiz mit FSRS.
- **Phase 2:**
  - Gespeicherte Wörter im Text farbig markieren.
  - Dubletten zusammenführen.
  - Quiz mit Multiple Choice, Lückentext und Eintippen.
  - Weitere Vorlagen für Claude (Quizrunde, Glossar, Mini-Geschichte).
  - Export als CSV, JSON und für Anki.
  - Deploy auf Cloudflare Pages und Installation als PWA auf Android.
- **Phase 3:** Statistik, Kapitel-Vorschau, Sync zwischen Geräten, optional eine Live-KI.

## Ideen für Zusatzfeatures

1. **Markierung im LingQ-Stil:** Unbekannte, gerade gelernte und bekannte Wörter erscheinen farbig im Text. Das läuft über die CSS Custom Highlight API und verändert den Text selbst nicht. Dazu ein Button „Rest der Seite als bekannt markieren“.
2. **Kapitel-Vorschau:** Vor einem Kapitel lernst du die 10 Wörter vor, die du wahrscheinlich nicht kennst. Grundlage sind eine Worthäufigkeitsliste und deine bekannten Wörter.
3. **Schwierigkeitswert pro Buch:** der Anteil der Wörter, die du kennst. Laut Leseforschung liest man ab etwa 98 % Abdeckung bequem. Dazu ein Verlauf über die Zeit.
4. **Mini-Quiz nach jedem Kapitel** mit den Wörtern, die du dort nachgeschlagen hast.
5. **Fachglossar pro Paper** über eine Claude-Vorlage, exportierbar.
6. **Satz erklären:** Die App kopiert den Satz samt Kontext als Prompt für Claude.
7. **Mini-Geschichte** aus deinen 10 neuesten Wörtern, zum Wiederholen.
8. **Eselsbrücken und Verwechslungspaare** (affect/effect) als eigene Quizrunde.
9. **Lernstatistik:** Vergessenskurven, Behaltensquote, Lernserien. Die Review-Logs lassen sich als CSV exportieren, z. B. zur Auswertung in R.
10. **Anki-Export** (.apkg oder CSV).
11. **Namen-Filter:** erkennt Eigennamen und blendet sie aus.
12. **Wortfamilie:** alle Formen eines Worts, die du gesehen hast, und die Bücher, in denen es vorkam.
13. **OCR für eingescannte PDFs** (tesseract.js), wenn das PDF keine Textebene hat.
14. **Kostenloser Sync zwischen Geräten:** per JSON-Export/-Import oder über eine Datei in Nextcloud/WebDAV. Später optional über ein selbst gehostetes PocketBase.

## Risiken

- **PDF in foliate-js:** Die Unterstützung ist „experimentell“. In Phase 0 mit einem echten Paper testen; der Ausweg ist `pdfjs-dist` über den Reader-Adapter.
- **Zweispaltige PDFs:** Die Textebene kann die Spalten vermischen, daher muss die Satzerkennung damit klarkommen.
- **DeepL-Anmeldung:** Laut einzelnen Berichten verlangt die Anmeldung zur Verifizierung eine Kreditkarte, die aber nicht belastet wird. Vor dem Start prüfen.
- **Einzelwörter bei DeepL:** Sie sind manchmal unglücklich übersetzt. Die Bedeutungen aus dem Wörterbuch stehen deshalb immer daneben.
- **Claudes Antworten:** Sie können unvollständig oder falsch formatiert sein. Dagegen helfen die robuste JSON-Extraktion, die Prüfung pro Eintrag, ein Teil-Import und der Korrektur-Prompt.
- **Lizenz:** Die Ding-Daten stehen unter GPL. Sie werden deshalb als separate Datendatei behandelt.

## Verifikation

- **Unit-Tests (Vitest):**
  - Wort- und Satzerkennung, inklusive Silbentrennung und Phrasal Verbs.
  - Grundformen.
  - `importResponse` mit echten Beispielantworten von Claude: mit und ohne Codeblock, mit Begleittext, abgeschnitten, mit falschen IDs.
  - FSRS-Wrapper (Fälligkeit nach einer Bewertung).
  - Erkennen von Dubletten.
- **End-to-End-Test (Playwright)** mit Test-EPUB und Test-PDF:
  - Buch importieren, ein Wort anklicken.
  - Popup erscheint mit Wörterbuch-Eintrag und DeepL-Übersetzung; DeepL wird dabei simuliert.
  - Speichern, dann steht das Wort in der Vokabelliste.
  - Eine Beispielantwort von Claude einfügen, danach sind die Felder angereichert.
  - Das Quiz zeigt die Karte, und die Bewertung verschiebt die Fälligkeit.
- **Von Hand:**
  - Mit `npm run dev` ein echtes Buch und ein Paper lesen.
  - Einen DeepL-Aufruf mit `show_billed_characters` machen, um zu bestätigen, dass nur das Wort abgerechnet wird.
  - Den Copy-Paste-Ablauf einmal echt mit Claude.ai durchspielen.
  - Die PWA auf dem Android-Handy installieren und dort nachschlagen und quizzen.

## Quellen

- Readest: https://github.com/readest/readest
- foliate-js: https://github.com/johnfactotum/foliate-js
- ts-fsrs: https://github.com/open-spaced-repetition/ts-fsrs
- KOReader Vocabulary Builder: https://git.blob42.xyz/Archives/koreader/wiki/Vocabulary-builder
- Lute v3: https://github.com/LuteOrg/lute-v3
- DeepL API Free: https://support.deepl.com/hc/en-us/articles/360021200939-DeepL-API-Free
- DeepL `context` wird nicht abgerechnet: https://developers.deepl.com/docs/best-practices/estimating-character-usage
- DeepL und CORS: https://developers.deepl.com/docs/best-practices/cors-requests
- Claude-Abo vs. API: https://support.claude.com/en/articles/9876003-i-subscribe-to-a-paid-claude-ai-plan-why-do-i-have-to-pay-separately-for-api-usage-on-console
