# Hilads — MVP v3

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

No friction. Instant presence. Optional identity.

---

## Core User Flow

```
Open app
  → geolocation resolves city (or pick manually)
  → see who's here + active events
  → chat or join an event instantly
  → explore people around you
```

Four steps to feeling the city.

---

## Current Features (v3)

### Identity

Two user types, one clean transition:

**Guest**
- Temporary identity (UUID + nickname)
- No sign-up required
- Full access to chat and events
- Identity stored in localStorage

**Registered**
- Persistent profile in PostgreSQL
- Email + password
- Display name, photo, home city, age, interests
- Seamless upgrade from guest → registered
- Single source of truth: backend always wins over localStorage

### Profile

Editable "Me" screen for registered users:
- Profile photo (uploaded to Cloudflare R2)
- Display name
- Home city
- Age
- Interests (up to 5, from a curated list)

Public profile viewable by other registered users.

### Presence

- See who's online in the city right now
- Live user count per city
- Real-time via WebSocket (presence snapshot on join, live join/leave events)
- Guest vs registered distinction (member badge)
- Tap a registered user → view their public profile
- Guest viewers tapping a user are encouraged to create an account

### City Chat

- Real-time chat per city
- Text + photo messages
- Auto-join based on geolocation
- Rate-limited to prevent spam
- Messages pushed via WebSocket (3s poll as fallback)

### Events

- Create a spontaneous event (title, time, place)
- Browse active events — Hilads events + external city events
- Event subchannels: dedicated real-time chat per event, with photo support
- Join an event → show attendance
- Events expire automatically
- External events imported from Ticketmaster
- Event location tappable → opens maps

### City Discovery

- 350 cities worldwide with country flags
- City list ranked by live score: events × 10 + online users × 3 + messages × 1
- Top 10 active cities shown by default
- Search across all 350 cities
- Skeleton loading state

### Geolocation

- Auto-detect city on open
- Resolve nearest of 350 supported cities
- Graceful error states: permission denied vs GPS unavailable
- Manual override always available

---

## Product Principles

**Mobile-first** — no web patterns. Native-feel on mobile. FAB, bottom nav, full screens.

**Instant interaction** — zero-friction entry. No mandatory onboarding walls.

**No empty states** — the city always feels active. Presence signals, event hints, activity indicators.

**Emotional, not functional** — the goal is to feel something, not to complete a task.

**Single identity rule** — one user, one name, one source of truth.

---

## What We Avoid

- Complex social graph (no followers, no feed algorithms)
- Private messaging (stay public and spontaneous)
- Notifications system (not yet — adds complexity without clear retention signal)
- Features that don't answer: *"Does this make the city feel more alive right now?"*

---

## Key Rule

> **"Does this make the city feel more alive right now?"**
>
> If the answer is no → don't build it.

---

## Tech Stack (v3)

| Layer | Stack |
|---|---|
| Frontend | React 18, Vite, mobile-first |
| Backend | PHP 8.2, plain REST API, no framework |
| Database | PostgreSQL (messages, events, presence, users) |
| Real-time | Node.js WebSocket (presence + message push) + 3s poll fallback |
| Media | Cloudflare R2 (profile photos, chat images) |
| External events | Ticketmaster Discovery API |
| Hosting | Render (API + WS), Vercel (frontend) |

---

## Success Metrics

- Time to first interaction (target: <30s)
- Messages per session
- Events created per day
- Users who return within 24h
- Guest → registered conversion rate
- Active users per city at peak

---

## What Comes Next

When v3 is stable and we see retention signals:

- Push notifications (for nearby events)
- Better liveness engine (more activity signals)
- City rankings / trending moments
- Richer profile matching (connect based on shared interests)
- Richer event formats (recurring, ticketed, etc.)
