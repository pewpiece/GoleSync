"""Write text to the laptop clipboard (X11 first, Wayland tools as a courtesy)."""

from __future__ import annotations

import os
import shutil
import subprocess


class Clipboard:
    def copy(self, text: str) -> bool:
        candidates: list[list[str]] = []
        if os.environ.get("WAYLAND_DISPLAY") and shutil.which("wl-copy"):
            candidates.append(["wl-copy"])
        if shutil.which("xclip"):
            candidates.append(["xclip", "-selection", "clipboard"])
        if shutil.which("xsel"):
            candidates.append(["xsel", "--clipboard", "--input"])
        for argv in candidates:
            try:
                subprocess.run(
                    argv,
                    input=text.encode(),
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    timeout=3,
                    check=True,
                )
                return True
            except (OSError, subprocess.SubprocessError):
                continue
        try:
            import pyperclip  # optional

            pyperclip.copy(text)
            return True
        except Exception:
            return False
