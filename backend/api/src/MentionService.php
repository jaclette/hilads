<?php

declare(strict_types=1);

/**
 * MentionService - @mention validation, suggestion sourcing, username resolution.
 *
 * Mentions are stored on messages.mentions as [{userId, offset, length}] - NO
 * username (resolved to the CURRENT username on read, so renames reflect
 * everywhere). Only registered users are mentionable; guests (no users row) are
 * never suggested or accepted. The mentionable set is context-scoped:
 *   city  → users.current_city_id = 'city_N' OR a recent message author in the city channel
 *   event → event_participants.user_id
 *   topic → topic_participants.user_id (the hangout's members)
 *
 * Offsets are owned by the client (JS UTF-16 indices into content) and the
 * renderer uses the same indices; the backend only stores them and bounds-checks
 * loosely against the byte length (a superset of the JS index, so valid mentions
 * are never rejected). Content is immutable (no message editing), so offsets stay
 * valid for the lifetime of the message.
 */
final class MentionService
{
    public const MAX_SUGGESTIONS = 8;
    public const MAX_PER_MESSAGE = 20;

    /**
     * Sanitize a client-supplied mention list against the userIds that are
     * actually mentionable in this context. Drops anything invalid (unknown user,
     * out-of-context, bad/oversized offsets), dedupes by (userId,offset), caps.
     *
     * @param array $raw            Client mentions: [{userId, offset, length}, ...]
     * @param array $allowedUserIds Mentionable userIds (string[]).
     * @param int   $contentLen     strlen($content) - loose upper bound (bytes ≥ JS index).
     * @return array Clean [{userId, offset, length}] safe to store.
     */
    public static function sanitize(array $raw, array $allowedUserIds, int $contentLen, array $allowedGuestIds = []): array
    {
        $allowed      = array_flip($allowedUserIds);
        $allowedGuest = array_flip($allowedGuestIds);
        $out  = [];
        $seen = [];
        foreach ($raw as $m) {
            if (!is_array($m)) continue;
            $off = $m['offset'] ?? null;
            $len = $m['length'] ?? null;
            if (!is_int($off) || !is_int($len)) continue;
            if ($off < 0 || $len <= 0 || $off + $len > $contentLen) continue;
            $uid = $m['userId'] ?? null;
            $gid = $m['guestId'] ?? null;
            if (is_string($uid) && isset($allowed[$uid])) {
                $key = 'u:' . $uid . ':' . $off;
                if (isset($seen[$key])) continue;
                $seen[$key] = true;
                $out[] = ['userId' => $uid, 'offset' => $off, 'length' => $len];
            } elseif (is_string($gid) && isset($allowedGuest[$gid])) {
                // Online-guest mention - anchored on the stable guestId (never the
                // display name). Live-only: $allowedGuestIds holds guests currently
                // present in the channel. No username stored (guests have no users
                // row); the client renders from message content + live presence.
                $key = 'g:' . $gid . ':' . $off;
                if (isset($seen[$key])) continue;
                $seen[$key] = true;
                $out[] = ['guestId' => $gid, 'offset' => $off, 'length' => $len];
            } else {
                continue;
            }
            if (count($out) >= self::MAX_PER_MESSAGE) break;
        }
        return $out;
    }

    /** Distinct userIds referenced by a stored mention list. */
    public static function userIds(array $mentions): array
    {
        $ids = [];
        foreach ($mentions as $m) {
            if (isset($m['userId']) && is_string($m['userId'])) $ids[$m['userId']] = true;
        }
        return array_keys($ids);
    }

