import argparse
import logging
import signal
import sys
import threading
from collections.abc import Callable
from functools import partial

from . import __version__
from .api import ApiClient, UrllibTransport
from .buffer import EventBuffer
from .clock import Clock, ServerClock, SystemClock
from .config import Config, ConfigError, load_config
from .debounce import Debouncer
from .heartbeat import Heartbeat
from .presses import PressRecorder
from .sender import Sender
from .serial_link import (
    SILENCE_TIMEOUT_SECONDS,
    SIMULATED_CODE,
    SerialLink,
    feed_simulated_presses,
    open_serial_port,
)

log = logging.getLogger(__name__)

STATUS_POLL_SECONDS = 0.5
SHUTDOWN_GRACE_SECONDS = 2.0


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    setup_logging(args.verbose)
    try:
        config = load_config(args.config)
    except ConfigError as error:
        log.error("✖ %s", error)
        return 2
    if not args.simulate and not config.serial_port:
        log.error("✖ serial_port fehlt in der Konfiguration (oder mit --simulate starten)")
        return 2
    run(config, simulate=args.simulate)
    return 0


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="fete_agent", description="Buzzer-Agent für die Fete-App")
    parser.add_argument("config", nargs="?", default="config.toml", help="Pfad zur TOML-Konfiguration")
    parser.add_argument("--simulate", action="store_true", help="stdin statt Seriell: Enter = BUZZ test")
    parser.add_argument("-v", "--verbose", action="store_true", help="Debug-Ausgaben")
    return parser.parse_args(argv)


def setup_logging(verbose: bool) -> None:
    for stream in (sys.stdout, sys.stderr):
        if stream is not None and hasattr(stream, "reconfigure"):
            stream.reconfigure(errors="backslashreplace")
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s  %(message)s",
        datefmt="%H:%M:%S",
        stream=sys.stdout,
    )


def run(config: Config, simulate: bool, clock: Clock | None = None) -> None:
    clock = clock or SystemClock()
    server_clock = ServerClock(clock)
    buffer = EventBuffer(config.buffer_path)
    buffer.make_all_due()
    api = ApiClient(
        config.base_url,
        config.agent_id,
        config.secret,
        server_clock,
        UrllibTransport(),
        config.request_timeout_seconds,
    )
    sender = Sender(buffer, api, config.agent_id, clock, server_clock, beep=make_beeper(config.beep))
    allowed_codes = config.allowed_codes
    if simulate and allowed_codes:
        allowed_codes |= {SIMULATED_CODE}
    recorder = PressRecorder(
        Debouncer(config.debounce_gap_ms, clock),
        allowed_codes,
        buffer,
        server_clock,
        clock,
        on_recorded=sender.wake.set,
    )
    link = SerialLink(
        config.serial_port,
        partial(open_serial_port, config.serial_port, config.baud),
        recorder.handle_code,
        clock,
    )
    serial_ok = (lambda: True) if simulate else link.ok
    heartbeat = Heartbeat(
        api, config.agent_id, config.heartbeat_seconds, server_clock, buffer.count, serial_ok
    )

    log.info("Fete-Agent %s · %s → %s", __version__, config.agent_id, config.base_url)
    if queued := buffer.count():
        log.info("⏳ %d Events aus dem Puffer werden nachgesendet", queued)
    if simulate:
        log.warning("Simulationsmodus: Enter = BUZZ %s – wird ECHT an den Server gesendet", SIMULATED_CODE)

    stop = threading.Event()
    workers = [
        start_thread("sender", sender.run, stop),
        start_thread("heartbeat", heartbeat.run, stop),
    ]
    if simulate:
        start_thread("stdin", feed_simulated_presses, link, sys.stdin)
    else:
        workers.append(start_thread("serial", link.run, stop))

    install_stop_signal(stop)
    serial_status = SerialStatusReporter(link.ok, clock)
    try:
        while not stop.wait(STATUS_POLL_SECONDS):
            if not simulate:
                serial_status.check()
    except KeyboardInterrupt:
        pass
    log.info("Beende …")
    stop.set()
    sender.wake.set()
    for worker in workers:
        worker.join(config.request_timeout_seconds + SHUTDOWN_GRACE_SECONDS)
    log.info("Beendet – %d Events im Puffer", buffer.count())
    buffer.close()


def start_thread(name: str, target: Callable[..., object], *args: object) -> threading.Thread:
    thread = threading.Thread(target=target, args=args, name=name, daemon=True)
    thread.start()
    return thread


def install_stop_signal(stop: threading.Event) -> None:
    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, lambda *_: stop.set())


class SerialStatusReporter:
    def __init__(self, serial_ok: Callable[[], bool], clock: Clock) -> None:
        self._serial_ok = serial_ok
        self._clock = clock
        self._started_at = clock.monotonic()
        self._reported: bool | None = None

    def check(self) -> None:
        ok = self._serial_ok()
        in_grace_period = self._clock.monotonic() - self._started_at < SILENCE_TIMEOUT_SECONDS
        if ok == self._reported or (not ok and in_grace_period):
            return
        if ok:
            log.info("✔ Seriell ok – Empfänger meldet sich")
        else:
            log.warning(
                "⚠ Seriell gestört – seit %.0f s kein Lebenszeichen vom Empfänger", SILENCE_TIMEOUT_SECONDS
            )
        self._reported = ok


def make_beeper(enabled: bool) -> Callable[[], None]:
    if not enabled:
        return lambda: None
    if sys.platform == "win32":
        import winsound

        def beep() -> None:
            try:
                winsound.Beep(1200, 150)
            except RuntimeError:
                log.debug("Beep nicht möglich", exc_info=True)

        return beep

    def bell() -> None:
        sys.stdout.write("\a")
        sys.stdout.flush()

    return bell
