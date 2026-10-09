export type Item = {
  id: string;
  seq: number;
  direction: 'to_laptop' | 'to_phone';
  kind: 'text' | 'file';
  text: string | null;
  filename: string | null;
  size: number | null;
  created_at: number;
};

export type Status = {
  version: string;
  protocol: number;
  name: string;
  paused: boolean;
  wayland: boolean;
  input_backend: string;
  input_ok: boolean;
  clients: number;
  max_file_bytes: number;
};

export type CommandInfo = { id: string; label: string; confirm: boolean };
export type CommandResult = {
  id: string;
  exit_code: number | null;
  timed_out: boolean;
  detached: boolean;
  pid: number | null;
  output: string;
};

export type ApiErrorKind =
  | 'network'
  | 'timeout'
  | 'auth'
  | 'rate_limited'
  | 'paused'
  | 'too_large'
  | 'confirmation_required'
  | 'not_found'
  | 'http';

export class ApiError extends Error {
  constructor(
    public kind: ApiErrorKind,
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function describeError(e: unknown): string {
  if (e instanceof ApiError) {
    switch (e.kind) {
      case 'network':
        return 'Laptop unreachable. Is the agent running and are you on the same Wi-Fi?';
      case 'timeout':
        return 'The laptop took too long to answer.';
      case 'auth':
        return 'The laptop rejected this phone. Pair again (token may have been rotated).';
      case 'rate_limited':
        return 'Too many requests. Wait a moment and try again.';
      case 'paused':
        return 'Paused on the laptop (kill switch). Run `golesync resume` there.';
      case 'too_large':
        return 'That file is larger than the laptop allows.';
      default:
        return e.message;
    }
  }
  return e instanceof Error ? e.message : String(e);
}

export type ApiConfig = { baseUrl: string; token: string };
type FetchLike = typeof fetch;

export class ApiClient {
  constructor(
    public cfg: ApiConfig,
    private fetchImpl: FetchLike = (...a) => fetch(...a),
    private timeoutMs = 10_000,
  ) {}

  headers(extra?: Record<string, string>): Record<string, string> {
    return { Authorization: `Bearer ${this.cfg.token}`, ...extra };
  }

  async request<T>(method: string, path: string, body?: unknown, timeoutMs = this.timeoutMs): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(this.cfg.baseUrl + path, {
        method,
        headers: this.headers(body === undefined ? undefined : { 'Content-Type': 'application/json' }),
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (e) {
      if (ctrl.signal.aborted) throw new ApiError('timeout', 0, 'timeout');
      throw new ApiError('network', 0, e instanceof Error ? e.message : 'network error');
    } finally {
      clearTimeout(timer);
    }
    if (res.ok) return (await res.json()) as T;
    throw await toApiError(res);
  }

  pairCheck() {
    return this.request<{ ok: boolean; name: string; protocol: number }>('GET', '/v1/pair/check');
  }
  status() {
    return this.request<Status>('GET', '/v1/status');
  }
  sendText(text: string) {
    return this.request<{ item: Item; copied: boolean }>('POST', '/v1/text', { text });
  }
  async inbox(after = 0) {
    return (await this.request<{ items: Item[] }>('GET', `/v1/inbox?after=${after}`)).items;
  }
  async history() {
    return (await this.request<{ items: Item[] }>('GET', '/v1/history')).items;
  }
  async commands() {
    return (await this.request<{ commands: CommandInfo[] }>('GET', '/v1/commands')).commands;
  }
  runCommand(id: string, confirmed: boolean) {
    // The id is the only thing that identifies a command; the phone never sends command text.
    return this.request<CommandResult>(
      'POST',
      `/v1/commands/${encodeURIComponent(id)}/run`,
      { confirmed },
      10 * 60_000 + 5_000,
    );
  }
  uploadUrl(name: string) {
    return `${this.cfg.baseUrl}/v1/files?name=${encodeURIComponent(name)}`;
  }
  downloadUrl(id: string) {
    return `${this.cfg.baseUrl}/v1/inbox/${encodeURIComponent(id)}/file`;
  }
}

export async function toApiError(res: { status: number; text(): Promise<string> }): Promise<ApiError> {
  let detail = '';
  let code = '';
  try {
    const parsed = JSON.parse(await res.text()) as { detail?: unknown; code?: string };
    detail = typeof parsed.detail === 'string' ? parsed.detail : '';
    code = parsed.code ?? '';
  } catch {
    // non-JSON body
  }
  return errorFromStatus(res.status, detail, code);
}

export function errorFromStatus(status: number, detail = '', code = ''): ApiError {
  if (status === 401) return new ApiError('auth', status, detail || 'unauthorized');
  if (status === 429) return new ApiError('rate_limited', status, detail || 'rate limited');
  if (status === 423) return new ApiError('paused', status, detail || 'paused');
  if (status === 413) return new ApiError('too_large', status, detail || 'too large');
  if (status === 404) return new ApiError('not_found', status, detail || 'not found');
  if (status === 409 && code === 'confirmation_required')
    return new ApiError('confirmation_required', status, detail);
  return new ApiError('http', status, detail || `HTTP ${status}`);
}
