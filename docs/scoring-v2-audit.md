# Scoring v2 – "Play, Win, Invite" + monthly seasons: audit and plan

Status: audit done 2026-11-23, decisions taken the same day (section 4). P0 (read-only Admin › Scoring) built; **nothing migrated yet**.

Paths: `backend/api/...` = PHP API, `apps/mobile/...` = the app, `apps/web/...` = the web.

---

## 1. Audit

### 1.1 How points are awarded today

- **Ledger.** One table, `score_events` (`migrate.php:1663`): one row per award: `user_id, kind, role, points, city_id, month_ref, daily_challenge_id, daily_proof_id, daily_twist_id, created_at`.
  - The `kind` CHECK lists every allowed kind (`migrate.php:1692`). New kinds must be added there.
  - Daily awards are unique per `(user_id, daily_challenge_id, kind)` (`uq_score_events_daily`, `migrate.php:2741`), which is how each award happens once.
  - That index blocks "two friends joined on the same day". The invite credit needs its own key (plan §3, P1).
- **Values.** `score_rules (kind, role, points)` (`migrate.php:1607`), daily rows seeded at `migrate.php:2774`. `DailyPoints::rule()` reads them.
  - Today's values: photo 10, vote 2, top 30/20/10. Streak, city best, twist, early, Local Pass and proposal rows still exist.
  - Since 2026-10-22 only `DailyPoints::EARNING_KINDS = [daily_proof, daily_vote, daily_top1..3]` earn (`src/DailyPoints.php:34`); the other kinds are silently refused in `insert()`.
  - `score_rules.counts_weekly` marks the kinds counted in period rankings.
- **When.**
  - **Photo +10:** at approval (`DailyPoints::awardProof`). Photos are auto-approved at submit (`routes/api.php:12686`). "Approved" therefore means "posted and not held by 3 reports".
  - **Vote +2 and podium:** at the close, i.e. the next drop at 02:00 UTC (`DailyDrop::closeChallenge` → `DailyResults::compute` → `DailyPoints::awardClose`).
  - **Vote rule:** +2 for anyone with at least one like standing at the close, whatever the number of likes.
- **Podium.** `DailyResults::rankProofs`: most likes, then **posted first**, then id. That is already the tie-break the brief asks for.
  - `MIN_VOTES_TO_WIN = 1`.
  - Excluded: demo, seed and suggestion photos, and demo users.
  - **Not excluded:** admins (`hidden_from_rankings`) and the store review account (`is_review`). Their photos can win and take the top-3 points. To fix (P4).
- **Two guards on every insert.**
  - `trg_score_event_adjust` gives admins nothing and doubles campaign challenges (legacy 1-1 challenges only).
  - `trg_score_events_sync` keeps the cached totals on `users` up to date.
  - `trg_score_event_daily_reverse` takes points back when a proof is rejected or deleted.
- **`challenge_ratings`:** legacy 1-1 challenge debriefs. These rows stay in all-time totals and play no part in v2.
- **Streak:** `DailyResults::streakEndingAt` / `countStreaks`, by challenge date (UTC drop days), on approved real photos. It earns nothing since 2026-10-22.

### 1.2 Two scoring systems feed the clients

| | A – cached totals on `users` | B – `score_events` summed per period |
|---|---|---|
| Fields | `score_alltime`, `score_month` + `score_month_ref` (= `gmdate('Y-m')` **at award time**), `monthly_rank_in_city/worldwide` | sum of `counts_weekly` kinds joined to `daily_challenges.challenge_date` |
| Used by | `/leaderboard` (month/alltime), `/me/scores`, `/me/score-celebration` totals and ranks, `MonthlyRankService` (profile rank rows), web header 🏆 chip, `/join` top 10 | `/ranks` (World tab), `/leaderboard/week` (Passport week card), `ScoreWin` medals and goal, rank-up notifications |

Problems for seasons:

- A's "month" is the month a point was **given**. The Nov 30 podium is given on Dec 1 at 02:00 UTC, so A would put it in December.
- A also includes legacy kinds.
- Passport mixes the two: "Most Local, all time" shows A, and tapping it opens `/ranks` all time, which is B.

**Seasons will be computed from B by challenge date** (see §3). A stays as it is for all-time totals.

### 1.3 Where points and ranks are shown

Vote points (+2) appear in **five places**: the rule, `GET /daily/points` (`vote`), the How it works screen (mobile), the "How points work" sheet in Passport (mobile and web), and the victory modal's "Votes" chip.

| Surface | Mobile | Web | Reads |
|---|---|---|---|
| How it works | `app/how-it-works.tsx` (SEED `vote: 2` at :22, Vote card :51-55) | – (none) | `/daily/points` |
| Points help sheet | `src/features/passport/PointsHelpSheet.tsx:9` **hardcoded** `['vote',2]` | `PassportScreen.jsx:22` **hardcoded** | – |
| World › Players | `app/(tabs)/ranks.tsx:37` periods today/week/alltime, YouBar :438-449 | `ranks/RanksScreen.jsx:17`, :274-280 | `/ranks` (B) |
| Victory modal | `ScoreCelebrationModal.tsx`: chips :274, goal bar :292/:334, totals :102 | `ScoreCelebrationModal.jsx`: chips :185, goal :213 | `/me/score-celebration` + `win` (`ScoreWin.php`: `SOURCES` :28, goal pass/streak/stamp :191-232, period today/week/alltime) |
| Passport | streak :146/:178, week rank :187, all time :237 (A), "How points work" :245 | :114/:143, :186, :195 | `/leaderboard/week`, `/leaderboard` alltime, `/users/{id}/daily` |
| Profile rank row | `ProfileRankRow.tsx` ("this month", A) | `ProfileRankRow.jsx` | `monthlyRank` |
| Today | streak in `TodayWeek.tsx:113/168` | same | `/users/{id}/daily` |
| Notifications | `daily_rank` "▲ You climbed to #N in X this week" (`Ranks.php:345`, hardcoded English body), `daily_result` (photo rank) | same inbox texts | inbox |
| Share cards | photo rank and "I'm #1 in X today/this week" (`shareLine.*_{today,week,alltime}`); no points | same | – |
| /join landing | – | `api/leaderboard-top.mjs` → `/leaderboard` world alltime (A), "N pts" | A |

Other notes:

- i18n with vote or week wording:
  - `me.json points.vote`, plus `points.weekly` ("resets every Monday").
  - `daily.json rules.earn.voteTitle/voteText`.
  - `challenge.json scoreWin.source.votes` and `shareLine.*`.
  - The web keeps the same keys in `profile.json` / `challenge.json`.
- The "+2 pts" in `group.joinCta` is the legacy group-challenge join, unrelated to v2.
- Server constants the clients rely on: `ScoreWin::CLOSE_GAP` 15, streak milestones 7/14/30/100, top-N 100.

### 1.4 Invites and attribution today

- **No referrer is stored anywhere.**
  - There is no `referred_by`, `invite_code`, device id or signup IP.
  - `/auth/signup` takes `email, password, display_name, username, guest_id, mode, eula_accepted` (`routes/api.php:1335`, `AuthService::signup`, `UserRepository::create`).
- **Proof share links** carry `?from=<username>&city&tpl&utm_*`.
  - `from` is a username, which people can change, and it only reaches PostHog (`app/p/[id].tsx:11`).
  - The web landing (`api/share-page.mjs:309`) forwards `ref` and utm to `/?auth=signup`, but signup sends nothing to the server.
- **Through install: nothing.**
  - The Play Store `referrer=` carries utm and `hilads_action`, but the app never reads it (no install-referrer module).
  - The iOS App Store passes nothing on.
  - No Branch, AppsFlyer or similar SDK, no clipboard read.
- **App links** (AASA + Android intent filters) cover `/p /s /d /today /e /event /city /t /challenge` and their locale variants. A **new** path such as `/i/{code}` needs a store build.
  - `/today?ref=CODE` already opens the app, so invites can ship over the air.
