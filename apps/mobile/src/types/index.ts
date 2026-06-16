// ── Identity ──────────────────────────────────────────────────────────────────

export interface GuestIdentity {
  guestId:   string;    // 32-char hex UUID
  nickname:  string;
  channelId?: string;   // persisted after first city join; used for auto-rejoin
  mode?:     ModeKey;   // Local / Exploring - chosen by guest, persisted locally
}

// ── City / Channel ────────────────────────────────────────────────────────────

export interface City {
  channelId:           string;
  name:                string;
  country:             string;
  timezone:            string;
  slug:                string;
  onlineCount?:        number;
  eventCount?:         number;
  topicCount?:         number;
  messageCount?:       number;
  recentMessageCount?: number;
  liveScore?:          number;
}

// ── Events ────────────────────────────────────────────────────────────────────

export type EventType =
  | 'drinks' | 'party' | 'nightlife' | 'music' | 'live music'
  | 'culture' | 'art' | 'food' | 'coffee' | 'sport'
  | 'meetup' | 'other';

/** Lightweight attendee shape embedded in event lists for the card avatar row. */
export interface ParticipantPreview {
  id: string;
  displayName: string;
  thumbAvatarUrl: string | null;
}

export interface HiladsEvent {
  id: string;
  title: string;
  location?: string;
  venue?: string;
  venue_lat?: number | null;   // precise venue coords when known (else maps falls back to address text)
  venue_lng?: number | null;
  event_type: EventType;
  source_type: 'hilads' | 'ticketmaster';
  starts_at: number;    // unix timestamp
  ends_at?: number;
  expires_at: number;
  created_at?: number;  // unix timestamp - when the event row was inserted
  series_id?: string;
  recurrence_label?: string;
  recurrence_type?: 'daily' | 'weekly' | 'every_n_days' | null;
  recurrence_weekdays?: number[];
  recurrence_interval?: number | null;
  guest_id?: string;
  created_by?: string;
  host_nickname?: string | null;
  participant_count?: number;
  participants_preview?: ParticipantPreview[];
  is_participating?: boolean;
  city_name?: string;
  city_channel_id?: string;
}

// ── Topics ────────────────────────────────────────────────────────────────────

export type TopicCategory = 'general' | 'tips' | 'food' | 'drinks' | 'help' | 'meetup';

export interface Topic {
  id:               string;
  city_id:          string;
  created_by:       string | null;
  guest_id:         string | null;
  title:            string;
  description:      string | null;
  category:         TopicCategory;
  message_count:    number;
  last_activity_at: number | null;  // unix timestamp
  active_now:       boolean;         // true if activity in last 30 min
  expires_at:       number;          // unix timestamp
  created_at:       number;          // unix timestamp
}

// ── Challenges (Défis) ────────────────────────────────────────────────────────
// Third primary entity alongside events + hangouts. Created in a city, accepted
// by other users, validated by the creator once complete. Persistent (no TTL).

export type ChallengeType     = 'food' | 'place' | 'culture' | 'help';
export type ChallengeAudience = 'locals' | 'explorers';
export type ChallengeStatus   = 'open' | 'validated';
export type ChallengeAcceptancePhase = 'pending' | 'accepted' | 'scheduled' | 'debrief' | 'approved' | 'rejected' | 'proof_submitted';

/** One challenge_acceptances row - the per-relationship thread (PR2). */
export interface ChallengeAcceptance {
  id:                  string;
  challenge_id:        string;
  acceptor_user_id:    string;
  thread_channel_id:   string;
  debrief_event_id:    string | null;
  phase:               ChallengeAcceptancePhase;
  /** PR4 - derived. Same as `phase` except 'scheduled' flips to 'debrief'
   *  once the meetup's end time has passed. Clients render off this. */
  effective_phase:     ChallengeAcceptancePhase;
  // PR3 - date concertation. Null until first proposal; rehydrated on every
  // propose/withdraw. date_approved_at is set when phase flips to 'scheduled'.
  proposed_starts_at:  number | null;
  proposed_ends_at:    number | null;
  proposed_venue:      string | null;
  proposed_by_user_id: string | null;
  proposed_at:         number | null;
  date_approved_at:    number | null;
  approved_at:         number | null;
  rejected_at:         number | null;
  created_at:          number;
  updated_at:          number;
}

