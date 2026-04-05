# Hilads — MVP

## Vision

Hilads makes cities feel alive in real time.

Open the app → see who's around → jump into something happening now.

Not a chat app. A **live social layer on top of cities**.

---

## Core Experience

```
Open app
  → city auto-detected by geolocation (or picked manually)
  → see who's online, what events are happening, what people are talking about
  → chat, join an event, join a topic conversation, or create one
  → no sign-up required — instant Ghost mode
  → register to unlock profile, DMs, friends, vibes, and notifications
```

---

## Main Screens

| Screen | What it does |
|---|---|
| **Now** | Mixed live feed: events + topics, filters: All / Events / Topics |
| **Chat** | City chat — real-time public channel for the current city |
| **Cities** | Switch city, ranked by live activity score |
| **Here** | Who's online right now in the city |
| **Messages** | DMs + event chats (registered users) |
| **Me** | Profile, My Events, friends list |

> **Now** is the primary discovery screen. It replaces the old "Hot" screen and extends it with Topics — user-generated conversations that live alongside events.

---

## Identity

### Ghost (default)

- Instant entry — no sign-up
- Persistent identity: 32-char hex `guestId` stored in `localStorage` / `SecureStore`
- Nickname chosen on first join
- Full access to city chat, events, topics, including creating them
- Cannot access DMs, friends, vibes, or notifications

Ghost identity persists across sessions — the same `guestId` reattaches historical feed messages correctly.

### Registered

- Email + password or Google OAuth
- Persistent profile: display name, photo, home city, age, bio
- Unlocks: DMs, friends, vibe system, push notifications, full profile
- Seamless upgrade from ghost — history preserved
- Badge evolves automatically over time

---

## Now Feed

The central discovery screen. Shows what's happening in the city right now.

### Feed items

| Kind | Source | Description |
|---|---|---|
| `event` | Hilads (user-created or recurring) | One-shot events + venue series |
| `topic` | Hilads (user-created) | City conversation threads |
| `public_event` | Ticketmaster | External events (no participation tracking) |

### Sort order

1. Live events (currently ongoing) → sorted by start time
2. Everything else → sorted by most recent activity (`last_activity_at`)

### Filters

All / 🔥 Events / 💬 Topics — filter pills at the top of the screen.

### Feed item DTO

Both the web and native apps consume a single normalized `FeedItem` shape returned by `GET /channels/{id}/now`. Backend normalizes both events and topics to a consistent contract before sending:

- `kind` — `"event"` | `"topic"`
- `id`, `title`, `description`
- `event_type`, `source_type` (events only)
- `starts_at`, `ends_at`, `expires_at` (events only)
- `location`, `venue` (events only)
- `participant_count`, `is_participating` (hilads events only)
- `recurrence_label` (recurring events only)
- `active_now` — true if live event or recently active topic
- `last_activity_at` — last reply timestamp (topics only)
- `message_count` (topics only)
- `category` (topics only)

Public events are returned in a separate `publicEvents` array within the same response (to avoid a second HTTP round-trip on mobile).

---

## Topics

User-generated conversation threads attached to a city.

- Any user (ghost or registered) can create a topic
- Topics have a title, optional description, and category (`general`, `tips`, `food`, `drinks`, `help`, `meetup`)
- Topics appear in the Now feed alongside events
- Topics have their own chat screen — replies show in the topic thread
- Topics are visible even with 0 replies
- Topics expire after 24 hours of inactivity
- Join CTA links directly to the topic chat

Topics are distinct from city chat: they are scoped conversations, not a general chatroom.

---

## City Chat

- One public real-time chat channel per city
- Text + photo messages
- Messages shown in reverse-chronological order (newest at bottom)
- Initial load: 50 most recent messages
- Lazy loading: scroll up to fetch older messages (`before_id` cursor pagination)
- Rate-limited to prevent spam
- Real-time via WebSocket; 3s poll as fallback
- Messages retained for the current day only (cleaned up at midnight)
- System feed items injected for join events and presence changes

