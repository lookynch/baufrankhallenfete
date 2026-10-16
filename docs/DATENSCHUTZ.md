# Datenschutz-Dokumentation

Interne Dokumentation des Betreibers zur Rechenschaftspflicht (Art. 5 Abs. 2 DSGVO). Sie ergänzt die Datenschutzerklärung `/datenschutz` (Text in [`src/client/pages/legal/texts.ts`](../src/client/pages/legal/texts.ts)).

- Name und Anschrift des Verantwortlichen und der Aufsichtsbehörde sowie alle Fristen stehen im Code nur in [`src/shared/legal.ts`](../src/shared/legal.ts). Die Fristen unten geben den Stand dieses Dokuments wieder; bei Änderungen dieses Dokument und die [Event-Checkliste](EVENT-CHECKLISTE.md) anpassen.
- Kennzeichnung: **[plausibel]** = gut begründet, nicht abschließend geklärt; **[unsicher]** = offene Rechtslage oder ungeprüfte Tatsache. Die Bewertungen beruhen auf eigener Recherche, nicht auf anwaltlicher Prüfung.
- Das Repo ist öffentlich. Verträge, Prüfnachweise, Anfragen und Vorfälle gehören in eine private Ablage des Betreibers, nicht hierher.

## 1. Rollen

| Wer                                       | Rolle                                                                                                                                                                                                                                                                                               |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Betreiber (`legal.controller`)            | Verantwortlicher, privat und nicht-kommerziell. Kein Datenschutzbeauftragter, weil keine Pflicht dazu besteht.                                                                                                                                                                                      |
| Ausrichter der Fete (`theme.event.hosts`) | Richtet die Feier aus, betreibt die App nicht. Zur möglichen Mitverantwortung siehe Abschnitt 11.                                                                                                                                                                                                   |
| Admin-Helfer                              | Handeln auf Weisung des Betreibers (Art. 29 DSGVO).                                                                                                                                                                                                                                                 |
| Cloudflare, Inc.                          | Auftragsverarbeiter für Pages, Functions, D1 und optional Access (Abschnitt 7). Netzwerk- und Sicherheitsdaten verarbeitet Cloudflare zusätzlich in eigener Verantwortung (Self-Serve Subscription Agreement Ziff. 2.5.5 „Network Data“); die Rolle ist vertraglich nicht eindeutig **[unsicher]**. |
| Spotify AB, Stockholm                     | Empfänger von Suchtexten und Track-Kennungen, die der Server ohne IP-Adresse und Geräte-ID sendet. Ist der Party-Account ein privates Konto, ist der Betreiber für dessen Wiedergabedaten nach den Spotify Developer Terms (Anhang A) eigener Verantwortlicher.                                     |
| Last.fm Ltd., London                      | Empfänger von Künstlernamen aus Suchergebnissen (Genre-Filter). Der Server sendet nur den Namen, ohne Suchtext, IP-Adresse oder Geräte-ID; kein Personenbezug, daher keine Drittlandübermittlung personenbezogener Daten.                                                                           |
| Google (Gmail)                            | Postfach des Betreibers für Anfragen. Rolle und Drittlandbezug nicht geprüft **[unsicher]**.                                                                                                                                                                                                        |
| Buchhaltung des Ausrichters               | Erhält nach der Fete das Verbrauchsprotokoll (CSV) mit der Spalte „Erfasst von“ (Anzeigename des Admins).                                                                                                                                                                                           |

## 2. Verzeichnis von Verarbeitungstätigkeiten (Art. 30 Abs. 1 DSGVO)

Für beide Einträge gilt: Verantwortlicher ist der Betreiber (`legal.controller`), Kontakt per E-Mail. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO (Abschnitt 4), nicht lit. b, weil kein Vertrag mit dem Betreiber besteht. Drittland: USA über Cloudflare (Abschnitt 7). Löschfristen: Abschnitt 6. TOM: Abschnitt 3.

### 2.1 Gäste: Teilnahme, Abstimmung, Wünsche, Suche

- **Zwecke:** Teilnahme per QR-Code, eine Stimme pro Gerät und Runde, Songwünsche und Unterstützung (+1), Songsuche, Schutz vor Mehrfachabstimmung und Überlastung, Auslieferung der App, Beantwortung von Anfragen.
- **Betroffene:** Gäste der Fete, überwiegend Beschäftigte der GmbH. Ob auch Externe teilnehmen, ist offen.
- **Daten:**
  - Cookie `__Host-fete` mit zufälliger Geräte-ID und Ablaufzeit, signiert.
  - `devices`: Geräte-ID, erster und letzter Beitritt. Die Spalte `ip_key` wird nicht mehr geschrieben, weil sie keinen Zweck hat.
  - `votes`: Runde, Song, Geräte-ID, Netz-Schlüssel (IPv4 bzw. IPv6-/64 und /48), Zeitpunkte, Ungültig-Vermerk.
  - `wishes` und `wish_upvotes`: Song, Geräte-ID, Status, Zeitpunkte; bei Unterstützungen zusätzlich der Netz-Schlüssel.
  - `search_cache`: Suchtext und Ergebnisse ohne Gerätebezug.
  - `rate_limits`: Zähler je Geräte-ID oder Netz-Schlüssel.
  - Verbindungsdaten bei Cloudflare (IP-Adresse, User-Agent, URL). Die App selbst führt kein Zugriffsprotokoll und speichert keine IP-Adresse im Klartext.
  - Local Storage `lang`, bleibt auf dem Gerät.
  - E-Mail-Anfragen: Adresse und Inhalt.
