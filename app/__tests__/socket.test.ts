import { ControlSocket, type ServerMessage } from '../src/services/socket';

class FakeWS {
  static instances: FakeWS[] = [];
  sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FakeWS.instances.push(this);
  }
  send(d: string) {
    this.sent.push(d);
  }
  close() {
    this.closed = true;
  }
  open() {
    this.onopen?.();
  }
  message(m: object) {
    this.onmessage?.({ data: JSON.stringify(m) });
  }
  drop(code = 1006) {
    this.onclose?.({ code });
  }
}

function make(extra: Partial<ConstructorParameters<typeof ControlSocket>[0]> = {}) {
  const states: string[] = [];
  const messages: ServerMessage[] = [];
  const onAuthFailed = jest.fn();
  const sock = new ControlSocket({
    baseUrl: 'http://10.0.0.2:8765',
    token: 'tok-123',
    onState: (s) => states.push(s),
    onMessage: (m) => messages.push(m),
    onAuthFailed,
    WebSocketImpl: FakeWS as never,
    backoff: [1000, 2000, 4000],
    random: () => 0,
    ...extra,
  });
  return { sock, states, messages, onAuthFailed };
}

const last = () => FakeWS.instances[FakeWS.instances.length - 1]!;

beforeEach(() => {
  FakeWS.instances = [];
  jest.useFakeTimers();
});
afterEach(() => jest.useRealTimers());

it('connects, authenticates with the token in the first message (not the URL)', () => {
  const { sock, states } = make();
  sock.start();
  expect(last().url).toBe('ws://10.0.0.2:8765/v1/ws');
  expect(last().url).not.toContain('tok-123');
  last().open();
  expect(JSON.parse(last().sent[0]!)).toEqual({ type: 'auth', token: 'tok-123' });
  expect(sock.send({ type: 'key', key: 'right' })).toBe(false); // not ready yet: nothing leaks out
  last().message({ type: 'ready', v: 1, paused: false, backend: 'pynput' });
  expect(states).toEqual(['connecting', 'open']);
  expect(sock.send({ type: 'key', key: 'right' })).toBe(true);
  expect(JSON.parse(last().sent[1]!)).toEqual({ type: 'key', key: 'right' });
});

it('reconnects with exponential backoff and resets after success', () => {
  const { sock } = make();
  sock.start();
  last().drop();
  expect(FakeWS.instances).toHaveLength(1);
  jest.advanceTimersByTime(999);
  expect(FakeWS.instances).toHaveLength(1);
  jest.advanceTimersByTime(2);
  expect(FakeWS.instances).toHaveLength(2); // after 1s
  last().drop();
  jest.advanceTimersByTime(2001);
  expect(FakeWS.instances).toHaveLength(3); // after 2s
  last().drop();
  jest.advanceTimersByTime(4001);
  expect(FakeWS.instances).toHaveLength(4); // after 4s
  last().drop();
  jest.advanceTimersByTime(4001);
  expect(FakeWS.instances).toHaveLength(5); // capped at 4s
  last().open();
  last().message({ type: 'ready', v: 1, paused: false, backend: 'x' });
  last().drop();
  jest.advanceTimersByTime(1001);
  expect(FakeWS.instances).toHaveLength(6); // back to 1s
});

it('does not retry when the laptop rejects the token (4401)', () => {
  const { sock, onAuthFailed } = make();
  sock.start();
  last().drop(4401);
  jest.advanceTimersByTime(60_000);
  expect(FakeWS.instances).toHaveLength(1);
  expect(onAuthFailed).toHaveBeenCalledTimes(1);
});

it('stop() cancels pending reconnects', () => {
  const { sock } = make();
  sock.start();
  last().drop();
  sock.stop();
  jest.advanceTimersByTime(60_000);
  expect(FakeWS.instances).toHaveLength(1);
});

it('reconnectNow skips the backoff wait', () => {
  const { sock } = make();
  sock.start();
  last().drop();
  sock.reconnectNow();
  expect(FakeWS.instances).toHaveLength(2);
});

it('detects a silent laptop via missed heartbeats and reconnects', () => {
  const { sock, states } = make({ heartbeatMs: 1000, staleMs: 2500 });
  sock.start();
  last().open();
  last().message({ type: 'ready', v: 1, paused: false, backend: 'x' });
  jest.advanceTimersByTime(1000);
  expect(JSON.parse(last().sent.at(-1)!)).toEqual({ type: 'ping' });
  jest.advanceTimersByTime(2000); // nothing heard for > 2.5 s
  expect(states.at(-1)).toBe('closed');
  jest.advanceTimersByTime(1001);
  expect(FakeWS.instances).toHaveLength(2);
});

it('forwards server messages and ignores garbage', () => {
  const { sock, messages } = make();
  sock.start();
  last().open();
  last().onmessage?.({ data: 'not json' });
  last().message({ type: 'paused' });
  expect(messages).toEqual([{ type: 'paused' }]);
});
