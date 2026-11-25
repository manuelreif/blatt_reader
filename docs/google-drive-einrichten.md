# Google Drive einrichten (Google Cloud Console)

Das musst du nur einmal machen. Es dauert etwa 10 Minuten und kostet nichts. Am Ende hast du eine
**OAuth-Client-ID** der Form `….apps.googleusercontent.com`. Sie kommt in `.env` als
`VITE_GOOGLE_CLIENT_ID`. Ein Client-Secret, ein API-Schlüssel oder ein Abrechnungskonto sind **nicht**
nötig.

Die Menünamen folgen der deutschen Oberfläche, der englische Name steht in Klammern. Google benennt die
Menüs ab und zu um. Findest du einen Punkt nicht, hilft das Suchfeld oben in der Console.

## 1. Projekt anlegen

1. Öffne <https://console.cloud.google.com> und melde dich mit dem Google-Konto an, dessen Drive die App
   nutzen soll.
2. Beim ersten Besuch wählst du ein Land und akzeptierst die Nutzungsbedingungen.
3. Klick oben links auf die Projektauswahl und dann auf **Neues Projekt** (New project):
   - Projektname: `Blatt-Reader`
   - Organisation bzw. Speicherort: **Keine Organisation** lassen
   - **Erstellen** (Create)
4. Warte auf die Benachrichtigung und wähl dann oben in der Projektauswahl **Blatt-Reader**. Alle
   weiteren Schritte gelten für das Projekt, das dort gerade ausgewählt ist.

## 2. Google Drive API aktivieren

1. Öffne Menü ☰ → **APIs & Dienste → Bibliothek** (APIs & Services → Library).
2. Such nach **Google Drive API**, öffne sie und klick auf **Aktivieren** (Enable).

Fehlt dieser Schritt, meldet die App: „Die Google Drive API ist im Google-Cloud-Projekt nicht aktiviert“.

## 3. Zustimmungsbildschirm einrichten (Google Auth Platform)

1. Öffne Menü ☰ → **Google Auth Platform** und klick auf **Jetzt starten** (Get started). Im Suchfeld
   findest du sie auch unter „OAuth-Zustimmungsbildschirm“ (OAuth consent screen).
2. Der Assistent fragt nacheinander:
   - **App-Informationen:** App-Name `Blatt-Reader`, Nutzersupport-E-Mail: deine Google-Adresse.
   - **Zielgruppe:** **Extern** (External). „Intern“ gibt es nur mit Google Workspace.
   - **Kontaktdaten:** deine Google-Adresse.
   - **Fertigstellen:** Bestätige die Richtlinie zu Nutzerdaten und klick auf **Erstellen**.
3. Unter **Zielgruppe** (Audience) bleibt der Veröffentlichungsstatus auf **Testen** (Testing).
   - Unter **Testnutzer** klickst du auf **Nutzer hinzufügen** (Add users), trägst deine Google-Adresse ein
     und speicherst.
   - Nur Testnutzer können sich anmelden, alle anderen bekommen „Fehler 403: access_denied“.
4. **Datenzugriff** (Data access) musst du nicht ausfüllen: Die App fragt ihre Berechtigungen beim
   Verbinden selbst an.

## 4. OAuth-Client anlegen

1. Öffne in der Google Auth Platform **Clients** und klick auf **Client erstellen** (Create client).
2. Wähl als Anwendungstyp **Webanwendung** (Web application). Als Name passt z. B. `Blatt-Reader Web`.
3. Unter **Autorisierte JavaScript-Quellen** (Authorized JavaScript origins) trägst du jede Adresse mit
   **+ URI hinzufügen** ein. Schreib sie genau so, ohne Schrägstrich am Ende:
   - `http://localhost:5173` für `npm run dev`
   - `http://localhost:5179` für die E2E-Tests (optional)
   - `http://localhost:4179` für den Preview-Server (optional)
   - `https://<projekt>.pages.dev`, die Cloudflare-Adresse (`<projekt>` = Name deines
     Cloudflare-Projekts). Steht sie noch nicht fest, ergänzt du sie später.
