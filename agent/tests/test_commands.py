import sys
import textwrap

import pytest

from golesync_agent.commands import load_commands


def write_commands(settings, body: str):
    settings.config_dir.mkdir(parents=True, exist_ok=True)
    settings.commands_path.write_text(textwrap.dedent(body))


@pytest.fixture
def cmds(settings):
    write_commands(
        settings,
        f"""
        commands:
          - id: hello
            label: Hello
            command: ["{sys.executable}", "-c", "print('hi'); print('line2')"]
          - id: fails
            label: Fails
            command: ["{sys.executable}", "-c", "import sys; print('bad'); sys.exit(3)"]
          - id: risky
            label: Risky
            command: ["echo", "done"]
            confirm: true
          - id: slow
            label: Slow
            command: ["sleep", "30"]
            timeout: 1
          - id: off
            label: Off
            command: ["echo", "should not run"]
            enabled: false
          - id: literal
            label: Literal
            command: ["echo", "a; touch PWNED && echo $(id) `id`"]
          - id: missing
            label: Missing binary
            command: ["/nonexistent/binary"]
          - id: Bad ID!
            label: Invalid id gets skipped
            command: ["echo", "x"]
          - id: tail
            label: Many lines
            command: ["{sys.executable}", "-c", "print('\\\\n'.join(str(i) for i in range(500)))"]
        """,
    )


def test_list_only_enabled_and_hides_argv(client, auth, cmds):
    items = client.get("/v1/commands", headers=auth).json()["commands"]
    ids = [c["id"] for c in items]
    assert "off" not in ids and "Bad ID!" not in ids and "hello" in ids
    assert all(set(c) == {"id", "label", "confirm"} for c in items)


def test_run_returns_exit_code_and_output(client, auth, cmds):
    r = client.post("/v1/commands/hello/run", headers=auth).json()
    assert r["exit_code"] == 0 and r["output"].splitlines() == ["hi", "line2"]
    r = client.post("/v1/commands/fails/run", headers=auth).json()
    assert r["exit_code"] == 3 and "bad" in r["output"]


def test_output_is_tailed(client, auth, cmds):
    out = client.post("/v1/commands/tail/run", headers=auth).json()["output"].splitlines()
    assert len(out) == 40 and out[-1] == "499"


@pytest.mark.parametrize(
    "bad_id",
    ["nope", "hello; rm -rf /", "hello && id", "$(id)", "`id`", "../hello", "hello%00", "HELLO", "off", "Bad ID!"],
)
def test_unknown_or_malicious_ids_rejected(client, auth, cmds, bad_id):
    r = client.post(f"/v1/commands/{bad_id}/run", headers=auth)
    assert r.status_code in (404, 405)  # never executes anything


def test_shell_injection_in_id_runs_nothing(client, auth, cmds, tmp_path):
    marker = tmp_path / "pwned"
    client.post(f"/v1/commands/x;touch {marker}/run", headers=auth)
    client.post("/v1/commands/run", headers=auth, json={"command": f"touch {marker}"})
    assert not marker.exists()


def test_body_cannot_smuggle_command_text(client, auth, cmds):
    for body in (
        {"command": "id"},
        {"argv": ["id"]},
        {"confirmed": True, "command": "id"},
        {"id": "hello", "cmd": "id"},
    ):
        r = client.post("/v1/commands/hello/run", headers=auth, json=body)
        assert r.status_code == 422


def test_no_shell_so_metacharacters_are_literal(client, auth, cmds, settings):
    r = client.post("/v1/commands/literal/run", headers=auth).json()
    assert r["output"].strip() == "a; touch PWNED && echo $(id) `id`"
    import os

    assert not os.path.exists("PWNED")


def test_confirm_required(client, auth, cmds):
    r = client.post("/v1/commands/risky/run", headers=auth)
    assert r.status_code == 409 and r.json()["code"] == "confirmation_required"
    r = client.post("/v1/commands/risky/run", headers=auth, json={"confirmed": True})
    assert r.status_code == 200 and r.json()["output"].strip() == "done"


def test_disabled_command_cannot_run(client, auth, cmds):
    assert client.post("/v1/commands/off/run", headers=auth).status_code == 404


def test_timeout_kills_process(client, auth, cmds):
    r = client.post("/v1/commands/slow/run", headers=auth).json()
    assert r["timed_out"] is True and r["exit_code"] is None


def test_missing_binary_reports_failure(client, auth, cmds):
    r = client.post("/v1/commands/missing/run", headers=auth).json()
    assert r["exit_code"] == 127 and "failed to start" in r["output"]


def test_paused_blocks_commands(client, local, auth, cmds):
    local.post("/local/pause")
    assert client.post("/v1/commands/hello/run", headers=auth).status_code == 423
    local.post("/local/resume")
    assert client.post("/v1/commands/hello/run", headers=auth).status_code == 200


def test_requires_token(client, cmds):
    assert client.post("/v1/commands/hello/run").status_code == 401


def test_loader_skips_garbage(settings):
    write_commands(settings, "commands:\n  - 12\n  - {id: a, label: A, command: []}\n  - {id: ok, label: ok, command: [echo]}\n")
    assert [c.id for c in load_commands(settings.commands_path)] == ["ok"]
    settings.commands_path.write_text("::: not yaml [")
    assert load_commands(settings.commands_path) == []
    settings.commands_path.unlink()
    assert load_commands(settings.commands_path) == []


