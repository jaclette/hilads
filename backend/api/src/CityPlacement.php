<?php

declare(strict_types=1);

/**
 * Where a position plays (V5-01): its municipality, unless a much bigger
 * neighbour of the same region absorbs it. From the GeoNames base (geo_cities):
 *
 *   1. only the cities within 50 km count; none → nobody is placed (picker)
 *   2. N = the nearest one: the municipality
 *   3. N has an override (geo_city_overrides, back office) → its target, or N
 *      itself when it is never absorbed
 *   4. a neighbour within 30 km, in N's country and admin1, at least 3 times
 *      N's population and 200,000 or more → the most populous such neighbour
 *      (no size cap: Brooklyn or Pudong are districts and play for their city).
 *      Across admin1 too when the neighbour has no admin1 (Hong Kong,
 *      Singapore) or is the capital of 1,000,000+ within 15 km (Bogotá, Lima,
 *      Kuala Lumpur sit in their own region). A never-absorbed neighbour
 *      keeps its own area (Hull → Gatineau, not Ottawa); an attached one
 *      hands it on (Makati → Quezon City → Manila)
 *   5. otherwise N
 *
 * GPS, IP (existing cities only) and the city search all go through choose().
 */
final class CityPlacement
{
    public const RADIUS_KM    = 50;
    public const NEIGHBOUR_KM = 30;
    public const RATIO        = 3;
    public const MIN_ABSORBER = 200_000;
    public const CAPITAL_KM   = 15;
    public const CAPITAL_POP  = 1_000_000;

    /**
     * Overrides seeded by migrate.php (geoname_id => [target or null = never
     * absorbed, note]); the back office edits geo_city_overrides afterwards.
     */
    public const SEED_OVERRIDES = [
        2271772  => [2267057, 'Amadora → Lisbon (2.89×, just under the ratio)'],
        1580541  => [null,    'Hội An stays Hội An (Quảng Nam merged into Đà Nẵng in 2025)'],
        12747064 => [1819729, 'Hong Kong Island → Hong Kong (GeoNames district)'],
        1819609  => [1819729, 'Kowloon → Hong Kong (GeoNames district)'],
        12747063 => [1819729, 'New Territories → Hong Kong (GeoNames district)'],
        1692192  => [1701668, 'Quezon City → Manila (Metro Manila plays as Manila)'],
        101760   => [109223,  'Sulţānah → Madinah (district)'],
        288764   => [287286,  'Bawshar → Muscat (district)'],
        5959974  => [null,    'Gatineau stays Gatineau (Québec, not Ottawa)'],
        1622846  => [null,    'Ubud stays Ubud (not Denpasar)'],
    ];

    /**
     * The play city among $candidates (geo_cities rows: geoname_id, country,
     * admin1, population, lat, lng, feature_code), or null when none is within 50 km.
     * $overrides: geoname_id => target geoname_id, or null (never absorbed);
     * an attach target must be among $candidates (place() adds it).
     */
    public static function choose(array $candidates, float $lat, float $lng, array $overrides = []): ?array
    {
        $near = [];
        foreach ($candidates as $c) {
            $d = self::distanceKm($lat, $lng, (float) $c['lat'], (float) $c['lng']);
            if ($d <= self::RADIUS_KM) $near[] = $c + ['distance_km' => $d];
        }
        if (!$near) return null;
        usort($near, fn($a, $b) => $a['distance_km'] <=> $b['distance_km']);

        $n = $near[0];
        if (array_key_exists((int) $n['geoname_id'], $overrides)) {
            return self::follow($n, $candidates, $lat, $lng, $overrides);
        }

        $absorber = null;
        $kept     = null; // the most populous never-absorbed neighbour: it holds its area
        foreach ($near as $c) {
            if ($c['distance_km'] > self::NEIGHBOUR_KM || $c['country'] !== $n['country']) continue;
            $capital = ($c['feature_code'] ?? '') === 'PPLC' && (int) $c['population'] >= self::CAPITAL_POP && $c['distance_km'] <= self::CAPITAL_KM;
            if ($c['admin1'] !== $n['admin1'] && $c['admin1'] !== '' && !$capital) continue;
            $pop = (int) $c['population'];
            if ($pop < self::MIN_ABSORBER || $pop < self::RATIO * (int) $n['population']) continue;
            if ($absorber === null || $pop > (int) $absorber['population']) $absorber = $c;
            $isKept = array_key_exists((int) $c['geoname_id'], $overrides) && $overrides[(int) $c['geoname_id']] === null;
            if ($isKept && ($kept === null || $pop > (int) $kept['population'])) $kept = $c;
        }
        $absorber = $kept ?? $absorber;
        return $absorber ? self::follow($absorber, $candidates, $lat, $lng, $overrides) : $n;
    }

