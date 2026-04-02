# Hilads — MVP v10

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
  → register to unlock profile, DMs, friends, vibes, and notifications
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
- Cannot access DMs, friends, vibes, or notifications

Ghost identity is **persistent across page loads** — the same guestId is reused so historical feed messages are correctly attributed.

### Registered

- Email + password or Google OAuth
- Persistent profile: display name, photo, home city, age, bio
- Unlocks: DMs, friends, vibe system, push notifications, full profile
- Seamless upgrade from ghost — history preserved
- Badge evolves automatically over time

---

## Profile System

### Registered Profile

Accessible from: Here screen, feed bubbles, friends list, direct link.

Contains:
- Display name + avatar (photo or generated initial)
- Badge (Fresh / Regular — auto-evolving)
- Self-chosen vibe label
- Vibe score (average rating) + vibe count
- List of vibes received
- Friends list
- Add Friend / Message CTA

### Ghost Profile

Accessible from feed bubbles.

Contains:
- Generated avatar + nickname
- 👻 Ghost badge
- City context
- No API call — fully client-side rendered

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
- One vibe per user pair — updatable, edits are silent (no repeated notification)
- Profile shows: vibe score, count, and vibe list
- Receiving a new vibe triggers in-app + push notification → deep-links to own profile

---

## Friends System

- From any registered user's profile: "Add Friend" CTA
- Currently one-directional (follow-style)
- Own friends list in the Me screen
- Friend addition triggers in-app + push notification

---

## Feed System

City chat includes system items announcing social activity:

| Event | Example |
|---|---|
| User joined city | "Jaclette joined the vibe" |
| User arrived | "Jaclette just landed" |
| User is active | "Jaclette is live" |

Feed items are clickable — tap opens the user's profile.

---

## City Chat

- One public chat channel per city
- Text + photo messages
- Timestamped messages (time + date shown under each bubble)
- Rate-limited to prevent spam
- Real-time via WebSocket, 3s poll as fallback
- Messages kept for current day only (cleaned up at midnight)
- Feed prompts injected client-side when activity is low
- New users should land at the latest message (bottom of feed)

---

## Events — Hot Screen

### One-shot events

- Created by any user (ghost or registered)
- Custom title, optional location hint, start/end time
- Each has its own real-time chat
- Auto-expire at `expires_at`

### Recurring events

- Seeded per city: bars, coffee shops, curated venues
- Daily/weekly schedule
- "↻ Every day" badge
- Only today's occurrence shown in Hot

### Public events (Ticketmaster)

- Ingested via Ticketmaster API
- Shown in Hot and Upcoming feeds
- "Public" badge — no participant tracking

---

## Event Participants

- Joining registers the user (ghost or registered) as a participant
- Participant count shown on event card and event screen
- Participant list visible inside the event — tappable avatars + names (registered users)
- Tapping a registered user opens their profile
- Ghost participants shown with nickname only

---

## Event Ownership

Creator capabilities:
- Replace "Join" CTA with "✏️ Edit event"
- Edit title, location, time
- Delete the event (with confirmation)

Ownership check: `guest_id = :guest_id OR created_by = :user_id`

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

- **In-app bell** — polled every 30s, real-time via WebSocket when open
- **Web push** — browser VAPID push
- **Native push** — Expo Push API (Android working; iOS not fully tested)
  - Deep linking working: DM tap → opens DM, event tap → opens event
  - Foreground suppression: no alert when user is already viewing the relevant screen
  - Anti-noise cooldowns on high-frequency types

### Notification preferences

Per-user toggles per type. Preference screen is accessible from the Notifications tab.

---

## Presence

- Live user count per city
- "X joined" system messages in city chat
- WebSocket-driven: snapshot on join, live updates

---

## City Discovery

- 350+ cities worldwide
- Ranked by live score: `events × 10 + online users × 3 + messages × 1`
- Top 10 by default, full search available
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
Each has a `channel_events` row with: timing, source, series linkage, and creator identity.

### event_series

Stores the recurrence rule for recurring events. Each series generates occurrence rows in `channel_events`. The series is the source of truth — occurrences are regenerated daily.

### Real-time

WebSocket server handles presence snapshots and message push.
PHP API broadcasts via fire-and-forget internal HTTP.
3-second poll fallback for clients that can't hold a WS connection.

---

## Admin Backoffice

Internal tool at `/admin` on the API service.

- `GET /admin` — stats dashboard
- `GET /admin/users` — searchable user list (read-only)
- `GET /admin/events` — event list with status filters
- `GET /admin/events/{id}/edit` — edit event fields
- `POST /admin/events/{id}/delete` — soft delete

---

## Analytics

PostHog — cross-platform, `platform` property on every event.

Frontend intent events: `landing_viewed`, `clicked_join_city`, `clicked_sign_up`, `clicked_sign_in`

Backend success events: `guest_created`, `user_registered`, `user_authenticated`, `joined_city`, `sent_message`, `event_created`, `joined_event`, `friend_added`, `friend_removed`

---

## Observability

| Project | Platform |
|---|---|
| `hilads-web` | React (Vite) |
| `hilads-backend` | PHP |
| `hilads-mobile` | Expo / React Native |

All DSNs are env-var only. Sentry skipped if DSN is not set.

---

## Known Issues

| Area | Issue | Severity |
|---|---|---|
| Performance | Several API endpoints respond in 2–4s (likely N+1 or missing index) | High |
| Mobile | UI inconsistencies vs web across several screens | Medium |
| Mobile | Input field partially hidden by bottom tab bar on some screens | Medium |
| Mobile | iOS push notifications not fully tested or validated | Medium |
| My Events | Recurring events appear as duplicates in the "My Events" list | Low |
| City chat | Users occasionally land at top of feed instead of latest message | Low |
| Notifications | 500 errors observed on the preferences endpoint (recently fixed) | Low |
| Profile | Duplicate API calls on profile screen load | Low |

---

## What Is Out of Scope

- Algorithmic ranking or recommendations
- Ticketing or paid events
- Archival or export
- Follower graph / feed (beyond friends)
- Real-time unread badge via WebSocket (currently polled every 30s)

---

## Next Steps

### Performance

- Profile screen: eliminate duplicate API calls (deduplicate `useEffect` fetches)
- Identify and fix the slowest endpoints (target < 300ms p95)
- Add DB indexes where missing (participant counts, message feeds)

### Push Notifications

- Validate iOS push end-to-end (EAS production build + TestFlight)
- Verify APNs environment entitlement matches build type
- Add `channel_message` and `city_join` deep-link routing on mobile

### UX Consistency (Web vs Mobile)

- Audit all screens: Hot, Event, Profile, DM, Notifications
- Align visual hierarchy, spacing, and interaction patterns
- Fix input field overlap with bottom bar
- Ensure city chat scroll-to-bottom on open

### Growth — First 100 Users in a City

- Target one city (local community, university campus, or event venue)
- Remove all empty-state feelings: always show venue events on Hot even with 0 joins
- Make Ghost mode visible and desirable ("You're browsing as a Ghost — claim your identity")
- Share deeplink: `hilads.live/city/london` → drops user directly into a city
- Track activation funnel: open → join city → send first message → create/join event

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
| Analytics | PostHog |
| Error monitoring | Sentry (hilads-web · hilads-backend · hilads-mobile) |
