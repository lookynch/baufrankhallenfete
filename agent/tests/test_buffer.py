from fete_agent.buffer import EventBuffer, PendingEvent


def make_event(number: int) -> PendingEvent:
    return PendingEvent(
        event_id=f"event-{number}",
        pressed_at=1760000000000 + number,
        source_code="5592405",
        attempts=0,
        next_attempt_at=0.0,
        created_at=1760000000.0 + number,
    )


def test_pending_events_survive_restart_in_order(tmp_path):
    path = tmp_path / "fete_buffer.sqlite3"
    first = EventBuffer(path)
    for number in (1, 2, 3):
        first.add(make_event(number))
    first.reschedule("event-1", attempts=4, next_attempt_at=1760000099.0)
    first.close()

    second = EventBuffer(path)

    assert [event.event_id for event in second.all()] == ["event-1", "event-2", "event-3"]
    assert second.oldest().attempts == 4
    assert second.oldest().next_attempt_at == 1760000099.0
    second.close()


def test_make_all_due_resets_backoff_but_keeps_attempts(buffer):
    buffer.add(make_event(1))
    buffer.reschedule("event-1", attempts=3, next_attempt_at=1760000099.0)

    buffer.make_all_due()

    assert buffer.oldest().next_attempt_at == 0
    assert buffer.oldest().attempts == 3


def test_reject_moves_event_to_rejected_table(tmp_path):
    path = tmp_path / "fete_buffer.sqlite3"
    buffer = EventBuffer(path)
    buffer.add(make_event(1))
    buffer.reject(make_event(1), 422, "unknown_code", 1760000001.0)
    buffer.close()

    reopened = EventBuffer(path)

    assert reopened.count() == 0
    [rejected] = reopened.rejected()
    assert (rejected.event.event_id, rejected.http_status, rejected.reason) == (
        "event-1",
        422,
        "unknown_code",
    )
    reopened.close()


def test_order_follows_insertion_not_clock(buffer):
    later_clock = make_event(1)
    earlier_clock = PendingEvent("event-2", 1, "5592405", 0, 0.0, created_at=1.0)
    buffer.add(later_clock)
    buffer.add(earlier_clock)

    assert buffer.oldest() == later_clock
