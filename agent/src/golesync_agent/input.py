"""Remote-control events: validation, mapping to actions, backends and the dispatcher."""

from __future__ import annotations

import asyncio
import logging
import os
import shutil
import subprocess
from typing import Annotated, Literal, Protocol

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter

log = logging.getLogger("golesync")

KeyName = Literal[
    "right", "left", "up", "down", "pagedown", "pageup", "home", "end",
    "enter", "backspace", "delete", "tab", "escape", "space", "f5",
]  # fmt: skip
MediaAction = Literal["play_pause", "next", "previous", "volume_up", "volume_down", "mute"]
Button = Literal["left", "right", "middle"]


class _Ev(BaseModel):
    model_config = ConfigDict(extra="forbid")


class KeyEvent(_Ev):
    type: Literal["key"]
    key: KeyName


class MediaEvent(_Ev):
    type: Literal["media"]
    action: MediaAction


class MoveEvent(_Ev):
    type: Literal["mouse_move"]
    dx: int = Field(ge=-4000, le=4000)
    dy: int = Field(ge=-4000, le=4000)


class ClickEvent(_Ev):
    type: Literal["mouse_click"]
    button: Button = "left"
    count: int = Field(1, ge=1, le=2)


class ButtonEvent(_Ev):
    type: Literal["mouse_down", "mouse_up"]
    button: Button = "left"


class ScrollEvent(_Ev):
    type: Literal["scroll"]
    dx: int = Field(0, ge=-200, le=200)
    dy: int = Field(0, ge=-200, le=200)


class TextEvent(_Ev):
    type: Literal["text"]
    text: str = Field(max_length=500)


ControlEvent = Annotated[
    KeyEvent | MediaEvent | MoveEvent | ClickEvent | ButtonEvent | ScrollEvent | TextEvent,
    Field(discriminator="type"),
]
_adapter: TypeAdapter[ControlEvent] = TypeAdapter(ControlEvent)
CONTROL_TYPES = {
    "key", "media", "mouse_move", "mouse_click", "mouse_down", "mouse_up", "scroll", "text",
}  # fmt: skip


def parse_event(data: dict) -> ControlEvent:
    return _adapter.validate_python(data)


class InputUnavailable(RuntimeError):
    pass


class InputBackend(Protocol):
    name: str

    def key(self, key: str) -> None: ...
    def media(self, action: str) -> None: ...
    def type_text(self, text: str) -> None: ...
    def move(self, dx: int, dy: int) -> None: ...
    def click(self, button: str, count: int) -> None: ...
    def button(self, button: str, down: bool) -> None: ...
    def scroll(self, dx: int, dy: int) -> None: ...


def apply_event(ev: ControlEvent, backend: InputBackend) -> None:
    """Map one validated event to backend calls. Pure mapping, no I/O of its own."""
    if isinstance(ev, KeyEvent):
        backend.key(ev.key)
    elif isinstance(ev, MediaEvent):
        backend.media(ev.action)
    elif isinstance(ev, MoveEvent):
        backend.move(ev.dx, ev.dy)
    elif isinstance(ev, ClickEvent):
        backend.click(ev.button, ev.count)
    elif isinstance(ev, ButtonEvent):
        backend.button(ev.button, ev.type == "mouse_down")
    elif isinstance(ev, ScrollEvent):
        backend.scroll(ev.dx, ev.dy)
    elif isinstance(ev, TextEvent):
        backend.type_text(ev.text)


# --- backends ---------------------------------------------------------------------------

XDO_KEYS = {
    "right": "Right", "left": "Left", "up": "Up", "down": "Down",
    "pagedown": "Next", "pageup": "Prior", "home": "Home", "end": "End",
    "enter": "Return", "backspace": "BackSpace", "delete": "Delete", "tab": "Tab",
    "escape": "Escape", "space": "space", "f5": "F5",
}  # fmt: skip
XDO_MEDIA = {
    "play_pause": "XF86AudioPlay", "next": "XF86AudioNext", "previous": "XF86AudioPrev",
    "volume_up": "XF86AudioRaiseVolume", "volume_down": "XF86AudioLowerVolume",
    "mute": "XF86AudioMute",
}  # fmt: skip
XDO_BUTTON = {"left": "1", "middle": "2", "right": "3"}


class XdotoolBackend:
    name = "xdotool"

    def __init__(self) -> None:
        if not shutil.which("xdotool"):
            raise InputUnavailable("xdotool not installed")

    def _run(self, *args: str) -> None:
        subprocess.run(["xdotool", *args], check=True, timeout=5, stdout=subprocess.DEVNULL)

    def key(self, key: str) -> None:
        self._run("key", "--", XDO_KEYS[key])

    def media(self, action: str) -> None:
        self._run("key", "--", XDO_MEDIA[action])

    def type_text(self, text: str) -> None:
        self._run("type", "--delay", "4", "--", text)

    def move(self, dx: int, dy: int) -> None:
        self._run("mousemove_relative", "--", str(dx), str(dy))

    def click(self, button: str, count: int) -> None:
        self._run("click", "--repeat", str(count), XDO_BUTTON[button])

    def button(self, button: str, down: bool) -> None:
        self._run("mousedown" if down else "mouseup", XDO_BUTTON[button])

    def scroll(self, dx: int, dy: int) -> None:
        # X11 wheel buttons: 4 up, 5 down, 6 left, 7 right
        if dy:
            self._run("click", "--repeat", str(abs(dy)), "4" if dy < 0 else "5")
        if dx:
            self._run("click", "--repeat", str(abs(dx)), "6" if dx < 0 else "7")


