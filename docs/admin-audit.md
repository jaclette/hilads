# Hilads Admin: audit and redesign plan (2026-11-25)

Status: **audit only, nothing changed.** Waiting for a go before implementing.

- Full page-by-page inventory (every URL, action, table, protection, with file:line): [admin-audit/inventory.md](admin-audit/inventory.md)
- Mockups (HTML + PNG, light / dark / tablet): [admin-audit/mockups/](admin-audit/mockups/)
  - `dashboard.png`, `dashboard-dark.png`, `dashboard-tablet.png`, `photos.png` (list page), `challenge-form.png` (form page)

---

## 1. What the admin is today

**Size.** 91 PHP files, 15,333 lines in `backend/api/admin/`, about 80 routes in one hand-written router (`admin/boot.php`). Plain server-rendered PHP: no template engine, no build step, no JS framework. All JavaScript is inline and vanilla; the only library is Leaflet (place picker).

**Why it looks broken.**
- The header is one flat row of **20 links** (`layout.php:254-275`), no grouping, no wrap rules: it spills over 3 lines on a laptop and pushes Sign out off screen. Only the Daily pages have any mobile rule.
- The shared stylesheet is 137 lines (`layout.php`), then **13 pages add their own `<style>`** and there are **984 inline `style=""` attributes** (contest.php alone: 97). Colors are hard-coded hex: no tokens, so no light mode and no consistency.
- Four different escaping helpers, three image-upload helpers, the push-sending code copied into Campaigns, the message soft-delete SQL copied in 3 files.

**Pages (20 nav items) and what to do with each.**

| Today's nav | What it is | Still used? | Goes to |
|---|---|---|---|
| Dashboard | 4 counters (users, Hi plan, messages) + Recalculate ranks, Backfill thumbnails, Reset all scores | counters are legacy | **Today › Dashboard** (rebuilt), the 3 actions → **System › Danger zone** |
| Users | list, create (fake users), edit (incl. score override, password), delete, ambassador roles | yes | **Community › Users** |
| Hi plan (`/admin/events`) | plans: one-shot / recurring, per-city chart | yes (Map › Plans, city chat) | **Community › Plans** |
| Hi now (`/admin/topics`) | city chat topics | yes (city chat) | **Community › Plans** (second tab "Topics") |
| Challenges | the old 1-to-1 / group challenges, proofs, pick winner | **legacy**: retired in the apps on 2026-11-16 | **Archive › Old challenges** (read-only) |
| ⚡ Campaigns | creates an old-style challenge + @hilads message + push | **legacy** (built on the retired challenges) | **Archive** (form disabled) |
| 🔥 Daily (13 tabs) | calendar, today, reserve, proposals, spots, picks, special days, seasonal events, promo, import, covers, translations, log | yes, the core | split: **Today › Daily challenges** (calendar, today, reserve, proposals, import, covers, translations), **Today › Special days & events** (special days, seasonal events), **Community › Places** (spots, picks), **Growth › Promo**, log → **System › Audit log** |
| 🌍 Worlds | Different Worlds video studio | yes (marketing) | **Growth › Worlds studio** |
| 🚀 Launch Season | contest seasons, 7 tabs | yes | **Game › Seasons** |
| Cities | search, auto-created cities, edit, merge, suburb rules | yes | **Community › Cities** (merge is super-admin only) |
| Messages | chat message search, soft / hard delete | yes | **Moderation › Messages** |
| Photos | every new photo (Daily, chat, avatars): keep / remove | yes | **Moderation › Photos** (+ the Daily › Today moderation queue merged in) |
| Scoring | v2 simulation, fair-play report, 2 switches, typed RESET | yes | **Game › Scoring** (simulation) + **Game › Fair play** (report + flagged voters + contest signals); reset → Danger zone |
| Hi questions | question of the day | yes | **Today › Hi questions** |
| Arrivals | system "X arrived" messages, ban button | diagnostic, rarely needed | **Archive › Arrivals** (ban button kept) |
| Reports | user reports, reviewed / dismiss / ban guest | yes | **Moderation › Reports** (+ reported photo comments from Daily › Today) |
| Bans | IP / guest bans | yes | **Moderation › Bans** |
| Email | Resend send, "all registered users" | yes, rarely | **Growth › Email** |
| Push | broadcast, schedule, history | yes | **Growth › Push** |
| App versions | min / latest per platform, block old apps, dual photo switch | yes | **System › App versions & switches** (with the scoring, Hi questions and seasonal-event switches) |

No page is deleted and **no data is touched** by the move: legacy pages go to an Archive group (collapsed), Campaigns' form is disabled with a note.

