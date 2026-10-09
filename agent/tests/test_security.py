import pytest
from starlette.testclient import TestClient, WebSocketDisconnect

from golesync_agent.api import create_app
from golesync_agent.security import FailureTracker, RateLimiter, TokenStore

PROTECTED = [
    ("GET", "/v1/pair/check"),
    ("GET", "/v1/status"),
    ("POST", "/v1/text"),
    ("POST", "/v1/files?name=a.txt"),
    ("GET", "/v1/inbox"),
    ("GET", "/v1/history"),
    ("GET", "/v1/inbox/" + "a" * 32 + "/file"),
    ("GET", "/v1/commands"),
    ("POST", "/v1/commands/x/run"),
]


def test_health_is_open_and_minimal(client):
    r = client.get("/health")
    assert r.status_code == 200 and r.json() == {"status": "ok"}


@pytest.mark.parametrize("method,path", PROTECTED)
def test_rejected_without_token(client, method, path):
    assert client.request(method, path).status_code == 401


@pytest.mark.parametrize("method,path", PROTECTED)
def test_rejected_with_wrong_token(client, method, path):
    r = client.request(method, path, headers={"Authorization": "Bearer nope"})
    assert r.status_code == 401


def test_token_in_query_string_is_not_accepted(client, token):
    assert client.get(f"/v1/status?token={token}").status_code == 401


def test_valid_token_accepted(client, auth):
    assert client.get("/v1/pair/check", headers=auth).json()["ok"] is True


def test_status_reports_state(client, auth):
    d = client.get("/v1/status", headers=auth).json()
    assert d["paused"] is False and d["input_backend"] == "recording"


def test_brute_force_gets_blocked(client, auth):
    for _ in range(10):
        assert client.get("/v1/status", headers={"Authorization": "Bearer bad"}).status_code == 401
    # now even the right token from that address is locked out for a while
    assert client.get("/v1/status", headers=auth).status_code == 429


def test_openapi_and_docs_not_exposed(client):
    for p in ("/docs", "/redoc", "/openapi.json"):
        assert client.get(p).status_code == 404


def test_websocket_rejects_without_token(client):
    with client.websocket_connect("/v1/ws") as ws:
        ws.send_json({"type": "key", "key": "right"})
        with pytest.raises(WebSocketDisconnect) as e:
            ws.receive_json()
        assert e.value.code == 4401


def test_websocket_rejects_wrong_token(client):
    with client.websocket_connect("/v1/ws") as ws:
        ws.send_json({"type": "auth", "token": "wrong"})
        with pytest.raises(WebSocketDisconnect) as e:
            ws.receive_json()
        assert e.value.code == 4401


def test_websocket_accepts_token_first_message(client, token):
    with client.websocket_connect("/v1/ws") as ws:
        ws.send_json({"type": "auth", "token": token})
        assert ws.receive_json()["type"] == "ready"


def test_websocket_accepts_bearer_header(client, auth):
    with client.websocket_connect("/v1/ws", headers=auth) as ws:
        assert ws.receive_json()["type"] == "ready"


def test_rotate_token_invalidates_old_token(client, local, auth, token):
    assert client.get("/v1/status", headers=auth).status_code == 200
    assert local.post("/local/rotate-token").status_code == 200
    assert client.get("/v1/status", headers=auth).status_code == 401


def test_rotate_token_disconnects_live_socket(client, local, token):
    with client.websocket_connect("/v1/ws") as ws:
        ws.send_json({"type": "auth", "token": token})
        assert ws.receive_json()["type"] == "ready"
        local.post("/local/rotate-token")
        with pytest.raises(WebSocketDisconnect):
            ws.receive_json()


def test_token_store_is_private_and_constant_time(tmp_path):
    store = TokenStore(tmp_path / "token")
    assert oct((tmp_path / "token").stat().st_mode & 0o777) == "0o600"
    assert store.verify(store.token()) and not store.verify("x") and not store.verify(None)
    assert not store.verify("")


def test_token_compare_uses_hmac(monkeypatch, tmp_path):
    import hmac

    calls = []
    real = hmac.compare_digest
    monkeypatch.setattr(hmac, "compare_digest", lambda a, b: calls.append(1) or real(a, b))
    store = TokenStore(tmp_path / "t")
    store.verify("abc")
    assert calls


def test_rate_limiter_window():
    rl = RateLimiter(3, window=10)
    assert [rl.allow("a", now=t) for t in (0, 1, 2, 3)] == [True, True, True, False]
    assert rl.allow("a", now=11.5)  # window moved on
    assert rl.allow("b", now=3)  # other keys independent


def test_failure_tracker():
    ft = FailureTracker(max_failures=2, window=10)
    ft.record("ip", now=0)
    assert not ft.blocked("ip", now=1)
    ft.record("ip", now=1)
    assert ft.blocked("ip", now=2) and not ft.blocked("ip", now=12)


def test_http_rate_limit(settings, parts, auth):
    app = create_app(settings.model_copy(update={"rate_limit_per_min": 10}), **parts)
    token = app.state.gs.tokens.token()
    with TestClient(app, client=("192.168.1.9", 1)) as c:
        codes = [c.get("/health").status_code for _ in range(15)]
    assert codes[:10] == [200] * 10 and set(codes[10:]) == {429}
    assert token


def test_json_body_limit(client, auth):
    big = "x" * (300 * 1024)
    r = client.post("/v1/text", headers=auth, json={"text": big})
    assert r.status_code == 413


def test_text_over_max_rejected(client, auth):
    r = client.post("/v1/text", headers=auth, json={"text": "x" * 100_001})
    assert r.status_code == 422


def test_unknown_fields_rejected(client, auth):
    r = client.post("/v1/text", headers=auth, json={"text": "hi", "extra": 1})
    assert r.status_code == 422


# --- local-only endpoints -------------------------------------------------------------


@pytest.mark.parametrize("path", ["/local/", "/local/state", "/local/pair.svg"])
def test_local_get_refuses_lan_clients(client, auth, path):
    assert client.get(path, headers=auth).status_code == 403


def test_local_post_refuses_lan_clients_even_with_header(client, auth):
    h = {**auth, "X-GoleSync-Local": "1"}
    assert client.post("/local/pause", headers=h).status_code == 403
    assert client.post("/local/send", headers=h, json={"text": "x"}).status_code == 403


def test_local_post_needs_custom_header(app):
    with TestClient(app, base_url="http://127.0.0.1:8765", client=("127.0.0.1", 1)) as c:
        assert c.post("/local/pause").status_code == 403  # simulates a cross-site form post
        assert app.state.gs.paused is False


def test_local_rejects_rebinding_host(app):
    with TestClient(app, base_url="http://evil.example:8765", client=("127.0.0.1", 1)) as c:
        c.headers["X-GoleSync-Local"] = "1"
        assert c.get("/local/state").status_code == 403
        assert c.post("/local/pause").status_code == 403


def test_local_page_and_qr(local):
    page = local.get("/local/")
    assert page.status_code == 200 and "GoleSync" in page.text
    svg = local.get("/local/pair.svg")
    assert svg.status_code == 200 and svg.text.lstrip().startswith("<?xml") or "<svg" in svg.text
