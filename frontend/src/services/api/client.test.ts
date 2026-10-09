import { afterEach, describe, expect, it, vi } from 'vitest';
import { authMeResponseSchema, syncMutationsResponseSchema } from '@memdev/contracts';
import { ApiClient, ApiError } from './client';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const authPayload = (accessToken: string) => ({
  user: { id: '00000000-0000-4000-8000-000000000001', email: 'user@example.com', displayName: null },
  accessToken,
  expiresIn: 600,
});

describe('ApiClient', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('parses successful JSON', async () => {
    const client = new ApiClient('', vi.fn().mockResolvedValue(json(200, { ok: true })));
    await expect(client.request('/example')).resolves.toEqual({ ok: true });
  });
  it('rejects successful JSON that does not match the response contract', async () => {
    const client = new ApiClient('', vi.fn().mockResolvedValue(json(200, { user: { id: 'not-a-uuid' } })));
    await expect(client.request('/auth/me', { responseSchema: authMeResponseSchema }))
      .rejects.toMatchObject({ status: 200, code: 'INVALID_RESPONSE', kind: 'unknown' });
  });
  it('includes credentials and the request marker on cookie auth endpoints', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const client = new ApiClient('', fetcher);
    await client.request<void>('/auth/logout', { method: 'POST', authenticated: false });
    expect(fetcher.mock.calls[0]?.[1]?.credentials).toBe('include');
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get('X-Memdev-Request')).toBe('1');
  });
  it.each([[400, 'validation'], [401, 'unauthenticated'], [403, 'forbidden'], [404, 'not_found'], [409, 'conflict'], [428, 'precondition_required'], [429, 'rate_limited']] as const)(
    'normalizes HTTP %i as %s', async (status, kind) => {
      const client = new ApiClient('', vi.fn().mockResolvedValue(json(status, { error: { code: 'TEST', message: 'Safe message' } })));
      await expect(client.request('/example', { authenticated: false })).rejects.toMatchObject({ status, kind, code: 'TEST' });
    },
  );
  it('normalizes network failures without leaking transport details', async () => {
    const client = new ApiClient('', vi.fn().mockRejectedValue(new Error('sensitive transport detail')));
    await expect(client.request('/example')).rejects.toMatchObject({ kind: 'network', message: expect.not.stringContaining('sensitive') });
  });
  it('refreshes once after 401 and retries with the new access token', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json(401, { error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } }))
      .mockResolvedValueOnce(json(200, authPayload('new-token')))
      .mockResolvedValueOnce(json(200, { ok: true }));
    const client = new ApiClient('', fetcher);
    client.setAccessToken('expired-token');
    await expect(client.request('/protected')).resolves.toEqual({ ok: true });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(new Headers(fetcher.mock.calls[2]?.[1]?.headers).get('Authorization')).toBe('Bearer new-token');
  });
  it('coalesces simultaneous 401 refreshes', async () => {
    let release!: (response: Response) => void;
    const delayedRefresh = new Promise<Response>((resolve) => { release = resolve; });
    const fetcher = vi.fn((url: string | URL | Request) => {
      if (String(url).endsWith('/auth/refresh')) return delayedRefresh;
      if (fetcher.mock.calls.filter(([u]) => !String(u).endsWith('/auth/refresh')).length <= 2)
        return Promise.resolve(json(401, { error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } }));
      return Promise.resolve(json(200, { ok: true }));
    });
    const client = new ApiClient('', fetcher);
    client.setAccessToken('old');
    const one = client.request('/a'); const two = client.request('/b');
    await Promise.resolve(); await Promise.resolve();
    release(json(200, authPayload('fresh')));
    await expect(Promise.all([one, two])).resolves.toEqual([{ ok: true }, { ok: true }]);
    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/auth/refresh'))).toHaveLength(1);
  });
  it('coalesces simultaneous explicit session checks', async () => {
    let release!: (response: Response) => void;
    const delayedRefresh = new Promise<Response>((resolve) => { release = resolve; });
    const fetcher = vi.fn().mockReturnValue(delayedRefresh);
    const client = new ApiClient('', fetcher);
    const first = client.refreshSession();
    const second = client.refreshSession();
    expect(fetcher).toHaveBeenCalledTimes(1);
    release(json(200, authPayload('fresh')));
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
  });
  it('preserves sync per-item results on HTTP 409', async () => {
    const client = new ApiClient('', vi.fn().mockResolvedValue(json(409, { results: [{ mutationId: 'id', status: 'conflict' }] })));
    const payload = { results: [{ mutationId: '00000000-0000-4000-8000-000000000001', status: 'conflict' }] };
    const parsedClient = new ApiClient('', vi.fn().mockResolvedValue(json(409, payload)));
    await expect(parsedClient.request('/sync/mutations', {
      method: 'POST', body: { mutations: [] }, responseSchema: syncMutationsResponseSchema,
    })).resolves.toEqual(payload);
    await expect(client.request('/sync/mutations', {
      method: 'POST', body: { mutations: [] }, responseSchema: syncMutationsResponseSchema,
    })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('clears auth and stops when refresh fails', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json(401, { error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } }))
      .mockResolvedValueOnce(json(401, { error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } }));
    const expired = vi.fn();
    const client = new ApiClient('', fetcher);
    client.setAccessToken('old');
    client.setOnAuthExpired(expired);
    await expect(client.request('/protected')).rejects.toBeInstanceOf(ApiError);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(expired).toHaveBeenCalledOnce();
  });
  it('clears authentication when the single retry is also unauthorized', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json(401, { error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } }))
      .mockResolvedValueOnce(json(200, authPayload('fresh')))
      .mockResolvedValueOnce(json(401, { error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } }));
    const expired = vi.fn();
    const client = new ApiClient('', fetcher);
    client.setAccessToken('old');
    client.setOnAuthExpired(expired);
    await expect(client.request('/protected')).rejects.toMatchObject({ status: 401 });
    expect(expired).toHaveBeenCalledOnce();
  });
});
