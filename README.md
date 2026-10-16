# Baufrankhallen-Fete

Party-App für die Fete in der Baufrankhalle (IT Applications & Buchhaltung). Läuft komplett auf **Cloudflare Pages (Free)**: Pages Functions + D1.

| Oberfläche                                                  | URL                                             | Wer                                                |
| ----------------------------------------------------------- | ----------------------------------------------- | -------------------------------------------------- |
| Gäste (Voting, Songwünsche)                                 | `/fete` (QR-Code auf dem TV → `/fete/v/<code>`) | Alle Gäste, nur QR scannen                         |
| TV / Bar 1 Stattrack / Bar 2 Buchhaltung / Player-Taktgeber | `/display` (Rolle wird beim Koppeln gewählt)    | Bildschirme                                        |
| Adminbereich                                                | `/admin`                                        | Orga-Team, Passkey oder Passwort + 2FA             |
| Buzzer                                                      | PC-Agent → `/api/buzzer/*`                      | Bar-PC, siehe [`agent/README.md`](agent/README.md) |

## So funktioniert der Abend

- **Sets** legen fest, welche Songs wann zur Wahl stehen, und haben ein Standard-Stimmungslevel (1 Chill … 5 Eskalation).
- **Songwünsche:** Gäste suchen beliebige Songs auf Spotify und wünschen sie mit einem Tipp. Passt der Song zur Party, wird er automatisch freigegeben, landet im Set, das zur nächsten Runde läuft, und kommt in eine der nächsten Abstimmungen (höchstens die Hälfte der Kandidaten sind Wünsche, jeder Wunsch höchstens dreimal). Die Stufe schätzt die App aus dem Genre; passt kein Genre, gilt die Stufe des Sets. Wünsche dürfen eine Stufe neben der Runde liegen, aber nie gegen die Richtung des Spannungsbogens. Pro Gerät sind 3 Wünsche pro Stunde möglich. Mit **Veto** im Admin fliegt ein Song aus Set, Voting und Warteschlange und kann nicht erneut gewünscht werden.
- **Genre-Filter:** Zu jedem Hauptkünstler holt die App die Top-Tags von Last.fm (Cache 30 Tage). Steht ein Begriff der Sperrliste (Einstellungen → Genre-Filter, Vorgabe: Metal, Grindcore, Polka, Disco Polo, Volksmusik …) als ganzes Wort in einem Tag mit Gewicht ≥ 60, ist der Song in Suche und Voting ausgeblendet. Künstler ohne Tags sind erlaubt; Karaoke- oder Cover-Versionen unbekannter Interpreten rutschen deshalb durch, dafür gibt es das Veto. Songs, die ein Admin selbst importiert oder in ein Set legt, sind nie gesperrt. Ohne `LASTFM_API_KEY` ist der Filter aus. Ist die Sperrliste einmal gespeichert, kommen spätere Änderungen der Vorgabe im Code nicht mehr an.
- **Erstes Voting** startet zur eingestellten Uhrzeit. Bis dahin läuft die Vorprogramm-Playlist.
- **Jede Runde hat genau ein Stimmungslevel.** Von Runde zu Runde ändert es sich um höchstens eine Stufe, so gibt es keine harten Übergänge.
- **Abstimmzeit mindestens 17 Minuten.** Die nächste Runde läuft, bis der letzte Gewinner-Song der vorherigen Runde anfängt. Es staut sich nie mehr als eine Runde, Filler-Songs gibt es nicht.
- **Spotify-Queue:** Die App reiht immer nur den nächsten Gewinner ein, sobald der aktuelle läuft. Korrekturen im Admin wirken bis dahin.
- **Notfall:** Fallen App, Netz oder Spotify-API aus, läuft die Vorprogramm-Playlist in Dauerschleife weiter. Es wird also nie still.
- **Buzzer = 1 Kasten** zum Durchschnittspreis. Gebucht wird _Soll Getränkeaufwand / Haben Getränkevorrat_. Korrekturen gehen nur per Storno.

