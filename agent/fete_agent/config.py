import os
import re
import tomllib
from collections.abc import Mapping
from dataclasses import MISSING, dataclass, field, fields
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

SECRET_ENV = "FETE_BUZZER_SECRET"
LOCAL_HOSTS = ("localhost", "127.0.0.1", "::1")
AGENT_ID_PATTERN = re.compile(r"[A-Za-z0-9._-]{1,40}")


class ConfigError(Exception):
    pass


@dataclass(frozen=True)
class Config:
    base_url: str
    agent_id: str
    secret: str = field(repr=False)
    serial_port: str = ""
    baud: int = 9600
    allowed_codes: frozenset[str] = frozenset()
    debounce_gap_ms: int = 600
    buffer_path: Path = Path("fete_buffer.sqlite3")
    beep: bool = False
    heartbeat_seconds: float = 20.0
    request_timeout_seconds: float = 8.0


FIELDS = {f.name: f for f in fields(Config)}


def load_config(path: str | Path, environ: Mapping[str, str] = os.environ) -> Config:
    path = Path(path)
    try:
        raw = tomllib.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise ConfigError(f"Konfigurationsdatei nicht gefunden: {path.resolve()}") from error
    except tomllib.TOMLDecodeError as error:
        raise ConfigError(f"{path}: ungültiges TOML ({error})") from error
    return parse_config(raw, environ, path.resolve().parent)


def parse_config(raw: Mapping[str, Any], environ: Mapping[str, str], base_dir: Path) -> Config:
    unknown = sorted(set(raw) - set(FIELDS))
    if unknown:
        raise ConfigError(f"Unbekannte Felder in der Konfiguration: {', '.join(unknown)}")
    secret = (environ.get(SECRET_ENV) or "").strip() or _value(raw, "secret", str, default="").strip()
    if not secret:
        raise ConfigError(f"Kein secret: Umgebungsvariable {SECRET_ENV} setzen oder secret eintragen")
    buffer_path = Path(_value(raw, "buffer_path", str))
    return Config(
        base_url=_base_url(_value(raw, "base_url", str)),
        agent_id=_agent_id(raw),
        secret=secret,
        serial_port=_value(raw, "serial_port", str).strip(),
        baud=_at_least(raw, "baud", int, 1),
        allowed_codes=_allowed_codes(raw),
        debounce_gap_ms=_at_least(raw, "debounce_gap_ms", int, 0),
        buffer_path=buffer_path if buffer_path.is_absolute() else base_dir / buffer_path,
        beep=_value(raw, "beep", bool),
        heartbeat_seconds=float(_at_least(raw, "heartbeat_seconds", int | float, 2)),
        request_timeout_seconds=float(_at_least(raw, "request_timeout_seconds", int | float, 1)),
    )


def _value(raw: Mapping[str, Any], name: str, kind: Any, default: Any = MISSING) -> Any:
    if name not in raw:
        fallback = FIELDS[name].default if default is MISSING else default
        if fallback is MISSING:
            raise ConfigError(f"Pflichtfeld fehlt: {name}")
        return fallback
    value = raw[name]
    if not isinstance(value, kind) or (isinstance(value, bool) and kind is not bool):
        raise ConfigError(f"{name}: ungültiger Wert {value!r}")
    return value


def _agent_id(raw: Mapping[str, Any]) -> str:
    value = _value(raw, "agent_id", str)
    if not AGENT_ID_PATTERN.fullmatch(value):
        raise ConfigError(f"agent_id: 1–40 Zeichen aus A–Z, a–z, 0–9, '.', '_', '-' erlaubt: {value!r}")
    return value


def _at_least(raw: Mapping[str, Any], name: str, kind: Any, minimum: float) -> Any:
    value = _value(raw, name, kind)
    if value < minimum:
        raise ConfigError(f"{name} muss mindestens {minimum} sein")
    return value


def _allowed_codes(raw: Mapping[str, Any]) -> frozenset[str]:
    codes = _value(raw, "allowed_codes", list, default=[])
    if any(isinstance(code, bool) or not isinstance(code, str | int) for code in codes):
        raise ConfigError('allowed_codes muss eine Liste von Codes sein, z. B. ["5592405"]')
    return frozenset(str(code).strip() for code in codes)


def _base_url(value: str) -> str:
    parts = urlsplit(value.strip())
    secure = parts.scheme == "https" or (parts.scheme == "http" and parts.hostname in LOCAL_HOSTS)
    if not secure or not parts.hostname:
        raise ConfigError(f"base_url muss eine https://-Adresse sein: {value!r}")
    if parts.path not in ("", "/") or parts.query or parts.fragment:
        raise ConfigError(
            f"base_url darf nur Schema und Host enthalten, z. B. https://fete.example.org: {value!r}"
        )
    return f"{parts.scheme}://{parts.netloc}"
