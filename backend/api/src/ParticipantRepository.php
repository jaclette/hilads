<?php

declare(strict_types=1);

class ParticipantRepository
{
    /**
     * Toggle participation for a session.
     * sessionId is stored as guest_id — same key, same behaviour as before.
     * Returns true if now participating, false if just left.
     */
    /**
     * @param string|null $userId  Registered user id if the participant is authenticated.
     *                             Stored so we can later query "events this user joined".
     */
    public static function toggle(string $eventId, string $sessionId, ?string $userId = null): bool
    {
        $pdo = Database::pdo();

        $stmt = $pdo->prepare("
            SELECT 1 FROM event_participants
            WHERE channel_id = ? AND guest_id = ?
        ");
        $stmt->execute([$eventId, $sessionId]);

        if ($stmt->fetchColumn()) {
            $pdo->prepare("
                DELETE FROM event_participants
                WHERE channel_id = ? AND guest_id = ?
            ")->execute([$eventId, $sessionId]);
            return false;
        }

        $pdo->prepare("
            INSERT INTO event_participants (channel_id, guest_id, user_id)
            VALUES (?, ?, ?)
            ON CONFLICT (channel_id, guest_id) DO UPDATE SET user_id = EXCLUDED.user_id
        ")->execute([$eventId, $sessionId, $userId]);

        return true;
    }

    public static function getCount(string $eventId): int
    {
        $stmt = Database::pdo()->prepare("
            SELECT COUNT(*) FROM event_participants WHERE channel_id = ?
        ");
        $stmt->execute([$eventId]);
        return (int) $stmt->fetchColumn();
    }

    public static function isIn(string $eventId, string $sessionId): bool
    {
        $stmt = Database::pdo()->prepare("
            SELECT 1 FROM event_participants
            WHERE channel_id = ? AND guest_id = ?
        ");
        $stmt->execute([$eventId, $sessionId]);
        return (bool) $stmt->fetchColumn();
    }

    /**
     * No-op: participants are now in Postgres and expire naturally
     * with their parent event channel (ON DELETE CASCADE).
     */
    public static function delete(string $eventId): void {}

    // Fire-and-forget broadcast to WS server — tells it to push the new count to viewers
    public static function broadcastToWs(string $eventId, int $count): void
    {
        $wsUrl   = rtrim(getenv('WS_INTERNAL_URL') ?: 'http://localhost:8082', '/');
        $payload = json_encode(['eventId' => $eventId, 'count' => $count]);

        $ctx = stream_context_create([
            'http' => [
                'method'        => 'POST',
                'header'        => "Content-Type: application/json\r\nContent-Length: " . strlen($payload) . "\r\n",
                'content'       => $payload,
                'timeout'       => 1,
                'ignore_errors' => true,
            ],
        ]);

        @file_get_contents($wsUrl . '/broadcast/event-participants', false, $ctx);
    }
}
