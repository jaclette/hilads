<?php
/**
 * V5-01 step 2: which GeoNames city each of our 350 seed cities is
 * (src/cities_data.php → geo_cities). Writes scripts/city_geonames.csv for a
 * human review; the reviewed CSV (geoname_id column) is what step 3 loads
 * into cities.geoname_id.
 *
 *   DATABASE_URL=… php scripts/city_geonames_map.php
 *
 * Needs the GeoNames base loaded (geonames_import.php --load). Read-only.
 *
 * Columns:
 *   match   - same country, within 40 km, the name matches (any locale or
 *             alternate spelling); the most populous such city
 *   placed  - what CityPlacement gives at our coordinates today
 *   status  - ok           match found and placement lands on it
 *             absorbed     match found but placement sends our centre to a
 *                          bigger neighbour: keep it (override) or merge
 *             no_match     no name match: placed city proposed, check it
 *             duplicate    another seed city maps to the same GeoNames city
 *             collision    city_<geoname_id> is one of our other seed ids
 */

declare(strict_types=1);

require_once __DIR__ . '/../vendor/autoload.php';
require_once __DIR__ . '/../src/Database.php';
require_once __DIR__ . '/../src/CityPlacement.php';

$pdo    = Database::pdo();
$cities = require __DIR__ . '/../src/cities_data.php';
$seedIds = array_flip(array_column($cities, 'id'));

function norm(string $s): string
{
    $s = @iconv('UTF-8', 'ASCII//TRANSLIT', $s) ?: $s;
    return preg_replace('/[^a-z0-9]/', '', strtolower($s));
}

$near = $pdo->prepare("
    SELECT geoname_id, name, country, admin1, population, timezone, lat, lng
    FROM geo_cities
    WHERE country = ? AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?
");
$names = $pdo->prepare("SELECT DISTINCT name FROM geo_city_names WHERE geoname_id = ?");

$rows = [];
foreach ($cities as $c) {
    $dLat = 40 / 111.0;
    $dLng = 40 / (111.0 * max(cos(deg2rad($c['lat'])), 0.01));
    $near->execute([$c['country'], $c['lat'] - $dLat, $c['lat'] + $dLat, $c['lng'] - $dLng, $c['lng'] + $dLng]);
    $want  = norm($c['name']);
    $match = null;
    foreach ($near->fetchAll(PDO::FETCH_ASSOC) as $g) {
        if (CityPlacement::distanceKm($c['lat'], $c['lng'], (float) $g['lat'], (float) $g['lng']) > 40) continue;
        $names->execute([$g['geoname_id']]);
        $all = array_map('norm', array_merge([$g['name']], $names->fetchAll(PDO::FETCH_COLUMN)));
        $all = array_filter($all, fn($n) => $n !== '');
        $hit = in_array($want, $all, true)
            || array_filter($all, fn($n) => (str_starts_with($n, $want) || str_starts_with($want, $n)) && min(strlen($n), strlen($want)) >= 5);
        if ($hit && ($match === null || (int) $g['population'] > (int) $match['population'])) $match = $g;
    }
    $placed = CityPlacement::place($pdo, (float) $c['lat'], (float) $c['lng']);
    $pick   = $match ?? $placed;
    $status = $match === null ? 'no_match' : ((int) $match['geoname_id'] === (int) ($placed['geoname_id'] ?? 0) ? 'ok' : 'absorbed');
    $rows[] = [
        'id'             => "city_{$c['id']}",
        'name'           => $c['name'],
        'country'        => $c['country'],
        'geoname_id'     => $pick['geoname_id'] ?? '',
        'geo_name'       => $pick['name'] ?? '',
        'geo_population' => $pick['population'] ?? '',
        'geo_km'         => $pick ? round(CityPlacement::distanceKm($c['lat'], $c['lng'], (float) $pick['lat'], (float) $pick['lng']), 1) : '',
        'tz_differs'     => $pick && $pick['timezone'] !== $c['timezone'] ? "{$c['timezone']} → {$pick['timezone']}" : '',
        'placed_id'      => $placed['geoname_id'] ?? '',
        'placed_name'    => $placed['name'] ?? '',
        'status'         => $status,
    ];
}

// A GeoNames city shared by two seeds, or city_<geoname_id> taken by another seed.
$count = array_count_values(array_filter(array_column($rows, 'geoname_id')));
foreach ($rows as &$r) {
    if ($r['geoname_id'] !== '' && $count[$r['geoname_id']] > 1) $r['status'] .= ' duplicate';
    if ($r['geoname_id'] !== '' && isset($seedIds[(int) $r['geoname_id']]) && "city_{$r['geoname_id']}" !== $r['id']) $r['status'] .= ' collision';
}
unset($r);

$out = fopen(__DIR__ . '/city_geonames.csv', 'w');
fputcsv($out, array_keys($rows[0]), ',', '"', '');
foreach ($rows as $r) fputcsv($out, $r, ',', '"', '');
fclose($out);

$byStatus = array_count_values(array_column($rows, 'status'));
ksort($byStatus);
foreach ($byStatus as $s => $n) fwrite(STDERR, str_pad($s, 24) . "{$n}\n");
