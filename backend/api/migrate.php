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

// PR11: rate_ready_push — fires when a meet-up's rating window opens
// (start + 1h, via Option B piggyback). High-signal social loop closer;
// default TRUE so users get the nudge unless they opt out.
run($pdo, "ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS rate_ready_push BOOLEAN NOT NULL DEFAULT TRUE", 'notification_preferences.rate_ready_push');

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
// Edit-signal for /sitemap/events <lastmod>. Bumped on every user edit in
// EventRepository::update(); DEFAULT now() on ALTER means pre-migration rows
// take the migration timestamp (one re-crawl wave, then quiet). TM-imported
// events keep INSERT-time updated_at — re-sync UPSERTs deliberately don't
// bump it because most syncs are no-ops (same data, false re-crawl signal).
run($pdo, "ALTER TABLE channel_events ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now()", 'channel_events.updated_at');
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

// Track edits + validations so /sitemap/challenges can emit a real <lastmod>
// signal — without this, Google never knows a challenge changed after its
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
// Type filter (food/place/culture/help) — bounded cardinality, btree is fine.
run($pdo, "CREATE INDEX IF NOT EXISTS idx_channel_challenges_type        ON channel_challenges (challenge_type)", 'idx_channel_challenges_type');

// Participant lookups.
run($pdo, "CREATE INDEX IF NOT EXISTS idx_challenge_participants_channel ON challenge_participants (channel_id)", 'idx_challenge_participants_channel');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_challenge_participants_user    ON challenge_participants (user_id) WHERE user_id IS NOT NULL", 'idx_challenge_participants_user');

// ── Challenge redesign (PR1: model + creation) ────────────────────────────────
// The challenge is now an "ad" — a creator publishes it, multiple travelers
// (or locals, depending on audience) can take it on. Each take-on opens its
// own 1:1 thread channel (challenge_acceptances row). The persistent
// challenge_challenges row carries the ad-level config (cap + return clause).
//
// PR1 is additive only. challenge_participants stays (still used by the
// legacy pooled-acceptance flow). PR2 will migrate the acceptance flow to
// challenge_acceptances and propose a data migration for any in-flight
// challenge_participants rows.

// max_participants: cap on concurrent take-ons. Default 3, editable by creator
// in the form. NOT NULL with a default is safe — every existing row gets 3.
run($pdo, "ALTER TABLE channel_challenges ADD COLUMN IF NOT EXISTS max_participants INT NOT NULL DEFAULT 3", 'channel_challenges.max_participants');

// return_clause: the "...and come convince me" half of the prompt. Pre-filled
// per type by the client (food/place/culture/help templates), editable by the
// creator before submit. Nullable so we can shipped without backfilling old
// challenges; the read path falls back to a generic clause for nulls.
run($pdo, "ALTER TABLE channel_challenges ADD COLUMN IF NOT EXISTS return_clause TEXT", 'channel_challenges.return_clause');

// ── Acceptances — one row per (challenge, acceptor) relationship ─────────────
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

// Step D rollback — challenge_thread channels are no longer auto-created on
// accept. The 1:1 private chat moved to the unified public challenge channel
// (badges distinguish roles). Existing acceptances keep their thread_channel_id
// pointing at the historical thread row; new acceptances write NULL.
// Drop NOT NULL so new INSERTs can land. The UNIQUE constraint still holds —
// Postgres treats multiple NULLs as distinct under UNIQUE.
run($pdo, "ALTER TABLE challenge_acceptances ALTER COLUMN thread_channel_id DROP NOT NULL", 'thread_channel_id nullable');