- **Device identity.**
  - Push tokens (`mobile_push_tokens`, one row per device, moved to the latest account) exist only once push is allowed.
  - `users.guest_id` is lost on reinstall.
  - `expo-application` and `expo-secure-store` are installed. A UUID in SecureStore survives a reinstall on iOS, and `getAndroidId()` is stable on Android.
  - No `X-Install-Id` header is sent today.
- **Reusable pieces.**
  - Friend requests: auto-friend the inviter and the friend.
  - The single approval path `DailyModerationService::approveProof()`: every Daily photo goes through it, so the "first photo" credit hooks in there.
  - Soft-deleted users keep their email, so delete-and-recreate with the same email is impossible.

### 1.5 Likes and fair play today

- **Self-likes are blocked on the server, twice:** `DailyVotes::guard()` (`src/DailyVotes.php:244`, 403 `own_proof`) and the DB trigger `trg_daily_vote_check` (`migrate.php:~2504`).
  - Both compare user ids, so a second account of the same person passes.
- **One like per account per photo:** `UNIQUE (proof_id, voter_user_id)` (`migrate.php:2488`). ✅
- **Guests cannot like** (`requireAuth('vote')`). ✅
- **No per-day like cap.** The old 3 per challenge was dropped.
  - Rate limit: 30 likes per 10 min per user, failing open on a DB error. It is not per IP, and banned guests or IPs are not checked on likes.
