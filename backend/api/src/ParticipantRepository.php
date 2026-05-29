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
        // Dedupe by person: a registered user who joined via several ephemeral
        // web sessions (or, pre-migration, across many occurrences) has multiple
        // rows with the same user_id but different guest_ids. COALESCE(user_id,
        // guest_id) collapses those to one attendee (earliest join kept).
        $stmt = Database::pdo()->prepare("
            SELECT guest_id, user_id, nickname, joined_at,
                   display_name, profile_photo_url, vibe, created_at
            FROM (
                SELECT DISTINCT ON (COALESCE(ep.user_id, ep.guest_id))
                       ep.guest_id, ep.user_id, ep.nickname,
                       EXTRACT(EPOCH FROM ep.joined_at)::int AS joined_at,
                       -- NULL-out deleted users so the PHP fallback renders them as guests
                       CASE WHEN u.deleted_at IS NULL THEN u.display_name      ELSE NULL END AS display_name,
                       CASE WHEN u.deleted_at IS NULL THEN u.profile_photo_url ELSE NULL END AS profile_photo_url,
                       CASE WHEN u.deleted_at IS NULL THEN u.vibe              ELSE NULL END AS vibe,
                       CASE WHEN u.deleted_at IS NULL THEN u.created_at        ELSE NULL END AS created_at
                FROM event_participants ep
                LEFT JOIN users u ON u.id = ep.user_id
                WHERE ep.channel_id = ?
                ORDER BY COALESCE(ep.user_id, ep.guest_id), ep.joined_at ASC
            ) d
            ORDER BY d.joined_at ASC
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

    /**
     * Batch-fetch a small attendee avatar preview for many events in ONE query.
     *
     * Returns [channelId => [ {id, displayName, thumbAvatarUrl}, ... up to $limit ]],
     * most-recent-joiner first. Powers the avatar row on event cards without an
     * N+1 per-card request — mirrors the batched count query in EventRepository.
     *
     * Guests / deleted users have no photo → thumbAvatarUrl is null and the
     * client renders an initial fallback, so no private photo or profile is
     * exposed (ghost mode respected by construction).
     */
    public static function getPreviewBatch(array $eventIds, int $limit = 5): array
    {
        if (empty($eventIds)) return [];

        $placeholders = implode(',', array_fill(0, count($eventIds), '?'));
        // $limit is a trusted int (constant/caller) — interpolated like the other
        // LIMIT clauses here, which sidesteps a Postgres bigint <= text param mismatch.
        $limit = max(1, (int) $limit);
        // Inner DISTINCT ON collapses multiple rows for the same person (same
        // user_id, different ephemeral guest_ids) to one before we pick the top-N
        // avatars — otherwise a user who joined repeatedly shows multiple times.
        $stmt = Database::pdo()->prepare("
            SELECT channel_id, id, display_name, nickname, thumb_url, full_url FROM (
                SELECT *, row_number() OVER (PARTITION BY channel_id ORDER BY joined_at DESC) AS rn
                FROM (
                    SELECT DISTINCT ON (ep.channel_id, COALESCE(ep.user_id, ep.guest_id))
                           ep.channel_id,
                           COALESCE(ep.user_id, ep.guest_id) AS id,
                           ep.nickname,
                           ep.joined_at,
                           CASE WHEN u.deleted_at IS NULL THEN u.display_name            ELSE NULL END AS display_name,
                           CASE WHEN u.deleted_at IS NULL THEN u.profile_thumb_photo_url ELSE NULL END AS thumb_url,
                           CASE WHEN u.deleted_at IS NULL THEN u.profile_photo_url        ELSE NULL END AS full_url
                    FROM event_participants ep
                    LEFT JOIN users u ON u.id = ep.user_id
                    WHERE ep.channel_id IN ($placeholders)
                    ORDER BY ep.channel_id, COALESCE(ep.user_id, ep.guest_id), ep.joined_at DESC
                ) deduped
            ) t
            WHERE t.rn <= $limit
            ORDER BY t.channel_id, t.rn
        ");
        $stmt->execute(array_values($eventIds));

        $out = [];
        foreach ($stmt->fetchAll(\PDO::FETCH_ASSOC) as $r) {
            $name = $r['display_name'] ?? '';
            if ($name === '' || $name === null) {
                $name = ($r['nickname'] ?? '') !== '' ? $r['nickname'] : 'Guest';
            }
            $out[$r['channel_id']][] = [
                'id'             => $r['id'],
                'displayName'    => $name,
                'thumbAvatarUrl' => $r['thumb_url'] ?? $r['full_url'],
            ];
        }
        return $out;
    }

    public static function getCount(string $eventId): int
    {
        $stmt = Database::pdo()->prepare("
            SELECT COUNT(DISTINCT COALESCE(user_id, guest_id)) FROM event_participants WHERE channel_id = ?
        ");
        $stmt->execute([$eventId]);
        return (int) $stmt->fetchColumn();
    }

    /**
     * Is this caller participating in the event?
     *
     * Matches the participant row by the session/guest key OR — for logged-in
     * users — their user_id. The user_id match is what keeps the Join/Going
     * button in sync with the "X going" count and attendee list: those include
     * the user's row regardless of which session created it, so the button must
     * recognise the row the same way. Without it, a registered user whose current
     * key differs from the one stored at join time (web: ephemeral per-page
     * sessionId; native: a different device's guestId) reads as "not joined"
     * while still appearing in the count/attendee list — contradicting itself.
     */
    public static function isIn(string $eventId, string $sessionId, ?string $userId = null): bool
    {
        if ($userId !== null && $userId !== '') {
            $stmt = Database::pdo()->prepare("
                SELECT 1 FROM event_participants
                WHERE channel_id = ? AND (guest_id = ? OR user_id = ?)
                LIMIT 1
            ");
            $stmt->execute([$eventId, $sessionId, $userId]);
        } else {
            $stmt = Database::pdo()->prepare("
                SELECT 1 FROM event_participants
                WHERE channel_id = ? AND guest_id = ?
            ");
            $stmt->execute([$eventId, $sessionId]);
        }
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
