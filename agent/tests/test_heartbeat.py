import pytest
from fakes import AGENT_ID, respond

from fete_agent.api import TransportError
from fete_agent.heartbeat import Heartbeat


@pytest.fixture
def heartbeat(api, server_clock) -> Heartbeat:
    return Heartbeat(api, AGENT_ID, 20, server_clock, queue_length=lambda: 3, serial_ok=lambda: True)


def test_heartbeat_payload(heartbeat, transport, server_clock):
    server_clock.offset_ms = 1500
    transport.outcomes.append(respond(200, next_tick_at=None))

    heartbeat.beat()

    request = transport.requests[0]
    assert request.url == "https://fete.example.org/api/buzzer/heartbeat"
    assert request.json == {
        "agent_id": AGENT_ID,
        "sent_at": server_clock.now_ms(),
        "queue_length": 3,
        "serial_ok": True,
    }
    assert request.headers["X-Fete-Agent"] == AGENT_ID


@pytest.mark.parametrize(
    ("tick_in_ms", "expected_delay"),
    [(5_000, 5.0), (60_000, 20.0), (500, 2.0), (-10_000, 2.0), (None, 20.0)],
)
def test_next_heartbeat_follows_next_tick_at(heartbeat, transport, server_clock, tick_in_ms, expected_delay):
    next_tick_at = None if tick_in_ms is None else server_clock.now_ms() + tick_in_ms
    transport.outcomes.append(respond(200, next_tick_at=next_tick_at, server_time=server_clock.now_ms()))

    assert heartbeat.beat() == pytest.approx(expected_delay)


def test_next_tick_at_is_compared_in_server_time(heartbeat, transport, clock, server_clock):
    server_now = int(clock.time() * 1000) + 60_000
    transport.outcomes.append(respond(200, next_tick_at=server_now + 7_000, server_time=server_now))

    assert heartbeat.beat() == pytest.approx(7.0)
    assert server_clock.offset_ms == 60_000


def test_heartbeat_keeps_interval_when_offline(heartbeat, transport, caplog):
    transport.outcomes.extend([TransportError("Timeout"), TransportError("Timeout")])

    assert heartbeat.beat() == 20
    assert heartbeat.beat() == 20
    assert caplog.text.count("Heartbeat fehlgeschlagen") == 1


def test_stale_heartbeat_retries_soon_with_server_time(heartbeat, transport, clock, server_clock):
    server_time = int(clock.time() * 1000) - 120_000
    transport.outcomes.append(respond(401, error="stale_timestamp", server_time=server_time))

    assert heartbeat.beat() == 2.0
    assert server_clock.offset_ms == -120_000


def test_reports_recovery_once(heartbeat, transport, caplog):
    transport.outcomes.extend([TransportError("Timeout"), respond(200), respond(200)])

    for _ in range(3):
        heartbeat.beat()

    assert caplog.text.count("Server erreichbar") == 1