/** Enriched thread row from GET /me/acceptances - for the "My threads" screen. */
export interface ChallengeThreadSummary {
  id:                   string;   // acceptance id
  challenge_id:         string;
  challenge_title:      string;
  challenge_type:       ChallengeType;
  /** Surfaced by getMineWithMeta so the threads list can branch the
   *  pipeline rendering (Local: 4-step; International: 3-step). */
  challenge_mode?:           'local' | 'international';
  challenge_target_city_id?: string | null;
  thread_channel_id:    string;
  debrief_event_id:     string | null;
  phase:                ChallengeAcceptancePhase;
  /** PR4 - see ChallengeAcceptance.effective_phase. */
  effective_phase:      ChallengeAcceptancePhase;
  // PR3 proposal state - null when no proposal pending.
  proposed_starts_at:   number | null;
  proposed_ends_at:     number | null;
  proposed_venue:       string | null;
  proposed_by_user_id:  string | null;
  proposed_at:          number | null;
  date_approved_at:     number | null;
  // PR4 - verdict timestamps.
  approved_at:          number | null;
  rejected_at:          number | null;
  created_at:           number;
  last_message_at:      number | null;
  last_message_content: string | null;
  i_am_creator:         boolean;
  /** Server-stamped primary acceptance for this (viewer, challenge) - the
   *  single "most actionable" row per challenge. Clients render the challenge
   *  pipeline off this without re-implementing the priority logic. */
  is_primary_for_challenge?: boolean;
  counterparty: {
    id:             string;
    displayName:    string;
    thumbAvatarUrl: string | null;
  };
}

/** Backend error code shape on accept-failure 403s. */
// `cap_reached` retired with the 1:1 model - still listed for back-compat
// in case an older API build returns it. `in_progress` is the new code.
export type AcceptFailureCode = 'not_creator' | 'mode_required' | 'mode_mismatch' | 'cap_reached' | 'in_progress' | 'completed';

/** Leaderboard scope/period selectors mirrored from GET /api/v1/leaderboard.
 *  'cities' ranks cities themselves (sum of their members' points), not users. */
export type LeaderboardScope  = 'city' | 'world' | 'cities';
export type LeaderboardPeriod = 'month' | 'alltime';

/** One row of the leaderboard list. Shape depends on scope:
 *  - 'city' / 'world' rows have user_id + displayName + thumbAvatarUrl.
 *  - 'cities' rows omit those and carry city_id + userCount instead.
 *  cityName / cityCountry / points are common. */
export interface LeaderboardEntry {
  rank:           number;
  // User row (city / world scope)
  user_id?:       string;
  displayName?:   string;
  thumbAvatarUrl?: string | null;
  // City row (cities scope)
  city_id?:       string;
  userCount?:     number;
  // Common
  points:         number;
  /** PR13 - caller's city + ISO country (e.g. "VN"). On world-scope user rows
   *  it pills next to the displayName; city scope hides it (everyone shares
   *  the same city). On cities-scope rows it IS the row (flag + city name). */
  cityName?:      string | null;
  cityCountry?:   string | null;
}

/** Full response shape for GET /api/v1/leaderboard. `me.rank` is null when
 *  the caller has no points in the requested scope/period - UI shows the
 *  "play to get on the board" prompt instead of a pinned row. */
export interface LeaderboardResponse {
  scope:     LeaderboardScope;
  period:    LeaderboardPeriod;
  city_id:   string | null;
  month_ref: string | null;
  limit:     number;
  offset:    number;
  entries:   LeaderboardEntry[];
  me: {
    user_id: string;
    rank:    number | null;
    points:  number;
  };
}

/** A single rate-eligible meet-up the caller has not rated yet - surfaced by
 *  GET /me/rate-prompts. The in-app banner on the threads screen reads off
 *  these; the rating sheet posts back to POST /challenges/:id/ratings. */
