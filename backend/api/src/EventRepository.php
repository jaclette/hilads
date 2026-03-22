<?php

declare(strict_types=1);

class EventRepository
{
    private const COOLDOWN   = 300; // 5 minutes between creations per guest per channel
    private const MAX_RETURN = 5;   // max active events returned by getByChannel

    private static function filePath(int $channelId): string
    {
        return Storage::path('events_' . $channelId . '.json');
    }

    private static function load(int $channelId): array
    {
        $path = self::filePath($channelId);

        if (!file_exists($path)) {
            return [];
        }

        $data = json_decode(file_get_contents($path), true);

        return is_array($data) ? $data : [];
    }

    private static function save(int $channelId, array $events): void
    {
        file_put_contents(self::filePath($channelId), json_encode(array_values($events)), LOCK_EX);
    }

    // Remove expired events and clean up their message files
    private static function pruneExpired(array $events): array
    {
        $now    = time();
        $active = [];

        foreach ($events as $event) {
            if ($event['expires_at'] >= $now) {
                $active[] = $event;
            } else {
                $msgFile = Storage::path('messages_' . $event['id'] . '.json');
                if (file_exists($msgFile)) unlink($msgFile);
                ParticipantRepository::delete($event['id']);
            }
        }

        return $active;
    }

    public static function getByChannel(int $channelId): array
    {
        $raw    = self::load($channelId);
        $active = self::pruneExpired($raw);

        self::save($channelId, $active);

        // Return only user-created (hilads) events — TM events have source=ticketmaster
        $hilads = array_values(array_filter($active, fn($e) => ($e['source'] ?? 'hilads') === 'hilads'));

        usort($hilads, fn($a, $b) => $a['starts_at'] - $b['starts_at']);

        return array_slice($hilads, 0, self::MAX_RETURN);
    }

    public static function getPublicByChannel(int $channelId): array
    {
        $raw    = self::load($channelId);
        $active = self::pruneExpired($raw);

        self::save($channelId, $active);

        $public = array_values(array_filter($active, fn($e) => ($e['source'] ?? 'hilads') === 'ticketmaster'));

        usort($public, fn($a, $b) => $a['starts_at'] - $b['starts_at']);

        return array_slice($public, 0, 10);
    }

    public static function upsertPublic(int $channelId, array $incoming): void
    {
        $raw = self::load($channelId);
        $now = time();

        // Index existing TM events by external_id for O(1) lookup
        $index = [];
        foreach ($raw as $i => $event) {
            if (($event['source'] ?? '') === 'ticketmaster' && !empty($event['external_id'])) {
                $index[$event['external_id']] = $i;
            }
        }

        foreach ($incoming as $new) {
            $extId = $new['external_id'];

            if (isset($index[$extId])) {
                // Update mutable fields on existing event
                $i = $index[$extId];
                $raw[$i]['title']        = $new['title'];
                $raw[$i]['venue']        = $new['venue'];
                $raw[$i]['location']     = $new['location'];
                $raw[$i]['image_url']    = $new['image_url'];
                $raw[$i]['external_url'] = $new['external_url'];
                $raw[$i]['starts_at']    = $new['starts_at'];
                $raw[$i]['expires_at']   = $new['expires_at'];
                $raw[$i]['updated_at']   = $now;
            } else {
                // Insert as a full internal event channel
                $raw[] = [
                    'id'           => bin2hex(random_bytes(8)),
                    'channel_id'   => $channelId,
                    'source'       => 'ticketmaster',
                    'external_id'  => $extId,
                    'title'        => $new['title'],
                    'type'         => 'city_event',
                    'venue'        => $new['venue'],
                    'location'     => $new['location'],
                    'image_url'    => $new['image_url'],
                    'external_url' => $new['external_url'],
                    'starts_at'    => $new['starts_at'],
                    'expires_at'   => $new['expires_at'],
                    'created_at'   => $now,
                    'updated_at'   => $now,
                    // Fields not applicable to imported events
                    'guest_id'     => null,
                    'nickname'     => null,
                    'location_hint'=> null,
                ];
            }
        }

        self::save($channelId, $raw);
    }

    // Find a non-expired event by its ID across all channels
    public static function findById(string $eventId): ?array
    {
        foreach (glob(Storage::dir() . '/events_*.json') ?: [] as $file) {
            $data = json_decode(file_get_contents($file), true);

            if (!is_array($data)) {
                continue;
            }

            foreach ($data as $event) {
                if ($event['id'] === $eventId) {
                    return $event['expires_at'] >= time() ? $event : null;
                }
            }
        }

        return null;
    }

    public static function add(
        int $channelId,
        string $guestId,
        string $nickname,
        string $title,
        ?string $locationHint,
        int $startsAt,
        string $type = 'other'
    ): array {
        // Load raw (including recently expired) to check cooldown history
        $raw = self::load($channelId);
        $now = time();

        // Cooldown: 5 minutes between event creations per guest per channel
        foreach ($raw as $event) {
            if ($event['guest_id'] === $guestId && ($now - $event['created_at']) < self::COOLDOWN) {
                Response::json(['error' => 'You must wait 5 minutes before creating another event'], 429);
            }
        }

        $active = self::pruneExpired($raw);

        // Cap: 1 active event per guest per channel
        foreach ($active as $event) {
            if ($event['guest_id'] === $guestId) {
                Response::json(['error' => 'You already have an active event in this channel'], 429);
            }
        }

        // Cap starts_at to 48h in the future; expires_at is always at least 2h from now
        $startsAt  = min($startsAt, $now + 48 * 3600);
        $expiresAt = max($startsAt, $now) + 2 * 3600;

        $event = [
            'id'            => bin2hex(random_bytes(8)),
            'channel_id'    => $channelId,
            'guest_id'      => $guestId,
            'nickname'      => $nickname,
            'title'         => $title,
            'type'          => $type,
            'location_hint' => $locationHint,
            'starts_at'     => $startsAt,
            'expires_at'    => $expiresAt,
            'created_at'    => $now,
        ];

        $active[] = $event;

        self::save($channelId, $active);

        return $event;
    }
}
