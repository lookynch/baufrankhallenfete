import uuid

from fete_agent.debounce import Debouncer
from fete_agent.presses import PressRecorder


def make_recorder(clock, server_clock, buffer, allowed_codes=(), on_recorded=lambda: None):
    return PressRecorder(Debouncer(600, clock), allowed_codes, buffer, server_clock, clock, on_recorded)


def test_whitelisted_code_is_buffered(clock, server_clock, buffer):
    recorder = make_recorder(clock, server_clock, buffer, allowed_codes={"5592405"})

    event = recorder.handle_code("5592405")

    assert buffer.all() == [event]
    assert event.source_code == "5592405"
    assert uuid.UUID(event.event_id).version == 4


def test_code_outside_whitelist_is_logged_and_ignored(clock, server_clock, buffer, caplog):
    recorder = make_recorder(clock, server_clock, buffer, allowed_codes={"5592405"})

    assert recorder.handle_code("1234") is None

    assert buffer.count() == 0
    assert "1234 ignoriert" in caplog.text


def test_empty_whitelist_allows_every_code(clock, server_clock, buffer):
    recorder = make_recorder(clock, server_clock, buffer)

    recorder.handle_code("1")
    clock.advance(1)
    recorder.handle_code("2")

    assert [event.source_code for event in buffer.all()] == ["1", "2"]


def test_held_foreign_code_is_logged_once(clock, server_clock, buffer, caplog):
    recorder = make_recorder(clock, server_clock, buffer, allowed_codes={"5592405"})

    for _ in range(10):
        recorder.handle_code("1234")
        clock.advance(0.1)

    assert caplog.text.count("1234 ignoriert") == 1


def test_pressed_at_uses_server_offset(clock, server_clock, buffer):
    server_clock.offset_ms = -2500
    recorder = make_recorder(clock, server_clock, buffer)

    event = recorder.handle_code("1")

    assert event.pressed_at == int(clock.time() * 1000) - 2500


def test_event_is_stored_before_sender_is_woken(clock, server_clock, buffer):
    counts_at_wake = []
    recorder = make_recorder(
        clock, server_clock, buffer, on_recorded=lambda: counts_at_wake.append(buffer.count())
    )

    recorder.handle_code("1")

    assert counts_at_wake == [1]
