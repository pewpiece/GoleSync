"""Command buttons: an allow-list from commands.yaml. The phone can only name an id."""

from __future__ import annotations

import asyncio
import logging
import os
import re
from pathlib import Path

import yaml
from pydantic import BaseModel, ConfigDict, Field, ValidationError

log = logging.getLogger("golesync")
OUTPUT_LINES = 40
OUTPUT_BYTES = 8000
ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")


class CommandSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(pattern=ID_RE.pattern)
    label: str = Field(min_length=1, max_length=60)
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
            proc = await asyncio.create_subprocess_exec(
                *argv,
                cwd=cwd,
                stdin=asyncio.subprocess.DEVNULL,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
                start_new_session=True,
            )
            return CommandResult(id=spec.id, exit_code=None, detached=True, pid=proc.pid)
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
