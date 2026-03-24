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

        // ── Channel events (1:1 with channels WHERE type='event') ────────────
        $pdo->exec("
            CREATE TABLE IF NOT EXISTS channel_events (
                channel_id   TEXT        PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE,
                source_type  TEXT        NOT NULL,
                external_id  TEXT,
                created_by   TEXT        REFERENCES users(id) ON DELETE SET NULL,
                guest_id     TEXT,
                title        TEXT        NOT NULL,
                event_type   TEXT,
                description  TEXT,
                venue        TEXT,
                location     TEXT,
                venue_lat    DOUBLE PRECISION,
                venue_lng    DOUBLE PRECISION,
                starts_at    TIMESTAMPTZ NOT NULL,
                ends_at      TIMESTAMPTZ,
                expires_at   TIMESTAMPTZ NOT NULL,
                image_url    TEXT,
                external_url TEXT,
                synced_at    TIMESTAMPTZ,
                sync_status  TEXT        DEFAULT 'ok',
                UNIQUE (source_type, external_id)
            )
        ");
        $pdo->exec("CREATE INDEX IF NOT EXISTS idx_channel_events_source  ON channel_events (source_type)");
        $pdo->exec("CREATE INDEX IF NOT EXISTS idx_channel_events_starts  ON channel_events (starts_at)");
        $pdo->exec("CREATE INDEX IF NOT EXISTS idx_channel_events_expires ON channel_events (expires_at)");
        $pdo->exec("CREATE INDEX IF NOT EXISTS idx_channel_events_guest   ON channel_events (guest_id) WHERE guest_id IS NOT NULL");
        $pdo->exec("CREATE INDEX IF NOT EXISTS idx_channel_events_ext_id  ON channel_events (external_id) WHERE external_id IS NOT NULL");

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

        // ── City sync log ─────────────────────────────────────────────────────
        $pdo->exec("
            CREATE TABLE IF NOT EXISTS city_sync_log (
                channel_id   TEXT        PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE,
                synced_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
                event_count  INTEGER     NOT NULL DEFAULT 0,
                status       TEXT        NOT NULL DEFAULT 'ok'
            )
        ");
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
