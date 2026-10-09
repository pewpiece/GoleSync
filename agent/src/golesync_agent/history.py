"""Persistent history of everything exchanged (both directions), JSON lines on disk."""

from __future__ import annotations

import threading
import time
import uuid
from pathlib import Path
from typing import Literal

from pydantic import BaseModel

MAX_ITEMS = 1000


class Item(BaseModel):
    id: str
    seq: int
    direction: Literal["to_laptop", "to_phone"]
    kind: Literal["text", "file"]
    text: str | None = None
    filename: str | None = None
    size: int | None = None
    created_at: float
    stored: str | None = None  # server-side location; never sent to the phone

    def public(self) -> dict:
        return self.model_dump(exclude={"stored"})


class History:
    def __init__(self, path: Path, outbox: Path):
        self.path, self.outbox = path, outbox
        self._lock = threading.Lock()
        self._items: list[Item] = []
        self._seq = 0
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.exists():
            for line in path.read_text().splitlines():
                try:
                    self._items.append(Item.model_validate_json(line))
                except ValueError:
                    continue
        self._seq = max((i.seq for i in self._items), default=0)

    def add(
        self,
        direction: Literal["to_laptop", "to_phone"],
        kind: Literal["text", "file"],
        *,
        text: str | None = None,
        filename: str | None = None,
        size: int | None = None,
        stored: str | None = None,
        item_id: str | None = None,
    ) -> Item:
        with self._lock:
            self._seq += 1
            item = Item(
                id=item_id or uuid.uuid4().hex,
                seq=self._seq,
                direction=direction,
                kind=kind,
                text=text,
                filename=filename,
                size=size,
                created_at=time.time(),
                stored=stored,
            )
            self._items.append(item)
            with self.path.open("a") as f:
                f.write(item.model_dump_json() + "\n")
            if len(self._items) > MAX_ITEMS + 100:
                self._trim()
            return item

    def _trim(self) -> None:
        drop, self._items = self._items[:-MAX_ITEMS], self._items[-MAX_ITEMS:]
        for it in drop:
            if it.direction == "to_phone" and it.stored:
                (self.outbox / it.stored).unlink(missing_ok=True)
        self.path.write_text("".join(i.model_dump_json() + "\n" for i in self._items))

    def list(
        self, direction: str | None = None, after: int = 0, limit: int = 200
    ) -> list[Item]:
        with self._lock:
            out = [
                i for i in self._items if i.seq > after and (direction in (None, i.direction))
            ]
        return out[-limit:]

    def get(self, item_id: str) -> Item | None:
        with self._lock:
            return next((i for i in self._items if i.id == item_id), None)

    def clear(self, direction: str | None = None) -> int:
        with self._lock:
            keep = [i for i in self._items if direction not in (None, i.direction)]
            removed = [i for i in self._items if i not in keep]
            for it in removed:
                if it.direction == "to_phone" and it.stored:
                    (self.outbox / it.stored).unlink(missing_ok=True)
            self._items = keep
            self.path.write_text("".join(i.model_dump_json() + "\n" for i in keep))
            return len(removed)