- **Empfänger:** Cloudflare (Auftragsverarbeiter); Spotify AB (Suchtext, Track-Kennung); Admin-Helfer (Wünsche ohne Geräte-ID; Anfang des Netz-Schlüssels und Gerätezahl bei auffälligen Netzen, nach einer Ungültigsetzung 7 Tage im Audit-Log; Anfrage-Zähler der letzten Stunde mit vollständigem Netz-Schlüssel bzw. Geräte-ID); Gmail bei E-Mail-Kontakt.
- **Rechtsgrundlage für Speicher auf dem Gerät:** § 25 Abs. 2 Nr. 2 TDDDG (Abschnitt 5).

### 2.2 Adminbereich und Audit-Log

- **Zwecke:** Zugriffsschutz und IT-Sicherheit des Adminbereichs, Nachvollziehbarkeit von Änderungen, Musiksteuerung über den Spotify-Party-Account, Buchung des Getränkeverbrauchs. Keine Leistungs- oder Verhaltenskontrolle.
- **Betroffene:** Admin-Helfer und eingeladene Personen, Inhaber des Spotify-Party-Accounts.
- **Daten:**
  - `admin_users`: Benutzername, Anzeigename, Rolle, Passwort-Hash (PBKDF2), TOTP-Schlüssel verschlüsselt (bei reinen Passkey-Konten leer), zufällige WebAuthn-Benutzerkennung, letzte Anmeldung, aktiv oder deaktiviert.
  - `admin_passkeys`: Credential-ID, öffentlicher Schlüssel, Signaturzähler, Transports, Name, Zeitpunkt von Einrichtung und letzter Nutzung. Keine biometrischen Daten, kein privater Schlüssel. Löschung durch den Admin unter „Mein Konto“, beim Reset und per `ON DELETE CASCADE` mit dem Konto.
  - `webauthn_challenges`: Hash der einmaligen Anmelde-Challenge, Zweck, Bezug (Einladung, Konto oder Sitzung), Ablauf nach 5 Minuten; wird beim Einlösen gelöscht, Reste im täglichen Löschlauf.
  - `admin_recovery_codes` als Hash, `admin_invites` mit Benutzername, Anzeigename, Rolle und Ablauf.
  - `admin_sessions`: Hash des Sitzungs-Tokens und Zeitstempel, ohne IP-Adresse und User-Agent. Cookie `__Host-admin`.
  - `audit_log`: Zeitpunkt, Konto, Aktion, Werte vorher und nachher; bei Anmeldung, Fehlversuch und erneuter Bestätigung der Netz-Schlüssel.
  - `rate_limits`: Anmelde-Zähler je Netz-Schlüssel und je HMAC aus Benutzername und Netz-Schlüssel, Code-Eingaben je Konto.
  - Spotify: Anzeigename des verbundenen Kontos im Audit-Log, Zugangsschlüssel verschlüsselt in `kv`, abgespielte Titel (`observed_plays`, `spotify_snapshot`), Cookie `__Host-oauth`.
  - Konto-Nummer in `ledger_entries`, `wishes.decided_by`, `settings` und `displays`.
  - Optional Cloudflare Access: Identität und Cookie `CF_Authorization` verarbeitet Cloudflare, die App prüft nur das Token.
- **Empfänger:** Cloudflare; Spotify beim Verbinden des Kontos; alle Admins sehen die Admin-Liste, das Audit-Log ohne Netz-Schlüssel und die Anmelde-Zähler der letzten Stunde mit Netz-Schlüssel bzw. Benutzername; die Buchhaltung des Ausrichters erhält das Verbrauchsprotokoll mit „Erfasst von“.

## 3. Technische und organisatorische Maßnahmen (Art. 32 DSGVO)

**Datenminimierung und Pseudonymisierung**

- IP-Adressen nur als HMAC-SHA-256 mit `IP_HASH_SECRET`: IPv4 vollständig, IPv6 als /64- und /48-Präfix. Keine IP-Adresse im Klartext in der Datenbank.
- Benutzername im Anmelde-Limit nur als HMAC. Das Audit-Log speichert beim Zurücksetzen eines Limits nur dessen Art.
- Kein Fingerprint, keine Bot-Challenge, keine IP oder Browserkennung in Admin-Sitzungen. Suchcache ohne Gerätebezug. Bar-Screens erhalten Buchungen ohne Admin-Kennung.
- Migration 0003 hat Altbestände entfernt: Fingerprint-Hashes, IP und User-Agent der Sitzungen, Login-Zähler mit Benutzernamen im Klartext und Limit-Schlüssel in Audit-Einträgen.

**Zugriffsschutz Adminbereich**

