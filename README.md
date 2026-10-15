# Baufrankhallen-Fete

Party-App für die Fete in der Baufrankhalle (IT Applications & Buchhaltung). Läuft komplett auf **Cloudflare Pages (Free)**: Pages Functions + D1.

| Oberfläche                                                  | URL                                          | Wer                                                |
| ----------------------------------------------------------- | -------------------------------------------- | -------------------------------------------------- |
| Gäste (Voting, Songwünsche)                                 | QR-Code auf dem TV → `/v/<code>`             | Alle Gäste, nur QR scannen                         |
| TV / Bar 1 Stattrack / Bar 2 Buchhaltung / Player-Taktgeber | `/display` (Rolle wird beim Koppeln gewählt) | Bildschirme                                        |
| Adminbereich                                                | `/admin`                                     | Orga-Team, eigener Login + 2FA                     |
| Buzzer                                                      | PC-Agent → `/api/buzzer/*`                   | Bar-PC, siehe [`agent/README.md`](agent/README.md) |

## So funktioniert der Abend

- **Sets** legen fest, welche Songs wann zur Wahl stehen, und haben ein Standard-Stimmungslevel (1 Chill … 5 Eskalation).
- **Erstes Voting** startet zur eingestellten Uhrzeit. Bis dahin läuft die Vorprogramm-Playlist.
- **Jede Runde hat genau ein Stimmungslevel.** Von Runde zu Runde ändert es sich um höchstens eine Stufe, so gibt es keine harten Übergänge.
- **Abstimmzeit mindestens 17 Minuten.** Die nächste Runde läuft, bis der letzte Gewinner-Song der vorherigen Runde anfängt. Es staut sich nie mehr als eine Runde, Filler-Songs gibt es nicht.
- **Spotify-Queue:** Die App reiht immer nur den nächsten Gewinner ein, sobald der aktuelle läuft. Korrekturen im Admin wirken bis dahin.
- **Notfall:** Fallen App, Netz oder Spotify-API aus, läuft die Vorprogramm-Playlist in Dauerschleife weiter. Es wird also nie still.
- **Buzzer = 1 Kasten** zum Durchschnittspreis. Gebucht wird _Soll Getränkeaufwand / Haben Getränkevorrat_. Korrekturen gehen nur per Storno.

## Betrugsschutz für Gäste (ohne Zusatzaufwand)

Gäste scannen nur den QR-Code. Unsichtbar geprüft werden:

- **Rotierender QR-Token** (60 s) als Anwesenheitsnachweis. Er setzt ein signiertes Geräte-Cookie für den ganzen Abend.
- **Cloudflare Turnstile** im Invisible-Modus.
- **IP-Limit pro Runde:** IPv6 pro /64-Netz (Standard 1), IPv4 Standard 3, weil Mobilfunk-CGNAT und iCloud Private Relay Adressen teilen. Unverifizierte Geräte zählen immer streng (1 pro IP).
- **Rate-Limits**, Gerätesignatur als Indiz und auffällige Netze im Admin sichtbar.

Restrisiko: Wer gezielt Browser oder Gerät wechselt _und_ sich neu ins Mobilfunknetz einwählt, kann mehrfach abstimmen. Ohne Login ist das nicht vollständig verhinderbar.

## Sicherheit Adminbereich

- Eigener Account pro Admin, Einladung per Einmal-Link (24 h).
- Passwort (PBKDF2 + geheimer Pepper) und **Pflicht-TOTP**, dazu 10 Wiederherstellungscodes.
- Sessions als `__Host-` Cookies mit SameSite=Strict, Idle 2 h, maximal 12 h. CSRF-Schutz über Origin-Prüfung und Pflicht-Header.
- Kritische Aktionen (Admins verwalten, Gästedaten löschen) brauchen eine **erneute 2FA-Bestätigung**.
- Rollen `owner` (verwaltet Admins) und `admin`.
- Login-Drosselung pro Benutzer + IP, damit Gäste niemanden aussperren können.
- Lückenloses **Audit-Log** aller Änderungen.
- Optional zusätzlich **Cloudflare Access** (siehe unten). Wenn `ACCESS_AUD` gesetzt ist, prüft die App das Access-JWT selbst.
- Strikte CSP ohne Inline-Skripte und HSTS. Displays sind nur nach Kopplung durch einen Admin nutzbar, Buzzer-Requests sind HMAC-signiert und gegen Wiederholung geschützt.