def test_shipped_example_is_valid_and_safe_by_default():
    from pathlib import Path

    import golesync_agent

    example = Path(golesync_agent.__file__).with_name("commands.example.yaml")
    loaded = load_commands(example)
    ids = {c.id for c in loaded}
    assert ids >= {"lock-screen", "dev-server", "git-pull", "run-tests", "suspend", "workspace-next"}
    enabled = {c.id for c in loaded if c.enabled}
    # nothing destructive or project-specific is on by default
    assert not enabled & {"suspend", "close-window", "dev-server", "git-pull", "run-tests"}
    assert {"lock-screen", "screen-off", "workspace-next", "workspace-prev", "open-shorts"} <= enabled
    # every risky entry asks for confirmation
    for c in loaded:
        if c.id in {"suspend", "close-window"}:
            assert c.confirm and not c.enabled
    assert all(c.command[0] for c in loaded)


def test_example_has_no_duplicate_ids_and_valid_risky_entries():
    from pathlib import Path

    import golesync_agent

    example = Path(golesync_agent.__file__).with_name("commands.example.yaml")
    raw_ids = [e["id"] for e in __import__("yaml").safe_load(example.read_text())["commands"]]
    assert len(raw_ids) == len(set(raw_ids))
    assert len(load_commands(example)) == len(raw_ids)  # none silently skipped as invalid
    by_id = {c.id: c for c in load_commands(example)}
    for risky in ("wifi-off", "empty-trash", "suspend", "close-window"):
        assert by_id[risky].confirm and not by_id[risky].enabled
    assert by_id["browser-close-tab"].confirm
    assert "reboot" not in by_id and "shutdown" not in by_id
    for gone in ("copy", "paste", "cut", "volume-up", "volume-down", "mute-toggle", "open-terminal"):
        assert gone not in by_id
    for app in ("brave", "chromium", "terminal", "vscode", "slack", "postman", "files"):
        c = by_id[f"app-{app}"]
        assert c.enabled and c.detach and not c.confirm


def test_sync_adds_only_missing_and_keeps_user_edits(tmp_path):
    from pathlib import Path

    import golesync_agent
    from golesync_agent.commands import sync_example

    example = Path(golesync_agent.__file__).with_name("commands.example.yaml")
    user = tmp_path / "commands.yaml"
    user.write_text(
        "# my file\ncommands:\n  - id: lock-screen\n    label: My lock\n    command: [echo, lock]\n    enabled: false\n"
        "  - id: mine\n    label: Mine\n    command: [echo, hi]\n"
    )
    added = sync_example(user, example)
    assert "lock-screen" not in added and "app-brave" in added and "mine" not in added
    loaded = {c.id: c for c in load_commands(user)}
    assert loaded["lock-screen"].label == "My lock" and loaded["lock-screen"].enabled is False
    assert loaded["mine"].command == ["echo", "hi"]
    assert loaded["select-all"].command == ["xdotool", "key", "ctrl+a"]
    assert user.read_text().startswith("# my file")
    assert sync_example(user, example) == []  # idempotent


def test_sync_creates_missing_file_and_repairs_empty_commands(tmp_path):
    from pathlib import Path

    import golesync_agent
    from golesync_agent.commands import sync_example

    example = Path(golesync_agent.__file__).with_name("commands.example.yaml")
    fresh = tmp_path / "new" / "commands.yaml"
    assert "lock-screen" in sync_example(fresh, example)
    empty = tmp_path / "empty.yaml"
    empty.write_text("commands: []\n")
    assert sync_example(empty, example)
    assert len(load_commands(empty)) == len(load_commands(example))


async def test_detached_failure_is_reported_with_output():
    from golesync_agent.commands import CommandSpec, run_command

    spec = CommandSpec(
        id="boom", label="b", detach=True,
        command=[sys.executable, "-c", "import sys; print('no display'); sys.exit(3)"],
    )  # fmt: skip
    r = await run_command([spec], "boom", False)
    assert r.exit_code == 3 and not r.detached and "no display" in r.output


async def test_detached_long_runner_returns_pid_and_keeps_running(monkeypatch):
    import os
    import signal

    from golesync_agent import commands
    from golesync_agent.commands import CommandSpec, run_command

    monkeypatch.setattr(commands, "DETACH_GRACE", 0.3)
    spec = CommandSpec(id="srv", label="s", detach=True, command=["sleep", "30"])
    r = await run_command([spec], "srv", False)
    try:
        assert r.detached and r.pid and r.exit_code is None
        os.kill(r.pid, 0)  # still alive
    finally:
        os.killpg(r.pid, signal.SIGKILL)


async def test_detached_quick_success_counts_as_started():
    from golesync_agent.commands import CommandSpec, run_command

    spec = CommandSpec(id="hand", label="h", detach=True, command=["true"])
    r = await run_command([spec], "hand", False)
    assert r.detached and r.exit_code == 0


async def test_detached_missing_binary_says_so():
    from golesync_agent.commands import CommandSpec, run_command

    spec = CommandSpec(id="nope", label="n", detach=True, command=["/nonexistent/app"])
    r = await run_command([spec], "nope", False)
    assert r.exit_code == 127 and "failed to start" in r.output