- Persönliche Konten, Einladung per Einmal-Link (24 h), Rollen `owner` und `admin`.
- Passwort mit PBKDF2-SHA-256 und geheimem Pepper, Pflicht-TOTP mit AES-GCM-verschlüsseltem Schlüssel (`ENC_KEY`), Wiederherstellungscodes nur als Hash.
- Alternativ Passkeys (WebAuthn, Nutzerverifikation Pflicht, Attestation `none`), an `WEBAUTHN_ORIGIN` gebunden, Challenges serverseitig und einmalig.
- Erneute Bestätigung per Passkey oder 2FA-Code für kritische Aktionen.
- Anmelde-Limits je 15 min: 30 Versuche pro IP (IPv6: /64), 60 pro IPv6-/48-Netz, 5 pro Benutzer und IP, 6 Code-Eingaben pro Konto.
- Optional Cloudflare Access vor `/admin` und `/api/admin`.

**Cookies und Browser**

- Alle Cookies der App mit Präfix `__Host-`, `Secure` und `HttpOnly`, Inhalt signiert oder Zufallswert. Admin und Displays `SameSite=Strict`, Gast und Spotify-Verbindung `SameSite=Lax`.
- Gast-Cookie höchstens 24 h, ein erneuter Scan verlängert es nicht.
- CSP nur `'self'` (Bilder zusätzlich `data:`), keine Inline-Skripte, keine Ressourcen von Drittanbietern. Dazu HSTS, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, COOP und CORP `same-origin`, restriktive `Permissions-Policy`.
- CSRF-Schutz über Origin-Prüfung, im Adminbereich zusätzlich ein Pflicht-Header.
- Cover-Proxy mit fester Upstream-Adresse (`https://i.scdn.co/image/<id>`), ohne Weitergabe von Client-Headern, Browser-Cache `private`.
- Displays nur nach Kopplung durch einen Admin, Buzzer-Requests HMAC-signiert und gegen Wiederholung geschützt.

**Löschung und Wiederherstellung**

- Automatische Löschung, Gast-Button und Admin-Button (Abschnitt 6).
- D1 Time Travel zur Wiederherstellung, Notbetrieb über Vorprogramm-Playlist und Strichliste.

**Betrieb und Änderungen**

- Secrets nur im GitHub-Environment `production` und in Pages. `SESSION_PEPPER` und `ENC_KEY` werden nie rotiert, `IP_HASH_SECRET` optional nach der Fete.
- Änderungen nur per Pull Request mit Review und CI: Lint, Typen, Tests mit Coverage, Build, Smoke-Test, E2E mit CSP-Prüfung und Netzwerk-Watcher. Actions per Commit-SHA gepinnt, Branch-Protection für `main`.
- Cloudflare-API-Token nur für dieses Konto, mit Ablaufdatum.

**Option: eigener Token für den Lösch-Workflow (Least Privilege)**

Der Workflow „Datenlöschung“ nutzt heute denselben Token wie der Deploy (_Cloudflare Pages: Edit_ und _D1: Edit_). Der Token steht nur im Lösch-Step, nicht in `npm ci`. Wer die Rechte enger fassen will:

1. In Cloudflare einen Token nur mit _Account → D1 → Edit_ für dieses Konto anlegen, mit Ablaufdatum.
2. In GitHub ein Environment `retention` anlegen, Deployment-Branch nur `main`, mit den Secrets `CLOUDFLARE_API_TOKEN` (der neue Token) und `CLOUDFLARE_ACCOUNT_ID`.
3. In [`.github/workflows/retention.yml`](../.github/workflows/retention.yml) `environment: production` durch `environment: retention` ersetzen.

Nutzen: Ein kompromittierter Löschlauf kann keine Pages-Deployments ändern. Aufwand: ein zweiter Token mit eigenem Ablaufdatum.

## 4. Interessenabwägung (Art. 6 Abs. 1 lit. f DSGVO)

Für alle Verarbeitungen gilt: Die Teilnahme ist freiwillig, es werden keine Namen erhoben, Gästedaten werden 7 Tage nach der letzten Aktivität gelöscht oder anonymisiert, und Gäste können ihre Daten selbst löschen, solange ihr Geräte-Cookie gilt (höchstens 24 h). Die meisten Gäste und Admin-Helfer sind Beschäftigte der GmbH. Der Betreiber ist nicht ihr Arbeitgeber, und die GmbH erhält keine Gästedaten. Ergebnis jeweils: Das Interesse des Betreibers überwiegt **[plausibel]**.

**a) Auslieferung der App (Hosting)**

- Interesse: sicherer, funktionierender Betrieb.
- Erforderlichkeit: Verbindungsdaten fallen technisch zwingend an. Die App führt kein eigenes Zugriffsprotokoll, Cover kommen über den eigenen Server, damit Spotify keine Gast-IP erhält.
- Abwägung: übliche, erwartbare Daten; Auftragsverarbeitung mit Cloudflare; Drittland über DPF bzw. Standardvertragsklauseln.

**b) Geräte-ID**

- Interesse: eine Stimme pro Gerät, Stimme ändern, eigene Wünsche sehen.
- Erforderlichkeit: Ohne Wiedererkennung ist keine faire Abstimmung möglich. Ein Login wäre eingriffsintensiver.
- Abwägung: Zufallswert ohne Namen, Cookie höchstens 24 h, Löschung per Button.