---

## 2. Auth and access today

| Topic | Today | Risk |
|---|---|---|
| Accounts | **One shared login** from env `ADMIN_USERNAME` / `ADMIN_PASSWORD` (`login.php:18-26`) | can't give someone access without giving them everything; can't revoke one person |
| Who did what | `admin_audit_log` exists (who, IP, before/after) but **only Daily, Places and Cities write to it**, and "who" is always the shared username | most actions leave no trace (see below) |
| Failed logins | written to the server log only, **no rate limit, no lockout** | password guessing |
| 2FA | none | |
| Session | cookie `hilads_admin`, httpOnly, SameSite=Strict, ends when the browser closes; **no idle timeout**; sessions are files on the Render instance, so **every deploy logs everyone out** | a forgotten open tab stays admin forever |
| CSRF | one token per session, checked on every POST (good) | |
| Writes on GET | `/admin/cities?view=auto` marks auto cities seen; the ranking CSV GET writes a log row | minor |

**Not logged at all today:** user create / delete / role changes, ban / unban (unban deletes the row, so even the ban disappears), report status, photo removals for chat and avatars, Hi questions, all of Worlds (incl. deleting a topic and its files), campaign create without push, cover removals, "use as theme cover".

---

## 3. Destructive and heavy actions today (the risky ones)

Full list (60+ actions) in the inventory §3. The ones that matter:

| Action | Touches | Protection today | Problem |
|---|---|---|---|
| **Reset all scores** | every user's score + the whole ledger (and optionally seasons) | from Scoring: typed RESET (server-checked). **From the Dashboard: a browser confirm only**, the server skips the RESET check (`scores_reset.php:33`) | one click away on the home page |
| **Email all registered users** | every registered user, irreversible | browser confirm only; no rate limit, no history; the page also prints every user's email address on each load | GDPR exposure, accidental blast |
| **Campaign create with push** | up to all users | **no confirm, no rate limit** (Push page has both) | duplicate of the Push page without its guards |
| **Daily import with "replace"** | deletes unplayed days, their twists and suggestions | dry run first, but **no confirm** on apply | |
| **App versions: block old apps** | every old-app user gets a 426 | **no confirm** | can lock users out |
| **City merge** | moves rows in ~25 tables, not undoable | preview with counts + browser confirm | OK, but anyone with the shared login can do it |
| **Recalculate ranks / backfill thumbnails** | all users / 20 per click | no confirm, on the Dashboard | heavy, sits next to everyday buttons |
| Places migration | deletes Google venues for good | dry run + confirm | OK |
| Message hard delete, Worlds topic delete | 1 item, irreversible | confirm | OK, but not logged |
| Ban guest from a report | guest + its IPs | **no confirm** | |

Also wrong texts: deleting a "Hi now" says it removes all its messages and can't be undone, but it's a soft delete that keeps the messages; same "can't be undone" on plans and challenges that are soft deletes.

---

## 4. Proposed sitemap

Left sidebar, grouped, each group collapsible (state remembered), badges for pending items. Header: global search (player, photo, city; `/` to focus), PROD / LOCAL pill, my name and role.

```
Today         Dashboard · Daily challenges (proposals badge) · Special days & events · Hi questions
Moderation    Photos (to-check badge) · Reports (open badge) · Messages · Bans
Community     Users · Cities (new auto cities badge) · Plans (plans + topics) · Places (spots + picks)
Game          Scoring · Seasons (Launch Season) · Fair play
Growth        Push · Email · Invites (new) · Worlds studio · Promo
System        App versions & switches · Settings (admins, roles, 2FA) · Audit log · Danger zone
Archive ▸     Old challenges · Campaigns · Arrivals          (collapsed, read-only)
```

Two items beyond your list, both from what exists today: **Places** (spots + Hilads picks, now buried in Daily) and **Worlds studio / Promo** (both active marketing tools). **Invites** is new: there is no admin view of crews / invite links today (read-only list: top inviters, links, conversions).

Badges cost one query each per page view today; the new shell computes them in **one** query and caches them 60 s.

---

## 5. The new dashboard (mockup: `dashboard.png`)

Every tile links to its page. What each number is and where it comes from:

