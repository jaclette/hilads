<?php

declare(strict_types=1);

class Database
{
    private static ?PDO $pdo = null;

    /**
     * Time (ms) spent inside `new PDO(...)` on the current request.
     *
     * <5 ms  → persistent connection was reused (TCP socket already open).
     * >100 ms → a new TCP+TLS handshake was required (cold worker or stale conn).
     *
     * Reset to 0.0 at the start of every pdo() call; only meaningful after the
     * first pdo() call in a request (subsequent within-request calls return early
     * and leave this value unchanged from the first call).
     */
    private static float $lastConnMs = 0.0;

    /** Whether the last pdo() call triggered a new PDO construction (always true
     *  in PHP-FPM because static properties reset per-request, but the underlying
     *  TCP may still be persistent). */
    private static bool $lastConnWasNew = false;

    public static function lastConnMs(): float
    {
        return self::$lastConnMs;
    }

    public static function lastConnWasNew(): bool
    {
        return self::$lastConnWasNew;
    }

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

        $t = microtime(true);

        self::$pdo = new PDO($dsn, $user, $pass, [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            // Reuse the underlying TCP+SSL connection across requests in the same
            // PHP-FPM worker process. Eliminates the TLS handshake cost (100–400ms)
            // on new worker spawns. Safe for auto-commit read/write operations.
            PDO::ATTR_PERSISTENT         => true,
        ]);

        self::$lastConnMs    = round((microtime(true) - $t) * 1000, 2);
        self::$lastConnWasNew = true;

        // Log slow connection establishment so Render logs reveal cold-start patterns.
        // A reused persistent connection completes new PDO() in <5ms.
        // A new TCP+TLS handshake to Supabase ap-northeast-1 takes 200–600ms.
        if (self::$lastConnMs > 50) {
            error_log(sprintf(
                '[db] new TCP connection established in %.1f ms (host=%s)',
                self::$lastConnMs,
                $parts['host'] ?? 'unknown'
            ));
        }

        return self::$pdo;
    }
}
