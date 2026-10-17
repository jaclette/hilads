<?php

declare(strict_types=1);

/**
 * V3-02 places migration, shared by scripts/places_migrate.php and the back
 * office page /admin/daily/spots/migration (V3-05). A dry run reports, apply
 * writes; both return the same report.
 *
 * 1. V1 pins → places: approved Daily proofs pinned in 1.x (place_lat/lng/name,
 *    no place_id yet) grouped by city, same name and within 40 m
 *    (Places::groupPins); each group becomes an approved place (a spot), or
 *    joins an existing place with the same name within 40 m. Pins without a
 *    name are reported and left alone.
 * 2. Validated user challenges with a venue: report only (no coordinates, no
 *    Daily proof); the founder seeds the ones worth it by hand.
 * 3. Google data: the venues seeded from Google Places (event_series with
 *    source_key 'places:v1:…') and their event channels are deleted (Google is
 *    out of Hilads, SPEC 9.5); their messages and participants cascade.
 *
 * Idempotent: a re-run only touches pins still without a place and venues
 * still present.
 */
final class PlacesMigration
{
    /**
     * Report: ['apply' => bool, 'pins' => [groups: [{action 'new'|'join', name,
     * city_id, lat, lng, proofs, place_id?}], skipped: [{id, why}], total],
     * 'challenges' => [rows], 'google' => [series: [rows], channels: int,
     * deleted: bool], 'errors' => [string]].
     */
    public static function run(PDO $pdo, bool $apply): array
    {
        $report = ['apply' => $apply, 'errors' => []];
        $report['pins']       = self::pins($pdo, $apply, $report['errors']);
        $report['challenges'] = self::challenges($pdo);
        $report['google']     = self::google($pdo, $apply, $report['errors']);
        return $report;
    }

    private static function pins(PDO $pdo, bool $apply, array &$errors): array
    {
        $pins = $pdo->query("
            SELECT id, city_id, user_id, place_lat AS lat, place_lng AS lng, place_name AS name
            FROM daily_proofs
            WHERE place_lat IS NOT NULL AND place_id IS NULL AND moderation_status = 'approved'
            ORDER BY approved_at, id
        ")->fetchAll(PDO::FETCH_ASSOC);

        $skipped = [];
        foreach ($pins as $p) {
            if ($p['city_id'] === null) {
                $skipped[] = ['id' => $p['id'], 'why' => 'no city'];
            } elseif (trim((string) $p['name']) === '') {
                $skipped[] = ['id' => $p['id'], 'why' => 'no name'];
            }
        }

        $groups = [];
        foreach (Places::groupPins($pins) as $g) {
            $target = self::existingPlace($pdo, $g);
            $row    = ['action' => $target === null ? 'new' : 'join', 'name' => $g['name'], 'city_id' => $g['city_id'],
                       'lat' => $g['lat'], 'lng' => $g['lng'], 'proofs' => count($g['pins']), 'place_id' => $target];
            if ($apply) {
                $pdo->beginTransaction();
                try {
                    if ($target === null) {
                        $target = bin2hex(random_bytes(8));
                        $pdo->prepare("
                            INSERT INTO places (id, city_id, name, lat, lng, created_by, status)
                            VALUES (?, ?, ?, ?, ?, ?, 'approved')
                        ")->execute([$target, $g['city_id'], $g['name'], $g['lat'], $g['lng'], $g['created_by']]);
                    } else {
                        $pdo->prepare("UPDATE places SET status = 'approved', updated_at = now() WHERE id = ? AND status = 'pending'")
                            ->execute([$target]);
                    }
                    $pdo->prepare("UPDATE daily_proofs SET place_id = ? WHERE id = ANY (string_to_array(?, ',')) AND place_id IS NULL")
                        ->execute([$target, implode(',', $g['pins'])]);
                    $pdo->commit();
                    $row['place_id'] = $target;
                } catch (Throwable $e) {
                    $pdo->rollBack();
                    $errors[] = "Pins \"{$g['name']}\": " . $e->getMessage();
                }
            }
            $groups[] = $row;
        }
        return ['total' => count($pins), 'groups' => $groups, 'skipped' => $skipped];
    }

    /** An existing place with the same name within the pin group radius, else null. */
    private static function existingPlace(PDO $pdo, array $g): ?string
    {
        [$minLat, $maxLat, $minLng, $maxLng] = Places::boundingBox($g['lat'], $g['lng'], Places::PIN_GROUP_RADIUS_M);
        $stmt = $pdo->prepare("
            SELECT id, name, lat, lng FROM places
            WHERE city_id = ? AND merged_into IS NULL AND status <> 'rejected'
              AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?
        ");
        $stmt->execute([$g['city_id'], $minLat, $maxLat, $minLng, $maxLng]);
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
            if (Places::normalizeName($r['name']) === Places::normalizeName($g['name'])
                && Places::distanceM($g['lat'], $g['lng'], (float) $r['lat'], (float) $r['lng']) <= Places::PIN_GROUP_RADIUS_M) {
                return $r['id'];
            }
        }
        return null;
    }

    private static function challenges(PDO $pdo): array
    {
        return $pdo->query("
            SELECT cc.channel_id, cc.city_id, ch.name AS city_name, cc.title, cc.venue, cc.venue_lat, cc.venue_lng,
                   cc.validated_at::date::text AS validated_on
            FROM channel_challenges cc
            LEFT JOIN channels ch ON ch.id = cc.city_id
            WHERE cc.status = 'validated' AND cc.venue IS NOT NULL AND btrim(cc.venue) <> ''
            ORDER BY cc.validated_at DESC NULLS LAST
        ")->fetchAll(PDO::FETCH_ASSOC);
    }

    private static function google(PDO $pdo, bool $apply, array &$errors): array
    {
        $series = $pdo->query("
            SELECT id, city_id, title FROM event_series WHERE source_key LIKE 'places:v1:%' ORDER BY city_id, title
        ")->fetchAll(PDO::FETCH_ASSOC);
        $ids      = array_column($series, 'id');
        $channels = [];
        if ($ids !== []) {
            $stmt = $pdo->prepare("SELECT channel_id FROM channel_events WHERE series_id = ANY (string_to_array(?, ','))");
            $stmt->execute([implode(',', $ids)]);
            $channels = $stmt->fetchAll(PDO::FETCH_COLUMN);
        }
        $deleted = false;
        if ($apply && $ids !== []) {
            $pdo->beginTransaction();
            try {
                if ($channels !== []) {
                    $pdo->prepare("DELETE FROM channels WHERE id = ANY (string_to_array(?, ','))")->execute([implode(',', $channels)]);
                }
                $pdo->prepare("DELETE FROM event_series WHERE id = ANY (string_to_array(?, ','))")->execute([implode(',', $ids)]);
                $pdo->commit();
                $deleted = true;
            } catch (Throwable $e) {
                $pdo->rollBack();
                $errors[] = 'Google venues (nothing deleted): ' . $e->getMessage();
            }
        }
        return ['series' => $series, 'channels' => count($channels), 'deleted' => $deleted];
    }
}
