<?php

declare(strict_types=1);

/**
 * The Ranks tab (V6): players (Most Local points), cities (the race: photos,
 * players, likes) and photos (most liked), for today, this week or all time
 * (photos also yesterday's official results), in a city or the World.
 * Movement is "since yesterday": the rank the same ranking gave without the
 * last day (week: without today's challenge; all time: without the last 24
 * hours). Rankings are cached a short while; "me" is computed per caller.
 * The older /leaderboard endpoints stay for older apps.
 */
final class Ranks
{
    public const CACHE_TTL = 45;
    public const PERIODS   = ['today', 'yesterday', 'week', 'alltime'];

    /** Challenge dates of a period: [from, to], or null for all time. */
    public static function dates(string $period, string $today): ?array
    {
        $d = new DateTimeImmutable($today, new DateTimeZone('UTC'));
        return match ($period) {
            'today'     => [$today, $today],
            'yesterday' => [$d->modify('-1 day')->format('Y-m-d'), $d->modify('-1 day')->format('Y-m-d')],
            'week'      => Spots::week($today),
            default     => null,
        };
    }

    /** Ranks by a score, ties broken by the order given: [key => rank] (1-based), zero scores left out. */
    public static function rankBy(array $rows, string $key, string $scoreField): array
    {
        $out  = [];
        $rank = 0;
        foreach ($rows as $r) {
            if ((float) ($r[$scoreField] ?? 0) <= 0) continue;
            $out[(string) $r[$key]] = ++$rank;
        }
        return $out;
    }

    // ── Players ─────────────────────────────────────────────────────────────

