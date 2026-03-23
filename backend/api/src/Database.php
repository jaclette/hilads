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

            self::migrate(self::$pdo);
        }

        return self::$pdo;
    }

    private static function migrate(PDO $pdo): void
    {
        error_log('[hilads:db] migrate() start');
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
        error_log('[hilads:db] migrate() done — users table ensured');
    }
}
