# Decisions

Made without asking, as requested. Revisit any of them.

## Naming and layout
* Display name **GoleSync**, logo text/header **Gsync**; package/bundle id `dev.pewpiece.golesync`; Python package `golesync_agent`; CLI `golesync` with alias `gsync` (two console scripts, one entry point).
* The three supplied images were copied unmodified into `app/assets/branding/` as `icon.png` (full-bleed, #0B1220), `adaptive-icon-foreground.png`, `splash-icon.png` (the two transparent ones were byte-different; I assumed the first is the foreground and the second the splash). Check them if I mixed them up.
* Colours: background `#0B1220`, accent `#38BDF8`, dark theme only.

## Agent
* **FastAPI + uvicorn**, plus the `websockets` package. uvicorn without it silently cannot serve WebSocket upgrades (found by running a real client; the in-process test client hides this).
* **Token in a separate file** `~/.config/golesync/token` (0600) instead of inside YAML, so rotation is an atomic file swap and a running agent notices it by mtime.
* **WebSocket auth by first message**, not URL/query, so the token never lands in logs or proxies. Server closes with 4401 after 5 s without a valid `auth`.
* **Binding:** the agent binds the detected LAN address *and* 127.0.0.1 with two sockets (the CLI/laptop page need loopback). It never defaults to 0.0.0.0.
* **Local endpoints instead of token for the CLI:** loopback peer + loopback `Host` + `X-GoleSync-Local: 1`. Protects against other machines, DNS rebinding and cross-site browser requests.
* **Uploads are raw-body streams** (`POST /v1/files?name=`) rather than multipart: constant memory, easy size enforcement, and the phone can use native binary upload with progress.
* **Mouse coalescing** in the dispatcher (sum pending deltas into one move) rather than a bounded queue: it can never fall behind and ordering with clicks is preserved. Backend calls run in a worker thread so a slow X call does not block the event loop.
* **Input backends:** `pynput` first; media keys go through `xdotool` when it is installed (pynput's media keysyms are unreliable across X servers) and fall back to pynput. Neither available -> a `NullBackend` that reports why, so the phone shows a clear message instead of failing silently. Wayland is detected at startup and warned about.
* **Command extras beyond the brief:** `enabled`, `timeout` (<= 600 s), and `detach` (dev servers cannot be waited on). `commands.yaml` is re-read per request. Invalid entries are skipped with a warning, never executed. Unknown ids return 404 and the request model forbids extra fields.
* **Kill switch cannot be undone from the phone** on purpose; only loopback can resume.
* **History** is JSON lines (cap 1000 items, oldest files in the outbox are deleted with them).
* Clipboard: `xclip`, then `xsel`, then `wl-copy` (Wayland), then pyperclip if installed. No hard dependency on any.
* Python deps are listed unpinned in `pyproject.toml` and pinned in `agent/requirements.txt` (generated with `uv pip freeze`).

## App
* **Expo SDK 57 / React Native 0.86**, Expo Router, Zustand, TypeScript strict (+ `noUncheckedIndexedAccess`). `babel.config.js` omitted: the Expo default is used.
* **Dependency versions** were taken from `expo/bundledNativeModules.json` and installed with npm because `npx expo install` needs `api.expo.dev`, which the build sandbox blocks. Versions match what `expo install` would choose. `react-dom` is pinned because npm otherwise resolves a peer to a React-incompatible version.
* **Share target: `expo-share-intent` 8.0.1.** It is an Expo config plugin (works with `expo prebuild`, no manual native edits), supports text, URLs, single and multiple files, and declares `expo ^57` as a peer. Alternatives such as `react-native-receive-sharing-intent` need manual native changes and are unmaintained.
* **File transfer** uses `expo-file-system/legacy` (`createUploadTask` with `BINARY_CONTENT`, `createDownloadResumable`) because it is the API that reports progress and streams from disk. Downloads go to the cache and are then handed to the Android share sheet (Save to Drive/Files, open in another app).
* **Cleartext HTTP** is enabled through `expo-build-properties` (`usesCleartextTraffic`) because Android 9+ blocks it otherwise and a LAN service has no public certificate. Trade-off: the whole app may use cleartext, and the token crosses the LAN unencrypted. Mitigation is Tailscale/trusted Wi-Fi (see `docs/SECURITY.md`). **Self-signed TLS with pinning (optional extra) is not implemented.**
* **Camera permission** only; `RECORD_AUDIO` is suppressed (`recordAudioAndroid: false`).
* **Tab icons are unicode glyphs**: SDK 57 no longer ships `@expo/vector-icons`, and one more dependency for five icons was not worth it.
* **Reconnect:** exponential backoff 1, 2, 4, 8, 15, 30 s (+20 % jitter), immediate retry on app foreground, 10 s ping with 25 s dead-link detection (laptop sleep / Wi-Fi drop).
* **Trackpad gestures:** react-native-gesture-handler `Race` of tap (left click), two-finger tap (right click), two-finger pan (scroll), long-press pan (drag and drop) and one-finger pan (move) with light acceleration; deltas batched at 16 ms.
* **Typed text** is sent as a block ("Type on laptop") rather than live per keystroke: IMEs/autocorrect make diffing keystrokes unreliable.
* Pairing also works from a `golesync://pair?...` link, and manually (address + token).

## CI / release
* `ci.yml` is reusable (`workflow_call`) so the release workflow runs the same checks first.
* The APK is built with Gradle (the Expo template signs release builds with the debug key), then **re-signed with `apksigner`** from the base64 keystore. This avoids depending on Gradle signing-property names that change between AGP versions.
* Version name from the tag (`APP_VERSION`), version code from `github.run_number` via `app.config.ts`.
