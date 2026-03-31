# Hilads — MVP v8

## Vision

Hilads makes cities feel alive in real time.

Open the app → see who's around → jump into something happening now.

Not a chat app. A **live social layer on top of cities**.

---

## Core Experience

```
Open app
  → city auto-detected by geolocation (or picked manually)
  → see who's online + what's happening
  → chat, join an event, or create one
  → no sign-up required — instant Ghost mode
  → register to unlock profile, DMs, friends, and vibes
```

---

## Main Screens

| Screen | What it does |
|---|---|
| **Hot** | Active events in the current city |
| **Cities** | Switch city — ranked by live activity |
| **Here** | Who's online right now in the city |
| **Me** | Profile, My Events, friends list (registered) |
| **Messages** | DMs + event chats (registered) |
| **Notifications** | Bell icon — in-app feed + push (registered) |

---

## Identity

### Ghost (default)

- Instant entry — no sign-up
- Persistent identity: 32-char hex guestId stored in localStorage / SecureStore
- Nickname chosen on first join
- Minimal profile card (ghost badge + avatar initial, no API call)
- Full access to city chat and events, including creating events

Ghost identity is **persistent across page loads** — the same guestId is reused so historical feed messages can be correctly attributed.

### Registered

- Email + password or Google OAuth
- Persistent profile: display name, photo, home city, age, bio
- Unlocks: DMs, friends, vibe system, notifications, full profile
- Seamless upgrade from ghost — ownership and history preserved
- Badge evolves automatically over time (see Badge System)

---

## Profile System

### Registered Profile

Accessible from:
- "Here" screen (tap any user)
- Feed bubbles (tap a join item)
- Friends list
- Direct link (`/user/{id}` on web, `/user/[id]` on native)

Contains:
- Display name + avatar (photo or generated initial)
- Badge (Fresh / Regular / Host / Local — see below)
- Self-chosen vibe (emoji label)
- Vibe score (average rating) + vibe count
- List of vibes received (author, rating, optional message)
- Friends list
- Add Friend / Message CTA

### Ghost Profile

Accessible from:
- Feed bubbles (tap a join item from a ghost user)

Contains:
- Generated avatar initial + color
- Nickname
- 👻 Ghost badge
- City context
- No API call — fully client-side rendered

---

## Badge System

Badges signal how long a user has been part of the Hilads community.

| Badge | Trigger | Label |
|---|---|---|
| Fresh | Account < 2 months old | 🌱 Fresh |
| Regular | Account ≥ 2 months old | ⭐ Regular |

Badges evolve automatically — no action required by the user. The badge is computed from `users.created_at` relative to the current date at display time.

Additional badges may be added in future (Host, Local, etc.).

---

## Vibe System

Vibes are the social reputation layer of Hilads. Instead of reviews, users leave **vibes** — a short rating + optional message — on other users' profiles.

### Leaving a vibe

- Any registered user can leave a vibe on any other registered user's profile
- Rating: 1–5 stars
- Optional message: up to 300 characters
- One vibe per (author → target) pair — the vibe is updatable
- Cannot leave a vibe on yourself

### Vibe display

On a user's profile:
- **Vibe score** — average rating displayed as a number (e.g. 4.8 ⭐)
- **Vibe count** — total number of vibes received
- **Vibe list** — latest vibes with author avatar, name, rating, and message

### Vibe notification

When someone receives a new vibe:
- **In-app notification** appears in the notification screen ("Jaclette sent you a vibe ✨")
- **Push notification** (web + native) — tapping opens the recipient's own profile so they can immediately see the new vibe
- Only first-time vibes notify — edits are silent

---

## Friends System

### Adding a friend

- From any registered user's profile: "Add Friend" CTA
- Friendship is currently one-directional (follow-style) in v1

### Viewing friends

- Own friends list visible in the **Me** screen
- Other users' friend lists visible on their public profiles

### Friend notification

- When someone adds you as a friend, you receive an in-app notification + push

---

## Feed System

The city chat feed includes **system items** that announce social activity:

| Event | Text example |
|---|---|
| User joined city | "Jaclette joined the vibe" |
| User arrived | "Jaclette just landed" |
| User is active | "Jaclette is live" |

Feed item properties:
- Timestamped
- **Clickable** — tapping opens the user's profile
- Identity-resolved: registered users open their full profile, ghost users open the ghost profile card
- Payload always includes `userId` (if registered) and `guestId` (if ghost), never conflated

---

## City Chat

- One public chat channel per city
- Text + photo messages
- Rate-limited to prevent spam
- Real-time via WebSocket, 3s poll as fallback
- Messages kept for current day only (cleaned up at midnight)
- Feed prompts injected client-side when activity is low

---

## Events — Hot Screen

Two types of events co-exist in the Hot screen:

### One-shot events
- Created by any user (ghost or registered)
- Custom title, optional location hint, start/end time
- Each has its own real-time chat
- Expire automatically at `expires_at`
- Event chat deleted when the event ends

### Recurring events
- Seeded per city: bars, coffee shops, curated venues
- Daily schedule (e.g. bars: 18:00–01:00, cafés: 10:00–18:00)
- Displayed with "↻ Every day" badge (or weekly schedule)
- Appear as "happening now" based on current time
- Only today's occurrence is shown in Hot

