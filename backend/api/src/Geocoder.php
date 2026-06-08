<?php

/**
 * Forward geocoding via Nominatim (OpenStreetMap) - turns a free-text address
 * into lat/lng. We use Nominatim because the rest of the app already does
 * (the location-picker search), and there is no Google Maps key on the client.
 *
 * Nominatim usage policy: send a real User-Agent and keep to ~1 request/second.
 * This class self-throttles process-wide (see throttle()), so callers - both the
 * single on-create lookup and the bulk backfill loop - don't need their own
 * sleeps. Failures are non-fatal everywhere: the caller keeps the text address
 * and simply shows no distance.
 */
final class Geocoder
{
    private const ENDPOINT   = 'https://nominatim.openstreetmap.org/search';
    private const USER_AGENT = 'Hilads/1.0 (+https://hilads.live)';
    private const MIN_GAP_S  = 1.05; // ≥1s between requests (Nominatim policy)

    private static float $lastCallAt = 0.0;

    /**
     * Best-effort forward geocode. Tries the full address first, then a
     * simplified "street, city" variant (house number stripped) which is far
     * more reliable for detailed local addresses. Returns the first hit.
     *
     * @return array{lat: float, lng: float}|null
     */
    public static function forward(
        string  $address,
        ?string $cityName    = null,
        ?string $countryCode = null,
        int     $timeoutMs   = 4000
    ): ?array {
        $address = trim($address);
        if ($address === '') {
            return null;
        }

        foreach (self::buildQueries($address, $cityName) as $query) {
            $hit = self::queryOne($query, $countryCode, $timeoutMs);
            if ($hit !== null) {
                return $hit;
            }
        }
        return null;
    }

    /**
     * Candidate query strings, in priority order. The fallback drops the
     * house number and any ward/district components, keeping just the street
     * plus the city (e.g. "27 Ngô Đức Kế, Bến Nghé, District 1, HCMC" →
     * "Ngô Đức Kế, Ho Chi Minh City"), which Nominatim resolves reliably.
     *
     * @return string[]
     */
    private static function buildQueries(string $address, ?string $cityName): array
    {
        $withCity = static function (string $s) use ($cityName): string {
            if ($cityName !== null && $cityName !== '' && stripos($s, $cityName) === false) {
                return $s . ', ' . $cityName;
            }
            return $s;
        };

        $queries = [$withCity($address)];

        $firstComponent = trim(explode(',', $address)[0]);
        // Strip a leading house number like "27 " or "27A ".
        $street = trim((string) preg_replace('/^\s*\d+[A-Za-z]?\s+/u', '', $firstComponent));
        if ($street !== '') {
            $candidate = $withCity($street);
            if (strcasecmp($candidate, $queries[0]) !== 0) {
                $queries[] = $candidate;
            }
        }
        return $queries;
    }

    /**
     * @return array{lat: float, lng: float}|null
     */
    private static function queryOne(string $query, ?string $countryCode, int $timeoutMs): ?array
    {
        $params = [
            'q'              => $query,
            'format'         => 'jsonv2',
            'limit'          => 1,
            'addressdetails' => 0,
        ];
        if ($countryCode !== null && $countryCode !== '') {
            $params['countrycodes'] = strtolower($countryCode);
        }

        self::throttle();

        $ch = curl_init(self::ENDPOINT . '?' . http_build_query($params));
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT_MS     => $timeoutMs,
            CURLOPT_HTTPHEADER     => [
                'User-Agent: ' . self::USER_AGENT,
                'Accept: application/json',
            ],
        ]);
        $body = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($body === false || $code !== 200) {
            return null;
        }

        $data = json_decode($body, true);
        if (!is_array($data) || count($data) === 0) {
            return null;
        }

        $lat = isset($data[0]['lat']) ? (float) $data[0]['lat'] : null;
        $lng = isset($data[0]['lon']) ? (float) $data[0]['lon'] : null;
        if ($lat === null || $lng === null) {
            return null;
        }
        // Reject the null island (0,0) - a common geocoder miss.
        if ($lat === 0.0 && $lng === 0.0) {
            return null;
        }

        return ['lat' => $lat, 'lng' => $lng];
    }

    /** Sleep just enough to keep ≥1s between Nominatim requests, process-wide. */
    private static function throttle(): void
    {
        $elapsed = microtime(true) - self::$lastCallAt;
        if (self::$lastCallAt > 0.0 && $elapsed < self::MIN_GAP_S) {
            usleep((int) ((self::MIN_GAP_S - $elapsed) * 1_000_000));
        }
        self::$lastCallAt = microtime(true);
    }
}
