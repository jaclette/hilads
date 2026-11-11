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

// Per-user hide of a DM conversation (removes it from that user's list only;
// reappears when a newer message arrives). See ConversationRepository::hideForUser.
run($pdo, "ALTER TABLE conversation_participants ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMPTZ", 'conversation_participants.hidden_at');

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
        audience_type   TEXT         NOT NULL CHECK (audience_type IN ('all','all_installs','city','user','test')),
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

// Scheduled push notifications: stored by the admin Push page, dispatched when
// due by /internal/run-cron. See admin/push.php + the cron block in api.php.
run($pdo, "
    CREATE TABLE IF NOT EXISTS scheduled_pushes (
        id              BIGSERIAL PRIMARY KEY,
        title           TEXT NOT NULL,
        body            TEXT NOT NULL,
        audience_type   TEXT NOT NULL,
        audience_filter JSONB NOT NULL DEFAULT '{}',
        deep_link       TEXT,
        extra_data      JSONB NOT NULL DEFAULT '{}',
        include_guests  BOOLEAN NOT NULL DEFAULT false,
        send_at         TIMESTAMPTZ NOT NULL,
        status          TEXT NOT NULL DEFAULT 'scheduled',
        created_by      TEXT,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        sent_at         TIMESTAMPTZ,
        broadcast_id    BIGINT,
        recipient_count INT,
        error           TEXT
    )
", 'scheduled_pushes');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_scheduled_pushes_due ON scheduled_pushes (send_at) WHERE status = 'scheduled'", 'idx_scheduled_pushes_due');

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
// Theme preference ('light' | 'dark'). NULL = no preference → client uses its
// default. Members store it here so it follows the account across devices;
// guests keep theirs in device storage only.
run($pdo, "ALTER TABLE users ADD COLUMN IF NOT EXISTS theme TEXT DEFAULT NULL", 'users.theme');

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
// Venue geocoordinates for schema.org GeoCoordinates in venue JSON-LD. The
// Google-seeded venues that filled them are gone (V3-02, scripts/places_migrate.php).
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
// World channel arrivals push - opt-in, default OFF. city_join stays scoped to
// the current city; this is the separate global-arrivals toggle.
run($pdo, "ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS world_arrival_push BOOLEAN NOT NULL DEFAULT FALSE", 'notification_preferences.world_arrival_push');

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

// push_broadcasts.audience_type gained 'all_installs' (the "All app installs incl.
// guests" audience) after the table's original CHECK was written, so existing DBs
// still reject it → "SQLSTATE[23514] ... push_broadcasts_audience_type_check". Widen
// the constraint idempotently to match the CREATE TABLE above.
run($pdo, "ALTER TABLE push_broadcasts DROP CONSTRAINT IF EXISTS push_broadcasts_audience_type_check", 'drop push_broadcasts audience_type check');
run($pdo, "ALTER TABLE push_broadcasts ADD CONSTRAINT push_broadcasts_audience_type_check CHECK (audience_type IN ('all','all_installs','city','user','test'))", 'push_broadcasts.audience_type +all_installs');

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

// One-time backfill: challenges that were resolved but never flipped to
// 'validated', so they were stuck reading "Available" + a deadline countdown
// despite being over. Two stuck shapes:
//   1. 1-1 (non-group): an approved proof = the taker succeeded (the approve
//      route used to update only the acceptance, not the challenge).
//   2. GROUP photo: a winner was already picked (a 'winner' score_event
//      exists) but on an older pick-winner that didn't set status. pick-winner
//      now refuses to re-run once a winner exists, so they can't self-heal.
// Idempotent - the status='open' guard means re-runs are a no-op.
run($pdo, "
    UPDATE channel_challenges cc
    SET status = 'validated',
        validated_at = COALESCE(cc.validated_at, now()),
        updated_at   = now()
    WHERE cc.status = 'open'
      AND (
          EXISTS (
              SELECT 1 FROM challenge_acceptances ca
              WHERE ca.challenge_id = cc.channel_id AND ca.phase = 'approved'
          )
          OR EXISTS (
              SELECT 1 FROM score_events se
              WHERE se.challenge_id = cc.channel_id AND se.kind = 'winner'
          )
      )
", 'backfill: validate resolved challenges (approved proof OR picked winner)');

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
        role         TEXT        NOT NULL CHECK (role IN ('challenger', 'taker', 'daily')),
        kind         TEXT        NOT NULL CHECK (kind IN ('accepted', 'meetup', 'debrief', 'ghost', 'date_locked', 'meet_bonus', 'challenge_created', 'challenge_first_taken', 'join', 'present', 'present_host', 'present_host_base', 'submission', 'winner', 'photo_host', 'daily_proof', 'daily_streak', 'daily_vote', 'daily_top1', 'daily_top2', 'daily_top3', 'daily_city_best', 'daily_twist', 'local_pass', 'proposal_selected', 'early_proof')),
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
    CHECK (kind IN ('accepted', 'meetup', 'debrief', 'ghost', 'date_locked', 'meet_bonus', 'challenge_created', 'challenge_first_taken', 'join', 'present', 'present_host', 'present_host_base', 'submission', 'winner', 'photo_host', 'daily_proof', 'daily_streak', 'daily_vote', 'daily_top1', 'daily_top2', 'daily_top3', 'daily_city_best', 'daily_twist', 'local_pass', 'proposal_selected', 'early_proof'))
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

// ── World channel + per-user read positions ───────────────────────────────
// A single global "World" companion channel (discriminator = type='world', no
// city_id) where users from every city meet - a lively fallback when a city is
// quiet. Reuses the messages table + realtime plumbing; no parallel infra.
run($pdo, "INSERT INTO channels (id, type, name, status)
           VALUES ('world', 'world', 'World', 'active')
           ON CONFLICT (id) DO NOTHING", 'seed world channel');

// Structured render data for World system messages (cross-city challenge, new-city
// user, challenge won). Reuses type='system' + event subtype; payload holds fields.
run($pdo, "ALTER TABLE messages ADD COLUMN IF NOT EXISTS payload JSONB", 'messages.payload');

// Per-(identity, channel) read cursor for symmetric city <-> World unread badges.
// identity_key = 'u:<userId>' (cross-device) | 'g:<guestId>' (device-local guest).
// Timestamp cursor (message ids are random-hex, NOT monotonic). Unread counting
// rides the existing idx_messages_channel_type_time index - no new messages index.
run($pdo, "CREATE TABLE IF NOT EXISTS channel_read_positions (
    identity_key TEXT        NOT NULL,
    channel_id   TEXT        NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    last_read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (identity_key, channel_id)
)", 'channel_read_positions');

// ── Hilads admin + double-points campaign challenges ──────────────────────
run($pdo, "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false", 'users.is_admin');
run($pdo, "ALTER TABLE channel_challenges ADD COLUMN IF NOT EXISTS is_campaign BOOLEAN NOT NULL DEFAULT false", 'channel_challenges.is_campaign');

// Seed the @hilads brand account: owns campaign challenges, shows on the
// leaderboard, never earns points (guarded below). Deterministic hex id keeps
// re-runs idempotent. Avatar can be replaced with a square PNG via /admin/users.
run($pdo, "
    INSERT INTO users (id, username, email, display_name, is_admin, is_fake, guest_id, profile_photo_url, vibe, locale, created_at, updated_at)
    VALUES (md5('hilads-admin'), 'hilads', 'admin@hilads.live', 'Hilads', true, true, md5('hilads-guest'),
            'https://hilads.live/logo/icon.svg', 'chill', 'en',
            EXTRACT(EPOCH FROM now())::INT, EXTRACT(EPOCH FROM now())::INT)
    ON CONFLICT (id) DO UPDATE SET is_admin = true, display_name = 'Hilads'
", 'seed @hilads admin account');

// One BEFORE-INSERT guard on score_events: (1) admins (@hilads) earn nothing;
// (2) campaign challenges award DOUBLE. Keeps every reward path (create / join /
// present / submission / winner) in sync without editing each award trigger fn.
run($pdo, "
    CREATE OR REPLACE FUNCTION on_score_event_adjust() RETURNS TRIGGER AS \$\$
    BEGIN
        IF EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND is_admin) THEN
            RETURN NULL;  -- admin earns nothing
        END IF;
        IF NEW.challenge_id IS NOT NULL AND EXISTS (
             SELECT 1 FROM channel_challenges WHERE channel_id = NEW.challenge_id AND is_campaign
           ) THEN
            NEW.points := NEW.points * 2;  -- campaign challenge = double points
        END IF;
        RETURN NEW;
    END;
    \$\$ LANGUAGE plpgsql;
", 'fn on_score_event_adjust');
run($pdo, "DROP TRIGGER IF EXISTS trg_score_event_adjust ON score_events", 'drop trg_score_event_adjust');
run($pdo, "
    CREATE TRIGGER trg_score_event_adjust
    BEFORE INSERT ON score_events
    FOR EACH ROW EXECUTE FUNCTION on_score_event_adjust()
", 'trg_score_event_adjust');

// ══════════════════════════════════════════════════════════════════════════════
// DAILY CHALLENGE - see docs/daily-challenge/SPEC.md section 4
// ══════════════════════════════════════════════════════════════════════════════
// One universal challenge per date. challenge_date is the UTC date of its drop:
// challenge D is live from D 02:00 UTC (DAILY_DROP_UTC) to D+1 02:00 UTC.

// Challenges, scheduled or reserve. A reserve challenge has no date until the
// drop publishes it (reserve used = is_reserve AND challenge_date IS NOT NULL).
// Content is English in V1, stored as {"en": "..."} so translations fit later.
run($pdo, "
    CREATE TABLE IF NOT EXISTS daily_challenges (
        id             TEXT        PRIMARY KEY,
        challenge_date DATE        UNIQUE,
        is_reserve     BOOLEAN     NOT NULL DEFAULT false,
        text_i18n      JSONB       NOT NULL,
        context_i18n   JSONB       NOT NULL DEFAULT '{}'::jsonb,
        status         TEXT        NOT NULL DEFAULT 'draft'
                                   CHECK (status IN ('draft', 'scheduled', 'published')),
        published_at   TIMESTAMPTZ,
        created_by     TEXT,
        updated_by     TEXT,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT daily_challenges_text_en_check
            CHECK (text_i18n->>'en' IS NOT NULL AND btrim(text_i18n->>'en') <> ''),
        CONSTRAINT daily_challenges_published_date_check
            CHECK (status <> 'published' OR challenge_date IS NOT NULL),
        CONSTRAINT daily_challenges_dated_check
            CHECK (is_reserve OR status = 'draft' OR challenge_date IS NOT NULL)
    )
", 'daily_challenges');
// Next unused reserve challenge for the drop (oldest first).
run($pdo, "CREATE INDEX IF NOT EXISTS idx_daily_challenges_reserve_unused
            ON daily_challenges (created_at)
            WHERE is_reserve AND challenge_date IS NULL AND status = 'scheduled'", 'idx_daily_challenges_reserve_unused');

// Local Twists: the city version of a challenge, shown only in live cities.
// Founder-written in V1 (status 'selected', moderation 'approved'); proposed by
// locals in V1.1. At most one selected twist per (challenge, city).
run($pdo, "
    CREATE TABLE IF NOT EXISTS daily_twists (
        id                TEXT        PRIMARY KEY,
        challenge_id      TEXT        NOT NULL REFERENCES daily_challenges(id) ON DELETE CASCADE,
        city_id           TEXT        NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
        text              TEXT        NOT NULL,
        author_user_id    TEXT        REFERENCES users(id) ON DELETE SET NULL,
        author_credit     TEXT,
        status            TEXT        NOT NULL DEFAULT 'proposed'
                                      CHECK (status IN ('proposed', 'selected', 'rejected')),
        moderation_status TEXT        NOT NULL DEFAULT 'pending'
                                      CHECK (moderation_status IN ('pending', 'approved', 'rejected')),
        created_by        TEXT,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
    )
", 'daily_twists');
run($pdo, "CREATE UNIQUE INDEX IF NOT EXISTS uq_daily_twists_selected
            ON daily_twists (challenge_id, city_id) WHERE status = 'selected'", 'uq_daily_twists_selected');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_daily_twists_challenge ON daily_twists (challenge_id)", 'idx_daily_twists_challenge');

// Local Twists proposed by locals (phase 3): proposed_at marks a proposal
// (founder twists keep it NULL). One proposal per local per challenge.
// Manual reversal: DROP INDEX uq_daily_twists_proposal; ALTER TABLE daily_twists DROP COLUMN proposed_at;
run($pdo, "ALTER TABLE daily_twists ADD COLUMN IF NOT EXISTS proposed_at TIMESTAMPTZ", 'daily_twists.proposed_at');
run($pdo, "CREATE UNIQUE INDEX IF NOT EXISTS uq_daily_twists_proposal
            ON daily_twists (challenge_id, author_user_id) WHERE proposed_at IS NOT NULL", 'uq_daily_twists_proposal');

// Hand-written translations of a twist (prompt 15): {"fr": "...", "_src": "<English at save time>"};
// daily_twists.text stays the English original.
run($pdo, "ALTER TABLE daily_twists ADD COLUMN IF NOT EXISTS text_i18n JSONB NOT NULL DEFAULT '{}'::jsonb", 'daily_twists.text_i18n');

// Proofs: one per user per challenge. city_id and is_local are set server-side
// (is_local is a snapshot taken at creation). Visible only once approved.
// Owner delete removes the row (votes, results and points cascade); an admin
// removal keeps it as 'removed' for the record, which also blocks a repost.
// vote_count / local_vote_count are maintained by the daily_votes triggers below.
run($pdo, "
    CREATE TABLE IF NOT EXISTS daily_proofs (
        id                TEXT             PRIMARY KEY,
        challenge_id      TEXT             NOT NULL REFERENCES daily_challenges(id) ON DELETE CASCADE,
        user_id           TEXT             NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        city_id           TEXT             REFERENCES channels(id) ON DELETE SET NULL,
        photo_url         TEXT             NOT NULL,
        caption           TEXT             CHECK (caption IS NULL OR char_length(caption) <= 140),
        price_amount      NUMERIC(14,2)    CHECK (price_amount IS NULL OR price_amount >= 0),
        price_currency    CHAR(3),
        place_lat         DOUBLE PRECISION,
        place_lng         DOUBLE PRECISION,
        place_name        TEXT,
        is_local          BOOLEAN          NOT NULL DEFAULT false,
        moderation_status TEXT             NOT NULL DEFAULT 'pending'
                                           CHECK (moderation_status IN ('pending', 'approved', 'rejected', 'removed')),
        rejection_reason  TEXT,
        vote_count        INT              NOT NULL DEFAULT 0,
        local_vote_count  INT              NOT NULL DEFAULT 0,
        approved_at       TIMESTAMPTZ,
        moderated_at      TIMESTAMPTZ,
        edited_at         TIMESTAMPTZ,
        created_at        TIMESTAMPTZ      NOT NULL DEFAULT now(),
        updated_at        TIMESTAMPTZ      NOT NULL DEFAULT now(),
        UNIQUE (challenge_id, user_id),
        CONSTRAINT daily_proofs_price_pair_check
            CHECK ((price_amount IS NULL) = (price_currency IS NULL)),
        CONSTRAINT daily_proofs_place_pair_check
            CHECK ((place_lat IS NULL) = (place_lng IS NULL))
    )
", 'daily_proofs');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_daily_proofs_city_approved
            ON daily_proofs (challenge_id, city_id, approved_at DESC)
            WHERE moderation_status = 'approved'", 'idx_daily_proofs_city_approved');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_daily_proofs_approved
            ON daily_proofs (challenge_id, approved_at DESC)
            WHERE moderation_status = 'approved'", 'idx_daily_proofs_approved');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_daily_proofs_pending
            ON daily_proofs (created_at)
            WHERE moderation_status = 'pending'", 'idx_daily_proofs_pending');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_daily_proofs_user ON daily_proofs (user_id, created_at DESC)", 'idx_daily_proofs_user');

// Votes (phase 2): 3 per voter per challenge, one per proof, never on one's own
// proof. The cap is structural: each vote takes one of 3 slots and the slot is
// unique per (challenge, voter), so concurrent requests can never make a 4th -
// no advisory locks needed (the pooler runs in transaction mode). Withdrawing a
// vote deletes the row and frees its slot. voter_is_local is a snapshot.
run($pdo, "
    CREATE TABLE IF NOT EXISTS daily_votes (
        id             BIGSERIAL   PRIMARY KEY,
        challenge_id   TEXT        NOT NULL REFERENCES daily_challenges(id) ON DELETE CASCADE,
        proof_id       TEXT        NOT NULL REFERENCES daily_proofs(id) ON DELETE CASCADE,
        voter_user_id  TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        voter_is_local BOOLEAN     NOT NULL DEFAULT false,
        vote_slot      SMALLINT    NOT NULL CHECK (vote_slot BETWEEN 1 AND 3),
        created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (proof_id, voter_user_id),
        UNIQUE (challenge_id, voter_user_id, vote_slot)
    )
", 'daily_votes');

// BEFORE INSERT: take challenge_id from the proof, refuse own or unapproved proofs.
run($pdo, "
    CREATE OR REPLACE FUNCTION on_daily_vote_check() RETURNS TRIGGER AS \$\$
    DECLARE
        p RECORD;
    BEGIN
        SELECT challenge_id, user_id, moderation_status INTO p
        FROM daily_proofs WHERE id = NEW.proof_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'daily_vote_proof_not_found';
        END IF;
        IF p.user_id = NEW.voter_user_id THEN
            RAISE EXCEPTION 'daily_vote_own_proof';
        END IF;
        IF p.moderation_status <> 'approved' THEN
            RAISE EXCEPTION 'daily_vote_proof_not_approved';
        END IF;
        NEW.challenge_id := p.challenge_id;
        RETURN NEW;
    END;
    \$\$ LANGUAGE plpgsql;
", 'fn on_daily_vote_check');
run($pdo, "DROP TRIGGER IF EXISTS trg_daily_vote_check ON daily_votes", 'drop trg_daily_vote_check');
run($pdo, "
    CREATE TRIGGER trg_daily_vote_check
    BEFORE INSERT ON daily_votes
    FOR EACH ROW EXECUTE FUNCTION on_daily_vote_check()
", 'trg_daily_vote_check');

// AFTER INSERT/DELETE: keep the proof's cached vote counts in step.
run($pdo, "
    CREATE OR REPLACE FUNCTION on_daily_vote_count() RETURNS TRIGGER AS \$\$
    BEGIN
        IF TG_OP = 'INSERT' THEN
            UPDATE daily_proofs
            SET vote_count       = vote_count + 1,
                local_vote_count = local_vote_count + CASE WHEN NEW.voter_is_local THEN 1 ELSE 0 END
            WHERE id = NEW.proof_id;
            RETURN NEW;
        END IF;
        UPDATE daily_proofs
        SET vote_count       = GREATEST(vote_count - 1, 0),
            local_vote_count = GREATEST(local_vote_count - CASE WHEN OLD.voter_is_local THEN 1 ELSE 0 END, 0)
        WHERE id = OLD.proof_id;
        RETURN OLD;
    END;
    \$\$ LANGUAGE plpgsql;
", 'fn on_daily_vote_count');
run($pdo, "DROP TRIGGER IF EXISTS trg_daily_vote_count ON daily_votes", 'drop trg_daily_vote_count');
run($pdo, "
    CREATE TRIGGER trg_daily_vote_count
    AFTER INSERT OR DELETE ON daily_votes
    FOR EACH ROW EXECUTE FUNCTION on_daily_vote_count()
", 'trg_daily_vote_count');

// Results (phase 2), computed at the drop that closes a challenge. scope is
// 'world' (top 3) or a city channel id (every approved proof of that city,
// ranked - rank 1 is the city's best proof). Rebuilt with delete + insert in
// one transaction, so a rerun is idempotent.
run($pdo, "
    CREATE TABLE IF NOT EXISTS daily_results (
        challenge_id     TEXT        NOT NULL REFERENCES daily_challenges(id) ON DELETE CASCADE,
        scope            TEXT        NOT NULL,
        rank             SMALLINT    NOT NULL CHECK (rank >= 1),
        proof_id         TEXT        NOT NULL REFERENCES daily_proofs(id) ON DELETE CASCADE,
        vote_count       INT         NOT NULL DEFAULT 0,
        local_vote_count INT         NOT NULL DEFAULT 0,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (challenge_id, scope, rank),
        UNIQUE (challenge_id, scope, proof_id)
    )
", 'daily_results');

// Drop run log: one row per date guarantees one drop per date. The drop claims
// the date with INSERT ... ON CONFLICT DO NOTHING; a crashed 'running' row is
// taken over after a timeout. steps records what each step did, for the logs.
run($pdo, "
    CREATE TABLE IF NOT EXISTS daily_drop_runs (
        challenge_date     DATE        PRIMARY KEY,
        status             TEXT        NOT NULL DEFAULT 'running'
                                       CHECK (status IN ('running', 'done', 'failed')),
        daily_challenge_id TEXT        REFERENCES daily_challenges(id) ON DELETE SET NULL,
        source             TEXT        CHECK (source IN ('scheduled', 'reserve', 'none')),
        steps              JSONB       NOT NULL DEFAULT '{}'::jsonb,
        attempts           INT         NOT NULL DEFAULT 1,
        error              TEXT,
        started_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
        finished_at        TIMESTAMPTZ
    )
", 'daily_drop_runs');

// Daily Challenge push log, which doubles as the deferred push queue: the drop
// queues one row per recipient with its send_at (user's local time), and the
// tick sends due rows. recipient_key = 'u:<userId>' | 'g:<guestId>' (same
// convention as channel_read_positions). The unique key prevents duplicates
// (one push of each type per recipient and challenge date).
run($pdo, "
    CREATE TABLE IF NOT EXISTS daily_push_log (
        id             BIGSERIAL   PRIMARY KEY,
        recipient_key  TEXT        NOT NULL,
        user_id        TEXT        REFERENCES users(id) ON DELETE CASCADE,
        guest_id       TEXT,
        challenge_date DATE        NOT NULL,
        type           TEXT        NOT NULL CHECK (type IN ('morning', 'reminder', 'digest')),
        send_at        TIMESTAMPTZ NOT NULL,
        status         TEXT        NOT NULL DEFAULT 'queued'
                                   CHECK (status IN ('queued', 'sending', 'sent', 'skipped', 'failed')),
        payload        JSONB       NOT NULL DEFAULT '{}'::jsonb,
        sent_at        TIMESTAMPTZ,
        error          TEXT,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (recipient_key, challenge_date, type)
    )
", 'daily_push_log');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_daily_push_log_due
            ON daily_push_log (send_at) WHERE status = 'queued'", 'idx_daily_push_log_due');

// The cap of 3 Daily pushes counts per recipient per LOCAL day (prompt 12): one
// local day can hold today's reminder and digest plus tomorrow's morning push.
// local_day = the recipient's date when the push goes out (set when queued,
// corrected when sent); timezone = the zone it was computed in. Older rows get
// their UTC send date.
run($pdo, "ALTER TABLE daily_push_log ADD COLUMN IF NOT EXISTS local_day DATE", 'daily_push_log.local_day');
run($pdo, "ALTER TABLE daily_push_log ADD COLUMN IF NOT EXISTS timezone TEXT", 'daily_push_log.timezone');
run($pdo, "UPDATE daily_push_log SET local_day = (COALESCE(sent_at, send_at) AT TIME ZONE 'UTC')::date
            WHERE local_day IS NULL", 'daily_push_log.local_day backfill');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_daily_push_log_sent_day
            ON daily_push_log (recipient_key, local_day) WHERE status = 'sent'", 'idx_daily_push_log_sent_day');

// V2-01: the "You're in today's top 10!" push. Reversal: the same constraint
// without 'top10' (after deleting the top10 rows).
// 2026-10-21: 'new_photo' (someone just played, to everyone). Reversal: the
// same constraint without it (after deleting the new_photo rows).
run($pdo, "ALTER TABLE daily_push_log DROP CONSTRAINT IF EXISTS daily_push_log_type_check", 'drop daily_push_log_type_check');
run($pdo, "ALTER TABLE daily_push_log ADD CONSTRAINT daily_push_log_type_check
            CHECK (type IN ('morning', 'reminder', 'digest', 'top10', 'proposal_approved', 'proposal_day', 'proposal_result', 'first_vote', 'new_photo'))",
    'daily_push_log_type_check');

// Content reports on proofs. user_reports allows one report per (reporter,
// user) forever, so it cannot hold per-proof reports. reason_code is checked in
// DailyModerationService. Guests can report (reporter_guest_id). Three open
// reports from different people send an approved proof back to review.
run($pdo, "
    CREATE TABLE IF NOT EXISTS daily_proof_reports (
        id                BIGSERIAL   PRIMARY KEY,
        proof_id          TEXT        NOT NULL REFERENCES daily_proofs(id) ON DELETE CASCADE,
        reporter_user_id  TEXT        REFERENCES users(id) ON DELETE CASCADE,
        reporter_guest_id TEXT,
        reason_code       TEXT        NOT NULL,
        details           TEXT,
        status            TEXT        NOT NULL DEFAULT 'open'
                                      CHECK (status IN ('open', 'reviewed', 'dismissed')),
        created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT daily_proof_reports_reporter_check
            CHECK (reporter_user_id IS NOT NULL OR reporter_guest_id IS NOT NULL)
    )
", 'daily_proof_reports');
run($pdo, "CREATE UNIQUE INDEX IF NOT EXISTS uq_daily_proof_reports_reporter
            ON daily_proof_reports (proof_id, COALESCE(reporter_user_id, '@g:' || reporter_guest_id))", 'uq_daily_proof_reports_reporter');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_daily_proof_reports_open
            ON daily_proof_reports (proof_id) WHERE status = 'open'", 'idx_daily_proof_reports_open');

// DB-backed rate limits (DbRateLimiter): the APCu limiter fails open on Render.
// bucket_key is a sha256 of the limit key. Purged by POST /internal/cleanup.
run($pdo, "
    CREATE TABLE IF NOT EXISTS rate_limit_buckets (
        bucket_key   TEXT        PRIMARY KEY,
        window_start TIMESTAMPTZ NOT NULL DEFAULT now(),
        hits         INT         NOT NULL DEFAULT 1
    )
", 'rate_limit_buckets');

// Back office audit log: who changed what. The back office has one shared
// env-based login, so admin_username + admin_ip is the identity (as in
// push_broadcasts).
run($pdo, "
    CREATE TABLE IF NOT EXISTS admin_audit_log (
        id             BIGSERIAL   PRIMARY KEY,
        admin_username TEXT        NOT NULL,
        admin_ip       INET,
        action         TEXT        NOT NULL,
        entity_type    TEXT,
        entity_id      TEXT,
        before         JSONB,
        after          JSONB,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    )
", 'admin_audit_log');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_admin_audit_log_entity
            ON admin_audit_log (entity_type, entity_id, created_at DESC)", 'idx_admin_audit_log_entity');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_admin_audit_log_time ON admin_audit_log (created_at DESC)", 'idx_admin_audit_log_time');

// Opt-out for every Daily Challenge push (morning, reminder, digest). On by default.
run($pdo, "ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS daily_challenge_push BOOLEAN NOT NULL DEFAULT TRUE", 'notification_preferences.daily_challenge_push');

// Timezones: the device's IANA timezone, sent by the app at each launch.
// Guest devices have no users row, so theirs lives on the push token.
// Fallback is cities.timezone of current_city_id.
run($pdo, "ALTER TABLE users ADD COLUMN IF NOT EXISTS timezone TEXT", 'users.timezone');
run($pdo, "ALTER TABLE mobile_push_tokens ADD COLUMN IF NOT EXISTS timezone TEXT", 'mobile_push_tokens.timezone');
// The device's app language (one of the 19 locales), for guests' Daily pushes (prompt 15);
// registered users keep theirs on users.locale.
run($pdo, "ALTER TABLE mobile_push_tokens ADD COLUMN IF NOT EXISTS locale TEXT", 'mobile_push_tokens.locale');
// V2-07 fix: the Android notification channel the app declared it created for
// Daily pushes (POST /daily/device, dailyChannel). Android drops a push sent to a
// channel the phone doesn't have, so only these Android devices get the Daily
// channel and its signature sound; others keep the default channel.
// Reversal: ALTER TABLE mobile_push_tokens DROP COLUMN daily_channel;
run($pdo, "ALTER TABLE mobile_push_tokens ADD COLUMN IF NOT EXISTS daily_channel TEXT", 'mobile_push_tokens.daily_channel');

// users.mode ('local' | 'exploring', self-declared) exists in production but was
// never in this file. No-op there; makes a fresh database match.
run($pdo, "ALTER TABLE users ADD COLUMN IF NOT EXISTS mode TEXT", 'users.mode');

// Admin switch that forces a city live. Not seeded: Saigon is switched on from
// the back office, so a rerun never overrides the admin's choice.
run($pdo, "ALTER TABLE cities ADD COLUMN IF NOT EXISTS force_live BOOLEAN NOT NULL DEFAULT false", 'cities.force_live');

// Channel cards are messages with type='system', event='daily_challenge' |
// 'daily_proof' and a JSON payload (the World card pattern). These unique
// indexes make posting a card idempotent per channel. CONCURRENTLY so the build
// never blocks writes on messages (run() uses autocommit, which it needs).
run($pdo, "CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_messages_daily_challenge
            ON messages (channel_id, (payload->>'challengeId'))
            WHERE event = 'daily_challenge'", 'uq_messages_daily_challenge');
run($pdo, "CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_messages_daily_proof
            ON messages (channel_id, (payload->>'proofId'))
            WHERE event = 'daily_proof'", 'uq_messages_daily_proof');
// V2-08: one flood-control group card per (channel, clock hour).
run($pdo, "CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_messages_daily_proof_group
            ON messages (channel_id, (payload->>'hour'))
            WHERE event = 'daily_proof_group'", 'uq_messages_daily_proof_group');

// score_events for the Daily Challenge (phase 2). Daily points have no
// challenge channel, so challenge_id becomes nullable and daily_* columns
// reference what earned them (deleting a proof or twist cascades its points).
// Role 'daily' and the daily_* kinds are in the CHECKs above.
run($pdo, "ALTER TABLE score_events ALTER COLUMN challenge_id DROP NOT NULL", 'score_events.challenge_id nullable');
run($pdo, "ALTER TABLE score_events ADD COLUMN IF NOT EXISTS daily_challenge_id TEXT REFERENCES daily_challenges(id) ON DELETE CASCADE", 'score_events.daily_challenge_id');
run($pdo, "ALTER TABLE score_events ADD COLUMN IF NOT EXISTS daily_proof_id TEXT REFERENCES daily_proofs(id) ON DELETE CASCADE", 'score_events.daily_proof_id');
run($pdo, "ALTER TABLE score_events ADD COLUMN IF NOT EXISTS daily_twist_id TEXT REFERENCES daily_twists(id) ON DELETE CASCADE", 'score_events.daily_twist_id');
run($pdo, "ALTER TABLE score_events DROP CONSTRAINT IF EXISTS score_events_role_check", 'score_events drop old role check');
run($pdo, "ALTER TABLE score_events ADD CONSTRAINT score_events_role_check
            CHECK (role IN ('challenger', 'taker', 'daily'))", 'score_events add role check');
run($pdo, "ALTER TABLE score_events DROP CONSTRAINT IF EXISTS score_events_source_check", 'score_events drop old source check');
run($pdo, "ALTER TABLE score_events ADD CONSTRAINT score_events_source_check
            CHECK (challenge_id IS NOT NULL OR daily_challenge_id IS NOT NULL)", 'score_events add source check');
// Each Daily award at most once per (user, challenge, kind), even on reruns.
run($pdo, "CREATE UNIQUE INDEX IF NOT EXISTS uq_score_events_daily
            ON score_events (user_id, daily_challenge_id, kind)
            WHERE daily_challenge_id IS NOT NULL", 'uq_score_events_daily');

// Reversal: trg_score_events_sync only adds on INSERT, so deleting a Daily row
// takes its points back off the cached totals. Daily rows only - existing kinds
// keep their behaviour (admin/scores_reset.php deletes first, then zeroes).
run($pdo, "
    CREATE OR REPLACE FUNCTION on_score_event_daily_reverse() RETURNS TRIGGER AS \$\$
    BEGIN
        UPDATE users
        SET score_alltime = score_alltime - OLD.points,
            score_month   = CASE
                WHEN score_month_ref = OLD.month_ref THEN score_month - OLD.points
                ELSE score_month
            END
        WHERE id = OLD.user_id;
        RETURN OLD;
    END;
    \$\$ LANGUAGE plpgsql;
", 'fn on_score_event_daily_reverse');
run($pdo, "DROP TRIGGER IF EXISTS trg_score_event_daily_reverse ON score_events", 'drop trg_score_event_daily_reverse');
run($pdo, "
    CREATE TRIGGER trg_score_event_daily_reverse
    AFTER DELETE ON score_events
    FOR EACH ROW WHEN (OLD.daily_challenge_id IS NOT NULL)
    EXECUTE FUNCTION on_score_event_daily_reverse()
", 'trg_score_event_daily_reverse');

// Daily point values (SPEC section 3.8, indicative). DO NOTHING, not DO UPDATE:
// values tuned in production by SQL survive reruns. The streak bonus is per
// consecutive day; its +20 cap is applied in code.
run($pdo, "
    INSERT INTO score_rules (kind, role, points) VALUES
        ('daily_proof',     'daily', 10),
        ('daily_streak',    'daily',  2),
        ('daily_vote',      'daily',  2),
        ('daily_top1',      'daily', 30),
        ('daily_top2',      'daily', 20),
        ('daily_top3',      'daily', 10),
        ('daily_city_best', 'daily', 15),
        ('daily_twist',     'daily', 15)
    ON CONFLICT (kind, role) DO NOTHING
", 'score_rules daily seed');

// V2-03: weekly themes and the Local Pass (SPEC 8.2, 8.3).
// theme = a DailyThemes key. Dated challenges get the theme of their weekday
// (Monday language ... Sunday traditions, ISO day of week - same table as
// DailyThemes::THEMES); undated reserves get one when the drop publishes them.
// Reversal: DROP TABLE daily_local_passes; ALTER TABLE daily_challenges DROP COLUMN theme;
// DELETE FROM score_events WHERE kind = 'local_pass'; DELETE FROM score_rules WHERE kind = 'local_pass';
run($pdo, "ALTER TABLE daily_challenges ADD COLUMN IF NOT EXISTS theme TEXT", 'daily_challenges.theme');
run($pdo, "
    UPDATE daily_challenges SET theme = CASE extract(isodow FROM challenge_date)::int
        WHEN 1 THEN 'language' WHEN 2 THEN 'street_food' WHEN 3 THEN 'coffee' WHEN 4 THEN 'market'
        WHEN 5 THEN 'night_out' WHEN 6 THEN 'neighborhood' ELSE 'traditions' END
    WHERE theme IS NULL AND challenge_date IS NOT NULL
", 'daily_challenges.theme backfill');

// One Local Pass per (user, city), earned once with an approved proof in all 7
// themes there; never taken back. daily_challenge_id = the challenge whose
// proof completed it (its score_events row hangs on it, not on the proof).
run($pdo, "
    CREATE TABLE IF NOT EXISTS daily_local_passes (
        user_id            TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        city_id            TEXT        NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
        daily_challenge_id TEXT        REFERENCES daily_challenges(id) ON DELETE SET NULL,
        earned_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, city_id)
    )
", 'daily_local_passes');
run($pdo, "INSERT INTO score_rules (kind, role, points) VALUES ('local_pass', 'daily', 50)
            ON CONFLICT (kind, role) DO NOTHING", 'score_rules local_pass');

// V2-05: challenge proposals (SPEC 8.6). Anyone registered proposes a Daily
// Challenge (English, 120 chars, a theme, a short why, an optional Local Twist
// for their city when they are a local of a live city); the founder approves it
// from the back office inbox (dated or to the reserve) or rejects it with a
// reason. Twist proposals for tomorrow stay in daily_twists (prompt 14).
// At most one pending proposal per user (DailyProposals::MAX_PENDING).
// Reversal: DROP TABLE daily_proposals, daily_rejection_templates;
// ALTER TABLE daily_challenges DROP COLUMN proposed_by_user_id; ALTER TABLE daily_twists DROP COLUMN rejection_reason;
run($pdo, "
    CREATE TABLE IF NOT EXISTS daily_proposals (
        id                   TEXT        PRIMARY KEY,
        user_id              TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        city_id              TEXT        REFERENCES channels(id) ON DELETE SET NULL,
        text                 TEXT        NOT NULL,
        why                  TEXT,
        theme                TEXT        NOT NULL,
        twist_text           TEXT,
        status               TEXT        NOT NULL DEFAULT 'pending'
                                         CHECK (status IN ('pending', 'approved', 'rejected')),
        rejection_reason     TEXT,
        created_challenge_id TEXT        REFERENCES daily_challenges(id) ON DELETE SET NULL,
        moderation_status    TEXT        NOT NULL DEFAULT 'pending'
                                         CHECK (moderation_status IN ('pending', 'approved', 'rejected')),
        reviewed_at          TIMESTAMPTZ,
        created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
    )
", 'daily_proposals');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_daily_proposals_user ON daily_proposals (user_id, created_at DESC)", 'idx_daily_proposals_user');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_daily_proposals_pending ON daily_proposals (created_at) WHERE status = 'pending'", 'idx_daily_proposals_pending');
run($pdo, "CREATE UNIQUE INDEX IF NOT EXISTS uq_daily_proposals_challenge ON daily_proposals (created_challenge_id)
            WHERE created_challenge_id IS NOT NULL", 'uq_daily_proposals_challenge');
run($pdo, "ALTER TABLE daily_challenges ADD COLUMN IF NOT EXISTS proposed_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL",
    'daily_challenges.proposed_by_user_id');
run($pdo, "ALTER TABLE daily_twists ADD COLUMN IF NOT EXISTS rejection_reason TEXT", 'daily_twists.rejection_reason');

// Rejection reasons the founder picks from (editable in the inbox).
run($pdo, "
    CREATE TABLE IF NOT EXISTS daily_rejection_templates (
        id         BIGSERIAL   PRIMARY KEY,
        text       TEXT        NOT NULL,
        position   INT         NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
", 'daily_rejection_templates');
run($pdo, "
    INSERT INTO daily_rejection_templates (text, position)
    SELECT v.text, v.position FROM (VALUES
        ('Too close to a challenge we already have.', 1),
        ('Not doable in most cities.', 2),
        ('It has to be safe and legal everywhere.', 3),
        ('Please write it in English, as one short sentence.', 4)
    ) AS v(text, position)
    WHERE NOT EXISTS (SELECT 1 FROM daily_rejection_templates)
", 'daily_rejection_templates seed');
run($pdo, "INSERT INTO score_rules (kind, role, points) VALUES ('proposal_selected', 'daily', 25)
            ON CONFLICT (kind, role) DO NOTHING", 'score_rules proposal_selected');

// V2-07: speed bonus (SPEC 8.5). A proof posted within 3 hours of the user's
// start time (the morning push rule: the drop if it is 09:00-21:00 local, else
// 09:00 local) is early: set when first posted, never changed by an edit. Its
// bonus (early_proof, proof-linked like the proof points) is awarded at approval.
// Reversal: ALTER TABLE daily_proofs DROP COLUMN is_early;
// DELETE FROM score_events WHERE kind = 'early_proof'; DELETE FROM score_rules WHERE kind = 'early_proof';
run($pdo, "ALTER TABLE daily_proofs ADD COLUMN IF NOT EXISTS is_early BOOLEAN NOT NULL DEFAULT false", 'daily_proofs.is_early');
run($pdo, "INSERT INTO score_rules (kind, role, points) VALUES ('early_proof', 'daily', 5)
            ON CONFLICT (kind, role) DO NOTHING", 'score_rules early_proof');

// V3-02: Hilads places (SPEC 9.4 / 9.12). Our own places, no third-party
// places API: the first proof at a location creates the place (a name typed by
// the user + the device position, moderated); a place with an approved proof
// is a spot. A proof keeps only its distance to the place (distance_m).
// Reversal: ALTER TABLE daily_proofs DROP COLUMN place_id, DROP COLUMN distance_m;
// DROP TABLE place_tags; DROP TABLE places;
run($pdo, "
    CREATE TABLE IF NOT EXISTS places (
        id          TEXT             PRIMARY KEY,
        city_id     TEXT             REFERENCES channels(id) ON DELETE SET NULL,
        name        TEXT             NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
        lat         DOUBLE PRECISION NOT NULL CHECK (lat BETWEEN -90 AND 90),
        lng         DOUBLE PRECISION NOT NULL CHECK (lng BETWEEN -180 AND 180),
        created_by  TEXT             REFERENCES users(id) ON DELETE SET NULL,
        status      TEXT             NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
        hidden      BOOLEAN          NOT NULL DEFAULT false,
        merged_into TEXT             REFERENCES places(id) ON DELETE SET NULL,
        created_at  TIMESTAMPTZ      NOT NULL DEFAULT now(),
        updated_at  TIMESTAMPTZ      NOT NULL DEFAULT now()
    )
", 'places');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_places_geo ON places (lat, lng) WHERE merged_into IS NULL", 'idx_places_geo');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_places_city ON places (city_id, status)", 'idx_places_city');
run($pdo, "
    CREATE TABLE IF NOT EXISTS place_tags (
        place_id   TEXT        NOT NULL REFERENCES places(id) ON DELETE CASCADE,
        tag        TEXT        NOT NULL CHECK (char_length(tag) BETWEEN 1 AND 60),
        source     TEXT        NOT NULL DEFAULT 'admin' CHECK (source IN ('admin', 'twist')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (place_id, tag)
    )
", 'place_tags');
run($pdo, "ALTER TABLE daily_proofs ADD COLUMN IF NOT EXISTS place_id TEXT REFERENCES places(id) ON DELETE SET NULL", 'daily_proofs.place_id');
run($pdo, "ALTER TABLE daily_proofs ADD COLUMN IF NOT EXISTS distance_m INT CHECK (distance_m >= 0)", 'daily_proofs.distance_m');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_daily_proofs_place ON daily_proofs (place_id) WHERE place_id IS NOT NULL", 'idx_daily_proofs_place');

// V3-03: dish tags of a Local Twist ("cơm tấm, sườn"), set in the back office.
// The spots posted on that day in that city show them (Spots::tagsOf).
// Reversal: ALTER TABLE daily_twists DROP COLUMN dish_tags;
run($pdo, "ALTER TABLE daily_twists ADD COLUMN IF NOT EXISTS dish_tags TEXT", 'daily_twists.dish_tags');

// V3-04: weekly Most Local (SPEC 9.8). counts_weekly marks the score kinds of
// the weekly ranking (the Daily Challenge kinds); change the list with SQL, no
// code change. Seeded once: a later manual change is never overwritten.
// hidden_from_rankings leaves an account out of every ranking (set for the
// admin @hilads account, seeded once too).
// Reversal: ALTER TABLE score_rules DROP COLUMN counts_weekly;
// ALTER TABLE users DROP COLUMN hidden_from_rankings;
// V3-05: seed spots. The founder seeds spots from the back office with real,
// approved proofs (is_seed) attached to a hidden per-theme 'seed' challenge
// (no date, never published): they count for the spot, not for the game
// (no points, cards, stamps, gallery). One proof per user per challenge does
// not apply to seeds.
// Reversal: DELETE FROM daily_proofs WHERE is_seed; DELETE FROM daily_challenges WHERE status = 'seed';
// then restore the two checks and UNIQUE (challenge_id, user_id), and drop is_seed.
run($pdo, "ALTER TABLE daily_proofs ADD COLUMN IF NOT EXISTS is_seed BOOLEAN NOT NULL DEFAULT false", 'daily_proofs.is_seed');
// Replaced by uq_daily_proofs_challenge_user_v2 (Hilads suggestions, below): not re-created once that exists.
run($pdo, "
    DO \$\$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'uq_daily_proofs_challenge_user_v2') THEN
            CREATE UNIQUE INDEX IF NOT EXISTS uq_daily_proofs_challenge_user ON daily_proofs (challenge_id, user_id) WHERE NOT is_seed;
        END IF;
    END \$\$
", 'uq_daily_proofs_challenge_user');
run($pdo, "ALTER TABLE daily_proofs DROP CONSTRAINT IF EXISTS daily_proofs_challenge_id_user_id_key", 'daily_proofs unique -> partial');
run($pdo, "ALTER TABLE daily_challenges DROP CONSTRAINT IF EXISTS daily_challenges_status_check", 'daily_challenges status check drop');
run($pdo, "ALTER TABLE daily_challenges ADD CONSTRAINT daily_challenges_status_check
            CHECK (status IN ('draft', 'scheduled', 'published', 'seed'))", 'daily_challenges status check + seed');
run($pdo, "ALTER TABLE daily_challenges DROP CONSTRAINT IF EXISTS daily_challenges_dated_check", 'daily_challenges dated check drop');
run($pdo, "ALTER TABLE daily_challenges ADD CONSTRAINT daily_challenges_dated_check
            CHECK (is_reserve OR status IN ('draft', 'seed') OR challenge_date IS NOT NULL)", 'daily_challenges dated check + seed');

run($pdo, "ALTER TABLE score_rules ADD COLUMN IF NOT EXISTS counts_weekly BOOLEAN NOT NULL DEFAULT false", 'score_rules.counts_weekly');
run($pdo, "
    UPDATE score_rules SET counts_weekly = true
    WHERE role = 'daily'
      AND kind IN ('daily_proof', 'daily_streak', 'early_proof', 'daily_vote', 'daily_top1', 'daily_top2',
                   'daily_top3', 'daily_city_best', 'daily_twist', 'proposal_selected', 'local_pass')
      AND NOT EXISTS (SELECT 1 FROM score_rules WHERE counts_weekly)
", 'score_rules.counts_weekly seed');
run($pdo, "ALTER TABLE users ADD COLUMN IF NOT EXISTS hidden_from_rankings BOOLEAN NOT NULL DEFAULT false", 'users.hidden_from_rankings');
run($pdo, "
    UPDATE users SET hidden_from_rankings = true
    WHERE is_admin AND NOT EXISTS (SELECT 1 FROM users WHERE hidden_from_rankings)
", 'users.hidden_from_rankings seed');

// ── Daily Challenge demo content (scripts/daily_demo.php) ─────────────────
// Demo accounts, their proofs and the spots they create carry is_demo: they
// show in the app for testing, never earn anything, and DailyDemo::cleanup()
// deletes them (by hand, or at the start of the next drop).
// Reversal: run the cleanup, then drop the three columns.
run($pdo, "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false", 'users.is_demo');
run($pdo, "ALTER TABLE daily_proofs ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false", 'daily_proofs.is_demo');
run($pdo, "ALTER TABLE places ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false", 'places.is_demo');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_users_demo ON users (id) WHERE is_demo", 'idx_users_demo');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_daily_proofs_demo ON daily_proofs (id) WHERE is_demo", 'idx_daily_proofs_demo');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_places_demo ON places (id) WHERE is_demo", 'idx_places_demo');

// The Daily Challenge card's cover image (SPEC 9.3): uploaded in the back
// office for one challenge; NULL = the theme's default image (bundled in the apps).
run($pdo, "ALTER TABLE daily_challenges ADD COLUMN IF NOT EXISTS cover_url TEXT", 'daily_challenges.cover_url');

// Themes v2 (SPEC 3, 8.2, 9.15, 2026-10-19): the 7 weekly themes are renamed
// and redefined (DailyThemes::LEGACY). Stored keys move with their theme, so
// stamps and Local Pass progress (computed from the challenges' themes) move
// too. "special" = a special day of world scope (daily_specials, special_id).
// daily_theme_covers: a theme's default cover uploaded in the back office
// (no row = the image bundled in the apps).
// Reversal: run the CASE below the other way round; DROP TABLE daily_theme_covers;
// ALTER TABLE daily_challenges DROP COLUMN special_id; DROP TABLE daily_specials.
foreach (['daily_challenges', 'daily_proposals'] as $t) {
    run($pdo, "
        UPDATE {$t} SET theme = CASE theme
            WHEN 'neighborhood' THEN 'hidden_gem' WHEN 'street_food' THEN 'taste' WHEN 'language' THEN 'join_in'
            WHEN 'market' THEN 'local_find' WHEN 'coffee' THEN 'sip' WHEN 'traditions' THEN 'only_here' END
        WHERE theme IN ('neighborhood', 'street_food', 'language', 'market', 'coffee', 'traditions')
    ", "{$t}.theme v2");
}
run($pdo, "
    UPDATE daily_challenges SET text_i18n = jsonb_build_object('en', 'Seed spots: ' || CASE theme
        WHEN 'hidden_gem' THEN 'Hidden gem' WHEN 'taste' THEN 'Taste' WHEN 'ask_local' THEN 'Ask a local' WHEN 'join_in' THEN 'Join in'
        WHEN 'local_find' THEN 'Local find' WHEN 'night_out' THEN 'Night out' WHEN 'sip' THEN 'Sip' ELSE 'Only here' END)
    WHERE status = 'seed' AND text_i18n->>'en' LIKE 'Seed spots: %'
", 'seed challenges theme names v2');
run($pdo, "
    CREATE TABLE IF NOT EXISTS daily_specials (
        id         TEXT        PRIMARY KEY,
        date       DATE        NOT NULL,
        name_i18n  JSONB       NOT NULL DEFAULT '{}'::jsonb,
        emoji      TEXT,
        icon       TEXT,
        cover_url  TEXT,
        scope      TEXT        NOT NULL DEFAULT 'world' CHECK (scope IN ('world', 'country', 'city')),
        country    TEXT,
        city_id    TEXT        REFERENCES channels(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
", 'daily_specials');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_daily_specials_date ON daily_specials (date)", 'idx_daily_specials_date');
run($pdo, "ALTER TABLE daily_challenges ADD COLUMN IF NOT EXISTS special_id TEXT REFERENCES daily_specials(id) ON DELETE SET NULL",
    'daily_challenges.special_id');
run($pdo, "
    CREATE TABLE IF NOT EXISTS daily_theme_covers (
        theme      TEXT        PRIMARY KEY,
        cover_url  TEXT        NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
", 'daily_theme_covers');

// Represent your city (SPEC 9.16): the Pioneer of a city = the author of its
// first approved proof ever (badge only, no points, permanent: a deleted
// account keeps the city claimed). Backfilled from history, real players only
// (no demo or seed proof, no demo or hidden_from_rankings account).
// Reversal: DROP TABLE daily_pioneers.
run($pdo, "
    CREATE TABLE IF NOT EXISTS daily_pioneers (
        city_id    TEXT        PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE,
        user_id    TEXT        REFERENCES users(id) ON DELETE SET NULL,
        proof_id   TEXT        REFERENCES daily_proofs(id) ON DELETE SET NULL,
        awarded_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
", 'daily_pioneers');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_daily_pioneers_user ON daily_pioneers (user_id)", 'idx_daily_pioneers_user');
run($pdo, "
    INSERT INTO daily_pioneers (city_id, user_id, proof_id, awarded_at)
    SELECT DISTINCT ON (p.city_id) p.city_id, p.user_id, p.id, COALESCE(p.approved_at, p.created_at)
    FROM daily_proofs p
    JOIN users u ON u.id = p.user_id
    WHERE p.city_id IS NOT NULL AND p.moderation_status = 'approved'
      AND NOT p.is_seed AND NOT p.is_demo AND NOT u.is_demo AND NOT u.hidden_from_rankings
    ORDER BY p.city_id, COALESCE(p.approved_at, p.created_at), p.id
    ON CONFLICT (city_id) DO NOTHING
", 'daily_pioneers backfill');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_daily_proofs_city_approved ON daily_proofs (city_id, challenge_id) WHERE moderation_status = 'approved'",
    'idx_daily_proofs_city_approved');

// V4 "Same challenge. Different worlds." (SPEC 10): the comparison question of
// a challenge, the answer of a proof and its Back home block, the user's home
// city as a real city, and the daily reference exchange rates.
// Reversal: drop the columns below and DROP TABLE daily_rates.
run($pdo, "ALTER TABLE daily_challenges ADD COLUMN IF NOT EXISTS compare_type TEXT
    CHECK (compare_type IS NULL OR compare_type IN ('word', 'text', 'number', 'time'))", 'daily_challenges.compare_type');
run($pdo, "ALTER TABLE daily_challenges ADD COLUMN IF NOT EXISTS compare_question_i18n JSONB", 'daily_challenges.compare_question_i18n');
run($pdo, "ALTER TABLE daily_challenges ADD COLUMN IF NOT EXISTS compare_unit_i18n JSONB", 'daily_challenges.compare_unit_i18n');
run($pdo, "
    ALTER TABLE daily_proofs
        ADD COLUMN IF NOT EXISTS answer_text         TEXT CHECK (answer_text IS NULL OR char_length(answer_text) <= 80),
        ADD COLUMN IF NOT EXISTS answer_number       BIGINT,
        ADD COLUMN IF NOT EXISTS answer_minutes      SMALLINT CHECK (answer_minutes IS NULL OR answer_minutes BETWEEN 0 AND 1410),
        ADD COLUMN IF NOT EXISTS home_city_id        TEXT REFERENCES channels(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS home_city_name      TEXT,
        ADD COLUMN IF NOT EXISTS home_country        CHAR(2),
        ADD COLUMN IF NOT EXISTS home_answer_text    TEXT CHECK (home_answer_text IS NULL OR char_length(home_answer_text) <= 80),
        ADD COLUMN IF NOT EXISTS home_answer_number  BIGINT,
        ADD COLUMN IF NOT EXISTS home_answer_minutes SMALLINT CHECK (home_answer_minutes IS NULL OR home_answer_minutes BETWEEN 0 AND 1410),
        ADD COLUMN IF NOT EXISTS home_price_amount   NUMERIC(14,2) CHECK (home_price_amount IS NULL OR home_price_amount >= 0),
        ADD COLUMN IF NOT EXISTS home_price_currency CHAR(3),
        ADD COLUMN IF NOT EXISTS home_line           TEXT CHECK (home_line IS NULL OR char_length(home_line) <= 80)
", 'daily_proofs answer and back home');
// Every proof carries a currency (the city's by default), with or without a price:
// the pair check becomes "an amount needs a currency".
run($pdo, "ALTER TABLE daily_proofs DROP CONSTRAINT IF EXISTS daily_proofs_price_pair_check", 'daily_proofs_price_pair_check dropped');
run($pdo, "
    DO \$\$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'daily_proofs_price_currency_check') THEN
            ALTER TABLE daily_proofs ADD CONSTRAINT daily_proofs_price_currency_check
                CHECK (price_amount IS NULL OR price_currency IS NOT NULL);
            ALTER TABLE daily_proofs ADD CONSTRAINT daily_proofs_home_price_currency_check
                CHECK (home_price_amount IS NULL OR home_price_currency IS NOT NULL);
        END IF;
    END \$\$
", 'daily_proofs price currency checks');
run($pdo, "ALTER TABLE users ADD COLUMN IF NOT EXISTS home_city_id TEXT REFERENCES channels(id) ON DELETE SET NULL", 'users.home_city_id');
run($pdo, "ALTER TABLE users ADD COLUMN IF NOT EXISTS home_country CHAR(2)", 'users.home_country');
// The structured home city (Back home): one of our cities (home_city_id), or
// a city we don't have (home_city_name + home_country). users.home_city stays
// the free-text profile field it was (local status, badges).
run($pdo, "ALTER TABLE users ADD COLUMN IF NOT EXISTS home_city_name TEXT", 'users.home_city_name');
// V4-05 (SPEC 10.7): the world tour of a closed challenge, built at the drop's
// closing step: [{cityId, proofId, count, podium}], proofs resolved on read.
// Reversal: DROP TABLE daily_world_tours.
run($pdo, "
    CREATE TABLE IF NOT EXISTS daily_world_tours (
        challenge_id TEXT        PRIMARY KEY REFERENCES daily_challenges(id) ON DELETE CASCADE,
        slides       JSONB       NOT NULL,
        built_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    )
", 'daily_world_tours');
// V4-07 (SPEC 10.9): the Hilads Index of a week (its Monday), built at
// Monday's drop: [{id, kind (price|time), challengeId, date, rows: [{cityId, value, count}]}].
// Reversal: DROP TABLE daily_index_weeks.
run($pdo, "
    CREATE TABLE IF NOT EXISTS daily_index_weeks (
        week_start DATE        PRIMARY KEY,
        cards      JSONB       NOT NULL,
        built_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    )
", 'daily_index_weeks');
// The Hilads Index by comparison: a shared key per comparison question (answers
// from different challenges and dates add up), its card title, and what the
// price of a challenge is for ("a coffee") with its own shared key.
// Reversal: ALTER TABLE daily_challenges DROP COLUMN compare_key, DROP COLUMN compare_title_i18n,
//           DROP COLUMN price_key, DROP COLUMN price_label_i18n.
run($pdo, "
    ALTER TABLE daily_challenges
        ADD COLUMN IF NOT EXISTS compare_key        TEXT,
        ADD COLUMN IF NOT EXISTS compare_title_i18n JSONB,
        ADD COLUMN IF NOT EXISTS price_key          TEXT,
        ADD COLUMN IF NOT EXISTS price_label_i18n   JSONB
", 'daily_challenges compare_key / price_key');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_daily_challenges_compare_key ON daily_challenges (compare_key) WHERE compare_key IS NOT NULL", 'idx_daily_challenges_compare_key');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_daily_challenges_price_key ON daily_challenges (price_key) WHERE price_key IS NOT NULL", 'idx_daily_challenges_price_key');
// Demo content a week ahead (DailyDemo::plan): per date, each demo player's
// uploaded photo, caption, answer, price and spot; the drop seeds that day's.
// Reversal: DROP TABLE daily_demo_days.
run($pdo, "
    CREATE TABLE IF NOT EXISTS daily_demo_days (
        challenge_date DATE        PRIMARY KEY,
        players        JSONB       NOT NULL,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    )
", 'daily_demo_days');

// Where users.current_city_id came from: 'gps' (/location/resolve), 'manual'
// (a Legend's /me/city), 'profile' (derived from home_city) or 'join' (the
// first city chat joined: an IP guess or a link). NULL = before this column,
// treated as a guess. Only 'gps' and 'manual' are trusted: GPS replaces a
// guess at once, and Today offers "Not in [city]? Change" on a guess.
// Reversal: ALTER TABLE users DROP COLUMN current_city_source.
run($pdo, "ALTER TABLE users ADD COLUMN IF NOT EXISTS current_city_source TEXT", 'users.current_city_source');

// Hilads picks: editorial spots. A pick is a place with a "Good to know" text
// (pick_note_i18n {en, fr, ...}) and a status (draft, published, hidden); its
// photo is an approved seed proof by an official account marked is_pick, with
// its photo_credit. Picks never count as answers (seed rules: no votes, ranks,
// tour, Index, presence, streak or pioneer); a player's proof at the place
// takes the cover. Reversal: DROP the four columns.
run($pdo, "ALTER TABLE places ADD COLUMN IF NOT EXISTS pick_note_i18n JSONB", 'places.pick_note_i18n');
run($pdo, "ALTER TABLE places ADD COLUMN IF NOT EXISTS pick_status TEXT CHECK (pick_status IN ('draft', 'published', 'hidden'))", 'places.pick_status');
run($pdo, "ALTER TABLE daily_proofs ADD COLUMN IF NOT EXISTS is_pick BOOLEAN NOT NULL DEFAULT false", 'daily_proofs.is_pick');
run($pdo, "ALTER TABLE daily_proofs ADD COLUMN IF NOT EXISTS photo_credit TEXT", 'daily_proofs.photo_credit');
// The licensed photo's source page (Wikimedia Commons file page, Unsplash photo
// page): the sheet links it next to the full credit (CC BY / BY-SA attribution).
// Reversal: DROP COLUMN photo_source_url.
run($pdo, "ALTER TABLE daily_proofs ADD COLUMN IF NOT EXISTS photo_source_url TEXT", 'daily_proofs.photo_source_url');

// A pick attached to a challenge: the Compare tab's "Meanwhile, from our picks",
// with the pick's answer to the challenge's question when we have one (checked
// in the back office). Never in the board, the world tour or the Index.
// Reversal: DROP TABLE daily_pick_answers.
run($pdo, "
    CREATE TABLE IF NOT EXISTS daily_pick_answers (
        challenge_id   TEXT        NOT NULL REFERENCES daily_challenges(id) ON DELETE CASCADE,
        place_id       TEXT        NOT NULL REFERENCES places(id) ON DELETE CASCADE,
        answer_text    TEXT,
        answer_number  INT,
        answer_minutes INT,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (challenge_id, place_id)
    )
", 'daily_pick_answers');

// Unlimited votes (one per answer, never one's own): the 3-slot limit goes.
// vote_slot stays as the vote's rank for its voter. Reversal: re-add both
// constraints once no voter has more than 3 votes on a challenge.
run($pdo, "ALTER TABLE daily_votes DROP CONSTRAINT IF EXISTS daily_votes_vote_slot_check", 'daily_votes: drop slot check');
run($pdo, "ALTER TABLE daily_votes DROP CONSTRAINT IF EXISTS daily_votes_challenge_id_voter_user_id_vote_slot_key", 'daily_votes: drop slot unique');

// Heavy voters, flagged at each close for review, never blocked: a voter who
// voted for most of a city's answers that day (DailyVotes::flagHeavyVoters).
// Reversal: DROP TABLE daily_vote_flags.
run($pdo, "
    CREATE TABLE IF NOT EXISTS daily_vote_flags (
        challenge_id TEXT        NOT NULL REFERENCES daily_challenges(id) ON DELETE CASCADE,
        user_id      TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        city_id      TEXT        NOT NULL,
        votes        INT         NOT NULL,
        answers      INT         NOT NULL,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (challenge_id, user_id, city_id)
    )
", 'daily_vote_flags');

// Votes on Hilads picks attached to a challenge (the Compare tab and Today's
// picks strip): one per pick per voter while the challenge is open. Kept apart
// from daily_votes: never in rankings, podiums, the world tour, the Index or points.
// Reversal: DROP TABLE daily_pick_votes.
run($pdo, "
    CREATE TABLE IF NOT EXISTS daily_pick_votes (
        challenge_id  TEXT        NOT NULL REFERENCES daily_challenges(id) ON DELETE CASCADE,
        place_id      TEXT        NOT NULL REFERENCES places(id) ON DELETE CASCADE,
        voter_user_id TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (challenge_id, place_id, voter_user_id)
    )
", 'daily_pick_votes');

// Hilads suggestions as answers (2026-10-19, the founder's call): a pick attached
// to a challenge becomes an approved answer of that challenge by the official
// account (is_suggestion, labeled "Hilads suggestion" with its photo credit). It
// counts like an answer (strips, board, votes, results, tour, Index, presence);
// several per challenge, so the one-answer-per-user index skips them.
// Reversal: DELETE FROM daily_proofs WHERE is_suggestion; restore the index; DROP COLUMN.
run($pdo, "ALTER TABLE daily_proofs ADD COLUMN IF NOT EXISTS is_suggestion BOOLEAN NOT NULL DEFAULT false", 'daily_proofs.is_suggestion');
run($pdo, "DROP INDEX IF EXISTS uq_daily_proofs_challenge_user", 'drop uq_daily_proofs_challenge_user');
run($pdo, "CREATE UNIQUE INDEX IF NOT EXISTS uq_daily_proofs_challenge_user_v2 ON daily_proofs (challenge_id, user_id) WHERE NOT is_seed AND NOT is_suggestion",
    'uq_daily_proofs_challenge_user_v2');

// The Today hero's short headline (SPEC 9.3, 45 characters): {en, fr, ...}; the
// challenge text is shown when absent. Reversal: DROP COLUMN headline_i18n.
run($pdo, "ALTER TABLE daily_challenges ADD COLUMN IF NOT EXISTS headline_i18n JSONB", 'daily_challenges.headline_i18n');
run($pdo, "
    CREATE TABLE IF NOT EXISTS daily_rates (
        date       DATE        PRIMARY KEY,
        base       CHAR(3)     NOT NULL,
        rates      JSONB       NOT NULL,
        source     TEXT        NOT NULL,
        fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
", 'daily_rates');

// Join in (2026-10-22) replaces Ask a local: the stored key moves with its
// theme (challenges, proposals, the uploaded theme cover), so stamps, Local
// Pass progress and spots follow. One DO block = one transaction; idempotent.
// An uploaded join_in cover already there wins (the ask_local one is kept).
// Reversal (the same updates the other way round):
//   UPDATE daily_challenges SET theme = 'ask_local' WHERE theme = 'join_in';
//   UPDATE daily_proposals  SET theme = 'ask_local' WHERE theme = 'join_in';
//   UPDATE daily_theme_covers SET theme = 'ask_local' WHERE theme = 'join_in'
//     AND NOT EXISTS (SELECT 1 FROM daily_theme_covers WHERE theme = 'ask_local');
//   UPDATE daily_challenges SET text_i18n = jsonb_set(text_i18n, '{en}', '"Seed spots: Ask a local"')
//     WHERE status = 'seed' AND text_i18n->>'en' = 'Seed spots: Join in';
run($pdo, "
    DO \$\$
    BEGIN
        UPDATE daily_challenges SET theme = 'join_in' WHERE theme = 'ask_local';
        UPDATE daily_proposals  SET theme = 'join_in' WHERE theme = 'ask_local';
        UPDATE daily_theme_covers SET theme = 'join_in' WHERE theme = 'ask_local'
            AND NOT EXISTS (SELECT 1 FROM daily_theme_covers WHERE theme = 'join_in');
        UPDATE daily_challenges SET text_i18n = jsonb_set(text_i18n, '{en}', '\"Seed spots: Join in\"')
            WHERE status = 'seed' AND text_i18n->>'en' = 'Seed spots: Ask a local';
    END
    \$\$
", 'themes: ask_local -> join_in');

// The challenge screen's subtitle under the question (2026-10-22): {en, fr, ...},
// 80 characters each, set in the back office (challenge page, "Subtitle") or by
// import ("subtitle"); the challenge text shows when absent.
// Reversal: ALTER TABLE daily_challenges DROP COLUMN subtitle_i18n.
run($pdo, "ALTER TABLE daily_challenges ADD COLUMN IF NOT EXISTS subtitle_i18n JSONB", 'daily_challenges.subtitle_i18n');

// The share card's question (2026-10-29, share card redo): {en, fr, ...}, 70
// characters each, set in the back office (challenge page, "Share question");
// the apps show "What's YOUR city's answer?" when absent.
// Reversal: ALTER TABLE daily_challenges DROP COLUMN share_question_i18n.
run($pdo, "ALTER TABLE daily_challenges ADD COLUMN IF NOT EXISTS share_question_i18n JSONB", 'daily_challenges.share_question_i18n');

// Photos I've viewed (2026-10-22, Today's country stories): a story ring is
// colored while one of its country's photos is unseen. Signed-in viewers only
// (a guest's are kept on the device). Reversal: DROP TABLE daily_proof_views.
run($pdo, "
    CREATE TABLE IF NOT EXISTS daily_proof_views (
        user_id   TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        proof_id  TEXT        NOT NULL REFERENCES daily_proofs(id) ON DELETE CASCADE,
        viewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, proof_id)
    )
", 'daily_proof_views');

// App versions (2026-10-23, Admin › App versions): per-platform minimum and
// latest versions read by GET /app/config, and the "Block old apps" switch.
// Reversal: DROP TABLE app_settings (the environment variables apply again).
run($pdo, "
    CREATE TABLE IF NOT EXISTS app_settings (
        key        TEXT        PRIMARY KEY,
        value      TEXT        NOT NULL DEFAULT '',
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_by TEXT
    )
", 'app_settings');

// Accounts and guests seen on an app from before the update screen while
// "Block old apps" is on (id = 'user:<id>' or 'guest:<id>'): the "Old app
// versions" push audience. Reversal: DROP TABLE old_app_seen; and the
// push_broadcasts CHECK below back to without 'old_app'.
run($pdo, "
    CREATE TABLE IF NOT EXISTS old_app_seen (
        id       TEXT        PRIMARY KEY,
        user_id  TEXT        REFERENCES users(id) ON DELETE CASCADE,
        guest_id TEXT,
        platform TEXT        NOT NULL,
        seen_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
", 'old_app_seen');
run($pdo, "ALTER TABLE push_broadcasts DROP CONSTRAINT IF EXISTS push_broadcasts_audience_type_check", 'drop push_broadcasts audience_type check (old_app)');
run($pdo, "ALTER TABLE push_broadcasts ADD CONSTRAINT push_broadcasts_audience_type_check CHECK (audience_type IN ('all','all_installs','city','user','test','old_app'))", 'push_broadcasts.audience_type +old_app');

// V5-01 (2026-10-27): the GeoNames world city base (cities5000 + names in our
// 19 locales + country currencies), loaded by scripts/geonames_import.php.
// Read-only reference data: Hilads cities (channels + cities) point to it.
// Reversal: DROP TABLE geo_city_names, geo_cities, geo_countries;
run($pdo, "
    CREATE TABLE IF NOT EXISTS geo_cities (
        geoname_id   INTEGER          PRIMARY KEY,
        name         TEXT             NOT NULL,
        ascii_name   TEXT             NOT NULL,
        country      CHAR(2)          NOT NULL,
        admin1       TEXT             NOT NULL DEFAULT '',
        admin2       TEXT             NOT NULL DEFAULT '',
        population   INTEGER          NOT NULL DEFAULT 0,
        timezone     TEXT             NOT NULL,
        lat          DOUBLE PRECISION NOT NULL,
        lng          DOUBLE PRECISION NOT NULL,
        feature_code TEXT             NOT NULL
    )
", 'geo_cities');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_geo_cities_lat_lng ON geo_cities (lat, lng)", 'idx_geo_cities_lat_lng');
run($pdo, "
    CREATE TABLE IF NOT EXISTS geo_city_names (
        geoname_id   INTEGER NOT NULL REFERENCES geo_cities(geoname_id) ON DELETE CASCADE,
        locale       TEXT    NOT NULL,
        name         TEXT    NOT NULL,
        is_preferred BOOLEAN NOT NULL DEFAULT false,
        is_short     BOOLEAN NOT NULL DEFAULT false,
        PRIMARY KEY (geoname_id, locale, name)
    )
", 'geo_city_names');
run($pdo, "
    CREATE TABLE IF NOT EXISTS geo_countries (
        country  CHAR(2) PRIMARY KEY,
        name     TEXT    NOT NULL,
        currency CHAR(3)
    )
", 'geo_countries');
// Placement exceptions, edited in the back office: a city attached to another
// (target_geoname_id) or never absorbed (NULL target). No FK to geo_cities:
// geonames_import.php --load truncates and reloads it.
// Reversal: DROP TABLE geo_city_overrides;
run($pdo, "
    CREATE TABLE IF NOT EXISTS geo_city_overrides (
        geoname_id        INTEGER     PRIMARY KEY,
        target_geoname_id INTEGER,
        note              TEXT,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
    )
", 'geo_city_overrides');
require_once __DIR__ . '/src/CityPlacement.php';
foreach (CityPlacement::SEED_OVERRIDES as $gid => [$target, $note]) {
    $stmt = $pdo->prepare("INSERT INTO geo_city_overrides (geoname_id, target_geoname_id, note) VALUES (?, ?, ?) ON CONFLICT (geoname_id) DO NOTHING");
    $stmt->execute([$gid, $target, $note]);
}
echo "  OK  geo_city_overrides seeds\n";

// 2026-10-27 - V5-01 step 3: Hilads cities on the GeoNames base. geoname_id is
// the GeoNames city a Hilads city is (our 350 seeds get theirs from
// scripts/city_geonames_apply.php; cities created at a first visit carry it
// from the start); auto_created marks those. Name-prefix indexes for the
// city search (GET /cities/search).
// Reversal: DROP INDEX idx_geo_city_names_lower, idx_geo_cities_lower_name,
//   idx_geo_cities_lower_ascii, idx_cities_geoname_id;
//   ALTER TABLE cities DROP COLUMN auto_created, DROP COLUMN geoname_id;
run($pdo, "ALTER TABLE cities ADD COLUMN IF NOT EXISTS geoname_id INTEGER", 'cities.geoname_id');
run($pdo, "ALTER TABLE cities ADD COLUMN IF NOT EXISTS auto_created BOOLEAN NOT NULL DEFAULT false", 'cities.auto_created');
run($pdo, "CREATE UNIQUE INDEX IF NOT EXISTS idx_cities_geoname_id ON cities (geoname_id) WHERE geoname_id IS NOT NULL", 'idx_cities_geoname_id');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_geo_cities_lower_ascii ON geo_cities (lower(ascii_name) text_pattern_ops)", 'idx_geo_cities_lower_ascii');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_geo_cities_lower_name ON geo_cities (lower(name) text_pattern_ops)", 'idx_geo_cities_lower_name');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_geo_city_names_lower ON geo_city_names (lower(name) text_pattern_ops)", 'idx_geo_city_names_lower');

// 2026-10-27 - V5-01 step 4: the back office Cities page. short_name: the name
// a city is known by worldwide where space is tight (Saigon), short_name_i18n
// its form in a locale that differs ({"vi": "Sài Gòn"}), aliases: more names
// the city search finds. merged_into: a city merged into another (its channel
// is status 'merged'; apps and links that kept it are sent to the target).
// Seeds the 8 short names the apps hard-coded (cityName.ts / cityName.js).
// Reversal: ALTER TABLE cities DROP COLUMN short_name, DROP COLUMN short_name_i18n,
//   DROP COLUMN aliases, DROP COLUMN merged_into;
run($pdo, "ALTER TABLE cities ADD COLUMN IF NOT EXISTS short_name TEXT", 'cities.short_name');
run($pdo, "ALTER TABLE cities ADD COLUMN IF NOT EXISTS short_name_i18n JSONB NOT NULL DEFAULT '{}'", 'cities.short_name_i18n');
run($pdo, "ALTER TABLE cities ADD COLUMN IF NOT EXISTS aliases TEXT[] NOT NULL DEFAULT '{}'", 'cities.aliases');
run($pdo, "ALTER TABLE cities ADD COLUMN IF NOT EXISTS merged_into TEXT", 'cities.merged_into');
foreach ([
    'Ho Chi Minh City'   => ['Saigon', ['vi' => 'Sài Gòn'], ['Saigon', 'Sài Gòn', 'HCMC']],
    'Saint Petersburg'   => ['St. Petersburg', ['ru' => 'Петербург'], ['St Petersburg', 'St. Petersburg', 'Petersburg']],
    'Rio de Janeiro'     => ['Rio', [], ['Rio']],
    'Thiruvananthapuram' => ['Trivandrum', [], ['Trivandrum']],
    'Guatemala City'     => ['Guatemala', [], []],
    'Quebec City'        => ['Québec', [], ['Québec', 'Quebec']],
    'Panama City'        => ['Panamá', [], []],
    'Kuwait City'        => ['Kuwait', [], []],
] as $name => [$short, $i18n, $aliases]) {
    try {
        $pdo->prepare("
            UPDATE cities SET short_name = ?, short_name_i18n = ?::jsonb, aliases = ?::text[]
            WHERE short_name IS NULL AND channel_id = (SELECT id FROM channels WHERE type = 'city' AND name = ? ORDER BY id LIMIT 1)
        ")->execute([$short, json_encode($i18n ?: new stdClass(), JSON_UNESCAPED_UNICODE), '{' . implode(',', array_map(fn($a) => '"' . $a . '"', $aliases)) . '}', $name]);
    } catch (\Throwable $e) {
        echo "  FAIL short name {$name}: {$e->getMessage()}\n";
    }
}
echo "  OK  city short names seeds\n";

// Get around (2026-10-28) replaces Join in on Wednesdays: the stored key moves
// with its theme (challenges, proposals), so stamps, Local Pass progress and
// spots follow. The uploaded join_in cover (people together) stays behind:
// Get around shows its bundled cover until one is uploaded. One DO block = one
// transaction; idempotent. Reversal:
//   UPDATE daily_challenges SET theme = 'join_in' WHERE theme = 'get_around';
//   UPDATE daily_proposals  SET theme = 'join_in' WHERE theme = 'get_around';
//   UPDATE daily_challenges SET text_i18n = jsonb_set(text_i18n, '{en}', '"Seed spots: Join in"')
//     WHERE status = 'seed' AND text_i18n->>'en' = 'Seed spots: Get around';
run($pdo, "
    DO \$\$
    BEGIN
        UPDATE daily_challenges SET theme = 'get_around' WHERE theme IN ('join_in', 'ask_local');
        UPDATE daily_proposals  SET theme = 'get_around' WHERE theme IN ('join_in', 'ask_local');
        UPDATE daily_challenges SET text_i18n = jsonb_set(text_i18n, '{en}', '\"Seed spots: Get around\"')
            WHERE status = 'seed' AND text_i18n->>'en' IN ('Seed spots: Join in', 'Seed spots: Ask a local');
    END
    \$\$
", 'themes: join_in -> get_around');

// Daily promo (SPEC 10.13, 2026-10-28): the video, carousel and captions made
// from yesterday's world tour by tools/promo. Photo rights: the author's
// consent ('yes' = every photo, also before the terms' clause; 'no' = none;
// NULL = photos from DailyPromo::TERMS_SINCE), when the one-time ask was shown,
// and a per-photo exclusion from the back office. The rendered files and
// captions per promo date, one row per kind (a rerun replaces it).
run($pdo, "ALTER TABLE users ADD COLUMN IF NOT EXISTS promo_consent TEXT CHECK (promo_consent IN ('yes', 'no'))", 'users.promo_consent');
run($pdo, "ALTER TABLE users ADD COLUMN IF NOT EXISTS promo_asked_at TIMESTAMPTZ", 'users.promo_asked_at');
run($pdo, "ALTER TABLE daily_proofs ADD COLUMN IF NOT EXISTS promo_excluded BOOLEAN NOT NULL DEFAULT false", 'daily_proofs.promo_excluded');
run($pdo, "
    CREATE TABLE IF NOT EXISTS daily_promo_assets (
        promo_date  DATE        NOT NULL,
        kind        TEXT        NOT NULL,
        url         TEXT,
        content     TEXT,
        rendered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (promo_date, kind)
    )
", 'daily_promo_assets');

// Comments on Daily Challenge photos (2026-10-29, docs/photo-comments-audit.md).
// One flat thread per photo: reply_to_comment_id only quotes. Soft delete
// (deleted_at) by the commenter or the photo's author; hidden_at when reports
// reach PhotoComments::REPORT_HIDE_THRESHOLD. daily_proofs.comment_count counts
// the visible ones, kept by a trigger like vote_count. Registered users only.
// Reversal: DROP TABLE photo_comment_reports, photo_comment_likes,
// photo_comment_mentions, photo_comments; DROP FUNCTION
// photo_comments_recount(); ALTER TABLE daily_proofs DROP COLUMN comment_count;
// ALTER TABLE notification_preferences DROP COLUMN comment_push.
run($pdo, "ALTER TABLE daily_proofs ADD COLUMN IF NOT EXISTS comment_count INTEGER NOT NULL DEFAULT 0", 'daily_proofs.comment_count');
run($pdo, "
    CREATE TABLE IF NOT EXISTS photo_comments (
        id                  BIGSERIAL   PRIMARY KEY,
        photo_id            TEXT        NOT NULL REFERENCES daily_proofs(id) ON DELETE CASCADE,
        user_id             TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        body                TEXT        NOT NULL CHECK (char_length(body) BETWEEN 1 AND 300),
        reply_to_comment_id BIGINT      REFERENCES photo_comments(id) ON DELETE SET NULL,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
        edited_at           TIMESTAMPTZ,
        deleted_at          TIMESTAMPTZ,
        hidden_at           TIMESTAMPTZ
    )
", 'photo_comments');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_photo_comments_photo ON photo_comments (photo_id, id) WHERE deleted_at IS NULL AND hidden_at IS NULL", 'idx_photo_comments_photo');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_photo_comments_user ON photo_comments (user_id, created_at)", 'idx_photo_comments_user');
run($pdo, "
    CREATE TABLE IF NOT EXISTS photo_comment_mentions (
        comment_id        BIGINT NOT NULL REFERENCES photo_comments(id) ON DELETE CASCADE,
        mentioned_user_id TEXT   NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        PRIMARY KEY (comment_id, mentioned_user_id)
    )
", 'photo_comment_mentions');
run($pdo, "
    CREATE TABLE IF NOT EXISTS photo_comment_likes (
        comment_id BIGINT      NOT NULL REFERENCES photo_comments(id) ON DELETE CASCADE,
        user_id    TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (comment_id, user_id)
    )
", 'photo_comment_likes');
run($pdo, "
    CREATE TABLE IF NOT EXISTS photo_comment_reports (
        id                BIGSERIAL   PRIMARY KEY,
        comment_id        BIGINT      NOT NULL REFERENCES photo_comments(id) ON DELETE CASCADE,
        reporter_user_id  TEXT        REFERENCES users(id) ON DELETE CASCADE,
        reporter_guest_id TEXT,
        reason_code       TEXT        NOT NULL,
        status            TEXT        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewed', 'dismissed')),
        created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
        CHECK (reporter_user_id IS NOT NULL OR reporter_guest_id IS NOT NULL)
    )
", 'photo_comment_reports');
run($pdo, "CREATE UNIQUE INDEX IF NOT EXISTS uq_photo_comment_reports_reporter
            ON photo_comment_reports (comment_id, COALESCE(reporter_user_id, '@g:' || reporter_guest_id))", 'uq_photo_comment_reports_reporter');
run($pdo, "
    CREATE OR REPLACE FUNCTION photo_comments_recount() RETURNS trigger AS \$\$
    DECLARE pid TEXT := COALESCE(NEW.photo_id, OLD.photo_id);
    BEGIN
        UPDATE daily_proofs SET comment_count = (
            SELECT count(*) FROM photo_comments
            WHERE photo_id = pid AND deleted_at IS NULL AND hidden_at IS NULL
        ) WHERE id = pid;
        RETURN NULL;
    END
    \$\$ LANGUAGE plpgsql
", 'photo_comments_recount()');
run($pdo, "DROP TRIGGER IF EXISTS trg_photo_comments_count ON photo_comments", 'drop trg_photo_comments_count');
run($pdo, "
    CREATE TRIGGER trg_photo_comments_count
    AFTER INSERT OR DELETE OR UPDATE OF deleted_at, hidden_at ON photo_comments
    FOR EACH ROW EXECUTE FUNCTION photo_comments_recount()
", 'trg_photo_comments_count');
run($pdo, "ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS comment_push BOOLEAN NOT NULL DEFAULT true", 'notification_preferences.comment_push');

// Dual photo (2026-10-29, docs/dual-photo-audit.md): the selfie taken right
// after the Daily photo, shown as an inset over it. Optional: NULL = a single
// photo (and every proof posted by an older app). Never a spot's cover or a map
// pin. Reversal: ALTER TABLE daily_proofs DROP COLUMN selfie_url.
run($pdo, "ALTER TABLE daily_proofs ADD COLUMN IF NOT EXISTS selfie_url TEXT", 'daily_proofs.selfie_url');

// "Different Worlds by Hilads" (2026-10-31, Admin › Worlds): the daily video
// series calendar, its packages (text + slides, one row per import, a topic can
// be redone) and the slides composed by DwSlides (illustration SVG + 1080x1920
// PNG on R2). Settings = one row. Reversal: DROP TABLE dw_slides, dw_packages,
// dw_topics, dw_settings.
run($pdo, "
    CREATE TABLE IF NOT EXISTS dw_topics (
        id               BIGSERIAL PRIMARY KEY,
        date             DATE NOT NULL UNIQUE,
        title            TEXT NOT NULL,
        notes            TEXT,
        type             TEXT NOT NULL DEFAULT 'evergreen' CHECK (type IN ('dated', 'evergreen')),
        needs_date_check BOOLEAN NOT NULL DEFAULT false,
        status           TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'generated', 'ready', 'published')),
        published_links  JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
    )
", 'dw_topics');
run($pdo, "
    CREATE TABLE IF NOT EXISTS dw_packages (
        id         BIGSERIAL PRIMARY KEY,
        topic_id   BIGINT NOT NULL REFERENCES dw_topics(id) ON DELETE CASCADE,
        version    INT NOT NULL,
        content    JSONB NOT NULL,
        model      TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (topic_id, version)
    )
", 'dw_packages');
run($pdo, "
    CREATE TABLE IF NOT EXISTS dw_slides (
        id         BIGSERIAL PRIMARY KEY,
        package_id BIGINT NOT NULL REFERENCES dw_packages(id) ON DELETE CASCADE,
        position   INT NOT NULL,
        kind       TEXT NOT NULL CHECK (kind IN ('hook', 'country', 'outro')),
        svg_url    TEXT,
        png_url    TEXT,
        fallback   BOOLEAN NOT NULL DEFAULT false,
        error      TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (package_id, position)
    )
", 'dw_slides');
run($pdo, "
    CREATE TABLE IF NOT EXISTS dw_settings (
        id                        INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        system_prompt             TEXT NOT NULL,
        illustration_prompt       TEXT NOT NULL,
        visual_style              TEXT NOT NULL,
        phase                     INT NOT NULL DEFAULT 1 CHECK (phase IN (1, 2, 3)),
        countries_always_included JSONB NOT NULL DEFAULT '[\"Vietnam\"]'::jsonb,
        updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
    )
", 'dw_settings');
// Real photos instead of drawn illustrations (2026-10-31): the 1080x1080 crop
// stored on R2 (the source + credit stay in the package content), and the
// silent video rendered on a Mac by tools/promo (npm run worlds).
run($pdo, "ALTER TABLE dw_slides ADD COLUMN IF NOT EXISTS photo_url TEXT", 'dw_slides.photo_url');
run($pdo, "ALTER TABLE dw_packages ADD COLUMN IF NOT EXISTS video_url TEXT", 'dw_packages.video_url');
run($pdo, "ALTER TABLE dw_packages ADD COLUMN IF NOT EXISTS video_at TIMESTAMPTZ", 'dw_packages.video_at');
// 2026-11-06: the topic's title and notes a package was made from (a later change asks for a new package).
run($pdo, "ALTER TABLE dw_packages ADD COLUMN IF NOT EXISTS brief JSONB", 'dw_packages.brief');
// The hilads.live lines (2026-10-31): under the outro's question, and before it
// at the end of every caption. Edited in Admin › Worlds › Settings.
run($pdo, "ALTER TABLE dw_settings ADD COLUMN IF NOT EXISTS outro_cta TEXT NOT NULL DEFAULT 'Compare your city on hilads.live'", 'dw_settings.outro_cta');
run($pdo, "ALTER TABLE dw_settings ADD COLUMN IF NOT EXISTS caption_cta TEXT NOT NULL DEFAULT 'Compare your city with the world on hilads.live 🌍 (link in bio)'", 'dw_settings.caption_cta');
require_once __DIR__ . '/src/DwSeed.php';
try {
    // The seeded drawing prompts become the photo prompts (each kept if it was edited).
    $pdo->prepare("UPDATE dw_settings SET illustration_prompt = ? WHERE id = 1 AND illustration_prompt = ?")
        ->execute([DwSeed::ILLUSTRATION_PROMPT, DwSeed::OLD_ILLUSTRATION_PROMPT]);
    $pdo->prepare("UPDATE dw_settings SET visual_style = ? WHERE id = 1 AND visual_style = ?")
        ->execute([DwSeed::VISUAL_STYLE, DwSeed::OLD_VISUAL_STYLE]);
    $pdo->prepare("UPDATE dw_settings SET system_prompt = ? WHERE id = 1 AND system_prompt IN (?, ?)")
        ->execute([DwSeed::SYSTEM_PROMPT, DwSeed::OLD_SYSTEM_PROMPT, DwSeed::OLD_SYSTEM_PROMPT_2]);
    $pdo->prepare("
        INSERT INTO dw_settings (id, system_prompt, illustration_prompt, visual_style, phase, countries_always_included)
        VALUES (1, ?, ?, ?, 1, '[\"Vietnam\"]'::jsonb) ON CONFLICT (id) DO NOTHING
    ")->execute([DwSeed::SYSTEM_PROMPT, DwSeed::ILLUSTRATION_PROMPT, DwSeed::VISUAL_STYLE]);
    // The humor rule (2026-10-31) goes right after the tone line, whatever was edited around it.
    $prompt = (string) $pdo->query("SELECT system_prompt FROM dw_settings WHERE id = 1")->fetchColumn();
    if ($prompt !== '' && !str_contains($prompt, '- Humor:')) {
        $withHumor = preg_replace('/^(- Tone:.*)$/m', '$1' . "\n" . DwSeed::HUMOR_LINE, $prompt, 1, $n);
        if ($n === 0) {
            $withHumor = preg_replace('/^(Brand context:.*)$/m', '$1' . "\n" . DwSeed::HUMOR_LINE, $prompt, 1, $n);
        }
        if ($n > 0) {
            $pdo->prepare("UPDATE dw_settings SET system_prompt = ?, updated_at = now() WHERE id = 1")->execute([$withHumor]);
        } else {
            echo "  WARN dw seed: no tone line in the system prompt, add the humor rule by hand\n";
        }
    }
    // Video clips (2026-11-01): the clip rule goes right after the photo rule, whatever was edited around it
    // (its first wording, a stock-site search query, is swapped for it).
    $prompt = (string) $pdo->query("SELECT system_prompt FROM dw_settings WHERE id = 1")->fetchColumn();
    // 2026-11-03: a clip only where it shows the slide's exact subject, else the photo (PREV_CLIP_LINE swapped too).
    if (str_contains($prompt, DwSeed::OLD_CLIP_LINE) || str_contains($prompt, DwSeed::PREV_CLIP_LINE)) {
        $prompt = str_replace([DwSeed::OLD_CLIP_LINE, DwSeed::PREV_CLIP_LINE], DwSeed::CLIP_LINE, $prompt);
        $pdo->prepare("UPDATE dw_settings SET system_prompt = ?, updated_at = now() WHERE id = 1")->execute([$prompt]);
    }
    if ($prompt !== '' && !str_contains($prompt, 'clip_url')) {
        $withClip = preg_replace('/^(- Each slide is illustrated by a real photo.*)$/m', '$1' . "\n" . str_replace('$', '\\$', DwSeed::CLIP_LINE), $prompt, 1, $n);
        if ($n > 0) {
            $pdo->prepare("UPDATE dw_settings SET system_prompt = ?, updated_at = now() WHERE id = 1")->execute([$withClip]);
        } else {
            echo "  WARN dw seed: no photo rule in the system prompt, add the clip rule by hand\n";
        }
    }
    // 2026-11-06: two levels of text (headline + detail) on the hook and the countries, in the rules and the schema.
    $prompt = (string) $pdo->query("SELECT system_prompt FROM dw_settings WHERE id = 1")->fetchColumn();
    $twoLevel = $prompt;
    foreach (DwSeed::TEXT_SWAPS as [$old, $new]) {
        $twoLevel = str_replace($old, $new, $twoLevel);
    }
    if ($twoLevel !== $prompt) {
        $pdo->prepare("UPDATE dw_settings SET system_prompt = ?, updated_at = now() WHERE id = 1")->execute([$twoLevel]);
    }
    if ($twoLevel !== '' && !str_contains($twoLevel, '"headline"')) {
        echo "  WARN dw seed: the system prompt was edited, add the headline / detail rule and schema by hand (DwSeed::TEXT_LINE)\n";
    }
    // 2026-11-07: 5 to 6 countries, about 35 s (40 at most) with the slides' durations.
    $shorter = $twoLevel;
    foreach (DwSeed::LENGTH_SWAPS as [$old, $new]) {
        $shorter = str_replace($old, $new, $shorter);
    }
    if ($shorter !== $twoLevel) {
        $pdo->prepare("UPDATE dw_settings SET system_prompt = ?, updated_at = now() WHERE id = 1")->execute([$shorter]);
    }
    if ($shorter !== '' && !str_contains($shorter, '5 to 6 countries')) {
        echo "  WARN dw seed: the system prompt was edited, set 5 to 6 countries and about 35 s by hand (DwSeed::LENGTH_SWAPS)\n";
    }
    $seedTopic = $pdo->prepare("
        INSERT INTO dw_topics (date, title, notes, type, needs_date_check) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (date) DO NOTHING
    ");
    // Only into an empty calendar: a topic deleted or moved in the admin must not come back.
    if ((int) $pdo->query("SELECT COUNT(*) FROM dw_topics")->fetchColumn() === 0) {
        foreach (DwSeed::TOPICS as [$d, $t, $ty, $check, $notes]) {
            $seedTopic->execute([$d, $t, $notes, $ty, $check ? 'true' : 'false']);
        }
    }
    // The funnier calendar (2026-10-31), once: every topic from Nov 1 not published is
    // replaced (its packages go with it), published days are kept.
    $pdo->exec("ALTER TABLE dw_settings ADD COLUMN IF NOT EXISTS calendar_rev INT NOT NULL DEFAULT 1");
    if ((int) $pdo->query("SELECT calendar_rev FROM dw_settings WHERE id = 1")->fetchColumn() < 2) {
        $pdo->beginTransaction();
        $gone = $pdo->exec("DELETE FROM dw_topics WHERE date >= '2026-11-01' AND status <> 'published'");
        foreach (DwSeed::TOPICS as [$d, $t, $ty, $check, $notes]) {
            if ($d >= '2026-11-01') $seedTopic->execute([$d, $t, $notes, $ty, $check ? 'true' : 'false']);
        }
        $pdo->exec("UPDATE dw_settings SET calendar_rev = 2 WHERE id = 1");
        $pdo->commit();
        echo "  OK  dw calendar v2 ($gone old topics replaced)\n";
    }
    echo "  OK  dw seed\n";
} catch (PDOException $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    echo "  ERR dw seed: " . $e->getMessage() . "\n";
}

// 2026-11-01 - Local/Traveler on Daily photos (DailyRules::isLocalFor) now
// matches every name of the photo's city (Saigon for Ho Chi Minh City: short
// name, local short names, aliases) and the home city picked from our list
// (users.home_city_id). Once (app_settings is_local_names_v1): the photos marked
// traveler whose author passes the new rule become local. Votes keep theirs.
// Reversal: none needed (only false → true, by the rule the app now applies).
require_once __DIR__ . '/src/DailyRules.php';
try {
    $done = $pdo->query("SELECT 1 FROM app_settings WHERE key = 'is_local_names_v1'")->fetchColumn();
    if (!$done) {
        $rows = $pdo->query("
            SELECT p.id, p.city_id, u.home_city, u.home_city_id, ch.name, ci.short_name,
                   ci.short_name_i18n::text AS i18n, array_to_json(ci.aliases)::text AS aliases
            FROM daily_proofs p
            JOIN users u     ON u.id = p.user_id AND u.mode = 'local'
            JOIN channels ch ON ch.id = p.city_id
            JOIN cities ci   ON ci.channel_id = p.city_id
            WHERE NOT p.is_local
        ")->fetchAll(PDO::FETCH_ASSOC);
        $fix = [];
        foreach ($rows as $r) {
            $home = trim((string) $r['home_city']);
            $names = array_merge([(string) $r['name'], (string) $r['short_name']],
                array_values(json_decode((string) $r['i18n'], true) ?: []), json_decode((string) $r['aliases'], true) ?: []);
            $match = $home !== '' && in_array(DailyRules::slug($home),
                array_map(static fn($n) => DailyRules::slug((string) $n), array_filter($names, static fn($n) => (string) $n !== '')), true);
            if ($match || ($r['home_city_id'] !== null && $r['home_city_id'] === $r['city_id'])) {
                $fix[] = $r['id'];
            }
        }
        $pdo->beginTransaction();
        $up = $pdo->prepare("UPDATE daily_proofs SET is_local = true WHERE id = ?");
        foreach ($fix as $id) $up->execute([$id]);
        $pdo->exec("INSERT INTO app_settings (key, value, updated_by) VALUES ('is_local_names_v1', now()::text, 'migrate')");
        $pdo->commit();
        echo "  OK  daily photos local by city names (" . count($fix) . " of " . count($rows) . " traveler photos of locals)\n";
    }
} catch (PDOException $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    echo "  ERR daily photos local by city names: " . $e->getMessage() . "\n";
}

// ── Different Worlds: video clips (2026-11-01) ─────────────────────────────
// A topic in 'video' mode plays a Commons clip in each slide's photo square
// when its package gives one (clip_url / clip_start / clip_credit, chosen in
// Claude Code like the photos). The first version searched Pexels / Pixabay
// (no API keys to be had): its column and cache table go.
// Reversal: ALTER TABLE dw_topics DROP COLUMN visual_mode.
run($pdo, "ALTER TABLE dw_topics ADD COLUMN IF NOT EXISTS visual_mode TEXT NOT NULL DEFAULT 'image' CHECK (visual_mode IN ('image', 'video'))", 'dw_topics.visual_mode');
run($pdo, "ALTER TABLE dw_slides DROP COLUMN IF EXISTS clip", 'dw_slides.clip dropped');
run($pdo, "DROP TABLE IF EXISTS dw_clip_searches", 'dw_clip_searches dropped');

// ── Photo placeholders (thumbhash) ────────────────────────────────────────
// A ~25-byte blurred preview of each Daily photo and selfie, sent with the
// proof and drawn while the photo loads. image_hashes: computed at upload,
// by file name; daily_proofs copies it (create / edit / the tick / the backfill).
// Reversal: DROP TABLE image_hashes; ALTER TABLE daily_proofs DROP COLUMN photo_hash, DROP COLUMN selfie_hash.
run($pdo, "CREATE TABLE IF NOT EXISTS image_hashes (
    name       TEXT PRIMARY KEY,
    hash       TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
)", 'image_hashes');
run($pdo, "ALTER TABLE daily_proofs ADD COLUMN IF NOT EXISTS photo_hash TEXT", 'daily_proofs.photo_hash');
run($pdo, "ALTER TABLE daily_proofs ADD COLUMN IF NOT EXISTS selfie_hash TEXT", 'daily_proofs.selfie_hash');

// ── V6 notifications: category, dedupe, seen (2026-11-06) ─────────────────
// category: social / game / plans / city / hilads (inbox filters, counts,
// preferences), written at insert by NotificationCategory::of and backfilled
// here. dedupe_key: the same event writes one row per recipient (unique per
// user; NULL = may repeat). seen_at: the "While you were away" card was
// dismissed (seen is not read). friend_arrival_push: a friend landed somewhere
// (worldwide arrivals are friends-only since V6).
// Reversal: DROP INDEX notifications_dedupe, notifications_unread_category;
// ALTER TABLE notifications DROP COLUMN category, DROP COLUMN dedupe_key, DROP COLUMN seen_at;
// ALTER TABLE notification_preferences DROP COLUMN friend_arrival_push.
require_once __DIR__ . '/src/NotificationCategory.php';
run($pdo, "ALTER TABLE notifications ADD COLUMN IF NOT EXISTS category VARCHAR(16)", 'notifications.category');
run($pdo, "ALTER TABLE notifications ADD COLUMN IF NOT EXISTS dedupe_key TEXT", 'notifications.dedupe_key');
run($pdo, "ALTER TABLE notifications ADD COLUMN IF NOT EXISTS seen_at TIMESTAMPTZ", 'notifications.seen_at');
run($pdo, "CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedupe ON notifications (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL", 'notifications_dedupe');
run($pdo, "CREATE INDEX IF NOT EXISTS notifications_unread_category ON notifications (user_id, category) WHERE is_read = FALSE", 'notifications_unread_category');
run($pdo, "UPDATE notifications SET category = " . NotificationCategory::caseSql('type') . " WHERE category IS NULL", 'notifications.category backfill');
// Rows read long ago count as seen.
run($pdo, "UPDATE notifications SET seen_at = created_at WHERE seen_at IS NULL AND is_read = TRUE", 'notifications.seen_at backfill');
run($pdo, "ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS friend_arrival_push BOOLEAN NOT NULL DEFAULT TRUE", 'notification_preferences.friend_arrival_push');

// ── V6 notification preferences (2026-11-06) ──────────────────────────────
// New toggles grouped like the inbox: likes (Social), results / rank changes /
// stamps / the evening reminder (Game), and quiet hours (minutes of the day in
// the user's timezone; null = off) when no push is sent.
// Reversal: ALTER TABLE notification_preferences DROP COLUMN like_push, DROP COLUMN results_push,
// DROP COLUMN rank_push, DROP COLUMN stamp_push, DROP COLUMN reminder_push, DROP COLUMN quiet_start, DROP COLUMN quiet_end.
foreach (['like_push', 'results_push', 'rank_push', 'stamp_push', 'reminder_push'] as $col) {
    run($pdo, "ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS {$col} BOOLEAN NOT NULL DEFAULT TRUE", "notification_preferences.{$col}");
}
run($pdo, "ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS quiet_start SMALLINT CHECK (quiet_start BETWEEN 0 AND 1439)", 'notification_preferences.quiet_start');
run($pdo, "ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS quiet_end SMALLINT CHECK (quiet_end BETWEEN 0 AND 1439)", 'notification_preferences.quiet_end');

// ── Different Worlds: the reaction + ranking format (2026-11-07) ──────────
// dw_topics.format: 'slides' (the slides video) or 'reaction' (one 8 s screen:
// a Pixabay reaction clip on top, a ranking of up to 20 countries under it,
// DwReaction). dw_packages.still_url: the screen as a PNG (tools/promo).
// Reversal: ALTER TABLE dw_topics DROP COLUMN format; ALTER TABLE dw_packages DROP COLUMN still_url.
run($pdo, "ALTER TABLE dw_topics ADD COLUMN IF NOT EXISTS format TEXT NOT NULL DEFAULT 'slides' CHECK (format IN ('slides', 'reaction'))", 'dw_topics.format');
run($pdo, "ALTER TABLE dw_packages ADD COLUMN IF NOT EXISTS still_url TEXT", 'dw_packages.still_url');
// The first reaction topic, once: "The 20 biggest beer drinkers in the world" on Nov 8; "Hangover
// cures around the world" moves from Nov 8 to Nov 9, "Foods locals love and tourists fear" from
// Nov 9 to the next free date. A topic not where it is expected stays put (the step says so).
try {
    $beer = 'The 20 biggest beer drinkers in the world';
    $has = $pdo->prepare("SELECT 1 FROM dw_topics WHERE title = ?");
    $has->execute([$beer]);
    if ($has->fetchColumn() === false) {
        $pdo->beginTransaction();
        $at = static function (string $date, string $prefix) use ($pdo): ?array {
            $q = $pdo->prepare("SELECT id, title, status FROM dw_topics WHERE date = ?::date");
            $q->execute([$date]);
            $row = $q->fetch(PDO::FETCH_ASSOC);
            return $row !== false && stripos($row['title'], $prefix) === 0 ? $row : null;
        };
        $taken = static function (string $date) use ($pdo): bool {
            $q = $pdo->prepare("SELECT 1 FROM dw_topics WHERE date = ?::date");
            $q->execute([$date]);
            return $q->fetchColumn() !== false;
        };
        $move = $pdo->prepare("UPDATE dw_topics SET date = ?::date, updated_at = now() WHERE id = ?");
        if ($foods = $at('2026-11-09', 'Foods locals love')) {
            $free = (string) $pdo->query("
                SELECT d::date::text FROM generate_series('2026-11-10'::date, '2027-12-31'::date, '1 day') d
                WHERE NOT EXISTS (SELECT 1 FROM dw_topics t WHERE t.date = d::date) ORDER BY d LIMIT 1
            ")->fetchColumn();
            $move->execute([$free, $foods['id']]);
            echo "  OK  dw: \"{$foods['title']}\" moved from 2026-11-09 to {$free}\n";
        }
        if (($hang = $at('2026-11-08', 'Hangover cures')) && !$taken('2026-11-09')) {
            $move->execute(['2026-11-09', $hang['id']]);
            echo "  OK  dw: \"{$hang['title']}\" moved from 2026-11-08 to 2026-11-09\n";
        }
        if (!$taken('2026-11-08')) {
            $pdo->prepare("INSERT INTO dw_topics (date, title, notes, type, needs_date_check, format) VALUES ('2026-11-08', ?, ?, 'evergreen', false, 'reaction')")
                ->execute([$beer, 'Kirin Global Beer Consumption Report 2024 (Dec 2025), liters per person, top 20. Keep it light: never encourage excessive drinking.']);
            echo "  OK  dw: \"{$beer}\" on 2026-11-08 (reaction)\n";
        } else {
            echo "  --  dw: 2026-11-08 is still taken: \"{$beer}\" not created (Admin › Worlds)\n";
        }
        $pdo->commit();
    }
} catch (PDOException $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    echo "  ERR dw reaction topic: " . $e->getMessage() . "\n";
}

// Once: the hangover topic leaves Nov 9 (to the next free date) for "The countries with the most singles"
// (reaction format). A Nov 9 topic without "hangover" in its title stays put (the step says so).
try {
    $singles = 'The countries with the most singles';
    $has = $pdo->prepare("SELECT 1 FROM dw_topics WHERE title = ?");
    $has->execute([$singles]);
    if ($has->fetchColumn() === false) {
        $pdo->beginTransaction();
        $nov9 = $pdo->query("SELECT id, title FROM dw_topics WHERE date = '2026-11-09'")->fetch(PDO::FETCH_ASSOC);
        if ($nov9 !== false && stripos($nov9['title'], 'hangover') !== false) {
            $free = (string) $pdo->query("
                SELECT d::date::text FROM generate_series('2026-11-10'::date, '2027-12-31'::date, '1 day') d
                WHERE NOT EXISTS (SELECT 1 FROM dw_topics t WHERE t.date = d::date) ORDER BY d LIMIT 1
            ")->fetchColumn();
            $pdo->prepare("UPDATE dw_topics SET date = ?::date, updated_at = now() WHERE id = ?")->execute([$free, $nov9['id']]);
            echo "  OK  dw: \"{$nov9['title']}\" moved from 2026-11-09 to {$free}\n";
            $nov9 = false;
        }
        if ($nov9 === false) {
            $pdo->prepare("INSERT INTO dw_topics (date, title, notes, type, needs_date_check, format) VALUES ('2026-11-09', ?, ?, 'evergreen', false, 'reaction')")
                ->execute([$singles, 'UN World Marriage Data 2019: % of women aged 30-34 never married, latest value per country (2010s). Never mock singles.']);
            echo "  OK  dw: \"{$singles}\" on 2026-11-09 (reaction)\n";
        } else {
            echo "  --  dw: 2026-11-09 is taken by \"{$nov9['title']}\": \"{$singles}\" not created (Admin › Worlds)\n";
        }
        $pdo->commit();
    }
} catch (PDOException $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    echo "  ERR dw singles topic: " . $e->getMessage() . "\n";
}

// Once: "The most cat-obsessed countries in Europe 🐱" (reaction) takes Nov 10 and "What people shout when they
// get hurt" (slides) Nov 11; the McDonald's topic (Nov 10) and the singles / dating one (Nov 11, right after the
// Nov 9 singles video) move to the next free dates. A topic not matching stays put (the step says so).
try {
    $cats = 'The most cat-obsessed countries in Europe 🐱';
    $hurt = 'What people shout when they get hurt';
    $has = $pdo->prepare("SELECT 1 FROM dw_topics WHERE title IN (?, ?)");
    $has->execute([$cats, $hurt]);
    if ($has->fetchColumn() === false) {
        $pdo->beginTransaction();
        $nextFree = static fn() => (string) $pdo->query("
            SELECT d::date::text FROM generate_series('2026-11-12'::date, '2027-12-31'::date, '1 day') d
            WHERE NOT EXISTS (SELECT 1 FROM dw_topics t WHERE t.date = d::date) ORDER BY d LIMIT 1
        ")->fetchColumn();
        $move = $pdo->prepare("UPDATE dw_topics SET date = ?::date, updated_at = now() WHERE id = ?");
        $plan = [
            ['2026-11-10', static fn($t) => stripos($t, 'mcdonald') !== false, $cats, 'evergreen', 'reaction',
             'FEDIAF Facts & Figures 2026: % of households owning at least one cat (2024), the 15 countries with national association data. Europe only.'],
            ['2026-11-11', static fn($t) => stripos($t, 'single') !== false || stripos($t, 'dating') !== false, $hurt, 'evergreen', 'slides',
             "Angle: what people shout when they get hurt in each language (ouch, aïe, ui da in Vietnam, itai in Japan...). Pick the funniest and most surprising ones. Hook: 'Stub your toe in Japan and you'll shout… 🦶💥'. Outro question: 'What do YOU shout when you get hurt?'"],
        ];
        foreach ($plan as [$date, $matches, $title, $type, $format, $notes]) {
            $q = $pdo->prepare("SELECT id, title FROM dw_topics WHERE date = ?::date");
            $q->execute([$date]);
            $old = $q->fetch(PDO::FETCH_ASSOC);
            if ($old !== false && $matches($old['title'])) {
                $free = $nextFree();
                $move->execute([$free, $old['id']]);
                echo "  OK  dw: \"{$old['title']}\" moved from {$date} to {$free}\n";
                $old = false;
            }
            if ($old === false) {
                $pdo->prepare("INSERT INTO dw_topics (date, title, notes, type, needs_date_check, format) VALUES (?::date, ?, ?, ?, false, ?)")
                    ->execute([$date, $title, $notes, $type, $format]);
                echo "  OK  dw: \"{$title}\" on {$date} ({$format})\n";
            } else {
                echo "  --  dw: {$date} is taken by \"{$old['title']}\": \"{$title}\" not created (Admin › Worlds)\n";
            }
        }
        $pdo->commit();
    }
} catch (PDOException $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    echo "  ERR dw Nov 10-11 topics: " . $e->getMessage() . "\n";
}

// Once: "The countries that eat the most instant noodles" (reaction) takes Nov 11; the Nov 11 topic with
// "shout" in its title moves to the next free date. Another Nov 11 topic stays put (the step says so).
try {
    $noodles = 'The countries that eat the most instant noodles';
    $has = $pdo->prepare("SELECT 1 FROM dw_topics WHERE title = ?");
    $has->execute([$noodles]);
    if ($has->fetchColumn() === false) {
        $pdo->beginTransaction();
        $nov11 = $pdo->query("SELECT id, title FROM dw_topics WHERE date = '2026-11-11'")->fetch(PDO::FETCH_ASSOC);
        if ($nov11 !== false && stripos($nov11['title'], 'shout') !== false) {
            $free = (string) $pdo->query("
                SELECT d::date::text FROM generate_series('2026-11-12'::date, '2027-12-31'::date, '1 day') d
                WHERE NOT EXISTS (SELECT 1 FROM dw_topics t WHERE t.date = d::date) ORDER BY d LIMIT 1
            ")->fetchColumn();
            $pdo->prepare("UPDATE dw_topics SET date = ?::date, updated_at = now() WHERE id = ?")->execute([$free, $nov11['id']]);
            echo "  OK  dw: \"{$nov11['title']}\" moved from 2026-11-11 to {$free}\n";
            $nov11 = false;
        }
        if ($nov11 === false) {
            $pdo->prepare("INSERT INTO dw_topics (date, title, notes, type, needs_date_check, format) VALUES ('2026-11-11', ?, ?, 'evergreen', false, 'reaction')")
                ->execute([$noodles, "WINA per capita servings, 2024 top 10 (WINA's 2025 data confirms Vietnam #1). Vietnam vs South Korea duel."]);
            echo "  OK  dw: \"{$noodles}\" on 2026-11-11 (reaction)\n";
        } else {
            echo "  --  dw: 2026-11-11 is taken by \"{$nov11['title']}\": \"{$noodles}\" not created (Admin › Worlds)\n";
        }
        $pdo->commit();
    }
} catch (PDOException $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    echo "  ERR dw noodles topic: " . $e->getMessage() . "\n";
}

// Once: "The price of a Big Mac around the world" (reaction) takes Nov 12; the Nov 12 topic with "sneeze" in its
// title moves to the next free date. Another Nov 12 topic stays put (the step says so).
try {
    $bigmac = 'The price of a Big Mac around the world';
    $has = $pdo->prepare("SELECT 1 FROM dw_topics WHERE title = ?");
    $has->execute([$bigmac]);
    if ($has->fetchColumn() === false) {
        $pdo->beginTransaction();
        $nov12 = $pdo->query("SELECT id, title FROM dw_topics WHERE date = '2026-11-12'")->fetch(PDO::FETCH_ASSOC);
        if ($nov12 !== false && stripos($nov12['title'], 'sneeze') !== false) {
            $free = (string) $pdo->query("
                SELECT d::date::text FROM generate_series('2026-11-13'::date, '2027-12-31'::date, '1 day') d
                WHERE NOT EXISTS (SELECT 1 FROM dw_topics t WHERE t.date = d::date) ORDER BY d LIMIT 1
            ")->fetchColumn();
            $pdo->prepare("UPDATE dw_topics SET date = ?::date, updated_at = now() WHERE id = ?")->execute([$free, $nov12['id']]);
            echo "  OK  dw: \"{$nov12['title']}\" moved from 2026-11-12 to {$free}\n";
            $nov12 = false;
        }
        if ($nov12 === false) {
            $pdo->prepare("INSERT INTO dw_topics (date, title, notes, type, needs_date_check, format) VALUES ('2026-11-12', ?, ?, 'evergreen', false, 'reaction')")
                ->execute([$bigmac, 'The Economist Big Mac Index, July 2026, dollar prices: the 12 dearest, the US (reference), a separator, Vietnam and the 5 cheapest.']);
            echo "  OK  dw: \"{$bigmac}\" on 2026-11-12 (reaction)\n";
        } else {
            echo "  --  dw: 2026-11-12 is taken by \"{$nov12['title']}\": \"{$bigmac}\" not created (Admin › Worlds)\n";
        }
        $pdo->commit();
    }
} catch (PDOException $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    echo "  ERR dw Big Mac topic: " . $e->getMessage() . "\n";
}

// Once: "The countries where people laugh the most" (reaction) takes Nov 13 (Friday the 13th); the Nov 13 topic
// with "Friday the 13th" in its title moves to the next free date. Another Nov 13 topic stays put (the step says so).
try {
    $laugh = 'The countries where people laugh the most';
    $has = $pdo->prepare("SELECT 1 FROM dw_topics WHERE title = ?");
    $has->execute([$laugh]);
    if ($has->fetchColumn() === false) {
        $pdo->beginTransaction();
        $nov13 = $pdo->query("SELECT id, title FROM dw_topics WHERE date = '2026-11-13'")->fetch(PDO::FETCH_ASSOC);
        if ($nov13 !== false && stripos($nov13['title'], 'friday the 13th') !== false) {
            $free = (string) $pdo->query("
                SELECT d::date::text FROM generate_series('2026-11-14'::date, '2027-12-31'::date, '1 day') d
                WHERE NOT EXISTS (SELECT 1 FROM dw_topics t WHERE t.date = d::date) ORDER BY d LIMIT 1
            ")->fetchColumn();
            $pdo->prepare("UPDATE dw_topics SET date = ?::date, updated_at = now() WHERE id = ?")->execute([$free, $nov13['id']]);
            echo "  OK  dw: \"{$nov13['title']}\" moved from 2026-11-13 to {$free}\n";
            $nov13 = false;
        }
        if ($nov13 === false) {
            $pdo->prepare("INSERT INTO dw_topics (date, title, notes, type, needs_date_check, format) VALUES ('2026-11-13', ?, ?, 'dated', false, 'reaction')")
                ->execute([$laugh, "Friday the 13th. Gallup Global Emotions 2026: % who smiled or laughed a lot yesterday (2025, 140 countries), top 20."]);
            echo "  OK  dw: \"{$laugh}\" on 2026-11-13 (reaction)\n";
        } else {
            echo "  --  dw: 2026-11-13 is taken by \"{$nov13['title']}\": \"{$laugh}\" not created (Admin › Worlds)\n";
        }
        $pdo->commit();
    }
} catch (PDOException $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    echo "  ERR dw laughing topic: " . $e->getMessage() . "\n";
}

// Once: "Places with more tourists than locals" (reaction) takes Nov 14; the topic there (not published) moves
// to the next free date.
try {
    $tourists = 'Places with more tourists than locals';
    $has = $pdo->prepare("SELECT 1 FROM dw_topics WHERE title = ?");
    $has->execute([$tourists]);
    if ($has->fetchColumn() === false) {
        $pdo->beginTransaction();
        $nov14 = $pdo->query("SELECT id, title, status FROM dw_topics WHERE date = '2026-11-14'")->fetch(PDO::FETCH_ASSOC);
        if ($nov14 !== false && $nov14['status'] !== 'published') {
            $free = (string) $pdo->query("
                SELECT d::date::text FROM generate_series('2026-11-15'::date, '2027-12-31'::date, '1 day') d
                WHERE NOT EXISTS (SELECT 1 FROM dw_topics t WHERE t.date = d::date) ORDER BY d LIMIT 1
            ")->fetchColumn();
            $pdo->prepare("UPDATE dw_topics SET date = ?::date, updated_at = now() WHERE id = ?")->execute([$free, $nov14['id']]);
            echo "  OK  dw: \"{$nov14['title']}\" moved from 2026-11-14 to {$free}\n";
            $nov14 = false;
        }
        if ($nov14 === false) {
            $pdo->prepare("INSERT INTO dw_topics (date, title, notes, type, needs_date_check, format) VALUES ('2026-11-14', ?, ?, 'evergreen', false, 'reaction')")
                ->execute([$tourists, 'UN Tourism overnight visitors / UN WPP 2024 population, 2019 (last year before the pandemic), countries & territories, top 20. Approved two-source exception.']);
            echo "  OK  dw: \"{$tourists}\" on 2026-11-14 (reaction)\n";
        } else {
            echo "  --  dw: 2026-11-14 is taken by a published topic, \"{$nov14['title']}\": \"{$tourists}\" not created (Admin › Worlds)\n";
        }
        $pdo->commit();
    }
} catch (PDOException $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    echo "  ERR dw tourists topic: " . $e->getMessage() . "\n";
}

// Once: "Sunday couch champions: where adults move the least" (reaction) takes Nov 15 (a Sunday); the Nov 15
// topic with "breakfast" in its title moves to the next free date (its date only: title, notes and packages kept).
// Another Nov 15 topic stays put (the step says so).
try {
    $couch = 'Sunday couch champions: where adults move the least';
    $has = $pdo->prepare("SELECT 1 FROM dw_topics WHERE title = ?");
    $has->execute([$couch]);
    if ($has->fetchColumn() === false) {
        $pdo->beginTransaction();
        $nov15 = $pdo->query("SELECT id, title FROM dw_topics WHERE date = '2026-11-15'")->fetch(PDO::FETCH_ASSOC);
        if ($nov15 !== false && stripos($nov15['title'], 'breakfast') !== false) {
            $free = (string) $pdo->query("
                SELECT d::date::text FROM generate_series('2026-11-16'::date, '2027-12-31'::date, '1 day') d
                WHERE NOT EXISTS (SELECT 1 FROM dw_topics t WHERE t.date = d::date) ORDER BY d LIMIT 1
            ")->fetchColumn();
            $pdo->prepare("UPDATE dw_topics SET date = ?::date, updated_at = now() WHERE id = ?")->execute([$free, $nov15['id']]);
            echo "  OK  dw: \"{$nov15['title']}\" moved from 2026-11-15 to {$free}\n";
            $nov15 = false;
        }
        if ($nov15 === false) {
            $pdo->prepare("INSERT INTO dw_topics (date, title, notes, type, needs_date_check, format) VALUES ('2026-11-15', ?, ?, 'evergreen', false, 'reaction')")
                ->execute([$couch, 'WHO GHO NCD_PAA: % of adults 18+ insufficiently physically active, age-standardized, 2022, top 20 + Vietnam (#73). Light, never shaming.']);
            echo "  OK  dw: \"{$couch}\" on 2026-11-15 (reaction)\n";
        } else {
            echo "  --  dw: 2026-11-15 is taken by \"{$nov15['title']}\": \"{$couch}\" not created (Admin › Worlds)\n";
        }
        $pdo->commit();
    }
} catch (PDOException $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    echo "  ERR dw couch topic: " . $e->getMessage() . "\n";
}

// Once: the singles topic (Nov 9) and the noodles topic (Nov 11) swap dates, so the singles one lands on Singles'
// Day (11/11); their packages are kept as they are. The singles package's caption gets a first line "Happy Singles'
// Day 🎉 11/11" and #SinglesDay is added to its hashtags (once each). Nothing moves unless both are where expected
// and not published.
try {
    $q = $pdo->prepare("SELECT id, date::text AS date, status FROM dw_topics WHERE title = ?");
    $q->execute(['The countries with the most singles']);
    $singles = $q->fetch(PDO::FETCH_ASSOC);
    $q->execute(['The countries that eat the most instant noodles']);
    $noodles = $q->fetch(PDO::FETCH_ASSOC);
    if ($singles && $noodles && $singles['date'] === '2026-11-09' && $noodles['date'] === '2026-11-11') {
        if ($singles['status'] === 'published' || $noodles['status'] === 'published') {
            echo "  --  dw: singles / noodles not swapped: one of them is published (Admin › Worlds)\n";
        } else {
            $pdo->beginTransaction();
            $move = $pdo->prepare("UPDATE dw_topics SET date = ?::date, updated_at = now() WHERE id = ?");
            $move->execute(['1900-01-01', $singles['id']]);   // dw_topics.date is unique: park it while the other moves
            $move->execute(['2026-11-09', $noodles['id']]);
            $move->execute(['2026-11-11', $singles['id']]);
            $pdo->prepare("
                UPDATE dw_packages SET content = jsonb_set(content, '{caption}', to_jsonb(? || E'\n\n' || (content->>'caption')))
                WHERE topic_id = ? AND position('Happy Singles'' Day' IN content->>'caption') = 0
            ")->execute(["Happy Singles' Day 🎉 11/11", $singles['id']]);
            $pdo->prepare("
                UPDATE dw_packages SET content = jsonb_set(content, '{hashtags}', COALESCE(content->'hashtags', '[]'::jsonb) || '[\"#SinglesDay\"]'::jsonb)
                WHERE topic_id = ? AND NOT (COALESCE(content->'hashtags', '[]'::jsonb) @> '[\"#SinglesDay\"]'::jsonb)
            ")->execute([$singles['id']]);
            $pdo->commit();
            echo "  OK  dw: \"The countries with the most singles\" on 2026-11-11, \"The countries that eat the most instant noodles\" on 2026-11-09 (packages kept; Singles' Day line + #SinglesDay)\n";
        }
    }
} catch (PDOException $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    echo "  ERR dw singles / noodles swap: " . $e->getMessage() . "\n";
}

// Once: today's challenge (2026-11-09, live) "Look up and find a year written on a facade." was too hard: replaced
// by "Snap a building facade that looks typical of your city." through the admin's own service functions
// (DailyAdminService: the English, its 18 translations, the headline, the comparison question, the Saigon Local
// Twist and its translations). Theme, cover, status and posted photos untouched. Runs only while the old text is there.
try {
    $nov9 = $pdo->query("SELECT id, text_i18n->>'en' AS en FROM daily_challenges WHERE challenge_date = '2026-11-09'")->fetch(PDO::FETCH_ASSOC);
    if ($nov9 && $nov9['en'] === 'Look up and find a year written on a facade.') {
        spl_autoload_register(static function (string $class): void {
            $file = __DIR__ . '/src/' . $class . '.php';
            if (preg_match('/^[A-Za-z0-9_]+$/', $class) && is_file($file)) require_once $file;
        });
        $new = json_decode(<<<'JSON'
{"headline": {"en": "Find your city's signature facade.", "fr": "Trouve la façade typique de ta ville.", "vi": "Tìm mặt tiền đậm chất thành phố bạn.", "es": "Encuentra la fachada típica de tu ciudad.", "it": "Trova la facciata tipica della tua città.", "pt-br": "Encontre a fachada típica da sua cidade.", "pt-pt": "Encontra a fachada típica da tua cidade.", "de": "Finde die typische Fassade deiner Stadt.", "nl": "Vind de typische gevel van jouw stad.", "zh-hans": "找到你所在城市的标志性立面。", "zh-hant": "找到你所在城市的代表性立面。", "ja": "あなたの街らしい外観を探しましょう。", "ko": "우리 도시다운 건물을 찾아보세요.", "fil": "Hanapin ang tipikal na harapan sa city mo.", "th": "หาหน้าตึกที่เป็นเอกลักษณ์ของเมืองคุณ", "id": "Temukan fasad khas kotamu.", "hi": "अपने शहर की खास इमारत ढूँढें।", "ru": "Найди фасад, типичный для твоего города.", "ar": "ابحث عن الواجهة التي تميّز مدينتك."}, "text": {"en": "Snap a building facade that looks typical of your city.", "fr": "Prends en photo une façade typique de ta ville.", "vi": "Chụp một mặt tiền nhà mang đậm chất thành phố của bạn.", "es": "Haz una foto de una fachada típica de tu ciudad.", "it": "Fotografa una facciata tipica della tua città.", "pt-br": "Fotografe uma fachada típica da sua cidade.", "pt-pt": "Fotografa uma fachada típica da tua cidade.", "de": "Fotografiere eine Fassade, die typisch für deine Stadt ist.", "nl": "Fotografeer een gevel die typisch is voor jouw stad.", "zh-hans": "拍一栋最能代表你所在城市的建筑立面。", "zh-hant": "拍一棟最能代表你所在城市的建築立面。", "ja": "あなたの街らしい建物の外観を撮ってみましょう。", "ko": "우리 도시다운 건물 외관을 사진으로 찍어 보세요.", "fil": "Kunan ng photo ang harapan ng gusaling tipikal sa city mo.", "th": "ถ่ายรูปหน้าตึกที่เป็นเอกลักษณ์ของเมืองคุณ", "id": "Foto fasad bangunan yang khas kotamu.", "hi": "अपने शहर की पहचान वाली किसी इमारत के सामने वाले हिस्से की फ़ोटो लें।", "ru": "Сфотографируй фасад, типичный для твоего города.", "ar": "صوّر واجهة مبنى تعبّر عن طابع مدينتك."}, "context": {"en": "Tube houses, Haussmann, brownstones: every city has its own look.", "fr": "Maisons-tubes, haussmannien, brownstones : chaque ville a son style.", "vi": "Nhà ống, kiểu Haussmann, brownstone: thành phố nào cũng có nét riêng.", "es": "Casas tubo, edificios Haussmann, brownstones: cada ciudad tiene su estilo.", "it": "Case tubo, palazzi Haussmann, brownstone: ogni città ha il suo stile.", "pt-br": "Casas-tubo, prédios Haussmann, brownstones: cada cidade tem seu estilo.", "pt-pt": "Casas-tubo, prédios Haussmann, brownstones: cada cidade tem o seu estilo.", "de": "Röhrenhäuser, Haussmann-Bauten, Brownstones: Jede Stadt hat ihren eigenen Look.", "nl": "Buishuizen, Haussmann-gevels, brownstones: elke stad heeft zijn eigen look.", "zh-hans": "竹筒屋、奥斯曼式建筑、褐石屋：每座城市都有自己的模样。", "zh-hant": "竹筒屋、奧斯曼式建築、褐石屋：每座城市都有自己的模樣。", "ja": "チューブハウス、オスマン様式、ブラウンストーン。どの街にも、その街らしい顔があります。", "ko": "튜브하우스, 오스만 양식, 브라운스톤까지. 도시마다 고유의 모습이 있어요.", "fil": "Tube house, Haussmann, brownstone: bawat city ay may sariling itsura.", "th": "บ้านทรงหลอด ตึกแบบโอสมานน์ บราวน์สโตน ทุกเมืองมีหน้าตาเป็นของตัวเอง", "id": "Rumah tabung, gaya Haussmann, brownstone: setiap kota punya wajahnya sendiri.", "hi": "ट्यूब हाउस, हॉसमैन इमारतें, ब्राउनस्टोन: हर शहर का अपना अलग रूप होता है।", "ru": "Дома-трубки, османовские фасады, браунстоуны: у каждого города свой облик.", "ar": "بيوت أنبوبية، وعمارة هوسمان، ومنازل البراونستون: لكل مدينة طابعها الخاص."}, "compare": {"en": "What year was it built? A guess is fine.", "fr": "Elle date de quelle année ? Une estimation suffit.", "vi": "Nhà này xây năm nào? Đoán thôi cũng được.", "es": "¿De qué año es? Basta con adivinar.", "it": "Di che anno è? Va bene anche a occhio.", "pt-br": "De que ano é? Pode chutar.", "pt-pt": "De que ano é? Um palpite chega.", "de": "Aus welchem Jahr ist es? Schätzen ist erlaubt.", "nl": "Uit welk jaar is het? Gokken mag.", "zh-hans": "它是哪一年建的？猜一猜也行。", "zh-hant": "它是哪一年建的？猜一猜也行。", "ja": "何年に建てられたと思いますか？予想でOKです。", "ko": "몇 년에 지어졌을까요? 짐작해도 괜찮아요.", "fil": "Anong taon ito itinayo? Puwede ang hula.", "th": "ตึกนี้สร้างปีไหน เดาก็ได้", "id": "Dibangun tahun berapa? Tebak saja boleh.", "hi": "यह किस साल बनी थी? अंदाज़ा भी चलेगा।", "ru": "В каком году его построили? Можно наугад.", "ar": "في أي عام بُني؟ يكفي التخمين."}, "twist": {"en": "Look for a narrow nhà ống with colorful balconies, plants and tangled wires.", "fr": "Cherche une nhà ống étroite avec des balcons colorés, des plantes et des fils emmêlés.", "vi": "Tìm một căn nhà ống hẹp với ban công nhiều màu, cây xanh và dây điện chằng chịt.", "es": "Busca una nhà ống estrecha con balcones de colores, plantas y cables enredados.", "it": "Cerca una nhà ống stretta con balconi colorati, piante e fili aggrovigliati.", "pt-br": "Procure uma nhà ống estreita com varandas coloridas, plantas e fios emaranhados.", "pt-pt": "Procura uma nhà ống estreita com varandas coloridas, plantas e fios emaranhados.", "de": "Such ein schmales nhà ống mit bunten Balkonen, Pflanzen und Kabelsalat.", "nl": "Zoek een smal nhà ống met kleurrijke balkons, planten en kluwens kabels.", "zh-hans": "找一栋窄窄的 nhà ống，阳台五颜六色，摆满绿植，电线缠成一团。", "zh-hant": "找一棟窄窄的 nhà ống，陽台五顏六色，擺滿綠植，電線纏成一團。", "ja": "カラフルなバルコニーに植物、絡まった電線のある細長い nhà ống を探してみましょう。", "ko": "알록달록한 발코니와 화분, 엉킨 전선이 있는 좁은 nhà ống을 찾아보세요.", "fil": "Maghanap ng makitid na nhà ống na may makukulay na balkonahe, mga halaman at gusot na kable.", "th": "มองหา nhà ống แคบๆ ที่มีระเบียงสีสดใส ต้นไม้ และสายไฟพันกันยุ่ง", "id": "Cari nhà ống sempit dengan balkon warna-warni, tanaman, dan kabel yang kusut.", "hi": "रंग-बिरंगी बालकनियों, पौधों और उलझे तारों वाला कोई पतला nhà ống खोजें।", "ru": "Найди узкий nhà ống с разноцветными балконами, растениями и спутанными проводами.", "ar": "ابحث عن بيت nhà ống ضيّق بشرفات ملوّنة ونباتات وأسلاك متشابكة."}}
JSON, true, 512, JSON_THROW_ON_ERROR);
        $tr = static fn(array $m): array => array_diff_key($m, ['en' => 1]);
        $id = (string) $nov9['id'];
        DailyAdminService::updateChallenge($id, ['text' => $new['text']['en'], 'context' => $new['context']['en']]);
        DailyAdminService::setChallengeTranslations($id, $tr($new['text']), $tr($new['context']));
        DailyAdminService::setChallengeHeadline($id, $new['headline']['en'], $tr($new['headline']));
        // The comparison question: the same type, key, title, unit and price, a new question (no one had answered).
        $row = $pdo->query("SELECT compare_type, compare_key, compare_title_i18n, compare_unit_i18n, price_key, price_label_i18n FROM daily_challenges WHERE id = " . $pdo->quote($id))->fetch(PDO::FETCH_ASSOC);
        $j = static fn(?string $v): ?array => $v !== null ? array_diff_key(json_decode($v, true) ?: [], ['_src' => 1]) : null;
        DailyAdminService::setChallengeCompare($id, [
            'type' => $row['compare_type'] ?: 'word', 'question' => $new['compare'], 'key' => $row['compare_key'],
            'title' => $j($row['compare_title_i18n']), 'unit' => $j($row['compare_unit_i18n']),
            'price' => $row['price_key'] !== null ? ['key' => $row['price_key'], 'label' => $j($row['price_label_i18n'])] : null,
        ]);
        // The Saigon Local Twist: its author and credit kept.
        $saigon = DailyAdminService::cityIdForSlug('ho-chi-minh-city');
        $tw = $pdo->prepare("SELECT id, city_id, author_user_id, author_credit FROM daily_twists WHERE challenge_id = ? AND city_id = ? AND status = 'selected'");
        $tw->execute([$id, (string) $saigon]);
        $twist = $tw->fetch(PDO::FETCH_ASSOC);
        if ($twist) {
            $saved = DailyAdminService::setTwist($id, (string) $twist['city_id'], $new['twist']['en'], $twist['author_user_id'], $twist['author_credit']);
            DailyAdminService::setTwistTranslations((string) $saved['id'], $tr($new['twist']));
        }
        echo "  OK  daily: 2026-11-09 replaced by \"{$new['text']['en']}\" (19 locales: text, context, headline, comparison question" . ($twist ? ', Saigon Local Twist' : ', no Saigon Local Twist found') . ")\n";
    }
} catch (Throwable $e) {
    echo "  ERR daily 2026-11-09 replacement: " . $e->getMessage() . "\n";
}

// Once: two reaction questions shortened to fit the on-screen question (max 7 words), through DwStudio::updateField
// (as the admin's field: the caption's last line follows). Only while each still has its old text.
try {
    spl_autoload_register(static function (string $class): void {
        $file = __DIR__ . '/src/' . $class . '.php';
        if (preg_match('/^[A-Za-z0-9_]+$/', $class) && is_file($file)) require_once $file;
    });
    $short = [
        '2026-11-09' => ['How many packs did YOU eat this week? 🍜', 'How many packs this week? 🍜'],
        '2026-11-12' => ['How much is a Big Mac where you live? 🍔', 'Big Mac price where you live? 🍔'],
    ];
    foreach ($short as $date => [$old, $new]) {
        $topic = DwStudio::topicByDate($date);
        $pkg = $topic !== null ? DwStudio::package($topic['id']) : null;
        if ($pkg !== null && ($pkg['content']['outro_question'] ?? null) === $old) {
            DwStudio::updateField($pkg['id'], 'outro_question', $new);
            echo "  OK  dw: {$date} question \"{$new}\"\n";
        }
    }
} catch (Throwable $e) {
    echo "  ERR dw short questions: " . $e->getMessage() . "\n";
}

// The reaction format's second PNG (its closing slide, the question), for carousels.
// Reversal: ALTER TABLE dw_packages DROP COLUMN still2_url.
run($pdo, "ALTER TABLE dw_packages ADD COLUMN IF NOT EXISTS still2_url TEXT", 'dw_packages.still2_url');
// Once: Nov 9 (noodles) question and detail, through DwStudio::updateField (as the admin's fields: the caption follows).
try {
    $topic = DwStudio::topicByDate('2026-11-09');
    $pkg = $topic !== null ? DwStudio::package($topic['id']) : null;
    if ($pkg !== null && ($pkg['content']['outro_question'] ?? null) === 'How many packs this week? 🍜') {
        DwStudio::updateField($pkg['id'], 'outro_question', 'How many did YOU eat this week? 🍜');
        DwStudio::updateField($pkg['id'], 'detail', 'Vietnam 🇻🇳 beats Korea 🇰🇷. Again. 🍜');
        echo "  OK  dw: 2026-11-09 question \"How many did YOU eat this week? 🍜\", detail \"Vietnam 🇻🇳 beats Korea 🇰🇷. Again. 🍜\"\n";
    }
} catch (Throwable $e) {
    echo "  ERR dw Nov 9 question: " . $e->getMessage() . "\n";
}

// The store review account (App Store / Google Play "App access"): created through the normal signup,
// flagged here: is_review (no push, no analytics, kept when "deleted", login not rate limited) and
// hidden_from_rankings (out of every ranking). It never posts photos of its own to real users.
// Reversal: UPDATE users SET is_review = false; ALTER TABLE users DROP COLUMN is_review.
run($pdo, "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_review BOOLEAN NOT NULL DEFAULT false", 'users.is_review');
try {
    $n = $pdo->exec("UPDATE users SET is_review = true, hidden_from_rankings = true
                     WHERE lower(email) = 'review@hilads.live' AND username = 'hilads_review' AND deleted_at IS NULL
                       AND (NOT is_review OR NOT hidden_from_rankings)");
    if ($n > 0) {
        $pdo->exec("DELETE FROM mobile_push_tokens WHERE user_id IN (SELECT id FROM users WHERE is_review)");
        echo "  OK  users: hilads_review flagged as the store review account\n";
    }
} catch (PDOException $e) {
    echo "  ERR review account: " . $e->getMessage() . "\n";
}

// Once: the light ranking card's color and orange headline words for the reaction packages of Nov 9 to 15,
// through DwStudio::updateField (as the admin's fields); only where no color is set yet and the words are in the headline.
try {
    $cards = [
        '2026-11-09' => ['yellow', 'instant noodle'], '2026-11-10' => ['pink', 'cat-obsessed'],
        '2026-11-11' => ['pink', 'full of singles'], '2026-11-12' => ['yellow', 'Very different price'],
        '2026-11-13' => ['blue', 'still laughing'], '2026-11-14' => ['blue', 'more tourists than locals'],
        '2026-11-15' => ['green', 'couch champions'],
    ];
    foreach ($cards as $date => [$bg, $accent]) {
        $topic = DwStudio::topicByDate($date);
        $pkg = $topic !== null ? DwStudio::package($topic['id']) : null;
        if ($pkg === null || !DwReaction::isReaction($pkg['content']) || isset($pkg['content']['card_bg'])) {
            continue;
        }
        DwStudio::updateField($pkg['id'], 'card_bg', $bg);
        if (mb_stripos((string) ($pkg['content']['headline'] ?? ''), $accent) !== false) {
            DwStudio::updateField($pkg['id'], 'headline_accent', $accent);
        }
        echo "  OK  dw: {$date} card {$bg}, \"{$accent}\" in orange\n";
    }
} catch (Throwable $e) {
    echo "  ERR dw card colors: " . $e->getMessage() . "\n";
}

// Once: Nov 10 (cats) headline, orange words, banner and question, through DwStudio::updateField (as the admin's
// fields: the caption's last line follows the question); only while the old headline is there.
try {
    $topic = DwStudio::topicByDate('2026-11-10');
    $pkg = $topic !== null ? DwStudio::package($topic['id']) : null;
    if ($pkg !== null && ($pkg['content']['headline'] ?? null) === "Europe's most cat-obsessed countries 🐱") {
        DwStudio::updateField($pkg['id'], 'headline', "Europe's most cat-addicted countries 🐱");
        DwStudio::updateField($pkg['id'], 'headline_accent', 'cat-addicted');
        DwStudio::updateField($pkg['id'], 'detail', '🇪🇸 Spain: cats rule over half the homes 🐈');
        DwStudio::updateField($pkg['id'], 'outro_question', 'Asia, Americas, Africa: are YOU cat people too? 🐱');
        echo "  OK  dw: 2026-11-10 headline \"Europe's most cat-addicted countries 🐱\", banner and question updated\n";
    }
} catch (Throwable $e) {
    echo "  ERR dw Nov 10 texts: " . $e->getMessage() . "\n";
}

// Once: the reaction video now shows the top 10: two headlines that promised 20, through DwStudio::updateField
// (as the admin's field); only while the old headline is there.
try {
    foreach (['2026-11-11' => ['20 countries full of singles 😎', '10 countries full of singles 😎'],
              '2026-11-15' => ['The 20 Sunday couch champions 🛋️', 'The 10 Sunday couch champions 🛋️']] as $date => [$old, $new]) {
        $topic = DwStudio::topicByDate($date);
        $pkg = $topic !== null ? DwStudio::package($topic['id']) : null;
        if ($pkg !== null && ($pkg['content']['headline'] ?? null) === $old) {
            DwStudio::updateField($pkg['id'], 'headline', $new);
            echo "  OK  dw: {$date} headline \"{$new}\" (the video shows the top 10)\n";
        }
    }
} catch (Throwable $e) {
    echo "  ERR dw top 10 headlines: " . $e->getMessage() . "\n";
}

// Once: the reaction format's closing slide (7 to 10 s) shows the topic's own question and its invitation to Hilads
// (cta_line, with hilads.live): one per unpublished reaction package, through DwStudio::updateField (as the admin's
// field), only where none is set; and Nov 8's headline says 10 (the video shows the top 10).
try {
    $ctas = [
        '2026-11-08' => 'Snap your local beer on hilads.live 🍻',
        '2026-11-09' => 'Show the world your bowl on hilads.live 🍜',
        '2026-11-10' => 'Show us your cat on hilads.live 🐱',
        '2026-11-11' => "Snap your city's best date spot on hilads.live 💘",
        '2026-11-12' => 'Show us your local burger on hilads.live 🍔',
        '2026-11-13' => 'Share what made you laugh on hilads.live 😂',
        '2026-11-14' => 'Show us your tourist hotspot on hilads.live 📸',
        '2026-11-15' => 'Show us your Sunday couch on hilads.live 🛋️',
    ];
    foreach ($ctas as $date => $cta) {
        $topic = DwStudio::topicByDate($date);
        $pkg = $topic !== null ? DwStudio::package($topic['id']) : null;
        if ($pkg === null || $topic['status'] === 'published' || !DwReaction::isReaction($pkg['content'])) {
            continue;
        }
        if (trim((string) ($pkg['content']['cta_line'] ?? '')) === '') {
            DwStudio::updateField($pkg['id'], 'cta_line', $cta);
            echo "  OK  dw: {$date} invitation \"{$cta}\"\n";
        }
        if ($date === '2026-11-08' && ($pkg['content']['headline'] ?? null) === 'The 20 biggest beer drinkers 🍺') {
            DwStudio::updateField($pkg['id'], 'headline', 'The 10 biggest beer drinkers 🍺');
            echo "  OK  dw: 2026-11-08 headline \"The 10 biggest beer drinkers 🍺\"\n";
        }
    }
} catch (Throwable $e) {
    echo "  ERR dw invitations: " . $e->getMessage() . "\n";
}

// The reaction format's quiz mode: a third PNG (quiz: 01 the quiz question, 02 the ranking, 03 the closing slide).
// Reversal: ALTER TABLE dw_packages DROP COLUMN still3_url.
run($pdo, "ALTER TABLE dw_packages ADD COLUMN IF NOT EXISTS still3_url TEXT", 'dw_packages.still3_url');
// Once: Nov 11 (singles) and Nov 14 (tourists) in quiz mode, through DwStudio::updateField (as the admin's fields: the
// caption's last line follows the question); only while they have no mode and are not published.
try {
    $quizzes = [
        '2026-11-11' => ['Where have most women 30–34 never married? 💍', 'Did YOU guess right? 💍'],
        '2026-11-14' => ['Where do tourists outnumber locals the most? ✈️', 'Did YOU guess right? ✈️'],
    ];
    foreach ($quizzes as $date => [$quiz, $question]) {
        $topic = DwStudio::topicByDate($date);
        $pkg = $topic !== null ? DwStudio::package($topic['id']) : null;
        if ($pkg === null || $topic['status'] === 'published' || !DwReaction::isReaction($pkg['content']) || isset($pkg['content']['mode'])) {
            continue;
        }
        DwStudio::updateField($pkg['id'], 'quiz_question', $quiz);
        DwStudio::updateField($pkg['id'], 'outro_question', $question);
        DwStudio::updateField($pkg['id'], 'mode', 'quiz');
        echo "  OK  dw: {$date} quiz \"{$quiz}\", closing \"{$question}\"\n";
    }
} catch (Throwable $e) {
    echo "  ERR dw quizzes: " . $e->getMessage() . "\n";
}

// Once: Nov 10 (cats) gets real footage instead of our AI kitten: Pixabay 131919 (a ginger kitten walking toward the
// camera in a sunny garden, by Marsel_beijing), through DwStudio::setReactionClip (as "Use this clip": copied to R2,
// author, license, source page, not AI; the AI copy is deleted); its warning about the AI label is replaced. Only
// while the AI clip is there and the topic is not published. The copy to R2 needs the Composer libraries (AWS SDK),
// which migrate.php doesn't load otherwise.
try {
    require_once __DIR__ . '/vendor/autoload.php';
    $topic = DwStudio::topicByDate('2026-11-10');
    $pkg = $topic !== null ? DwStudio::package($topic['id']) : null;
    if ($pkg !== null && $topic['status'] !== 'published' && ($pkg['content']['clip']['source'] ?? null) === 'upload'
        && !empty($pkg['content']['clip']['ai_generated'])) {
        $clip = DwStudio::setReactionClip($pkg['id'], 131919);
        $warnings = array_map(static fn($w) => str_starts_with($w, 'Clip: our own AI video')
            ? 'Clip: Pixabay 131919 by Marsel_beijing (real footage, not AI), replacing our AI kitten.' : $w, $pkg['content']['warnings'] ?? []);
        DwStudio::updateField($pkg['id'], 'warnings', implode("\n", $warnings));
        echo "  OK  dw: 2026-11-10 clip Pixabay 131919 by " . ($clip['author'] ?? '?') . " (not AI)\n";
    }
} catch (Throwable $e) {
    echo "  ERR dw Nov 10 clip: " . $e->getMessage() . "\n";
}

// Once: Nov 10's kitten clip (Pixabay 131919) is slow-motion footage: played 1.5× faster (it then covers the main
// screen, 8.3 s, without looping), through DwStudio::updateField (as the admin's field). Only while no speed is set.
try {
    $topic = DwStudio::topicByDate('2026-11-10');
    $pkg = $topic !== null ? DwStudio::package($topic['id']) : null;
    if ($pkg !== null && $topic['status'] !== 'published' && (int) ($pkg['content']['clip']['pixabay_id'] ?? 0) === 131919
        && !isset($pkg['content']['clip_speed'])) {
        DwStudio::updateField($pkg['id'], 'clip_speed', '1.5');
        echo "  OK  dw: 2026-11-10 clip at 1.5×\n";
    }
} catch (Throwable $e) {
    echo "  ERR dw Nov 10 clip speed: " . $e->getMessage() . "\n";
}

// Once: Nov 12 (Big Mac) shows Vietnam (#49, $2.89, the same July 2026 edition) after the top 10, under "• • •", highlighted;
// the banner gets its flags (Indonesia kept: 9.0419 / 2.3803 = 3.80, "almost 4", beats Vietnam's 9.0419 / 2.8946 = 3.12).
// Through DwStudio::updateField (as the admin's fields), only while the old banner is there.
try {
    $topic = DwStudio::topicByDate('2026-11-12');
    $pkg = $topic !== null ? DwStudio::package($topic['id']) : null;
    if ($pkg !== null && $topic['status'] !== 'published' && ($pkg['content']['detail'] ?? null) === '1 Big Mac in Switzerland = almost 4 in Indonesia 😳') {
        DwStudio::updateField($pkg['id'], 'extra_row', 'Vietnam');
        DwStudio::updateField($pkg['id'], 'detail', '🇨🇭 1 Big Mac in Switzerland = almost 4 in Indonesia 🇮🇩');
        echo "  OK  dw: 2026-11-12 Vietnam after the top 10, banner with flags\n";
    }
} catch (Throwable $e) {
    echo "  ERR dw Nov 12: " . $e->getMessage() . "\n";
}

// Once: Nov 11's quiz question in the banner's words, through DwStudio::updateField; only while the old one is there.
try {
    $topic = DwStudio::topicByDate('2026-11-11');
    $pkg = $topic !== null ? DwStudio::package($topic['id']) : null;
    if ($pkg !== null && $topic['status'] !== 'published' && ($pkg['content']['quiz_question'] ?? null) === 'Where have most women 30–34 never married? 💍') {
        DwStudio::updateField($pkg['id'], 'quiz_question', 'Where are most women unmarried at 30? 💍');
        echo "  OK  dw: 2026-11-11 quiz \"Where are most women unmarried at 30? 💍\"\n";
    }
} catch (Throwable $e) {
    echo "  ERR dw Nov 11 quiz: " . $e->getMessage() . "\n";
}

// The race format (DwRace): a bar chart race over the years, no clip. dw_topics.format accepts 'race'.
// Reversal: the same constraint without 'race' (after moving race topics back to another format).
run($pdo, "ALTER TABLE dw_topics DROP CONSTRAINT IF EXISTS dw_topics_format_check", 'dw_topics.format check (drop)');
run($pdo, "ALTER TABLE dw_topics ADD CONSTRAINT dw_topics_format_check CHECK (format IN ('slides', 'reaction', 'race'))", 'dw_topics.format check (slides, reaction, race)');
// Once: Nov 16 becomes the first race, "The world's most visited countries, 2000 to 2020" (UN Tourism, overnight
// visitors, the same dataset as Nov 14); "Beer customs around the world" moves to the first date with no topic.
// Separate statements (DwStudio writes through its own connection): each part runs again until it is done.
try {
    spl_autoload_register(static function (string $class): void {
        $file = __DIR__ . '/src/' . $class . '.php';
        if (preg_match('/^[A-Za-z0-9_]+$/', $class) && is_file($file)) require_once $file;
    });
    $beer = $pdo->query("SELECT id, status FROM dw_topics WHERE date = '2026-11-16' AND title = 'Beer customs around the world'")->fetch(PDO::FETCH_ASSOC);
    if ($beer && $beer['status'] !== 'published') {
        $free = $pdo->query("SELECT d::date::text FROM generate_series('2026-11-17'::date, '2027-12-31'::date, '1 day') d
                             WHERE NOT EXISTS (SELECT 1 FROM dw_topics t WHERE t.date = d::date) ORDER BY d LIMIT 1")->fetchColumn();
        $pdo->prepare("UPDATE dw_topics SET date = ?::date, updated_at = now() WHERE id = ?")->execute([$free, $beer['id']]);
        echo "  OK  dw: \"Beer customs around the world\" moved from 2026-11-16 to {$free}\n";
    }
    $title = "The world's most visited countries, 2000 to 2020";
    if (!$pdo->query("SELECT 1 FROM dw_topics WHERE date = '2026-11-16'")->fetchColumn()) {
        $pdo->prepare("INSERT INTO dw_topics (date, title, notes, type, needs_date_check, format) VALUES ('2026-11-16', ?, ?, 'evergreen', false, 'race')")
            ->execute([$title, 'Race: international tourist arrivals (overnight visitors), UN Tourism, the top 10 of each year from 2000 to 2020. France #1 every year, Spain and the US swap #2, China climbs, the 2020 collapse.']);
        echo "  OK  dw: 2026-11-16 race topic\n";
    }
    $topic = DwStudio::topicByDate('2026-11-16');
    if ($topic !== null && $topic['format'] === 'race' && $topic['title'] === $title && DwStudio::package($topic['id']) === null) {
        $content = json_decode(<<<'JSON'
{"format":"race","topic":"The world's most visited countries, 2000 to 2020","headline":"The world's most visited countries, 2000 → 2020 ✈️","headline_accent":"most visited","detail":"2020: the world stops ✈️❌","banner_year":2020,"value_label":"International tourist arrivals (overnight visitors), millions","unit":"M","source":"UN Tourism","source_url":"https://www.untourism.int/tourism-statistics/key-tourism-statistics","data_years":"2000–2020","series":[{"country":"Hong Kong","flag":"🇭🇰","values":{"2000":8.8,"2001":8.9,"2002":10.7,"2003":9.7,"2004":13.7,"2005":14.8,"2006":15.8,"2007":17.2,"2008":17.3,"2009":16.9,"2010":20.1,"2011":22.3,"2012":23.8,"2013":25.7,"2014":27.8,"2015":26.7,"2016":26.6,"2017":27.9,"2018":29.3,"2019":23.8,"2020":1.4}},{"country":"United Kingdom","flag":"🇬🇧","values":{"2000":23.2,"2001":21.0,"2002":22.3,"2003":22.8,"2004":25.7,"2005":28.0,"2006":30.7,"2007":30.9,"2008":30.1,"2009":29.4,"2010":28.9,"2011":30.4,"2012":30.4,"2013":31.9,"2014":33.6,"2015":35.1,"2016":37.4,"2017":39.5,"2018":38.7,"2019":39.4,"2020":10.7}},{"country":"United States","flag":"🇺🇸","values":{"2000":51.2,"2001":46.9,"2002":43.6,"2003":41.2,"2004":46.1,"2005":49.2,"2006":51.0,"2007":56.1,"2008":58.0,"2009":55.1,"2010":60.0,"2011":63.5,"2012":67.0,"2013":71.6,"2014":75.4,"2015":77.8,"2016":76.4,"2017":77.2,"2018":79.7,"2019":79.4,"2020":19.2}},{"country":"Austria","flag":"🇦🇹","values":{"2000":18.0,"2001":18.2,"2002":18.6,"2003":19.1,"2004":19.4,"2005":20.0,"2006":20.3,"2007":20.8,"2008":21.9,"2009":21.4,"2010":22.0,"2011":23.0,"2012":24.2,"2013":24.8,"2014":25.3,"2015":26.7,"2016":28.1,"2017":29.5,"2018":30.8,"2019":31.9,"2020":15.1}},{"country":"Canada","flag":"🇨🇦","values":{"2000":19.6,"2001":19.7,"2002":20.1,"2003":17.5,"2004":19.1,"2005":18.8,"2006":18.3,"2007":17.9,"2008":17.1,"2009":15.7,"2010":16.2,"2011":16.0,"2012":16.3,"2013":16.1,"2014":16.5,"2015":18.0,"2016":20.0,"2017":20.9,"2018":21.1,"2019":22.1,"2020":3.0}},{"country":"China","flag":"🇨🇳","values":{"2000":31.2,"2001":33.2,"2002":36.8,"2003":33.0,"2004":41.8,"2005":46.8,"2006":49.9,"2007":54.7,"2008":53.0,"2009":50.9,"2010":55.7,"2011":57.6,"2012":57.7,"2013":55.7,"2014":55.6,"2015":56.9,"2016":59.3,"2017":60.7,"2018":62.9,"2019":65.7,"2020":8.0}},{"country":"France","flag":"🇫🇷","values":{"2000":77.2,"2001":75.2,"2002":77.0,"2003":75.0,"2004":74.4,"2005":75.0,"2006":77.9,"2007":80.9,"2008":79.2,"2009":76.8,"2010":76.6,"2011":80.5,"2012":82.0,"2013":83.6,"2014":83.7,"2015":84.5,"2016":82.7,"2017":86.8,"2018":89.3,"2019":90.9,"2020":41.7}},{"country":"Germany","flag":"🇩🇪","values":{"2000":19.0,"2001":17.9,"2002":18.0,"2003":18.4,"2004":20.1,"2005":21.5,"2006":23.6,"2007":24.4,"2008":24.9,"2009":24.2,"2010":26.9,"2011":28.4,"2012":30.4,"2013":31.5,"2014":33.0,"2015":35.0,"2016":35.6,"2017":37.5,"2018":38.9,"2019":39.6,"2020":12.4}},{"country":"Greece","flag":"🇬🇷","values":{"2000":13.1,"2001":14.1,"2002":14.2,"2003":14.0,"2004":13.3,"2005":14.8,"2006":16.0,"2007":16.2,"2008":15.9,"2009":14.9,"2010":15.0,"2011":16.4,"2012":15.5,"2013":17.9,"2014":22.0,"2015":23.6,"2016":24.8,"2017":27.2,"2018":30.1,"2019":31.3,"2020":7.4}},{"country":"Italy","flag":"🇮🇹","values":{"2000":41.2,"2001":39.6,"2002":39.8,"2003":39.6,"2004":37.1,"2005":36.5,"2006":41.1,"2007":43.7,"2008":42.7,"2009":43.2,"2010":43.6,"2011":46.1,"2012":46.4,"2013":47.7,"2014":48.6,"2015":50.7,"2016":52.4,"2017":58.3,"2018":61.6,"2019":64.5,"2020":25.2}},{"country":"Malaysia","flag":"🇲🇾","values":{"2000":10.2,"2001":12.8,"2002":13.3,"2003":10.6,"2004":15.7,"2005":16.4,"2006":17.5,"2007":21.0,"2008":22.1,"2009":23.6,"2010":24.6,"2011":24.7,"2012":25.0,"2013":25.7,"2014":27.4,"2015":25.7,"2016":26.8,"2017":25.9,"2018":25.8,"2019":26.1,"2020":4.3}},{"country":"Mexico","flag":"🇲🇽","values":{"2000":20.6,"2001":19.8,"2002":19.7,"2003":18.7,"2004":20.6,"2005":21.9,"2006":21.4,"2007":21.6,"2008":22.9,"2009":22.3,"2010":23.3,"2011":23.4,"2012":23.4,"2013":24.2,"2014":29.3,"2015":32.1,"2016":35.1,"2017":39.3,"2018":41.3,"2019":45.0,"2020":24.3}},{"country":"Poland","flag":"🇵🇱","values":{"2000":17.4,"2001":15.0,"2002":14.0,"2003":13.7,"2004":14.3,"2005":15.2,"2006":15.7,"2007":15.0,"2008":13.0,"2009":11.9,"2010":12.5,"2011":13.3,"2012":14.8,"2013":15.8,"2014":16.0,"2015":16.7,"2016":17.5,"2017":18.3,"2018":19.6,"2019":21.2,"2020":8.4}},{"country":"Spain","flag":"🇪🇸","values":{"2000":46.4,"2001":48.6,"2002":50.3,"2003":50.9,"2004":52.4,"2005":55.9,"2006":58.0,"2007":58.7,"2008":57.2,"2009":52.2,"2010":52.7,"2011":56.2,"2012":57.5,"2013":60.7,"2014":64.9,"2015":68.2,"2016":75.3,"2017":81.9,"2018":82.8,"2019":83.5,"2020":18.9}},{"country":"Thailand","flag":"🇹🇭","values":{"2000":9.6,"2001":10.1,"2002":10.9,"2003":10.1,"2004":11.7,"2005":11.6,"2006":13.8,"2007":14.5,"2008":14.6,"2009":14.2,"2010":15.9,"2011":19.2,"2012":22.4,"2013":26.5,"2014":24.8,"2015":29.9,"2016":32.5,"2017":35.6,"2018":38.2,"2019":39.9,"2020":6.7}},{"country":"Türkiye","flag":"🇹🇷","values":{"2000":9.6,"2001":10.8,"2002":12.8,"2003":13.3,"2004":16.8,"2005":20.3,"2006":18.9,"2007":26.1,"2008":29.8,"2009":30.2,"2010":31.4,"2011":34.7,"2012":35.7,"2013":37.8,"2014":39.8,"2015":39.5,"2016":30.3,"2017":37.6,"2018":45.8,"2019":51.2,"2020":15.9}},{"country":"Ukraine","flag":"🇺🇦","values":{"2000":6.4,"2001":9.2,"2002":10.5,"2003":12.5,"2004":15.6,"2005":17.6,"2006":18.9,"2007":23.1,"2008":25.4,"2009":20.8,"2010":21.2,"2011":21.4,"2012":23.0,"2013":24.7,"2014":12.7,"2015":12.4,"2016":13.3,"2017":14.2,"2018":14.1,"2019":13.4,"2020":3.1}}],"outro_question":"Which country did YOU visit last? ✈️","cta_line":"Show us your favorite trip spot on hilads.live 📸","card_bg":"blue","caption":"France has been the world's most visited country every single year since 2000 🇫🇷 Spain and the US kept swapping second place, China climbed as high as #3, and Türkiye rose from #16 to #6. Then 2020 came: Spain lost 77% of its visitors in a single year, France more than half. UN Tourism counts international overnight visitors, so day trips don't count. Different Worlds by Hilads.","hashtags":["#DifferentWorlds","#Travel","#Tourism","#TravelStats","#France","#Spain"],"warnings":["UN Tourism bulk download (05/2026), inbound_arrivals, INBD_TRIP_TOTL_TOTL_TOUR (overnight visitors), thousand trips shown in millions (one decimal).","2000-2020: the last year where France (#1), China and Thailand all report (France and Thailand have no 2022, China no 2021-2022). No gaps to interpolate among the 17 countries shown.","Countries reporting only total visitors (overnight + same-day) are not in this indicator (Russia after 2005, the UAE 2006-2013, Vietnam)."]}
JSON, true, 512, JSON_THROW_ON_ERROR);
        $r = DwStudio::importRace($topic, $content, 'Claude Code');
        echo $r['ok'] ? "  OK  dw: 2026-11-16 race package v{$r['version']}\n" : "  ERR dw Nov 16 race: " . implode(' ', $r['errors']) . "\n";
    }
} catch (Throwable $e) {
    echo "  ERR dw Nov 16 race: " . $e->getMessage() . "\n";
}

// Once: Nov 17 becomes the race "The world's most powerful passports, 2010 to 2026" (Henley Passport Index, January
// editions; 2007 and 2009 have no scores in Henley's history), Vietnam as the extra row with its real rank;
// '"Raining cats and dogs" in other languages' moves to the first date with no topic. Separate statements, as Nov 16.
try {
    $old = $pdo->query("SELECT id, status FROM dw_topics WHERE date = '2026-11-17' AND title = '\"Raining cats and dogs\" in other languages'")->fetch(PDO::FETCH_ASSOC);
    if ($old && $old['status'] !== 'published') {
        $free = $pdo->query("SELECT d::date::text FROM generate_series('2026-11-18'::date, '2027-12-31'::date, '1 day') d
                             WHERE NOT EXISTS (SELECT 1 FROM dw_topics t WHERE t.date = d::date) ORDER BY d LIMIT 1")->fetchColumn();
        $pdo->prepare("UPDATE dw_topics SET date = ?::date, updated_at = now() WHERE id = ?")->execute([$free, $old['id']]);
        echo "  OK  dw: \"Raining cats and dogs\" moved from 2026-11-17 to {$free}\n";
    }
    $title = "The world's most powerful passports, 2010 to 2026";
    if (!$pdo->query("SELECT 1 FROM dw_topics WHERE date = '2026-11-17'")->fetchColumn()) {
        $pdo->prepare("INSERT INTO dw_topics (date, title, notes, type, needs_date_check, format) VALUES ('2026-11-17', ?, ?, 'evergreen', false, 'race')")
            ->execute([$title, 'Race: visa-free destinations per passport (Henley Passport Index, January editions), the top 10 of each year from 2010 to 2026, Vietnam as the extra row. Europe leads until 2017, Japan takes #1 in 2018, Singapore alone at #1 in 2025-2026, the UAE from #65 to #2.']);
        echo "  OK  dw: 2026-11-17 race topic\n";
    }
    $topic = DwStudio::topicByDate('2026-11-17');
    if ($topic !== null && $topic['format'] === 'race' && $topic['title'] === $title && DwStudio::package($topic['id']) === null) {
        $content = json_decode(<<<'JSON'
{"format":"race","topic":"The world's most powerful passports, 2010 to 2026","headline":"The world's most powerful passports, 2010 → 2026 🛂","headline_accent":"most powerful","detail":"2018: Japan takes the crown 🇯🇵","banner_year":2018,"extra_row":"Vietnam","value_label":"Visa-free destinations per passport","data_years":"2010–2026","unit":"","decimals":0,"source":"Henley Passport Index","source_url":"https://www.henleyglobal.com/passport-index/ranking","series":[{"country":"Austria","flag":"🇦🇹","values":{"2010":158,"2011":168,"2012":163,"2013":168,"2014":171,"2015":169,"2016":173,"2017":173,"2018":186,"2019":185,"2020":187,"2021":188,"2022":188,"2023":188,"2024":192,"2025":191,"2026":185},"ranks":{"2010":8,"2011":6,"2012":6,"2013":5,"2014":4,"2015":5,"2016":5,"2017":4,"2018":5,"2019":5,"2020":5,"2021":4,"2022":4,"2023":5,"2024":3,"2025":4,"2026":5}},{"country":"Belgium","flag":"🇧🇪","values":{"2010":160,"2011":171,"2012":167,"2013":171,"2014":172,"2015":170,"2016":174,"2017":173,"2018":185,"2019":184,"2020":185,"2021":186,"2022":186,"2023":186,"2024":191,"2025":190,"2026":186},"ranks":{"2010":6,"2011":3,"2012":3,"2013":3,"2014":3,"2015":4,"2016":4,"2017":4,"2018":6,"2019":6,"2020":7,"2021":6,"2022":6,"2023":7,"2024":4,"2025":5,"2026":4}},{"country":"Canada","flag":"🇨🇦","values":{"2010":157,"2011":164,"2012":163,"2013":170,"2014":173,"2015":170,"2016":172,"2017":171,"2018":185,"2019":184,"2020":183,"2021":184,"2022":185,"2023":185,"2024":188,"2025":188,"2026":183},"ranks":{"2010":9,"2011":9,"2012":6,"2013":4,"2014":2,"2015":4,"2016":6,"2017":6,"2018":6,"2019":6,"2020":9,"2021":8,"2022":7,"2023":8,"2024":7,"2025":7,"2026":7}},{"country":"Denmark","flag":"🇩🇰","values":{"2010":164,"2011":173,"2012":169,"2013":172,"2014":173,"2015":171,"2016":174,"2017":174,"2018":187,"2019":187,"2020":187,"2021":188,"2022":188,"2023":188,"2024":192,"2025":191,"2026":186},"ranks":{"2010":2,"2011":1,"2012":1,"2013":2,"2014":2,"2015":3,"2016":4,"2017":3,"2018":4,"2019":3,"2020":5,"2021":4,"2022":4,"2023":5,"2024":3,"2025":4,"2026":4}},{"country":"Finland","flag":"🇫🇮","values":{"2010":162,"2011":173,"2012":168,"2013":173,"2014":174,"2015":172,"2016":175,"2017":174,"2018":187,"2019":188,"2020":188,"2021":189,"2022":189,"2023":189,"2024":193,"2025":192,"2026":186},"ranks":{"2010":4,"2011":1,"2012":2,"2013":1,"2014":1,"2015":2,"2016":3,"2017":3,"2018":4,"2019":2,"2020":4,"2021":3,"2022":3,"2023":4,"2024":2,"2025":3,"2026":4}},{"country":"France","flag":"🇫🇷","values":{"2010":161,"2011":171,"2012":167,"2013":170,"2014":172,"2015":171,"2016":175,"2017":173,"2018":188,"2019":186,"2020":186,"2021":187,"2022":188,"2023":187,"2024":194,"2025":192,"2026":186},"ranks":{"2010":5,"2011":3,"2012":3,"2013":4,"2014":3,"2015":3,"2016":3,"2017":4,"2018":3,"2019":4,"2020":6,"2021":5,"2022":4,"2023":6,"2024":1,"2025":3,"2026":4}},{"country":"Germany","flag":"🇩🇪","values":{"2010":161,"2011":172,"2012":168,"2013":172,"2014":174,"2015":173,"2016":177,"2017":176,"2018":188,"2019":188,"2020":189,"2021":190,"2022":190,"2023":190,"2024":194,"2025":192,"2026":186},"ranks":{"2010":5,"2011":2,"2012":2,"2013":2,"2014":1,"2015":1,"2016":1,"2017":1,"2018":3,"2019":2,"2020":3,"2021":2,"2022":2,"2023":3,"2024":1,"2025":3,"2026":4}},{"country":"Ireland","flag":"🇮🇪","values":{"2010":159,"2011":169,"2012":165,"2013":170,"2014":171,"2015":169,"2016":172,"2017":172,"2018":185,"2019":184,"2020":186,"2021":187,"2022":187,"2023":187,"2024":192,"2025":191,"2026":186},"ranks":{"2010":7,"2011":5,"2012":5,"2013":4,"2014":4,"2015":5,"2016":6,"2017":5,"2018":6,"2019":6,"2020":6,"2021":5,"2022":5,"2023":6,"2024":3,"2025":4,"2026":4}},{"country":"Italy","flag":"🇮🇹","values":{"2010":161,"2011":171,"2012":166,"2013":171,"2014":172,"2015":171,"2016":175,"2017":174,"2018":187,"2019":187,"2020":188,"2021":189,"2022":189,"2023":189,"2024":194,"2025":192,"2026":186},"ranks":{"2010":5,"2011":3,"2012":4,"2013":3,"2014":3,"2015":3,"2016":3,"2017":3,"2018":4,"2019":3,"2020":4,"2021":3,"2022":3,"2023":4,"2024":1,"2025":3,"2026":4}},{"country":"Japan","flag":"🇯🇵","values":{"2010":160,"2011":170,"2012":165,"2013":170,"2014":172,"2015":171,"2016":173,"2017":172,"2018":190,"2019":190,"2020":191,"2021":192,"2022":192,"2023":193,"2024":194,"2025":193,"2026":188},"ranks":{"2010":6,"2011":4,"2012":5,"2013":4,"2014":3,"2015":3,"2016":5,"2017":5,"2018":1,"2019":1,"2020":1,"2021":1,"2022":1,"2023":1,"2024":1,"2025":2,"2026":2}},{"country":"Luxembourg","flag":"🇱🇺","values":{"2010":162,"2011":171,"2012":166,"2013":172,"2014":172,"2015":171,"2016":172,"2017":173,"2018":186,"2019":187,"2020":188,"2021":189,"2022":189,"2023":189,"2024":191,"2025":191,"2026":186},"ranks":{"2010":4,"2011":3,"2012":4,"2013":2,"2014":3,"2015":3,"2016":6,"2017":4,"2018":5,"2019":3,"2020":4,"2021":3,"2022":3,"2023":4,"2024":4,"2025":4,"2026":4}},{"country":"Netherlands","flag":"🇳🇱","values":{"2010":161,"2011":171,"2012":167,"2013":171,"2014":172,"2015":171,"2016":174,"2017":173,"2018":186,"2019":185,"2020":186,"2021":187,"2022":188,"2023":188,"2024":192,"2025":191,"2026":186},"ranks":{"2010":5,"2011":3,"2012":3,"2013":3,"2014":3,"2015":3,"2016":4,"2017":4,"2018":5,"2019":5,"2020":6,"2021":5,"2022":4,"2023":5,"2024":3,"2025":4,"2026":4}},{"country":"New Zealand","flag":"🇳🇿","values":{"2010":157,"2011":166,"2012":165,"2013":168,"2014":170,"2015":170,"2016":171,"2017":172,"2018":182,"2019":182,"2020":185,"2021":186,"2022":186,"2023":186,"2024":189,"2025":190,"2026":183},"ranks":{"2010":9,"2011":8,"2012":5,"2013":5,"2014":5,"2015":4,"2016":7,"2017":5,"2018":8,"2019":8,"2020":7,"2021":6,"2022":6,"2023":7,"2024":6,"2025":5,"2026":7}},{"country":"Norway","flag":"🇳🇴","values":{"2010":159,"2011":170,"2012":165,"2013":170,"2014":171,"2015":171,"2016":172,"2017":173,"2018":186,"2019":184,"2020":185,"2021":185,"2022":186,"2023":186,"2024":191,"2025":191,"2026":186},"ranks":{"2010":7,"2011":4,"2012":5,"2013":4,"2014":4,"2015":3,"2016":6,"2017":4,"2018":5,"2019":6,"2020":7,"2021":7,"2022":6,"2023":7,"2024":4,"2025":4,"2026":4}},{"country":"Portugal","flag":"🇵🇹","values":{"2010":158,"2011":170,"2012":165,"2013":170,"2014":172,"2015":170,"2016":172,"2017":171,"2018":186,"2019":185,"2020":186,"2021":187,"2022":187,"2023":187,"2024":191,"2025":190,"2026":185},"ranks":{"2010":8,"2011":4,"2012":5,"2013":4,"2014":3,"2015":4,"2016":6,"2017":6,"2018":5,"2019":5,"2020":6,"2021":5,"2022":5,"2023":6,"2024":4,"2025":5,"2026":5}},{"country":"Singapore","flag":"🇸🇬","values":{"2010":155,"2011":164,"2012":161,"2013":167,"2014":170,"2015":169,"2016":173,"2017":173,"2018":189,"2019":190,"2020":190,"2021":192,"2022":192,"2023":192,"2024":194,"2025":195,"2026":193},"ranks":{"2010":11,"2011":9,"2012":8,"2013":6,"2014":5,"2015":5,"2016":5,"2017":4,"2018":2,"2019":1,"2020":2,"2021":1,"2022":1,"2023":2,"2024":1,"2025":1,"2026":1}},{"country":"South Korea","flag":"🇰🇷","values":{"2010":151,"2011":163,"2012":160,"2013":166,"2014":172,"2015":171,"2016":172,"2017":170,"2018":188,"2019":188,"2020":189,"2021":190,"2022":190,"2023":192,"2024":193,"2025":192,"2026":188},"ranks":{"2010":13,"2011":10,"2012":9,"2013":7,"2014":3,"2015":3,"2016":6,"2017":7,"2018":3,"2019":2,"2020":3,"2021":2,"2022":2,"2023":2,"2024":2,"2025":3,"2026":2}},{"country":"Spain","flag":"🇪🇸","values":{"2010":160,"2011":170,"2012":165,"2013":170,"2014":172,"2015":170,"2016":175,"2017":174,"2018":187,"2019":186,"2020":188,"2021":189,"2022":189,"2023":190,"2024":194,"2025":192,"2026":186},"ranks":{"2010":6,"2011":4,"2012":5,"2013":4,"2014":3,"2015":4,"2016":3,"2017":3,"2018":4,"2019":4,"2020":4,"2021":3,"2022":3,"2023":3,"2024":1,"2025":3,"2026":4}},{"country":"Sweden","flag":"🇸🇪","values":{"2010":163,"2011":173,"2012":168,"2013":173,"2014":174,"2015":172,"2016":176,"2017":175,"2018":187,"2019":186,"2020":186,"2021":187,"2022":188,"2023":188,"2024":193,"2025":191,"2026":187},"ranks":{"2010":3,"2011":1,"2012":2,"2013":1,"2014":1,"2015":2,"2016":2,"2017":2,"2018":4,"2019":4,"2020":6,"2021":5,"2022":4,"2023":5,"2024":2,"2025":4,"2026":3}},{"country":"United Arab Emirates","flag":"🇦🇪","values":{"2010":64,"2011":67,"2012":70,"2013":72,"2014":77,"2015":113,"2016":122,"2017":121,"2018":161,"2019":172,"2020":170,"2021":174,"2022":175,"2023":178,"2024":183,"2025":185,"2026":188},"ranks":{"2010":65,"2011":65,"2012":64,"2013":56,"2014":55,"2015":42,"2016":38,"2017":38,"2018":21,"2019":15,"2020":18,"2021":16,"2022":15,"2023":15,"2024":11,"2025":10,"2026":2}},{"country":"United Kingdom","flag":"🇬🇧","values":{"2010":166,"2011":171,"2012":167,"2013":173,"2014":174,"2015":173,"2016":175,"2017":173,"2018":186,"2019":184,"2020":185,"2021":185,"2022":186,"2023":187,"2024":191,"2025":190,"2026":184},"ranks":{"2010":1,"2011":3,"2012":3,"2013":1,"2014":1,"2015":1,"2016":3,"2017":4,"2018":5,"2019":6,"2020":7,"2021":7,"2022":6,"2023":6,"2024":4,"2025":5,"2026":6}},{"country":"United States","flag":"🇺🇸","values":{"2010":159,"2011":169,"2012":166,"2013":172,"2014":174,"2015":172,"2016":174,"2017":172,"2018":186,"2019":184,"2020":185,"2021":185,"2022":186,"2023":186,"2024":188,"2025":186,"2026":180},"ranks":{"2010":7,"2011":5,"2012":4,"2013":2,"2014":1,"2015":2,"2016":4,"2017":5,"2018":5,"2019":6,"2020":7,"2021":7,"2022":6,"2023":7,"2024":7,"2025":9,"2026":10}},{"country":"Vietnam","flag":"🇻🇳","values":{"2010":43,"2011":42,"2012":44,"2013":45,"2014":47,"2015":45,"2016":47,"2017":45,"2018":51,"2019":51,"2020":54,"2021":53,"2022":54,"2023":55,"2024":55,"2025":51,"2026":49},"ranks":{"2010":84,"2011":88,"2012":89,"2013":81,"2014":81,"2015":94,"2016":90,"2017":90,"2018":90,"2019":90,"2020":86,"2021":95,"2022":89,"2023":88,"2024":87,"2025":91,"2026":89}}],"card_bg":"cream","outro_question":"How many countries can YOU visit visa-free? 🛂","cta_line":"Show us your last trip on hilads.live ✈️","caption":"The UK had the world's most powerful passport in 2010. Then the Nordics, then Germany… until 2018, when Japan took the crown and Asia never really gave it back. Today Singapore stands alone at #1, and the UAE rocketed from #65 to #2. Vietnam? Somewhere around #90, with about 50 visa-free destinations. Different Worlds by Hilads.","hashtags":["#DifferentWorlds","#Passport","#Travel","#VisaFree","#Singapore","#Vietnam"],"warnings":["Henley Passport Index, its own yearly history (api.henleypassportindex.com v3, the data of each country): one value per year, the January edition (2025: Singapore 195 = the January 2025 index).","2010-2026: Henley's history has no scores for 2007 and 2009 (0 for every country); 2006 and 2008 are left out so the years follow each other.","Ranks are Henley's (dense: tied passports share a rank, the next one is +1). The scores jump about +14 in 2018 for everyone (Henley counts more destinations from then).","Vietnam's row: its real rank and score each year (#89 with 49 in 2026)."]}
JSON, true, 512, JSON_THROW_ON_ERROR);
        $r = DwStudio::importRace($topic, $content, 'Claude Code');
        echo $r['ok'] ? "  OK  dw: 2026-11-17 race package v{$r['version']}\n" : "  ERR dw Nov 17 race: " . implode(' ', $r['errors']) . "\n";
    }
} catch (Throwable $e) {
    echo "  ERR dw Nov 17 race: " . $e->getMessage() . "\n";
}

// Once: Nov 18 becomes the race "The world's best cuisines" (TasteAtlas Awards, editions 2022/23 to 2025/26, user ratings;
// Greece dethrones Italy in 2024/25), Vietnam as the extra row; "Cute nicknames for your partner" moves to the first date
// with no topic; the unpublished birth rate topic is dropped (DwStudio::deleteTopic, its files on R2 too). As Nov 16.
try {
    require_once __DIR__ . '/vendor/autoload.php';
    $old = $pdo->query("SELECT id, status FROM dw_topics WHERE date = '2026-11-18' AND title = 'Cute nicknames for your partner'")->fetch(PDO::FETCH_ASSOC);
    if ($old && $old['status'] !== 'published') {
        $free = $pdo->query("SELECT d::date::text FROM generate_series('2026-11-19'::date, '2027-12-31'::date, '1 day') d
                             WHERE NOT EXISTS (SELECT 1 FROM dw_topics t WHERE t.date = d::date) ORDER BY d LIMIT 1")->fetchColumn();
        $pdo->prepare("UPDATE dw_topics SET date = ?::date, updated_at = now() WHERE id = ?")->execute([$free, $old['id']]);
        echo "  OK  dw: \"Cute nicknames for your partner\" moved from 2026-11-18 to {$free}\n";
    }
    foreach ($pdo->query("SELECT id, date::text AS date, title FROM dw_topics WHERE status <> 'published'
                          AND (title ILIKE '%birth rate%' OR title ILIKE '%birthrate%' OR title ILIKE '%fertility%' OR title ILIKE '%births per%' OR title ILIKE '%babies per%')")
             ->fetchAll(PDO::FETCH_ASSOC) as $t) {
        DwStudio::deleteTopic((int) $t['id']);
        echo "  OK  dw: dropped {$t['date']} \"{$t['title']}\"\n";
    }
    $title = "The world's best cuisines, 2022/23 to 2025/26";
    if (!$pdo->query("SELECT 1 FROM dw_topics WHERE date = '2026-11-18'")->fetchColumn()) {
        $pdo->prepare("INSERT INTO dw_topics (date, title, notes, type, needs_date_check, format) VALUES ('2026-11-18', ?, ?, 'evergreen', false, 'race')")
            ->execute([$title, 'Race: TasteAtlas Awards Best Cuisines, the top 10 of each edition from 2022/23 to 2025/26 (average user ratings out of 5), Vietnam as the extra row. Italy #1, Greece takes the crown in 2024/25, Italy back in 2025/26, Peru to #3.']);
        echo "  OK  dw: 2026-11-18 race topic\n";
    }
    $topic = DwStudio::topicByDate('2026-11-18');
    if ($topic !== null && $topic['format'] === 'race' && $topic['title'] === $title && DwStudio::package($topic['id']) === null) {
        $content = json_decode(<<<'JSON'
{"format":"race","topic":"The world's best cuisines, TasteAtlas Awards 2022/23 to 2025/26","headline":"The world's best cuisines, 2022/23 → 2025/26 🍝","headline_accent":"best cuisines","detail":"Greece dethrones Italy 🇬🇷","banner_year":2024,"extra_row":"Vietnam","year_labels":{"2022":"2022/23","2023":"2023/24","2024":"2024/25","2025":"2025/26"},"step_seconds":2.5,"start_seconds":1.5,"hold":0.55,"value_label":"Average user rating out of 5","data_years":"2022/23–2025/26","unit":"","decimals":2,"source":"TasteAtlas Awards","source_url":"https://www.tasteatlas.com/best/cuisines","series":[{"country":"United States","flag":"🇺🇸","values":{"2022":4.51,"2023":4.48,"2024":4.42,"2025":4.42},"ranks":{"2022":8,"2023":16,"2024":13,"2025":15}},{"country":"China","flag":"🇨🇳","values":{"2022":4.49,"2023":4.59,"2024":4.45,"2025":4.48},"ranks":{"2022":11,"2023":5,"2024":10,"2025":8}},{"country":"France","flag":"🇫🇷","values":{"2022":4.51,"2023":4.55,"2024":4.48,"2025":4.48},"ranks":{"2022":9,"2023":8,"2024":8,"2025":9}},{"country":"Greece","flag":"🇬🇷","values":{"2022":4.69,"2023":4.64,"2024":4.6,"2025":4.6},"ranks":{"2022":2,"2023":3,"2024":1,"2025":2}},{"country":"India","flag":"🇮🇳","values":{"2022":4.54,"2023":4.52,"2024":4.42,"2025":4.43},"ranks":{"2022":5,"2023":11,"2024":12,"2025":13}},{"country":"Indonesia","flag":"🇮🇩","values":{"2022":4.37,"2023":4.57,"2024":4.48,"2025":4.48},"ranks":{"2022":16,"2023":6,"2024":7,"2025":10}},{"country":"Italy","flag":"🇮🇹","values":{"2022":4.72,"2023":4.65,"2024":4.59,"2025":4.64},"ranks":{"2022":1,"2023":1,"2024":2,"2025":1}},{"country":"Japan","flag":"🇯🇵","values":{"2022":4.59,"2023":4.65,"2024":4.47,"2025":4.49},"ranks":{"2022":4,"2023":2,"2024":9,"2025":6}},{"country":"Mexico","flag":"🇲🇽","values":{"2022":4.53,"2023":4.56,"2024":4.52,"2025":4.46},"ranks":{"2022":6,"2023":7,"2024":3,"2025":11}},{"country":"Peru","flag":"🇵🇪","values":{"2022":4.51,"2023":4.54,"2024":4.4,"2025":4.54},"ranks":{"2022":10,"2023":10,"2024":14,"2025":3}},{"country":"Poland","flag":"🇵🇱","values":{"2022":4.44,"2023":4.5,"2024":4.42,"2025":4.42},"ranks":{"2022":14,"2023":13,"2024":11,"2025":14}},{"country":"Portugal","flag":"🇵🇹","values":{"2022":4.47,"2023":4.61,"2024":4.5,"2025":4.53},"ranks":{"2022":13,"2023":4,"2024":5,"2025":4}},{"country":"Spain","flag":"🇪🇸","values":{"2022":4.59,"2023":4.55,"2024":4.5,"2025":4.53},"ranks":{"2022":3,"2023":9,"2024":4,"2025":5}},{"country":"Türkiye","flag":"🇹🇷","values":{"2022":4.52,"2023":4.49,"2024":4.5,"2025":4.49},"ranks":{"2022":7,"2023":15,"2024":6,"2025":7}},{"country":"Vietnam","flag":"🇻🇳","values":{"2022":4.31,"2023":4.44,"2024":4.34,"2025":4.36},"ranks":{"2022":20,"2023":22,"2024":19,"2025":16}}],"card_bg":"yellow","outro_question":"Is YOUR country's food ranked too low? 😤","cta_line":"Show us your favorite local dish on hilads.live 🍜","caption":"Italy topped TasteAtlas's world cuisine ranking in 2022/23 and 2023/24, then Greece took the crown in 2024/25 by 0.01 point… before Italy won it back in 2025/26, with Peru jumping to #3. Vietnam keeps climbing: #16 this year, its best ever. These are average user ratings of each country's dishes on TasteAtlas. Different Worlds by Hilads.","hashtags":["#DifferentWorlds","#Food","#TasteAtlas","#Foodie","#Italy","#Greece","#VietnameseFood"],"warnings":["TasteAtlas Awards 'Best Cuisines in the World', from TasteAtlas's own ranking page (archived copies: Dec 2022, Jan 2024 + its ranks 16-100, Dec 2024, Jan 2026): 2022 (shown 2022/23), 23/24, 24/25, 25/26. The 2021 edition is left out: its archived page has only #36-50.","Scores are average user ratings out of 5 (TasteAtlas's method: ratings of each country's dishes and products); the ratings counted grow each edition, so scores move a little between editions.","Ranks are TasteAtlas's own (2023/24: Italy #1 and Japan #2 both at 4.65, ordered by more decimals).","Vietnam: #20 (4.31), #22 (4.44), #19 (4.34), #16 (4.36)."]}
JSON, true, 512, JSON_THROW_ON_ERROR);
        $r = DwStudio::importRace($topic, $content, 'Claude Code');
        echo $r['ok'] ? "  OK  dw: 2026-11-18 race package v{$r['version']}\n" : "  ERR dw Nov 18 race: " . implode(' ', $r['errors']) . "\n";
    }
} catch (Throwable $e) {
    echo "  ERR dw Nov 18 race: " . $e->getMessage() . "\n";
}

// Once: Nov 19 becomes the race "The countries with the most Miss Universe crowns, 1952 to 2025"; the old topic moves to the first date with no topic from Nov 22. As Nov 16.
try {
    require_once __DIR__ . '/vendor/autoload.php';
    $old = $pdo->query("SELECT id, title, status FROM dw_topics WHERE date = '2026-11-19' AND title ILIKE 'World Toilet Day%'")->fetch(PDO::FETCH_ASSOC);
    if ($old && $old['status'] !== 'published') {
        $free = $pdo->query("SELECT d::date::text FROM generate_series('2026-11-22'::date, '2027-12-31'::date, '1 day') d
                             WHERE NOT EXISTS (SELECT 1 FROM dw_topics t WHERE t.date = d::date) ORDER BY d LIMIT 1")->fetchColumn();
        $pdo->prepare("UPDATE dw_topics SET date = ?::date, updated_at = now() WHERE id = ?")->execute([$free, $old['id']]);
        echo "  OK  dw: \"{$old['title']}\" moved from 2026-11-19 to {$free}\n";
    }
    $title = 'The countries with the most Miss Universe crowns, 1952 to 2025';
    if (!$pdo->query("SELECT 1 FROM dw_topics WHERE date = '2026-11-19'")->fetchColumn()) {
        $pdo->prepare("INSERT INTO dw_topics (date, title, notes, type, needs_date_check, format) VALUES ('2026-11-19', ?, ?, 'evergreen', false, 'race')")
            ->execute([$title, 'Race: Miss Universe crowns by country, cumulative, every edition 1952-2025 (2002 counted for Panama, the official replacement; 2026 held on Nov 24, not included). The US leads alone since 1956 (9), Venezuela 7, Puerto Rico 5, Mexico and the Philippines 4. Banner 2009: Venezuela\'s back-to-back. Fast early decades (0.25 s a year), 0.6 s a year from 2011.']);
        echo "  OK  dw: 2026-11-19 race topic\n";
    }
    $topic = DwStudio::topicByDate('2026-11-19');
    if ($topic !== null && $topic['format'] === 'race' && $topic['title'] === $title && DwStudio::package($topic['id']) === null) {
        $content = json_decode(<<<'JSON'
{"format":"race","topic":"The countries with the most Miss Universe crowns, 1952 to 2025","headline":"Miss Universe crowns by country, 1952 → 2025 👑","headline_accent":"Miss Universe crowns","detail":"2009: Venezuela wins twice in a row 🇻🇪","banner_year":2009,"value_label":"Miss Universe titles by country","data_years":"1952–2025","unit":"","decimals":0,"value_prefix":"👑 x","step_seconds":0.25,"slow_from":2011,"slow_step":0.6,"source":"official Miss Universe results","source_url":"https://en.wikipedia.org/wiki/List_of_Miss_Universe_titleholders","series":[{"country":"Argentina","flag":"🇦🇷","values":{"1952":0,"1953":0,"1954":0,"1955":0,"1956":0,"1957":0,"1958":0,"1959":0,"1960":0,"1961":0,"1962":1,"1963":1,"1964":1,"1965":1,"1966":1,"1967":1,"1968":1,"1969":1,"1970":1,"1971":1,"1972":1,"1973":1,"1974":1,"1975":1,"1976":1,"1977":1,"1978":1,"1979":1,"1980":1,"1981":1,"1982":1,"1983":1,"1984":1,"1985":1,"1986":1,"1987":1,"1988":1,"1989":1,"1990":1,"1991":1,"1992":1,"1993":1,"1994":1,"1995":1,"1996":1,"1997":1,"1998":1,"1999":1,"2000":1,"2001":1,"2002":1,"2003":1,"2004":1,"2005":1,"2006":1,"2007":1,"2008":1,"2009":1,"2010":1,"2011":1,"2012":1,"2013":1,"2014":1,"2015":1,"2016":1,"2017":1,"2018":1,"2019":1,"2020":1,"2021":1,"2022":1,"2023":1,"2024":1,"2025":1},"ranks":{"1952":2,"1953":2,"1954":2,"1955":2,"1956":3,"1957":3,"1958":3,"1959":3,"1960":3,"1961":3,"1962":2,"1963":2,"1964":2,"1965":2,"1966":3,"1967":3,"1968":3,"1969":3,"1970":3,"1971":3,"1972":3,"1973":3,"1974":3,"1975":3,"1976":3,"1977":3,"1978":3,"1979":3,"1980":3,"1981":3,"1982":3,"1983":3,"1984":4,"1985":4,"1986":4,"1987":4,"1988":4,"1989":4,"1990":4,"1991":4,"1992":4,"1993":4,"1994":4,"1995":4,"1996":5,"1997":5,"1998":5,"1999":5,"2000":5,"2001":5,"2002":5,"2003":5,"2004":5,"2005":5,"2006":6,"2007":6,"2008":5,"2009":6,"2010":6,"2011":6,"2012":6,"2013":6,"2014":6,"2015":6,"2016":6,"2017":6,"2018":7,"2019":7,"2020":7,"2021":7,"2022":7,"2023":7,"2024":7,"2025":7},"order":{"1952":2,"1953":3,"1954":4,"1955":5,"1956":5,"1957":6,"1958":7,"1959":8,"1960":8,"1961":9,"1962":8,"1963":8,"1964":8,"1965":8,"1966":8,"1967":8,"1968":9,"1969":9,"1970":9,"1971":9,"1972":9,"1973":10,"1974":10,"1975":10,"1976":10,"1977":10,"1978":10,"1979":10,"1980":10,"1981":11,"1982":11,"1983":11,"1984":11,"1985":12,"1986":12,"1987":12,"1988":13,"1989":13,"1990":13,"1991":13,"1992":13,"1993":13,"1994":13,"1995":13,"1996":13,"1997":13,"1998":14,"1999":14,"2000":15,"2001":15,"2002":15,"2003":15,"2004":16,"2005":17,"2006":17,"2007":17,"2008":17,"2009":17,"2010":18,"2011":18,"2012":18,"2013":18,"2014":18,"2015":18,"2016":18,"2017":19,"2018":19,"2019":19,"2020":19,"2021":19,"2022":19,"2023":19,"2024":19,"2025":19}},{"country":"Brazil","flag":"🇧🇷","values":{"1952":0,"1953":0,"1954":0,"1955":0,"1956":0,"1957":0,"1958":0,"1959":0,"1960":0,"1961":0,"1962":0,"1963":1,"1964":1,"1965":1,"1966":1,"1967":1,"1968":2,"1969":2,"1970":2,"1971":2,"1972":2,"1973":2,"1974":2,"1975":2,"1976":2,"1977":2,"1978":2,"1979":2,"1980":2,"1981":2,"1982":2,"1983":2,"1984":2,"1985":2,"1986":2,"1987":2,"1988":2,"1989":2,"1990":2,"1991":2,"1992":2,"1993":2,"1994":2,"1995":2,"1996":2,"1997":2,"1998":2,"1999":2,"2000":2,"2001":2,"2002":2,"2003":2,"2004":2,"2005":2,"2006":2,"2007":2,"2008":2,"2009":2,"2010":2,"2011":2,"2012":2,"2013":2,"2014":2,"2015":2,"2016":2,"2017":2,"2018":2,"2019":2,"2020":2,"2021":2,"2022":2,"2023":2,"2024":2,"2025":2},"ranks":{"1952":2,"1953":2,"1954":2,"1955":2,"1956":3,"1957":3,"1958":3,"1959":3,"1960":3,"1961":3,"1962":3,"1963":2,"1964":2,"1965":2,"1966":3,"1967":3,"1968":2,"1969":2,"1970":2,"1971":2,"1972":2,"1973":2,"1974":2,"1975":2,"1976":2,"1977":2,"1978":2,"1979":2,"1980":2,"1981":2,"1982":2,"1983":2,"1984":3,"1985":3,"1986":3,"1987":3,"1988":3,"1989":3,"1990":3,"1991":3,"1992":3,"1993":3,"1994":3,"1995":3,"1996":4,"1997":4,"1998":4,"1999":4,"2000":4,"2001":4,"2002":4,"2003":4,"2004":4,"2005":4,"2006":5,"2007":5,"2008":4,"2009":5,"2010":5,"2011":5,"2012":5,"2013":5,"2014":5,"2015":5,"2016":5,"2017":5,"2018":6,"2019":6,"2020":6,"2021":6,"2022":6,"2023":6,"2024":6,"2025":6},"order":{"1952":5,"1953":6,"1954":7,"1955":8,"1956":8,"1957":9,"1958":10,"1959":11,"1960":11,"1961":12,"1962":12,"1963":9,"1964":9,"1965":9,"1966":9,"1967":9,"1968":2,"1969":2,"1970":2,"1971":2,"1972":2,"1973":2,"1974":2,"1975":2,"1976":2,"1977":2,"1978":2,"1979":2,"1980":2,"1981":2,"1982":2,"1983":2,"1984":2,"1985":2,"1986":3,"1987":3,"1988":3,"1989":3,"1990":3,"1991":3,"1992":3,"1993":4,"1994":4,"1995":4,"1996":4,"1997":4,"1998":4,"1999":4,"2000":4,"2001":4,"2002":4,"2003":4,"2004":4,"2005":4,"2006":4,"2007":4,"2008":4,"2009":4,"2010":4,"2011":4,"2012":4,"2013":4,"2014":4,"2015":5,"2016":5,"2017":5,"2018":5,"2019":6,"2020":7,"2021":8,"2022":8,"2023":8,"2024":8,"2025":8}},{"country":"Colombia","flag":"🇨🇴","values":{"1952":0,"1953":0,"1954":0,"1955":0,"1956":0,"1957":0,"1958":1,"1959":1,"1960":1,"1961":1,"1962":1,"1963":1,"1964":1,"1965":1,"1966":1,"1967":1,"1968":1,"1969":1,"1970":1,"1971":1,"1972":1,"1973":1,"1974":1,"1975":1,"1976":1,"1977":1,"1978":1,"1979":1,"1980":1,"1981":1,"1982":1,"1983":1,"1984":1,"1985":1,"1986":1,"1987":1,"1988":1,"1989":1,"1990":1,"1991":1,"1992":1,"1993":1,"1994":1,"1995":1,"1996":1,"1997":1,"1998":1,"1999":1,"2000":1,"2001":1,"2002":1,"2003":1,"2004":1,"2005":1,"2006":1,"2007":1,"2008":1,"2009":1,"2010":1,"2011":1,"2012":1,"2013":1,"2014":2,"2015":2,"2016":2,"2017":2,"2018":2,"2019":2,"2020":2,"2021":2,"2022":2,"2023":2,"2024":2,"2025":2},"ranks":{"1952":2,"1953":2,"1954":2,"1955":2,"1956":3,"1957":3,"1958":2,"1959":2,"1960":2,"1961":2,"1962":2,"1963":2,"1964":2,"1965":2,"1966":3,"1967":3,"1968":3,"1969":3,"1970":3,"1971":3,"1972":3,"1973":3,"1974":3,"1975":3,"1976":3,"1977":3,"1978":3,"1979":3,"1980":3,"1981":3,"1982":3,"1983":3,"1984":4,"1985":4,"1986":4,"1987":4,"1988":4,"1989":4,"1990":4,"1991":4,"1992":4,"1993":4,"1994":4,"1995":4,"1996":5,"1997":5,"1998":5,"1999":5,"2000":5,"2001":5,"2002":5,"2003":5,"2004":5,"2005":5,"2006":6,"2007":6,"2008":5,"2009":6,"2010":6,"2011":6,"2012":6,"2013":6,"2014":5,"2015":5,"2016":5,"2017":5,"2018":6,"2019":6,"2020":6,"2021":6,"2022":6,"2023":6,"2024":6,"2025":6},"order":{"1952":8,"1953":9,"1954":10,"1955":11,"1956":11,"1957":12,"1958":5,"1959":5,"1960":5,"1961":5,"1962":5,"1963":5,"1964":5,"1965":5,"1966":5,"1967":5,"1968":6,"1969":6,"1970":6,"1971":6,"1972":6,"1973":7,"1974":7,"1975":7,"1976":7,"1977":7,"1978":7,"1979":7,"1980":7,"1981":8,"1982":8,"1983":8,"1984":8,"1985":9,"1986":9,"1987":9,"1988":10,"1989":10,"1990":10,"1991":10,"1992":10,"1993":10,"1994":10,"1995":10,"1996":10,"1997":10,"1998":11,"1999":11,"2000":12,"2001":12,"2002":12,"2003":12,"2004":13,"2005":14,"2006":14,"2007":15,"2008":15,"2009":15,"2010":16,"2011":16,"2012":16,"2013":16,"2014":14,"2015":14,"2016":14,"2017":14,"2018":14,"2019":15,"2020":15,"2021":15,"2022":15,"2023":15,"2024":15,"2025":15}},{"country":"Finland","flag":"🇫🇮","values":{"1952":1,"1953":1,"1954":1,"1955":1,"1956":1,"1957":1,"1958":1,"1959":1,"1960":1,"1961":1,"1962":1,"1963":1,"1964":1,"1965":1,"1966":1,"1967":1,"1968":1,"1969":1,"1970":1,"1971":1,"1972":1,"1973":1,"1974":1,"1975":2,"1976":2,"1977":2,"1978":2,"1979":2,"1980":2,"1981":2,"1982":2,"1983":2,"1984":2,"1985":2,"1986":2,"1987":2,"1988":2,"1989":2,"1990":2,"1991":2,"1992":2,"1993":2,"1994":2,"1995":2,"1996":2,"1997":2,"1998":2,"1999":2,"2000":2,"2001":2,"2002":2,"2003":2,"2004":2,"2005":2,"2006":2,"2007":2,"2008":2,"2009":2,"2010":2,"2011":2,"2012":2,"2013":2,"2014":2,"2015":2,"2016":2,"2017":2,"2018":2,"2019":2,"2020":2,"2021":2,"2022":2,"2023":2,"2024":2,"2025":2},"ranks":{"1952":1,"1953":1,"1954":1,"1955":1,"1956":2,"1957":2,"1958":2,"1959":2,"1960":2,"1961":2,"1962":2,"1963":2,"1964":2,"1965":2,"1966":3,"1967":3,"1968":3,"1969":3,"1970":3,"1971":3,"1972":3,"1973":3,"1974":3,"1975":2,"1976":2,"1977":2,"1978":2,"1979":2,"1980":2,"1981":2,"1982":2,"1983":2,"1984":3,"1985":3,"1986":3,"1987":3,"1988":3,"1989":3,"1990":3,"1991":3,"1992":3,"1993":3,"1994":3,"1995":3,"1996":4,"1997":4,"1998":4,"1999":4,"2000":4,"2001":4,"2002":4,"2003":4,"2004":4,"2005":4,"2006":5,"2007":5,"2008":4,"2009":5,"2010":5,"2011":5,"2012":5,"2013":5,"2014":5,"2015":5,"2016":5,"2017":5,"2018":6,"2019":6,"2020":6,"2021":6,"2022":6,"2023":6,"2024":6,"2025":6},"order":{"1952":0,"1953":0,"1954":0,"1955":0,"1956":1,"1957":1,"1958":1,"1959":1,"1960":1,"1961":1,"1962":1,"1963":1,"1964":1,"1965":1,"1966":2,"1967":2,"1968":3,"1969":3,"1970":3,"1971":3,"1972":3,"1973":4,"1974":4,"1975":4,"1976":4,"1977":4,"1978":4,"1979":4,"1980":4,"1981":4,"1982":4,"1983":4,"1984":4,"1985":4,"1986":5,"1987":5,"1988":5,"1989":5,"1990":5,"1991":5,"1992":5,"1993":6,"1994":6,"1995":6,"1996":6,"1997":6,"1998":6,"1999":6,"2000":6,"2001":6,"2002":6,"2003":6,"2004":6,"2005":6,"2006":6,"2007":6,"2008":6,"2009":6,"2010":6,"2011":6,"2012":6,"2013":6,"2014":6,"2015":6,"2016":6,"2017":6,"2018":6,"2019":7,"2020":8,"2021":9,"2022":9,"2023":9,"2024":9,"2025":9}},{"country":"France","flag":"🇫🇷","values":{"1952":0,"1953":1,"1954":1,"1955":1,"1956":1,"1957":1,"1958":1,"1959":1,"1960":1,"1961":1,"1962":1,"1963":1,"1964":1,"1965":1,"1966":1,"1967":1,"1968":1,"1969":1,"1970":1,"1971":1,"1972":1,"1973":1,"1974":1,"1975":1,"1976":1,"1977":1,"1978":1,"1979":1,"1980":1,"1981":1,"1982":1,"1983":1,"1984":1,"1985":1,"1986":1,"1987":1,"1988":1,"1989":1,"1990":1,"1991":1,"1992":1,"1993":1,"1994":1,"1995":1,"1996":1,"1997":1,"1998":1,"1999":1,"2000":1,"2001":1,"2002":1,"2003":1,"2004":1,"2005":1,"2006":1,"2007":1,"2008":1,"2009":1,"2010":1,"2011":1,"2012":1,"2013":1,"2014":1,"2015":1,"2016":2,"2017":2,"2018":2,"2019":2,"2020":2,"2021":2,"2022":2,"2023":2,"2024":2,"2025":2},"ranks":{"1952":2,"1953":1,"1954":1,"1955":1,"1956":2,"1957":2,"1958":2,"1959":2,"1960":2,"1961":2,"1962":2,"1963":2,"1964":2,"1965":2,"1966":3,"1967":3,"1968":3,"1969":3,"1970":3,"1971":3,"1972":3,"1973":3,"1974":3,"1975":3,"1976":3,"1977":3,"1978":3,"1979":3,"1980":3,"1981":3,"1982":3,"1983":3,"1984":4,"1985":4,"1986":4,"1987":4,"1988":4,"1989":4,"1990":4,"1991":4,"1992":4,"1993":4,"1994":4,"1995":4,"1996":5,"1997":5,"1998":5,"1999":5,"2000":5,"2001":5,"2002":5,"2003":5,"2004":5,"2005":5,"2006":6,"2007":6,"2008":5,"2009":6,"2010":6,"2011":6,"2012":6,"2013":6,"2014":6,"2015":6,"2016":5,"2017":5,"2018":6,"2019":6,"2020":6,"2021":6,"2022":6,"2023":6,"2024":6,"2025":6},"order":{"1952":11,"1953":1,"1954":1,"1955":1,"1956":2,"1957":2,"1958":2,"1959":2,"1960":2,"1961":2,"1962":2,"1963":2,"1964":2,"1965":2,"1966":3,"1967":3,"1968":4,"1969":4,"1970":4,"1971":4,"1972":4,"1973":5,"1974":5,"1975":5,"1976":5,"1977":5,"1978":5,"1979":5,"1980":5,"1981":6,"1982":6,"1983":6,"1984":6,"1985":7,"1986":7,"1987":7,"1988":8,"1989":8,"1990":8,"1991":8,"1992":8,"1993":8,"1994":8,"1995":8,"1996":8,"1997":8,"1998":9,"1999":9,"2000":10,"2001":10,"2002":10,"2003":10,"2004":11,"2005":12,"2006":12,"2007":13,"2008":13,"2009":13,"2010":14,"2011":14,"2012":14,"2013":14,"2014":15,"2015":15,"2016":15,"2017":15,"2018":15,"2019":16,"2020":16,"2021":16,"2022":16,"2023":16,"2024":16,"2025":16}},{"country":"Germany","flag":"🇩🇪","values":{"1952":0,"1953":0,"1954":0,"1955":0,"1956":0,"1957":0,"1958":0,"1959":0,"1960":0,"1961":1,"1962":1,"1963":1,"1964":1,"1965":1,"1966":1,"1967":1,"1968":1,"1969":1,"1970":1,"1971":1,"1972":1,"1973":1,"1974":1,"1975":1,"1976":1,"1977":1,"1978":1,"1979":1,"1980":1,"1981":1,"1982":1,"1983":1,"1984":1,"1985":1,"1986":1,"1987":1,"1988":1,"1989":1,"1990":1,"1991":1,"1992":1,"1993":1,"1994":1,"1995":1,"1996":1,"1997":1,"1998":1,"1999":1,"2000":1,"2001":1,"2002":1,"2003":1,"2004":1,"2005":1,"2006":1,"2007":1,"2008":1,"2009":1,"2010":1,"2011":1,"2012":1,"2013":1,"2014":1,"2015":1,"2016":1,"2017":1,"2018":1,"2019":1,"2020":1,"2021":1,"2022":1,"2023":1,"2024":1,"2025":1},"ranks":{"1952":2,"1953":2,"1954":2,"1955":2,"1956":3,"1957":3,"1958":3,"1959":3,"1960":3,"1961":2,"1962":2,"1963":2,"1964":2,"1965":2,"1966":3,"1967":3,"1968":3,"1969":3,"1970":3,"1971":3,"1972":3,"1973":3,"1974":3,"1975":3,"1976":3,"1977":3,"1978":3,"1979":3,"1980":3,"1981":3,"1982":3,"1983":3,"1984":4,"1985":4,"1986":4,"1987":4,"1988":4,"1989":4,"1990":4,"1991":4,"1992":4,"1993":4,"1994":4,"1995":4,"1996":5,"1997":5,"1998":5,"1999":5,"2000":5,"2001":5,"2002":5,"2003":5,"2004":5,"2005":5,"2006":6,"2007":6,"2008":5,"2009":6,"2010":6,"2011":6,"2012":6,"2013":6,"2014":6,"2015":6,"2016":6,"2017":6,"2018":7,"2019":7,"2020":7,"2021":7,"2022":7,"2023":7,"2024":7,"2025":7},"order":{"1952":12,"1953":12,"1954":13,"1955":14,"1956":14,"1957":15,"1958":15,"1959":16,"1960":16,"1961":7,"1962":7,"1963":7,"1964":7,"1965":7,"1966":7,"1967":7,"1968":8,"1969":8,"1970":8,"1971":8,"1972":8,"1973":9,"1974":9,"1975":9,"1976":9,"1977":9,"1978":9,"1979":9,"1980":9,"1981":10,"1982":10,"1983":10,"1984":10,"1985":11,"1986":11,"1987":11,"1988":12,"1989":12,"1990":12,"1991":12,"1992":12,"1993":12,"1994":12,"1995":12,"1996":12,"1997":12,"1998":13,"1999":13,"2000":14,"2001":14,"2002":14,"2003":14,"2004":15,"2005":16,"2006":16,"2007":16,"2008":16,"2009":16,"2010":17,"2011":17,"2012":17,"2013":17,"2014":17,"2015":17,"2016":17,"2017":18,"2018":18,"2019":18,"2020":18,"2021":18,"2022":18,"2023":18,"2024":18,"2025":18}},{"country":"India","flag":"🇮🇳","values":{"1952":0,"1953":0,"1954":0,"1955":0,"1956":0,"1957":0,"1958":0,"1959":0,"1960":0,"1961":0,"1962":0,"1963":0,"1964":0,"1965":0,"1966":0,"1967":0,"1968":0,"1969":0,"1970":0,"1971":0,"1972":0,"1973":0,"1974":0,"1975":0,"1976":0,"1977":0,"1978":0,"1979":0,"1980":0,"1981":0,"1982":0,"1983":0,"1984":0,"1985":0,"1986":0,"1987":0,"1988":0,"1989":0,"1990":0,"1991":0,"1992":0,"1993":0,"1994":1,"1995":1,"1996":1,"1997":1,"1998":1,"1999":1,"2000":2,"2001":2,"2002":2,"2003":2,"2004":2,"2005":2,"2006":2,"2007":2,"2008":2,"2009":2,"2010":2,"2011":2,"2012":2,"2013":2,"2014":2,"2015":2,"2016":2,"2017":2,"2018":2,"2019":2,"2020":2,"2021":3,"2022":3,"2023":3,"2024":3,"2025":3},"ranks":{"1952":2,"1953":2,"1954":2,"1955":2,"1956":3,"1957":3,"1958":3,"1959":3,"1960":3,"1961":3,"1962":3,"1963":3,"1964":3,"1965":3,"1966":4,"1967":4,"1968":4,"1969":4,"1970":4,"1971":4,"1972":4,"1973":4,"1974":4,"1975":4,"1976":4,"1977":4,"1978":4,"1979":4,"1980":4,"1981":4,"1982":4,"1983":4,"1984":5,"1985":5,"1986":5,"1987":5,"1988":5,"1989":5,"1990":5,"1991":5,"1992":5,"1993":5,"1994":4,"1995":4,"1996":5,"1997":5,"1998":5,"1999":5,"2000":4,"2001":4,"2002":4,"2003":4,"2004":4,"2005":4,"2006":5,"2007":5,"2008":4,"2009":5,"2010":5,"2011":5,"2012":5,"2013":5,"2014":5,"2015":5,"2016":5,"2017":5,"2018":6,"2019":6,"2020":6,"2021":5,"2022":5,"2023":5,"2024":5,"2025":5},"order":{"1952":14,"1953":14,"1954":15,"1955":16,"1956":16,"1957":17,"1958":17,"1959":18,"1960":18,"1961":18,"1962":18,"1963":18,"1964":18,"1965":19,"1966":19,"1967":19,"1968":19,"1969":20,"1970":21,"1971":22,"1972":22,"1973":22,"1974":23,"1975":23,"1976":24,"1977":25,"1978":26,"1979":27,"1980":27,"1981":27,"1982":27,"1983":28,"1984":28,"1985":28,"1986":28,"1987":28,"1988":28,"1989":29,"1990":30,"1991":31,"1992":32,"1993":32,"1994":28,"1995":28,"1996":28,"1997":28,"1998":28,"1999":28,"2000":9,"2001":9,"2002":9,"2003":9,"2004":9,"2005":9,"2006":9,"2007":9,"2008":9,"2009":9,"2010":9,"2011":9,"2012":9,"2013":9,"2014":9,"2015":9,"2016":9,"2017":9,"2018":9,"2019":10,"2020":11,"2021":7,"2022":7,"2023":7,"2024":7,"2025":7}},{"country":"Japan","flag":"🇯🇵","values":{"1952":0,"1953":0,"1954":0,"1955":0,"1956":0,"1957":0,"1958":0,"1959":1,"1960":1,"1961":1,"1962":1,"1963":1,"1964":1,"1965":1,"1966":1,"1967":1,"1968":1,"1969":1,"1970":1,"1971":1,"1972":1,"1973":1,"1974":1,"1975":1,"1976":1,"1977":1,"1978":1,"1979":1,"1980":1,"1981":1,"1982":1,"1983":1,"1984":1,"1985":1,"1986":1,"1987":1,"1988":1,"1989":1,"1990":1,"1991":1,"1992":1,"1993":1,"1994":1,"1995":1,"1996":1,"1997":1,"1998":1,"1999":1,"2000":1,"2001":1,"2002":1,"2003":1,"2004":1,"2005":1,"2006":1,"2007":2,"2008":2,"2009":2,"2010":2,"2011":2,"2012":2,"2013":2,"2014":2,"2015":2,"2016":2,"2017":2,"2018":2,"2019":2,"2020":2,"2021":2,"2022":2,"2023":2,"2024":2,"2025":2},"ranks":{"1952":2,"1953":2,"1954":2,"1955":2,"1956":3,"1957":3,"1958":3,"1959":2,"1960":2,"1961":2,"1962":2,"1963":2,"1964":2,"1965":2,"1966":3,"1967":3,"1968":3,"1969":3,"1970":3,"1971":3,"1972":3,"1973":3,"1974":3,"1975":3,"1976":3,"1977":3,"1978":3,"1979":3,"1980":3,"1981":3,"1982":3,"1983":3,"1984":4,"1985":4,"1986":4,"1987":4,"1988":4,"1989":4,"1990":4,"1991":4,"1992":4,"1993":4,"1994":4,"1995":4,"1996":5,"1997":5,"1998":5,"1999":5,"2000":5,"2001":5,"2002":5,"2003":5,"2004":5,"2005":5,"2006":6,"2007":5,"2008":4,"2009":5,"2010":5,"2011":5,"2012":5,"2013":5,"2014":5,"2015":5,"2016":5,"2017":5,"2018":6,"2019":6,"2020":6,"2021":6,"2022":6,"2023":6,"2024":6,"2025":6},"order":{"1952":16,"1953":16,"1954":17,"1955":18,"1956":18,"1957":19,"1958":19,"1959":6,"1960":6,"1961":6,"1962":6,"1963":6,"1964":6,"1965":6,"1966":6,"1967":6,"1968":7,"1969":7,"1970":7,"1971":7,"1972":7,"1973":8,"1974":8,"1975":8,"1976":8,"1977":8,"1978":8,"1979":8,"1980":8,"1981":9,"1982":9,"1983":9,"1984":9,"1985":10,"1986":10,"1987":10,"1988":11,"1989":11,"1990":11,"1991":11,"1992":11,"1993":11,"1994":11,"1995":11,"1996":11,"1997":11,"1998":12,"1999":12,"2000":13,"2001":13,"2002":13,"2003":13,"2004":14,"2005":15,"2006":15,"2007":12,"2008":12,"2009":12,"2010":12,"2011":12,"2012":12,"2013":12,"2014":12,"2015":12,"2016":12,"2017":12,"2018":12,"2019":13,"2020":14,"2021":14,"2022":14,"2023":14,"2024":14,"2025":14}},{"country":"Mexico","flag":"🇲🇽","values":{"1952":0,"1953":0,"1954":0,"1955":0,"1956":0,"1957":0,"1958":0,"1959":0,"1960":0,"1961":0,"1962":0,"1963":0,"1964":0,"1965":0,"1966":0,"1967":0,"1968":0,"1969":0,"1970":0,"1971":0,"1972":0,"1973":0,"1974":0,"1975":0,"1976":0,"1977":0,"1978":0,"1979":0,"1980":0,"1981":0,"1982":0,"1983":0,"1984":0,"1985":0,"1986":0,"1987":0,"1988":0,"1989":0,"1990":0,"1991":1,"1992":1,"1993":1,"1994":1,"1995":1,"1996":1,"1997":1,"1998":1,"1999":1,"2000":1,"2001":1,"2002":1,"2003":1,"2004":1,"2005":1,"2006":1,"2007":1,"2008":1,"2009":1,"2010":2,"2011":2,"2012":2,"2013":2,"2014":2,"2015":2,"2016":2,"2017":2,"2018":2,"2019":2,"2020":3,"2021":3,"2022":3,"2023":3,"2024":3,"2025":4},"ranks":{"1952":2,"1953":2,"1954":2,"1955":2,"1956":3,"1957":3,"1958":3,"1959":3,"1960":3,"1961":3,"1962":3,"1963":3,"1964":3,"1965":3,"1966":4,"1967":4,"1968":4,"1969":4,"1970":4,"1971":4,"1972":4,"1973":4,"1974":4,"1975":4,"1976":4,"1977":4,"1978":4,"1979":4,"1980":4,"1981":4,"1982":4,"1983":4,"1984":5,"1985":5,"1986":5,"1987":5,"1988":5,"1989":5,"1990":5,"1991":4,"1992":4,"1993":4,"1994":4,"1995":4,"1996":5,"1997":5,"1998":5,"1999":5,"2000":5,"2001":5,"2002":5,"2003":5,"2004":5,"2005":5,"2006":6,"2007":6,"2008":5,"2009":6,"2010":5,"2011":5,"2012":5,"2013":5,"2014":5,"2015":5,"2016":5,"2017":5,"2018":6,"2019":6,"2020":5,"2021":5,"2022":5,"2023":5,"2024":5,"2025":4},"order":{"1952":18,"1953":18,"1954":19,"1955":20,"1956":20,"1957":21,"1958":21,"1959":21,"1960":21,"1961":21,"1962":21,"1963":21,"1964":21,"1965":22,"1966":22,"1967":22,"1968":22,"1969":23,"1970":24,"1971":24,"1972":24,"1973":24,"1974":25,"1975":25,"1976":25,"1977":26,"1978":27,"1979":28,"1980":28,"1981":28,"1982":28,"1983":29,"1984":29,"1985":29,"1986":29,"1987":29,"1988":29,"1989":30,"1990":31,"1991":26,"1992":26,"1993":26,"1994":26,"1995":26,"1996":26,"1997":26,"1998":26,"1999":26,"2000":27,"2001":27,"2002":27,"2003":27,"2004":27,"2005":27,"2006":27,"2007":27,"2008":27,"2009":27,"2010":13,"2011":13,"2012":13,"2013":13,"2014":13,"2015":13,"2016":13,"2017":13,"2018":13,"2019":14,"2020":6,"2021":6,"2022":6,"2023":6,"2024":6,"2025":4}},{"country":"Peru","flag":"🇵🇪","values":{"1952":0,"1953":0,"1954":0,"1955":0,"1956":0,"1957":1,"1958":1,"1959":1,"1960":1,"1961":1,"1962":1,"1963":1,"1964":1,"1965":1,"1966":1,"1967":1,"1968":1,"1969":1,"1970":1,"1971":1,"1972":1,"1973":1,"1974":1,"1975":1,"1976":1,"1977":1,"1978":1,"1979":1,"1980":1,"1981":1,"1982":1,"1983":1,"1984":1,"1985":1,"1986":1,"1987":1,"1988":1,"1989":1,"1990":1,"1991":1,"1992":1,"1993":1,"1994":1,"1995":1,"1996":1,"1997":1,"1998":1,"1999":1,"2000":1,"2001":1,"2002":1,"2003":1,"2004":1,"2005":1,"2006":1,"2007":1,"2008":1,"2009":1,"2010":1,"2011":1,"2012":1,"2013":1,"2014":1,"2015":1,"2016":1,"2017":1,"2018":1,"2019":1,"2020":1,"2021":1,"2022":1,"2023":1,"2024":1,"2025":1},"ranks":{"1952":2,"1953":2,"1954":2,"1955":2,"1956":3,"1957":2,"1958":2,"1959":2,"1960":2,"1961":2,"1962":2,"1963":2,"1964":2,"1965":2,"1966":3,"1967":3,"1968":3,"1969":3,"1970":3,"1971":3,"1972":3,"1973":3,"1974":3,"1975":3,"1976":3,"1977":3,"1978":3,"1979":3,"1980":3,"1981":3,"1982":3,"1983":3,"1984":4,"1985":4,"1986":4,"1987":4,"1988":4,"1989":4,"1990":4,"1991":4,"1992":4,"1993":4,"1994":4,"1995":4,"1996":5,"1997":5,"1998":5,"1999":5,"2000":5,"2001":5,"2002":5,"2003":5,"2004":5,"2005":5,"2006":6,"2007":6,"2008":5,"2009":6,"2010":6,"2011":6,"2012":6,"2013":6,"2014":6,"2015":6,"2016":6,"2017":6,"2018":7,"2019":7,"2020":7,"2021":7,"2022":7,"2023":7,"2024":7,"2025":7},"order":{"1952":25,"1953":25,"1954":26,"1955":27,"1956":27,"1957":4,"1958":4,"1959":4,"1960":4,"1961":4,"1962":4,"1963":4,"1964":4,"1965":4,"1966":4,"1967":4,"1968":5,"1969":5,"1970":5,"1971":5,"1972":5,"1973":6,"1974":6,"1975":6,"1976":6,"1977":6,"1978":6,"1979":6,"1980":6,"1981":7,"1982":7,"1983":7,"1984":7,"1985":8,"1986":8,"1987":8,"1988":9,"1989":9,"1990":9,"1991":9,"1992":9,"1993":9,"1994":9,"1995":9,"1996":9,"1997":9,"1998":10,"1999":10,"2000":11,"2001":11,"2002":11,"2003":11,"2004":12,"2005":13,"2006":13,"2007":14,"2008":14,"2009":14,"2010":15,"2011":15,"2012":15,"2013":15,"2014":16,"2015":16,"2016":16,"2017":17,"2018":17,"2019":17,"2020":17,"2021":17,"2022":17,"2023":17,"2024":17,"2025":17}},{"country":"Philippines","flag":"🇵🇭","values":{"1952":0,"1953":0,"1954":0,"1955":0,"1956":0,"1957":0,"1958":0,"1959":0,"1960":0,"1961":0,"1962":0,"1963":0,"1964":0,"1965":0,"1966":0,"1967":0,"1968":0,"1969":1,"1970":1,"1971":1,"1972":1,"1973":2,"1974":2,"1975":2,"1976":2,"1977":2,"1978":2,"1979":2,"1980":2,"1981":2,"1982":2,"1983":2,"1984":2,"1985":2,"1986":2,"1987":2,"1988":2,"1989":2,"1990":2,"1991":2,"1992":2,"1993":2,"1994":2,"1995":2,"1996":2,"1997":2,"1998":2,"1999":2,"2000":2,"2001":2,"2002":2,"2003":2,"2004":2,"2005":2,"2006":2,"2007":2,"2008":2,"2009":2,"2010":2,"2011":2,"2012":2,"2013":2,"2014":2,"2015":3,"2016":3,"2017":3,"2018":4,"2019":4,"2020":4,"2021":4,"2022":4,"2023":4,"2024":4,"2025":4},"ranks":{"1952":2,"1953":2,"1954":2,"1955":2,"1956":3,"1957":3,"1958":3,"1959":3,"1960":3,"1961":3,"1962":3,"1963":3,"1964":3,"1965":3,"1966":4,"1967":4,"1968":4,"1969":3,"1970":3,"1971":3,"1972":3,"1973":2,"1974":2,"1975":2,"1976":2,"1977":2,"1978":2,"1979":2,"1980":2,"1981":2,"1982":2,"1983":2,"1984":3,"1985":3,"1986":3,"1987":3,"1988":3,"1989":3,"1990":3,"1991":3,"1992":3,"1993":3,"1994":3,"1995":3,"1996":4,"1997":4,"1998":4,"1999":4,"2000":4,"2001":4,"2002":4,"2003":4,"2004":4,"2005":4,"2006":5,"2007":5,"2008":4,"2009":5,"2010":5,"2011":5,"2012":5,"2013":5,"2014":5,"2015":4,"2016":4,"2017":4,"2018":4,"2019":4,"2020":4,"2021":4,"2022":4,"2023":4,"2024":4,"2025":4},"order":{"1952":26,"1953":26,"1954":27,"1955":28,"1956":28,"1957":28,"1958":28,"1959":28,"1960":28,"1961":28,"1962":28,"1963":28,"1964":28,"1965":29,"1966":29,"1967":29,"1968":29,"1969":12,"1970":12,"1971":12,"1972":12,"1973":3,"1974":3,"1975":3,"1976":3,"1977":3,"1978":3,"1979":3,"1980":3,"1981":3,"1982":3,"1983":3,"1984":3,"1985":3,"1986":4,"1987":4,"1988":4,"1989":4,"1990":4,"1991":4,"1992":4,"1993":5,"1994":5,"1995":5,"1996":5,"1997":5,"1998":5,"1999":5,"2000":5,"2001":5,"2002":5,"2003":5,"2004":5,"2005":5,"2006":5,"2007":5,"2008":5,"2009":5,"2010":5,"2011":5,"2012":5,"2013":5,"2014":5,"2015":4,"2016":4,"2017":4,"2018":3,"2019":3,"2020":3,"2021":3,"2022":3,"2023":3,"2024":3,"2025":3}},{"country":"Puerto Rico","flag":"🇵🇷","values":{"1952":0,"1953":0,"1954":0,"1955":0,"1956":0,"1957":0,"1958":0,"1959":0,"1960":0,"1961":0,"1962":0,"1963":0,"1964":0,"1965":0,"1966":0,"1967":0,"1968":0,"1969":0,"1970":1,"1971":1,"1972":1,"1973":1,"1974":1,"1975":1,"1976":1,"1977":1,"1978":1,"1979":1,"1980":1,"1981":1,"1982":1,"1983":1,"1984":1,"1985":2,"1986":2,"1987":2,"1988":2,"1989":2,"1990":2,"1991":2,"1992":2,"1993":3,"1994":3,"1995":3,"1996":3,"1997":3,"1998":3,"1999":3,"2000":3,"2001":4,"2002":4,"2003":4,"2004":4,"2005":4,"2006":5,"2007":5,"2008":5,"2009":5,"2010":5,"2011":5,"2012":5,"2013":5,"2014":5,"2015":5,"2016":5,"2017":5,"2018":5,"2019":5,"2020":5,"2021":5,"2022":5,"2023":5,"2024":5,"2025":5},"ranks":{"1952":2,"1953":2,"1954":2,"1955":2,"1956":3,"1957":3,"1958":3,"1959":3,"1960":3,"1961":3,"1962":3,"1963":3,"1964":3,"1965":3,"1966":4,"1967":4,"1968":4,"1969":4,"1970":3,"1971":3,"1972":3,"1973":3,"1974":3,"1975":3,"1976":3,"1977":3,"1978":3,"1979":3,"1980":3,"1981":3,"1982":3,"1983":3,"1984":4,"1985":3,"1986":3,"1987":3,"1988":3,"1989":3,"1990":3,"1991":3,"1992":3,"1993":2,"1994":2,"1995":2,"1996":3,"1997":3,"1998":3,"1999":3,"2000":3,"2001":2,"2002":2,"2003":2,"2004":2,"2005":2,"2006":2,"2007":2,"2008":2,"2009":3,"2010":3,"2011":3,"2012":3,"2013":3,"2014":3,"2015":3,"2016":3,"2017":3,"2018":3,"2019":3,"2020":3,"2021":3,"2022":3,"2023":3,"2024":3,"2025":3},"order":{"1952":27,"1953":27,"1954":28,"1955":29,"1956":29,"1957":29,"1958":29,"1959":29,"1960":29,"1961":29,"1962":29,"1963":29,"1964":29,"1965":30,"1966":30,"1967":30,"1968":30,"1969":30,"1970":13,"1971":13,"1972":13,"1973":13,"1974":13,"1975":13,"1976":13,"1977":13,"1978":13,"1979":13,"1980":13,"1981":14,"1982":14,"1983":14,"1984":14,"1985":6,"1986":6,"1987":6,"1988":6,"1989":6,"1990":6,"1991":6,"1992":6,"1993":3,"1994":3,"1995":3,"1996":3,"1997":3,"1998":3,"1999":3,"2000":3,"2001":2,"2002":2,"2003":2,"2004":2,"2005":2,"2006":1,"2007":1,"2008":1,"2009":2,"2010":2,"2011":2,"2012":2,"2013":2,"2014":2,"2015":2,"2016":2,"2017":2,"2018":2,"2019":2,"2020":2,"2021":2,"2022":2,"2023":2,"2024":2,"2025":2}},{"country":"South Africa","flag":"🇿🇦","values":{"1952":0,"1953":0,"1954":0,"1955":0,"1956":0,"1957":0,"1958":0,"1959":0,"1960":0,"1961":0,"1962":0,"1963":0,"1964":0,"1965":0,"1966":0,"1967":0,"1968":0,"1969":0,"1970":0,"1971":0,"1972":0,"1973":0,"1974":0,"1975":0,"1976":0,"1977":0,"1978":1,"1979":1,"1980":1,"1981":1,"1982":1,"1983":1,"1984":1,"1985":1,"1986":1,"1987":1,"1988":1,"1989":1,"1990":1,"1991":1,"1992":1,"1993":1,"1994":1,"1995":1,"1996":1,"1997":1,"1998":1,"1999":1,"2000":1,"2001":1,"2002":1,"2003":1,"2004":1,"2005":1,"2006":1,"2007":1,"2008":1,"2009":1,"2010":1,"2011":1,"2012":1,"2013":1,"2014":1,"2015":1,"2016":1,"2017":2,"2018":2,"2019":3,"2020":3,"2021":3,"2022":3,"2023":3,"2024":3,"2025":3},"ranks":{"1952":2,"1953":2,"1954":2,"1955":2,"1956":3,"1957":3,"1958":3,"1959":3,"1960":3,"1961":3,"1962":3,"1963":3,"1964":3,"1965":3,"1966":4,"1967":4,"1968":4,"1969":4,"1970":4,"1971":4,"1972":4,"1973":4,"1974":4,"1975":4,"1976":4,"1977":4,"1978":3,"1979":3,"1980":3,"1981":3,"1982":3,"1983":3,"1984":4,"1985":4,"1986":4,"1987":4,"1988":4,"1989":4,"1990":4,"1991":4,"1992":4,"1993":4,"1994":4,"1995":4,"1996":5,"1997":5,"1998":5,"1999":5,"2000":5,"2001":5,"2002":5,"2003":5,"2004":5,"2005":5,"2006":6,"2007":6,"2008":5,"2009":6,"2010":6,"2011":6,"2012":6,"2013":6,"2014":6,"2015":6,"2016":6,"2017":5,"2018":6,"2019":5,"2020":5,"2021":5,"2022":5,"2023":5,"2024":5,"2025":5},"order":{"1952":28,"1953":28,"1954":29,"1955":30,"1956":30,"1957":30,"1958":30,"1959":30,"1960":30,"1961":30,"1962":30,"1963":30,"1964":30,"1965":31,"1966":31,"1967":31,"1968":31,"1969":31,"1970":31,"1971":31,"1972":31,"1973":31,"1974":32,"1975":32,"1976":32,"1977":33,"1978":19,"1979":19,"1980":19,"1981":20,"1982":20,"1983":20,"1984":20,"1985":20,"1986":20,"1987":20,"1988":20,"1989":20,"1990":20,"1991":20,"1992":20,"1993":20,"1994":20,"1995":20,"1996":20,"1997":20,"1998":20,"1999":20,"2000":21,"2001":21,"2002":21,"2003":21,"2004":21,"2005":22,"2006":22,"2007":22,"2008":22,"2009":22,"2010":23,"2011":23,"2012":23,"2013":23,"2014":23,"2015":23,"2016":23,"2017":16,"2018":16,"2019":5,"2020":5,"2021":5,"2022":5,"2023":5,"2024":5,"2025":6}},{"country":"Sweden","flag":"🇸🇪","values":{"1952":0,"1953":0,"1954":0,"1955":1,"1956":1,"1957":1,"1958":1,"1959":1,"1960":1,"1961":1,"1962":1,"1963":1,"1964":1,"1965":1,"1966":2,"1967":2,"1968":2,"1969":2,"1970":2,"1971":2,"1972":2,"1973":2,"1974":2,"1975":2,"1976":2,"1977":2,"1978":2,"1979":2,"1980":2,"1981":2,"1982":2,"1983":2,"1984":3,"1985":3,"1986":3,"1987":3,"1988":3,"1989":3,"1990":3,"1991":3,"1992":3,"1993":3,"1994":3,"1995":3,"1996":3,"1997":3,"1998":3,"1999":3,"2000":3,"2001":3,"2002":3,"2003":3,"2004":3,"2005":3,"2006":3,"2007":3,"2008":3,"2009":3,"2010":3,"2011":3,"2012":3,"2013":3,"2014":3,"2015":3,"2016":3,"2017":3,"2018":3,"2019":3,"2020":3,"2021":3,"2022":3,"2023":3,"2024":3,"2025":3},"ranks":{"1952":2,"1953":2,"1954":2,"1955":1,"1956":2,"1957":2,"1958":2,"1959":2,"1960":2,"1961":2,"1962":2,"1963":2,"1964":2,"1965":2,"1966":2,"1967":2,"1968":2,"1969":2,"1970":2,"1971":2,"1972":2,"1973":2,"1974":2,"1975":2,"1976":2,"1977":2,"1978":2,"1979":2,"1980":2,"1981":2,"1982":2,"1983":2,"1984":2,"1985":2,"1986":2,"1987":2,"1988":2,"1989":2,"1990":2,"1991":2,"1992":2,"1993":2,"1994":2,"1995":2,"1996":3,"1997":3,"1998":3,"1999":3,"2000":3,"2001":3,"2002":3,"2003":3,"2004":3,"2005":3,"2006":4,"2007":4,"2008":3,"2009":4,"2010":4,"2011":4,"2012":4,"2013":4,"2014":4,"2015":4,"2016":4,"2017":4,"2018":5,"2019":5,"2020":5,"2021":5,"2022":5,"2023":5,"2024":5,"2025":5},"order":{"1952":30,"1953":30,"1954":31,"1955":3,"1956":3,"1957":3,"1958":3,"1959":3,"1960":3,"1961":3,"1962":3,"1963":3,"1964":3,"1965":3,"1966":1,"1967":1,"1968":1,"1969":1,"1970":1,"1971":1,"1972":1,"1973":1,"1974":1,"1975":1,"1976":1,"1977":1,"1978":1,"1979":1,"1980":1,"1981":1,"1982":1,"1983":1,"1984":1,"1985":1,"1986":1,"1987":1,"1988":1,"1989":1,"1990":1,"1991":1,"1992":1,"1993":1,"1994":1,"1995":1,"1996":2,"1997":2,"1998":2,"1999":2,"2000":2,"2001":3,"2002":3,"2003":3,"2004":3,"2005":3,"2006":3,"2007":3,"2008":3,"2009":3,"2010":3,"2011":3,"2012":3,"2013":3,"2014":3,"2015":3,"2016":3,"2017":3,"2018":4,"2019":4,"2020":4,"2021":4,"2022":4,"2023":4,"2024":4,"2025":5}},{"country":"Thailand","flag":"🇹🇭","values":{"1952":0,"1953":0,"1954":0,"1955":0,"1956":0,"1957":0,"1958":0,"1959":0,"1960":0,"1961":0,"1962":0,"1963":0,"1964":0,"1965":1,"1966":1,"1967":1,"1968":1,"1969":1,"1970":1,"1971":1,"1972":1,"1973":1,"1974":1,"1975":1,"1976":1,"1977":1,"1978":1,"1979":1,"1980":1,"1981":1,"1982":1,"1983":1,"1984":1,"1985":1,"1986":1,"1987":1,"1988":2,"1989":2,"1990":2,"1991":2,"1992":2,"1993":2,"1994":2,"1995":2,"1996":2,"1997":2,"1998":2,"1999":2,"2000":2,"2001":2,"2002":2,"2003":2,"2004":2,"2005":2,"2006":2,"2007":2,"2008":2,"2009":2,"2010":2,"2011":2,"2012":2,"2013":2,"2014":2,"2015":2,"2016":2,"2017":2,"2018":2,"2019":2,"2020":2,"2021":2,"2022":2,"2023":2,"2024":2,"2025":2},"ranks":{"1952":2,"1953":2,"1954":2,"1955":2,"1956":3,"1957":3,"1958":3,"1959":3,"1960":3,"1961":3,"1962":3,"1963":3,"1964":3,"1965":2,"1966":3,"1967":3,"1968":3,"1969":3,"1970":3,"1971":3,"1972":3,"1973":3,"1974":3,"1975":3,"1976":3,"1977":3,"1978":3,"1979":3,"1980":3,"1981":3,"1982":3,"1983":3,"1984":4,"1985":4,"1986":4,"1987":4,"1988":3,"1989":3,"1990":3,"1991":3,"1992":3,"1993":3,"1994":3,"1995":3,"1996":4,"1997":4,"1998":4,"1999":4,"2000":4,"2001":4,"2002":4,"2003":4,"2004":4,"2005":4,"2006":5,"2007":5,"2008":4,"2009":5,"2010":5,"2011":5,"2012":5,"2013":5,"2014":5,"2015":5,"2016":5,"2017":5,"2018":6,"2019":6,"2020":6,"2021":6,"2022":6,"2023":6,"2024":6,"2025":6},"order":{"1952":31,"1953":31,"1954":32,"1955":32,"1956":32,"1957":32,"1958":32,"1959":32,"1960":32,"1961":32,"1962":32,"1963":32,"1964":32,"1965":11,"1966":11,"1967":11,"1968":11,"1969":11,"1970":11,"1971":11,"1972":11,"1973":12,"1974":12,"1975":12,"1976":12,"1977":12,"1978":12,"1979":12,"1980":12,"1981":13,"1982":13,"1983":13,"1984":13,"1985":14,"1986":14,"1987":14,"1988":7,"1989":7,"1990":7,"1991":7,"1992":7,"1993":7,"1994":7,"1995":7,"1996":7,"1997":7,"1998":7,"1999":7,"2000":7,"2001":7,"2002":7,"2003":7,"2004":7,"2005":7,"2006":7,"2007":7,"2008":7,"2009":7,"2010":7,"2011":7,"2012":7,"2013":7,"2014":7,"2015":7,"2016":7,"2017":7,"2018":7,"2019":8,"2020":9,"2021":10,"2022":10,"2023":10,"2024":10,"2025":10}},{"country":"Trinidad and Tobago","flag":"🇹🇹","values":{"1952":0,"1953":0,"1954":0,"1955":0,"1956":0,"1957":0,"1958":0,"1959":0,"1960":0,"1961":0,"1962":0,"1963":0,"1964":0,"1965":0,"1966":0,"1967":0,"1968":0,"1969":0,"1970":0,"1971":0,"1972":0,"1973":0,"1974":0,"1975":0,"1976":0,"1977":1,"1978":1,"1979":1,"1980":1,"1981":1,"1982":1,"1983":1,"1984":1,"1985":1,"1986":1,"1987":1,"1988":1,"1989":1,"1990":1,"1991":1,"1992":1,"1993":1,"1994":1,"1995":1,"1996":1,"1997":1,"1998":2,"1999":2,"2000":2,"2001":2,"2002":2,"2003":2,"2004":2,"2005":2,"2006":2,"2007":2,"2008":2,"2009":2,"2010":2,"2011":2,"2012":2,"2013":2,"2014":2,"2015":2,"2016":2,"2017":2,"2018":2,"2019":2,"2020":2,"2021":2,"2022":2,"2023":2,"2024":2,"2025":2},"ranks":{"1952":2,"1953":2,"1954":2,"1955":2,"1956":3,"1957":3,"1958":3,"1959":3,"1960":3,"1961":3,"1962":3,"1963":3,"1964":3,"1965":3,"1966":4,"1967":4,"1968":4,"1969":4,"1970":4,"1971":4,"1972":4,"1973":4,"1974":4,"1975":4,"1976":4,"1977":3,"1978":3,"1979":3,"1980":3,"1981":3,"1982":3,"1983":3,"1984":4,"1985":4,"1986":4,"1987":4,"1988":4,"1989":4,"1990":4,"1991":4,"1992":4,"1993":4,"1994":4,"1995":4,"1996":5,"1997":5,"1998":4,"1999":4,"2000":4,"2001":4,"2002":4,"2003":4,"2004":4,"2005":4,"2006":5,"2007":5,"2008":4,"2009":5,"2010":5,"2011":5,"2012":5,"2013":5,"2014":5,"2015":5,"2016":5,"2017":5,"2018":6,"2019":6,"2020":6,"2021":6,"2022":6,"2023":6,"2024":6,"2025":6},"order":{"1952":32,"1953":32,"1954":33,"1955":33,"1956":33,"1957":33,"1958":33,"1959":33,"1960":33,"1961":33,"1962":33,"1963":33,"1964":33,"1965":33,"1966":33,"1967":33,"1968":33,"1969":33,"1970":33,"1971":33,"1972":33,"1973":33,"1974":33,"1975":33,"1976":33,"1977":18,"1978":18,"1979":18,"1980":18,"1981":19,"1982":19,"1983":19,"1984":19,"1985":19,"1986":19,"1987":19,"1988":19,"1989":19,"1990":19,"1991":19,"1992":19,"1993":19,"1994":19,"1995":19,"1996":19,"1997":19,"1998":8,"1999":8,"2000":8,"2001":8,"2002":8,"2003":8,"2004":8,"2005":8,"2006":8,"2007":8,"2008":8,"2009":8,"2010":8,"2011":8,"2012":8,"2013":8,"2014":8,"2015":8,"2016":8,"2017":8,"2018":8,"2019":9,"2020":10,"2021":11,"2022":11,"2023":11,"2024":11,"2025":11}},{"country":"United States","flag":"🇺🇸","values":{"1952":0,"1953":0,"1954":1,"1955":1,"1956":2,"1957":2,"1958":2,"1959":2,"1960":3,"1961":3,"1962":3,"1963":3,"1964":3,"1965":3,"1966":3,"1967":4,"1968":4,"1969":4,"1970":4,"1971":4,"1972":4,"1973":4,"1974":4,"1975":4,"1976":4,"1977":4,"1978":4,"1979":4,"1980":5,"1981":5,"1982":5,"1983":5,"1984":5,"1985":5,"1986":5,"1987":5,"1988":5,"1989":5,"1990":5,"1991":5,"1992":5,"1993":5,"1994":5,"1995":6,"1996":6,"1997":7,"1998":7,"1999":7,"2000":7,"2001":7,"2002":7,"2003":7,"2004":7,"2005":7,"2006":7,"2007":7,"2008":7,"2009":7,"2010":7,"2011":7,"2012":8,"2013":8,"2014":8,"2015":8,"2016":8,"2017":8,"2018":8,"2019":8,"2020":8,"2021":8,"2022":9,"2023":9,"2024":9,"2025":9},"ranks":{"1952":2,"1953":2,"1954":1,"1955":1,"1956":1,"1957":1,"1958":1,"1959":1,"1960":1,"1961":1,"1962":1,"1963":1,"1964":1,"1965":1,"1966":1,"1967":1,"1968":1,"1969":1,"1970":1,"1971":1,"1972":1,"1973":1,"1974":1,"1975":1,"1976":1,"1977":1,"1978":1,"1979":1,"1980":1,"1981":1,"1982":1,"1983":1,"1984":1,"1985":1,"1986":1,"1987":1,"1988":1,"1989":1,"1990":1,"1991":1,"1992":1,"1993":1,"1994":1,"1995":1,"1996":1,"1997":1,"1998":1,"1999":1,"2000":1,"2001":1,"2002":1,"2003":1,"2004":1,"2005":1,"2006":1,"2007":1,"2008":1,"2009":1,"2010":1,"2011":1,"2012":1,"2013":1,"2014":1,"2015":1,"2016":1,"2017":1,"2018":1,"2019":1,"2020":1,"2021":1,"2022":1,"2023":1,"2024":1,"2025":1},"order":{"1952":33,"1953":33,"1954":2,"1955":2,"1956":0,"1957":0,"1958":0,"1959":0,"1960":0,"1961":0,"1962":0,"1963":0,"1964":0,"1965":0,"1966":0,"1967":0,"1968":0,"1969":0,"1970":0,"1971":0,"1972":0,"1973":0,"1974":0,"1975":0,"1976":0,"1977":0,"1978":0,"1979":0,"1980":0,"1981":0,"1982":0,"1983":0,"1984":0,"1985":0,"1986":0,"1987":0,"1988":0,"1989":0,"1990":0,"1991":0,"1992":0,"1993":0,"1994":0,"1995":0,"1996":0,"1997":0,"1998":0,"1999":0,"2000":0,"2001":0,"2002":0,"2003":0,"2004":0,"2005":0,"2006":0,"2007":0,"2008":0,"2009":0,"2010":0,"2011":0,"2012":0,"2013":0,"2014":0,"2015":0,"2016":0,"2017":0,"2018":0,"2019":0,"2020":0,"2021":0,"2022":0,"2023":0,"2024":0,"2025":0}},{"country":"Venezuela","flag":"🇻🇪","values":{"1952":0,"1953":0,"1954":0,"1955":0,"1956":0,"1957":0,"1958":0,"1959":0,"1960":0,"1961":0,"1962":0,"1963":0,"1964":0,"1965":0,"1966":0,"1967":0,"1968":0,"1969":0,"1970":0,"1971":0,"1972":0,"1973":0,"1974":0,"1975":0,"1976":0,"1977":0,"1978":0,"1979":1,"1980":1,"1981":2,"1982":2,"1983":2,"1984":2,"1985":2,"1986":3,"1987":3,"1988":3,"1989":3,"1990":3,"1991":3,"1992":3,"1993":3,"1994":3,"1995":3,"1996":4,"1997":4,"1998":4,"1999":4,"2000":4,"2001":4,"2002":4,"2003":4,"2004":4,"2005":4,"2006":4,"2007":4,"2008":5,"2009":6,"2010":6,"2011":6,"2012":6,"2013":7,"2014":7,"2015":7,"2016":7,"2017":7,"2018":7,"2019":7,"2020":7,"2021":7,"2022":7,"2023":7,"2024":7,"2025":7},"ranks":{"1952":2,"1953":2,"1954":2,"1955":2,"1956":3,"1957":3,"1958":3,"1959":3,"1960":3,"1961":3,"1962":3,"1963":3,"1964":3,"1965":3,"1966":4,"1967":4,"1968":4,"1969":4,"1970":4,"1971":4,"1972":4,"1973":4,"1974":4,"1975":4,"1976":4,"1977":4,"1978":4,"1979":3,"1980":3,"1981":2,"1982":2,"1983":2,"1984":3,"1985":3,"1986":2,"1987":2,"1988":2,"1989":2,"1990":2,"1991":2,"1992":2,"1993":2,"1994":2,"1995":2,"1996":2,"1997":2,"1998":2,"1999":2,"2000":2,"2001":2,"2002":2,"2003":2,"2004":2,"2005":2,"2006":3,"2007":3,"2008":2,"2009":2,"2010":2,"2011":2,"2012":2,"2013":2,"2014":2,"2015":2,"2016":2,"2017":2,"2018":2,"2019":2,"2020":2,"2021":2,"2022":2,"2023":2,"2024":2,"2025":2},"order":{"1952":34,"1953":34,"1954":34,"1955":34,"1956":34,"1957":34,"1958":34,"1959":34,"1960":34,"1961":34,"1962":34,"1963":34,"1964":34,"1965":34,"1966":34,"1967":34,"1968":34,"1969":34,"1970":34,"1971":34,"1972":34,"1973":34,"1974":34,"1975":34,"1976":34,"1977":34,"1978":34,"1979":20,"1980":20,"1981":5,"1982":5,"1983":5,"1984":5,"1985":5,"1986":2,"1987":2,"1988":2,"1989":2,"1990":2,"1991":2,"1992":2,"1993":2,"1994":2,"1995":2,"1996":1,"1997":1,"1998":1,"1999":1,"2000":1,"2001":1,"2002":1,"2003":1,"2004":1,"2005":1,"2006":2,"2007":2,"2008":2,"2009":1,"2010":1,"2011":1,"2012":1,"2013":1,"2014":1,"2015":1,"2016":1,"2017":1,"2018":1,"2019":1,"2020":1,"2021":1,"2022":1,"2023":1,"2024":1,"2025":1}}],"card_bg":"pink","outro_question":"Who's YOUR pick for the next Miss Universe? 👑","cta_line":"Show us your city's most beautiful spot on hilads.live ✨","caption":"The United States took its 2nd crown in 1956 and has led ever since: 9 crowns today. Venezuela came closest, one crown away in 2009 and 2013, and its 2008–2009 double is still the only back-to-back win in the pageant's history 👑 Mexico's 2025 crown lifts it level with the Philippines at 4. And Vietnam? Its best ever is H'Hen Niê's Top 5 in 2018. Different Worlds by Hilads.","hashtags":["#DifferentWorlds","#MissUniverse","#Pageant","#Venezuela","#Philippines","#Vietnam"],"warnings":["Winners 1952-2025 as in the official results (list of titleholders, cross-checked with its by-country table: every count matches). The 2026 edition is on 24 November 2026, after this video: not included.","2002: Oxana Fedorova (Russia) was dethroned and Justine Pasek (Panama) became Miss Universe 2002: counted for Panama, as the official list does.","Ties share a rank; among tied countries, the first to reach that count stays above. The US has led alone every year since 1956; Venezuela never overtook it.","Vietnam: no crown; best result H'Hen Niê, Top 5 in 2018 (2025: Hương Giang unplaced)."]}
JSON, true, 512, JSON_THROW_ON_ERROR);
        $r = DwStudio::importRace($topic, $content, 'Claude Code');
        echo $r['ok'] ? "  OK  dw: 2026-11-19 race package v{$r['version']}\n" : "  ERR dw Nov 19 race: " . implode(' ', $r['errors']) . "\n";
    }
} catch (Throwable $e) {
    echo "  ERR dw Nov 19 race: " . $e->getMessage() . "\n";
}

// Once: Nov 20 becomes the race "The countries with the world's best universities, 2003 to 2026"; the old Teachers' Day topic is replaced (dropped, unpublished). As Nov 16.
try {
    require_once __DIR__ . '/vendor/autoload.php';
    $old = $pdo->query("SELECT id, title, status FROM dw_topics WHERE date = '2026-11-20' AND title ILIKE 'Vietnamese Teachers'' Day%'")->fetch(PDO::FETCH_ASSOC);
    if ($old && $old['status'] !== 'published') {
        DwStudio::deleteTopic((int) $old['id']);
        echo "  OK  dw: dropped 2026-11-20 \"{$old['title']}\" (replaced by the race, same day, same theme)\n";
    }
    $title = 'The countries with the world\'s best universities, 2003 to 2026';
    if (!$pdo->query("SELECT 1 FROM dw_topics WHERE date = '2026-11-20'")->fetchColumn()) {
        $pdo->prepare("INSERT INTO dw_topics (date, title, notes, type, needs_date_check, format) VALUES ('2026-11-20', ?, ?, 'evergreen', false, 'race')")
            ->execute([$title, 'Race for Vietnamese Teachers\' Day: universities in the ARWU top 100 per country, every edition 2003-2026 (ShanghaiRanking). The US 58 -> 37, mainland China 0 until 2016, passes the UK in 2023 (banner), 16 in 2026.']);
        echo "  OK  dw: 2026-11-20 race topic\n";
    }
    $topic = DwStudio::topicByDate('2026-11-20');
    if ($topic !== null && $topic['format'] === 'race' && $topic['title'] === $title && DwStudio::package($topic['id']) === null) {
        $content = json_decode(<<<'JSON'
{"format":"race","topic":"The countries with the world's best universities, 2003 to 2026","headline":"The countries with the world's best universities, 2003 → 2026 🎓","headline_accent":"best universities","detail":"2023: China passes the UK 🇨🇳","banner_year":2023,"value_label":"Universities in the ARWU top 100","data_years":"2003–2026","unit":"","decimals":0,"value_prefix":"🎓 x","source":"ShanghaiRanking (ARWU)","source_url":"https://www.shanghairanking.com/rankings/arwu/2026","series":[{"country":"Australia","flag":"🇦🇺","values":{"2003":2,"2004":2,"2005":2,"2006":2,"2007":2,"2008":3,"2009":3,"2010":3,"2011":4,"2012":5,"2013":5,"2014":4,"2015":4,"2016":6,"2017":6,"2018":6,"2019":7,"2020":7,"2021":7,"2022":7,"2023":6,"2024":5,"2025":5,"2026":5},"ranks":{"2003":6,"2004":7,"2005":6,"2006":7,"2007":6,"2008":5,"2009":5,"2010":5,"2011":5,"2012":3,"2013":3,"2014":4,"2015":3,"2016":3,"2017":3,"2018":3,"2019":3,"2020":3,"2021":3,"2022":3,"2023":4,"2024":4,"2025":4,"2026":4},"order":{"2003":8,"2004":8,"2005":8,"2006":8,"2007":8,"2008":7,"2009":6,"2010":6,"2011":5,"2012":2,"2013":2,"2014":6,"2015":5,"2016":2,"2017":2,"2018":2,"2019":2,"2020":2,"2021":2,"2022":3,"2023":3,"2024":4,"2025":4,"2026":4}},{"country":"Belgium","flag":"🇧🇪","values":{"2003":1,"2004":0,"2005":0,"2006":0,"2007":0,"2008":0,"2009":0,"2010":1,"2011":1,"2012":1,"2013":1,"2014":2,"2015":2,"2016":2,"2017":2,"2018":2,"2019":2,"2020":2,"2021":2,"2022":2,"2023":2,"2024":2,"2025":2,"2026":2},"ranks":{"2003":7,"2004":9,"2005":8,"2006":9,"2007":8,"2008":8,"2009":8,"2010":7,"2011":8,"2012":7,"2013":7,"2014":6,"2015":5,"2016":6,"2017":7,"2018":7,"2019":7,"2020":8,"2021":7,"2022":7,"2023":8,"2024":7,"2025":7,"2026":7},"order":{"2003":11,"2004":22,"2005":22,"2006":21,"2007":20,"2008":20,"2009":20,"2010":15,"2011":15,"2012":15,"2013":15,"2014":11,"2015":11,"2016":11,"2017":11,"2018":12,"2019":12,"2020":12,"2021":13,"2022":12,"2023":12,"2024":10,"2025":11,"2026":9}},{"country":"Canada","flag":"🇨🇦","values":{"2003":4,"2004":4,"2005":4,"2006":4,"2007":4,"2008":4,"2009":4,"2010":4,"2011":4,"2012":4,"2013":4,"2014":4,"2015":4,"2016":4,"2017":4,"2018":4,"2019":4,"2020":4,"2021":4,"2022":5,"2023":5,"2024":3,"2025":3,"2026":3},"ranks":{"2003":4,"2004":5,"2005":4,"2006":5,"2007":4,"2008":4,"2009":4,"2010":4,"2011":5,"2012":4,"2013":4,"2014":4,"2015":3,"2016":4,"2017":5,"2018":5,"2019":5,"2020":6,"2021":5,"2022":4,"2023":5,"2024":6,"2025":6,"2026":6},"order":{"2003":4,"2004":4,"2005":4,"2006":4,"2007":4,"2008":3,"2009":4,"2010":4,"2011":4,"2012":3,"2013":3,"2014":3,"2015":2,"2016":3,"2017":4,"2018":4,"2019":4,"2020":6,"2021":5,"2022":4,"2023":4,"2024":8,"2025":8,"2026":7}},{"country":"China","flag":"🇨🇳","values":{"2003":0,"2004":0,"2005":0,"2006":0,"2007":0,"2008":0,"2009":0,"2010":0,"2011":0,"2012":0,"2013":0,"2014":0,"2015":0,"2016":2,"2017":2,"2018":3,"2019":4,"2020":6,"2021":7,"2022":8,"2023":10,"2024":13,"2025":13,"2026":16},"ranks":{"2003":8,"2004":9,"2005":8,"2006":9,"2007":8,"2008":8,"2009":8,"2010":8,"2011":9,"2012":8,"2013":8,"2014":8,"2015":7,"2016":6,"2017":7,"2018":6,"2019":5,"2020":4,"2021":3,"2022":2,"2023":2,"2024":2,"2025":2,"2026":2},"order":{"2003":17,"2004":17,"2005":17,"2006":16,"2007":15,"2008":15,"2009":15,"2010":16,"2011":16,"2012":16,"2013":16,"2014":16,"2015":16,"2016":13,"2017":12,"2018":10,"2019":7,"2020":3,"2021":3,"2022":2,"2023":1,"2024":1,"2025":1,"2026":1}},{"country":"Denmark","flag":"🇩🇰","values":{"2003":1,"2004":1,"2005":1,"2006":1,"2007":1,"2008":2,"2009":2,"2010":2,"2011":2,"2012":2,"2013":2,"2014":2,"2015":2,"2016":2,"2017":2,"2018":2,"2019":2,"2020":2,"2021":2,"2022":2,"2023":2,"2024":2,"2025":2,"2026":2},"ranks":{"2003":7,"2004":8,"2005":7,"2006":8,"2007":7,"2008":6,"2009":6,"2010":6,"2011":7,"2012":6,"2013":6,"2014":6,"2015":5,"2016":6,"2017":7,"2018":7,"2019":7,"2020":8,"2021":7,"2022":7,"2023":8,"2024":7,"2025":7,"2026":7},"order":{"2003":12,"2004":11,"2005":11,"2006":10,"2007":10,"2008":10,"2009":10,"2010":10,"2011":10,"2012":11,"2013":11,"2014":10,"2015":10,"2016":10,"2017":10,"2018":11,"2019":11,"2020":11,"2021":12,"2022":11,"2023":11,"2024":9,"2025":10,"2026":8}},{"country":"France","flag":"🇫🇷","values":{"2003":2,"2004":4,"2005":4,"2006":4,"2007":4,"2008":3,"2009":3,"2010":3,"2011":3,"2012":3,"2013":4,"2014":4,"2015":4,"2016":3,"2017":3,"2018":3,"2019":3,"2020":5,"2021":4,"2022":4,"2023":4,"2024":4,"2025":4,"2026":4},"ranks":{"2003":6,"2004":5,"2005":4,"2006":5,"2007":4,"2008":5,"2009":5,"2010":5,"2011":6,"2012":5,"2013":4,"2014":4,"2015":3,"2016":5,"2017":6,"2018":6,"2019":6,"2020":5,"2021":5,"2022":5,"2023":6,"2024":5,"2025":5,"2026":5},"order":{"2003":9,"2004":5,"2005":5,"2006":5,"2007":5,"2008":8,"2009":7,"2010":7,"2011":7,"2012":7,"2013":6,"2014":5,"2015":4,"2016":7,"2017":8,"2018":8,"2019":9,"2020":5,"2021":7,"2022":6,"2023":7,"2024":6,"2025":6,"2026":6}},{"country":"Germany","flag":"🇩🇪","values":{"2003":5,"2004":7,"2005":5,"2006":5,"2007":6,"2008":6,"2009":5,"2010":5,"2011":6,"2012":4,"2013":4,"2014":4,"2015":4,"2016":3,"2017":4,"2018":4,"2019":4,"2020":4,"2021":4,"2022":4,"2023":4,"2024":4,"2025":4,"2026":4},"ranks":{"2003":3,"2004":3,"2005":3,"2006":4,"2007":3,"2008":3,"2009":3,"2010":3,"2011":3,"2012":4,"2013":4,"2014":4,"2015":3,"2016":5,"2017":5,"2018":5,"2019":5,"2020":6,"2021":5,"2022":5,"2023":6,"2024":5,"2025":5,"2026":5},"order":{"2003":2,"2004":2,"2005":3,"2006":3,"2007":3,"2008":2,"2009":2,"2010":2,"2011":2,"2012":5,"2013":5,"2014":4,"2015":3,"2016":8,"2017":5,"2018":5,"2019":5,"2020":7,"2021":6,"2022":5,"2023":6,"2024":5,"2025":5,"2026":5}},{"country":"Israel","flag":"🇮🇱","values":{"2003":1,"2004":1,"2005":1,"2006":1,"2007":1,"2008":1,"2009":1,"2010":1,"2011":1,"2012":3,"2013":3,"2014":2,"2015":2,"2016":2,"2017":1,"2018":2,"2019":1,"2020":1,"2021":3,"2022":3,"2023":3,"2024":3,"2025":3,"2026":2},"ranks":{"2003":7,"2004":8,"2005":7,"2006":8,"2007":7,"2008":7,"2009":7,"2010":7,"2011":8,"2012":5,"2013":5,"2014":6,"2015":5,"2016":6,"2017":8,"2018":7,"2019":8,"2020":9,"2021":6,"2022":6,"2023":7,"2024":6,"2025":6,"2026":7},"order":{"2003":14,"2004":13,"2005":13,"2006":12,"2007":12,"2008":12,"2009":12,"2010":12,"2011":12,"2012":9,"2013":8,"2014":12,"2015":12,"2016":12,"2017":17,"2018":13,"2019":17,"2020":17,"2021":10,"2022":9,"2023":9,"2024":7,"2025":7,"2026":14}},{"country":"Japan","flag":"🇯🇵","values":{"2003":5,"2004":5,"2005":5,"2006":6,"2007":6,"2008":4,"2009":5,"2010":5,"2011":5,"2012":4,"2013":3,"2014":3,"2015":4,"2016":4,"2017":3,"2018":3,"2019":3,"2020":3,"2021":3,"2022":2,"2023":2,"2024":2,"2025":2,"2026":2},"ranks":{"2003":3,"2004":4,"2005":3,"2006":3,"2007":3,"2008":4,"2009":3,"2010":3,"2011":4,"2012":4,"2013":5,"2014":5,"2015":3,"2016":4,"2017":6,"2018":6,"2019":6,"2020":7,"2021":6,"2022":7,"2023":8,"2024":7,"2025":7,"2026":7},"order":{"2003":3,"2004":3,"2005":2,"2006":2,"2007":2,"2008":5,"2009":3,"2010":3,"2011":3,"2012":6,"2013":9,"2014":9,"2015":7,"2016":4,"2017":9,"2018":9,"2019":10,"2020":10,"2021":9,"2022":14,"2023":14,"2024":12,"2025":13,"2026":11}},{"country":"Netherlands","flag":"🇳🇱","values":{"2003":3,"2004":2,"2005":2,"2006":2,"2007":2,"2008":2,"2009":2,"2010":2,"2011":2,"2012":2,"2013":3,"2014":4,"2015":4,"2016":3,"2017":4,"2018":4,"2019":4,"2020":4,"2021":3,"2022":3,"2023":3,"2024":2,"2025":2,"2026":2},"ranks":{"2003":5,"2004":7,"2005":6,"2006":7,"2007":6,"2008":6,"2009":6,"2010":6,"2011":7,"2012":6,"2013":5,"2014":4,"2015":3,"2016":5,"2017":5,"2018":5,"2019":5,"2020":6,"2021":6,"2022":6,"2023":7,"2024":7,"2025":7,"2026":7},"order":{"2003":5,"2004":9,"2005":9,"2006":9,"2007":9,"2008":9,"2009":9,"2010":9,"2011":9,"2012":10,"2013":10,"2014":7,"2015":6,"2016":9,"2017":6,"2018":6,"2019":6,"2020":8,"2021":11,"2022":10,"2023":10,"2024":13,"2025":14,"2026":12}},{"country":"Sweden","flag":"🇸🇪","values":{"2003":3,"2004":4,"2005":4,"2006":4,"2007":4,"2008":4,"2009":3,"2010":3,"2011":3,"2012":3,"2013":3,"2014":3,"2015":3,"2016":3,"2017":3,"2018":3,"2019":3,"2020":3,"2021":3,"2022":3,"2023":3,"2024":2,"2025":3,"2026":2},"ranks":{"2003":5,"2004":5,"2005":4,"2006":5,"2007":4,"2008":4,"2009":5,"2010":5,"2011":6,"2012":5,"2013":5,"2014":5,"2015":4,"2016":5,"2017":6,"2018":6,"2019":6,"2020":7,"2021":6,"2022":6,"2023":7,"2024":7,"2025":6,"2026":7},"order":{"2003":6,"2004":6,"2005":6,"2006":6,"2007":6,"2008":4,"2009":8,"2010":8,"2011":8,"2012":8,"2013":7,"2014":8,"2015":9,"2016":6,"2017":7,"2018":7,"2019":8,"2020":9,"2021":8,"2022":8,"2023":8,"2024":14,"2025":9,"2026":15}},{"country":"Switzerland","flag":"🇨🇭","values":{"2003":3,"2004":3,"2005":3,"2006":3,"2007":3,"2008":3,"2009":3,"2010":3,"2011":4,"2012":4,"2013":4,"2014":5,"2015":4,"2016":4,"2017":5,"2018":5,"2019":5,"2020":5,"2021":5,"2022":4,"2023":5,"2024":5,"2025":5,"2026":5},"ranks":{"2003":5,"2004":6,"2005":5,"2006":6,"2007":5,"2008":5,"2009":5,"2010":5,"2011":5,"2012":4,"2013":4,"2014":3,"2015":3,"2016":4,"2017":4,"2018":4,"2019":4,"2020":5,"2021":4,"2022":5,"2023":5,"2024":4,"2025":4,"2026":4},"order":{"2003":7,"2004":7,"2005":7,"2006":7,"2007":7,"2008":6,"2009":5,"2010":5,"2011":6,"2012":4,"2013":4,"2014":2,"2015":8,"2016":5,"2017":3,"2018":3,"2019":3,"2020":4,"2021":4,"2022":7,"2023":5,"2024":3,"2025":3,"2026":3}},{"country":"United Kingdom","flag":"🇬🇧","values":{"2003":9,"2004":11,"2005":11,"2006":11,"2007":11,"2008":11,"2009":11,"2010":11,"2011":10,"2012":9,"2013":9,"2014":8,"2015":9,"2016":8,"2017":9,"2018":8,"2019":8,"2020":8,"2021":8,"2022":8,"2023":8,"2024":8,"2025":8,"2026":8},"ranks":{"2003":2,"2004":2,"2005":2,"2006":2,"2007":2,"2008":2,"2009":2,"2010":2,"2011":2,"2012":2,"2013":2,"2014":2,"2015":2,"2016":2,"2017":2,"2018":2,"2019":2,"2020":2,"2021":2,"2022":2,"2023":3,"2024":3,"2025":3,"2026":3},"order":{"2003":1,"2004":1,"2005":1,"2006":1,"2007":1,"2008":1,"2009":1,"2010":1,"2011":1,"2012":1,"2013":1,"2014":1,"2015":1,"2016":1,"2017":1,"2018":1,"2019":1,"2020":1,"2021":1,"2022":1,"2023":2,"2024":2,"2025":2,"2026":2}},{"country":"United States","flag":"🇺🇸","values":{"2003":58,"2004":51,"2005":53,"2006":54,"2007":54,"2008":54,"2009":55,"2010":54,"2011":53,"2012":53,"2013":52,"2014":52,"2015":51,"2016":50,"2017":48,"2018":46,"2019":45,"2020":41,"2021":40,"2022":39,"2023":38,"2024":38,"2025":37,"2026":37},"ranks":{"2003":1,"2004":1,"2005":1,"2006":1,"2007":1,"2008":1,"2009":1,"2010":1,"2011":1,"2012":1,"2013":1,"2014":1,"2015":1,"2016":1,"2017":1,"2018":1,"2019":1,"2020":1,"2021":1,"2022":1,"2023":1,"2024":1,"2025":1,"2026":1},"order":{"2003":0,"2004":0,"2005":0,"2006":0,"2007":0,"2008":0,"2009":0,"2010":0,"2011":0,"2012":0,"2013":0,"2014":0,"2015":0,"2016":0,"2017":0,"2018":0,"2019":0,"2020":0,"2021":0,"2022":0,"2023":0,"2024":0,"2025":0,"2026":0}}],"card_bg":"blue","outro_question":"Which teacher changed YOUR life? 🍎","cta_line":"Show us your old school on hilads.live 🎓","caption":"Happy Vietnamese Teachers' Day 🍎 (Nov 20)\n\nIn 2003, 58 of the world's top 100 universities were American. Today: 37. Mainland China had none until 2016, caught the UK in 2022 and passed it in 2023: 16 universities in the top 100 this year. Behind every one of them: teachers. Different Worlds by Hilads.","hashtags":["#DifferentWorlds","#TeachersDay","#NgayNhaGiaoVietNam","#University","#ShanghaiRanking","#Education"],"warnings":["ShanghaiRanking's Academic Ranking of World Universities (ARWU), every edition 2003-2026 (shanghairanking.com, its rankings data): the universities with an exact rank of 100 or better (some years 101 with a tie at #100; past #100 ARWU publishes ranges only).","Countries as ARWU labels them: mainland China and Hong Kong ('China-Hong Kong') are separate.","Ties share a rank; among tied countries, the one at that count first (since that year) stays above. 2022: China ties the UK at 8 (the UK stays above), 2023: China 10, the UK 8.","No Vietnamese university in the top 100."]}
JSON, true, 512, JSON_THROW_ON_ERROR);
        $r = DwStudio::importRace($topic, $content, 'Claude Code');
        echo $r['ok'] ? "  OK  dw: 2026-11-20 race package v{$r['version']}\n" : "  ERR dw Nov 20 race: " . implode(' ', $r['errors']) . "\n";
    }
} catch (Throwable $e) {
    echo "  ERR dw Nov 20 race: " . $e->getMessage() . "\n";
}

// Once: Nov 21 becomes the race "The countries with the world's best bars, 2009 to 2026"; the old topic moves to the first date with no topic from Nov 22. As Nov 16.
try {
    require_once __DIR__ . '/vendor/autoload.php';
    $old = $pdo->query("SELECT id, title, status FROM dw_topics WHERE date = '2026-11-21' AND title ILIKE 'World Hello Day%'")->fetch(PDO::FETCH_ASSOC);
    if ($old && $old['status'] !== 'published') {
        $free = $pdo->query("SELECT d::date::text FROM generate_series('2026-11-22'::date, '2027-12-31'::date, '1 day') d
                             WHERE NOT EXISTS (SELECT 1 FROM dw_topics t WHERE t.date = d::date) ORDER BY d LIMIT 1")->fetchColumn();
        $pdo->prepare("UPDATE dw_topics SET date = ?::date, updated_at = now() WHERE id = ?")->execute([$free, $old['id']]);
        echo "  OK  dw: \"{$old['title']}\" moved from 2026-11-21 to {$free}\n";
    }
    $title = 'The countries with the world\'s best bars, 2009 to 2026';
    if (!$pdo->query("SELECT 1 FROM dw_topics WHERE date = '2026-11-21'")->fetchColumn()) {
        $pdo->prepare("INSERT INTO dw_topics (date, title, notes, type, needs_date_check, format) VALUES ('2026-11-21', ?, ?, 'evergreen', false, 'race')")
            ->execute([$title, 'Race: bars per country in The World\'s 50 Best Bars (1-50), every list 2009-2026. The UK and the US had 26 of 50 in 2012, 7 in 2026; Singapore tops them in 2021 (banner); 2026: Hong Kong, Mexico, the US and France tied at 4. No Vietnamese bar.']);
        echo "  OK  dw: 2026-11-21 race topic\n";
    }
    $topic = DwStudio::topicByDate('2026-11-21');
    if ($topic !== null && $topic['format'] === 'race' && $topic['title'] === $title && DwStudio::package($topic['id']) === null) {
        $content = json_decode(<<<'JSON'
{"format":"race","topic":"The countries with the world's best bars, 2009 to 2026","headline":"The countries with the world's best bars, 2009 → 2026 🍸","headline_accent":"best bars","detail":"2021: Singapore tops the UK and the US 🇸🇬","banner_year":2021,"value_label":"Bars in The World's 50 Best Bars list","data_years":"2009–2026","unit":"","decimals":0,"value_prefix":"🍸 x","step_seconds":0.8,"source":"The World's 50 Best Bars","source_url":"https://www.theworlds50best.com/bars/list/1-50","card_bg":"yellow","outro_question":"What's YOUR favorite bar in your city? 🍸","cta_line":"Show us your favorite bar on hilads.live 🍸","caption":"Saturday night plans? 🍸 In 2012, 26 of The World's 50 Best Bars were in the UK or the US. In 2026: 7. Singapore topped them both in 2021, and this year's list is the most global ever: 22 countries, with Hong Kong, Mexico, the US and France tied at 4 bars each (Hong Kong also has the world's #1, Bar Leone). Great bars are about craft, not quantity: pick one, sip slowly, and get home safe. Different Worlds by Hilads.","hashtags":["#DifferentWorlds","#Worlds50BestBars","#Cocktails","#SaturdayNight","#BarLeone","#Mixology"],"warnings":["The World's 50 Best Bars, every list 2009-2026 (theworlds50best.com, its previous lists and the 2026 list): the bars ranked 1 to 50 (since 2023 the site also ranks 51-100: not counted). Every edition published, none missing; every year adds up to 50.","Countries from each bar's city; Hong Kong apart from mainland China, Puerto Rico apart from the US. 2010 has a tie at #29 (still 50 bars).","Ties share a rank; among tied countries, the one at that count first (since that year) stays above, then the one with the best-ranked bar. 2026: Hong Kong, Mexico, the US and France tie at 4 (Hong Kong above: the #1 bar).","Vietnam: no bar in the 1-50 list in any year: no extra row.","Responsible tone: no drinking amounts, the caption ends on 'get home safe'."],"series":[{"country":"Argentina","flag":"🇦🇷","values":{"2009":0,"2010":1,"2011":1,"2012":1,"2013":1,"2014":1,"2015":0,"2016":1,"2017":1,"2018":1,"2019":2,"2020":2,"2021":3,"2022":3,"2023":3,"2024":3,"2025":2,"2026":2},"ranks":{"2009":6,"2010":6,"2011":6,"2012":6,"2013":6,"2014":6,"2015":7,"2016":5,"2017":6,"2018":5,"2019":5,"2020":5,"2021":3,"2022":4,"2023":4,"2024":3,"2025":4,"2026":3},"order":{"2009":14,"2010":14,"2011":9,"2012":9,"2013":11,"2014":9,"2015":35,"2016":19,"2017":14,"2018":12,"2019":7,"2020":8,"2021":7,"2022":6,"2023":5,"2024":6,"2025":12,"2026":12}},{"country":"Australia","flag":"🇦🇺","values":{"2009":12,"2010":5,"2011":3,"2012":4,"2013":6,"2014":6,"2015":4,"2016":3,"2017":2,"2018":1,"2019":1,"2020":3,"2021":4,"2022":2,"2023":2,"2024":3,"2025":2,"2026":1},"ranks":{"2009":1,"2010":2,"2011":4,"2012":4,"2013":3,"2014":3,"2015":3,"2016":3,"2017":5,"2018":5,"2019":6,"2020":4,"2021":2,"2022":5,"2023":5,"2024":3,"2025":4,"2026":4},"order":{"2009":2,"2010":3,"2011":4,"2012":4,"2013":3,"2014":3,"2015":3,"2016":4,"2017":8,"2018":20,"2019":16,"2020":6,"2021":5,"2022":12,"2023":10,"2024":9,"2025":15,"2026":19}},{"country":"Brazil","flag":"🇧🇷","values":{"2009":0,"2010":2,"2011":0,"2012":0,"2013":0,"2014":0,"2015":0,"2016":0,"2017":0,"2018":0,"2019":1,"2020":0,"2021":0,"2022":0,"2023":0,"2024":1,"2025":1,"2026":2},"ranks":{"2009":6,"2010":5,"2011":7,"2012":7,"2013":7,"2014":7,"2015":7,"2016":6,"2017":7,"2018":6,"2019":6,"2020":7,"2021":6,"2022":7,"2023":7,"2024":5,"2025":5,"2026":3},"order":{"2009":15,"2010":10,"2011":33,"2012":31,"2013":29,"2014":29,"2015":29,"2016":26,"2017":25,"2018":26,"2019":20,"2020":34,"2021":28,"2022":30,"2023":30,"2024":18,"2025":17,"2026":14}},{"country":"China","flag":"🇨🇳","values":{"2009":0,"2010":0,"2011":0,"2012":0,"2013":0,"2014":0,"2015":0,"2016":1,"2017":1,"2018":1,"2019":2,"2020":1,"2021":3,"2022":0,"2023":0,"2024":0,"2025":1,"2026":1},"ranks":{"2009":6,"2010":7,"2011":7,"2012":7,"2013":7,"2014":7,"2015":7,"2016":5,"2017":6,"2018":5,"2019":5,"2020":6,"2021":3,"2022":7,"2023":7,"2024":6,"2025":5,"2026":4},"order":{"2009":16,"2010":18,"2011":17,"2012":17,"2013":17,"2014":17,"2015":20,"2016":14,"2017":12,"2018":14,"2019":9,"2020":21,"2021":10,"2022":35,"2023":34,"2024":33,"2025":20,"2026":17}},{"country":"Colombia","flag":"🇨🇴","values":{"2009":0,"2010":0,"2011":0,"2012":0,"2013":0,"2014":0,"2015":0,"2016":0,"2017":0,"2018":0,"2019":0,"2020":1,"2021":0,"2022":1,"2023":1,"2024":2,"2025":1,"2026":3},"ranks":{"2009":6,"2010":7,"2011":7,"2012":7,"2013":7,"2014":7,"2015":7,"2016":6,"2017":7,"2018":6,"2019":7,"2020":6,"2021":6,"2022":6,"2023":6,"2024":4,"2025":5,"2026":2},"order":{"2009":17,"2010":19,"2011":18,"2012":18,"2013":18,"2014":18,"2015":21,"2016":21,"2017":21,"2018":22,"2019":23,"2020":22,"2021":31,"2022":15,"2023":15,"2024":14,"2025":19,"2026":7}},{"country":"Cuba","flag":"🇨🇺","values":{"2009":0,"2010":0,"2011":1,"2012":0,"2013":0,"2014":0,"2015":0,"2016":0,"2017":0,"2018":0,"2019":0,"2020":0,"2021":0,"2022":0,"2023":0,"2024":0,"2025":0,"2026":0},"ranks":{"2009":6,"2010":7,"2011":6,"2012":7,"2013":7,"2014":7,"2015":7,"2016":6,"2017":7,"2018":6,"2019":7,"2020":7,"2021":6,"2022":7,"2023":7,"2024":6,"2025":6,"2026":5},"order":{"2009":18,"2010":20,"2011":14,"2012":33,"2013":31,"2014":31,"2015":31,"2016":28,"2017":27,"2018":28,"2019":27,"2020":25,"2021":19,"2022":21,"2023":21,"2024":21,"2025":22,"2026":21}},{"country":"Cyprus","flag":"🇨🇾","values":{"2009":0,"2010":0,"2011":0,"2012":0,"2013":0,"2014":0,"2015":1,"2016":1,"2017":1,"2018":1,"2019":0,"2020":0,"2021":0,"2022":0,"2023":0,"2024":0,"2025":0,"2026":0},"ranks":{"2009":6,"2010":7,"2011":7,"2012":7,"2013":7,"2014":7,"2015":6,"2016":5,"2017":6,"2018":5,"2019":7,"2020":7,"2021":6,"2022":7,"2023":7,"2024":6,"2025":6,"2026":5},"order":{"2009":19,"2010":21,"2011":19,"2012":19,"2013":19,"2014":19,"2015":19,"2016":12,"2017":10,"2018":10,"2019":35,"2020":32,"2021":26,"2022":28,"2023":28,"2024":28,"2025":29,"2026":28}},{"country":"Czechia","flag":"🇨🇿","values":{"2009":0,"2010":0,"2011":0,"2012":1,"2013":0,"2014":1,"2015":0,"2016":0,"2017":0,"2018":0,"2019":0,"2020":0,"2021":0,"2022":0,"2023":0,"2024":0,"2025":0,"2026":0},"ranks":{"2009":6,"2010":7,"2011":7,"2012":6,"2013":7,"2014":6,"2015":7,"2016":6,"2017":7,"2018":6,"2019":7,"2020":7,"2021":6,"2022":7,"2023":7,"2024":6,"2025":6,"2026":5},"order":{"2009":20,"2010":22,"2011":20,"2012":14,"2013":34,"2014":14,"2015":36,"2016":32,"2017":31,"2018":32,"2019":31,"2020":29,"2021":23,"2022":25,"2023":25,"2024":25,"2025":26,"2026":25}},{"country":"Denmark","flag":"🇩🇰","values":{"2009":0,"2010":1,"2011":1,"2012":1,"2013":1,"2014":0,"2015":1,"2016":1,"2017":0,"2018":0,"2019":0,"2020":0,"2021":0,"2022":0,"2023":0,"2024":0,"2025":0,"2026":0},"ranks":{"2009":6,"2010":6,"2011":6,"2012":6,"2013":6,"2014":7,"2015":6,"2016":5,"2017":7,"2018":6,"2019":7,"2020":7,"2021":6,"2022":7,"2023":7,"2024":6,"2025":6,"2026":5},"order":{"2009":21,"2010":16,"2011":11,"2012":11,"2013":10,"2014":36,"2015":16,"2016":13,"2017":35,"2018":34,"2019":33,"2020":30,"2021":24,"2022":26,"2023":26,"2024":26,"2025":27,"2026":26}},{"country":"France","flag":"🇫🇷","values":{"2009":2,"2010":3,"2011":4,"2012":2,"2013":5,"2014":1,"2015":2,"2016":2,"2017":3,"2018":3,"2019":1,"2020":1,"2021":1,"2022":1,"2023":2,"2024":3,"2025":3,"2026":4},"ranks":{"2009":4,"2010":4,"2011":3,"2012":5,"2013":4,"2014":6,"2015":5,"2016":4,"2017":4,"2018":3,"2019":6,"2020":6,"2021":5,"2022":6,"2023":5,"2024":3,"2025":3,"2026":1},"order":{"2009":5,"2010":6,"2011":3,"2012":7,"2013":5,"2014":13,"2015":8,"2016":6,"2017":4,"2018":4,"2019":22,"2020":17,"2021":16,"2022":13,"2023":12,"2024":8,"2025":5,"2026":4}},{"country":"Germany","flag":"🇩🇪","values":{"2009":1,"2010":2,"2011":1,"2012":5,"2013":5,"2014":3,"2015":3,"2016":1,"2017":1,"2018":2,"2019":1,"2020":1,"2021":0,"2022":0,"2023":1,"2024":0,"2025":0,"2026":0},"ranks":{"2009":5,"2010":5,"2011":6,"2012":3,"2013":4,"2014":4,"2015":4,"2016":5,"2017":6,"2018":4,"2019":6,"2020":6,"2021":6,"2022":7,"2023":6,"2024":6,"2025":6,"2026":5},"order":{"2009":9,"2010":11,"2011":16,"2012":3,"2013":4,"2014":4,"2015":4,"2016":20,"2017":16,"2018":9,"2019":21,"2020":18,"2021":32,"2022":33,"2023":19,"2024":36,"2025":36,"2026":35}},{"country":"Greece","flag":"🇬🇷","values":{"2009":0,"2010":0,"2011":0,"2012":0,"2013":2,"2014":1,"2015":1,"2016":2,"2017":2,"2018":2,"2019":2,"2020":2,"2021":2,"2022":3,"2023":3,"2024":2,"2025":3,"2026":3},"ranks":{"2009":6,"2010":7,"2011":7,"2012":7,"2013":5,"2014":6,"2015":6,"2016":4,"2017":5,"2018":4,"2019":5,"2020":5,"2021":4,"2022":4,"2023":4,"2024":4,"2025":3,"2026":2},"order":{"2009":22,"2010":23,"2011":21,"2012":20,"2013":9,"2014":15,"2015":11,"2016":8,"2017":6,"2018":5,"2019":5,"2020":7,"2021":11,"2022":7,"2023":6,"2024":13,"2025":6,"2026":6}},{"country":"Hong Kong","flag":"🇭🇰","values":{"2009":0,"2010":0,"2011":0,"2012":0,"2013":1,"2014":1,"2015":2,"2016":2,"2017":2,"2018":1,"2019":2,"2020":2,"2021":3,"2022":2,"2023":2,"2024":2,"2025":2,"2026":4},"ranks":{"2009":6,"2010":7,"2011":7,"2012":7,"2013":6,"2014":6,"2015":5,"2016":4,"2017":5,"2018":5,"2019":5,"2020":5,"2021":3,"2022":5,"2023":5,"2024":4,"2025":4,"2026":1},"order":{"2009":23,"2010":24,"2011":22,"2012":21,"2013":16,"2014":11,"2015":9,"2016":7,"2017":5,"2018":18,"2019":8,"2020":9,"2021":8,"2022":11,"2023":11,"2024":10,"2025":8,"2026":1}},{"country":"Hungary","flag":"🇭🇺","values":{"2009":0,"2010":0,"2011":0,"2012":1,"2013":0,"2014":0,"2015":0,"2016":0,"2017":0,"2018":0,"2019":0,"2020":0,"2021":0,"2022":0,"2023":0,"2024":0,"2025":0,"2026":0},"ranks":{"2009":6,"2010":7,"2011":7,"2012":6,"2013":7,"2014":7,"2015":7,"2016":6,"2017":7,"2018":6,"2019":7,"2020":7,"2021":6,"2022":7,"2023":7,"2024":6,"2025":6,"2026":5},"order":{"2009":24,"2010":25,"2011":23,"2012":15,"2013":35,"2014":34,"2015":33,"2016":30,"2017":29,"2018":30,"2019":29,"2020":27,"2021":21,"2022":23,"2023":23,"2024":23,"2025":24,"2026":23}},{"country":"India","flag":"🇮🇳","values":{"2009":1,"2010":4,"2011":0,"2012":0,"2013":0,"2014":0,"2015":0,"2016":0,"2017":0,"2018":0,"2019":0,"2020":0,"2021":1,"2022":1,"2023":0,"2024":0,"2025":0,"2026":0},"ranks":{"2009":5,"2010":3,"2011":7,"2012":7,"2013":7,"2014":7,"2015":7,"2016":6,"2017":7,"2018":6,"2019":7,"2020":7,"2021":5,"2022":6,"2023":7,"2024":6,"2025":6,"2026":5},"order":{"2009":11,"2010":5,"2011":34,"2012":32,"2013":30,"2014":30,"2015":30,"2016":27,"2017":26,"2018":27,"2019":26,"2020":24,"2021":17,"2022":14,"2023":36,"2024":35,"2025":35,"2026":34}},{"country":"Indonesia","flag":"🇮🇩","values":{"2009":1,"2010":0,"2011":0,"2012":0,"2013":0,"2014":0,"2015":0,"2016":0,"2017":0,"2018":0,"2019":0,"2020":0,"2021":0,"2022":0,"2023":0,"2024":0,"2025":0,"2026":0},"ranks":{"2009":5,"2010":7,"2011":7,"2012":7,"2013":7,"2014":7,"2015":7,"2016":6,"2017":7,"2018":6,"2019":7,"2020":7,"2021":6,"2022":7,"2023":7,"2024":6,"2025":6,"2026":5},"order":{"2009":13,"2010":35,"2011":32,"2012":30,"2013":28,"2014":28,"2015":28,"2016":25,"2017":24,"2018":25,"2019":25,"2020":23,"2021":18,"2022":20,"2023":20,"2024":20,"2025":21,"2026":20}},{"country":"Israel","flag":"🇮🇱","values":{"2009":0,"2010":0,"2011":0,"2012":0,"2013":0,"2014":0,"2015":1,"2016":0,"2017":1,"2018":0,"2019":0,"2020":0,"2021":0,"2022":0,"2023":0,"2024":0,"2025":0,"2026":0},"ranks":{"2009":6,"2010":7,"2011":7,"2012":7,"2013":7,"2014":7,"2015":6,"2016":6,"2017":6,"2018":6,"2019":7,"2020":7,"2021":6,"2022":7,"2023":7,"2024":6,"2025":6,"2026":5},"order":{"2009":25,"2010":26,"2011":24,"2012":22,"2013":20,"2014":20,"2015":14,"2016":33,"2017":20,"2018":35,"2019":34,"2020":31,"2021":25,"2022":27,"2023":27,"2024":27,"2025":28,"2026":27}},{"country":"Italy","flag":"🇮🇹","values":{"2009":1,"2010":4,"2011":0,"2012":1,"2013":2,"2014":2,"2015":2,"2016":2,"2017":1,"2018":0,"2019":2,"2020":2,"2021":3,"2022":4,"2023":5,"2024":4,"2025":4,"2026":2},"ranks":{"2009":5,"2010":3,"2011":7,"2012":6,"2013":5,"2014":5,"2015":5,"2016":4,"2017":6,"2018":6,"2019":5,"2020":5,"2021":3,"2022":3,"2023":2,"2024":2,"2025":2,"2026":3},"order":{"2009":8,"2010":4,"2011":35,"2012":12,"2013":8,"2014":5,"2015":5,"2016":5,"2017":19,"2018":36,"2019":10,"2020":10,"2021":9,"2022":5,"2023":3,"2024":5,"2025":3,"2026":13}},{"country":"Japan","flag":"🇯🇵","values":{"2009":0,"2010":1,"2011":2,"2012":1,"2013":1,"2014":2,"2015":1,"2016":1,"2017":2,"2018":2,"2019":2,"2020":3,"2021":2,"2022":1,"2023":2,"2024":2,"2025":3,"2026":2},"ranks":{"2009":6,"2010":6,"2011":5,"2012":6,"2013":6,"2014":5,"2015":6,"2016":5,"2017":5,"2018":4,"2019":5,"2020":4,"2021":4,"2022":6,"2023":5,"2024":4,"2025":3,"2026":3},"order":{"2009":26,"2010":17,"2011":7,"2012":13,"2013":14,"2014":6,"2015":13,"2016":10,"2017":7,"2018":6,"2019":6,"2020":5,"2021":14,"2022":18,"2023":13,"2024":12,"2025":7,"2026":15}},{"country":"Lebanon","flag":"🇱🇧","values":{"2009":0,"2010":0,"2011":0,"2012":0,"2013":0,"2014":0,"2015":0,"2016":1,"2017":0,"2018":1,"2019":1,"2020":0,"2021":0,"2022":0,"2023":0,"2024":0,"2025":0,"2026":0},"ranks":{"2009":6,"2010":7,"2011":7,"2012":7,"2013":7,"2014":7,"2015":7,"2016":5,"2017":7,"2018":5,"2019":6,"2020":7,"2021":6,"2022":7,"2023":7,"2024":6,"2025":6,"2026":5},"order":{"2009":27,"2010":27,"2011":25,"2012":23,"2013":21,"2014":21,"2015":22,"2016":17,"2017":36,"2018":19,"2019":17,"2020":35,"2021":29,"2022":31,"2023":31,"2024":30,"2025":31,"2026":30}},{"country":"Mexico","flag":"🇲🇽","values":{"2009":0,"2010":1,"2011":1,"2012":1,"2013":1,"2014":2,"2015":1,"2016":1,"2017":1,"2018":2,"2019":1,"2020":1,"2021":4,"2022":4,"2023":4,"2024":4,"2025":2,"2026":4},"ranks":{"2009":6,"2010":6,"2011":6,"2012":6,"2013":6,"2014":5,"2015":6,"2016":5,"2017":6,"2018":4,"2019":6,"2020":6,"2021":2,"2022":3,"2023":3,"2024":2,"2025":4,"2026":1},"order":{"2009":28,"2010":13,"2011":8,"2012":8,"2013":12,"2014":8,"2015":15,"2016":9,"2017":9,"2018":7,"2019":18,"2020":15,"2021":3,"2022":4,"2023":4,"2024":3,"2025":10,"2026":2}},{"country":"Netherlands","flag":"🇳🇱","values":{"2009":0,"2010":0,"2011":1,"2012":0,"2013":1,"2014":2,"2015":2,"2016":1,"2017":1,"2018":1,"2019":0,"2020":0,"2021":0,"2022":0,"2023":0,"2024":0,"2025":0,"2026":0},"ranks":{"2009":6,"2010":7,"2011":6,"2012":7,"2013":6,"2014":5,"2015":5,"2016":5,"2017":6,"2018":5,"2019":7,"2020":7,"2021":6,"2022":7,"2023":7,"2024":6,"2025":6,"2026":5},"order":{"2009":29,"2010":28,"2011":13,"2012":34,"2013":15,"2014":7,"2015":6,"2016":15,"2017":15,"2018":15,"2019":36,"2020":33,"2021":27,"2022":29,"2023":29,"2024":29,"2025":30,"2026":29}},{"country":"New Zealand","flag":"🇳🇿","values":{"2009":2,"2010":3,"2011":1,"2012":0,"2013":0,"2014":0,"2015":0,"2016":0,"2017":0,"2018":0,"2019":0,"2020":0,"2021":0,"2022":0,"2023":0,"2024":0,"2025":0,"2026":0},"ranks":{"2009":4,"2010":4,"2011":6,"2012":7,"2013":7,"2014":7,"2015":7,"2016":6,"2017":7,"2018":6,"2019":7,"2020":7,"2021":6,"2022":7,"2023":7,"2024":6,"2025":6,"2026":5},"order":{"2009":6,"2010":7,"2011":15,"2012":35,"2013":32,"2014":32,"2015":32,"2016":29,"2017":28,"2018":29,"2019":28,"2020":26,"2021":20,"2022":22,"2023":22,"2024":22,"2025":23,"2026":22}},{"country":"Norway","flag":"🇳🇴","values":{"2009":0,"2010":0,"2011":0,"2012":0,"2013":0,"2014":0,"2015":0,"2016":1,"2017":1,"2018":1,"2019":1,"2020":1,"2021":0,"2022":1,"2023":1,"2024":1,"2025":2,"2026":1},"ranks":{"2009":6,"2010":7,"2011":7,"2012":7,"2013":7,"2014":7,"2015":7,"2016":5,"2017":6,"2018":5,"2019":6,"2020":6,"2021":6,"2022":6,"2023":6,"2024":5,"2025":4,"2026":4},"order":{"2009":30,"2010":29,"2011":26,"2012":24,"2013":22,"2014":22,"2015":23,"2016":18,"2017":13,"2018":13,"2019":12,"2020":12,"2021":33,"2022":16,"2023":16,"2024":15,"2025":14,"2026":18}},{"country":"Peru","flag":"🇵🇪","values":{"2009":0,"2010":0,"2011":0,"2012":0,"2013":0,"2014":0,"2015":0,"2016":0,"2017":0,"2018":0,"2019":1,"2020":1,"2021":0,"2022":1,"2023":1,"2024":1,"2025":2,"2026":2},"ranks":{"2009":6,"2010":7,"2011":7,"2012":7,"2013":7,"2014":7,"2015":7,"2016":6,"2017":7,"2018":6,"2019":6,"2020":6,"2021":6,"2022":6,"2023":6,"2024":5,"2025":4,"2026":3},"order":{"2009":31,"2010":30,"2011":27,"2012":25,"2013":23,"2014":23,"2015":24,"2016":22,"2017":22,"2018":23,"2019":19,"2020":16,"2021":34,"2022":17,"2023":18,"2024":16,"2025":13,"2026":10}},{"country":"Puerto Rico","flag":"🇵🇷","values":{"2009":0,"2010":0,"2011":0,"2012":0,"2013":0,"2014":0,"2015":1,"2016":1,"2017":1,"2018":1,"2019":1,"2020":0,"2021":0,"2022":0,"2023":0,"2024":0,"2025":0,"2026":0},"ranks":{"2009":6,"2010":7,"2011":7,"2012":7,"2013":7,"2014":7,"2015":6,"2016":5,"2017":6,"2018":5,"2019":6,"2020":7,"2021":6,"2022":7,"2023":7,"2024":6,"2025":6,"2026":5},"order":{"2009":32,"2010":31,"2011":28,"2012":26,"2013":24,"2014":24,"2015":18,"2016":11,"2017":11,"2018":11,"2019":11,"2020":36,"2021":30,"2022":32,"2023":32,"2024":31,"2025":32,"2026":31}},{"country":"Russia","flag":"🇷🇺","values":{"2009":0,"2010":1,"2011":1,"2012":1,"2013":1,"2014":1,"2015":1,"2016":0,"2017":0,"2018":1,"2019":1,"2020":1,"2021":2,"2022":0,"2023":0,"2024":0,"2025":0,"2026":0},"ranks":{"2009":6,"2010":6,"2011":6,"2012":6,"2013":6,"2014":6,"2015":6,"2016":6,"2017":7,"2018":5,"2019":6,"2020":6,"2021":4,"2022":7,"2023":7,"2024":6,"2025":6,"2026":5},"order":{"2009":33,"2010":15,"2011":10,"2012":10,"2013":13,"2014":10,"2015":10,"2016":34,"2017":32,"2018":21,"2019":15,"2020":14,"2021":12,"2022":36,"2023":35,"2024":34,"2025":34,"2026":33}},{"country":"Singapore","flag":"🇸🇬","values":{"2009":1,"2010":0,"2011":1,"2012":2,"2013":2,"2014":1,"2015":2,"2016":3,"2017":6,"2018":5,"2019":6,"2020":4,"2021":6,"2022":2,"2023":3,"2024":4,"2025":2,"2026":2},"ranks":{"2009":5,"2010":7,"2011":6,"2012":5,"2013":5,"2014":6,"2015":5,"2016":3,"2017":3,"2018":2,"2019":3,"2020":3,"2021":1,"2022":5,"2023":4,"2024":2,"2025":4,"2026":3},"order":{"2009":12,"2010":36,"2011":12,"2012":5,"2013":6,"2014":12,"2015":7,"2016":3,"2017":3,"2018":3,"2019":3,"2020":3,"2021":1,"2022":9,"2023":8,"2024":4,"2025":11,"2026":11}},{"country":"South Africa","flag":"🇿🇦","values":{"2009":2,"2010":2,"2011":0,"2012":1,"2013":0,"2014":0,"2015":0,"2016":0,"2017":0,"2018":0,"2019":0,"2020":0,"2021":0,"2022":0,"2023":0,"2024":0,"2025":0,"2026":0},"ranks":{"2009":4,"2010":5,"2011":7,"2012":6,"2013":7,"2014":7,"2015":7,"2016":6,"2017":7,"2018":6,"2019":7,"2020":7,"2021":6,"2022":7,"2023":7,"2024":6,"2025":6,"2026":5},"order":{"2009":7,"2010":9,"2011":36,"2012":16,"2013":36,"2014":35,"2015":34,"2016":31,"2017":30,"2018":31,"2019":30,"2020":28,"2021":22,"2022":24,"2023":24,"2024":24,"2025":25,"2026":24}},{"country":"Spain","flag":"🇪🇸","values":{"2009":1,"2010":1,"2011":3,"2012":2,"2013":2,"2014":1,"2015":1,"2016":0,"2017":0,"2018":2,"2019":3,"2020":3,"2021":4,"2022":4,"2023":3,"2024":3,"2025":3,"2026":3},"ranks":{"2009":5,"2010":6,"2011":4,"2012":5,"2013":5,"2014":6,"2015":6,"2016":6,"2017":7,"2018":4,"2019":4,"2020":4,"2021":2,"2022":3,"2023":4,"2024":3,"2025":3,"2026":2},"order":{"2009":10,"2010":12,"2011":5,"2012":6,"2013":7,"2014":16,"2015":12,"2016":35,"2017":33,"2018":8,"2019":4,"2020":4,"2021":2,"2022":3,"2023":7,"2024":7,"2025":4,"2026":5}},{"country":"Sweden","flag":"🇸🇪","values":{"2009":0,"2010":0,"2011":0,"2012":0,"2013":0,"2014":0,"2015":0,"2016":1,"2017":1,"2018":1,"2019":1,"2020":1,"2021":2,"2022":1,"2023":1,"2024":1,"2025":1,"2026":0},"ranks":{"2009":6,"2010":7,"2011":7,"2012":7,"2013":7,"2014":7,"2015":7,"2016":5,"2017":6,"2018":5,"2019":6,"2020":6,"2021":4,"2022":6,"2023":6,"2024":5,"2025":5,"2026":5},"order":{"2009":34,"2010":32,"2011":29,"2012":27,"2013":25,"2014":25,"2015":25,"2016":16,"2017":17,"2018":16,"2019":13,"2020":13,"2021":15,"2022":19,"2023":17,"2024":17,"2025":16,"2026":36}},{"country":"Taiwan","flag":"🇹🇼","values":{"2009":0,"2010":0,"2011":0,"2012":0,"2013":0,"2014":0,"2015":0,"2016":0,"2017":1,"2018":1,"2019":1,"2020":2,"2021":0,"2022":0,"2023":0,"2024":0,"2025":0,"2026":0},"ranks":{"2009":6,"2010":7,"2011":7,"2012":7,"2013":7,"2014":7,"2015":7,"2016":6,"2017":6,"2018":5,"2019":6,"2020":5,"2021":6,"2022":7,"2023":7,"2024":6,"2025":6,"2026":5},"order":{"2009":35,"2010":33,"2011":30,"2012":28,"2013":26,"2014":26,"2015":26,"2016":23,"2017":18,"2018":17,"2019":14,"2020":11,"2021":35,"2022":34,"2023":33,"2024":32,"2025":33,"2026":32}},{"country":"Thailand","flag":"🇹🇭","values":{"2009":0,"2010":0,"2011":0,"2012":0,"2013":0,"2014":0,"2015":0,"2016":0,"2017":0,"2018":0,"2019":0,"2020":1,"2021":0,"2022":2,"2023":2,"2024":2,"2025":2,"2026":3},"ranks":{"2009":6,"2010":7,"2011":7,"2012":7,"2013":7,"2014":7,"2015":7,"2016":6,"2017":7,"2018":6,"2019":7,"2020":6,"2021":6,"2022":5,"2023":5,"2024":4,"2025":4,"2026":2},"order":{"2009":36,"2010":34,"2011":31,"2012":29,"2013":27,"2014":27,"2015":27,"2016":24,"2017":23,"2018":24,"2019":24,"2020":20,"2021":36,"2022":10,"2023":9,"2024":11,"2025":9,"2026":8}},{"country":"UAE","flag":"🇦🇪","values":{"2009":4,"2010":3,"2011":2,"2012":0,"2013":0,"2014":0,"2015":1,"2016":0,"2017":0,"2018":0,"2019":0,"2020":1,"2021":2,"2022":3,"2023":2,"2024":1,"2025":1,"2026":1},"ranks":{"2009":3,"2010":4,"2011":5,"2012":7,"2013":7,"2014":7,"2015":6,"2016":6,"2017":7,"2018":6,"2019":7,"2020":6,"2021":4,"2022":4,"2023":5,"2024":5,"2025":5,"2026":4},"order":{"2009":4,"2010":8,"2011":6,"2012":36,"2013":33,"2014":33,"2015":17,"2016":36,"2017":34,"2018":33,"2019":32,"2020":19,"2021":13,"2022":8,"2023":14,"2024":19,"2025":18,"2026":16}},{"country":"United Kingdom","flag":"🇬🇧","values":{"2009":12,"2010":7,"2011":14,"2012":14,"2013":9,"2014":9,"2015":9,"2016":10,"2017":8,"2018":10,"2019":10,"2020":9,"2021":3,"2022":5,"2023":6,"2024":5,"2025":5,"2026":3},"ranks":{"2009":1,"2010":1,"2011":1,"2012":1,"2013":2,"2014":2,"2015":2,"2016":2,"2017":2,"2018":1,"2019":1,"2020":1,"2021":3,"2022":2,"2023":1,"2024":1,"2025":1,"2026":2},"order":{"2009":1,"2010":1,"2011":1,"2012":1,"2013":2,"2014":2,"2015":2,"2016":2,"2017":2,"2018":1,"2019":1,"2020":1,"2021":6,"2022":2,"2023":1,"2024":2,"2025":2,"2026":9}},{"country":"United States","flag":"🇺🇸","values":{"2009":10,"2010":7,"2011":13,"2012":12,"2013":10,"2014":16,"2015":14,"2016":14,"2017":13,"2018":10,"2019":7,"2020":5,"2021":4,"2022":8,"2023":5,"2024":5,"2025":5,"2026":4},"ranks":{"2009":2,"2010":1,"2011":2,"2012":2,"2013":1,"2014":1,"2015":1,"2016":1,"2017":1,"2018":1,"2019":2,"2020":2,"2021":2,"2022":1,"2023":2,"2024":1,"2025":1,"2026":1},"order":{"2009":3,"2010":2,"2011":2,"2012":2,"2013":1,"2014":1,"2015":1,"2016":1,"2017":1,"2018":2,"2019":2,"2020":2,"2021":4,"2022":1,"2023":2,"2024":1,"2025":1,"2026":3}}]}
JSON, true, 512, JSON_THROW_ON_ERROR);
        $r = DwStudio::importRace($topic, $content, 'Claude Code');
        echo $r['ok'] ? "  OK  dw: 2026-11-21 race package v{$r['version']}\n" : "  ERR dw Nov 21 race: " . implode(' ', $r['errors']) . "\n";
    }
} catch (Throwable $e) {
    echo "  ERR dw Nov 21 race: " . $e->getMessage() . "\n";
}

// Once: Nov 22 becomes the race "The countries with the most skyscrapers, 1990 to 2025" (CTBUH, buildings of 200 m+, China overtakes the US in 2011), Vietnam as
// the extra row; the unpublished topic on Nov 22 moves to the first date with no topic from Nov 23. As Nov 16.
try {
    require_once __DIR__ . '/vendor/autoload.php';
    $title = 'The countries with the most skyscrapers, 1990 to 2025';
    $old = $pdo->prepare("SELECT id, title, status FROM dw_topics WHERE date = '2026-11-22' AND title <> ?");
    $old->execute([$title]);
    $old = $old->fetch(PDO::FETCH_ASSOC);
    if ($old && $old['status'] !== 'published') {
        $free = $pdo->query("SELECT d::date::text FROM generate_series('2026-11-23'::date, '2027-12-31'::date, '1 day') d
                             WHERE NOT EXISTS (SELECT 1 FROM dw_topics t WHERE t.date = d::date) ORDER BY d LIMIT 1")->fetchColumn();
        $pdo->prepare("UPDATE dw_topics SET date = ?::date, updated_at = now() WHERE id = ?")->execute([$free, $old['id']]);
        echo "  OK  dw: \"{$old['title']}\" moved from 2026-11-22 to {$free}\n";
    }
    if (!$pdo->query("SELECT 1 FROM dw_topics WHERE date = '2026-11-22'")->fetchColumn()) {
        $pdo->prepare("INSERT INTO dw_topics (date, title, notes, type, needs_date_check, format) VALUES ('2026-11-22', ?, ?, 'evergreen', false, 'race')")
            ->execute([$title, 'Race: completed buildings of 200 m+ per country, cumulative, 1990-2025 (CTBUH Skyscraper Center; Hong Kong and Taiwan apart from mainland China). The US leads until 2010, China passes it in 2011 (166 vs 161, banner) and ends 2025 at 1,246 vs 256; Vietnam as the extra row (0 until 2010, 9 in 2025).']);
        echo "  OK  dw: 2026-11-22 race topic\n";
    }
    $topic = DwStudio::topicByDate('2026-11-22');
    if ($topic !== null && $topic['format'] === 'race' && $topic['title'] === $title && DwStudio::package($topic['id']) === null) {
        $content = json_decode(<<<'JSON'
{"format":"race","topic":"The countries with the most skyscrapers, 1990 to 2025","headline":"The countries with the most skyscrapers, 1990 → 2025 🏙️","headline_accent":"most skyscrapers","detail":"2011: China overtakes the US 🇨🇳","banner_year":2011,"extra_row":"Vietnam","value_label":"Completed buildings of 200 m+","data_years":"1990–2025","unit":"","decimals":0,"value_prefix":"🏙️ x","step_seconds":0.6,"source":"CTBUH Skyscraper Center","source_url":"https://www.skyscrapercenter.com/","card_bg":"blue","outro_question":"What's the tallest building in YOUR city? 🏙️","cta_line":"Show us your city's skyline on hilads.live 🌆","caption":"In 1990, the US had 110 of the world's 146 buildings of 200 m or more. Mainland China had 2. China passed the US in 2011 and never looked back: 1,246 by the end of 2025, almost five times the US (256). Vietnam went from none to 9 in 15 years, from Bitexco Tower (2010) to Landmark 81 (461 m, 2018), still the country's tallest. Different Worlds by Hilads.","hashtags":["#DifferentWorlds","#Skyscrapers","#Skyline","#Architecture","#Landmark81","#Vietnam"],"warnings":["CTBUH Skyscraper Center, its building database (country and city pages, every building): buildings (CTBUH's definition: not towers or masts) of 200 m or more (architectural height), completed, counted at the end of each year by their completion year, 1990-2025 (1990: 16 countries already have one; 2026 is not a full year).","Countries as CTBUH records them, except that Hong Kong and Taiwan are shown apart from mainland China (CTBUH files them under China; Macau has none of 200 m+).","Demolished buildings count until they came down: the World Trade Center's two towers until 2000, 270 Park Avenue (JPMorgan Chase Tower, New York) until 2020, AXA Tower (Singapore) until 2022 (CTBUH has no demolition year: public dates).","China and US country pages don't load (too large): their counts come from their city pages, plus a few buildings in smaller cities from CTBUH's own search index (same data); about 10 recent towers missing from that index are counted from the country pages.","Ties share a rank; among tied countries, the one at that count first stays above. China passes the US in 2011 (166 vs 161).","Vietnam: 0 until 2010 (no rank shown), then 1 (Bitexco, 2010) to 9 in 2024-2025 (#24 in 2025, ties shared)."],"series":[{"country":"Singapore","flag":"🇸🇬","values":{"1990":4,"1991":4,"1992":5,"1993":5,"1994":5,"1995":5,"1996":7,"1997":7,"1998":7,"1999":7,"2000":8,"2001":8,"2002":8,"2003":8,"2004":8,"2005":8,"2006":9,"2007":9,"2008":11,"2009":11,"2010":17,"2011":20,"2012":22,"2013":24,"2014":27,"2015":29,"2016":30,"2017":32,"2018":33,"2019":33,"2020":33,"2021":34,"2022":34,"2023":33,"2024":34,"2025":35},"ranks":{"1990":3,"1991":3,"1992":5,"1993":5,"1994":6,"1995":6,"1996":6,"1997":5,"1998":6,"1999":7,"2000":7,"2001":7,"2002":7,"2003":8,"2004":8,"2005":8,"2006":8,"2007":8,"2008":7,"2009":8,"2010":8,"2011":8,"2012":8,"2013":8,"2014":7,"2015":7,"2016":8,"2017":9,"2018":9,"2019":10,"2020":10,"2021":11,"2022":11,"2023":12,"2024":14,"2025":14},"order":{"1990":4,"1991":5,"1992":6,"1993":6,"1994":6,"1995":6,"1996":6,"1997":7,"1998":7,"1999":7,"2000":7,"2001":7,"2002":7,"2003":9,"2004":9,"2005":9,"2006":10,"2007":10,"2008":9,"2009":9,"2010":8,"2011":8,"2012":8,"2013":8,"2014":8,"2015":7,"2016":8,"2017":9,"2018":10,"2019":10,"2020":11,"2021":11,"2022":11,"2023":13,"2024":14,"2025":14}},{"country":"Australia","flag":"🇦🇺","values":{"1990":3,"1991":7,"1992":10,"1993":11,"1994":11,"1995":11,"1996":11,"1997":11,"1998":11,"1999":11,"2000":13,"2001":13,"2002":13,"2003":13,"2004":15,"2005":19,"2006":21,"2007":22,"2008":22,"2009":22,"2010":22,"2011":22,"2012":25,"2013":25,"2014":27,"2015":28,"2016":31,"2017":33,"2018":34,"2019":37,"2020":39,"2021":47,"2022":52,"2023":57,"2024":60,"2025":61},"ranks":{"1990":4,"1991":2,"1992":2,"1993":2,"1994":3,"1995":3,"1996":3,"1997":3,"1998":4,"1999":5,"2000":5,"2001":5,"2002":5,"2003":5,"2004":5,"2005":5,"2006":5,"2007":5,"2008":5,"2009":6,"2010":7,"2011":7,"2012":7,"2013":7,"2014":7,"2015":8,"2016":7,"2017":8,"2018":8,"2019":9,"2020":8,"2021":7,"2022":7,"2023":7,"2024":7,"2025":7},"order":{"1990":5,"1991":2,"1992":2,"1993":2,"1994":3,"1995":3,"1996":3,"1997":3,"1998":4,"1999":5,"2000":5,"2001":5,"2002":5,"2003":5,"2004":5,"2005":5,"2006":5,"2007":5,"2008":6,"2009":6,"2010":7,"2011":7,"2012":7,"2013":7,"2014":7,"2015":8,"2016":7,"2017":8,"2018":9,"2019":9,"2020":9,"2021":7,"2022":7,"2023":7,"2024":7,"2025":7}},{"country":"Panama","flag":"🇵🇦","values":{"1990":0,"1991":0,"1992":0,"1993":0,"1994":0,"1995":0,"1996":0,"1997":0,"1998":0,"1999":0,"2000":0,"2001":0,"2002":0,"2003":0,"2004":0,"2005":0,"2006":0,"2007":0,"2008":2,"2009":2,"2010":3,"2011":13,"2012":17,"2013":19,"2014":19,"2015":21,"2016":21,"2017":23,"2018":23,"2019":23,"2020":23,"2021":24,"2022":24,"2023":25,"2024":25,"2025":25},"ranks":{"2008":13,"2009":13,"2010":14,"2011":9,"2012":9,"2013":9,"2014":8,"2015":10,"2016":12,"2017":13,"2018":12,"2019":13,"2020":13,"2021":14,"2022":15,"2023":15,"2024":17,"2025":18},"order":{"1990":15,"1991":15,"1992":16,"1993":16,"1994":16,"1995":16,"1996":17,"1997":17,"1998":18,"1999":19,"2000":19,"2001":19,"2002":19,"2003":19,"2004":19,"2005":19,"2006":19,"2007":19,"2008":18,"2009":18,"2010":17,"2011":10,"2012":10,"2013":9,"2014":9,"2015":11,"2016":13,"2017":13,"2018":13,"2019":14,"2020":14,"2021":14,"2022":15,"2023":15,"2024":16,"2025":16}},{"country":"Vietnam","flag":"🇻🇳","values":{"1990":0,"1991":0,"1992":0,"1993":0,"1994":0,"1995":0,"1996":0,"1997":0,"1998":0,"1999":0,"2000":0,"2001":0,"2002":0,"2003":0,"2004":0,"2005":0,"2006":0,"2007":0,"2008":0,"2009":0,"2010":1,"2011":3,"2012":4,"2013":4,"2014":5,"2015":6,"2016":6,"2017":6,"2018":7,"2019":7,"2020":7,"2021":8,"2022":8,"2023":8,"2024":9,"2025":9},"ranks":{"2010":16,"2011":16,"2012":16,"2013":18,"2014":15,"2015":16,"2016":17,"2017":20,"2018":19,"2019":21,"2020":21,"2021":21,"2022":20,"2023":21,"2024":21,"2025":24},"order":{"1990":20,"1991":20,"1992":20,"1993":20,"1994":20,"1995":20,"1996":20,"1997":20,"1998":20,"1999":20,"2000":20,"2001":20,"2002":20,"2003":20,"2004":20,"2005":20,"2006":20,"2007":20,"2008":20,"2009":20,"2010":20,"2011":18,"2012":18,"2013":18,"2014":18,"2015":17,"2016":17,"2017":17,"2018":17,"2019":18,"2020":18,"2021":18,"2022":18,"2023":18,"2024":18,"2025":18}},{"country":"Germany","flag":"🇩🇪","values":{"1990":1,"1991":1,"1992":1,"1993":2,"1994":2,"1995":2,"1996":2,"1997":3,"1998":3,"1999":4,"2000":4,"2001":4,"2002":4,"2003":4,"2004":4,"2005":4,"2006":4,"2007":4,"2008":4,"2009":4,"2010":4,"2011":5,"2012":5,"2013":5,"2014":5,"2015":5,"2016":5,"2017":5,"2018":5,"2019":5,"2020":5,"2021":5,"2022":5,"2023":5,"2024":5,"2025":6},"ranks":{"1990":6,"1991":5,"1992":7,"1993":6,"1994":8,"1995":8,"1996":9,"1997":6,"1998":7,"1999":8,"2000":9,"2001":9,"2002":10,"2003":11,"2004":11,"2005":10,"2006":10,"2007":10,"2008":12,"2009":12,"2010":13,"2011":14,"2012":15,"2013":17,"2014":15,"2015":17,"2016":18,"2017":21,"2018":21,"2019":22,"2020":22,"2021":23,"2022":22,"2023":23,"2024":24,"2025":26},"order":{"1990":12,"1991":12,"1992":12,"1993":12,"1994":12,"1995":12,"1996":12,"1997":9,"1998":9,"1999":9,"2000":9,"2001":10,"2002":12,"2003":13,"2004":13,"2005":13,"2006":13,"2007":13,"2008":15,"2009":15,"2010":15,"2011":16,"2012":16,"2013":17,"2014":17,"2015":18,"2016":18,"2017":19,"2018":19,"2019":19,"2020":19,"2021":19,"2022":19,"2023":19,"2024":19,"2025":19}},{"country":"United States","flag":"🇺🇸","values":{"1990":110,"1991":115,"1992":124,"1993":125,"1994":125,"1995":125,"1996":126,"1997":126,"1998":126,"1999":127,"2000":128,"2001":128,"2002":129,"2003":131,"2004":136,"2005":138,"2006":140,"2007":144,"2008":147,"2009":153,"2010":159,"2011":161,"2012":163,"2013":164,"2014":167,"2015":169,"2016":175,"2017":183,"2018":197,"2019":210,"2020":221,"2021":229,"2022":235,"2023":243,"2024":246,"2025":256},"ranks":{"1990":1,"1991":1,"1992":1,"1993":1,"1994":1,"1995":1,"1996":1,"1997":1,"1998":1,"1999":1,"2000":1,"2001":1,"2002":1,"2003":1,"2004":1,"2005":1,"2006":1,"2007":1,"2008":1,"2009":1,"2010":1,"2011":2,"2012":2,"2013":2,"2014":2,"2015":2,"2016":2,"2017":2,"2018":2,"2019":2,"2020":2,"2021":2,"2022":2,"2023":2,"2024":2,"2025":2},"order":{"1990":1,"1991":1,"1992":1,"1993":1,"1994":1,"1995":1,"1996":1,"1997":1,"1998":1,"1999":1,"2000":1,"2001":1,"2002":1,"2003":1,"2004":1,"2005":1,"2006":1,"2007":1,"2008":1,"2009":1,"2010":1,"2011":2,"2012":2,"2013":2,"2014":2,"2015":2,"2016":2,"2017":2,"2018":2,"2019":2,"2020":2,"2021":2,"2022":2,"2023":2,"2024":2,"2025":2}},{"country":"Malaysia","flag":"🇲🇾","values":{"1990":2,"1991":2,"1992":2,"1993":2,"1994":3,"1995":3,"1996":3,"1997":3,"1998":7,"1999":7,"2000":7,"2001":8,"2002":8,"2003":10,"2004":10,"2005":10,"2006":10,"2007":10,"2008":11,"2009":11,"2010":12,"2011":12,"2012":14,"2013":15,"2014":15,"2015":20,"2016":26,"2017":31,"2018":39,"2019":46,"2020":50,"2021":56,"2022":58,"2023":69,"2024":74,"2025":84},"ranks":{"1990":5,"1991":4,"1992":6,"1993":6,"1994":7,"1995":7,"1996":8,"1997":6,"1998":6,"1999":7,"2000":8,"2001":7,"2002":7,"2003":6,"2004":6,"2005":6,"2006":7,"2007":7,"2008":7,"2009":8,"2010":9,"2011":10,"2012":10,"2013":11,"2014":10,"2015":11,"2016":10,"2017":10,"2018":7,"2019":6,"2020":6,"2021":6,"2022":6,"2023":6,"2024":6,"2025":5},"order":{"1990":8,"1991":8,"1992":8,"1993":8,"1994":7,"1995":7,"1996":8,"1997":8,"1998":8,"1999":8,"2000":8,"2001":8,"2002":8,"2003":6,"2004":6,"2005":6,"2006":7,"2007":7,"2008":8,"2009":8,"2010":9,"2011":12,"2012":12,"2013":11,"2014":13,"2015":12,"2016":10,"2017":10,"2018":8,"2019":6,"2020":6,"2021":6,"2022":6,"2023":6,"2024":6,"2025":5}},{"country":"Indonesia","flag":"🇮🇩","values":{"1990":0,"1991":0,"1992":0,"1993":0,"1994":0,"1995":0,"1996":1,"1997":1,"1998":1,"1999":1,"2000":1,"2001":1,"2002":1,"2003":1,"2004":1,"2005":2,"2006":3,"2007":3,"2008":7,"2009":10,"2010":11,"2011":11,"2012":14,"2013":14,"2014":16,"2015":24,"2016":29,"2017":36,"2018":40,"2019":44,"2020":44,"2021":46,"2022":49,"2023":50,"2024":51,"2025":51},"ranks":{"1996":10,"1997":8,"1998":9,"1999":11,"2000":12,"2001":12,"2002":13,"2003":14,"2004":13,"2005":12,"2006":11,"2007":11,"2008":9,"2009":9,"2010":10,"2011":11,"2012":10,"2013":12,"2014":9,"2015":9,"2016":9,"2017":7,"2018":6,"2019":7,"2020":7,"2021":8,"2022":8,"2023":9,"2024":9,"2025":10},"order":{"1990":14,"1991":14,"1992":15,"1993":15,"1994":15,"1995":15,"1996":14,"1997":15,"1998":15,"1999":16,"2000":17,"2001":17,"2002":17,"2003":17,"2004":17,"2005":17,"2006":16,"2007":16,"2008":11,"2009":11,"2010":11,"2011":13,"2012":11,"2013":12,"2014":12,"2015":9,"2016":9,"2017":7,"2018":6,"2019":7,"2020":7,"2021":8,"2022":8,"2023":9,"2024":9,"2025":10}},{"country":"Russia","flag":"🇷🇺","values":{"1990":2,"1991":2,"1992":2,"1993":2,"1994":2,"1995":2,"1996":2,"1997":2,"1998":2,"1999":2,"2000":2,"2001":2,"2002":2,"2003":2,"2004":2,"2005":3,"2006":3,"2007":4,"2008":5,"2009":5,"2010":7,"2011":8,"2012":9,"2013":10,"2014":10,"2015":15,"2016":16,"2017":16,"2018":16,"2019":17,"2020":19,"2021":21,"2022":21,"2023":24,"2024":26,"2025":29},"ranks":{"1990":5,"1991":4,"1992":6,"1993":6,"1994":8,"1995":8,"1996":9,"1997":7,"1998":8,"1999":10,"2000":11,"2001":11,"2002":12,"2003":13,"2004":12,"2005":11,"2006":11,"2007":10,"2008":11,"2009":11,"2010":12,"2011":13,"2012":14,"2013":15,"2014":13,"2015":13,"2016":14,"2017":17,"2018":16,"2019":16,"2020":16,"2021":17,"2022":16,"2023":16,"2024":16,"2025":16},"order":{"1990":9,"1991":9,"1992":9,"1993":9,"1994":9,"1995":9,"1996":9,"1997":12,"1998":12,"1999":12,"2000":14,"2001":15,"2002":15,"2003":15,"2004":15,"2005":15,"2006":15,"2007":15,"2008":14,"2009":14,"2010":14,"2011":15,"2012":15,"2013":15,"2014":15,"2015":14,"2016":14,"2017":15,"2018":15,"2019":15,"2020":15,"2021":16,"2022":16,"2023":16,"2024":15,"2025":15}},{"country":"Japan","flag":"🇯🇵","values":{"1990":6,"1991":7,"1992":7,"1993":8,"1994":12,"1995":13,"1996":14,"1997":15,"1998":15,"1999":15,"2000":18,"2001":18,"2002":20,"2003":22,"2004":22,"2005":22,"2006":23,"2007":27,"2008":28,"2009":30,"2010":30,"2011":30,"2012":32,"2013":33,"2014":35,"2015":35,"2016":37,"2017":39,"2018":39,"2019":40,"2020":44,"2021":45,"2022":47,"2023":52,"2024":52,"2025":55},"ranks":{"1990":2,"1991":2,"1992":4,"1993":4,"1994":2,"1995":2,"1996":2,"1997":2,"1998":3,"1999":3,"2000":3,"2001":4,"2002":4,"2003":4,"2004":4,"2005":4,"2006":4,"2007":4,"2008":4,"2009":5,"2010":5,"2011":6,"2012":6,"2013":6,"2014":6,"2015":6,"2016":6,"2017":6,"2018":7,"2019":8,"2020":7,"2021":9,"2022":9,"2023":8,"2024":8,"2025":8},"order":{"1990":3,"1991":4,"1992":4,"1993":5,"1994":2,"1995":2,"1996":2,"1997":2,"1998":3,"1999":3,"2000":3,"2001":4,"2002":4,"2003":4,"2004":4,"2005":4,"2006":4,"2007":4,"2008":4,"2009":5,"2010":5,"2011":6,"2012":6,"2013":6,"2014":6,"2015":6,"2016":6,"2017":6,"2018":7,"2019":8,"2020":8,"2021":9,"2022":9,"2023":8,"2024":8,"2025":8}},{"country":"UAE","flag":"🇦🇪","values":{"1990":0,"1991":0,"1992":0,"1993":0,"1994":0,"1995":0,"1996":0,"1997":0,"1998":0,"1999":1,"2000":3,"2001":3,"2002":4,"2003":5,"2004":5,"2005":8,"2006":15,"2007":19,"2008":28,"2009":35,"2010":50,"2011":64,"2012":70,"2013":81,"2014":87,"2015":93,"2016":96,"2017":100,"2018":110,"2019":119,"2020":131,"2021":136,"2022":145,"2023":156,"2024":158,"2025":159},"ranks":{"1999":11,"2000":10,"2001":10,"2002":10,"2003":10,"2004":10,"2005":8,"2006":6,"2007":6,"2008":4,"2009":4,"2010":4,"2011":4,"2012":4,"2013":3,"2014":3,"2015":3,"2016":3,"2017":3,"2018":3,"2019":3,"2020":3,"2021":3,"2022":3,"2023":3,"2024":3,"2025":3},"order":{"1990":19,"1991":19,"1992":19,"1993":19,"1994":19,"1995":19,"1996":19,"1997":19,"1998":19,"1999":17,"2000":13,"2001":13,"2002":13,"2003":12,"2004":12,"2005":10,"2006":6,"2007":6,"2008":5,"2009":4,"2010":4,"2011":4,"2012":4,"2013":3,"2014":3,"2015":3,"2016":3,"2017":3,"2018":3,"2019":3,"2020":3,"2021":3,"2022":3,"2023":3,"2024":3,"2025":3}},{"country":"Taiwan","flag":"🇹🇼","values":{"1990":0,"1991":0,"1992":1,"1993":2,"1994":2,"1995":2,"1996":2,"1997":3,"1998":3,"1999":3,"2000":3,"2001":3,"2002":3,"2003":3,"2004":4,"2005":4,"2006":4,"2007":4,"2008":4,"2009":4,"2010":4,"2011":4,"2012":4,"2013":6,"2014":7,"2015":7,"2016":7,"2017":7,"2018":8,"2019":9,"2020":9,"2021":9,"2022":10,"2023":10,"2024":10,"2025":12},"ranks":{"1992":7,"1993":6,"1994":8,"1995":8,"1996":9,"1997":6,"1998":7,"1999":9,"2000":10,"2001":10,"2002":11,"2003":12,"2004":11,"2005":10,"2006":10,"2007":10,"2008":12,"2009":12,"2010":13,"2011":15,"2012":16,"2013":16,"2014":14,"2015":15,"2016":16,"2017":19,"2018":18,"2019":19,"2020":20,"2021":20,"2022":18,"2023":20,"2024":20,"2025":22},"order":{"1990":17,"1991":17,"1992":13,"1993":13,"1994":13,"1995":13,"1996":13,"1997":10,"1998":10,"1999":11,"2000":11,"2001":12,"2002":14,"2003":14,"2004":14,"2005":14,"2006":14,"2007":14,"2008":16,"2009":16,"2010":16,"2011":17,"2012":17,"2013":16,"2014":16,"2015":16,"2016":16,"2017":16,"2018":16,"2019":17,"2020":17,"2021":17,"2022":17,"2023":17,"2024":17,"2025":17}},{"country":"India","flag":"🇮🇳","values":{"1990":0,"1991":0,"1992":0,"1993":0,"1994":0,"1995":0,"1996":0,"1997":0,"1998":0,"1999":0,"2000":0,"2001":0,"2002":0,"2003":0,"2004":0,"2005":0,"2006":0,"2007":0,"2008":0,"2009":0,"2010":2,"2011":2,"2012":2,"2013":2,"2014":2,"2015":3,"2016":3,"2017":6,"2018":6,"2019":14,"2020":17,"2021":22,"2022":30,"2023":41,"2024":46,"2025":52},"ranks":{"2010":15,"2011":17,"2012":18,"2013":20,"2014":18,"2015":19,"2016":20,"2017":20,"2018":20,"2019":17,"2020":17,"2021":16,"2022":12,"2023":10,"2024":10,"2025":9},"order":{"1990":13,"1991":13,"1992":14,"1993":14,"1994":14,"1995":14,"1996":16,"1997":16,"1998":17,"1999":18,"2000":18,"2001":18,"2002":18,"2003":18,"2004":18,"2005":18,"2006":18,"2007":18,"2008":19,"2009":19,"2010":19,"2011":20,"2012":20,"2013":20,"2014":20,"2015":19,"2016":19,"2017":18,"2018":18,"2019":16,"2020":16,"2021":15,"2022":13,"2023":10,"2024":10,"2025":9}},{"country":"Thailand","flag":"🇹🇭","values":{"1990":0,"1991":0,"1992":0,"1993":0,"1994":0,"1995":0,"1996":1,"1997":3,"1998":3,"1999":4,"2000":4,"2001":6,"2002":6,"2003":6,"2004":6,"2005":6,"2006":6,"2007":6,"2008":7,"2009":8,"2010":10,"2011":10,"2012":11,"2013":12,"2014":12,"2015":13,"2016":15,"2017":17,"2018":20,"2019":24,"2020":26,"2021":26,"2022":29,"2023":33,"2024":40,"2025":42},"ranks":{"1996":10,"1997":6,"1998":7,"1999":8,"2000":9,"2001":8,"2002":8,"2003":9,"2004":9,"2005":9,"2006":9,"2007":9,"2008":9,"2009":10,"2010":11,"2011":12,"2012":13,"2013":14,"2014":12,"2015":14,"2016":15,"2017":16,"2018":14,"2019":12,"2020":12,"2021":13,"2022":13,"2023":12,"2024":13,"2025":13},"order":{"1990":18,"1991":18,"1992":18,"1993":18,"1994":18,"1995":18,"1996":15,"1997":11,"1998":11,"1999":10,"2000":10,"2001":9,"2002":9,"2003":10,"2004":10,"2005":11,"2006":11,"2007":11,"2008":12,"2009":13,"2010":13,"2011":14,"2012":14,"2013":14,"2014":14,"2015":15,"2016":15,"2017":14,"2018":14,"2019":13,"2020":13,"2021":13,"2022":14,"2023":14,"2024":13,"2025":13}},{"country":"Venezuela","flag":"🇻🇪","values":{"1990":2,"1991":2,"1992":2,"1993":2,"1994":2,"1995":2,"1996":2,"1997":2,"1998":2,"1999":2,"2000":2,"2001":2,"2002":2,"2003":2,"2004":2,"2005":2,"2006":2,"2007":2,"2008":2,"2009":2,"2010":2,"2011":2,"2012":2,"2013":2,"2014":2,"2015":2,"2016":2,"2017":2,"2018":2,"2019":2,"2020":2,"2021":2,"2022":2,"2023":2,"2024":2,"2025":2},"ranks":{"1990":5,"1991":4,"1992":6,"1993":6,"1994":8,"1995":8,"1996":9,"1997":7,"1998":8,"1999":10,"2000":11,"2001":11,"2002":12,"2003":13,"2004":12,"2005":12,"2006":12,"2007":12,"2008":13,"2009":13,"2010":15,"2011":17,"2012":18,"2013":20,"2014":18,"2015":20,"2016":21,"2017":24,"2018":24,"2019":25,"2020":25,"2021":26,"2022":25,"2023":26,"2024":27,"2025":30},"order":{"1990":11,"1991":11,"1992":11,"1993":11,"1994":11,"1995":11,"1996":11,"1997":14,"1998":14,"1999":14,"2000":16,"2001":16,"2002":16,"2003":16,"2004":16,"2005":16,"2006":17,"2007":17,"2008":17,"2009":17,"2010":18,"2011":19,"2012":19,"2013":19,"2014":19,"2015":20,"2016":20,"2017":20,"2018":20,"2019":20,"2020":20,"2021":20,"2022":20,"2023":20,"2024":20,"2025":20}},{"country":"Philippines","flag":"🇵🇭","values":{"1990":0,"1991":0,"1992":0,"1993":0,"1994":0,"1995":0,"1996":0,"1997":0,"1998":1,"1999":2,"2000":3,"2001":4,"2002":5,"2003":5,"2004":6,"2005":6,"2006":6,"2007":6,"2008":6,"2009":10,"2010":10,"2011":13,"2012":13,"2013":14,"2014":19,"2015":20,"2016":24,"2017":27,"2018":28,"2019":33,"2020":34,"2021":38,"2022":40,"2023":41,"2024":42,"2025":44},"ranks":{"1998":9,"1999":10,"2000":10,"2001":9,"2002":9,"2003":10,"2004":9,"2005":9,"2006":9,"2007":9,"2008":10,"2009":9,"2010":11,"2011":9,"2012":11,"2013":12,"2014":8,"2015":11,"2016":11,"2017":11,"2018":10,"2019":10,"2020":9,"2021":10,"2022":10,"2023":10,"2024":11,"2025":12},"order":{"1990":16,"1991":16,"1992":17,"1993":17,"1994":17,"1995":17,"1996":18,"1997":18,"1998":16,"1999":15,"2000":12,"2001":11,"2002":11,"2003":11,"2004":11,"2005":12,"2006":12,"2007":12,"2008":13,"2009":12,"2010":12,"2011":11,"2012":13,"2013":13,"2014":11,"2015":13,"2016":11,"2017":11,"2018":11,"2019":11,"2020":10,"2021":10,"2022":10,"2023":11,"2024":11,"2025":12}},{"country":"South Korea","flag":"🇰🇷","values":{"1990":2,"1991":2,"1992":2,"1993":2,"1994":2,"1995":2,"1996":2,"1997":2,"1998":2,"1999":2,"2000":2,"2001":3,"2002":6,"2003":9,"2004":10,"2005":10,"2006":10,"2007":10,"2008":12,"2009":16,"2010":24,"2011":35,"2012":38,"2013":47,"2014":49,"2015":51,"2016":58,"2017":65,"2018":69,"2019":72,"2020":75,"2021":76,"2022":79,"2023":79,"2024":80,"2025":80},"ranks":{"1990":5,"1991":4,"1992":6,"1993":6,"1994":8,"1995":8,"1996":9,"1997":7,"1998":8,"1999":10,"2000":11,"2001":10,"2002":8,"2003":7,"2004":6,"2005":6,"2006":7,"2007":7,"2008":6,"2009":7,"2010":6,"2011":5,"2012":5,"2013":5,"2014":5,"2015":5,"2016":5,"2017":5,"2018":5,"2019":5,"2020":5,"2021":5,"2022":5,"2023":5,"2024":5,"2025":6},"order":{"1990":10,"1991":10,"1992":10,"1993":10,"1994":10,"1995":10,"1996":10,"1997":13,"1998":13,"1999":13,"2000":15,"2001":14,"2002":10,"2003":8,"2004":7,"2005":7,"2006":8,"2007":8,"2008":7,"2009":7,"2010":6,"2011":5,"2012":5,"2013":5,"2014":5,"2015":5,"2016":5,"2017":5,"2018":5,"2019":5,"2020":5,"2021":5,"2022":5,"2023":5,"2024":5,"2025":6}},{"country":"Hong Kong","flag":"🇭🇰","values":{"1990":2,"1991":4,"1992":7,"1993":8,"1994":8,"1995":8,"1996":8,"1997":9,"1998":11,"1999":13,"2000":17,"2001":24,"2002":25,"2003":37,"2004":39,"2005":48,"2006":51,"2007":51,"2008":59,"2009":63,"2010":66,"2011":71,"2012":74,"2013":74,"2014":76,"2015":76,"2016":76,"2017":77,"2018":78,"2019":81,"2020":85,"2021":88,"2022":97,"2023":97,"2024":99,"2025":102},"ranks":{"1990":5,"1991":3,"1992":4,"1993":4,"1994":5,"1995":5,"1996":5,"1997":4,"1998":4,"1999":4,"2000":4,"2001":3,"2002":3,"2003":3,"2004":3,"2005":3,"2006":3,"2007":3,"2008":3,"2009":3,"2010":3,"2011":3,"2012":3,"2013":4,"2014":4,"2015":4,"2016":4,"2017":4,"2018":4,"2019":4,"2020":4,"2021":4,"2022":4,"2023":4,"2024":4,"2025":4},"order":{"1990":7,"1991":6,"1992":5,"1993":4,"1994":5,"1995":5,"1996":5,"1997":6,"1998":5,"1999":4,"2000":4,"2001":3,"2002":3,"2003":3,"2004":3,"2005":3,"2006":3,"2007":3,"2008":3,"2009":3,"2010":3,"2011":3,"2012":3,"2013":4,"2014":4,"2015":4,"2016":4,"2017":4,"2018":4,"2019":4,"2020":4,"2021":4,"2022":4,"2023":4,"2024":4,"2025":4}},{"country":"Canada","flag":"🇨🇦","values":{"1990":6,"1991":7,"1992":9,"1993":9,"1994":9,"1995":9,"1996":9,"1997":9,"1998":9,"1999":9,"2000":9,"2001":9,"2002":9,"2003":9,"2004":9,"2005":9,"2006":9,"2007":9,"2008":9,"2009":10,"2010":11,"2011":13,"2012":17,"2013":17,"2014":19,"2015":21,"2016":21,"2017":25,"2018":27,"2019":32,"2020":32,"2021":33,"2022":34,"2023":39,"2024":41,"2025":46},"ranks":{"1990":2,"1991":2,"1992":3,"1993":3,"1994":4,"1995":4,"1996":4,"1997":4,"1998":5,"1999":6,"2000":6,"2001":6,"2002":6,"2003":7,"2004":7,"2005":7,"2006":8,"2007":8,"2008":8,"2009":9,"2010":10,"2011":9,"2012":9,"2013":10,"2014":8,"2015":10,"2016":12,"2017":12,"2018":11,"2019":11,"2020":11,"2021":12,"2022":11,"2023":11,"2024":12,"2025":11},"order":{"1990":2,"1991":3,"1992":3,"1993":3,"1994":4,"1995":4,"1996":4,"1997":5,"1998":6,"1999":6,"2000":6,"2001":6,"2002":6,"2003":7,"2004":8,"2005":8,"2006":9,"2007":9,"2008":10,"2009":10,"2010":10,"2011":9,"2012":9,"2013":10,"2014":10,"2015":10,"2016":12,"2017":12,"2018":12,"2019":12,"2020":12,"2021":12,"2022":12,"2023":12,"2024":12,"2025":11}},{"country":"China","flag":"🇨🇳","values":{"1990":2,"1991":2,"1992":2,"1993":2,"1994":2,"1995":2,"1996":6,"1997":11,"1998":20,"1999":24,"2000":32,"2001":40,"2002":45,"2003":52,"2004":58,"2005":71,"2006":81,"2007":95,"2008":108,"2009":121,"2010":145,"2011":166,"2012":187,"2013":224,"2014":294,"2015":368,"2016":465,"2017":549,"2018":656,"2019":734,"2020":804,"2021":873,"2022":968,"2023":1066,"2024":1161,"2025":1246},"ranks":{"1990":5,"1991":4,"1992":6,"1993":6,"1994":8,"1995":8,"1996":7,"1997":3,"1998":2,"1999":2,"2000":2,"2001":2,"2002":2,"2003":2,"2004":2,"2005":2,"2006":2,"2007":2,"2008":2,"2009":2,"2010":2,"2011":1,"2012":1,"2013":1,"2014":1,"2015":1,"2016":1,"2017":1,"2018":1,"2019":1,"2020":1,"2021":1,"2022":1,"2023":1,"2024":1,"2025":1},"order":{"1990":6,"1991":7,"1992":7,"1993":7,"1994":8,"1995":8,"1996":7,"1997":4,"1998":2,"1999":2,"2000":2,"2001":2,"2002":2,"2003":2,"2004":2,"2005":2,"2006":2,"2007":2,"2008":2,"2009":2,"2010":2,"2011":1,"2012":1,"2013":1,"2014":1,"2015":1,"2016":1,"2017":1,"2018":1,"2019":1,"2020":1,"2021":1,"2022":1,"2023":1,"2024":1,"2025":1}}]}
JSON, true, 512, JSON_THROW_ON_ERROR);
        $r = DwStudio::importRace($topic, $content, 'Claude Code');
        echo $r['ok'] ? "  OK  dw: 2026-11-22 race package v{$r['version']}\n" : "  ERR dw Nov 22 race: " . implode(' ', $r['errors']) . "\n";
    }
} catch (Throwable $e) {
    echo "  ERR dw Nov 22 race: " . $e->getMessage() . "\n";
}

// Once: today's challenge (2026-11-11, live) "Hop on public transport and get off at a stop you've never seen." made
// easier: "Snap a typical public transport stop in your city." through the admin's own service functions
// (DailyAdminService: the English, its 18 translations, the headline). The comparison question ("Which stop?"), theme,
// cover, status and posted photos untouched. Runs only while the old text is there.
try {
    $nov11 = $pdo->query("SELECT id, text_i18n->>'en' AS en FROM daily_challenges WHERE challenge_date = '2026-11-11'")->fetch(PDO::FETCH_ASSOC);
    if ($nov11 && $nov11['en'] === "Hop on public transport and get off at a stop you've never seen.") {
        spl_autoload_register(static function (string $class): void {
            $file = __DIR__ . '/src/' . $class . '.php';
            if (preg_match('/^[A-Za-z0-9_]+$/', $class) && is_file($file)) require_once $file;
        });
        $new = json_decode(<<<'JSON'
{"text": {"en": "Snap a typical public transport stop in your city.", "fr": "Prends en photo un arrêt de transport typique de ta ville.", "vi": "Chụp một trạm giao thông công cộng đặc trưng ở thành phố bạn.", "es": "Haz una foto de una parada típica del transporte público de tu ciudad.", "it": "Fotografa una tipica fermata dei mezzi pubblici della tua città.", "pt-br": "Fotografe um ponto típico de transporte público da sua cidade.", "pt-pt": "Fotografa uma paragem típica dos transportes públicos da tua cidade.", "de": "Fotografiere eine typische Haltestelle in deiner Stadt.", "nl": "Maak een foto van een typische ov-halte in jouw stad.", "zh-hans": "拍一个你所在城市最典型的公共交通站点。", "zh-hant": "拍一個你所在城市最典型的大眾運輸站點。", "ja": "あなたの街の、いかにも地元らしい駅やバス停を撮ろう。", "ko": "우리 도시의 전형적인 대중교통 정류장을 찍어 보세요.", "fil": "Kunan ng litrato ang isang tipikal na sakayan sa lungsod mo.", "th": "ถ่ายรูปป้ายรถหรือสถานีขนส่งสาธารณะที่เป็นแบบฉบับของเมืองคุณ", "id": "Foto halte transportasi umum yang khas di kotamu.", "hi": "अपने शहर का कोई आम पब्लिक ट्रांसपोर्ट स्टॉप क्लिक करें।", "ru": "Сфотографируй типичную остановку общественного транспорта в своём городе.", "ar": "صوّر محطة نقل عام نموذجية في مدينتك."}, "context": {"en": "Bus stop, metro, tram or ferry: whatever locals use every day.", "fr": "Arrêt de bus, métro, tram ou ferry : ce que les gens d'ici prennent tous les jours.", "vi": "Trạm xe buýt, metro, tàu điện hay bến phà: chỗ người dân ở đây dùng mỗi ngày.", "es": "Parada de bus, metro, tranvía o ferri: lo que la gente de aquí usa a diario.", "it": "Fermata del bus, metro, tram o traghetto: quella che la gente del posto usa ogni giorno.", "pt-br": "Ponto de ônibus, metrô, VLT ou barca: o que o pessoal daqui usa todo dia.", "pt-pt": "Paragem de autocarro, metro, elétrico ou barco: o que a malta daqui usa todos os dias.", "de": "Bushaltestelle, U-Bahn, Tram oder Fähre: was die Leute hier jeden Tag nehmen.", "nl": "Bushalte, metro, tram of pont: wat de mensen hier elke dag gebruiken.", "zh-hans": "公交站、地铁站、有轨电车站或轮渡码头：本地人每天都在用的就行。", "zh-hant": "公車站、捷運站、輕軌站或渡輪碼頭：在地人每天都在用的就行。", "ja": "バス停、地下鉄、路面電車、フェリー乗り場：地元の人が毎日使う場所ならOK。", "ko": "버스 정류장, 지하철역, 트램, 페리 선착장: 현지인이 매일 이용하는 곳이면 돼요.", "fil": "Bus stop, MRT, jeep o bangka: kung ano ang sinasakyan ng mga taga-rito araw-araw.", "th": "ป้ายรถเมล์ รถไฟฟ้า รถราง หรือท่าเรือ: อะไรก็ได้ที่คนท้องถิ่นใช้ทุกวัน", "id": "Halte bus, stasiun MRT, trem, atau dermaga feri: apa pun yang dipakai warga tiap hari.", "hi": "बस स्टॉप, मेट्रो, ट्राम या फ़ेरी: जो भी लोकल लोग रोज़ इस्तेमाल करते हैं।", "ru": "Автобусная остановка, метро, трамвай или паром: то, чем местные пользуются каждый день.", "ar": "موقف باص، مترو، ترام أو عبّارة: أي شيء يستخدمه أهل المدينة كل يوم."}, "headline": {"en": "Snap your city's everyday stop.", "fr": "Photographie l'arrêt typique de ta ville.", "vi": "Chụp trạm xe quen thuộc ở thành phố bạn.", "es": "Fotografía la parada típica de tu ciudad.", "it": "Fotografa la fermata tipica della tua città.", "pt-br": "Fotografe o ponto típico da sua cidade.", "pt-pt": "Fotografa a paragem típica da tua cidade.", "de": "Knips die typische Haltestelle deiner Stadt.", "nl": "Fotografeer de typische halte van jouw stad.", "zh-hans": "拍下你城市最日常的那一站。", "zh-hant": "拍下你城市最日常的那一站。", "ja": "街らしい駅やバス停を撮ろう。", "ko": "우리 도시다운 정류장을 찍어 보세요.", "fil": "Kunan ang tipikal na sakayan sa lungsod mo.", "th": "ถ่ายป้ายรถแบบฉบับเมืองคุณ", "id": "Foto halte khas di kotamu.", "hi": "अपने शहर का रोज़ वाला स्टॉप क्लिक करें।", "ru": "Сфоткай типичную остановку своего города.", "ar": "صوّر المحطة المعتادة في مدينتك."}}
JSON, true, 512, JSON_THROW_ON_ERROR);
        $tr = static fn(array $m): array => array_diff_key($m, ['en' => 1]);
        $id = (string) $nov11['id'];
        DailyAdminService::updateChallenge($id, ['text' => $new['text']['en'], 'context' => $new['context']['en']]);
        DailyAdminService::setChallengeTranslations($id, $tr($new['text']), $tr($new['context']));
        DailyAdminService::setChallengeHeadline($id, $new['headline']['en'], $tr($new['headline']));
        echo "  OK  daily: 2026-11-11 replaced by \"{$new['text']['en']}\" (19 locales: text, context, headline)\n";
    }
} catch (Throwable $e) {
    echo "  ERR daily 2026-11-11 replacement: " . $e->getMessage() . "\n";
}

// Once: Nov 11 (singles) back to classic, with the static layout (no animation, a plain list, #1 with a 👑), Vietnam as
// the extra row, the banner with its flag and the question "Single or taken? 👀", through DwStudio::updateField (as the
// admin's fields: the caption's last line follows); the quiz PNG 03 dropped (classic renders two). Only while in quiz mode.
try {
    spl_autoload_register(static function (string $class): void {
        $file = __DIR__ . '/src/' . $class . '.php';
        if (preg_match('/^[A-Za-z0-9_]+$/', $class) && is_file($file)) require_once $file;
    });
    $topic = DwStudio::topicByDate('2026-11-11');
    $pkg = $topic !== null ? DwStudio::package($topic['id']) : null;
    if ($pkg !== null && ($pkg['content']['mode'] ?? null) === 'quiz') {
        DwStudio::updateField($pkg['id'], 'mode', 'classic');
        DwStudio::updateField($pkg['id'], 'layout', 'static');
        DwStudio::updateField($pkg['id'], 'extra_row', 'Vietnam');
        DwStudio::updateField($pkg['id'], 'detail', '🇯🇲 Jamaica: 75% of women unmarried at 30 💍');
        DwStudio::updateField($pkg['id'], 'outro_question', 'Single or taken? 👀');
        $pdo->prepare("UPDATE dw_packages SET still3_url = NULL WHERE id = ?")->execute([$pkg['id']]);
        echo "  OK  dw: 2026-11-11 classic, static layout, Vietnam row, \"Single or taken? 👀\"\n";
    }
} catch (Throwable $e) {
    echo "  ERR dw Nov 11 static: " . $e->getMessage() . "\n";
}

// Once: Nov 12 to 15 in Nov 11's format (classic, static layout) through DwStudio::updateField (as the admin's fields:
// the caption's last line follows a new question): Nov 13 and 14 banners with their flags, Nov 14 out of quiz mode
// (its quiz question kept, unused; the question 'Did YOU guess right?' becomes 'Too many tourists in YOUR city? ✈️';
// its quiz PNG 03 dropped), Vietnam as Nov 15's extra row (#73). Only while a package is not static yet.
try {
    spl_autoload_register(static function (string $class): void {
        $file = __DIR__ . '/src/' . $class . '.php';
        if (preg_match('/^[A-Za-z0-9_]+$/', $class) && is_file($file)) require_once $file;
    });
    $static = [
        '2026-11-12' => [],
        '2026-11-13' => ['detail' => '🇮🇩🇱🇦 Indonesia & Laos: 9 in 10 laughed yesterday 😄'],
        '2026-11-14' => ['mode' => 'classic', 'detail' => '🇦🇩 Andorra: 40 tourists for every local 🙈', 'outro_question' => 'Too many tourists in YOUR city? ✈️'],
        '2026-11-15' => ['extra_row' => 'Vietnam'],
    ];
    foreach ($static as $date => $fields) {
        $topic = DwStudio::topicByDate($date);
        $pkg = $topic !== null ? DwStudio::package($topic['id']) : null;
        if ($pkg === null || ($pkg['content']['layout'] ?? null) === 'static') {
            continue;
        }
        foreach ($fields + ['layout' => 'static'] as $path => $value) {
            DwStudio::updateField($pkg['id'], $path, $value);
        }
        if (isset($fields['mode'])) {
            $pdo->prepare("UPDATE dw_packages SET still3_url = NULL WHERE id = ?")->execute([$pkg['id']]);
        }
        echo "  OK  dw: {$date} static layout\n";
    }
} catch (Throwable $e) {
    echo "  ERR dw Nov 12-15 static: " . $e->getMessage() . "\n";
}

// Once: the races of Nov 17 to 22 hold, then move (each step still 1.2 s to read, a 0.4 s transition, a 2.5 s freeze on
// the last year), through DwStudio::updateField (the admin's Pace fields). Years shown: every edition on Nov 18 (4),
// one out of 2 on Nov 17, 20 and 21, one out of 3 on Nov 19 (fast until 2009) and Nov 22, each banner year kept.
// Close values (Nov 17 passports, Nov 18 cuisine ratings): bars start just below each year's top 10. Nov 17's headline
// ends with ✈️ (🛂 rendered as a box). Only while a race does not hold first yet.
try {
    spl_autoload_register(static function (string $class): void {
        $file = __DIR__ . '/src/' . $class . '.php';
        if (preg_match('/^[A-Za-z0-9_]+$/', $class) && is_file($file)) require_once $file;
    });
    $pace = ['hold_first' => 'true', 'step_seconds' => '1.6', 'hold' => '0.75', 'freeze_seconds' => '2.5'];
    $races = [
        '2026-11-17' => ['year_step' => '2', 'bar_scale' => 'step', 'headline' => "The world's most powerful passports, 2010 → 2026 ✈️"] + $pace,
        '2026-11-18' => ['bar_scale' => 'step'] + $pace,
        '2026-11-19' => ['year_step' => '3', 'step_seconds' => '0.8', 'slow_from' => '2009', 'slow_step' => '1.6'] + $pace,
        '2026-11-20' => ['year_step' => '2'] + $pace,
        '2026-11-21' => ['year_step' => '2'] + $pace,
        '2026-11-22' => ['year_step' => '3'] + $pace,
    ];
    foreach ($races as $date => $fields) {
        $topic = DwStudio::topicByDate($date);
        $pkg = $topic !== null ? DwStudio::package($topic['id']) : null;
        if ($pkg === null || !DwRace::isRace($pkg['content']) || !empty($pkg['content']['hold_first'])) {
            continue;
        }
        foreach ($fields as $path => $value) {
            DwStudio::updateField($pkg['id'], $path, $value);
        }
        echo "  OK  dw: {$date} race pace (hold, then move)\n";
    }
} catch (Throwable $e) {
    echo "  ERR dw Nov 17-22 race pace: " . $e->getMessage() . "\n";
}

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
