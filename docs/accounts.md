# Hilads — Accounts & Profiles Design

## Context

Hi Lads currently runs on file-based JSON storage with no user database.
Guest identity is a UUID (`guestId`) stored in a PHP session + localStorage.

This document defines the full design for optional user accounts and profiles.

---

## Product Decisions

### 1. Guest access is preserved
Users can open the app and chat immediately without creating an account.
Account creation is always optional and triggered from the Me tab.

### 2. Account is an upgrade, not a requirement
The flow is: guest → optional signup → registered user.
Nothing changes for users who never register.

### 3. Age stored as birth year
Storing `birth_year` (e.g. 1995) instead of exact date.
- Less invasive than full birth date
- Age is computed dynamically (never goes stale)
- Simple to validate (must be ≥ 18 to use the app)

### 4. Public vs private fields

| Field | Public |
|---|---|
| display_name | ✅ |
| age (computed) | ✅ |
| profile_photo_url | ✅ |
| home_city | ✅ |
| interests | ✅ |
| email | ❌ |
| password_hash | ❌ |
| google_id | ❌ |
| created_at | ❌ |

### 5. Guest upgrade strategy
On signup, the guest's `guestId` is stored in the user record.
The nickname becomes the initial `display_name`.
The guest session continues to work — the app just enriches it with the user account.
No hard data migration required.

### 6. Database: SQLite
The system has no database today. Adding one should not require infrastructure changes.
SQLite lives as a single file in the existing storage directory — consistent with the current approach, zero new dependencies, native PHP PDO support.
Path: `storage/users.db`
Upgrade to MySQL/Postgres later if scale requires it.

---

## Interests List

```
drinks · party · nightlife · music · live music · culture · art · food · coffee
sport · fitness · hiking · beach · wellness · travel · hangout · socializing
language exchange · dating · networking · startup · tech · gaming
```

23 options. Multi-select. Stored as a JSON array in the DB.

---

## Data Model

### `users` table (SQLite)

```sql
CREATE TABLE users (
  id             TEXT PRIMARY KEY,    -- UUID v4
  email          TEXT UNIQUE,         -- null for Google-only users
  password_hash  TEXT,                -- null for Google-only users
  google_id      TEXT UNIQUE,         -- null for email users
  display_name   TEXT NOT NULL,
  birth_year     INTEGER,             -- e.g. 1995. null = not set
  profile_photo_url TEXT,
  home_city      TEXT,
  interests      TEXT DEFAULT '[]',   -- JSON array of strings
  guest_id       TEXT,                -- original guestId before upgrade
  created_at     INTEGER NOT NULL,    -- unix timestamp
  updated_at     INTEGER NOT NULL
);
```

No separate profile table — keeps it simple. One row per user, everything inline.

---

## API Endpoints

### Auth

```
POST /api/v1/auth/signup
Body: { email, password, display_name, guest_id? }
Response: { user }
Creates account. Logs the user in (sets session). Optionally links guest_id.

POST /api/v1/auth/login
Body: { email, password }
Response: { user }
Logs in. Sets session.

POST /api/v1/auth/google
Body: { id_token }   ← Google ID token from frontend Google Sign-In
Response: { user, created: bool }
Verifies token with Google. Creates or logs in. Sets session.

POST /api/v1/auth/logout
Response: 200
Clears user session (guest session remains intact).

GET /api/v1/auth/me
Response: { user } or 401
Returns the currently logged-in user.
```

### Profile

```
PUT /api/v1/profile
Auth: required
Body: { display_name?, birth_year?, home_city?, interests?, profile_photo_url? }
Response: { user }
Updates own profile. Partial update — only send what changed.

GET /api/v1/users/{userId}
Auth: none
Response: { user } (public fields only)
Public profile view.
```

### Photo upload
Reuse existing `POST /api/v1/uploads` endpoint — already validates R2 origin.
The returned URL is then saved via `PUT /api/v1/profile`.

### Request/response examples

**Signup**
```json
POST /api/v1/auth/signup
{
  "email": "alice@example.com",
  "password": "hunter2",
  "display_name": "Alice",
  "guest_id": "abc123"
}

→ 201
{
  "user": {
    "id": "uuid-here",
    "display_name": "Alice",
    "profile_photo_url": null,
    "home_city": null,
    "interests": [],
    "age": null
  }
}
```

**Public profile**
```json
GET /api/v1/users/uuid-here

→ 200
{
  "user": {
    "id": "uuid-here",
    "display_name": "Alice",
    "age": 29,
    "profile_photo_url": "https://r2.hilads.app/abc.jpg",
    "home_city": "Paris",
    "interests": ["music", "coffee", "travel"]
  }
}
```

---

## Backend Structure

New files to create:

```
src/
  Database.php          ← PDO SQLite singleton, runs migrations on first boot
  UserRepository.php    ← CRUD for users table
  AuthService.php       ← signup, login, Google token verification, session helpers
  GoogleAuth.php        ← verifies Google ID token (HTTP call to Google's tokeninfo)
```

New routes in `api.php`:
```
POST /api/v1/auth/signup
POST /api/v1/auth/login
POST /api/v1/auth/google
POST /api/v1/auth/logout
GET  /api/v1/auth/me
PUT  /api/v1/profile
GET  /api/v1/users/{userId}
```

**Session model after login:**
```php
$_SESSION['user_id'] = $user['id'];
// guest session remains — $_SESSION['guests'][$guestId] still works
```

Display name resolution (everywhere in the app a nickname is shown):
- If user is logged in → use `display_name` from their account
- Otherwise → use `nickname` from guest session (unchanged behavior)