---

## Events

### One-shot events

- Created by any user (ghost or registered)
- Custom title, optional location hint, start/end time
- Each has its own real-time chat channel
- Auto-expire at `expires_at`

### Recurring events

- Seeded per city: bars, coffee shops, curated venues
- Daily/weekly/every-N-days schedule
- "↻ Every day" / "Mon · Wed · Fri" badge
- Only today's occurrence shown in the Now feed; all occurrences in Upcoming

### Public events (Ticketmaster)

- Ingested via Ticketmaster API
- Shown in Now feed (separate "🎫 Public Events" section) and Upcoming feed
- "Public" badge — no participant tracking, no event chat

### Event participants

- Any user (ghost or registered) can join
- Participant count shown on event card and event screen
- Participant list visible inside the event — tappable avatars + names
- Tapping a registered user opens their profile

### Event ownership

Creator can: replace "Join" with "✏️ Edit event", edit title/location/time, delete the event.

Ownership check: `guest_id = :guest_id OR created_by = :user_id`.

---

## Profile System

### Registered Profile

- Display name + avatar (photo or generated initial)
- Badge (Fresh / Regular — auto-evolving by account age)
- Vibe score (average rating) + vibe count + vibes received
- Friends list
- Add Friend / Message CTA

### Ghost Profile

- Generated avatar + nickname
- 👻 Ghost badge
- City context
- Client-side only — no API call

---

## Badge System

| Badge | Condition |
|---|---|
| 🌱 Fresh | Account < 2 months old |
| ⭐ Regular | Account ≥ 2 months old |

Computed from `users.created_at` at display time. No user action required.

---

## Vibe System

- Any registered user can leave a vibe (1–5 stars + optional message) on another user's profile
- One vibe per user pair — updatable; edits are silent (no repeated notification)
- Profile shows: vibe score, count, and vibe list
- Receiving a new vibe triggers in-app + push notification → deep-links to own profile

---

## Friends System

- From any registered user's profile: "Add Friend" CTA
- Currently one-directional (follow-style)
- Own friends list in the Me screen
- Friend addition triggers in-app + push notification

---

## Direct Messages

- Registered users only
- 1:1 private conversations
- History kept for 7 days, then auto-deleted

---

## Notifications

Registered users only.

### Notification types

| Type | Trigger | Deep-link |
|---|---|---|
| `dm_message` | New direct message | DM conversation |
| `event_message` | New message in event you joined | Event chat |
| `event_join` | Someone joined your event | Event |
| `new_event` | New event created while you're online | Event |
| `channel_message` | New message in city chat | City chat |
| `city_join` | Registered user arrived in your city | City chat |
| `friend_added` | Someone added you as friend | Their profile |
| `vibe_received` | Someone left a vibe | Your own profile |
| `profile_view` | Someone viewed your profile | Viewer's profile |

### Delivery

- **In-app bell** — polled every 30s; real-time via WebSocket when open
- **Web push** — browser VAPID push
- **Native push** — Expo Push API (Android working; iOS in progress)
  - Deep linking working: DM tap → DM, event tap → event
  - Foreground suppression: no alert when user is already on the relevant screen
  - Anti-noise cooldowns on high-frequency types

### Notification preferences

Per-user toggles per type, accessible from the Notifications tab.

---

## Presence

- Live user count per city
- "X joined" system messages in city chat
- WebSocket-driven: snapshot on join, live delta updates

---

## City Discovery

- 350+ cities worldwide
- Ranked by live score: `events × 10 + online users × 3 + messages × 1`
- Top 10 by default, full search available
- City row shows: event count, online users, message count

---

## Photos

- Share images in city chat, event chats, and direct messages
- Stored on Cloudflare R2

### Platform behavior

