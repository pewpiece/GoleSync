from __future__ import annotations

import pytest
from starlette.testclient import TestClient

from golesync_agent.api import create_app
from golesync_agent.config import Settings


class FakeNotifier:
    def __init__(self):
        self.events: list[tuple[str, str]] = []

    def notify(self, title, body=""):
        self.events.append((title, body))


class FakeClipboard:
    def __init__(self):
        self.copied: list[str] = []

    def copy(self, text):
        self.copied.append(text)
        return True


class RecordingBackend:
    name = "recording"

    def __init__(self):
        self.calls: list[tuple] = []

    def key(self, key):
        self.calls.append(("key", key))

    def media(self, action):
        self.calls.append(("media", action))

    def type_text(self, text):
        self.calls.append(("type", text))

    def move(self, dx, dy):
        self.calls.append(("move", dx, dy))

    def click(self, button, count):
        self.calls.append(("click", button, count))

    def button(self, button, down):
        self.calls.append(("button", button, down))

    def scroll(self, dx, dy):
        self.calls.append(("scroll", dx, dy))


@pytest.fixture
def settings(tmp_path, monkeypatch):
    monkeypatch.setenv("GOLESYNC_CONFIG_DIR", str(tmp_path / "config"))
    monkeypatch.setenv("GOLESYNC_DATA_DIR", str(tmp_path / "data"))
    s = Settings.load()
    s = s.model_copy(update={"inbox_dir": str(tmp_path / "Inbox"), "max_file_mb": 1})
    return s


@pytest.fixture
def parts(settings):
    return {"notifier": FakeNotifier(), "clipboard": FakeClipboard(), "backend": RecordingBackend()}


@pytest.fixture
def app(settings, parts):
    return create_app(settings, **parts)


@pytest.fixture
def token(app):
    return app.state.gs.tokens.token()


@pytest.fixture
def auth(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def client(app):
    """A phone on the LAN."""
    with TestClient(app, client=("192.168.1.50", 40000)) as c:
        yield c


@pytest.fixture
def local(app):
    """A process on the laptop itself."""
    with TestClient(app, base_url="http://127.0.0.1:8765", client=("127.0.0.1", 40001)) as c:
        c.headers["X-GoleSync-Local"] = "1"
        yield c
