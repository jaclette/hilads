import { API_URL } from '@/constants';
import { appHeaders } from '@/lib/appVersion';

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
  /** Read response headers (e.g. ETag) before the body is parsed. */
  onHeaders?: (headers: Headers) => void;
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public body: any = null) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T = unknown>(
  path: string,
  options: FetchOptions = {},
): Promise<T> {
  const { params, headers: extraHeaders, onHeaders, ...rest } = options;

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
    // X-Platform (arrivals' platform, /app/config's versions) and X-App-Version
    // (update prompts; a call without it is an old app and can be blocked).
    ...appHeaders(),
    // Themes v2 keys (hidden_gem, taste...): without it the API answers with the v1 keys.
    'X-Themes': '2',
    // ...and the keys since (get_around): without it the API answers an older Wednesday key.
    'X-Themes-Rev': '4',
    // V4: this build asks the comparison question, so the API requires the answer on new proofs.
    'X-Compare': '1',
    ...(extraHeaders as Record<string, string>),
  };

  // Send auth via BOTH Cookie and Authorization: Bearer headers.
  //
  // iOS NSURLSession owns its own NSHTTPCookieStorage and will silently
  // strip manually-set Cookie headers in some configurations (notably
  // POSTs that reuse connections after the login response set a cookie).
  // /auth/me happened to work because NSURLSession's cookie jar caught
  // the Set-Cookie from the login response, but that jar empties under
  // conditions we can't reliably control - leading to "Authentication
  // required" failures on later POSTs even though the JS-side token is
  // perfectly fine.
  //
  // The PHP backend's AuthService::currentUser() reads $_COOKIE first,
  // then falls back to Authorization: Bearer (AuthService.php:158-162).
  // Sending both headers makes auth work regardless of which one iOS
  // decides to forward.
  if (authToken) {
    headers['Cookie']         = `hilads_token=${authToken}`;
    headers['Authorization']  = `Bearer ${authToken}`;
  }

  if (__DEV__) {
    console.log('[api]', (rest.method ?? 'GET').padEnd(6), url);
  }

  // 15s timeout - prevents indefinite hangs when the server is unreachable.
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

  onHeaders?.(res.headers);

  if (res.status === 204) return undefined as T;

  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new ApiError(res.status, body?.error ?? `HTTP ${res.status}`, body);
  }

  return body as T;
}

// Convenience methods
export const api = {
  get: <T>(path: string, options?: FetchOptions) =>
    request<T>(path, { method: 'GET', ...options }),

  /** GET with If-None-Match; a 304 throws ApiError(304). Returns the new ETag. */
  getWithEtag: async <T>(path: string, etag: string | null, options?: FetchOptions) => {
    let next: string | null = null;
    const data = await request<T>(path, {
      method: 'GET', ...options,
      headers: etag ? { 'If-None-Match': etag } : undefined,
      onHeaders: h => { next = h.get('etag'); },
    });
    return { data, etag: next as string | null };
  },

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

  patch: <T>(path: string, body?: unknown, options?: FetchOptions) =>
    request<T>(path, {
      method: 'PATCH',
      body: body !== undefined ? JSON.stringify(body) : undefined,
      ...options,
    }),
};
