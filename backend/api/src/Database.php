<?php

declare(strict_types=1);

class Database
{
    private static ?PDO $pdo = null;

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
            ]);

            // Only run DDL migrations when tables don't exist yet (e.g. fresh deploy).
            // Skipping this on every worker startup avoids catalog lock contention.
            $tablesExist = (bool) self::$pdo
                ->query("SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'channels')")
                ->fetchColumn();

            if (!$tablesExist) {
                self::migrate(self::$pdo);
            }

            // Additive migrations: run when a new table is absent on an existing DB.
            // Each block is idempotent and safe to re-check on every cold start.
            $convExist = (bool) self::$pdo
                ->query("SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'conversations')")
                ->fetchColumn();

            if (!$convExist) {
                self::migrateConversations(self::$pdo);
            }

            // Add last_read_at to conversation_participants if missing (tracks DM unread state).
            $lastReadExists = (bool) self::$pdo
                ->query("SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'conversation_participants' AND column_name = 'last_read_at')")
                ->fetchColumn();

            if (!$lastReadExists) {
                self::$pdo->exec("ALTER TABLE conversation_participants ADD COLUMN IF NOT EXISTS last_read_at TIMESTAMPTZ DEFAULT NULL");
            }

            // Add last_read_at to event_participants if missing (tracks event chat unread state).
            $epLastReadExists = (bool) self::$pdo
                ->query("SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'event_participants' AND column_name = 'last_read_at')")
                ->fetchColumn();

            if (!$epLastReadExists) {
                self::$pdo->exec("ALTER TABLE event_participants ADD COLUMN IF NOT EXISTS last_read_at TIMESTAMPTZ DEFAULT NULL");
            }

            // DB-backed auth sessions (replaces PHP file sessions lost on container restart).
            $userSessionsExist = (bool) self::$pdo
                ->query("SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'user_sessions')")
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
                ->query("SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'event_series')")
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
                    ->query("SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'event_series' AND column_name = 'source_key')")
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
        }

        // ── Notifications (Phase 1) ───────────────────────────────────────────
        $notifExist = (bool) self::$pdo
            ->query("SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'notifications')")
            ->fetchColumn();

        if (!$notifExist) {
            self::$pdo->exec("
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
            self::$pdo->exec("CREATE INDEX idx_notifications_user_feed   ON notifications (user_id, created_at DESC)");
            self::$pdo->exec("CREATE INDEX idx_notifications_user_unread ON notifications (user_id) WHERE is_read = FALSE");

            self::$pdo->exec("
                CREATE TABLE notification_preferences (
                    user_id              TEXT    PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                    dm_push              BOOLEAN NOT NULL DEFAULT TRUE,
                    event_message_push   BOOLEAN NOT NULL DEFAULT TRUE,
                    new_event_push       BOOLEAN NOT NULL DEFAULT FALSE
                )
            ");

            // push_subscriptions is Phase 2 — created now so Phase 2 needs no migration.
            self::$pdo->exec("
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
            self::$pdo->exec("CREATE INDEX idx_push_subscriptions_user ON push_subscriptions (user_id)");
        }

        return self::$pdo;
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
                guest_id          TEXT,
                created_at        INTEGER NOT NULL,
                updated_at        INTEGER NOT NULL
            )
        ");
        $pdo->exec("CREATE INDEX IF NOT EXISTS idx_users_email    ON users (lower(email))");
        $pdo->exec("CREATE INDEX IF NOT EXISTS idx_users_guest_id ON users (guest_id) WHERE guest_id IS NOT NULL");

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
