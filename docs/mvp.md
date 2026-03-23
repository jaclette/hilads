# Hilads — MVP v2

## What is Hilads?

Hilads is a real-time social app that makes cities feel alive.

Open the app → see who's around → jump into something happening now.

It is not a chat app. It is a **live social layer on top of cities**.

---

## Core Concept

When you open Hilads, you feel the energy of your city instantly.

- Who's here right now?
- What's happening nearby?
- Can I join something in the next 10 minutes?

No friction. No sign-up wall. Just instant presence.

---

## Current Features (v2)

### Identity
- Lightweight guest session (UUID + nickname)
- Custom nickname support
- No password, no email required

### Presence
- See who's online in the city right now
- Live user count per city
- Presence signals even with low traffic (liveness engine)

### City Chat
- Real-time chat per city
- Text + photo messages in all chat contexts (city channels and event subchannels)
- Auto-join based on geolocation
- Rate-limited to prevent spam

### Events
- Create a spontaneous event (time, place, vibe)
- Browse active events in the city — Hilads events (today) + upcoming city events
- Event subchannels: dedicated chat per event, with photo support
- Join an event → show attendance
- Events expire automatically
- External city events imported from Ticketmaster (upcoming, not today-only)
- Event location displayed with venue name + city, tappable to open maps

### City Discovery
- 350 cities worldwide with country flags
- Switch city screen ranked by live score: events × 10 + online users × 3 + messages × 1
- Top 10 cities shown by default (active cities first, then well-known cities by ID)
- Search across all 350 cities with consistent event counts
- Skeleton loading state while cities load
- Event counts pre-loaded for well-known cities (IDs 1–20) without requiring a city visit

### Geolocation
- Auto-detect city on open
- Resolve nearest of 350 supported cities
- Graceful error states: permission denied vs GPS unavailable shown separately
- Retry and manual override always available

---

## Core User Flow

```
Open app
  → geolocation resolves city (or pick manually)
  → see who's here + active events
  → chat or join an event instantly
```

That's it. Three steps to feeling the city.

---

## Product Principles

**Mobile-first** — no web patterns. Native-feel on mobile. FAB, bottom nav, full screens.

**Instant interaction** — zero-friction entry. No onboarding walls. You're in immediately.

**No empty states** — the city always feels active. Presence signals, event hints, activity indicators.

**Trustworthy data** — event counts in the city list match what is visible on the Hot screen. No inflation.

**Emotional, not functional** — the goal is to feel something, not to complete a task.

---

## What We Avoid

- Heavy authentication (no passwords, no OAuth flows)
- Complex social graph (no followers, no feed algorithms)
- Private messaging (stay public and spontaneous)
- Notifications system (not yet — adds complexity without clear retention gain)
- Features that don't answer: *"Does this make the city feel more alive right now?"*

---

## Key Rule

> **"Does this make the city feel more alive right now?"**
>
> If the answer is no → don't build it.

---

## Tech Stack (v2)

| Layer | Stack |
|---|---|
| Frontend | React 18, Vite, mobile-first |
| Backend | PHP 8.2, plain REST API, no framework |
| Storage | File-based JSON (messages, events, presence) |
| Real-time | Polling + Node.js WebSocket (presence) |
| Media | Cloudflare R2 (photos, all chat types) |
| External events | Ticketmaster Discovery API (7-day sync cooldown per city) |
| Hosting | Render |

---

## Success Metrics

- Time to first interaction (target: <30s)
- Messages per session
- Events created per day
- Users who return within 24h
- Active users per city at peak time

---

## What Comes Next

When v2 is stable and we see retention signals:

- Push notifications (for nearby events)
- Better liveness engine (more activity signals)
- City rankings / trending moments
- Richer event formats (recurring, ticketed, etc.)
- User-reported event locations with coordinates
