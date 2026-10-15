from fakes import FakeClock

from fete_agent.debounce import Debouncer


def feed(debouncer: Debouncer, clock: FakeClock, code: str, times: int, every: float) -> int:
    events = 0
    for _ in range(times):
        events += debouncer.is_new_press(code)
        clock.advance(every)
    return events


def test_held_button_repeating_every_100ms_counts_once(clock):
    debouncer = Debouncer(600, clock)

    assert feed(debouncer, clock, "5592405", times=50, every=0.1) == 1


def test_two_presses_with_one_second_pause_count_twice(clock):
    debouncer = Debouncer(600, clock)

    first = feed(debouncer, clock, "5592405", times=4, every=0.1)
    clock.advance(1.0)
    second = feed(debouncer, clock, "5592405", times=4, every=0.1)

    assert (first, second) == (1, 1)


def test_first_reception_triggers_immediately(clock):
    assert Debouncer(600, clock).is_new_press("1") is True


def test_suppressed_repeat_extends_quiet_window(clock):
    debouncer = Debouncer(600, clock)
    debouncer.is_new_press("1")
    clock.advance(0.5)
    assert debouncer.is_new_press("1") is False
    clock.advance(0.5)
    assert debouncer.is_new_press("1") is False
    clock.advance(0.6)
    assert debouncer.is_new_press("1") is True


def test_codes_are_debounced_independently(clock):
    debouncer = Debouncer(600, clock)

    assert debouncer.is_new_press("1") is True
    assert debouncer.is_new_press("2") is True
    clock.advance(0.1)
    assert debouncer.is_new_press("1") is False


def test_many_foreign_codes_do_not_break_debounce(clock):
    debouncer = Debouncer(600, clock)
    debouncer.is_new_press("mine")
    for code in range(200):
        debouncer.is_new_press(str(code))

    assert debouncer.is_new_press("mine") is False
