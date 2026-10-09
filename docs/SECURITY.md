# Security

GoleSync lets a phone type on, click on, and run allow-listed commands on your laptop. Treat
the pairing token like a password.

## Threat model

Designed for: **one person, one phone, one laptop, on a network you broadly trust** (home
Wi-Fi) or over a VPN (Tailscale/WireGuard). Not designed for: hostile shared Wi-Fi without a
VPN, or exposure to the internet.

## What protects you

| Control | Detail |
| --- | --- |
| Pairing token | 256-bit random, stored in `~/.config/golesync/token` (mode 0600) on the laptop and in Android Keystore-backed `expo-secure-store` on the phone. Excluded from Android backups. |
| Auth everywhere | Every REST call and WebSocket needs the token; constant-time comparison; token never in URLs. |
| Lockout | 10 failed attempts / 60 s per address blocks that address. |
| Rotation | `golesync rotate-token` replaces the token and kicks every connected phone immediately. |
| Network exposure | The agent binds to your LAN address (and loopback), not `0.0.0.0`, unless you set `bind: ["0.0.0.0"]`. **Never port-forward it, and never put it on a public address.** |
| Kill switch | `golesync pause` (or the button on the laptop page) makes the agent drop all remote-control events and refuse all commands at once; only the laptop can resume. Desktop notifications announce pause/resume and every phone connect/disconnect. |
| Command allow-list | The phone can only name a command **id** from `commands.yaml`. Commands run as an argv list with no shell, with a timeout, no stdin, in their own process group (killed on timeout). Request bodies reject unknown fields, so there is no field that could carry command text. Entries can require confirmation on the phone. |
| Input validation | pydantic models with `extra="forbid"` for every request and WebSocket event; keys are an enumerated list, not free text; text and number ranges are capped. |
| Files | Streaming uploads with a hard size limit (header and byte count); sanitised file names; `O_EXCL | O_NOFOLLOW` creation so existing files and symlinks are never overwritten or followed; downloads only by opaque server-generated id. |
| Limits | Request-size caps, per-address rate limit, per-socket message limit. |
| Local endpoints | Loopback peer + loopback `Host` + custom header, so neither other machines nor web pages in your browser can drive them. |
| Minimal unauthenticated surface | `/health` returns `{"status":"ok"}` only; API docs/OpenAPI are disabled. |

## Known trade-offs (read these)

* **No TLS.** Traffic, including the token, is plain HTTP. Anyone who can sniff your Wi-Fi
  can read the token. The Android build therefore sets `usesCleartextTraffic="true"`
  (Android blocks cleartext by default). Mitigations: trusted network, or use Tailscale and
  put its address in Settings (WireGuard encrypts the link). A pinned self-signed TLS mode is
  not implemented (see `DECISIONS.md`).
* **Anyone with the token has the keyboard.** A stolen phone with the app, or a leaked QR
  screenshot, means remote typing/clicking and any command in your allow-list. Rotate the
  token, and keep dangerous commands off the allow-list or set `confirm: true`.
* **Local processes are trusted.** Any program running as you can call the loopback endpoints
  (pause, resume, send) and read the token file. That is the same trust level as your shell.
* **Wayland** blocks synthetic input by design. On Wayland the agent warns and remote control is
  disabled; clipboard/files/Inbox still work.

## Hardening checklist

1. Keep the default `bind` (LAN address only); do not use `0.0.0.0` on laptops that join public networks.
2. Run the agent only while you need it (`systemctl --user stop golesync`) on untrusted networks.
3. Keep `commands.yaml` short; use `confirm: true` for anything destructive; prefer scripts you own.
4. `golesync rotate-token` after losing a phone or sharing a screenshot of the QR.
5. Back up the release keystore; never commit it (`*.jks`, `*.keystore` are git-ignored).

## Reporting

This is a personal project. Open a private security advisory on the repository.
