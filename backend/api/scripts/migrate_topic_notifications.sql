-- ── Topic notification system ────────────────────────────────────────────────
-- Run once in production (idempotent).

-- 1. Subscription table — tracks which users want notifications for a topic.
CREATE TABLE IF NOT EXISTS topic_subscriptions (
    topic_id      TEXT         NOT NULL,
    user_id       TEXT         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subscribed_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (topic_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_topic_subscriptions_topic ON topic_subscriptions (topic_id);
CREATE INDEX IF NOT EXISTS idx_topic_subscriptions_user  ON topic_subscriptions (user_id);

-- 2. New notification preference columns.
ALTER TABLE notification_preferences
    ADD COLUMN IF NOT EXISTS topic_reply_push BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS new_topic_push   BOOLEAN NOT NULL DEFAULT FALSE;
