export type Pairing = { host: string; port: number; token: string };

const HOST_RE = /^(\[[0-9a-fA-F:]+\]|[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?)$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;

function parseQuery(query: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of query.split('&')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    const key = eq < 0 ? part : part.slice(0, eq);
    const val = eq < 0 ? '' : part.slice(eq + 1);
    try {
      out[decodeURIComponent(key)] = decodeURIComponent(val.replace(/\+/g, ' '));
    } catch {
      return {};
    }
  }
  return out;
}

export function validatePairing(p: { host?: unknown; port?: unknown; token?: unknown }): Pairing | null {
  const host = typeof p.host === 'string' ? p.host.trim() : '';
  const port = Number(p.port);
  const token = typeof p.token === 'string' ? p.token.trim() : '';
  if (!HOST_RE.test(host)) return null;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  if (!TOKEN_RE.test(token)) return null;
  return { host, port, token };
}

/** Parses the QR payload `golesync://pair?host=..&port=..&token=..`. */
export function parsePairing(data: string): Pairing | null {
  const trimmed = data.trim();
  const prefix = 'golesync://pair';
  if (!trimmed.toLowerCase().startsWith(prefix)) return null;
  const q = trimmed.indexOf('?');
  if (q < 0) return null;
  const params = parseQuery(trimmed.slice(q + 1).split('#')[0] ?? '');
  return validatePairing(params);
}

export function baseUrlFor(host: string, port: number): string {
  return `http://${host}:${port}`;
}

/** Accepts `192.168.1.5:8765`, `http://laptop.tailnet.ts.net:8765/` etc. Returns null if unusable. */
export function normalizeBaseUrl(input: string): string | null {
  let s = input.trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
  s = s.replace(/\/+$/, '');
  const m = /^(https?):\/\/(\[[0-9a-fA-F:]+\]|[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?)(:(\d{1,5}))?$/i.exec(s);
  if (!m) return null;
  const port = m[5] ? Number(m[5]) : undefined;
  if (port !== undefined && (port < 1 || port > 65535)) return null;
  return s;
}

export function wsUrlFor(baseUrl: string): string {
  return baseUrl.replace(/^http/i, 'ws') + '/v1/ws';
}
