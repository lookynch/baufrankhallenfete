import random

import pytest
from fakes import AGENT_ID, SECRET, FakeTransport, respond

from fete_agent.api import TransportError, sign
from fete_agent.buffer import PendingEvent
from fete_agent.sender import Backoff, Sender


def make_event(number: int = 1) -> PendingEvent:
    return PendingEvent(f"event-{number}", 1759999990000 + number, "5592405", 0, 0.0, 1759999990.0)


@pytest.fixture
def beeps() -> list[str]:
    return []


@pytest.fixture
def sender(buffer, api, clock, server_clock, beeps) -> Sender:
    return Sender(
        buffer,
        api,
        AGENT_ID,
        clock,
        server_clock,
        Backoff(rng=random.Random(7)),
        beep=lambda: beeps.append("beep"),
    )


def queue(transport: FakeTransport, *outcomes) -> None:
    transport.outcomes.extend(outcomes)


def test_accepted_event_is_removed_and_reported(sender, buffer, transport, beeps, caplog):
    buffer.add(make_event())
    queue(transport, respond(200, status="accepted", booking_no="BF-0042"))

    assert sender.send_next() == 0
    assert sender.send_next() is None

    assert buffer.count() == 0
    assert "✔ Kasten gebucht (BF-0042)" in caplog.text
    assert beeps == ["beep"]
    request = transport.requests[0]
    assert request.url == "https://fete.example.org/api/buzzer/press"
    assert request.json == {
        "event_id": "event-1",
        "pressed_at": 1759999990001,
        "source_code": "5592405",
        "agent_id": AGENT_ID,
    }
    timestamp = request.headers["X-Fete-Timestamp"]
    assert request.headers["X-Fete-Signature"] == sign(
        SECRET, "POST", "/api/buzzer/press", timestamp, request.body
    )


def test_accepted_without_booking_no(sender, buffer, transport, caplog):
    buffer.add(make_event())
    queue(transport, respond(200, status="accepted"))

    sender.send_next()

    assert "✔ Kasten gebucht\n" in caplog.text


def test_duplicate_is_removed_without_beep(sender, buffer, transport, beeps):
    buffer.add(make_event())
    queue(transport, respond(200, status="duplicate", booking_no="BF-0042"))

    sender.send_next()

    assert buffer.count() == 0
    assert beeps == []


def test_200_with_unexpected_body_keeps_event(sender, buffer, transport):
    buffer.add(make_event())
    queue(transport, respond(200, hello="captive portal"))

    sender.send_next()

    assert buffer.count() == 1


def test_422_moves_event_to_rejected_and_never_resends(sender, buffer, transport, clock, caplog):
    buffer.add(make_event())
    queue(transport, respond(422, error="unknown_source_code"))

    sender.send_next()
    clock.advance(60)

    assert sender.send_next() is None
    assert len(transport.requests) == 1
    assert buffer.count() == 0
    [rejected] = buffer.rejected()
    assert (rejected.event.event_id, rejected.reason) == ("event-1", "unknown_source_code")
    assert "unknown_source_code" in caplog.text


def test_stale_timestamp_adopts_server_offset_and_resends_immediately(
    sender, buffer, transport, clock, server_clock
):
    buffer.add(make_event())
    server_time = int(clock.time() * 1000) + 90_000
    queue(
        transport,
        respond(401, error="stale_timestamp", server_time=server_time),
        respond(200, status="accepted"),
    )

    assert sender.send_next() == 0
    assert server_clock.offset_ms == 90_000
    sender.send_next()

    assert buffer.count() == 0
    assert transport.requests[1].headers["X-Fete-Timestamp"] == str(server_time)
    assert transport.requests[1].body == transport.requests[0].body


def test_repeated_stale_timestamp_backs_off_instead_of_spinning(sender, buffer, transport, clock):
    buffer.add(make_event())
    stale = respond(401, error="stale_timestamp", server_time=int(clock.time() * 1000))
    queue(transport, stale, stale)

    assert sender.send_next() == 0
    assert sender.send_next() > 0

    assert buffer.oldest().attempts == 1


