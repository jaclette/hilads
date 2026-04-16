-- Performance indexes v2 — /now endpoint critical path
-- Run once in production (fully idempotent — safe to re-run).
--
-- IMPORTANT: CONCURRENTLY cannot run inside a transaction block.
-- Run with: psql $DATABASE_URL -f scripts/migrate_perf_indexes_v2.sql
-- Or on a managed DB (Supabase/Neon/RDS): run each statement individually.
--
-- These indexes address the three remaining slow endpoints:
--   POST /join           (~1.77s) — fixed in PHP (COUNT removed); presence index below
--   GET  /messages?lean  (~1.8s)  — idx_messages_channel in v1 (apply that first)
--   GET  /now            (~1.4s)  — all indexes below target /now


-- ── 1. channel_events: city-scoped active event filter ────────────────────────
-- Query (getAllByChannel / getByChannel / getPublicByChannel / getUpcoming):
--   WHERE ce.city_id IN ('hilads','ticketmaster') AND ce.expires_at > now()
-- v1 migration created idx_channel_events_channel_expires on (channel_id, expires_at)
-- which is UNUSED because the query filters on city_id, not channel_id.
-- This compound index covers the actual WHERE clause and makes the scan index-only.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_channel_events_city_active
    ON channel_events (city_id, expires_at);


-- ── 2. channel_topics: city-scoped active topic filter ───────────────────────
-- Query 1 in TopicRepository::getByCity:
--   WHERE ct.city_id = :city_id AND c.status = 'active' AND ct.expires_at > now()
-- Without this: sequential scan of channel_topics joining channels.
-- (Referenced in TopicRepository.php comments but missing from v1 migration.)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_channel_topics_city
    ON channel_topics (city_id, expires_at);


-- ── 3. messages: topic message stats (channel + type filter) ─────────────────
-- Query 2 in TopicRepository::getByCity:
--   WHERE channel_id IN (...) AND type IN ('text', 'image')
-- Compound (channel_id, type, created_at DESC) covers both the filter and MAX(created_at).
-- Also benefits MessageRepository::getByChannel for event/topic channels.
-- (Referenced in TopicRepository.php comments but missing from v1 migration.)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_channel_type_time
    ON messages (channel_id, type, created_at DESC);


-- ── 4. event_participants: batch participant count ────────────────────────────
-- Query in EventRepository::getAllByChannel / getByChannel:
--   SELECT channel_id, COUNT(*) FROM event_participants WHERE channel_id IN (...) GROUP BY channel_id
-- Without this: sequential scan; one per /now call for each batch of event IDs.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_event_participants_channel
    ON event_participants (channel_id);


-- ── Verify ────────────────────────────────────────────────────────────────────
-- Run after migration to confirm all indexes were created:
--
-- SELECT indexname, tablename, indexdef
-- FROM pg_indexes
-- WHERE indexname IN (
--     'idx_channel_events_city_active',
--     'idx_channel_topics_city',
--     'idx_messages_channel_type_time',
--     'idx_event_participants_channel'
-- )
-- ORDER BY tablename, indexname;