    /** Every ranked player of the period: [{id, display_name, username, thumb, home_city_id, current_city_id, city_name, city_country, points, prev_points}], best first. */
    public static function playerRows(string $period, ?string $cityId, string $today): array
    {
        $key = 'ranks_players_v1_' . md5("{$period}|{$cityId}|{$today}");
        return Cache::remember($key, self::CACHE_TTL, static function () use ($period, $cityId, $today): array {
            $dates = self::dates($period, $today);
            $args  = [];
            $where = [];
            $join  = '';
            $prev  = "se.created_at < now() - interval '1 day'";
            if ($dates !== null) {
                // Daily kinds only (as the weekly ranking), on the period's challenges.
                $join   = 'JOIN score_rules r ON r.kind = se.kind AND r.role = se.role AND r.counts_weekly
                           JOIN daily_challenges dc ON dc.id = se.daily_challenge_id';
                $where[] = 'dc.challenge_date BETWEEN ?::date AND ?::date';
                array_push($args, $dates[0], $dates[1]);
                $prev = $period === 'week' ? 'dc.challenge_date < ?::date' : 'false';
            }
            if ($cityId !== null) {
                $where[] = 'se.city_id = ?';
                $args[]  = $cityId;
            }
            $prevArgs = $period === 'week' ? [$today] : [];
            $stmt = Database::pdo()->prepare("
                WITH totals AS (
                    SELECT se.user_id, sum(se.points) AS points,
                           coalesce(sum(se.points) FILTER (WHERE {$prev}), 0) AS prev_points
                    FROM score_events se {$join}
                    " . ($where ? 'WHERE ' . implode(' AND ', $where) : '') . "
                    GROUP BY se.user_id
                )
                SELECT u.id, u.display_name, u.username, u.profile_thumb_photo_url AS thumb, u.home_city_id, u.current_city_id,
                       ch.name AS city_name, c.country AS city_country, t.points, t.prev_points
                FROM totals t
                JOIN users u          ON u.id = t.user_id
                LEFT JOIN channels ch ON ch.id = u.current_city_id
                LEFT JOIN cities c    ON c.channel_id = u.current_city_id
                WHERE t.points > 0 AND u.deleted_at IS NULL AND NOT u.hidden_from_rankings AND NOT u.is_demo
                ORDER BY t.points DESC, u.id ASC
                LIMIT 2000
            ");
            $stmt->execute(array_merge($prevArgs, $args));
            return $stmt->fetchAll(PDO::FETCH_ASSOC);
        }) ?? [];
    }

    /** The players ranking for the API: entries (top $limit) and me (rank, gap to the one above). */
    public static function players(string $period, ?string $cityId, ?string $viewerId, string $today, int $limit = 50): array
    {
        $rows  = self::playerRows($period, $cityId, $today);
        $ranks = self::rankBy($rows, 'id', 'points');
        $prevRows = $rows;
        usort($prevRows, static fn($a, $b) => [(int) $b['prev_points'], $a['id']] <=> [(int) $a['prev_points'], $b['id']]);
        $prev = $period === 'today' ? [] : self::rankBy($prevRows, 'id', 'prev_points');

        $entry = static fn(array $r): array => [
            'rank'     => $ranks[$r['id']],
            'prevRank' => $period === 'today' ? null : ($prev[$r['id']] ?? null),
            'points'   => (int) $r['points'],
            'user'     => [
                'id'          => $r['id'],
                'displayName' => $r['display_name'],
                'username'    => $r['username'],
                'photoUrl'    => R2Uploader::thumbProxy($r['thumb']),
                'isLocal'     => $r['home_city_id'] !== null && $r['home_city_id'] === $r['current_city_id'],
            ],
            'city'     => $r['current_city_id'] !== null
                ? ['id' => (int) substr((string) $r['current_city_id'], 5), 'name' => $r['city_name'], 'country' => $r['city_country']]
                : null,
        ];
        $entries = array_map($entry, array_slice($rows, 0, $limit));

        $me = null;
        if ($viewerId !== null && isset($ranks[$viewerId])) {
            $i  = $ranks[$viewerId] - 1;
            $me = $entry($rows[$i]);
            if ($i > 0) {
                $above = $rows[$i - 1];
                $me['gap']  = (int) $above['points'] - (int) $rows[$i]['points'] + 1;
                $me['next'] = ['displayName' => $above['display_name'], 'username' => $above['username']];
            }
        }
        return ['entries' => $entries, 'me' => $me, 'total' => count($rows)];
    }

    // ── Cities ──────────────────────────────────────────────────────────────

    /** The city race: [{city_id, name, country, photos, players, likes, prev_photos}], leader first. */
    public static function cityRows(string $period, string $today): array
    {
        $key = 'ranks_cities_v1_' . md5("{$period}|{$today}");
        return Cache::remember($key, self::CACHE_TTL, static function () use ($period, $today): array {
            $dates = self::dates($period, $today);
            $args  = [];
            $where = '';
            $prev  = "p.created_at < now() - interval '1 day'";
            if ($dates !== null) {
                $where = 'AND dc.challenge_date BETWEEN ?::date AND ?::date';
                $args  = [$dates[0], $dates[1]];
                $prev  = $period === 'week' ? 'dc.challenge_date < ?::date' : 'false';
            }
            $prevArgs = $period === 'week' ? [$today] : [];
            $stmt = Database::pdo()->prepare("
                SELECT p.city_id, ch.name, c.country, count(*) AS photos, count(DISTINCT p.user_id) AS players,
                       coalesce(sum(p.vote_count), 0) AS likes, count(*) FILTER (WHERE {$prev}) AS prev_photos
                FROM daily_proofs p
                JOIN daily_challenges dc ON dc.id = p.challenge_id
                JOIN users u             ON u.id = p.user_id
                JOIN channels ch         ON ch.id = p.city_id
                LEFT JOIN cities c       ON c.channel_id = p.city_id
                WHERE p.moderation_status = 'approved' AND NOT p.is_demo AND NOT p.is_seed AND NOT p.is_suggestion AND NOT u.is_demo
                  AND p.city_id IS NOT NULL {$where}
                GROUP BY p.city_id, ch.name, c.country
                ORDER BY photos DESC, likes DESC, players DESC, p.city_id
                LIMIT 200
            ");
            $stmt->execute(array_merge($prevArgs, $args));
            return $stmt->fetchAll(PDO::FETCH_ASSOC);
        }) ?? [];
    }

    public static function cities(string $period, ?string $viewerCityId, string $today, int $limit = 50): array
    {
        $rows  = self::cityRows($period, $today);
        $ranks = self::rankBy($rows, 'city_id', 'photos');
        $prevRows = $rows;
        usort($prevRows, static fn($a, $b) => [(int) $b['prev_photos'], $a['city_id']] <=> [(int) $a['prev_photos'], $b['city_id']]);
        $prev = $period === 'today' ? [] : self::rankBy($prevRows, 'city_id', 'prev_photos');
        $entry = static fn(array $r): array => [
            'rank'     => $ranks[$r['city_id']],
            'prevRank' => $period === 'today' ? null : ($prev[$r['city_id']] ?? null),
            'city'     => ['id' => (int) substr((string) $r['city_id'], 5), 'name' => $r['name'], 'country' => $r['country']],
            'photos'   => (int) $r['photos'],
            'players'  => (int) $r['players'],
            'likes'    => (int) $r['likes'],
        ];
        $mine = null;
        if ($viewerCityId !== null && isset($ranks[$viewerCityId])) {
            $i    = $ranks[$viewerCityId] - 1;
            $mine = $entry($rows[$i]);
            if ($i > 0) {
                $mine['gap']  = (int) $rows[$i - 1]['photos'] - (int) $rows[$i]['photos'] + 1;
                $mine['next'] = ['name' => $rows[$i - 1]['name'], 'country' => $rows[$i - 1]['country']];
            }
        }
        return ['entries' => array_map($entry, array_slice($rows, 0, $limit)), 'mine' => $mine, 'total' => count($rows)];
    }

    // ── Photos ──────────────────────────────────────────────────────────────

    /**
     * Most liked photos of the period: ids, best first. Yesterday: the official
     * results (World top 3, or the city's) then the rest by likes.
     */
    public static function photoIds(string $period, ?string $cityId, string $today, int $limit = 30): array
    {
        $key = 'ranks_photos_v1_' . md5("{$period}|{$cityId}|{$today}|{$limit}");
        return Cache::remember($key, self::CACHE_TTL, static function () use ($period, $cityId, $today, $limit): array {
            $dates = self::dates($period, $today);
            $args  = [];
            $where = '';
            if ($dates !== null) {
                $where .= ' AND dc.challenge_date BETWEEN ?::date AND ?::date';
                array_push($args, $dates[0], $dates[1]);
            }
            if ($cityId !== null) {
                $where .= ' AND p.city_id = ?';
                $args[] = $cityId;
            }
            $stmt = Database::pdo()->prepare("
                SELECT p.id, p.vote_count
                FROM daily_proofs p
                JOIN daily_challenges dc ON dc.id = p.challenge_id
                JOIN users u             ON u.id = p.user_id
                WHERE p.moderation_status = 'approved' AND NOT p.is_demo AND NOT p.is_seed AND NOT p.is_suggestion AND NOT u.is_demo
                  AND p.vote_count > 0 {$where}
                ORDER BY p.vote_count DESC, p.approved_at ASC NULLS LAST, p.id
                LIMIT " . (int) $limit . "
            ");
            $stmt->execute($args);
            return $stmt->fetchAll(PDO::FETCH_COLUMN);
        }) ?? [];
    }

    /** Yesterday's best photo of each city (official results): [cityId => proofId]. */
    public static function cityBestIds(string $date): array
    {
        $challenge = DailyChallengeRepository::findPublishedByDate($date);
        if ($challenge === null) return [];
        $stmt = Database::pdo()->prepare("
            SELECT r.scope, r.proof_id FROM daily_results r
            WHERE r.challenge_id = ? AND r.scope <> 'world' AND r.rank = 1
            ORDER BY r.vote_count DESC
            LIMIT 40
        ");
        $stmt->execute([$challenge['id']]);
        return array_column($stmt->fetchAll(PDO::FETCH_ASSOC), 'proof_id', 'scope');
    }

    // ── Rank-up notifications (Game) ────────────────────────────────────────

    /**
     * After a challenge closed: players who climbed in their city's weekly
     * ranking thanks to it (and are in its top 10) get a "▲ You climbed to #3
     * in Saigon" row. One per player, date and city (dedupe key). Returns rows written.
     */
    public static function notifyRankUps(array $challenge): int
    {
        $date = (string) $challenge['challenge_date'];
        [$from, $to] = Spots::week($date);
        $n = 0;
        try {
            $stmt = Database::pdo()->prepare("SELECT DISTINCT city_id FROM score_events WHERE daily_challenge_id = ? AND city_id IS NOT NULL");
            $stmt->execute([$challenge['id']]);
            foreach ($stmt->fetchAll(PDO::FETCH_COLUMN) as $cityId) {
                $q = Database::pdo()->prepare("
                    SELECT se.user_id, sum(se.points) AS points,
                           coalesce(sum(se.points) FILTER (WHERE se.daily_challenge_id <> ?), 0) AS before
                    FROM score_events se
                    JOIN score_rules r       ON r.kind = se.kind AND r.role = se.role AND r.counts_weekly
                    JOIN daily_challenges dc ON dc.id = se.daily_challenge_id
                    JOIN users u             ON u.id = se.user_id
                    WHERE dc.challenge_date BETWEEN ?::date AND ?::date AND se.city_id = ?
                      AND u.deleted_at IS NULL AND NOT u.hidden_from_rankings
                    GROUP BY se.user_id
                    ORDER BY points DESC, se.user_id
                ");
                $q->execute([$challenge['id'], $from, $to, $cityId]);
                $rows   = $q->fetchAll(PDO::FETCH_ASSOC);
                $now    = self::rankBy($rows, 'user_id', 'points');
                $sorted = $rows;
                usort($sorted, static fn($a, $b) => [(int) $b['before'], $a['user_id']] <=> [(int) $a['before'], $b['user_id']]);
                $was    = self::rankBy($sorted, 'user_id', 'before');
                $name   = CityRepository::findById((int) substr((string) $cityId, 5))['name'] ?? null;
                foreach ($now as $userId => $rank) {
                    $before = $was[$userId] ?? null;
                    if ($rank > 10 || ($before !== null && $before <= $rank)) continue;
                    if (!NotificationRepository::enabledFor((string) $userId, 'daily_rank')) continue;
                    $data = ['date' => $date, 'scope' => (string) $cityId, 'cityId' => (string) $cityId, 'cityName' => $name,
                             'rank' => $rank, 'prevRank' => $before];
                    $body = '▲ You climbed to #' . $rank . ' in ' . CityNames::short((string) $name) . ' this week';
                    $n += NotificationRepository::createUnchecked((string) $userId, 'daily_rank', 'Most Local', $body, $data, null, false) !== [] ? 1 : 0;
                }
            }
        } catch (\Throwable $e) {
            error_log('[ranks] rank-up notifications failed: ' . $e->getMessage());
        }
        return $n;
    }
}
