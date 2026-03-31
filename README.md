# Hilads

> Open the app. See who's around. Jump into something happening now.

Hilads is a real-time social app. Join a city, see who's online, chat, discover events, and meet people — no sign-up required.

---

## What it does

- **City chat** — public real-time chat, one channel per city
- **Hot screen** — active events in your city (one-shot + recurring venues)
- **Events** — create, join, edit, and delete events; every event has its own real-time chat
- **Presence** — who's online right now, live join/leave feed
- **Here screen** — browse online users, view profiles, add friends
- **Ghost mode** — instant access with a persistent ghost identity, no sign-up
- **Profiles** — badge, vibe score, friends list, vibes received
- **Vibe system** — leave a 1–5 star vibe + message on any user's profile
- **Badge system** — Fresh / Regular — evolves automatically over time
- **Friends** — add friends from profiles, view friend lists
- **Direct messages** — 1:1 private chat for registered users
- **Notifications** — in-app bell + web push + native push (DMs, events, friends, vibes)
- **Native app** — iOS + Android via Expo

---

## How it works

```
Open app
  → geolocation resolves your city (or pick manually)
  → see city chat, online users, active events
  → jump in — no account needed (Ghost mode)
  → register to unlock profile, DMs, friends, and vibes
```

**Ghost session:** instant access, persistent 32-char guestId, nickname chosen on entry.
**Registered account:** full profile, DMs, vibe system, friends, notifications.

---

## Identity

### Ghost users

Ghost users get a persistent `guestId` (32-char hex) stored in `localStorage` (web) and `SecureStore` (native). This ID is reused across sessions — not regenerated on every load — so historical feed messages are correctly attributed even after registration.

Ghost profiles show a generated avatar, nickname, and 👻 Ghost badge. No API call required.

### Registered users

Email + password or Google OAuth. Full profile with display name, photo, badge, vibe score, and friends.

---

## Badge System

Badges evolve automatically based on account age:

| Badge | Condition |
|---|---|
| 🌱 Fresh | Account < 2 months old |
| ⭐ Regular | Account ≥ 2 months old |

No action required — computed at display time from `users.created_at`.

---

## Vibe System

Any registered user can leave a **vibe** (rating + optional message) on another user's profile.

- Rating: 1–5 stars
- One vibe per user pair — updatable, updates are silent (no repeated notifications)
- Profile shows: vibe score (e.g. 4.8 ⭐), count, and list of vibes received
- Receiving a new vibe triggers an in-app + push notification → deep-links to own profile

---

## Events

Two types co-exist in the Hot screen:

**One-shot** — created by any user (ghost or registered), custom title/time, own chat, auto-expire.

**Recurring** — seeded curated venues (bars, cafés) per city, daily/weekly schedule, "↻ Every day" badge.

Event creators can edit and delete their events. Creator UX: "👑 Your event" badge + Edit CTA.

---

## Notifications

Delivered in-app (bell in channel header) and as push (web VAPID + native Expo).

| Type | Trigger |
|---|---|
| `dm_message` | New direct message |
| `event_message` | Message in an event you joined |
| `event_join` | Someone joined your event |
| `new_event` | New event while you're online |
| `friend_added` | Someone added you as friend |
| `vibe_received` | Someone left a vibe on your profile |

Tapping a `vibe_received` notification deep-links to **your own profile** so you can immediately see the new vibe.

Per-user preference toggles for each type. Anti-noise cooldowns on high-frequency types.

---

## Screens

| Screen | Description |
|---|---|
| Hot | Events happening now or today |
| Cities | Switch city, ranked by live activity |
| Here | Online users in the city |
| Me | Profile, My Events, friends list (registered) |
| Messages | DMs + event chats (registered) |
| Notifications | In-app feed + preferences (registered) |

---

## Architecture

```
apps/
  web/          React 18 + Vite — mobile-first PWA
  mobile/       Expo SDK 52 + React Native (iOS + Android)
backend/
  api/          PHP 8.2 REST API (nginx + FPM via Docker)
    admin/      Internal backoffice (/admin — ops only)
    src/        Repositories, services, push
  ws/           Node.js WebSocket server
docs/
  mvp.md        Full product definition
  design.md     UX and visual direction
infra/          Infrastructure notes
render.yaml     Render service definitions
```