export interface RatePrompt {
  acceptance_id:   string;
  challenge_id:    string;
  challenge_title: string;
  /** Caller's role for this prompt - matches the trigger's role mapping. */
  role:            'challenger' | 'taker';
  counterparty: {
    id:             string;
    displayName:    string;
    thumbAvatarUrl: string | null;
  };
  /** Epoch seconds when the meet-up ended (or started, if no end set). May
   *  be null for legacy 'approved' rows where no proposal was recorded. */
  meetup_ended_at: number | null;
  /** True iff the OTHER party has already rated. Lets the banner warm the
   *  copy ("they're waiting on you") vs. a neutral nudge. */
  other_rated:    boolean;
}

export interface Challenge {
  id:                    string;
  city_id:               string;
  created_by:            string | null;
  guest_id:              string | null;
  title:                 string;
  challenge_type:        ChallengeType;
  audience:              ChallengeAudience;
  status:                ChallengeStatus;
  /** (Legacy) Cap on concurrent take-ons. Kept on the type for one release -
   *  the 1:1 model uses `is_in_progress` instead. The column still exists in
   *  the DB and is returned as-is for back-compat, but nothing reads it now. */
  max_participants:      number;
  /** "...and come share it with me" half of the prompt; pre-filled per type. Null = generic fallback. */
  return_clause:         string | null;
  /** Mode discriminator - 'local' (default, IRL meetup) or 'international'
   *  (cross-city, proof-based). Local challenges keep the existing audience
   *  + return_clause flow; international rows use target_city_id + proof_requirements. */
  mode?:                 'local' | 'international';
  /** Target city for International mode. Null = "anywhere" (no fan-out).
   *  Format: 'city_<int>' matching channels.id. Local rows: null. */
  target_city_id?:       string | null;
  /** ISO-2 country codes for the origin + target cities (server-resolved
   *  via the cached CityRepository). Used to render flag emojis on the
   *  International pill. target_country is null for "anywhere" / unknown. */
  country?:              string | null;
  target_country?:       string | null;
  /** PR15 - display name of the target city (e.g. "Berlin"). Surfaced in
   *  the International pill so it stays readable even when the flag emoji
   *  doesn't render on a given device. Null for "anywhere" / local rows. */
  target_city_name?:     string | null;
  /** Creator-authored proof spec shown to acceptors before they upload.
   *  International only - null on local rows. */
  proof_requirements?:   string | null;
  /** Validation method per challenge. International is locked to
   *  'photo_proof' server-side; local creators pick at creation.
   *  Default 'meet' preserves the historical IRL flow. */
  validation_method?:    'meet' | 'photo_proof';
  /** 1:1 model - true iff the challenge has a non-terminal acceptance right
   *  now. Drives the Available / In progress / Validated pill and gates the
   *  Accept (+) button. Backend computes via EXISTS over challenge_acceptances. */
  is_in_progress?:       boolean;
  /** One-shot rule: true once the challenge has been SUCCESSFULLY completed
   *  (an acceptance reached 'approved'). A completed challenge is closed for
   *  good - no new take-ons. Distinct from the reversible 'validated' archive. */
  closed?:               boolean;
  /** Privacy layer (web parity). 'public' default; 'friends' / 'private'
   *  hide the row from sitemap + city feed for non-entitled viewers. */
  visibility?:           'public' | 'friends' | 'private';
  /** Creator-only freeze for the participation gate. When true, /join refuses
   *  new joiners; existing participants stay. */
  closed_to_new_joins?:  boolean;
  /** Creator display info - null for pure-guest challenges. UI renders
   *  "by {creator_display_name}" on cards + detail header. */
  creator_display_name?:     string | null;
  creator_username?:         string | null;
  creator_thumb_avatar_url?: string | null;
  /** Versus-layout: the currently-active taker on this challenge. Resolved
   *  server-side from the most-recent non-rejected acceptance + the
   *  taker's users row. Null when nobody has taken it on (states 1 / 3).
   *  Stays populated through state 4 (validated) so the versus layout
   *  keeps both avatars visible after completion. acceptor_country is the
   *  taker's CURRENT-city ISO-2 (their flag = identity), distinct from
   *  the challenge's target_country. */
  acceptor_user_id?:          string | null;
  /** Phase of the active taker's acceptance (accepted | proof_submitted |
   *  approved | ...). Lets the creator's pipeline reflect the taker's real
   *  progress even though the creator has no acceptance of their own. */
  acceptor_phase?:            string | null;
  /** Id of the active taker's acceptance - lets the creator open the proof
   *  review + proof block (which fetch by acceptance id) without an
   *  acceptance of their own. */
  acceptor_acceptance_id?:    string | null;
  acceptor_display_name?:     string | null;
  acceptor_thumb_avatar_url?: string | null;
  acceptor_country?:          string | null;
  /** Monthly rank badges on the versus avatars (Top 10 + podium for
   *  Top 3). NULL = user is outside the relevant top-10 OR their
   *  cached score_month_ref is stale (month rollover). The card reads
   *  in_city for local challenges and worldwide for international,
   *  matching the duel's narrative scope. Both parties expose both
   *  scopes so the same DTO covers asymmetric cases (e.g. #1 in city
   *  duelling a worldwide-only newcomer). */
  creator_monthly_rank_in_city?:    number | null;
  creator_monthly_rank_worldwide?:  number | null;
  acceptor_monthly_rank_in_city?:   number | null;
  acceptor_monthly_rank_worldwide?: number | null;
  message_count:         number;
  last_activity_at:      number | null;   // unix timestamp
  validated_at:          number | null;   // unix timestamp; set when status flips to 'validated'
  created_at:            number;           // unix timestamp
  participants_preview:  ParticipantPreview[];
  participant_count:     number;
}