**c) Netz-Schlüssel und Schutzgrenzen**

- Interesse: Mehrfachabstimmung durch Cookie-Löschen erschweren, Überlastung abwehren.
- Erforderlichkeit: Das Cookie allein lässt sich löschen. Bot-Challenge und Fingerprint wurden bewusst entfernt, IPv6 wird nur als Präfix verwendet.
- Abwägung: Pseudonymisierung per HMAC, keine Klartext-IP, Zähler nach 24 h gelöscht, bei auffälligen Netzen nur der Anfang des Schlüssels sichtbar. Die Zähler-Liste der letzten Stunde zeigt den vollständigen Schlüssel, damit Admins Sperren lösen können. Geteilte Adressen (Mobilfunk-CGNAT) können legitime Stimmen ablehnen, die Limits sind deshalb einstellbar. Keine Entscheidung nach Art. 22 DSGVO, weil eine abgelehnte Stimme nicht erheblich beeinträchtigt.

**d) Abstimmung einschließlich Ungültigsetzung**

- Interesse: Gäste über die Musik mitbestimmen lassen, Manipulation korrigieren.
- Erforderlichkeit: Die Stimme muss gespeichert sein, um sie zu zählen und Änderungen zuzulassen.
- Abwägung: Angezeigt werden nur Summen je Song. Die Ungültigsetzung betrifft auffällige Netze und wirkt sich nur auf die Musik aus.

**e) Songwünsche und Unterstützung**

- Interesse: Musikwünsche fair berücksichtigen.
- Erforderlichkeit: Geräte-ID und Netz-Schlüssel begrenzen offene Wünsche und Unterstützungen und zeigen dem Gast seine Wünsche.
- Abwägung: Die Moderation sieht keine Geräte-ID, nach 7 Tagen bleibt der Wunsch ohne Personenbezug.

**f) Songsuche über Spotify**

- Interesse: Songwünsche ermöglichen.
- Erforderlichkeit: Der Katalog ist nur über die Spotify-API durchsuchbar. Der Server sendet nur Suchtext bzw. Track-Kennung, der Cache (24 h) spart Anfragen.
- Abwägung: Persönliche Angaben im Suchtext sind möglich. Die Suche bittet daher um Song- oder Künstlernamen, Spotify AB sitzt in der EU.
- Genre-Filter: Für den Hauptkünstler jedes Treffers fragt der Server die Top-Tags bei Last.fm ab und speichert sie 30 Tage in `artist_tags`. Übermittelt wird nur der Künstlername aus dem Spotify-Katalog, nie der Suchtext oder Gastdaten.

**g) Kontakt per E-Mail**

- Interesse: Anfragen beantworten.
- Erforderlichkeit: Ohne Adresse und Inhalt keine Antwort.
- Abwägung: Die Person entscheidet selbst über den Kontakt. Löschung nach Erledigung.

**h) Admin-Konten und Anmeldeschutz**

- Interesse: nur berechtigte Personen im Adminbereich.
- Erforderlichkeit: persönliche Konten mit 2FA statt eines geteilten Passworts. Anmelde-Zähler sind nötig gegen Passwortraten.
- Abwägung: Sitzungen ohne IP und Browserkennung, Benutzername in Zählern nur als HMAC, deaktivierte Konten nach 90 Tagen gelöscht.

**i) Audit-Log**

- Interesse: Änderungen nachvollziehen, Missbrauch aufklären.
- Erforderlichkeit: Ohne Protokoll lassen sich Fehlbuchungen, Löschungen oder Rechteänderungen nicht zuordnen.
- Abwägung: keine Leistungs- oder Verhaltenskontrolle, Netz-Schlüssel nach 7 Tagen entfernt, Einträge nach 90 Tagen gelöscht.

**j) Spotify-Verbindung und Wiedergabedaten**

- Interesse: Musiksteuerung und Rundenablauf der Fete.
- Erforderlichkeit: Die App muss Zugangsschlüssel und den laufenden Titel kennen.
- Abwägung: Schlüssel verschlüsselt, Trennen löscht sie. Die Titelliste hat keine feste Frist (Abschnitt 11).

**k) Buchungen mit Konto-Nummer und Verbrauchsprotokoll**

- Interesse: nachvollziehbare Buchhaltung für die Fete.
- Erforderlichkeit: Bei Korrekturen muss klar sein, wer gebucht hat.
- Abwägung: Bar-Screens zeigen keine Admin-Kennung. Die Weitergabe des Anzeigenamens an die Buchhaltung ist der Punkt, an dem eine Mitverantwortung der GmbH entstehen kann (Abschnitt 11).

## 5. Speicher auf dem Gerät (§ 25 TDDDG)

