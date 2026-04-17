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
        $host  = $parts['host'] ?? '';
        $port  = (int) ($parts['port'] ?? 5432);

        // ── Supabase pooler mode detection ────────────────────────────────────
        // Supabase offers two pooler modes on the same host:
        //   port 5432 → Session mode   (one real DB connection per client session)
        //   port 6543 → Transaction mode (connections returned to pool per transaction)
        //
        // Session mode exhausts the pool when Apache has many workers, each holding
        // a persistent connection indefinitely. Always use Transaction mode (6543).
        //
        // ACTION REQUIRED: update DATABASE_URL on your server to use port 6543:
        //   postgresql://postgres.[ref]:[pass]@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres
        if ($port === 5432 && str_contains($host, 'pooler.supabase.com')) {
            error_log('[db] WARNING: DATABASE_URL uses session-mode port 5432 on Supabase pooler. '
                    . 'Switch to port 6543 (transaction mode) to prevent connection exhaustion.');
        }

        // connect_timeout: abort quickly if DB is unreachable rather than hanging requests.
        $dsn = sprintf(
            'pgsql:host=%s;port=%d;dbname=%s;sslmode=require;connect_timeout=5',
            $host,
            $port,
            ltrim($parts['path'] ?? '', '/')
        );

        // parse_url() returns URL-encoded credentials — PDO needs decoded values.
        $user = isset($parts['user']) ? urldecode($parts['user']) : null;
        $pass = isset($parts['pass']) ? urldecode($parts['pass']) : null;

        $t = microtime(true);

        self::$pdo = new PDO($dsn, $user, $pass, [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            // IMPORTANT: Do NOT use PDO::ATTR_PERSISTENT here.
            //
            // With Apache prefork + session-mode pooler, persistent connections cause
            // each Apache worker to hold a dedicated DB connection for its entire
            // lifetime. 20–50 workers = 20–50 open connections at all times, which
            // immediately exhausts Supabase's pool limit ("MaxClientsInSessionMode").
            //
            // In transaction mode (port 6543) persistent connections are safe because
            // pgbouncer returns the real DB connection to its pool after each
            // transaction. But we keep this off to be safe across deployment modes.
            //
            // PDO::ATTR_EMULATE_PREPARES: required for pgbouncer transaction mode.
            // Without it, PDO uses server-side named prepared statements which are
            // session-scoped and incompatible with transaction mode pooling.
            PDO::ATTR_EMULATE_PREPARES   => true,
        ]);

        self::$lastConnMs     = round((microtime(true) - $t) * 1000, 2);
        self::$lastConnWasNew = true;

        if (self::$lastConnMs > 200) {
            error_log(sprintf(
                '[db] slow connection: %.1f ms (host=%s port=%d)',
                self::$lastConnMs,
                $host,
                $port,
            ));
        }

        return self::$pdo;
    }
}
