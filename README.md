# Hilads

> Open the app. See who's around. Jump into something happening now.

Hilads is a real-time social app that makes cities feel alive. It's not a chat app — it's a **live social layer on top of cities**.

---

## What it does

When you open Hilads, you feel the energy of your city instantly:

- Who's online right now?
- What events are happening nearby?
- Explore the people around you

No mandatory sign-up. You're in immediately.

---

## Features

- **City chat** — real-time public chat per city, auto-joined by geolocation
- **Events** — create or join spontaneous local events, with dedicated chat per event
- **Presence** — see who's online right now, with live join/leave updates
- **People Here** — browse online users, see who's a member, view their profiles
- **Identity** — guest session (no sign-up) or registered account (persistent profile)
- **Profile** — display name, photo, home city, age, interests
- **Photos** — share images in city chat and event subchannels

---

## Tech Stack

| Layer | Tech |
|---|---|
| Frontend | React 18, Vite (mobile-first) |
| Backend | PHP 8.2 — plain REST API, no framework |
| Database | PostgreSQL |
| Real-time | Node.js WebSocket server + 3s poll fallback |
| File storage | Cloudflare R2 |
| Hosting | Render (API + WS) · Vercel (frontend) |

---

## Architecture

```
apps/
  web/        React frontend (mobile-first PWA)
backend/
  api/        PHP REST API (FPM + nginx)
  ws/         Node.js WebSocket server (presence + message push)
docs/         Product docs (mvp.md, design.md)
infra/        Infrastructure notes
```

**Backend** is intentionally thin: plain PHP router → services → PDO → PostgreSQL. No framework, no ORM.

**WebSocket server** handles two things only: real-time presence (join/leave snapshots) and instant message delivery. HTTP polling is the fallback.

**Identity** has two tiers: a lightweight guest session (UUID + nickname, localStorage) and a registered account (PostgreSQL). Guests can upgrade at any time — their messages are preserved.

---

## Running Locally

### 1. Backend API

```bash
cd backend/api
cp .env.example .env
# fill in: DATABASE_URL, R2 keys, WS_INTERNAL_URL

docker build -t hilads-api .
docker run -p 8080:80 hilads-api
```

### 2. WebSocket server

```bash
cd backend/ws
npm install
node server.js
# runs on :8081 (public WS) and :8082 (internal HTTP for PHP broadcasts)
```

### 3. Frontend

```bash
cd apps/web
npm install
cp .env.example .env
# set VITE_API_URL and VITE_WS_URL

npm run dev
# open http://localhost:5173
```

---

## Development Philosophy

**Simplicity first.** No overengineering. No premature abstractions.

**Mobile-first, always.** Every UI decision is made for a phone.

**Speed over perfection.** Ship fast, iterate in real conditions.

**One product rule:** *Does this make the city feel more alive right now?* If not, don't build it.

---

## Docs

- [`docs/mvp.md`](docs/mvp.md) — product definition, features, principles
- [`docs/design.md`](docs/design.md) — UX and visual direction
- [`CLAUDE.md`](CLAUDE.md) — tech lead guidelines for AI agents
