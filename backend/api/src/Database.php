<?php

declare(strict_types=1);

class Database
{
    private static ?PDO $pdo = null;
    private static bool $bootstrapped = false;

    /**
     * Schema version — bump this integer each time you add a new migration block.
     * Once all blocks have run in production, cold workers do ONE pg_catalog query
     * to confirm the version matches and skip all 27+ information_schema checks.
     */
    private const SCHEMA_VERSION = 2;

    public static function pdo(): PDO
    {
        if (self::$pdo === null) {
            $url = getenv('DATABASE_URL');
            if (!$url) {
                throw new \RuntimeException('DATABASE_URL environment variable is not set');
            }

            $parts = parse_url($url);
            $dsn   = sprintf(
                'pgsql:host=%s;port=%s;dbname=%s;sslmode=require',
                $parts['host'],
                $parts['port'] ?? 5432,
                ltrim($parts['path'], '/')
            );

            // parse_url() returns URL-encoded credentials — PDO needs the decoded values
            $user = isset($parts['user']) ? urldecode($parts['user']) : null;
            $pass = isset($parts['pass']) ? urldecode($parts['pass']) : null;

            self::$pdo = new PDO($dsn, $user, $pass, [
                PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                // Reuse the underlying TCP+SSL connection across requests in the
                // same PHP-FPM worker process. Eliminates the TLS handshake cost
                // (100–400 ms) that was being paid on every new worker spawn.
                // Safe for auto-commit read/write operations (no session state leaks).
                PDO::ATTR_PERSISTENT         => true,
            ]);

            // ── Fast path: schema already up to date ─────────────────────────
            // A single pg_catalog lookup replaces 27+ slow information_schema
            // checks AND the 4–6 bootstrap() pg_catalog checks on every cold
            // PHP-FPM worker start. The schema version is only written AFTER
            // bootstrap() completes (see setSchemaVersion below), so a matching
            // version proves all migrations including bootstrap have already run.
            if (self::getSchemaVersion() >= self::SCHEMA_VERSION) {
                self::$bootstrapped = true; // skip bootstrap() — proven applied
                return self::$pdo;
            }

            // Only run DDL migrations when tables don't exist yet (e.g. fresh deploy).
            // Skipping this on every worker startup avoids catalog lock contention.
            $tablesExist = (bool) self::$pdo
                ->query("SELECT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'channels')")
                ->fetchColumn();

            if (!$tablesExist) {
                self::migrate(self::$pdo);
            }

            // Additive migrations: run when a new table is absent on an existing DB.
            // Each block is idempotent and safe to re-check on every cold start.
            $convExist = (bool) self::$pdo
                ->query("SELECT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'conversations')")
                ->fetchColumn();

            if (!$convExist) {
                self::migrateConversations(self::$pdo);
            }

            // Add last_read_at to conversation_participants if missing (tracks DM unread state).
            $lastReadExists = (bool) self::$pdo
                ->query("SELECT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.conversation_participants'::regclass AND attname = 'last_read_at' AND NOT attisdropped)")
                ->fetchColumn();

            if (!$lastReadExists) {
                self::$pdo->exec("ALTER TABLE conversation_participants ADD COLUMN IF NOT EXISTS last_read_at TIMESTAMPTZ DEFAULT NULL");
            }

            // Add last_read_at to event_participants if missing (tracks event chat unread state).
            $epLastReadExists = (bool) self::$pdo
                ->query("SELECT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.event_participants'::regclass AND attname = 'last_read_at' AND NOT attisdropped)")
                ->fetchColumn();

            if (!$epLastReadExists) {
                self::$pdo->exec("ALTER TABLE event_participants ADD COLUMN IF NOT EXISTS last_read_at TIMESTAMPTZ DEFAULT NULL");
            }

            // Add nickname to event_participants if missing (powers the participant strip).
            $epNicknameExists = (bool) self::$pdo
                ->query("SELECT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.event_participants'::regclass AND attname = 'nickname' AND NOT attisdropped)")
                ->fetchColumn();

            if (!$epNicknameExists) {
                self::$pdo->exec("ALTER TABLE event_participants ADD COLUMN IF NOT EXISTS nickname TEXT NOT NULL DEFAULT ''");
            }

            // DB-backed auth sessions (replaces PHP file sessions lost on container restart).
            $userSessionsExist = (bool) self::$pdo
                ->query("SELECT to_regclass('public.user_sessions') IS NOT NULL")
                ->fetchColumn();

            if (!$userSessionsExist) {
                self::$pdo->exec("
                    CREATE TABLE IF NOT EXISTS user_sessions (
                        id         TEXT        PRIMARY KEY,
                        user_id    TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                        expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 days')
                    )
                ");
                self::$pdo->exec("CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions (user_id)");
            }

            // Recurring event series (adds event_series table + two columns on channel_events).
            $seriesTableExists = (bool) self::$pdo
                ->query("SELECT to_regclass('public.event_series') IS NOT NULL")
                ->fetchColumn();

            if (!$seriesTableExists) {
                self::$pdo->exec("
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
                        source_key      TEXT        UNIQUE,
                        created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
                    )
                ");
                self::$pdo->exec("CREATE INDEX IF NOT EXISTS idx_event_series_city   ON event_series (city_id)");
                self::$pdo->exec("CREATE INDEX IF NOT EXISTS idx_event_series_source ON event_series (source)");
                self::$pdo->exec("ALTER TABLE channel_events ADD COLUMN IF NOT EXISTS series_id TEXT REFERENCES event_series(id) ON DELETE SET NULL");
                self::$pdo->exec("ALTER TABLE channel_events ADD COLUMN IF NOT EXISTS occurrence_date DATE");
                self::$pdo->exec("CREATE INDEX IF NOT EXISTS idx_channel_events_series ON channel_events (series_id) WHERE series_id IS NOT NULL");
            } else {
                // Additive: add source + source_key columns if missing (deployed before this migration)
                $hasSourceKey = (bool) self::$pdo
                    ->query("SELECT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.event_series'::regclass AND attname = 'source_key' AND NOT attisdropped)")
                    ->fetchColumn();
                if (!$hasSourceKey) {
                    self::$pdo->exec("ALTER TABLE event_series ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'user'");
                    self::$pdo->exec("ALTER TABLE event_series ADD COLUMN IF NOT EXISTS source_key TEXT");
                    // Full unique index (not partial) — required for ON CONFLICT (source_key) to work.
                    // PostgreSQL allows multiple NULLs in a full unique index on a nullable column.
                    self::$pdo->exec("CREATE UNIQUE INDEX IF NOT EXISTS event_series_source_key_unique ON event_series (source_key)");
                    self::$pdo->exec("CREATE INDEX IF NOT EXISTS idx_event_series_source ON event_series (source)");
                    // created_by was NOT NULL in the first iteration — relax it for import rows
                    self::$pdo->exec("ALTER TABLE event_series ALTER COLUMN created_by DROP NOT NULL");
                }
            }

            // Fix: partial unique index on source_key does not satisfy ON CONFLICT (source_key).
            // PostgreSQL only matches non-partial unique constraints/indexes for conflict targets.
            // Drop and recreate as a full unique index. Idempotent: the WHERE % check ensures
            // this runs exactly once — after replacement the new index has no WHERE clause.
            $hasPartialSourceKeyIdx = (bool) self::$pdo
                ->query("SELECT EXISTS (
                    SELECT 1 FROM pg_indexes
                    WHERE schemaname = 'public'
                      AND tablename  = 'event_series'
                      AND indexname  = 'event_series_source_key_unique'
                      AND indexdef   LIKE '% WHERE %'
                )")
                ->fetchColumn();

            if ($hasPartialSourceKeyIdx) {
                self::$pdo->exec("DROP INDEX IF EXISTS event_series_source_key_unique");
                self::$pdo->exec("CREATE UNIQUE INDEX event_series_source_key_unique ON event_series (source_key)");
            }

            // Add created_by to channel_events if missing (event ownership feature).
            $ceCreatedByExists = (bool) self::$pdo
                ->query("SELECT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.channel_events'::regclass AND attname = 'created_by' AND NOT attisdropped)")
                ->fetchColumn();

            if (!$ceCreatedByExists) {
                self::$pdo->exec("ALTER TABLE channel_events ADD COLUMN IF NOT EXISTS created_by TEXT REFERENCES users(id) ON DELETE SET NULL");
                self::$pdo->exec("CREATE INDEX IF NOT EXISTS idx_channel_events_created_by ON channel_events (created_by) WHERE created_by IS NOT NULL");
            }

            // Add user_id to event_participants if missing (event ownership feature).
            // The original table only had (channel_id, guest_id, joined_at).
            // user_id was added to link registered users to their participation rows.
            $epUserIdExists = (bool) self::$pdo
                ->query("SELECT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.event_participants'::regclass AND attname = 'user_id' AND NOT attisdropped)")
                ->fetchColumn();

            if (!$epUserIdExists) {
                self::$pdo->exec("ALTER TABLE event_participants ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES users(id) ON DELETE SET NULL");
                self::$pdo->exec("CREATE INDEX IF NOT EXISTS idx_event_participants_user ON event_participants (user_id) WHERE user_id IS NOT NULL");
            }

            // Add event_join_push to notification_preferences if missing.
            // This column was added to NotificationPreferencesRepository but the original
            // bootstrap() CREATE TABLE only had 3 columns — causing SQL crashes in production.
            $ejpExists = (bool) self::$pdo
                ->query("SELECT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.notification_preferences'::regclass AND attname = 'event_join_push' AND NOT attisdropped)")
                ->fetchColumn();

            if (!$ejpExists) {
                self::$pdo->exec("ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS event_join_push BOOLEAN NOT NULL DEFAULT FALSE");
            }

            // Add channel_message_push + city_join_push to notification_preferences if missing.
            $cmpExists = (bool) self::$pdo
                ->query("SELECT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.notification_preferences'::regclass AND attname = 'channel_message_push' AND NOT attisdropped)")
                ->fetchColumn();
            if (!$cmpExists) {
                self::$pdo->exec("ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS channel_message_push BOOLEAN NOT NULL DEFAULT FALSE");
            }

            $cjpExists = (bool) self::$pdo
                ->query("SELECT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.notification_preferences'::regclass AND attname = 'city_join_push' AND NOT attisdropped)")
                ->fetchColumn();
            if (!$cjpExists) {
                self::$pdo->exec("ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS city_join_push BOOLEAN NOT NULL DEFAULT FALSE");
            }

            // Add friend_added_push to notification_preferences if missing.
            $fapExists = (bool) self::$pdo
                ->query("SELECT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.notification_preferences'::regclass AND attname = 'friend_added_push' AND NOT attisdropped)")
                ->fetchColumn();
            if (!$fapExists) {
                self::$pdo->exec("ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS friend_added_push BOOLEAN NOT NULL DEFAULT TRUE");
            }

            // Add vibe_received_push to notification_preferences if missing.
            $vrpExists = (bool) self::$pdo
                ->query("SELECT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.notification_preferences'::regclass AND attname = 'vibe_received_push' AND NOT attisdropped)")
                ->fetchColumn();
            if (!$vrpExists) {
                self::$pdo->exec("ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS vibe_received_push BOOLEAN NOT NULL DEFAULT TRUE");
            }

            // Mobile push token registry (one row per device, Expo push tokens).
            $mptExists = (bool) self::$pdo
                ->query("SELECT to_regclass('public.mobile_push_tokens') IS NOT NULL")
                ->fetchColumn();

            if (!$mptExists) {
                self::$pdo->exec("
                    CREATE TABLE IF NOT EXISTS mobile_push_tokens (
                        id           BIGSERIAL   PRIMARY KEY,
                        user_id      TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                        token        TEXT        NOT NULL UNIQUE,
                        platform     TEXT        NOT NULL DEFAULT 'unknown',
                        created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
                        last_used_at TIMESTAMPTZ NOT NULL DEFAULT now()
                    )
                ");
                self::$pdo->exec("CREATE INDEX IF NOT EXISTS idx_mobile_push_tokens_user ON mobile_push_tokens (user_id)");
            } else {
                // Add last_used_at if missing — the ON CONFLICT UPDATE in /push/mobile-token sets it.
                // Without this column the upsert fails silently and no token is ever stored.
                $mptLuaExists = (bool) self::$pdo
                    ->query("SELECT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.mobile_push_tokens'::regclass AND attname = 'last_used_at' AND NOT attisdropped)")
                    ->fetchColumn();
                if (!$mptLuaExists) {
                    self::$pdo->exec("ALTER TABLE mobile_push_tokens ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ NOT NULL DEFAULT now()");
                }
            }

            // Add type + image_url to conversation_messages if missing (DM image upload feature).
            $cmTypeExists = (bool) self::$pdo
                ->query("SELECT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.conversation_messages'::regclass AND attname = 'type' AND NOT attisdropped)")
                ->fetchColumn();
            if (!$cmTypeExists) {
                self::$pdo->exec("ALTER TABLE conversation_messages ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'text'");
                self::$pdo->exec("ALTER TABLE conversation_messages ADD COLUMN IF NOT EXISTS image_url TEXT");
            }

            // User city roles (ambassador programme).
            $ucrExists = (bool) self::$pdo
                ->query("SELECT to_regclass('public.user_city_roles') IS NOT NULL")
                ->fetchColumn();

            if (!$ucrExists) {
                self::$pdo->exec("
                    CREATE TABLE IF NOT EXISTS user_city_roles (
                        id         TEXT        PRIMARY KEY,
                        user_id    TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                        city_id    TEXT        NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
                        role       TEXT        NOT NULL DEFAULT 'ambassador',
                        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                        UNIQUE (user_id, city_id, role)
                    )
                ");
                self::$pdo->exec("CREATE INDEX IF NOT EXISTS idx_user_city_roles_user ON user_city_roles (user_id)");
                self::$pdo->exec("CREATE INDEX IF NOT EXISTS idx_user_city_roles_city ON user_city_roles (city_id)");
            }

            // User friends — mutual (bilateral) friendship.
            // Both (A→B) and (B→A) rows are always kept in sync by the API.
            $ufExists = (bool) self::$pdo
                ->query("SELECT to_regclass('public.user_friends') IS NOT NULL")
                ->fetchColumn();

            if (!$ufExists) {
                self::$pdo->exec("
                    CREATE TABLE IF NOT EXISTS user_friends (
                        user_id    TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                        friend_id  TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                        PRIMARY KEY (user_id, friend_id)
                    )
                ");
                self::$pdo->exec("CREATE INDEX IF NOT EXISTS idx_user_friends_user   ON user_friends (user_id,   created_at DESC)");
                self::$pdo->exec("CREATE INDEX IF NOT EXISTS idx_user_friends_friend ON user_friends (friend_id, created_at DESC)");
            } else {
                // Backfill reverse rows for any existing one-way friendships so the table
                // is consistent with the new bilateral model. Idempotent — safe to run repeatedly.
                self::$pdo->exec("
                    INSERT INTO user_friends (user_id, friend_id, created_at)
                    SELECT orig.friend_id, orig.user_id, orig.created_at
                    FROM   user_friends orig
                    WHERE  NOT EXISTS (
                        SELECT 1 FROM user_friends rev
                        WHERE  rev.user_id   = orig.friend_id
                          AND  rev.friend_id = orig.user_id
                    )
                    ON CONFLICT DO NOTHING
                ");
            }

            // City memberships (source of truth for City Crew / Here screen).
            // Added after initial deploy — must run as an additive migration on existing DBs.
            $ucmExists = (bool) self::$pdo
                ->query("SELECT to_regclass('public.user_city_memberships') IS NOT NULL")
                ->fetchColumn();

            if (!$ucmExists) {
                self::$pdo->exec("
                    CREATE TABLE IF NOT EXISTS user_city_memberships (
                        user_id       TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                        channel_id    TEXT        NOT NULL,
                        first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                        last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
                        PRIMARY KEY (user_id, channel_id)
                    )
                ");
                self::$pdo->exec("CREATE INDEX IF NOT EXISTS idx_city_memberships_channel ON user_city_memberships (channel_id, last_seen_at DESC)");
                self::$pdo->exec("CREATE INDEX IF NOT EXISTS idx_city_memberships_user    ON user_city_memberships (user_id)");
            }

            // Anti-noise push delivery log (cooldown tracking per user/type/ref).
            $pdlExists = (bool) self::$pdo
                ->query("SELECT to_regclass('public.push_delivery_log') IS NOT NULL")
                ->fetchColumn();

            if (!$pdlExists) {
                self::$pdo->exec("
                    CREATE TABLE IF NOT EXISTS push_delivery_log (
                        id      BIGSERIAL   PRIMARY KEY,
                        user_id TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                        type    TEXT        NOT NULL,
                        ref_id  TEXT        NOT NULL DEFAULT '',
                        sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
                    )
                ");
                self::$pdo->exec("CREATE INDEX IF NOT EXISTS idx_push_delivery_log_lookup ON push_delivery_log (user_id, type, ref_id, sent_at DESC)");
            }

            // User vibes — social rating system (1–5 stars + optional message).
            // Added after initial deploy — additive migration.
            $uvExists = (bool) self::$pdo
                ->query("SELECT to_regclass('public.user_vibes') IS NOT NULL")
                ->fetchColumn();

            if (!$uvExists) {
                self::$pdo->exec("
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
                ");
                self::$pdo->exec("CREATE INDEX IF NOT EXISTS idx_user_vibes_target ON user_vibes (target_id, created_at DESC)");
                self::$pdo->exec("CREATE INDEX IF NOT EXISTS idx_user_vibes_author ON user_vibes (author_id)");
            }
        }

        // ── Performance indexes (idempotent — safe to re-run on every cold start) ──
        // These are CREATE IF NOT EXISTS so they are no-ops once created.

        // Missing index: channel_events.channel_id is the JOIN key in every EventRepository
        // query but had no index. Without it Postgres does a full seq scan of channel_events
        // for every event fetch (getByChannel, getPublicByChannel, etc.), adding 50-200ms per call.
        self::$pdo->exec("CREATE INDEX IF NOT EXISTS idx_channel_events_channel ON channel_events (channel_id)");

        self::$pdo->exec("CREATE INDEX IF NOT EXISTS idx_messages_channel_created ON messages (channel_id, created_at DESC)");
        self::$pdo->exec("CREATE INDEX IF NOT EXISTS idx_conv_messages_conv_created ON conversation_messages (conversation_id, created_at DESC)");

        // Covering index for city-crew DISTINCT guest_id scan (GET /channels/{id}/members).
        // The msg_senders subquery does: SELECT DISTINCT guest_id FROM messages
        //   WHERE channel_id = ? AND type = 'text' AND guest_id IS NOT NULL
        // Without this index Postgres scans all messages for the channel to filter type+guest_id.
        self::$pdo->exec("CREATE INDEX IF NOT EXISTS idx_messages_crew_lookup ON messages (channel_id, type, guest_id) WHERE type = 'text' AND guest_id IS NOT NULL");

        // Better index for PresenceRepository::getOnline().
        // The query is DISTINCT ON (guest_id) ORDER BY guest_id, last_seen_at DESC.
        // (channel_id, guest_id, last_seen_at DESC) lets Postgres resolve DISTINCT via
        // index-only scan ordered by guest_id, avoiding a separate sort step.
        self::$pdo->exec("CREATE INDEX IF NOT EXISTS idx_presence_online ON presence (channel_id, guest_id, last_seen_at DESC)");

        // Covers the batch unread check in ConversationRepository::listDmsForUser():
        // WHERE conversation_id IN (...) AND sender_id != ? — filters by both columns.
        self::$pdo->exec("CREATE INDEX IF NOT EXISTS idx_conv_messages_unread ON conversation_messages (conversation_id, sender_id, created_at DESC)");

        // Covers listEventChannelsForUser() batch unread check:
        // WHERE channel_id IN (...) AND type IN ('text', 'image')
        self::$pdo->exec("CREATE INDEX IF NOT EXISTS idx_messages_channel_type_time ON messages (channel_id, type, created_at DESC) WHERE type IN ('text', 'image')");

        // Covers members/here page city filter — LOWER(TRIM(home_city)) = LOWER(TRIM(?))
        self::$pdo->exec("CREATE INDEX IF NOT EXISTS idx_users_home_city_lower ON users (LOWER(TRIM(home_city)))");

        self::bootstrap(self::$pdo);

        // Stamp the schema version so future cold starts skip all the checks above.
        self::setSchemaVersion(self::SCHEMA_VERSION);

        return self::$pdo;
    }

    // ── Schema version helpers ────────────────────────────────────────────────
    // One fast pg_catalog row replaces 27+ slow information_schema queries.

    private static function getSchemaVersion(): int
    {
        // Single query — if the table doesn't exist Postgres throws an exception
        // which we catch and treat as version 0. Saves 1 DB round-trip vs. the
        // previous two-step approach (to_regclass check + SELECT).
        try {
            $v = self::$pdo
                ->query("SELECT value FROM _hilads_schema_ver WHERE key = 'version' LIMIT 1")
                ->fetchColumn();
            return $v !== false ? (int) $v : 0;
        } catch (\Throwable) {
            return 0; // table does not exist yet — fresh deploy
        }
    }

    private static function setSchemaVersion(int $version): void
    {
        self::$pdo->exec("CREATE TABLE IF NOT EXISTS _hilads_schema_ver (key TEXT PRIMARY KEY, value TEXT)");
        self::$pdo->prepare(
            "INSERT INTO _hilads_schema_ver (key, value) VALUES ('version', ?)
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value"
        )->execute([$version]);
    }

    private static function bootstrap(PDO $pdo): void
    {
        if (self::$bootstrapped) {
            return;
        }

        // ── Notifications (Phase 1) ───────────────────────────────────────────
        $notifExist = (bool) $pdo
            ->query("SELECT to_regclass('public.notifications') IS NOT NULL")
            ->fetchColumn();

        if (!$notifExist) {
            $pdo->exec("
                CREATE TABLE notifications (
                    id         BIGSERIAL    PRIMARY KEY,
                    user_id    TEXT         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    type       VARCHAR(50)  NOT NULL,
                    title      TEXT         NOT NULL,
                    body       TEXT,
                    data       JSONB        NOT NULL DEFAULT '{}',
                    is_read    BOOLEAN      NOT NULL DEFAULT FALSE,
                    created_at TIMESTAMPTZ  NOT NULL DEFAULT now()
                )
            ");
            $pdo->exec("CREATE INDEX idx_notifications_user_feed   ON notifications (user_id, created_at DESC)");
            $pdo->exec("CREATE INDEX idx_notifications_user_unread ON notifications (user_id) WHERE is_read = FALSE");

            $pdo->exec("
                CREATE TABLE notification_preferences (
                    user_id                TEXT    PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                    dm_push                BOOLEAN NOT NULL DEFAULT TRUE,
                    event_message_push     BOOLEAN NOT NULL DEFAULT TRUE,
                    event_join_push        BOOLEAN NOT NULL DEFAULT FALSE,
                    new_event_push         BOOLEAN NOT NULL DEFAULT FALSE,
                    channel_message_push   BOOLEAN NOT NULL DEFAULT FALSE,
                    city_join_push         BOOLEAN NOT NULL DEFAULT FALSE
                )
            ");

            // push_subscriptions is Phase 2 — created now so Phase 2 needs no migration.
            $pdo->exec("
                CREATE TABLE push_subscriptions (
                    id           BIGSERIAL    PRIMARY KEY,
                    user_id      TEXT         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    endpoint     TEXT         NOT NULL UNIQUE,
                    p256dh       TEXT         NOT NULL,
                    auth_key     TEXT         NOT NULL,
                    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
                    last_used_at TIMESTAMPTZ  NOT NULL DEFAULT now()
                )
            ");
            $pdo->exec("CREATE INDEX idx_push_subscriptions_user ON push_subscriptions (user_id)");
        }

        // ── Password reset tokens ─────────────────────────────────────────────
        $resetExist = (bool) $pdo
            ->query("SELECT to_regclass('public.password_reset_tokens') IS NOT NULL")
            ->fetchColumn();

        if (!$resetExist) {
            $pdo->exec("
                CREATE TABLE password_reset_tokens (
                    id         BIGSERIAL    PRIMARY KEY,
                    user_id    TEXT         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    token_hash TEXT         NOT NULL UNIQUE,
                    expires_at TIMESTAMPTZ  NOT NULL DEFAULT (now() + INTERVAL '1 hour'),
                    used_at    TIMESTAMPTZ,
                    created_at TIMESTAMPTZ  NOT NULL DEFAULT now()
                )
            ");
            $pdo->exec("CREATE INDEX idx_prt_user ON password_reset_tokens (user_id)");
            $pdo->exec("CREATE INDEX idx_prt_hash ON password_reset_tokens (token_hash) WHERE used_at IS NULL");
        }

        // ── User admin columns (deleted_at, is_fake) ─────────────────────────
        // These are additive — must run on existing databases too, not just fresh ones.
        $deletedAtExists = (bool) self::$pdo
            ->query("SELECT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.users'::regclass AND attname = 'deleted_at' AND NOT attisdropped)")
            ->fetchColumn();

        if (!$deletedAtExists) {
            self::$pdo->exec("ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL");
            self::$pdo->exec("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_fake BOOLEAN NOT NULL DEFAULT false");
        }

        // ── Topics (city subchannels) ─────────────────────────────────────────
        $topicsExist = (bool) $pdo
            ->query("SELECT to_regclass('public.channel_topics') IS NOT NULL")
            ->fetchColumn();

        if (!$topicsExist) {
            $pdo->exec("
                CREATE TABLE channel_topics (
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
            ");
            $pdo->exec("CREATE INDEX IF NOT EXISTS idx_channel_topics_city   ON channel_topics (city_id, expires_at DESC)");
            $pdo->exec("CREATE INDEX IF NOT EXISTS idx_channel_topics_expiry ON channel_topics (expires_at)");
        }

        self::$bootstrapped = true;
    }

    private static function migrate(PDO $pdo): void
    {
        // ── Users (existing) ─────────────────────────────────────────────────
        $pdo->exec("
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
                created_at        INTEGER NOT NULL,
                updated_at        INTEGER NOT NULL
            )
        ");
        $pdo->exec("CREATE INDEX IF NOT EXISTS idx_users_email    ON users (lower(email))");
        $pdo->exec("CREATE INDEX IF NOT EXISTS idx_users_guest_id ON users (guest_id) WHERE guest_id IS NOT NULL");
        // Add vibe to existing users tables (migration — safe no-op if column already exists).
        $pdo->exec("ALTER TABLE users ADD COLUMN IF NOT EXISTS vibe TEXT NOT NULL DEFAULT 'chill'");
        // Email verification flag — false until the user clicks the verification link.
        $pdo->exec("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT false");
        // Soft-delete support — null = active, set = deleted.
        $pdo->exec("ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL");
        // Admin-only fake user flag — never exposed in public API responses.
        $pdo->exec("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_fake BOOLEAN NOT NULL DEFAULT false");

        // ── Channels (cities + events + future subchannel types) ─────────────
        $pdo->exec("
            CREATE TABLE IF NOT EXISTS channels (
                id          TEXT        PRIMARY KEY,
                type        TEXT        NOT NULL,
                parent_id   TEXT        REFERENCES channels(id) ON DELETE CASCADE,
                name        TEXT        NOT NULL,
                status      TEXT        NOT NULL DEFAULT 'active',
                created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        ");
        $pdo->exec("CREATE INDEX IF NOT EXISTS idx_channels_parent ON channels (parent_id) WHERE parent_id IS NOT NULL");
        $pdo->exec("CREATE INDEX IF NOT EXISTS idx_channels_type   ON channels (type)");
        $pdo->exec("CREATE INDEX IF NOT EXISTS idx_channels_status ON channels (status)");
        // Partial index: fast lookup of active events by city (used by event counts + listings)
        $pdo->exec("CREATE INDEX IF NOT EXISTS idx_channels_active_events ON channels (parent_id) WHERE type = 'event' AND status = 'active'");

        // ── Cities (1:1 with channels WHERE type='city') ─────────────────────
        $pdo->exec("
            CREATE TABLE IF NOT EXISTS cities (
                channel_id  TEXT             PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE,
                country     TEXT             NOT NULL,
                lat         DOUBLE PRECISION NOT NULL,
                lng         DOUBLE PRECISION NOT NULL,
                timezone    TEXT             NOT NULL
            )
        ");
        $pdo->exec("CREATE INDEX IF NOT EXISTS idx_cities_geo ON cities (lat, lng)");

        // ── Recurring event series ────────────────────────────────────────────
        $pdo->exec("
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
                source_key      TEXT        UNIQUE,
                created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        ");
        $pdo->exec("CREATE INDEX IF NOT EXISTS idx_event_series_city   ON event_series (city_id)");
        $pdo->exec("CREATE INDEX IF NOT EXISTS idx_event_series_source ON event_series (source)");

        // ── Channel events (1:1 with channels WHERE type='event') ────────────
        $pdo->exec("
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
        ");
        $pdo->exec("CREATE INDEX IF NOT EXISTS idx_channel_events_source  ON channel_events (source_type)");
        $pdo->exec("CREATE INDEX IF NOT EXISTS idx_channel_events_starts  ON channel_events (starts_at)");
        $pdo->exec("CREATE INDEX IF NOT EXISTS idx_channel_events_expires ON channel_events (expires_at)");
        $pdo->exec("CREATE INDEX IF NOT EXISTS idx_channel_events_guest   ON channel_events (guest_id) WHERE guest_id IS NOT NULL");
        $pdo->exec("CREATE INDEX IF NOT EXISTS idx_channel_events_ext_id  ON channel_events (external_id) WHERE external_id IS NOT NULL");
        $pdo->exec("CREATE INDEX IF NOT EXISTS idx_channel_events_series  ON channel_events (series_id) WHERE series_id IS NOT NULL");

        // ── Messages ─────────────────────────────────────────────────────────
        $pdo->exec("
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
        ");
        $pdo->exec("CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages (channel_id, created_at DESC)");
        $pdo->exec("CREATE INDEX IF NOT EXISTS idx_messages_guest   ON messages (guest_id) WHERE guest_id IS NOT NULL");

        // ── Presence ─────────────────────────────────────────────────────────
        $pdo->exec("
            CREATE TABLE IF NOT EXISTS presence (
                session_id   TEXT        NOT NULL,
                channel_id   TEXT        NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
                guest_id     TEXT        NOT NULL,
                user_id      TEXT        REFERENCES users(id) ON DELETE CASCADE,
                nickname     TEXT        NOT NULL,
                last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                PRIMARY KEY (session_id, channel_id)
            )
        ");
        $pdo->exec("CREATE INDEX IF NOT EXISTS idx_presence_channel ON presence (channel_id, last_seen_at DESC)");
        $pdo->exec("CREATE INDEX IF NOT EXISTS idx_presence_guest   ON presence (guest_id)");
        // Covering index: avoids heap fetches for COUNT(DISTINCT guest_id) per channel
        $pdo->exec("CREATE INDEX IF NOT EXISTS idx_presence_count   ON presence (channel_id, last_seen_at DESC, guest_id)");

        // ── City memberships — persistent record of registered users per city ──
        // Upserted on every channel join; survives session end / page close.
        // Source of truth for the "City Crew" feature in the Here screen.
        $pdo->exec("
            CREATE TABLE IF NOT EXISTS user_city_memberships (
                user_id       TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                channel_id    TEXT        NOT NULL,
                first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
                PRIMARY KEY (user_id, channel_id)
            )
        ");
        $pdo->exec("CREATE INDEX IF NOT EXISTS idx_city_memberships_channel ON user_city_memberships (channel_id, last_seen_at DESC)");
        $pdo->exec("CREATE INDEX IF NOT EXISTS idx_city_memberships_user    ON user_city_memberships (user_id)");

        // ── Event participants ────────────────────────────────────────────────
        $pdo->exec("
            CREATE TABLE IF NOT EXISTS event_participants (
                channel_id  TEXT        NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
                guest_id    TEXT        NOT NULL,
                user_id     TEXT        REFERENCES users(id) ON DELETE SET NULL,
                joined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
                PRIMARY KEY (channel_id, guest_id)
            )
        ");
        $pdo->exec("CREATE INDEX IF NOT EXISTS idx_event_participants_channel ON event_participants (channel_id)");
        $pdo->exec("CREATE INDEX IF NOT EXISTS idx_event_participants_user    ON event_participants (user_id) WHERE user_id IS NOT NULL");

        // ── Direct conversations ──────────────────────────────────────────────
        $pdo->exec("
            CREATE TABLE IF NOT EXISTS conversations (
                id         TEXT        PRIMARY KEY,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        ");
        $pdo->exec("
            CREATE TABLE IF NOT EXISTS conversation_participants (
                conversation_id TEXT        NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
                user_id         TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                last_read_at    TIMESTAMPTZ DEFAULT NULL,
                PRIMARY KEY (conversation_id, user_id)
            )
        ");
        $pdo->exec("CREATE INDEX IF NOT EXISTS idx_conv_participants_user ON conversation_participants (user_id)");
        $pdo->exec("
            CREATE TABLE IF NOT EXISTS conversation_messages (
                id              TEXT        PRIMARY KEY,
                conversation_id TEXT        NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
                sender_id       TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                content         TEXT        NOT NULL,
                created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        ");
        $pdo->exec("CREATE INDEX IF NOT EXISTS idx_conv_messages_conv ON conversation_messages (conversation_id, created_at ASC)");

        // ── City sync log ─────────────────────────────────────────────────────
        $pdo->exec("
            CREATE TABLE IF NOT EXISTS city_sync_log (
                channel_id   TEXT        PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE,
                synced_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
                event_count  INTEGER     NOT NULL DEFAULT 0,
                status       TEXT        NOT NULL DEFAULT 'ok'
            )
        ");

        // ── Auth sessions (DB-backed — survives container restarts) ───────────
        $pdo->exec("
            CREATE TABLE IF NOT EXISTS user_sessions (
                id         TEXT        PRIMARY KEY,
                user_id    TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 days')
            )
        ");
        $pdo->exec("CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions (user_id)");
    }

    /**
     * Additive migration for the conversations feature.
     * Called when the conversations table is absent (existing DB that predates this feature).
     * All statements are CREATE IF NOT EXISTS — safe to run more than once.
     */
    private static function migrateConversations(PDO $pdo): void
    {
        $pdo->exec("
            CREATE TABLE IF NOT EXISTS conversations (
                id         TEXT        PRIMARY KEY,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        ");
        $pdo->exec("
            CREATE TABLE IF NOT EXISTS conversation_participants (
                conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
                user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                PRIMARY KEY (conversation_id, user_id)
            )
        ");
        $pdo->exec("CREATE INDEX IF NOT EXISTS idx_conv_participants_user ON conversation_participants (user_id)");
        $pdo->exec("
            CREATE TABLE IF NOT EXISTS conversation_messages (
                id              TEXT        PRIMARY KEY,
                conversation_id TEXT        NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
                sender_id       TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                content         TEXT        NOT NULL,
                created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        ");
        $pdo->exec("CREATE INDEX IF NOT EXISTS idx_conv_messages_conv ON conversation_messages (conversation_id, created_at ASC)");
    }
}
