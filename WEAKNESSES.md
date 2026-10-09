# Known weaknesses and untested areas

Written honestly; "verified" means I ran it and saw the output in `TEST_OUTPUT.txt` or in this session.

## What was verified, and how

| Area | How | Result |
| --- | --- | --- |
| Agent REST/WS/auth/limits/files/commands/pause | 164 pytest tests (in-process client) | pass |
| Agent over a real socket | `golesync serve` + curl + the real CLI + a real `websockets` client (found a real bug: uvicorn had no WebSocket library) | worked after fix |
| Mouse, clicks, drag, scroll, slide keys, typing, media keys, clipboard | pynput **and** xdotool backends, and the whole WS->agent->pynput path, against a real **Xvfb** X server (18 tests, `test_x11_integration.py`); `xclip` round trip | pass |
| `install.sh` | run with a fake `HOME` and a stub `systemctl` | created venv, links, unit file, config, token |
| App logic | 79 Jest tests: pairing parser, API client (errors/timeouts), WebSocket reconnect/backoff/auth/dead-link, store, trackpad batching, Remote buttons, Commands/Inbox screens | pass |
| App static checks | `tsc --noEmit` strict, ESLint `--max-warnings=0` | clean |
| Android project generation | `expo prebuild --platform android`; inspected the generated manifest: package id, cleartext, camera, no RECORD_AUDIO, SEND/SEND_MULTIPLE intent filters, adaptive icon, splash colour | correct |

## NOT verified (needs your phone / desktop / GitHub)

1. **No APK was built.** The Android SDK download is blocked in my sandbox, so `./gradlew assembleRelease`, the `apksigner` signing step and the `release.yml` workflow have never run. `ci.yml` is also unproven until it runs on GitHub. Expect to fix small things on the first tag.
2. **Nothing was run on a real phone.** Untested: camera QR scan, the share sheet target (`expo-share-intent`), the document picker, real upload/download progress (`expo-file-system` is mocked in Jest), SecureStore, haptics, keep-awake, React Native's WebSocket on Android, cleartext HTTP on a device, the Android 13+ behaviours of any of these.
3. **Trackpad feel is unproven.** The gesture composition (tap vs. two-finger tap vs. scroll vs. long-press-drag vs. move, via `Gesture.Race`) and the acceleration/scroll constants are my best guess; only the event mapping and batching are tested. Expect to tune `pointer.ts` and the long-press delay.
4. **Xvfb has no window manager or desktop.** I proved the agent produces the right X events (key, button, motion) but not that GNOME, LibreOffice or your media player reacts to them (media keys in particular depend on the desktop).
5. **`notify-send` and the systemd unit** were not exercised on a real session. Notifications are tested via a fake; `DISPLAY`/`XAUTHORITY` hand-off to the user service is documented but untried.
6. **Wayland** is only detected (environment variables) and warned about; no Wayland session was available.
7. **LAN behaviour:** IP auto-detection, binding to the LAN address, and two-device lockout were not tried on a real network. Sandbox address was `192.0.2.2`.
8. **iOS:** configured (bundle id) but never built or run; the share extension is untested.
9. Non-ASCII typing: tested with ASCII only on X11. Emoji, dead keys and exotic layouts may fail via pynput/xdotool.

## Design weaknesses and limitations

* **No TLS.** The token travels in clear text on the LAN. Use trusted Wi-Fi or Tailscale. Self-signed TLS with pinning (the optional extra) was not built.
* **One shared token, no per-device management.** Every paired phone uses the same token; the only revocation is `rotate-token`, which disconnects all of them.
* **Token at rest on the laptop is plain text** (mode 0600), and is shown in the terminal QR (scrollback) and on the loopback web page.
* **History is plain text on disk** (`~/.local/share/golesync/history.jsonl`, outbox files): it includes every clipboard text sent from the phone.
* **Any local process running as you** can use the loopback endpoints and read the token. By design, same trust as your shell.
* **Rate limit/lockout are in memory and per source address.** Clients behind one NAT or a Tailscale subnet router share a budget; the agent restarting resets them. Someone on the LAN who spoofs your phone's IP can trigger its lockout.
* **Commands:** run with the agent's environment and permissions; `detach` processes are not tracked or stoppable from the phone; shell features need a script you provide (no shell by design); output is only the last 40 lines.
* **No background delivery** (Android limits it); the Inbox is live only while the app is open and syncs on open.
* **Transfers:** uploads are not resumable or cancellable from the UI; downloads land in the app cache and are saved/shared through the Android share sheet rather than written straight to Downloads.
* **IPv4 only, no discovery.** If the laptop's DHCP address changes you must re-scan the QR or edit the address in Settings (a stable DHCP lease, hostname, or Tailscale avoids this).
* Keyboard text is sent as a block, not live per keystroke.
* The `*/*` share filter makes GoleSync appear for every shared item.
* `npm audit` reports 64 advisories (47 high) in transitive build-tooling dependencies of Expo/React Native (`npm audit --omit=dev`); I did not run `audit fix --force` because it would break the pinned SDK. They are not part of the runtime attack surface of the agent, but review before publishing the app widely. `pip-audit` on `agent/requirements.txt`: none found.
* Dependency versions were chosen from Expo's `bundledNativeModules.json` because `expo install`/`expo-doctor` could not reach `api.expo.dev` from my sandbox.
* Linux/X11 only. No macOS/Windows agent.