---

## Event Ownership

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

---

## Direct Messages

- Registered users only
- 1:1 private conversations
- History kept for 7 days, then auto-deleted

---

## Notifications

- Registered users only
- In-app notification feed (bell icon in city channel header)
- Unread badge polled every 30s (real-time update via WebSocket when open)
- Per-user preferences: toggle each type on/off

### Notification types

| Type | Trigger | Deep-link target |
|---|---|---|
| `dm_message` | New direct message | DM conversation |
| `event_message` | New message in event you joined | Event chat |
| `event_join` | Someone joined your event | Event |
| `new_event` | New event created while you're online | Event |
| `channel_message` | New message in city chat | City chat |
| `city_join` | Registered user arrived in your city | City chat |
| `friend_added` | Someone added you as friend | Their profile |
| `vibe_received` | Someone left a vibe on your profile | **Your own profile** |

### Push notifications

- **Web push** — browser VAPID push (requires permission)
- **Native push** — Expo Push API (iOS + Android)
- Anti-noise cooldowns on high-frequency types (event_join: 5 min, new_event: 1 hour, channel_message: 5 min)
- Expired push subscriptions cleaned up automatically
- Same preference controls apply to push as to in-app

---

## Presence

- Live user count per city
- "X joined" system messages in city chat
- Ghost vs registered badge on user rows
- WebSocket-driven: snapshot on join, live updates

---

## City Discovery

- 350+ cities worldwide
- Ranked by live score: `events × 10 + online users × 3 + messages × 1`
- Top 10 shown by default, full search available
- City row shows: event count, online users, message count

---

## Photos

- Share images in city chat and event chats
- Stored on Cloudflare R2

---

## Message Retention

| Channel | Kept | Deleted |
|---|---|---|
| City chat | Current day | Older than today (daily cron) |
| Event chat | While event is active | 1h after event ends |
| Direct messages | 7 days | Older than 7 days (daily cron) |

---

## Architecture Concepts

### City Channels
`city_1`, `city_2` etc. One per city. All users share the same channel. Parent of all event subchannels.

### Event Subchannels
Hex-id channels of `type='event'`, parented to a city channel.
Each has a `channel_events` row with: timing, source, series linkage, and creator identity (`created_by`).

### event_series
Stores the recurrence rule for recurring events. Each series generates occurrence rows in `channel_events` with an `occurrence_date`. The series is the source of truth — occurrences are ephemeral and regenerated daily.

### Event ownership model
```
channel_events.guest_id     — creator's guest UUID (always set)
channel_events.created_by   — creator's user UUID (set if registered)
```
Ownership check: `guest_id = :guest_id OR created_by = :user_id`

### Ghost identity persistence
The guestId is a 32-char hex string stored in `localStorage` (web) and `SecureStore` (native). It is reused across sessions so that historical chat messages can be linked to a registered user via `users.guest_id` when they later register.

### Real-time
WebSocket server handles presence snapshots and message push.
PHP API uses a fire-and-forget internal HTTP call to broadcast events.
3-second poll is the fallback for clients that can't maintain a WS connection.

### Non-fatal side effects
Auto-join and city notification on event creation are wrapped in try/catch.
Schema migrations are applied idempotently inside `Database::pdo()` on first connection.

---

## Admin Backoffice

Internal tool accessible at `/admin` on the API service. Not part of the product — ops only.

**Routes:**
- `GET /admin` — dashboard with stats
- `GET /admin/users` — searchable, paginated user list (read-only)
- `GET /admin/events` — searchable event list with status filters
- `GET /admin/events/{id}/edit` — edit event fields
- `POST /admin/events/{id}/delete` — soft delete

---

## What Is In Scope

- City chat (public, ephemeral)
- Events: one-shot + recurring
- Event ownership: create, edit, delete
- Event subchannels
- My Events (deduplicated, per creator)
- Direct messages (registered users)
- Presence + user discovery
- Ghost profile (lightweight, no API call)
- Registered profile (full — badge, vibe, friends)
- Badge system (Fresh / Regular, auto-evolving)
- Vibe system (leave, display, score)
- Friends system (add, list, view)
- Feed bubbles (clickable, identity-resolved)
- City switching + discovery
- Curated recurring venue seed
- Message retention via daily cleanup
- In-app notifications + web push + native push
- Push preference controls per type
- Vibe notifications (in-app + push, deep-link to own profile)
- Native app (Expo / React Native — iOS + Android)
- Internal admin backoffice (ops only)

---

## What Is Out of Scope

- Algorithmic ranking or recommendations
- Ticketing or paid events
- Archival or export
- Follower graph / feed (beyond friends)
- Real-time unread badge via WebSocket (currently polled every 30s)

---

## Product Rule

> **"Does this make the city feel more alive right now?"**
> If no → don't build it.

---

## Tech Stack

| Layer | Stack |
|---|---|
| Web frontend | React 18, Vite, mobile-first PWA |
| Native app | Expo SDK 52 + React Native, TypeScript |
| Backend | PHP 8.2, plain REST API, no framework |
| Database | PostgreSQL |
| Real-time | Node.js WebSocket + 3s poll fallback |
| Media | Cloudflare R2 |
| Hosting | Render (API + WS) · Vercel (web) · EAS (native builds) |
