# Stand, Tests und Planung

Was fertig ist, was echt (nicht nur simuliert) geprüft wurde, was offen ist. Gefundene Fehler hier ergänzen,
erledigte Punkte nach oben in den Stand übernehmen.

## Stand (23.11.2026)

**Fertig (Phase 0 + MVP):** Bibliothek (Import, Cover, Fortschritt), Reader für EPUB und PDF (TOC,
Schriftgröße, Zoom, Positionsregler), Nachschlage-Popup (Wörterbuch + DeepL, Vorlesen, Speichern,
Ignorieren, Auto-Speichern), Vokabelliste mit Detailansicht und „im Buch zeigen“, Claude-Anreicherung,
FSRS-Quiz (EN→DE, DE→EN, Lückentext), Einstellungen, Backup/Restore, CSV-Export (Vokabeln und
Review-Log für R), PWA mit Offline-Cache.

**Gemini (deployt 25.11.2026):** „Mit Gemini anreichern“ mit eigenem Free-Tier-Key, direkt aus dem Browser.
Echt geprüft: Free-Tier-Key (AI Studio, eigenes Projekt ohne Abrechnung), „Gemini testen“ im Dev-Server liefert
„bank“ → „Ufer“, das Modell-Alias `gemini-flash-lite-latest` existiert. **Noch offen:** echter Durchgang mit 30
Wörtern (gültiges JSON? Qualität im Vergleich zu Claude?), tatsächliches Tageslimit, Aufruf aus der Live-Version
(CSP nur im E2E-Test mit gestubbter API geprüft).

**Echt getestet (21.11.2026):** DeepL-Free-Key in `.env` über `/api/translate`: „bank“ wird je nach
Satz zu „Ufer“ bzw. „Bank“, abgerechnet werden nur 4 Zeichen (der Kontext zählt nicht).

**Neu (21.11.2026):** Passwortschutz, Wörterbuch komplett offline speichern, Offline-Hinweis im Popup,
DeepL für offline gespeicherte Wörter nachholen, Anzeige „dauerhafter Speicher“ in den Einstellungen.

**Neu (21.11.2026):** Google-Drive-Abgleich: Bücherordner automatisch laden, Vokabeln/Lernstand/Lesefortschritt
zwischen Geräten zusammenführen (Grabsteine für gelöschte Wörter), Merge auch beim manuellen Einspielen.

**Neu (25.11.2026):** Mehrere Drive-Bücherordner. Ordner-Browser in den Einstellungen („Meine Ablage“, „Für
mich freigegeben“, geteilte Ablagen, Suche nach Name oder Link), die Liste gilt für alle Geräte. Ein
nicht erreichbarer Ordner hält den Rest nicht auf, und beim Entfernen bleiben die Bücher. In der Bibliothek
gibt es einen Filter nach Ordner. Geprüft ist das nur mit dem Fake-Drive (Unit + E2E, auch 400 px breit), mit
echtem Google noch nicht.

**Neu (21.11.2026):** Reader-Modi Lesen/Übersetzen/Markieren (Knopf, Tasten l/u/m, Zwei-Finger-Tipp) und
Markierungen mit Farben, Notizen und Liste pro Buch, mit Sicherung und Drive-Abgleich.

**Neu (21.11.2026):** Quiz pro Buch (Auswahl im Quiz, Link in der Bibliothek), Buchfilter in der Vokabelliste.

**Neu (22.11.2026):** Umbenennung in „Blatt-Reader“, Logo (App-Icons, Kopfleiste, Reader, Anmeldeseite,
Einstellungen), Farbschema Navy/Creme aus dem Logo, Blatt-Muster als Wasserzeichen im Hintergrund.
Reader-Leiste läuft am Handy nicht mehr über den Bildschirmrand hinaus.

**Live (seit 22.11.2026):** auf Cloudflare Pages, Branch `main`, Secrets `DEEPL_API_KEY` und `APP_PASSWORD`,
KV-Binding `LOGIN_ATTEMPTS`. Adresse, Projektname, Deploy-Befehl und Google-Client stehen in `CLAUDE.local.md`.
Echt geprüft: Passwortschutz in der Cloudflare-Laufzeit (lokal mit `wrangler pages dev` und live), DeepL über
die Pages Function, App am Desktop, Google-Login am Desktop. Die Google-Client-ID hat als JavaScript-Quellen die
drei localhost-Ports und die Live-Adresse. Eine neue Domain dort eintragen, sonst `origin_mismatch`.