| Eintrag                                                                                | Zugriff                                                     | Bewertung                                                                                                                   |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Cookie `__Host-fete`                                                                   | beim Beitritt gesetzt, bei jeder Gast-Anfrage gelesen       | Abs. 2 Nr. 2: unbedingt erforderlich für die Teilnahme, die der Gast durch das Scannen ausdrücklich wünscht **[plausibel]** |
| Local Storage `lang`                                                                   | nur nach Tippen auf DE oder EN, nur lokal gelesen           | Abs. 2 Nr. 2 **[plausibel]**                                                                                                |
| `navigator.language`                                                                   | per JavaScript gelesen, wenn `lang` fehlt; nicht übertragen | Abs. 2 Nr. 2: nur zur Anzeige in der Sprache des Gastes **[plausibel]**                                                     |
| `__Host-admin`, `__Host-oauth`, Session Storage `admin-invite-token`, `__Host-display` | Anmeldung bzw. Absicherung der jeweils gewünschten Funktion | Abs. 2 Nr. 2                                                                                                                |
| Cookie `CF_Authorization`                                                              | nur mit Cloudflare Access, nur Adminbereich                 | Abs. 2 Nr. 2 **[plausibel]**                                                                                                |

- **Kein Fingerprint:** Das Auslesen von Browsermerkmalen per JavaScript ist ein Zugriff nach § 25 Abs. 1 TDDDG (DSK OH Digitale Dienste Rn. 24). Er diente nur einer Admin-Statistik und war daher nicht unbedingt erforderlich. Ein Ersatz über Header wie User-Agent und Accept-Language wurde nicht gewählt, weil auch er unter Art. 5 Abs. 3 ePrivacy-RL fallen kann (EDPB-Leitlinien 2/2023 Rn. 43).
- **Keine Bot-Challenge:** Turnstile führt JavaScript-Prüfungen im Browser aus und nutzt die Signale auch für Cloudflares eigene Zwecke. Ob die Ausnahme nach Abs. 2 Nr. 2 trägt, war offen (DSK OH Rn. 83, 86, 95) **[unsicher]**. Turnstile ist deshalb entfernt.
- **Keine Drittressourcen:** CSP nur `'self'`, Cover über den Proxy, Spotify-Links öffnen erst beim Tippen. Kein Dritter greift beim Aufruf auf das Endgerät zu.
- **Ergebnis:** Keine Einwilligung nach § 25 Abs. 1 TDDDG nötig, daher kein Banner **[plausibel]**. Voraussetzungen: Keine Cloudflare-Zone-Funktion bindet Skripte unter `/cdn-cgi/` ein (Event-Checkliste), und jeder neue Speicher-Eintrag wird vorher geprüft.

## 6. Löschkonzept

| Daten                             | Frist                                 | ab                             | Umsetzung                                                                                                                                                            |
| --------------------------------- | ------------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stimmen (`votes`)                 | 7 Tage                                | letzte Änderung                | gelöscht                                                                                                                                                             |
| Geräteeintrag (`devices`)         | 7 Tage                                | letzter Beitritt               | gelöscht                                                                                                                                                             |
| Wünsche (`wishes.device_id`)      | 7 Tage                                | Anlage                         | anonymisiert, Wunsch bleibt                                                                                                                                          |
| Unterstützungen (`wish_upvotes`)  | 7 Tage                                | Anlage                         | Geräte-ID und Netz-Schlüssel entfernt                                                                                                                                |
| Suchcache (`search_cache`)        | 24 h                                  | Abruf                          | gelöscht                                                                                                                                                             |
| Anfrage-Zähler (`rate_limits`)    | 24 h                                  | Fensterbeginn                  | gelöscht, laufende Sperren bleiben                                                                                                                                   |
| Netz-Schlüssel im Audit-Log       | 7 Tage                                | Eintrag                        | entfernt                                                                                                                                                             |
| Audit-Log                         | 90 Tage                               | Eintrag                        | gelöscht                                                                                                                                                             |
| Admin-Sitzungen                   | Ablauf (12 h) oder 2 h ohne Aktivität |                                | beim nächsten Lauf gelöscht                                                                                                                                          |
| Einladungen                       | 90 Tage                               | Ablauf                         | gelöscht                                                                                                                                                             |
| Deaktivierte Admin-Konten         | 90 Tage                               | letzte Anmeldung, sonst Anlage | gelöscht, Recovery-Codes und Sitzungen per `ON DELETE CASCADE`; liegt die Anmeldung länger zurück, schon beim nächsten Lauf nach der Sperre (Hinweis unter „Admins“) |
| Gast-Cookie                       | höchstens 24 h                        | erster Scan                    | Ablauf im Browser                                                                                                                                                    |
| E-Mails                           | bis zur Erledigung                    |                                | manuell                                                                                                                                                              |
| Gelöschte Daten in D1 Time Travel | 7 Tage (Workers Free)                 | Löschung                       | durch Cloudflare, nicht abschaltbar                                                                                                                                  |

**Mechanismus**

