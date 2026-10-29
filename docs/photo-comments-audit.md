# Photo comments: Phase 0 audit (2026-10-29)

Read-only audit for comments on Daily Challenge photos ("proofs"). Paths are relative to the repo root; `api.php` = `backend/api/routes/api.php`. App first (`apps/mobile`), web ported after.

## 1. Photos

- **Table** `daily_proofs` (`backend/api/migrate.php:2610`): `id` TEXT (16 hex), `challenge_id`, `user_id`, `city_id` (`city_N`), `photo_url`, `caption`, `moderation_status`, `vote_count` / `local_vote_count` (denormalized, kept by the `trg_daily_vote_count` trigger), `is_suggestion`, `is_demo`, …
- **Serializer** `DailyProofRepository::format($row, $viewerId)` (`backend/api/src/DailyProofRepository.php:601`), used by every proof endpoint: `/daily/today/proofs`, `/daily/today/countries` (`cities[].top`), `/daily/podium`, `/daily/challenges/{date}`, `/daily/tour`, `/daily/proofs?ids=`, `/daily/proofs/{id}`, `/users/{id}/daily`, `/me/daily-photos`. The map uses `Spots::format` / `Spots::formatPhoto` (separate shape, `proofId` on the cover).
- **Live state** `GET /daily/proofs/state?ids=` (`DailyVotes::stateOf`, `backend/api/src/DailyVotes.php:199`): `{voteCount, validatedByLocal, myVote, isMine, votingOpen}`. The app store `apps/mobile/src/features/daily/votes.ts` batches it (≤50 ids) and re-polls proofs on screen every 30 s. **Votes have no WebSocket event.**
- **Migrations**: one idempotent file, `backend/api/migrate.php` (`run($pdo, "CREATE TABLE IF NOT EXISTS …")`, dated comment + "Reversal:" line), run by hand in the Render shell after a deploy.

## 2. The photo's post in the Hi chat

- `DailyModerationService::approveProof` → `DailyCards::postProof` (`backend/api/src/DailyCards.php:138`) inserts a `messages` row (`type='system'`, `event='daily_proof'`) in `world` and in the live city channel, with a **copy** of the proof in `payload` (`DailyCards::proofPayload`: `proofId`, user, city, photo, caption, theme…). The only link is `payload->>'proofId'` (unique index per channel). After 6 cards an hour, proofs join a `daily_proof_group` card instead.
- Read: `GET /channels/{id}/messages` → `MessageRepository::format`; live: `/broadcast/message` → WS `newMessage`; removal: `hideProof` → `messageDeleted`.
- App: `ChatMessage.tsx:707` → `DailyChannelCard.tsx` `ProofCard` (l.241): author row, photo, caption, action row (theme chip, local check, `DailyVoteButton`). **No share and no comment button on the card.** Tap → `/daily/{date}?proof=`, long press → message action sheet, `ReactionPills` under it.
- Consequence: the card's payload is frozen; a live comment count has to come from the proof state, not from the message.

## 3. Chat patterns to reuse

| Need | Existing piece |
| --- | --- |
| Bubble, avatar, handle, profile tap | `ChatMessage.tsx` (registered → `/user/[id]`, guarded by `canAccessProfile`, `src/lib/profileAccess.ts`) |
| Mentions | Server `MentionService` (JSONB `[{userId, offset, length}]`, names resolved at read time, `sanitize`, `suggest`); app `MentionSuggestions.tsx`, `src/api/mentions.ts`, `src/lib/mentions.ts` (`detectActiveMention`, `buildMentionsFromText`, `splitContentByMentions`). `suggest` sorts alphabetically only (no priority). |
| Long-press menu | `MessageActionSheet.tsx` (react, reply, copy, edit, delete). **No Report** on messages. |
| Reply | snapshot columns `reply_to_*` (`resolveReplySnapshot`, `api.php:132`), quote in the bubble, strip in `ChatInput` |
| Composer | `ChatInput.tsx` (emoji panel, mentions, send; tied to channel contexts) |
| Sheet + keyboard | `src/ui/Sheet.tsx` (RN Modal, swipe down, `KeyboardAvoidingView` from react-native-keyboard-controller) |
| Blocks | `BlockRepository::getBidirectional`, `dailyBlocks()` (`api.php:14514`), `filterByBlocks`; client `filterBlocked` + `blockedSet` |
| Moderation | `ModerationService::check()` (422 `moderation_blocked`); photo reports `DailyModerationService::report` → `daily_proof_reports`, hide at a threshold, admin queue |
| Rate limit | `DbRateLimiter::allow(key, limit, window)` (works on Render; APCu `RateLimiter` does not) |
| Identity | `currentUser()`, `requireAuth('action')` → 401 `signup_required`. **Guests cannot vote**; only registered users have handles. |

