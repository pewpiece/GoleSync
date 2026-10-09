import asyncio

import pytest
from pydantic import ValidationError

from golesync_agent.input import (
    ButtonEvent,
    ClickEvent,
    InputDispatcher,
    InputUnavailable,
    KeyEvent,
    MediaEvent,
    MoveEvent,
    NullBackend,
    ScrollEvent,
    TextEvent,
    apply_event,
    parse_event,
    wayland_warning,
)

from .conftest import RecordingBackend


@pytest.mark.parametrize(
    "data,expected",
    [
        ({"type": "key", "key": "right"}, ("key", "right")),
        ({"type": "key", "key": "pageup"}, ("key", "pageup")),
        ({"type": "key", "key": "f5"}, ("key", "f5")),
        ({"type": "key", "key": "escape"}, ("key", "escape")),
        ({"type": "media", "action": "play_pause"}, ("media", "play_pause")),
        ({"type": "media", "action": "volume_up"}, ("media", "volume_up")),
        ({"type": "mouse_move", "dx": 5, "dy": -3}, ("move", 5, -3)),
        ({"type": "mouse_click", "button": "right"}, ("click", "right", 1)),
        ({"type": "mouse_click"}, ("click", "left", 1)),
        ({"type": "mouse_click", "count": 2}, ("click", "left", 2)),
        ({"type": "mouse_down", "button": "left"}, ("button", "left", True)),
        ({"type": "mouse_up", "button": "left"}, ("button", "left", False)),
        ({"type": "scroll", "dy": 3}, ("scroll", 0, 3)),
        ({"type": "text", "text": "héllo"}, ("type", "héllo")),
    ],
)
def test_event_to_action_mapping(data, expected):
    backend = RecordingBackend()
    apply_event(parse_event(data), backend)
    assert backend.calls == [expected]


@pytest.mark.parametrize(
    "data",
    [
        {"type": "key", "key": "ctrl+alt+delete"},
        {"type": "key", "key": "super"},
        {"type": "key"},
        {"type": "media", "action": "shutdown"},
        {"type": "mouse_move", "dx": 10**9, "dy": 0},
        {"type": "mouse_move", "dx": "a", "dy": 0},
        {"type": "mouse_click", "button": "back"},
        {"type": "mouse_click", "count": 50},
        {"type": "scroll", "dy": 10_000},
        {"type": "text", "text": "x" * 501},
        {"type": "text", "text": "ok", "extra": 1},
        {"type": "exec", "cmd": "rm -rf /"},
        {},
    ],
)
def test_invalid_events_rejected(data):
    with pytest.raises(ValidationError):
        parse_event(data)


def test_models_are_distinct_types():
    assert isinstance(parse_event({"type": "key", "key": "tab"}), KeyEvent)
    assert isinstance(parse_event({"type": "media", "action": "mute"}), MediaEvent)
    assert isinstance(parse_event({"type": "mouse_move", "dx": 1, "dy": 1}), MoveEvent)
    assert isinstance(parse_event({"type": "mouse_click"}), ClickEvent)
    assert isinstance(parse_event({"type": "mouse_down"}), ButtonEvent)
    assert isinstance(parse_event({"type": "scroll", "dx": 1}), ScrollEvent)
    assert isinstance(parse_event({"type": "text", "text": "a"}), TextEvent)


def test_null_backend_raises():
    with pytest.raises(InputUnavailable):
        NullBackend("no X").key("right")


def test_wayland_warning(monkeypatch):
    monkeypatch.setenv("XDG_SESSION_TYPE", "wayland")
    assert "X11" in wayland_warning()
    monkeypatch.setenv("XDG_SESSION_TYPE", "x11")
    monkeypatch.delenv("WAYLAND_DISPLAY", raising=False)
    assert wayland_warning() is None


