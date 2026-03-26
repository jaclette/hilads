<?php

declare(strict_types=1);

class EventRepository
{
    private const COOLDOWN   = 300; // 5 min between creations per guest per channel
    private const MAX_HILADS = 6;
    private const MAX_PUBLIC = 10;

    // ── Shared SELECT columns ─────────────────────────────────────────────────

    private const SELECT = "
        SELECT
            c.id,
            c.parent_id,
            ce.source_type                              AS source,
            ce.external_id,
            ce.guest_id,
            ce.created_by,
            ce.title,
            ce.event_type                               AS type,
            ce.venue,
            ce.location,
            ce.location                                 AS location_hint,
            ce.venue_lat,
            ce.venue_lng,
            ce.image_url,
            ce.external_url,
            ce.series_id,
            es.recurrence_type,
            es.weekdays                                 AS series_weekdays,
            es.interval_days,
            EXTRACT(EPOCH FROM ce.starts_at)::INTEGER   AS starts_at,
            EXTRACT(EPOCH FROM ce.expires_at)::INTEGER  AS expires_at,
            EXTRACT(EPOCH FROM c.created_at)::INTEGER   AS created_at
        FROM channels c
        JOIN channel_events ce ON ce.channel_id = c.id
        LEFT JOIN event_series es ON es.id = ce.series_id
    ";

    // ── Build a human-readable recurrence label ───────────────────────────────

    private static function recurrenceLabel(string $type, ?string $weekdaysJson, ?int $intervalDays): string
    {
        $dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        switch ($type) {
            case 'daily':
                return 'Every day';
            case 'weekly':
                $days = json_decode($weekdaysJson ?? '[]', true) ?: [];
                sort($days);
                if (count($days) === 0) return 'Weekly';
                if (count($days) === 7) return 'Every day';
                return implode(' · ', array_map(fn($d) => $dayNames[$d] ?? '?', $days));
            case 'every_n_days':
                return 'Every ' . ($intervalDays ?? 1) . ' days';
            default:
                return '';
        }
    }

    // ── Format a DB row into the legacy event array shape ─────────────────────

    private static function format(array $row): array
    {
        $recurrenceLabel = null;
        if (!empty($row['recurrence_type'])) {
            $recurrenceLabel = self::recurrenceLabel(
                $row['recurrence_type'],
                $row['series_weekdays'] ?? null,
                isset($row['interval_days']) ? (int) $row['interval_days'] : null,
            );
        }

        return [
            'id'               => $row['id'],
            'channel_id'       => $row['parent_id']
                                    ? (int) substr($row['parent_id'], 5) // 'city_N' → N
                                    : null,
            'source'           => $row['source'],
            'external_id'      => $row['external_id'],
            'guest_id'         => $row['guest_id'],
            'created_by'       => $row['created_by'],
            'title'            => $row['title'],
            'type'             => $row['type'],
            'location_hint'    => $row['location_hint'],
            'venue'            => $row['venue'],
            'location'         => $row['location'],
            'venue_lat'        => isset($row['venue_lat']) ? (float) $row['venue_lat'] : null,
            'venue_lng'        => isset($row['venue_lng']) ? (float) $row['venue_lng'] : null,
            'image_url'        => $row['image_url'],
            'external_url'     => $row['external_url'],
            'series_id'        => $row['series_id'],
            'recurrence_label' => $recurrenceLabel,
            'starts_at'        => (int) $row['starts_at'],
            'ends_at'          => (int) $row['expires_at'], // user-visible end time
            'expires_at'       => (int) $row['expires_at'],
            'created_at'       => (int) $row['created_at'],
        ];
    }

    // ── Public reads ──────────────────────────────────────────────────────────