## Betrugsschutz für Gäste (ohne Zusatzaufwand)

Gäste scannen nur den QR-Code. Geprüft wird ohne Drittanbieter, ohne Bot-Challenge und ohne Gerätesignatur:

- **Rotierender QR-Token** (60 s) als Anwesenheitsnachweis. Er setzt ein signiertes Geräte-Cookie, das höchstens 24 h gilt. Erneutes Scannen verlängert es nicht.
- **IP-Limit pro Runde:** IPv6 pro /64-Netz (Standard 1) und zusätzlich pro /48-Netz (`votesPerNetV6`, Standard 5), IPv4 Standard 3, weil Mobilfunk-CGNAT und iCloud Private Relay Adressen teilen. Gespeichert wird nur ein pseudonymisierter Netz-Schlüssel (HMAC), nie die IP-Adresse.
- **Rate-Limits** und auffällige Netze (Geräte pro Netz-Schlüssel) im Admin sichtbar.

Restrisiko: Wer gezielt Browser oder Gerät wechselt _und_ sich neu ins Mobilfunknetz einwählt, kann mehrfach abstimmen. Ohne Login ist das nicht vollständig verhinderbar.

## Sicherheit Adminbereich

- Eigener Account pro Admin, Einladung per Einmal-Link (24 h). Eine neue Einladung ersetzt ältere offene Einladungen desselben Benutzers. Bestehende Benutzer werden nur mit ausdrücklichem **Reset** neu eingeladen. Offene Einladungen lassen sich widerrufen, Deaktivieren widerruft sie automatisch. Deaktivierte Accounts werden durch eine Einladung nicht reaktiviert, der letzte aktive Owner kann nicht herabgestuft werden.
- Anmeldung per **Passkey** (Face ID, Touch ID, Windows Hello, Android-Bildschirmsperre) oder per Passwort (PBKDF2 + geheimer Pepper) mit **Pflicht-TOTP** und 10 Wiederherstellungscodes. Die Methode wählt jeder beim Einlösen der Einladung bzw. beim Bootstrap; weitere Passkeys unter „Mein Konto“. Passkeys sind an `WEBAUTHN_ORIGIN` gebunden (Deploy setzt es auf `PRODUCTION_URL` bzw. `https://<projekt>.pages.dev`), auf Preview-URLs gibt es keine Passkeys.
- Gast- und Adminbereich sind als getrennte Web-Apps installierbar: Gäste unter `/fete`, Admin unter `/admin`. Die Scopes überschneiden sich nicht (`/` und alte `/v/<code>`-Links leiten per `public/_redirects` auf `/fete` um). Jede App hat eine eigene HTML-Datei mit festem Manifest (`dist/fete/index.html`, `dist/admin/index.html`, erzeugt von `scripts/pwa-entries.ts` aus `src/shared/pwa.ts`), weil iOS das Manifest beim Laden liest und spätere Änderungen ignoriert. `/display`, `/datenschutz` und `/impressum` laufen über die Root-HTML ohne Manifest. Icons liegen in `public/pwa/`. Icons neu erzeugen: quadratische PNGs nach `assets/pwa/guest.png` und `assets/pwa/admin.png` legen, dann `node scripts/generate-icons.ts`. Das Skript schneidet 14 % pro Seite ab (eingebauter Rahmen und runde Ecken – iOS und Android maskieren selbst) und verkleinert das Motiv im maskierbaren Android-Icon auf die Sicherheitszone, der Rand wird unscharf aufgefüllt. Auf dem iPhone haben Homescreen-Apps eigene Cookies: Einladungen in Safari annehmen, danach in der App per Passkey anmelden; Spotify im Browser verbinden. Die Gast-App braucht nach dem QR-Scan (öffnet Safari) dort ein gültiges Cookie, auf dem iPhone ist sie deshalb nur eingeschränkt nützlich.
- Sessions als `__Host-` Cookies mit SameSite=Strict, Idle 2 h, maximal 12 h, ohne gespeicherte IP oder Browserkennung. CSRF-Schutz über Origin-Prüfung und Pflicht-Header.
- Kritische Aktionen (Admins verwalten, Passkeys verwalten, Gästedaten löschen) brauchen eine **erneute Bestätigung** per Passkey oder 2FA-Code.
- Rollen `owner` (verwaltet Admins) und `admin`.
- Login-Drosselung pro IP, pro IPv6-/48-Netz und pro Benutzer + IP (Benutzername nur als HMAC), damit Gäste niemanden aussperren können.
- **Audit-Log** aller Änderungen (90 Tage).
- Optional zusätzlich **Cloudflare Access** (siehe unten). Wenn `ACCESS_TEAM_DOMAIN` und `ACCESS_AUD` gesetzt sind, prüft die App das Access-JWT selbst, sonst warnt das Dashboard.
- Strikte CSP ohne Inline-Skripte und HSTS. Displays sind nur nach Kopplung durch einen Admin nutzbar, Buzzer-Requests sind HMAC-signiert und gegen Wiederholung geschützt.

