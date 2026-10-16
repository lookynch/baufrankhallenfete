# Event-Checkliste

## 4 Wochen vorher

- [ ] Kalendereinträge für **Fete −7 Tage**, **+8 Tage** und **+91 Tage** angelegt (Abschnitte unten).
- [ ] Musikrechte mit dem Ausrichter geklärt (organisatorisch, nicht Teil der App):
  - GEMA: Betriebsfeiern gelten regelmäßig als öffentliche Wiedergabe, Anmeldung vor dem Event.
  - Spotify: Developer Terms und Nutzungsbedingungen erlauben nur private, nicht-kommerzielle Nutzung, die Developer Policy untersagt Produkte für Unternehmen.
- [ ] Datenschutz (Betreiber ist privat, Details in [`DATENSCHUTZ.md`](DATENSCHUTZ.md)):
  - `/datenschutz` und `/impressum` gegengelesen, Stand-Datum `updatedAt` in `src/shared/legal.ts` aktuell.
  - Rolle der GmbH geklärt. Nutzt sie die App mit (z. B. die Buchhaltung das Verbrauchsprotokoll) oder gibt sie Weisungen, kann sie mitverantwortlich sein. Dann auch ihren Datenschutzbeauftragten und gegebenenfalls den Betriebsrat einbinden.
  - Offene Prüfungen aus `DATENSCHUTZ.md` erledigt (D1-Standort, Cloudflare-Plan, DPF-Eintrag, Inhaber des Party-Accounts).
- [ ] `LASTFM_API_KEY` gesetzt, sonst ist der Genre-Filter für Gästewünsche aus (Dashboard warnt).
- [ ] `CF_ANALYTICS_TOKEN` gesetzt (dringend empfohlen). Ohne ihn drosselt der Budget-Wächter nicht, und Gäste sehen Cover auch über 80 % Budget.
- [ ] Spotify-Premium des Party-Accounts läuft über das Eventdatum hinaus.
- [ ] Spotify im Admin unter „Musik & Sets → Spotify“ **neu verbinden**: Die Freigabe gilt 6 Monate ab Verbindung.
- [ ] Mindestens 2 Owner mit Passkey oder 2FA. Wiederherstellungscodes sicher abgelegt, Passkey-Konten möglichst mit zwei Geräten (z. B. iPhone + Laptop).
- [ ] Adminbereich auf den Orga-Handys als App installiert: `/admin` öffnen, dann Safari: Teilen → Zum Home-Bildschirm, Android: App installieren. Dort einmal angemeldet. Test-Apps von vor der Trennung in Gast- und Admin-App einmal löschen und neu hinzufügen (sie starten sonst auf der Gäste-Seite).
- [ ] Buchhaltung hat Konten, Durchschnittspreis pro Kasten und Budget in den Einstellungen bestätigt.

## Generalprobe (mind. 1 Woche vorher, vor Ort)

- [ ] **Mobilfunkempfang in der Halle** zur Event-Uhrzeit mit allen Netzen (Telekom, Vodafone, O2) gemessen.
- [ ] **Eigener LTE/5G-Router** für TV, Bar-Screens, Buzzer-PC und Spotify-Player eingerichtet (nicht das Gäste-Netz).
- [ ] Kiosk-Geräte (Laptop oder Stick mit aktuellem Chrome im Vollbild) für TV, Bar 1, Bar 2 und den Player-Tab.
- [ ] Alle Displays unter `/display` gekoppelt:
  - TV
  - Bar 1 Stattrack
  - Bar 2 Buchhaltung
  - Player-Taktgeber auf dem Spotify-Rechner
- [ ] Buzzer kalibriert: Lange halten zählt einen Kasten, zwei kurze Drücke zählen zwei. Siehe `agent/README.md`.
- [ ] Testbuchungen storniert oder Eventzeitraum so gesetzt, dass Testdrücke abgelehnt werden.
- [ ] Mit 3 Personen ohne Erklärung QR scannen und abstimmen lassen. Ziel: unter 10 Sekunden.
- [ ] Im Dashboard die Zahl „Requests heute“ mit dem Cloudflare-Dashboard abgeglichen.
- [ ] PBKDF2-Login-Zeit mit `wrangler pages deployment tail` geprüft (CPU unter 10 ms, Standard 20.000 Iterationen, max. 30.000).
- [ ] Admins mit Passwort aus älteren Versionen (50.000 Iterationen) per Einladung mit Reset neu eingeladen.
- [ ] Bei eigener Domain: In der Cloudflare-Zone Web Analytics, Bot Fight Mode, JavaScript Detections und Email Obfuscation ausgeschaltet. Sie können Skripte unter `/cdn-cgi/` einbinden, die die CSP als eigene Domain erlaubt.
- [ ] Gastseite in den Browser-DevTools geprüft: Im Netzwerk-Tab nur Requests an die eigene Domain, auch keine unter `/cdn-cgi/` (Filter `/cdn-cgi/`). Gespeichert ist nur `__Host-fete`, nach Sprachwahl zusätzlich `lang`.

## Fete −7 Tage

- [ ] Workflow „Datenlöschung“ unter _Actions_ aktiv. GitHub deaktiviert Schedules in öffentlichen Repos nach 60 Tagen ohne Aktivität im Repo, dann „Enable workflow“.
- [ ] Workflow mit „Run workflow“ gestartet, Lauf grün. Das Dashboard zeigt keine Warnung „Automatische Löschung …“.
- [ ] Keine offenen Issues „Datenlöschung fehlgeschlagen“.

