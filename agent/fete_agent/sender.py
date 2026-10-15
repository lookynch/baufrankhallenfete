import logging
import random
import threading
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from .api import BAD_SIGNATURE, PRESS_PATH, STALE_TIMESTAMP, ApiClient, HttpResponse, TransportError
from .buffer import EventBuffer, PendingEvent
from .clock import Clock, ServerClock

log = logging.getLogger(__name__)

IDLE_WAIT_SECONDS = 30.0
ERROR_WAIT_SECONDS = 5.0
BOOKED_STATUSES = ("accepted", "duplicate")


@dataclass
class Backoff:
    base_seconds: float = 1.0
    max_seconds: float = 30.0
    rng: random.Random = field(default_factory=random.Random)

    def delay(self, attempts: int) -> float:
        exponential = self.base_seconds * 2 ** min(attempts - 1, 16)
        return min(self.max_seconds, exponential * self.rng.uniform(0.85, 1.15))


class Sender:
    def __init__(
        self,
        buffer: EventBuffer,
        api: ApiClient,
        agent_id: str,
        clock: Clock,
        server_clock: ServerClock,
        backoff: Backoff | None = None,
        beep: Callable[[], None] = lambda: None,
    ) -> None:
        self.wake = threading.Event()
        self._buffer = buffer
        self._api = api
        self._agent_id = agent_id
        self._clock = clock
        self._server_clock = server_clock
        self._backoff = backoff or Backoff()
        self._beep = beep
        self._stale_retry_used = False
        self._reported_offline_queue: int | None = None

    def run(self, stop: threading.Event) -> None:
        while not stop.is_set():
            try:
                delay = self.send_next()
            except Exception:
                log.exception("✖ Fehler in der Sende-Schleife")
                delay = ERROR_WAIT_SECONDS
            if delay is None or delay > 0:
                self.wake.wait(IDLE_WAIT_SECONDS if delay is None else delay)
                self.wake.clear()

    def send_next(self) -> float | None:
        event = self._buffer.oldest()
        if event is None:
            return None
        wait = event.next_attempt_at - self._clock.time()
        if 0 < wait <= self._backoff.max_seconds:
            return wait
        return self._send(event)

    def _send(self, event: PendingEvent) -> float:
        try:
            response = self._api.post(PRESS_PATH, self._payload(event))
        except TransportError as error:
            return self._retry_later(event, str(error))
        data = response.json()
        if response.status == 200 and data.get("status") in BOOKED_STATUSES:
            return self._booked(event, data)
        if response.status == 422:
            return self._rejected(event, response, data)
        if response.status == 401 and data.get("error") == STALE_TIMESTAMP and not self._stale_retry_used:
            self._stale_retry_used = True
            log.warning("⚠ Zeitstempel abgelehnt – Uhr an Server angeglichen, sende sofort erneut")
            return 0.0
        if response.status == 401 and data.get("error") == BAD_SIGNATURE:
            log.error("✖ Signatur abgelehnt – secret und agent_id prüfen! Event bleibt im Puffer.")
        if response.status == 200:
            return self._retry_later(event, f"unerwartete Antwort: {response.body[:80]!r}")
        return self._retry_later(event, response.describe())

    def _payload(self, event: PendingEvent) -> dict[str, Any]:
        return {
            "event_id": event.event_id,
            "pressed_at": min(event.pressed_at, self._server_clock.now_ms()),
            "source_code": event.source_code,
            "agent_id": self._agent_id,
        }

    def _booked(self, event: PendingEvent, data: dict[str, Any]) -> float:
        self._buffer.remove(event.event_id)
        self._settled()
        booking_no = data.get("booking_no")
        suffix = f" ({booking_no})" if booking_no else ""
        if data["status"] == "duplicate":
            log.info("✔ Kasten war bereits gebucht%s", suffix)
        else:
            log.info("✔ Kasten gebucht%s", suffix)
            self._beep()
        return 0.0

    def _rejected(self, event: PendingEvent, response: HttpResponse, data: dict[str, Any]) -> float:
        reason = data.get("error") or data.get("reason") or data.get("message")
        reason = str(reason) if reason else response.body[:200].decode("utf-8", errors="replace")
        self._buffer.reject(event, response.status, reason, self._clock.time())
        self._settled()
        log.error("✖ Kasten abgelehnt (Code %s): %s – wird nicht erneut gesendet", event.source_code, reason)
        return 0.0

    def _retry_later(self, event: PendingEvent, reason: str) -> float:
        self._stale_retry_used = False
        attempts = event.attempts + 1
        delay = self._backoff.delay(attempts)
        self._buffer.reschedule(event.event_id, attempts, self._clock.time() + delay)
        queued = self._buffer.count()
        if queued != self._reported_offline_queue:
            log.warning("⏳ offline – %d im Puffer (%s)", queued, reason)
            self._reported_offline_queue = queued
        else:
            log.debug("Versuch %d fehlgeschlagen (%s), nächster in %.1f s", attempts, reason, delay)
        return delay

    def _settled(self) -> None:
        self._stale_retry_used = False
        self._reported_offline_queue = None
