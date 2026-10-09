# GoleSync protocol, version 1

All paths are prefixed `/v1`. The agent speaks plain HTTP/1.1 and WebSocket on one port
(default **8765**). Everything except `GET /health` and the loopback-only `/local/*` endpoints
requires the pairing token.

## Authentication

* **REST:** `Authorization: Bearer <token>` on every request. The token is **never** accepted
  in a query string (URLs end up in logs).
* **WebSocket:** after the upgrade the client's *first message* must be
  `{"type":"auth","token":"<token>"}` within 5 s. (A `Authorization: Bearer` header on the
  upgrade request is also accepted.) The token is never put in the WebSocket URL.
* The token is 256 random bits (`secrets.token_urlsafe(32)`), compared with `hmac.compare_digest`.
* 10 failed attempts from one address in 60 s lock that address out for the rest of the window
  (HTTP 429 / WS close code 4429), even for the right token.
* `golesync rotate-token` invalidates the old token at once and closes live sockets (code 4401).

Pairing QR payload: `golesync://pair?host=<ip-or-name>&port=<port>&token=<token>`.

## Limits

| What | Limit |
| --- | --- |
| JSON request body | 256 KiB (HTTP 413) |
| Text message (`POST /v1/text`) | 100 000 characters |
| File upload | `max_file_mb` (default 200 MB), enforced by `Content-Length` *and* while streaming (HTTP 413; partial file deleted) |
| HTTP requests | 600 / minute / address by default (`rate_limit_per_min`), HTTP 429 beyond that |
| WebSocket message | 8 KiB; 300 messages / second / connection (excess dropped); 25 invalid messages closes the socket (1008) |

## Errors

JSON `{"detail": "...", "code": "..."?}` with: `401` bad/missing token, `404` unknown id,
`409` + `code: "confirmation_required"`, `413` too large, `422` validation (unknown fields are
rejected everywhere), `423` agent paused, `429` rate limited.

## REST

| Method & path | Purpose |
| --- | --- |
| `GET /health` | Unauthenticated liveness: `{"status":"ok"}` and nothing else. |
| `GET /v1/pair/check` | Verify token; returns `{ok, name, protocol}`. |
| `GET /v1/status` | `{version, protocol, name, paused, wayland, input_backend, input_ok, clients, max_file_bytes}` |
| `POST /v1/text` | Body `{"text": str, "clipboard": bool = true}`. Copies to the laptop clipboard, shows a notification, records history. Returns `{item, copied}`. |
| `POST /v1/files?name=<filename>` | Raw request body = file bytes (`application/octet-stream`). Saved to the Inbox folder. The name is sanitised (basename only, no control chars, no leading dots, <= 200 bytes) and never overwrites: conflicts become `name (1).ext`. Returns `{item}`. |
| `GET /v1/inbox?after=<seq>&limit=` | Items the laptop sent to the phone (`direction: "to_phone"`), oldest first. |
| `GET /v1/history?limit=` | Both directions. |
| `GET /v1/inbox/{id}/file` | Download a laptop-to-phone file. `id` must be 32 hex chars and must belong to a `to_phone` file record; no client-supplied path ever touches the filesystem. |
| `GET /v1/commands` | `{commands:[{id,label,confirm}]}`: only enabled entries, argv is not revealed. |
| `POST /v1/commands/{id}/run` | Body `{"confirmed": bool}` (no other field is accepted). Runs the allow-listed command with that id. Returns `{id, exit_code, timed_out, detached, pid, output}` where `output` is the last 40 lines (max 8 KB) of combined stdout/stderr. `404` for unknown ids, `409 confirmation_required` if the entry has `confirm: true` and `confirmed` is not true, `423` when paused. |

An **item**: `{id, seq, direction: "to_laptop"|"to_phone", kind: "text"|"file", text, filename, size, created_at}`.
`seq` increases monotonically; use it with `?after=`.

## WebSocket `/v1/ws`

Client to server (after `auth`):

```json
{"type":"ping"}
{"type":"key","key":"right"}            // right left up down pagedown pageup home end enter backspace delete tab escape space f5
{"type":"media","action":"play_pause"}  // play_pause next previous volume_up volume_down mute
{"type":"mouse_move","dx":5,"dy":-3}    // each |value| <= 4000; coalesced by the agent
{"type":"mouse_click","button":"left","count":1}   // button: left|right|middle, count 1|2
{"type":"mouse_down","button":"left"}   {"type":"mouse_up","button":"left"}
{"type":"scroll","dx":0,"dy":3}         // wheel notches, positive dy = scroll down; |value| <= 200
{"type":"text","text":"hello"}          // typed on the laptop, <= 500 chars
```

Unknown types, unknown fields, or out-of-range values are rejected with an `error` message.
There is deliberately **no** event that executes a command or arbitrary key chord.

Server to client:

```json
{"type":"ready","v":1,"paused":false,"backend":"pynput"}   // after successful auth
{"type":"pong"}
{"type":"inbox","item":{...}}          // a new laptop-to-phone item, pushed live
{"type":"paused"} / {"type":"resumed"}  // kill switch changed; while paused events are dropped
{"type":"error","code":"bad_event"|"input_failed","message":"..."}
```

Close codes: `4401` authentication failed or token rotated, `4429` temporarily blocked,
`1008` too many invalid messages, `1009` message too large.

### Mouse movement

The phone batches deltas and sends at most ~60 messages/second. On the laptop each connection
has a dispatcher that applies events in order; consecutive pending `mouse_move` deltas are
**summed into one** move, so a slow input backend can never build up a queue of stale moves.
Any other event (click, key, ...) first flushes the pending move, so order is preserved.

### Android background behaviour

Android freezes background network activity. Live `inbox` pushes only arrive while the app
is open; when the app is opened it reconnects and calls `GET /v1/inbox`, so nothing is lost.

## Local-only endpoints (`/local/*`)

Used by the CLI and the laptop web page (`http://127.0.0.1:8765/local/`). Each request must
come from a loopback address, carry a loopback `Host` header (DNS-rebinding defence), and
every state-changing request must carry `X-GoleSync-Local: 1` (which a cross-site browser
request cannot add without a CORS preflight that the agent never grants). No token is used.

`GET /local/`, `GET /local/pair.svg`, `GET /local/state`, `POST /local/pause`,
`POST /local/resume`, `POST /local/send` `{text}`, `POST /local/send-file?name=` (raw body),
`POST /local/rotate-token`.
