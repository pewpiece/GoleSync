import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'golesync.token';
const URL_KEY = 'golesync.baseUrl';

export type Saved = { baseUrl: string; token: string } | null;

export async function loadConnection(): Promise<Saved> {
  try {
    const [baseUrl, token] = await Promise.all([
      SecureStore.getItemAsync(URL_KEY),
      SecureStore.getItemAsync(TOKEN_KEY),
    ]);
    return baseUrl && token ? { baseUrl, token } : null;
  } catch {
    return null;
  }
}

export async function saveConnection(baseUrl: string, token: string): Promise<void> {
  await SecureStore.setItemAsync(URL_KEY, baseUrl);
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function clearConnection(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(URL_KEY);
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch {
    // nothing stored / store unavailable
  }
}
