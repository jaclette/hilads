<?php

/**
 * Hilads - Database migration script
 *
 * Run manually before or after deploys when the schema has changed.
 * Safe to re-run: every statement uses CREATE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS.
 *
 * Usage:
 *   php migrate.php
 *
 * Or via the protected internal endpoint (requires MIGRATION_KEY env var):
 *   POST /internal/migrate
 *   Header: X-Migration-Key: <MIGRATION_KEY>
 */

declare(strict_types=1);

// ── Load environment ──────────────────────────────────────────────────────────

$envFile = __DIR__ . '/.env';
if (file_exists($envFile)) {
    $vars = @parse_ini_file($envFile);
    if (is_array($vars)) {
        foreach ($vars as $key => $value) {
            putenv("$key=$value");
        }
    }
}

// ── Connect ───────────────────────────────────────────────────────────────────

$url = getenv('DATABASE_URL');
if (!$url) {
    fwrite(STDERR, "ERROR: DATABASE_URL is not set\n");
    exit(1);
}

$parts   = parse_url($url);
$sslmode = getenv('PG_SSLMODE') ?: 'require';
$dsn     = sprintf(
    'pgsql:host=%s;port=%s;dbname=%s;sslmode=%s',
    $parts['host'],
    $parts['port'] ?? 5432,
    ltrim($parts['path'], '/'),
    $sslmode,
);

$user = isset($parts['user']) ? urldecode($parts['user']) : null;
$pass = isset($parts['pass']) ? urldecode($parts['pass']) : null;

