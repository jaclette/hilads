#!/usr/bin/env php
<?php

/**
 * Seed recurring venue events for Hilads cities.
 *
 * For each city, fetches popular bars and coffee shops via Google Places API,
 * normalizes them into recurring event series (daily recurrence), and either
 * prints the JSON payload or imports it via the internal API endpoint.
 *
 * ── Usage ─────────────────────────────────────────────────────────────────────
 *
 *   # Collect data only — outputs JSON to stdout
 *   php seed_recurring_venues.php --google-key=XXX
 *
 *   # Collect + dry-run import (shows what would be created, no DB writes)
 *   php seed_recurring_venues.php --google-key=XXX --api-url=https://api.hilads.com --api-key=XXX --dry-run
 *
 *   # Full import
 *   php seed_recurring_venues.php --google-key=XXX --api-url=https://api.hilads.com --api-key=XXX --import
 *
 *   # Specific cities only
 *   php seed_recurring_venues.php --cities=1,2,3 --google-key=XXX --import ...
 *
 * ── Options ───────────────────────────────────────────────────────────────────
 *
 *   --cities=1,2,3    Comma-separated city IDs to process (default: top 20)
 *   --google-key=KEY  Google Places API key (or GOOGLE_PLACES_KEY env var)
 *   --api-url=URL     Hilads API base URL (or HILADS_API_URL env var)
 *   --api-key=KEY     MIGRATION_KEY for the import endpoint (or MIGRATION_KEY env var)
 *   --dry-run         Validate + count, but do not write to DB
 *   --import          Execute import after collecting data
 *   --bars=N          Number of bars per city (default: 4)
 *   --cafes=N         Number of cafes per city (default: 2)
 *   --output=FILE     Write JSON payload to file instead of stdout
 *   --help            Show this message and exit
 *
 * ── Defaults ──────────────────────────────────────────────────────────────────
 *
 *   Bars:       daily 18:00 → 01:00, event_type = drinks
 *   Coffee:     daily 10:00 → 18:00, event_type = coffee
 *   Recurrence: daily
 *   Source:     import
 */

declare(strict_types=1);

// ── Bootstrap ─────────────────────────────────────────────────────────────────

$opts = getopt('', [
    'cities:',
    'google-key:',
    'api-url:',
    'api-key:',
    'dry-run',
    'import',
    'bars:',
    'cafes:',
    'output:',
    'help',
]);

if (isset($opts['help'])) {
    echo file_get_contents(__FILE__);
    exit(0);
}

$googleKey  = $opts['google-key'] ?? getenv('GOOGLE_PLACES_KEY')  ?: null;
$apiUrl     = rtrim($opts['api-url'] ?? getenv('HILADS_API_URL')   ?: '', '/');
$apiKey     = $opts['api-key']    ?? getenv('MIGRATION_KEY')       ?: null;
$dryRun     = isset($opts['dry-run']);
$doImport   = isset($opts['import']) || $dryRun;
$barsCount  = max(1, (int) ($opts['bars']  ?? 4));
$cafesCount = max(1, (int) ($opts['cafes'] ?? 2));
$outputFile = $opts['output'] ?? null;

// Validate required args
if ($googleKey === null) {
    fwrite(STDERR, "ERROR: --google-key or GOOGLE_PLACES_KEY env var is required\n");
    exit(1);
}

if ($doImport && ($apiUrl === '' || $apiKey === null)) {
    fwrite(STDERR, "ERROR: --api-url and --api-key are required when using --import or --dry-run\n");
    exit(1);
}

// Load city definitions from the shared data file
$allCities = require __DIR__ . '/../api/src/cities_data.php';
$cityMap   = [];
foreach ($allCities as $c) {
    $cityMap[(int) $c['id']] = $c;
}

// Default: top 20 cities (IDs 1–20)
$defaultCityIds = range(1, 20);
$selectedIds    = isset($opts['cities'])
    ? array_map('intval', array_filter(explode(',', $opts['cities']), 'is_numeric'))
    : $defaultCityIds;

