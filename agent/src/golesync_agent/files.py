"""Filename sanitising and collision-free file reservation."""

from __future__ import annotations

import os
import re
import unicodedata
from pathlib import Path

MAX_NAME_BYTES = 200
_BAD = re.compile(r"[^\w.\- ()\[\]+@,&=#%~]", re.UNICODE)


def sanitize_filename(name: str | None) -> str:
    """Return a safe single path component. Never empty, never hidden, never contains
    a separator, NUL or control characters."""
    name = unicodedata.normalize("NFC", name or "")
    name = name.replace("\\", "/").split("/")[-1]  # basename of either style
    name = "".join(ch for ch in name if unicodedata.category(ch)[0] != "C")
    name = _BAD.sub("_", name).strip(" .")
    name = name.lstrip(".")
    if not name or set(name) <= {"_", " "}:
        name = "file"
    stem, ext = os.path.splitext(name)
    if len(ext) > 20:
        stem, ext = name, ""
    # truncate by bytes, not characters
    budget = MAX_NAME_BYTES - len(ext.encode())
    while len(stem.encode()) > budget:
        stem = stem[:-1]
    return (stem.rstrip(" .") or "file") + ext


def reserve_file(directory: Path, name: str | None) -> tuple[Path, int]:
    """Atomically create a new, empty file in `directory` and return (path, fd).

    Uses O_EXCL, so concurrent uploads and pre-existing files can never be overwritten;
    on conflict a numeric suffix is added: `a.txt`, `a (1).txt`, ...
    """
    directory.mkdir(parents=True, exist_ok=True)
    safe = sanitize_filename(name)
    stem, ext = os.path.splitext(safe)
    root = directory.resolve()
    for n in range(0, 10_000):
        candidate = safe if n == 0 else f"{stem} ({n}){ext}"
        path = root / candidate
        if path.parent != root:  # belt and braces; sanitize makes this unreachable
            raise ValueError("path escapes target directory")
        try:
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644)
            return path, fd
        except FileExistsError:
            continue
    raise FileExistsError("could not find a free filename")
