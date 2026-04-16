-- Performance indexes for bootstrap critical path
-- Run once in production (fully idempotent — safe to re-run).
--
-- IMPORTANT: CONCURRENTLY cannot run inside a transaction block.
-- Run with: psql $DATABASE_URL -f scripts/migrate_perf_indexes.sql
-- Or on a managed DB (Supabase/Neon/RDS): run each statement individually.
--
-- Each index targets a specific query in the bootstrap critical path.
-- Timings in the bootstrap log show which phases are slow — these indexes
-- address the most common bottlenecks found in queries_ms.


-- ── 1. presence: online-count query ──────────────────────────────────────────
-- Query: COUNT(DISTINCT guest_id) WHERE channel_id = ? AND last_seen_at > now() - interval '120s'
-- Without this: sequential scan of the whole presence table per bootstrap call.
-- INCLUDE (guest_id) makes it a covering index — count served without heap fetch.
-- Targets: queries_ms.presence (PresenceRepository::join CTE)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_presence_channel_active
    ON presence (channel_id, last_seen_at DESC)
    INCLUDE (guest_id);


-- ── 2. messages: channel feed (initial load) ──────────────────────────────────
-- Query: WHERE channel_id = ? ORDER BY created_at DESC LIMIT 25
-- This index is referenced by name in MessageRepository.php comments; it may
-- already exist. IF NOT EXISTS makes this a no-op if it does.
-- Targets: queries_ms.messages (MessageRepository::getByChannel)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_channel
    ON messages (channel_id, created_at DESC);


-- ── 3. user_city_roles: ambassador lookup ─────────────────────────────────────
-- Query (badge enrichment): WHERE city_id = ? AND role = 'ambassador' AND user_id IN (...)
-- Query (auth currentUser): WHERE user_id = u.id AND role = 'ambassador' LIMIT 1
-- A single compound index serves both access patterns.
-- Targets: queries_ms.badges (UserBadgeService::batchFull)
--          queries_ms.auth_user (AuthService::currentUser EXISTS subquery)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_city_roles_city_role_user
    ON user_city_roles (city_id, role, user_id);


-- ── 4. notifications: unread count ───────────────────────────────────────────
-- Query: SELECT COUNT(*) FROM notifications WHERE user_id = ? AND is_read = FALSE
-- Partial index on unread rows only — keeps the index small as rows get marked read.
-- Targets: queries_ms.notif_cnt (NotificationRepository::unreadCount)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_user_unread
    ON notifications (user_id)
    WHERE is_read = FALSE;


-- ── 5. conversation_participants: DM unread check ─────────────────────────────
-- Query: WHERE cp.user_id = :u AND cm.sender_id != :u AND cm.created_at > cp.last_read_at
-- Entry point of the first EXISTS branch in ConversationRepository::hasAnyUnread.
-- Targets: queries_ms.unread_dm (first EXISTS sub-select)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conversation_participants_user
    ON conversation_participants (user_id);


-- ── 6. event_participants: event-chat unread check ────────────────────────────
-- Query: WHERE ep.user_id = :u (second EXISTS branch in hasAnyUnread)
-- Also used by NotificationRepository to find participants for push dispatch.
-- Targets: queries_ms.unread_dm (second EXISTS sub-select)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_event_participants_user
    ON event_participants (user_id);


-- ── 7. channel_events: active event filter ────────────────────────────────────
-- Query: JOIN channel_events ce ON ce.channel_id = ep.channel_id
--        WHERE ce.expires_at > now()
--          AND (ce.occurrence_date IS NULL OR ce.occurrence_date = CURRENT_DATE)
-- Lets Postgres filter expired events early, before joining to messages.
-- Targets: queries_ms.unread_dm (second EXISTS sub-select)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_channel_events_channel_expires
    ON channel_events (channel_id, expires_at);


-- ── Verify ────────────────────────────────────────────────────────────────────
-- Run after migration to confirm all indexes were created:
--
-- SELECT indexname, tablename, indexdef
-- FROM pg_indexes
-- WHERE indexname IN (
--     'idx_presence_channel_active',
--     'idx_messages_channel',
--     'idx_user_city_roles_city_role_user',
--     'idx_notifications_user_unread',
--     'idx_conversation_participants_user',
--     'idx_event_participants_user',
--     'idx_channel_events_channel_expires'
-- )
-- ORDER BY tablename, indexname;
