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

// ── Event chat unread state ───────────────────────────────────────────────────

export interface EventChatPreview {
  count:     number;   // unread message count since last view (in-memory, resets on launch)
  preview:   string;   // last message text
  previewAt: string;   // ISO timestamp of last message
}

// ── Event participants ────────────────────────────────────────────────────────

export interface EventParticipant {
  guestId: string;
  nickname: string;
  joinedAt?: number;
}

// ── Badges ────────────────────────────────────────────────────────────────────

export interface Badge {
  key: 'ghost' | 'fresh' | 'regular' | 'local' | 'host';
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

export interface FriendUser {
  id: string;
  display_name: string;
  profile_photo_url?: string;
  vibe?: VibeKey;
  primaryBadge?: Badge;
}

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
  type: 'dm_message' | 'event_message' | 'event_join' | 'new_event';
  title: string;
  body: string;
  data: {
    conversationId?: string;
    eventId?: string;
    channelId?: string;
    senderName?: string;
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
