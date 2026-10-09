"""FastAPI application factory and the /v1 REST API."""

from __future__ import annotations

import logging
import os
import socket
from dataclasses import dataclass, field

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from . import PROTOCOL_VERSION, __version__
from .clipboard import Clipboard
from .commands import CommandError, load_commands, run_command
from .config import Settings
from .files import reserve_file
from .history import History, Item
from .input import InputBackend, NullBackend, create_backend, is_wayland
from .notify import Notifier
from .security import (
    BodyLimitMiddleware,
    FailureTracker,
    RateLimiter,
    RateLimitMiddleware,
    TokenStore,
    bearer,
    client_ip,
)
from .ws import ConnectionManager, websocket_endpoint

log = logging.getLogger("golesync")
MAX_TEXT = 100_000
ID_PATTERN = r"^[0-9a-f]{32}$"


@dataclass
class AppState:
    settings: Settings
    tokens: TokenStore
    history: History
    notifier: Notifier
    clipboard: Clipboard
    backend: InputBackend
    manager: ConnectionManager = field(default_factory=ConnectionManager)
    failures: FailureTracker = field(default_factory=FailureTracker)
    paused: bool = False

    async def set_paused(self, paused: bool) -> None:
        if paused == self.paused:
            return
        self.paused = paused
        self.notifier.notify("GoleSync paused" if paused else "GoleSync resumed",
                             "Remote control and commands are " + ("OFF" if paused else "ON"))
        await self.manager.broadcast({"type": "paused" if paused else "resumed"})

    async def add_to_phone(self, item: Item) -> None:
        await self.manager.broadcast({"type": "inbox", "item": item.public()})


async def require_auth(request: Request) -> None:
    state: AppState = request.app.state.gs
    ip = client_ip(request)
    if state.failures.blocked(ip):
        raise HTTPException(429, "too many failed attempts")
    if not state.tokens.verify(bearer(request)):
        state.failures.record(ip)
        raise HTTPException(401, "invalid or missing token")


class TextIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str = Field(min_length=1, max_length=MAX_TEXT)
    clipboard: bool = True


class RunIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    confirmed: bool = False


def _state(request: Request) -> AppState:
    return request.app.state.gs


async def save_stream(request: Request, directory, name: str | None, max_bytes: int):
    """Stream the request body into a freshly reserved file. Returns (path, size)."""
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > max_bytes:
        raise HTTPException(413, f"file exceeds the {max_bytes // (1024 * 1024)} MB limit")
    path, fd = reserve_file(directory, name)
    size = 0
    try:
        with os.fdopen(fd, "wb") as f:
            async for chunk in request.stream():
                size += len(chunk)
                if size > max_bytes:
                    raise HTTPException(
                        413, f"file exceeds the {max_bytes // (1024 * 1024)} MB limit"
                    )
                f.write(chunk)
    except BaseException:
        path.unlink(missing_ok=True)
        raise
    return path, size


