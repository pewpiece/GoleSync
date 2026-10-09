import * as FileSystem from 'expo-file-system/legacy';

import type { Item } from './api';

const path = () => `${FileSystem.documentDirectory}golesync-history.json`;
const MAX = 200;

export type Cached = { inbox: Item[]; sent: Item[] };

export async function loadCache(): Promise<Cached> {
  try {
    const raw = await FileSystem.readAsStringAsync(path());
    const parsed = JSON.parse(raw) as Partial<Cached>;
    return { inbox: parsed.inbox ?? [], sent: parsed.sent ?? [] };
  } catch {
    return { inbox: [], sent: [] };
  }
}

export async function saveCache(c: Cached): Promise<void> {
  try {
    await FileSystem.writeAsStringAsync(
      path(),
      JSON.stringify({ inbox: c.inbox.slice(-MAX), sent: c.sent.slice(-MAX) }),
    );
  } catch {
    // history is a convenience; never fail the app over it
  }
}