/** Item in the /now mixed feed - either an event or a topic. */
export type NowItem =
  | (HiladsEvent & { kind: 'event' })
  | (Topic       & { kind: 'topic' });

// ── Normalized /now feed DTO ──────────────────────────────────────────────────
// This is the canonical shape returned by GET /channels/{id}/now after
// backend normalization. Both web and native consume this same contract.
// Use FeedItem instead of NowItem for the Now screen rendering.

export interface FeedItem {
  kind:             'event' | 'topic' | 'challenge';
  id:               string;
  title:            string;
  description:      string | null;   // event location/venue OR topic description
  created_at:       number;          // unix timestamp
  last_activity_at: number | null;   // unix timestamp; null for events
  active_now:       boolean;         // live event OR topic active in last 30 min

  // ── Event-only fields (present when kind === 'event') ──────────────────────
  event_type?:        string;          // canonical - same value as legacy 'type'
  source_type?:       'hilads' | 'ticketmaster';
  starts_at?:         number;
  ends_at?:           number | null;
  expires_at?:        number;
  location?:          string | null;
  venue?:             string | null;
  venue_lat?:         number | null;   // precise venue coords (for NOW distance calc)
  venue_lng?:         number | null;
  participant_count?: number;
  participants_preview?: ParticipantPreview[];
  is_participating?:  boolean;
  recurrence_label?:  string | null;
  recurrence_type?:   'daily' | 'weekly' | 'every_n_days' | null;
  recurrence_weekdays?: number[];
  recurrence_interval?: number | null;
  series_id?:         string | null;
  guest_id?:          string | null;
  created_by?:        string | null;
  host_nickname?:     string | null;

  // ── Topic-only fields (present when kind === 'topic') ─────────────────────
  category?:      string;
  message_count?: number;
  city_id?:       string;

  // ── Challenge-only fields (present when kind === 'challenge') ─────────────
  // Subset of Challenge - enough for ChallengeVersusCard to render in past archive.
  challenge_type?: ChallengeType;
  audience?:       ChallengeAudience;
  status?:         'open' | 'validated';
  validated_at?:   number | null;
}

// ── Event chat unread state ───────────────────────────────────────────────────

export interface EventChatPreview {
  count:     number;   // unread message count since last view (in-memory, resets on launch)
  preview:   string;   // last message text
  previewAt: string;   // ISO timestamp of last message
}

// ── Canonical User DTO ────────────────────────────────────────────────────────
// Matches backend UserResource output. Used by all REST endpoints that return
// user data: public profile, friends, city crew, event participants.
// Note: /auth/me (own profile) still uses the legacy User shape below.

