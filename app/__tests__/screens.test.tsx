import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Alert } from 'react-native';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));

import { bannerFor } from '../src/components/ConnectionBanner';
import { formatBytes, sendAsset } from '../src/features/send/send';
import { ApiClient } from '../src/services/api';
import { useConnection } from '../src/store/connection';
import CommandsScreen from '../app/(tabs)/commands';
import InboxScreen from '../app/(tabs)/index';

const TOKEN = 'a-valid-token-0123456789';
const requests: { url: string; init?: RequestInit }[] = [];

function mockServer(handlers: Record<string, (init?: RequestInit) => { status?: number; body: unknown }>) {
  requests.length = 0;
  global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    requests.push({ url, init });
    const path = url.replace(/^http:\/\/[^/]+/, '');
    const h = handlers[path];
    const r = h ? h(init) : { status: 404, body: { detail: 'nf' } };
    const status = r.status ?? 200;
    return { ok: status < 300, status, json: async () => r.body, text: async () => JSON.stringify(r.body) } as Response;
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  useConnection.setState({ baseUrl: 'http://10.0.0.2:8765', token: TOKEN, link: 'connected', paused: false, inbox: [], sent: [], lastError: null });
});

describe('Commands screen', () => {
  const commands = [
    { id: 'lock-screen', label: 'Lock screen', confirm: false },
    { id: 'suspend', label: 'Suspend laptop', confirm: true },
  ];

  it('lists commands and runs one by id', async () => {
    mockServer({
      '/v1/commands': () => ({ body: { commands } }),
      '/v1/commands/lock-screen/run': () => ({ body: { id: 'lock-screen', exit_code: 0, timed_out: false, detached: false, pid: null, output: 'locked' } }),
    });
    await render(<CommandsScreen />);
    await screen.findByLabelText('Lock screen');
    await fireEvent.press(screen.getByLabelText('Lock screen'));
    await screen.findByText('Exit code 0');
    expect(screen.getByText('locked')).toBeTruthy();
    const run = requests.find((r) => r.url.endsWith('/run'))!;
    expect(JSON.parse(run.init!.body as string)).toEqual({ confirmed: false });
  });

  it('asks before running a confirm command, and only then sends confirmed:true', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockServer({
      '/v1/commands': () => ({ body: { commands } }),
      '/v1/commands/suspend/run': () => ({ body: { id: 'suspend', exit_code: 0, timed_out: false, detached: false, pid: null, output: '' } }),
    });
    await render(<CommandsScreen />);
    await fireEvent.press(await screen.findByLabelText('Suspend laptop  (asks first)'));
    expect(alert).toHaveBeenCalled();
    expect(requests.some((r) => r.url.endsWith('/run'))).toBe(false); // nothing sent yet
    const buttons = alert.mock.calls[0]![2]!;
    await act(async () => {
      await buttons.find((b) => b.text === 'Run')!.onPress!();
    });
    await waitFor(() => expect(requests.some((r) => r.url.endsWith('/run'))).toBe(true));
    const run = requests.find((r) => r.url.endsWith('/run'))!;
    expect(JSON.parse(run.init!.body as string)).toEqual({ confirmed: true });
  });

  it('shows a clear error when the laptop is paused', async () => {
    mockServer({
      '/v1/commands': () => ({ body: { commands } }),
      '/v1/commands/lock-screen/run': () => ({ status: 423, body: { detail: 'agent is paused' } }),
    });
    await render(<CommandsScreen />);
    await fireEvent.press(await screen.findByLabelText('Lock screen'));
    await screen.findByText(/Paused on the laptop/);
  });

  it('shows an empty state with instructions', async () => {
    mockServer({ '/v1/commands': () => ({ body: { commands: [] } }) });
    await render(<CommandsScreen />);
    await screen.findByText('No commands yet');
  });

  it('shows an error state with retry when the laptop is unreachable', async () => {
    global.fetch = jest.fn(async () => {
      throw new TypeError('Network request failed');
    }) as unknown as typeof fetch;
    await render(<CommandsScreen />);
    await screen.findByText(/unreachable/i);
    expect(screen.getByLabelText('Retry')).toBeTruthy();
  });
});

describe('Inbox screen', () => {
  it('shows the pairing prompt when unpaired', async () => {
    useConnection.setState({ link: 'unpaired', baseUrl: null, token: null });
    await render(<InboxScreen />);
    expect(screen.getByText('Pair with your laptop')).toBeTruthy();
    expect(screen.getByLabelText('Scan QR code')).toBeTruthy();
  });

  it('shows how to send something when the inbox is empty', async () => {
    await render(<InboxScreen />);
    expect(screen.getByText('Inbox is empty')).toBeTruthy();
  });

  it('shows items newest first with a Copy button for text', async () => {
    useConnection.setState({
      inbox: [
        { id: 'a', seq: 1, direction: 'to_phone', kind: 'text', text: 'older', filename: null, size: null, created_at: 1 },
        { id: 'b', seq: 2, direction: 'to_phone', kind: 'text', text: 'newer', filename: null, size: null, created_at: 2 },
      ],
    });
    await render(<InboxScreen />);
    const texts = screen.getAllByText(/older|newer/).map((n) => n.props.children);
    expect(texts).toEqual(['newer', 'older']);
    expect(screen.getAllByLabelText('Copy')).toHaveLength(2);
  });
});

describe('connection banner', () => {
  it.each([
    ['unpaired', false, null, /Not paired/],
    ['offline', false, null, /unreachable/],
    ['auth_failed', false, null, /rejected/],
    ['connected', true, null, /Paused on laptop/],
  ])('%s', (link, paused, err, re) => {
    expect(bannerFor(link, paused, err)?.text).toMatch(re);
  });
  it('is hidden when everything is fine', () => {
    expect(bannerFor('connected', false, null)).toBeNull();
  });
});

describe('sending files', () => {
  it('refuses files above the laptop limit before uploading', async () => {
    const api = new ApiClient({ baseUrl: 'http://x:1', token: TOKEN });
    await expect(sendAsset(api, { uri: 'file:///a', name: 'big.bin', size: 5000 }, 1000)).rejects.toMatchObject({ kind: 'too_large' });
  });
  it('formats sizes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});
