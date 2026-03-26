# Hilads — MVP v6

## Vision

Hilads makes cities feel alive in real time.

Open the app → see who's around → jump into something happening now.

Not a chat app. A live social layer on top of cities.

---

## Core Experience

```
Open app
  → city auto-detected by geolocation (or picked manually)
  → see who's online + what's happening
  → chat, join an event, or create one
  → no sign-up required
```

---

## Main Screens

| Screen | What it does |
|---|---|
| **Hot** | Active events in the current city |
| **Cities** | Switch city — ranked by live activity |
| **Here** | Who's online right now in the city |
| **Me** | Profile + My Events (registered users) |
| **Messages** | DMs + event chats (registered users) |

---

## Features

### Identity

**Guest** (default)
- Instant entry — no sign-up
- Temporary identity: UUID + nickname stored in localStorage
- Full access to city chat and events, including creating events

**Registered**
- Email + password or Google OAuth
- Persistent profile: display name, photo, home city, age, interests
- Unlocks: DMs, Messages screen, persistent event ownership across sessions
- Seamless upgrade from guest — history and ownership preserved

---

### City Chat

- One public chat channel per city
- Text + photo messages
- Rate-limited to prevent spam
- Real-time via WebSocket, 3s poll as fallback
- Messages kept for current day only (cleaned up at midnight)
- Feed prompts injected client-side when activity is low

---

### Events — Hot Screen

Two types of events co-exist in the Hot screen:

**One-shot events**
- Created by any user (guest or registered)
- Custom title, optional location hint, start/end time
- Each has its own real-time chat
- Expire automatically at `expires_at`
- Event chat deleted when the event ends

**Recurring events**
- Seeded per city: bars, coffee shops, curated venues
- Daily schedule (e.g. bars: 18:00–01:00, cafés: 10:00–18:00)
- Displayed with "↻ Every day" badge (or weekly schedule)
- Appear as "happening now" based on current time
- Only today's occurrence is shown in Hot

---

### Event Ownership

Every event belongs to its creator — tracked via dual identity:

- `guest_id` — UUID cookie (all users)
- `created_by` (`user_id`) — persistent UUID for registered users

**Creator capabilities:**
- Replace "Join" CTA with "✏️ Edit event"
- Edit title, location, time
- Delete the event (with confirmation)

**Creator UX signals:**
- "👑 Your event" badge in the event header
- Owner-prompt card injected at the top of event chat on first open
- Edit button pulse animation on first render

**Ownership on recurring events:**
- Ownership belongs to the `event_series` row, not individual occurrences
- Creator can edit or delete the entire series

---

### Event Lifecycle

```
Guest/registered user creates event
  → event is inserted into channel_events
  → creator is auto-joined as first participant
  → city online users are notified (push + in-app)
  → creator sees Edit CTA instead of Join

Creator can edit:
  → update title, location, start/end time

Creator can delete:
  → soft delete: status = 'deleted', expires_at = now()
  → event disappears from Hot, Messages, city lists
  → event chat is purged on next cleanup run
```

---

### Event Subchannels

- Every event has its own real-time chat
- Text + photo messages
- Visible to anyone in the city
- Messages deleted when the event expires (+1h buffer)

---

### Recurring Events — How They Work

Each recurring series (`event_series`) stores the recurrence rule.
Daily occurrences are generated into `channel_events` via a 7-day lookahead cron.
Only today's occurrence is surfaced in Hot and Messages.

Source: curated static dataset — 10 cities × ~7 venues each (bars + cafés).

**Recurrence types:** daily, weekly (specific weekdays)
**Labels:** "Every day", "Mon / Wed / Fri", etc. — computed from series rule

---

### My Events

Shows events created by the user — available in the **Me** tab.

Rules:
- One-shot events: shown with exact start → end time
- Recurring events: shown **once per series** (nearest upcoming occurrence)
  - Deduplicated server-side: first upcoming occurrence wins
  - Meta line shows recurrence label (e.g. "Every day · 18:00") instead of a specific date
  - Badge shows "↻ Recurring" instead of "Upcoming"
