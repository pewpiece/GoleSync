"""Settings: paths, defaults and the YAML config file."""

from __future__ import annotations

import os
import socket
from pathlib import Path

import yaml
from pydantic import BaseModel, ConfigDict, Field


def config_dir() -> Path:
    env = os.environ.get("GOLESYNC_CONFIG_DIR")
    if env:
        return Path(env).expanduser()
    base = os.environ.get("XDG_CONFIG_HOME") or str(Path.home() / ".config")
    return Path(base) / "golesync"


def data_dir() -> Path:
    env = os.environ.get("GOLESYNC_DATA_DIR")
    if env:
        return Path(env).expanduser()
    base = os.environ.get("XDG_DATA_HOME") or str(Path.home() / ".local" / "share")
    return Path(base) / "golesync"


class Settings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # "auto" = this machine's LAN address. 127.0.0.1 is always bound too (CLI + local web page).
    bind: list[str] = Field(default_factory=lambda: ["auto"])
    port: int = Field(8765, ge=1, le=65535)
    # Host written into the pairing QR. Default: detected LAN address. Set to a Tailscale
    # address / MagicDNS name to pair over a VPN.
    advertise_host: str | None = None
    max_file_mb: int = Field(200, ge=1, le=100_000)
    inbox_dir: str = "~/GoleSync/Inbox"
    rate_limit_per_min: int = Field(600, ge=10)
    notifications: bool = True

    # Resolved at load time, not stored in YAML.
    config_dir: Path = Field(default_factory=config_dir, exclude=True)
    data_dir: Path = Field(default_factory=data_dir, exclude=True)

    @property
    def max_file_bytes(self) -> int:
        return self.max_file_mb * 1024 * 1024

    @property
    def inbox_path(self) -> Path:
        return Path(self.inbox_dir).expanduser()

    @property
    def outbox_path(self) -> Path:
        return self.data_dir / "outbox"

    @property
    def token_path(self) -> Path:
        return self.config_dir / "token"

    @property
    def commands_path(self) -> Path:
        return self.config_dir / "commands.yaml"

    @property
    def history_path(self) -> Path:
        return self.data_dir / "history.jsonl"

    @classmethod
    def load(cls) -> Settings:
        cdir, ddir = config_dir(), data_dir()
        path = cdir / "config.yaml"
        raw = {}
        if path.exists():
            raw = yaml.safe_load(path.read_text()) or {}
            if not isinstance(raw, dict):
                raise ValueError(f"{path} must contain a YAML mapping")
        return cls(**raw, config_dir=cdir, data_dir=ddir)

    def write_default(self) -> Path:
        self.config_dir.mkdir(parents=True, exist_ok=True)
        path = self.config_dir / "config.yaml"
        if not path.exists():
            body = yaml.safe_dump(self.model_dump(mode="json"), sort_keys=False)
            path.write_text("# GoleSync agent config. Restart the agent after editing.\n" + body)
        return path


def detect_lan_ip() -> str | None:
    """Primary outbound IPv4 address. Connecting a UDP socket sends no packets."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))
        ip = s.getsockname()[0]
        return None if ip.startswith("127.") else ip
    except OSError:
        return None
    finally:
        s.close()


def resolve_bind_hosts(settings: Settings) -> list[str]:
    hosts: list[str] = []
    for h in settings.bind:
        if h == "auto":
            ip = detect_lan_ip()
            if ip:
                hosts.append(ip)
        else:
            hosts.append(h)
    if "0.0.0.0" not in hosts and "127.0.0.1" not in hosts:
        hosts.append("127.0.0.1")
    if "0.0.0.0" in hosts:
        return ["0.0.0.0"]
    return list(dict.fromkeys(hosts))


def advertised_host(settings: Settings) -> str:
    return settings.advertise_host or detect_lan_ip() or "127.0.0.1"
