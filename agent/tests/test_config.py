from pathlib import Path

import pytest

from fete_agent.config import SECRET_ENV, Config, ConfigError, load_config, parse_config

MINIMAL = {"base_url": "https://fete.example.org", "agent_id": "bar-pc-1", "secret": "from-file"}


def parse(raw: dict, environ: dict | None = None) -> Config:
    return parse_config(raw, environ or {}, Path("/opt/fete"))


def test_defaults():
    config = parse(MINIMAL)

    assert config.baud == 9600
    assert config.allowed_codes == frozenset()
    assert config.debounce_gap_ms == 600
    assert config.buffer_path == Path("/opt/fete/fete_buffer.sqlite3")
    assert config.beep is False
    assert config.heartbeat_seconds == 20
    assert config.request_timeout_seconds == 8


def test_environment_secret_takes_precedence():
    assert parse(MINIMAL, {SECRET_ENV: "from-env"}).secret == "from-env"


def test_secret_from_environment_only():
    raw = {key: value for key, value in MINIMAL.items() if key != "secret"}

    assert parse(raw, {SECRET_ENV: "from-env"}).secret == "from-env"


def test_missing_secret_is_an_error():
    with pytest.raises(ConfigError, match=SECRET_ENV):
        parse({**MINIMAL, "secret": ""})


def test_secret_is_not_in_repr():
    assert "from-file" not in repr(parse(MINIMAL))


def test_unknown_field_is_an_error():
    with pytest.raises(ConfigError, match="allowed_code"):
        parse({**MINIMAL, "allowed_code": ["1"]})


def test_allowed_codes_accept_numbers():
    assert parse({**MINIMAL, "allowed_codes": ["5592405", 123]}).allowed_codes == {"5592405", "123"}


@pytest.mark.parametrize(
    "base_url",
    ["http://fete.example.org", "https://fete.example.org/app", "fete.example.org", "https://"],
)
def test_invalid_base_url(base_url):
    with pytest.raises(ConfigError, match="base_url"):
        parse({**MINIMAL, "base_url": base_url})


def test_localhost_may_use_http():
    assert parse({**MINIMAL, "base_url": "http://localhost:8788/"}).base_url == "http://localhost:8788"


def test_wrong_type_is_an_error():
    with pytest.raises(ConfigError, match="beep"):
        parse({**MINIMAL, "beep": "ja"})


def test_load_config_resolves_buffer_relative_to_config_file(tmp_path):
    path = tmp_path / "config.toml"
    path.write_text(
        'base_url = "https://fete.example.org"\nagent_id = "bar"\nsecret = "s"\n'
        'serial_port = "COM3"\nallowed_codes = ["1"]\nbuffer_path = "data/puffer.sqlite3"\n',
        encoding="utf-8",
    )

    config = load_config(path, environ={})

    assert config.serial_port == "COM3"
    assert config.buffer_path == tmp_path / "data" / "puffer.sqlite3"


def test_example_config_is_valid_toml_without_secret():
    example = Path(__file__).parent.parent / "config.example.toml"

    with pytest.raises(ConfigError, match=SECRET_ENV):
        load_config(example, environ={})
    assert load_config(example, environ={SECRET_ENV: "x"}).base_url.startswith("https://")


def test_missing_file_is_a_config_error(tmp_path):
    with pytest.raises(ConfigError, match="nicht gefunden"):
        load_config(tmp_path / "fehlt.toml", environ={})


@pytest.mark.parametrize("agent_id", ["", "bar pc", "x" * 41, "bär"])
def test_agent_id_must_be_accepted_by_server(agent_id):
    with pytest.raises(ConfigError, match="agent_id"):
        parse({**MINIMAL, "agent_id": agent_id})
