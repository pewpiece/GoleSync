# GoleSync ("Gsync")

Connect your Android phone and your Linux laptop over your own network. Single user, no cloud,
no accounts.

* **Text & clipboard push, both ways.** Share a link from any Android app to the laptop's
  clipboard; send text or links from the laptop to the phone's Inbox.
* **File drop, both ways.** Phone files land in `~/GoleSync/Inbox`; laptop files appear in the phone's Inbox with progress.
* **Phone as remote control.** Slide clicker, media keys, trackpad (move, click, right-click, scroll, drag), keyboard.
* **Command buttons.** Run allow-listed commands from `commands.yaml` by id, with a confirm prompt.

```
agent/   Python service for the laptop (FastAPI, X11)       -> golesync / gsync CLI
app/     Expo React Native (TypeScript) Android app          -> APK from GitHub Releases
docs/    PROTOCOL.md, SECURITY.md, MANUAL_TEST_CHECKLIST.md
```

> **Security in one paragraph.** The agent listens on your LAN address only, every call needs a
> secret token you pair by QR code, and the phone can never send command *text*, only the id of
> a command you allow-listed. There is no TLS: use it on networks you trust or over Tailscale.
> **Never expose the port to the internet.** Full detail in [docs/SECURITY.md](docs/SECURITY.md).

## 1. Laptop (Linux, X11)

Remote control (mouse, keyboard, media keys) needs an **X11 session**. On Wayland the agent
starts, prints a warning, and clipboard/files/Inbox still work, but remote control is off.
To switch on Ubuntu/GNOME: log out, click your name, click the gear icon, choose
*Ubuntu on Xorg* / *GNOME on Xorg*.

```bash
sudo apt install python3-venv xdotool xclip libnotify-bin     # Debian/Ubuntu names
git clone https://github.com/pewpiece/golesync.git && cd golesync/agent
./scripts/install.sh        # venv in ~/.local/share/golesync, systemd user service, `golesync` + `gsync` on ~/.local/bin
golesync pair               # prints the pairing QR code
```

Or run it by hand without installing a service:

```bash
cd agent && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt && .venv/bin/pip install --no-deps -e .
.venv/bin/golesync serve    # prints the QR; Ctrl+C to stop
```

First run creates `~/.config/golesync/` with `config.yaml`, `token` (mode 0600) and an example
`commands.yaml`. Logs with the service: `journalctl --user -u golesync -f`.

If the service cannot move your mouse, it did not get your session's display. Run
`systemctl --user import-environment DISPLAY XAUTHORITY && systemctl --user restart golesync`.

### CLI (`golesync`, alias `gsync`)

| Command | What it does |
| --- | --- |
| `golesync serve` | Run the agent (the service does this). |
| `golesync pair` | Print the pairing QR again. The same QR is on `http://127.0.0.1:8765/local/`. |
| `golesync send "text"` | Send text/a link to the phone's Inbox (`-` reads stdin). |
| `golesync send-file path` | Send a file to the phone's Inbox. |
| `golesync pause` / `resume` | Kill switch: ignore all remote-control events and commands. |
| `golesync status` | Running? paused? how many phones connected? |
| `golesync rotate-token` | New token; every paired phone is locked out until it scans the new QR. |
| `golesync init` | Create config files without starting the agent. |

### Config (`~/.config/golesync/config.yaml`)

```yaml
bind: [auto]            # "auto" = this machine's LAN IP (+ 127.0.0.1 always). Add a Tailscale IP, or "0.0.0.0" (not recommended)
port: 8765
advertise_host: null    # host shown in the QR; set to your Tailscale name/IP to pair over a VPN
max_file_mb: 200
inbox_dir: ~/GoleSync/Inbox
rate_limit_per_min: 600
notifications: true
```

Restart the agent after editing.

### Adding commands (`~/.config/golesync/commands.yaml`)

```yaml
commands:
  - id: git-pull                     # a-z 0-9 _ -  (this is all the phone ever sends)
    label: Git pull
    command: ["git", "pull", "--ff-only"]   # argv list, no shell
    cwd: ~/projects/my-app
    confirm: true                    # phone asks "Run ...?" first
    timeout: 60                      # seconds (max 600)
  - id: dev-server
    label: Start dev server
    command: ["npm", "run", "dev"]
    cwd: ~/projects/my-app
    detach: true                     # start and return immediately
```

No restart needed: the file is re-read for every request. `enabled: false` hides an entry. The
shipped example only enables "Lock screen". Need pipes or `&&`? Put them in a script you
own and allow-list `["~/bin/my-script.sh"]`.

## 2. Phone (Android)

1. Download `GoleSync-vX.Y.Z.apk` from the repository's **Releases** page and install it
   (allow "install unknown apps" for your browser once).
2. Open GoleSync, tap **Scan QR code** (Inbox tab), scan the QR from `golesync pair`.
3. Phone and laptop must be on the same Wi-Fi. For other networks use Tailscale: install it on
   both, set `advertise_host` to the laptop's Tailscale address (and add it to `bind`), re-scan.
   You can also change the address later under Settings with no code changes.

**Background behaviour:** Android suspends background network use, so GoleSync does not
promise background delivery. While the app is open the Inbox updates live; when you open it
(or return to it) it reconnects and fetches everything it missed.

Android share sheet: share text, links or files from any app and choose **GoleSync**.

## 3. Releasing the APK

CI (`.github/workflows/ci.yml`) lints, type-checks and tests both parts on every push. Pushing
a tag `v*` runs `release.yml`: tests, `expo prebuild --platform android`, `./gradlew assembleRelease`,
signs the APK with your keystore and attaches `GoleSync-vX.Y.Z.apk` (+ sha256) to a GitHub Release.

One-time setup, on your machine (keep the keystore safe: if you lose it you cannot ship updates
that install over the old app):

```bash
keytool -genkeypair -v -storetype PKCS12 \
  -keystore golesync-release.keystore -alias golesync \
  -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 golesync-release.keystore > keystore.b64        # macOS: base64 -i golesync-release.keystore -o keystore.b64
```

Add four repository secrets (Settings > Secrets and variables > Actions), or with the `gh` CLI:

| Secret | Value |
| --- | --- |
| `KEYSTORE_BASE64` | contents of `keystore.b64` (`gh secret set KEYSTORE_BASE64 < keystore.b64`) |
| `KEYSTORE_PASSWORD` | the store password you typed for `keytool` |
| `KEY_ALIAS` | `golesync` |
| `KEY_PASSWORD` | the key password (for PKCS12 this is the same as the store password) |

Then `git tag v0.1.0 && git push origin v0.1.0`. Delete `keystore.b64` afterwards. The version
name comes from the tag, the version code from the workflow run number.

## 4. Development

```bash
# agent
cd agent && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt && .venv/bin/pip install pytest pytest-asyncio ruff && .venv/bin/pip install --no-deps -e .
.venv/bin/ruff check src tests && .venv/bin/python -m pytest -q

# app
cd app && npm ci && npm run lint && npm run typecheck && npm test
npx expo prebuild --platform android && npx expo run:android     # needs the Android SDK; Expo Go cannot run this app (share intent, camera)
```

Docs: [PROTOCOL.md](docs/PROTOCOL.md), [SECURITY.md](docs/SECURITY.md),
[MANUAL_TEST_CHECKLIST.md](docs/MANUAL_TEST_CHECKLIST.md), [DECISIONS.md](DECISIONS.md),
[WEAKNESSES.md](WEAKNESSES.md), [TEST_OUTPUT.txt](TEST_OUTPUT.txt).