// ── Challenge redesign — PR3: date concertation ──────────────────────────────
// Either party proposes a date in the thread; the creator approves; on approve
// the server creates a debrief event (channel_events with source_type=
// 'challenge_debrief' so it stays out of public city event feeds) and sets
// phase='scheduled'. Counter-proposals overwrite the previous proposal —
// one active proposal per acceptance at a time.
run($pdo, "ALTER TABLE challenge_acceptances ADD COLUMN IF NOT EXISTS proposed_starts_at  TIMESTAMPTZ", 'challenge_acceptances.proposed_starts_at');
run($pdo, "ALTER TABLE challenge_acceptances ADD COLUMN IF NOT EXISTS proposed_ends_at    TIMESTAMPTZ", 'challenge_acceptances.proposed_ends_at');
run($pdo, "ALTER TABLE challenge_acceptances ADD COLUMN IF NOT EXISTS proposed_venue      TEXT",        'challenge_acceptances.proposed_venue');
run($pdo, "ALTER TABLE challenge_acceptances ADD COLUMN IF NOT EXISTS proposed_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL", 'challenge_acceptances.proposed_by_user_id');
run($pdo, "ALTER TABLE challenge_acceptances ADD COLUMN IF NOT EXISTS proposed_at         TIMESTAMPTZ", 'challenge_acceptances.proposed_at');
run($pdo, "ALTER TABLE challenge_acceptances ADD COLUMN IF NOT EXISTS date_approved_at    TIMESTAMPTZ", 'challenge_acceptances.date_approved_at');

