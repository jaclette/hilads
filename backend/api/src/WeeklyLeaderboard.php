<?php

declare(strict_types=1);

/**
 * Weekly Most Local (V3-04, SPEC 9.8): points of the current week (challenge
 * dates Monday to Sunday), World or per city (the city where the points were
 * earned). Only the score kinds whose rule has counts_weekly = true count:
 * the Daily Challenge kinds; add one with
 *   UPDATE score_rules SET counts_weekly = true WHERE kind = '…';
 * Users with hidden_from_rankings are left out. The all-time ranking stays
 * on GET /leaderboard.
 */
final class WeeklyLeaderboard
{
    public const CACHE_TTL = 30;

    /**
     * Ranked rows with points > 0: [{id, display_name, thumb, points,
     * city_name, city_country}]. $cityId null = World.
     */
    public static function rows(?string $cityId, string $from, string $to, int $limit, int $offset): array
    {
        $key = 'weekly_lb_v1_' . md5(implode('|', [$cityId, $from, $to, $limit, $offset]));
        return Cache::remember($key, self::CACHE_TTL, static function () use ($cityId, $from, $to, $limit, $offset): array {
            [$sql, $args] = self::totalsSql($cityId, $from, $to);
            $stmt = Database::pdo()->prepare("
                WITH totals AS ({$sql})
                SELECT u.id, u.display_name, u.profile_thumb_photo_url, t.points,
                       ch.name AS city_name, c.country AS city_country
                FROM totals t
                JOIN users u          ON u.id = t.user_id
                LEFT JOIN channels ch ON ch.id = u.current_city_id
                LEFT JOIN cities c    ON c.channel_id = u.current_city_id
                WHERE t.points > 0 AND u.deleted_at IS NULL AND NOT u.hidden_from_rankings
                ORDER BY t.points DESC, u.id ASC
                LIMIT ? OFFSET ?
            ");
            $stmt->execute(array_merge($args, [$limit, $offset]));
            return $stmt->fetchAll(PDO::FETCH_ASSOC);
        }) ?? [];
    }

    /** ['rank' => ?int, 'points' => int] of one user (rank null without points or when hidden). */
    public static function mine(string $userId, ?string $cityId, string $from, string $to): array
    {
        [$sql, $args] = self::totalsSql($cityId, $from, $to);
        $stmt = Database::pdo()->prepare("
            WITH totals AS ({$sql}),
                 visible AS (
                     SELECT t.user_id, t.points FROM totals t
                     JOIN users u ON u.id = t.user_id
                     WHERE t.points > 0 AND u.deleted_at IS NULL AND NOT u.hidden_from_rankings
                 ),
                 me AS (SELECT points FROM visible WHERE user_id = ?)
            SELECT (SELECT points FROM me) AS points,
                   (SELECT count(*) FROM visible v, me
                     WHERE v.points > me.points OR (v.points = me.points AND v.user_id < ?)) + 1 AS rank
        ");
        $stmt->execute(array_merge($args, [$userId, $userId]));
        $r = $stmt->fetch(PDO::FETCH_ASSOC);
        return $r['points'] === null
            ? ['rank' => null, 'points' => 0]
            : ['rank' => (int) $r['rank'], 'points' => (int) $r['points']];
    }

    /** Per-user totals of the week: [sql, args]. */
    private static function totalsSql(?string $cityId, string $from, string $to): array
    {
        $sql = "
            SELECT se.user_id, sum(se.points) AS points
            FROM score_events se
            JOIN score_rules r       ON r.kind = se.kind AND r.role = se.role AND r.counts_weekly
            JOIN daily_challenges dc ON dc.id = se.daily_challenge_id
            WHERE dc.challenge_date BETWEEN ?::date AND ?::date" . ($cityId !== null ? " AND se.city_id = ?" : "") . "
            GROUP BY se.user_id
        ";
        return [$sql, $cityId !== null ? [$from, $to, $cityId] : [$from, $to]];
    }
}
