# Hilads

> Open the app. See who's around. Jump into something happening now.

Hilads is a real-time social app. Join a city, see who's online, chat, discover events, and meet people — no sign-up required.

---

## What it does

- **City chat** — public real-time chat, one channel per city
- **Hot screen** — active events (one-shot + recurring venues + public Ticketmaster events)
- **Events** — create, join, edit, and delete events; every event has its own real-time chat
- **Event participants** — see who's going; tappable participant list inside each event
- **Presence** — live online users, join/leave feed
- **Here screen** — browse online users, view profiles, add friends
- **Ghost mode** — instant access with a persistent identity, no sign-up
- **Profiles** — badge, vibe score, friends list, vibes received
- **Vibe system** — leave a 1–5 star vibe + message on any user's profile
- **Badge system** — 🌱 Fresh / ⭐ Regular — evolves automatically over time
- **Friends** — add from profiles, view friend lists
- **Direct messages** — 1:1 private chat for registered users
- **Notifications** — in-app bell + web push + native push (Android working, iOS in progress)
- **Notification preferences** — per-type toggles
- **Analytics** — PostHog cross-platform (web + mobile + backend)
- **Error monitoring** — Sentry across web, backend, and native

---

## How it works

```
Open app
  → geolocation resolves your city (or pick manually)
  → see city chat, online users, active events
  → jump in — no account needed (Ghost mode)
  → register to unlock profile, DMs, friends, vibes, and notifications
```

**Ghost session:** instant access, persistent 32-char guestId, nickname chosen on entry.
**Registered account:** full profile, DMs, vibe system, friends, push notifications.

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

**Backend** — thin by design: router → repositories → PDO → PostgreSQL. No framework, no ORM.

**WebSocket server** — handles presence snapshots and real-time message push. PHP broadcasts via internal HTTP call.

**Push notifications** — web push (VAPID) + native push via Expo Push API (`https://exp.host/--/api/v2/push/send`). Token registration at `POST /api/v1/push/mobile-token`.

**Schema migrations** — applied idempotently inside `Database::pdo()` on first connection. No migration runner.

**Message retention** — daily cron purges city chat (> today), event chat (expired + 1h), DMs (> 7 days).

---

## Running Locally

### Prerequisites

- PHP 8.2 + Docker
- Node.js 18+
- PostgreSQL (or use DATABASE_URL pointing to a remote instance)

### Backend API

```bash
cd backend/api
cp .env.example .env
# fill: DATABASE_URL, R2_*, WS_INTERNAL_URL, MIGRATION_KEY

docker build -t hilads-api .
docker run -p 8080:80 --env-file .env hilads-api
```

API available at `http://localhost:8080`.

### WebSocket server

```bash
cd backend/ws
npm install
node server.js
# WS on :8081 (public connections), HTTP on :8082 (PHP broadcast calls)
```

### Web frontend

```bash
cd apps/web
npm install
cp .env.example .env.local
# set VITE_API_URL=http://localhost:8080
# set VITE_WS_URL=ws://localhost:8081

npm run dev
# http://localhost:5173
```

### Native app (Expo)

```bash
cd apps/mobile
npm install
cp .env.example .env.local
# set EXPO_PUBLIC_API_URL=http://192.168.x.x:8080  ← use LAN IP, not localhost
# set EXPO_PUBLIC_WS_URL=ws://192.168.x.x:8081

npm run dev        # Expo Go — fastest for iteration
npm run android    # Android emulator or device
npm run ios        # iOS simulator (Mac only)
```

> The device/emulator cannot reach `localhost`. Use your machine's LAN IP for `EXPO_PUBLIC_API_URL` and `EXPO_PUBLIC_WS_URL`.

Push notifications require a physical device and an EAS build (see below).

---

## Mobile — Production Build (EAS)

```bash
npm install -g eas-cli
eas login

# Android APK (for testing, no store signing)
eas build --platform android --profile preview

# Android production (signed, for Play Store)
eas build --platform android --profile production

# iOS (requires Apple Developer account)
eas build --platform ios --profile production
```

Build profiles are defined in `apps/mobile/eas.json`.

