"""WebSocket: remote-control events in, live inbox/pause events out."""

from __future__ import annotations

import asyncio
import json
import logging
import time

from fastapi import WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from . import PROTOCOL_VERSION
from .input import CONTROL_TYPES, InputDispatcher, parse_event
from .security import RateLimiter, bearer, client_ip

log = logging.getLogger("golesync")
AUTH_TIMEOUT = 5.0
MAX_MESSAGE = 8192
MAX_BAD_MESSAGES = 25


class ConnectionManager:
    def __init__(self) -> None:
        self.clients: set[WebSocket] = set()

    async def broadcast(self, message: dict) -> None:
        for ws in list(self.clients):
            try:
                await ws.send_json(message)
            except Exception:  # noqa: BLE001 - dead socket; its own handler will clean up
                self.clients.discard(ws)

    async def close_all(self, code: int = 4401) -> None:
        for ws in list(self.clients):
            await _close(ws, code)
        self.clients.clear()


async def _close(ws: WebSocket, code: int) -> None:
    try:
        await ws.close(code=code)
    except Exception:  # noqa: BLE001 - already closed
        pass


async def _authenticate(ws: WebSocket, state) -> bool:
    if state.tokens.verify(bearer(ws)):
        return True
    try:
        raw = await asyncio.wait_for(ws.receive_text(), timeout=AUTH_TIMEOUT)
        msg = json.loads(raw) if len(raw) < 512 else {}
    except (TimeoutError, ValueError, WebSocketDisconnect, RuntimeError):
        return False
    return isinstance(msg, dict) and msg.get("type") == "auth" and state.tokens.verify(
        msg.get("token") if isinstance(msg.get("token"), str) else None
    )


async def websocket_endpoint(ws: WebSocket) -> None:
    state = ws.app.state.gs
    ip = client_ip(ws)
    await ws.accept()
    if state.failures.blocked(ip):
        await _close(ws, 4429)
        return
    if not await _authenticate(ws, state):
        state.failures.record(ip)
        await _close(ws, 4401)
        return

    generation = state.tokens.generation
    state.manager.clients.add(ws)
    state.notifier.notify("Phone connected", ip)
    last_report = [0.0]

    def on_error(exc: Exception) -> None:
        now = time.monotonic()
        if now - last_report[0] > 5:  # one error notice per 5 s, not one per mouse move
            last_report[0] = now
            _report(ws, exc)

    dispatcher = InputDispatcher(state.backend, on_error=on_error)
    dispatcher.start()
    limiter = RateLimiter(limit=300, window=1.0)  # messages per second per connection
    bad = 0
    try:
        await ws.send_json(
            {"type": "ready", "v": PROTOCOL_VERSION, "paused": state.paused, "backend": state.backend.name}
        )
        while True:
            raw = await ws.receive_text()
            if state.tokens.generation != generation:
                await _close(ws, 4401)
                return
            if len(raw) > MAX_MESSAGE:
                await _close(ws, 1009)
                return
            if not limiter.allow("c"):
                continue  # flood: drop silently
            try:
                data = json.loads(raw)
                if not isinstance(data, dict):
                    raise ValueError("not an object")
                kind = data.get("type")
                if kind == "ping":
                    await ws.send_json({"type": "pong"})
                    continue
                if kind not in CONTROL_TYPES:
                    raise ValueError(f"unknown type {kind!r}")
                if state.paused:
                    if kind != "mouse_move":
                        await ws.send_json({"type": "paused"})
                    continue
                dispatcher.submit(parse_event(data))
            except (ValueError, ValidationError) as e:
                bad += 1
                await ws.send_json({"type": "error", "code": "bad_event", "message": str(e)[:200]})
                if bad >= MAX_BAD_MESSAGES:
                    await _close(ws, 1008)
                    return
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        state.manager.clients.discard(ws)
        await dispatcher.stop()
        state.notifier.notify("Phone disconnected", ip)


def _report(ws: WebSocket, exc: Exception) -> None:
    log.warning("input error: %s", exc)
    asyncio.get_running_loop().create_task(
        _safe_send(ws, {"type": "error", "code": "input_failed", "message": str(exc)[:200]})
    )


async def _safe_send(ws: WebSocket, msg: dict) -> None:
    try:
        await ws.send_json(msg)
    except Exception:  # noqa: BLE001
        pass
