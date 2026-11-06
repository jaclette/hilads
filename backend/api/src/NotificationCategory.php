<?php

declare(strict_types=1);

/**
 * V6 notification taxonomy: the category of each type (stored on the row,
 * drives the inbox filters, counts and preferences), its dedupe key (one row
 * per event), its grouping key (similar rows within a day become one inbox
 * item: "Lan and 3 others liked your photo"), and the bits of `data` the
 * inbox needs (actor, object, deep link). Pure functions, no database.
 */
final class NotificationCategory
{
    public const SOCIAL = 'social';
    public const GAME   = 'game';
    public const PLANS  = 'plans';
    public const CITY   = 'city';
    public const HILADS = 'hilads';
    public const ALL    = [self::SOCIAL, self::GAME, self::PLANS, self::CITY, self::HILADS];

    /** Window in which similar notifications fold into one inbox item. */
    public const GROUP_WINDOW_SECONDS = 86400;

    public static function of(string $type): string
    {
        return match (true) {
            in_array($type, [
                'mention', 'city_here', 'photo_comment', 'photo_mention', 'daily_vote',
                'friend_request_received', 'friend_request_accepted', 'friend_added',
                'vibe_received', 'profile_view', 'rating_received',
            ], true) => self::SOCIAL,
            in_array($type, ['new_event', 'event_join', 'event_message', 'join_request', 'join_request_accepted',
                             'topic_message', 'new_topic'], true) => self::PLANS,
            in_array($type, ['city_join', 'world_arrival', 'channel_message'], true) => self::CITY,
            in_array($type, ['admin_announcement', 'daily_admin'], true) => self::HILADS,
            str_starts_with($type, 'daily_') || str_starts_with($type, 'challenge_')
                || $type === 'new_challenge' => self::GAME,
            default => self::HILADS,
        };
    }

    /** SQL CASE expression mapping `type` to its category (the backfill, and rows written before V6). */
    public static function caseSql(string $column = 'type'): string
    {
        $types = [
            'mention', 'city_here', 'photo_comment', 'photo_mention', 'daily_vote', 'friend_request_received',
            'friend_request_accepted', 'friend_added', 'vibe_received', 'profile_view', 'rating_received',
            'new_event', 'event_join', 'event_message', 'join_request', 'join_request_accepted', 'topic_message',
            'new_topic', 'city_join', 'world_arrival', 'channel_message', 'admin_announcement', 'daily_admin',
            'new_challenge',
        ];
        $when = [];
        foreach ($types as $t) {
            $when[] = "WHEN '{$t}' THEN '" . self::of($t) . "'";
        }
        return "CASE {$column} " . implode(' ', $when)
            . " ELSE CASE WHEN {$column} LIKE 'daily\\_%' OR {$column} LIKE 'challenge\\_%' THEN 'game' ELSE 'hilads' END END";
    }

    /**
     * The key that makes the same event write one row only (a unique index per
     * recipient), or null for types that can legitimately repeat (messages).
     */
    public static function dedupeKey(string $type, array $data, ?DateTimeImmutable $now = null): ?string
    {
        $day = ($now ?? new DateTimeImmutable('now', new DateTimeZone('UTC')))->format('Y-m-d');
        $s   = static fn($v): string => mb_strtolower(trim((string) $v));
        return match ($type) {
            // One arrival per person, city and day ("kitty_3 just landed" twice).
            'city_join'     => 'arrival:' . $s($data['arriverName'] ?? '') . ':' . ($data['channelId'] ?? '') . ':' . $day,
            'world_arrival' => 'arrival:' . $s($data['nickname'] ?? '') . ':' . $s($data['cityName'] ?? '') . ':' . $day,
            'daily_vote'    => isset($data['proofId'], $data['voterId']) ? "vote:{$data['proofId']}:{$data['voterId']}" : null,
            'photo_comment', 'photo_mention' => isset($data['commentId']) ? "comment:{$data['commentId']}" : null,
            'profile_view'  => isset($data['viewerId']) ? "view:{$data['viewerId']}:{$day}" : null,
            'friend_request_received' => isset($data['requestId']) ? "freq:{$data['requestId']}" : null,
            'friend_request_accepted' => isset($data['accepterUserId']) ? "facc:{$data['accepterUserId']}" : null,
            'event_join'    => isset($data['eventId'], $data['senderUserId']) ? "join:{$data['eventId']}:{$data['senderUserId']}" : null,
            'daily_result'  => isset($data['date']) ? "result:{$data['date']}" : null,
            'daily_local_pass' => isset($data['cityId']) ? "localpass:{$data['cityId']}" : null,
            'daily_rank'    => isset($data['date'], $data['scope']) ? "rank:{$data['date']}:{$data['scope']}" : null,
            default         => null,
        };
    }

