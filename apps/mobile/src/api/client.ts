import { API_URL } from '@/constants';

// ── Token store ───────────────────────────────────────────────────────────────
// React Native fetch doesn't handle cookies automatically.
// We intercept Set-Cookie on login and replay it on subsequent requests.
// For guest-only flows the token is not needed (guestId goes in the body).

let authToken: string | null = null;

export function setAuthToken(token: string | null): void {
  authToken = token;
}

export function getAuthToken(): string | null {
  return authToken;
}

// ── Core fetch wrapper ────────────────────────────────────────────────────────

interface FetchOptions extends RequestInit {
  params?: Record<string, string | number | undefined>;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T = unknown>(
  path: string,
  options: FetchOptions = {},
): Promise<T> {
  const { params, headers: extraHeaders, ...rest } = options;

  // Build URL with optional query params
  let url = `${API_URL}${path}`;
  if (params) {
    const qs = Object.entries(params)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&');
    if (qs) url += `?${qs}`;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(extraHeaders as Record<string, string>),
  };

  // Replay auth token as cookie if we have it
  if (authToken) {
    headers['Cookie'] = `hilads_token=${authToken}`;
  }

  if (__DEV__) {
    console.log('[api]', (rest.method ?? 'GET').padEnd(6), url);
  }

  // 15s timeout — prevents indefinite hangs when the server is unreachable.
  // The OS TCP timeout can be 75s+; this gives the caller a predictable failure.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15_000);

  let res: Response;
  try {
    res = await fetch(url, { headers, signal: controller.signal, ...rest });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[api] fetch failed:', (rest.method ?? 'GET'), url, '→', msg);
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }

  // Capture auth token from Set-Cookie header (login response)
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) {
    const match = setCookie.match(/hilads_token=([^;]+)/);
    if (match) authToken = match[1];
  }

  if (res.status === 204) return undefined as T;

  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new ApiError(res.status, body?.error ?? `HTTP ${res.status}`);
  }

  return body as T;
}

// Convenience methods
export const api = {
  get: <T>(path: string, options?: FetchOptions) =>
    request<T>(path, { method: 'GET', ...options }),

  post: <T>(path: string, body?: unknown, options?: FetchOptions) =>
    request<T>(path, {
      method: 'POST',
      body: body !== undefined ? JSON.stringify(body) : undefined,
      ...options,
    }),

  put: <T>(path: string, body?: unknown, options?: FetchOptions) =>
    request<T>(path, {
      method: 'PUT',
      body: body !== undefined ? JSON.stringify(body) : undefined,
      ...options,
    }),

  delete: <T>(path: string, body?: unknown, options?: FetchOptions) =>
    request<T>(path, {
      method: 'DELETE',
      body: body !== undefined ? JSON.stringify(body) : undefined,
      ...options,
    }),
};
