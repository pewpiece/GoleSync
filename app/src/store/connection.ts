import { create } from 'zustand';

import { ApiClient, ApiError, describeError, type Item, type Status } from '../services/api';
import { loadCache, saveCache } from '../services/cache';
import { ControlSocket, type ServerMessage, type SocketState } from '../services/socket';
import { clearConnection, loadConnection, saveConnection } from '../services/storage';

export type Link = 'unpaired' | 'connecting' | 'connected' | 'offline' | 'auth_failed';

type State = {
  hydrated: boolean;
  baseUrl: string | null;
  token: string | null;
  link: Link;
  paused: boolean;
  status: Status | null;
  inbox: Item[];
  sent: Item[];
  lastError: string | null;
  hydrate: () => Promise<void>;
  pair: (baseUrl: string, token: string) => Promise<void>;
  unpair: () => Promise<void>;
  connect: () => void;
  disconnect: () => void;
  reconnectNow: () => void;
  refresh: () => Promise<void>;
  api: () => ApiClient | null;
  sendEvent: (event: object) => boolean;
  addSent: (item: Item) => void;
  handleMessage: (m: ServerMessage) => void;
};

let socket: ControlSocket | null = null;

function mergeById(existing: Item[], incoming: Item[]): Item[] {
  const map = new Map(existing.map((i) => [i.id, i]));
  for (const i of incoming) map.set(i.id, i);
  return [...map.values()].sort((a, b) => a.created_at - b.created_at);
}

export const useConnection = create<State>((set, get) => ({
  hydrated: false,
  baseUrl: null,
  token: null,
  link: 'unpaired',
  paused: false,
  status: null,
  inbox: [],
  sent: [],
  lastError: null,

  async hydrate() {
    const [saved, cache] = await Promise.all([loadConnection(), loadCache()]);
    set({
      hydrated: true,
      inbox: cache.inbox,
      sent: cache.sent,
      ...(saved ? { baseUrl: saved.baseUrl, token: saved.token, link: 'connecting' as Link } : {}),
    });
    if (saved) get().connect();
  },

  async pair(baseUrl, token) {
    const api = new ApiClient({ baseUrl, token });
    await api.pairCheck(); // throws ApiError on bad token / unreachable laptop
    await saveConnection(baseUrl, token);
    get().disconnect();
    set({ baseUrl, token, link: 'connecting', lastError: null, paused: false });
    get().connect();
  },

  async unpair() {
    get().disconnect();
    await clearConnection();
    set({ baseUrl: null, token: null, link: 'unpaired', status: null, paused: false, lastError: null });
  },

  connect() {
    const { baseUrl, token } = get();
    if (!baseUrl || !token) return;
    socket?.stop();
    socket = new ControlSocket({
      baseUrl,
      token,
      onState: (s: SocketState) => {
        if (get().link === 'auth_failed') return;
        if (s === 'open') {
          set({ link: 'connected', lastError: null });
          void get().refresh();
        } else if (s === 'connecting') {
          set({ link: get().link === 'offline' ? 'offline' : 'connecting' });
        } else {
          set({ link: 'offline' });
        }
      },
      onMessage: (m) => get().handleMessage(m),
      onAuthFailed: () => set({ link: 'auth_failed', lastError: describeError(new ApiError('auth', 401, '')) }),
    });
    socket.start();
  },

  disconnect() {
    socket?.stop();
    socket = null;
  },

  reconnectNow() {
    socket?.reconnectNow();
  },

  api() {
    const { baseUrl, token } = get();
    return baseUrl && token ? new ApiClient({ baseUrl, token }) : null;
  },

  sendEvent(event) {
    return socket?.send(event) ?? false;
  },

  async refresh() {
    const api = get().api();
    if (!api) return;
    try {
      const [status, inbox, history] = await Promise.all([api.status(), api.inbox(), api.history()]);
      const sent = history.filter((i) => i.direction === 'to_laptop');
      set((s) => ({
        status,
        paused: status.paused,
        inbox: mergeById(s.inbox, inbox),
        sent: mergeById(s.sent, sent),
        lastError: null,
      }));
      const { inbox: i, sent: t } = get();
      void saveCache({ inbox: i, sent: t });
    } catch (e) {
      if (e instanceof ApiError && e.kind === 'auth') {
        set({ link: 'auth_failed', lastError: describeError(e) });
      } else {
        set({ lastError: describeError(e) });
      }
    }
  },

  addSent(item) {
    set((s) => ({ sent: mergeById(s.sent, [item]) }));
    const { inbox, sent } = get();
    void saveCache({ inbox, sent });
  },

  handleMessage(m) {
    switch (m.type) {
      case 'ready':
        set({ paused: m.paused });
        break;
      case 'paused':
        set({ paused: true });
        break;
      case 'resumed':
        set({ paused: false });
        break;
      case 'inbox': {
        set((s) => ({ inbox: mergeById(s.inbox, [m.item as Item]) }));
        const { inbox, sent } = get();
        void saveCache({ inbox, sent });
        break;
      }
      case 'error':
        set({ lastError: m.message });
        break;
      default:
        break;
    }
  },
}));
