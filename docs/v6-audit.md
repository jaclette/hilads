# V6 audit: notifications, ranks, map, passport rivals

State of the code on 2026-11-06 (after 46185b61), before V6. Paths are relative to the repo root; `api.php` is `backend/api/routes/api.php`, `NR` is `backend/api/src/NotificationRepository.php`.

## 1. Notifications

### Types and where they are created
- One writer: `NR::create` (preference check) → `createUnchecked` (insert, then web push `PushService::send` and Expo push `MobilePushService::send` when `$push`).
- Direct types in `api.php`: mention, profile_view, friend_request_received / _accepted, vibe_received, dm_message, join_request / _accepted, rating_received, challenge_* (about 20 group-challenge types).
- Fan-outs: `notifyCityOnlineUsers` (new_event, city_here, channel_message, new_challenge, challenge_international_target), `notifyEventParticipants` (event_message, event_join), `notifyTopicSubscribers` (topic_message), `notifyChallengeParticipants`, `notifyGroupResult`.
- Other classes:
  - `PhotoCommentNotify` (photo_comment, photo_mention, with push)
  - `DailyNotify` (daily_vote, daily_twist_completed, bell only)
  - `DailyTwistProposals` (daily_twist_picked)
  - `DailyDrop` / `DailyProposals` (daily_admin)
  - `DailyModerationService` (daily_moderation)
  - `PushBroadcastService` (admin_announcement)
- **Daily pushes have no bell row.** `DailyPushes` (morning, reminder, results line "Yesterday your photo ranked 2nd…", top10, first vote…) sends pushes only. Nothing about the game is in the inbox apart from votes and twists.

### Arrivals (the "New arrival in Omaha" noise)
`NR::emitCityArrival` (channel join, bootstrap) does three things:
- It writes the feed line.
- It sends **city_join** to the members of that city (`current_city_id`, 30 days, max 200). This one is off by default.
- It sends **world_arrival** ("{nick} just landed in {city}") to **every** active user with `world_arrival_push` on, in any city.

That second fan-out is the Omaha / Montreal noise. Dedupe is a 1-hour `arrival_cooldown` per arriver and channel, plus per-recipient rate limits. The `notifications` table has **no unique key**, so the same arriver after an hour, or on a new guest id, notifies again ("kitty_3 just landed" twice).

### Table, inbox, counts
- `notifications(id, user_id, type, title, body, data JSONB, is_read, created_at)`. Indexes `(user_id, created_at DESC)` and `(user_id) WHERE NOT is_read`. No category, no dedupe key, no seen state.
- `GET /notifications?limit&offset`: raw rows plus `unread_count`, blocked actors filtered, chat types excluded. `GET /notifications/unread-count`. `POST /notifications/mark-read {ids|all}`.
- **App bell count:**
  - It comes from bootstrap `unreadNotifications`, then +1 per WS `notification` / `newNotification`.
  - Only `DailyNotify` and `PhotoCommentNotify` send that WS event, so most types never move the badge until the next launch.
  - There is no polling, and `fetchUnreadCount` has no callers in the app.

### Preferences
- `notification_preferences`: one boolean column per toggle. `NR::typeToColumn` gates the bell row as well as the push; `MobilePushService::prefColumn` checks the push again.
- Default on: dm, event_message, new_event, new_challenge, mention, friend_request, vibe_received, profile_view, topic_reply, join_request, admin_announcement, daily_challenge, comment.
- Default off: event_join, channel_message, city_join, world_arrival, new_topic.
- `GET` / `PUT /notification-preferences`, which does a partial upsert.
- UI: 14 toggles stacked under the 5-item preview of `app/notifications.tsx`. `daily_challenge_push` is not among them.

### Screens and deep links
- `app/notifications.tsx` (preview of 5 plus preferences) and `app/notifications-history.tsx` (FlatList, offset pagination). Each has its own copy of the type → route mapping.
- `NotifRow` renders the server's `title` / `body` as is, with an icon per type. world_arrival, admin_announcement and daily_admin have no deep link.

### City names in notifications
- Arrival rows use `channels.name` ("Ho Chi Minh City").
- `NotificationI18n::render` (which applies `CityNames::short`) runs only for non-English locales, so English rows keep the long name. world_arrival is never localized.
- `DailyPushes::outcomeLine` (English), `DailyNotify` (twist body) and `DailyTwistProposals` also use the raw name.

### Push permission
`src/services/push.ts`: `hasPushPermission`, `requestAndRegisterPush`, and `askDailyPush`, which offers "Open settings" when the OS has blocked prompts.

## 2. Ranks and results

- **Players:**
  - `GET /leaderboard?scope=city|world|cities&period=month|alltime` reads the denormalised `users.score_*`. City scope means the home city.
  - `GET /leaderboard/week?scope=city|world` sums `score_events` over the Monday–Sunday week, with the city filter on the city where the points were earned; cached 30 s.
  - **No "today" player ranking.** There are no rank snapshots; movement has to be computed from the `score_events` ledger (`created_at`, `daily_challenge_id`).
