<?php

declare(strict_types=1);

/**
 * Daily Challenge rules shared by the API, the admin and the cron.
 *
 * - Live city: a city is live only when the admin forced it live
 *   (cities.force_live). AUDIT Q2: no activity threshold in V1.
 * - Local: a proof is local when the user declared themselves a local
 *   (users.mode = 'local') AND posts in their own city. users.home_city is free
 *   text that normally holds the exact city name; when it is empty we trust the
 *   declared mode. AUDIT Q3.
 */
final class DailyRules
{
    /** @var string[]|null city channel ids ('city_N'), per request */
    private static ?array $liveIds = null;

    /** Live city channel ids ('city_N'). Cached 60 s across requests. */
    public static function liveCityIds(): array
    {
        if (self::$liveIds !== null) {
            return self::$liveIds;
        }
        $cached = PHP_SAPI !== 'cli' ? Cache::get('daily_live_cities_v1') : null;
        if ($cached !== null) {
            return self::$liveIds = $cached;
        }
        $ids = Database::pdo()
            ->query("SELECT channel_id FROM cities WHERE force_live ORDER BY channel_id")
            ->fetchAll(PDO::FETCH_COLUMN);
        self::$liveIds = array_values(array_map('strval', $ids));
        if (PHP_SAPI !== 'cli') {
            Cache::set('daily_live_cities_v1', self::$liveIds, 60);
        }
        return self::$liveIds;
    }

    /** $cityId is a channel id ('city_N'). */
    public static function isLive(?string $cityId): bool
    {
        return $cityId !== null && in_array($cityId, self::liveCityIds(), true);
    }

    /** Drop the cached live list (after an admin switch). */
    public static function forgetLiveCities(): void
    {
        self::$liveIds = null;
        if (PHP_SAPI !== 'cli') {
            @unlink(sys_get_temp_dir() . '/hilads_cache_' . md5('daily_live_cities_v1'));
        }
    }

    public static function isLocalFor(?string $mode, ?string $homeCity, ?string $cityName): bool
    {
        if ($mode !== 'local' || $cityName === null || trim($cityName) === '') {
            return false;
        }
        $home = trim((string) $homeCity);
        return $home === '' || self::slug($home) === self::slug($cityName);
    }

    public static function isValidTimezone(string $tz): bool
    {
        static $ids = null;
        $ids ??= array_flip(DateTimeZone::listIdentifiers());
        return isset($ids[$tz]);
    }

    /** Same slug rule as the city URLs (resolveCityBySlug). */
    public static function slug(string $name): string
    {
        return trim((string) preg_replace('/[^a-z0-9]+/', '-', strtolower($name)), '-');
    }
}
