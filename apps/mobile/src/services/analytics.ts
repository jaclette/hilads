/**
 * Minimal analytics service.
 *
 * Dev:  logs to console
 * Prod: batches events and POSTs to /analytics/events every 5s
 *
 * Backend assumption: POST /api/v1/analytics/events { events: [...] }
 * Add this endpoint when backend is ready. The call is silent/non-fatal.
 *
 * Usage:
 *   track('event_opened', { eventId: '123', cityId: 'paris' });
 */
import { API_URL } from '@/constants';
import { getAuthToken } from '@/api/client';
import { Platform } from 'react-native';

// ── Event catalogue ───────────────────────────────────────────────────────────

export type AnalyticsEvent =
  | 'app_open'
  | 'city_selected'
  | 'message_sent'
  | 'event_opened'
  | 'event_joined'
  | 'event_created'
  | 'dm_opened'
  | 'dm_sent'
  | 'notification_opened'
  | 'push_permission_granted'
  | 'push_permission_denied'
  | 'auth_signup'
  | 'auth_login'
  | 'auth_logout'
  | 'landing_joined';

type Payload = Record<string, string | number | boolean | undefined | null>;

interface QueuedEvent {
  event:   AnalyticsEvent;
  payload: Payload | undefined;
  ts:      number;
}

// ── Queue + flush ─────────────────────────────────────────────────────────────

const queue: QueuedEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(flush, 5_000);
}

async function flush(): Promise<void> {
  flushTimer = null;
  if (queue.length === 0) return;
  const batch = queue.splice(0);
  try {
    const token = getAuthToken();
    await fetch(`${API_URL}/analytics/events`, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Cookie: `hilads_token=${token}` } : {}),
      },
      body: JSON.stringify({
        events: batch,
        platform: Platform.OS,
      }),
    });
  } catch {
    // Backend may not have this endpoint yet — silently discard
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function track(event: AnalyticsEvent, payload?: Payload): void {
  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.log('[analytics]', event, payload ?? '');
    return;
  }
  queue.push({ event, payload, ts: Date.now() });
  scheduleFlush();
}