def build_router() -> APIRouter:
    r = APIRouter(prefix="/v1", dependencies=[Depends(require_auth)])

    @r.get("/pair/check")
    async def pair_check(request: Request):
        return {"ok": True, "name": socket.gethostname(), "protocol": PROTOCOL_VERSION}

    @r.get("/status")
    async def status(request: Request):
        s = _state(request)
        return {
            "version": __version__,
            "protocol": PROTOCOL_VERSION,
            "name": socket.gethostname(),
            "paused": s.paused,
            "wayland": is_wayland(),
            "input_backend": s.backend.name,
            "input_ok": not isinstance(s.backend, NullBackend),
            "clients": len(s.manager.clients),
            "max_file_bytes": s.settings.max_file_bytes,
        }

    @r.post("/text")
    async def send_text(body: TextIn, request: Request):
        s = _state(request)
        copied = s.clipboard.copy(body.text) if body.clipboard else False
        item = s.history.add("to_laptop", "text", text=body.text)
        preview = body.text[:120].replace("\n", " ")
        s.notifier.notify("From phone" + (" (copied)" if copied else ""), preview)
        return {"item": item.public(), "copied": copied}

    @r.post("/files")
    async def upload_file(request: Request, name: str = Query("file", max_length=300)):
        s = _state(request)
        path, size = await save_stream(request, s.settings.inbox_path, name, s.settings.max_file_bytes)
        item = s.history.add("to_laptop", "file", filename=path.name, size=size, stored=str(path))
        s.notifier.notify("File from phone", f"{path.name} saved to {path.parent}")
        return {"item": item.public()}

    @r.get("/inbox")
    async def inbox(request: Request, after: int = Query(0, ge=0), limit: int = Query(200, ge=1, le=500)):
        return {"items": [i.public() for i in _state(request).history.list("to_phone", after, limit)]}

    @r.get("/history")
    async def history(request: Request, limit: int = Query(200, ge=1, le=500)):
        return {"items": [i.public() for i in _state(request).history.list(None, 0, limit)]}

    @r.get("/inbox/{item_id}/file")
    async def download(request: Request, item_id: str):
        import re

        if not re.fullmatch(ID_PATTERN, item_id):
            raise HTTPException(404, "not found")
        s = _state(request)
        item = s.history.get(item_id)
        if not item or item.direction != "to_phone" or item.kind != "file" or not item.stored:
            raise HTTPException(404, "not found")
        path = s.settings.outbox_path / item.stored  # `stored` is a name we generated
        if not path.is_file():
            raise HTTPException(404, "file no longer available")
        return FileResponse(path, filename=item.filename, media_type="application/octet-stream")

    @r.get("/commands")
    async def list_commands(request: Request):
        cmds = load_commands(_state(request).settings.commands_path)
        return {
            "commands": [
                {"id": c.id, "label": c.label, "confirm": c.confirm} for c in cmds if c.enabled
            ]
        }

    @r.post("/commands/{cmd_id}/run")
    async def run(request: Request, cmd_id: str, body: RunIn | None = None):
        s = _state(request)
        if s.paused:
            raise HTTPException(423, "agent is paused")
        cmds = load_commands(s.settings.commands_path)
        try:
            result = await run_command(cmds, cmd_id, bool(body and body.confirmed))
        except CommandError as e:
            return JSONResponse({"detail": e.message, "code": e.code}, status_code=e.status)
        log.info("ran command %s -> %s", cmd_id, result.exit_code)
        return result

    return r


def create_app(
    settings: Settings,
    *,
    backend: InputBackend | None = None,
    notifier: Notifier | None = None,
    clipboard: Clipboard | None = None,
) -> FastAPI:
    from .local import build_local_router

    app = FastAPI(title="GoleSync agent", version=__version__, docs_url=None, redoc_url=None, openapi_url=None)
    settings.inbox_path.mkdir(parents=True, exist_ok=True)
    settings.outbox_path.mkdir(parents=True, exist_ok=True)
    app.state.gs = AppState(
        settings=settings,
        tokens=TokenStore(settings.token_path),
        history=History(settings.history_path, settings.outbox_path),
        notifier=notifier or Notifier(settings.notifications),
        clipboard=clipboard or Clipboard(),
        backend=backend if backend is not None else create_backend(),
    )

    @app.get("/health")
    async def health():
        return {"status": "ok"}  # deliberately minimal and unauthenticated

    app.include_router(build_router())
    app.include_router(build_local_router())
    app.add_api_websocket_route("/v1/ws", websocket_endpoint)

    big = settings.max_file_bytes + 1024 * 1024
    app.add_middleware(
        BodyLimitMiddleware,
        small=256 * 1024,
        big=big,
        big_paths=("/v1/files", "/local/send-file"),
    )
    app.add_middleware(RateLimitMiddleware, limiter=RateLimiter(settings.rate_limit_per_min))
    return app
