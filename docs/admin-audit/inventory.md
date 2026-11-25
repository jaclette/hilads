# Hilads admin back office: factual inventory (2026-11-25)

Scope: `backend/api/admin/*.php` (91 files, 15,333 lines). Entry: `public/index.php:40-163` loads `.env`, ~100 `require_once` of `src/` classes, then `admin/boot.php`. All paths below are relative to `backend/api/admin/` unless noted.

Auth model (facts):
- One shared account: `ADMIN_USERNAME` / `ADMIN_PASSWORD` env, compared with `hash_equals` (login.php:18-26). No per-person accounts, no roles, no 2FA.
- Failed logins: `error_log('[admin] failed login attempt from IP …')` only (login.php:33). No rate limit / lockout on login.
- Session cookie `hilads_admin`, path `/admin`, `httponly`, `samesite=Strict`, `secure` only if `$_SERVER['HTTPS']` set, lifetime 0 (boot.php:8-16). `session_regenerate_id(true)` on login (login.php:27).
- `admin_require_login()` (auth.php:10) is called by every routed page except login.php; also inline for `/admin/api/cities/{n}/members` (boot.php:324).
- CSRF: one token per session (csrf.php:5-11), `csrf_verify()` checks `$_POST['csrf_token']` (csrf.php:18-25). Called by every POST handler found (see §3). `worlds_api.php:16-21` re-implements the check to answer JSON.

---

## 1. Routed URLs (boot.php:80-360)

Nav = top-nav item the page highlights via `admin_nav()`.

| URL | File | Method(s) | Purpose (from code) | Level | Nav |
|---|---|---|---|---|---|
| `/admin`, `/admin/` | dashboard.php | GET | 4 counters + Recalc ranks, Backfill thumbs, Danger zone "Reset all scores" | top | Dashboard |
| `/admin/login` | login.php | GET, POST | Login form, env credential check | top (no nav) | - |
| `/admin/logout` | logout.php | POST only | CSRF check, destroy session | action | - |
| `/admin/users` | users.php | GET | User list (search, filters active/fake/deleted) + per-city "new users" chart | top | Users |
| `/admin/users/create` | user_create.php | GET, POST | Create a registered (often fake) user with avatar, city, vibe | sub | Users |
| `/admin/users/{id}/edit` | user_edit.php | GET, POST | Edit profile, email, password, avatar, scores, current city, is_fake | sub | Users |
| `/admin/users/{id}/delete` | user_delete.php | GET (confirm page), POST | Soft-delete user + kill sessions/push tokens | sub | Users |
| `/admin/users/{id}/roles` | user_roles.php | GET, POST | Add/remove city ambassador role (`user_city_roles`) | sub | Users |
| `/admin/topics` | topics.php | GET | "Hi now" list + per-city chart | top | Hi now |
| `/admin/topics/create` | topic_create.php | GET, POST | Create a Hi now topic for a city/creator | sub | Hi now |
| `/admin/topics/{id}/edit` | topic_edit.php | GET, POST | Edit title/description/category/expiry | sub | Hi now |
| `/admin/topics/{id}/delete` | topic_delete.php | POST only | Soft-delete topic channel | action | Hi now |
| `/admin/messages` | messages.php | GET | Message search per channel/type/date + per-city charts | top | Messages |
| `/admin/messages/{id}/delete` | message_delete.php | POST only | Soft-delete (tombstone) a message | action | Messages |
| `/admin/messages/{id}/hard-delete` | message_hard_delete.php | POST only | Physically delete message + reactions | action | Messages |
| `/admin/photos` | photos.php | GET, POST | PhotoWatch feed (Daily, chat, avatar photos): seen / keep / remove | top | Photos |
| `/admin/launch-season/export` | contest_export.php | GET (ranking), POST (participants) | CSV exports; participants needs password re-entry | sub | Launch Season |
| `/admin/launch-season` | contest.php | GET, POST (+GET `?suggest=1` JSON) | Contest seasons, 7 tabs, all contest actions | top | Launch Season |
| `/admin/hi-questions` | hi_questions.php | GET, POST | Question-of-the-day lists + on/off switch | top | Hi questions |
| `/admin/scoring` | scoring_save.php | POST | Save 2 fair-play switches in `app_settings` | action | Scoring |
| `/admin/scoring` | scoring.php | GET (+`?csv=1`) | Scoring v2 simulation + fair-play report + typed-RESET reset form | top | Scoring |
| `/admin/arrivals` | arrivals.php | GET | City arrivals (system join messages) + ban button + charts | top | Arrivals |
| `/admin/bans` | bans.php | GET | Active bans list + add form | top | Bans |
| `/admin/bans/add` | ban_add.php | POST only | Ban IP / guest / guest+IPs | action | Bans |
| `/admin/bans/{n}/unban` | ban_unban.php | POST only | Delete ban row | action | Bans |
| `/admin/campaigns`, `/admin/campaigns/create` | campaign_create.php | GET, POST | Create @hilads 2x campaign challenge, auto-share message, optional push | top (form only, no list) | Campaigns |
| `/admin/worlds` | worlds.php | GET (+`?brief=1` JSON download), POST | Different Worlds month calendar, create topic, import packages | top | Worlds |
| `/admin/worlds/settings` | worlds_settings.php | GET, POST | Prompts/style settings; "apply CTAs" to all packages | sub | Worlds |
| `/admin/worlds/api` | worlds_api.php | POST only (JSON) | Inline edits, staged import, Pixabay clip search/pick, rows save | XHR | Worlds |
| `/admin/worlds/{n}` | worlds_topic.php (+includes worlds_reaction.php / worlds_race.php) | GET (+`?zip`, `?v=`), POST | One topic: package, slides, fields, status, delete | sub | Worlds |
| `/admin/daily` | daily.php | GET | Calendar: past 7 + next 30 days, gaps, reserve count | top | Daily (Calendar) |
| `/admin/daily/today` | daily_today.php | GET, POST | Today's challenge, moderation queue, reported comments, twists, live cities | sub | Daily (Today) |
| `/admin/daily/reserve` | daily_reserve.php | GET, POST | Reserve challenge list + add | sub | Daily (Reserve) |
| `/admin/daily/proposals` | daily_proposals.php | GET, POST | Player challenge/twist proposals, rejection templates | sub | Daily (Proposals) |
| `/admin/daily/spots` | daily_spots.php | GET | Places list with filters | sub | Daily (Spots) |
| `/admin/daily/spots/review` | daily_spots_review.php | GET, POST | Pending places: approve/rename, merge, reject | sub-sub | Daily |
| `/admin/daily/spots/new` | daily_spot_new.php | GET, POST | Seed a spot (photo + position via Leaflet/Nominatim) | sub-sub | Daily |
| `/admin/daily/picks` | daily_picks.php | GET, POST | Hilads picks (editorial places): create/edit/attach/detach | sub | Daily (Picks) |
| `/admin/daily/spots/geocode` | daily_spots_geocode.php | GET (JSON) | Nominatim address search proxy | XHR | - |
| `/admin/daily/spots/migration` | daily_spots_migration.php | GET (dry run), POST (apply) | PlacesMigration report/apply | sub-sub | Daily |
| `/admin/daily/spots/{16hex}` | daily_spot.php | GET, POST | One spot: rename, tags, hide/show, approve/reject, merge | sub-sub | Daily |
| `/admin/daily/specials` | daily_specials.php | GET, POST | Special days + theme covers | sub | Daily (Special days) |
| `/admin/daily/events` | daily_events.php | GET, POST | Seasonal events (kill switch, features, preview users) | sub | Daily (Seasonal events) |
| `/admin/daily/promo` | daily_promo.php | GET, POST | Promo assets per day + exclude/include a photo | sub | Daily (Promo) |
| `/admin/daily/import` | daily_import.php | GET, POST | JSON bulk import, dry run then apply (optional replace) | sub | Daily (Import) |
| `/admin/daily/covers` | daily_covers.php | GET, POST (+`?one=1` JSON) | Bulk cover upload by file name date | sub | Daily (Covers) |
| `/admin/daily/translations` | daily_translations.php | GET (+`?download=1`), POST | Translations export/import (dry run then apply) | sub | Daily (Translations) |
| `/admin/daily/log` | daily_log.php | GET | Last 100 `admin_audit_log` rows, filterable | sub | Daily (Log) |
| `/admin/daily/new` | daily_edit.php (`$dailyId=null`) | GET, POST | New challenge or reserve | sub | Daily |
| `/admin/daily/{16hex}` | daily_edit.php | GET, POST | Edit one challenge: 19 actions (see §3) | sub | Daily |
| `/admin/challenges` | challenges.php | GET | Legacy/campaign challenges list with photo proofs + per-city chart | top | Challenges |
| `/admin/challenges/{id}/submissions` | challenge_submissions.php | GET | Group photo submissions, pick winner | sub | Challenges |
| `/admin/challenges/{id}/pick-winner` | challenge_pick_winner.php | POST only | Crown winner: score_events, validate, notify | action | Challenges |
| `/admin/challenges/{id}/delete` | challenge_delete.php | POST only | Soft-delete challenge + its shared messages | action | Challenges |
| `/admin/challenges/{id}/proof/replace` | challenge_proof_replace.php | POST only | Replace latest proof image (R2 upload) | action | Challenges |
| `/admin/challenges/{id}/proof/{pid}/delete` | challenge_proof_delete_one.php | POST only | Hard-delete one group submission | action | Challenges |
| `/admin/challenges/{id}/proof/delete` | challenge_proof_delete.php | POST only | Hard-delete latest proof ("legacy single-proof") | action | Challenges |
| `/admin/challenges/{id}/edit` | challenge_edit.php | GET, POST | Edit challenge fields + channel name/parent | sub | Challenges |
| `/admin/reports` | reports.php | GET | `user_reports` list by status | top | Reports |
| `/admin/reports/{n}/status` | report_status.php | POST only | Set open/reviewed/dismissed | action | Reports |
| `/admin/reports/{n}/ban-guest` | report_ban_guest.php | POST only | 7-day guest+IP ban, mark reviewed | action | Reports |
| `/admin/events` | events.php | GET | "Hi plan" list (filters) + per-city chart | top | Hi plan |
| `/admin/scores/reset-all` | scores_reset.php | POST only | Wipe score ledger + user aggregates (+seasons opt.) | action | Dashboard / Scoring |
| `/admin/ranks/recalc-all` | ranks_recalc.php | POST only | `MonthlyRankService::recalcAll()` | action | Dashboard |
| `/admin/thumbs/backfill` | thumbs_backfill.php | POST only | 20 avatar thumbnails per click (R2) | action | Dashboard |
| `/admin/email` | email.php | GET, POST | Send email via Resend (To/BCC or all users 1:1) | top | Email |
| `/admin/push` | push.php | GET, POST (+JSON `search_user`/`count`) | Push broadcast: test/send/schedule/cancel + history | top | Push |
| `/admin/app-versions` | app_versions.php | GET, POST | Min/latest versions per platform, block old apps, dual_photo switch | top | App versions |
| `/admin/cities` | cities.php | GET | City search / "Created automatically" view | top | Cities |
| `/admin/cities/suburbs` | city_suburbs.php | GET, POST | `geo_city_overrides` rules | sub | Cities |
| `/admin/cities/city_{n}` | city_edit.php | GET, POST | Edit city (name, live, tolerance…), merge preview form | sub | Cities |
| `/admin/cities/city_{n}/merge` | city_merge.php | GET (plan), POST (merge) | Merge city into another | sub | Cities |
| `/admin/events/create` | event_create.php | GET, POST | Create one-shot event or recurring series | sub | Hi plan |
| `/admin/api/cities/{n}/members` | inline in boot.php:323-342 | GET (JSON) | Up to 100 members of a city (creator picker) | XHR | - |
| `/admin/events/{id}/edit` | event_edit.php | GET, POST | Edit event (+series fields), status | sub | Hi plan |
| `/admin/events/{id}/delete` | event_delete.php | POST only | Soft-delete one occurrence or end a series | action | Hi plan |
| anything else | boot.php:351-359 | any | 404 page | - | - |