## Datenschutz und Löschfristen

Die App wird privat betrieben. Verantwortlicher, Aufsichtsbehörde und Fristen stehen im Code nur in [`src/shared/legal.ts`](src/shared/legal.ts). Daraus entstehen `/datenschutz` (mit Abschnitt `#admin`) und `/impressum`, statisch auf Deutsch und Englisch. Interne Dokumentation mit Verzeichnis der Verarbeitungstätigkeiten, TOM, Interessenabwägung, Löschkonzept und Datenpannen: [`docs/DATENSCHUTZ.md`](docs/DATENSCHUTZ.md). Ändern sich Fristen oder Stammdaten, diese Datei und die [Event-Checkliste](docs/EVENT-CHECKLISTE.md) mitziehen.

- Gast-Browser laden nur von der eigenen Domain: keine Skripte, Schriften oder Bilder von Drittanbietern, Cover über den Proxy `/api/cover/<id>`. Deshalb gibt es kein Consent-Banner.
- Gespeichert werden Geräte-ID, ein pseudonymisierter Netz-Schlüssel (HMAC der IP-Adresse, rechtlich weiter personenbezogen), Stimmen und Wünsche.
- Gästedaten werden 7 Tage nach der letzten Aktivität automatisch gelöscht bzw. anonymisiert, Suchcache und Rate-Limits nach 24 h, das Audit-Log nach 90 Tagen. Gäste löschen die Daten ihres Geräts in der App sofort, Owner alle Gästedaten unter „Eventdaten bereinigen“.

### Workflow „Datenlöschung“

[`.github/workflows/retention.yml`](.github/workflows/retention.yml) läuft täglich um 04:23 UTC und lässt sich manuell starten. `scripts/retention-sql.ts` erzeugt die Statements aus `src/server/services/retention.ts`, dieselbe Liste wie beim Admin-Button. `wrangler d1 execute --remote --command` führt sie auf der Produktions-D1 aus. Der Workflow nutzt `CLOUDFLARE_API_TOKEN` und `CLOUDFLARE_ACCOUNT_ID` aus dem Environment `production` und hat die eigene Concurrency-Gruppe `retention`, blockiert also keinen Deploy.

- **Nachweis:** Das letzte Statement setzt `retention_run` in `kv`, danach prüft der Workflow, ob der Zeitstempel frisch ist. Das Dashboard warnt, wenn der letzte Lauf über 48 h zurückliegt. „Eventdaten bereinigen“ setzt den Nachweis ebenfalls.
- **Fehler:** Der Workflow legt ein Issue „Datenlöschung fehlgeschlagen (Datum)“ an. Der Lauf ist idempotent, der nächste Tag holt nach.
- **60-Tage-Regel:** GitHub deaktiviert Schedules in öffentlichen Repos nach 60 Tagen ohne Aktivität im Repo. Dann gibt es weder Lauf noch Issue. Unter _Actions → Datenlöschung_ wieder aktivieren und manuell starten. Die Termine dafür stehen in der Event-Checkliste.
- Nach dem ersten Merge einmal manuell starten. Abschalten: Workflow in Actions deaktivieren. Fehllöschungen über D1 Time Travel zurückholen.

