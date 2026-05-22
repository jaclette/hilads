<?php

declare(strict_types=1);

/**
 * MentionService — @mention validation, suggestion sourcing, username resolution.
 *
 * Mentions are stored on messages.mentions as [{userId, offset, length}] — NO
 * username (resolved to the CURRENT username on read, so renames reflect
 * everywhere). Only registered users are mentionable; guests (no users row) are
 * never suggested or accepted. The mentionable set is context-scoped:
 *   city  → users.current_city_id = 'city_N'
 *   event → event_participants.user_id
 *   topic → topic_subscriptions.user_id
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
     * @param int   $contentLen     strlen($content) — loose upper bound (bytes ≥ JS index).
     * @return array Clean [{userId, offset, length}] safe to store.
     */
    public static function sanitize(array $raw, array $allowedUserIds, int $contentLen): array
    {
        $allowed = array_flip($allowedUserIds);
        $out  = [];
        $seen = [];
        foreach ($raw as $m) {
            if (!is_array($m)) continue;
            $uid = $m['userId'] ?? null;
            $off = $m['offset'] ?? null;
            $len = $m['length'] ?? null;
            if (!is_string($uid) || !isset($allowed[$uid])) continue;
            if (!is_int($off) || !is_int($len)) continue;
            if ($off < 0 || $len <= 0 || $off + $len > $contentLen) continue;
            $key = $uid . ':' . $off;
            if (isset($seen[$key])) continue;
            $seen[$key] = true;
            $out[] = ['userId' => $uid, 'offset' => $off, 'length' => $len];
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
     * @param array $messages Reference — text messages may carry
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
                if ($uid !== null && isset($nameById[$uid])) {
                    $resolved[] = [
                        'userId'   => $uid,
                        'username' => $nameById[$uid],
                        'offset'   => (int) ($m['offset'] ?? 0),
                        'length'   => (int) ($m['length'] ?? 0),
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
            $stmt = $pdo->prepare("SELECT user_id FROM topic_subscriptions WHERE topic_id = ?");
            $stmt->execute([$channelId]);
        } else { // city
            $stmt = $pdo->prepare("SELECT id FROM users WHERE current_city_id = ? AND deleted_at IS NULL");
            $stmt->execute([$channelId]);
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
        $cap  = self::MAX_SUGGESTIONS;          // int constant — safe to interpolate

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
            $sql = "
                SELECT u.id, u.username, u.display_name, u.profile_thumb_photo_url, u.profile_photo_url
                FROM topic_subscriptions ts
                JOIN users u ON u.id = ts.user_id
                WHERE ts.topic_id = ?
                  AND u.username IS NOT NULL AND u.deleted_at IS NULL
                  AND lower(u.username) LIKE ?
                  AND (CAST(? AS text) IS NULL OR u.id != ?)
                ORDER BY u.username ASC
                LIMIT $cap";
            $params = [$channelId, $like, $excludeUserId, $excludeUserId];
        } else { // city — active (recent presence) first, then other members
            $sql = "
                SELECT u.id, u.username, u.display_name, u.profile_thumb_photo_url, u.profile_photo_url,
                       (SELECT max(p.last_seen_at) FROM presence p WHERE p.user_id = u.id AND p.channel_id = ?) AS last_seen
                FROM users u
                WHERE u.current_city_id = ?
                  AND u.username IS NOT NULL AND u.deleted_at IS NULL
                  AND lower(u.username) LIKE ?
                  AND (CAST(? AS text) IS NULL OR u.id != ?)
                ORDER BY last_seen DESC NULLS LAST, u.username ASC
                LIMIT $cap";
            $params = [$channelId, $channelId, $like, $excludeUserId, $excludeUserId];
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
