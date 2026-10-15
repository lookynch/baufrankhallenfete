import logging
import threading
from collections.abc import Callable, Iterable
from typing import Protocol

from .clock import Clock

log = logging.getLogger(__name__)

RECONNECT_SECONDS = 2.0
SILENCE_TIMEOUT_SECONDS = 15.0
READ_TIMEOUT_SECONDS = 1.0
MAX_LINE_BYTES = 128
SIMULATED_CODE = "test"


class Port(Protocol):
    def readline(self) -> bytes: ...

    def close(self) -> None: ...


class SerialSilence(Exception):
    pass


def open_serial_port(name: str, baud: int) -> Port:
    import serial

    return serial.Serial(name, baud, timeout=READ_TIMEOUT_SECONDS)


def parse_line(line: str) -> tuple[str, str] | None:
    parts = line.split()
    if len(parts) == 2 and parts[0] == "BUZZ":
        return "BUZZ", parts[1]
    if parts and parts[0] in ("ALIVE", "HELLO"):
        return parts[0], " ".join(parts[1:])
    return None


class SerialLink:
    def __init__(
        self,
        port_name: str,
        open_port: Callable[[], Port],
        on_code: Callable[[str], object],
        clock: Clock,
    ) -> None:
        self._port_name = port_name
        self._open_port = open_port
        self._on_code = on_code
        self._clock = clock
        self._last_heard: float | None = None

    def ok(self) -> bool:
        return (
            self._last_heard is not None and self._seconds_since(self._last_heard) < SILENCE_TIMEOUT_SECONDS
        )

    def handle_line(self, line: str) -> None:
        parsed = parse_line(line)
        if parsed is None:
            log.debug("Seriell: unbekannte Zeile %r", line)
            return
        self._last_heard = self._clock.monotonic()
        kind, value = parsed
        if kind == "HELLO":
            log.info("✔ Empfänger gestartet (%s)", value)
        elif kind == "BUZZ":
            self._on_code(value)

    def run(self, stop: threading.Event) -> None:
        unavailable_reported = False
        while not stop.is_set():
            try:
                port = self._open_port()
            except Exception as error:
                if not unavailable_reported:
                    log.warning(
                        "⚠ Seriell: %s nicht verfügbar (%s) – neuer Versuch alle %.0f s",
                        self._port_name,
                        error,
                        RECONNECT_SECONDS,
                    )
                    unavailable_reported = True
                stop.wait(RECONNECT_SECONDS)
                continue
            unavailable_reported = False
            log.info("✔ Seriell verbunden (%s)", self._port_name)
            try:
                self._read_lines(port, stop)
            except Exception as error:
                log.warning("⚠ Seriell getrennt (%s)", error)
                stop.wait(RECONNECT_SECONDS)
            finally:
                _close_quietly(port)

    def _read_lines(self, port: Port, stop: threading.Event) -> None:
        connected_at = self._clock.monotonic()
        partial = b""
        while not stop.is_set():
            partial += port.readline()
            if partial.endswith(b"\n"):
                self.handle_line(partial.decode("ascii", errors="replace"))
                partial = b""
            elif len(partial) > MAX_LINE_BYTES:
                partial = b""
            if self._seconds_since(self._last_activity(connected_at)) >= SILENCE_TIMEOUT_SECONDS:
                raise SerialSilence(f"seit {SILENCE_TIMEOUT_SECONDS:.0f} s keine Daten vom Empfänger")

    def _last_activity(self, connected_at: float) -> float:
        return connected_at if self._last_heard is None else max(connected_at, self._last_heard)

    def _seconds_since(self, moment: float) -> float:
        return self._clock.monotonic() - moment


def _close_quietly(port: Port) -> None:
    try:
        port.close()
    except Exception:
        log.debug("Seriell: Schließen fehlgeschlagen", exc_info=True)


def feed_simulated_presses(link: SerialLink, lines: Iterable[str]) -> None:
    for line in lines:
        link.handle_line(f"BUZZ {(line.split() or [SIMULATED_CODE])[0]}")
    log.info("Eingabe beendet – Agent läuft weiter (Ctrl+C beendet)")