## Kosten / Free-Tier

Pro Tag sind 100.000 Function-Requests frei. Für 6 h, 150 Gäste und etwa 18 Runden kommt die Planung im schlechtesten Fall auf rund 25.000 Requests.

- **Statische Dateien zählen nicht** (`_routes.json` aktiviert Functions nur für `/api/*`).
- Gäste fragen nicht dauerhaft ab, nur beim Laden, beim Abstimmen und beim Rundenwechsel (mit Zufallsverzögerung).
- Der **Budget-Wächter** im Dashboard zeigt den echten Verbrauch (optional `CF_ANALYTICS_TOKEN`). Ab 60 % werden Gäste und Bar-Screens automatisch gedrosselt; TV, Player-Tab und Buzzer-PC (die Taktgeber) nie.
- Welche Analytics-Datensätze Pages-Functions-Aufrufe enthalten, ist nicht abschließend geprüft. Die App fragt `workersInvocationsAdaptive` und `pagesFunctionsInvocationsAdaptiveGroups` ab und nimmt den größeren Wert. Vor dem Event mit dem Cloudflare-Dashboard abgleichen.

## Änderungen machen (ohne Cloudflare-Zugang)

1. Branch anlegen, ändern, Pull Request öffnen. Die **CI** prüft Audit, Lint, Format, Theme-Regel, Typen, Unit-/Integrationstests mit Coverage, Build, Migrationen auf frischer D1, Smoke-Test gegen `wrangler pages dev`, Playwright-E2E (inkl. CSP-Verstößen) und den PC-Agenten.
2. Nach Review in `main` mergen. **`deploy.yml`** führt die CI erneut aus, wendet D1-Migrationen an, synchronisiert die Secrets, deployt und macht einen Health-Check auf Produktion.

Migrationen nur **additiv** schreiben (neue Datei `migrations/000N_*.sql`). Der laufende Code muss mit dem neuen Schema funktionieren.

### Design an den Einladungsflyer anpassen

Alle Farben, Schriften, Radius, Logo und Eventname stehen **ausschließlich** in [`src/shared/theme.ts`](src/shared/theme.ts). Logo: `public/logo.svg`. Die CI verbietet Farbwerte an anderen Stellen und prüft den WCAG-Kontrast aller Textfarben. Ändern → PR → Merge → live.

## Lokale Entwicklung

```bash
npm ci
npm run build && npm run test:smoke -- --serve   # baut, migriert lokale D1, startet http://127.0.0.1:8799
npm run dev                                      # optional: Vite mit Hot-Reload auf :5173 (API-Proxy auf :8799)
npm test                                         # Unit- + Integrationstests (inkl. Abendsimulation)
PW_CHROMIUM_PATH=/pfad/zu/chrome npm run test:e2e
```

`npm run test:smoke` legt beim ersten Start eine `.dev.vars` mit Zufalls-Secrets an (`BOOTSTRAP_TOKEN=local-bootstrap-token`).

## Einmalige Einrichtung (Owner mit Cloudflare-Zugang)

1. `scripts/bootstrap-cloudflare.sh` ausführen. Das Script:
   - legt die D1-Datenbank an und trägt die ID in `wrangler.toml` ein,
   - legt das Pages-Projekt an,
   - setzt die Basis-Secrets im GitHub-Environment `production` (falls `gh` angemeldet ist).
2. **Cloudflare API-Token** anlegen: Rechte _Account → Cloudflare Pages → Edit_ und _Account → D1 → Edit_, nur dieses Konto, mit Ablaufdatum. In GitHub als Environment-Secrets `CLOUDFLARE_API_TOKEN` und `CLOUDFLARE_ACCOUNT_ID` hinterlegen.
3. **Spotify-App** auf developer.spotify.com mit dem **Premium-Party-Account** anlegen:
   - Redirect-URI: `https://<projekt>.pages.dev/admin/spotify/callback`
   - Secrets `SPOTIFY_CLIENT_ID` und `SPOTIFY_CLIENT_SECRET`