export type BadgeKey = 'ghost' | 'fresh' | 'regular' | 'host';

/** Badge metadata for rendering - badge labels/colors are a UI concern. */
export const BADGE_META: Record<BadgeKey, { label: string; color: string; bg: string; border: string }> = {
  ghost:   { label: '👻 Ghost', color: '#888',    bg: 'rgba(255,255,255,0.06)', border: 'rgba(255,255,255,0.10)' },
  fresh:   { label: '✨ Fresh', color: '#4ade80', bg: 'rgba(74,222,128,0.12)',  border: 'rgba(74,222,128,0.22)'  },
  regular: { label: '😎 Crew',   color: '#60a5fa', bg: 'rgba(96,165,250,0.12)',  border: 'rgba(96,165,250,0.22)'  },
  host:    { label: '👑 Legend', color: '#fbbf24', bg: 'rgba(251,191,36,0.15)',  border: 'rgba(251,191,36,0.28)'  },
};

export interface UserDTO {
  id:             string;
  accountType:    'guest' | 'registered';
  /** Unique @-handle. Null for guests (not mentionable) and un-backfilled legacy users. */
  username:       string | null;
  displayName:    string;
  avatarUrl:      string | null;
  /** Thumbnail URL (≤400 px). Falls back to avatarUrl server-side - never null when avatarUrl is set. */
  thumbAvatarUrl: string | null;
  /** Badge keys in priority order: primary badge first, context badge second if present. */
  badges:         BadgeKey[];
  vibe:           string | null;
  mode?:          string | null;
  isFriend?:      boolean | null;
  isOnline?:      boolean | null;
}

/**
 * Bounded read-time monthly ranks. Mirrors the PHP MonthlyRankService::ranksForUser
 * shape - used on profile screens (own + other) for the "#N in {city}" + "#N
 * worldwide" rows. null = outside the top 100 (top_n). score_month=0 + null
 * rank = no monthly score yet → "Not ranked this month" copy.
 */
export interface MonthlyRank {
  city:        number | null;
  global:      number | null;
  score_month: number;
  has_city:    boolean;
  top_n:       number;
}

/** Public profile - UserDTO + profile-specific extensions. */
export interface PublicProfile extends UserDTO {
  age?:       number | null;
  homeCity?:  string | null;
  /** Live last-geolocated city name. Distinct from homeCity (user-edited). Drives the rank-row "in X" label. */
  currentCity?: string | null;
  /** ISO country code for the currentCity - used to render the flag emoji on the rank row. */
  currentCityCountry?: string | null;
  aboutMe?:   string | null;
  interests?: string[];
  mode?:      ModeKey | null;
  vibeScore?: number | null;
  vibeCount?: number;
  ambassadorPicks?: {
    restaurant?: string;
    spot?:       string;
    tip?:        string;
    story?:      string;
  } | null;
  // Open friend request between viewer and this user, if any. Direction tells
  // the client which button to render: outgoing → "Request sent" (cancel),
  // incoming → "Accept request". Null when no request is pending.
  pendingFriendRequest?: {
    id:        string;
    direction: 'outgoing' | 'incoming';
  } | null;
  /** Monthly ranks (city + worldwide) - null beyond the top 100. */
  monthlyRank?: MonthlyRank | null;
}

// ── Event participants ────────────────────────────────────────────────────────

/** Enriched event participant - UserDTO + when they joined. */
export interface EventParticipant extends UserDTO {
  joinedAt?: number;
}

// ── Badges ────────────────────────────────────────────────────────────────────

export interface Badge {
  key: BadgeKey;
  label: string;
}

// ── Messages ──────────────────────────────────────────────────────────────────
//
// API returns camelCase. All field names here match the actual wire format.

/** Snapshot of the message being replied to, stored with the reply for resilience. */
export interface ReplyRef {
  id:       string;
  nickname: string;
  content:  string;
  type:     string;
}

export interface Reaction {
  emoji: string;
  count: number;
  self: boolean;   // true if current viewer has reacted with this emoji
}

export type { ReactionType } from '@/lib/reactionEmitter';