    public static function getByChannel(int $channelId): array
    {
        $city = CityRepository::findById($channelId);
        $timezone = $city['timezone'] ?? 'UTC';
        $tz = new DateTimeZone($timezone);
        $today = (new DateTime('now', $tz))->format('Y-m-d');
        $now = time();

        $stmt = Database::pdo()->prepare(self::SELECT . "
            WHERE c.parent_id = :parent_id
              AND c.type       = 'event'
              AND c.status     = 'active'
              AND ce.source_type = 'hilads'
              AND ce.expires_at  > now()
            ORDER BY ce.starts_at ASC
        ");
        $stmt->execute(['parent_id' => 'city_' . $channelId]);

        $events = [];
        $seenKeys = [];
        foreach ($stmt->fetchAll() as $row) {
            $event = self::format($row);

            $startDate = (new DateTime('@' . $event['starts_at']))->setTimezone($tz)->format('Y-m-d');
            $endDate = (new DateTime('@' . $event['expires_at']))->setTimezone($tz)->format('Y-m-d');
            $isVisibleToday = $startDate === $today
                || ($event['starts_at'] <= $now && $endDate === $today);

            if (!$isVisibleToday) {
                continue;
            }

            $dedupeKey = $event['series_id'] ?: $event['id'];
            if (isset($seenKeys[$dedupeKey])) {
                continue;
            }
            $seenKeys[$dedupeKey] = true;
            $events[] = $event;
        }

        usort($events, fn(array $a, array $b) => $a['starts_at'] <=> $b['starts_at']);

        return array_slice($events, 0, self::MAX_HILADS);
    }

    public static function getPublicByChannel(int $channelId): array
    {
        $stmt = Database::pdo()->prepare(self::SELECT . "
            WHERE c.parent_id = :parent_id
              AND c.type         = 'event'
              AND c.status       = 'active'
              AND ce.source_type = 'ticketmaster'
              AND ce.expires_at  > now()
            ORDER BY ce.starts_at ASC
            LIMIT " . self::MAX_PUBLIC
        );
        $stmt->execute(['parent_id' => 'city_' . $channelId]);
        return array_map([self::class, 'format'], $stmt->fetchAll());
    }

    public static function findById(string $eventId): ?array
    {
        $stmt = Database::pdo()->prepare(self::SELECT . "
            WHERE c.id        = :id
              AND ce.expires_at > now()
        ");
        $stmt->execute(['id' => $eventId]);
        $row = $stmt->fetch();
        return $row ? self::format($row) : null;
    }

    /**
     * Returns active/upcoming Hilads events created by this guest or registered user.
     * Recurring series are deduplicated: only the nearest upcoming (or currently live)
     * occurrence is returned per series, so users see one entry per series they created.
     */
    public static function getByUser(string $guestId, ?string $userId): array
    {
        if ($userId !== null) {
            $stmt = Database::pdo()->prepare(self::SELECT . "
                WHERE c.type         = 'event'
                  AND c.status       = 'active'
                  AND ce.source_type = 'hilads'
                  AND ce.expires_at  > now()
                  AND (ce.guest_id = :guest_id OR ce.created_by = :user_id)
                ORDER BY ce.starts_at ASC
            ");
            $stmt->execute(['guest_id' => $guestId, 'user_id' => $userId]);
        } else {
            $stmt = Database::pdo()->prepare(self::SELECT . "
                WHERE c.type         = 'event'
                  AND c.status       = 'active'
                  AND ce.source_type = 'hilads'
                  AND ce.expires_at  > now()
                  AND ce.guest_id    = :guest_id
                ORDER BY ce.starts_at ASC
            ");
            $stmt->execute(['guest_id' => $guestId]);
        }

        // Deduplicate recurring series: rows are sorted by starts_at ASC so the first
        // occurrence seen per series_id is the nearest upcoming (or currently live) one.
        $seenSeries = [];
        $result     = [];
        foreach ($stmt->fetchAll() as $row) {
            $sid = $row['series_id'] ?? null;
            if ($sid !== null) {
                if (isset($seenSeries[$sid])) continue;
                $seenSeries[$sid] = true;
            }
            $result[] = self::format($row);
        }
        return $result;
    }

    /**
     * Updates a Hilads event. Returns the updated event or null if ownership check fails.
     * Ownership: creator's guest_id or (for registered users) created_by user_id.
     */
    public static function update(
        string  $eventId,
        string  $guestId,
        ?string $userId,
        string  $title,
        ?string $locationHint,
        int     $startsAt,
        int     $endsAt,
        string  $type
    ): ?array {
        $pdo = Database::pdo();

        // Verify ownership before writing
        if ($userId !== null) {
            $check = $pdo->prepare("
                SELECT 1 FROM channel_events
                WHERE channel_id = :id AND source_type = 'hilads'
                  AND (guest_id = :guest_id OR created_by = :user_id)
            ");
            $check->execute(['id' => $eventId, 'guest_id' => $guestId, 'user_id' => $userId]);
        } else {
            $check = $pdo->prepare("
                SELECT 1 FROM channel_events
                WHERE channel_id = :id AND source_type = 'hilads' AND guest_id = :guest_id
            ");
            $check->execute(['id' => $eventId, 'guest_id' => $guestId]);
        }
        if (!$check->fetch()) return null;

        $now       = time();
        $startsAt  = min($startsAt, $now + 48 * 3600);
        $expiresAt = min($endsAt,   $startsAt + 24 * 3600);

        $pdo->prepare("
            UPDATE channel_events
            SET title      = :title,
                location   = :location,
                event_type = :type,
                starts_at  = to_timestamp(:starts_at),
                expires_at = to_timestamp(:expires_at)
            WHERE channel_id = :id
        ")->execute([
            'title'      => $title,
            'location'   => $locationHint,
            'type'       => $type,
            'starts_at'  => $startsAt,
            'expires_at' => $expiresAt,
            'id'         => $eventId,
        ]);

        // Keep channel name in sync with title
        $pdo->prepare("
            UPDATE channels SET name = :name, updated_at = now() WHERE id = :id
        ")->execute(['name' => $title, 'id' => $eventId]);

        return self::findById($eventId);
    }

    /**
     * Soft-deletes a Hilads event by expiring it immediately.
     * Returns false if the event was not found or the caller is not the owner.
     */
    public static function delete(string $eventId, string $guestId, ?string $userId): bool
    {
        $pdo = Database::pdo();

        if ($userId !== null) {
            $check = $pdo->prepare("
                SELECT 1 FROM channel_events
                WHERE channel_id = :id AND source_type = 'hilads'
                  AND (guest_id = :guest_id OR created_by = :user_id)
            ");
            $check->execute(['id' => $eventId, 'guest_id' => $guestId, 'user_id' => $userId]);
        } else {
            $check = $pdo->prepare("
                SELECT 1 FROM channel_events
                WHERE channel_id = :id AND source_type = 'hilads' AND guest_id = :guest_id
            ");
            $check->execute(['id' => $eventId, 'guest_id' => $guestId]);
        }
        if (!$check->fetch()) return false;

        $pdo->prepare("UPDATE channels       SET status = 'deleted', updated_at = now() WHERE id = :id")->execute(['id' => $eventId]);
        $pdo->prepare("UPDATE channel_events SET expires_at = now()                      WHERE channel_id = :id")->execute(['id' => $eventId]);

        return true;
    }

    /**
     * Returns active event counts keyed by integer city ID.
     * Used by the /channels listing endpoint to avoid N file reads.
     * Example: [1 => 3, 5 => 10, 42 => 1]
     */
    public static function getCountsPerCity(): array
    {
        $rows = Database::pdo()
            ->query("
                SELECT
                    CAST(SUBSTRING(c.parent_id FROM 6) AS INTEGER) AS city_id,
                    COUNT(*) AS event_count
                FROM channels c
                JOIN channel_events ce ON ce.channel_id = c.id
                WHERE c.type     = 'event'
                  AND c.status   = 'active'
                  AND ce.expires_at > now()
                  AND (
                      ce.occurrence_date IS NULL
                      OR ce.occurrence_date = CURRENT_DATE
                  )
                GROUP BY c.parent_id
            ")
            ->fetchAll(PDO::FETCH_ASSOC);

        $counts = [];
        foreach ($rows as $row) {
            $counts[(int) $row['city_id']] = (int) $row['event_count'];
        }
        return $counts;
    }

    // ── Writes ────────────────────────────────────────────────────────────────

    public static function add(
        int $channelId,
        string $guestId,
        string $nickname,
        string $title,
        ?string $locationHint,
        int $startsAt,
        int $endsAt,
        string $type = 'other',
        ?string $userId = null
    ): array {
        $pdo      = Database::pdo();
        $parentId = 'city_' . $channelId;

        // Cooldown: 5 minutes between event creations per guest per channel
        $cooldownCheck = $pdo->prepare("
            SELECT 1 FROM channels c
            JOIN channel_events ce ON ce.channel_id = c.id
            WHERE c.parent_id     = :parent_id
              AND ce.source_type  = 'hilads'
              AND ce.guest_id     = :guest_id
              AND c.created_at    > now() - interval '5 minutes'
            LIMIT 1
        ");
        $cooldownCheck->execute(['parent_id' => $parentId, 'guest_id' => $guestId]);
        if ($cooldownCheck->fetchColumn()) {
            Response::json(['error' => 'You must wait 5 minutes before creating another event'], 429);
        }

        // Cap: 1 active event per guest per channel
        $capCheck = $pdo->prepare("
            SELECT 1 FROM channels c
            JOIN channel_events ce ON ce.channel_id = c.id
            WHERE c.parent_id    = :parent_id
              AND ce.source_type = 'hilads'
              AND ce.guest_id    = :guest_id
              AND c.status       = 'active'
              AND ce.expires_at  > now()
            LIMIT 1
        ");
        $capCheck->execute(['parent_id' => $parentId, 'guest_id' => $guestId]);
        if ($capCheck->fetchColumn()) {
            Response::json(['error' => 'You already have an active event in this channel'], 429);
        }

        $now       = time();
        $id        = bin2hex(random_bytes(8));
        $startsAt  = min($startsAt, $now + 48 * 3600);    // cap start: 48 h in the future
        $expiresAt = min($endsAt, $startsAt + 24 * 3600); // cap duration: 24 h

        $pdo->prepare("
            INSERT INTO channels (id, type, parent_id, name, status, created_at, updated_at)
            VALUES (:id, 'event', :parent_id, :name, 'active', now(), now())
        ")->execute([
            'id'        => $id,
            'parent_id' => $parentId,
            'name'      => $title,
        ]);

        $pdo->prepare("
            INSERT INTO channel_events
                (channel_id, source_type, guest_id, created_by, title, event_type, location,
                 starts_at, expires_at)
            VALUES
                (:channel_id, 'hilads', :guest_id, :created_by, :title, :event_type, :location,
                 to_timestamp(:starts_at), to_timestamp(:expires_at))
        ")->execute([
            'channel_id' => $id,
            'guest_id'   => $guestId,
            'created_by' => $userId,
            'title'      => $title,
            'event_type' => $type,
            'location'   => $locationHint,
            'starts_at'  => $startsAt,
            'expires_at' => $expiresAt,
        ]);

        // Auto-join: creator is always the first participant (idempotent via ON CONFLICT).
        // Non-fatal: if this fails (e.g. schema lag), the event itself is already created.
        try {
            $pdo->prepare("
                INSERT INTO event_participants (channel_id, guest_id, user_id)
                VALUES (?, ?, ?)
                ON CONFLICT (channel_id, guest_id) DO NOTHING
            ")->execute([$id, $guestId, $userId]);
        } catch (\Throwable $e) {
            error_log("[event-create] auto-join failed (non-fatal): " . $e->getMessage());
        }

        return [
            'id'           => $id,
            'channel_id'   => $channelId,
            'source'       => 'hilads',
            'external_id'  => null,
            'guest_id'     => $guestId,
            'created_by'   => $userId,
            'nickname'     => $nickname,
            'title'        => $title,
            'type'         => $type,
            'location_hint'=> $locationHint,
            'venue'        => null,
            'location'     => $locationHint,
            'venue_lat'    => null,
            'venue_lng'    => null,
            'image_url'    => null,
            'external_url' => null,
            'starts_at'    => $startsAt,
            'ends_at'      => $expiresAt,
            'expires_at'   => $expiresAt,
            'created_at'   => $now,
            'participated' => true, // creator is always auto-joined
        ];
    }

    public static function upsertPublic(int $channelId, array $incoming): void
    {
        $pdo      = Database::pdo();
        $parentId = 'city_' . $channelId;

        $findStmt = $pdo->prepare("
            SELECT channel_id FROM channel_events
            WHERE source_type = 'ticketmaster' AND external_id = ?
        ");

        $chanStmt = $pdo->prepare("
            INSERT INTO channels (id, type, parent_id, name, status, created_at, updated_at)
            VALUES (:id, 'event', :parent_id, :name, 'active', now(), now())
            ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, updated_at = now()
        ");

        $evStmt = $pdo->prepare("
            INSERT INTO channel_events
                (channel_id, source_type, external_id, title,
                 venue, location, venue_lat, venue_lng,
                 starts_at, expires_at, image_url, external_url, synced_at)
            VALUES
                (:channel_id, 'ticketmaster', :external_id, :title,
                 :venue, :location, :venue_lat, :venue_lng,
                 to_timestamp(:starts_at), to_timestamp(:expires_at),
                 :image_url, :external_url, now())
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
                synced_at    = now()
        ");

        foreach ($incoming as $ev) {
            $extId = $ev['external_id'];

            // Reuse existing channel_id for this TM event if it already exists
            $findStmt->execute([$extId]);
            $existingId = $findStmt->fetchColumn();
            $channelRowId = $existingId ?: bin2hex(random_bytes(8));

            $chanStmt->execute([
                'id'        => $channelRowId,
                'parent_id' => $parentId,
                'name'      => $ev['title'],
            ]);

            $evStmt->execute([
                'channel_id'  => $channelRowId,
                'external_id' => $extId,
                'title'       => $ev['title'],
                'venue'       => $ev['venue'],
                'location'    => $ev['location'],
                'venue_lat'   => $ev['venue_lat'] ?? null,
                'venue_lng'   => $ev['venue_lng'] ?? null,
                'starts_at'   => $ev['starts_at'],
                'expires_at'  => $ev['expires_at'],
                'image_url'   => $ev['image_url'],
                'external_url'=> $ev['external_url'],
            ]);
        }
    }
}