After a successful build, download the APK/IPA from [expo.dev](https://expo.dev) or install directly via EAS.

---

## Environment Variables

### Backend API (`backend/api/.env`)

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `R2_ACCOUNT_ID` | Cloudflare R2 account ID |
| `R2_ACCESS_KEY_ID` | R2 access key |
| `R2_SECRET_ACCESS_KEY` | R2 secret |
| `R2_BUCKET` | R2 bucket name |
| `R2_PUBLIC_URL` | Public base URL for uploaded files |
| `WS_INTERNAL_URL` | Internal URL of the WS server (e.g. `http://ws:8082`) |
| `WS_INTERNAL_TOKEN` | Auth token for WS internal broadcast endpoint |
| `WS_ALLOWED_ORIGINS` | Comma-separated CORS origins for WS (e.g. `https://hilads.live`) |
| `MIGRATION_KEY` | Secret for `/internal/*` endpoints |
| `POSTHOG_API_KEY` | PostHog project API key (server-side capture) |
| `POSTHOG_HOST` | PostHog ingest host |
| `SENTRY_DSN` | Sentry DSN for `hilads-backend` |
| `APP_ENV` | `production` / `staging` / `development` |
| `VAPID_PUBLIC_KEY` | VAPID public key for web push |
| `VAPID_PRIVATE_KEY` | VAPID private key for web push |
| `VAPID_SUBJECT` | `mailto:` address or HTTPS URL |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `ADMIN_USERNAME` | Admin backoffice username |
| `ADMIN_PASSWORD` | Admin backoffice password |

Generate VAPID keys:
```bash
php backend/api/scripts/generate-vapid-keys.php
```

### Web frontend (`apps/web/.env.local`)

| Variable | Description |
|---|---|
| `VITE_API_URL` | Backend API base URL |
| `VITE_WS_URL` | WebSocket server URL |
| `VITE_SENTRY_DSN` | Sentry DSN for `hilads-web` |

### Native app (`apps/mobile/.env.local`)

| Variable | Description |
|---|---|
| `EXPO_PUBLIC_API_URL` | Backend API base URL (no trailing slash) |
| `EXPO_PUBLIC_WS_URL` | WebSocket server URL |
| `EXPO_PUBLIC_SENTRY_DSN` | Sentry DSN for `hilads-mobile` |

EAS build env vars are defined in `apps/mobile/eas.json` under each profile's `env` block.

---

## Key API Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/guest/session` | Create a ghost session |
| `POST` | `/api/v1/auth/login` | Registered user login |
| `POST` | `/api/v1/auth/register` | Register account |
| `GET` | `/api/v1/auth/me` | Current session info |
| `GET` | `/api/v1/channels/{id}/messages` | Fetch city chat messages |
| `POST` | `/api/v1/channels/{id}/messages` | Send a message |
| `POST` | `/api/v1/channels/{id}/join` | Join a city channel |
| `GET` | `/api/v1/channels/{id}/events` | List events for a city |
| `POST` | `/api/v1/events` | Create an event |
| `GET` | `/api/v1/events/{id}/messages` | Fetch event chat |
| `POST` | `/api/v1/events/{id}/messages` | Send event chat message |
| `GET` | `/api/v1/events/{id}/participants` | List event participants |
| `POST` | `/api/v1/events/{id}/join` | Join an event |
| `GET` | `/api/v1/users/{id}` | Get a user's public profile |
| `GET` | `/api/v1/users/{id}/vibes` | List vibes for a user |
| `POST` | `/api/v1/users/{id}/vibes` | Leave a vibe |
| `GET` | `/api/v1/friends` | Current user's friends list |
| `POST` | `/api/v1/friends/{id}` | Add a friend |
| `GET` | `/api/v1/notifications` | In-app notification feed |
| `POST` | `/api/v1/notifications/mark-read` | Mark notifications read |
| `GET` | `/api/v1/notification-preferences` | Get push preferences |
| `PUT` | `/api/v1/notification-preferences` | Update push preferences |
| `POST` | `/api/v1/push/subscribe` | Register web push subscription |
| `POST` | `/api/v1/push/mobile-token` | Register Expo push token (Android/iOS) |
| `DELETE` | `/api/v1/push/mobile-token` | Unregister push token on logout |

---

## Internal Endpoints

All `/internal/*` routes require `?key=YOUR_MIGRATION_KEY` or `X-Api-Key` header.
Returns `404` if `MIGRATION_KEY` is not configured, `403` on wrong key.

| Method | Path | Description |
|---|---|---|
| `POST` | `/internal/run-migrations` | Idempotent DB migrations (run after deploy) |
| `POST` | `/internal/cleanup` | Purge stale messages + expired channels |
| `POST` | `/internal/event-series/generate` | Generate recurring event occurrences |
| `POST` | `/internal/seed-static-venues` | Import venue seed (`{"dryRun": true/false}`) |

---

## Scheduled Jobs (Cron)

Two daily jobs, both protected by `MIGRATION_KEY`:

**Generate recurring event occurrences** — 2:00 AM UTC
```
POST /internal/event-series/generate?key=YOUR_KEY
```

**Cleanup stale messages + expired channels** — 3:00 AM UTC
```
POST /internal/cleanup?key=YOUR_KEY
```

Set up as Render Cron Jobs or via [cron-job.org](https://cron-job.org).

---

## Seeding Recurring Venues

Bootstraps cities with recurring events so the Hot screen is never empty on launch.

```bash
# Dry run first
curl -X POST "https://api.hilads.live/internal/seed-static-venues" \
  -H "X-Api-Key: YOUR_MIGRATION_KEY" \
  -d '{"dryRun": true}'

# Real import
curl -X POST "https://api.hilads.live/internal/seed-static-venues" \
  -H "X-Api-Key: YOUR_MIGRATION_KEY" \
  -d '{"dryRun": false}'

# Then generate today's occurrences
curl -X POST "https://api.hilads.live/internal/event-series/generate?key=YOUR_KEY"
```

Venue list: `backend/api/src/venues_seed.php`.

---

## Deployment

| Service | Platform | Config |
|---|---|---|
| PHP API | Render (Docker) | `render.yaml` — auto-deploy on push to main |
| WebSocket | Render (Node) | `render.yaml` — persistent connections |
| Web frontend | Vercel | `apps/web` — auto-deploy on push to main |
| Native builds | EAS (Expo) | `eas build --platform android/ios` |

Production URLs:
- API: `https://api.hilads.live`
- WebSocket: `wss://ws.hilads.live`
- Web: `https://hilads.live`

After deploying the API, always run migrations:
```
POST /internal/run-migrations?key=YOUR_KEY
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

## Native App Structure

```
apps/mobile/
  app/
    _layout.tsx           Root layout + boot sequence + push registration
    (tabs)/
      hot.tsx             Events happening now
      cities.tsx          City list + switcher
      here.tsx            Online users in city
      messages.tsx        DMs + event chats
      me.tsx              Profile, My Events, friends
    notifications.tsx     In-app notifications + preferences
    user/[id].tsx         Public profile screen
    user/guest.tsx        Ghost profile screen
    event/[id].tsx        Event chat screen
    dm/[id].tsx           Direct message screen
  src/
    api/                  REST API client (typed)
    services/             push.ts — token registration, channel setup
    context/              AppContext (global state)
    hooks/                useAppBoot, usePushRegistration
    features/             notifications/NotificationHandler (foreground + deep-link)
    types/index.ts        Shared TypeScript types
    constants.ts          Colors, tokens
```

---

## Analytics

PostHog tracks cross-platform behaviour. Every event includes a `platform` property.

- **Web:** `posthog-js` in `apps/web/src/main.jsx`
- **Mobile:** `posthog-react-native` in `apps/mobile/src/services/analytics.ts` (disabled in `__DEV__`)
- **Backend:** server-side HTTP capture in `AnalyticsService.php` (fire-and-forget)

---

## Error Monitoring

| Project | DSN env var |
|---|---|
| `hilads-web` | `VITE_SENTRY_DSN` |
| `hilads-backend` | `SENTRY_DSN` |
| `hilads-mobile` | `EXPO_PUBLIC_SENTRY_DSN` |

Sentry is skipped if the DSN is not set — safe for local dev.

---

## Known Issues

| Area | Issue |
|---|---|
| Performance | Several endpoints respond in 2–4s |
| Mobile | UI inconsistencies vs web on several screens |
| Mobile | Input field partially hidden by bottom tab bar on some screens |
| Mobile iOS | Push notifications not fully tested |
| My Events | Recurring events appear as duplicates |
| City chat | Occasionally loads at top instead of latest message |
| Profile | Duplicate API calls on screen load |

---

## Next Steps

**Performance**
- Eliminate duplicate API calls on the profile screen
- Target < 300ms p95 on all feed endpoints
- Add missing DB indexes on participant counts and message feeds

**iOS Push Notifications**
- Validate end-to-end on TestFlight (EAS production build)
- Verify APNs environment entitlement matches build type
- Do not hardcode `aps-environment` in `app.json` — let EAS manage it

**UX Consistency**
- Audit all screens: Hot, Event, Profile, DM, Notifications
- Fix input field overlap with bottom bar
- Align visual hierarchy and spacing between web and mobile
- Ensure city chat opens at the latest message on all platforms

**Growth — First 100 Users in a City**
- Focus on one city: local community, campus, or recurring venue
- Ensure Hot screen is never empty (venue events always visible)
- Make Ghost mode feel intentional: "You're browsing as a Ghost — claim your identity"
- Create shareable city deeplinks: `hilads.live/city/paris`
- Track and optimize activation funnel: open → join city → first message → join event

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
