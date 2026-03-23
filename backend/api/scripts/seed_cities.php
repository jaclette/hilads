<?php

/**
 * seed_cities.php — Phase 0: seed all cities into PostgreSQL channels + cities tables.
 *
 * Run once via Render Shell:
 *   php scripts/seed_cities.php
 *
 * Safe to run multiple times — uses ON CONFLICT DO NOTHING.
 */

declare(strict_types=1);

require_once __DIR__ . '/../src/Storage.php';
require_once __DIR__ . '/../src/Database.php';

$envFile = __DIR__ . '/../.env';
if (file_exists($envFile)) {
    $vars = @parse_ini_file($envFile);
    if (is_array($vars)) {
        foreach ($vars as $k => $v) putenv("$k=$v");
    }
}

$pdo    = Database::pdo();
$cities = require __DIR__ . '/../src/cities_data.php';

$chanStmt = $pdo->prepare("
    INSERT INTO channels (id, type, name, created_at, updated_at)
    VALUES (:id, 'city', :name, now(), now())
    ON CONFLICT (id) DO NOTHING
");

$cityStmt = $pdo->prepare("
    INSERT INTO cities (channel_id, country, lat, lng, timezone)
    VALUES (:channel_id, :country, :lat, :lng, :timezone)
    ON CONFLICT (channel_id) DO NOTHING
");

$inserted = 0;
$skipped  = 0;

foreach ($cities as $city) {
    $id = 'city_' . $city['id'];

    $chanStmt->execute(['id' => $id, 'name' => $city['name']]);
    $cityStmt->execute([
        'channel_id' => $id,
        'country'    => $city['country'],
        'lat'        => $city['lat'],
        'lng'        => $city['lng'],
        'timezone'   => $city['timezone'],
    ]);

    if ($chanStmt->rowCount() > 0) {
        $inserted++;
    } else {
        $skipped++;
    }
}

echo "Cities seeded: inserted=$inserted skipped=$skipped total=" . count($cities) . "\n";

// Verify
$count = $pdo->query("SELECT COUNT(*) FROM channels WHERE type='city'")->fetchColumn();
echo "Verification: channels WHERE type='city' = $count\n";