| Platform | Source |
|---|---|
| Native (iOS + Android) | Camera + photo library (via `expo-image-picker`) |
| Web (mobile browser) | Camera capture + library (via `accept="image/*"` — browser native sheet) |
| Web (desktop browser) | File picker (library only — no camera hardware) |

---

## Message Retention

| Channel | Retained | Deleted when |
|---|---|---|
| City chat | Current day | Older than today (daily cron) |
| Topic chat | While topic active | 24h after last activity |
| Event chat | While event active | 1h after event expires |
| Direct messages | 7 days | Older than 7 days (daily cron) |

---

## Landing Page

The landing page (`/`) is shown to unauthenticated users before they join a city.

- Shows a live preview of the detected city: online count, upcoming events, active topics
- Preview uses a three-tier fallback: Hilads events today → Ticketmaster public events → upcoming recurring events (next 7 days)
- "Join [City]" CTA drops the user directly into the city chat as a Ghost
- Sign up / Log in available as secondary actions for returning registered users
- Mobile store badges shown (apps coming soon)

---

## Recent UX Improvements

These changes reflect the current shipped state of the product.

### Profile screen — sticky CTA bar
- "Save profile" and "Sign out" are now fixed at the bottom of the screen, always visible regardless of scroll position
- Correct visual hierarchy: Save (full-width orange primary button) + Sign out (small muted text below)
- Safe area support on native (home indicator inset)

### Logo — platform consistency
- The Hilads logo SVG uses a unique gradient ID per instance (via React `useId()`)
- Fixes a rendering bug on mobile web where the responsive layout had two logo instances in the DOM simultaneously, causing the gradient to resolve incorrectly (dark / wrong colors) on the visible instance
- Logo now renders identically across desktop web, mobile web, and native

### Web camera capture
- `accept="image/*"` on chat image inputs (was `accept="image/jpeg,image/png,image/webp"`)
- On mobile browsers this triggers the native OS sheet with camera + library options
- Desktop behavior unchanged (file picker only)

---

## Architecture Concepts

### City Channels

`city_1`, `city_2`, etc. One per city. All users share the same channel. Parent of all event and topic subchannels.

### Event Subchannels

Hex-id channels of `type='event'`, parented to a city channel. Each has a `channel_events` row: timing, source type, series linkage, creator identity.

### Topic Subchannels

Hex-id channels of `type='topic'`, parented to a city channel. Each has a `channel_topics` row: title, description, category, expiry.

### event_series

Stores the recurrence rule for recurring events. Daily cron generates occurrence rows from each series. `ensureTodayOccurrences` runs as a post-response deferred call — never blocks the HTTP response.

### Feed DTO

`GET /channels/{id}/now` returns a single normalized response: `{ items: FeedItem[], publicEvents: FeedItem[] }`. Events and topics share a consistent top-level shape; kind-specific fields are present only where relevant. Web and mobile share the same contract — no client-side remapping.

### Real-time

WebSocket server handles presence snapshots and message push. PHP API broadcasts via fire-and-forget internal HTTP. 3s poll fallback for clients that can't hold a persistent WS connection. Topics use 5s polling (no WS room join yet).

---

## Performance Strategy

- **Initial message load**: 50 messages (not full history)
- **Lazy loading**: `before_id` cursor pagination — load older messages on scroll
- **Parallel requests on city join**: messages + events + topics fetched concurrently
- **Now screen**: single `/now` call returns events + topics + public events (no second request)
- **Double-load prevention**: 30s stale threshold in native Now screen prevents concurrent refetches on focus
- **Deferred writes**: `ensureTodayOccurrences` runs after response dispatch; never blocks API response time

---

## Admin Backoffice

Internal tool at `/admin` on the API service.

| Route | Description |
|---|---|
| `GET /admin` | Stats dashboard |
| `GET /admin/users` | Searchable user list (read-only) |
| `GET /admin/events` | Event list with status filters |
| `GET /admin/events/{id}/edit` | Edit event fields |
| `POST /admin/events/{id}/delete` | Soft delete |

