<?php

declare(strict_types=1);

class ParticipantRepository
{
    private static function filePath(string $eventId): string
    {
        return __DIR__ . '/../storage/participants_' . $eventId . '.json';
    }

    private static function load(string $eventId): array
    {
        $path = self::filePath($eventId);
        if (!file_exists($path)) return [];
        $data = json_decode(file_get_contents($path), true);
        return is_array($data) ? $data : [];
    }

    private static function save(string $eventId, array $data): void
    {
        file_put_contents(self::filePath($eventId), json_encode($data), LOCK_EX);
    }

    public static function toggle(string $eventId, string $sessionId): bool
    {
        $data = self::load($eventId);

        if (isset($data[$sessionId])) {
            unset($data[$sessionId]);
            $isIn = false;
        } else {
            $data[$sessionId] = true;
            $isIn = true;
        }

        self::save($eventId, $data);

        return $isIn;
    }

    public static function getCount(string $eventId): int
    {
        return count(self::load($eventId));
    }

    public static function isIn(string $eventId, string $sessionId): bool
    {
        return isset(self::load($eventId)[$sessionId]);
    }

    public static function delete(string $eventId): void
    {
        $path = self::filePath($eventId);
        if (file_exists($path)) unlink($path);
    }

    // Fire-and-forget broadcast to WS server — tells it to push the new count to viewers
    public static function broadcastToWs(string $eventId, int $count): void
    {
        $wsUrl = rtrim(getenv('WS_INTERNAL_URL') ?: 'http://localhost:8082', '/');
        $payload = json_encode(['eventId' => $eventId, 'count' => $count]);

        $ctx = stream_context_create([
            'http' => [
                'method'  => 'POST',
                'header'  => "Content-Type: application/json\r\nContent-Length: " . strlen($payload) . "\r\n",
                'content' => $payload,
                'timeout' => 1,
                'ignore_errors' => true,
            ],
        ]);

        @file_get_contents($wsUrl . '/broadcast/event-participants', false, $ctx);
    }
}
