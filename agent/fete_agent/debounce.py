from .clock import Clock

PRUNE_THRESHOLD = 64


class Debouncer:
    def __init__(self, gap_ms: int, clock: Clock) -> None:
        self._gap_seconds = gap_ms / 1000
        self._clock = clock
        self._last_seen: dict[str, float] = {}

    def is_new_press(self, code: str) -> bool:
        now = self._clock.monotonic()
        previous = self._last_seen.get(code)
        self._last_seen[code] = now
        if len(self._last_seen) > PRUNE_THRESHOLD:
            self._forget_quiet_codes(now)
        return previous is None or now - previous >= self._gap_seconds

    def _forget_quiet_codes(self, now: float) -> None:
        self._last_seen = {
            code: seen for code, seen in self._last_seen.items() if now - seen < self._gap_seconds
        }
