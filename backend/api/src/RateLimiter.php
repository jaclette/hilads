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

        $dir = sys_get_temp_dir() . '/hilads-rate-limit';
        if (!is_dir($dir) && !@mkdir($dir, 0700, true) && !is_dir($dir)) {
            return true; // fail open if temp storage is unavailable
        }

        $path = $dir . '/' . hash('sha256', $key) . '.json';
        $now  = time();
        $fp   = @fopen($path, 'c+');

        if ($fp === false) {
            return true;
        }

        try {
            if (!flock($fp, LOCK_EX)) {
                return true;
            }

            $raw   = stream_get_contents($fp);
            $entry = json_decode($raw ?: '', true);

            if (!is_array($entry) || ($entry['expires_at'] ?? 0) < $now) {
                $entry = ['count' => 1, 'expires_at' => $now + $windowSeconds];
            } else {
                if (($entry['count'] ?? 0) >= $limit) {
                    return false;
                }
                $entry['count'] = (int) $entry['count'] + 1;
            }

            ftruncate($fp, 0);
            rewind($fp);
            fwrite($fp, json_encode($entry));
            fflush($fp);
            return true;
        } finally {
            flock($fp, LOCK_UN);
            fclose($fp);
        }
    }
}
