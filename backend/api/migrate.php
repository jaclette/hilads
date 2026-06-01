<?php

/**
 * Hilads — Database migration script
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
// TABLES — all idempotent (CREATE TABLE IF NOT EXISTS)
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
// Idempotent — CREATE TABLE IF NOT EXISTS above won't touch an existing table.
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

// Full unique index required for ON CONFLICT (source_key) — must not be partial.
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
// re-fetch cadence (24 h on success, 1 h on failure — fields stay nullable so
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
// explicitly on the live column (idempotent — safe to re-run every deploy).
run($pdo, "ALTER TABLE notification_preferences ALTER COLUMN new_event_push SET DEFAULT TRUE", 'notification_preferences.new_event_push default→true');

// mention_push — @mention notifications. High-signal/personal → default TRUE
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

// Admin push broadcasts — one row per send action triggered from /admin/push.
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

// Hangout (internally "topic") participants — registered members in a hangout.
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

// join_request_push — notify a hangout's participants when someone asks to join.
// High-signal/social → default TRUE; backfill existing rows to TRUE (mirrors the
// new_event_push / mention_push default fix).
run($pdo, "ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS join_request_push BOOLEAN NOT NULL DEFAULT TRUE", 'notification_preferences.join_request_push');
$jrBackfill = $pdo->exec("UPDATE notification_preferences SET join_request_push = TRUE WHERE join_request_push = FALSE");
echo "  OK  backfilled join_request_push=TRUE for " . (int) $jrBackfill . " row(s)\n";

// ══════════════════════════════════════════════════════════════════════════════
// ADDITIVE COLUMNS — safe no-ops when columns already exist
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

// username — the unique @-mention handle. Case-insensitive uniqueness enforced
// at the DB level via a partial unique index on lower(username) (partial so the
// many legacy NULLs stay valid until the backfill at the end of this script
// fills them). New signups always provide one, so NULLs are legacy-only.
run($pdo, "ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT", 'users.username');
run($pdo, "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower ON users (lower(username)) WHERE username IS NOT NULL", 'idx_users_username_lower');

// messages.mentions — @mention metadata: [{userId, offset, length}] into content.
// Usernames are NOT stored (resolved to the current value on read) so renames
// reflect everywhere. Empty array for non-mention messages.
run($pdo, "ALTER TABLE messages ADD COLUMN IF NOT EXISTS mentions JSONB NOT NULL DEFAULT '[]'", 'messages.mentions');

// users — current city: single source of truth for membership + notifications.
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
// Venue geocoordinates — captured from Google Places API on seeding so we
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
// Backfill from channels.created_at — idempotent (re-run just sets the same value)
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

// messages — reply support
run($pdo, "ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to_id       TEXT REFERENCES messages(id) ON DELETE SET NULL", 'messages.reply_to_id');
run($pdo, "ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to_nickname TEXT", 'messages.reply_to_nickname');
run($pdo, "ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to_content  TEXT", 'messages.reply_to_content');
run($pdo, "ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to_type     TEXT NOT NULL DEFAULT 'text'", 'messages.reply_to_type');

// conversation_messages — reply support
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

// mobile_push_tokens
run($pdo, "ALTER TABLE mobile_push_tokens ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ NOT NULL DEFAULT now()", 'mobile_push_tokens.last_used_at');

// ══════════════════════════════════════════════════════════════════════════════
// DATA FIXES — idempotent, run once
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
// INDEXES — all idempotent (CREATE INDEX IF NOT EXISTS)
// ══════════════════════════════════════════════════════════════════════════════

echo "\n[ Indexes ]\n";

// users
run($pdo, "CREATE INDEX IF NOT EXISTS idx_users_email         ON users (lower(email))", 'idx_users_email');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_users_guest_id      ON users (guest_id) WHERE guest_id IS NOT NULL", 'idx_users_guest_id');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_users_home_city_lower ON users (LOWER(TRIM(home_city)))", 'idx_users_home_city_lower');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_users_current_city ON users (current_city_id) WHERE current_city_id IS NOT NULL", 'idx_users_current_city');

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

// channel_events — channel_id was missing; causes seq scan on every event query
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
// Compound index for city-scoped event queries — replaces the slow channels JOIN
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
// Hangouts have no address — their coordinates are the creator's location at
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

// Partial unique index — race defense. Active pairs (non-dismissed) must be unique.
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
// (no TTL — expires_at uses a 2999 sentinel to keep the existing > now() guards
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

// Participants — mirrors event_participants exactly (channel_id + guest_id PK,
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

// Main feed query: city_id + status + created_at DESC (NOW screen, top 5).
run($pdo, "CREATE INDEX IF NOT EXISTS idx_channel_challenges_city_status ON channel_challenges (city_id, status, created_at DESC)", 'idx_channel_challenges_city_status');
// Past-challenges feed (validated) per city.
run($pdo, "CREATE INDEX IF NOT EXISTS idx_channel_challenges_status      ON channel_challenges (status)", 'idx_channel_challenges_status');
// Profile filter: user's created challenges.
run($pdo, "CREATE INDEX IF NOT EXISTS idx_channel_challenges_created_by  ON channel_challenges (created_by) WHERE created_by IS NOT NULL", 'idx_channel_challenges_created_by');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_channel_challenges_guest       ON channel_challenges (guest_id)    WHERE guest_id IS NOT NULL",   'idx_channel_challenges_guest');
// Type filter (food/place/culture/help) — bounded cardinality, btree is fine.
run($pdo, "CREATE INDEX IF NOT EXISTS idx_channel_challenges_type        ON channel_challenges (challenge_type)", 'idx_channel_challenges_type');

// Participant lookups.
run($pdo, "CREATE INDEX IF NOT EXISTS idx_challenge_participants_channel ON challenge_participants (channel_id)", 'idx_challenge_participants_channel');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_challenge_participants_user    ON challenge_participants (user_id) WHERE user_id IS NOT NULL", 'idx_challenge_participants_user');

echo "\nDone.\n";