## Musik

- [ ] Sets mit Zeitfenstern und Standard-Level angelegt. In der Zeitleiste sind alle Sets **grün** (genug Songs).
- [ ] Rund 130–180 Songs mit gepflegtem Level, keine Lücken zwischen Sets.
- [ ] Vorprogramm-Playlist gesetzt. Die Prüfung meldet **keine Überschneidung** mit den Sets.
- [ ] Startzeit des ersten Votings gesetzt.
- [ ] Genre-Filter geprüft: Unter „Einstellungen → Genre-Filter“ die Sperrliste durchgesehen. In der Gäste-App gesucht:
  - ausgeblendet: Rammstein, Slayer, Metallica, Zenek Martyniuk (Disco Polo), Kastelruther Spatzen
  - sichtbar: AC/DC, Bon Jovi, Europe, Linkin Park, Dua Lipa, Helene Fischer

  Abweichungen notieren und Sperrliste anpassen; einzelne Songs lassen sich per Import in ein Set trotzdem erlauben.

## Am Abend (vor Einlass)

- [ ] Spotify-Gerät aktiv, Standby und Bildschirmschoner aus.
- [ ] **Crossfade/Automix aus.**
- [ ] **Party-Account nur auf dem Abspielgerät eingeloggt.** Sonst übernimmt Spotify Connect die Wiedergabe auf einem anderen Gerät.
- [ ] Im Admin „Vorprogramm starten“ und „Wiederholung an“ gedrückt. Das Abspielgerät zeigt „Playlist“ als Wiederholung. Ohne laufende Wiedergabe spielt die Wunsch-Jukebox keine Gästewünsche.
- [ ] Dashboard ohne Warnungen:
  - Spotify OK
  - Buzzer-PC online
  - TV online
  - Sets grün
  - Budget-Wächter aktiv
  - Automatische Löschung aktuell
- [ ] Cloudflare Access eingerichtet (sonst Hinweis im Dashboard).
- [ ] Buzzer-Agent läuft. Ein Testdruck erscheint unter „Buzzer“ und wird gleich wieder storniert.

## Während des Abends

- [ ] Gelegentlich das Dashboard prüfen:
  - IP-Ablehnungen (bei vielen das IPv4- bzw. IPv6-/48-Limit `votesPerNetV6` erhöhen)
  - Notfall-Songs
  - Requests heute
- [ ] Unter „Wünsche → Freigegeben, wartend“ unpassende Wünsche per **Veto** aussortieren. „In Prüfung“ füllt sich nur, wenn die automatische Freigabe aus ist oder kein Set existiert.
- [ ] Markierte Buzzer-Drücke prüfen, Fehlbuchungen per Storno korrigieren.

## Notfall

| Problem                            | Maßnahme                                                                                                                                                                                          |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App, Internet oder Spotify-API weg | Musik läuft über die Vorprogramm-Playlist weiter. Getränke per Strichliste, später unter „Buchhaltung“ nachbuchen.                                                                                |
| Song gehört nicht hierher          | „Voting & Queue“ → Song entfernen oder verschieben. Spotify → „Song überspringen“.                                                                                                                |
| Falsches Stimmungslevel            | Level der nächsten Runde unter „Voting & Queue“ setzen.                                                                                                                                           |
| Admin ausgesperrt                  | Anderer Owner entsperrt unter „Audit & Sicherheit → Rate-Limits“ bzw. lädt mit Reset neu ein (Passkey oder Passwort und 2FA). Letzter Owner ohne Zugang: `scripts/notfall-einladung.ts` (README). |
| Display zeigt Kopplungscode        | Im Admin unter „Displays“ den Code eingeben.                                                                                                                                                      |

## Danach

- [ ] Verbrauchsprotokoll (CSV) an die Buchhaltung, bevor Admin-Konten gelöscht werden. Sonst ist „Erfasst von“ für deren Buchungen leer.
- [ ] Gästedaten werden 7 Tage nach der letzten Aktivität automatisch gelöscht. Optional sofort mit „Eventdaten bereinigen“ (Owner).
- [ ] `BOOTSTRAP_TOKEN` in GitHub löschen und Deploy erneut ausführen (entfernt ihn auch aus Pages).
- [ ] Nicht mehr benötigte Admins deaktivieren (offene Einladungen werden dabei widerrufen). Deaktivierte Konten werden 90 Tage nach der letzten Anmeldung automatisch gelöscht.
- [ ] Spotify im Admin trennen, wenn keine weitere Fete ansteht.
- [ ] Optional `IP_HASH_SECRET` in GitHub durch einen neuen Zufallswert ersetzen und den Deploy erneut ausführen. Alte Netz-Schlüssel lassen sich dann keiner IP-Adresse mehr zuordnen.

## Fete +8 Tage

- [ ] Dashboard „Gäste & Sicherheit“ zeigt 0 Geräte und 0 Stimmen.
- [ ] Workflow „Datenlöschung“ läuft weiter täglich grün.

## Fete +91 Tage

- [ ] Workflow „Datenlöschung“ noch aktiv. Ohne Aktivität im Repo hat GitHub ihn nach 60 Tagen deaktiviert: „Enable workflow“, dann „Run workflow“.
- [ ] Unter „Audit & Sicherheit“ ist der älteste Eintrag (mit „Ältere laden“ bis zum Ende) höchstens 91 Tage alt: 90 Tage Frist plus ein Tag Laufintervall.
