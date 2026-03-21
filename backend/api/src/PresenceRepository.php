<?php

declare(strict_types=1);

class PresenceRepository
{
    private const TTL = 60; // seconds without heartbeat before a user is considered offline

    private static function filePath(int $channelId): string
    {
        return __DIR__ . '/../storage/presence_' . $channelId . '.json';
    }

    // Load presence keyed by guestId: { "guestId": { guestId, nickname, lastSeenAt } }
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

    public static function join(int $channelId, string $guestId, string $nickname): void
    {
        $presence = self::pruneStale(self::load($channelId));

        $presence[$guestId] = [
            'guestId'    => $guestId,
            'nickname'   => $nickname,
            'lastSeenAt' => time(),
        ];

        self::save($channelId, $presence);
    }

    public static function leave(int $channelId, string $guestId): void
    {
        $presence = self::pruneStale(self::load($channelId));

        unset($presence[$guestId]);

        self::save($channelId, $presence);
    }

    public static function heartbeat(int $channelId, string $guestId): void
    {
        $presence = self::pruneStale(self::load($channelId));

        if (!isset($presence[$guestId])) {
            return; // user not in this room, ignore
        }

        $presence[$guestId]['lastSeenAt'] = time();

        self::save($channelId, $presence);
    }

    public static function getOnline(int $channelId): array
    {
        return array_values(self::pruneStale(self::load($channelId)));
    }

    public static function getCount(int $channelId): int
    {
        return count(self::pruneStale(self::load($channelId)));
    }
}
