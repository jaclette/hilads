<?php

declare(strict_types=1);

class Database
{
    private static ?PDO $pdo = null;

    public static function pdo(): PDO
    {
        if (self::$pdo === null) {
            $path     = Storage::path('users.db');
            self::$pdo = new PDO('sqlite:' . $path);
            self::$pdo->setAttribute(PDO::ATTR_ERRMODE,            PDO::ERRMODE_EXCEPTION);
            self::$pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
            self::$pdo->exec('PRAGMA journal_mode=WAL');  // better concurrent read performance
            self::migrate(self::$pdo);
        }

        return self::$pdo;
    }

    private static function migrate(PDO $pdo): void
    {
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
    }
}