Nav (layout.php:254-275), 20 items in one horizontal `<nav>`: Dashboard, Users, Hi plan, Hi now, Challenges, ⚡ Campaigns, 🔥 Daily, 🌍 Worlds, 🚀 Launch Season, Cities, Messages, Photos, Scoring, Hi questions, Arrivals, Reports, Bans, Email, Push, App versions. Badges: Daily = pending proposals (`DailyProposals::pendingCount()`), Photos = `PhotoWatch::unseenCount()`, Cities = `CityAdmin::newAutoCount()` (link switches to `?view=auto`). Each badge = 1 query per page view.

Daily sub-nav (daily_common.php:155-179), 13 tabs: Calendar, Today, Reserve, Proposals, Spots, Picks, Special days, Seasonal events, Promo, Import, Covers, Translations, Log. Spots review/new/migration are linked from the Spots page only (daily_spots.php:48-50).
Worlds sub-nav (worlds_common.php:13-21): Calendar, Settings.
Launch Season tabs (contest.php:15-16): Seasons, Dashboard, Participants, Signals, Winner & export, Rules, Log.

---

## 2. Per nav item

Tables: R = read, W = written (direct SQL in the admin file or via the named `src/` class).

**Dashboard** (dashboard.php 115 + actions ranks_recalc 33, thumbs_backfill 132, scores_reset 108)
- Shows: Registered users, Active Hi plan, Total Hi plan, Messages, score_events count, top scorer, thumbs-missing count.
- Actions: Recalculate ranks (no confirm), Backfill avatar thumbnails (no confirm, 20/click), Reset all scores (JS confirm).
- R: users, channel_events, channels, messages, score_events. W (actions): users (monthly_rank_*, score_*, profile_thumb_photo_url), score_events (DELETE), season_results/seasons (opt.).

