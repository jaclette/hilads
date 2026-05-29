<?php

declare(strict_types=1);

/**
 * Tiny file-based response cache for crawler-facing GET endpoints.
 *
 * Why this exists: the PHP API has no caching layer, so every prerender/crawler
 * hit ran fresh Postgres queries. With 19 localized URL variants per page, a
 * single recrawl wave fans out into 19× identical queries → Supabase egress.
 * This collapses that fan-out: the first request computes + stores the result,
 * the rest of the wave is served from a temp file with zero DB egress.
 *
 * Scope: only consulted for SSR/crawler requests (the X-Hilads-SSR header the
 * prerender sends). Real app users never touch it, so the live experience stays
 * fresh. File-based — no DB egress, no extra infra; per Render instance is fine,
 * a short TTL on each still kills the bulk of repeat queries.
 */
final class Cache
{
    private static function path(string $key): string
    {
        return sys_get_temp_dir() . '/hilads_cache_' . md5($key);
    }

    /** Cached value for $key if still fresh, else null. */
    public static function get(string $key): ?array
    {
        $file = self::path($key);
        if (!is_file($file)) return null;
        $raw = @file_get_contents($file);
        if ($raw === false) return null;
        $entry = @unserialize($raw);
        if (!is_array($entry) || (int) ($entry['e'] ?? 0) < time()) return null;
        return is_array($entry['v'] ?? null) ? $entry['v'] : null;
    }

    public static function set(string $key, array $value, int $ttl): void
    {
        @file_put_contents(self::path($key), serialize(['e' => time() + $ttl, 'v' => $value]), LOCK_EX);
    }

    /**
     * Return the cached value for $key, or run $producer, store, and return it.
     * Degrades gracefully to just running $producer on any cache I/O failure.
     * A null producer result is returned but not cached (e.g. not-found).
     */
    public static function remember(string $key, int $ttl, callable $producer): ?array
    {
        $hit = self::get($key);
        if ($hit !== null) return $hit;
        $value = $producer();
        if (is_array($value)) self::set($key, $value, $ttl);
        return $value;
    }
}
