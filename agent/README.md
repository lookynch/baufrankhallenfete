# Fete-Agent – Funkbuzzer an der Bar

Ein 433-MHz-Funkbuzzer an der Bar meldet „1 Kasten Getränke mehr“. Die Kette:

```
Buzzer ──433 MHz──▶ Empfänger ──▶ Arduino (D2) ──USB-Seriell──▶ fete_agent (PC) ──HTTPS, HMAC-signiert──▶ Fete-App
```

Ziel ist Zuverlässigkeit: Kein Druck darf verloren gehen, keiner darf doppelt zählen.

- Jeder erkannte Druck bekommt eine `event_id` (UUID4) und wird **zuerst** in einen SQLite-Puffer geschrieben, erst danach gesendet.
- Gelöscht wird ein Event erst, wenn der Server mit `200` und `status` `accepted` oder `duplicate` antwortet.
- Geht eine Antwort verloren, wird dasselbe Event mit derselben `event_id` erneut gesendet. Der Server erkennt es als `duplicate`; es zählt nicht doppelt.
- Offline, bei Serverfehlern oder nach einem Neustart des PCs bleiben Events im Puffer und werden der Reihe nach nachgesendet.

Grenzen, die der Agent nicht auffangen kann: Ein Druck, den der Empfänger gar nicht hört (Reichweite, Störung), und ein Druck, während der Arduino abgezogen oder der Agent beendet ist, kommt nie beim Agenten an.

## Inhalt

| Pfad | Zweck |
|---|---|
| `arduino/buzzer_receiver/buzzer_receiver.ino` | Sketch für den Arduino mit dem 433-MHz-Empfänger |
| `fete_agent/` | Python-Agent |
| `tests/` | pytest-Tests, laufen ohne Hardware und ohne Netz |
| `config.example.toml` | Vorlage für `config.toml` |

## 1. Hardware

Benötigt: Arduino Uno oder Nano, 433-MHz-Empfängermodul, Buzzer bzw. Funksender mit festem Code, USB-Kabel.

| Empfänger | Arduino |
|---|---|
| VCC | 5V |
| GND | GND |
| DATA (bei zwei DATA-Pins: einer davon, sie sind verbunden) | D2 |

- D2 ist beim Uno und Nano Interrupt 0, den der Sketch nutzt. Beim Leonardo oder Micro liegt Interrupt 0 auf D3.
- Antenne: 17,3 cm Draht (λ/4 bei 433,92 MHz) an den ANT-Lötpunkt des Empfängers, möglichst gerade und frei.
- Superheterodyn-Empfänger (z. B. RXB6, SRX882) haben meist deutlich mehr Reichweite als die billigen XY-MK-5V.
- Der Buzzer muss einen festen Code senden (z. B. EV1527, PT2262). Sender mit Rolling Code (KeeLoq) liefern bei jedem Druck einen anderen Wert und sind ungeeignet.

## 2. Arduino-Sketch

1. Arduino IDE installieren.
2. Library installieren: *Werkzeuge → Bibliotheken verwalten…*, nach **rc-switch** suchen (Autor: sui77) und installieren.
3. `arduino/buzzer_receiver/buzzer_receiver.ino` öffnen, Board und Port wählen, hochladen.

Der Sketch sendet mit 9600 Baud:

| Zeile | Bedeutung |
|---|---|
| `HELLO fete-receiver 1` | einmal nach dem Start |
| `ALIVE` | alle 5 s |
| `BUZZ <dezimalwert>` | ein erkannter Tastendruck |

Wiederholungen desselben Codes, die zu einem Tastendruck gehören, filtert der Sketch: Derselbe Code wird erst wieder gemeldet, wenn mindestens 400 ms (`REPEAT_GAP_MS`) nichts mit diesem Code empfangen wurde.

## 3. Codes des eigenen Buzzers herausfinden

**Variante A – serieller Monitor:** In der Arduino IDE *Werkzeuge → Serieller Monitor* öffnen, 9600 Baud einstellen. Nach `HELLO` und `ALIVE` den Buzzer drücken. Die Zeile `BUZZ 5592405` liefert den Code `5592405`. Danach den seriellen Monitor schließen, sonst ist der Port für den Agenten belegt.

