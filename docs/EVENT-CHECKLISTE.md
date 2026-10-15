# Event-Checkliste

## 4 Wochen vorher

- [ ] Rechtsfragen geklärt: Spotify-Nutzung im Firmenkontext, GEMA (Rechtsabteilung).
- [ ] Datenschutzhinweis und Betriebsrat informiert.
- [ ] Spotify-Premium des Party-Accounts läuft über das Eventdatum hinaus.
- [ ] Spotify im Admin unter „Musik & Sets → Spotify“ **neu verbinden**: Die Freigabe gilt 6 Monate ab Verbindung.
- [ ] Mindestens 2 Owner mit 2FA. Wiederherstellungscodes sicher abgelegt.
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

## Musik

- [ ] Sets mit Zeitfenstern und Standard-Level angelegt. In der Zeitleiste sind alle Sets **grün** (genug Songs).
- [ ] Rund 130–180 Songs mit gepflegtem Level, keine Lücken zwischen Sets.
- [ ] Vorprogramm-Playlist gesetzt. Die Prüfung meldet **keine Überschneidung** mit den Sets.
- [ ] Startzeit des ersten Votings gesetzt.

## Am Abend (vor Einlass)

- [ ] Spotify-Gerät aktiv, Standby und Bildschirmschoner aus.
- [ ] **Crossfade/Automix aus.**
- [ ] **Party-Account nur auf dem Abspielgerät eingeloggt.** Sonst übernimmt Spotify Connect die Wiedergabe auf einem anderen Gerät.
- [ ] Im Admin „Vorprogramm starten“ und „Wiederholung an“ gedrückt. Das Abspielgerät zeigt „Playlist“ als Wiederholung.
- [ ] Dashboard ohne Warnungen:
  - Spotify OK
  - Buzzer-PC online
  - TV online
  - Sets grün
  - Turnstile und Access konfiguriert (ohne Turnstile gelten alle Gäste als verifiziert)
- [ ] Buzzer-Agent läuft. Ein Testdruck erscheint unter „Buzzer“ und wird gleich wieder storniert.

## Während des Abends

- [ ] Gelegentlich das Dashboard prüfen:
  - IP-Ablehnungen (bei vielen das IPv4- bzw. IPv6-/48-Limit `votesPerNetV6` erhöhen)
  - Notfall-Songs
  - Requests heute
- [ ] Songwünsche unter „Wünsche“ freigeben (Set und Level wählen).
- [ ] Markierte Buzzer-Drücke prüfen, Fehlbuchungen per Storno korrigieren.

## Notfall

| Problem                            | Maßnahme                                                                                                           |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| App, Internet oder Spotify-API weg | Musik läuft über die Vorprogramm-Playlist weiter. Getränke per Strichliste, später unter „Buchhaltung“ nachbuchen. |
| Song gehört nicht hierher          | „Voting & Queue“ → Song entfernen oder verschieben. Spotify → „Song überspringen“.                                 |
| Falsches Stimmungslevel            | Level der nächsten Runde unter „Voting & Queue“ setzen.                                                            |
| Admin ausgesperrt                  | Anderer Owner entsperrt unter „Audit & Sicherheit → Rate-Limits“ bzw. lädt mit Reset neu ein (Passwort und 2FA).   |
| Display zeigt Kopplungscode        | Im Admin unter „Displays“ den Code eingeben.                                                                       |

## Danach

- [ ] Verbrauchsprotokoll (CSV) an die Buchhaltung.
- [ ] „Eventdaten bereinigen“ (Owner) ausführen.
- [ ] `BOOTSTRAP_TOKEN` in GitHub löschen und Deploy erneut ausführen (entfernt ihn auch aus Pages).
- [ ] Nicht mehr benötigte Admins deaktivieren (offene Einladungen werden dabei widerrufen).