**Users** (users 271, user_create 368, user_edit 605, user_delete 66, user_roles 184 = 1,494)
- List: search, filter active/fake/deleted, pagination; row links Edit / Roles / Delete (users.php:240-242); default view = per-city new-users chart (`_city_activity.php`).
- Create: display_name, email, password, username, home_city (city picker), vibe, birth_year, avatar upload (R2), is_fake.
- Edit: same + current_city_id, score_alltime, score_month (direct override), remove_avatar, password reset; triggers MonthlyRankService recalcs.
- Delete: separate confirm page (bullet list, "Reversible by an engineer").
- Roles: add/remove ambassador per city.
- R/W: users, user_city_memberships (upsert), user_city_roles, user_sessions (DELETE), mobile_push_tokens (DELETE), channels (R).

**Hi plan /admin/events** (events 308, event_create 405, event_edit 425, event_delete 56 = 1,194)
- List with filters active/expired/deleted/recurring/one-shot; per-city chart default. Row: Edit, Delete / Del. occurrence / Del. series.
- Create: one-shot or recurring series, city, creator (members via `/admin/api/cities/{n}/members`).
- R/W: channel_events, channels, event_series, users, user_city_memberships (R).

**Hi now /admin/topics** (topics 261, topic_create 231, topic_edit 200, topic_delete 35 = 727)
- List (active/expired), message counts, per-city chart. Create / Edit / Delete.
- R/W: channel_topics, channels, messages (R count), users.

**Challenges** (challenges 307, submissions 81, edit 238, pick_winner 143, delete 63, proof_replace 55, proof_delete 42, proof_delete_one 42 = 971)
- List by city/date with latest proof or group submissions, winner marks; row actions Edit, Submissions, Delete, per-photo delete, replace proof, delete proof. Per-city chart.
- Pick winner on submissions page.
- R/W: channel_challenges, channels, challenge_acceptances (R), challenge_proofs (UPDATE/DELETE), score_events (INSERT), score_rules (R), users (R), messages (soft-delete on challenge delete), notifications via `NotificationRepository::notifyGroupResult`.

**Campaigns** (campaign_create 336)
- Form only (no list; campaigns appear in Challenges). Scope city/world/global, type, title, origin city, push options (audience all/city/user, custom title/body).
- On submit: `ChallengeRepository::create`, `MessageRepository::add` as @hilads, WS broadcast (`campaign_broadcast_ws`, campaign_create.php:27-40), optional push via `PushBroadcastService`.
- W: channels/channel_challenges (via ChallengeRepository), messages, push_broadcasts (+ push delivery).

**Daily** (19 files + daily_common 329 = 3,136 lines)
- Calendar (daily 99): R daily_challenges, daily_drop_runs, daily_specials, daily_twist proposals counts; links to `/admin/daily/{id}` and `/new`. No actions.
- Today (243): today's challenge stats, run status, moderation queue (50), reported comments (50), latest 20 approved photos, twists, flagged voters (`DailyVotes::flaggedVoters`), live cities with Turn off / Make live (city picker). Actions: approve, reject, dismiss_reports, remove_proof, keep_comment, remove_comment, remove_twist, force_live. R/W daily_proofs, daily_proof_reports, score_events (DELETE on reject/remove), photo_comments, photo_comment_reports, daily_twists (DELETE), cities.force_live, admin_audit_log.
- Reserve (75): add reserve text/context/theme; list used/unused. W daily_challenges.
- Proposals (188): approve (schedule or reserve, editable text/theme/twist/date), reject (with template + extra; author notified per flash text), pick/reject twist, add/delete rejection template. W daily_proposals, daily_challenges, daily_twists, daily_rejection_templates.
- Spots (84) / review (78) / new (67) / spot (138) / migration (81) / geocode (17): list+filters; approve/rename/merge/reject; seed with photo (R2) + Leaflet map; rename/tags/hide/show/approve/reject/merge; migration dry run/apply. W places, place_tags, daily_proofs (merge re-points), daily_challenges; migration via `PlacesMigration::run` (deletes "Google venues" per confirm text).
- Picks (163): create/update pick with photo + credit + note i18n, attach to a date with an answer, detach. W places, daily_proofs (suggestions), daily_pick_answers.
- Special days (180): save/delete special day, upload/remove special cover, upload/remove theme cover. W daily_specials, daily_challenges, daily_theme_covers.
- Seasonal events (135): save/delete event (stored in app_settings). W app_settings.
- Promo (148): shows `DailyPromo::data/assets` and candidate photos; exclude/include a photo. W daily_proofs/daily_promo_assets (via DailyPromo).
- Import (92): JSON file or textarea; dry run report then apply; `replace` flag deletes/replaces unplayed days. W daily_challenges, daily_twists, daily_proofs (suggestions DELETE).
- Covers (209): multi-file upload, one XHR per file with progress bar. W daily_challenges.cover_url (via `DailyAdminService::setCover`), R2.
- Translations (100): download JSON (`?download=1&days=`), upload, dry run then apply. W daily_challenges, daily_twists (i18n columns).
- Log (54): `admin_audit_log` last 100, filter by entity type/id.
- Edit (656): fields, compare question, twists per live city, headline/subtitle/share-question i18n, translations, duplicate, move, delete, cover upload/remove/make-theme-default, test push, live preview cards (JS). W daily_challenges, daily_twists, daily_theme_covers, daily_push_log (test push), admin_audit_log.

**Worlds** (worlds 216, settings 82, api 103, topic 415, race 104, reaction 382, common 83 = 1,385)
- Calendar by month, create topic, brief JSON download, package import (multi-doc JSON). Topic page: package versions, slides, inline field edits (XHR), replace art/clip, status (planned/generated/ready/published with links), ZIP download, delete. Settings: prompts, style, countries; "apply CTAs" redraws all packages.
- R/W: dw_topics, dw_packages, dw_slides, dw_settings; R2 files (renders via rsvg, Pixabay clip download).

**Launch Season** (contest 868, contest_export 75 = 943)
- Tabs: Seasons (create/edit season settings, copy content, photos, itinerary, founder, prize, souvenir, testers, publish/pause/resume/end/reopen, head-start freeze), Dashboard (standings), Participants (invalidate photo/like, disqualify/undo), Signals, Winner & export (winner flags, ranking CSV, participants CSV with password), Rules (per-locale body, Final flag), Log (last 300 `contest_admin_log`).
- R/W: contest_seasons, contest_rules, contest_testers, contest_participants, contest_invalidations, contest_headstart, contest_admin_log; R users, daily_proofs, daily_votes, daily_challenges, user_devices.

**Cities** (cities 86, city_edit 136, city_merge 76, city_suburbs 125 = 423)
- Search / auto-created list (GET marks the auto list as seen: `CityAdmin::markAutoSeen`, cities.php:25). Edit city (name, force live, tolerance…), first members/photos, merge preview (counts per table) then merge, suburb overrides add/delete.
- W: cities, channels, geo_city_overrides, app_settings, admin_audit_log; merge moves rows in ~25 tables (CityAdmin.php:15-60 list: channels, messages, presence, user_city_memberships, arrival_cooldown, channel_read_positions, city_sync_log, channel_events, channel_topics, channel_challenges, event_series, daily_proofs, daily_proposals, daily_specials, daily_twists, daily_local_passes, daily_pioneers, daily_vote_flags, places, score_events, user_city_roles, users…), DELETE daily_results for the old scope (CityAdmin.php:302), sets old channel `status='merged'` (CityAdmin.php:317).

