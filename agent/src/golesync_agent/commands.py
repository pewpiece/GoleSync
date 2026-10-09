"""Command buttons: an allow-list from commands.yaml. The phone can only name an id."""

from __future__ import annotations

import asyncio
import logging
import os
import re
import textwrap
from dataclasses import dataclass, field
from pathlib import Path

import yaml
from pydantic import BaseModel, ConfigDict, Field, ValidationError

log = logging.getLogger("golesync")
DETACH_GRACE = 1.5  # seconds a detached command is watched for an immediate failure
OUTPUT_LINES = 40
OUTPUT_BYTES = 8000
ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")


class CommandSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(pattern=ID_RE.pattern)
    label: str = Field(min_length=1, max_length=60)
    section: str = Field("General", min_length=1, max_length=40)
    command: list[str] = Field(min_length=1)
    cwd: str | None = None
    confirm: bool = False
    enabled: bool = True
    timeout: int = Field(60, ge=1, le=600)
    detach: bool = False  # start and return immediately (long-running things like a dev server)


class CommandResult(BaseModel):
    id: str
    exit_code: int | None
    timed_out: bool = False
    detached: bool = False
    pid: int | None = None
    output: str = ""


class CommandError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


def load_commands(path: Path) -> list[CommandSpec]:
    """Parse the allow-list. Invalid entries are skipped with a warning, never run."""
    if not path.exists():
        return []
    try:
        raw = yaml.safe_load(path.read_text()) or {}
    except yaml.YAMLError as e:
        log.warning("commands.yaml unreadable: %s", e)
        return []
    items = raw.get("commands", []) if isinstance(raw, dict) else []
    out: list[CommandSpec] = []
    seen: set[str] = set()
    for entry in items if isinstance(items, list) else []:
        try:
            spec = CommandSpec.model_validate(entry)
        except ValidationError as e:
            log.warning("skipping invalid command entry %r: %s", entry, e.errors()[0]["msg"])
            continue
        if spec.id in seen or not all(isinstance(a, str) for a in spec.command):
            continue
        seen.add(spec.id)
        out.append(spec)
    return out


def tail(text: str) -> str:
    lines = text.splitlines()[-OUTPUT_LINES:]
    return "\n".join(lines)[-OUTPUT_BYTES:]


_background: set[asyncio.Task] = set()


async def _run_detached(spec: CommandSpec, argv: list[str], cwd: str | None) -> CommandResult:
    """Start a long-running command and return. It is watched for DETACH_GRACE seconds so an
    immediate failure (missing binary, sandbox error, no display) is reported with its output
    instead of silently doing nothing. Afterwards its output is drained and discarded."""
    proc = await asyncio.create_subprocess_exec(
        *argv,
        cwd=cwd,
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
        start_new_session=True,
    )
    buf = bytearray()

    async def pump() -> None:
        assert proc.stdout is not None
        while chunk := await proc.stdout.read(4096):
            if len(buf) < 32_768:
                buf.extend(chunk)

    pump_task = asyncio.create_task(pump())
    try:
        await asyncio.wait_for(asyncio.shield(proc.wait()), timeout=DETACH_GRACE)
    except TimeoutError:
        # still running: keep draining its output in the background so it never blocks
        _background.add(pump_task)
        pump_task.add_done_callback(_background.discard)
        return CommandResult(
            id=spec.id, exit_code=None, detached=True, pid=proc.pid, output=tail(buf.decode(errors="replace"))
        )
    try:  # exited quickly; collect what it printed (a forked child may hold the pipe open)
        await asyncio.wait_for(asyncio.shield(pump_task), timeout=1.0)
    except TimeoutError:
        _background.add(pump_task)
        pump_task.add_done_callback(_background.discard)
    out = tail(buf.decode(errors="replace"))
    if proc.returncode == 0:  # launcher scripts (code, xdg-open) hand off and exit 0
        return CommandResult(id=spec.id, exit_code=0, detached=True, pid=proc.pid, output=out)
    return CommandResult(id=spec.id, exit_code=proc.returncode, output=out)


