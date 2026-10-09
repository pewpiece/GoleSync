import { wsUrlFor } from './pairing';

export type SocketState = 'connecting' | 'open' | 'closed';
export type ServerMessage =
  | { type: 'ready'; v: number; paused: boolean; backend: string }
  | { type: 'inbox'; item: unknown }
  | { type: 'paused' | 'resumed' | 'pong' }
  | { type: 'error'; code: string; message: string };

type WSCtor = new (url: string) => WebSocket;

export type SocketOptions = {
  baseUrl: string;
  token: string;
  onState: (s: SocketState) => void;
  onMessage: (m: ServerMessage) => void;
  onAuthFailed: () => void;
  WebSocketImpl?: WSCtor;
  /** reconnect delays in ms; the last one repeats */
  backoff?: number[];
  heartbeatMs?: number;
  staleMs?: number;
  random?: () => number;
};

/** Authenticated WebSocket that reconnects with exponential backoff and detects dead links. */
export class ControlSocket {
  private ws: WebSocket | null = null;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private beat: ReturnType<typeof setInterval> | null = null;
  private lastSeen = 0;
  private stopped = true;
  state: SocketState = 'closed';

  constructor(private o: SocketOptions) {}

  private get delays() {
    return this.o.backoff ?? [1000, 2000, 4000, 8000, 15000, 30000];
  }

  start() {
    this.stopped = false;
    this.open();
  }

  stop() {
    this.stopped = true;
    this.clearTimers();
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
      try {
        ws.close();
      } catch {
        // already closed
      }
    }
    this.setState('closed');
  }

  /** Reconnect right now (app returned to foreground, user pressed retry). */
  reconnectNow() {
    if (this.stopped) return;
    if (this.state === 'open') return;
    this.clearTimers();
    this.attempt = 0;
    this.detach();
    this.open();
  }

  send(msg: object): boolean {
    if (this.state !== 'open' || !this.ws) return false;
    try {
      this.ws.send(JSON.stringify(msg));
      return true;
    } catch {
      return false;
    }
  }

  private setState(s: SocketState) {
    if (this.state !== s) {
      this.state = s;
      this.o.onState(s);
    }
  }

  private clearTimers() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.beat) clearInterval(this.beat);
    this.retryTimer = this.beat = null;
  }

  private detach() {
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
      try {
        ws.close();
      } catch {
        // ignore
      }
    }
  }

  private open() {
    this.setState('connecting');
    const Impl = this.o.WebSocketImpl ?? (WebSocket as unknown as WSCtor);
    let ws: WebSocket;
    try {
      ws = new Impl(wsUrlFor(this.o.baseUrl));
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      // Token travels in the first message, never in the URL.
      ws.send(JSON.stringify({ type: 'auth', token: this.o.token }));
    };
    ws.onmessage = (ev: MessageEvent) => {
      this.lastSeen = Date.now();
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(ev.data)) as ServerMessage;
      } catch {
        return;
      }
      if (msg.type === 'ready') {
        this.attempt = 0;
        this.setState('open');
        this.startHeartbeat();
      }
      this.o.onMessage(msg);
    };
    ws.onerror = () => {
      // onclose follows; nothing to do here
    };
    ws.onclose = (ev: CloseEvent) => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.beat) clearInterval(this.beat);
      this.beat = null;
      this.setState('closed');
      if (ev.code === 4401) {
        this.stopped = true;
        this.o.onAuthFailed();
        return;
      }
      if (!this.stopped) this.scheduleReconnect();
    };
  }

  private startHeartbeat() {
    if (this.beat) clearInterval(this.beat);
    this.lastSeen = Date.now();
    const every = this.o.heartbeatMs ?? 10_000;
    const stale = this.o.staleMs ?? 25_000;
    this.beat = setInterval(() => {
      if (Date.now() - this.lastSeen > stale) {
        // laptop vanished (sleep, Wi-Fi drop): force a reconnect
        this.detach();
        this.setState('closed');
        if (this.beat) clearInterval(this.beat);
        this.beat = null;
        this.scheduleReconnect();
        return;
      }
      this.send({ type: 'ping' });
    }, every);
  }

  private scheduleReconnect() {
    if (this.stopped) return;
    const d = this.delays;
    const base = d[Math.min(this.attempt, d.length - 1)] ?? 30_000;
    this.attempt += 1;
    const jitter = base * 0.2 * (this.o.random ? this.o.random() : Math.random());
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (!this.stopped) this.open();
    }, base + jitter);
  }
}