**Variante B – Agent-Log:** In `config.toml` einen Platzhalter eintragen, z. B. `allowed_codes = ["CODE-VOM-BUZZER"]` (so steht es in der Vorlage). Agent starten und den Buzzer drücken. Der Agent bucht nichts und meldet:

```
21:03:12  Code 5592405 ignoriert (nicht in allowed_codes)
```

Den Code als String eintragen, bei mehreren Buzzern alle:

```toml
allowed_codes = ["5592405", "5592420"]
```

Eine leere Liste lässt jeden Code zu. Das ist nicht zu empfehlen, weil Wetterstationen, Funkklingeln und Ähnliches in der Nachbarschaft dann Kästen buchen würden.

## 4. Python-Installation

Voraussetzung: Python ≥ 3.11. Abhängig ist der Agent nur von `pyserial`.

### Windows

1. Python von python.org installieren und im Installer **„Add python.exe to PATH“** anhaken.
2. Den Ordner `agent` z. B. nach `C:\Fete\agent` kopieren.
3. In der Eingabeaufforderung:

   ```bat
   cd C:\Fete\agent
   py -m venv .venv
   .venv\Scripts\python -m pip install .
   copy config.example.toml config.toml
   notepad config.toml
   ```

4. `serial_port`: Im Geräte-Manager unter *Anschlüsse (COM & LPT)* steht der Port, z. B. `COM3`. Arduino-Nachbauten mit CH340-Chip brauchen ggf. den CH340-Treiber.
5. Secret setzen, am besten als Benutzer-Umgebungsvariable statt in der Datei:

   ```bat
   setx FETE_BUZZER_SECRET "das-secret-aus-der-app"
   ```

   Danach ab- und wieder anmelden, damit neu gestartete Programme die Variable sehen. Die Umgebungsvariable hat Vorrang vor `secret` in `config.toml`.

### Linux

```bash
cd /opt/fete/agent
python3 -m venv .venv
.venv/bin/pip install .
cp config.example.toml config.toml
sudo usermod -aG dialout "$USER"   # Zugriff auf /dev/ttyUSB*, /dev/ttyACM*
```

Als `serial_port` am besten den stabilen Pfad unter `/dev/serial/by-id/…` verwenden.

## 5. Konfiguration

| Feld | Standard | Bedeutung |
|---|---|---|
| `base_url` | – | z. B. `https://fete.example.org`, nur Schema und Host, `https` Pflicht (`http` nur für `localhost`) |
| `agent_id` | – | Kennung dieses PCs, 1–40 Zeichen aus `A–Z a–z 0–9 . _ -` |
| `secret` | – | HMAC-Secret; die Umgebungsvariable `FETE_BUZZER_SECRET` hat Vorrang |
| `serial_port` | – | `COM3`, `/dev/ttyUSB0` … (im Simulationsmodus nicht nötig) |
| `baud` | `9600` | muss zum Sketch passen |
| `allowed_codes` | `[]` | Whitelist; leer = alle Codes erlaubt |
| `debounce_gap_ms` | `600` | Ruhefenster pro Code, siehe Abschnitt 9 |
| `buffer_path` | `fete_buffer.sqlite3` | relativ zum Ordner der Konfigurationsdatei |
| `beep` | `false` | Ton bei jeder erfolgreichen Buchung |
| `heartbeat_seconds` | `20` | maximaler Abstand der Heartbeats |
| `request_timeout_seconds` | `8` | Timeout pro HTTP-Request |

Unbekannte Felder (z. B. Tippfehler wie `allowed_code`) führen zu einer Fehlermeldung beim Start.

## 6. Starten

```bat
.venv\Scripts\python -m fete_agent config.toml
```

Optionen:

- `--simulate`: liest statt vom Arduino von der Tastatur. Enter erzeugt `BUZZ test`, ein eingetippter Wert vor Enter wird als Code verwendet. `test` ist im Simulationsmodus immer erlaubt. **Die Events gehen echt an den Server** und werden dort gebucht.
- `-v`: Debug-Ausgaben, u. a. jede empfangene und unterdrückte Wiederholung.

Typische Ausgabe:

```
21:00:01  Fete-Agent 1.0.0 · bar-pc-1 → https://fete.example.org
21:00:01  ✔ Seriell verbunden (COM3)
21:00:01  ✔ Server erreichbar
21:00:03  ✔ Empfänger gestartet (fete-receiver 1)
21:00:03  ✔ Seriell ok – Empfänger meldet sich
21:04:17  ● Druck erkannt (Code 5592405)
21:04:17  ✔ Kasten gebucht (BF-0042)
```

Beenden mit Ctrl+C. Offene Events bleiben im Puffer und werden beim nächsten Start gesendet.

## 7. Autostart

### Windows: Aufgabenplanung

1. `taskschd.msc` öffnen → rechts **Aufgabe erstellen…** (nicht „Einfache Aufgabe“).
2. Reiter **Allgemein**
   - Name: `Fete-Agent`
   - **Nur ausführen, wenn der Benutzer angemeldet ist** – dann ist das Konsolenfenster mit den Meldungen sichtbar. Der Bar-PC muss dafür nach dem Booten angemeldet sein (ggf. automatische Anmeldung einrichten).
3. Reiter **Trigger**
   - **Neu… → Aufgabe starten: Bei Anmeldung**, Bestimmter Benutzer: der Bar-Benutzer, *Verzögern für: 30 Sekunden*.
   - Als Absicherung ein zweiter Trigger: **Neu… → Täglich**, Start 00:00, unter *Erweiterte Einstellungen* **Wiederholen jede: 5 Minuten**, **für die Dauer von: Unbegrenzt**. Zusammen mit „Keine neue Instanz starten“ (Schritt 6) startet das den Agenten neu, falls er beendet wurde, und tut sonst nichts.
4. Reiter **Aktionen → Neu… → Programm starten**
   - Programm/Skript: `C:\Fete\agent\.venv\Scripts\python.exe`
   - Argumente hinzufügen: `-m fete_agent C:\Fete\agent\config.toml`
   - Starten in: `C:\Fete\agent`
5. Reiter **Bedingungen**: alle Haken entfernen, insbesondere „Aufgabe nur starten, falls Computer im Netzbetrieb ausgeführt wird“ und „Nur starten, falls folgende Netzwerkverbindung verfügbar ist“. Der Agent puffert offline selbst.
6. Reiter **Einstellungen**
   - **Falls Aufgabe fehlschlägt, neu starten alle: 1 Minute**, **Neustartversuche bis: 999**
   - „Aufgabe beenden, falls Ausführung länger als“: **deaktivieren**
   - „Falls die Aufgabe bereits ausgeführt wird“: **Keine neue Instanz starten**
7. OK, dann in der Aufgabenliste mit Rechtsklick → **Ausführen** testen.

Ob „Falls Aufgabe fehlschlägt, neu starten“ auch greift, wenn der Prozess nach dem Start mit Fehlercode endet, ist nicht in jedem Fall zuverlässig. Deshalb gibt es den zweiten Trigger alle 5 Minuten.

Zusätzlich in den Windows-Energieoptionen: Standbymodus auf „Nie“ und *Erweiterte Einstellungen → USB-Einstellungen → Einstellung für selektives USB-Energiesparen* auf „Deaktiviert“, damit der Arduino nicht abgeschaltet wird.

### Linux: systemd

`/etc/fete-agent.env` (Rechte `600`):

```ini
FETE_BUZZER_SECRET=das-secret-aus-der-app
```

`/etc/systemd/system/fete-agent.service`:

```ini
[Unit]
Description=Fete Buzzer-Agent
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=0

[Service]
User=fete
SupplementaryGroups=dialout
WorkingDirectory=/opt/fete/agent
EnvironmentFile=/etc/fete-agent.env
Environment=PYTHONUNBUFFERED=1
ExecStart=/opt/fete/agent/.venv/bin/python -m fete_agent /opt/fete/agent/config.toml
KillSignal=SIGINT
TimeoutStopSec=20
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now fete-agent
journalctl -u fete-agent -f
```

## 8. Betrieb

### Puffer

- Datei `fete_buffer.sqlite3` (Pfad aus `buffer_path`), Tabelle `pending`. Jedes Event wird dort gespeichert, bevor es gesendet wird.
- Gesendet wird strikt der Reihe nach, das älteste zuerst. Hängt das älteste Event (Server antwortet mit Fehler), warten die späteren dahinter.
- Bei Netzwerkfehler, Timeout, `429` oder `5xx`: neuer Versuch nach 1 s, 2 s, 4 s … höchstens 30 s, mit Zufallsanteil. Nach einem Neustart des Agenten wird sofort neu versucht.
- `422` heißt: endgültig abgelehnt. Das Event wird mit Grund in die Tabelle `rejected` verschoben und nicht erneut gesendet. Ansehen:

  ```bat
  .venv\Scripts\python -c "import sqlite3; [print(r) for r in sqlite3.connect('fete_buffer.sqlite3').execute('select * from rejected')]"
  ```

- Die Puffer-Datei während des Betriebs nicht löschen. Darin stehen Drücke, die noch nicht gebucht sind.

### Uhrzeit

Jeder Request trägt einen Zeitstempel. Geht die PC-Uhr falsch, antwortet der Server mit `stale_timestamp` und seiner Uhrzeit. Der Agent übernimmt den Offset und sendet sofort erneut. Auch jeder Heartbeat gleicht die Uhr ab. `pressed_at` wird mit dem zum Zeitpunkt des Drucks bekannten Offset berechnet. Lag dieser Wert falsch (z. B. PC-Uhr vorgehend und beim Start noch kein Serverkontakt), wird `pressed_at` beim Senden auf die aktuelle Serverzeit begrenzt; sonst würde der Server den Druck als `pressed_in_future` endgültig ablehnen.

### Heartbeat

Der Agent meldet sich spätestens alle `heartbeat_seconds` beim Server (`agent_id`, Pufferlänge, Seriell-Status). Gibt der Server `next_tick_at` vor, kommt der nächste Heartbeat zu diesem Zeitpunkt, frühestens nach 2 s. Die App nutzt den Heartbeat auch als Taktgeber. Der Agent muss deshalb während der Fete laufen, auch wenn niemand drückt.

### Fehlerbilder

| Meldung | Ursache / Abhilfe |
|---|---|
| `⚠ Seriell: COM3 nicht verfügbar … neuer Versuch alle 2 s` | USB abgezogen, falscher Port oder Port belegt (serieller Monitor der Arduino IDE offen). Der Agent verbindet sich automatisch neu. Im Geräte-Manager prüfen, ob sich die COM-Nummer geändert hat. |
| `⚠ Seriell getrennt (…)` | USB-Verbindung abgerissen. Automatischer Reconnect alle 2 s. |
| `⚠ Seriell getrennt (seit 15 s keine Daten vom Empfänger)` | Port offen, aber keine `ALIVE`-Zeilen: falsche Baudrate, falscher Sketch, Arduino hängt. Der Agent öffnet den Port neu; das setzt den Arduino zurück. |
| `⚠ Seriell gestört – seit 15 s kein Lebenszeichen` | wie oben; der Heartbeat meldet `serial_ok=false` an die App. |
| `Code … ignoriert (nicht in allowed_codes)` | fremder Sender oder eigener Code nicht eingetragen (Abschnitt 3). |
| `⏳ offline – N im Puffer (…)` | Internet weg oder Server gestört. Nichts tun, die Events werden nachgesendet. |
| `⚠ Heartbeat fehlgeschlagen (…)` | wie oben; wird nur beim Wechsel gemeldet, Erholung mit `✔ Server erreichbar`. |
| `✖ Signatur abgelehnt – secret und agent_id prüfen!` | `secret` oder `agent_id` passen nicht zur App. Die Events bleiben im Puffer. Konfiguration korrigieren und Agent neu starten, dann werden sie gesendet. |
| `✖ Kasten abgelehnt (Code …): …` | Server hat mit `422` abgelehnt, siehe Tabelle `rejected`. |
| Ein Druck zählt doppelt oder zwei Drücke zählen einmal | Debounce kalibrieren (Abschnitt 9). |
| `✖ Konfigurationsdatei nicht gefunden` / `Unbekannte Felder` | Pfad oder Tippfehler in `config.toml`. Der Agent startet nicht (Exit-Code 2). |

