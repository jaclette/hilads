// ── Identity ──────────────────────────────────────────────────────────────────

export interface GuestIdentity {
  guestId:   string;    // 32-char hex UUID
  nickname:  string;
  channelId?: string;   // persisted after first city join; used for auto-rejoin
}

// ── City / Channel ────────────────────────────────────────────────────────────

export interface City {
  channelId: string;
  name: string;
  country: string;
  timezone: string;
  slug: string;
  onlineCount?: number;
  eventCount?: number;
  messageCount?: number;
  liveScore?: number;
}

// ── Events ────────────────────────────────────────────────────────────────────

export type EventType =
  | 'drinks' | 'party' | 'nightlife' | 'music' | 'live music'
  | 'culture' | 'art' | 'food' | 'coffee' | 'sport'
  | 'meetup' | 'other';

export interface HiladsEvent {
  id: string;
  title: string;
  location?: string;
  venue?: string;
  event_type: EventType;
  source_type: 'hilads' | 'ticketmaster';
  starts_at: number;    // unix timestamp
  ends_at?: number;
  expires_at: number;
  series_id?: string;
  recurrence_label?: string;
  guest_id?: string;
  created_by?: string;
  participant_count?: number;
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

/** Item in the /now mixed feed — either an event or a topic. */
export type NowItem =
  | (HiladsEvent & { kind: 'event' })
  | (Topic       & { kind: 'topic' });

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

export type BadgeKey = 'ghost' | 'fresh' | 'regular' | 'local' | 'host';

/** Badge metadata for rendering — badge labels/colors are a UI concern. */
export const BADGE_META: Record<BadgeKey, { label: string; color: string; bg: string; border: string }> = {
  ghost:   { label: '👻 Ghost', color: '#888',    bg: 'rgba(255,255,255,0.06)', border: 'rgba(255,255,255,0.10)' },
  fresh:   { label: '✨ Fresh', color: '#4ade80', bg: 'rgba(74,222,128,0.12)',  border: 'rgba(74,222,128,0.22)'  },
  regular: { label: 'Regular',  color: '#60a5fa', bg: 'rgba(96,165,250,0.12)',  border: 'rgba(96,165,250,0.22)'  },
  local:   { label: '🌍 Local', color: '#34d399', bg: 'rgba(52,211,153,0.12)',  border: 'rgba(52,211,153,0.22)'  },
  host:    { label: '⭐ Host',  color: '#fbbf24', bg: 'rgba(251,191,36,0.15)',  border: 'rgba(251,191,36,0.28)'  },
};

export interface UserDTO {
  id:          string;
  accountType: 'guest' | 'registered';
  displayName: string;
  avatarUrl:   string | null;
  /** Badge keys in priority order: primary badge first, context badge second if present. */
  badges:      BadgeKey[];
  vibe:        string | null;
  isFriend?:   boolean | null;
  isOnline?:   boolean | null;
}

/** Public profile — UserDTO + profile-specific extensions. */
export interface PublicProfile extends UserDTO {
  age?:       number | null;
  homeCity?:  string | null;
  interests?: string[];
  vibeScore?: number | null;
  vibeCount?: number;
  ambassadorPicks?: {
    restaurant?: string;
    spot?:       string;
    tip?:        string;
    story?:      string;
  } | null;
}

// ── Event participants ────────────────────────────────────────────────────────

/** Enriched event participant — UserDTO + when they joined. */
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

export interface Message {
  id?: string;                    // absent on some system messages
  channelId?: string;
  type: 'text' | 'system' | 'image' | 'event';
  event?: string;                 // system message subtype: 'join' | etc.
  guestId?: string;
  userId?: string;
  nickname: string;
  content?: string;               // text message body
  imageUrl?: string;              // image message URL (R2)
  createdAt: number | string;     // unix seconds (number) or ISO string
  eventId?: string;               // for type === 'event' synthetic feed items
  primaryBadge?: Badge;           // identity badge (ghost/fresh/crew)
  contextBadge?: Badge | null;    // city-specific badge (host/local)
  vibe?: string;                  // user's self-chosen vibe (party/coffee/…)
  // Optimistic send state — absent on confirmed server messages
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
  isRegistered: boolean;
  primaryBadge?: Badge;
  contextBadge?: Badge | null;
  vibe?: string;
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export type VibeKey = 'party' | 'board_games' | 'coffee' | 'music' | 'food' | 'chill';

export interface User {
  id: string;
  email?: string;
  display_name: string;
  profile_photo_url?: string;
  home_city?: string;
  interests?: string[];
  age?: number;
  vibe?: VibeKey;
  guest_id?: string;
  primaryBadge?: Badge;
  isFriend?: boolean;
}

/** Friends list items — canonical UserDTO shape. */
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
  // Optimistic send state — absent on confirmed server messages
  localId?: string;
  status?: 'sending' | 'failed';
}

// ── Notifications ─────────────────────────────────────────────────────────────

export interface Notification {
  id: number;
  type: 'dm_message' | 'event_message' | 'event_join' | 'new_event' | 'channel_message' | 'city_join' | 'friend_added' | 'vibe_received' | 'profile_view';
  title: string;
  body: string;
  data: {
    conversationId?: string;
    eventId?: string;
    channelId?: string;
    senderName?: string;
    senderUserId?: string;
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
