import json
from dataclasses import dataclass
from typing import Any

from fete_agent.api import HttpResponse

BASE_URL = "https://fete.example.org"
AGENT_ID = "bar-pc-1"
SECRET = "test-secret-123"


class FakeClock:
    def __init__(self, wall: float = 1_760_000_000.0, mono: float = 500.0) -> None:
        self.wall = wall
        self.mono = mono

    def time(self) -> float:
        return self.wall

    def monotonic(self) -> float:
        return self.mono

    def advance(self, seconds: float) -> None:
        self.wall += seconds
        self.mono += seconds


@dataclass(frozen=True)
class SentRequest:
    url: str
    headers: dict[str, str]
    body: bytes

    @property
    def json(self) -> dict[str, Any]:
        return json.loads(self.body)


class FakeTransport:
    def __init__(self, *outcomes: HttpResponse | Exception) -> None:
        self.outcomes = list(outcomes)
        self.requests: list[SentRequest] = []

    def post(self, url: str, headers: dict[str, str], body: bytes, timeout: float) -> HttpResponse:
        self.requests.append(SentRequest(url, headers, body))
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


def respond(http_status: int, /, **data: Any) -> HttpResponse:
    return HttpResponse(http_status, json.dumps(data).encode())
