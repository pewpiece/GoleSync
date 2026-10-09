"""`golesync` / `gsync` command line."""

from __future__ import annotations

import asyncio
import logging
import socket
import sys
from pathlib import Path

import httpx
import typer

from . import __version__
from .config import Settings, advertised_host, resolve_bind_hosts
from .input import wayland_warning
from .security import LOCAL_HEADER, TokenStore

app = typer.Typer(
    add_completion=False,
    no_args_is_help=True,
    help="GoleSync: connect your phone and this laptop over the local network.",
)

LOCAL = {LOCAL_HEADER: "1"}


def _settings() -> Settings:
    try:
        return Settings.load()
    except Exception as e:  # noqa: BLE001
        typer.secho(f"Invalid config: {e}", fg="red", err=True)
        raise typer.Exit(2) from e


def _local(method: str, path: str, **kw) -> httpx.Response:
    s = _settings()
    try:
        return httpx.request(
            method, f"http://127.0.0.1:{s.port}{path}", headers=LOCAL, timeout=kw.pop("timeout", 10), **kw
        )
    except httpx.ConnectError:
        typer.secho(
            f"The agent is not running on 127.0.0.1:{s.port}. Start it with `golesync serve`.",
            fg="red",
            err=True,
        )
        raise typer.Exit(1) from None


def pairing_uri(s: Settings, token: str) -> str:
    return f"golesync://pair?host={advertised_host(s)}&port={s.port}&token={token}"


def print_qr(uri: str) -> None:
    import qrcode

    qr = qrcode.QRCode(border=1)
    qr.add_data(uri)
    qr.make()
    qr.print_ascii(out=sys.stdout, invert=True)


def _bound_sockets(hosts: list[str], port: int) -> list[socket.socket]:
    socks = []
    for h in hosts:
        sk = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sk.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sk.bind((h, port))
        sk.listen(128)
        sk.setblocking(False)
        socks.append(sk)
    return socks


@app.command()
def serve(
    quiet_qr: bool = typer.Option(False, "--no-qr", help="Do not print the pairing QR code."),
) -> None:
    """Run the agent (the long-running service)."""
    import uvicorn

    from .api import create_app

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    s = _settings()
    s.write_default()
    tokens = TokenStore(s.token_path)
    hosts = resolve_bind_hosts(s)
    try:
        socks = _bound_sockets(hosts, s.port)
    except OSError as e:
        typer.secho(f"Cannot listen on {hosts}:{s.port}: {e}", fg="red", err=True)
        raise typer.Exit(1) from e

    warn = wayland_warning()
    if warn:
        typer.secho("WARNING: " + warn, fg="yellow", err=True)
    typer.echo(f"GoleSync agent {__version__} listening on {', '.join(f'{h}:{s.port}' for h in hosts)}")
    if "0.0.0.0" in hosts:
        typer.secho("NOTE: bound to ALL interfaces (bind: 0.0.0.0). Do not expose this port to the internet.", fg="yellow")
    typer.echo(f"Local page (this laptop only): http://127.0.0.1:{s.port}/local/")
    typer.echo(f"Inbox folder: {s.inbox_path}")
    if not quiet_qr:
        uri = pairing_uri(s, tokens.token())
        typer.echo("\nScan with the GoleSync app to pair:\n")
        print_qr(uri)
        typer.echo(f"\nOr enter manually: host {advertised_host(s)}  port {s.port}  (token in {s.token_path})\n")

    application = create_app(s)
    config = uvicorn.Config(application, log_level="info", ws_max_size=16384)
    asyncio.run(uvicorn.Server(config).serve(sockets=socks))


@app.command()
def pair() -> None:
    """Print the pairing QR code again."""
    s = _settings()
    uri = pairing_uri(s, TokenStore(s.token_path).token())
    print_qr(uri)
    typer.echo(f"host {advertised_host(s)}  port {s.port}")


@app.command("rotate-token")
def rotate_token() -> None:
    """Create a new token. Every paired phone is disconnected and must scan the new QR."""
    s = _settings()
    store = TokenStore(s.token_path)
    store.rotate()
    try:
        httpx.post(
            f"http://127.0.0.1:{s.port}/local/rotate-token", headers=LOCAL, timeout=3
        )
    except httpx.HTTPError:
        pass  # agent not running; it reads the file on start
    typer.secho("Token rotated. Old phones are locked out. Scan this code to pair again:", fg="green")
    print_qr(pairing_uri(s, store.token()))


@app.command()
def pause() -> None:
    """Kill switch: ignore all remote-control and command events."""
    r = _local("POST", "/local/pause")
    typer.echo("paused" if r.is_success else f"failed: {r.status_code}")
    raise typer.Exit(0 if r.is_success else 1)


@app.command()
def resume() -> None:
    """Re-enable remote control and commands."""
    r = _local("POST", "/local/resume")
    typer.echo("resumed" if r.is_success else f"failed: {r.status_code}")
    raise typer.Exit(0 if r.is_success else 1)


@app.command()
def status() -> None:
    """Show whether the agent is running, paused, and how many phones are connected."""
    r = _local("GET", "/local/state")
    d = r.json()
    typer.echo(f"running; paused={d['paused']}; phones connected={d['clients']}; inbox={d['inbox_dir']}")


@app.command()
def send(text: str = typer.Argument(..., help='Text to send to the phone, or "-" to read stdin.')) -> None:
    """Send text/a link to the phone's Inbox."""
    if text == "-":
        text = sys.stdin.read()
    r = _local("POST", "/local/send", json={"text": text})
    if not r.is_success:
        typer.secho(f"failed: {r.status_code} {r.text}", fg="red", err=True)
        raise typer.Exit(1)
    n = r.json()["live_clients"]
    typer.echo(f"sent ({n} phone(s) connected now; it will also appear when the app is next opened)")


@app.command("send-file")
def send_file(path: Path = typer.Argument(..., exists=True, dir_okay=False, readable=True)) -> None:
    """Send a file to the phone's Inbox."""
    with path.open("rb") as f:
        r = _local("POST", "/local/send-file", params={"name": path.name}, content=f, timeout=600)
    if not r.is_success:
        typer.secho(f"failed: {r.status_code} {r.text}", fg="red", err=True)
        raise typer.Exit(1)
    typer.echo(f"sent {path.name}")


@app.command()
def init() -> None:
    """Create the config directory, config.yaml, token and an example commands.yaml."""
    s = _settings()
    s.write_default()
    TokenStore(s.token_path)
    dest = s.commands_path
    if not dest.exists():
        example = Path(__file__).with_name("commands.example.yaml")
        dest.write_text(example.read_text())
    typer.echo(f"config: {s.config_dir}\ncommands: {dest}")


@app.command()
def version() -> None:
    """Print the version."""
    typer.echo(__version__)


if __name__ == "__main__":
    app()
