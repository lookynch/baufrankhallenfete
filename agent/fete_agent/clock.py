import logging
import time
from typing import Protocol

log = logging.getLogger(__name__)

NOTEWORTHY_OFFSET_CHANGE_MS = 1000


class Clock(Protocol):
    def time(self) -> float: ...

    def monotonic(self) -> float: ...


class SystemClock:
    def time(self) -> float:
        return time.time()

    def monotonic(self) -> float:
        return time.monotonic()


class ServerClock:
    def __init__(self, clock: Clock) -> None:
        self._clock = clock
        self.offset_ms = 0

    def local_ms(self) -> int:
        return int(self._clock.time() * 1000)

    def now_ms(self) -> int:
        return self.local_ms() + self.offset_ms

    def adopt(self, server_time_ms: int, local_ms: int) -> None:
        offset_ms = server_time_ms - local_ms
        if abs(offset_ms - self.offset_ms) >= NOTEWORTHY_OFFSET_CHANGE_MS:
            log.info("Uhr an Server angeglichen (Offset %+d ms)", offset_ms)
        self.offset_ms = offset_ms