## 9. Debounce am echten Sender kalibrieren

Ein Buzzer sendet seinen Code, solange die Taste gedrückt ist, typischerweise alle paar zehn Millisekunden. Gefiltert wird in zwei Stufen:

1. **Sketch (`REPEAT_GAP_MS`, 400 ms):** Erst wenn 400 ms nichts mit diesem Code kam, wird er wieder als `BUZZ` gemeldet. Diese Stufe überbrückt Empfangslücken *während* eines Drucks.
2. **Agent (`debounce_gap_ms`, 600 ms):** Der erste `BUZZ` zählt sofort. Weitere `BUZZ` desselben Codes zählen erst, wenn vorher `debounce_gap_ms` lang Ruhe war; jede unterdrückte Wiederholung verlängert das Fenster. Der Agent sieht nur die `BUZZ`-Zeilen, die der Sketch durchlässt.

Vorgehen:

1. **Sketch prüfen:** Serieller Monitor, 9600 Baud. Den Buzzer kurz drücken → genau eine `BUZZ`-Zeile. Den Buzzer 3 s gedrückt halten, auch aus der größten Entfernung an der Bar und mit der Hand über dem Sender → genau eine Zeile. Kommen mehrere, reißt der Empfang länger als 400 ms ab: Antenne und Position des Empfängers verbessern oder `REPEAT_GAP_MS` im Sketch erhöhen (z. B. 600–800) und neu hochladen.
2. **Agent prüfen:** Agent mit `-v` starten. Zehnmal in normalem Tempo drücken → genau zehnmal `● Druck erkannt`. Unterdrückte Wiederholungen erscheinen als `BUZZ … – Wiederholung, unterdrückt`.
3. **Schnelle Doppeldrücke:** So schnell zweimal drücken, wie es das Barpersonal realistisch tut, wenn es zwei Kästen meint. Werden daraus zwei Buchungen, passt die Einstellung. Wird daraus eine, `debounce_gap_ms` und ggf. `REPEAT_GAP_MS` senken.
4. Faustregel: Der Wert muss größer sein als die längste Empfangslücke innerhalb eines Drucks und kleiner als der kürzeste Abstand zwischen zwei gewollten Drücken. Im Zweifel lieber zu groß: Zwei Kästen innerhalb einer halben Sekunde sind an der Bar unrealistisch, ein doppelt gezählter Druck dagegen ein echter Fehler.

## Entwicklung

```bash
pip install -e ".[dev]"
python -m pytest -q
python -m ruff check . && python -m ruff format --check .
```

Die Tests ersetzen HTTP-Transport, Uhr und seriellen Port durch Fakes und laufen ohne Hardware, ohne Netz und ohne Wartezeiten.

### Protokoll

Jeder Request ist ein `POST` mit kompaktem UTF-8-JSON und den Headern `X-Fete-Agent`, `X-Fete-Timestamp` (ms, um den Server-Offset korrigiert), `X-Fete-Signature`, `Content-Type: application/json`.

```
X-Fete-Signature = hex(HMAC_SHA256(secret, "POST\n<PATH>\n<timestamp>\n<sha256_hex(body)>"))
```

| Pfad | Body |
|---|---|
| `/api/buzzer/press` | `{"event_id", "pressed_at", "source_code", "agent_id"}` |
| `/api/buzzer/heartbeat` | `{"agent_id", "sent_at", "queue_length", "serial_ok"}` |
