import sqlite3
import threading
from dataclasses import astuple, dataclass
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS pending (
    event_id TEXT PRIMARY KEY,
    pressed_at INTEGER NOT NULL,
    source_code TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at REAL NOT NULL DEFAULT 0,
    created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS rejected (
    event_id TEXT PRIMARY KEY,
    pressed_at INTEGER NOT NULL,
    source_code TEXT NOT NULL,
    attempts INTEGER NOT NULL,
    next_attempt_at REAL NOT NULL,
    created_at REAL NOT NULL,
    http_status INTEGER NOT NULL,
    reason TEXT NOT NULL,
    rejected_at REAL NOT NULL
);
"""
EVENT_COLUMNS = "event_id, pressed_at, source_code, attempts, next_attempt_at, created_at"


@dataclass(frozen=True)
class PendingEvent:
    event_id: str
    pressed_at: int
    source_code: str
    attempts: int
    next_attempt_at: float
    created_at: float


@dataclass(frozen=True)
class RejectedEvent:
    event: PendingEvent
    http_status: int
    reason: str
    rejected_at: float


class EventBuffer:
    def __init__(self, path: str | Path) -> None:
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._db = sqlite3.connect(str(path), check_same_thread=False, timeout=10)
        self._db.execute("PRAGMA synchronous = FULL")
        self._db.executescript(SCHEMA)

    def add(self, event: PendingEvent) -> None:
        with self._lock, self._db:
            self._db.execute(
                f"INSERT INTO pending ({EVENT_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?)", astuple(event)
            )

    def oldest(self) -> PendingEvent | None:
        with self._lock:
            row = self._db.execute(f"SELECT {EVENT_COLUMNS} FROM pending ORDER BY rowid LIMIT 1").fetchone()
        return PendingEvent(*row) if row else None

    def all(self) -> list[PendingEvent]:
        with self._lock:
            rows = self._db.execute(f"SELECT {EVENT_COLUMNS} FROM pending ORDER BY rowid").fetchall()
        return [PendingEvent(*row) for row in rows]

    def count(self) -> int:
        with self._lock:
            return self._db.execute("SELECT COUNT(*) FROM pending").fetchone()[0]

    def remove(self, event_id: str) -> None:
        with self._lock, self._db:
            self._db.execute("DELETE FROM pending WHERE event_id = ?", (event_id,))

    def reschedule(self, event_id: str, attempts: int, next_attempt_at: float) -> None:
        with self._lock, self._db:
            self._db.execute(
                "UPDATE pending SET attempts = ?, next_attempt_at = ? WHERE event_id = ?",
                (attempts, next_attempt_at, event_id),
            )

    def make_all_due(self) -> None:
        with self._lock, self._db:
            self._db.execute("UPDATE pending SET next_attempt_at = 0")

    def reject(self, event: PendingEvent, http_status: int, reason: str, rejected_at: float) -> None:
        with self._lock, self._db:
            self._db.execute(
                f"INSERT OR REPLACE INTO rejected ({EVENT_COLUMNS}, http_status, reason, rejected_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (*astuple(event), http_status, reason, rejected_at),
            )
            self._db.execute("DELETE FROM pending WHERE event_id = ?", (event.event_id,))

    def rejected(self) -> list[RejectedEvent]:
        with self._lock:
            rows = self._db.execute(
                f"SELECT {EVENT_COLUMNS}, http_status, reason, rejected_at FROM rejected ORDER BY rejected_at"
            ).fetchall()
        return [RejectedEvent(PendingEvent(*row[:6]), *row[6:]) for row in rows]

    def close(self) -> None:
        with self._lock:
            self._db.close()
