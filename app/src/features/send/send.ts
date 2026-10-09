import { ApiClient, ApiError, type Item } from '../../services/api';
import { uploadFile, type Progress } from '../../services/transfer';
import { useConnection } from '../../store/connection';

export type Asset = { uri: string; name: string; size?: number | null };

export function formatBytes(n: number | null | undefined): string {
  if (n == null) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export async function sendText(api: ApiClient, text: string): Promise<{ item: Item; copied: boolean }> {
  const res = await api.sendText(text);
  useConnection.getState().addSent(res.item);
  return res;
}

/** Uploads one file after checking the size limit advertised by the laptop. */
export async function sendAsset(api: ApiClient, asset: Asset, maxBytes: number | null, onProgress?: Progress): Promise<Item> {
  if (maxBytes && asset.size && asset.size > maxBytes) {
    throw new ApiError('too_large', 413, `${asset.name} is ${formatBytes(asset.size)}; limit is ${formatBytes(maxBytes)}`);
  }
  const item = await uploadFile(api, asset.uri, asset.name, onProgress);
  useConnection.getState().addSent(item);
  return item;
}
