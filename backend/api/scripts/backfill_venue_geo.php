<?php
/**
 * Backfill lat/lng on event_series venue rows that were seeded before
 * PlacesService.FIELD_MASK included `places.location`.
 *
 *   php scripts/backfill_venue_geo.php          # do it
 *   php scripts/backfill_venue_geo.php --dry    # show plan, don't write
 *
 * Strategy:
 *   - Selects event_series rows with source='import', source_key LIKE
 *     'places:v1:%', and either lat or lng NULL.
 *   - Extracts the place_id from source_key (format:
 *     places:v1:city_<n>:<place_id>:<category>).
 *   - Calls PlacesService::detailsById to fetch fresh lat/lng.
 *   - UPDATEs the row. Skips on any failure (logs and continues).
 *
 * Cost: one Places API Details call per venue. At Google's $5/1000 rate
 * that's ~$0.005 per venue. ~70 venues today → under $0.50 total.
 *
 * Limitations:
 *   - Cannot backfill source_key starting with 'static:v1:' — those are
 *     fixture-seeded venues with no place_id. They need manual lat/lng
 *     in src/venues_seed.php if you want geo coverage.
 *   - GOOGLE_PLACES_API_KEY must be set in the environment (same key the
 *     seeder uses).
 *
 * Idempotent: re-runs only touch rows still missing lat or lng.
 */

declare(strict_types=1);

$dryRun = in_array('--dry', $argv, true);

// ── .env + PDO (same pattern as migrate.php) ────────────────────────────────

$envFile = __DIR__ . '/../.env';
if (file_exists($envFile)) {
    $vars = @parse_ini_file($envFile);
    if (is_array($vars)) {
        foreach ($vars as $key => $value) putenv("$key=$value");
    }
}

$url = getenv('DATABASE_URL');
if (!$url) { fwrite(STDERR, "ERROR: DATABASE_URL is not set\n"); exit(1); }

$parts   = parse_url($url);
$sslmode = getenv('PG_SSLMODE') ?: 'require';
$dsn     = sprintf('pgsql:host=%s;port=%s;dbname=%s;sslmode=%s',
    $parts['host'], $parts['port'] ?? 5432, ltrim($parts['path'], '/'), $sslmode);

$user = isset($parts['user']) ? urldecode($parts['user']) : null;
$pass = isset($parts['pass']) ? urldecode($parts['pass']) : null;

try {
    $pdo = new PDO($dsn, $user, $pass, [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
} catch (PDOException $e) {
    fwrite(STDERR, "ERROR: DB connection failed: " . $e->getMessage() . "\n");
    exit(1);
}

// PlacesService needs the project autoloader + the class file. Keep this
// minimal — we only need PlacesService::detailsById.
require_once __DIR__ . '/../vendor/autoload.php';
require_once __DIR__ . '/../src/PlacesService.php';

if (!getenv('GOOGLE_PLACES_API_KEY')) {
    fwrite(STDERR, "ERROR: GOOGLE_PLACES_API_KEY is not set\n");
    exit(1);
}

// ── Identify backfill targets ────────────────────────────────────────────────

$rows = $pdo->query("
    SELECT id, title, source_key
      FROM event_series
     WHERE source = 'import'
       AND source_key LIKE 'places:v1:%'
       AND (lat IS NULL OR lng IS NULL)
       AND (ends_on IS NULL OR ends_on >= CURRENT_DATE)
     ORDER BY title
")->fetchAll();

$total   = count($rows);
$skipped = $pdo->query("
    SELECT count(*) FROM event_series
     WHERE source = 'import'
       AND source_key LIKE 'static:v1:%'
       AND (lat IS NULL OR lng IS NULL)
")->fetchColumn();

echo "\nBackfilling venue lat/lng…\n";
echo "  Targets (places:v1 with NULL geo): $total\n";
echo "  Static venues without geo (skipped — no place_id): $skipped\n";
if ($dryRun) echo "  DRY RUN — no writes\n";
echo "\n";

if ($total === 0) { echo "Nothing to do.\n"; exit(0); }

// ── Backfill loop ────────────────────────────────────────────────────────────

$update = $pdo->prepare("UPDATE event_series SET lat = ?, lng = ? WHERE id = ?");
$updated = 0;
$failed  = 0;

foreach ($rows as $row) {
    // source_key format: places:v1:city_<n>:<place_id>:<category>
    // place_id can contain anything URL-safe — split on ':' deterministically.
    $parts = explode(':', (string) $row['source_key']);
    if (count($parts) < 5) {
        echo "  SKIP {$row['id']} ({$row['title']}) — malformed source_key\n";
        $failed++;
        continue;
    }
    // Reassemble in case place_id contained colons (unlikely but defensive).
    $placeId = implode(':', array_slice($parts, 3, count($parts) - 4));

    try {
        $details = PlacesService::detailsById($placeId);
    } catch (\Throwable $e) {
        echo "  ERR  {$row['id']} ({$row['title']}) — " . $e->getMessage() . "\n";
        $failed++;
        usleep(200_000);
        continue;
    }

    if ($details === null || !isset($details['lat'], $details['lng'])) {
        echo "  MISS {$row['id']} ({$row['title']}) — no geo in Places response\n";
        $failed++;
        usleep(200_000);
        continue;
    }

    if (!$dryRun) {
        $update->execute([$details['lat'], $details['lng'], $row['id']]);
    }
    $updated++;
    echo sprintf("  OK   %s (%-35s) → %.6f, %.6f\n",
        $row['id'], mb_substr($row['title'], 0, 35), $details['lat'], $details['lng']);

    // Stay polite to Places API (~5 RPS).
    usleep(200_000);
}

echo "\n";
echo "  Updated:  $updated\n";
echo "  Failed:   $failed\n";
echo "  Total:    $total\n";
if ($dryRun) echo "  (DRY RUN — nothing written)\n";
echo "\nDone.\n";
