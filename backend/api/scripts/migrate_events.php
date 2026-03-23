<?php

/**
 * migrate_events.php — Phase 0: migrate all events from JSON files into PostgreSQL.
 *
 * Run once via Render Shell AFTER seed_cities.php:
 *   php scripts/migrate_events.php
 *
 * Safe to run multiple times — uses ON CONFLICT DO NOTHING / DO UPDATE.
 * Does NOT delete or modify the source JSON files.
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

$pdo = Database::pdo();
$now = time();

$chanStmt = $pdo->prepare("
    INSERT INTO channels (id, type, parent_id, name, status, created_at, updated_at)
    VALUES (:id, 'event', :parent_id, :name, :status, :created_at, :updated_at)
    ON CONFLICT (id) DO NOTHING
");

// For hilads events: dedup by channel_id (primary key only)
$hiladsEvStmt = $pdo->prepare("
    INSERT INTO channel_events
        (channel_id, source_type, guest_id, title, event_type,
         venue, location, venue_lat, venue_lng,
         starts_at, expires_at, image_url, external_url)
    VALUES
        (:channel_id, 'hilads', :guest_id, :title, :event_type,
         :venue, :location, :venue_lat, :venue_lng,
         to_timestamp(:starts_at), to_timestamp(:expires_at),
         :image_url, :external_url)
    ON CONFLICT (channel_id) DO NOTHING
");

// For TM events: dedup by (source_type, external_id) — update mutable fields if already exists
$tmEvStmt = $pdo->prepare("
    INSERT INTO channel_events
        (channel_id, source_type, external_id, title, event_type,
         venue, location, venue_lat, venue_lng,
         starts_at, expires_at, image_url, external_url, synced_at)
    VALUES
        (:channel_id, 'ticketmaster', :external_id, :title, :event_type,
         :venue, :location, :venue_lat, :venue_lng,
         to_timestamp(:starts_at), to_timestamp(:expires_at),
         :image_url, :external_url, :synced_at)
    ON CONFLICT (source_type, external_id) DO UPDATE SET
        title        = EXCLUDED.title,
        venue        = EXCLUDED.venue,
        location     = EXCLUDED.location,
        venue_lat    = EXCLUDED.venue_lat,
        venue_lng    = EXCLUDED.venue_lng,
        starts_at    = EXCLUDED.starts_at,
        expires_at   = EXCLUDED.expires_at,
        image_url    = EXCLUDED.image_url,
        external_url = EXCLUDED.external_url,
        synced_at    = EXCLUDED.synced_at
");

$files     = glob(Storage::dir() . '/events_*.json') ?: [];
$migrated  = 0;
$skipped   = 0;
$errors    = 0;

foreach ($files as $file) {
    if (!preg_match('/events_(\d+)\.json$/', $file, $m)) continue;

    $cityId   = (int) $m[1];
    $parentId = 'city_' . $cityId;

    // Verify parent city exists in DB
    $parentExists = $pdo->prepare("SELECT 1 FROM channels WHERE id = ?");
    $parentExists->execute([$parentId]);
    if (!$parentExists->fetchColumn()) {
        echo "WARN: parent $parentId not found — run seed_cities.php first. Skipping $file.\n";
        $skipped++;
        continue;
    }

    $events = json_decode(file_get_contents($file), true) ?? [];

    foreach ($events as $ev) {
        if (empty($ev['id']) || empty($ev['title']) || empty($ev['starts_at'])) {
            $skipped++;
            continue;
        }

        $source    = $ev['source'] ?? 'hilads';
        $status    = ($ev['expires_at'] ?? 0) < $now ? 'expired' : 'active';
        $createdAt = date('c', $ev['created_at'] ?? $now);
        $updatedAt = date('c', $ev['updated_at'] ?? $ev['created_at'] ?? $now);

        try {
            $pdo->beginTransaction();

            $chanStmt->execute([
                'id'         => $ev['id'],
                'parent_id'  => $parentId,
                'name'       => mb_substr($ev['title'], 0, 100),
                'status'     => $status,
                'created_at' => $createdAt,
                'updated_at' => $updatedAt,
            ]);

            $common = [
                'channel_id'  => $ev['id'],
                'title'       => mb_substr($ev['title'], 0, 100),
                'event_type'  => $ev['type'] ?? null,
                'venue'       => $ev['venue'] ?? null,
                'location'    => $ev['location'] ?? ($ev['location_hint'] ?? null),
                'venue_lat'   => isset($ev['venue_lat']) ? (float) $ev['venue_lat'] : null,
                'venue_lng'   => isset($ev['venue_lng']) ? (float) $ev['venue_lng'] : null,
                'starts_at'   => (int) $ev['starts_at'],
                'expires_at'  => (int) ($ev['expires_at'] ?? ($ev['starts_at'] + 10800)),
                'image_url'   => $ev['image_url'] ?? null,
                'external_url'=> $ev['external_url'] ?? null,
            ];

            if ($source === 'ticketmaster') {
                $tmEvStmt->execute(array_merge($common, [
                    'external_id' => $ev['external_id'] ?? null,
                    'synced_at'   => $updatedAt,
                ]));
            } else {
                $hiladsEvStmt->execute(array_merge($common, [
                    'guest_id' => $ev['guest_id'] ?? null,
                ]));
            }

            $pdo->commit();
            $migrated++;
        } catch (Throwable $e) {
            $pdo->rollBack();
            echo "ERROR event id={$ev['id']}: " . $e->getMessage() . "\n";
            $errors++;
        }
    }
}

echo "\nMigration complete.\n";
echo "  migrated : $migrated\n";
echo "  skipped  : $skipped\n";
echo "  errors   : $errors\n";

// Summary
$bySource = $pdo->query("SELECT source_type, COUNT(*) AS n FROM channel_events GROUP BY source_type")->fetchAll(PDO::FETCH_ASSOC);
echo "\nEvents in DB by source:\n";
foreach ($bySource as $row) {
    echo "  {$row['source_type']}: {$row['n']}\n";
}

$active = $pdo->query("SELECT COUNT(*) FROM channel_events WHERE expires_at > now()")->fetchColumn();
echo "  active (not expired): $active\n";