    /**
     * Resolve each message's stored mentions to the CURRENT @username, in place.
     * Batched: one query for all userIds across the set. Mentions whose user was
     * deleted / lost their username are dropped (render as plain text).
     *
     * @param array $messages Reference - text messages may carry
     *                        ['mentions' => [{userId,offset,length}]].
     */
    public static function resolveForMessages(array &$messages): void
    {
        $allIds = [];
        foreach ($messages as $msg) {
            if (!empty($msg['mentions']) && is_array($msg['mentions'])) {
                foreach (self::userIds($msg['mentions']) as $id) $allIds[$id] = true;
            }
        }
        if (empty($allIds)) return;

        $ids = array_keys($allIds);
        $in  = implode(',', array_fill(0, count($ids), '?'));
        $stmt = Database::pdo()->prepare(
            "SELECT id, username FROM users WHERE id IN ($in) AND username IS NOT NULL AND deleted_at IS NULL"
        );
        $stmt->execute($ids);
        $nameById = array_column($stmt->fetchAll(\PDO::FETCH_ASSOC), 'username', 'id');

        foreach ($messages as &$msg) {
            if (empty($msg['mentions']) || !is_array($msg['mentions'])) continue;
            $resolved = [];
            foreach ($msg['mentions'] as $m) {
                $uid = $m['userId'] ?? null;
                $gid = $m['guestId'] ?? null;
                if ($uid !== null && isset($nameById[$uid])) {
                    $resolved[] = [
                        'userId'   => $uid,
                        'username' => $nameById[$uid],
                        'offset'   => (int) ($m['offset'] ?? 0),
                        'length'   => (int) ($m['length'] ?? 0),
                    ];
                } elseif (is_string($gid) && $gid !== '') {
                    // Guest mention - no users row to resolve. Pass through; the
                    // client renders the @name from message content and decides
                    // online/inert from live presence (guestId is the anchor).
                    $resolved[] = [
                        'guestId' => $gid,
                        'offset'  => (int) ($m['offset'] ?? 0),
                        'length'  => (int) ($m['length'] ?? 0),
                    ];
                }
            }
            $msg['mentions'] = $resolved;
        }
        unset($msg);
    }

    /** Convenience: resolve a single stored mention list to current usernames. */
    public static function resolveOne(array $mentions): array
    {
        $wrap = [['mentions' => $mentions]];
        self::resolveForMessages($wrap);
        return $wrap[0]['mentions'];
    }