/** A resolved @mention on a message: span into content + the current username. */
export interface MentionRef {
  userId?:   string;   // member mention
  guestId?:  string;   // online-guest mention - anchored on the stable guest id
  username?: string;   // resolved current @name (members); guests render from content
  offset:    number;
  length:    number;
}

export interface Message {
  id?: string;                    // absent on some system messages
  channelId?: string;
  type: 'text' | 'system' | 'image' | 'event' | 'topic' | 'challenge' | 'challenge_validated' | 'activity' | 'prompt' | 'join_request';
  event?: string;                 // system message subtype: 'join' | etc.
  subtype?: string;               // activity/prompt subtype: 'crowd' | 'explore' | 'photo' | 'create-event'
  cta?: string;                   // prompt CTA button label
  guestId?: string;
  userId?: string;
  nickname: string;
  content?: string;               // text message body
  imageUrl?: string;              // image message URL (R2)
  createdAt: number | string;     // unix seconds (number) or ISO string
  eventId?: string;               // for type === 'event' synthetic feed items
  topicId?: string;               // for type === 'topic' synthetic feed items
  challengeId?: string;           // for type === 'challenge' synthetic feed items
  audience?: 'locals' | 'explorers'; // for type === 'challenge': picks the locale-aware verb template
  /** For type === 'challenge': the challenge's mode. Drives the
   *  international-specific copy variant (no audience distinction since
   *  the cross-city flow doesn't have locals/travelers semantics). */
  challengeMode?: 'local' | 'international';
  /** For type === 'challenge' with challengeMode='international': origin +
   *  target ISO-2 country codes. Render as flag emojis in the banner so the
   *  copy reads "🇫🇷 → 🇻🇳 International challenge: …" instead of leaning on
   *  the user's name (creators stay anonymous in the city feed). */
  challengeCountry?:       string | null;
  challengeTargetCountry?: string | null;
  // Snapshot of the challenge's open/validated state at the time the feed
  // pill is emitted. (Commit 1) `challengeCount` / `challengeMax` removed
  // with the cap model; commit 2 brings the field back with 1:1 semantics.
  challengeStatus?: 'open' | 'validated';
  primaryBadge?: Badge;           // identity badge (ghost/fresh/crew)
  contextBadge?: Badge | null;    // city-specific badge (host = Legend)
  vibe?: string;                  // user's self-chosen vibe (party/coffee/…)
  mode?: string;                  // user's current mode (local/exploring)
  replyTo?: ReplyRef;             // snapshot of the message this is a reply to
  mentions?: MentionRef[];        // @mentions resolved to current usernames by the backend
  reactions?: Reaction[];         // emoji reactions (empty array = none)
  editedAt?: number | null;       // unix seconds - present (truthy) if the message has been edited
  deletedAt?: number | null;      // unix seconds - present (truthy) for tombstoned messages (content blanked server-side)
  // Optimistic send state - absent on confirmed server messages
  localId?: string;               // temp id assigned client-side before server confirms
  status?: 'sending' | 'failed'; // undefined = confirmed
}

// ── Presence ──────────────────────────────────────────────────────────────────

