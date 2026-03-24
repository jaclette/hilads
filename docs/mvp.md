# Hilads — MVP v5

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
  → chat, join an event, or discover a place
  → no sign-up required
```

---

## Main Screens

| Screen | What it does |
|---|---|
| **Hot** | Active events in the current city |
| **Cities** | Switch city — ranked by live activity |
| **Here** | Who's online right now in the city |
| **Me** | Profile (registered users only) |
| **Messages** | DMs + event chats (registered users only) |

---

## Features

### Identity

**Guest** (default)
- Instant entry — no sign-up
- Temporary identity: UUID + nickname stored in localStorage
- Full access to city chat and events

**Registered**
- Email + password or Google
- Persistent profile: display name, photo, home city, age, interests
- Unlocks: DMs, creating recurring events, Messages screen
- Seamless upgrade from guest — history preserved

### City Chat

- One public chat channel per city
- Text + photo messages
- Rate-limited to prevent spam
- Real-time via WebSocket, 3s poll as fallback
- Messages kept for current day only (cleaned up at midnight)
- Feed prompts injected client-side when activity is low (explore, photo, create-event, new-event banners)

### Events — Hot Screen

Two types of events co-exist in the Hot screen:

**One-shot events**
- Created by any user (guest or registered)
- Custom title, time, location
- Each has its own real-time chat
- Expire automatically
- Event chat deleted when the event ends

**Recurring events**
- Seeded per city: bars, coffee shops, curated venues
- Daily schedule (e.g. bars: 18:00–01:00, cafés: 10:00–18:00)
- Displayed with "Every day" badge
- Appear as "happening now" based on current time
- Only today's occurrence is shown in Hot and Messages

### Event Subchannels

- Every event has its own real-time chat
- Text + photo messages
- Visible to anyone in the city
- Messages deleted when the event expires (+ 1h buffer)

### Recurring Events — How They Work

Each recurring series generates daily occurrences (7-day lookahead window).
Only today's occurrence is surfaced in Hot and Messages.
A daily cron refreshes the lookahead window.

Source: curated static dataset — 10 cities × 7 venues (4 bars + 3 cafés each).

### Direct Messages

- Registered users only
- 1:1 private conversations
- History kept for 7 days, then auto-deleted

### Notifications

- Registered users only
- In-app notification feed (bell icon in header)
- Unread badge — polled every 30s
- Triggered by: new DM, new event message, new event in city
- Web push (browser push notifications) — registered users who grant permission
- Push delivered via VAPID / Web Push Protocol
- Per-user preferences: toggle push on/off per notification type
- Notification click deep-links into the relevant screen
- Expired push subscriptions cleaned up automatically (410 responses)

### Presence

- Live user count per city
- "X joined" system messages
- Guest vs registered badge
- WebSocket-driven (snapshot on join, live updates)

### City Discovery

- 350 cities worldwide
- Ranked by live score: `events × 10 + online users × 3 + messages × 1`
- Top 10 shown by default, full search available
- City row shows: event count, online users, message count
- Event count = today's active events only (no future occurrences)

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
`city_1`, `city_2` etc. One per city. All users in that city share the same channel. Parent of all event subchannels.

### Event Subchannels
Hex-id channels of `type='event'`, parented to a city channel. Each has a `channel_events` row with timing, source, and series linkage.

### event_series
Stores the recurrence rule for recurring events. Each series generates occurrence rows in `channel_events` with an `occurrence_date`. The series is the source of truth — occurrences are ephemeral.

### source_key
Stable fingerprint for import-created series: `static:v1:city_{id}:{slug}:{category}`. Ensures the seed is idempotent — running it multiple times has no effect.

### Real-time
WebSocket server handles presence snapshots and message push. PHP API uses a fire-and-forget internal HTTP call to broadcast events. 3-second poll is the fallback for clients that can't maintain a WS connection.

---

## What Is In Scope

- City chat (public, ephemeral)
- Events: one-shot + recurring
- Event subchannels
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
- Push notification batching/throttling (deferred to Phase 3)
- Real-time unread badge via WebSocket (currently polled — deferred to Phase 3)

---

## Known Issues (Next to Fix)

- Recurring event generation needs daily cron to be stable
- UI consistency for recurring vs one-shot events in some edge cases
- Notification unread badge is polled (30s lag) — not real-time

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
| External events | Ticketmaster Discovery API |
| Hosting | Render (API + WS) · Vercel (frontend) |
