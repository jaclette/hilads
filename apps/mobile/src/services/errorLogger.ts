/**
 * Structured error logger.
 *
 * Dev:  logs to console with full context
 * Prod: sends to /errors/report (silent, non-fatal)
 *
 * Uses direct fetch to avoid circular dependency with api/client.ts.
 *
 * Backend assumption: POST /api/v1/errors/report { message, context, platform, ts }
 * This endpoint is optional — errors degrade gracefully if missing.
 */
import { Platform } from 'react-native';
import { API_URL } from '@/constants';
import { getAuthToken } from '@/api/client';

export interface ErrorContext {
  screen?:  string;
  action?:  string;
  userId?:  string;
  [key: string]: unknown;
}

// ── Core logger ───────────────────────────────────────────────────────────────

export function logError(error: unknown, context?: ErrorContext): void {
  const message = error instanceof Error ? error.message : String(error);
  const stack   = error instanceof Error ? error.stack   : undefined;

  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.error('[error]', message, context ?? '', stack ?? '');
    return;
  }

  // Fire-and-forget in production
  sendToBackend({ message, stack, context, ts: Date.now() });
}

/** Log a failed API call. Skips expected status codes (401, 404). */
export function logApiError(
  path: string,
  status: number,
  message: string,
  context?: Omit<ErrorContext, 'action'>,
): void {
  // 401: unauthenticated (expected). 404: resource missing (often expected).
  if (status === 401 || status === 404) return;

  logError(new Error(`[API ${status}] ${path}: ${message}`), {
    ...context,
    action: 'api_call',
    path,
    status,
  });
}

// ── Internal ──────────────────────────────────────────────────────────────────

async function sendToBackend(payload: object): Promise<void> {
  try {
    const token = getAuthToken();
    await fetch(`${API_URL}/errors/report`, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Cookie: `hilads_token=${token}` } : {}),
      },
      body: JSON.stringify({ ...payload, platform: Platform.OS }),
    });
  } catch {
    // Silently discard — logging must never crash the app
  }
}
