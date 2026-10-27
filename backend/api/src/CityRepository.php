<?php

declare(strict_types=1);

class CityRepository
{
    /** In-memory cache - loaded once per request from Postgres. */
    private static ?array $cities = null;

    private const CACHE_KEY = 'cities_all_v3';

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
            $cached = apcu_fetch(self::CACHE_KEY);
            if (is_array($cached)) {
                self::$cities = $cached;
                return self::$cities;
            }
        }
        if (PHP_SAPI !== 'cli') {
            $cached = Cache::get(self::CACHE_KEY);
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
                    ci.timezone,
                    " . self::v5Columns() . "
                FROM channels ch
                JOIN cities ci ON ci.channel_id = ch.id
                WHERE ch.type = 'city'
                  AND ch.status = 'active'
                ORDER BY id
            ")
            ->fetchAll(PDO::FETCH_ASSOC);

        self::$cities = array_map(self::fromRow(...), $rows);

        if ($apcu) {
            apcu_store(self::CACHE_KEY, self::$cities, 3600);
        }
        if (PHP_SAPI !== 'cli') {
            Cache::set(self::CACHE_KEY, self::$cities, 3600);
        }

        return self::$cities;
    }

    public static function all(): array
    {
        return self::load();
    }

    /**
     * The V5-01 columns (GeoNames id, short names, aliases), or NULLs before
     * the migration ran: the code can ship first, every city is then unmapped
     * and placement stays legacy.
     */
    private static function v5Columns(): string
    {
        static $has = null;
        if ($has === null) {
            try {
                $has = Database::pdo()->query("
                    SELECT array_agg(column_name::text) FROM information_schema.columns
                    WHERE table_name = 'cities' AND column_name IN ('geoname_id', 'short_name')
                ")->fetchColumn() ?: '';
            } catch (\Throwable) {
                $has = '';
            }
        }
        return (str_contains($has, 'geoname_id') ? 'ci.geoname_id' : 'NULL::int AS geoname_id') . ', '
            . (str_contains($has, 'short_name')
                ? 'ci.short_name, ci.short_name_i18n::text AS short_name_i18n, array_to_json(ci.aliases)::text AS aliases'
                : 'NULL AS short_name, NULL AS short_name_i18n, NULL AS aliases');
    }

    /** A cities row as the list holds it (PDO returns strings). */
    private static function fromRow(array $row): array
    {
        return [
            'id'         => (int)   $row['id'],
            'name'       => $row['name'],
            'country'    => $row['country'],
            'lat'        => (float) $row['lat'],
            'lng'        => (float) $row['lng'],
            'timezone'   => $row['timezone'],
            'geoname_id' => $row['geoname_id'] !== null ? (int) $row['geoname_id'] : null,
            // Saigon, {"vi": "Sài Gòn"}, more names the search finds.
            'short_name'      => $row['short_name'] ?? null,
            'short_name_i18n' => json_decode((string) ($row['short_name_i18n'] ?? ''), true) ?: [],
            'aliases'         => json_decode((string) ($row['aliases'] ?? ''), true) ?: [],
        ];
    }

    /** Drop every cached copy of the list (a city was created, merged or edited). */
    public static function forget(): void
    {
        self::$cities = null;
        if (function_exists('apcu_delete')) apcu_delete(self::CACHE_KEY);
        Cache::forget(self::CACHE_KEY);
    }

    /** The Hilads city of a GeoNames city, or null. */
    public static function findByGeonameId(int $geonameId): ?array
    {
        foreach (self::load() as $city) {
            if ($city['geoname_id'] === $geonameId) return $city;
        }
        return null;
    }

    /** Whether the seed cities are mapped to GeoNames yet (V5-01): before that, placement stays legacy. */
    public static function mapped(): bool
    {
        foreach (self::load() as $city) {
            if ($city['geoname_id'] !== null) return true;
        }
        return false;
    }

    /**
     * The city a merged city now lives in (city_12 merged into city_7 → 7,
     * following a chain), or null when it was never merged.
     */
    public static function mergedInto(int $id): ?int
    {
        $into = null;
        try {
            $stmt = Database::pdo()->prepare("SELECT merged_into FROM cities WHERE channel_id = ?");
            for ($i = 0; $i < 5; $i++) {
                $stmt->execute(['city_' . $id]);
                $next = $stmt->fetchColumn();
                if (!is_string($next) || !preg_match('/^city_(\d+)$/', $next, $m)) break;
                $into = $id = (int) $m[1];
            }
        } catch (\Throwable) {
            return null; // before the V5-01 migration
        }
        return $into;
    }

    public static function findById(int $id): ?array
    {
        foreach (self::load() as $city) {
            if ($city['id'] === $id) {
                return $city;
            }
        }
        // A city created since this instance cached the list (another instance,
        // within the hour): one small row read, kept for the rest of the request.
        $stmt = Database::pdo()->prepare("
            SELECT " . $id . " AS id, ch.name, ci.country, ci.lat, ci.lng, ci.timezone, " . self::v5Columns() . "
            FROM channels ch JOIN cities ci ON ci.channel_id = ch.id
            WHERE ch.id = ? AND ch.type = 'city' AND ch.status = 'active'
        ");
        $stmt->execute(['city_' . $id]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$row) return null;
        $city = self::fromRow($row);
        self::$cities[] = $city;
        return $city;
    }

    /** ISO-2 country code of a city ("city_5" or 5), or null. Uses the cached city list. */
    public static function countryOf(int|string|null $cityId): ?string
    {
        if ($cityId === null) {
            return null;
        }
        $n = is_int($cityId) ? $cityId : (int) preg_replace('/^city_/', '', $cityId);
        return $n > 0 ? (self::findById($n)['country'] ?? null) : null;
    }

    /**
     * Map a city display name to its channel id ("city_<int>"). Case-
     * insensitive, trims whitespace. Returns null when no exact match.
     *
     * Used by signup / profile-edit paths that store users.home_city as a
     * raw string and need to derive current_city_id so the user appears in
     * the City Crew (members query filters on current_city_id under
     * MEMBERS_USE_CURRENT_CITY=on).
     */
    public static function findChannelIdByName(string $name): ?string
    {
        $needle = strtolower(trim($name));
        if ($needle === '') return null;
        foreach (self::load() as $city) {
            if (strtolower(trim((string) ($city['name'] ?? ''))) === $needle) {
                return 'city_' . $city['id'];
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
