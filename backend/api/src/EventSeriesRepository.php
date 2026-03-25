<?php

declare(strict_types=1);

class EventSeriesRepository
{
    // ── Helpers ───────────────────────────────────────────────────────────────

    private static function localToUnix(string $date, string $timeStr, string $timezone): int
    {
        $dt = new DateTime("{$date}T{$timeStr}:00", new DateTimeZone($timezone));
        return $dt->getTimestamp();
    }

    private static function matchesRecurrence(array $series, string $date): bool
    {
        $dt  = new DateTime($date);
        $dow = (int) $dt->format('w'); // 0=Sun, 1=Mon, ... 6=Sat

        switch ($series['recurrence_type']) {
            case 'daily':
                return true;

            case 'weekly':
                $weekdays = json_decode($series['weekdays'] ?? '[]', true) ?: [];
                return in_array($dow, $weekdays, true);

            case 'every_n_days':
                $start        = new DateTime($series['starts_on']);
                $intervalDays = max(1, (int) ($series['interval_days'] ?? 1));
                $diff         = (int) $dt->diff($start)->format('%r%a');
                return $diff >= 0 && ($diff % $intervalDays) === 0;

            default:
                return false;
        }
    }

    private static function createOccurrence(array $series, string $date): string
    {
        $pdo      = Database::pdo();
        $tz       = $series['timezone'];
        $startsAt = self::localToUnix($date, $series['start_time'], $tz);
        $endsAt   = self::localToUnix($date, $series['end_time'], $tz);

        // Handle midnight crossover (end < start → end is next day)
        if ($endsAt <= $startsAt) {
            $endsAt += 86400;
        }

        $channelId = bin2hex(random_bytes(8));

        $pdo->prepare("
            INSERT INTO channels (id, type, parent_id, name, status, created_at, updated_at)
            VALUES (?, 'event', ?, ?, 'active', now(), now())
        ")->execute([$channelId, $series['city_id'], $series['title']]);

        $pdo->prepare("
            INSERT INTO channel_events
                (channel_id, source_type, created_by, guest_id, title, event_type,
                 location, starts_at, expires_at, series_id, occurrence_date)
            VALUES
                (?, 'hilads', ?, ?, ?, ?,
                 ?, to_timestamp(?), to_timestamp(?), ?, ?)
        ")->execute([
            $channelId,
            $series['created_by'] ?? null,
            $series['guest_id'] ?? null,
            $series['title'],
            $series['event_type'],
            $series['location'] ?? null,
            $startsAt,
            $endsAt,
            $series['id'],
            $date,
        ]);

        // Auto-join creator if this is a user-created series
        if (!empty($series['guest_id'])) {
            $pdo->prepare("
                INSERT INTO event_participants (channel_id, guest_id, user_id)
                VALUES (?, ?, ?)
                ON CONFLICT (channel_id, guest_id) DO NOTHING
            ")->execute([$channelId, $series['guest_id'], $series['created_by'] ?? null]);
        }

        return $channelId;
    }

    // ── Public API ────────────────────────────────────────────────────────────

    /**
     * Create a user-initiated series (requires authenticated user + guestId).
     * Returns { series_id, first_event }.
     */
    public static function create(
        int     $channelId,
        string  $userId,
        string  $guestId,
        string  $title,
        string  $eventType,
        ?string $location,
        string  $startTime,
        string  $endTime,
        string  $timezone,
        string  $recurrenceType,
        ?array  $weekdays    = null,
        ?int    $intervalDays = null,
        ?string $startsOn    = null,
        ?string $endsOn      = null
    ): array {
        $pdo    = Database::pdo();
        $cityId = 'city_' . $channelId;
        $id     = bin2hex(random_bytes(8));

        if ($startsOn === null) {
            $startsOn = (new DateTime('today', new DateTimeZone($timezone)))->format('Y-m-d');
        }

        $pdo->prepare("
            INSERT INTO event_series
                (id, city_id, created_by, guest_id, title, event_type, location,
                 start_time, end_time, timezone, recurrence_type, weekdays,
                 interval_days, starts_on, ends_on, source)
            VALUES
                (?, ?, ?, ?, ?, ?, ?,
                 ?, ?, ?, ?, ?,
                 ?, ?, ?, 'user')
        ")->execute([
            $id, $cityId, $userId, $guestId, $title, $eventType, $location,
            $startTime, $endTime, $timezone, $recurrenceType,
            $weekdays !== null ? json_encode($weekdays) : null,
            $intervalDays, $startsOn, $endsOn,
        ]);

        $series = [
            'id'             => $id,
            'city_id'        => $cityId,
            'created_by'     => $userId,
            'guest_id'       => $guestId,
            'title'          => $title,
            'event_type'     => $eventType,
            'location'       => $location,
            'start_time'     => $startTime,
            'end_time'       => $endTime,
            'timezone'       => $timezone,
            'recurrence_type'=> $recurrenceType,
            'weekdays'       => $weekdays !== null ? json_encode($weekdays) : null,
            'interval_days'  => $intervalDays,
            'starts_on'      => $startsOn,
            'ends_on'        => $endsOn,
        ];

        self::generateOccurrences($series, 7);

        return [
            'series_id'  => $id,
            'first_event'=> self::getFirstOccurrence($id),
        ];
    }