async def test_dispatcher_coalesces_stale_moves_and_keeps_order():
    backend = RecordingBackend()
    d = InputDispatcher(backend)
    # Submit everything before the worker gets to run: a worst-case burst.
    for _ in range(100):
        d.submit(MoveEvent(type="mouse_move", dx=1, dy=2))
    d.submit(ClickEvent(type="mouse_click", button="left", count=1))
    for _ in range(50):
        d.submit(MoveEvent(type="mouse_move", dx=1, dy=0))
    d.start()
    await asyncio.sleep(0.2)
    await d.stop()
    assert backend.calls == [("move", 100, 200), ("click", "left", 1), ("move", 50, 0)]
    assert d.dropped_moves == 148


async def test_dispatcher_survives_backend_errors():
    errors = []

    class Boom(RecordingBackend):
        def key(self, key):
            raise InputUnavailable("nope")

    b = Boom()
    d = InputDispatcher(b, on_error=errors.append)
    d.start()
    d.submit(KeyEvent(type="key", key="right"))
    d.submit(TextEvent(type="text", text="after"))
    await asyncio.sleep(0.1)
    await d.stop()
    assert len(errors) == 1 and b.calls == [("type", "after")]


# --- over the WebSocket ---------------------------------------------------------------


def _connect(client, token):
    ws = client.websocket_connect("/v1/ws")
    sock = ws.__enter__()
    sock.send_json({"type": "auth", "token": token})
    assert sock.receive_json()["type"] == "ready"
    return ws, sock


def _wait_for(backend, n, timeout=2.0):
    import time

    end = time.time() + timeout
    while len(backend.calls) < n and time.time() < end:
        time.sleep(0.01)


def test_ws_events_drive_backend(client, token, parts):
    ws, sock = _connect(client, token)
    try:
        sock.send_json({"type": "key", "key": "right"})
        sock.send_json({"type": "media", "action": "mute"})
        sock.send_json({"type": "text", "text": "abc"})
        _wait_for(parts["backend"], 3)
    finally:
        ws.__exit__(None, None, None)
    assert parts["backend"].calls == [("key", "right"), ("media", "mute"), ("type", "abc")]


def test_ws_bad_event_reports_error_and_keeps_going(client, token, parts):
    ws, sock = _connect(client, token)
    try:
        sock.send_json({"type": "key", "key": "ctrl+q"})
        assert sock.receive_json()["code"] == "bad_event"
        sock.send_json({"type": "run", "cmd": "rm -rf /"})
        assert sock.receive_json()["code"] == "bad_event"
        sock.send_text("not json")
        assert sock.receive_json()["code"] == "bad_event"
        sock.send_json({"type": "key", "key": "left"})
        _wait_for(parts["backend"], 1)
    finally:
        ws.__exit__(None, None, None)
    assert parts["backend"].calls == [("key", "left")]


def test_ws_ping_pong(client, token):
    ws, sock = _connect(client, token)
    try:
        sock.send_json({"type": "ping"})
        assert sock.receive_json() == {"type": "pong"}
    finally:
        ws.__exit__(None, None, None)


def test_pause_blocks_events_and_notifies(client, local, token, parts):
    ws, sock = _connect(client, token)
    try:
        assert local.post("/local/pause").json() == {"paused": True}
        assert sock.receive_json()["type"] == "paused"
        sock.send_json({"type": "key", "key": "right"})
        assert sock.receive_json()["type"] == "paused"
        assert parts["backend"].calls == []
        assert any(t == "GoleSync paused" for t, _ in parts["notifier"].events)
        local.post("/local/resume")
        assert sock.receive_json()["type"] == "resumed"
        sock.send_json({"type": "key", "key": "left"})
        _wait_for(parts["backend"], 1)
    finally:
        ws.__exit__(None, None, None)
    assert parts["backend"].calls == [("key", "left")]


def test_connect_disconnect_notifications(client, token, parts):
    ws, sock = _connect(client, token)
    ws.__exit__(None, None, None)
    titles = [t for t, _ in parts["notifier"].events]
    assert "Phone connected" in titles and "Phone disconnected" in titles