**Messages** (messages 505, message_delete 55, message_hard_delete 59, _messages_search_form 20 = 639)
- Channel list/search, messages per channel (type filter, text search, date range, pagination), soft delete + hard delete per row, per-city charts (sum/daily).
- R/W: messages, message_reactions (DELETE), channels.

**Photos** (183)
- New/All views, pagination, "Mark page seen", "Mark all seen", per-photo Keep / Remove.
- R/W: photo_watch, daily_proofs (via removeProof/approveProof), daily_proof_reports, messages, message_reports, users (avatar null), score_events (DELETE via removeProof), admin_audit_log (Daily photos only).

**Scoring** (scoring 258, scoring_save 29)
- Simulation of v2 rules over 7-90 days (`ScoringReport::simulate` + `fairPlay`, computed on every GET), CSV export, two switches form, typed-RESET reset form.
- R: score_events, daily_proofs, daily_votes, daily_challenges, users, user_devices. W: app_settings (switches).

**Hi questions** (93)
- On/off switch, per scope (city/world) table: edit text/position/active, delete, add, seed built-ins.
- R/W: hi_questions, app_settings.

**Arrivals** (329)
- Arrivals (system join messages) per city/date range, platform badge, flag, per-row "ban guest + IPs" button; charts.
- R: messages, channels, cities. W (button): bans via `/admin/bans/add` target guest_fanout.

**Reports** (reports 205, report_status 28, report_ban_guest 37)
- `user_reports` list by status (open count), links to reporter/target users and target delete page; buttons Reviewed / Dismiss / Reopen / Ban guest 7 days.
- R/W: user_reports, bans, messages (R for IPs), users (R).

**Bans** (bans 95, ban_add 34, ban_unban 17)
- Active bans (500), add form (IP / guest / guest+IPs, days, reason), Lift.
- R/W: bans (INSERT; unban = `DELETE FROM bans` BanRepository.php:152).

**Email** (484)
- From/To/BCC/Subject/Body (HTML allowed), Send test, "Send to all registered users" checkbox, and a field listing every registered email with a copy button (`all_registered_emails()`, email.php:90-102).
- R: users (emails). W: nothing in DB; external Resend API.

**Push** (727)
- Form: title, body, image upload (R2), deep link, audience (all, all_installs, old_app, city, user search), schedule (UTC+7), Test, Send; live audience count (XHR); scheduled list with Cancel; history of last 50 broadcasts.
- R/W: push_broadcasts, scheduled_pushes, users, mobile_push_tokens, notification_preferences, presence, old_app_seen (R); delivery log table push_delivery_log (via service).

**App versions** (113)
- Per-platform min/latest versions, block_old_apps (426 for versionless apps), dual_photo switch + testers, old-app counts.
- R/W: app_settings (with updated_by/updated_at), old_app_seen (R).

Shared/infra: layout 308, boot 360, auth 32, csrf 25, flash 23, login 77, logout 10, `_city_activity` 126, `_city_bar_chart` 34, `_daily_stacked_chart` 70.

---

## 3. Every write / delete / send / heavy action

Columns: Rev. = reversibility (soft = row kept/flag; hard = row deleted; irr. = cannot be undone by the UI). Scope = rows/users touched. Prot. = protections. All listed POST handlers call `csrf_verify()` unless noted. "No log" = nothing beyond the flash message.

### Global / Dashboard / Scoring
| Action | Does | Rev. | Scope | Protection | Logging |
|---|---|---|---|---|---|
| POST `/admin/scores/reset-all` (from Dashboard) | DELETE all score_events, zero users.score_*, clear monthly ranks; opt. keep today | hard, irr. | ALL users | CSRF (scores_reset.php:6); JS `confirm('Reset every user\'s score back to zero?\n\nThis wipes ALL score_events and resets every users.score_alltime / score_month to 0. Ratings stay.\n\nThis can\'t be undone.')` (dashboard.php:105); no typed check on this path | error_log `[admin-scores-reset]` (scores_reset.php:101) |
| same, from Scoring (`back=scoring`) | same + optional `with_seasons` DELETE season_results + seasons | hard, irr. | ALL users | CSRF; typed `RESET` checked client (scoring.php:246) and server `trim($_POST['confirm_text']) !== 'RESET'` (scores_reset.php:33) | error_log |
| POST `/admin/ranks/recalc-all` | Recompute monthly_rank_* for every city + world | recomputable | all users | CSRF (ranks_recalc.php:6); no confirm | error_log on failure only |
| POST `/admin/thumbs/backfill` | Download avatar, resize, upload to R2, set thumb URL | additive | 20 users/click | CSRF (thumbs_backfill.php:6); no confirm | none (flash) |
| POST `/admin/scoring` | 2 fair-play switches in app_settings | reversible | global rule | CSRF (scoring_save.php:6); no confirm | error_log (scoring_save.php:27) + app_settings.updated_by='admin' |

### Users
| Action | Does | Rev. | Scope | Protection | Logging |
|---|---|---|---|---|---|
| POST `/admin/users/create` | INSERT user (+avatar R2, membership) | - | 1 | CSRF (user_create.php:20) | none |
| POST `/admin/users/{id}/edit` | UPDATE profile, email, password hash, avatar, is_fake, scores, current city | overwrite (no history) | 1 | CSRF (user_edit.php:46); no confirm | error_log for score changes (user_edit.php:153,158) and city change (174) only |
| POST `/admin/users/{id}/delete` | users.deleted_at=now, DELETE user_sessions + mobile_push_tokens (UserRepository.php:302-308) | soft (tokens/sessions hard) | 1 | CSRF (user_delete.php:16) + separate GET confirmation page (user_delete.php:39-63) | none |
| POST `/admin/users/{id}/roles` action=add_role | INSERT user_city_roles | reversible | 1 | CSRF (user_roles.php:28) | none |
| action=remove_role | DELETE user_city_roles | hard | 1 | CSRF; `confirm('Remove this role?')` (user_roles.php:133) | none |

