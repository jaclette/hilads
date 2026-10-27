<?php

declare(strict_types=1);

/**
 * V5-01 step 3: the reviewed scripts/city_geonames.csv as SQL, to run in
 * DataGrip after migrate.php (cities.geoname_id must exist). Read-only here:
 * prints the SQL, touches no database.
 *
 *   php scripts/city_geonames_apply.php > /tmp/city_geonames_apply.sql
 *
 * - each seed gets its GeoNames id (once it is set, placement switches from
 *   the legacy nearest city to GeoNames, within the hour the city list is cached);
 * - a pinned city (Bali) moves to its GeoNames city's position, name kept;
 * - a GeoNames timezone that differs (Asia/Rangoon → Asia/Yangon) is taken;
 * - a duplicate seed (merge_into) stays unmapped: merge it into its twin with
 *   the back office (Cities › Merge) - geoname_id is unique.
 */

$csv = __DIR__ . '/city_geonames.csv';
$fh  = fopen($csv, 'r');
if ($fh === false) {
    fwrite(STDERR, "Cannot read {$csv}\n");
    exit(1);
}
$header = fgetcsv($fh, null, ",", "\"", "");

$out    = ["-- V5-01: map the seed cities to GeoNames (from scripts/city_geonames.csv)", "BEGIN;"];
$mapped = 0;
$merges = [];
while (($row = fgetcsv($fh, null, ",", "\"", "")) !== false) {
    $r  = array_combine($header, $row);
    $id = $r['id'];
    if (!preg_match('/^city_\d+$/', $id) || !ctype_digit($r['geoname_id'])) {
        fwrite(STDERR, "Skipped {$id}: no GeoNames id\n");
        continue;
    }
    if ($r['merge_into'] !== '') {
        $merges[] = "--   {$id} {$r['name']} → {$r['merge_into']}";
        continue;
    }
    $gid   = (int) $r['geoname_id'];
    $out[] = "UPDATE cities SET geoname_id = {$gid} WHERE channel_id = '{$id}';";
    if ($r['status'] === 'pinned') {
        $out[] = "UPDATE cities c SET lat = g.lat, lng = g.lng FROM geo_cities g WHERE g.geoname_id = {$gid} AND c.channel_id = '{$id}';";
    }
    if ($r['tz_differs'] !== '') {
        $out[] = "UPDATE cities c SET timezone = g.timezone FROM geo_cities g WHERE g.geoname_id = {$gid} AND c.channel_id = '{$id}';";
    }
    $mapped++;
}
fclose($fh);

$out[] = "COMMIT;";
$out[] = "-- {$mapped} cities mapped.";
if ($merges) {
    $out[] = "-- Left unmapped, merge in the back office (Cities › Merge):";
    array_push($out, ...$merges);
}
echo implode("\n", $out), "\n";
