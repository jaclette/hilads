<?php

declare(strict_types=1);

class Database
{
    private static ?PDO $pdo = null;

    public static function pdo(): PDO
    {
        if (self::$pdo !== null) {
            return self::$pdo;
        }

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
            // Reuse the underlying TCP+SSL connection across requests in the same
            // PHP-FPM worker process. Eliminates the TLS handshake cost (100–400ms)
            // on new worker spawns. Safe for auto-commit read/write operations.
            PDO::ATTR_PERSISTENT         => true,
        ]);

        return self::$pdo;
    }
}