### Hi plan / Hi now
| Action | Does | Rev. | Scope | Protection | Logging |
|---|---|---|---|---|---|
| POST `/admin/events/create` | INSERT event or series | - | 1 | CSRF (event_create.php:17) | error_log (78, 125) |
| POST `/admin/events/{id}/edit` | UPDATE channel_events, event_series, channels | overwrite | 1 (series fields affect series) | CSRF (event_edit.php:56) | none |
| POST `/admin/events/{id}/delete` mode=single | channels.status='deleted', expires_at=now | soft | 1 | CSRF (event_delete.php:7); `confirm('Delete event «title»? This cannot be undone.')` (events.php:274) or `confirm('Delete this occurrence only?…')` (events.php:261) | error_log (event_delete.php:52) |
| mode=series | `EventSeriesRepository::deleteSeries` (ends series, soft-deletes future occurrences) | soft | series | CSRF; `confirm('DELETE ENTIRE SERIES?…This cannot be undone.')` (events.php:267) | error_log (40) |
| POST `/admin/topics/create` | `TopicRepository::adminCreate` | - | 1 | CSRF (topic_create.php:14) | error_log (64) |
| POST `/admin/topics/{id}/edit` | adminUpdate | overwrite | 1 | CSRF (topic_edit.php:51) | error_log (86) |
| POST `/admin/topics/{id}/delete` | channels.status='deleted', expires_at=now (TopicRepository.php:835-840) | soft | 1 | CSRF (topic_delete.php:6); `confirm('Delete Hi now «title»?\n\nThis will remove the Hi now and all its messages. Cannot be undone.')` (topics.php:228) | error_log (32) |

### Challenges / Campaigns
| Action | Does | Rev. | Scope | Protection | Logging |
|---|---|---|---|---|---|
| POST `/admin/challenges/{id}/edit` | UPDATE channel_challenges + channels | overwrite | 1 | CSRF (challenge_edit.php:51) | error_log (111) |
| POST `…/delete` | channels.status='deleted' + soft-delete every text/image message whose content LIKE `%/challenge/{id}%` | soft | 1 + N messages | CSRF (challenge_delete.php:7); `confirm('Delete challenge «title»? It will be hidden from the app. This cannot be undone.')` (challenges.php:248) | error_log (60) |
| POST `…/proof/{pid}/delete` | DELETE challenge_proofs row | hard | 1 | CSRF (challenge_proof_delete_one.php:7); `confirm('Delete this photo submission permanently? This cannot be undone.')` (challenges.php:204) | error_log (40) |
| POST `…/proof/delete` | DELETE latest challenge_proofs row | hard | 1 | CSRF; `confirm('Delete this photo proof permanently? This cannot be undone.')` (challenges.php:229) | error_log (40) |
| POST `…/proof/replace` | Upload to R2, UPDATE media_url (old URL lost) | irr. | 1 | CSRF (challenge_proof_replace.php:7); no confirm | error_log (53) |
| POST `…/pick-winner` | INSERT score_events (winner + host), validate challenge, approve proof, notify every submitter | irr. (no undo route) | 1 challenge, N users notified | CSRF (challenge_pick_winner.php:13); `confirm('Crown this photo as the winner? Points are awarded and the challenge is validated. This cannot be undone.')` (challenge_submissions.php:68); duplicate guard (38-41) | error_log (141) |
| POST `/admin/campaigns/create` | Create challenge, post message as @hilads, WS broadcast, optional push to all / city / user | message soft-deletable; push irr. | up to ALL users (push) | CSRF (campaign_create.php:42); **no confirm, no rate limit** | push_broadcasts row if push; otherwise none |

### Daily (all via `daily_action`, `$_POST['action']`)
| Action (URL / action=) | Does | Rev. | Scope | Protection | Logging |
|---|---|---|---|---|---|
| today: approve | Approve proof (+ score) | reversible via reject/remove | 1 | CSRF (daily_today.php:15); no confirm | admin_audit_log `daily_proof.approve` |
| today: reject | status rejected, DELETE score_events for proof, reports reviewed | status soft, points hard | 1 | CSRF; reason required (119); no confirm | audit `daily_proof.reject` |
| today: dismiss_reports | reports → dismissed | reversible | 1 | CSRF | audit `daily_proof.reports_*` |
| today: remove_proof | status removed, DELETE score_events (DailyAdminService.php:531-559) | soft row, points hard | 1 | CSRF; `confirm('Remove this proof and its cards?')` (daily_today.php:182) | audit `daily_proof.remove` |
| today: keep_comment / remove_comment | unhide / `photo_comments.deleted_at=now` | soft | 1 | CSRF; no confirm | **none** |
| today / edit: remove_twist | `DELETE FROM daily_twists` (DailyAdminService.php:508) | hard | 1 | CSRF; `confirm('Remove this twist?')` (daily_today.php:199, daily_edit.php:470) | audit `daily_twist.remove` |
| today: force_live | UPDATE cities.force_live | reversible | 1 city | CSRF; Turn off: `confirm('Turn this city off? Its twist and city cards stop.')` (daily_today.php:227); turn on: none | audit `city.force_live` |
| reserve: create | INSERT reserve challenge | - | 1 | CSRF (daily_reserve.php:12) | audit `daily_challenge.create_reserve` |
| proposals: approve / reject | Schedule or reserve proposal / reject with reason (author notified) | approve creates row | 1 | CSRF (daily_proposals.php:16); no confirm | audit `daily_proposal.*` |
| proposals: pick_twist / reject_twist | Twist pick / reject | - | 1 | CSRF; edit page reject: `confirm('Reject this proposal?')` (daily_edit.php:515) | audit `daily_twist.pick/reject` |
| proposals: add_template / delete_template | INSERT / DELETE daily_rejection_templates | delete hard | 1 | CSRF; no confirm | audit |
| spots review / spot: approve, reject, rename, tags, hide, show | places status/name/tags/hidden | reversible | 1 | CSRF (daily_spots_review.php:15, daily_spot.php:14) | audit `place.*` |
| spot / review: merge | Re-point proofs, DELETE place_tags of dropped, set merged_into | not undoable in UI | 1 + its proofs | CSRF; `confirm('Merge this spot into the one you picked?')` / `confirm('Merge this spot?')` (daily_spot.php:121,128); review page: none | audit `place.merge` |
| spots/new | Seed place + proof with photo (R2) | - | 1 | CSRF (daily_spot_new.php:14) | audit `place.seed` |
| spots/migration apply | `PlacesMigration::run(pdo, true)` | "Google venues are deleted for good" | bulk | CSRF (13); `confirm('Apply the migration? The Google venues are deleted for good.')` (75); dry run shown first | audit `places.migrate` |
| picks: create / update / attach / detach | Picks + attachments | detach reversible | 1 | CSRF (daily_picks.php:19); no confirm | audit `place.pick*` |
| specials: save / cover_upload / cover_remove / delete / theme_cover_upload / theme_cover_remove | special days + covers | delete hard | 1 (theme cover = every challenge of that theme) | CSRF (20); delete: `confirm('Delete this special day? Its challenges go back to their weekday theme.')` (151); others none | audit: save, cover, delete, theme cover upload; **cover_remove and theme_cover_remove: none** |
| events: save / delete | seasonal event in app_settings (kill switch affects all apps) | delete hard | global | CSRF (17); delete: `confirm('Delete <id>?')` (127); save: none | audit `seasonal_event.*` |
| promo: exclude / include | flag a proof out of promo | reversible | 1 | CSRF (20) | audit `daily_proof.promo_*` |
| import (step=apply, opt. replace=1) | Create/update days, reserve; replace deletes unplayed days, their twists and suggestion proofs (DailyAdminService.php:773-891) | hard when replace | bulk (all days in file) | CSRF (17); dry run first (hidden JSON re-posted); **no confirm** | audit `daily_challenge.import` |
| covers (bulk) | Upload cover per file, overwrite cover_url | overwrite | bulk | CSRF (74); no confirm | audit `daily_challenge.cover` per day |
| translations (step=apply) | Write i18n columns | overwrite | bulk | CSRF (25); dry run first | audit (DailyTranslations) |
| edit: save / move / duplicate / save_compare / set_twist / save_headline / save_subtitle / save_share_question / save_translations / save_twist_translations / cover_upload / cover_remove | challenge fields | overwrite | 1 | CSRF (daily_edit.php:24); no confirm | audit per action |
| edit: cover_as_theme | Make this cover the default for every challenge of the theme | overwrite | all challenges of theme w/o own cover | CSRF; no confirm | **none** (DailyThemes::setCover not audited here) |
| edit: delete | `DELETE FROM daily_challenges` (refused if published, DailyAdminService.php:326-329) | hard | 1 | CSRF; `confirm('Delete this challenge and its twists?')` (daily_edit.php:546) | audit `daily_challenge.delete` (before snapshot kept) |
| edit: test_push | Push to ADMIN_TEST_USER_ID devices | send | 1 admin | CSRF; no confirm | audit `daily_challenge.test_push` + daily_push_log |