**Neu (22.11.2026):** Wörterbuch zuerst, DeepL auf Knopfdruck (Einstellung „DeepL abfragen“), ganze Sätze im
Übersetzen-Modus mit DeepL übersetzen und als Markierungsnotiz behalten. Claude-Anreicherung ersetzt
Übersetzungen, die nur aus dem Wörterbuch stammen, automatisch.

**Neu (23.11.2026):** Repo für die Veröffentlichung vorbereitet: MIT-Lizenz, Historie bereinigt (Live-Adresse,
Projektnamen, persönliche Angaben und Logo-PNGs entfernt; Backup-Bundle liegt lokal neben dem Projektordner),
Login-Bremse (5 Fehlversuche pro Stunde und IP).

**Neu (23.11.2026):** Eigener DeepL-Key pro Gerät (Einstellungen → Übersetzung), damit Mitnutzer auf ihr
eigenes Kontingent übersetzen; optional erzwingbar mit `DEEPL_REQUIRE_OWN_KEY`.

**Neu (23.11.2026):** Google-OAuth-App „In Produktion“ (vorher „Test“: nur eingetragene Testnutzer, andere Konten
bekamen `403 access_denied`). Jedes Google-Konto kann Drive verbinden, sieht aber den Hinweis „Google hat diese App
nicht überprüft“ (→ „Erweitert“ → „Weiter zu …“), weil `drive.readonly` eingeschränkt ist und nie geprüft wurde.
Höchstens 100 Nutzer insgesamt. Dafür öffentliche Seite `/datenschutz`.

**Neu (23.11.2026):** Aus dem ersten Handytest: Am Touch-Gerät eigene Auswahl per Gedrückthalten + Ziehen statt der
nativen (die Chromes Google-Leiste „Touch to Search“ auslöste), deutliche Rückmeldung beim Speichern (grünes
„✓ Gespeichert“ + Toast), Popups bleiben beim Hineinzoomen ganz sichtbar.

**Neu (24.11.2026):** Die App übernimmt neue Versionen selbst (Update-Prüfung beim Zurückkehren und stündlich,
dann kurz neu laden). Anlass: Am Handy lief nach dem Deploy noch die alte Version, das Popup war beim Zoomen
abgeschnitten; nach Schließen und Neustart der App passte es. Geprüft mit dem Produktions-Build: offene Seite, neu
gebaut, `visibilitychange` → Seite lädt neu und zeigt die neue Version.

**Echt getestet (24.11.2026):** Popup im hineingezoomten Zustand am Android-Handy erscheint ganz und in normaler
Größe (mit aktueller Version). In der Emulation zusätzlich mit echter Pinch-Geste
(`Input.synthesizePinchGesture`, nur mit `gestureSourceType: 'mouse'` wirksam) nachgestellt.

**Echt getestet (24.11.2026):** zweispaltiges arXiv-Paper (BERT, 16 Seiten) im Dev-Server, je Seite gut 20 Wörter
angetippt und den Satz gegen die Lesereihenfolge von `pdftotext` geprüft: vorher 5 von 43 Sätzen richtig
(gestapelte Textlayer, Titel/Fußnoten im Satz), danach 235 von 255; der Rest sind Tabellen, Formeln und
Beschriftungen in Abbildungen. Spalten werden in der richtigen Reihenfolge gelesen, `pdfjs-dist` ist nicht nötig.
Anreicherung mit einer echten Claude-Antwort auf den Prompt der App: 7 von 7 gültig, Wörterbuch-Übersetzungen
automatisch ersetzt („downstream“: „Abwärtsstrom“ → „nachgelagert“).

**Als Nächstes (geplant ab 23.11.2026): Praxistest auf Android**, in Chrome die Live-Adresse (`CLAUDE.local.md`)
öffnen, anmelden, Menü → „App installieren“, dann in der installierten App:
- [ ] Nach dem Anmelden erscheint „App installieren“ (leere Bibliothek bzw. Einstellungen → App) und öffnet
      Chromes Dialog; danach steht in den Einstellungen „Läuft als installierte App“
- [ ] Icon und Start ohne Browserleiste; Anmeldung bleibt nach Neustart erhalten
- [ ] Buch importieren (vom Gerät und über Drive)
- [ ] Wort antippen: Popup passt auf den Bildschirm, Wörterbuch sofort, „+ DeepL“, speichern, Quizrunde
- [ ] Übersetzen-Modus: Wort gedrückt halten → keine Google-Leiste, kein Menü „Kopieren/Websuche“; weiterziehen
      wählt mehrere Wörter, ein ganzer Satz öffnet das Satz-Popup, „+ Mit DeepL übersetzen“, „Markieren“