export interface OnlineUser {
  sessionId: string;
  guestId: string;
  userId?: string;
  nickname: string;
  profilePhotoUrl?: string;
  profileThumbPhotoUrl?: string;
  isRegistered: boolean;
  primaryBadge?: Badge;
  contextBadge?: Badge | null;
  vibe?: string;
  mode?: string;
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export type VibeKey = 'party' | 'board_games' | 'coffee' | 'music' | 'food' | 'chill';
export type ModeKey = 'local' | 'exploring';

export interface User {
  id: string;
  email?: string;
  /** Unique @-handle. Null only for legacy users not yet backfilled. */
  username?: string | null;
  display_name: string;
  profile_photo_url?: string;
  /** Snake-case thumbnail URL (≤400 px) - same shape as profile_photo_url
   *  for callers that hold the raw account row from /me. Falls back to
   *  profile_photo_url server-side when no thumbnail was generated. */
  profile_thumb_photo_url?: string;
  /** Camel-case thumbnail URL - surfaced by UserResource DTOs (lists). */
  thumbAvatarUrl?: string | null;
  home_city?: string;
  about_me?: string | null;
  interests?: string[];
  age?: number;
  vibe?: VibeKey;
  mode?: ModeKey;
  guest_id?: string;
  primaryBadge?: Badge;
  isFriend?: boolean;
  /**
   * ISO-8601 timestamp of EULA acceptance, NULL until the user has accepted.
   * Apple G1.2 - existing users (created before the moderation update) get
   * the re-prompt modal once; new signups stamp this immediately via the
   * required checkbox.
   */
  eula_accepted_at?: string | null;
  /**
   * Set to TRUE the first time the user dismisses the public-default opt-in
   * modal on challenge create. Drives whether that modal appears on
   * subsequent submits.
   */
  has_seen_public_optin?: boolean;
  /**
   * Live source of truth for "what city is this user in." Server-side, updated
   * by the two-signal transition rule on /location/resolve and immediately by
   * manual switches via POST /me/city. Null when never resolved + no
   * home_city backfill match. Phase B: surfaced for clients to read; not yet
   * used to drive membership or notifications (those switch in Phase C/D).
   */
  current_city?: {
    channelId: number;
    name:      string;
    country:   string;
    timezone:  string;
  } | null;
  current_city_set_at?: string | null;
  /** Bounded monthly ranks for the own-profile rank row. See MonthlyRank shape. */
  monthly_rank?: MonthlyRank | null;
  /**
   * Badge keys mirroring UserResource::fromUser: primary first (ghost/fresh/
   * regular), then 'host' appended when the user is an ambassador in any city.
   * Used by isLegend() to gate the Legend-only manual city switch + other
   * ambassador surfaces. Backend always emits the array.
   */
  badges?: BadgeKey[];
}

/** Friends list items - canonical UserDTO shape. */
export type FriendUser = UserDTO;

// ── Conversations (DMs) ───────────────────────────────────────────────────────

export interface Conversation {
  id: string;
  updated_at: string;
  other_user_id: string;
  other_display_name: string;
  other_photo_url?: string;
  last_message?: string;
  last_message_at?: string;
  last_sender_id?: string;
  has_unread: boolean;
}

export interface DmMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  type?: 'text' | 'image';
  image_url?: string;
  created_at: string;
  sender_name: string;
  sender_photo?: string;
  replyTo?: ReplyRef;
  reactions?: Reaction[];
  edited_at?: string | null;   // ISO timestamp - present (truthy) when edited
  deleted_at?: string | null;  // ISO timestamp - present (truthy) for tombstoned messages
  // Optimistic send state - absent on confirmed server messages
  localId?: string;
  status?: 'sending' | 'failed';
}

// ── Friend requests ───────────────────────────────────────────────────────────

export interface FriendRequest {
  id:           string;
  sender_id:    string;
  receiver_id:  string;
  status:       'pending' | 'accepted' | 'declined' | 'cancelled';
  created_at:   string;
  updated_at?:  string;
  // Joined-user fields populated by listIncoming / listOutgoing endpoints + the
  // friendRequestReceived WS event. Absent on the bare row returned from
  // create / accept.
  other_user_id?:      string;
  other_display_name?: string;
  other_photo_url?:    string | null;
  other_vibe?:         string | null;
}

// ── Notifications ─────────────────────────────────────────────────────────────

export interface Notification {
  id: number;
  type:
    | 'dm_message' | 'event_message' | 'event_join' | 'new_event'
    | 'channel_message' | 'city_join'
    | 'friend_request_received' | 'friend_request_accepted' | 'friend_added' // friend_added kept for legacy rows
    | 'vibe_received' | 'profile_view';
  title: string;
  body: string;
  data: {
    conversationId?: string;
    eventId?: string;
    channelId?: string;
    senderName?: string;
    senderUserId?: string;
    accepterUserId?: string;
    accepterName?: string;
    requestId?: string;
    actorId?: string;
    actorName?: string;
    vibeId?: number;
    viewerId?: string;
    viewerName?: string;
  };
  is_read: boolean;
  created_at: string;
}

// ── WebSocket messages ────────────────────────────────────────────────────────

export interface WsMessage {
  type: string;
  channelId?: string;
  [key: string]: unknown;
}
