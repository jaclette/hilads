<?php

declare(strict_types=1);

class CityRepository
{
    /** In-memory cache - loaded once per request from Postgres. */
    private static ?array $cities = null;

    private static function load(): array
    {
        if (self::$cities !== null) {
            return self::$cities;
        }

        // Cross-request cache - cities change at most a few times per year, so we
        // avoid re-reading the full ~350-row set on every city lookup/validation.
        // APCu when available (fastest, shared across workers); otherwise a
        // file-based fallback. APCu is NOT enabled on Render's mod_php, and
        // without the fallback this query ran ~147k× and dominated DB egress
        // (~5GB). TTL: 1 hour. Both stores clear on deploy / instance restart.
        $apcu = function_exists('apcu_fetch') && PHP_SAPI !== 'cli';
        if ($apcu) {
            $cached = apcu_fetch('hilads_cities_v1');
            if (is_array($cached)) {
                self::$cities = $cached;
                return self::$cities;
            }
        }
        if (PHP_SAPI !== 'cli') {
            $cached = Cache::get('cities_all_v1');
            if ($cached !== null) {
                self::$cities = $cached;
                return self::$cities;
            }
        }

        $rows = Database::pdo()
            ->query("
                SELECT
                    CAST(SUBSTRING(ch.id FROM 6) AS INTEGER) AS id,
                    ch.name,
                    ci.country,
                    ci.lat,
                    ci.lng,
                    ci.timezone
                FROM channels ch
                JOIN cities ci ON ci.channel_id = ch.id
                WHERE ch.type = 'city'
                  AND ch.status = 'active'
                ORDER BY id
            ")
            ->fetchAll(PDO::FETCH_ASSOC);

        // Cast numeric fields to their proper types (PDO returns strings)
        self::$cities = array_map(function (array $row): array {
            return [
                'id'       => (int)   $row['id'],
                'name'     => $row['name'],
                'country'  => $row['country'],
                'lat'      => (float) $row['lat'],
                'lng'      => (float) $row['lng'],
                'timezone' => $row['timezone'],
            ];
        }, $rows);

        if ($apcu) {
            apcu_store('hilads_cities_v1', self::$cities, 3600);
        }
        if (PHP_SAPI !== 'cli') {
            Cache::set('cities_all_v1', self::$cities, 3600);
        }

        return self::$cities;
    }

    public static function all(): array
    {
        return self::load();
    }

    public static function findById(int $id): ?array
    {
        foreach (self::load() as $city) {
            if ($city['id'] === $id) {
                return $city;
            }
        }
        return null;
    }

    /**
     * Find the closest city to a GPS point, optionally constrained to a country.
     *
     * When the client passes the GPS point's country (resolved via native
     * reverse-geocode on mobile / Nominatim on web), we restrict the candidate
     * set to cities in that country before computing distances. This prevents
     * the nearest-city search from snapping across an international border -
     * the bug that placed users on Phu Quoc (VN, no city in our DB) into
     * Phnom Penh (KH, ~150 km) instead of Ho Chi Minh City (VN, ~300 km).
     *
     * If the country is missing, malformed, or has no cities in our DB, we
     * fall back to the global nearest - so older clients (no country param)
     * keep working unchanged.
     */
    public static function nearest(float $lat, float $lng, ?string $country = null): array
    {
        $candidates = self::load();

        if ($country !== null && $country !== '') {
            $sameCountry = array_values(array_filter(
                $candidates,
                fn($c) => strcasecmp($c['country'] ?? '', $country) === 0,
            ));
            if (!empty($sameCountry)) {
                $candidates = $sameCountry;
            }
        }

        $nearest     = null;
        $minDistance = PHP_FLOAT_MAX;

        foreach ($candidates as $city) {
            $distance = self::haversine($lat, $lng, $city['lat'], $city['lng']);
            if ($distance < $minDistance) {
                $minDistance = $distance;
                $nearest     = $city;
            }
        }

        return $nearest;
    }

    private static function haversine(float $lat1, float $lng1, float $lat2, float $lng2): float
    {
        $R    = 6371;
        $dLat = deg2rad($lat2 - $lat1);
        $dLng = deg2rad($lng2 - $lng1);

        $a = sin($dLat / 2) ** 2
            + cos(deg2rad($lat1)) * cos(deg2rad($lat2)) * sin($dLng / 2) ** 2;

        return $R * 2 * atan2(sqrt($a), sqrt(1 - $a));
    }
}