def test_server_error_keeps_event_and_backs_off(sender, buffer, transport, clock, caplog):
    buffer.add(make_event())
    queue(transport, respond(500), respond(503), respond(200, status="accepted"))

    first_delay = sender.send_next()
    assert 0.85 <= first_delay <= 1.15
    assert buffer.oldest().attempts == 1
    assert "⏳ offline – 1 im Puffer (HTTP 500)" in caplog.text

    assert sender.send_next() == pytest.approx(first_delay)
    assert len(transport.requests) == 1

    clock.advance(first_delay)
    second_delay = sender.send_next()
    assert 1.7 <= second_delay <= 2.3
    assert buffer.oldest().attempts == 2

    clock.advance(second_delay)
    sender.send_next()
    assert buffer.count() == 0


@pytest.mark.parametrize("failure", [TransportError("Timeout"), TransportError("Connection refused")])
def test_network_error_keeps_event_and_backs_off(sender, buffer, transport, failure):
    buffer.add(make_event())
    queue(transport, failure)

    delay = sender.send_next()

    assert delay > 0
    assert buffer.oldest().attempts == 1


def test_rate_limit_keeps_event(sender, buffer, transport):
    buffer.add(make_event())
    queue(transport, respond(429, error="rate_limited"))

    assert sender.send_next() > 0
    assert buffer.count() == 1


def test_bad_signature_is_loud_and_never_drops_event(sender, buffer, transport, clock, caplog):
    buffer.add(make_event())
    queue(transport, *[respond(401, error="bad_signature")] * 3)

    for _ in range(3):
        clock.advance(sender.send_next())

    assert buffer.oldest().attempts == 3
    assert caplog.text.count("Signatur abgelehnt") == 3


def test_events_are_sent_strictly_oldest_first(sender, buffer, transport, clock):
    buffer.add(make_event(1))
    buffer.add(make_event(2))
    queue(
        transport, TransportError("offline"), respond(200, status="accepted"), respond(200, status="accepted")
    )

    delay = sender.send_next()
    assert [r.json["event_id"] for r in transport.requests] == ["event-1"]
    assert sender.send_next() == pytest.approx(delay)

    clock.advance(delay)
    sender.send_next()
    sender.send_next()

    assert [r.json["event_id"] for r in transport.requests] == ["event-1", "event-1", "event-2"]


def test_backoff_doubles_up_to_30_seconds():
    backoff = Backoff(rng=random.Random(1))

    delays = [backoff.delay(attempt) for attempt in range(1, 12)]

    for attempt, delay in enumerate(delays[:5], start=1):
        assert 0.85 * 2 ** (attempt - 1) <= delay <= 1.15 * 2 ** (attempt - 1)
    assert all(delay <= 30 for delay in delays)
    assert delays[-1] >= 25


def test_backoff_wait_far_in_future_is_treated_as_due(sender, buffer, transport, clock):
    buffer.add(make_event())
    buffer.reschedule("event-1", attempts=2, next_attempt_at=clock.time() + 3600)
    queue(transport, respond(200, status="accepted"))

    sender.send_next()

    assert buffer.count() == 0


def test_pressed_at_from_wrong_clock_is_never_sent_in_the_future(
    sender, buffer, transport, clock, server_clock
):
    server_clock.offset_ms = 300_000
    buffer.add(PendingEvent("event-1", server_clock.now_ms(), "5592405", 0, 0.0, clock.time()))
    true_server_time = int(clock.time() * 1000)
    queue(
        transport,
        respond(401, error="stale_timestamp", server_time=true_server_time),
        respond(200, status="accepted"),
    )

    sender.send_next()
    sender.send_next()

    assert transport.requests[1].json["pressed_at"] == true_server_time
    assert buffer.count() == 0