**Backend** — intentionally thin: router → repositories → PDO → PostgreSQL. No framework, no ORM.

**WebSocket server** — handles presence snapshots (join/leave) and real-time message push. PHP broadcasts via internal HTTP.

**Schema migrations** — applied idempotently inside `Database::pdo()` on first connection. No migration runner required.

**Message retention** — daily cleanup job purges city chat (> today), event chat (event expired + 1h), DMs (> 7 days).

---

## Key API Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/guest/session` | Create a ghost session (guestId + nickname) |
| `GET` | `/api/v1/channels/{id}/messages` | Fetch city chat messages |
| `POST` | `/api/v1/channels/{id}/messages` | Send a message |
| `POST` | `/api/v1/channels/{id}/join` | Join a city channel (emits feed bubble) |
| `GET` | `/api/v1/channels/{id}/events` | List events for a city |
| `POST` | `/api/v1/events` | Create an event |
| `GET` | `/api/v1/events/{id}/messages` | Fetch event chat |
| `POST` | `/api/v1/events/{id}/messages` | Send event chat message |
| `GET` | `/api/v1/users/{id}` | Get a user's public profile |
| `GET` | `/api/v1/users/{id}/vibes` | List vibes for a user + score |
| `POST` | `/api/v1/users/{id}/vibes` | Leave a vibe (auth required) |
| `GET` | `/api/v1/friends` | Current user's friends list |
| `POST` | `/api/v1/friends/{id}` | Add a friend |
| `GET` | `/api/v1/notifications` | List in-app notifications |
| `POST` | `/api/v1/notifications/mark-read` | Mark notifications read |
| `GET` | `/api/v1/notification-preferences` | Get push preferences |
| `PUT` | `/api/v1/notification-preferences` | Update push preferences |
| `POST` | `/api/v1/push/subscribe` | Register web push subscription |
| `POST` | `/api/v1/push/mobile-token` | Register Expo push token |

---

## Running Locally

### Backend API

```bash
cd backend/api
cp .env.example .env
# fill: DATABASE_URL, R2_*, WS_INTERNAL_URL, MIGRATION_KEY

docker build -t hilads-api .
docker run -p 8080:80 --env-file .env hilads-api
```

### WebSocket server

```bash
cd backend/ws
npm install
node server.js
# WS on :8081 (public), HTTP on :8082 (internal PHP broadcasts)
```

### Web frontend

```bash
cd apps/web
npm install
cp .env.example .env
# set VITE_API_URL, VITE_WS_URL

npm run dev
# http://localhost:5173
```

### Native app

```bash
cd apps/mobile
npm install
cp .env.example .env
# set EXPO_PUBLIC_API_URL (LAN IP, not localhost)
# set EXPO_PUBLIC_WS_URL

npm run dev        # Expo Go — fastest for dev
npm run android    # Android emulator / device
npm run ios        # iOS simulator (Mac only)
```

> Use your machine's LAN IP (`192.168.x.x`) for the native env vars — the device/emulator cannot reach `localhost`.

---

## Environment Variables

### Backend API (`.env`)

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `R2_ACCOUNT_ID` | Cloudflare R2 account |
| `R2_ACCESS_KEY_ID` | R2 access key |
| `R2_SECRET_ACCESS_KEY` | R2 secret |
| `R2_BUCKET` | R2 bucket name |
| `R2_PUBLIC_URL` | Public base URL for uploaded files |
| `WS_INTERNAL_URL` | Internal URL of the WS server |
| `MIGRATION_KEY` | Secret key for internal admin endpoints |
| `VAPID_PUBLIC_KEY` | VAPID public key for web push |
| `VAPID_PRIVATE_KEY` | VAPID private key for web push |
| `VAPID_SUBJECT` | VAPID subject — `mailto:` or HTTPS URL |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `ADMIN_USERNAME` | Admin backoffice username |
| `ADMIN_PASSWORD` | Admin backoffice password |