    /**
     * Batch-import series from an external source (e.g. places seed script).
     * Each item must include source_key for idempotency.
     * Returns { created, skipped, errors }.
     *
     * @param array $items  Array of series definitions (see importBatch docblock below)
     * @param bool  $dryRun If true, validate + count without writing to DB
     */
    public static function importBatch(array $items, bool $dryRun = false, bool $updateExisting = false): array
    {
        $pdo     = Database::pdo();
        $created = 0;
        $updated = 0;
        $skipped = 0;
        $errors  = [];
        $preview = [
            'would_create' => 0,
            'would_update' => 0,
            'would_skip'   => 0,
            'items'        => [],
        ];

        $checkStmt = $pdo->prepare("SELECT id FROM event_series WHERE source_key = ?");

        foreach ($items as $idx => $item) {
            $sourceKey = $item['source_key'] ?? null;
            if (empty($sourceKey) || !is_string($sourceKey)) {
                $errors[] = "item #{$idx}: missing or invalid source_key";
                continue;
            }

            $cityId = isset($item['city_id']) ? (int) $item['city_id'] : null;
            if (!$cityId) {
                $errors[] = "item #{$idx}: missing city_id";
                continue;
            }

            $city = CityRepository::findById($cityId);
            if ($city === null) {
                $errors[] = "item #{$idx}: city_id={$cityId} not found";
                continue;
            }

            if (empty($item['title']) || empty($item['start_time']) || empty($item['end_time'])) {
                $errors[] = "item #{$idx}: missing required field (title, start_time, end_time)";
                continue;
            }

            // Check for existing series with this source_key (dedup)
            $checkStmt->execute([$sourceKey]);
            $existingSeriesId = $checkStmt->fetchColumn();
            if ($existingSeriesId) {
                if ($updateExisting) {
                    if ($dryRun) {
                        $preview['would_update']++;
                        $preview['items'][] = [
                            'action'     => 'update',
                            'city_id'    => $cityId,
                            'title'      => $item['title'],
                            'source_key' => $sourceKey,
                            'location'   => $item['location'] ?? null,
                        ];
                    }
                    if (!$dryRun) {
                        self::updateImportedSeries((string) $existingSeriesId, $item, $city);
                    }
                    $updated++;
                } else {
                    if ($dryRun) {
                        $preview['would_skip']++;
                        $preview['items'][] = [
                            'action'     => 'skip',
                            'city_id'    => $cityId,
                            'title'      => $item['title'],
                            'source_key' => $sourceKey,
                            'location'   => $item['location'] ?? null,
                        ];
                    }
                    $skipped++;
                }
                continue;
            }

            if ($dryRun) {
                $preview['would_create']++;
                $preview['items'][] = [
                    'action'     => 'create',
                    'city_id'    => $cityId,
                    'title'      => $item['title'],
                    'source_key' => $sourceKey,
                    'location'   => $item['location'] ?? null,
                ];
                continue;
            }

            $id       = bin2hex(random_bytes(8));
            $cityDbId = 'city_' . $cityId;
            $startsOn = (new DateTime('today', new DateTimeZone($city['timezone'])))->format('Y-m-d');

            $stmt = $pdo->prepare("
                INSERT INTO event_series
                    (id, city_id, created_by, guest_id, title, event_type, location,
                     start_time, end_time, timezone, recurrence_type, weekdays,
                     interval_days, starts_on, ends_on, source, source_key)
                VALUES
                    (?, ?, NULL, NULL, ?, ?, ?,
                     ?, ?, ?, ?, NULL,
                     NULL, ?, NULL, 'import', ?)
                ON CONFLICT (source_key) DO NOTHING
            ");
            $stmt->execute([
                $id,
                $cityDbId,
                mb_substr(trim($item['title']), 0, 100),
                $item['event_type'] ?? 'other',
                isset($item['location']) ? mb_substr(trim($item['location']), 0, 100) : null,
                $item['start_time'],
                $item['end_time'],
                $city['timezone'],
                $item['recurrence_type'] ?? 'daily',
                $startsOn,
                $sourceKey,
            ]);

            // ON CONFLICT triggered means a concurrent insert beat us — treat as skipped
            if ($stmt->rowCount() === 0) {
                $skipped++;
                continue;
            }

            // Generate the first 7 days of occurrences
            $series = [
                'id'             => $id,
                'city_id'        => $cityDbId,
                'created_by'     => null,
                'guest_id'       => null,
                'title'          => mb_substr(trim($item['title']), 0, 100),
                'event_type'     => $item['event_type'] ?? 'other',
                'location'       => isset($item['location']) ? mb_substr(trim($item['location']), 0, 100) : null,
                'start_time'     => $item['start_time'],
                'end_time'       => $item['end_time'],
                'timezone'       => $city['timezone'],
                'recurrence_type'=> $item['recurrence_type'] ?? 'daily',
                'weekdays'       => null,
                'interval_days'  => null,
                'starts_on'      => $startsOn,
                'ends_on'        => null,
            ];

            self::generateOccurrences($series, 7);
            $created++;
        }

        return [
            'created' => $created,
            'updated' => $updated,
            'skipped' => $skipped,
            'errors'  => $errors,
            'preview' => $dryRun ? $preview : null,
        ];
    }

    public static function generateOccurrences(array $series, int $lookaheadDays = 7): int
    {
        $pdo       = Database::pdo();
        $tz        = new DateTimeZone($series['timezone']);
        $today     = new DateTime('today', $tz);
        $end       = (clone $today)->modify("+{$lookaheadDays} days");
        $seriesEnd = !empty($series['ends_on']) ? new DateTime($series['ends_on'], $tz) : null;

        $created   = 0;
        $current   = clone $today;

        $startsOn = new DateTime($series['starts_on'], $tz);
        if ($current < $startsOn) {
            $current = clone $startsOn;
        }

        $existsStmt = $pdo->prepare("
            SELECT 1 FROM channel_events WHERE series_id = ? AND occurrence_date = ?::date
        ");

        while ($current <= $end) {
            if ($seriesEnd !== null && $current > $seriesEnd) break;

            $date = $current->format('Y-m-d');

            if (self::matchesRecurrence($series, $date)) {
                $existsStmt->execute([$series['id'], $date]);
                if (!$existsStmt->fetchColumn()) {
                    self::createOccurrence($series, $date);
                    $created++;
                }
            }

            $current->modify('+1 day');
        }

        return $created;
    }

    public static function generateAll(int $lookaheadDays = 7): array
    {
        $allRows = Database::pdo()->query("
            SELECT * FROM event_series
            WHERE ends_on IS NULL OR ends_on >= CURRENT_DATE
        ")->fetchAll();

        $results = [];
        foreach ($allRows as $series) {
            $n = self::generateOccurrences($series, $lookaheadDays);
            $results[] = ['series_id' => $series['id'], 'created' => $n];
        }

        return $results;
    }

    private static function updateImportedSeries(string $seriesId, array $item, array $city): void
    {
        $pdo = Database::pdo();
        $title = mb_substr(trim($item['title']), 0, 100);
        $location = isset($item['location']) ? mb_substr(trim($item['location']), 0, 100) : null;
        $eventType = $item['event_type'] ?? 'other';
        $startTime = $item['start_time'];
        $endTime = $item['end_time'];
        $recurrenceType = $item['recurrence_type'] ?? 'daily';

        $pdo->prepare("
            UPDATE event_series
            SET title = ?, event_type = ?, location = ?, start_time = ?, end_time = ?, timezone = ?, recurrence_type = ?
            WHERE id = ?
        ")->execute([$title, $eventType, $location, $startTime, $endTime, $city['timezone'], $recurrenceType, $seriesId]);

        $pdo->prepare("
            UPDATE channels
            SET name = ?, updated_at = now()
            WHERE id IN (
                SELECT channel_id FROM channel_events
                WHERE series_id = ?
                  AND expires_at > now()
            )
        ")->execute([$title, $seriesId]);

        $pdo->prepare("
            UPDATE channel_events
            SET title = ?, event_type = ?, location = ?
            WHERE series_id = ?
              AND expires_at > now()
        ")->execute([$title, $eventType, $location, $seriesId]);
    }

    private static function getFirstOccurrence(string $seriesId): ?array
    {
        $stmt = Database::pdo()->prepare("
            SELECT
                c.id,
                c.parent_id,
                ce.source_type                              AS source,
                ce.external_id,
                ce.guest_id,
                ce.title,
                ce.event_type                               AS type,
                ce.location                                 AS location_hint,
                ce.venue,
                ce.location,
                ce.venue_lat,
                ce.venue_lng,
                ce.image_url,
                ce.external_url,
                ce.series_id,
                ce.occurrence_date::TEXT                    AS occurrence_date,
                EXTRACT(EPOCH FROM ce.starts_at)::INTEGER  AS starts_at,
                EXTRACT(EPOCH FROM ce.expires_at)::INTEGER AS expires_at,
                EXTRACT(EPOCH FROM c.created_at)::INTEGER  AS created_at
            FROM channels c
            JOIN channel_events ce ON ce.channel_id = c.id
            WHERE ce.series_id = ?
              AND c.status     = 'active'
              AND ce.expires_at > now()
            ORDER BY ce.starts_at ASC
            LIMIT 1
        ");
        $stmt->execute([$seriesId]);
        $row = $stmt->fetch();
        if (!$row) return null;

        return [
            'id'             => $row['id'],
            'channel_id'     => (int) substr($row['parent_id'], 5),
            'source'         => $row['source'],
            'external_id'    => $row['external_id'],
            'guest_id'       => $row['guest_id'],
            'title'          => $row['title'],
            'type'           => $row['type'],
            'location_hint'  => $row['location_hint'],
            'venue'          => $row['venue'],
            'location'       => $row['location'],
            'venue_lat'      => isset($row['venue_lat']) ? (float) $row['venue_lat'] : null,
            'venue_lng'      => isset($row['venue_lng']) ? (float) $row['venue_lng'] : null,
            'image_url'      => $row['image_url'],
            'external_url'   => $row['external_url'],
            'series_id'      => $row['series_id'],
            'occurrence_date'=> $row['occurrence_date'],
            'starts_at'      => (int) $row['starts_at'],
            'ends_at'        => (int) $row['expires_at'],
            'expires_at'     => (int) $row['expires_at'],
            'created_at'     => (int) $row['created_at'],
            'participated'   => true,
        ];
    }
}
