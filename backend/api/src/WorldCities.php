<?php

declare(strict_types=1);

/**
 * Hilads cities on the GeoNames world base (V5-01): a city is created the
 * first time someone plays there (GPS or a pick in the search, never IP),
 * search across every GeoNames city, and the list of cities with activity.
 */
final class WorldCities
{
    /** Never more than this many ids below the collision offset: GeoNames ids are ~13M today. */
    private const COLLISION_OFFSET = 1_000_000_000;

    /**
     * Where a GPS position plays: its Hilads city (created on the first visit),
     * or null when no city is within 50 km. Before the seeds are mapped to
     * GeoNames (or without the GeoNames base), the legacy nearest city.
     */
    public static function fromPosition(float $lat, float $lng, ?string $country = null): ?array
    {
        if (!CityRepository::mapped()) return CityRepository::nearest($lat, $lng, $country);
        $pdo   = Database::pdo();
        $geo   = CityPlacement::place($pdo, $lat, $lng);
        if ($geo === null) {
            $loaded = $pdo->query("SELECT 1 FROM geo_cities LIMIT 1")->fetchColumn();
            return $loaded ? null : CityRepository::nearest($lat, $lng, $country);
        }
        return self::ensure((int) $geo['geoname_id']);
    }

    /**
     * Where a picked GeoNames city plays (Brooklyn → New York City): its
     * placement at the city's own position, created when needed. Null for an
     * unknown id.
     */
    public static function fromPick(int $geonameId): ?array
    {
        $pdo  = Database::pdo();
        $stmt = $pdo->prepare("SELECT lat, lng FROM geo_cities WHERE geoname_id = ?");
        $stmt->execute([$geonameId]);
        $at = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$at) return null;
        $geo = CityPlacement::place($pdo, (float) $at['lat'], (float) $at['lng']);
        return self::ensure((int) ($geo['geoname_id'] ?? $geonameId));
    }

    /**
     * The Hilads city of a GeoNames city, created when it does not exist yet:
     * id city_<geoname_id>, or city_<1e9 + geoname_id> when that id is one of
     * our seed numbers (GeoNames 285 vs city_285 Alicante). Named in English.
     */
    public static function ensure(int $geonameId): ?array
    {
        $existing = CityRepository::findByGeonameId($geonameId) ?? self::findInDb($geonameId);
        if ($existing !== null) return $existing;

        $pdo  = Database::pdo();
        $stmt = $pdo->prepare("SELECT geoname_id, name, country, timezone, lat, lng FROM geo_cities WHERE geoname_id = ?");
        $stmt->execute([$geonameId]);
        $geo = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$geo) return null;
        // Creation is cheap but permanent: a few new cities a day per address
        // (fake GPS, a script walking coordinates).
        if (PHP_SAPI !== 'cli' && !DbRateLimiter::allow('city_create|' . Request::ip(), 20, 86400)) return null;

        $name  = self::localName($geonameId, 'en') ?? $geo['name'];
        $taken = $pdo->prepare("SELECT 1 FROM channels WHERE id = ?");
        $taken->execute(["city_{$geonameId}"]);
        $id = $taken->fetchColumn() ? self::COLLISION_OFFSET + $geonameId : $geonameId;

        $pdo->beginTransaction();
        try {
            $pdo->prepare("
                INSERT INTO channels (id, type, name, created_at, updated_at)
                VALUES (?, 'city', ?, now(), now())
                ON CONFLICT (id) DO NOTHING
            ")->execute(["city_{$id}", $name]);
            $pdo->prepare("
                INSERT INTO cities (channel_id, country, lat, lng, timezone, geoname_id, auto_created)
                VALUES (?, ?, ?, ?, ?, ?, true)
                ON CONFLICT DO NOTHING
            ")->execute(["city_{$id}", $geo['country'], $geo['lat'], $geo['lng'], $geo['timezone'], $geonameId]);
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        CityRepository::forget();
        // Two first visitors at once: the loser's insert did nothing, read the winner's.
        $city = self::findInDb($geonameId);
        if ($city !== null && (int) $city['id'] === $id) {
            AnalyticsService::defer('city_created', "city_{$id}", ['geoname_id' => $geonameId, 'country' => $geo['country']]);
        }
        return $city;
    }

    private static function findInDb(int $geonameId): ?array
    {
        $stmt = Database::pdo()->prepare("
            SELECT ch.id, ch.name, ci.country, ci.lat, ci.lng, ci.timezone, ci.geoname_id
            FROM cities ci JOIN channels ch ON ch.id = ci.channel_id
            WHERE ci.geoname_id = ? AND ch.status = 'active'
        ");
        $stmt->execute([$geonameId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$row) return null;
        return [
            'id' => (int) substr($row['id'], 5), 'name' => $row['name'], 'country' => $row['country'],
            'lat' => (float) $row['lat'], 'lng' => (float) $row['lng'], 'timezone' => $row['timezone'],
            'geoname_id' => (int) $row['geoname_id'],
        ];
    }

    /** A GeoNames city's name in a locale (preferred, else the first), or null. */
    public static function localName(int $geonameId, string $locale): ?string
    {
        return self::localNames([$geonameId], $locale)[$geonameId] ?? null;
    }

    /** geoname_id => name in a locale, for the ids that have one. */
    public static function localNames(array $geonameIds, string $locale): array
    {
        if (!$geonameIds) return [];
        $in   = implode(',', array_fill(0, count($geonameIds), '?'));
        $stmt = Database::pdo()->prepare("
            SELECT DISTINCT ON (geoname_id) geoname_id, name
            FROM geo_city_names
            WHERE locale = ? AND geoname_id IN ({$in})
            ORDER BY geoname_id, is_preferred DESC, is_short ASC, name
        ");
        $stmt->execute(array_merge([$locale], array_values($geonameIds)));
        $out = [];
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) $out[(int) $r['geoname_id']] = $r['name'];
        return $out;
    }

    /**
     * Every GeoNames city whose name (any locale) starts with $q, most
     * populous first, each with where it plays (Brooklyn → New York City) and
     * its Hilads city when that exists already.
     */
    public static function search(string $q, string $locale, int $limit = 20): array
    {
        $q = mb_strtolower(trim($q));
        if (mb_strlen($q) < 2) return [];
        $like = str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $q) . '%';
        $pdo  = Database::pdo();
        $stmt = $pdo->prepare("
            SELECT g.geoname_id, g.name, g.country, g.population, g.lat, g.lng
            FROM geo_cities g
            WHERE lower(g.ascii_name) LIKE :p OR lower(g.name) LIKE :p
               OR g.geoname_id IN (SELECT geoname_id FROM geo_city_names WHERE lower(name) LIKE :p)
            ORDER BY g.population DESC
            LIMIT {$limit}
        ");
        $stmt->execute(['p' => $like]);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

        $plays = [];
        foreach ($rows as $r) {
            $plays[(int) $r['geoname_id']] = CityPlacement::place($pdo, (float) $r['lat'], (float) $r['lng']);
        }
        $ids   = array_unique(array_merge(array_keys($plays), array_filter(array_map(fn($p) => $p ? (int) $p['geoname_id'] : null, $plays))));
        $names = self::localNames($ids, $locale);
        $en    = $locale === 'en' ? $names : self::localNames($ids, 'en');

        $out = [];
        foreach ($rows as $r) {
            $gid    = (int) $r['geoname_id'];
            $playId = $plays[$gid] ? (int) $plays[$gid]['geoname_id'] : $gid;
            $hilads = CityRepository::findByGeonameId($playId);
            $out[] = [
                'geonameId'  => $gid,
                'name'       => $names[$gid] ?? $en[$gid] ?? $r['name'],
                'country'    => $r['country'],
                'population' => (int) $r['population'],
                // Where a pick lands: itself, or the city that absorbs it.
                'playsIn'    => $playId === $gid ? null : [
                    'geonameId' => $playId,
                    'name'      => $names[$playId] ?? $en[$playId] ?? $plays[$gid]['name'],
                ],
                'channelId'  => $hilads ? $hilads['id'] : null,
            ];
        }
        return $out;
    }

    /**
     * The cities with activity (someone lives there now, or a photo in the
     * last 90 days), most members first. For the scope selector; cached 5 min.
     */
    public static function active(): array
    {
        return Cache::remember('cities_active_v1', 300, static function (): array {
            $rows = Database::pdo()->query("
                SELECT a.city_id, SUM(a.members) AS members, SUM(a.photos) AS photos
                FROM (
                    SELECT current_city_id AS city_id, COUNT(*) AS members, 0 AS photos
                    FROM users WHERE deleted_at IS NULL AND current_city_id IS NOT NULL
                    GROUP BY current_city_id
                    UNION ALL
                    SELECT city_id, 0, COUNT(*)
                    FROM daily_proofs WHERE city_id IS NOT NULL AND created_at > now() - interval '90 days'
                    GROUP BY city_id
                ) a
                GROUP BY a.city_id
                ORDER BY members DESC, photos DESC
            ")->fetchAll(PDO::FETCH_ASSOC);
            $out = [];
            foreach ($rows as $r) {
                $city = CityRepository::findById((int) substr((string) $r['city_id'], 5));
                if ($city === null) continue;
                $out[] = [
                    'channelId' => $city['id'],
                    'name'      => $city['name'],
                    'country'   => $city['country'],
                    'geonameId' => $city['geoname_id'],
                    'members'   => (int) $r['members'],
                    'photos'    => (int) $r['photos'],
                ];
            }
            return $out;
        });
    }
}