### Worlds
| Action | Does | Rev. | Scope | Protection | Logging |
|---|---|---|---|---|---|
| worlds: create / import | INSERT topic; import packages, render slides to R2 (heavy) | - | 1..N | CSRF (worlds.php:28) | none |
| settings: save / apply_ctas | Save settings; `DwStudio::applyCtas()` redraws every package | overwrite | all packages | CSRF (worlds_settings.php:20); no confirm | none |
| topic: update / status / art / clip / import | edit, publish links, replace art/clip (R2) | overwrite | 1 | CSRF (worlds_topic.php:40) | none |
| topic: delete | `DELETE FROM dw_topics` + delete R2 files (DwStudio.php:263-278) | hard, irr. | 1 topic + packages + slides + files | CSRF; `confirm('Delete this topic, its packages and slides?')` (worlds_topic.php:316) | none |
| api: update_field, import_start/slide/done (prunes older versions: `pruneOlderVersions`), clip_search, clip_pick (download to R2), clip_ai, save_rows | XHR edits | import_done deletes old versions (hard) | 1 package | token check (worlds_api.php:16-21); no confirm | none |

### Launch Season (contest.php, `$_POST['do']`)
| do= | Does | Rev. | Scope | Protection | Logging |
|---|---|---|---|---|---|
| save_season (create/update), refreeze option | INSERT/UPDATE contest_seasons (+ placeholder rules) | overwrite | 1 season | CSRF (contest.php:75) | contest_admin_log `create` / `settings` (+changed fields), `refreeze_headstart` |
| copy_content | Overwrite photos, itinerary, founder, prize, souvenir from another season | overwrite | 1 season | CSRF; `confirm('Replace this season\'s photos, sample itinerary, founder word, prize text and souvenir prizes wi…')` (383) | log `copy_content` |
| save_prize, save_souvenir, trip_text, founder_meta, founder_photo, day_photo_upload, day_photo_pixabay, photo_upload, photo_pixabay, photo_up, photo_caption | content edits | overwrite | 1 | CSRF; none | logged |
| photo_remove | remove from list (file shared) | soft-ish | 1 | `confirm('Remove this photo from the season?')` (412) | logged |
| start (Publish) | status running (one real season at a time check, 227-231) | reopenable | public | `confirm('Publish this season? It becomes visible to everyone…')` (540) | log `start` |
| pause / resume / end / reopen | status flags | reversible | public | pause/end/reopen confirms (541, 543, 544); resume none | logged |
| freeze | Recompute head-start | overwrite | season players | `confirm('Replace the head-start with the current season top N?')` (545) | log `refreeze_headstart` |
| tester_add / tester_remove | contest_testers INSERT / DELETE | hard (re-add) | 1 | CSRF; none | logged |
| invalidate_photo / invalidate_vote / undo_invalidation | contest_invalidations | reversible | 1 | confirms (739, 746, 761) + reason required | logged (Contest.php:707,716) |
| disqualify / undo_disqualify | contest_participants flag | reversible | 1 | confirms (721, 723) + reason required | logged (Contest.php:726) |
| winner (set / flags) | winner_user_id, notified/shipped-type timestamps | reversible | 1 | confirms (806, 814) | log `winner_*` |
| rules | INSERT/UPSERT contest_rules per locale (Final flag) | overwrite | public text | CSRF; none | log `rules` |
| GET `/admin/launch-season/export?what=ranking` | CSV, no personal data | read | all participants | login only (GET, no CSRF) | log `export_ranking` |
| POST export what=participants | CSV with emails, country, 18+ | read (GDPR) | all participants | CSRF + **admin password re-entry** `hash_equals($pass, $_POST['password'])` (contest_export.php:47-53) | log `export_participants` (hashed IP) / `export_participants_refused` |

### Cities
| Action | Does | Rev. | Scope | Protection | Logging |
|---|---|---|---|---|---|
| POST `/admin/cities/city_{n}` | `CityAdmin::update` (name, force_live, tolerance…) | overwrite | 1 city | CSRF (city_edit.php:15); no confirm | audit `city.update` |
| POST `…/merge` | Move rows in ~25 tables, delete daily_results of old scope, old channel status merged | not undoable | whole city (all its users/content) | CSRF (city_merge.php:16); GET preview with counts first; `confirm("Merge {from} into {to}? This cannot be undone.")` (68) | audit `city.merge` (row counts) |
| POST `/admin/cities/suburbs` save / delete | geo_city_overrides upsert / delete | reversible | placement rule | CSRF (16); delete: `confirm('Remove this rule?')` (113) | audit `city.override` / `city.override_delete` |
| GET `/admin/cities?view=auto` | writes "auto seen" marker (`markAutoSeen`) | - | - | GET side effect, no CSRF | - |