try {
    $pdo = new PDO($dsn, $user, $pass, [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
} catch (PDOException $e) {
    fwrite(STDERR, "ERROR: DB connection failed: " . $e->getMessage() . "\n");
    exit(1);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function run(PDO $pdo, string $sql, string $label = ''): void
{
    try {
        $pdo->exec($sql);
        if ($label) echo "  OK  $label\n";
    } catch (PDOException $e) {
        echo "  ERR $label: " . $e->getMessage() . "\n";
    }
}

// ── Run migrations ────────────────────────────────────────────────────────────

echo "Running Hilads migrations...\n\n";

// ══════════════════════════════════════════════════════════════════════════════
// TABLES - all idempotent (CREATE TABLE IF NOT EXISTS)
// ══════════════════════════════════════════════════════════════════════════════

echo "[ Tables ]\n";

run($pdo, "
    CREATE TABLE IF NOT EXISTS users (
        id                TEXT PRIMARY KEY,
        email             TEXT UNIQUE,
        password_hash     TEXT,
        google_id         TEXT UNIQUE,
        display_name      TEXT NOT NULL,
        birth_year        INTEGER,
        profile_photo_url TEXT,
        home_city         TEXT,
        interests         TEXT NOT NULL DEFAULT '[]',
        vibe              TEXT NOT NULL DEFAULT 'chill',
        guest_id          TEXT,
        is_verified       BOOLEAN NOT NULL DEFAULT false,
        deleted_at        TIMESTAMPTZ DEFAULT NULL,
        is_fake           BOOLEAN NOT NULL DEFAULT false,
        ambassador_restaurant TEXT,
        ambassador_spot       TEXT,
        ambassador_tip        TEXT,
        ambassador_story      TEXT,
        created_at        INTEGER NOT NULL,
        updated_at        INTEGER NOT NULL
    )
", 'users');

// Per-user UI language, set from the client's device locale on push-token /
// web-push registration. Drives localized notification text (push + bell).
// Idempotent - CREATE TABLE IF NOT EXISTS above won't touch an existing table.
run($pdo, "ALTER TABLE users ADD COLUMN IF NOT EXISTS locale TEXT NOT NULL DEFAULT 'en'", 'users.locale');

run($pdo, "
    CREATE TABLE IF NOT EXISTS channels (
        id          TEXT        PRIMARY KEY,
        type        TEXT        NOT NULL,
        parent_id   TEXT        REFERENCES channels(id) ON DELETE CASCADE,
        name        TEXT        NOT NULL,
        status      TEXT        NOT NULL DEFAULT 'active',
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
", 'channels');

run($pdo, "
    CREATE TABLE IF NOT EXISTS cities (
        channel_id  TEXT             PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE,
        country     TEXT             NOT NULL,
        lat         DOUBLE PRECISION NOT NULL,
        lng         DOUBLE PRECISION NOT NULL,
        timezone    TEXT             NOT NULL
    )
", 'cities');

run($pdo, "
    CREATE TABLE IF NOT EXISTS event_series (
        id              TEXT        PRIMARY KEY,
        city_id         TEXT        NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
        created_by      TEXT        REFERENCES users(id) ON DELETE SET NULL,
        guest_id        TEXT,
        title           TEXT        NOT NULL,
        event_type      TEXT        NOT NULL DEFAULT 'other',
        location        TEXT,
        start_time      TEXT        NOT NULL,
        end_time        TEXT        NOT NULL,
        timezone        TEXT        NOT NULL,
        recurrence_type TEXT        NOT NULL,
        weekdays        TEXT,
        interval_days   INTEGER,
        starts_on       DATE        NOT NULL,
        ends_on         DATE,
        source          TEXT        NOT NULL DEFAULT 'user',
        source_key      TEXT,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    )
", 'event_series');

// Full unique index required for ON CONFLICT (source_key) - must not be partial.
run($pdo, "
    CREATE UNIQUE INDEX IF NOT EXISTS event_series_source_key_unique ON event_series (source_key)
", 'event_series_source_key_unique');

run($pdo, "
    CREATE TABLE IF NOT EXISTS channel_events (
        channel_id      TEXT        PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE,
        source_type     TEXT        NOT NULL,
        external_id     TEXT,
        created_by      TEXT        REFERENCES users(id) ON DELETE SET NULL,
        guest_id        TEXT,
        title           TEXT        NOT NULL,
        event_type      TEXT,
        description     TEXT,
        venue           TEXT,
        location        TEXT,
        venue_lat       DOUBLE PRECISION,
        venue_lng       DOUBLE PRECISION,
        starts_at       TIMESTAMPTZ NOT NULL,
        ends_at         TIMESTAMPTZ,
        expires_at      TIMESTAMPTZ NOT NULL,
        image_url       TEXT,
        external_url    TEXT,
        synced_at       TIMESTAMPTZ,
        sync_status     TEXT        DEFAULT 'ok',
        series_id       TEXT        REFERENCES event_series(id) ON DELETE SET NULL,
        occurrence_date DATE,
        UNIQUE (source_type, external_id)
    )
", 'channel_events');

// Partial index for the canonical recurring-event lookup (one row per series).
run($pdo, "
    CREATE INDEX IF NOT EXISTS idx_channel_events_canonical
        ON channel_events (series_id)
        WHERE series_id IS NOT NULL AND occurrence_date IS NULL
", 'idx_channel_events_canonical');

// Maps a retired recurring-occurrence channel_id → its surviving canonical
// channel_id, so old /event/<occurrence-hex> URLs Google cached can 301 to the
// canonical event. The per-date occurrence id is a one-way hash, so a lookup
// table is required. No FK: from_channel_id intentionally points at a deleted
// channel.
run($pdo, "
    CREATE TABLE IF NOT EXISTS event_redirects (
        from_channel_id TEXT        PRIMARY KEY,
        to_channel_id   TEXT        NOT NULL,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    )
", 'event_redirects');

// Cached Open Graph previews for URLs posted in chat. PK is the SHA-1 of the
// URL so the index stays bounded regardless of URL length. ttl_until controls
// re-fetch cadence (24 h on success, 1 h on failure - fields stay nullable so
// the negative result is also cached).
run($pdo, "
    CREATE TABLE IF NOT EXISTS link_previews (
        url_hash    CHAR(40)     PRIMARY KEY,
        url         TEXT         NOT NULL,
        title       TEXT,
        description TEXT,
        image       TEXT,
        site_name   TEXT,
        fetched_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
        ttl_until   TIMESTAMPTZ  NOT NULL
    )
", 'link_previews');

run($pdo, "
    CREATE TABLE IF NOT EXISTS messages (
        id          TEXT        PRIMARY KEY,
        channel_id  TEXT        NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
        type        TEXT        NOT NULL DEFAULT 'text',
        event       TEXT,
        guest_id    TEXT,
        user_id     TEXT        REFERENCES users(id) ON DELETE SET NULL,
        nickname    TEXT        NOT NULL DEFAULT '',
        content     TEXT,
        image_url   TEXT,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
", 'messages');

run($pdo, "
    CREATE TABLE IF NOT EXISTS presence (
        session_id   TEXT        NOT NULL,
        channel_id   TEXT        NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
        guest_id     TEXT        NOT NULL,
        user_id      TEXT        REFERENCES users(id) ON DELETE CASCADE,
        nickname     TEXT        NOT NULL,
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (session_id, channel_id)
    )
", 'presence');

run($pdo, "
    CREATE TABLE IF NOT EXISTS event_participants (
        channel_id   TEXT        NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
        guest_id     TEXT        NOT NULL,
        user_id      TEXT        REFERENCES users(id) ON DELETE SET NULL,
        nickname     TEXT        NOT NULL DEFAULT '',
        joined_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_read_at TIMESTAMPTZ DEFAULT NULL,
        PRIMARY KEY (channel_id, guest_id)
    )
", 'event_participants');

run($pdo, "
    CREATE TABLE IF NOT EXISTS user_city_memberships (
        user_id       TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        channel_id    TEXT        NOT NULL,
        first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, channel_id)
    )
", 'user_city_memberships');

run($pdo, "
    CREATE TABLE IF NOT EXISTS user_sessions (
        id         TEXT        PRIMARY KEY,
        user_id    TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 days')
    )
", 'user_sessions');

run($pdo, "
    CREATE TABLE IF NOT EXISTS user_city_roles (
        id         TEXT        PRIMARY KEY,
        user_id    TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        city_id    TEXT        NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
        role       TEXT        NOT NULL DEFAULT 'ambassador',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (user_id, city_id, role)
    )
", 'user_city_roles');

run($pdo, "
    CREATE TABLE IF NOT EXISTS user_friends (
        user_id    TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        friend_id  TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, friend_id)
    )
", 'user_friends');

// Friend requests: a directed pending → accepted/declined/cancelled record.
// `user_friends` is only populated when a request is accepted; the legacy
// instant-add behaviour is replaced by request creation.
run($pdo, "
    CREATE TABLE IF NOT EXISTS friend_requests (
        id          TEXT        PRIMARY KEY,
        sender_id   TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        receiver_id TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status      TEXT        NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending','accepted','declined','cancelled')),
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        CHECK (sender_id <> receiver_id)
    )
", 'friend_requests');

run($pdo, "
    CREATE TABLE IF NOT EXISTS conversations (
        id         TEXT        PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
", 'conversations');

run($pdo, "
    CREATE TABLE IF NOT EXISTS conversation_participants (
        conversation_id TEXT        NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        user_id         TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        last_read_at    TIMESTAMPTZ DEFAULT NULL,
        PRIMARY KEY (conversation_id, user_id)
    )
", 'conversation_participants');

run($pdo, "
    CREATE TABLE IF NOT EXISTS conversation_messages (
        id              TEXT        PRIMARY KEY,
        conversation_id TEXT        NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        sender_id       TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type            TEXT        NOT NULL DEFAULT 'text',
        content         TEXT        NOT NULL,
        image_url       TEXT,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    )
", 'conversation_messages');

run($pdo, "
    CREATE TABLE IF NOT EXISTS notifications (
        id         BIGSERIAL    PRIMARY KEY,
        user_id    TEXT         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type       VARCHAR(50)  NOT NULL,
        title      TEXT         NOT NULL,
        body       TEXT,
        data       JSONB        NOT NULL DEFAULT '{}',
        is_read    BOOLEAN      NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ  NOT NULL DEFAULT now()
    )
", 'notifications');

run($pdo, "
    CREATE TABLE IF NOT EXISTS notification_preferences (
        user_id                TEXT    PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        dm_push                BOOLEAN NOT NULL DEFAULT TRUE,
        event_message_push     BOOLEAN NOT NULL DEFAULT TRUE,
        event_join_push        BOOLEAN NOT NULL DEFAULT FALSE,
        new_event_push         BOOLEAN NOT NULL DEFAULT TRUE,
        channel_message_push   BOOLEAN NOT NULL DEFAULT FALSE,
        city_join_push         BOOLEAN NOT NULL DEFAULT FALSE,
        friend_request_push    BOOLEAN NOT NULL DEFAULT TRUE,
        vibe_received_push     BOOLEAN NOT NULL DEFAULT TRUE,
        profile_view_push      BOOLEAN NOT NULL DEFAULT TRUE,
        topic_reply_push       BOOLEAN NOT NULL DEFAULT TRUE,
        new_topic_push         BOOLEAN NOT NULL DEFAULT FALSE,
        admin_announcement_push BOOLEAN NOT NULL DEFAULT TRUE
    )
", 'notification_preferences');

// new_event_push was originally DEFAULT FALSE while the "new event in your city"
// trigger was broken. Now that it's fixed, city members should get it by default.
// CREATE TABLE IF NOT EXISTS won't touch the existing column, so set the default
// explicitly on the live column (idempotent - safe to re-run every deploy).
run($pdo, "ALTER TABLE notification_preferences ALTER COLUMN new_event_push SET DEFAULT TRUE", 'notification_preferences.new_event_push default→true');

// mention_push - @mention notifications. High-signal/personal → default TRUE
// at the column level, and backfill existing rows so nobody is stuck at a
// technical FALSE (mirrors the new_event_push fix).
run($pdo, "ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS mention_push BOOLEAN NOT NULL DEFAULT TRUE", 'notification_preferences.mention_push');
$mentionBackfill = $pdo->exec("UPDATE notification_preferences SET mention_push = TRUE WHERE mention_push = FALSE");
echo "  OK  backfilled mention_push=TRUE for " . (int) $mentionBackfill . " row(s)\n";

// Per-(arriver, city) "someone arrived" cooldown. One row per arriver per city,
// updated in place; last_notified_at gates re-notification so a quick
// leave/return or a foreground/reconnect within the cooldown window does NOT
// re-spam the city. arriver_key = "u:<userId>" (registered) or "g:<guestId>".
run($pdo, "
    CREATE TABLE IF NOT EXISTS arrival_cooldown (
        arriver_key      TEXT        NOT NULL,
        channel_id       TEXT        NOT NULL,
        last_notified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (arriver_key, channel_id)
    )
", 'arrival_cooldown');

// Admin push broadcasts - one row per send action triggered from /admin/push.
// Doubles as the audit log (admin_username + admin_ip + created_at) since
// the back office uses single-user env-based auth, not a user table.
run($pdo, "
    CREATE TABLE IF NOT EXISTS push_broadcasts (
        id              BIGSERIAL    PRIMARY KEY,
        admin_username  TEXT         NOT NULL,
        admin_ip        INET,
        title           VARCHAR(80)  NOT NULL,
        body            VARCHAR(200) NOT NULL,
        audience_type   TEXT         NOT NULL CHECK (audience_type IN ('all','city','user','test')),
        audience_filter JSONB        NOT NULL DEFAULT '{}'::jsonb,
        deep_link       TEXT,
        recipient_count INTEGER      NOT NULL DEFAULT 0,
        delivered_count INTEGER      NOT NULL DEFAULT 0,
        failed_count    INTEGER      NOT NULL DEFAULT 0,
        status          TEXT         NOT NULL DEFAULT 'sending'
                                     CHECK (status IN ('sending','sent','failed')),
        created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
        sent_at         TIMESTAMPTZ
    )
", 'push_broadcasts');

run($pdo, "
    CREATE TABLE IF NOT EXISTS push_subscriptions (
        id           BIGSERIAL    PRIMARY KEY,
        user_id      TEXT         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        endpoint     TEXT         NOT NULL UNIQUE,
        p256dh       TEXT         NOT NULL,
        auth_key     TEXT         NOT NULL,
        created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
        last_used_at TIMESTAMPTZ  NOT NULL DEFAULT now()
    )
", 'push_subscriptions');

run($pdo, "
    CREATE TABLE IF NOT EXISTS mobile_push_tokens (
        id           BIGSERIAL   PRIMARY KEY,
        user_id      TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token        TEXT        NOT NULL UNIQUE,
        platform     TEXT        NOT NULL DEFAULT 'unknown',
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_used_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
", 'mobile_push_tokens');

run($pdo, "
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id         BIGSERIAL    PRIMARY KEY,
        user_id    TEXT         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT         NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ  NOT NULL DEFAULT (now() + INTERVAL '1 hour'),
        used_at    TIMESTAMPTZ,
        created_at TIMESTAMPTZ  NOT NULL DEFAULT now()
    )
", 'password_reset_tokens');

run($pdo, "
    CREATE TABLE IF NOT EXISTS city_sync_log (
        channel_id   TEXT        PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE,
        synced_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        event_count  INTEGER     NOT NULL DEFAULT 0,
        status       TEXT        NOT NULL DEFAULT 'ok'
    )
", 'city_sync_log');

run($pdo, "
    CREATE TABLE IF NOT EXISTS push_delivery_log (
        id      BIGSERIAL   PRIMARY KEY,
        user_id TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type    TEXT        NOT NULL,
        ref_id  TEXT        NOT NULL DEFAULT '',
        sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
", 'push_delivery_log');

run($pdo, "
    CREATE TABLE IF NOT EXISTS user_vibes (
        id          BIGSERIAL    PRIMARY KEY,
        author_id   TEXT         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        target_id   TEXT         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        rating      SMALLINT     NOT NULL CHECK (rating BETWEEN 1 AND 5),
        message     TEXT,
        created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
        updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
        UNIQUE (author_id, target_id)
    )
", 'user_vibes');

run($pdo, "
    CREATE TABLE IF NOT EXISTS channel_topics (
        channel_id   TEXT        PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE,
        city_id      TEXT        NOT NULL    REFERENCES channels(id),
        created_by   TEXT        REFERENCES users(id) ON DELETE SET NULL,
        guest_id     TEXT,
        title        TEXT        NOT NULL,
        description  TEXT,
        category     TEXT        NOT NULL DEFAULT 'general',
        expires_at   TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '24 hours'),
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    )
", 'channel_topics');

run($pdo, "
    CREATE TABLE IF NOT EXISTS topic_subscriptions (
        topic_id   TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (topic_id, user_id)
    )
", 'topic_subscriptions');

// Hangout (internally "topic") participants - registered members in a hangout.
// Hangouts are members-only, so keyed by user_id (no guests). Creator is added
// on create; accepted join-requesters are added on accept.
run($pdo, "
    CREATE TABLE IF NOT EXISTS topic_participants (
        topic_id  TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
        user_id   TEXT NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
        joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (topic_id, user_id)
    )
", 'topic_participants');

// Hangout join requests. Resolution is collaborative + first-write-wins: any
// participant can accept/reject; the partial unique index guarantees at most
// one PENDING request per (hangout, requester).
run($pdo, "
    CREATE TABLE IF NOT EXISTS topic_join_requests (
        id               TEXT PRIMARY KEY,
        topic_id         TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
        requester_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        requester_name   TEXT NOT NULL DEFAULT '',
        status           TEXT NOT NULL DEFAULT 'pending',
        resolved_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
        resolved_by_name TEXT,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
        resolved_at      TIMESTAMPTZ
    )
", 'topic_join_requests');
run($pdo, "
    CREATE UNIQUE INDEX IF NOT EXISTS topic_join_requests_one_pending
    ON topic_join_requests (topic_id, requester_id) WHERE status = 'pending'
", 'topic_join_requests_one_pending');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_topic_join_requests_topic ON topic_join_requests (topic_id)", 'idx_topic_join_requests_topic');

// Backfill: every existing hangout's creator becomes a participant so existing
// pulses are valid hangouts with a non-empty attendee list.
$tpBackfill = $pdo->exec("
    INSERT INTO topic_participants (topic_id, user_id)
    SELECT channel_id, created_by FROM channel_topics
    WHERE created_by IS NOT NULL
    ON CONFLICT (topic_id, user_id) DO NOTHING
");
echo "  OK  backfilled topic_participants for " . (int) $tpBackfill . " hangout creator(s)\n";

// join_request_push - notify a hangout's participants when someone asks to join.
// High-signal/social → default TRUE; backfill existing rows to TRUE (mirrors the
// new_event_push / mention_push default fix).
run($pdo, "ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS join_request_push BOOLEAN NOT NULL DEFAULT TRUE", 'notification_preferences.join_request_push');
$jrBackfill = $pdo->exec("UPDATE notification_preferences SET join_request_push = TRUE WHERE join_request_push = FALSE");
echo "  OK  backfilled join_request_push=TRUE for " . (int) $jrBackfill . " row(s)\n";

// ══════════════════════════════════════════════════════════════════════════════
// ADDITIVE COLUMNS - safe no-ops when columns already exist
// ══════════════════════════════════════════════════════════════════════════════

echo "\n[ Additive columns ]\n";

// users
run($pdo, "ALTER TABLE users ADD COLUMN IF NOT EXISTS vibe TEXT NOT NULL DEFAULT 'chill'", 'users.vibe');
run($pdo, "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT false", 'users.is_verified');
run($pdo, "ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL", 'users.deleted_at');
run($pdo, "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_fake BOOLEAN NOT NULL DEFAULT false", 'users.is_fake');
run($pdo, "ALTER TABLE users ADD COLUMN IF NOT EXISTS ambassador_restaurant TEXT", 'users.ambassador_restaurant');
run($pdo, "ALTER TABLE users ADD COLUMN IF NOT EXISTS ambassador_spot TEXT", 'users.ambassador_spot');
run($pdo, "ALTER TABLE users ADD COLUMN IF NOT EXISTS ambassador_tip TEXT", 'users.ambassador_tip');
run($pdo, "ALTER TABLE users ADD COLUMN IF NOT EXISTS ambassador_story TEXT", 'users.ambassador_story');
run($pdo, "ALTER TABLE users ADD COLUMN IF NOT EXISTS about_me TEXT", 'users.about_me');
run($pdo, "ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_thumb_photo_url TEXT", 'users.profile_thumb_photo_url');

// username - the unique @-mention handle. Case-insensitive uniqueness enforced
// at the DB level via a partial unique index on lower(username) (partial so the
// many legacy NULLs stay valid until the backfill at the end of this script
// fills them). New signups always provide one, so NULLs are legacy-only.
run($pdo, "ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT", 'users.username');
run($pdo, "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower ON users (lower(username)) WHERE username IS NOT NULL", 'idx_users_username_lower');

// messages.mentions - @mention metadata: [{userId, offset, length}] into content.
// Usernames are NOT stored (resolved to the current value on read) so renames
// reflect everywhere. Empty array for non-mention messages.
run($pdo, "ALTER TABLE messages ADD COLUMN IF NOT EXISTS mentions JSONB NOT NULL DEFAULT '[]'", 'messages.mentions');

// users - current city: single source of truth for membership + notifications.
// `current_city_id` is committed via the two-signal transition rule (see
// /location/resolve handler). `pending_*` holds the first-signal candidate
// until a second signal ≥10 min later commits it. `home_city` is kept as a
// freeform profile string ("where you're from"), no longer used for membership.
run($pdo, "ALTER TABLE users ADD COLUMN IF NOT EXISTS current_city_id TEXT REFERENCES channels(id) ON DELETE SET NULL", 'users.current_city_id');
run($pdo, "ALTER TABLE users ADD COLUMN IF NOT EXISTS current_city_set_at TIMESTAMPTZ", 'users.current_city_set_at');
run($pdo, "ALTER TABLE users ADD COLUMN IF NOT EXISTS current_city_last_confirmed_at TIMESTAMPTZ", 'users.current_city_last_confirmed_at');
run($pdo, "ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_city_id TEXT REFERENCES channels(id) ON DELETE SET NULL", 'users.pending_city_id');
run($pdo, "ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_city_first_seen_at TIMESTAMPTZ", 'users.pending_city_first_seen_at');

// event_series
run($pdo, "ALTER TABLE event_series ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'user'", 'event_series.source');
run($pdo, "ALTER TABLE event_series ADD COLUMN IF NOT EXISTS source_key TEXT", 'event_series.source_key');
run($pdo, "ALTER TABLE event_series ALTER COLUMN created_by DROP NOT NULL", 'event_series.created_by nullable');
// Venue geocoordinates - captured from Google Places API on seeding so we
// can emit schema.org GeoCoordinates in venue JSON-LD (unlocks the map rich
// result). Nullable so legacy rows stay valid; backfill via
// scripts/backfill_venue_geo.php when ready.
run($pdo, "ALTER TABLE event_series ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION", 'event_series.lat');
run($pdo, "ALTER TABLE event_series ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION", 'event_series.lng');

// channel_events
run($pdo, "ALTER TABLE channel_events ADD COLUMN IF NOT EXISTS series_id TEXT REFERENCES event_series(id) ON DELETE SET NULL", 'channel_events.series_id');
run($pdo, "ALTER TABLE channel_events ADD COLUMN IF NOT EXISTS occurrence_date DATE", 'channel_events.occurrence_date');
run($pdo, "ALTER TABLE channel_events ADD COLUMN IF NOT EXISTS created_by TEXT REFERENCES users(id) ON DELETE SET NULL", 'channel_events.created_by');
// Denormalized city_id: eliminates the slow channels JOIN in event queries
run($pdo, "ALTER TABLE channel_events ADD COLUMN IF NOT EXISTS city_id TEXT", 'channel_events.city_id');
// Backfill from channels (idempotent: WHERE city_id IS NULL)
run($pdo,
    "UPDATE channel_events ce SET city_id = c.parent_id FROM channels c WHERE c.id = ce.channel_id AND ce.city_id IS NULL",
    'channel_events.city_id backfill'
);
// Denormalized created_at: mirrors channels.created_at so we can drop the channels JOIN
// from city-channel event queries entirely (previously needed c.created_at in SELECT)
run($pdo, "ALTER TABLE channel_events ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now()", 'channel_events.created_at');
// Edit-signal for /sitemap/events <lastmod>. Bumped on every user edit in
// EventRepository::update(); DEFAULT now() on ALTER means pre-migration rows
// take the migration timestamp (one re-crawl wave, then quiet). TM-imported
// events keep INSERT-time updated_at - re-sync UPSERTs deliberately don't
// bump it because most syncs are no-ops (same data, false re-crawl signal).
run($pdo, "ALTER TABLE channel_events ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now()", 'channel_events.updated_at');
// Backfill from channels.created_at - idempotent (re-run just sets the same value)
run($pdo,
    "UPDATE channel_events ce SET created_at = c.created_at FROM channels c WHERE c.id = ce.channel_id",
    'channel_events.created_at backfill'
);

// event_participants
run($pdo, "ALTER TABLE event_participants ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES users(id) ON DELETE SET NULL", 'event_participants.user_id');
run($pdo, "ALTER TABLE event_participants ADD COLUMN IF NOT EXISTS last_read_at TIMESTAMPTZ DEFAULT NULL", 'event_participants.last_read_at');
run($pdo, "ALTER TABLE event_participants ADD COLUMN IF NOT EXISTS nickname TEXT NOT NULL DEFAULT ''", 'event_participants.nickname');

// conversation_participants
run($pdo, "ALTER TABLE conversation_participants ADD COLUMN IF NOT EXISTS last_read_at TIMESTAMPTZ DEFAULT NULL", 'conversation_participants.last_read_at');

// conversation_messages
run($pdo, "ALTER TABLE conversation_messages ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'text'", 'conversation_messages.type');
run($pdo, "ALTER TABLE conversation_messages ADD COLUMN IF NOT EXISTS image_url TEXT", 'conversation_messages.image_url');

// messages - reply support
run($pdo, "ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to_id       TEXT REFERENCES messages(id) ON DELETE SET NULL", 'messages.reply_to_id');
run($pdo, "ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to_nickname TEXT", 'messages.reply_to_nickname');
run($pdo, "ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to_content  TEXT", 'messages.reply_to_content');
run($pdo, "ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to_type     TEXT NOT NULL DEFAULT 'text'", 'messages.reply_to_type');

// messages - per-acceptance scoping for challenge channels.
//
// A challenge channel persists across multiple sequential acceptances on the
// same channel_challenges row. Without this column, every new acceptor saw
// the previous run's conversation when they landed on the channel - confusing
// + leaks chat between runs. The column binds each message to the acceptance
// that was active when it was written; the GET messages route filters to
// "messages whose acceptance is the current active one" so each run reads
// like a fresh chat. Messages outside any acceptance window (creator chatter
// between runs, pre-acceptance system events) get NULL - they're visible
// during the same "no active acceptance" state but hidden once a new run
// starts.
//
// ON DELETE SET NULL: when an acceptance is cancelled & hard-deleted, leave
// its messages in place (don't cascade-delete the chat). They'll fall back
// to NULL and behave like cross-acceptance writes.
run($pdo, "ALTER TABLE messages ADD COLUMN IF NOT EXISTS challenge_acceptance_id TEXT REFERENCES challenge_acceptances(id) ON DELETE SET NULL", 'messages.challenge_acceptance_id');
// Partial index - the column is only meaningful for challenge channels
// (city / event / DM channels never set it), so skip the NULL rows that
// dominate the table.
run($pdo, "CREATE INDEX IF NOT EXISTS idx_messages_acceptance_channel
    ON messages (channel_id, challenge_acceptance_id, created_at DESC)
    WHERE challenge_acceptance_id IS NOT NULL", 'idx_messages_acceptance_channel');

// One-shot backfill: stamp every existing challenge-channel message with the
// most recent prior acceptance (any phase - including rejected). Heuristic:
// "the acceptance that was already created by the time this message landed".
// Messages older than the first acceptance keep NULL (pre-acceptance system
// events like challenge creation banners), which is what we want.
//
// Idempotent: the WHERE challenge_acceptance_id IS NULL guard means re-runs
// only touch rows the prior run didn't already stamp.
run($pdo, "
    UPDATE messages m
    SET challenge_acceptance_id = (
        SELECT ca.id
        FROM challenge_acceptances ca
        WHERE ca.challenge_id = m.channel_id
          AND ca.created_at  <= m.created_at
        ORDER BY ca.created_at DESC
        LIMIT 1
    )
    WHERE m.challenge_acceptance_id IS NULL
      AND m.channel_id IN (SELECT channel_id FROM channel_challenges)
", 'backfill - stamp challenge messages with prior acceptance');

// conversation_messages - reply support
run($pdo, "ALTER TABLE conversation_messages ADD COLUMN IF NOT EXISTS reply_to_id       TEXT REFERENCES conversation_messages(id) ON DELETE SET NULL", 'conversation_messages.reply_to_id');
run($pdo, "ALTER TABLE conversation_messages ADD COLUMN IF NOT EXISTS reply_to_nickname TEXT", 'conversation_messages.reply_to_nickname');
run($pdo, "ALTER TABLE conversation_messages ADD COLUMN IF NOT EXISTS reply_to_content  TEXT", 'conversation_messages.reply_to_content');
run($pdo, "ALTER TABLE conversation_messages ADD COLUMN IF NOT EXISTS reply_to_type     TEXT NOT NULL DEFAULT 'text'", 'conversation_messages.reply_to_type');

// notification_preferences
run($pdo, "ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS event_join_push BOOLEAN NOT NULL DEFAULT FALSE", 'notification_preferences.event_join_push');
run($pdo, "ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS channel_message_push BOOLEAN NOT NULL DEFAULT FALSE", 'notification_preferences.channel_message_push');
run($pdo, "ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS city_join_push BOOLEAN NOT NULL DEFAULT FALSE", 'notification_preferences.city_join_push');
// Rename friend_added_push → friend_request_push for the new request-based
// flow. Idempotent: only runs when the old column exists and the new doesn't.
run($pdo, "
    DO \$\$
    BEGIN
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'notification_preferences' AND column_name = 'friend_added_push'
        ) AND NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'notification_preferences' AND column_name = 'friend_request_push'
        ) THEN
            ALTER TABLE notification_preferences RENAME COLUMN friend_added_push TO friend_request_push;
        END IF;
    END \$\$
", 'notification_preferences.friend_added_push → friend_request_push');
run($pdo, "ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS friend_request_push BOOLEAN NOT NULL DEFAULT TRUE", 'notification_preferences.friend_request_push');
run($pdo, "ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS vibe_received_push BOOLEAN NOT NULL DEFAULT TRUE", 'notification_preferences.vibe_received_push');
run($pdo, "ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS profile_view_push BOOLEAN NOT NULL DEFAULT TRUE", 'notification_preferences.profile_view_push');
run($pdo, "ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS topic_reply_push BOOLEAN NOT NULL DEFAULT TRUE", 'notification_preferences.topic_reply_push');
run($pdo, "ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS new_topic_push BOOLEAN NOT NULL DEFAULT FALSE", 'notification_preferences.new_topic_push');
run($pdo, "ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS admin_announcement_push BOOLEAN NOT NULL DEFAULT TRUE", 'notification_preferences.admin_announcement_push');
// new_challenge_push was only ever added by the on-demand api.php migration
// block - never in migrate.php. If that block hasn't run, the column is missing
// and EVERY preference upsert 500s (the INSERT lists all defaults() columns),
// which makes the notification toggles flip back. Provision it here so a plain
// migrate.php run fixes it.
run($pdo, "ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS new_challenge_push BOOLEAN NOT NULL DEFAULT TRUE", 'notification_preferences.new_challenge_push');

// mobile_push_tokens
run($pdo, "ALTER TABLE mobile_push_tokens ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ NOT NULL DEFAULT now()", 'mobile_push_tokens.last_used_at');

// Guest device tokens: a push token can belong to a registered user OR an
// unregistered guest device. user_id becomes nullable; guest_id holds the
// device's guest session when there's no account. Lets the BO broadcast to
// "all app installs incl. guests". When a guest later registers, the same token
// re-subscribes with user_id set (claimed). Additive + backfill-free.
run($pdo, "ALTER TABLE mobile_push_tokens ALTER COLUMN user_id DROP NOT NULL", 'mobile_push_tokens.user_id nullable');
run($pdo, "ALTER TABLE mobile_push_tokens ADD COLUMN IF NOT EXISTS guest_id TEXT", 'mobile_push_tokens.guest_id');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_mobile_push_tokens_guest ON mobile_push_tokens (guest_id) WHERE guest_id IS NOT NULL", 'idx_mobile_push_tokens_guest');

// ══════════════════════════════════════════════════════════════════════════════
// DATA FIXES - idempotent, run once
// ══════════════════════════════════════════════════════════════════════════════

echo "\n[ Data fixes ]\n";

// Backfill bilateral friendships: for every one-way A→B, ensure B→A exists.
run($pdo, "
    INSERT INTO user_friends (user_id, friend_id, created_at)
    SELECT orig.friend_id, orig.user_id, orig.created_at
    FROM   user_friends orig
    WHERE  NOT EXISTS (
        SELECT 1 FROM user_friends rev
        WHERE  rev.user_id   = orig.friend_id
          AND  rev.friend_id = orig.user_id
    )
    ON CONFLICT DO NOTHING
", 'user_friends bilateral backfill');

// ══════════════════════════════════════════════════════════════════════════════
// INDEXES - all idempotent (CREATE INDEX IF NOT EXISTS)
// ══════════════════════════════════════════════════════════════════════════════

echo "\n[ Indexes ]\n";

// users
run($pdo, "CREATE INDEX IF NOT EXISTS idx_users_email         ON users (lower(email))", 'idx_users_email');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_users_guest_id      ON users (guest_id) WHERE guest_id IS NOT NULL", 'idx_users_guest_id');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_users_home_city_lower ON users (LOWER(TRIM(home_city)))", 'idx_users_home_city_lower');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_users_current_city ON users (current_city_id) WHERE current_city_id IS NOT NULL", 'idx_users_current_city');

// Backfill: registered users who set home_city in their profile but never
// had GPS resolve are invisible in their city's crew (MEMBERS_USE_CURRENT_CITY=on
// filters on current_city_id only). One-shot UPDATE keyed on
// current_city_id IS NULL so re-runs are no-ops. Goes through to channels +
// cities (case-insensitive name match) so we capture every recognised city,
// not just those still spelled exactly as the city display name. Confidence
// timestamps are stamped to now() so the two-signal transition rule treats
// the placement as already-confirmed.
run($pdo, "
    UPDATE users u
       SET current_city_id                = ch.id,
           current_city_set_at            = COALESCE(u.current_city_set_at, now()),
           current_city_last_confirmed_at = COALESCE(u.current_city_last_confirmed_at, now())
      FROM channels ch
      JOIN cities ci ON ci.channel_id = ch.id
     WHERE u.current_city_id IS NULL
       AND u.deleted_at IS NULL
       AND u.home_city IS NOT NULL
       AND lower(trim(u.home_city)) = lower(trim(ch.name))
       AND ch.type = 'city'
       AND ch.status = 'active'
", 'backfill users.current_city_id from home_city');

// channels
run($pdo, "CREATE INDEX IF NOT EXISTS idx_channels_parent        ON channels (parent_id) WHERE parent_id IS NOT NULL", 'idx_channels_parent');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_channels_type          ON channels (type)", 'idx_channels_type');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_channels_status        ON channels (status)", 'idx_channels_status');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_channels_active_events ON channels (parent_id) WHERE type = 'event' AND status = 'active'", 'idx_channels_active_events');

// cities
run($pdo, "CREATE INDEX IF NOT EXISTS idx_cities_geo ON cities (lat, lng)", 'idx_cities_geo');

// event_series
run($pdo, "CREATE INDEX IF NOT EXISTS idx_event_series_city   ON event_series (city_id)", 'idx_event_series_city');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_event_series_source ON event_series (source)", 'idx_event_series_source');

// channel_events - channel_id was missing; causes seq scan on every event query
run($pdo, "CREATE INDEX IF NOT EXISTS idx_channel_events_channel  ON channel_events (channel_id)", 'idx_channel_events_channel');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_channel_events_source   ON channel_events (source_type)", 'idx_channel_events_source');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_channel_events_starts   ON channel_events (starts_at)", 'idx_channel_events_starts');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_channel_events_expires  ON channel_events (expires_at)", 'idx_channel_events_expires');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_channel_events_guest    ON channel_events (guest_id) WHERE guest_id IS NOT NULL", 'idx_channel_events_guest');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_channel_events_ext_id   ON channel_events (external_id) WHERE external_id IS NOT NULL", 'idx_channel_events_ext_id');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_channel_events_series      ON channel_events (series_id) WHERE series_id IS NOT NULL", 'idx_channel_events_series');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_channel_events_created_by  ON channel_events (created_by) WHERE created_by IS NOT NULL", 'idx_channel_events_created_by');
// Speeds up ensureTodayOccurrences NOT EXISTS check (series_id + occurrence_date lookup)
run($pdo, "CREATE INDEX IF NOT EXISTS idx_channel_events_series_date ON channel_events (series_id, occurrence_date) WHERE series_id IS NOT NULL AND occurrence_date IS NOT NULL", 'idx_channel_events_series_date');
// Compound index for city-scoped event queries - replaces the slow channels JOIN
run($pdo, "CREATE INDEX IF NOT EXISTS idx_channel_events_city_active ON channel_events (city_id, source_type, expires_at, starts_at) WHERE city_id IS NOT NULL", 'idx_channel_events_city_active');

// messages
run($pdo, "CREATE INDEX IF NOT EXISTS idx_messages_channel          ON messages (channel_id, created_at DESC)", 'idx_messages_channel');
// Drop the duplicate index (identical definition to idx_messages_channel above)
run($pdo, "DROP INDEX IF EXISTS idx_messages_channel_created", 'drop_idx_messages_channel_created');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_messages_guest            ON messages (guest_id) WHERE guest_id IS NOT NULL", 'idx_messages_guest');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_messages_crew_lookup      ON messages (channel_id, type, guest_id) WHERE type = 'text' AND guest_id IS NOT NULL", 'idx_messages_crew_lookup');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_messages_channel_type_time ON messages (channel_id, type, created_at DESC) WHERE type IN ('text', 'image')", 'idx_messages_channel_type_time');

// presence
run($pdo, "CREATE INDEX IF NOT EXISTS idx_presence_channel ON presence (channel_id, last_seen_at DESC)", 'idx_presence_channel');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_presence_guest   ON presence (guest_id)", 'idx_presence_guest');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_presence_count   ON presence (channel_id, last_seen_at DESC, guest_id)", 'idx_presence_count');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_presence_online  ON presence (channel_id, guest_id, last_seen_at DESC)", 'idx_presence_online');

// event_participants
run($pdo, "CREATE INDEX IF NOT EXISTS idx_event_participants_channel ON event_participants (channel_id)", 'idx_event_participants_channel');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_event_participants_user    ON event_participants (user_id) WHERE user_id IS NOT NULL", 'idx_event_participants_user');

// user_city_memberships
run($pdo, "CREATE INDEX IF NOT EXISTS idx_city_memberships_channel ON user_city_memberships (channel_id, last_seen_at DESC)", 'idx_city_memberships_channel');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_city_memberships_user    ON user_city_memberships (user_id)", 'idx_city_memberships_user');

// user_sessions
run($pdo, "CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions (user_id)", 'idx_user_sessions_user');

// user_city_roles
run($pdo, "CREATE INDEX IF NOT EXISTS idx_user_city_roles_user ON user_city_roles (user_id)", 'idx_user_city_roles_user');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_user_city_roles_city ON user_city_roles (city_id)", 'idx_user_city_roles_city');

// user_friends
run($pdo, "CREATE INDEX IF NOT EXISTS idx_user_friends_user   ON user_friends (user_id,   created_at DESC)", 'idx_user_friends_user');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_user_friends_friend ON user_friends (friend_id, created_at DESC)", 'idx_user_friends_friend');

// friend_requests
run($pdo, "CREATE INDEX IF NOT EXISTS idx_friend_req_receiver_status ON friend_requests (receiver_id, status, created_at DESC)", 'idx_friend_req_receiver_status');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_friend_req_sender_status   ON friend_requests (sender_id,   status, created_at DESC)", 'idx_friend_req_sender_status');
// At most one pending request per direction. Combined with the auto-accept
// path on mutual add (Phase 2) this guarantees only one pending row exists
// between any two users at a time. Re-sending after decline/cancel creates a
// new row because the old row's status is no longer 'pending'.
run($pdo, "CREATE UNIQUE INDEX IF NOT EXISTS uq_friend_req_pending ON friend_requests (sender_id, receiver_id) WHERE status = 'pending'", 'uq_friend_req_pending');

// conversations
run($pdo, "CREATE INDEX IF NOT EXISTS idx_conv_participants_user    ON conversation_participants (user_id)", 'idx_conv_participants_user');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_conv_messages_conv        ON conversation_messages (conversation_id, created_at ASC)", 'idx_conv_messages_conv');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_conv_messages_conv_created ON conversation_messages (conversation_id, created_at DESC)", 'idx_conv_messages_conv_created');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_conv_messages_unread      ON conversation_messages (conversation_id, sender_id, created_at DESC)", 'idx_conv_messages_unread');

// notifications
run($pdo, "CREATE INDEX IF NOT EXISTS idx_notifications_user_feed   ON notifications (user_id, created_at DESC)", 'idx_notifications_user_feed');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications (user_id) WHERE is_read = FALSE", 'idx_notifications_user_unread');

// push
run($pdo, "CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions (user_id)", 'idx_push_subscriptions_user');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_mobile_push_tokens_user ON mobile_push_tokens (user_id)", 'idx_mobile_push_tokens_user');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_push_delivery_log_lookup ON push_delivery_log (user_id, type, ref_id, sent_at DESC)", 'idx_push_delivery_log_lookup');

// password reset
run($pdo, "CREATE INDEX IF NOT EXISTS idx_prt_user ON password_reset_tokens (user_id)", 'idx_prt_user');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_prt_hash ON password_reset_tokens (token_hash) WHERE used_at IS NULL", 'idx_prt_hash');

// user_vibes
run($pdo, "CREATE INDEX IF NOT EXISTS idx_user_vibes_target ON user_vibes (target_id, created_at DESC)", 'idx_user_vibes_target');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_user_vibes_author ON user_vibes (author_id)", 'idx_user_vibes_author');

// channel_topics
run($pdo, "CREATE INDEX IF NOT EXISTS idx_channel_topics_city   ON channel_topics (city_id, expires_at DESC)", 'idx_channel_topics_city');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_channel_topics_expiry ON channel_topics (expires_at)", 'idx_channel_topics_expiry');
// Hangouts have no address - their coordinates are the creator's location at
// creation time, so the NOW feed can show distance like events.
run($pdo, "ALTER TABLE channel_topics ADD COLUMN IF NOT EXISTS venue_lat DOUBLE PRECISION", 'channel_topics.venue_lat');
run($pdo, "ALTER TABLE channel_topics ADD COLUMN IF NOT EXISTS venue_lng DOUBLE PRECISION", 'channel_topics.venue_lng');

// ── Reactions ─────────────────────────────────────────────────────────────────

run($pdo, "
    CREATE TABLE IF NOT EXISTS message_reactions (
        id         BIGSERIAL   PRIMARY KEY,
        message_id TEXT        NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        guest_id   TEXT,
        user_id    TEXT        REFERENCES users(id) ON DELETE CASCADE,
        emoji      TEXT        NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
", 'message_reactions');

run($pdo, "
    CREATE TABLE IF NOT EXISTS conversation_message_reactions (
        id         BIGSERIAL   PRIMARY KEY,
        message_id TEXT        NOT NULL REFERENCES conversation_messages(id) ON DELETE CASCADE,
        user_id    TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        emoji      TEXT        NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (message_id, user_id, emoji)
    )
", 'conversation_message_reactions');

// One reaction per emoji per registered user (across all messages)
run($pdo, "
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_msg_rxn_user
    ON message_reactions (message_id, user_id, emoji)
    WHERE user_id IS NOT NULL
", 'uniq_msg_rxn_user');

// One reaction per emoji per guest (only when no registered user_id is set)
run($pdo, "
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_msg_rxn_guest
    ON message_reactions (message_id, guest_id, emoji)
    WHERE guest_id IS NOT NULL AND user_id IS NULL
", 'uniq_msg_rxn_guest');

// Efficient batch-fetch by message_id
run($pdo, "CREATE INDEX IF NOT EXISTS idx_msg_rxn_message ON message_reactions (message_id)", 'idx_msg_rxn_message');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_conv_msg_rxn_message ON conversation_message_reactions (message_id)", 'idx_conv_msg_rxn_message');

// ── User reports ──────────────────────────────────────────────────────────────

run($pdo, "
    CREATE TABLE IF NOT EXISTS user_reports (
        id                BIGSERIAL   PRIMARY KEY,
        reporter_user_id  TEXT        REFERENCES users(id) ON DELETE SET NULL,
        reporter_guest_id TEXT,
        target_user_id    TEXT        REFERENCES users(id) ON DELETE SET NULL,
        target_guest_id   TEXT,
        target_nickname   TEXT,
        reason            TEXT        NOT NULL,
        status            TEXT        NOT NULL DEFAULT 'open',
        created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT chk_reporter_identity CHECK (reporter_user_id IS NOT NULL OR reporter_guest_id IS NOT NULL),
        CONSTRAINT chk_target_identity   CHECK (target_user_id   IS NOT NULL OR target_guest_id   IS NOT NULL),
        CONSTRAINT chk_no_self_report    CHECK (reporter_user_id IS NULL OR reporter_user_id != target_user_id),
        CONSTRAINT chk_status            CHECK (status IN ('open', 'reviewed', 'dismissed'))
    )
", 'user_reports');

run($pdo, "CREATE INDEX IF NOT EXISTS idx_user_reports_target_user   ON user_reports (target_user_id)  WHERE target_user_id IS NOT NULL", 'idx_user_reports_target_user');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_user_reports_target_guest  ON user_reports (target_guest_id) WHERE target_guest_id IS NOT NULL", 'idx_user_reports_target_guest');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_user_reports_status_time   ON user_reports (status, created_at DESC)", 'idx_user_reports_status_time');

// ── Event host nickname ───────────────────────────────────────────────────────
// Stored denormalised on channel_events so the event list/detail can show
// "Hosted by X" without a JOIN. Mirrors the pattern used on messages/presence/
// event_participants. Guest hosts have no recoverable history pre-fix, so the
// backfill only covers events with a registered creator (created_by).

run($pdo, "
    ALTER TABLE channel_events
    ADD COLUMN IF NOT EXISTS host_nickname TEXT
", 'channel_events host_nickname');

run($pdo, "
    UPDATE channel_events ce
       SET host_nickname = u.display_name
      FROM users u
     WHERE ce.created_by = u.id
       AND ce.host_nickname IS NULL
", 'channel_events host_nickname backfill');

// ── Dedup user_reports: one report per (reporter, target) pair forever ────────
// Dismiss all but the oldest report per pair so the partial unique index can be
// created and duplicate audit context is preserved.
run($pdo, "
    WITH ranked AS (
        SELECT id,
               ROW_NUMBER() OVER (
                   PARTITION BY
                       COALESCE(reporter_user_id, '@g:' || reporter_guest_id),
                       COALESCE(target_user_id,   '@g:' || target_guest_id)
                   ORDER BY created_at ASC, id ASC
               ) AS rn
          FROM user_reports
    )
    UPDATE user_reports
       SET status = 'dismissed'
     WHERE id IN (SELECT id FROM ranked WHERE rn > 1)
       AND status <> 'dismissed'
", 'user_reports dedup backfill');

// Partial unique index - race defense. Active pairs (non-dismissed) must be unique.
// The '@g:' prefix guarantees user IDs and guest IDs cannot collide in the key.
run($pdo, "
    CREATE UNIQUE INDEX IF NOT EXISTS idx_user_reports_unique_active_pair
      ON user_reports (
          COALESCE(reporter_user_id, '@g:' || reporter_guest_id),
          COALESCE(target_user_id,   '@g:' || target_guest_id)
      )
      WHERE status <> 'dismissed'
", 'idx_user_reports_unique_active_pair');

// push_broadcasts: history page reads recent rows DESC.
run($pdo, "CREATE INDEX IF NOT EXISTS idx_push_broadcasts_recent ON push_broadcasts (created_at DESC)", 'idx_push_broadcasts_recent');

// ── Abuse bans (guest / IP) ───────────────────────────────────────────────────
// Lets ops block a returning anonymous guest. A row bans EITHER a guest_id or an
// ip_address (one non-null), with an expiry. Checked on every city message POST
// (BanRepository::isBanned). Time-boxed, per-identity - no global collateral.
run($pdo, "
    CREATE TABLE IF NOT EXISTS bans (
        id          BIGSERIAL   PRIMARY KEY,
        guest_id    TEXT,
        ip_address  TEXT,
        reason      TEXT,
        created_by  TEXT,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        expires_at  TIMESTAMPTZ,
        CONSTRAINT chk_ban_target CHECK (guest_id IS NOT NULL OR ip_address IS NOT NULL)
    )
", 'bans');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_bans_guest_id   ON bans (guest_id)   WHERE guest_id   IS NOT NULL", 'idx_bans_guest_id');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_bans_ip_address ON bans (ip_address) WHERE ip_address IS NOT NULL", 'idx_bans_ip_address');

// messages.ip_address: stamped on city messages for abuse forensics + so a guest
// ban can also block the IPs that guest posted from. Nullable, additive.
run($pdo, "ALTER TABLE messages ADD COLUMN IF NOT EXISTS ip_address TEXT", 'messages.ip_address');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_messages_guest_recent ON messages (guest_id, created_at DESC) WHERE guest_id IS NOT NULL", 'idx_messages_guest_recent');
// messages.country: ISO-2 origin country from Cloudflare's CF-IPCountry header
// (free, no API). Stamped on arrival (join) events + city messages so the BO
// can show where a guest is connecting from. Nullable, additive.
run($pdo, "ALTER TABLE messages ADD COLUMN IF NOT EXISTS country TEXT", 'messages.country');

// messages.platform: client platform ('web' | 'ios' | 'android' | 'unknown')
// from the X-Platform header, stamped on arrival (join) events so the BO can
// tell whether a session came from the website or a native app. Nullable,
// additive - rows written before this ships stay NULL (shown as "—").
run($pdo, "ALTER TABLE messages ADD COLUMN IF NOT EXISTS platform TEXT", 'messages.platform');

// ── Backfill usernames for legacy users ─────────────────────────────────────
// Every registered user needs a unique @-handle (mentions reference it). New
// signups always provide one; this fills rows created before usernames existed.
// Idempotent: only touches username IS NULL, so re-running is a no-op once
// everyone has one. Reuses the app's slug+dedupe logic via UsernameService,
// passing this script's own $pdo (migrate.php doesn't autoload Database).
require_once __DIR__ . '/src/UsernameService.php';
$missingUsernames = $pdo->query("SELECT id, display_name FROM users WHERE username IS NULL AND deleted_at IS NULL")->fetchAll();
$filledUsernames  = 0;
foreach ($missingUsernames as $uRow) {
    $handle = UsernameService::generateUnique((string) ($uRow['display_name'] ?? 'user'), $pdo);
    $pdo->prepare("UPDATE users SET username = ? WHERE id = ?")->execute([$handle, $uRow['id']]);
    $filledUsernames++;
}
echo "  OK  backfilled username for {$filledUsernames} legacy user(s)\n";

// ── Edit / delete columns on messages + conversation_messages ───────────────
// Soft-delete: deleted_at IS NOT NULL ⇒ render the bubble as a tombstone client-
// side (content is cleared at delete time so no leakage). edited_at: timestamp
// of the last edit; client renders "(edited)" tag when present.
run($pdo, "ALTER TABLE messages              ADD COLUMN IF NOT EXISTS edited_at  TIMESTAMPTZ DEFAULT NULL", 'messages.edited_at');
run($pdo, "ALTER TABLE messages              ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL", 'messages.deleted_at');
run($pdo, "ALTER TABLE conversation_messages ADD COLUMN IF NOT EXISTS edited_at  TIMESTAMPTZ DEFAULT NULL", 'conversation_messages.edited_at');
run($pdo, "ALTER TABLE conversation_messages ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL", 'conversation_messages.deleted_at');

// ── Challenges (Défis) ────────────────────────────────────────────────────────
// Third primary entity alongside events + hangouts. Challenges are persistent
// (no TTL - expires_at uses a 2999 sentinel to keep the existing > now() guards
// happy) and have an explicit lifecycle: status 'open' (active feed) → 'validated'
// (archive, surfaced via "See past challenges"). Hard-delete still goes through
// channels.status = 'deleted'.
run($pdo, "
    CREATE TABLE IF NOT EXISTS channel_challenges (
        channel_id     TEXT        PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE,
        city_id        TEXT        NOT NULL REFERENCES channels(id),
        created_by     TEXT        REFERENCES users(id) ON DELETE SET NULL,
        guest_id       TEXT,
        title          TEXT        NOT NULL,
        challenge_type TEXT        NOT NULL,
        audience       TEXT        NOT NULL,
        status         TEXT        NOT NULL DEFAULT 'open',
        expires_at     TIMESTAMPTZ NOT NULL DEFAULT '2999-01-01T00:00:00Z'::timestamptz,
        validated_at   TIMESTAMPTZ,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    )
", 'channel_challenges');

// Participants - mirrors event_participants exactly (channel_id + guest_id PK,
// optional user_id, joined_at, last_read_at for chat read state). Kept as a
// separate table from event_participants so queries / schemas don't entangle.
run($pdo, "
    CREATE TABLE IF NOT EXISTS challenge_participants (
        channel_id   TEXT        NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
        guest_id     TEXT        NOT NULL,
        user_id      TEXT        REFERENCES users(id) ON DELETE SET NULL,
        nickname     TEXT,
        joined_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_read_at TIMESTAMPTZ,
        PRIMARY KEY (channel_id, guest_id)
    )
", 'challenge_participants');

// Track edits + validations so /sitemap/challenges can emit a real <lastmod>
// signal - without this, Google never knows a challenge changed after its
// first crawl, so edits never bubble out. DEFAULT now() on ALTER means
// existing rows get the migration timestamp (one re-crawl wave, then quiet).
run($pdo, "ALTER TABLE channel_challenges ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now()", 'channel_challenges.updated_at');

// Main feed query: city_id + status + created_at DESC (NOW screen, top 5).
run($pdo, "CREATE INDEX IF NOT EXISTS idx_channel_challenges_city_status ON channel_challenges (city_id, status, created_at DESC)", 'idx_channel_challenges_city_status');
// Past-challenges feed (validated) per city.
run($pdo, "CREATE INDEX IF NOT EXISTS idx_channel_challenges_status      ON channel_challenges (status)", 'idx_channel_challenges_status');
// Profile filter: user's created challenges.
run($pdo, "CREATE INDEX IF NOT EXISTS idx_channel_challenges_created_by  ON channel_challenges (created_by) WHERE created_by IS NOT NULL", 'idx_channel_challenges_created_by');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_channel_challenges_guest       ON channel_challenges (guest_id)    WHERE guest_id IS NOT NULL",   'idx_channel_challenges_guest');
// Type filter (food/place/culture/help) - bounded cardinality, btree is fine.
run($pdo, "CREATE INDEX IF NOT EXISTS idx_channel_challenges_type        ON channel_challenges (challenge_type)", 'idx_channel_challenges_type');

// Participant lookups.
run($pdo, "CREATE INDEX IF NOT EXISTS idx_challenge_participants_channel ON challenge_participants (channel_id)", 'idx_challenge_participants_channel');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_challenge_participants_user    ON challenge_participants (user_id) WHERE user_id IS NOT NULL", 'idx_challenge_participants_user');

// ── Challenge redesign (PR1: model + creation) ────────────────────────────────
// The challenge is now an "ad" - a creator publishes it, multiple travelers
// (or locals, depending on audience) can take it on. Each take-on opens its
// own 1:1 thread channel (challenge_acceptances row). The persistent
// challenge_challenges row carries the ad-level config (cap + return clause).
//
// PR1 is additive only. challenge_participants stays (still used by the
// legacy pooled-acceptance flow). PR2 will migrate the acceptance flow to
// challenge_acceptances and propose a data migration for any in-flight
// challenge_participants rows.

// max_participants: cap on concurrent take-ons. Default 3, editable by creator
// in the form. NOT NULL with a default is safe - every existing row gets 3.
run($pdo, "ALTER TABLE channel_challenges ADD COLUMN IF NOT EXISTS max_participants INT NOT NULL DEFAULT 3", 'channel_challenges.max_participants');

// return_clause: the "...and come convince me" half of the prompt. Pre-filled
// per type by the client (food/place/culture/help templates), editable by the
// creator before submit. Nullable so we can shipped without backfilling old
// challenges; the read path falls back to a generic clause for nulls.
run($pdo, "ALTER TABLE channel_challenges ADD COLUMN IF NOT EXISTS return_clause TEXT", 'channel_challenges.return_clause');

// ── Acceptances - one row per (challenge, acceptor) relationship ─────────────
// Each row owns:
//   - thread_channel_id: a new channels.type='challenge_thread' channel, the
//     1:1 chat between creator + acceptor (parent_id=challenge.id)
//   - debrief_event_id  (nullable): the channels.type='event' channel auto-
//     created in phase 2 (parent_id=thread_channel_id, private to thread)
//   - phase: accepted → scheduled → debrief (derived) → approved | rejected
// UNIQUE (challenge, acceptor) enforces "one channel per relationship".
run($pdo, "
    CREATE TABLE IF NOT EXISTS challenge_acceptances (
        id                  TEXT        PRIMARY KEY,
        challenge_id        TEXT        NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
        acceptor_user_id    TEXT        NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
        thread_channel_id   TEXT        NOT NULL UNIQUE REFERENCES channels(id) ON DELETE CASCADE,
        debrief_event_id    TEXT        REFERENCES channels(id) ON DELETE SET NULL,
        phase               TEXT        NOT NULL DEFAULT 'accepted',
        approved_at         TIMESTAMPTZ,
        rejected_at         TIMESTAMPTZ,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (challenge_id, acceptor_user_id)
    )
", 'challenge_acceptances');

// Acceptor's thread list (mobile/web "my challenge threads" screen, PR2).
run($pdo, "CREATE INDEX IF NOT EXISTS idx_chacc_acceptor  ON challenge_acceptances (acceptor_user_id, created_at DESC)", 'idx_chacc_acceptor');
// Per-challenge acceptances (creator's view of who took it on + cap check).
run($pdo, "CREATE INDEX IF NOT EXISTS idx_chacc_challenge ON challenge_acceptances (challenge_id,    created_at DESC)", 'idx_chacc_challenge');

// Re-take after a finished round. The original `UNIQUE (challenge_id,
// acceptor_user_id)` table-level constraint blocked any second acceptance
// from the same user - even after both parties rated and the channel
// auto-reopened, the previous taker tapping "Take on the challenge" silently
// no-op'd (route returned the stale terminal row + INSERT would have hit
// the unique). Swap for a partial UNIQUE that fires only on ACTIVE phases,
// so historical terminal rows coexist with one fresh active row per user.
run($pdo, "ALTER TABLE challenge_acceptances DROP CONSTRAINT IF EXISTS challenge_acceptances_challenge_id_acceptor_user_id_key", 'drop strict chacc unique');
run($pdo, "CREATE UNIQUE INDEX IF NOT EXISTS uq_chacc_active_per_user
            ON challenge_acceptances (challenge_id, acceptor_user_id)
            WHERE phase NOT IN ('approved', 'rejected')", 'partial unique active acceptance per user');

// Step D rollback - challenge_thread channels are no longer auto-created on
// accept. The 1:1 private chat moved to the unified public challenge channel
// (badges distinguish roles). Existing acceptances keep their thread_channel_id
// pointing at the historical thread row; new acceptances write NULL.
// Drop NOT NULL so new INSERTs can land. The UNIQUE constraint still holds -
// Postgres treats multiple NULLs as distinct under UNIQUE.
run($pdo, "ALTER TABLE challenge_acceptances ALTER COLUMN thread_channel_id DROP NOT NULL", 'thread_channel_id nullable');

// ── Challenge redesign - PR3: date concertation ──────────────────────────────
// Either party proposes a date in the thread; the creator approves; on approve
// the server creates a debrief event (channel_events with source_type=
// 'challenge_debrief' so it stays out of public city event feeds) and sets
// phase='scheduled'. Counter-proposals overwrite the previous proposal -
// one active proposal per acceptance at a time.
run($pdo, "ALTER TABLE challenge_acceptances ADD COLUMN IF NOT EXISTS proposed_starts_at  TIMESTAMPTZ", 'challenge_acceptances.proposed_starts_at');
run($pdo, "ALTER TABLE challenge_acceptances ADD COLUMN IF NOT EXISTS proposed_ends_at    TIMESTAMPTZ", 'challenge_acceptances.proposed_ends_at');
run($pdo, "ALTER TABLE challenge_acceptances ADD COLUMN IF NOT EXISTS proposed_venue      TEXT",        'challenge_acceptances.proposed_venue');
run($pdo, "ALTER TABLE challenge_acceptances ADD COLUMN IF NOT EXISTS proposed_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL", 'challenge_acceptances.proposed_by_user_id');
run($pdo, "ALTER TABLE challenge_acceptances ADD COLUMN IF NOT EXISTS proposed_at         TIMESTAMPTZ", 'challenge_acceptances.proposed_at');
run($pdo, "ALTER TABLE challenge_acceptances ADD COLUMN IF NOT EXISTS date_approved_at    TIMESTAMPTZ", 'challenge_acceptances.date_approved_at');
// The TAKER's own rating + note for the challenge - mirror of the challenger's
// host_rating/host_comment, but per-acceptance so each taker rates their own
// take. Surfaced in the success showcase attributed to the taker.
run($pdo, "ALTER TABLE challenge_acceptances ADD COLUMN IF NOT EXISTS taker_rating  SMALLINT CHECK (taker_rating BETWEEN 1 AND 5)", 'challenge_acceptances.taker_rating');
run($pdo, "ALTER TABLE challenge_acceptances ADD COLUMN IF NOT EXISTS taker_comment TEXT", 'challenge_acceptances.taker_comment');

// ── Challenge invitations ─────────────────────────────────────────────────────
// After publishing, the creator can hand-pick city members and ping them.
// Each row = one (challenge, invitee) ping. status pending → accepted | ignored.
// Accept is just "the invitee tapped Accept on the push or in-app" - it does
// NOT bypass the regular take-on flow; it deep-links them to the challenge
// where the existing accept path runs (with same gating + pending review).
// We keep this as a separate table so we can: (a) show the creator who they
// already invited, (b) close the loop via push action buttons by invitation_id.
run($pdo, "
    CREATE TABLE IF NOT EXISTS challenge_invitations (
        id            TEXT        PRIMARY KEY,
        challenge_id  TEXT        NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
        inviter_user_id TEXT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        invitee_user_id TEXT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status        TEXT        NOT NULL DEFAULT 'pending',
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        responded_at  TIMESTAMPTZ,
        UNIQUE (challenge_id, invitee_user_id)
    )
", 'challenge_invitations');

run($pdo, "CREATE INDEX IF NOT EXISTS idx_chinv_invitee   ON challenge_invitations (invitee_user_id, created_at DESC)", 'idx_chinv_invitee');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_chinv_challenge ON challenge_invitations (challenge_id,    created_at DESC)", 'idx_chinv_challenge');

// ── Défi - International mode (PR1: schema only) ──────────────────────────────
// The existing challenge model is "Local mode" implicitly: creator + acceptor
// in the same city, ends with an IRL meetup. International mode is the growth
// engine - creator in city A challenges someone from anywhere (or a specific
// city B). No meetup; the acceptor sends visual proof (photo/video w/ geotag)
// and the creator validates from afar. Single source of truth - discriminator
// column on the existing channel_challenges table, NOT a parallel table.
//
//   mode               : 'local' (default - all existing rows) | 'international'
//   target_city_id     : nullable. For local rows: unused. For international:
//                        NULL = "anywhere" (no fan-out, origin city only);
//                        non-null = mirror into target city's feed + push.
//   proof_requirements : creator-authored text shown to the acceptor before
//                        they submit the proof. Local rows: NULL.
run($pdo, "ALTER TABLE channel_challenges ADD COLUMN IF NOT EXISTS mode               TEXT NOT NULL DEFAULT 'local'", 'channel_challenges.mode');
run($pdo, "ALTER TABLE channel_challenges ADD COLUMN IF NOT EXISTS target_city_id     TEXT REFERENCES channels(id)", 'channel_challenges.target_city_id');
run($pdo, "ALTER TABLE channel_challenges ADD COLUMN IF NOT EXISTS proof_requirements TEXT",                          'channel_challenges.proof_requirements');

// Filter queries: NOW feed sub-chip "Local | International | All" - common
// path lands on (mode, status, created_at DESC); reuse the existing city
// index for the city filter and let this one short-list mode within it.
run($pdo, "CREATE INDEX IF NOT EXISTS idx_channel_challenges_mode ON channel_challenges (mode)", 'idx_channel_challenges_mode');
// Target-city lookups (mirrored feed + reverse fan-out from city B back to
// the creator's challenge). Partial - most rows have target_city_id IS NULL.
run($pdo, "CREATE INDEX IF NOT EXISTS idx_channel_challenges_target_city ON channel_challenges (target_city_id) WHERE target_city_id IS NOT NULL", 'idx_channel_challenges_target_city');

// ── challenge_proofs - one row per submission attempt ─────────────────────────
// Acceptor submits a proof (image or short video) with mandatory geotag. The
// creator reviews + approves or rejects with a mandatory reason (1–200 chars).
// Max 3 attempts per acceptance (enforced in the route, not as a DB constraint
// - keeps the migration simple and lets us tune later).
//
//   status: 'pending' (just submitted) | 'approved' | 'rejected'
//   geotag_verified: server-side bbox check result at submit time (cached so
//                    the review UI doesn't recompute on every paint).
//   rejection_reason: NOT NULL when status='rejected'; required by the route.
run($pdo, "
    CREATE TABLE IF NOT EXISTS challenge_proofs (
        id               TEXT        PRIMARY KEY,
        acceptance_id    TEXT        NOT NULL REFERENCES challenge_acceptances(id) ON DELETE CASCADE,
        media_url        TEXT        NOT NULL,
        media_type       TEXT        NOT NULL,
        geotag_lat       DOUBLE PRECISION NOT NULL,
        geotag_lng       DOUBLE PRECISION NOT NULL,
        geotag_verified  BOOLEAN     NOT NULL DEFAULT FALSE,
        status           TEXT        NOT NULL DEFAULT 'pending',
        rejection_reason TEXT,
        submitted_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
        reviewed_at      TIMESTAMPTZ
    )
", 'challenge_proofs');

// Creator's review queue + acceptor's history per acceptance - both walk by
// acceptance_id, newest first.
run($pdo, "CREATE INDEX IF NOT EXISTS idx_chproofs_acceptance ON challenge_proofs (acceptance_id, submitted_at DESC)", 'idx_chproofs_acceptance');

// ── Per-city geotag tolerance (server-side config, env fallback) ──────────────
// 30 km default (set via env CHALLENGE_PROOF_TOLERANCE_KM at the read site).
// Per-city override for sprawling metros (Saigon, LA-style basins) - leave
// NULL for now; an admin tool / SQL update can tune individual cities later
// without a code change.
run($pdo, "ALTER TABLE cities ADD COLUMN IF NOT EXISTS proof_geotag_tolerance_km INT", 'cities.proof_geotag_tolerance_km');

// ── challenge_acceptances - phase=‘proof_submitted’ for international flow ────
// No schema change needed; phase is TEXT and the column already exists. This
// comment documents that the route layer will emit 'proof_submitted' as a
// new value (between 'pending' and 'approved'|'rejected') ONLY for
// international acceptances. Local flow keeps the existing pending→accepted
// →scheduled→debrief→approved|rejected chain.

// ── Visibility layer (Round 2: privacy/public-by-default) ────────────────────
// New axis on top of the existing mode (local/international): every challenge
// has a visibility level that gates who can read it + whether crawlers index it.
//
//   public  (default): visible to everyone, indexed by Google, surfaces in
//                      city feed + NOW + profile + sitemap.
//   friends (Local only): visible to creator + their friends; not indexed;
//                         dropped from public surfaces.
//   private (Local only, post-acceptance via MUTUAL agreement):
//                      visible to creator + acceptor only; not indexed;
//                      spectator comments hidden but preserved.
//
// International is enforced 'public' at the route layer regardless of input
// (cross-city content can't be private - defeats the model). No CHECK
// constraint on the column itself so we can flex later without a migration.
run($pdo, "ALTER TABLE channel_challenges ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'public'", 'channel_challenges.visibility');

// PR - validation method per local challenge. International is always
// 'photo_proof' (no UI choice); local creators pick at creation. The
// default keeps every existing row on the historical Meet flow; the
// backfill below locks international rows to photo_proof to match
// their UX so the column is consistent across the whole table.
run($pdo, "ALTER TABLE channel_challenges
    ADD COLUMN IF NOT EXISTS validation_method TEXT NOT NULL DEFAULT 'meet'", 'channel_challenges.validation_method');
run($pdo, "ALTER TABLE channel_challenges DROP CONSTRAINT IF EXISTS channel_challenges_validation_method_check", 'drop old validation_method check');
run($pdo, "ALTER TABLE channel_challenges
    ADD CONSTRAINT channel_challenges_validation_method_check
    CHECK (validation_method IN ('meet','photo_proof'))", 'add validation_method check');
run($pdo, "UPDATE channel_challenges SET validation_method = 'photo_proof'
    WHERE mode = 'international' AND validation_method <> 'photo_proof'", 'backfill intl → photo_proof');

// Sitemap + feed + profile queries all gate on visibility - index it.
// Composite with status covers the common path (visibility='public' AND
// status='open'); single-column is fine for the smaller branches.
run($pdo, "CREATE INDEX IF NOT EXISTS idx_channel_challenges_visibility ON channel_challenges (visibility)", 'idx_channel_challenges_visibility');

// ── First-time public opt-in flag ────────────────────────────────────────────
// Flipped to TRUE the first time the user dismisses the public-default opt-in
// modal on the create form. Persists per-user so we only educate once.
run($pdo, "ALTER TABLE users ADD COLUMN IF NOT EXISTS has_seen_public_optin BOOLEAN NOT NULL DEFAULT FALSE", 'users.has_seen_public_optin');

// ── challenge_privacy_requests (mutual go-private flow) ──────────────────────
// Local challenges flip from public → private only when BOTH the creator and
// the acceptor have agreed. Each side posts a request (one row per user
// per challenge); the route layer flips visibility=private when both rows
// reach status='agreed'.
//
//   status: 'pending' (just opened by this user, waiting for the other side)
//         | 'agreed'  (this user has confirmed)
//         | 'denied'  (this user explicitly declined; visibility stays public)
//
// UNIQUE (challenge_id, user_id) - one row per user; resubmitting the
// request updates the row rather than spawning duplicates.
run($pdo, "
    CREATE TABLE IF NOT EXISTS challenge_privacy_requests (
        id           TEXT        PRIMARY KEY,
        challenge_id TEXT        NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
        user_id      TEXT        NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
        status       TEXT        NOT NULL DEFAULT 'pending',
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (challenge_id, user_id)
    )
", 'challenge_privacy_requests');

// Walked by challenge_id (read the two rows, check both 'agreed') and by
// user_id (a user's pending privacy requests across challenges, future inbox).
run($pdo, "CREATE INDEX IF NOT EXISTS idx_chprivreq_challenge ON challenge_privacy_requests (challenge_id)", 'idx_chprivreq_challenge');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_chprivreq_user      ON challenge_privacy_requests (user_id, status)", 'idx_chprivreq_user');

// challenge_anonymized_users dropped - pseudonymous-by-default identities
// (chosen username + avatar) already serve this need. Existing levers (change
// username, leave the challenge, delete account) cover the "I want to
// disappear" use case without a separate display-mask layer. DROP is
// idempotent so production environments where the table got created get
// cleaned up on the next migrate.
run($pdo, "DROP TABLE IF EXISTS challenge_anonymized_users CASCADE", 'drop challenge_anonymized_users');

// challenge_comments dropped - Hilads channels are conversational by design,
// so splitting "spectator chatter" from "participant chat" added a layer that
// contradicts the rest of the app. Single unified message thread per
// challenge channel (existing `messages` table on the challenge's channel_id)
// is the model now; participant roles surface as render-time badges instead.
// DROP IF EXISTS keeps prod idempotent.
run($pdo, "DROP TABLE IF EXISTS challenge_comments CASCADE", 'drop challenge_comments');

// ── Participation-gated channel (new model) ──────────────────────────────────
// The challenge channel is no longer freely readable. Only joined participants
// (plus the implicit creator + active acceptor) can read or post in the
// channel. Non-participants see the SSR detail page only.
//
//   - challenge_participants.notification_preference: 'milestones' (default;
//     taker accept + proof submit + final validation), 'all' (every message),
//     'off' (silent - the user still gets read access, just no pings)
//   - channel_challenges.closed_to_new_joins: creator can freeze the
//     participant list at any point (existing participants stay; new join
//     requests refused). Per-challenge toggle, default FALSE.
//   - challenge_kicks: per-(challenge, user) ban issued by the creator OR
//     the active taker. Kicked users can't re-join until the row is removed
//     (no UI for unkicking in v1; ops-only).
run($pdo, "ALTER TABLE challenge_participants ADD COLUMN IF NOT EXISTS notification_preference TEXT NOT NULL DEFAULT 'milestones'", 'challenge_participants.notification_preference');
run($pdo, "ALTER TABLE channel_challenges     ADD COLUMN IF NOT EXISTS closed_to_new_joins     BOOLEAN NOT NULL DEFAULT FALSE",      'channel_challenges.closed_to_new_joins');

// ── GROUP CHALLENGE MODEL — Phase 1: data model only (additive, no behaviour) ──
// Migrating challenges from 1-to-1 to GROUP. The challenge_acceptances table
// already supports MULTIPLE takers (one active row per user); the only 1-to-1
// restriction is the hasActiveAcceptance app gate in /accept, untouched here and
// removed in Phase 2. `visibility` (public/friends/private) already exists. So
// this phase only adds the new challenge-level fields. NOTHING reads them yet -
// the app behaves exactly as before. All columns are nullable except the format
// flag (defaults so existing rows stay on the current flow).
//   - challenge_format: 'legacy' = current accept→date→mutual-rate flow;
//     'group' = new join→meet→challenger-validates flow. Existing + newly-created
//     rows default to 'legacy' until Phase 4 wires group creation. A Phase 5
//     force-migration converts remaining 'legacy' rows to group-of-one.
//   - meet_at / meet_ends_at: the single group meet's date/time, set at creation
//     (editable until the meet happens). NULL on legacy rows.
//   - venue / venue_lat / venue_lng: the meet location set at creation. NULL on
//     legacy rows.
run($pdo, "ALTER TABLE channel_challenges ADD COLUMN IF NOT EXISTS challenge_format TEXT NOT NULL DEFAULT 'legacy'", 'channel_challenges.challenge_format');
run($pdo, "ALTER TABLE channel_challenges ADD COLUMN IF NOT EXISTS meet_at          TIMESTAMPTZ",      'channel_challenges.meet_at');
run($pdo, "ALTER TABLE channel_challenges ADD COLUMN IF NOT EXISTS meet_ends_at     TIMESTAMPTZ",      'channel_challenges.meet_ends_at');
run($pdo, "ALTER TABLE channel_challenges ADD COLUMN IF NOT EXISTS venue            TEXT",             'channel_challenges.venue');
run($pdo, "ALTER TABLE channel_challenges ADD COLUMN IF NOT EXISTS venue_lat        DOUBLE PRECISION", 'channel_challenges.venue_lat');
run($pdo, "ALTER TABLE channel_challenges ADD COLUMN IF NOT EXISTS venue_lng        DOUBLE PRECISION", 'channel_challenges.venue_lng');
// GROUP meet: the challenger's 1-5 star rating of how the meet went, captured
// in the validate-presence sheet. Drives the showcase star for group meets
// (replaces the fabricated 5.0). Nullable - older group rows have none.
run($pdo, "ALTER TABLE channel_challenges ADD COLUMN IF NOT EXISTS host_rating      SMALLINT CHECK (host_rating BETWEEN 1 AND 5)", 'channel_challenges.host_rating');
// Optional note the challenger leaves alongside host_rating (meet: validate
// sheet; photo: the reveal modal). Surfaces as the showcase comment.
run($pdo, "ALTER TABLE channel_challenges ADD COLUMN IF NOT EXISTS host_comment     TEXT", 'channel_challenges.host_comment');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_channel_challenges_format ON channel_challenges (challenge_format)", 'idx_channel_challenges_format');

// One-time backfill: non-group (1-1) challenges whose proof was already
// approved but that were never flipped to 'validated' (the approve route used
// to update only the acceptance). They were stuck reading "Available" + a
// deadline countdown despite being over. Idempotent - the status='open' guard
// means re-runs are a no-op.
run($pdo, "
    UPDATE channel_challenges cc
    SET status = 'validated',
        validated_at = COALESCE(cc.validated_at, now()),
        updated_at   = now()
    WHERE cc.status = 'open'
      AND COALESCE(cc.challenge_format, 'legacy') <> 'group'
      AND EXISTS (
          SELECT 1 FROM challenge_acceptances ca
          WHERE ca.challenge_id = cc.channel_id AND ca.phase = 'approved'
      )
", 'backfill: validate 1-1 challenges with an approved proof');

run($pdo, "
    CREATE TABLE IF NOT EXISTS challenge_kicks (
        challenge_id      TEXT        NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
        user_id           TEXT        NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
        kicked_by_user_id TEXT        NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
        kicked_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
        reason            TEXT,
        PRIMARY KEY (challenge_id, user_id)
    )
", 'challenge_kicks');

run($pdo, "CREATE INDEX IF NOT EXISTS idx_chkick_user ON challenge_kicks (user_id)", 'idx_chkick_user');

// ── Scores + ratings - Path A (PHP/PDO, no RLS) ─────────────────────────────
// Cached score columns on users + a score_events ledger + a score_rules
// config table + a challenge_ratings table + triggers that derive points
// from the rules. Mutual ratings are the source of truth for "meetup
// happened + we debriefed it" - the trigger on challenge_ratings flips
// the active acceptance to phase='approved' on the second rating,
// replacing the legacy manual creator-approve step.
//
// All city_id columns on score_events are anchored to cc.city_id (the
// challenge's origin city) so the per-city leaderboard sums cleanly
// across accepted / meetup / debrief for the same challenge.

run($pdo, "CREATE EXTENSION IF NOT EXISTS pgcrypto", 'pgcrypto');

// Cached scores on users - driven by triggers; never written by hand.
run($pdo, "ALTER TABLE users ADD COLUMN IF NOT EXISTS score_alltime    INT  NOT NULL DEFAULT 0", 'users.score_alltime');
run($pdo, "ALTER TABLE users ADD COLUMN IF NOT EXISTS score_month      INT  NOT NULL DEFAULT 0", 'users.score_month');
run($pdo, "ALTER TABLE users ADD COLUMN IF NOT EXISTS score_month_ref  TEXT",                    'users.score_month_ref');

// Monthly rank badges on challenge cards (Top 10 + podium for Top 3).
// NULL = user is outside the relevant top-10; non-null = the user's
// position (1..10). Recomputed inline by MonthlyRankService at every
// score- or city-change route - there is no cron. Two columns because
// the badge scope follows the duel scope: local challenges read in-city
// rank, international challenges read worldwide rank. See
// src/MonthlyRankService.php for the recalc SQL.
//
// Stored in users (not score_events) because reads happen on the
// already-joined creator + acceptor rows in the Challenge DTO - no
// extra JOIN, zero egress impact on the existing list query.
run($pdo, "ALTER TABLE users ADD COLUMN IF NOT EXISTS monthly_rank_in_city   INT", 'users.monthly_rank_in_city');
run($pdo, "ALTER TABLE users ADD COLUMN IF NOT EXISTS monthly_rank_worldwide INT", 'users.monthly_rank_worldwide');
// Partial indexes - only non-null rows matter (top 10 per scope),
// which is at most a few hundred users globally. Lookup by id is the
// only access pattern at read time so we don't need a real index;
// these are mostly here to remind ops the column is sparse.
run($pdo, "CREATE INDEX IF NOT EXISTS idx_users_monthly_rank_city
    ON users (current_city_id, monthly_rank_in_city)
    WHERE monthly_rank_in_city IS NOT NULL", 'idx_users_monthly_rank_city');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_users_monthly_rank_world
    ON users (monthly_rank_worldwide)
    WHERE monthly_rank_worldwide IS NOT NULL", 'idx_users_monthly_rank_world');

// PR17 - celebration popin watermark. Stores the max score_events.created_at
// the user has already been shown in the "+X points!" popin. The endpoint
// sums points earned strictly after this watermark; the client acks by
// posting the new watermark back. Initialized to NOW() on first migration
// so existing point ledgers don't trigger a giant "+1247 points!" surprise
// on first launch after deploy.
run($pdo, "ALTER TABLE users ADD COLUMN IF NOT EXISTS score_celebrated_at TIMESTAMPTZ", 'users.score_celebrated_at');
run($pdo, "UPDATE users SET score_celebrated_at = now() WHERE score_celebrated_at IS NULL", 'users.score_celebrated_at backfill (now)');

// Intentionally NO users.city_id - current_city_id already covers it
// and a second FK would just create ambiguity. score_events.city_id is
// always cc.city_id (the challenge's anchor), not the user's location.

// Points config - single source of truth, tunable in prod via SQL UPDATE.
run($pdo, "
    CREATE TABLE IF NOT EXISTS score_rules (
        kind    TEXT NOT NULL,
        role    TEXT NOT NULL,
        points  INT  NOT NULL,
        PRIMARY KEY (kind, role)
    )
", 'score_rules');

// PR10: meetup folded into debrief (no separate user-visible signal, no
// cron for "meetup ended"). Totals at the user level are unchanged:
//   challenger 5 + 30 = 35  (was 5 + 10 + 20)
//   taker      0 + 40 = 40  (was 0 + 15 + 25)
// Existing 'meetup' rule rows are deleted; existing 'debrief' rules get
// the new combined points via ON CONFLICT DO UPDATE. Historical
// score_events of kind='meetup' from prior runs are LEFT INTACT - they
// already contribute the old 10/15 points to alltime totals, and the
// per-challenge sum is preserved.
run($pdo, "DELETE FROM score_rules WHERE kind = 'meetup'", 'score_rules drop meetup');

// PR12: date-locked points. When the creator approves the taker's proposed
// date (challenge_acceptances.date_approved_at flips NULL → set), both
// parties earn +5. Trigger below writes the score_events.
run($pdo, "
    INSERT INTO score_rules (kind, role, points) VALUES
        -- Challenge created: credited IMMEDIATELY to the creator at creation
        -- time, independent of whether anyone ever takes it, and NOT subject
        -- to the double-rating rule (the deferral is just \"don't insert the
        -- event until earned\" - inserting at creation IS the credit). Capped
        -- at the first 3 creations per user per UTC day (see
        -- on_challenge_create_award trigger below).
        ('challenge_created', 'challenger', 10),
        -- Challenge first taken: SEEDED BUT INACTIVE. No trigger emits this
        -- kind yet - it's a dormant rule we can wire up later (award the
        -- creator when their challenge gets its first take-on) by adding an
        -- emitter. Until then it credits nobody.
        ('challenge_first_taken', 'taker',   3),
        ('accepted',    'challenger',  5),
        ('accepted',    'taker',       5),
        ('date_locked', 'challenger',  5),
        ('date_locked', 'taker',       5),
        ('debrief',     'challenger', 30),
        ('debrief',     'taker',      40),
        ('ghost',       'taker',       0),
        -- Meet bonus: only fires when channel_challenges.validation_method='meet'
        -- and both ratings have landed (see on_challenge_rating_insert trigger
        -- below). Same +50 for both sides - meeting in person is the soul
        -- of Hilads and the leaderboard structure should reflect that.
        ('meet_bonus',  'challenger', 50),
        ('meet_bonus',  'taker',      50)
    ON CONFLICT (kind, role) DO UPDATE SET points = EXCLUDED.points
", 'score_rules seed');

// Append-only ledger. UNIQUE (user_id, challenge_id, role, kind) enforces
// "one event per kind per (user, challenge)" so triggers can re-fire
// safely with ON CONFLICT DO NOTHING.
run($pdo, "
    CREATE TABLE IF NOT EXISTS score_events (
        id           TEXT        PRIMARY KEY,
        user_id      TEXT        NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
        challenge_id TEXT        NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
        role         TEXT        NOT NULL CHECK (role IN ('challenger', 'taker')),
        kind         TEXT        NOT NULL CHECK (kind IN ('accepted', 'meetup', 'debrief', 'ghost', 'date_locked', 'meet_bonus', 'challenge_created', 'challenge_first_taken', 'join', 'present', 'present_host', 'present_host_base', 'submission', 'winner', 'photo_host')),
        points       INT         NOT NULL,
        city_id      TEXT        REFERENCES channels(id) ON DELETE SET NULL,
        month_ref    TEXT        NOT NULL,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (user_id, challenge_id, role, kind)
    )
", 'score_events');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_score_events_user_month ON score_events (user_id, month_ref)", 'idx_score_events_user_month');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_score_events_city_month ON score_events (city_id, month_ref)", 'idx_score_events_city_month');
// Powers the challenge-created daily cap: a bounded, single-user range scan
// (user_id, kind, today) - never reads beyond this user's challenge_created
// rows for the current UTC day. Egress-safe: the count never leaves the DB.
run($pdo, "CREATE INDEX IF NOT EXISTS idx_score_events_user_kind_date ON score_events (user_id, kind, created_at)", 'idx_score_events_user_kind_date');

// Extend the kind CHECK to allow 'date_locked' (PR12), 'meet_bonus'
// (Meet bonus PR), and 'challenge_created' / 'challenge_first_taken'
// (creation reward PR). Idempotent DROP + re-ADD updates pre-existing
// tables; new DBs inherit the latest constraint from the CREATE TABLE
// above (kept in sync with this list).
run($pdo, "ALTER TABLE score_events DROP CONSTRAINT IF EXISTS score_events_kind_check", 'score_events drop old kind check');
run($pdo, "
    ALTER TABLE score_events
    ADD CONSTRAINT score_events_kind_check
    CHECK (kind IN ('accepted', 'meetup', 'debrief', 'ghost', 'date_locked', 'meet_bonus', 'challenge_created', 'challenge_first_taken', 'join', 'present', 'present_host', 'present_host_base', 'submission', 'winner', 'photo_host'))
", 'score_events add new kind check');

// ── GROUP CHALLENGE — Phase 2: join spark (+2, immediate, once per user) ──────
// Group challenges have no request/approval and no 1:1 lock - joining = becoming
// a taker, credited a SMALL +2 the instant they join. Idempotent forever per
// (user, challenge): the partial unique below means a leave+rejoin never
// re-credits. acceptance_id is intentionally NULL on join rows (the spark is
// per-challenge, not per take-on round), so the per-ROUND unique can't dedupe it
// - this dedicated index does.
run($pdo, "INSERT INTO score_rules (kind, role, points) VALUES ('join', 'taker', 2)
            ON CONFLICT (kind, role) DO UPDATE SET points = EXCLUDED.points", 'score_rule join/taker=2');
run($pdo, "CREATE UNIQUE INDEX IF NOT EXISTS uq_score_events_join_per_user
            ON score_events (user_id, challenge_id) WHERE kind = 'join'", 'uq_score_events_join_per_user');

// Trigger: award the +2 join spark when a registered user joins a GROUP
// challenge (a challenge_acceptances row is inserted). Group-only - legacy
// challenges keep the accepted/+5 path. ON CONFLICT DO NOTHING dedupes against
// uq_score_events_join_per_user so rejoin never re-credits.
run($pdo, "
    CREATE OR REPLACE FUNCTION on_challenge_join_award() RETURNS TRIGGER AS \$\$
    DECLARE
        v_format      TEXT;
        origin_city   TEXT;
        pts           INT;
        current_month TEXT := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM');
    BEGIN
        SELECT cc.challenge_format, cc.city_id
        INTO v_format, origin_city
        FROM channel_challenges cc
        WHERE cc.channel_id = NEW.challenge_id;

        IF v_format IS DISTINCT FROM 'group' THEN RETURN NEW; END IF;
        IF NEW.acceptor_user_id IS NULL THEN RETURN NEW; END IF;

        SELECT points INTO pts FROM score_rules WHERE kind = 'join' AND role = 'taker';
        IF pts IS NULL THEN RETURN NEW; END IF;

        INSERT INTO score_events (id, user_id, challenge_id, role, kind, points, city_id, month_ref, acceptance_id)
        VALUES (encode(gen_random_bytes(8), 'hex'),
                NEW.acceptor_user_id, NEW.challenge_id, 'taker', 'join',
                pts, origin_city, current_month, NULL)
        ON CONFLICT DO NOTHING;

        RETURN NEW;
    END;
    \$\$ LANGUAGE plpgsql;
", 'fn on_challenge_join_award');
run($pdo, "DROP TRIGGER IF EXISTS trg_chacc_join_award ON challenge_acceptances", 'drop trg_chacc_join_award');
run($pdo, "
    CREATE TRIGGER trg_chacc_join_award
    AFTER INSERT ON challenge_acceptances
    FOR EACH ROW EXECUTE FUNCTION on_challenge_join_award()
", 'trg_chacc_join_award');

// ── GROUP CHALLENGE — Phase 3: presence validation rewards ───────────────────
// After the group meet, the challenger validates who was present. Each validated
// taker earns the BIG reward (+40); the challenger earns a base (+10) PLUS a
// per-head bump (+5 each), so their reward grows with the number of validated
// participants. Real merit (showing up) carries the big points - the +2 join
// spark stays small so farming joins is never worth it.
//
// NOTE (accepted risk, deferred): the challenger both validates alone AND earns
// per head, so at scale they're incentivised to inflate the present list. Fine
// for the current small/trusting base; harden later with cross-confirmation
// (taker taps "I was there" + challenger agrees). Structural, not a surprise.
run($pdo, "INSERT INTO score_rules (kind, role, points) VALUES
        ('present',           'taker',      40),
        ('present_host',      'challenger',  5),
        ('present_host_base', 'challenger', 10)
    ON CONFLICT (kind, role) DO UPDATE SET points = EXCLUDED.points", 'score_rules present/host');

// Challenger's +10 base is once per challenge (first validated head triggers it).
// acceptance_id is NULL on the base row, so the per-ROUND unique can't dedupe it -
// this dedicated index does.
run($pdo, "CREATE UNIQUE INDEX IF NOT EXISTS uq_score_events_hostbase_per_challenge
            ON score_events (challenge_id) WHERE kind = 'present_host_base'", 'uq_score_events_hostbase');

// ── PHOTO-PROOF GROUP — P1: scoring rules (data model only, dormant) ──────────
// The competitive at-a-distance mode (the international flow). Each participant
// submits a photo before the deadline (= meet_at). Then:
//   - 'submission' (+5): credited at SUBMISSION (a real photo), once per (user,
//     challenge) - so it can't be farmed by joiners who never submit.
//   - 'winner' (+40): the challenger picks the best photo; the winner earns the
//     big reward. Late participation is never penalised (the resolution delay
//     starts at the deadline, not first upload). Auto-distribution of the
//     'submission' points after a post-deadline delay (even with no designated
//     winner) is a later behaviour phase + a background job.
// Rules are added now (additive, no trigger fires them yet) so the behaviour
// phases can wire them. The +2 join spark still applies at join.
run($pdo, "INSERT INTO score_rules (kind, role, points) VALUES
        ('submission', 'taker', 5),
        ('winner',     'taker', 40),
        -- Photo-contest HOST reward, mirrors the meet host: +10 base (reuses
        -- present_host_base) + +5 per submitter ('photo_host', keyed per the
        -- submitter's acceptance_id so the challenger earns once per entrant).
        ('photo_host', 'challenger', 5)
    ON CONFLICT (kind, role) DO UPDATE SET points = EXCLUDED.points", 'score_rules submission/winner/photo_host');
// 'submission' is once per (user, challenge) - a participant who re-submits a
// better photo before the deadline isn't paid twice for participating.
run($pdo, "CREATE UNIQUE INDEX IF NOT EXISTS uq_score_events_submission_per_user
            ON score_events (user_id, challenge_id) WHERE kind = 'submission'", 'uq_score_events_submission_per_user');

// Trigger: award presence rewards when a group taker is validated (phase →
// 'present'). Per validated head: taker +40, challenger +5 (tied to THIS taker's
// acceptance for idempotency - re-validate never doubles, new heads add). Plus a
// once-per-challenge challenger +10 base. Group-only; legacy uses mutual rating.
run($pdo, "
    CREATE OR REPLACE FUNCTION on_challenge_presence_validated() RETURNS TRIGGER AS \$\$
    DECLARE
        v_format      TEXT;
        origin_city   TEXT;
        challenger    TEXT;
        pts_taker     INT;
        pts_host      INT;
        pts_base      INT;
        current_month TEXT := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM');
    BEGIN
        -- Fire only on the transition INTO 'present'.
        IF NEW.phase <> 'present' OR OLD.phase = 'present' THEN RETURN NEW; END IF;

        SELECT cc.challenge_format, cc.city_id, cc.created_by
        INTO v_format, origin_city, challenger
        FROM channel_challenges cc
        WHERE cc.channel_id = NEW.challenge_id;

        IF v_format IS DISTINCT FROM 'group' THEN RETURN NEW; END IF;
        IF NEW.acceptor_user_id IS NULL OR challenger IS NULL THEN RETURN NEW; END IF;

        -- Taker's BIG reward for validated presence.
        SELECT points INTO pts_taker FROM score_rules WHERE kind = 'present' AND role = 'taker';
        IF pts_taker IS NOT NULL THEN
            INSERT INTO score_events (id, user_id, challenge_id, role, kind, points, city_id, month_ref, acceptance_id)
            VALUES (encode(gen_random_bytes(8), 'hex'),
                    NEW.acceptor_user_id, NEW.challenge_id, 'taker', 'present',
                    pts_taker, origin_city, current_month, NEW.id)
            ON CONFLICT (user_id, challenge_id, role, kind, acceptance_id) DO NOTHING;
        END IF;

        -- Challenger: +5 for THIS validated head, keyed on the taker's
        -- acceptance so it's idempotent per head and scales with the group.
        SELECT points INTO pts_host FROM score_rules WHERE kind = 'present_host' AND role = 'challenger';
        IF pts_host IS NOT NULL THEN
            INSERT INTO score_events (id, user_id, challenge_id, role, kind, points, city_id, month_ref, acceptance_id)
            VALUES (encode(gen_random_bytes(8), 'hex'),
                    challenger, NEW.challenge_id, 'challenger', 'present_host',
                    pts_host, origin_city, current_month, NEW.id)
            ON CONFLICT (user_id, challenge_id, role, kind, acceptance_id) DO NOTHING;
        END IF;

        -- Challenger: +10 base, ONCE per challenge (deduped by the partial
        -- unique above; ON CONFLICT with no target catches it).
        SELECT points INTO pts_base FROM score_rules WHERE kind = 'present_host_base' AND role = 'challenger';
        IF pts_base IS NOT NULL THEN
            INSERT INTO score_events (id, user_id, challenge_id, role, kind, points, city_id, month_ref, acceptance_id)
            VALUES (encode(gen_random_bytes(8), 'hex'),
                    challenger, NEW.challenge_id, 'challenger', 'present_host_base',
                    pts_base, origin_city, current_month, NULL)
            ON CONFLICT DO NOTHING;
        END IF;

        RETURN NEW;
    END;
    \$\$ LANGUAGE plpgsql;
", 'fn on_challenge_presence_validated');
run($pdo, "DROP TRIGGER IF EXISTS trg_chacc_presence ON challenge_acceptances", 'drop trg_chacc_presence');
run($pdo, "
    CREATE TRIGGER trg_chacc_presence
    AFTER UPDATE OF phase ON challenge_acceptances
    FOR EACH ROW EXECUTE FUNCTION on_challenge_presence_validated()
", 'trg_chacc_presence');

// Per-round scoring. The original UNIQUE (user_id, challenge_id, role, kind)
// made each kind single-shot PER CHALLENGE, which silently dropped points
// when a user took the SAME challenge again after the channel auto-reopened
// (chacc partial-unique change above + mutual-rating reopen). Add an
// acceptance_id column + scope the UNIQUE to (user, challenge, role, kind,
// acceptance_id) so each take-on round earns independently. Historical rows
// have acceptance_id NULL and stay distinct from new rows (Postgres
// NULL-distinct semantics on composite UNIQUE), so backfill is unnecessary.
run($pdo, "ALTER TABLE score_events ADD COLUMN IF NOT EXISTS acceptance_id TEXT REFERENCES challenge_acceptances(id) ON DELETE CASCADE", 'score_events.acceptance_id');
run($pdo, "ALTER TABLE score_events DROP CONSTRAINT IF EXISTS score_events_user_id_challenge_id_role_kind_key", 'drop old score_events strict unique');
run($pdo, "CREATE UNIQUE INDEX IF NOT EXISTS uq_score_events_per_round
            ON score_events (user_id, challenge_id, role, kind, acceptance_id)", 'score_events per-round unique');

// Mutual ratings. UNIQUE (challenge_id, rater_id) → one rating per
// rater per challenge. Both parties rating is the meetup proof.
run($pdo, "
    CREATE TABLE IF NOT EXISTS challenge_ratings (
        id           TEXT        PRIMARY KEY,
        challenge_id TEXT        NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
        rater_id     TEXT        NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
        ratee_id     TEXT        NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
        rater_role   TEXT        NOT NULL CHECK (rater_role IN ('challenger', 'taker')),
        stars        INT         NOT NULL CHECK (stars BETWEEN 1 AND 5),
        comment      TEXT,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (challenge_id, rater_id)
    )
", 'challenge_ratings');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_chrate_challenge ON challenge_ratings (challenge_id)", 'idx_chrate_challenge');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_chrate_ratee     ON challenge_ratings (ratee_id)",     'idx_chrate_ratee');

// Leaderboard indexes - power the bounded rank queries on GET /me/scores.
// Without these, the global rank query scans the users table for callers
// whose rank is outside the top 100 (no full-table read past the inner
// LIMIT 101, but the cliff exists). With them, the index covers the sort.
// idx_users_current_city already exists for the city-scoped queries.
run($pdo, "
    CREATE INDEX IF NOT EXISTS users_score_alltime_desc
        ON users (score_alltime DESC) WHERE deleted_at IS NULL
", 'users_score_alltime_desc');
run($pdo, "
    CREATE INDEX IF NOT EXISTS users_score_month_desc
        ON users (score_month_ref, score_month DESC) WHERE deleted_at IS NULL
", 'users_score_month_desc');

// ── Trigger: sync cached users.score_* on every score_events INSERT ────────
run($pdo, "
    CREATE OR REPLACE FUNCTION sync_user_scores() RETURNS TRIGGER AS \$\$
    BEGIN
        UPDATE users
        SET score_alltime   = score_alltime + NEW.points,
            score_month     = CASE
                WHEN score_month_ref IS NULL OR score_month_ref <> NEW.month_ref
                    THEN NEW.points
                ELSE score_month + NEW.points
            END,
            score_month_ref = NEW.month_ref
        WHERE id = NEW.user_id;
        RETURN NEW;
    END;
    \$\$ LANGUAGE plpgsql;
", 'fn sync_user_scores');

run($pdo, "DROP TRIGGER IF EXISTS trg_score_events_sync ON score_events", 'drop trg_score_events_sync');
run($pdo, "
    CREATE TRIGGER trg_score_events_sync
    AFTER INSERT ON score_events
    FOR EACH ROW EXECUTE FUNCTION sync_user_scores()
", 'trg_score_events_sync');

// ── Trigger: accepted-points when the CREATOR approves a take-on ──────────
// PR42 - the old logic awarded the challenger +5 on EVERY acceptance
// insert, including phase='pending' (a request the creator hasn't seen
// yet). Net result: a stranger requesting your challenge bumped your
// score by 5 even though you might still REJECT them. Now the trigger
// gates on `phase NOT IN ('pending', 'rejected')` - international
// acceptances are created in phase='accepted' (auto-approved) so they
// fire on INSERT; local acceptances start 'pending' and fire on the
// UPDATE that approves them. UNIQUE (user_id, challenge_id, role, kind)
// keeps the event single-shot even if the row re-transitions later.
//
// City anchor = cc.city_id (the challenge's origin city). Matches the
// mutual-rating trigger below so all score_events for one challenge
// hit the same city bucket.
run($pdo, "
    CREATE OR REPLACE FUNCTION on_challenge_acceptance_score() RETURNS TRIGGER AS \$\$
    DECLARE
        challenger_id    TEXT;
        origin_city      TEXT;
        challenge_mode   TEXT;
        challenge_format TEXT;
        taker_city       TEXT;
        pts_c          INT;
        pts_t          INT;
        current_month  TEXT := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM');
    BEGIN
        -- Gate: only fire when the take-on has been APPROVED. Pending
        -- requests don't count (the creator may still reject); rejected
        -- rows obviously don't earn anything either.
        IF NEW.phase IN ('pending', 'rejected') THEN RETURN NEW; END IF;

        SELECT cc.created_by, cc.city_id, cc.mode, cc.challenge_format
        INTO challenger_id, origin_city, challenge_mode, challenge_format
        FROM channel_challenges cc
        WHERE cc.channel_id = NEW.challenge_id;

        IF challenger_id IS NULL THEN RETURN NEW; END IF;
        -- Group challenges DON'T use the legacy accepted/+5 path: joining
        -- credits the +2 join spark (on_challenge_join_award) and the big
        -- reward lands at validated presence (Phase 3). Skip them here.
        IF challenge_format = 'group' THEN RETURN NEW; END IF;

        -- Challenger gets the take-on-accepted reward.
        SELECT points INTO pts_c FROM score_rules WHERE kind = 'accepted' AND role = 'challenger';
        IF pts_c IS NOT NULL THEN
            INSERT INTO score_events (id, user_id, challenge_id, role, kind, points, city_id, month_ref, acceptance_id)
            VALUES (encode(gen_random_bytes(8), 'hex'),
                    challenger_id, NEW.challenge_id, 'challenger', 'accepted',
                    pts_c, origin_city, current_month, NEW.id)
            ON CONFLICT (user_id, challenge_id, role, kind, acceptance_id) DO NOTHING;
        END IF;

        -- Taker gets the SAME take-on-accepted reward (registered takers only;
        -- guest acceptances have no user_id and can't hold score). International
        -- takers earn on THEIR city's board, mirroring the date/debrief triggers.
        IF NEW.acceptor_user_id IS NOT NULL THEN
            SELECT points INTO pts_t FROM score_rules WHERE kind = 'accepted' AND role = 'taker';
            IF pts_t IS NOT NULL THEN
                IF challenge_mode = 'international' THEN
                    SELECT u.current_city_id INTO taker_city FROM users u WHERE u.id = NEW.acceptor_user_id;
                    taker_city := COALESCE(taker_city, origin_city);
                ELSE
                    taker_city := origin_city;
                END IF;
                INSERT INTO score_events (id, user_id, challenge_id, role, kind, points, city_id, month_ref, acceptance_id)
                VALUES (encode(gen_random_bytes(8), 'hex'),
                        NEW.acceptor_user_id, NEW.challenge_id, 'taker', 'accepted',
                        pts_t, taker_city, current_month, NEW.id)
                ON CONFLICT (user_id, challenge_id, role, kind, acceptance_id) DO NOTHING;
            END IF;
        END IF;

        RETURN NEW;
    END;
    \$\$ LANGUAGE plpgsql;
", 'fn on_challenge_acceptance_score');

// Drop the old INSERT-only trigger; recreate it covering INSERT OR
// UPDATE OF phase so the local approval path (pending → accepted) also
// fires it. The new function name keeps the legacy DROP guarded above.
run($pdo, "DROP TRIGGER IF EXISTS trg_chacc_accepted_score ON challenge_acceptances", 'drop trg_chacc_accepted_score (legacy)');
run($pdo, "
    CREATE TRIGGER trg_chacc_accepted_score
    AFTER INSERT OR UPDATE OF phase ON challenge_acceptances
    FOR EACH ROW EXECUTE FUNCTION on_challenge_acceptance_score()
", 'trg_chacc_accepted_score');

// PR42 cleanup: remove premature 'accepted' score_events whose
// challenges still have NO approved acceptance. Idempotent - the
// subquery returns nothing on re-run. Sync trigger only fires on
// INSERT, so we recompute the affected users' cached aggregates by
// hand after the delete.
run($pdo, "
    WITH bad AS (
        DELETE FROM score_events se
        WHERE se.kind = 'accepted'
          AND NOT EXISTS (
              SELECT 1 FROM challenge_acceptances ca
              WHERE ca.challenge_id = se.challenge_id
                AND ca.phase NOT IN ('pending', 'rejected')
          )
        RETURNING se.user_id
    )
    UPDATE users u
    SET score_alltime = COALESCE((
            SELECT SUM(points) FROM score_events WHERE user_id = u.id
        ), 0),
        score_month = COALESCE((
            SELECT SUM(points) FROM score_events
            WHERE user_id = u.id
              AND month_ref = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM')
        ), 0),
        score_month_ref = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM')
    WHERE u.id IN (SELECT DISTINCT user_id FROM bad)
", 'PR42 - clean up premature accepted score_events + resync user aggregates');

// ── Trigger: challenge-created reward (immediate, take-on-independent) ─────
//
// Fires AFTER INSERT ON channel_challenges - the moment a challenge is
// created. Credits the CREATOR +10 (score_rules.challenge_created.challenger)
// right away, regardless of whether anyone ever takes it on. This is NOT
// caught by the \"only after double-rating\" rule: that deferral is implemented
// purely by NOT inserting an event until it's earned (the sync trigger
// credits users.score_* on every score_events INSERT, unconditionally), so
// inserting here at creation time IS an immediate, exempt credit.
//
// Daily cap: only the FIRST 3 creations per user per UTC day earn points -
// the 4th+ still creates the challenge but silently earns nothing (no error,
// no user-facing block). The cap count is a bounded, single-user,
// index-backed range scan (idx_score_events_user_kind_date) on today's rows
// only, so it adds no egress and no full scan.
//
// Idempotency / never-re-award-on-edit: the trigger is INSERT-only, and a
// challenge's channel_challenges row is inserted exactly once at creation
// (edits are UPDATEs, restarts reuse acceptances - never a new row), so it
// fires exactly once per challenge. acceptance_id stays NULL (no round).
//
// Guests (created_by NULL) can't earn - skipped.
run($pdo, "
    CREATE OR REPLACE FUNCTION on_challenge_create_award() RETURNS TRIGGER AS \$\$
    DECLARE
        pts           INT;
        today_count   INT;
        current_month TEXT := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM');
    BEGIN
        IF NEW.created_by IS NULL THEN RETURN NEW; END IF;

        SELECT points INTO pts FROM score_rules
        WHERE kind = 'challenge_created' AND role = 'challenger';
        IF pts IS NULL THEN RETURN NEW; END IF;

        -- Bounded, single-user, today-only count. The AT TIME ZONE 'UTC'
        -- round-trip pins the day boundary to UTC regardless of the session
        -- timezone (a bare timestamp compared to timestamptz would otherwise
        -- be cast in the session tz).
        SELECT COUNT(*) INTO today_count
        FROM score_events
        WHERE user_id = NEW.created_by
          AND kind = 'challenge_created'
          AND created_at >= (date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC');

        IF today_count >= 3 THEN RETURN NEW; END IF;

        INSERT INTO score_events (id, user_id, challenge_id, role, kind, points, city_id, month_ref)
        VALUES (encode(gen_random_bytes(8), 'hex'),
                NEW.created_by, NEW.channel_id, 'challenger', 'challenge_created',
                pts, NEW.city_id, current_month)
        ON CONFLICT (user_id, challenge_id, role, kind, acceptance_id) DO NOTHING;

        RETURN NEW;
    END;
    \$\$ LANGUAGE plpgsql;
", 'fn on_challenge_create_award');

run($pdo, "DROP TRIGGER IF EXISTS trg_chchal_created_award ON channel_challenges", 'drop trg_chchal_created_award');
run($pdo, "
    CREATE TRIGGER trg_chchal_created_award
    AFTER INSERT ON channel_challenges
    FOR EACH ROW EXECUTE FUNCTION on_challenge_create_award()
", 'trg_chchal_created_award');

// ── PR12: date-locked points trigger ──────────────────────────────────────
// Fires when challenge_acceptances.date_approved_at flips from NULL to a
// real timestamp - i.e. the moment the creator approves the taker's date
// proposal. Writes two score_events (challenger +5, taker +5). The trigger
// re-evaluates only on UPDATE OF date_approved_at, so the rest of the
// acceptance lifecycle (proposals, withdrawals, rate-push stamps) doesn't
// re-fire it.
//
// Idempotency: the UNIQUE (user_id, challenge_id, role, kind) constraint
// on score_events + ON CONFLICT DO NOTHING means even if a date gets
// approved, withdrawn, re-proposed, and re-approved on the same
// acceptance, the points are awarded exactly once.
run($pdo, "
    CREATE OR REPLACE FUNCTION on_challenge_date_approved() RETURNS TRIGGER AS \$\$
    DECLARE
        challenger_id  TEXT;
        origin_city    TEXT;
        challenge_mode TEXT;
        taker_city     TEXT;
        pts_c          INT;
        pts_t          INT;
        current_month  TEXT := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM');
    BEGIN
        -- Only fire on the NULL → set transition. A reschedule that clears
        -- date_approved_at back to NULL (proposeDate sets it null again) and
        -- then re-approves won't double-credit because of ON CONFLICT below,
        -- but the guard here keeps us from re-entering the function body on
        -- unrelated UPDATEs.
        IF OLD.date_approved_at IS NOT NULL OR NEW.date_approved_at IS NULL THEN
            RETURN NEW;
        END IF;

        SELECT cc.created_by, cc.city_id, cc.mode
        INTO challenger_id, origin_city, challenge_mode
        FROM channel_challenges cc
        WHERE cc.channel_id = NEW.challenge_id;

        IF challenger_id IS NULL OR NEW.acceptor_user_id IS NULL THEN
            RETURN NEW;
        END IF;

        -- International challenges: taker plays from their own city, so their
        -- points belong on THEIR city's leaderboard, not the creator's. Local
        -- challenges (the default) keep both rows in origin_city - the meetup
        -- happened there, both participants are local to it.
        IF challenge_mode = 'international' THEN
            SELECT u.current_city_id INTO taker_city
            FROM users u WHERE u.id = NEW.acceptor_user_id;
            taker_city := COALESCE(taker_city, origin_city);
        ELSE
            taker_city := origin_city;
        END IF;

        SELECT points INTO pts_c FROM score_rules WHERE kind = 'date_locked' AND role = 'challenger';
        SELECT points INTO pts_t FROM score_rules WHERE kind = 'date_locked' AND role = 'taker';

        INSERT INTO score_events (id, user_id, challenge_id, role, kind, points, city_id, month_ref, acceptance_id)
        VALUES
          (encode(gen_random_bytes(8),'hex'), challenger_id,        NEW.challenge_id, 'challenger', 'date_locked', COALESCE(pts_c, 0), origin_city, current_month, NEW.id),
          (encode(gen_random_bytes(8),'hex'), NEW.acceptor_user_id, NEW.challenge_id, 'taker',      'date_locked', COALESCE(pts_t, 0), taker_city,  current_month, NEW.id)
        ON CONFLICT (user_id, challenge_id, role, kind, acceptance_id) DO NOTHING;

        RETURN NEW;
    END;
    \$\$ LANGUAGE plpgsql;
", 'fn on_challenge_date_approved');

run($pdo, "DROP TRIGGER IF EXISTS trg_chacc_date_locked ON challenge_acceptances", 'drop trg_chacc_date_locked');
run($pdo, "
    CREATE TRIGGER trg_chacc_date_locked
    AFTER UPDATE OF date_approved_at ON challenge_acceptances
    FOR EACH ROW EXECUTE FUNCTION on_challenge_date_approved()
", 'trg_chacc_date_locked');

// ── Trigger: mutual-rating → meetup + debrief + phase flip ────────────────
//
// STRICT mutual-rating model: debrief fires ONLY when BOTH parties have
// rated. If one person never rates, NEITHER earns debrief points - not
// even the one who did rate. This is intentional. The double-rating is
// a stronger meetup proof than a one-sided claim. PR10 folded the old
// 'meetup' event into 'debrief'; same totals at the user level.
//
// TODO: time-based fallback. If only one party has rated after N days,
// consider awarding partial points (reveal + award the lone rater) and
// separately flagging the no-show via the 'ghost' kind. Requires a
// scheduled job - out of scope for this migration. score_rules.ghost.taker
// is already seeded at 0 so the column exists when we wire that up.
run($pdo, "
    CREATE OR REPLACE FUNCTION on_challenge_rating_insert() RETURNS TRIGGER AS \$\$
    DECLARE
        cnt              INT;
        challenger_id    TEXT;
        taker_id         TEXT;
        v_acceptance_id  TEXT;
        origin_city      TEXT;
        challenge_mode   TEXT;
        v_method         TEXT;
        taker_city       TEXT;
        pts_debrief_c    INT;
        pts_debrief_t    INT;
        pts_meet_bonus_c INT;
        pts_meet_bonus_t INT;
        current_month    TEXT := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM');
    BEGIN
        SELECT COUNT(DISTINCT rater_id) INTO cnt
        FROM challenge_ratings
        WHERE challenge_id = NEW.challenge_id;

        IF cnt < 2 THEN RETURN NEW; END IF;

        SELECT cc.created_by, cc.city_id, cc.mode, cc.validation_method
        INTO challenger_id, origin_city, challenge_mode, v_method
        FROM channel_challenges cc
        WHERE cc.channel_id = NEW.challenge_id;

        -- Capture the active acceptance id so per-round score_events stay
        -- distinct (the user could have taken this challenge in an earlier
        -- round; ON CONFLICT key includes acceptance_id). Prefix with v_ so
        -- it doesn't collide with score_events.acceptance_id in the
        -- ON CONFLICT clause (Postgres 42702 ambiguous column otherwise).
        SELECT ca.acceptor_user_id, ca.id
        INTO taker_id, v_acceptance_id
        FROM challenge_acceptances ca
        WHERE ca.challenge_id = NEW.challenge_id
          AND ca.phase <> 'rejected'
        ORDER BY ca.created_at DESC
        LIMIT 1;

        IF challenger_id IS NULL OR taker_id IS NULL THEN RETURN NEW; END IF;

        -- International challenges: taker plays from their own city, so their
        -- points belong on THEIR city's leaderboard, not the creator's. Local
        -- challenges (the default) keep both rows in origin_city - the meetup
        -- happened there, both participants are local to it.
        IF challenge_mode = 'international' THEN
            SELECT u.current_city_id INTO taker_city
            FROM users u WHERE u.id = taker_id;
            taker_city := COALESCE(taker_city, origin_city);
        ELSE
            taker_city := origin_city;
        END IF;

        -- Base debrief points (always fire on mutual rating). PR10 folded the
        -- old 'meetup' kind into debrief; the 'meetup' value stays allowed in
        -- the score_events kind CHECK so historical rows keep validating.
        SELECT points INTO pts_debrief_c FROM score_rules WHERE kind = 'debrief' AND role = 'challenger';
        SELECT points INTO pts_debrief_t FROM score_rules WHERE kind = 'debrief' AND role = 'taker';

        INSERT INTO score_events (id, user_id, challenge_id, role, kind, points, city_id, month_ref, acceptance_id)
        VALUES
          (encode(gen_random_bytes(8),'hex'), challenger_id, NEW.challenge_id, 'challenger', 'debrief', COALESCE(pts_debrief_c, 0), origin_city, current_month, v_acceptance_id),
          (encode(gen_random_bytes(8),'hex'), taker_id,      NEW.challenge_id, 'taker',      'debrief', COALESCE(pts_debrief_t, 0), taker_city,  current_month, v_acceptance_id)
        ON CONFLICT (user_id, challenge_id, role, kind, acceptance_id) DO NOTHING;

        -- Meet bonus: only when the creator chose Meet at creation. Fires once
        -- per (user, challenge, role, kind, acceptance) round, so a re-take
        -- earns it again as long as a new acceptance row was created.
        IF COALESCE(v_method, 'meet') = 'meet' THEN
            SELECT points INTO pts_meet_bonus_c FROM score_rules WHERE kind = 'meet_bonus' AND role = 'challenger';
            SELECT points INTO pts_meet_bonus_t FROM score_rules WHERE kind = 'meet_bonus' AND role = 'taker';

            INSERT INTO score_events (id, user_id, challenge_id, role, kind, points, city_id, month_ref, acceptance_id)
            VALUES
              (encode(gen_random_bytes(8),'hex'), challenger_id, NEW.challenge_id, 'challenger', 'meet_bonus', COALESCE(pts_meet_bonus_c, 0), origin_city, current_month, v_acceptance_id),
              (encode(gen_random_bytes(8),'hex'), taker_id,      NEW.challenge_id, 'taker',      'meet_bonus', COALESCE(pts_meet_bonus_t, 0), taker_city,  current_month, v_acceptance_id)
            ON CONFLICT (user_id, challenge_id, role, kind, acceptance_id) DO NOTHING;
        END IF;

        UPDATE challenge_acceptances
        SET phase       = 'approved',
            approved_at = COALESCE(approved_at, now()),
            updated_at  = now()
        WHERE challenge_id = NEW.challenge_id
          AND phase NOT IN ('approved', 'rejected');

        RETURN NEW;
    END;
    \$\$ LANGUAGE plpgsql;
", 'fn on_challenge_rating_insert');

run($pdo, "DROP TRIGGER IF EXISTS trg_chrate_mutual_complete ON challenge_ratings", 'drop trg_chrate_mutual_complete');
run($pdo, "
    CREATE TRIGGER trg_chrate_mutual_complete
    AFTER INSERT ON challenge_ratings
    FOR EACH ROW EXECUTE FUNCTION on_challenge_rating_insert()
", 'trg_chrate_mutual_complete');

// ── Trigger: international proof approval → debrief ────────────────────────
//
// For LOCAL challenges, debrief points fire from the mutual-rating trigger
// above. International challenges have no rating step - the photo verdict
// IS the debrief signal. Without this trigger, an approved international
// proof earned ZERO debrief points (only the 'accepted' kind from
// on_challenge_acceptance_score), the score-celebration popin had nothing
// to surface, and the user got a silent verdict.
//
// Mirrors the rating trigger's shape: same +30/+40 split, same per-round
// idempotency via score_events UNIQUE (user, challenge, role, kind,
// acceptance_id), same taker-city = current_city_id fallback so the points
// land on the taker's home leaderboard rather than the challenger's.
run($pdo, "
    CREATE OR REPLACE FUNCTION on_challenge_proof_verdict() RETURNS TRIGGER AS \$\$
    DECLARE
        challenger_id    TEXT;
        origin_city      TEXT;
        challenge_mode   TEXT;
        challenge_format TEXT;
        taker_city       TEXT;
        pts_debrief_c    INT;
        pts_debrief_t    INT;
        current_month    TEXT := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM');
    BEGIN
        -- Only fire on the transition INTO 'approved'. A row already at
        -- 'approved' that gets touched (re-approval is impossible today but
        -- the guard is cheap) shouldn't re-credit.
        IF NEW.phase <> 'approved' OR OLD.phase = 'approved' THEN RETURN NEW; END IF;

        SELECT cc.created_by, cc.city_id, cc.mode, cc.challenge_format
        INTO challenger_id, origin_city, challenge_mode, challenge_format
        FROM channel_challenges cc
        WHERE cc.channel_id = NEW.challenge_id;

        -- Group photo-proof scores via submission + winner (pick-winner),
        -- NOT the legacy debrief. Skip group rows here.
        IF challenge_format = 'group' THEN RETURN NEW; END IF;

        -- LOCAL flow earns debrief from the mutual-rating trigger; double-
        -- firing here would create a duplicate row that the ON CONFLICT would
        -- silently swallow, but skipping LOCAL keeps the intent clear and
        -- avoids the extra round-trip.
        IF challenge_mode <> 'international' THEN RETURN NEW; END IF;
        IF challenger_id IS NULL OR NEW.acceptor_user_id IS NULL THEN RETURN NEW; END IF;

        SELECT u.current_city_id INTO taker_city
        FROM users u WHERE u.id = NEW.acceptor_user_id;
        taker_city := COALESCE(taker_city, origin_city);

        SELECT points INTO pts_debrief_c FROM score_rules WHERE kind = 'debrief' AND role = 'challenger';
        SELECT points INTO pts_debrief_t FROM score_rules WHERE kind = 'debrief' AND role = 'taker';

        INSERT INTO score_events (id, user_id, challenge_id, role, kind, points, city_id, month_ref, acceptance_id)
        VALUES
          (encode(gen_random_bytes(8),'hex'), challenger_id,        NEW.challenge_id, 'challenger', 'debrief', COALESCE(pts_debrief_c, 0), origin_city, current_month, NEW.id),
          (encode(gen_random_bytes(8),'hex'), NEW.acceptor_user_id, NEW.challenge_id, 'taker',      'debrief', COALESCE(pts_debrief_t, 0), taker_city,  current_month, NEW.id)
        ON CONFLICT (user_id, challenge_id, role, kind, acceptance_id) DO NOTHING;

        RETURN NEW;
    END;
    \$\$ LANGUAGE plpgsql;
", 'fn on_challenge_proof_verdict');

run($pdo, "DROP TRIGGER IF EXISTS trg_chacc_intl_debrief ON challenge_acceptances", 'drop trg_chacc_intl_debrief');
run($pdo, "
    CREATE TRIGGER trg_chacc_intl_debrief
    AFTER UPDATE OF phase ON challenge_acceptances
    FOR EACH ROW EXECUTE FUNCTION on_challenge_proof_verdict()
", 'trg_chacc_intl_debrief');

// ── PHOTO-PROOF GROUP — P2: participation reward at submission ────────────────
// A real photo submitted to a GROUP photo-proof challenge credits the submitter
// +5 'submission', ONCE per (user, challenge) - re-submitting a better photo
// before the deadline never re-pays. Group-only; legacy photo-proof keeps its
// debrief-on-verdict path. International credits the submitter's own city board.
run($pdo, "
    CREATE OR REPLACE FUNCTION on_challenge_submission_award() RETURNS TRIGGER AS \$\$
    DECLARE
        chal_id       TEXT;
        v_format      TEXT;
        v_method      TEXT;
        v_mode        TEXT;
        origin_city   TEXT;
        submitter     TEXT;
        sub_city      TEXT;
        pts           INT;
        current_month TEXT := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM');
    BEGIN
        SELECT ca.challenge_id, cc.challenge_format, cc.validation_method, cc.mode, cc.city_id, ca.acceptor_user_id
        INTO chal_id, v_format, v_method, v_mode, origin_city, submitter
        FROM challenge_acceptances ca
        JOIN channel_challenges cc ON cc.channel_id = ca.challenge_id
        WHERE ca.id = NEW.acceptance_id;

        IF v_format IS DISTINCT FROM 'group' THEN RETURN NEW; END IF;
        IF v_mode <> 'international' AND v_method <> 'photo_proof' THEN RETURN NEW; END IF;
        IF submitter IS NULL THEN RETURN NEW; END IF;

        SELECT points INTO pts FROM score_rules WHERE kind = 'submission' AND role = 'taker';
        IF pts IS NULL THEN RETURN NEW; END IF;

        IF v_mode = 'international' THEN
            SELECT u.current_city_id INTO sub_city FROM users u WHERE u.id = submitter;
            sub_city := COALESCE(sub_city, origin_city);
        ELSE
            sub_city := origin_city;
        END IF;

        INSERT INTO score_events (id, user_id, challenge_id, role, kind, points, city_id, month_ref, acceptance_id)
        VALUES (encode(gen_random_bytes(8), 'hex'),
                submitter, chal_id, 'taker', 'submission',
                pts, sub_city, current_month, NULL)
        ON CONFLICT DO NOTHING;
        RETURN NEW;
    END;
    \$\$ LANGUAGE plpgsql;
", 'fn on_challenge_submission_award');
run($pdo, "DROP TRIGGER IF EXISTS trg_chproof_submission ON challenge_proofs", 'drop trg_chproof_submission');
run($pdo, "
    CREATE TRIGGER trg_chproof_submission
    AFTER INSERT ON challenge_proofs
    FOR EACH ROW EXECUTE FUNCTION on_challenge_submission_award()
", 'trg_chproof_submission');

// ── Backfill: re-attribute international-challenge taker points to the
// taker's own city ──────────────────────────────────────────────────────────
// Before this migration, both triggers above credited the taker to the
// challenge's origin city. For international challenges that's wrong - the
// taker plays from their own city and shouldn't appear on the creator's
// city leaderboard.
//
// Idempotent: the IS DISTINCT FROM guard skips rows that already match
// the taker's current city, so re-running the migration is a no-op once
// the data is correct. Rows where the taker's current_city_id is NULL are
// left untouched (they'd otherwise drop off every leaderboard).
run($pdo, "
    UPDATE score_events se
    SET city_id = u.current_city_id
    FROM users u, channel_challenges cc
    WHERE se.user_id      = u.id
      AND se.challenge_id = cc.channel_id
      AND se.role         = 'taker'
      AND se.kind         IN ('debrief', 'date_locked')
      AND cc.mode         = 'international'
      AND u.current_city_id IS NOT NULL
      AND se.city_id IS DISTINCT FROM u.current_city_id
", 'backfill - taker score_events to taker city for international challenges');

// ── Mutual-reveal view ──────────────────────────────────────────────────────
// A challenge_ratings row is visible only when the ratee has also rated
// the same challenge. Pure projection - no auth context (this app has
// no Supabase RLS; the PHP route layer filters by viewer on top of this
// view). Kept as documentation of the rule + a guarantee that "mutual"
// is what we mean by visible. If we ever wire Supabase Auth, the same
// view gets a policy: USING (ratee_id = auth.uid()).
run($pdo, "
    CREATE OR REPLACE VIEW visible_ratings AS
    SELECT r.*
    FROM challenge_ratings r
    WHERE EXISTS (
        SELECT 1 FROM challenge_ratings r2
        WHERE r2.challenge_id = r.challenge_id
          AND r2.rater_id     = r.ratee_id
    )
", 'visible_ratings view');

// ── Self-heal monthly rank columns ────────────────────────────────────────
// The denormalised users.monthly_rank_* columns are kept fresh by
// route-level recalc hooks fired after each scoring action. If any
// score_event ever lands without firing its hook (cold migration,
// admin tool, direct SQL backfill, code path we forgot to wire), the
// column drifts and the versus-card badge goes silent for that user.
//
// Run a full recalc on every deploy as a safety net. Bounded write
// set (top-10 + currently-non-NULL rows) keeps the cost trivial even
// on the production data, and the function is idempotent - running it
// when the columns are already correct is a no-op.
require_once __DIR__ . '/src/MonthlyRankService.php';
try {
    $summary = MonthlyRankService::recalcAll();
    echo "  rank recalc: {$summary['cities']} cities + world in {$summary['total_ms']}ms\n";
} catch (\Throwable $e) {
    echo "  rank recalc: SKIPPED (" . $e->getMessage() . ")\n";
}

echo "\nDone.\n";
