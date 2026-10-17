<?php
/**
 * V3-02 places migration (SPEC 9.5 / 9.10). The logic lives in PlacesMigration
 * (also run from the back office: /admin/daily/spots/migration, V3-05).
 *
 *   php scripts/places_migrate.php            # dry run: report only, writes nothing
 *   php scripts/places_migrate.php --apply    # do it
 *
 * 1. V1 pins → places: approved Daily proofs pinned in 1.x (place_lat/lng/name,
 *    no place_id yet) are grouped by city, same name and within 40 m
 *    (Places::groupPins); each group becomes an approved place (a spot), or
 *    joins an existing place with the same name within 40 m, and its proofs
 *    get place_id. Pins without a name are reported and left alone.
 * 2. Validated user challenges with a venue: report only. They have a venue
 *    text but no coordinates and no Daily proof, so they are reviewed by hand
 *    in the back office (V3-05).
 * 3. Google data: the venues seeded from Google Places (event_series with
 *    source_key 'places:v1:…') and their event channels are deleted (Google
 *    is out of Hilads, SPEC 9.5). Messages and participants of those channels
 *    go with them (ON DELETE CASCADE).
 *
 * Idempotent: a re-run only touches pins still without a place and venues
 * still present. Run it from the Render Shell, dry run first.
 */

declare(strict_types=1);

$apply = in_array('--apply', $argv, true);

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

try {
    $pdo = new PDO($dsn, isset($parts['user']) ? urldecode($parts['user']) : null,
        isset($parts['pass']) ? urldecode($parts['pass']) : null, [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
} catch (PDOException $e) {
    fwrite(STDERR, "ERROR: DB connection failed: " . $e->getMessage() . "\n");
    exit(1);
}

require_once __DIR__ . '/../src/Places.php';
require_once __DIR__ . '/../src/PlacesMigration.php';

echo $apply ? "== APPLY ==\n\n" : "== DRY RUN (nothing is written; add --apply) ==\n\n";
$r = PlacesMigration::run($pdo, $apply);

$new = count(array_filter($r['pins']['groups'], static fn(array $g): bool => $g['action'] === 'new'));
echo "1. V1 pins: {$r['pins']['total']} approved pinned proofs without a place, " . count($r['pins']['groups'])
   . " places, " . count($r['pins']['skipped']) . " skipped\n";
foreach ($r['pins']['groups'] as $g) {
    printf("   %s %-40s %s  %.5f,%.5f  %d proof(s)\n", $g['action'] === 'new' ? 'NEW ' : 'JOIN',
        mb_strimwidth($g['name'], 0, 40, '…'), $g['city_id'], $g['lat'], $g['lng'], $g['proofs']);
}
foreach ($r['pins']['skipped'] as $p) {
    echo "   SKIP proof {$p['id']} ({$p['why']})\n";
}
echo "   => " . ($apply ? '' : 'would ') . "create {$new} place(s), join " . (count($r['pins']['groups']) - $new) . " existing\n\n";

echo "2. Validated challenges with a venue (seed the ones worth it from the back office): " . count($r['challenges']) . "\n";
foreach ($r['challenges'] as $c) {
    printf("   %s %s  \"%s\" @ %s\n", $c['channel_id'], $c['city_id'], mb_strimwidth((string) $c['title'], 0, 50, '…'),
        mb_strimwidth((string) $c['venue'], 0, 50, '…'));
}
echo "\n3. Google-seeded venues: " . count($r['google']['series']) . " series, {$r['google']['channels']} event channel(s)\n";
foreach ($r['google']['series'] as $v) {
    printf("   DELETE %s %s  %s\n", $v['id'], $v['city_id'], mb_strimwidth((string) $v['title'], 0, 60, '…'));
}
echo "   => " . ($r['google']['series'] === [] ? 'nothing to delete'
    : ($r['google']['deleted'] ? 'deleted' : ($apply ? 'nothing deleted' : 'would delete them'))) . "\n";
foreach ($r['errors'] as $e) {
    echo "ERROR: {$e}\n";
}
echo "\nDone.\n";
exit($r['errors'] === [] ? 0 : 1);