// ── Places fetcher ────────────────────────────────────────────────────────────

/**
 * Fetch nearby places from Google Places Nearby Search API.
 *
 * @param  string $apiKey  Google Places API key
 * @param  float  $lat     City latitude
 * @param  float  $lng     City longitude
 * @param  string $type    Google place type ('bar', 'cafe')
 * @param  int    $limit   Max results to return
 * @return array           Array of normalized place objects
 */
function fetchNearbyPlaces(string $apiKey, float $lat, float $lng, string $type, int $limit): array
{
    $params = http_build_query([
        'location'  => "{$lat},{$lng}",
        'radius'    => 5000,        // 5 km radius
        'type'      => $type,
        'rankby'    => 'prominence', // most well-known first
        'key'       => $apiKey,
    ]);

    $url = "https://maps.googleapis.com/maps/api/place/nearbysearch/json?{$params}";

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 8,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_USERAGENT      => 'hilads-seed/1.0',
    ]);

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlErr  = curl_error($ch);
    curl_close($ch);

    if ($response === false || $curlErr !== '') {
        throw new RuntimeException("Places API request failed: {$curlErr}");
    }

    if ($httpCode !== 200) {
        throw new RuntimeException("Places API returned HTTP {$httpCode}: {$response}");
    }

    $data = json_decode($response, true);

    if (!is_array($data)) {
        throw new RuntimeException("Places API returned invalid JSON");
    }

    $status = $data['status'] ?? 'UNKNOWN';
    if (!in_array($status, ['OK', 'ZERO_RESULTS'], true)) {
        throw new RuntimeException("Places API error: {$status} — " . ($data['error_message'] ?? ''));
    }

    $places = [];
    foreach (array_slice($data['results'] ?? [], 0, $limit) as $result) {
        $placeId = $result['place_id'] ?? null;
        $name    = $result['name']     ?? null;

        if (empty($placeId) || empty($name)) continue;

        $places[] = [
            'place_id' => $placeId,
            'name'     => $name,
            'address'  => $result['vicinity'] ?? null,
            'rating'   => $result['rating']   ?? null,
        ];
    }

    return $places;
}

// ── Normalizer ────────────────────────────────────────────────────────────────

/**
 * Turn a raw place result into a recurring series payload item.
 *
 * @param  int    $cityId    Integer city ID (1–N)
 * @param  string $placeId   Google place_id
 * @param  string $name      Venue name
 * @param  string|null $address
 * @param  string $category  'bar' or 'cafe'
 * @return array
 */
function normalizeSeries(int $cityId, string $placeId, string $name, ?string $address, string $category): array
{
    $isBar = $category === 'bar';

    return [
        'city_id'        => $cityId,
        'title'          => mb_substr($name, 0, 100),
        'event_type'     => $isBar ? 'drinks' : 'coffee',
        'location'       => $address,
        'start_time'     => $isBar ? '18:00' : '10:00',
        'end_time'       => $isBar ? '01:00' : '18:00',
        'recurrence_type'=> 'daily',
        // Stable fingerprint: same place+category always produces the same key
        'source_key'     => "places:v1:city_{$cityId}:{$placeId}:{$category}",
    ];
}

// ── Collection phase ──────────────────────────────────────────────────────────

$payload = [];
$log     = [];
$errors  = [];

