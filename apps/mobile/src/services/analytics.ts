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
  | 'guest_signup_prompted'   // V3-11: the sign-up sheet opened, { action }
  | 'guest_signup_completed'  // V3-11: auth finished from the sheet, { action, method }
  | 'auth_login'
  | 'auth_logout'
  | 'user_authenticated'
  | 'viewed_profile'
  // Per-feature GPS permission funnel (requested only at feature use).
  | 'gps_permission_requested'
  | 'gps_permission_granted'
  | 'gps_permission_denied'
  | 'gps_city_corrected'
  | 'here_change'                 // Today: "Not in Saigon? Change" (ok: placed by GPS)
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
  | 'system_message_generated'
  // Daily Challenge (props: challenge_date, city, is_local + per-event fields).
  | 'daily_challenge_viewed'
  | 'daily_proof_started'
  | 'how_it_works_shown'
  | 'how_it_works_choice'
  | 'daily_proof_posted'
  | 'daily_push_permission'
  | 'daily_notification_opened'
  | 'daily_vote_cast'
  // Sharing (SPEC 9.14): { content_type, source } + share_completed { channel, activity? }; link_opened { content_type, utm_source }.
  // Share card redo: share_opened (the panel), share_template_selected { template, method }, share_target { channel, template },
  // share_link_visit { from, template } when a share card's link opens the app (the web landing sends its own).
  | 'share_started'
  | 'share_completed'
  | 'share_opened'
  | 'share_template_selected'
  | 'share_target'
  | 'share_link_visit'
  | 'link_opened'
  // Same challenge. Different worlds (SPEC 10.11): compare_answer_posted { type }, back_home_added { has_answer, has_price, has_line }.
  | 'compare_answer_posted'
  | 'back_home_added'
  | 'world_board_viewed'
  | 'world_teaser_tapped'
  // Yesterday around the world (SPEC 10.7): opened { source }, slide_viewed { city }, completed, shared.
  | 'world_tour_opened'
  | 'world_tour_slide_viewed'
  | 'world_tour_completed'
  | 'today_stories_opened'
  | 'map_play_here'
  | 'today_stories_completed'
  | 'world_tour_shared'
  // Today's photos (the feed): opened { source, pinned }, tab { tab }, viewed { index, city, tab }, challenge_opened.
  | 'daily_photos_opened'
  | 'daily_photos_tab'
  | 'daily_photos_viewed'
  | 'daily_photos_challenge_opened'
  // Today's country stories and mosaic: story { country, unseen }, tile { country }, play { has_photos }.
  | 'today_countries_story'
  | 'today_countries_tile'
  | 'today_pile_swipe'
  | 'today_countries_play'
  | 'today_countries_all'
  | 'today_countries_sort'
  | 'challenge_bubble_tapped'
  | 'challenge_cta_tapped'
  // The Hilads Index (SPEC 10.9): viewed { source, week }, shared { card }.
  | 'index_viewed'
  | 'index_shared'
  | 'index_carousel_swiped'
  | 'index_opened'
  | 'index_search_used'
  | 'two_cities_compared'
  | 'vote_cast'
  | 'vote_prompt_shown'
  | 'daily_twist_proposed'
  | 'daily_map_opened'
  | 'daily_leaderboard_viewed'
  | 'daily_week_strip_used'
  | 'daily_theme_filter_used'
  | 'daily_local_pass_earned'
  | 'daily_proposal_started'
  | 'daily_proposal_submitted'
  | 'daily_link_opened'
  // V3-07: the map of spots (SPEC 9.13)
  | 'map_viewed'
  | 'map_filter_used'
  | 'map_first_spot_tapped'
  | 'map_view_switched'
  | 'map_city_bubble_tapped'
  | 'map_list_sorted'
  | 'spot_opened'
  // V3-08: the place-based proof (SPEC 9.13)
  | 'place_picker_opened'
  | 'place_picked'
  | 'proof_too_far'
  | 'stamp_earned';

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
