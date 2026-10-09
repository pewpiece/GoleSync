import os

import pytest

from golesync_agent.files import reserve_file, sanitize_filename

# --- text -----------------------------------------------------------------------------


def test_phone_text_copies_notifies_and_records(client, auth, parts):
    r = client.post("/v1/text", headers=auth, json={"text": "https://example.com"})
    assert r.status_code == 200 and r.json()["copied"] is True
    assert parts["clipboard"].copied == ["https://example.com"]
    assert any("From phone" in t for t, _ in parts["notifier"].events)
    hist = client.get("/v1/history", headers=auth).json()["items"]
    assert hist[-1]["text"] == "https://example.com" and hist[-1]["direction"] == "to_laptop"
    assert "stored" not in hist[-1]


def test_phone_text_without_clipboard(client, auth, parts):
    client.post("/v1/text", headers=auth, json={"text": "x", "clipboard": False})
    assert parts["clipboard"].copied == []


def test_laptop_text_reaches_inbox_and_live_socket(client, local, auth, token):
    with client.websocket_connect("/v1/ws") as ws:
        ws.send_json({"type": "auth", "token": token})
        assert ws.receive_json()["type"] == "ready"
        r = local.post("/local/send", json={"text": "hello phone"})
        assert r.json()["live_clients"] == 1
        msg = ws.receive_json()
        assert msg["type"] == "inbox" and msg["item"]["text"] == "hello phone"
    items = client.get("/v1/inbox", headers=auth).json()["items"]
    assert [i["text"] for i in items] == ["hello phone"]
    assert client.get(f"/v1/inbox?after={items[0]['seq']}", headers=auth).json()["items"] == []


def test_history_survives_restart(settings, parts, auth):
    from starlette.testclient import TestClient

    from golesync_agent.api import create_app

    app1 = create_app(settings, **parts)
    with TestClient(app1, client=("10.0.0.2", 1)) as c:
        c.post("/v1/text", headers={"Authorization": f"Bearer {app1.state.gs.tokens.token()}"}, json={"text": "keep me"})
    app2 = create_app(settings, **parts)
    assert [i.text for i in app2.state.gs.history.list()] == ["keep me"]


# --- filename sanitising ---------------------------------------------------------------

TRAVERSAL = [
    "../../etc/passwd",
    "..\\..\\windows\\system32\\evil.dll",
    "/etc/cron.d/job",
    "a/b/c.txt",
    "....//....//x",
    "%2e%2e%2fsecret",
    "..",
    ".",
    "",
    None,
    "...",
    ".bashrc",
    "name\x00.txt",
    "evil\n.sh",
    "C:\\Users\\x\\f.txt",
    "x" * 500 + ".txt",
    " . ",
]


@pytest.mark.parametrize("raw", TRAVERSAL)
def test_sanitize_yields_single_safe_component(raw):
    out = sanitize_filename(raw)
    assert out and "/" not in out and "\\" not in out and "\x00" not in out and "\n" not in out
    assert out not in (".", "..") and not out.startswith(".")
    assert len(out.encode()) <= 200


def test_sanitize_keeps_normal_names():
    assert sanitize_filename("holiday photo (1).jpg") == "holiday photo (1).jpg"
    assert sanitize_filename("../../etc/passwd") == "passwd"
    assert sanitize_filename("résumé.pdf") == "résumé.pdf"
    assert sanitize_filename("x" * 500 + ".txt").endswith(".txt")


def test_reserve_never_overwrites(tmp_path):
    names = []
    for _ in range(3):
        path, fd = reserve_file(tmp_path, "a.txt")
        os.write(fd, b"x")
        os.close(fd)
        names.append(path.name)
    assert names == ["a.txt", "a (1).txt", "a (2).txt"]


def test_reserve_refuses_symlink_target(tmp_path):
    victim = tmp_path / "victim"
    victim.write_text("precious")
    inbox = tmp_path / "in"
    inbox.mkdir()
    (inbox / "a.txt").symlink_to(victim)
    path, fd = reserve_file(inbox, "a.txt")
    os.close(fd)
    assert path.name == "a (1).txt" and victim.read_text() == "precious"


# --- upload / download -----------------------------------------------------------------


def test_upload_saves_to_inbox(client, auth, settings, parts):
    r = client.post("/v1/files?name=hello.txt", headers=auth, content=b"hello world")
    assert r.status_code == 200
    assert (settings.inbox_path / "hello.txt").read_bytes() == b"hello world"
    assert r.json()["item"]["size"] == 11
    assert any("File from phone" in t for t, _ in parts["notifier"].events)


def test_upload_traversal_name_stays_in_inbox(client, auth, settings, tmp_path):
    r = client.post("/v1/files", params={"name": "../../escape.txt"}, headers=auth, content=b"x")
    assert r.status_code == 200
    assert (settings.inbox_path / "escape.txt").exists()
    assert not (tmp_path / "escape.txt").exists()
    assert not (settings.inbox_path.parent / "escape.txt").exists()


def test_upload_twice_does_not_overwrite(client, auth, settings):
    client.post("/v1/files?name=a.txt", headers=auth, content=b"first")
    client.post("/v1/files?name=a.txt", headers=auth, content=b"second")
    assert (settings.inbox_path / "a.txt").read_bytes() == b"first"
    assert (settings.inbox_path / "a (1).txt").read_bytes() == b"second"


def test_upload_over_limit_rejected_and_cleaned(client, auth, settings):
    data = b"x" * (1024 * 1024 + 1)  # limit is 1 MB in tests
    r = client.post("/v1/files?name=big.bin", headers=auth, content=data)
    assert r.status_code == 413
    assert list(settings.inbox_path.iterdir()) == []


def test_upload_chunked_over_limit_rejected_and_cleaned(client, auth, settings):
    def gen():
        for _ in range(300):
            yield b"y" * 8192

    r = client.post("/v1/files?name=chunked.bin", headers=auth, content=gen())
    assert r.status_code == 413
    assert list(settings.inbox_path.iterdir()) == []


def test_laptop_file_download_roundtrip(client, local, auth):
    r = local.post("/local/send-file", params={"name": "../notes.txt"}, content=b"from laptop")
    assert r.status_code == 200
    item = r.json()["item"]
    assert item["filename"] == "notes.txt"
    items = client.get("/v1/inbox", headers=auth).json()["items"]
    assert items[0]["id"] == item["id"]
    d = client.get(f"/v1/inbox/{item['id']}/file", headers=auth)
    assert d.status_code == 200 and d.content == b"from laptop"
    assert "notes.txt" in d.headers["content-disposition"]


@pytest.mark.parametrize("bad", ["../../etc/passwd", "..%2f..%2fetc%2fpasswd", "x" * 32, "A" * 32])
def test_download_rejects_non_ids(client, auth, bad):
    assert client.get(f"/v1/inbox/{bad}/file", headers=auth).status_code == 404


def test_cannot_download_files_phone_uploaded(client, auth):
    item = client.post("/v1/files?name=u.txt", headers=auth, content=b"x").json()["item"]
    assert client.get(f"/v1/inbox/{item['id']}/file", headers=auth).status_code == 404


def test_send_file_over_limit(local):
    r = local.post("/local/send-file", params={"name": "big"}, content=b"x" * (1024 * 1024 + 5))
    assert r.status_code == 413
