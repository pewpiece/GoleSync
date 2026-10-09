"""Token auth, rate limiting, body limits and local-only checks."""

from __future__ import annotations

import hmac
import os
import secrets
import time
from collections import deque
from pathlib import Path

from starlette.exceptions import HTTPException
from starlette.requests import HTTPConnection
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

LOOPBACK = {"127.0.0.1", "::1", "::ffff:127.0.0.1"}
LOCAL_HOSTS = {"127.0.0.1", "localhost", "[::1]"}
LOCAL_HEADER = "x-golesync-local"


class TokenStore:
    """Token kept in a 0600 file. Re-read when the file changes (rotate-token)."""

    def __init__(self, path: Path):
        self.path = path
        self._token = ""
        self._mtime = -1
        self.generation = 0
        self.token()

    def _write(self, token: str) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as f:
            f.write(token)
        os.replace(tmp, self.path)

    def token(self) -> str:
        if not self.path.exists():
            self._write(secrets.token_urlsafe(32))
        mtime = self.path.stat().st_mtime_ns
        if mtime != self._mtime:
            value = self.path.read_text().strip()
            if value != self._token:
                if self._token:
                    self.generation += 1
                self._token = value
            self._mtime = mtime
        return self._token

    def verify(self, candidate: str | None) -> bool:
        if not candidate:
            return False
        return hmac.compare_digest(candidate.encode(), self.token().encode())

    def rotate(self) -> str:
        new = secrets.token_urlsafe(32)
        self._write(new)
        return self.token()


class RateLimiter:
    """Sliding window, per key."""

    def __init__(self, limit: int, window: float = 60.0):
        self.limit, self.window = limit, window
        self._hits: dict[str, deque[float]] = {}

    def allow(self, key: str, now: float | None = None) -> bool:
        now = time.monotonic() if now is None else now
        q = self._hits.setdefault(key, deque())
        while q and now - q[0] > self.window:
            q.popleft()
        if len(q) >= self.limit:
            return False
        q.append(now)
        if len(self._hits) > 2048:
            self._hits = {k: v for k, v in self._hits.items() if v and now - v[-1] <= self.window}
        return True


class FailureTracker:
    """Blocks an address after too many failed authentications."""

    def __init__(self, max_failures: int = 10, window: float = 60.0):
        self.max, self.window = max_failures, window
        self._fails: dict[str, deque[float]] = {}

    def _prune(self, ip: str, now: float) -> deque[float]:
        q = self._fails.setdefault(ip, deque())
        while q and now - q[0] > self.window:
            q.popleft()
        return q

    def blocked(self, ip: str, now: float | None = None) -> bool:
        return len(self._prune(ip, time.monotonic() if now is None else now)) >= self.max

    def record(self, ip: str, now: float | None = None) -> None:
        now = time.monotonic() if now is None else now
        self._prune(ip, now).append(now)


def client_ip(conn: HTTPConnection) -> str:
    return conn.client.host if conn.client else "unknown"


def is_loopback(conn: HTTPConnection) -> bool:
    return client_ip(conn) in LOOPBACK


def bearer(conn: HTTPConnection) -> str | None:
    h = conn.headers.get("authorization", "")
    if h[:7].lower() == "bearer ":
        return h[7:].strip()
    return None


def _host_only(value: str) -> str:
    if value.startswith("["):
        return value.split("]")[0] + "]"
    return value.split(":")[0]


def require_local(conn: HTTPConnection, *, mutating: bool) -> None:
    """Local-only endpoints: loopback peer + loopback Host (anti DNS-rebinding), and for
    state-changing requests a custom header, which a cross-site browser request cannot send
    without a CORS preflight (which we never grant)."""
    if not is_loopback(conn):
        raise HTTPException(403, "local only")
    host = _host_only(conn.headers.get("host", ""))
    if host.lower() not in LOCAL_HOSTS:
        raise HTTPException(403, "bad host")
    if mutating and conn.headers.get(LOCAL_HEADER) != "1":
        raise HTTPException(403, "missing local header")


class RateLimitMiddleware:
    def __init__(self, app: ASGIApp, limiter: RateLimiter):
        self.app, self.limiter = app, limiter

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http":
            ip = scope["client"][0] if scope.get("client") else "unknown"
            if ip not in LOOPBACK and not self.limiter.allow(ip):
                resp = JSONResponse({"detail": "rate limited"}, status_code=429)
                await resp(scope, receive, send)
                return
        await self.app(scope, receive, send)


class BodyLimitMiddleware:
    """Caps request bodies: small for JSON endpoints, larger for the streaming file endpoints."""

    def __init__(self, app: ASGIApp, small: int, big: int, big_paths: tuple[str, ...]):
        self.app, self.small, self.big, self.big_paths = app, small, big, big_paths

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        path = scope["path"]
        limit = self.big if path in self.big_paths else self.small
        declared = dict(scope["headers"]).get(b"content-length")
        if declared and declared.isdigit() and int(declared) > limit:
            resp = JSONResponse({"detail": "payload too large"}, status_code=413)
            await resp(scope, receive, send)
            return
        seen = 0

        async def limited() -> dict:
            nonlocal seen
            msg = await receive()
            if msg["type"] == "http.request":
                seen += len(msg.get("body", b""))
                if seen > limit:
                    raise HTTPException(413, "payload too large")
            return msg

        await self.app(scope, limited, send)
