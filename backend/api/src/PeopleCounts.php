<?php

declare(strict_types=1);

/**
 * People counts for the Chat tab's people row (V3-04, SPEC 9.6): people here
 * now, people in an active Hi now, arrivals this week and tonight's plans.
 * A count below MIN comes back as null, so the row never shows "1 nearby".
 */
final class PeopleCounts
{
    /** Counts below this are not returned (SPEC 9.6, indicative 3). */
    public const MIN = 3;
    public const TONIGHT_MAX = 3;
    public const CACHE_TTL = 30;

    public static function gate(int $n): ?int
    {
        return $n >= self::MIN ? $n : null;
    }

    /**
     * Today's remaining plans of a city (ongoing or starting before the end of
     * the local day), most joined first: [{id, title, startsAt, going}].
     * $events are EventRepository rows; $endOfDay a unix time.
     */
    public static function tonight(array $events, int $now, int $endOfDay): array
    {
        $out = [];
        foreach ($events as $e) {
            if (($e['source'] ?? null) !== 'hilads' || !empty($e['is_venue'])
                || (int) $e['ends_at'] <= $now || (int) $e['starts_at'] >= $endOfDay) {
                continue;
            }
            $out[$e['id'] . '@' . $e['starts_at']] = [
                'id'       => $e['id'],
                'title'    => $e['title'],
                'startsAt' => (int) $e['starts_at'],
                'going'    => (int) ($e['participant_count'] ?? 0),
            ];
        }
        $out = array_values($out);
        usort($out, static fn(array $a, array $b): int => [$b['going'], $a['startsAt']] <=> [$a['going'], $b['startsAt']]);
        return array_map(static fn(array $p): array => ['going' => self::gate($p['going'])] + $p,
                         array_slice($out, 0, self::TONIGHT_MAX));
    }

    /**
     * Tonight's plans with up to 3 avatars of the people going (photos only),
     * shown only where the count itself shows (going >= MIN): [... + avatars].
     */
    private static function withAvatars(PDO $pdo, array $plans): array
    {
        $ids = array_values(array_unique(array_column(array_filter($plans, static fn(array $p): bool => $p['going'] !== null), 'id')));
        $by  = [];
        if ($ids !== []) {
            $stmt = $pdo->prepare("
                SELECT p.channel_id, coalesce(u.profile_thumb_photo_url, u.profile_photo_url) AS photo
                FROM event_participants p JOIN users u ON u.id = p.user_id
                WHERE p.channel_id IN (" . implode(',', array_fill(0, count($ids), '?')) . ")
                  AND u.deleted_at IS NULL AND coalesce(u.profile_thumb_photo_url, u.profile_photo_url) IS NOT NULL
                ORDER BY p.joined_at
            ");
            $stmt->execute($ids);
            foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
                if (count($by[$r['channel_id']] ?? []) < 3) {
                    $by[$r['channel_id']][] = $r['photo'];
                }
            }
        }
        return array_map(static fn(array $p): array => $p + ['avatars' => $p['going'] !== null ? ($by[$p['id']] ?? []) : []], $plans);
    }

    /** {nearby, hiNow, arrivalsWeek, tonight} for a city channel number. Cached CACHE_TTL seconds. */
    public static function forCity(int $cityChannel): array
    {
        return Cache::remember('people_v2_' . $cityChannel, self::CACHE_TTL, static function () use ($cityChannel): array {
            $pdo    = Database::pdo();
            $cityId = 'city_' . $cityChannel;

            $hiNow = $pdo->prepare("
                SELECT count(DISTINCT x.who) FROM (
                    SELECT t.channel_id, COALESCE(t.created_by, t.guest_id) AS who
                    FROM channel_topics t JOIN channels c ON c.id = t.channel_id
                    WHERE t.city_id = ? AND t.expires_at > now() AND c.status = 'active'
                    UNION
                    SELECT p.topic_id, p.user_id
                    FROM topic_participants p
                    JOIN channel_topics t ON t.channel_id = p.topic_id
                    JOIN channels c       ON c.id = t.channel_id
                    WHERE t.city_id = ? AND t.expires_at > now() AND c.status = 'active'
                ) x WHERE x.who IS NOT NULL
            ");
            $hiNow->execute([$cityId, $cityId]);

            $arrivals = $pdo->prepare("
                SELECT count(DISTINCT COALESCE(user_id, guest_id)) FROM messages
                WHERE channel_id = ? AND type = 'system' AND event = 'join'
                  AND created_at > now() - interval '7 days'
            ");
            $arrivals->execute([$cityId]);

            $city     = CityRepository::findById($cityChannel);
            $tz       = new DateTimeZone($city['timezone'] ?? 'UTC');
            $endOfDay = (new DateTimeImmutable('tomorrow', $tz))->getTimestamp();
            $events   = EventRepository::getAllByChannel($cityChannel, null, $city)['hilads'] ?? [];

            return [
                'nearby'       => self::gate(PresenceRepository::getCount($cityChannel)),
                'hiNow'        => self::gate((int) $hiNow->fetchColumn()),
                'arrivalsWeek' => self::gate((int) $arrivals->fetchColumn()),
                'tonight'      => self::withAvatars($pdo, self::tonight($events, time(), $endOfDay)),
                'min'          => self::MIN,
            ];
        }) ?? [];
    }
}