// PR11: rate-ready push tracking. Set the moment we fire the "rate your
// meet-up" push (Option B piggyback — see NotificationRepository::
// maybeTickRatePushes). Dedupes the global scan so the same acceptance
// can't be pushed twice. NULL = not yet pushed; partial index below
// keeps the scan O(few rows) regardless of table size.
run($pdo, "ALTER TABLE challenge_acceptances ADD COLUMN IF NOT EXISTS rate_push_sent_at TIMESTAMPTZ", 'challenge_acceptances.rate_push_sent_at');
run($pdo, "
    CREATE INDEX IF NOT EXISTS idx_chacc_rate_push_pending
        ON challenge_acceptances (COALESCE(proposed_ends_at, proposed_starts_at))
        WHERE phase = 'scheduled' AND rate_push_sent_at IS NULL
", 'idx_chacc_rate_push_pending');

// ── Challenge invitations ─────────────────────────────────────────────────────
// After publishing, the creator can hand-pick city members and ping them.
// Each row = one (challenge, invitee) ping. status pending → accepted | ignored.
// Accept is just "the invitee tapped Accept on the push or in-app" — it does
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

// ── Défi — International mode (PR1: schema only) ──────────────────────────────
// The existing challenge model is "Local mode" implicitly: creator + acceptor
// in the same city, ends with an IRL meetup. International mode is the growth
// engine — creator in city A challenges someone from anywhere (or a specific
// city B). No meetup; the acceptor sends visual proof (photo/video w/ geotag)
// and the creator validates from afar. Single source of truth — discriminator
// column on the existing channel_challenges table, NOT a parallel table.
//
//   mode               : 'local' (default — all existing rows) | 'international'
//   target_city_id     : nullable. For local rows: unused. For international:
//                        NULL = "anywhere" (no fan-out, origin city only);
//                        non-null = mirror into target city's feed + push.
//   proof_requirements : creator-authored text shown to the acceptor before
//                        they submit the proof. Local rows: NULL.
run($pdo, "ALTER TABLE channel_challenges ADD COLUMN IF NOT EXISTS mode               TEXT NOT NULL DEFAULT 'local'", 'channel_challenges.mode');
run($pdo, "ALTER TABLE channel_challenges ADD COLUMN IF NOT EXISTS target_city_id     TEXT REFERENCES channels(id)", 'channel_challenges.target_city_id');
run($pdo, "ALTER TABLE channel_challenges ADD COLUMN IF NOT EXISTS proof_requirements TEXT",                          'channel_challenges.proof_requirements');

// Filter queries: NOW feed sub-chip "Local | International | All" — common
// path lands on (mode, status, created_at DESC); reuse the existing city
// index for the city filter and let this one short-list mode within it.
run($pdo, "CREATE INDEX IF NOT EXISTS idx_channel_challenges_mode ON channel_challenges (mode)", 'idx_channel_challenges_mode');
// Target-city lookups (mirrored feed + reverse fan-out from city B back to
// the creator's challenge). Partial — most rows have target_city_id IS NULL.
run($pdo, "CREATE INDEX IF NOT EXISTS idx_channel_challenges_target_city ON channel_challenges (target_city_id) WHERE target_city_id IS NOT NULL", 'idx_channel_challenges_target_city');

// ── challenge_proofs — one row per submission attempt ─────────────────────────
// Acceptor submits a proof (image or short video) with mandatory geotag. The
// creator reviews + approves or rejects with a mandatory reason (1–200 chars).
// Max 3 attempts per acceptance (enforced in the route, not as a DB constraint
// — keeps the migration simple and lets us tune later).
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

// Creator's review queue + acceptor's history per acceptance — both walk by
// acceptance_id, newest first.
run($pdo, "CREATE INDEX IF NOT EXISTS idx_chproofs_acceptance ON challenge_proofs (acceptance_id, submitted_at DESC)", 'idx_chproofs_acceptance');

// ── Per-city geotag tolerance (server-side config, env fallback) ──────────────
// 30 km default (set via env CHALLENGE_PROOF_TOLERANCE_KM at the read site).
// Per-city override for sprawling metros (Saigon, LA-style basins) — leave
// NULL for now; an admin tool / SQL update can tune individual cities later
// without a code change.
run($pdo, "ALTER TABLE cities ADD COLUMN IF NOT EXISTS proof_geotag_tolerance_km INT", 'cities.proof_geotag_tolerance_km');

// ── challenge_acceptances — phase=‘proof_submitted’ for international flow ────
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
// (cross-city content can't be private — defeats the model). No CHECK
// constraint on the column itself so we can flex later without a migration.
run($pdo, "ALTER TABLE channel_challenges ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'public'", 'channel_challenges.visibility');

// Sitemap + feed + profile queries all gate on visibility — index it.
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
// UNIQUE (challenge_id, user_id) — one row per user; resubmitting the
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

// challenge_anonymized_users dropped — pseudonymous-by-default identities
// (chosen username + avatar) already serve this need. Existing levers (change
// username, leave the challenge, delete account) cover the "I want to
// disappear" use case without a separate display-mask layer. DROP is
// idempotent so production environments where the table got created get
// cleaned up on the next migrate.
run($pdo, "DROP TABLE IF EXISTS challenge_anonymized_users CASCADE", 'drop challenge_anonymized_users');

// challenge_comments dropped — Hilads channels are conversational by design,
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
//     'off' (silent — the user still gets read access, just no pings)
//   - channel_challenges.closed_to_new_joins: creator can freeze the
//     participant list at any point (existing participants stay; new join
//     requests refused). Per-challenge toggle, default FALSE.
//   - challenge_kicks: per-(challenge, user) ban issued by the creator OR
//     the active taker. Kicked users can't re-join until the row is removed
//     (no UI for unkicking in v1; ops-only).
run($pdo, "ALTER TABLE challenge_participants ADD COLUMN IF NOT EXISTS notification_preference TEXT NOT NULL DEFAULT 'milestones'", 'challenge_participants.notification_preference');
run($pdo, "ALTER TABLE channel_challenges     ADD COLUMN IF NOT EXISTS closed_to_new_joins     BOOLEAN NOT NULL DEFAULT FALSE",      'channel_challenges.closed_to_new_joins');

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

// ── Scores + ratings — Path A (PHP/PDO, no RLS) ─────────────────────────────
// Cached score columns on users + a score_events ledger + a score_rules
// config table + a challenge_ratings table + triggers that derive points
// from the rules. Mutual ratings are the source of truth for "meetup
// happened + we debriefed it" — the trigger on challenge_ratings flips
// the active acceptance to phase='approved' on the second rating,
// replacing the legacy manual creator-approve step.
//
// All city_id columns on score_events are anchored to cc.city_id (the
// challenge's origin city) so the per-city leaderboard sums cleanly
// across accepted / meetup / debrief for the same challenge.

run($pdo, "CREATE EXTENSION IF NOT EXISTS pgcrypto", 'pgcrypto');

// Cached scores on users — driven by triggers; never written by hand.
run($pdo, "ALTER TABLE users ADD COLUMN IF NOT EXISTS score_alltime    INT  NOT NULL DEFAULT 0", 'users.score_alltime');
run($pdo, "ALTER TABLE users ADD COLUMN IF NOT EXISTS score_month      INT  NOT NULL DEFAULT 0", 'users.score_month');
run($pdo, "ALTER TABLE users ADD COLUMN IF NOT EXISTS score_month_ref  TEXT",                    'users.score_month_ref');

// Intentionally NO users.city_id — current_city_id already covers it
// and a second FK would just create ambiguity. score_events.city_id is
// always cc.city_id (the challenge's anchor), not the user's location.

// Points config — single source of truth, tunable in prod via SQL UPDATE.
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
// score_events of kind='meetup' from prior runs are LEFT INTACT — they
// already contribute the old 10/15 points to alltime totals, and the
// per-challenge sum is preserved.
run($pdo, "DELETE FROM score_rules WHERE kind = 'meetup'", 'score_rules drop meetup');

run($pdo, "
    INSERT INTO score_rules (kind, role, points) VALUES
        ('accepted', 'challenger',  5),
        ('debrief',  'challenger', 30),
        ('debrief',  'taker',      40),
        ('ghost',    'taker',       0)
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
        kind         TEXT        NOT NULL CHECK (kind IN ('accepted', 'meetup', 'debrief', 'ghost')),
        points       INT         NOT NULL,
        city_id      TEXT        REFERENCES channels(id) ON DELETE SET NULL,
        month_ref    TEXT        NOT NULL,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (user_id, challenge_id, role, kind)
    )
", 'score_events');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_score_events_user_month ON score_events (user_id, month_ref)", 'idx_score_events_user_month');
run($pdo, "CREATE INDEX IF NOT EXISTS idx_score_events_city_month ON score_events (city_id, month_ref)", 'idx_score_events_city_month');

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

