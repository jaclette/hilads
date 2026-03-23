# Hilads

> Open the app. See who's around. Jump into something happening now.

Hilads is a real-time social app that makes cities feel alive. It's not a chat app — it's a **live social layer on top of cities**.

---

## What it does

When you open Hilads, you feel the energy of your city instantly:

- Who's online right now?
- What events are happening nearby?
- Jump into a conversation or an event in seconds

No sign-up wall. No onboarding. You're in immediately.

---

## Features

- **City chat** — real-time public chat per city, auto-joined by geolocation
- **Events** — create or join spontaneous local events
- **Presence** — see who's online in your city right now
- **Photos** — share moments in the city chat
- **Lightweight identity** — nickname + guest session, no password needed

---

## Tech Stack

| Layer | Tech |
|---|---|
| Frontend | React 18, Vite |
| Backend | PHP 8.2 (plain REST, no framework) |
| Database | MySQL |
| Real-time | Short polling + Node.js WebSocket (presence) |
| File storage | Cloudflare R2 |
| Hosting | Render |

---

## Architecture

```
apps/
  web/          React frontend (mobile-first)
backend/
  api/          PHP REST API
  ws/           Node.js WebSocket server (presence)
docs/           Product docs
infra/          Infrastructure notes
```

The backend is intentionally simple: a plain PHP router → services → DB. No heavy framework. No ORM. The WebSocket server handles online presence only.

---

## Running Locally

### 1. Backend API

```bash
cd backend/api
cp .env.example .env
# fill in your DB credentials and R2 keys

docker build -t hilads-api .
docker run -p 8080:80 hilads-api
```

Or run with a local Apache/PHP setup pointing to `backend/api/public`.

### 2. WebSocket server

```bash
cd backend/ws
npm install
node server.js
```

Runs on port `8081` by default.

### 3. Frontend

```bash
cd apps/web
npm install
cp .env.example .env
# set VITE_API_URL and VITE_WS_URL

npm run dev
```

Open `http://localhost:5173`.

---

## Development Philosophy

**Simplicity first.** No overengineering. No premature abstractions.

**Mobile-first, always.** Every UI decision is made for a phone, not a desktop.

**Speed over perfection.** Ship fast, iterate in real conditions.

**One product rule:** *Does this make the city feel more alive right now?* If not, don't build it.

---

## Docs

- [`docs/mvp.md`](docs/mvp.md) — product definition, features, principles
- [`docs/design.md`](docs/design.md) — UX and visual direction
- [`CLAUDE.md`](CLAUDE.md) — tech lead guidelines for AI agents
