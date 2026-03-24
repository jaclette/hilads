<?php

declare(strict_types=1);

/**
 * Thin wrapper around the Google Places API (New) — Text Search.
 * Returns normalized place objects — no business logic here.
 *
 * API: POST https://places.googleapis.com/v1/places:searchText
 * Docs: https://developers.google.com/maps/documentation/places/web-service/text-search
 */
class PlacesService
{
    private const TIMEOUT  = 8;
    private const ENDPOINT = 'https://places.googleapis.com/v1/places:searchText';

    // Only request the fields we actually use — keeps response small and avoids
    // billing for unused field classes (Basic vs Advanced vs Preferred tiers).
    private const FIELD_MASK = 'places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount';

    /**
     * Search for places matching $query near the given coordinates.
     *
     * @param  string $query  e.g. "popular bars in Paris"
     * @param  float  $lat    City centre latitude
     * @param  float  $lng    City centre longitude
     * @param  int    $limit  Max results to return after filtering and sorting
     * @return array          Array of [ place_id, name, address, rating ]
     * @throws RuntimeException on API or network error
     */
    public static function search(string $query, float $lat, float $lng, int $limit): array
    {
        $apiKey = getenv('GOOGLE_PLACES_API_KEY') ?: '';
        if ($apiKey === '') {
            throw new RuntimeException('GOOGLE_PLACES_API_KEY env var is not set');
        }

        // Places API (New) uses POST with a JSON body.
        // maxResultCount 20 is the API maximum — we request all available so
        // the quality filter has the largest pool to work with before slicing.
        $body = json_encode([
            'textQuery'      => $query,
            'maxResultCount' => 20,
            'locationBias'   => [
                'circle' => [
                    'center' => ['latitude' => $lat, 'longitude' => $lng],
                    'radius' => 5000.0,
                ],
            ],
        ]);

        $ch = curl_init(self::ENDPOINT);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => $body,
            CURLOPT_HTTPHEADER     => [
                'Content-Type: application/json',
                'X-Goog-Api-Key: ' . $apiKey,
                'X-Goog-FieldMask: ' . self::FIELD_MASK,
            ],
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

        $data = json_decode($response, true);
        if (!is_array($data)) {
            throw new RuntimeException('Places API returned invalid JSON');
        }

        // The new API surfaces errors as { "error": { "code": N, "message": "..." } }
        // with a matching HTTP status code — not a legacy "status" string field.
        if ($httpCode !== 200) {
            $msg = $data['error']['message'] ?? "HTTP {$httpCode}";
            throw new RuntimeException("Places API error: {$msg}");
        }

        // Zero results → response is {} (no "places" key) — not an error.

        // ── Filter ────────────────────────────────────────────────────────────
        // Process all returned places, then sort + slice.
        // Slicing before filtering would produce fewer results than requested
        // when some entries fail the quality checks.

        $places = [];
        foreach ($data['places'] ?? [] as $place) {
            // Places API (New) response field mapping vs legacy:
            //   place_id          → id
            //   name              → displayName.text
            //   formatted_address → formattedAddress
            //   user_ratings_total→ userRatingCount
            $placeId = $place['id']                     ?? null;
            $name    = trim($place['displayName']['text'] ?? '');
            $address = trim($place['formattedAddress']    ?? '');

            // Hard requirements: id, name, formatted address, rating
            if (empty($placeId) || $name === '' || $address === '') {
                continue;
            }

            if (!isset($place['rating'])) {
                continue;
            }

            $places[] = [
                'place_id'     => $placeId,
                'name'         => $name,
                'address'      => $address,
                'rating'       => (float) $place['rating'],
                // Used for sorting only — stripped before returning to callers
                '_review_count'=> (int) ($place['userRatingCount'] ?? 0),
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
