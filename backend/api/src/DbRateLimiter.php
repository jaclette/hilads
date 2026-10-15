<?php

declare(strict_types=1);

/**
 * Fixed-window rate limiter backed by Postgres (rate_limit_buckets).
 *
 * RateLimiter (APCu) fails open on Render because APCu is not installed, so
 * limits that must actually hold use this one: one atomic upsert per call,
 * shared by every instance. Like RateLimiter it fails open on a DB error - a
 * limiter outage must never take the endpoint down with it. Old buckets are
 * purged by POST /internal/cleanup.
 */
final class DbRateLimiter
{
    public static function allow(string $key, int $limit, int $windowSeconds): bool
    {
        if ($limit < 1 || $windowSeconds < 1) {
            return true;
        }
        try {
            $stmt = Database::pdo()->prepare("
                INSERT INTO rate_limit_buckets (bucket_key, window_start, hits)
                VALUES (?, now(), 1)
                ON CONFLICT (bucket_key) DO UPDATE SET
                    hits = CASE
                        WHEN rate_limit_buckets.window_start <= now() - make_interval(secs => ?)
                            THEN 1
                        ELSE rate_limit_buckets.hits + 1
                    END,
                    window_start = CASE
                        WHEN rate_limit_buckets.window_start <= now() - make_interval(secs => ?)
                            THEN now()
                        ELSE rate_limit_buckets.window_start
                    END
                RETURNING hits
            ");
            $stmt->execute([hash('sha256', $key), $windowSeconds, $windowSeconds]);
            return (int) $stmt->fetchColumn() <= $limit;
        } catch (\Throwable $e) {
            error_log('[rate-limit] db limiter failed open: ' . $e->getMessage());
            return true;
        }
    }
}
