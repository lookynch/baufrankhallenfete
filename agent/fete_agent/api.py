import hashlib
import hmac
import http.client
import json
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Protocol

from . import __version__
from .clock import ServerClock

PRESS_PATH = "/api/buzzer/press"
HEARTBEAT_PATH = "/api/buzzer/heartbeat"
STALE_TIMESTAMP = "stale_timestamp"
BAD_SIGNATURE = "bad_signature"


class TransportError(Exception):
    pass


@dataclass(frozen=True)
class HttpResponse:
    status: int
    body: bytes = b""

    def json(self) -> dict[str, Any]:
        try:
            data = json.loads(self.body)
        except ValueError:
            return {}
        return data if isinstance(data, dict) else {}

    def describe(self) -> str:
        error = self.json().get("error")
        return f"HTTP {self.status} {error}" if error else f"HTTP {self.status}"


class Transport(Protocol):
    def post(self, url: str, headers: dict[str, str], body: bytes, timeout: float) -> HttpResponse: ...


class UrllibTransport:
    def post(self, url: str, headers: dict[str, str], body: bytes, timeout: float) -> HttpResponse:
        request = urllib.request.Request(url, data=body, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return HttpResponse(response.status, response.read())
        except urllib.error.HTTPError as error:
            return HttpResponse(error.code, _read_quietly(error))
        except (urllib.error.URLError, http.client.HTTPException, OSError) as error:
            raise TransportError(_describe_network_error(error)) from error


def _read_quietly(error: urllib.error.HTTPError) -> bytes:
    try:
        return error.read()
    except (OSError, http.client.HTTPException):
        return b""
    finally:
        error.close()


def _describe_network_error(error: Exception) -> str:
    reason = getattr(error, "reason", error)
    if isinstance(reason, TimeoutError):
        return "Timeout"
    return str(reason) or type(reason).__name__


def encode_json(payload: dict[str, Any]) -> bytes:
    return json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def sign(secret: str, method: str, path: str, timestamp: str, body: bytes) -> str:
    message = f"{method}\n{path}\n{timestamp}\n{hashlib.sha256(body).hexdigest()}"
    return hmac.new(secret.encode("utf-8"), message.encode("utf-8"), hashlib.sha256).hexdigest()


class ApiClient:
    def __init__(
        self,
        base_url: str,
        agent_id: str,
        secret: str,
        server_clock: ServerClock,
        transport: Transport,
        timeout_seconds: float,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._agent_id = agent_id
        self._secret = secret
        self._server_clock = server_clock
        self._transport = transport
        self._timeout = timeout_seconds

    def post(self, path: str, payload: dict[str, Any]) -> HttpResponse:
        body = encode_json(payload)
        sent_at_local = self._server_clock.local_ms()
        timestamp = str(sent_at_local + self._server_clock.offset_ms)
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": f"fete-agent/{__version__}",
            "X-Fete-Agent": self._agent_id,
            "X-Fete-Timestamp": timestamp,
            "X-Fete-Signature": sign(self._secret, "POST", path, timestamp, body),
        }
        response = self._transport.post(self._base_url + path, headers, body, self._timeout)
        self._adopt_server_time(response, (sent_at_local + self._server_clock.local_ms()) // 2)
        return response

    def _adopt_server_time(self, response: HttpResponse, local_ms: int) -> None:
        data = response.json()
        server_time = data.get("server_time")
        if isinstance(server_time, bool) or not isinstance(server_time, int | float):
            return
        if response.status == 200 or data.get("error") == STALE_TIMESTAMP:
            self._server_clock.adopt(int(server_time), local_ms)