4. **Autorisierte Weiterleitungs-URIs** (Authorized redirect URIs) lässt du leer.
5. Klick auf **Erstellen** und **kopier die Client-ID** aus dem Fenster, das dann erscheint. Ein
   Client-Secret, falls angezeigt, braucht die App nicht. Es gehört weder in `.env` noch ins Repo.

Neue oder geänderte JavaScript-Quellen gelten manchmal erst nach ein paar Minuten.

## 5. In die App eintragen und verbinden

1. Trag die ID in `.env` im Projektordner ein:
   ```
   VITE_GOOGLE_CLIENT_ID=123456789-abc….apps.googleusercontent.com
   ```
2. Starte `npm run dev` neu. Vite liest `.env` nur beim Start.
3. Öffne **genau** `http://localhost:5173`. Mit `127.0.0.1` oder einer LAN-IP lehnt Google die Anmeldung ab.
4. Tipp auf **Einstellungen → Google Drive → Mit Google verbinden**.
5. Google warnt: „Google hat diese App nicht überprüft“. Klick auf **Erweitert** (Advanced) und dann auf
   **Weiter zu Blatt-Reader (unsicher)**. Bei eigenen Projekten ist diese Warnung normal.
6. Auf der Berechtigungsseite setzt du **beide Häkchen**, dann **Weiter**. Das eine erlaubt, Drive-Dateien
   anzusehen, das andere, die von der App angelegten Dateien zu bearbeiten.
7. In „Meine Ablage“ liegt jetzt der Ordner **Blatt-Reader**. Leg ein EPUB oder PDF hinein und tippe in
   der App auf **Jetzt abgleichen**. Weitere Ordner, auch für dich freigegebene, kommen über
   **+ Ordner hinzufügen** dazu.

## 6. Später: Cloudflare und Handy

- Die Cloudflare-Adresse muss unter den JavaScript-Quellen stehen (Schritt 4.3). Am Handy funktioniert
  Drive erst mit dieser Adresse, weil Google keine LAN-Adresse zulässt.
- Baust du lokal mit `npm run build`, kommt die ID aus `.env` mit. Baut Cloudflare aus Git, trägst du
  `VITE_GOOGLE_CLIENT_ID` dort als Build-Variable ein.
- Fragt Google im Status „Testen“ alle 7 Tage erneut nach der Zustimmung, wechselst du den Status:
  **Zielgruppe → App veröffentlichen** (Publish app), danach steht dort „In Produktion“. Für den eigenen
  Gebrauch geht das ohne Überprüfung durch Google, die Warnung „nicht überprüft“ bleibt aber.

## Wenn etwas nicht klappt

| Meldung | Ursache | Lösung |
|---|---|---|
| „Fehler 400: origin_mismatch“ oder „redirect_uri_mismatch“ | Die Adresse im Browser fehlt unter den JavaScript-Quellen | Schritt 4.3 genau prüfen (http/https, Port, kein `/` am Ende), ein paar Minuten warten |
| „Fehler 403: access_denied“ | Das Konto ist nicht als Testnutzer eingetragen | Schritt 3.3 |
| „Die Google Drive API ist … nicht aktiviert“ | Die API ist in einem anderen Projekt oder gar nicht aktiviert | Schritt 2, dabei auf das richtige Projekt in der Projektauswahl achten |
| „Bitte beide Google-Drive-Berechtigungen erlauben“ oder „Berechtigung fehlt“ | Ein Häkchen fehlte | In der App **Trennen**, neu verbinden und beide Häkchen setzen |
| „Das Anmelde-Fenster wurde blockiert“ | Der Browser blockiert Pop-ups | Pop-ups für `localhost` bzw. die App-Adresse erlauben |
| „Nicht eingerichtet“ in den Einstellungen | Die ID fehlt in `.env` oder der Dev-Server lief schon vorher | Schritt 5.1 und 5.2 |
