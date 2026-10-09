"""Loopback-only endpoints: the laptop-side web page, CLI helpers and the kill switch.

Everything here requires: peer address is loopback, Host header is loopback, and (for
state-changing calls) the `X-GoleSync-Local: 1` header. No token is needed or accepted.
"""

from __future__ import annotations

import io

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import HTMLResponse, Response
from pydantic import BaseModel, ConfigDict, Field

from .api import MAX_TEXT, AppState, _state, save_stream
from .config import advertised_host
from .files import sanitize_filename
from .security import require_local
from .webpage import PAGE


def _get(request: Request) -> None:
    require_local(request, mutating=False)


def _post(request: Request) -> None:
    require_local(request, mutating=True)


def pairing_uri(state: AppState, port: int) -> str:
    host = advertised_host(state.settings)
    return f"golesync://pair?host={host}&port={port}&token={state.tokens.token()}"


def qr_svg(data: str) -> str:
    import qrcode
    import qrcode.image.svg

    img = qrcode.make(data, image_factory=qrcode.image.svg.SvgPathImage, box_size=10, border=2)
    buf = io.BytesIO()
    img.save(buf)
    return buf.getvalue().decode()


class LocalText(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str = Field(min_length=1, max_length=MAX_TEXT)


def build_local_router() -> APIRouter:
    r = APIRouter(prefix="/local")

    @r.get("/", response_class=HTMLResponse, dependencies=[Depends(_get)])
    async def page(request: Request):
        return HTMLResponse(PAGE, headers={"Cache-Control": "no-store", "Content-Security-Policy": "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' data:"})

    @r.get("/pair.svg", dependencies=[Depends(_get)])
    async def pair_svg(request: Request):
        port = request.url.port or request.app.state.gs.settings.port
        return Response(qr_svg(pairing_uri(_state(request), port)), media_type="image/svg+xml",
                        headers={"Cache-Control": "no-store"})

    @r.get("/state", dependencies=[Depends(_get)])
    async def state(request: Request):
        s = _state(request)
        return {
            "paused": s.paused,
            "clients": len(s.manager.clients),
            "history": [i.public() for i in s.history.list(None, 0, 50)][::-1],
            "inbox_dir": str(s.settings.inbox_path),
        }

    @r.post("/pause", dependencies=[Depends(_post)])
    async def pause(request: Request):
        await _state(request).set_paused(True)
        return {"paused": True}

    @r.post("/resume", dependencies=[Depends(_post)])
    async def resume(request: Request):
        await _state(request).set_paused(False)
        return {"paused": False}

    @r.post("/send", dependencies=[Depends(_post)])
    async def send(body: LocalText, request: Request):
        s = _state(request)
        item = s.history.add("to_phone", "text", text=body.text)
        await s.add_to_phone(item)
        return {"item": item.public(), "live_clients": len(s.manager.clients)}

    @r.post("/send-file", dependencies=[Depends(_post)])
    async def send_file(request: Request, name: str = Query("file", max_length=300)):
        s = _state(request)
        # Stored under a generated id so the download route never touches a client-chosen path.
        import uuid

        item_id = uuid.uuid4().hex
        stored = f"{item_id}_{sanitize_filename(name)}"
        path, size = await save_stream(request, s.settings.outbox_path, stored, s.settings.max_file_bytes)
        item = s.history.add(
            "to_phone", "file", filename=sanitize_filename(name), size=size, stored=path.name,
            item_id=item_id,
        )
        await s.add_to_phone(item)
        return {"item": item.public(), "live_clients": len(s.manager.clients)}

    @r.post("/rotate-token", dependencies=[Depends(_post)])
    async def rotate(request: Request):
        s = _state(request)
        s.tokens.rotate()
        s.tokens.token()
        await s.manager.close_all()
        return {"rotated": True}

    return r


__all__ = ["build_local_router", "pairing_uri", "qr_svg"]
