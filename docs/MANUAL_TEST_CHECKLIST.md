# Manual test checklist

Things automated tests cannot cover (real phone, real X11 session). Tick as you go.
Set up first: laptop on an **X11** session with `xdotool`, `xclip`, `libnotify-bin` installed,
agent running (`golesync serve`), phone on the same Wi-Fi with the APK installed.

## Pairing
- [ ] `golesync serve` prints a QR and a host/port, no Wayland warning.
- [ ] App > Inbox shows "Not paired"; **Scan QR code** asks for camera permission; scanning pairs and returns to Inbox with no banner.
- [ ] Settings shows status `connected`, laptop name and agent version.
- [ ] Scanning a random QR code (e.g. a website) shows "not a GoleSync pairing code".
- [ ] `golesync rotate-token`: phone shows "Laptop rejected this phone"; scanning the new QR recovers.
- [ ] Force-stop and reopen the app: still paired (token survived).

## Text and clipboard
- [ ] Send tab: type text > **Send to laptop**; laptop shows a notification and Ctrl+V pastes it.
- [ ] From a browser/app on the phone use Share > GoleSync with a link; it is on the laptop clipboard.
- [ ] `golesync send "hello"`: appears in the phone Inbox live (app open) with a Copy button; Copy puts it on the phone clipboard.
- [ ] Laptop web page (`http://127.0.0.1:8765/local/`) send box works the same way.
- [ ] With the app closed, `golesync send "later"`, then open the app: the item is there (fetched on open).
- [ ] Sent tab and laptop history list the items; they survive an app restart.

## Files
- [ ] Send tab > choose 2 files: progress bars finish; both appear in `~/GoleSync/Inbox`.
- [ ] Send the same file twice: second is `name (1).ext`, the first is untouched.
- [ ] Share a photo from Gallery > GoleSync: it arrives; share several photos at once.
- [ ] Set `max_file_mb: 1`, restart agent, send a 5 MB file: phone says the file is too large and nothing is left in Inbox.
- [ ] `golesync send-file ~/some.pdf`: phone Inbox shows it; **Download / share** shows progress and opens the share sheet.
- [ ] Turn Wi-Fi off mid-upload: a clear "Laptop unreachable" error, no crash.

## Remote control (X11)
- [ ] Open a slide deck (LibreOffice Impress): **Start (F5)**, **Next**, **Previous**, **Page Down/Up**, **Stop (Esc)** all work; each press vibrates.
- [ ] Media: play a video/song; Play/Pause, Next, Previous, Vol -, Vol +, Mute work.
- [ ] Trackpad: drag moves the pointer smoothly; tap clicks; two-finger tap right-clicks; two-finger drag scrolls a page; hold ~0.4 s then drag moves a window/selects text and releases on lift.
- [ ] Moving fast does not lag or "run on" after you stop.
- [ ] Keys: type `héllo wörld` > **Type on laptop** types into a focused text field; Enter, Backspace, Tab, Esc, arrows work.
- [ ] Screen stays awake on the Remote tab, and goes back to normal timeout on other tabs.
- [ ] Laptop shows "Phone connected" / "Phone disconnected" notifications.

## Kill switch
- [ ] `golesync pause`: laptop notification; phone banner "Paused on laptop"; remote buttons do nothing; Commands refuse.
- [ ] `golesync resume`: everything works again without re-pairing.
- [ ] The laptop web page toggle does the same.

## Commands
- [ ] Copy the example to `~/.config/golesync/commands.yaml`, enable `git-pull` with a real `cwd`: it appears on the phone without restarting the agent.
- [ ] Run "Lock screen": the laptop locks. A `confirm: true` command shows a confirmation dialog first; Cancel does nothing.
- [ ] A failing command shows a non-zero exit code and its output; a command longer than `timeout` shows "Timed out".
- [ ] A `detach: true` command (dev server) returns "Started (pid ...)" and keeps running.

## Resilience and security
- [ ] Stop the agent: phone shows "Laptop unreachable. Retrying..."; restart it and the phone reconnects within ~30 s, or at once when you tap the banner.
- [ ] Suspend the laptop for a minute, wake it: the phone recovers on its own.
- [ ] From another LAN device: `curl http://<laptop-ip>:8765/v1/status` gives 401; `curl http://<laptop-ip>:8765/local/state` gives 403.
- [ ] `ss -ltnp | grep 8765` shows only the LAN IP and 127.0.0.1, not `0.0.0.0` (unless you configured that).
- [ ] On a Wayland session the agent prints the warning and the Remote tab shows the X11 hint; Inbox/Send still work.
- [ ] Tailscale: set `advertise_host`/`bind`, re-scan, works on mobile data.