### Messages / Photos / Reports / Bans / Arrivals
| Action | Does | Rev. | Scope | Protection | Logging |
|---|---|---|---|---|---|
| POST `/admin/messages/{id}/delete` | content='', image_url NULL, deleted_at | soft but content wiped (irr.) | 1 | CSRF (message_delete.php:7); `confirm('Soft-delete this message? It becomes a tombstone (the row is kept for context).')` (messages.php:186) | error_log (53) |
| POST `…/hard-delete` | DELETE message_reactions + messages (transaction) | hard, irr. | 1 | CSRF (message_hard_delete.php:7); `confirm('PERMANENTLY delete this message and any reactions on it? This removes the row entirely and cannot be undone.')` (messages.php:192) | error_log (55) |
| POST `/admin/photos` action=remove | daily: `removeProof`; chat: soft-delete message; avatar: NULL profile photo URLs; photo_watch.removed_at | daily/chat soft, avatar irr. | 1 | CSRF (photos.php:19); `confirm('Remove this photo from the app?')` (168) | daily → audit; chat/avatar → **none** (only photo_watch.removed_at) |
| action=keep | dismiss reports, approve pending daily, restore chat image | reversible | 1 | CSRF; none | daily → audit; else none |
| action=seen_page / seen_all | photo_watch.seen_at | reversible | page / all unseen | seen_all: `confirm('Mark all N photos as seen?')` (116) | none |
| POST `/admin/reports/{n}/status` | open/reviewed/dismissed | reversible | 1 | CSRF (report_status.php:6); none | none |
| POST `/admin/reports/{n}/ban-guest` | 7-day guest ban + IP bans from recent messages, report reviewed | reversible (unban) | 1 guest + N IPs | CSRF (report_ban_guest.php:6); **no confirm** | bans.created_by='admin', reason `admin: report #n`; no other log |
| POST `/admin/bans/add` | IP / guest / guest+IPs ban, days (0 = permanent; fanout default 36500) | reversible | 1..N | CSRF (ban_add.php:6); arrivals button `confirm('Block guest «who» and the IP(s) they arrived/posted from?')` (arrivals.php:161); bans page form: none | bans row only |
| POST `/admin/bans/{n}/unban` | `DELETE FROM bans` | hard (no history of the ban) | 1 | CSRF (ban_unban.php:6); `confirm('Lift this ban?')` (bans.php:83) | none |

### Email / Push / App versions / Hi questions
| Action | Does | Rev. | Scope | Protection | Logging |
|---|---|---|---|---|---|
| POST `/admin/email` send / send_test | Resend API to To/BCC | irr. | listed addresses | CSRF (email.php:119); none | error_log (234) |
| POST `/admin/email` send_all_users | 1:1 loop to every registered email, `set_time_limit(0)`, `ignore_user_abort(true)`, 200 ms pacing (email.php:155-180) | irr. | ALL registered users | CSRF; JS-only `confirm('This will email ALL registered users. Send to everyone?')` (email.php:453); **no rate limit, no server-side confirm** | error_log only (160; parse_emails logs every address, 29); no DB history |
| POST `/admin/push` action=send | Record broadcast, dispatch in `register_shutdown_function` (push.php:364) to resolved audience (+guest tokens for all_installs) | irr. | up to ALL users + guest devices | CSRF (167); **rate limit 10/hour** `RateLimiter::allow('admin_push_broadcast|user', 10, 3600)` (174-179); JS confirm with title/body/count (push.php:703-712); 0-audience alert | push_broadcasts (admin username, IP, title, body, audience, counts) + error_log on crash |
| action=send/test with schedule_at | INSERT scheduled_pushes (cron sends) | cancellable | audience | same rate limit + confirm | scheduled_pushes row (created_by) |
| action=test | Push to ADMIN_TEST_USER_ID | - | 1 | CSRF + rate limit; no confirm | push_broadcasts |
| action=cancel_schedule | status cancelled | - | 1 | CSRF; `confirm('Cancel this scheduled push?')` (558) | row status |
| POST `/admin/app-versions` | Save versions, block_old_apps, dual_photo(+testers) | reversible | ALL old-app users (block) | CSRF (app_versions.php:17); **no confirm** | app_settings.updated_by/updated_at (last change only) |
| POST `/admin/hi-questions` do=switch/add/save/delete/seed | app_settings flag; hi_questions CRUD; seed inserts built-ins | delete hard | global / 1 | CSRF (hi_questions.php:16); delete: `confirm('Delete this question?')` (84); others none | none (switch: updated_by='admin') |

Not found anywhere: typed confirmation other than the Scoring RESET; password re-entry other than the participants export; rate limiting other than Push send/test.

---

## 4. Logging / audit today

| Mechanism | Table / sink | Written by |
|---|---|---|
| Back-office audit log | `admin_audit_log` (admin_username = shared env user, admin_ip, action, entity, before/after JSON) via `DailyAdminService::audit` (src/DailyAdminService.php:1183) | Daily (challenge create/update/move/duplicate/delete/import/cover/translations/headline/subtitle/share_question/compare/schedule/test_push, twists, proofs approve/reject/remove/reports, proposals, templates, specials, seasonal events, promo), Spots/Picks (`place.*`, `places.migrate`), Cities (`city.update/merge/override/override_delete/force_live`). Viewer: Daily › Log (last 100). |
| Contest log | `contest_admin_log` via `Contest::log` (src/Contest.php:694) | Every contest.php action + exports (incl. refused password). Viewer: Launch Season › Log (last 300). |
| Push history | `push_broadcasts` (+ `push_delivery_log`, `scheduled_pushes`) | Push page send/test/schedule; Campaign push. Viewer: Push page history (50). |
| Daily push log | `daily_push_log` | daily_edit test_push (via DailyPushes). |
| Settings stamp | `app_settings.updated_by/updated_at` (overwritten, no history) | App versions, Scoring switches, Hi questions switch, seasonal events, CityAdmin settings. |
| PHP `error_log` (server logs only) | stderr | login failures, scores reset, scoring switches, user score/city edits, event/topic create/update/delete, challenge edit/delete/proof delete/replace/winner, message soft/hard delete, email sends (with recipient list), push crashes, ban failures. |

Writes with **no log at all** (not even error_log): user create, user delete, user roles add/remove, event edit, report status, report ban-guest (only bans row), ban add (only bans row), unban (row deleted), thumbs backfill, ranks recalc (success), photos keep/remove for chat and avatar, seen marks, photo comment keep/remove (daily_today), special cover_remove / theme_cover_remove, cover_as_theme, hi_questions CRUD, all Worlds actions (create, import, settings, apply_ctas, delete topic + R2 files, API edits), campaign create without push.

---

## 5. Front-end build facts

- Rendering: plain PHP, no templating engine, no build step, no JS framework. Pages mix `?>…<?php` inline HTML with `<?= ?>`; email.php builds most HTML with `echo '…'` strings. Layout = `admin_head($title)` (full `<head>` + CSS + shared JS), `admin_nav($current)`, page body in `<div|main class="admin-main">`, `admin_foot()` (layout.php:305-308). Feedback via session flash (flash.php). Errors via `admin_die()` (auth.php:24, own inline-styled HTML page).
- Desktop-oriented dark theme: header 52px sticky, nav of 20 links in one row (`.admin-header nav { display:flex }`, no wrap); only `daily_styles()` adds a `@media (max-width:720px)` block (daily_common.php:212-223) making the header scroll; no other responsive rules.
- CSS:
  - layout.php `<style>` 15-153 (137 lines): reset, header/nav, stats, toolbar, buttons (.btn-primary/-secondary/-danger/-sm), table, badges, flash, forms, info grid, warning box, pagination, city picker, login.
  - Per-page `<style>` blocks (13): daily_common.php 184-225 (40, `daily_styles()`), worlds_common.php 45-82 (36, `worlds_styles()`), worlds_reaction.php 150-198 (47), user_create.php 308-330 (21), user_edit.php 522-540 (17), contest.php 309-325 (15), _daily_stacked_chart.php 16-30 (13), event_create.php 137-150 (12), daily_promo.php 49-61 (11), scoring.php 63-71 (7), campaign_create.php 178-184 (5), daily_covers.php 90-96 (5).
  - Inline `style="` attributes: 984 total across 949 lines. Top 15: contest 97, daily_edit 60, messages 57, push 43, arrivals 43, worlds_reaction 41, challenges 37, daily_today 36, email 35, user_edit 32, worlds_topic 28, city_edit 28, photos 24, bans 20, app_versions 20 (then daily_specials 19). Colors are hard-coded hex everywhere (no CSS variables).
