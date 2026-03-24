<?php

declare(strict_types=1);

/**
 * Orchestrates venue seeding: for each city, fetches bars + coffee shops
 * from Google Places, normalises them into event series payloads, and
 * delegates to EventSeriesRepository::importBatch() for dedup + storage.
 *
 * Dedup key format: places:v1:city_{id}:{place_id}:{category}
 * This is stable — re-running for the same cities always produces the same keys.
 */
class VenueSeeder
{
    // ── Defaults ──────────────────────────────────────────────────────────────

    private const BAR_START    = '18:00';
    private const BAR_END      = '01:00';
    private const COFFEE_START = '10:00';
    private const COFFEE_END   = '18:00';

    /**
     * Run the seeding pipeline for the given city IDs.
     *
     * @param  int[]  $cityIds           Cities to seed
     * @param  bool   $dryRun            If true, nothing is written to DB
     * @param  int    $barsLimit         Max bars per city
     * @param  int    $coffeeLimit       Max coffee shops per city
     * @return array  { created, skipped, errors, cities, preview? }
     */
    public static function run(
        array $cityIds,
        bool  $dryRun      = false,
        int   $barsLimit   = 4,
        int   $coffeeLimit = 2
    ): array {
        $items    = [];
        $cityLog  = [];
        $errors   = [];

        foreach ($cityIds as $cityId) {
            $cityId = (int) $cityId;
            $city   = CityRepository::findById($cityId);

            if ($city === null) {
                $errors[]  = "city_id={$cityId}: not found";
                $cityLog[] = ['city_id' => $cityId, 'error' => 'not found'];
                error_log("[VenueSeeder] city_id={$cityId}: not found — skipping");
                continue;
            }

            $cityName = $city['name'];
            error_log("[VenueSeeder] city_id={$cityId} ({$cityName}): fetching venues");

            // ── Bars ──────────────────────────────────────────────────────────
            $barItems = [];
            try {
                $bars = PlacesService::search("popular bars in {$cityName}", $city['lat'], $city['lng'], $barsLimit);
                foreach ($bars as $place) {
                    $barItems[] = self::buildItem($cityId, $place, 'bar');
                }
                error_log("[VenueSeeder] city_id={$cityId}: " . count($bars) . " bars found");
            } catch (RuntimeException $e) {
                $errors[] = "city_id={$cityId} bars: " . $e->getMessage();
                error_log("[VenueSeeder] city_id={$cityId} bars ERROR: " . $e->getMessage());
            }

            // ── Coffee shops ──────────────────────────────────────────────────
            $cafeItems = [];
            try {
                $cafes = PlacesService::search("coffee shops in {$cityName}", $city['lat'], $city['lng'], $coffeeLimit);
                foreach ($cafes as $place) {
                    $cafeItems[] = self::buildItem($cityId, $place, 'cafe');
                }
                error_log("[VenueSeeder] city_id={$cityId}: " . count($cafes) . " cafes found");
            } catch (RuntimeException $e) {
                $errors[] = "city_id={$cityId} cafes: " . $e->getMessage();
                error_log("[VenueSeeder] city_id={$cityId} cafes ERROR: " . $e->getMessage());
            }

            $items    = array_merge($items, $barItems, $cafeItems);
            $cityLog[] = [
                'city_id' => $cityId,
                'name'    => $cityName,
                'bars'    => count($barItems),
                'cafes'   => count($cafeItems),
            ];

            // Brief pause between cities to stay within Places API rate limits
            if ($cityId !== end($cityIds)) {
                usleep(150_000); // 150ms
            }
        }

        // ── Dry-run: check DB without writing, return full split preview ─────────
        if ($dryRun) {
            $existing   = self::fetchExistingKeys(array_column($items, 'source_key'));
            $toCreate   = array_values(array_filter($items, fn($i) => !in_array($i['source_key'], $existing, true)));
            $alreadyHas = array_values(array_filter($items, fn($i) =>  in_array($i['source_key'], $existing, true)));

            return [
                'ok'      => empty($errors),
                'dry_run' => true,
                'created' => count($toCreate),
                'skipped' => count($alreadyHas),
                'errors'  => $errors,
                'cities'  => $cityLog,
                'preview' => [
                    'to_create'      => $toCreate,
                    'already_exists' => $alreadyHas,
                ],
            ];
        }

        // ── Real run: delegate dedup + storage to importBatch ─────────────────
        $result = EventSeriesRepository::importBatch($items, false);

        $result['cities']  = $cityLog;
        $result['errors']  = array_merge($errors, $result['errors'] ?? []);
        $result['preview'] = null;

        return $result;
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    /**
     * One batch query for all source_keys — avoids N+1 in dry-run mode.
     *
     * @param  string[] $keys
     * @return string[]  Keys that already exist in event_series
     */
    private static function fetchExistingKeys(array $keys): array
    {
        if (empty($keys)) {
            return [];
        }

        $placeholders = implode(',', array_fill(0, count($keys), '?'));
        $stmt = Database::pdo()->prepare(
            "SELECT source_key FROM event_series WHERE source_key IN ({$placeholders})"
        );
        $stmt->execute($keys);

        return $stmt->fetchAll(PDO::FETCH_COLUMN) ?: [];
    }

    private static function buildItem(int $cityId, array $place, string $category): array
    {
        $isBar = $category === 'bar';

        return [
            'city_id'        => $cityId,
            'title'          => $place['name'],
            'event_type'     => $isBar ? 'drinks' : 'coffee',
            'location'       => $place['address'],
            'start_time'     => $isBar ? self::BAR_START    : self::COFFEE_START,
            'end_time'       => $isBar ? self::BAR_END      : self::COFFEE_END,
            'recurrence_type'=> 'daily',
            // Stable fingerprint: same place + city + category → same key forever
            'source_key'     => "places:v1:city_{$cityId}:{$place['place_id']}:{$category}",
        ];
    }
}
