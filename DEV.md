# Hilads — Local development & release workflow

Auto-deploy is **off** on both Render and Vercel. You push to `main` as often
as you like; deploys are a manual step. The loop is:

```
  edit → docker compose up → smoke-test locally → commit + push → deploy button
```

---

## 1. One-time setup

Prereqs: Docker Desktop (macOS/Windows) or Docker Engine + Compose v2 (Linux),
Node ≥ 20, and (for mobile) the Expo CLI.

```bash
# Clone is already done — if not: git clone … hilads
cd hilads

# Compose builds the PHP image on first run; takes ~2min.
docker compose up -d

# First time only: run migrations against the empty DB.
docker compose exec api php migrate.php
```

You're up. Check:

```bash
curl http://localhost:8080/health           # → {"status":"ok",...}
curl http://localhost:8081/health           # → {"status":"ok",...}
```

Postgres is on `localhost:5432` (`hilads` / `hilads_dev`). Connect with `psql`
or any GUI:

```bash
psql postgres://hilads:hilads_dev@localhost:5432/hilads
```

---

## 2. Daily loop

### Backend (PHP API + Node WS + Postgres)

```bash
docker compose up                 # foreground, tail logs
docker compose up -d              # background
docker compose logs -f api        # only the PHP service
docker compose logs -f ws         # only the WS service
docker compose restart api        # rarely needed — opcache is dev-tuned
docker compose down               # stop, preserve DB
docker compose down -v            # stop, wipe DB (fresh slate)
```

Code edits in `backend/api/**` and `backend/ws/**` are picked up immediately —
PHP via OPcache `validate_timestamps=1`, Node via `node --watch`.

### Web (React + Vite)

Runs on the host, not in compose — hot-reload works best that way and the
mobile device can reach it over LAN.

```bash
cd apps/web
npm install                       # one-time
VITE_API_URL=http://localhost:8080 \
VITE_WS_URL=ws://localhost:8081 \
  npm run dev
# → Vite dev server on http://localhost:5173
```

### Mobile (React Native / Expo)

```bash
cd apps/mobile
cp .env.example .env              # one-time
# Edit .env:
#   EXPO_PUBLIC_API_URL=http://<your-LAN-IP>:8080
#   EXPO_PUBLIC_WS_URL=ws://<your-LAN-IP>:8081
# Android emulator shortcut: use http://10.0.2.2:8080 instead of LAN IP.
npm install                       # one-time
npx expo start
```

Grab your LAN IP with `ipconfig getifaddr en0` on macOS.

---

## 3. Pre-deploy smoke checklist

Run through this **before** hitting the deploy button. 10 minutes beats a
rollback.

### Infrastructure sanity

- [ ] `docker compose ps` — all three services `Up` / `healthy`.
- [ ] `docker compose exec api php migrate.php` — reports `OK` for every step,
      no `ERR`. Safe to re-run any time.
- [ ] `docker compose exec db psql -U hilads -d hilads -c '\dt'` — tables
      present.

### API surface

- [ ] `GET /health` → 200.
- [ ] `POST /api/v1/guest/session` with a nickname → returns `guestId`.
- [ ] `POST /api/v1/location/resolve` with sample lat/lng → returns a city.
- [ ] `GET /api/v1/channels/{id}/now` → returns `items`.
- [ ] Auth flow end-to-end if touched: login → `/api/v1/auth/me` → logout.

### WebSocket

- [ ] Web at `localhost:5173` connects to `ws://localhost:8081`, devtools
      Network → WS tab shows status `101` and messages flowing.
- [ ] Open two browser tabs in different cities — presence counter updates
      without a refresh.
- [ ] Kill `docker compose restart ws` — web should auto-reconnect within
      ~5 s (`socket.js` backoff), no manual refresh.

### Feature-specific (run what the PR touched)

- [ ] Reports: tap flag on a user → submit once (success). Tap flag again →
      "Already reported on …" alert, no second row in `user_reports`.
- [ ] DMs: send, receive, reaction burst animation fires on first reaction.
- [ ] Events: create, join, leave; counts match between the list and the
      detail screen.