- Live events: badge shows "Live"
- Expired events: not shown

---

### Direct Messages

- Registered users only
- 1:1 private conversations
- History kept for 7 days, then auto-deleted

---

### Notifications

- Registered users only
- In-app notification feed (bell icon in header)
- Unread badge polled every 30s
- Triggered by: new DM, new event message, new event in city
- Web push (browser push notifications) — users who grant permission
- Push delivered via VAPID / Web Push Protocol
- Per-user preferences: toggle push on/off per notification type
- Notification click deep-links into the relevant screen
- Expired push subscriptions cleaned up automatically (410 responses)

---

### Presence

- Live user count per city
- "X joined" system messages in city chat
- Guest vs registered badge on user rows
- WebSocket-driven: snapshot on join, live updates

---

### City Discovery

- 350 cities worldwide
- Ranked by live score: `events × 10 + online users × 3 + messages × 1`
- Top 10 shown by default, full search available
- City row shows: event count, online users, message count
- Event count = today's active events only

---

### Photos

- Share images in city chat and event chats
- Stored on Cloudflare R2

---

## Message Retention

| Channel | Kept | Deleted |
|---|---|---|
| City chat | Current day | Older than today (daily cron) |
| Event chat | While event is active | 1h after event ends |
| Direct messages | 7 days | Older than 7 days (daily cron) |

Cleanup is handled by a scheduled job — not during user requests.

---

## Architecture Concepts

### City Channels
`city_1`, `city_2` etc. One per city. All users share the same channel.
Parent of all event subchannels.

### Event Subchannels
Hex-id channels of `type='event'`, parented to a city channel.
Each has a `channel_events` row with: timing, source, series linkage, and creator identity (`created_by`).

### event_series
Stores the recurrence rule for recurring events.
Each series generates occurrence rows in `channel_events` with an `occurrence_date`.
The series is the source of truth — occurrences are ephemeral and regenerated daily.

### Event ownership model
```
channel_events.guest_id     — creator's guest UUID (always set)
channel_events.created_by   — creator's user UUID (set if registered)
```
Ownership check: `guest_id = :guest_id OR created_by = :user_id`

### source_key
Stable fingerprint for seeded series: `static:v1:city_{id}:{slug}:{category}`.
Ensures the seed is idempotent — re-running it skips already-created series.

### Real-time
WebSocket server handles presence snapshots and message push.
PHP API uses a fire-and-forget internal HTTP call to broadcast events.
3-second poll is the fallback for clients that can't maintain a WS connection.

### Non-fatal side effects
Auto-join and city notification on event creation are wrapped in try/catch.
If they fail (e.g. schema lag), the event itself is already created and a 201 is returned.
Schema migrations are applied idempotently inside `Database::pdo()` on first connection.

---

## What Is In Scope

- City chat (public, ephemeral)
- Events: one-shot + recurring
- Event ownership: create, edit, delete
- Event subchannels
- My Events (deduplicated, per creator)
- Direct messages (registered users)
- Presence + user discovery
- Profile (registered users)
- City switching + discovery
- Curated recurring venue seed (10 cities)
- Message retention via daily cleanup
- In-app notifications + web push (registered users)
- Feed prompts (client-side engagement nudges)

---

## What Is Out of Scope

- Followers, feeds, social graph
- Algorithmic ranking or recommendations
- Ticketing or paid events
- Archival or export
- Mobile native app
- Push notification batching/throttling
- Real-time unread badge via WebSocket (currently polled)

---

## Product Rule

> **"Does this make the city feel more alive right now?"**
> If no → don't build it.

---

## Tech Stack

| Layer | Stack |
|---|---|
| Frontend | React 18, Vite, mobile-first |
| Backend | PHP 8.2, plain REST API, no framework |
| Database | PostgreSQL |
| Real-time | Node.js WebSocket + 3s poll fallback |
| Media | Cloudflare R2 |
| Hosting | Render (API + WS) · Vercel (frontend) |