class PynputBackend:
    name = "pynput"

    def __init__(self) -> None:
        try:
            from pynput import keyboard, mouse  # import fails without an X display
        except Exception as e:  # noqa: BLE001 - pynput raises assorted errors headless
            raise InputUnavailable(f"pynput unavailable: {e}") from e
        self._K, self._B = keyboard.Key, mouse.Button
        self._kb, self._ms = keyboard.Controller(), mouse.Controller()
        self._xdo: XdotoolBackend | None
        try:
            self._xdo = XdotoolBackend()
        except InputUnavailable:
            self._xdo = None
        K = self._K
        self._keys = {
            "right": K.right, "left": K.left, "up": K.up, "down": K.down,
            "pagedown": K.page_down, "pageup": K.page_up, "home": K.home, "end": K.end,
            "enter": K.enter, "backspace": K.backspace, "delete": K.delete, "tab": K.tab,
            "escape": K.esc, "space": K.space, "f5": K.f5,
        }  # fmt: skip
        self._media = {
            "play_pause": K.media_play_pause, "next": K.media_next,
            "previous": K.media_previous, "volume_up": K.media_volume_up,
            "volume_down": K.media_volume_down, "mute": K.media_volume_mute,
        }  # fmt: skip
        self._buttons = {"left": self._B.left, "right": self._B.right, "middle": self._B.middle}

    def key(self, key: str) -> None:
        self._kb.tap(self._keys[key])

    def media(self, action: str) -> None:
        # pynput's media keysyms are not mapped on every X server; xdotool is the fallback.
        if self._xdo is not None:
            try:
                self._xdo.media(action)
                return
            except (OSError, subprocess.SubprocessError):
                log.debug("xdotool media failed, trying pynput")
        self._kb.tap(self._media[action])

    def type_text(self, text: str) -> None:
        self._kb.type(text)

    def move(self, dx: int, dy: int) -> None:
        self._ms.move(dx, dy)

    def click(self, button: str, count: int) -> None:
        self._ms.click(self._buttons[button], count)

    def button(self, button: str, down: bool) -> None:
        (self._ms.press if down else self._ms.release)(self._buttons[button])

    def scroll(self, dx: int, dy: int) -> None:
        # Phone sends "content direction" deltas: positive dy = scroll down.
        self._ms.scroll(dx, -dy)


class NullBackend:
    name = "none"

    def __init__(self, reason: str):
        self.reason = reason

    def _fail(self, *_: object) -> None:
        raise InputUnavailable(self.reason)

    key = media = type_text = move = click = button = scroll = _fail  # type: ignore[assignment]


def session_type() -> str:
    return os.environ.get("XDG_SESSION_TYPE", "").lower()


def is_wayland() -> bool:
    return session_type() == "wayland" or bool(os.environ.get("WAYLAND_DISPLAY"))


def wayland_warning() -> str | None:
    if is_wayland():
        return (
            "Wayland session detected. Remote control (mouse, keyboard, media keys) needs an "
            "X11 session: log out and choose 'Ubuntu on Xorg' / 'GNOME on Xorg' / X11 at the "
            "login screen. Clipboard, files and Inbox still work."
        )
    return None


def create_backend() -> InputBackend:
    if is_wayland():
        return NullBackend("Wayland session: remote control needs X11")
    if not os.environ.get("DISPLAY"):
        return NullBackend("no DISPLAY: the agent must run inside your graphical X11 session")
    for factory in (PynputBackend, XdotoolBackend):
        try:
            return factory()
        except InputUnavailable as e:
            log.warning("%s", e)
    return NullBackend("neither pynput nor xdotool could be initialised")


# --- dispatcher -------------------------------------------------------------------------


class _PendingMove:
    def __init__(self, dx: int, dy: int):
        self.dx, self.dy = dx, dy


class InputDispatcher:
    """Applies events in order without queue build-up.

    Mouse deltas are *coalesced*: while the worker is busy, further deltas are summed into
    one pending move, so stale intermediate positions are dropped rather than queued. Any
    other event first causes the pending move to be applied, preserving order.
    """

    def __init__(self, backend: InputBackend, on_error=None):
        self.backend = backend
        self.on_error = on_error or (lambda exc: log.warning("input error: %s", exc))
        self._q: asyncio.Queue[ControlEvent | _PendingMove | None] = asyncio.Queue()
        self._pending: _PendingMove | None = None
        self._task: asyncio.Task | None = None
        self.dropped_moves = 0

    def start(self) -> None:
        self._task = asyncio.get_running_loop().create_task(self._worker())

    async def stop(self) -> None:
        if self._task:
            self._q.put_nowait(None)
            await self._task
            self._task = None

    def submit(self, ev: ControlEvent) -> None:
        if isinstance(ev, MoveEvent):
            if self._pending is not None:
                self.dropped_moves += 1  # merged into the move that has not run yet
                self._pending.dx += ev.dx
                self._pending.dy += ev.dy
            else:
                self._pending = _PendingMove(ev.dx, ev.dy)
                self._q.put_nowait(self._pending)
        else:
            self._pending = None  # later moves must run after this event
            self._q.put_nowait(ev)

    async def _worker(self) -> None:
        while True:
            item = await self._q.get()
            if item is None:
                return
            if isinstance(item, _PendingMove):
                if self._pending is item:
                    self._pending = None
                if not (item.dx or item.dy):
                    continue
                ev: ControlEvent = MoveEvent.model_construct(
                    type="mouse_move", dx=item.dx, dy=item.dy
                )
            else:
                ev = item
            try:
                await asyncio.to_thread(apply_event, ev, self.backend)
            except Exception as e:  # noqa: BLE001 - never kill the worker
                self.on_error(e)