- JavaScript (all inline, vanilla):
  - layout.php 154-234: `initCityPickers(cities)` autocomplete (used by user_create, user_edit, daily_today:242).
  - Inline `<script>` blocks: worlds_reaction 199-382 (184 lines, live preview, Pixabay search, rows table), push 622-725 (104), worlds_topic 321-414 (94), daily_covers 131-208 (78, XHR per-file upload + progress), user_edit 509-520 + 542-603 (74), daily_edit 599-655 (57, live preview, compare), event_create 350-403 (54, `loadMembers`), daily_common 275-327 (53, Leaflet place picker), worlds 164-215 (52), user_create 295-306 + 332-366 (47), email 438-481 (44), contest 571-607 (37, tester suggest), campaign_create 313-334 (22), topic_create 209-229 (21, `loadMembers`), daily_proposals 181-187 (7).
  - Plus inline `onsubmit="return confirm(…)"` / `onclick` handlers (~45 confirms, §3).
  - CDN: only Leaflet 1.9.4 from unpkg (`leaflet.css` + `leaflet.js`, daily_common.php:273-274) for the place picker; OSM tiles; Nominatim via server proxy.
- Shared helpers:
  - auth.php: `admin_is_logged_in`, `admin_require_login`, `admin_redirect`, `admin_die`. csrf.php: `csrf_token`, `csrf_input`, `csrf_verify`. flash.php: `flash_set`, `flash_html`.
  - layout.php: `admin_head`, `admin_nav`, `admin_foot`, `admin_pending_proposals`.
  - boot.php: `admin_upload_avatar` (R2 image upload, also used for challenge proofs).
  - daily_common.php: `dh`, `daily_window_label`, `daily_text`, `daily_state_badge`, `daily_theme_label`, `daily_theme_select`, `daily_osm_link`, `daily_place_badges`, `daily_action`, `daily_locale_names`, `daily_brand_warnings`, `daily_subnav`, `daily_styles`, `daily_cover_upload`, `daily_place_picker` (also included by photos.php).
  - worlds_common.php: `wh`, `worlds_subnav`, `worlds_status_badge`, `worlds_action`, `worlds_styles`.
  - Partials: `_city_activity.php` (range + sum/daily toggle, included by users, events, topics, challenges) → `_city_bar_chart.php`, `_daily_stacked_chart.php` (also included directly by messages, arrivals); `_messages_search_form.php` (messages, twice).
  - Page-local: email.php `parse_emails`, `prepare_html`, `email_wrap`, `resend_send`, `all_registered_emails`, `extract_email`; push.php `admin_push_username`, `admin_push_test_user_id`, `admin_push_remote_ip`, `admin_push_cities`, `admin_push_parse_audience`, `admin_upload_notification_image`; campaign_create `campaign_broadcast_ws`; daily_covers `daily_covers_save`; daily_proposals `daily_reason_fields`; event_edit `fmt_dt`; worlds_topic `worlds_field`; worlds_settings `worlds_cta_report`.

---

## 6. Broken / dead / duplicated

Dead / unrouted:
- No unrouted page files. Non-routed files are all includes: auth, csrf, flash, layout, daily_common, worlds_common, worlds_race, worlds_reaction, `_city_activity`, `_city_bar_chart`, `_daily_stacked_chart`, `_messages_search_form`. No route points to a missing file.
- `/admin/campaigns` and `/admin/campaigns/create` are the same page (boot.php:157); there is no campaigns list.
- `/admin/users/{id}/roles` (ambassador roles) is reachable only from user rows / edit page.
- challenge_proof_delete.php / challenge_proof_replace.php are the "legacy single-proof" path (comment challenge_proof_delete_one.php:11); the whole Challenges section reads channel_challenges / challenge_acceptances / challenge_proofs / score_rules (legacy 1-1 challenge code was removed from the apps on 2026-11-16 per project notes; the admin still uses these tables).

Text that contradicts the code:
- Hi now delete confirm says "This will remove the Hi now and all its messages. Cannot be undone." (topics.php:228) but the code only sets channels.status='deleted' and expires it; messages are untouched (TopicRepository.php:835-840).
- Hi plan single delete says "This cannot be undone." (events.php:274) and Challenge delete says "This cannot be undone." (challenges.php:248); both are soft deletes (status='deleted').
- message_delete.php:42-44 comment says `MessageRepository::softDelete()` is "not loaded on the admin require path"; public/index.php:92 and :247 do load MessageRepository.php (softDelete exists at src/MessageRepository.php:850).
- Dashboard reset confirm (dashboard.php:105) describes less than the Scoring page warning (scoring.php:240-244) for the same endpoint, and the dashboard path skips the typed RESET check (scores_reset.php:33 only applies when `back=scoring`).

Duplication:
- Message soft-delete SQL repeated in message_delete.php:45-51, challenge_delete.php:50-56, photos.php:40 (instead of MessageRepository::softDelete).
- Three image-upload helpers: `admin_upload_avatar` (boot.php:34), `admin_upload_notification_image` (push.php:133), `daily_cover_upload` (daily_common.php:232) + SpotsAdmin/contest uploads.
- Push dispatch code in push.php (resolveAudience → recordBroadcast → dispatch) duplicated in campaign_create.php:143-156 without the rate limit or confirm.
- `loadMembers()` JS duplicated in event_create.php:373 and topic_create.php:210.
- City filtering JS in user_edit.php:572-603 besides the shared `initCityPickers`.
- Escaping helpers: `dh()`, `wh()`, `$esc` closures (contest, scoring, hi_questions), `$h` closures (cities pages), plus raw `htmlspecialchars` elsewhere.
- Two score-reset entry points with different protections (Dashboard confirm() vs Scoring typed RESET).
- Two ban entry points with different protections (Reports ban-guest: no confirm; Arrivals: confirm; Bans page: none).

Behavioral notes worth knowing:
- Push send dispatches inside `register_shutdown_function` (push.php:364); per project notes Render runs mod_php, so this runs inside the request.
- Email "send to all" holds the request open for ~350 ms per recipient (`set_time_limit(0)`), and email.php shows every registered email address in a copyable field on each GET.
- Scoring GET always runs the 7-90 day simulation (`ScoringReport::simulate` + `fairPlay`, scoring.php:15-17).
- Nav badges run 3 count queries on every admin page view (layout.php:277-291).
- Writes on GET: `/admin/cities?view=auto` (`markAutoSeen`), `/admin/launch-season/export?what=ranking` (log row).
- `admin_audit_log.admin_username` is always the shared ADMIN_USERNAME, so "who" = IP only.