## Kosten / Free-Tier

Pro Tag sind 100.000 Function-Requests frei (Reset 00:00 UTC). Schätzung für 6 h, 150 Gäste und etwa 18 Runden:

| Posten                                      | Schlechtester Fall | Realistisch    |
| ------------------------------------------- | ------------------ | -------------- |
| Join, Abstimmen, Rundenwechsel, Displays    | ca. 25.000         | ca. 25.000     |
| Cover der Kandidaten (150 × 18 Runden × 12) | 32.400             | 11.000         |
| Cover „Läuft gerade“ (150 × 18)             | 2.700              | 1.000          |
| Cover Wunschliste (150 × 60)                | 9.000              | 2.300          |
| Cover Suche (150 × ca. 120)                 | 18.000             | 2.000          |
| Cover TV, Player, Admin                     | 3.000              | 1.500          |
| **Summe ohne Budget-Wächter**               | **ca. 90.000**     | **ca. 43.000** |

- **Statische Dateien zählen nicht** (`_routes.json` aktiviert Functions nur für `/api/*`), auch nicht `/datenschutz` und `/impressum`. Der Löschlauf nutzt die D1-API und kostet ebenfalls keinen Function-Request.
- Jedes Cover ist ein Function-Request, der Browser hält es 24 h im Cache.
- Gäste fragen nicht dauerhaft ab, nur beim Laden, beim Abstimmen und beim Rundenwechsel (mit Zufallsverzögerung).
- Der **Budget-Wächter** im Dashboard zeigt den echten Verbrauch. Er braucht `CF_ANALYTICS_TOKEN` (dringend empfohlen). Ohne Token warnt das Dashboard „Budget-Wächter inaktiv“, der Deploy läuft trotzdem.
  - Ab 60 % fragen Gäste und Bar-Screens nur halb so oft ab.
  - Ab 80 % nur noch ein Viertel so oft, und Gäste sehen keine Cover mehr (Status, Suche, Wünsche). Damit bleibt auch der schlechteste Fall unter 100.000.
  - TV, Player-Tab und Buzzer-PC (die Taktgeber) werden nie gedrosselt.
- Welche Analytics-Datensätze Pages-Functions-Aufrufe enthalten, ist nicht abschließend geprüft. Die App fragt `workersInvocationsAdaptive` und `pagesFunctionsInvocationsAdaptiveGroups` ab und nimmt den größeren Wert. Vor dem Event mit dem Cloudflare-Dashboard abgleichen.

## Änderungen machen (ohne Cloudflare-Zugang)

1. Branch anlegen, ändern, Pull Request öffnen. Die **CI** prüft Audit, Lint, Format, Theme-Regel, Typen, Unit-/Integrationstests mit Coverage, Build, Migrationen auf frischer D1, Smoke-Test gegen `wrangler pages dev`, Playwright-E2E (inkl. CSP-Verstößen) und den PC-Agenten.
2. Nach Review in `main` mergen. **`deploy.yml`** führt die CI erneut aus, wendet D1-Migrationen an, synchronisiert die Secrets, deployt und macht einen Health-Check auf Produktion.

Migrationen nur **additiv** schreiben (neue Datei `migrations/000N_*.sql`). Der laufende Code muss mit dem neuen Schema funktionieren. `/api/health` meldet die Schema-Version (aktuell 4).

### Design an den Einladungsflyer anpassen

Alle Farben, Schriften, Radius, Logo und Eventname stehen **ausschließlich** in [`src/shared/theme.ts`](src/shared/theme.ts). Logo: `public/logo.svg`. Die CI verbietet Farbwerte an anderen Stellen und prüft den WCAG-Kontrast aller Textfarben. Ändern → PR → Merge → live.

## Lokale Entwicklung