| Block | Definition | Source |
|---|---|---|
| Photos today vs yesterday | approved + pending photos on today's / yesterday's challenge | `daily_proofs` by challenge date |
| Players today | distinct users with a photo today | `daily_proofs` |
| Cities that played | distinct cities with a photo today | `daily_proofs` |
| New sign-ups | registered accounts created today (Saigon day) vs yesterday | `users.created_at` |
| D1 / D7 retention | share of each day's sign-ups who **did something** (photo, like, comment, message) 1 day / 7 days later, averaged over the last 7 cohorts | `users` + activity tables. **Decision needed:** the server doesn't record app opens, so this is "came back and acted". True "opened the app" retention lives in PostHog (`app_open`); the tile can read PostHog's API instead if you prefer (needs a personal API key on Render) |
| Needs attention | photos to check (+ oldest), open reports, proposals to review, new auto cities | `photo_watch`, `user_reports`, `daily_proposals`, cities |
| Today's challenge | published at the drop? translated in N/19? cover set? morning push sent (devices)? | `daily_challenges`, `daily_push_log`, `daily_drop_runs` |
| Next 7 days | each day: challenge or **gap (red)**, ready / missing languages / no cover | `daily_challenges` |
| Season top 5 | current Launch Season (else the monthly season) | `Contest::standings` / ranks |
| Photos, last 14 days | bar per day | `daily_proofs` |
| Recent errors | **Decision needed:** nothing is stored server-side today. Option A: a link + the last 5 issues from Sentry's API (needs a Sentry auth token on Render). Option B: a small `api_errors` table filled by the API's error handler (no external dependency, server errors only) | Sentry / new table |

Removed: Registered users (moves to Users), Active / Total Hi plan, Messages count, and the three action buttons.

---

## 6. Safety model

**Danger zone** (System › Danger zone, super-admin only): Reset all scores, Recalculate ranks, Backfill thumbnails, Places migration, plus the ones that stay on their page but go through the same dialog (city merge, email all users, block old apps, import with replace).

Every destructive action:
1. **Server-side preview** of exactly what will change ("Will reset 79 users and delete 14 ledger rows; top scorer jaclette 50 pts").
2. **Typed phrase** checked on the server (e.g. `RESET SCORES`, the city name for a merge), never only a browser confirm.
3. **Super-admin role** required (checked on the server, not just hidden).
4. Written to the **audit log** with before / after.
5. Mass sends (email all, campaign / push to all) also get a **rate limit** and a recorded history.

**Accounts and roles.** A new `admin_users` table: email, name, password (Argon2id), role, optional TOTP 2FA secret, last login, disabled flag. The current env login becomes the first super admin and is then switched off.

| Role | Can |
|---|---|
| Super admin | everything, incl. Danger zone, Settings (admins), App versions, exports with personal data |
| Moderator | Moderation, Community (no city merge), read Today / Game |
| Content editor | Today (challenges, special days, Hi questions), Places, Worlds, Promo, Push to a test device only |
| Read-only | every page, no action |

Each route declares the permission it needs (one map, checked in the router), so a hidden button can never be called directly.

**Sessions.** Stored in the database (survive deploys: no more logout after each Render deploy), idle timeout 2 h (configurable), absolute 12 h, login rate limit (5 tries / 15 min per IP + account), "sign out everywhere".

**Audit log** (System › Audit log). One writer (`AdminAudit::log`) called by every handler: who (real person), role, IP, action in plain words, target, before / after. Filter by person, page, action, target, date. The existing `admin_audit_log` table is reused (a column `admin_user_id` added); Launch Season's own log and push history are shown in the same view.

---

## 7. Design system and stack

**Recommendation: keep the current PHP stack and add a real component layer.** A rewrite (React admin + JSON API) would mean re-exposing ~80 routes as API endpoints, re-doing auth, and rebuilding every form: roughly 6 to 8 weeks before it does what today's admin does. The problem today isn't PHP, it's that there is no shared CSS and no shared components. Fixing that is about a third of the cost and can ship page by page.

What gets built (all plain PHP + one CSS file + one small JS file, no build step):
- `admin/assets/admin.css`: tokens (color, type, spacing, radius) for **light and dark** (system setting + a toggle), the shell (sidebar, header), and components: buttons, badges, cards, KPI tiles, data table, toolbar / filters, bulk bar, pagination, form fields with help and error, tabs, callouts, empty and loading states, toasts, confirm dialog. Readable type (14 px base, 13 px tables), proper spacing, tablet layout (sidebar collapses to icons under 1100 px). The mockup's `admin.css` is the starting point.
- `admin/ui.php`: PHP helpers so pages stop hand-writing HTML: `ui_table($columns, $rows, sort / filter / pagination / bulk)`, `ui_field(...)` with help text and validation message, `ui_badge`, `ui_empty`, `ui_confirm(...)` (typed phrase), `ui_toast` (replaces flash), one escaping helper.
- `admin/assets/admin.js` (~150 lines): confirm dialog, toasts with Undo, table sort / select-all / bulk bar, sidebar state, `/` search shortcut, auto-submit filters.
- Labels in plain words everywhere: no table names (`score_events` → "points history", `score_alltime` → "all-time points", `channel_events` → "plans").

