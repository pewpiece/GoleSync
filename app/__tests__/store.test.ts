import type { Item } from '../src/services/api';
import * as SecureStore from 'expo-secure-store';

const sockets: any[] = [];
jest.mock('../src/services/socket', () => ({
  ControlSocket: jest.fn().mockImplementation((opts) => {
    const s = {
      opts,
      start: jest.fn(),
      stop: jest.fn(),
      send: jest.fn(() => true),
      reconnectNow: jest.fn(),
    };
    sockets.push(s);
    return s;
  }),
}));

import { useConnection } from '../src/store/connection';

const item = (id: string, text: string, seq: number, direction: Item['direction'] = 'to_phone'): Item => ({
  id,
  seq,
  direction,
  kind: 'text',
  text,
  filename: null,
  size: null,
  created_at: seq,
});

function fakeFetch(routes: Record<string, { status?: number; body: unknown }>) {
  global.fetch = jest.fn(async (url: string) => {
    const path = url.replace(/^http:\/\/[^/]+/, '').split('?')[0]!;
    const r = routes[path] ?? { status: 404, body: { detail: 'nf' } };
    const status = r.status ?? 200;
    return { ok: status < 300, status, json: async () => r.body, text: async () => JSON.stringify(r.body) } as Response;
  }) as unknown as typeof fetch;
}

const TOKEN = 'a-valid-token-0123456789';
const status = { version: '0.1.0', protocol: 1, name: 'lap', paused: false, wayland: false, input_backend: 'pynput', input_ok: true, clients: 1, max_file_bytes: 1000 };

beforeEach(async () => {
  sockets.length = 0;
  useConnection.setState({ hydrated: false, baseUrl: null, token: null, link: 'unpaired', paused: false, status: null, inbox: [], sent: [], lastError: null });
  await SecureStore.deleteItemAsync('golesync.token');
  await SecureStore.deleteItemAsync('golesync.baseUrl');
});

it('starts unpaired when nothing is stored', async () => {
  await useConnection.getState().hydrate();
  expect(useConnection.getState()).toMatchObject({ hydrated: true, link: 'unpaired' });
  expect(sockets).toHaveLength(0);
});

it('pairing verifies the token before saving it', async () => {
  fakeFetch({ '/v1/pair/check': { status: 401, body: { detail: 'invalid' } } });
  await expect(useConnection.getState().pair('http://10.0.0.2:8765', TOKEN)).rejects.toMatchObject({ kind: 'auth' });
  expect(await SecureStore.getItemAsync('golesync.token')).toBeNull();
  expect(useConnection.getState().link).toBe('unpaired');
});

it('pairs, stores credentials, connects and loads the inbox', async () => {
  fakeFetch({
    '/v1/pair/check': { body: { ok: true, name: 'lap', protocol: 1 } },
    '/v1/status': { body: status },
    '/v1/inbox': { body: { items: [item('a', 'hello', 1)] } },
    '/v1/history': { body: { items: [item('b', 'sent', 2, 'to_laptop')] } },
  });
  await useConnection.getState().pair('http://10.0.0.2:8765', TOKEN);
  expect(await SecureStore.getItemAsync('golesync.token')).toBe(TOKEN);
  expect(sockets).toHaveLength(1);
  sockets[0].opts.onState('open');
  await new Promise((r) => setTimeout(r, 0));
  const s = useConnection.getState();
  expect(s.link).toBe('connected');
  expect(s.inbox.map((i) => i.text)).toEqual(['hello']);
  expect(s.sent.map((i) => i.text)).toEqual(['sent']);
  expect(s.status?.max_file_bytes).toBe(1000);
});

it('live inbox messages are merged without duplicates; pause state follows the laptop', () => {
  const { handleMessage } = useConnection.getState();
  handleMessage({ type: 'inbox', item: item('a', 'one', 1) });
  handleMessage({ type: 'inbox', item: item('a', 'one', 1) });
  handleMessage({ type: 'inbox', item: item('b', 'two', 2) });
  expect(useConnection.getState().inbox.map((i) => i.id)).toEqual(['a', 'b']);
  handleMessage({ type: 'paused' });
  expect(useConnection.getState().paused).toBe(true);
  handleMessage({ type: 'resumed' });
  expect(useConnection.getState().paused).toBe(false);
});

it('goes offline when the socket drops and marks auth failures', async () => {
  useConnection.setState({ baseUrl: 'http://10.0.0.2:8765', token: TOKEN, link: 'connecting' });
  useConnection.getState().connect();
  sockets[0].opts.onState('closed');
  expect(useConnection.getState().link).toBe('offline');
  sockets[0].opts.onAuthFailed();
  expect(useConnection.getState().link).toBe('auth_failed');
  sockets[0].opts.onState('connecting'); // must not flip back
  expect(useConnection.getState().link).toBe('auth_failed');
});

it('refresh reports an unreachable laptop instead of throwing', async () => {
  useConnection.setState({ baseUrl: 'http://10.0.0.2:8765', token: TOKEN });
  global.fetch = jest.fn(async () => {
    throw new TypeError('Network request failed');
  }) as unknown as typeof fetch;
  await useConnection.getState().refresh();
  expect(useConnection.getState().lastError).toMatch(/unreachable/i);
});

it('unpair wipes credentials and state', async () => {
  fakeFetch({ '/v1/pair/check': { body: { ok: true, name: 'x', protocol: 1 } }, '/v1/status': { body: status }, '/v1/inbox': { body: { items: [] } }, '/v1/history': { body: { items: [] } } });
  await useConnection.getState().pair('http://10.0.0.2:8765', TOKEN);
  await useConnection.getState().unpair();
  expect(await SecureStore.getItemAsync('golesync.token')).toBeNull();
  expect(useConnection.getState()).toMatchObject({ link: 'unpaired', token: null });
  expect(sockets[0].stop).toHaveBeenCalled();
});

it('sendEvent goes through the socket and fails soft when there is none', () => {
  expect(useConnection.getState().sendEvent({ type: 'key', key: 'right' })).toBe(false);
  useConnection.setState({ baseUrl: 'http://10.0.0.2:8765', token: TOKEN });
  useConnection.getState().connect();
  expect(useConnection.getState().sendEvent({ type: 'key', key: 'right' })).toBe(true);
});