```bash
npm ci
npm run build && npm run test:smoke -- --serve   # baut, migriert lokale D1, startet http://127.0.0.1:8799
npm run dev                                      # optional: Vite mit Hot-Reload auf :5173 (API-Proxy auf :8799 bzw. $SMOKE_PORT)
npm test                                         # Unit- + Integrationstests (inkl. Abendsimulation)
PW_CHROMIUM_PATH=/pfad/zu/chrome npm run test:e2e
```

`npm run test:smoke` legt beim ersten Start eine `.dev.vars` mit Zufalls-Secrets an (`BOOTSTRAP_TOKEN=local-bootstrap-token`). `npm run dev:api` startet nur `wrangler pages dev` auf demselben Port :8799. Für Passkeys lokal `WEBAUTHN_ORIGIN=http://localhost:5173` (Vite) bzw. `http://localhost:8799` in `.dev.vars` setzen und die App über `localhost` öffnen – WebAuthn akzeptiert keine IP-Adressen.

## Einmalige Einrichtung (Owner mit Cloudflare-Zugang)

1. `scripts/bootstrap-cloudflare.sh` ausführen. Das Script:
   - legt die D1-Datenbank an und trägt die ID in `wrangler.toml` ein,
   - legt das Pages-Projekt an,
   - setzt die Basis-Secrets im GitHub-Environment `production` (falls `gh` angemeldet ist). Vorhandene Secrets bleiben unverändert, das Script ist wiederholbar.
