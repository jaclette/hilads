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
    public static function toggle(string $eventId, string $sessionId, ?string $userId = null, string $nickname = ''): bool
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
            INSERT INTO event_participants (channel_id, guest_id, user_id, nickname)
            VALUES (?, ?, ?, ?)
            ON CONFLICT (channel_id, guest_id) DO UPDATE SET user_id = EXCLUDED.user_id, nickname = EXCLUDED.nickname
        ")->execute([$eventId, $sessionId, $userId, $nickname]);

        return true;
    }

    /**
     * Returns the list of participants as canonical UserDTOs (via UserResource),
     * enriched with profile data for registered users.
     *
     * @return array  Each entry is a UserDTO + { joinedAt: int }
     */
    public static function getParticipants(string $eventId): array
    {
        $stmt = Database::pdo()->prepare("
            SELECT ep.guest_id, ep.user_id, ep.nickname,
                   EXTRACT(EPOCH FROM ep.joined_at)::int AS joined_at,
                   -- NULL-out deleted users so the PHP fallback renders them as guests
                   CASE WHEN u.deleted_at IS NULL THEN u.display_name      ELSE NULL END AS display_name,
                   CASE WHEN u.deleted_at IS NULL THEN u.profile_photo_url ELSE NULL END AS profile_photo_url,
                   CASE WHEN u.deleted_at IS NULL THEN u.vibe              ELSE NULL END AS vibe,
                   CASE WHEN u.deleted_at IS NULL THEN u.created_at        ELSE NULL END AS created_at
            FROM event_participants ep
            LEFT JOIN users u ON u.id = ep.user_id
            WHERE ep.channel_id = ?
            ORDER BY ep.joined_at ASC
        ");
        $stmt->execute([$eventId]);

        return array_map(function (array $r): array {
            $joinedAt = (int) $r['joined_at'];

            if ($r['user_id'] !== null && $r['display_name'] !== null) {
                // Active registered user
                $userRow = [
                    'id'                => $r['user_id'],
                    'display_name'      => $r['display_name'],
                    'profile_photo_url' => $r['profile_photo_url'],
                    'vibe'              => $r['vibe'],
                    'created_at'        => $r['created_at'],
                    'home_city'         => null,
                ];
                return array_merge(UserResource::fromUser($userRow), ['joinedAt' => $joinedAt]);
            }

            if ($r['user_id'] !== null) {
                // Registered user who has since been deleted — show as "Former member"
                return array_merge(
                    UserResource::fromGuest($r['guest_id'], 'Former member'),
                    ['joinedAt' => $joinedAt],
                );
            }

            return array_merge(
                UserResource::fromGuest($r['guest_id'], $r['nickname']),
                ['joinedAt' => $joinedAt],
            );
        }, $stmt->fetchAll(\PDO::FETCH_ASSOC));
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
