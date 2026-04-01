/**
 * Analytics service — PostHog backed.
 *
 * Keeps the same track() / identifyUser() API so all existing callers
 * continue to work without changes.
 *
 * Dev: logs to console only (PostHog disabled).
 * Prod: fires directly to PostHog EU cloud.
 */

import PostHog from 'posthog-react-native';

// ── Event catalogue ───────────────────────────────────────────────────────────

export type AnalyticsEvent =
  | 'app_open'
  | 'landing_viewed'
  | 'clicked_join_city'
  | 'clicked_sign_up'
  | 'clicked_sign_in'
  | 'landing_joined'
  | 'joined_city'
  | 'city_selected'
  | 'message_sent'
  | 'sent_message'
  | 'event_opened'
  | 'event_joined'
  | 'event_created'
  | 'dm_opened'
  | 'dm_sent'
  | 'notification_opened'
  | 'notification_clicked'
  | 'notifications_opened'
  | 'auth_gate_viewed'
  | 'profile_access_blocked'
  | 'push_permission_granted'
  | 'push_permission_denied'
  | 'auth_signup'
  | 'auth_login'
  | 'auth_logout'
  | 'user_authenticated'
  | 'viewed_profile';

type Payload = Record<string, string | number | boolean | undefined | null>;

// ── Shared context (auto-merged into every capture) ───────────────────────────

let _ctx: Payload = {};

export function setAnalyticsContext(ctx: Payload): void {
  _ctx = { ..._ctx, ...ctx };
}

// ── PostHog singleton ─────────────────────────────────────────────────────────

const posthog = new PostHog('phc_zz4Q6VJETesgBUkeKe8a9asUwbra9qGXgw4ff6zPTxLM', {
  host: 'https://eu.i.posthog.com',
  // Disable in dev so we don't pollute analytics with test data
  disabled: __DEV__,
});

// ── Public API ────────────────────────────────────────────────────────────────

export function track(event: AnalyticsEvent, payload?: Payload): void {
  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.log('[analytics]', event, { ..._ctx, ...payload });
    return;
  }
  posthog.capture(event, { platform: 'mobile', ..._ctx, ...payload });
}

export function identifyUser(id: string, props?: Payload): void {
  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.log('[analytics] identify', id, props ?? '');
    return;
  }
  posthog.identify(id, props);
}
