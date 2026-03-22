<?php

declare(strict_types=1);

class PresenceRepository
{
    private const TTL = 60; // seconds without heartbeat before a user is considered offline

    private static function filePath(int $channelId): string
    {
        return Storage::path('presence_' . $channelId . '.json');
    }

    // Load presence keyed by sessionId: { "sessionId": { sessionId, guestId, nickname, lastSeenAt } }
    private static function load(int $channelId): array
    {
        $path = self::filePath($channelId);

        if (!file_exists($path)) {
            return [];
        }

        $data = json_decode(file_get_contents($path), true);

        return is_array($data) ? $data : [];
    }

    private static function save(int $channelId, array $presence): void
    {
        file_put_contents(
            self::filePath($channelId),
            json_encode($presence, JSON_FORCE_OBJECT),
            LOCK_EX
        );
    }

    // Remove entries whose lastSeenAt is older than TTL
    private static function pruneStale(array $presence): array
    {
        $cutoff = time() - self::TTL;

        return array_filter($presence, fn($p) => $p['lastSeenAt'] >= $cutoff);
    }

    public static function join(int $channelId, string $sessionId, string $guestId, string $nickname): void
    {
        $presence = self::pruneStale(self::load($channelId));

        $presence[$sessionId] = [
            'sessionId'  => $sessionId,
            'guestId'    => $guestId,
            'nickname'   => $nickname,
            'lastSeenAt' => time(),
        ];

        self::save($channelId, $presence);
    }

    public static function leave(int $channelId, string $sessionId): void
    {
        $presence = self::pruneStale(self::load($channelId));

        unset($presence[$sessionId]);

        self::save($channelId, $presence);
    }

    public static function heartbeat(int $channelId, string $sessionId, string $guestId, string $nickname): void
    {
        $presence = self::pruneStale(self::load($channelId));

        if (!isset($presence[$sessionId])) {
            // Re-insert if expired (e.g. after server restart or TTL lapse while tab was open)
            $presence[$sessionId] = [
                'sessionId'  => $sessionId,
                'guestId'    => $guestId,
                'nickname'   => $nickname,
                'lastSeenAt' => time(),
            ];
        } else {
            $presence[$sessionId]['lastSeenAt'] = time();
        }

        self::save($channelId, $presence);
    }

    // Remove a session from all channels — used on browser tab close
    public static function disconnect(string $sessionId): void
    {
        foreach (glob(Storage::dir() . '/presence_*.json') ?: [] as $file) {
            preg_match('/presence_(\d+)\.json$/', $file, $m);
            if (empty($m[1])) continue;
            $channelId = (int) $m[1];
            $presence  = self::pruneStale(self::load($channelId));
            if (isset($presence[$sessionId])) {
                unset($presence[$sessionId]);
                self::save($channelId, $presence);
            }
        }
    }

    // Returns unique online users (deduplicated by guestId — one entry per person even with multiple tabs)
    public static function getOnline(int $channelId): array
    {
        $presence = self::pruneStale(self::load($channelId));
        $seen     = [];
        $result   = [];

        foreach ($presence as $entry) {
            if (!isset($seen[$entry['guestId']])) {
                $seen[$entry['guestId']] = true;
                $result[] = [
                    'guestId'  => $entry['guestId'],
                    'nickname' => $entry['nickname'],
                ];
            }
        }

        return $result;
    }

    public static function getCount(int $channelId): int
    {
        return count(self::getOnline($channelId));
    }
}
