import { ApiClient, ApiError, describeError, errorFromStatus } from '../src/services/api';

function mockFetch(status: number, body: unknown, capture?: { req?: [string, RequestInit] }) {
  return jest.fn(async (url: string, init: RequestInit) => {
    if (capture) capture.req = [url, init];
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

const cfg = { baseUrl: 'http://10.0.0.2:8765', token: 'secret-token-value-123' };

describe('ApiClient', () => {
  it('sends the bearer token on every request and never in the URL', async () => {
    const cap: { req?: [string, RequestInit] } = {};
    const api = new ApiClient(cfg, mockFetch(200, { ok: true }, cap));
    await api.pairCheck();
    const [url, init] = cap.req!;
    expect(url).toBe('http://10.0.0.2:8765/v1/pair/check');
    expect(url).not.toContain('secret');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret-token-value-123');
  });

  it('posts JSON for text', async () => {
    const cap: { req?: [string, RequestInit] } = {};
    const api = new ApiClient(cfg, mockFetch(200, { item: { id: 'x' }, copied: true }, cap));
    const r = await api.sendText('hi');
    expect(r.copied).toBe(true);
    expect(cap.req![1].method).toBe('POST');
    expect(JSON.parse(cap.req![1].body as string)).toEqual({ text: 'hi' });
  });

  it('runs commands by id only, with no command text in the request', async () => {
    const cap: { req?: [string, RequestInit] } = {};
    const api = new ApiClient(cfg, mockFetch(200, { id: 'x', exit_code: 0 }, cap));
    await api.runCommand('git-pull', true);
    expect(cap.req![0]).toBe('http://10.0.0.2:8765/v1/commands/git-pull/run');
    expect(JSON.parse(cap.req![1].body as string)).toEqual({ confirmed: true });
  });

  it('url-encodes ids and file names', () => {
    const api = new ApiClient(cfg, mockFetch(200, {}));
    expect(api.runCommand).toBeDefined();
    expect(api.uploadUrl('a b/../c.txt')).toBe('http://10.0.0.2:8765/v1/files?name=a%20b%2F..%2Fc.txt');
    expect(api.downloadUrl('a/b')).toContain('a%2Fb');
  });

  it.each([
    [401, 'auth'],
    [429, 'rate_limited'],
    [423, 'paused'],
    [413, 'too_large'],
    [404, 'not_found'],
    [500, 'http'],
  ])('maps HTTP %i to %s', async (status, kind) => {
    const api = new ApiClient(cfg, mockFetch(status, { detail: 'nope' }));
    await expect(api.status()).rejects.toMatchObject({ kind, status });
  });

  it('maps confirmation_required', async () => {
    const api = new ApiClient(cfg, mockFetch(409, { detail: 'needs confirm', code: 'confirmation_required' }));
    await expect(api.runCommand('x', false)).rejects.toMatchObject({ kind: 'confirmation_required' });
  });

  it('maps a dead network to a friendly error', async () => {
    const f = jest.fn(async () => {
      throw new TypeError('Network request failed');
    }) as unknown as typeof fetch;
    const api = new ApiClient(cfg, f);
    const err = await api.status().catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.kind).toBe('network');
    expect(describeError(err)).toMatch(/unreachable/i);
  });

  it('times out hung requests', async () => {
    jest.useFakeTimers();
    const f = jest.fn(
      (_u: string, init: RequestInit) =>
        new Promise((_res, rej) => {
          init.signal!.addEventListener('abort', () => rej(new Error('aborted')));
        }),
    ) as unknown as typeof fetch;
    const api = new ApiClient(cfg, f, 5000);
    const p = api.status().catch((e) => e);
    await jest.advanceTimersByTimeAsync(5001);
    expect(await p).toMatchObject({ kind: 'timeout' });
    jest.useRealTimers();
  });
});

describe('errors', () => {
  it('describes every kind with something useful', () => {
    for (const status of [401, 423, 413, 429]) {
      expect(describeError(errorFromStatus(status)).length).toBeGreaterThan(10);
    }
    expect(describeError(new Error('boom'))).toBe('boom');
  });
});
