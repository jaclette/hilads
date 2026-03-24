<?php

declare(strict_types=1);

/**
 * Thin wrapper around the Google Places Text Search API.
 * Returns normalized place objects — no business logic here.
 */
class PlacesService
{
    private const TIMEOUT  = 8;
    private const BASE_URL = 'https://maps.googleapis.com/maps/api/place/textsearch/json';

    /**
     * Search for places matching $query near the given coordinates.
     *
     * @param  string $query  e.g. "popular bars in Paris"
     * @param  float  $lat    City centre latitude
     * @param  float  $lng    City centre longitude
     * @param  int    $limit  Max results to return (slice from top of ranked list)
     * @return array          Array of [ place_id, name, address, rating|null ]
     * @throws RuntimeException on API or network error
     */
    public static function search(string $query, float $lat, float $lng, int $limit): array
    {
        $apiKey = getenv('GOOGLE_PLACES_API_KEY') ?: '';
        if ($apiKey === '') {
            throw new RuntimeException('GOOGLE_PLACES_API_KEY env var is not set');
        }

        $url = self::BASE_URL . '?' . http_build_query([
            'query'    => $query,
            'location' => "{$lat},{$lng}",
            'radius'   => 5000,
            'key'      => $apiKey,
        ]);

        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => self::TIMEOUT,
            CURLOPT_CONNECTTIMEOUT => self::TIMEOUT,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_USERAGENT      => 'hilads/1.0',
        ]);

        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlErr  = curl_error($ch);
        curl_close($ch);

        if ($response === false || $curlErr !== '') {
            throw new RuntimeException("Places API request failed: {$curlErr}");
        }

        if ($httpCode !== 200) {
            throw new RuntimeException("Places API returned HTTP {$httpCode}");
        }

        $data = json_decode($response, true);
        if (!is_array($data)) {
            throw new RuntimeException('Places API returned invalid JSON');
        }

        $status = $data['status'] ?? '';
        if (!in_array($status, ['OK', 'ZERO_RESULTS'], true)) {
            $msg = $data['error_message'] ?? $status;
            throw new RuntimeException("Places API error: {$msg}");
        }

        // ── Filter ────────────────────────────────────────────────────────────
        // Process all results the API returned (up to 20), then sort + slice.
        // Slicing before filtering would produce fewer results than requested
        // when some entries fail the quality checks.

        $places = [];
        foreach ($data['results'] ?? [] as $result) {
            $placeId = $result['place_id']          ?? null;
            $name    = trim($result['name']          ?? '');
            $address = trim($result['formatted_address'] ?? '');

            // Hard requirements: place_id, name, formatted_address, rating
            if (empty($placeId) || $name === '' || $address === '') {
                continue;
            }

            if (!isset($result['rating'])) {
                continue;
            }

            $places[] = [
                'place_id'     => $placeId,
                'name'         => $name,
                'address'      => $address,
                'rating'       => (float) $result['rating'],
                // Used for sorting — not exposed to callers
                '_review_count'=> (int) ($result['user_ratings_total'] ?? 0),
            ];
        }

        // ── Sort by review count desc (more reviews = more established venue) ─
        usort($places, fn($a, $b) => $b['_review_count'] <=> $a['_review_count']);

        // Strip the internal sort key and take the top $limit results
        return array_map(
            fn($p) => ['place_id' => $p['place_id'], 'name' => $p['name'], 'address' => $p['address'], 'rating' => $p['rating']],
            array_slice($places, 0, $limit)
        );
    }
}
