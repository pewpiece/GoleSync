"""Desktop notifications via notify-send. Never raises."""

from __future__ import annotations

import logging
import shutil
import subprocess

log = logging.getLogger("golesync")


class Notifier:
    def __init__(self, enabled: bool = True):
        self.enabled = enabled and shutil.which("notify-send") is not None

    def notify(self, title: str, body: str = "") -> None:
        log.info("notify: %s %s", title, body)
        if not self.enabled:
            return
        try:
            subprocess.Popen(
                ["notify-send", "--app-name=GoleSync", "--", title[:100], body[:300]],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        except OSError:
            self.enabled = False