    /** Rows sharing this key (and type) within GROUP_WINDOW_SECONDS fold into one inbox item; null = never grouped. */
    public static function groupKey(string $type, array $data): ?string
    {
        return match ($type) {
            'daily_vote'                 => isset($data['proofId']) ? "vote:{$data['proofId']}" : null,
            'photo_comment'              => isset($data['proofId']) ? "comment:{$data['proofId']}" : null,
            'city_join', 'world_arrival' => 'arrival:' . ($data['channelId'] ?? mb_strtolower((string) ($data['cityName'] ?? ''))),
            'profile_view'               => 'views',
            'event_join'                 => isset($data['eventId']) ? "join:{$data['eventId']}" : null,
            'vibe_received'              => 'vibes',
            default                      => null,
        };
    }

    /** The person behind a row: [id|null, name|null], from the keys the writers use. */
    public static function actor(array $data): array
    {
        $id = null;
        foreach (['actorId', 'voterId', 'senderUserId', 'accepterUserId', 'viewerId', 'arriverUserId', 'userId'] as $k) {
            if (!empty($data[$k]) && is_string($data[$k])) { $id = $data[$k]; break; }
        }
        $name = null;
        foreach (['actorName', 'voterName', 'senderName', 'accepterName', 'viewerName', 'requesterName', 'arriverName', 'nickname', 'name'] as $k) {
            if (!empty($data[$k]) && is_string($data[$k])) { $name = $data[$k]; break; }
        }
        return [$id, $name];
    }

    /**
     * Where a tap goes, as an app path (the web maps the same paths). Mirrors
     * the app's former per-type routing (notifications.tsx), now in one place.
     */
    public static function deepLink(string $type, array $data): ?string
    {
        $q = static fn(array $p): string => http_build_query(array_filter($p, static fn($v) => $v !== null && $v !== ''));
        return match (true) {
            !empty($data['conversationId'])                       => '/dm/' . $data['conversationId'],
            !empty($data['topicId'])                              => '/topic/' . $data['topicId'],
            !empty($data['eventId'])                              => '/event/' . $data['eventId'],
            !empty($data['challengeId'])                          => '/challenge/' . $data['challengeId'],
            in_array($type, ['photo_comment', 'photo_mention'], true) && !empty($data['proofId'])
                => '/daily/' . ($data['date'] ?? 'today') . '?' . $q(['proof' => $data['proofId'], 'comment' => $data['commentId'] ?? null]),
            in_array($type, ['daily_vote', 'daily_twist_completed'], true) && !empty($data['proofId'])
                => '/daily/' . ($data['date'] ?? 'today') . '?' . $q(['proof' => $data['proofId']]),
            $type === 'daily_twist_picked'                        => '/daily/twist',
            $type === 'daily_result'                              => '/ranks?' . $q(['tab' => 'photos', 'period' => 'yesterday']),
            $type === 'daily_rank'                                => '/ranks?' . $q(['tab' => 'players', 'period' => 'week', 'scope' => $data['scope'] ?? null]),
            $type === 'daily_local_pass'                          => '/(tabs)/passport',
            in_array($type, ['channel_message', 'city_join', 'city_here'], true) => '/(tabs)/chat',
            $type === 'friend_request_received'                   => '/friend-requests',
            in_array($type, ['friend_request_accepted', 'friend_added', 'profile_view'], true)
                => !empty($data['accepterUserId'] ?? $data['viewerId'] ?? $data['senderUserId'] ?? null)
                    ? '/user/' . ($data['accepterUserId'] ?? $data['viewerId'] ?? $data['senderUserId']) : null,
            $type === 'vibe_received'                             => '/(tabs)/me',
            $type === 'world_arrival'                             => '/(tabs)/chat',
            default                                               => null,
        };
    }
}