- [ ] „Speichern“ zeigt den grünen Haken „✓ Gespeichert“ und oben den Toast
- [ ] Hineingezoomt (zwei Finger): Popup erscheint ganz und in normaler Größe; Tastatur im Übersetzungsfeld
      verdeckt das Popup nicht
- [ ] Reader-Leiste läuft nicht über den Rand
- [ ] Nach einem Deploy: App aus dem Hintergrund zurückholen → lädt kurz neu und zeigt die neue Version
- [ ] Lesemodus: Blättern per Tippen links/rechts
- [ ] Zwei-Finger-Tipp wechselt den Modus
- [ ] Markieren-Modus: gedrückt halten und ziehen, Farbe, Notiz (ebenfalls ohne Google-Leiste)
- [ ] Einstellungen → Wörterbuch offline speichern, „dauerhafter Speicher“ ansehen
- [ ] Flugmodus: App startet, Buch lesbar, Nachschlagen nur Wörterbuch mit Hinweis, Wort speichern;
      wieder online → DeepL wird nachgeholt
- [ ] „Mit Google verbinden“ in der installierten PWA: Popup geht auf, zurück in die App
- [ ] Abgleich Desktop ↔ Handy: Wort am Desktop speichern, auf beiden „Jetzt abgleichen“
- [ ] Drive lädt ein Buch aus dem Ordner wirklich herunter (auch am Desktop noch offen); scheitert es an
      der CSP, Ziel-Domain von `alt=media` in `connect-src` aufnehmen
- [ ] „+ Ordner hinzufügen“ am Handy: durch „Meine Ablage“ und „Für mich freigegeben“ tippen, einen
      freigegebenen Ordner hinzufügen, seine Bücher kommen, der Filter in der Bibliothek erscheint;
      „Geteilte Ablagen“ nur mit einem Workspace-Konto prüfbar
Gefundene Fehler hier ergänzen, erledigte Punkte nach oben in den Stand übernehmen.

**Offen aus dem Paper-Test (24.11.2026):**
- ~~Grundform: Adverb auf -ly wird zum Adjektiv, „jointly“ → „joint“ (Wörterbuch dann „ausfugen“);
  „fine-grained“ → „fine grained“ ohne Bindestrich~~ → erledigt (25.11.2026): Adverben auf -ly und Wörter mit
  Bindestrich bleiben, wie sie im Text stehen; die umgeformte Variante ist nur noch Ersatzkandidat fürs Wörterbuch.
  Schon gespeicherte „joint“/„fine grained“ bleiben, wie sie sind (von Hand löschen).
- ~~Zitat-Links im PDF springen auch im Übersetzen-Modus~~ → erledigt: Links gelten nur noch im Lesemodus.

**Noch nie echt getestet** (nur simuliert bzw. mit generierten Fixtures):
- Google Drive mit echtem Google: Login-Popup in der installierten Android-PWA, Verhalten nach mehr als
  1 h, ob `alt=media`-Downloads auf eine andere Domain umleiten (dann in die CSP `connect-src`)
- Zwei-Finger-Tipp und die eigene Touch-Auswahl (Gedrückthalten + Ziehen, abgelehntes `selectstart`) auf einem
  echten Android-Gerät (nur Unit-Tests der Automaten, CDP-Touch in Headless-Chromium). Taucht die Google-Leiste
  trotzdem auf: beim Ziehen zusätzlich `user-select: none` am Buchdokument; kommt sie schon beim bloßen Tippen,
  `touchend` von Taps im Übersetzen-Modus abfangen.
- Automatisches Update auf dem Handy (nur im Produktions-Build am Desktop nachgestellt)
- Copy-Paste über die Oberfläche von claude.ai (Kopieren/Einfügen am Handy); Prompt und Import sind mit einer
  echten Claude-Antwort geprüft
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
Schwierigkeitswert pro Buch, Sync (JSON/WebDAV), Live-KI auch für „Satz erklären“ im Popup (Gemini ist für
die Anreicherung angebunden, `askGemini` lässt sich wiederverwenden; pro Antippen eine Anfrage, Tageslimit beachten).

Der ausführliche ursprüngliche Plan mit Recherche, Quellen und Feature-Ideen: `docs/plan.md`
(Stand bei Projektstart; die Abschnitte oben sind aktueller).