Generate VAPID keys: `php backend/api/scripts/generate-vapid-keys.php`

### Web frontend (`.env`)

| Variable | Description |
|---|---|
| `VITE_API_URL` | Backend API base URL |
| `VITE_WS_URL` | WebSocket server URL |

### Native app (`.env`)

| Variable | Description |
|---|---|
| `EXPO_PUBLIC_API_URL` | Backend API base URL (no trailing slash) |
| `EXPO_PUBLIC_WS_URL` | WebSocket server URL |

---

## Deployment

| Service | Platform | Notes |
|---|---|---|
| PHP API | Render (Docker) | `render.yaml` — auto-deploy on push |
| WebSocket | Render (Node) | `render.yaml` — persistent WS connection |
| Web frontend | Vercel | `apps/web` — auto-deploy on push |
| Native builds | EAS (Expo) | `eas build --platform android/ios` |

---

## Scheduled Jobs (Cron)

Two daily jobs, both protected by `MIGRATION_KEY`:

**Generate recurring event occurrences** (2:00 AM UTC)
```
POST /internal/event-series/generate?key=YOUR_KEY
```

**Cleanup stale messages + expired channels** (3:00 AM UTC)
```
POST /internal/cleanup?key=YOUR_KEY
```

Set up as Render Cron Jobs or via [cron-job.org](https://cron-job.org).

---

## Seeding Recurring Venues

Hilads bootstraps cities with recurring events so the Hot screen is never empty on launch. The venue list lives in `backend/api/src/venues_seed.php`.

```bash
# Dry run first
curl -X POST "https://your-api.onrender.com/internal/seed-static-venues" \
  -H "X-Api-Key: YOUR_MIGRATION_KEY" \
  -d '{"dryRun": true}'

# Real import
curl -X POST "https://your-api.onrender.com/internal/seed-static-venues" \
  -H "X-Api-Key: YOUR_MIGRATION_KEY" \
  -d '{"dryRun": false}'

# Then generate today's occurrences
POST /internal/event-series/generate?key=YOUR_MIGRATION_KEY
```

---

## Admin Backoffice

Internal ops tool at `/admin` on the API service. Not part of the product.

| Route | Description |
|---|---|
| `GET /admin` | Dashboard — stats overview |
| `GET /admin/users` | User list — searchable, read-only |
| `GET /admin/events` | Event list — filterable by status |
| `GET /admin/events/{id}/edit` | Edit event fields |
| `POST /admin/events/{id}/delete` | Soft-delete an event |

Auth: env-var credentials (`ADMIN_USERNAME` + `ADMIN_PASSWORD`), PHP session, CSRF-protected.

---

## Native App (Expo)

```
apps/mobile/
  app/
    _layout.tsx         Root layout + boot sequence
    (tabs)/
      hot.tsx           Events happening now
      cities.tsx        City list + switcher
      here.tsx          Online users in city
      messages.tsx      DMs + event chats
      me.tsx            Profile, My Events, friends
    notifications.tsx   In-app notifications + preferences
    user/
      [id].tsx          Public profile screen
      guest.tsx         Ghost profile screen
    event/[id].tsx      Event chat screen
    dm/[id].tsx         Direct message screen
  src/
    api/                REST API client (typed)
    lib/                identity, socket, push
    context/            AppContext (global state)
    hooks/              useAppBoot, usePushRegistration
    features/           notifications/NotificationHandler
    types/index.ts      Shared TypeScript types
    constants.ts        Colors, tokens
```

**Production build:**
```bash
npm install -g eas-cli
eas login
eas build --platform android --profile preview
```

---

## Docs

- [`docs/mvp.md`](docs/mvp.md) — full product definition
- [`docs/design.md`](docs/design.md) — UX and visual direction
- [`CLAUDE.md`](CLAUDE.md) — tech lead guidelines for AI agents

---

## Principles

- Mobile-first, always — no web patterns
- No sign-up friction — Ghost mode is first-class
- Simplicity over engineering — no framework, no ORM, no abstraction layers
- One product rule: *does this make the city feel more alive right now?*