- [ ] Photo upload (if R2 creds are in `.env`; otherwise skip).

### Build-quality gates

```bash
# Backend tests
docker compose exec api vendor/bin/phpunit --no-coverage

# Web typecheck + build
cd apps/web && npm run build

# Mobile typecheck (if touched)
cd apps/mobile && npx tsc --noEmit
```

No errors = green light to commit.

---

## 4. Commit & push

```bash
git add -p                        # review each hunk
git commit -m "…"                 # follow existing commit style (fix(area): …)
git push origin main
```

Push does **not** deploy. It only puts your code on GitHub.

---

## 5. Deploying to production

### Render (PHP API + Node WS)

```
https://dashboard.render.com → hilads-api   → "Manual Deploy" → "Deploy latest commit"
https://dashboard.render.com → hilads-ws    → "Manual Deploy" → "Deploy latest commit"
```

Or via the Render CLI:

```bash
render deploys create <service-id> --commit <sha>
```

After the API deploys, if your commit includes schema changes, run migrations:

```bash
# Render Shell for hilads-api
php migrate.php
```

Or hit the protected `POST /internal/migrate` endpoint with
`X-Migration-Key: <MIGRATION_KEY env>`.

### Vercel (React web)

```
https://vercel.com → hilads → Deployments → "Redeploy" on the commit you want,
                              or use the branch "Deploy latest"
```

Or via CLI:

```bash
cd apps/web
vercel --prod
```

### Mobile (React Native)

Unchanged — release via EAS + store flows. Nothing in this workflow affects
the mobile release cadence.

---

## 6. Rollback

### Render
Dashboard → service → "Events" tab → pick the last known-good deploy →
"Rollback to this deploy". Takes ~30 s.

### Vercel
Dashboard → Deployments → find the last good one → "… → Promote to
Production". Instant — just flips the alias.

---

## 7. Keeping the auto-deploy OFF

Two belt-and-braces layers:

1. **Config files** (already in the repo):
   - `render.yaml` → `autoDeploy: false` on both services
   - `apps/web/vercel.json` → `git.deploymentEnabled.main: false`

2. **Dashboard toggles** — verify once after merge:
   - Render: each service → Settings → Build & Deploy → **Auto-Deploy = No**
   - Vercel: project → Settings → Git → Production Branch → **Ignored Build
     Step** left default; confirm the `deploymentEnabled` override is picked up
     by looking at the next push (it should NOT trigger a build in Deployments).

If a push ever triggers a deploy you didn't want, the dashboard setting won
over the file. Flip it there once and both places stay off.

---

## 8. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `api` container restarts with `Class 'PDO' not found` | `vendor/` was shadowed by the bind mount | `docker compose down && docker compose up --build` |
| PHP edits don't show up | OPcache override not mounted | `docker compose exec api php -i \| grep validate_timestamps` → should be `On`. If `Off`, recheck `docker-compose.yml` volumes. |
| WS server can't reach `api` (broadcast failing) | You renamed the compose service | Match `WS_INTERNAL_URL` in `api` env to the WS service hostname on the compose network. |
| "connection to server … timeout expired" when running locally | You're still pointed at Supabase — check `DATABASE_URL` | Compose sets it; if you exported it in your shell it'll override. `unset DATABASE_URL` then `docker compose up`. |
| Mobile device can't reach API | Used `localhost` instead of LAN IP | macOS: `ipconfig getifaddr en0` → put in `apps/mobile/.env` |
| Web CORS error on `/api/v1/*` | `CORS_ORIGINS` doesn't include your dev URL | In compose, `api.environment.CORS_ORIGINS` already includes `http://localhost:5173` — add more with comma separation. |

---

## Quick reference

```
# Backend up/down
docker compose up -d
docker compose down

# Migrations
docker compose exec api php migrate.php

# Tests
docker compose exec api vendor/bin/phpunit --no-coverage

# Web
cd apps/web   && npm run dev
cd apps/web   && npm run build

# Mobile
cd apps/mobile && npx expo start

# Deploy (manual, dashboards)
Render → hilads-api → Manual Deploy
Render → hilads-ws  → Manual Deploy
Vercel → hilads     → Redeploy
```
