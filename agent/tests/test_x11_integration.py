"""Runs the real input backends against a virtual X server (Xvfb).

Skipped automatically unless Xvfb, xdotool and xclip are installed. These are the tests that
prove pynput/xdotool/xclip actually do what the agent expects, with no mocks.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import time

import pytest

pytestmark = pytest.mark.skipif(
    not all(shutil.which(t) for t in ("Xvfb", "xdotool", "xclip")),
    reason="needs Xvfb, xdotool and xclip",
)

DISPLAY = ":97"


@pytest.fixture(scope="module")
def xserver():
    proc = subprocess.Popen(
        ["Xvfb", DISPLAY, "-screen", "0", "800x600x24"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    old = {k: os.environ.get(k) for k in ("DISPLAY", "XDG_SESSION_TYPE", "WAYLAND_DISPLAY")}
    os.environ["DISPLAY"] = DISPLAY
    os.environ["XDG_SESSION_TYPE"] = "x11"
    os.environ.pop("WAYLAND_DISPLAY", None)
    for _ in range(50):
        if subprocess.run(["xdotool", "getmouselocation"], capture_output=True).returncode == 0:
            break
        time.sleep(0.1)
    yield DISPLAY
    import gc

    gc.collect()  # drop pynput controllers while the server is still alive
    proc.terminate()
    proc.wait(5)
    for k, v in old.items():
        if v is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = v


@pytest.fixture
def window(xserver):
    """A window that has the pointer and keyboard focus and records the events it receives."""
    from Xlib import X, display

    d = display.Display(xserver)
    win = d.screen().root.create_window(
        0, 0, 600, 500, 0, d.screen().root_depth, X.InputOutput, X.CopyFromParent,
        event_mask=X.KeyPressMask | X.ButtonPressMask,
    )
    win.map()
    d.sync()
    subprocess.run(["xdotool", "mousemove", "300", "250"], check=True)
    win.set_input_focus(X.RevertToParent, X.CurrentTime)
    d.sync()

    class W:
        def events(self, timeout=1.0):
            out, end = [], time.time() + timeout
            while time.time() < end:
                while d.pending_events():
                    out.append(d.next_event())
                if out:
                    time.sleep(0.15)
                    while d.pending_events():
                        out.append(d.next_event())
                    break
                time.sleep(0.02)
            return out

        def drain(self):
            self.events(0.3)

        def keysyms(self, evs):
            return [d.keycode_to_keysym(e.detail, 0) for e in evs if e.type == X.KeyPress]

        def buttons(self, evs):
            return [e.detail for e in evs if e.type == X.ButtonPress]

    w = W()
    w.drain()
    yield w
    win.destroy()
    d.close()


def pointer() -> tuple[int, int]:
    out = subprocess.run(["xdotool", "getmouselocation", "--shell"], capture_output=True, text=True).stdout
    kv = dict(line.split("=") for line in out.split())
    return int(kv["X"]), int(kv["Y"])


def backends():
    from golesync_agent.input import PynputBackend, XdotoolBackend

    return [PynputBackend(), XdotoolBackend()]


@pytest.mark.parametrize("idx", [0, 1], ids=["pynput", "xdotool"])
def test_move_is_relative(window, idx):
    b = backends()[idx]
    x0, y0 = pointer()
    b.move(25, -10)
    time.sleep(0.2)
    assert pointer() == (x0 + 25, y0 - 10)


@pytest.mark.parametrize("idx", [0, 1], ids=["pynput", "xdotool"])
def test_clicks(window, idx):
    b = backends()[idx]
    b.click("left", 1)
    b.click("right", 1)
    b.click("middle", 1)
    b.click("left", 2)
    assert window.buttons(window.events()) == [1, 3, 2, 1, 1]


@pytest.mark.parametrize("idx", [0, 1], ids=["pynput", "xdotool"])
def test_press_and_release_for_drag(window, idx):
    from Xlib import X

    b = backends()[idx]
    b.button("left", True)
    b.move(40, 0)
    b.button("left", False)
    evs = window.events()
    assert [e.type for e in evs if e.type in (X.ButtonPress, X.ButtonRelease)] == [X.ButtonPress]


@pytest.mark.parametrize("idx", [0, 1], ids=["pynput", "xdotool"])
def test_scroll_direction(window, idx):
    b = backends()[idx]
    b.scroll(0, 3)  # positive = scroll down = X wheel button 5
    assert window.buttons(window.events()) == [5, 5, 5]
    b.scroll(0, -2)
    assert window.buttons(window.events()) == [4, 4]


@pytest.mark.parametrize("idx", [0, 1], ids=["pynput", "xdotool"])
def test_slide_and_editing_keys(window, idx):
    from Xlib import XK

    b = backends()[idx]
    names = ["right", "left", "pagedown", "pageup", "f5", "escape", "enter", "backspace", "tab"]
    for n in names:
        b.key(n)
    got = window.keysyms(window.events(2))
    want = [XK.XK_Right, XK.XK_Left, XK.XK_Next, XK.XK_Prior, XK.XK_F5, XK.XK_Escape,
            XK.XK_Return, XK.XK_BackSpace, XK.XK_Tab]  # fmt: skip
    assert got == want


@pytest.mark.parametrize("idx", [0, 1], ids=["pynput", "xdotool"])
def test_type_text(window, idx):
    from Xlib import XK

    b = backends()[idx]
    b.type_text("ab1")
    got = window.keysyms(window.events(2))
    assert got == [XK.string_to_keysym("a"), XK.string_to_keysym("b"), XK.string_to_keysym("1")]


@pytest.mark.parametrize("idx", [0, 1], ids=["pynput", "xdotool"])
def test_type_text_with_capitals_uses_shift(window, idx):
    from Xlib import XK, X

    b = backends()[idx]
    b.type_text("Q")
    evs = [e for e in window.events(2) if e.type == X.KeyPress]
    letter = [e for e in evs if window_keysym(e) == XK.string_to_keysym("q")]
    assert letter and letter[0].state & X.ShiftMask


def window_keysym(ev):
    from Xlib import display

    d = display.Display(DISPLAY)
    try:
        return d.keycode_to_keysym(ev.detail, 0)
    finally:
        d.close()


def test_media_keys_reach_the_server(window):
    b = backends()[0]  # pynput backend routes media through xdotool when available
    keysyms = {  # X11 XF86 keysyms (Xlib's string lookup does not load that group)
        "play_pause": 0x1008FF14,
        "next": 0x1008FF17,
        "previous": 0x1008FF16,
        "volume_up": 0x1008FF13,
        "volume_down": 0x1008FF11,
        "mute": 0x1008FF12,
    }
    for action, sym in keysyms.items():
        b.media(action)
        assert sym in window.keysyms(window.events(1.5)), action


def test_create_backend_picks_pynput_on_x11(xserver):
    from golesync_agent.input import create_backend

    assert create_backend().name == "pynput"


def test_clipboard_roundtrip(xserver):
    from golesync_agent.clipboard import Clipboard

    assert Clipboard().copy("héllo from phone\nline 2") is True
    out = subprocess.run(["xclip", "-o", "-selection", "clipboard"], capture_output=True, timeout=3)
    assert out.stdout.decode() == "héllo from phone\nline 2"


def test_whole_stack_ws_to_real_x_server(window, settings):
    """Phone WebSocket events -> agent -> pynput -> X server, nothing mocked but the notifier."""
    from starlette.testclient import TestClient

    from golesync_agent.api import create_app
    from golesync_agent.input import create_backend

    from .conftest import FakeNotifier

    app = create_app(settings, backend=create_backend(), notifier=FakeNotifier())
    token = app.state.gs.tokens.token()
    x0, y0 = pointer()
    with TestClient(app, client=("192.168.1.9", 5)) as c, c.websocket_connect("/v1/ws") as ws:
        ws.send_json({"type": "auth", "token": token})
        assert ws.receive_json()["backend"] == "pynput"
        for _ in range(20):
            ws.send_json({"type": "mouse_move", "dx": 2, "dy": 1})
        ws.send_json({"type": "mouse_click", "button": "left", "count": 1})
        ws.send_json({"type": "key", "key": "right"})
        evs = window.events(2)
        time.sleep(0.3)
    assert window.buttons(evs) == [1]
    assert pointer() == (x0 + 40, y0 + 20)