    /** Registered userIds mentionable in a context (for send-time validation). */
    public static function mentionableUserIds(string $context, string $channelId): array
    {
        $pdo = Database::pdo();
        if ($context === 'event') {
            $stmt = $pdo->prepare("SELECT DISTINCT user_id FROM event_participants WHERE channel_id = ? AND user_id IS NOT NULL");
            $stmt->execute([$channelId]);
        } elseif ($context === 'topic') {
            // Members of the hangout (topic_participants), not just posters - so a
            // member who joined but hasn't messaged yet is still mentionable.
            $stmt = $pdo->prepare("SELECT user_id FROM topic_participants WHERE topic_id = ?");
            $stmt->execute([$channelId]);
        } elseif ($context === 'challenge') {
            // Mentionable in a challenge channel = the creator (challenger), any
            // registered acceptor/joiner (challenge_participants), AND anyone who
            // has posted a message here. Guests have no @handle, so user_id NOT
            // NULL filters them out. Keep in sync with suggest('challenge').
            $stmt = $pdo->prepare("
                SELECT DISTINCT uid FROM (
                    SELECT created_by AS uid FROM channel_challenges    WHERE channel_id = ? AND created_by IS NOT NULL
                    UNION
                    SELECT user_id   AS uid FROM challenge_participants WHERE channel_id = ? AND user_id   IS NOT NULL
                    UNION
                    SELECT user_id   AS uid FROM messages              WHERE channel_id = ? AND user_id   IS NOT NULL
                ) t
            ");
            $stmt->execute([$channelId, $channelId, $channelId]);
        } else { // city
            // PR29 - Mentionable in a city = ACTUAL members of that city only:
            // current_city_id (the source of truth per the membership rule)
            // OR an explicit row in user_city_memberships (legacy + the
            // belt-and-braces upsert /me/city writes alongside current_city_id).
            // The previous "OR posted recently in this channel" branch surfaced
            // travellers who'd dropped a message but never became members -
            // hence the bug where users like BigFatBison showed up as mention
            // suggestions in Ho Chi Minh City despite not being a member.
            // Travellers ARE city members of wherever they're currently in
            // (current_city_id flips on geo arrival), so this gate doesn't
            // exclude legitimate visitors.
            $stmt = $pdo->prepare("
                SELECT u.id
                FROM users u
                WHERE u.deleted_at IS NULL
                  AND (
                        u.current_city_id = ?
                     OR EXISTS (
                          SELECT 1 FROM user_city_memberships ucm
                          WHERE ucm.channel_id = ? AND ucm.user_id = u.id
                        )
                  )
            ");
            $stmt->execute([$channelId, $channelId]);
        }
        return $stmt->fetchAll(\PDO::FETCH_COLUMN);
    }

    /**
     * Autocomplete suggestions for the @ picker. Registered users only, prefix
     * match on username (case-insensitive), excludes the caller, capped. For city,
     * currently-active users (recent presence) are surfaced first.
     *
     * @return array [{ userId, username, displayName, avatarUrl }]
     */
    public static function suggest(string $context, string $channelId, string $q, ?string $excludeUserId): array
    {
        $pdo  = Database::pdo();
        $like = strtolower(trim($q)) . '%';   // prefix match ('' → everyone)
        $cap  = self::MAX_SUGGESTIONS;          // int constant - safe to interpolate

        if ($context === 'event') {
            $sql = "
                SELECT DISTINCT u.id, u.username, u.display_name, u.profile_thumb_photo_url, u.profile_photo_url
                FROM event_participants ep
                JOIN users u ON u.id = ep.user_id
                WHERE ep.channel_id = ?
                  AND u.username IS NOT NULL AND u.deleted_at IS NULL
                  AND lower(u.username) LIKE ?
                  AND (CAST(? AS text) IS NULL OR u.id != ?)
                ORDER BY u.username ASC
                LIMIT $cap";
            $params = [$channelId, $like, $excludeUserId, $excludeUserId];
        } elseif ($context === 'topic') {
            // Suggest the hangout's members (topic_participants) - same as an event
            // suggests its participants - so you can tag anyone who's in it.
            $sql = "
                SELECT u.id, u.username, u.display_name, u.profile_thumb_photo_url, u.profile_photo_url
                FROM topic_participants tp
                JOIN users u ON u.id = tp.user_id
                WHERE tp.topic_id = ?
                  AND u.username IS NOT NULL AND u.deleted_at IS NULL
                  AND lower(u.username) LIKE ?
                  AND (CAST(? AS text) IS NULL OR u.id != ?)
                ORDER BY u.username ASC
                LIMIT $cap";
            $params = [$channelId, $like, $excludeUserId, $excludeUserId];
        } elseif ($context === 'challenge') {
            // Suggest the challenge's creator (challenger), its registered
            // acceptors/joiners (challenge_participants), and anyone who has
            // posted a message in the channel. Guests are filtered out (no @
            // handle). Keep in sync with mentionableUserIds('challenge') so a
            // suggested handle is never stripped at send time.
            $sql = "
                SELECT DISTINCT u.id, u.username, u.display_name, u.profile_thumb_photo_url, u.profile_photo_url
                FROM users u
                WHERE u.username IS NOT NULL AND u.deleted_at IS NULL
                  AND lower(u.username) LIKE ?
                  AND (CAST(? AS text) IS NULL OR u.id != ?)
                  AND (
                        u.id = (SELECT created_by FROM channel_challenges WHERE channel_id = ?)
                     OR EXISTS (SELECT 1 FROM challenge_participants cp WHERE cp.channel_id = ? AND cp.user_id = u.id)
                     OR EXISTS (SELECT 1 FROM messages m WHERE m.channel_id = ? AND m.user_id = u.id)
                  )
                ORDER BY u.username ASC
                LIMIT $cap";
            $params = [$like, $excludeUserId, $excludeUserId, $channelId, $channelId, $channelId];
        } else { // city - actual members of the city only
            // PR29 - Mirror mentionableUserIds(): match on current_city_id
            // OR an explicit user_city_memberships row. Previously the gate
            // also fell through for "anyone who posted here in the last
            // 30 days", which surfaced travellers / one-off posters as
            // mention suggestions in a city they're not a member of.
            $sql = "
                SELECT u.id, u.username, u.display_name, u.profile_thumb_photo_url, u.profile_photo_url
                FROM users u
                WHERE u.username IS NOT NULL AND u.deleted_at IS NULL
                  AND lower(u.username) LIKE ?
                  AND (CAST(? AS text) IS NULL OR u.id != ?)
                  AND (
                        u.current_city_id = ?
                     OR EXISTS (
                          SELECT 1 FROM user_city_memberships ucm
                          WHERE ucm.channel_id = ? AND ucm.user_id = u.id
                        )
                  )
                ORDER BY u.username ASC
                LIMIT $cap";
            $params = [$like, $excludeUserId, $excludeUserId, $channelId, $channelId];
        }

        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        return array_map(static fn(array $r): array => [
            'userId'      => $r['id'],
            'username'    => $r['username'],
            'displayName' => $r['display_name'],
            'avatarUrl'   => $r['profile_thumb_photo_url'] ?? $r['profile_photo_url'] ?? null,
        ], $stmt->fetchAll(\PDO::FETCH_ASSOC));
    }
}
