<?php

declare(strict_types=1);

/**
 * Server-side geotag verification for International challenge proofs.
 *
 * Tolerance resolution order:
 *   1. cities.proof_geotag_tolerance_km — per-city override set via SQL
 *      (no admin UI yet; sprawling metros like Saigon get bumped here)
 *   2. env CHALLENGE_PROOF_TOLERANCE_KM
 *   3. DEFAULT_TOLERANCE_KM constant fallback (30)
 *
 * If the challenge has no target_city_id set ("anywhere" international),
 * no bbox check applies — any geotag is accepted as verified.
 */
final class ChallengeProofGeotag
{
    /** Last-resort fallback if both per-city override and env are unset. */
    private const DEFAULT_TOLERANCE_KM = 30;

    /**
     * Returns true if the geotag falls within tolerance of the target city.
     * Returns true unconditionally when no target city is set.
     *
     * Caller passes the resolved target_city_id (the 'city_<int>' channel id)
     * and the submitted lat/lng. We look up the city's center coords + per-
     * city tolerance in one query and compute Haversine distance.
     */
    public static function verify(?string $targetCityId, float $lat, float $lng): bool
    {
        if ($targetCityId === null || $targetCityId === '') {
            // "Anywhere" — anything goes. The acceptor's geotag is still
            // stored (audit trail) but not gated.
            return true;
        }

        $stmt = Database::pdo()->prepare("
            SELECT c.lat, c.lng, c.proof_geotag_tolerance_km
            FROM cities c
            WHERE c.channel_id = ?
        ");
        $stmt->execute([$targetCityId]);
        $row = $stmt->fetch(\PDO::FETCH_ASSOC);
        if ($row === false) {
            // Target city resolved at create-time but missing now — let it
            // through rather than fail closed (would block legitimate proofs
            // on a misconfigured DB). The audit row still has the geotag.
            error_log("[proof-geotag] target city {$targetCityId} not found in cities; passing through");
            return true;
        }

        $toleranceKm = self::resolveToleranceKm($row['proof_geotag_tolerance_km'] ?? null);
        $distanceKm  = self::haversineKm(
            (float) $row['lat'], (float) $row['lng'],
            $lat,                $lng,
        );

        return $distanceKm <= $toleranceKm;
    }

    /**
     * Distance between two GPS points (Haversine, km). Earth radius rounded
     * to 6371 — sub-1% error at the kind of distances we care about (5–50 km
     * bbox checks). No need for an ellipsoid model here.
     */
    public static function haversineKm(float $lat1, float $lng1, float $lat2, float $lng2): float
    {
        $earthRadiusKm = 6371.0;
        $dLat = deg2rad($lat2 - $lat1);
        $dLng = deg2rad($lng2 - $lng1);
        $a = sin($dLat / 2) ** 2
             + cos(deg2rad($lat1)) * cos(deg2rad($lat2)) * sin($dLng / 2) ** 2;
        return 2 * $earthRadiusKm * asin(min(1.0, sqrt($a)));
    }

    /** city_override ?? env ?? default. */
    private static function resolveToleranceKm($cityOverride): int
    {
        if ($cityOverride !== null && (int) $cityOverride > 0) {
            return (int) $cityOverride;
        }
        $env = getenv('CHALLENGE_PROOF_TOLERANCE_KM');
        if ($env !== false && (int) $env > 0) {
            return (int) $env;
        }
        return self::DEFAULT_TOLERANCE_KM;
    }
}