    /** $city, or the city its override attaches it to (the target must be among $candidates). */
    private static function follow(array $city, array $candidates, float $lat, float $lng, array $overrides): array
    {
        $target = $overrides[(int) $city['geoname_id']] ?? null;
        if ($target === null) return $city;
        foreach ($candidates as $c) {
            if ((int) $c['geoname_id'] === (int) $target) return $c + ['distance_km' => self::distanceKm($lat, $lng, (float) $c['lat'], (float) $c['lng'])];
        }
        return $city; // target missing from the base: keep the city itself
    }

    /** The geo_cities rows within 50 km of a position (bounding box, indexed). */
    public static function candidates(PDO $pdo, float $lat, float $lng): array
    {
        $dLat = self::RADIUS_KM / 111.0;
        $dLng = self::RADIUS_KM / (111.0 * max(cos(deg2rad($lat)), 0.01));
        $stmt = $pdo->prepare("
            SELECT geoname_id, name, country, admin1, population, timezone, lat, lng, feature_code
            FROM geo_cities
            WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?
        ");
        $stmt->execute([$lat - $dLat, $lat + $dLat, $lng - $dLng, $lng + $dLng]);
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    /** The overrides of these cities (geoname_id => target or null). */
    public static function overrides(PDO $pdo, array $geonameIds): array
    {
        if (!$geonameIds) return [];
        $in   = implode(',', array_fill(0, count($geonameIds), '?'));
        $stmt = $pdo->prepare("SELECT geoname_id, target_geoname_id FROM geo_city_overrides WHERE geoname_id IN ({$in})");
        $stmt->execute(array_values($geonameIds));
        $out = [];
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $out[(int) $r['geoname_id']] = $r['target_geoname_id'] === null ? null : (int) $r['target_geoname_id'];
        }
        return $out;
    }

    /** The GeoNames city a position plays in, or null (nothing within 50 km). */
    public static function place(PDO $pdo, float $lat, float $lng): ?array
    {
        $candidates = self::candidates($pdo, $lat, $lng);
        $overrides  = self::overrides($pdo, array_map('intval', array_column($candidates, 'geoname_id')));
        // An attach target can lie beyond the 50 km box: load it too.
        $missing = array_diff(array_filter($overrides), array_map('intval', array_column($candidates, 'geoname_id')));
        if ($missing) {
            $in   = implode(',', array_fill(0, count($missing), '?'));
            $stmt = $pdo->prepare("SELECT geoname_id, name, country, admin1, population, timezone, lat, lng, feature_code FROM geo_cities WHERE geoname_id IN ({$in})");
            $stmt->execute(array_values($missing));
            $candidates = array_merge($candidates, $stmt->fetchAll(PDO::FETCH_ASSOC));
        }
        return self::choose($candidates, $lat, $lng, $overrides);
    }

    public static function distanceKm(float $lat1, float $lng1, float $lat2, float $lng2): float
    {
        $dLat = deg2rad($lat2 - $lat1);
        $dLng = deg2rad($lng2 - $lng1);
        $a = sin($dLat / 2) ** 2 + cos(deg2rad($lat1)) * cos(deg2rad($lat2)) * sin($dLng / 2) ** 2;
        return 6371.0 * 2 * atan2(sqrt($a), sqrt(1 - $a));
    }
}
