import threading

from fakes import FakeClock

from fete_agent.serial_link import (
    RECONNECT_SECONDS,
    SerialLink,
    feed_simulated_presses,
    parse_line,
)


class ScriptedPort:
    def __init__(self, clock: FakeClock, chunks: list[bytes | Exception], stop: threading.Event) -> None:
        self.clock = clock
        self.chunks = chunks
        self.stop = stop
        self.closed = False

    def readline(self) -> bytes:
        if not self.chunks:
            self.stop.set()
            return b""
        chunk = self.chunks.pop(0)
        if isinstance(chunk, Exception):
            raise chunk
        self.clock.advance(0.1)
        return chunk

    def close(self) -> None:
        self.closed = True


class RecordingStop(threading.Event):
    def __init__(self) -> None:
        super().__init__()
        self.waits: list[float] = []

    def wait(self, timeout: float | None = None) -> bool:
        self.waits.append(timeout)
        return self.is_set()


def test_parse_line():
    assert parse_line("BUZZ 5592405\r\n") == ("BUZZ", "5592405")
    assert parse_line("ALIVE\r\n") == ("ALIVE", "")
    assert parse_line("HELLO fete-receiver 1\r\n") == ("HELLO", "fete-receiver 1")
    assert parse_line("\x00\xffgarbage") is None
    assert parse_line("BUZZ") is None


def test_serial_ok_after_alive_and_false_after_15_seconds_silence(clock):
    link = SerialLink("COM3", lambda: None, lambda code: None, clock)
    assert link.ok() is False

    link.handle_line("ALIVE\r\n")
    clock.advance(14.9)
    assert link.ok() is True

    clock.advance(0.2)
    assert link.ok() is False


def test_reads_codes_and_joins_partial_lines(clock):
    stop = RecordingStop()
    codes: list[str] = []
    port = ScriptedPort(
        clock, [b"HELLO fete-receiver 1\r\n", b"BUZZ 55", b"92405\r\n", b"", b"ALIVE\r\n"], stop
    )
    link = SerialLink("COM3", lambda: port, codes.append, clock)

    link.run(stop)

    assert codes == ["5592405"]
    assert link.ok() is True
    assert port.closed is True


def test_reconnects_every_two_seconds_after_unplug(clock):
    stop = RecordingStop()
    codes: list[str] = []
    attempts: list[str] = []
    second_port = ScriptedPort(clock, [b"BUZZ 2\r\n"], stop)
    first_port = ScriptedPort(clock, [b"BUZZ 1\r\n", OSError("device disconnected")], stop)
    ports = [first_port, OSError("COM3 not found"), OSError("COM3 not found"), second_port]

    def open_port():
        attempts.append("open")
        port = ports.pop(0)
        if isinstance(port, Exception):
            raise port
        return port

    SerialLink("COM3", open_port, codes.append, clock).run(stop)

    assert codes == ["1", "2"]
    assert len(attempts) == 4
    assert stop.waits == [RECONNECT_SECONDS] * 3
    assert first_port.closed


def test_silent_port_is_reopened(clock):
    stop = RecordingStop()
    silent = ScriptedPort(clock, [b""] * 200, stop)
    replacement = ScriptedPort(clock, [b"ALIVE\r\n"], stop)
    ports = [silent, replacement]

    SerialLink("COM3", lambda: ports.pop(0), lambda code: None, clock).run(stop)

    assert silent.closed
    assert len(silent.chunks) < 200
    assert ports == []


def test_simulation_turns_enter_into_test_code(clock):
    codes: list[str] = []
    link = SerialLink("stdin", lambda: None, codes.append, clock)

    feed_simulated_presses(link, ["\n", "5592405\n"])

    assert codes == ["test", "5592405"]