2. **Cloudflare API-Token** anlegen: Rechte _Account → Cloudflare Pages → Edit_ und _Account → D1 → Edit_, nur dieses Konto, mit Ablaufdatum. In GitHub als Environment-Secrets `CLOUDFLARE_API_TOKEN` und `CLOUDFLARE_ACCOUNT_ID` hinterlegen. Deploy und Workflow „Datenlöschung“ nutzen beide diesen Token. Ein eigener Token nur für D1 ist als Option in [`docs/DATENSCHUTZ.md`](docs/DATENSCHUTZ.md) beschrieben.
3. **Spotify-App** auf developer.spotify.com mit dem **Premium-Party-Account** anlegen:
   - Redirect-URI: `https://<projekt>.pages.dev/admin/spotify/callback`
   - Secrets `SPOTIFY_CLIENT_ID` und `SPOTIFY_CLIENT_SECRET`
   - **Last.fm-API-Key** (kostenlos, [last.fm/api/account/create](https://www.last.fm/api/account/create)) als Secret `LASTFM_API_KEY` für den Genre-Filter
4. **Cloudflare Access** (Zero Trust, gratis bis 50 Nutzer) einrichten:
   - Anwendung für `<projekt>.pages.dev/admin`, `/api/admin` **und** `*.<projekt>.pages.dev` (Deployment-URLs)
   - Optional `ACCESS_TEAM_DOMAIN` (z. B. `team.cloudflareaccess.com`) und `ACCESS_AUD` setzen, dann prüft die App das Token zusätzlich.
5. **Analytics-Token** (_Account Analytics: Read_) → `CF_ANALYTICS_TOKEN`. Dringend empfohlen, ohne ihn arbeitet der Budget-Wächter nicht.
6. **Branch-Protection** für `main` aktivieren:
   - PR, 1 Review und grüne CI-Checks Pflicht, kein Force-Push
   - CODEOWNERS prüfen
7. `wrangler.toml` committen und mergen, der Deploy läuft automatisch. Danach den Workflow „Datenlöschung“ unter _Actions_ einmal manuell starten und prüfen, dass er grün ist.
8. Ersten Owner anlegen: `/admin/bootstrap` öffnen, den `BOOTSTRAP_TOKEN` eingeben, den Einladungslink öffnen und „Mit Passkey einrichten“ wählen (oder Passwort + 2FA). Danach weitere Admins einladen, mindestens **2 Owner**. Notfall, falls der letzte Owner keinen Zugang mehr hat: `PRODUCTION_URL=https://… node scripts/notfall-einladung.ts <benutzername>` gibt einen `wrangler d1 execute`-Befehl und einen Reset-Link aus. Anschließend `BOOTSTRAP_TOKEN` in GitHub löschen und den Deploy erneut ausführen. Der Deploy entfernt optionale Secrets, die in GitHub leer sind oder fehlen, auch aus Pages.

**Wichtig:** `SESSION_PEPPER` und `ENC_KEY` nie ändern. Sonst sind alle Passwörter, 2FA-Geheimnisse und die Spotify-Verbindung ungültig, und alle Admins müssen neu eingeladen werden.

### Secrets (GitHub-Environment `production`)

| Name                                                                        | Pflicht                 | Zweck                                                         |
| --------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`                             | ja                      | Deploy und Workflow „Datenlöschung“                           |
| `SESSION_PEPPER`, `COOKIE_SECRET`, `QR_SECRET`, `IP_HASH_SECRET`, `ENC_KEY` | ja                      | Kryptografie (je ≥ 32 Zufallszeichen)                         |
| `BUZZER_HMAC_SECRET`                                                        | ja                      | Gleicher Wert in `agent/config.toml`                          |
| `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`                                | für Musik               | Spotify-App                                                   |
| `LASTFM_API_KEY`                                                            | für den Genre-Filter    | Last.fm-API (ohne: Gäste können jeden Song wünschen)          |
| `CF_ANALYTICS_TOKEN`                                                        | dringend empfohlen      | Budget-Wächter (ohne: keine Drosselung, Cover auch über 80 %) |
| `BOOTSTRAP_TOKEN`                                                           | nur für Ersteinrichtung | Erster Owner                                                  |
| `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`                                          | optional                | Access-JWT-Prüfung                                            |
| Variable `PBKDF2_ITERATIONS`                                                | optional                | Standard 20.000, 10.000–30.000 (CPU-Limit Free-Tier: 10 ms)   |
| Variablen `PAGES_PROJECT`, `PRODUCTION_URL`                                 | optional                | Projektname bzw. eigene Domain                                |

Eine geänderte `PBKDF2_ITERATIONS` gilt für neue oder zurückgesetzte Passwörter. Beim Login wird nur umgehasht, wenn gespeicherte und neue Iterationszahl zusammen höchstens 30.000 ergeben. Admins mit älterem Hash (z. B. 50.000) per Einladung mit Reset neu einladen.

## Rollback

- **Code:** Im Cloudflare-Dashboard unter Pages → Deployments eine frühere Version wieder aktivieren, oder den Deploy-Workflow für einen älteren Commit starten.
- **Datenbank:** D1 Time Travel (Point-in-Time-Restore).
- **Notbetrieb:** Spotify spielt die Vorprogramm-Playlist, an der Bar wird eine Strichliste geführt, ein Admin bucht später nach.

## Offene Punkte vor dem Event

- **Musikrechte (organisatorisch, nicht Teil der App):** Die Spotify Developer Terms erlauben nur private, persönliche Nutzung, die Developer Policy untersagt Produkte für Unternehmen. Eine Betriebsfeier ist voraussichtlich GEMA-pflichtig. Beides mit dem Ausrichter klären, es ist nicht abschließend geprüft. Gleiches gilt für die Last.fm-API-Nutzungsbedingungen (Genre-Filter).
- **Datenschutz:** Gespeichert werden Geräte-ID, pseudonymisierter Netz-Schlüssel und Stimmen; gelöscht wird automatisch. Offen sind die Rolle der GmbH (mögliche Mitverantwortung), der D1-Standort, der Cloudflare-Plan (Time Travel) und der Inhaber des Spotify-Party-Accounts, siehe [`docs/DATENSCHUTZ.md`](docs/DATENSCHUTZ.md).
- **Buchhaltung:** Kontenrahmen bestätigen (Defaults sind SKR03-artig: 3980 Vorrat, 4140 Aufwand, 1600 Verbindlichkeiten), dazu Durchschnittspreis und Budget.

Ablauf für den Abend: [`docs/EVENT-CHECKLISTE.md`](docs/EVENT-CHECKLISTE.md).