This requires no changes to the existing chat/event/presence endpoints.
The frontend is responsible for sending the right nickname.

---

## Frontend Structure

New screens:

```
screens/
  AuthScreen.jsx        ← login / signup tabs (email + Google)
  MeScreen.jsx          ← own profile view + edit entry point
  EditProfileScreen.jsx ← edit display_name, photo, age, city, interests
  PublicProfileScreen.jsx ← read-only public profile (shown on user tap)
```

New state (added to App.jsx or a dedicated auth context):
```js
const [account, setAccount] = useState(null)  // null = guest, object = logged in
```

**Auth flow:**
```
Me tab tapped
  → if no account → show AuthScreen (login / signup choice)
  → if account exists → show MeScreen

AuthScreen
  → signup tab: email + password + display_name → POST /auth/signup → setAccount
  → login tab: email + password → POST /auth/login → setAccount
  → Google button → Google Sign-In SDK → POST /auth/google → setAccount

MeScreen
  → shows profile fields
  → "Edit profile" button → EditProfileScreen
  → "Sign out" → POST /auth/logout → setAccount(null)

EditProfileScreen
  → edit display_name, photo (reuses upload flow), birth_year, home_city, interests
  → PUT /profile → updates account state

PublicProfileScreen
  → full-screen overlay, shown when tapping a username/avatar in chat
  → GET /users/{userId} → renders public fields
```

**Guest upgrade CTA:**
A soft nudge shown in MeScreen when user is a guest:
- "Save your profile" button → opens AuthScreen
- No forced interruption. Guest can ignore it.

---

## Guest Upgrade Flow

```
User is chatting as guest (guestId = "abc123", nickname = "Nomad42")

User opens Me tab → sees guest profile + "Create account" CTA

User taps "Create account" → AuthScreen opens

User fills email + password → frontend sends { ..., guest_id: "abc123" }

Backend:
  1. creates user with display_name = "Nomad42" (from guest nickname)
  2. stores guest_id = "abc123" in user record
  3. sets $_SESSION['user_id'] = new user id

Frontend:
  1. sets account state
  2. uses display_name from account for all future messages
  3. guestId is still in localStorage — still valid for existing messages
```

Past messages keep the guest nickname — no backfill needed. Only future messages use the account display_name.

---

## Security & Validation

**Password rules:**
- minimum 8 characters
- no maximum (bcrypt truncates at 72 bytes — enforce 72 char max to avoid confusion)
- no complexity requirements (friction without real security benefit)
- hashed with `password_hash($pw, PASSWORD_BCRYPT)`

**Email:**
- validated with PHP `filter_var($email, FILTER_VALIDATE_EMAIL)`
- stored lowercase

**Google ID token:**
- verified by calling `https://oauth2.googleapis.com/tokeninfo?id_token=<token>`
- validate `aud` matches our Google client ID
- no SDK needed — one HTTP call

**Profile fields:**
- `display_name`: 1–30 chars, strip HTML tags
- `birth_year`: integer, between (current_year - 100) and (current_year - 18)
- `home_city`: max 60 chars, strip tags
- `interests`: array of strings, each must be in the allowed list, max 10 selected
- `profile_photo_url`: must start with R2 public URL base (same check as image messages)

**Access control:**
- `PUT /profile` and `GET /auth/me` require `$_SESSION['user_id']`
- `GET /users/{userId}` is public, returns only public fields
- email/password_hash/google_id never returned by any endpoint

---

## Implementation Plan

### Phase 1 — Backend foundation (build first)
1. `Database.php` — SQLite singleton, auto-migrate `users` table on first boot
2. `UserRepository.php` — create, find by email, find by google_id, update, find by id
3. `AuthService.php` — signup, login, session helpers
4. Routes: `POST /auth/signup`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`
5. Route: `PUT /profile`
6. Route: `GET /users/{userId}`

### Phase 2 — Frontend auth screens
1. `AuthScreen.jsx` — email/password login + signup tabs
2. `MeScreen.jsx` — guest state (upgrade CTA) + logged-in state (profile view)
3. Wire Me tab to show AuthScreen vs MeScreen based on account state

### Phase 3 — Profile editing
1. `EditProfileScreen.jsx` — photo, display_name, birth_year, home_city, interests picker
2. Photo upload reuses existing upload flow, saves URL via `PUT /profile`
3. Interests multi-select UI (chips/pills, max 10)

### Phase 4 — Public profiles
1. `PublicProfileScreen.jsx` — shown when tapping a username in chat
2. Tap target on usernames/avatars in chat feed → opens public profile overlay

### Phase 5 — Google Sign-In (later)
1. Add Google Sign-In button to AuthScreen
2. `GoogleAuth.php` — verify ID token
3. Route: `POST /auth/google`
4. Frontend Google SDK integration

### Phase 6 — Display name propagation (later, non-breaking)
When a logged-in user sends a message, the frontend sends `display_name` instead of `nickname`.
No backend change needed — messages already store the name sent.
Optional: add a `user_id` field to messages for linking to public profile.

---

## What to Build Now vs Later

**Now (Phase 1–3):**
- SQLite + user table
- Email signup/login
- Me tab with own profile
- Profile editing (display_name, photo, city, interests, age)
- Guest upgrade CTA

**Later (Phase 4–6):**
- Public profile views (tap on username)
- Google Sign-In
- Display name / message linking
- Profile completeness nudges
- Account deletion

---

## Non-Goals (explicitly out of scope)

- Follow/friend system
- Private messaging
- Notifications
- Profile bio / long text
- Social links
- Reputation / karma
- Activity feed