foreach ($selectedIds as $cityId) {
    $city = $cityMap[$cityId] ?? null;

    if ($city === null) {
        $errors[] = "city_id={$cityId}: not found in cities_data.php — skipping";
        fwrite(STDERR, "WARN  city_id={$cityId}: not found\n");
        continue;
    }

    $cityName = $city['name'];
    fwrite(STDERR, "INFO  [{$cityId}] {$cityName}: fetching venues…\n");

    // Fetch bars
    $bars = [];
    try {
        $bars = fetchNearbyPlaces($googleKey, $city['lat'], $city['lng'], 'bar', $barsCount);
        fwrite(STDERR, "INFO  [{$cityId}] {$cityName}: got " . count($bars) . " bars\n");
    } catch (RuntimeException $e) {
        $errors[] = "city_id={$cityId} bars: " . $e->getMessage();
        fwrite(STDERR, "ERROR [{$cityId}] {$cityName} bars: " . $e->getMessage() . "\n");
    }

    // Fetch cafes
    $cafes = [];
    try {
        $cafes = fetchNearbyPlaces($googleKey, $city['lat'], $city['lng'], 'cafe', $cafesCount);
        fwrite(STDERR, "INFO  [{$cityId}] {$cityName}: got " . count($cafes) . " cafes\n");
    } catch (RuntimeException $e) {
        $errors[] = "city_id={$cityId} cafes: " . $e->getMessage();
        fwrite(STDERR, "ERROR [{$cityId}] {$cityName} cafes: " . $e->getMessage() . "\n");
    }

    foreach ($bars as $place) {
        $payload[] = normalizeSeries($cityId, $place['place_id'], $place['name'], $place['address'], 'bar');
    }

    foreach ($cafes as $place) {
        $payload[] = normalizeSeries($cityId, $place['place_id'], $place['name'], $place['address'], 'cafe');
    }

    $log[] = "city_id={$cityId} ({$cityName}): " . count($bars) . " bars + " . count($cafes) . " cafes";

    // Small delay between cities to stay within Places API rate limits
    if ($cityId !== end($selectedIds)) {
        usleep(200_000); // 200ms
    }
}

// ── Output phase ──────────────────────────────────────────────────────────────

$output = json_encode(['series' => $payload], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);

if ($outputFile !== null) {
    file_put_contents($outputFile, $output);
    fwrite(STDERR, "INFO  payload written to {$outputFile} (" . count($payload) . " series)\n");
} elseif (!$doImport) {
    // No --import flag: just print the payload so it can be piped / inspected
    echo $output . "\n";
}

// ── Import phase ──────────────────────────────────────────────────────────────

if ($doImport && count($payload) > 0) {
    $endpoint = "{$apiUrl}/internal/event-series/import?key=" . urlencode($apiKey)
        . ($dryRun ? '&dry_run=1' : '');

    fwrite(STDERR, "INFO  importing " . count($payload) . " series to {$apiUrl}" . ($dryRun ? ' (DRY RUN)' : '') . "…\n");

    $ch = curl_init($endpoint);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $output,
        CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
        CURLOPT_TIMEOUT        => 30,
        CURLOPT_SSL_VERIFYPEER => true,
    ]);

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlErr  = curl_error($ch);
    curl_close($ch);

    if ($response === false || $curlErr !== '') {
        fwrite(STDERR, "ERROR import request failed: {$curlErr}\n");
        exit(1);
    }

    $result = json_decode($response, true);

    if ($httpCode !== 200) {
        fwrite(STDERR, "ERROR import endpoint returned HTTP {$httpCode}: {$response}\n");
        exit(1);
    }

    fwrite(STDERR, "INFO  import result: created={$result['created']} skipped={$result['skipped']}\n");

    if (!empty($result['errors'])) {
        fwrite(STDERR, "WARN  import errors:\n");
        foreach ($result['errors'] as $err) {
            fwrite(STDERR, "      - {$err}\n");
        }
    }

    // Print import result as JSON to stdout for CI/logging
    echo json_encode([
        'ok'         => $result['ok'] ?? false,
        'dry_run'    => $dryRun,
        'collected'  => count($payload),
        'created'    => $result['created'] ?? 0,
        'skipped'    => $result['skipped'] ?? 0,
        'errors'     => array_merge($errors, $result['errors'] ?? []),
        'city_log'   => $log,
    ], JSON_PRETTY_PRINT) . "\n";
} elseif ($doImport && count($payload) === 0) {
    fwrite(STDERR, "WARN  no series collected — nothing to import\n");
    echo json_encode(['ok' => true, 'collected' => 0, 'created' => 0, 'skipped' => 0, 'errors' => $errors]) . "\n";
}

exit(empty($errors) ? 0 : 1);