// Leaderboard indexes — power the bounded rank queries on GET /me/scores.
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

// ── Trigger: accepted-points on first acceptance ───────────────────────────
// City anchor = cc.city_id (the challenge's origin city). Matches the
// mutual-rating trigger below so all score_events for one challenge
// hit the same city bucket. UNIQUE on score_events blocks dupes when a
// challenge is accepted, dropped, re-accepted — one accepted-event per
// challenge total.
run($pdo, "
    CREATE OR REPLACE FUNCTION on_challenge_acceptance_insert() RETURNS TRIGGER AS \$\$
    DECLARE
        challenger_id TEXT;
        origin_city   TEXT;
        pts           INT;
        current_month TEXT := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM');
    BEGIN
        IF NEW.phase = 'rejected' THEN RETURN NEW; END IF;

        SELECT cc.created_by, cc.city_id
        INTO challenger_id, origin_city
        FROM channel_challenges cc
        WHERE cc.channel_id = NEW.challenge_id;

        IF challenger_id IS NULL THEN RETURN NEW; END IF;

        SELECT points INTO pts FROM score_rules WHERE kind = 'accepted' AND role = 'challenger';
        IF pts IS NULL THEN RETURN NEW; END IF;

        INSERT INTO score_events (id, user_id, challenge_id, role, kind, points, city_id, month_ref)
        VALUES (encode(gen_random_bytes(8), 'hex'),
                challenger_id, NEW.challenge_id, 'challenger', 'accepted',
                pts, origin_city, current_month)
        ON CONFLICT (user_id, challenge_id, role, kind) DO NOTHING;

        RETURN NEW;
    END;
    \$\$ LANGUAGE plpgsql;
", 'fn on_challenge_acceptance_insert');

run($pdo, "DROP TRIGGER IF EXISTS trg_chacc_accepted_score ON challenge_acceptances", 'drop trg_chacc_accepted_score');
run($pdo, "
    CREATE TRIGGER trg_chacc_accepted_score
    AFTER INSERT ON challenge_acceptances
    FOR EACH ROW EXECUTE FUNCTION on_challenge_acceptance_insert()
", 'trg_chacc_accepted_score');

// ── Trigger: mutual-rating → meetup + debrief + phase flip ────────────────
//
// STRICT mutual-rating model: debrief fires ONLY when BOTH parties have
// rated. If one person never rates, NEITHER earns debrief points — not
// even the one who did rate. This is intentional. The double-rating is
// a stronger meetup proof than a one-sided claim. PR10 folded the old
// 'meetup' event into 'debrief'; same totals at the user level.
//
// TODO: time-based fallback. If only one party has rated after N days,
// consider awarding partial points (reveal + award the lone rater) and
// separately flagging the no-show via the 'ghost' kind. Requires a
// scheduled job — out of scope for this migration. score_rules.ghost.taker
// is already seeded at 0 so the column exists when we wire that up.
run($pdo, "
    CREATE OR REPLACE FUNCTION on_challenge_rating_insert() RETURNS TRIGGER AS \$\$
    DECLARE
        cnt            INT;
        challenger_id  TEXT;
        taker_id       TEXT;
        origin_city    TEXT;
        pts_debrief_c  INT;
        pts_debrief_t  INT;
        current_month  TEXT := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM');
    BEGIN
        SELECT COUNT(DISTINCT rater_id) INTO cnt
        FROM challenge_ratings
        WHERE challenge_id = NEW.challenge_id;

        IF cnt < 2 THEN RETURN NEW; END IF;

        SELECT cc.created_by, cc.city_id
        INTO challenger_id, origin_city
        FROM channel_challenges cc
        WHERE cc.channel_id = NEW.challenge_id;

        SELECT ca.acceptor_user_id INTO taker_id
        FROM challenge_acceptances ca
        WHERE ca.challenge_id = NEW.challenge_id
          AND ca.phase <> 'rejected'
        ORDER BY ca.created_at DESC
        LIMIT 1;

        IF challenger_id IS NULL OR taker_id IS NULL THEN RETURN NEW; END IF;

        -- PR10: meetup events no longer written. The combined points live
        -- on debrief now (30 + 40). cnt<2 short-circuit above, ON CONFLICT
        -- idempotency, and the phase='approved' flip below are unchanged.
        -- The 'meetup' value stays allowed in the score_events kind CHECK
        -- so historical rows from earlier runs keep validating.
        SELECT points INTO pts_debrief_c FROM score_rules WHERE kind = 'debrief' AND role = 'challenger';
        SELECT points INTO pts_debrief_t FROM score_rules WHERE kind = 'debrief' AND role = 'taker';

        INSERT INTO score_events (id, user_id, challenge_id, role, kind, points, city_id, month_ref)
        VALUES
          (encode(gen_random_bytes(8),'hex'), challenger_id, NEW.challenge_id, 'challenger', 'debrief', COALESCE(pts_debrief_c, 0), origin_city, current_month),
          (encode(gen_random_bytes(8),'hex'), taker_id,      NEW.challenge_id, 'taker',      'debrief', COALESCE(pts_debrief_t, 0), origin_city, current_month)
        ON CONFLICT (user_id, challenge_id, role, kind) DO NOTHING;

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

// ── Mutual-reveal view ──────────────────────────────────────────────────────
// A challenge_ratings row is visible only when the ratee has also rated
// the same challenge. Pure projection — no auth context (this app has
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

echo "\nDone.\n";
