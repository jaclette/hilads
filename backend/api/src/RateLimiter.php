<?php

declare(strict_types=1);

final class RateLimiter
{
    private static function useApcu(): bool
    {
        return function_exists('apcu_fetch')
            && filter_var(ini_get('apc.enabled'), FILTER_VALIDATE_BOOL)
            && PHP_SAPI !== 'cli';
    }

    public static function allow(string $key, int $limit, int $windowSeconds): bool
    {
        if ($limit < 1 || $windowSeconds < 1) {
            return true;
        }

        if (self::useApcu()) {
            $bucketKey = 'hilads_rl_' . hash('sha256', $key);
            $now       = time();
            $entry     = apcu_fetch($bucketKey);

            if (!is_array($entry) || ($entry['expires_at'] ?? 0) < $now) {
                return apcu_store($bucketKey, ['count' => 1, 'expires_at' => $now + $windowSeconds], $windowSeconds);
            }

            if (($entry['count'] ?? 0) >= $limit) {
                return false;
            }

            $entry['count'] = (int) $entry['count'] + 1;
            return apcu_store($bucketKey, $entry, max(1, (int) $entry['expires_at'] - $now));
        }

        // APCu is unavailable — fail open rather than use flock() on a tmp file.
        // File-based exclusive locking can add 50–300 ms of blocking latency per
        // request (filesystem I/O + lock contention under concurrent load).
        // The join rate limit (90/300s) is loose enough that failing open is safe:
        // the presence upsert is idempotent, and other endpoints protect against spam.
        return true;
    }
}