- **Cities:** `scope=cities` gives points and members per home city, month or all time. **No endpoint gives players, photos and likes per city for a period.** `/daily/today/countries?date=` gives them for a single day.
- **Photos:**
  - Live today: `/daily/leaderboard` (world top 10, top 3 per city, cached 15 s, ETag) and `/daily/today/proofs`.
  - Closed days: `daily_results` (world top 3 and each proof's city rank), `/daily/podium` and the sheet's `results`.
  - No week or all-time photo ranking.
- **Results UI:** there is no Daily results modal. The results line rides on the morning push; the podium shows in `DailyLeaderboardPanel` (See all › Top 10); the recap is `/daily/tour`. `ChallengeResultModal` belongs to the old group challenges.
- **Entry points:**
  - Passport "Most Local, all time" opens `/leaderboard?period=alltime`.
  - The Passport "#1 this week" card is a plain Card with no onPress, and no weekly screen exists.
  - The `daily_top10` push opens See all › Top 10.
  - Profile rank rows and the score celebration open `/leaderboard`.
- **Tab bar:** `app/(tabs)/_layout.tsx`, a custom tab bar with Today / Map / Chat (labelled Hi) / Passport. Hidden tabs (challenges, events, me, here) highlight their parent. No badges.

## 3. Map

- `@rnmapbox/maps` 10.2.10 with style `mapbox://styles/mapbox/light-v11` / `dark-v11`, or env `EXPO_PUBLIC_MAPBOX_STYLE_LIGHT|DARK`. `LocationPuck` for me.
- **Pins:**
  - One clustered `ShapeSource`: cluster circles colored by the dominant theme, plain theme circles, a ★ on picks, and a pulsing halo on today's photos.
  - Photo icons (`<Images>`, `pinUrl` from `/img-pin`) appear only from zoom 13.5, beside the label.
  - The selected spot is a RN `MarkerView`.
- **Plans:** up to 30 RN `MarkerView` pills. They are native views above the GL canvas, outside Mapbox collision, so they cover clusters.
- **"List" button:** it flips to a full-screen `SpotList` FlatList (Near / This week). The pin card is `SpotSheet`, a plain View with a PanResponder swipe-down.
- **Data:** `GET /map?cityId&bbox&theme` (≤300 spots, plans for 7 days), reloaded on map idle (400 ms debounce). Search `/spots/search` (20 max).
- **Missing:** no empty-area state (only `EmptyCity` for a city with no spots at all), no random spot, no bottom sheet with detents. `src/ui/Sheet.tsx` is a Modal driven by a PanResponder, and `@gorhom/bottom-sheet` is not installed. RNGH and Reanimated are installed since 2.0.4.
- Theme colors live in `src/ui/joy.tsx` (`THEME_COLORS`, `themeColor()`).

## 4. Passport "Compared with"

- `DailyResults::comparedCities` already counts shared challenges **over all of history** (my approved proofs, other cities' proofs on the same challenges) and sorts by count, up to 12. The count is dropped from the response.
- A tap opens `/daily/stories?city=`, which loads **today** only: a city with no photo today hits the dead end "Berlin hasn't played yet today".
- Nothing returns, per shared challenge, my photo vs that city's best photo: this needs a new endpoint.

## 5. Today fixes

- **Hero:** `TodayTicket` shows the `subtitle`, else the full `text` whenever the headline differs as a string. Paraphrases (Nov 6) show twice.
- **Empty slot and yesterday's cards:**
  - The empty slot (`SlotCard`) is a 200 px dashed card.
  - Yesterday's cards are `faded` (whole card at opacity 0.55). With `count > 1` but a single loaded photo, the theme-colored loading sheets never go away. That is the washed-out purple.
- **"move in Berli":** the player's answer itself. Word answers are capped at 30 characters (`DailyCompare::TYPES`, app `AnswerInput`), so it was saved cut. It is not a display bug.

## 6. Decisions for V6

- **Categories:**
  - Stored in a new `notifications.category` column, filled by `NotificationCategory::of($type)` at insert and backfilled.
  - A `dedupe_key` column with a unique index per user: `INSERT … ON CONFLICT DO NOTHING`.
  - A `seen_at` column for "While you were away" (seen is not read).
- **Inbox v2:** `GET /notifications/inbox?category&cursor` returns aggregated items (`actors[]` ≤3, `count`, `object`, `deep_link`). `GET /notifications/counts` returns unread per category. `GET /notifications` v1 stays as it is for old apps.
- **Arrivals:**
  - world_arrival only to friends of the arriver.
  - city_join only to the arriver's city (already the case).
  - Existing world_arrival rows from non-friends are left out of the inbox, and `dedupe_key` is set per arriver, city and day.
- **Game rows:** the results / outcome of the morning, rank changes and Local Pass go into the bell as `game` rows (`push=false`, since the push already exists).
- **City names:** `CityNames::short` in every locale, English included.
- **Ranks tab:**
  - A new `GET /ranks/players|cities|photos?period=today|week|alltime&scope=city|world`, computed from `score_events`, `daily_proofs` and `daily_votes`, with movement against the previous period and cached 30-60 s.
  - The old `/leaderboard` endpoints stay for old apps.
- **Map sheet:** `@gorhom/bottom-sheet` v5. It is plain JavaScript on the RNGH and Reanimated already in 2.0.4+.
- **Map style:** a custom Mapbox Studio style needs the Hilads Mapbox account, so the palette is applied in code with `existing` layers on top of light / dark v11 (land, water, parks, fewer POI labels). The env vars can later point at a Studio style.
- **Rivals:**
  - `GET /users/{id}/daily/rivals` returns the cities with their duel count.
  - `GET /users/{id}/daily/rivals/{cityId}` returns the face-offs: my photo vs their best per shared challenge, plus whether they played today.
- **Web:** this pass covers the app and the API. The web keeps working on the v1 endpoints, and its V6 parity is a follow-up.

## 7. What ships how

- The **API** (all phases) deploys on Render. Phases 1, 3, 4 and 6 need `php migrate.php` first.
- **App: JavaScript only.**
  - Everything except the map sheet goes out with EAS Update to builds of the same app version.
  - The map sheet uses `@gorhom/bottom-sheet`, which is pure JavaScript, but it needs gesture-handler, which is native and only in builds 2.0.4 and later.
  - The current version is 2.0.5, so V6 goes out with the 2.0.5 store build or as an update to it.
