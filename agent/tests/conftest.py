import pytest
from fakes import AGENT_ID, BASE_URL, SECRET, FakeClock, FakeTransport

from fete_agent.api import ApiClient
from fete_agent.buffer import EventBuffer
from fete_agent.clock import ServerClock


@pytest.fixture
def clock() -> FakeClock:
    return FakeClock()


@pytest.fixture
def server_clock(clock: FakeClock) -> ServerClock:
    return ServerClock(clock)


@pytest.fixture
def buffer(tmp_path):
    event_buffer = EventBuffer(tmp_path / "buffer.sqlite3")
    yield event_buffer
    event_buffer.close()


@pytest.fixture
def transport() -> FakeTransport:
    return FakeTransport()


@pytest.fixture
def api(server_clock: ServerClock, transport: FakeTransport) -> ApiClient:
    return ApiClient(BASE_URL, AGENT_ID, SECRET, server_clock, transport, timeout_seconds=8)
