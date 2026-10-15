import logging
import sqlite3
import uuid
from collections.abc import Callable, Collection

from .buffer import EventBuffer, PendingEvent
from .clock import Clock, ServerClock
from .debounce import Debouncer

log = logging.getLogger(__name__)


class PressRecorder:
    def __init__(
        self,
        debouncer: Debouncer,
        allowed_codes: Collection[str],
        buffer: EventBuffer,
        server_clock: ServerClock,
        clock: Clock,
        on_recorded: Callable[[], None] = lambda: None,
    ) -> None:
        self._debouncer = debouncer
        self._allowed_codes = frozenset(allowed_codes)
        self._buffer = buffer
        self._server_clock = server_clock
        self._clock = clock
        self._on_recorded = on_recorded

    def handle_code(self, code: str) -> PendingEvent | None:
        if not self._debouncer.is_new_press(code):
            log.debug("BUZZ %s – Wiederholung, unterdrückt", code)
            return None
        if self._allowed_codes and code not in self._allowed_codes:
            log.info("Code %s ignoriert (nicht in allowed_codes)", code)
            return None
        event = PendingEvent(
            event_id=str(uuid.uuid4()),
            pressed_at=self._server_clock.now_ms(),
            source_code=code,
            attempts=0,
            next_attempt_at=0.0,
            created_at=self._clock.time(),
        )
        try:
            self._buffer.add(event)
        except sqlite3.Error:
            log.critical("✖ Druck konnte NICHT gespeichert werden: %s", event, exc_info=True)
            return None
        log.info("● Druck erkannt (Code %s)", code)
        self._on_recorded()
        return event