- Die einzige Quelle der Regeln ist `retentionStatements` in [`src/server/services/retention.ts`](../src/server/services/retention.ts).
- Täglich um 04:23 UTC führt der Workflow „Datenlöschung“ (`.github/workflows/retention.yml`) `RETENTION_SQL` mit `wrangler d1 execute --remote --command` aus. Die Löschung kann daher bis zu einen Tag nach Fristablauf erfolgen.
- Nachweis: Das letzte Statement setzt `retention_run` in `kv`; der Workflow prüft den Zeitstempel. Bei Fehlern legt er ein Issue an, das Dashboard warnt nach 48 h ohne Lauf. Wegen der 60-Tage-Regel für Schedules in öffentlichen Repos gibt es Prüftermine in der Event-Checkliste (Fete −7, +8 und +91 Tage).
- „Eventdaten bereinigen“ (Owner, erneute 2FA) wendet dieselbe Liste mit Stichtag „jetzt“ für alle Gästedaten an.
- „Meine Daten auf diesem Gerät löschen“ (`POST /api/public/forget`) löscht sofort Stimmen, Unterstützungen, Geräteeintrag, Zähler der Geräte-ID und Cookie und anonymisiert die Wünsche des Geräts. Der Button steht nur bereit, solange das Geräte-Cookie gilt (höchstens 24 h). Gast-Endpunkte verlangen einen vorhandenen Geräteeintrag, ein zurückbehaltenes Cookie wirkt nach der Löschung also nicht mehr.

**Ohne feste Frist** bleiben, weil für Abrechnung und Ablauf der Fete gebraucht: Buchungen, Einstellungen, Displays, Songs und Sets, anonymisierte Wünsche, abgespielte Titel (`observed_plays`, `spotify_snapshot`) und die Spotify-Zugangsschlüssel bis zur Trennung.

**Aktives Admin-Konto auf Anfrage löschen**

1. Im Admin unter „Admins“ deaktivieren (Owner, erneute 2FA). Das beendet die Sitzungen und widerruft offene Einladungen. Das eigene Konto und der letzte aktive Owner lassen sich nicht deaktivieren.
2. Werden die Buchungen des Kontos noch gebraucht, vorher das Verbrauchsprotokoll exportieren. Danach ist „Erfasst von“ leer.
3. Mit Cloudflare-Zugang (`wrangler login` oder Token mit D1-Rechten) ausführen, Groß-/Kleinschreibung des Benutzernamens spielt keine Rolle:

   ```bash
   npx wrangler d1 execute fete --remote --command "DELETE FROM admin_invites WHERE username = 'benutzername'"
   npx wrangler d1 execute fete --remote --command "DELETE FROM admin_users WHERE username = 'benutzername' AND disabled = 1"
   ```

4. Audit-Einträge zum Konto (Konto-Nummer, bei Einladungen auch Benutzer- und Anzeigename) laufen nach 90 Tagen aus. Vorzeitiges Löschen schwächt die Nachvollziehbarkeit und ist im Einzelfall abzuwägen.

## 7. Cloudflare: Auftragsverarbeitung und Unterauftragsverarbeiter

- **Vertrag:** Cloudflare Customer DPA v6.4 (gültig ab 03.04.2026), einbezogen über das Self-Serve Subscription Agreement, auch im Free-Plan **[plausibel]**. Vertragspartner ist der Inhaber des Cloudflare-Kontos, hier der Betreiber privat; das passt zu seiner Rolle als Verantwortlicher **[plausibel]**. Quellen: https://www.cloudflare.com/cloudflare-customer-dpa/, https://www.cloudflare.com/terms/
- **Drittland (DPA Ziff. 6):** USA: EU-U.S. Data Privacy Framework (Durchführungsbeschluss (EU) 2023/1795), hilfsweise Standardvertragsklauseln (Durchführungsbeschluss (EU) 2021/914, Modul 2). Andere Drittländer ohne Angemessenheitsbeschluss: Standardvertragsklauseln (DPA Ziff. 1.1(p) und 6.2). Die Klauseln sind per Verweis einbezogen, nicht angehängt (am 16.10.2026 nachgelesen). Das EuG hat die Klage gegen den DPF am 03.09.2025 abgewiesen (T-553/23); das Rechtsmittel C-703/25 P ist anhängig, ob inzwischen entschieden ist **[unsicher]**.
- **Unterauftragsverarbeiter:** https://www.cloudflare.com/gdpr/subprocessors/cloudflare-services/ (bei der Recherche Stand 01.10.2025). Änderungen kündigt Cloudflare 30 Tage vorher an, Widerspruch binnen 10 Tagen. Der Betreiber prüft die Liste vor jedem Event.
- **Ablage (privat, nicht im Repo):** DPA als PDF mit Annahmedatum, Unterauftragsverarbeiter-Liste mit Datum, Prüfung des DPF-Eintrags „Cloudflare, Inc.“ auf https://www.dataprivacyframework.gov/ mit Datum.
- **D1-Standort:** ungeprüft, `npx wrangler d1 info fete`. Eine EU-Jurisdiktion ginge nur über eine neue Datenbank (`--jurisdiction=eu`) und ist nicht geplant.
- **Time Travel:** 7 Tage (Workers Free) bzw. 30 Tage (Workers Paid), nicht abschaltbar. Welcher Plan gilt, ist nicht bestätigt. Ein Wechsel auf Paid erfordert `legal.retention.restoreDays = 30`.

## 8. Datenpannen (Art. 33 und 34 DSGVO)