## 4. Realtime

- `backend/ws/server.js` (Node `ws`), PHP posts to `WS_INTERNAL_URL/broadcast/*` with `X-Internal-Token` (`postToWs`, `api.php:160`). Rooms: city (one at a time per socket), event, topic, world, DM, per-user (`joinUser`, `broadcastUserEventToWs`).
- App `src/lib/socket.ts` (`socket.on` returns an unsubscribe; joins replayed on reconnect). No Today / daily screen listens to the socket today.
- A comment on a Saigon photo must reach a viewer in Berlin looking at the Saigon story: the city room is not enough. → **new per-photo subscription** (`watchProofs` / `unwatchProofs`) in the WS server, refcounted in the client.

## 5. Push and bell

- Push: `MobilePushService::send` (Expo, prefs via `prefColumn`, cooldowns, `push_delivery_log`); web push `PushService`. Daily pushes use `DailyPushes` + `DailyPushText` (per-locale strings, `render($key, $locale, $vars)`).
- The closest model is the vote: `DailyNotify::onVote` = bell row (pre-localized, `push=false`) + WS `newNotification` to the author + `DailyPushes::sendVote` → `data {type, proofId, date, deepLink}`.
- Bell: table `notifications` (`type, title, body, data JSONB, is_read`), no actor / thumbnail columns (they go in `data`), **no grouping**. App rows: `NotifRow.tsx` (icon per type), routing in `app/notifications.tsx` / `notifications-history.tsx`. The bell's block filter does not look at the daily actor keys.
- Push routing: `NotificationHandler.tsx` `resolvePushRoute` (switch on `data.type`), cold start handled (`getColdStartNotificationRoute`).
- Prefs: `notification_preferences` columns (`NotificationPreferencesRepository::defaults`), `mention_push` already has a toggle in `app/notifications.tsx`; adding one = column + defaults + `prefColumn` maps + PrefRow + 19 locales.

## 6. Photo surfaces (app)

| Surface | File | Comment entry |
| --- | --- | --- |
| Hi chat post | `src/features/daily/DailyChannelCard.tsx` `ProofCard` | action row + 2 latest + "See all" |
| Today's photos feed (push target) | `app/daily/photos.tsx` (right action column) | 💬 button + count |
| Story viewer | `app/daily/stories.tsx` | 💬 button + count |
| Compare mosaic | `src/features/today/TodayCountries.tsx` `CityCard` | 💬 count (display) |
| Yesterday tour | `app/daily/tour.tsx` | 💬 button |
| Single photo viewer (passport, My photos, gallery, countries, challenge page) | `src/features/daily/DailyProofViewer.tsx` | 💬 button |
| Map spot sheet | `src/features/map/SpotSheet.tsx` (cover `proofId`) | 💬 on the cover photo |

## 7. Decisions

- **Tables** `photo_comments`, `photo_comment_mentions`, `photo_comment_likes` (`photo_id` → `daily_proofs.id`), `daily_proofs.comment_count` kept by a trigger like `vote_count` (counts non-deleted comments).
- **Registered users only** comment, like and are mentioned (like votes); guests read. A guest tapping the composer gets the sign-up gate.
- **No points** for comments (`DailyPoints` only awards proofs, streaks and results; points for comments would invite spam).
- **Photo state carries the comments**: `format` gains `commentCount`; `/daily/proofs/state` gains `commentCount` and `latestComments` (≤2), so every surface (the chat card included) reads one store. Old apps ignore the new fields.
- **Live**: WS `proofComment` events per photo subscription (new, deleted, liked) + the 30 s state poll as a fallback.
- **Report** a comment: new `photo_comment_reports` (unique per reporter), hidden at 3 reports, listed in the admin daily queue.
- **Notifications**: one event per user with priority mention > reply > author > previous commenter; within 5 min on the same photo the bell row is updated ("Lan and 2 others…") and no new push is sent. New pref `comment_push` (Comments), mentions keep `mention_push`.
- **Composer**: a small comment composer reusing `MentionSuggestions`, `EmojiPanel` and the mention helpers (`ChatInput` is bound to channels and 1000 chars).

## 8. Risks

- Old apps: only additive fields and new endpoints.
- Chat payloads are frozen copies: comment previews come from the state store, never from `payload`.
- Load: `latestComments` is one batched query per state call (≤50 ids); WS subscriptions are per open photo, refcounted.
- Migration has to run on Render before the new app ships (endpoints fail soft until then: `commentCount` 0).
