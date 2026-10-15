import logging
import threading
from collections.abc import Callable

from .api import HEARTBEAT_PATH, STALE_TIMESTAMP, ApiClient, TransportError
from .clock import ServerClock

log = logging.getLogger(__name__)

MIN_INTERVAL_SECONDS = 2.0
NOT_YET_REPORTED = "noch kein Heartbeat"


class Heartbeat:
    def __init__(
        self,
        api: ApiClient,
        agent_id: str,
        interval_seconds: float,
        server_clock: ServerClock,
        queue_length: Callable[[], int],
        serial_ok: Callable[[], bool],
    ) -> None:
        self._api = api
        self._agent_id = agent_id
        self._interval = interval_seconds
        self._server_clock = server_clock
        self._queue_length = queue_length
        self._serial_ok = serial_ok
        self._reported_problem: str | None = NOT_YET_REPORTED

    def run(self, stop: threading.Event) -> None:
        while not stop.is_set():
            try:
                delay = self.beat()
            except Exception:
                log.exception("✖ Fehler im Heartbeat")
                delay = self._interval
            stop.wait(delay)

    def beat(self) -> float:
        payload = {
            "agent_id": self._agent_id,
            "sent_at": self._server_clock.now_ms(),
            "queue_length": self._queue_length(),
            "serial_ok": self._serial_ok(),
        }
        try:
            response = self._api.post(HEARTBEAT_PATH, payload)
        except TransportError as error:
            self._report(str(error))
            return self._interval
        data = response.json()
        if response.status != 200:
            self._report(response.describe())
            return MIN_INTERVAL_SECONDS if data.get("error") == STALE_TIMESTAMP else self._interval
        self._report(None)
        return self.next_delay(data.get("next_tick_at"))

    def next_delay(self, next_tick_at: object) -> float:
        delay = self._interval
        if isinstance(next_tick_at, int | float) and not isinstance(next_tick_at, bool):
            delay = min(delay, (next_tick_at - self._server_clock.now_ms()) / 1000)
        return max(MIN_INTERVAL_SECONDS, delay)

    def _report(self, problem: str | None) -> None:
        if problem == self._reported_problem:
            return
        if problem is None:
            log.info("✔ Server erreichbar")
        else:
            log.warning("⚠ Heartbeat fehlgeschlagen (%s)", problem)
        self._reported_problem = problem