async def run_command(
    commands: list[CommandSpec], cmd_id: str, confirmed: bool
) -> CommandResult:
    spec = next((c for c in commands if c.id == cmd_id and c.enabled), None)
    if spec is None:
        raise CommandError(404, "unknown_command", "no such command")
    if spec.confirm and not confirmed:
        raise CommandError(409, "confirmation_required", "this command needs confirmation")
    cwd = os.path.expanduser(spec.cwd) if spec.cwd else None
    argv = [os.path.expanduser(a) if a.startswith("~/") else a for a in spec.command]
    try:
        if spec.detach:
            return await _run_detached(spec, argv, cwd)
        proc = await asyncio.create_subprocess_exec(  # argv list, never a shell
            *argv,
            cwd=cwd,
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            start_new_session=True,
        )
    except (OSError, ValueError) as e:
        return CommandResult(id=spec.id, exit_code=127, output=f"failed to start: {e}")
    try:
        out, _ = await asyncio.wait_for(proc.communicate(), timeout=spec.timeout)
        return CommandResult(
            id=spec.id, exit_code=proc.returncode, output=tail(out.decode(errors="replace"))
        )
    except TimeoutError:
        try:
            os.killpg(proc.pid, 9)
        except ProcessLookupError:
            pass
        out, _ = await proc.communicate()
        return CommandResult(
            id=spec.id,
            exit_code=None,
            timed_out=True,
            output=tail(out.decode(errors="replace")),
        )


def _raw_entries(path: Path) -> list[dict]:
    try:
        raw = yaml.safe_load(path.read_text()) or {}
    except (OSError, yaml.YAMLError):
        return []
    items = raw.get("commands", []) if isinstance(raw, dict) else []
    return [e for e in items if isinstance(e, dict)] if isinstance(items, list) else []


@dataclass
class SyncResult:
    added: list[str] = field(default_factory=list)  # example commands appended
    sectioned: list[str] = field(default_factory=list)  # existing commands given a section


def _assign_sections(text: str, example: list[dict], user: list[dict]) -> tuple[str, list[str]]:
    """Insert `section:` into user entries that lack one, using the example's section for the
    same id. Pure text edit after the `- id:` line, so comments and the user's edits stay."""
    wanted = {e["id"]: e["section"] for e in example if "id" in e and "section" in e}
    done: list[str] = []
    for e in user:
        cid = e.get("id")
        if "section" in e or cid not in wanted:
            continue
        pat = re.compile(r"(?m)^([ \t]*)- id:[ \t]*[\"']?" + re.escape(str(cid)) + r"[\"']?[ \t]*\n")
        m = pat.search(text)
        if not m:
            continue  # flow-style entry etc.: leave alone
        ins = f"{m.group(1)}  section: {wanted[cid]}\n"
        text = text[: m.end()] + ins + text[m.end() :]
        done.append(cid)
    return text, done


def sync_example(user_path: Path, example_path: Path) -> SyncResult:
    """Bring a user's commands.yaml up to date with the shipped example, without touching
    their edits: (1) put existing commands that have no `section` into the example's section,
    (2) append example commands whose id is missing. The file is restored if the result
    would not parse."""
    result = SyncResult()
    example = _raw_entries(example_path)
    if not user_path.exists():
        user_path.parent.mkdir(parents=True, exist_ok=True)
        user_path.write_text(example_path.read_text())
        result.added = [e["id"] for e in example if "id" in e]
        return result
    original = user_path.read_text()
    text, result.sectioned = _assign_sections(original, example, _raw_entries(user_path))
    have = {e.get("id") for e in _raw_entries(user_path)}
    missing = [e for e in example if e.get("id") not in have]
    if missing:
        block = "".join(
            textwrap.indent(yaml.safe_dump([e], sort_keys=False, default_flow_style=None), "  ") + "\n"
            for e in missing
        )
        data = yaml.safe_load(text) or {}
        if isinstance(data, dict) and data.get("commands") and isinstance(data["commands"], list):
            text = text.rstrip("\n") + "\n\n  # added by `golesync commands-sync`\n" + block
        else:
            text = "commands:\n" + block
        result.added = [e["id"] for e in missing]
    if text == original:
        return result
    user_path.write_text(text)
    parsed = _raw_entries(user_path)
    ok = {e.get("id") for e in parsed} >= have | set(result.added)
    ok = ok and all("section" in e for e in parsed if e.get("id") in result.sectioned)
    if not ok:
        user_path.write_text(original)  # never leave a broken file behind
        raise ValueError("could not merge into commands.yaml; left it unchanged")
    return result