---

## Analytics

PostHog — cross-platform, `platform` property on every event.

**Frontend intent events:** `landing_viewed`, `clicked_join_city`, `clicked_sign_up`, `clicked_sign_in`, `topic_opened`, `event_opened`

**Backend success events:** `guest_created`, `user_registered`, `user_authenticated`, `joined_city`, `sent_message`, `event_created`, `joined_event`, `friend_added`, `friend_removed`

---

## Observability

| Project | Platform |
|---|---|
| `hilads-web` | React (Vite) — `VITE_SENTRY_DSN` |
| `hilads-backend` | PHP — `SENTRY_DSN` |
| `hilads-mobile` | Expo / React Native — `EXPO_PUBLIC_SENTRY_DSN` |

Sentry is skipped if the DSN env var is not set — safe for local dev.

---

## Tech Stack

| Layer | Stack |
|---|---|
| Web frontend | React 18, Vite, mobile-first PWA |
| Native app | Expo SDK 52 + React Native, TypeScript |
| Backend | PHP 8.2, plain REST API, no framework |
| Database | PostgreSQL |
| Real-time | Node.js WebSocket + 5s poll fallback |
| Media | Cloudflare R2 |
| Hosting | Render (API + WS) · Vercel (web) · EAS (native builds) |
| Analytics | PostHog |
| Error monitoring | Sentry |

---

## What Is In Scope

- City-level public chat
- Events (one-shot, recurring, Ticketmaster public)
- Topics (user-generated city conversations)
- Ghost mode (instant, no signup)
- Registered accounts (optional upgrade)
- Presence and online user tracking
- Profile, vibes, badges, friends
- Direct messages (registered only)
- In-app + push notifications (registered only)
- Photo sharing in chats
- City discovery (350+ cities)
- Admin backoffice

## What Is Out of Scope

- Algorithmic ranking or recommendations
- Ticketing or paid events
- Content archival or export
- Follower graph / social feeds (beyond friends)
- Complex moderation or content review tools
- Real-time unread badge via WebSocket (currently polled every 30s)

---

## Known Issues

| Area | Issue |
|---|---|
| Mobile iOS | Push notifications not fully validated end-to-end on TestFlight |
| My Events | Recurring events may appear as duplicates in the My Events list |
| Topics | No WebSocket room join yet — uses 5s polling instead of real-time push |
| City chat | Scroll-to-bottom on open is inconsistent across platforms |
| Performance | Now feed endpoint p95 latency not yet benchmarked; DB indexes on participant counts and topic queries not fully optimised |

---

## Next Steps

### Push Notifications (iOS)
- Validate end-to-end on TestFlight (EAS production build)
- Verify APNs environment entitlement matches build type

### Topics — Real-time
- Add WS room join for topic channels to eliminate 5s polling
- Consistent with how city and event channels already work

### Performance
- Target < 300ms p95 on all feed endpoints
- Review DB indexes on participant counts, message feeds, topic queries
- Now screen skeleton loading state (show placeholders while loading)

### UX Consistency (Web vs Mobile) — remaining
- Audit Now screen, Event screen, DM screen for layout parity
- Fix input field overlap with bottom tab bar on native
- Profile screen: done ✓ (sticky CTA, action hierarchy)
- Logo: done ✓ (consistent across all platforms)

### Growth — First 100 Users in a City
- Focus on one city (local community, campus, or recurring venue)
- Ensure Now screen never feels empty (venue events always visible, topics always surfaced)
- Ghost mode: make the identity feel intentional, not a limitation
- Shareable deeplinks: `hilads.live/city/paris` → drops user directly into a city
- Track activation funnel: open → join city → first message → create/join event

---

## Product Rule

> **"Does this make the city feel more alive right now?"**
> If not → don't build it.