- **You can like without having played today.** `vote_requires_play` would change that.
- **Existing abuse signal:** `DailyVotes::flagHeavyVoters` (liked ≥ 80 % of a city's photos), shown in Admin › Daily today.
  - Nothing exists for multiple accounts on one device or IP.
- **No IP or device stored** on users, sessions, likes or photos. IPs exist only on city chat messages and bans.
  - **The "many accounts from one device / IP" report needs us to start recording them (P3).** It can't look back in time.
- Inconsistency: World › Photos ranks ties by **comments** before "posted first" (`Ranks::photoRows`), while the podium does not. Proposed: align the Photos tab on the podium rule.

---

## 2. What v2 changes (summary)

| Action | Points | Kind (new kinds in bold) |
|---|---|---|
| Play the Daily Challenge (approved photo, once a day) | +10 | `daily_proof` |
| World podium of the day | +30 / +20 / +10 | `daily_top1/2/3` |
| Perfect week (all 7 challenges Mon–Sun) | +30 | **`perfect_week`** |
| Invited friend's first approved photo (max 5 per season) | +10 | **`friend_joined`** |
| 5th friend: "Bring your crew" (once per season) | +50 | **`crew_bonus`** |
| Like | 0 | `daily_vote` stops being created from the switch date; past rows stay |

---

## 3. Plan (one phase = one commit, no push, no deploy)

### Config: `backend/api/config/scoring.php` (single source)

```php
return [
  'switch_date'      => '2026-11-24',  // first challenge date under v2 (no more vote events from its close)
  'first_season'     => '2026-12',     // seasons before it are "pre-season"
  'points' => [
    'daily_proof' => 10, 'daily_top1' => 30, 'daily_top2' => 20, 'daily_top3' => 10,
    'perfect_week' => 30, 'friend_joined' => 10, 'crew_bonus' => 50,
  ],
  'season_kinds'      => ['daily_proof','daily_top1','daily_top2','daily_top3','perfect_week','friend_joined','crew_bonus'],
  'invites_per_season'=> 5,
  'crew_size'         => 5,
  'invite_click_ttl_h'=> 24,           // IP-match fallback window
  'season_ending_days'=> 3,            // "season ends soon" push
  'switches' => [                      // defaults; Admin › Scoring overrides (app_settings), both OFF
    'podium_min_photos'  => 0,         // 0 = off; N = fewer than N photos worldwide → only 🥇 is paid
    'vote_requires_play' => false,
  ],
];
```

How the config is used:

- `migrate.php` syncs `score_rules` from this file, so the existing SQL joins keep working.
- `DailyPoints::rule()` reads the file first.
- Nothing is hardcoded in the apps: `GET /daily/points` returns all of it.

### P0 – read-only reports (no migration, safe to deploy first) — DONE

`config/scoring.php` (every value + both switches), `src/Scoring.php` (config, podium, Perfect week rules, tests/ScoringTest.php), `src/ScoringReport.php` + `admin/scoring.php` (Admin › Scoring, CSV export).

New page **Admin › Scoring** with three sections:

1. **30-day simulation.**
   - For each player active in the last 30 challenge days: old points (as awarded) and new points (photos + podium + perfect weeks recomputed from proofs; invites are 0 since nothing was ever tracked).
   - The old and new top 10 side by side, and the movers.
   - CSV export.
2. **Switch impact on real data.**
   - `podium_min_photos`: for N = 3, 5, 10, 20, how many of the last 30 days would have paid only 🥇, and the points lost per player.
   - `vote_requires_play`: the share of likes that came from people who hadn't posted that day, and how many of the last 30 podiums would have changed.
3. **Fair play.**
   - Accounts sharing a push token or a guest_id.
   - "One-fan" likers: ≥ 80 % of their likes go to one user, with at least 5 likes.
   - The existing heavy voters.
   - Once P3 records them: accounts per install id and per IP hash, and invite bursts (≥ 3 invitee signups for one inviter within an hour, or from one IP).
   - Report only, no auto-ban.

This gives the before/after numbers **before** any data change.

### P1 – the new rules (backend) — DONE

Built as planned, with these specifics:

- The switch date is written by the migration (`app_settings.scoring_v2_since` = the challenge date of the day `php migrate.php` runs). Until then the code keeps the old rules.
- `rule()` reads config/scoring.php for the v2 kinds.
- Review accounts are set `hidden_from_rankings`, so they leave every ranking that already filters admins; city rankings now filter it too.
- Moderation reject / remove also revokes the Perfect week of the photo's week (`DailyPoints::revokePerfectWeek`).
- New sources and the `week` goal reach only apps sending `X-Scoring: 2` (P5); older apps see "other".
- `/daily/points` adds `v2, perfectWeek, friendJoined, crewBonus, invitesPerSeason, crewSize, season`; `vote` is 0 once v2 is live.
- World › Photos and its movement/gap use the podium tie rule (likes, then posted first).
- Not in P1 (season period, one total everywhere → P2; crew goal → P3; switches enforcement in likes → P4).

Original plan:

- **Migration:**
  - Add `perfect_week`, `friend_joined` and `crew_bonus` to the kind CHECK.
  - Add `score_events.subject_user_id` (the invited friend) with a unique index `(user_id, kind, subject_user_id) WHERE kind = 'friend_joined'`.
  - Exclude `friend_joined` from `uq_score_events_daily` so two friends on one day both count.
  - Add a `season` column (`'YYYY-MM'` of the challenge date), backfilled for Daily rows.
- **Votes:** `awardClose` stops creating `daily_vote` for challenges dated on or after `switch_date`.
- **Perfect week:** checked in `awardProof`. When the user has approved real photos on all 7 published challenges Mon–Sun of that photo's week, they get +30. The award is anchored on the **Sunday** challenge, so it is unique per week, and it belongs to the season of that Sunday.
  - A week with a missing published challenge needs one photo per published day.
  - It is not taken back when one of the photos is later deleted. Reversing it would be possible; I'd keep it simple.
- **Podium:** also excludes `hidden_from_rankings` and `is_review` accounts.
- **`GET /daily/points`:** adds `perfectWeek, friendJoined, crewBonus, invitesPerSeason, season {key, endsAt, daysLeft, pre}`.
  - It keeps `vote` (= 0) and `top` for older apps.
- **`ScoreWin`:**
  - New sources: `perfect_week`, `friends`, `crew`. Votes only appear for old events.
  - New goals: `week` ("2 more days for a Perfect week") and `crew` ("2 friends to go"), next to `pass`.
  - Old apps ignore unknown goals or sources and fall back to "other".
- Unit tests: ScoreWinTest, plus new PerfectWeekTest and SeasonTest.

### P2 – seasons (backend) — DONE

- Built as planned: `Ranks` period `season`, the season tie-break for every player ranking, `DailySeasons` (freeze at the drop of the 1st, medals, `daily_season_result` / `daily_season_ending`), `daily_perfect_week` notification, `GET /me/season-result` + `POST /me/season-result/seen`, `seasonMedals` and `week` in `/users/{id}/daily`, notification texts in 19 locales (`NotificationI18n::SCORING`).
- One total everywhere: `/leaderboard` (world / city), the profile rank row (`MonthlyRankService::ranksForUser`) and `/me/score-celebration` totals and ranks read the ledger by challenge date ("month" = this season). `/leaderboard?scope=cities` is unchanged (a sum per city, unused by the current apps).

Original plan:

- **Season = the calendar month of the challenge date.** Challenge days run 02:00 → 02:00 UTC, so the November season covers the Nov 1–30 challenges and **ends at the close of the Nov 30 challenge: Dec 1, 02:00 UTC** (Dec 1, 09:00 in Saigon). The UI says "Season ends Dec 1 · 02:00 UTC" and "N days left".
- **`/ranks?tab=players&period=season`** (new period; old apps never ask for it).
  - It sums the `season_kinds` of the month by challenge date.
  - Ties go to most podiums, then most days played, then earliest to reach the score (the time of the event that brought the player to their final total).
  - `alltime` is unchanged and stays the glory tab.
  - `me.gap` / `me.next` drive "You're #2 this season, 15 pts behind @kitty_3".
- **Tables:** `seasons (key, starts_on, ends_on, status, frozen_at)` and `season_results (season, user_id, rank, points, podiums, days)`.
- **Rollover, in the drop:** after `closeChallenge(Nov 30)`, freeze November: write `season_results` for everyone, give the top 3 a medal, send the results notification to every ranked player, and open December. It is idempotent and reruns safely.
- **Notifications:**
  - `season_ending`: 3 days before the end, top 20 and players still in reach.
  - `season_result`: your final rank, and a medal for the top 3.
  - Both are new `NotificationCategory` types, with their own dedupe key and deep link.
- **Pre-season (current month before `first_season`):** the same season ranking, flagged `pre: true`. The UI shows "Pre-season" and no medals are given.
- `GET /users/{id}/daily` adds `seasonMedals: [{season, rank}]`, week progress `{done, total, earned}` and `crew {count, max, friends[]}`.

### P3 – invites (backend) — DONE

- Built as planned (`Invites`, migration, `/me/invite`, `/invites/{code}`, `POST /invites/click`, signup `invite_code`, `X-Install-Id` recorded at signup / login / `/auth/me`, credit in `approveProof`, revoke in reject / remove, crew goal in the victory modal, Admin › Scoring device / network / burst / by-IP tables, 90-day prune at the drop).
- Change from the plan: a shared **network** never blocks a credit (friends often sign up together on one Wi-Fi), it is only reported. Blocked: the friend's install is one of the inviter's, or an older account is on it.
- IP hash key: env `IP_HASH_SALT` (set it on Render; without it a key derived from DATABASE_URL is used).
- The app's link capture, install id header and screens are in P5.

Original plan:

- **`users.invite_code`:** short and stable, created lazily, never a username.
  - The link is **`https://hilads.live/today?ref=CODE`** (already an app link: no store build).
- **`invite_clicks (code, ip_hash, platform, created_at)`:** written by the web landing and by the app when the link opens it.
- **Signup** takes an optional `invite_code`:
  - **app:** kept in storage from the link (`+native-intent`)
  - **web:** from `ref`
  - **fallback:** a click from the same IP hash in the last 24 h (covers "installed from the store").
  - The result is stored on `users.invited_by_user_id`, `invited_via` (`code` / `ip`) and `invited_at`.
- **Distinct devices:**
  - The app sends `X-Install-Id`: a UUID in SecureStore, which survives a reinstall on iOS; on Android, `getAndroidId()`.
  - `user_devices (user_id, install_id, ip_hash, first_seen, last_seen)` is written at signup, login and boot.
  - IPs are stored only as a salted sha256: enough to group accounts, never a readable IP.
- **Credit**, in `approveProof()`, on the invitee's **first** approved real photo, only if all of these hold:
  - the invitee signed up after the click
  - the invitee's install id is new: never seen on another account, and not the inviter's
  - the inviter is not the invitee
  - the inviter has fewer than 5 `friend_joined` this season
  - the 5th triggers `crew_bonus` once per season
- Inviter and friend become friends automatically.
- **Notifications:** `friend_joined` (+10) and `crew_bonus` (+50).
- **The friend's side:** sees "Invited by @minh" on sign-up and on their Passport.
- **Android Play install referrer:** at the next store build (needs a native module). Until then Android also relies on the IP fallback.

### P4 – fair play switches — DONE

- Admin › Scoring: v2 status (live since / not live), the current season, the two switches (saved in app_settings), and a "Reset all scores to 0" card (type RESET; option: also delete past season results and medals). The dashboard's reset is the same action.
- `vote_requires_play` → `DailyVotes::guard` answers 403 `play_first` ("Post today's photo to like the others.").

Original plan:

- `podium_min_photos` and `vote_requires_play`: in Admin › Scoring (stored in `app_settings`), **both off**.
  - `vote_requires_play` is checked in `DailyVotes::guard()` and returns a clear 403 (`play_first`). The apps show "Post today's photo to like".
- The fair-play section of Admin › Scoring gets the install-id and IP-hash groups and invite bursts from P3.

### P5 – app

- **How it works,** from `/daily/points`:
  - Play.
  - Win, the three medal lines.
  - Perfect week.
  - Invite friends (+10 each, +50 at 5).
  - A short Seasons block.
  - The Vote card goes. `PointsHelpSheet` reads the same endpoint (no more hardcoded values).
- **World › Players:** "This season" (default) and "All time", "Season ends in N days", the new You bar copy.
- **Victory modal:** the new chips and goals.
- **Today:** on Sunday, at 6/7, "Play today to complete your Perfect week 🔥 +30".
- **Passport:**
  - The crew card: progress 3 / 5, Invite button (share sheet with the link), friends who joined.
  - The week's 7 dots with the +30.
  - Season medals.
  - The all-time card reads the same source as the tab it opens.
- **Celebration screens:** a small one per friend (through `celebrationQueue`), a bigger one for the crew and for season results.
- **Notification texts and deep links** for the five new types.
- 19 locales (brand terms in English, tu in French, plurals and ordinals).

### P6 – web parity

The same on the web:

- Ranks season / all time
- the victory modal
- Passport crew card and medals
- notifications
- a "How it works" sheet
- `ref` kept through `/?auth=signup` and sent to signup
- the `/join` top 10 can switch to the season

### Test checklist (delivered with P5)

- Season rollover with a fake date: `DAILY_FAKE_NOW` / a `--date` on the drop script. Covers the Nov 30 close, freeze, medals, notifications, December empty then filling, and a rerun with no double rows.
- Perfect week:
  - Mon–Sun across a month boundary (counts in the Sunday's month).
  - A Sunday photo posted at 01:30 UTC Monday (still Sunday's challenge).
  - A user in UTC−8 and one in UTC+7.
  - A deleted photo.
  - A week with a missing challenge.
- Invite end to end on two devices:
  - the link opens the app, signup, first photo, +10 and notification on device A
  - the same device makes a second account: no credit
  - an existing user opens the link: no credit
  - five friends: crew +50 once
  - the sixth: nothing
- Old app (2.2.0 / Android 2.2.1 bundle before the update): How it works, the victory modal and Ranks still work.
- Switches: turn each on in staging, check a like refused with `play_first`, and a 2-photo day paying only 🥇.

---

## 4. Decisions (founder, 2026-11-23)

1. **Switch date:** the challenge of the day P1 is deployed. P1's migration stores that challenge date (`app_settings.scoring_v2_since`): no vote event from that challenge's close on, while every +2 already shown stays (all-time included).
2. **November pre-season:** photos + podiums (no votes), Perfect weeks only from the switch week. No medals.
3. **Season boundary:** the month of the challenge date, ending when its last day closes (02:00 UTC on the 1st). **The apps show it in the user's local time** ("Ends Dec 1, 9:00 AM" in Saigon); the server sends `endsAt` as an ISO UTC instant.
4. **Invite credit:** link code + same-IP-within-24 h fallback, for points. See 4.1 for what must come before a cash prize.
5. **IP storage:** salted sha256 only. See 4.2 for the privacy changes.
6. **Reversals:**
   - A player deleting their own photo later: the Perfect week stays. The photo's own +10 goes with it, as today.
   - Moderation removing or rejecting a photo: its +10, any podium points it won, and the Perfect week of its week are all taken back.
   - The Perfect week row therefore carries the week's Sunday and is deleted by the moderation path (`DailyModerationService` reject / remove), not by the cascade of an owner delete.
7. **Tie rule everywhere:** most likes, then posted first (podium, World › Photos, city best, tour). `Ranks::photoRows` drops the comments step.
8. **One points total everywhere, by challenge date:**
   - Profile rank row, `/join` top 10, web 🏆 chip, Passport "all time" and `/leaderboard` all read the same ledger sums as World › Players (B in 1.2).
   - "This month" there becomes "This season".
   - The cached `users.score_*` columns stay only as a fallback for old apps.
9. **Admin and store-review accounts:** no podium points and no place in any ranking (podium, players, photos, cities, season results).

### 4.1 Before any cash prize

- **Android Play install referrer** (native module, store build): the invite code survives a store install without the IP guess.
- **A manual fair-play review** of the season's top 10 in Admin › Scoring before paying:
  - shared install id / IP hash
  - one-fan likers
  - invite bursts
  - podiums won with likes from new accounts
- **`vote_requires_play` and `podium_min_photos` decided** with the impact numbers from Admin › Scoring.
- **Prize rules written:**
  - eligibility (age, country, one account per person)
  - tie-break (already: podiums, days played, first to reach the score)
  - the right to disqualify
  - payment
- **Identity check of the winner** before paying.

### 4.2 Privacy policy and store labels (needed when P3 ships)

New data collected by P3:

| Data | Why | Linked to the account | Kept |
|---|---|---|---|
| Install id (random UUID in the app's secure storage; Android ID on Android) | one credited invite per device, fair-play report | yes | while the account exists |
| IP address, **hashed** with a secret salt (never stored readable) | same-IP invite match, accounts-per-network report | yes | 90 days |
| Who invited you (inviter's account), invite link clicks | invite points, "Invited by @…" | yes | while the account exists (clicks: 90 days) |

- **Privacy policy:**
  - Add an "Invitations and fair play" section covering:
    - the device identifier and hashed IP address, and that they are used only to credit invitations and prevent cheating
    - that they are never used for ads and never shared
    - how long they are kept
    - that the inviter sees when you join and you see who invited you
  - Mention that season rankings and medals are public in the app.
- **App Store privacy label:**
  - Add **Identifiers › Device ID**: linked to the user, purpose *App Functionality* (Apple counts fraud prevention there), not used for tracking.
  - The hashed IP is not a readable identifier. Declaring it under the same Device ID / App Functionality entry is the conservative choice.
  - Nothing changes for "Data used to track you".
- **Google Play Data safety:**
  - Add **Device or other IDs**: collected, not shared, purposes *App functionality* and *Fraud prevention, security, and compliance*, not optional.
  - The rest is unchanged (encrypted in transit; users can ask for deletion).
