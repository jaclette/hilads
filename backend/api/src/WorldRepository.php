<?php

/**
 * WorldRepository — the global "World" companion channel.
 *
 * Owns: per-(identity, channel) read positions + symmetric unread counts, and the
 * cached activity aggregate (online / cities / cross-city challenges) that powers
 * the World header banner + pills.
 *
 * Bot exclusion: presence-derived counts exclude the 'bot' sentinel guest_id
 * (POST /guest/session hands known-crawler UAs guestId='bot'), defence-in-depth
 * on top of the UA gate applied to the write paths.
 */
class WorldRepository
{
    public const WORLD_ID = 'world';

    private static function dbKey(int|string $channelId): string
    {
        return (is_int($channelId) || ctype_digit((string) $channelId))
            ? 'city_' . (int) $channelId
            : (string) $channelId;
    }

    /** Unified read/unread identity: cross-device for accounts, device-local for guests. */
    public static function identityKey(?string $userId, ?string $guestId): ?string
    {
        if (!empty($userId))  return 'u:' . $userId;
        if (!empty($guestId)) return 'g:' . $guestId;
        return null;
    }

    /** Mark a channel read up to now for this identity. Idempotent upsert. */
    public static function markRead(string $identityKey, int|string $channelId): void
    {
        Database::pdo()->prepare("
            INSERT INTO channel_read_positions (identity_key, channel_id, last_read_at, updated_at)
            VALUES (?, ?, now(), now())
            ON CONFLICT (identity_key, channel_id)
            DO UPDATE SET last_read_at = now(), updated_at = now()
        ")->execute([$identityKey, self::dbKey($channelId)]);
    }

    /**
     * Unread CHAT count (text/image) per channel for this identity, excluding the
     * caller's own messages. Returns [clientChannelId => count]. No read position
     * yet → everything counts (epoch fallback). Curated system messages don't
     * inflate the badge. Rides idx_messages_channel_type_time.
     */
    public static function unreadCounts(string $identityKey, ?string $guestId, ?string $userId, array $channelIds): array
    {
        $out  = [];
        $stmt = Database::pdo()->prepare("
            SELECT COUNT(*) AS n
            FROM messages m
            WHERE m.channel_id = :cid
              AND m.type IN ('text','image')
              AND m.deleted_at IS NULL
              AND m.created_at > COALESCE(
                    (SELECT last_read_at FROM channel_read_positions
                     WHERE identity_key = :ik AND channel_id = :cid),
                    'epoch')
              AND NOT (
                    (:gid IS NOT NULL AND m.guest_id = :gid) OR
                    (:uid IS NOT NULL AND m.user_id  = :uid)
              )
        ");
        foreach ($channelIds as $cid) {
            $stmt->execute([
                ':cid' => self::dbKey($cid), ':ik' => $identityKey,
                ':gid' => $guestId ?: null,  ':uid' => $userId ?: null,
            ]);
            $out[(string) $cid] = (int) $stmt->fetchColumn();
        }
        return $out;
    }

    /** World header/pills aggregate. Cache at the route layer (Cache.php, 30-60s). */
    public static function activity(): array
    {
        $pdo = Database::pdo();

        // "N en ligne" — distinct humans active across ALL cities in the last 300s.
        $online = (int) $pdo->query("
            SELECT COUNT(DISTINCT guest_id) FROM presence
            WHERE last_seen_at > now() - interval '300 seconds'
              AND guest_id <> 'bot'
        ")->fetchColumn();

        // "N villes" — cities with >=1 real chat message in the last 24h.
        $cities = (int) $pdo->query("
            SELECT COUNT(DISTINCT channel_id) FROM messages
            WHERE channel_id LIKE 'city_%'
              AND type IN ('text','image')
              AND created_at > now() - interval '24 hours'
        ")->fetchColumn();

        // Cross-city challenges — derived from the World 'challenge_created' system
        // messages the backend hook records (emergent: participants span >=2 cities).
        // Cheap: small set, indexed by channel_id + created_at.
        $rows = $pdo->query("
            SELECT payload FROM messages
            WHERE channel_id = 'world' AND type = 'system' AND event = 'challenge_created'
              AND created_at > now() - interval '48 hours'
        ")->fetchAll();
        $challengeIds = [];
        $cityset      = [];
        foreach ($rows as $r) {
            $p = json_decode($r['payload'] ?? 'null', true);
            if (!is_array($p)) continue;
            if (!empty($p['challenge_id'])) $challengeIds[$p['challenge_id']] = true;
            foreach (['city_a', 'city_b'] as $k) {
                if (!empty($p[$k])) $cityset[$p[$k]] = true;
            }
        }

        return [
            'online'    => $online,
            'cities'    => $cities,
            'crossCity' => [
                'count'  => count($challengeIds),
                'cities' => array_keys($cityset),
            ],
        ];
    }

    /** Recent World chat volume — used to avoid routing a quiet-city user to a quiet World. */
    public static function recentMessageCount(int $hours): int
    {
        $stmt = Database::pdo()->prepare("
            SELECT COUNT(*) FROM messages
            WHERE channel_id = 'world' AND type IN ('text','image')
              AND created_at > now() - (? * interval '1 hour')
        ");
        $stmt->execute([$hours]);
        return (int) $stmt->fetchColumn();
    }
}
