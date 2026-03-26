// ── Identity ──────────────────────────────────────────────────────────────────

export interface GuestIdentity {
  guestId: string;    // 32-char hex UUID
  nickname: string;
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

// ── Messages ──────────────────────────────────────────────────────────────────

export interface Message {
  id: string;
  channel_id: string;
  type: 'text' | 'system' | 'image';
  event?: string;
  guest_id?: string;
  user_id?: string;
  nickname: string;
  content?: string;
  image_url?: string;
  created_at: string;  // ISO timestamp
}

// ── Presence ──────────────────────────────────────────────────────────────────

export interface OnlineUser {
  sessionId: string;
  guestId: string;
  userId?: string;
  nickname: string;
  profilePhotoUrl?: string;
  isRegistered: boolean;
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  email?: string;
  display_name: string;
  profile_photo_url?: string;
  home_city?: string;
  interests?: string[];
  guest_id?: string;
}

// ── WebSocket messages ────────────────────────────────────────────────────────

export interface WsMessage {
  type: string;
  channelId?: string;
  [key: string]: unknown;
}