4. **Turnstile-Widget** im Modus _Invisible_ für die Domain anlegen → `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET`.
5. **Cloudflare Access** (Zero Trust, gratis bis 50 Nutzer) einrichten:
   - Anwendung für `<projekt>.pages.dev/admin`, `/api/admin` **und** `*.<projekt>.pages.dev` (Deployment-URLs)
   - Optional `ACCESS_TEAM_DOMAIN` (z. B. `team.cloudflareaccess.com`) und `ACCESS_AUD` setzen, dann prüft die App das Token zusätzlich.
6. Optional ein Analytics-Token (_Account Analytics: Read_) → `CF_ANALYTICS_TOKEN`.
7. **Branch-Protection** für `main` aktivieren:
   - PR, 1 Review und grüne CI-Checks Pflicht, kein Force-Push
   - CODEOWNERS prüfen
8. `wrangler.toml` committen und mergen, der Deploy läuft automatisch.
9. Ersten Owner anlegen: `/admin/bootstrap` öffnen, den `BOOTSTRAP_TOKEN` eingeben, den Einladungslink öffnen und Passwort + 2FA einrichten. Danach weitere Admins einladen, mindestens **2 Owner**. Den Bootstrap-Token anschließend entfernen.

**Wichtig:** `SESSION_PEPPER` und `ENC_KEY` nie ändern. Sonst sind alle Passwörter, 2FA-Geheimnisse und die Spotify-Verbindung ungültig, und alle Admins müssen neu eingeladen werden.

### Secrets (GitHub-Environment `production`)

| Name                                                                        | Pflicht                 | Zweck                                                       |
| --------------------------------------------------------------------------- | ----------------------- | ----------------------------------------------------------- |
| `SESSION_PEPPER`, `COOKIE_SECRET`, `QR_SECRET`, `IP_HASH_SECRET`, `ENC_KEY` | ja                      | Kryptografie (je ≥ 32 Zufallszeichen)                       |
| `BUZZER_HMAC_SECRET`                                                        | ja                      | Gleicher Wert in `agent/config.toml`                        |
| `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`                                | für Musik               | Spotify-App                                                 |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET`                                    | empfohlen               | Bot-Schutz                                                  |
| `BOOTSTRAP_TOKEN`                                                           | nur für Ersteinrichtung | Erster Owner                                                |
| `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`                                          | optional                | Access-JWT-Prüfung                                          |
| `CF_ANALYTICS_TOKEN`                                                        | optional                | Budget-Wächter                                              |
| Variable `PBKDF2_ITERATIONS`                                                | optional                | Standard 50.000, max. 100.000 (CPU-Limit Free-Tier messen!) |
| Variablen `PAGES_PROJECT`, `PRODUCTION_URL`                                 | optional                | Projektname bzw. eigene Domain                              |

## Rollback

- **Code:** Im Cloudflare-Dashboard unter Pages → Deployments eine frühere Version wieder aktivieren, oder den Deploy-Workflow für einen älteren Commit starten.
- **Datenbank:** D1 Time Travel (Point-in-Time-Restore).
- **Notbetrieb:** Spotify spielt die Vorprogramm-Playlist, an der Bar wird eine Strichliste geführt, ein Admin bucht später nach.

## Offene Punkte vor dem Event

- **Recht:** Die Spotify Developer Policy untersagt die Wiedergabe „publicly from a business“; eine Betriebsfeier ist eventuell GEMA-pflichtig. Das muss die Rechtsabteilung klären, es ist nicht geprüft.
- **Datenschutz / Betriebsrat:** Gespeichert werden Geräte-ID, anonymisierter IP-Schlüssel und Stimmen. Nach dem Event im Admin unter „Eventdaten bereinigen“ löschen.
- **Buchhaltung:** Kontenrahmen bestätigen (Defaults sind SKR03-artig: 3980 Vorrat, 4140 Aufwand, 1600 Verbindlichkeiten), dazu Durchschnittspreis und Budget.

Ablauf für den Abend: [`docs/EVENT-CHECKLISTE.md`](docs/EVENT-CHECKLISTE.md).
