import {
  apiErrorEnvelopeSchema,
  authResponseSchema,
  type ApiErrorKind,
  type AuthResponse,
  type ContractSchema,
} from '@memdev/contracts';

type RequestOptions<T> = Omit<RequestInit, 'body'> & {
  body?: unknown;
  authenticated?: boolean;
  retryAuth?: boolean;
  responseSchema?: ContractSchema<T>;
};

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly kind: ApiErrorKind) {
    super(message);
    this.name = 'ApiError';
  }
}

function kindForStatus(status: number): ApiErrorKind {
  if (status === 401) return 'unauthenticated';
  if (status === 403) return 'forbidden';
  if (status === 400 || status === 422) return 'validation';
  if (status === 428) return 'precondition_required';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'server';
  return 'unknown';
}

export class ApiClient {
  private accessToken: string | null = null;
  private refreshPromise: Promise<AuthResponse> | null = null;
  private onAuthExpired: (() => void) | undefined;
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;

  constructor(baseUrl = import.meta.env.VITE_API_BASE_URL ?? '', fetcher: typeof fetch = fetch) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.fetcher = fetcher;
  }

  setAccessToken(token: string | null): void { this.accessToken = token; }
  setOnAuthExpired(callback: (() => void) | null): void { this.onAuthExpired = callback ?? undefined; }

  refreshSession(): Promise<AuthResponse> {
    if (!this.refreshPromise) {
      const request = this.request<AuthResponse>('/auth/refresh', {
        method: 'POST', authenticated: false, retryAuth: false, responseSchema: authResponseSchema,
      })
        .then((result) => {
          this.accessToken = result.accessToken;
          return result;
        }, (error: unknown) => {
          this.accessToken = null;
          throw error;
        });
      this.refreshPromise = request.finally(() => { this.refreshPromise = null; });
    }
    return this.refreshPromise;
  }

  async request<T>(path: string, options: RequestOptions<T> = {}): Promise<T> {
    const { body, authenticated = true, retryAuth = true, responseSchema, headers: inputHeaders, ...init } = options;
    const headers = new Headers(inputHeaders);
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    if (authenticated && this.accessToken) headers.set('Authorization', `Bearer ${this.accessToken}`);
    if (this.requiresRequestMarker(path)) headers.set('X-Memdev-Request', '1');

    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}${path}`, {
        ...init, headers, credentials: 'include',
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new ApiError(0, 'NETWORK_ERROR', 'Unable to reach the server. Check your connection and try again.', 'network');
    }

    if (response.status === 401 && authenticated && path !== '/auth/refresh') {
      if (retryAuth && await this.refreshAccessToken()) return this.request<T>(path, { ...options, retryAuth: false });
      this.accessToken = null;
      this.onAuthExpired?.();
    }

    if (!response.ok) {
      const payload: unknown = await response.json().catch(() => null);
      // Sync deliberately returns per-item outcomes with HTTP 400/409; preserve these results.
      if (path === '/sync/mutations' && (response.status === 400 || response.status === 409)
        && typeof payload === 'object' && payload !== null && 'results' in payload) {
        return this.validateResponse(payload, response.status, responseSchema);
      }
      const parsed = apiErrorEnvelopeSchema.safeParse(payload);
      const code = parsed.success ? parsed.data.error.code : `HTTP_${response.status}`;
      const message = parsed.success ? parsed.data.error.message : this.safeFallback(response.status);
      throw new ApiError(response.status, code, message, kindForStatus(response.status));
    }
    if (response.status === 204) return undefined as T;
    let payload: unknown;
    try { payload = await response.json(); }
    catch { throw this.invalidResponse(response.status); }
    return this.validateResponse(payload, response.status, responseSchema);
  }

  private async refreshAccessToken(): Promise<boolean> {
    try { await this.refreshSession(); return true; }
    catch { return false; }
  }

  private requiresRequestMarker(path: string): boolean {
    return ['/auth/register', '/auth/login', '/auth/refresh', '/auth/logout', '/auth/logout-all'].includes(path);
  }

  private safeFallback(status: number): string {
    if (status === 401) return 'Please sign in again.';
    if (status === 400 || status === 422) return 'Please check the submitted information.';
    if (status === 428) return 'Reload the item before making this change.';
    if (status === 404) return 'The requested item was not found.';
    if (status === 409) return 'This item changed. Refresh and try again.';
    if (status === 429) return 'Too many requests. Try again shortly.';
    if (status >= 500) return 'The server encountered an error. Try again later.';
    return `Request failed (${status}).`;
  }

  private validateResponse<T>(payload: unknown, status: number, schema?: ContractSchema<T>): T {
    if (!schema) return payload as T;
    const result = schema.safeParse(payload);
    if (!result.success) throw this.invalidResponse(status);
    return result.data;
  }

  private invalidResponse(status: number): ApiError {
    return new ApiError(status, 'INVALID_RESPONSE', 'The server returned an unexpected response.', 'unknown');
  }
}

export const apiClient = new ApiClient();