1. **Eindämmen:** betroffene Secrets in GitHub ersetzen und den Deploy ausführen, Cloudflare-Token widerrufen, Admin-Konten deaktivieren oder mit Reset neu einladen, notfalls das Deployment zurückrollen. Neue `SESSION_PEPPER` oder `ENC_KEY` machen alle Passwörter, 2FA-Schlüssel und die Spotify-Verbindung ungültig.
2. **Bewerten:** welche Daten, wie viele Betroffene, welches Risiko.
3. **Melden:**
   - an das BayLDA (`legal.authority`) binnen 72 Stunden nach Bekanntwerden, es sei denn, die Verletzung führt voraussichtlich nicht zu einem Risiko (Art. 33 Abs. 1 DSGVO);
   - bei voraussichtlich hohem Risiko zusätzlich an die Betroffenen (Art. 34 DSGVO);
   - bei Vorfällen mit Spotify-Daten an security@spotify.com binnen 24 Stunden (Spotify Developer Terms, Anhang A § 9).
4. **Dokumentieren:** jede Verletzung mit Sachverhalt, Auswirkungen und Abhilfe, auch ohne Meldung (Art. 33 Abs. 5 DSGVO), in der privaten Ablage.

## 9. Betroffenenanfragen

- **Eingang:** E-Mail an die Adresse in `legal.controller`. Antwort unverzüglich, spätestens innerhalb eines Monats (Art. 12 Abs. 3 DSGVO). Anfrage und Antwort in der privaten Ablage festhalten.
- **Gäste:** Bekannt ist nur die zufällige Geräte-ID im Cookie. Ohne zusätzliche Angaben lässt sich eine Anfrage keinem Gerät zuordnen (Art. 11 Abs. 2 DSGVO). Auf den Button „Meine Daten auf diesem Gerät löschen“ verweisen, der auch einen Widerspruch nach Art. 21 sofort umsetzt, aber nur, solange das Geräte-Cookie gilt (höchstens 24 h). Ohne Button werden die Daten 7 Tage nach der letzten Aktivität gelöscht bzw. anonymisiert, mit dem täglichen Lauf bis zu einen Tag später.
- **Admins:** Auskunft aus `admin_users`, `admin_invites`, `audit_log` (Konto-Nummer und Einträge mit dem Benutzernamen), `ledger_entries`, `wishes.decided_by`, `settings` und `displays`. Löschung nach Abschnitt 6, Widerspruch durch Deaktivieren.
- **Inhaber des Party-Accounts:** `observed_plays`, `spotify_snapshot` und Anzeigename im Audit-Log. „Spotify trennen“ im Admin löscht die Zugangsschlüssel.
- Kein Recht auf Datenübertragbarkeit, weil alle Verarbeitungen auf lit. f beruhen.

## 10. Schwellwertanalyse Datenschutz-Folgenabschätzung (Art. 35 DSGVO)

Ergebnis: **keine DSFA** **[plausibel]**. Prüfung anhand der Kriterien aus WP248:

| Kriterium                                     | Bewertung                                                          |
| --------------------------------------------- | ------------------------------------------------------------------ |
| Bewertung oder Scoring                        | nein                                                               |
| Automatisierte Entscheidung mit Rechtswirkung | nein, Limits lehnen nur Stimmen ab                                 |
| Systematische Überwachung                     | kann angenommen werden (Netz-Schlüssel, Audit-Log) **[plausibel]** |
| Sensible oder höchstpersönliche Daten         | nein                                                               |
| Großer Umfang                                 | nein, eine Feier mit etwa 150 Gästen und wenigen Admins            |
| Abgleich oder Zusammenführung von Datensätzen | nein                                                               |
| Schutzbedürftige Betroffene                   | Beschäftigte können es sein **[plausibel]**                        |
| Innovative Technologie                        | nein                                                               |
| Hindert an Rechten oder Leistungen            | nein, Teilnahme freiwillig, die Feier geht auch ohne App           |

Zwei Kriterien können erfüllt sein, deshalb die Begründung für „keine DSFA“:

- Überwachung: keine Zuordnung von Stimmen zu Personen, kein Profil über die Feier hinaus, Gästedaten nach 7 Tagen und Audit-Log nach 90 Tagen gelöscht, ausdrücklich keine Verhaltenskontrolle.
- Beschäftigte: Der Betreiber ist nicht Arbeitgeber, die GmbH erhält keine Gästedaten, Admin-Namen nur im Verbrauchsprotokoll.
- Pseudonymisierung, keine Drittressourcen im Browser, Selbstlöschung.

Die DSFA-Muss-Liste der Aufsichtsbehörden für den nicht-öffentlichen Bereich ist nicht im Einzelnen abgeglichen **[unsicher]**. Neu prüfen, wenn die GmbH (mit)verantwortlich wird, Gästedaten Personen zugeordnet werden, Fristen länger werden oder neue Datenarten oder Drittanbieter dazukommen.

## 11. Restrisiken

