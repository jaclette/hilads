-- Ambassador picks: per-user city tips shown on their public profile.
-- Run once: psql $DATABASE_URL -f scripts/migrate_ambassador_picks.sql

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS ambassador_restaurant VARCHAR(200),
    ADD COLUMN IF NOT EXISTS ambassador_spot       VARCHAR(200),
    ADD COLUMN IF NOT EXISTS ambassador_tip        VARCHAR(300),
    ADD COLUMN IF NOT EXISTS ambassador_story      VARCHAR(400);
