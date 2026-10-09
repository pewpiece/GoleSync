import * as FileSystem from 'expo-file-system/legacy';

import { ApiClient, ApiError, errorFromStatus, type Item } from './api';

export type Progress = (sent: number, total: number) => void;

/** Streams a local file to the laptop as a raw body (no multipart, no memory blow-up). */
export async function uploadFile(
  api: ApiClient,
  uri: string,
  name: string,
  onProgress?: Progress,
): Promise<Item> {
  const task = FileSystem.createUploadTask(
    api.uploadUrl(name),
    uri,
    {
      httpMethod: 'POST',
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: api.headers({ 'Content-Type': 'application/octet-stream' }),
    },
    (p) => onProgress?.(p.totalBytesSent, p.totalBytesExpectedToSend),
  );
  let res;
  try {
    res = await task.uploadAsync();
  } catch (e) {
    throw new ApiError('network', 0, e instanceof Error ? e.message : 'upload failed');
  }
  if (!res) throw new ApiError('network', 0, 'upload cancelled');
  if (res.status < 200 || res.status >= 300) {
    let detail = '';
    try {
      detail = (JSON.parse(res.body) as { detail?: string }).detail ?? '';
    } catch {
      // not JSON
    }
    throw errorFromStatus(res.status, detail);
  }
  return (JSON.parse(res.body) as { item: Item }).item;
}

export function safeLocalName(name: string): string {
  const base = name.replace(/\\/g, '/').split('/').pop() ?? 'file';
  const cleaned = base.replace(/[^\w.\- ()]/g, '_').replace(/^\.+/, '');
  return cleaned || 'file';
}

/** Downloads an Inbox file into the app cache. Returns the local file URI. */
export async function downloadFile(api: ApiClient, item: Item, onProgress?: Progress): Promise<string> {
  const dest = `${FileSystem.cacheDirectory}${item.id.slice(0, 8)}-${safeLocalName(item.filename ?? 'file')}`;
  const dl = FileSystem.createDownloadResumable(
    api.downloadUrl(item.id),
    dest,
    { headers: api.headers() },
    (p) => onProgress?.(p.totalBytesWritten, p.totalBytesExpectedToWrite),
  );
  let res;
  try {
    res = await dl.downloadAsync();
  } catch (e) {
    throw new ApiError('network', 0, e instanceof Error ? e.message : 'download failed');
  }
  if (!res) throw new ApiError('network', 0, 'download cancelled');
  if (res.status < 200 || res.status >= 300) {
    await FileSystem.deleteAsync(dest, { idempotent: true });
    throw errorFromStatus(res.status);
  }
  return res.uri;
}
