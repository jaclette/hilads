/**
 * Analytics service - PostHog backed.
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
  | 'event_opened'
  | 'event_created'
  | 'topic_opened'
  | 'challenge_opened'
  | 'challenge_created'
  | 'challenge_inspiration_create'
  | 'challenge_inspiration_open'
  | 'challenge_accepted'
  | 'challenge_validated'
  | 'challenge_unvalidated'
  | 'challenge_take_on'
  | 'calendar_day_tapped'
  | 'past_archive_opened'
  | 'past_archive_range'
  | 'dm_opened'
  | 'dm_sent'
  | 'dm_image_sent'
  | 'notification_opened'
  | 'notification_action'
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
  | 'viewed_profile'
  // Per-feature GPS permission funnel (requested only at feature use).
  | 'gps_permission_requested'
  | 'gps_permission_granted'
  | 'gps_permission_denied'
  | 'gps_city_corrected'
  // First-launch IP city detection (no GPS prompt).
  | 'first_launch_ip_detection_started'
  | 'first_launch_ip_detection_resolved'
  | 'first_launch_ip_detection_failed'
  | 'first_launch_city_picker_shown'
  | 'first_launch_city_selected'
  // World channel.
  | 'world_channel_viewed'
  | 'quiet_city_card_shown'
  | 'quiet_city_card_tapped'
  | 'system_message_generated';

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

export function resetAnalytics(): void {
  _ctx = {};
  if (!__DEV__) posthog.reset();
}
