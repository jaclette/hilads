<?php
/**
 * V3-02 places migration (SPEC 9.5 / 9.10).
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

echo $apply ? "== APPLY ==\n\n" : "== DRY RUN (nothing is written; add --apply) ==\n\n";

// ── 1. V1 pins → places ──────────────────────────────────────────────────────

$pins = $pdo->query("
    SELECT id, city_id, user_id, place_lat AS lat, place_lng AS lng, place_name AS name
    FROM daily_proofs
    WHERE place_lat IS NOT NULL AND place_id IS NULL AND moderation_status = 'approved'
    ORDER BY approved_at, id
")->fetchAll();
$unnamed = array_values(array_filter($pins, static fn(array $p): bool =>
    trim((string) $p['name']) === '' || $p['city_id'] === null));
$groups  = Places::groupPins($pins);

/** An existing place with the same name within the group radius, else null. */
$existing = static function (array $g) use ($pdo): ?string {
    [$minLat, $maxLat, $minLng, $maxLng] = Places::boundingBox($g['lat'], $g['lng'], Places::PIN_GROUP_RADIUS_M);
    $stmt = $pdo->prepare("
        SELECT id, name, lat, lng FROM places
        WHERE city_id = ? AND merged_into IS NULL AND status <> 'rejected'
          AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?
    ");
    $stmt->execute([$g['city_id'], $minLat, $maxLat, $minLng, $maxLng]);
    foreach ($stmt->fetchAll() as $r) {
        if (Places::normalizeName($r['name']) === Places::normalizeName($g['name'])
            && Places::distanceM($g['lat'], $g['lng'], (float) $r['lat'], (float) $r['lng']) <= Places::PIN_GROUP_RADIUS_M) {
            return $r['id'];
        }
    }
    return null;
};

echo "1. V1 pins: " . count($pins) . " approved pinned proofs without a place, "
   . count($groups) . " places, " . count($unnamed) . " skipped (no name or no city)\n";
$created = $joined = 0;
foreach ($groups as $g) {
    $target = $existing($g);
    printf("   %s %-40s %s  %.5f,%.5f  %d proof(s)\n", $target ? 'JOIN' : 'NEW ',
        mb_strimwidth($g['name'], 0, 40, '…'), $g['city_id'], $g['lat'], $g['lng'], count($g['pins']));
    if (!$apply) {
        $target ? $joined++ : $created++;
        continue;
    }
    $pdo->beginTransaction();
    try {
        if ($target === null) {
            $target = bin2hex(random_bytes(8));
            $pdo->prepare("
                INSERT INTO places (id, city_id, name, lat, lng, created_by, status)
                VALUES (?, ?, ?, ?, ?, ?, 'approved')
            ")->execute([$target, $g['city_id'], $g['name'], $g['lat'], $g['lng'], $g['created_by']]);
            $created++;
        } else {
            $pdo->prepare("UPDATE places SET status = 'approved', updated_at = now() WHERE id = ? AND status = 'pending'")
                ->execute([$target]);
            $joined++;
        }
        $pdo->prepare("UPDATE daily_proofs SET place_id = ? WHERE id = ANY (string_to_array(?, ',')) AND place_id IS NULL")
            ->execute([$target, implode(',', $g['pins'])]);
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        echo "   ERROR: " . $e->getMessage() . "\n";
    }
}
foreach ($unnamed as $p) {
    printf("   SKIP proof %s (%s)\n", $p['id'], $p['city_id'] === null ? 'no city' : 'no name');
}
echo "   => " . ($apply ? '' : 'would ') . "create {$created} place(s), join {$joined} existing\n\n";

// ── 2. Validated user challenges with a venue (report only) ──────────────────

$challenges = $pdo->query("
    SELECT cc.channel_id, cc.city_id, cc.title, cc.venue, cc.venue_lat, cc.venue_lng, cc.validated_at
    FROM channel_challenges cc
    WHERE cc.status = 'validated' AND cc.venue IS NOT NULL AND btrim(cc.venue) <> ''
    ORDER BY cc.validated_at DESC NULLS LAST
")->fetchAll();
echo "2. Validated challenges with a venue (review by hand in the back office): " . count($challenges) . "\n";
foreach ($challenges as $c) {
    printf("   %s %s  \"%s\" @ %s%s\n", $c['channel_id'], $c['city_id'], mb_strimwidth((string) $c['title'], 0, 50, '…'),
        mb_strimwidth((string) $c['venue'], 0, 50, '…'),
        $c['venue_lat'] !== null ? sprintf('  (%.5f,%.5f)', $c['venue_lat'], $c['venue_lng']) : '');
}
echo "\n";

// ── 3. Google-seeded venues: delete ──────────────────────────────────────────

$series = $pdo->query("
    SELECT id, city_id, title FROM event_series WHERE source_key LIKE 'places:v1:%' ORDER BY city_id, title
")->fetchAll();
$seriesIds = array_column($series, 'id');
$channels  = [];
if ($seriesIds !== []) {
    $stmt = $pdo->prepare("SELECT channel_id FROM channel_events WHERE series_id = ANY (string_to_array(?, ','))");
    $stmt->execute([implode(',', $seriesIds)]);
    $channels = $stmt->fetchAll(PDO::FETCH_COLUMN);
}
echo "3. Google-seeded venues: " . count($series) . " series, " . count($channels) . " event channel(s)\n";
foreach ($series as $v) {
    printf("   DELETE %s %s  %s\n", $v['id'], $v['city_id'], mb_strimwidth((string) $v['title'], 0, 60, '…'));
}
if ($apply && $seriesIds !== []) {
    $pdo->beginTransaction();
    try {
        if ($channels !== []) {
            $pdo->prepare("DELETE FROM channels WHERE id = ANY (string_to_array(?, ','))")->execute([implode(',', $channels)]);
        }
        $pdo->prepare("DELETE FROM event_series WHERE id = ANY (string_to_array(?, ','))")->execute([implode(',', $seriesIds)]);
        $pdo->commit();
        echo "   => deleted\n";
    } catch (Throwable $e) {
        $pdo->rollBack();
        echo "   ERROR (nothing deleted): " . $e->getMessage() . "\n";
    }
} else {
    echo "   => " . ($apply ? 'nothing to delete' : 'would delete them') . "\n";
}

echo "\nDone.\n";
