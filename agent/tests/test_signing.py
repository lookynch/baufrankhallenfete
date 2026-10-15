import hashlib

from fakes import SECRET, FakeTransport, respond

from fete_agent.api import ApiClient, encode_json, sign

PAYLOAD = {
    "event_id": "0b7c5d1e-3f2a-4c6b-9d8e-1a2b3c4d5e6f",
    "pressed_at": 1760000000000,
    "source_code": "5592405",
    "agent_id": "bar-pc-1",
}
EXPECTED_BODY = (
    b'{"event_id":"0b7c5d1e-3f2a-4c6b-9d8e-1a2b3c4d5e6f","pressed_at":1760000000000,'
    b'"source_code":"5592405","agent_id":"bar-pc-1"}'
)
EXPECTED_SIGNATURE = "bdaae81d053937c13d03bbb4ac2d27b97ff05396116ed687292542dbd4e575a2"


def test_body_is_compact_utf8_json():
    assert encode_json(PAYLOAD) == EXPECTED_BODY


def test_signature_matches_fixed_vector():
    assert hashlib.sha256(EXPECTED_BODY).hexdigest() == (
        "213981aacb6e78a1eb4eb52094dbd38b4549c9c5abdb465b02ed2c1dd3203fe0"
    )
    signature = sign("test-secret-123", "POST", "/api/buzzer/press", "1760000000123", EXPECTED_BODY)
    assert signature == EXPECTED_SIGNATURE


def test_utf8_secret_is_encoded_as_utf8():
    signature = sign("geheim-ä", "POST", "/api/buzzer/press", "1760000000123", EXPECTED_BODY)
    assert signature == "5769c316fb6c035e85cbca15d57fccbe8616aa0ab44cff15aa27b8ba2c69d26d"


def test_client_sends_signed_headers_over_exact_body(clock, server_clock):
    clock.wall = 1760000000.123
    transport = FakeTransport(respond(200, status="accepted"))
    api = ApiClient("https://fete.example.org/", "bar-pc-1", SECRET, server_clock, transport, 8)

    api.post("/api/buzzer/press", PAYLOAD)

    request = transport.requests[0]
    assert request.url == "https://fete.example.org/api/buzzer/press"
    assert request.body == EXPECTED_BODY
    assert request.headers["X-Fete-Agent"] == "bar-pc-1"
    assert request.headers["X-Fete-Timestamp"] == "1760000000123"
    assert request.headers["X-Fete-Signature"] == EXPECTED_SIGNATURE
    assert request.headers["Content-Type"] == "application/json"


def test_timestamp_header_includes_server_offset(clock, server_clock):
    clock.wall = 1760000000.123
    server_clock.offset_ms = 5000
    transport = FakeTransport(respond(200, status="accepted"))
    api = ApiClient("https://fete.example.org", "bar-pc-1", SECRET, server_clock, transport, 8)

    api.post("/api/buzzer/press", PAYLOAD)

    headers = transport.requests[0].headers
    assert headers["X-Fete-Timestamp"] == "1760000005123"
    assert headers["X-Fete-Signature"] == sign(
        SECRET, "POST", "/api/buzzer/press", "1760000005123", EXPECTED_BODY
    )