1. **Mitverantwortung der GmbH:** Das TV zeigt den Ausrichter (`theme.event.hosts`), Konto 4140 bucht „Freiwillige soziale Aufwendungen (Betriebsveranstaltung)“, die Buchhaltung erhält das Verbrauchsprotokoll. Bestimmt die GmbH Zwecke oder Mittel mit, kann sie (gemeinsam) Verantwortliche sein. Dann bräuchte es eine Vereinbarung nach Art. 26 DSGVO. Außerdem wären ihr Datenschutzbeauftragter und gegebenenfalls der Betriebsrat einzubinden (für Audit-Log und persönliche Admin-Konten § 87 Abs. 1 Nr. 6 BetrVG **[plausibel]**), und der Beschäftigtendatenschutz wäre zu beachten.
2. **Persönliche Haftung:** Die Verantwortung und damit die Haftung trägt der Betreiber persönlich.
3. **Öffentliches Repo mit Privatanschrift:** Name, Anschrift und E-Mail des Betreibers stehen in `src/shared/legal.ts` und damit dauerhaft in der öffentlichen Git-Historie, auch nach einer Änderung. Entfernen ginge nur durch Umschreiben der Historie, Forks und Kopien blieben. Option: Repo privat stellen; das betrifft Branch-Protection im Free-Plan **[plausibel]** und das Actions-Kontingent. Auch dieses Dokument ist öffentlich.
4. **Lösch-Workflow fällt aus:** 60-Tage-Regel, abgelaufener Token oder Cloudflare-Fehler. Abhilfe: Issue, Dashboard-Warnung, Prüftermine. „Eventdaten bereinigen“ setzt den Nachweis und unterdrückt die Warnung bis zu 48 h, auch wenn der Workflow ausfällt.
5. **Breiter Token im täglichen Workflow:** Pages- und D1-Rechte, siehe Least-Privilege-Option in Abschnitt 3.
6. **TOTP-Aussperrung:** Wer das Passwort eines Admins kennt, kann über falsche Codes dessen Konto für 15 min sperren. Das bestand schon vorher, Turnstile hätte es nicht verhindert. Abhilfe: anderer Owner entsperrt unter „Audit & Sicherheit → Rate-Limits“, Passwort per Reset ändern.
7. **Spotify-Vertragspflichten** (Folgen vertraglich, z. B. Sperrung der App, nicht datenschutzrechtlich):
   - Link-back nur als Icon mit der Beschriftung „Open Spotify“; die Policy nennt „OPEN SPOTIFY“, „PLAY ON SPOTIFY“ oder „LISTEN ON SPOTIFY“.
   - Keine Nutzungsbedingungen mit den Mindestklauseln der Developer Terms (V.11) und keine Zustimmung der Gäste. Ob anonyme Gäste „end users“ im Sinne der Terms sind, ist offen.
   - Dashboard, „Voting & Queue“ und „Wünsche“ zeigen Spotify-Daten ohne Spotify-Logo.
   - Fällt der Cover-Proxy aus, fehlt am TV das Cover während der Wiedergabe (Developer Policy II 5).
   - Nutzung im Firmenkontext: Developer Terms III.1.1 („private personal use“), Developer Policy III.10.
   - Kein Hinweis, dass Spotify Drittbegünstigter von Nutzungsbedingungen und Datenschutzerklärung ist (Developer Terms V.11(e)); wie die Nutzungsbedingungen nicht umgesetzt.
8. **Mehrfachabstimmung:** Wer Cookies löscht und das Netz wechselt, kann mehrfach abstimmen.
9. **Drittland und Cloudflare:** DPF-Rechtsmittel anhängig, Rolle von Cloudflare bei Network Data unklar, D1-Standort ungeprüft.
10. **Daten ohne feste Frist:** `observed_plays`, `spotify_snapshot` und Buchungen mit Konto-Nummer. Ob für Buchungen Aufbewahrungspflichten gelten (§ 257 HGB, § 147 AO), ist ungeprüft. Nach Löschung eines Admin-Kontos ist „Erfasst von“ leer.
11. **Gmail:** Rechtsträger, Rolle und Übermittlungsgrundlage von Google ungeprüft. Die Erklärung nennt nur die weltweite Verarbeitung laut Google-Datenschutzerklärung.

## 12. Offene Punkte vor dem Livegang

- Rolle der GmbH klären (Restrisiko 1).
- D1-Standort, Cloudflare-Plan (Time Travel), DPA, Unterauftragsverarbeiter und DPF-Eintrag prüfen und ablegen (Abschnitt 7). Danach `legal.retention.restoreDays` bestätigen (bei Workers Paid 30), den D1-Standort in Abschnitt 6 der Erklärung nennen und `legal.updatedAt` aktualisieren.
- Bild-Hosts in Produktion prüfen. Nur `https://i.scdn.co/image/<id>` läuft über den Proxy, andere Hosts zeigen den Platzhalter:

  ```bash
  npx wrangler d1 execute fete --remote --command "SELECT substr(image_url, 1, 30) AS host, COUNT(*) AS n FROM songs GROUP BY host"
  ```

- Bei eigener Domain die Zone-Funktionen prüfen (Event-Checkliste).
- Inhaber des Spotify-Party-Accounts klären.
- Gmail klären (Restrisiko 11) und Abschnitte 3 k, 5 und 6 der Erklärung ergänzen.
- Speicherdauer für Buchungen, Einstellungen, Bildschirme und Titelliste festlegen, Aufbewahrungspflichten prüfen (Restrisiko 10).
