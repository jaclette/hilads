<?php

declare(strict_types=1);

class CityRepository
{
    /** In-memory cache — loaded once per request from Postgres. */
    private static ?array $cities = null;

    private static function load(): array
    {
        if (self::$cities !== null) {
            return self::$cities;
        }

        // APCu cross-worker cache — cities change at most a few times per year.
        // Eliminates the DB round-trip (and the DB connection establishment cost
        // on cold workers) for every endpoint that validates or looks up a city.
        // TTL: 1 hour. Cleared automatically when APCu is restarted on deploy.
        if (function_exists('apcu_fetch') && PHP_SAPI !== 'cli') {
            $cached = apcu_fetch('hilads_cities_v1');
            if (is_array($cached)) {
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

        if (function_exists('apcu_store') && PHP_SAPI !== 'cli') {
            apcu_store('hilads_cities_v1', self::$cities, 3600);
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

    public static function nearest(float $lat, float $lng): array
    {
        $nearest     = null;
        $minDistance = PHP_FLOAT_MAX;

        foreach (self::load() as $city) {
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