---

## 8. Team comfort

- `docs/admin-guide.md` (written in phase 5): schedule a challenge, fill a gap, translate a day, moderate a photo, handle a report, ban someone, run a Launch Season (create → copy content → publish → final week → winner), send a push safely, add a team member.
- Inline help: a "How this works" link on the complex pages (Daily challenge form, Photos, Scoring, Seasons, Cities merge) opening a short side panel; help text under every non-obvious field (mockup: `challenge-form.png`).

---

## 9. Phased plan

Effort = my working days. Each phase ships on its own and leaves the admin working.

| Phase | What | Effort |
|---|---|---|
| **0. Safety quick wins** | Danger zone page; typed + server-checked confirmation on reset / email all / campaign push / import replace / block old apps / ban from report; rate limit on login and email-all; stop printing all emails on the Email page; idle session timeout; fix the wrong "can't be undone" texts; disable the Campaigns form | 1.5 |
| **1. Shell + design system** | `admin.css`, `admin.js`, `ui.php`; new layout with grouped sidebar, badges (1 cached query), header search (players, photos, cities), light / dark. Every existing page renders inside the new shell right away (nav fixed everywhere on day one) | 3 |
| **2. Accounts, roles, audit** | `admin_users` + roles + route permission map, DB sessions (no logout on deploy), optional TOTP 2FA, Settings › Admins page (invite, change role, disable), audit writer on every handler + Audit log page | 4 |
| **3. Dashboard** | new dashboard (§5), with your choices on retention and errors | 2 |
| **4. Pages onto the components** | by group, removing inline styles and internal labels, adding inline help: Moderation (2), Today / Daily (3), Community (2), Game + Growth + System (2) | 9 |
| **5. Docs and archive** | `docs/admin-guide.md`, Archive group, final label pass | 1 |
| **Total** | | **≈ 20 days** |

Phases 0 and 1 alone remove the broken nav and the riskiest one-click actions in about 4.5 days.

---

## 10. Decisions I need from you

1. **Go / no go** on keeping PHP (recommended) vs a rewrite.
2. **Retention:** "came back and did something" from our own data, or "opened the app" from PostHog (needs a PostHog personal API key on Render)?
3. **Recent errors:** Sentry API (needs a Sentry token on Render) or our own small error table?
4. **Roles:** the 4 roles above OK? Who should get access first (names / emails), and is 2FA required for super admins?
5. **Archive:** OK to move Challenges, Campaigns (form disabled) and Arrivals to a collapsed Archive group?
6. **Order:** start with phases 0 + 1 (safety + new shell), then the rest?

---

## 11. Decisions (2026-11-25) and progress

Decided: keep PHP; retention from PostHog (read-only key, `query:read`), until then labelled "Active players who came back";
errors from Sentry (read-only token, `event:read`), no own error table; four roles, one super admin for now, 2FA required for
super admins, optional for others, recovery codes + a documented recovery path; Archive = Old challenges, Campaigns, Arrivals
(read-only, data kept); keys and tokens only as Render environment variables.

Done (phases 0 + 1, plus accounts pulled forward from phase 2), local, not deployed:
- Accounts: `admin_users`, sign-in with email + password + TOTP, 10 single-use recovery codes, lockout (5 / 15 min per IP or
  email), DB sessions (survive deploys, 2 h idle / 12 h max), My account, Settings › Admins, `scripts/admin_recover.php`.
  The shared env login only creates the first super admin.
- Roles checked on every route (`AdminAuth::area` + `canView/canEdit`), Archive read-only for everyone.
- Danger zone (reset scores, ranks, thumbnails, places migration) with counts and server-checked phrases; city merge, email
  to everyone (+ once a day), block old apps, import replace protected the same way; the all-emails list removed from Email;
  wrong "can't be undone" texts fixed; ban from a report confirms.
- Audit log page (filters, before/after); sign-ins, account changes, danger actions, app settings, email-to-all logged with
  the person.
- Shell: grouped collapsible sidebar with counts, search (players, photos, cities, `/`), PROD/LOCAL, theme (system/light/
  dark), one stylesheet + one script, old pages' colours on tokens (readable in light mode), tablet + phone layouts.
- Screenshots: `docs/admin-audit/phase1/`.

Next: phase 2 rest (audit lines in every remaining handler), phase 3 dashboard, phase 4 pages, phase 5 guide.
