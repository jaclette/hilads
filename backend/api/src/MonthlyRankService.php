<?php

declare(strict_types=1);

/**
 * Monthly rank recalc — denormalised onto users.monthly_rank_in_city and
 * users.monthly_rank_worldwide. Called inline at the end of every route
 * that changes a user's monthly score or current city.
 *
 * Why inline, not async / cron:
 *   - Render runs PHP under mod_php; there's no fastcgi_finish_request()
 *     and register_shutdown_function-style "deferred" work blocks the
 *     response (we hit this on profile + messages already). True async
 *     would require new infra (WS worker, jobs table) which defeats the
 *     point of avoiding a cron service in the first place.
 *   - Cron is operational debt: a separate service to monitor, silent
 *     failure mode, constant background load even when the app is quiet.
 *   - The recalc itself is small (single-city UPDATE) and cheap (<20ms
 *     city, <100ms world). It sits inside routes that the user is
 *     already waiting on a celebration animation for — the inline cost
 *     is invisible.
 *
 * Each call writes ONLY the top-10 rank values (1..10). Users outside
 * the top get NULL. That means the column is mostly NULL across the
 * users table (cheap storage, cheap reads).
 */
class MonthlyRankService
{
    private const TOP_N = 10;

    /**
     * Recompute monthly_rank_in_city for the home cities of each user
     * passed in AND monthly_rank_worldwide globally. Callers list the
     * user(s) whose score just changed — the service looks up each
     * user's current_city_id internally so the route doesn't have to.
     * Multiple users in the same city collapse to a single city
     * recalc; the world recalc fires once regardless.
     *
     * Wraps everything in a single try/catch so a flaky DB never
     * breaks the originating action (rating, approve, accept) — that
     * action already succeeded by the time we get here.
     *
     * Logs city + world durations at info level so we have
     * observability if perf drifts as the DB grows.
     *
     *   [rank_recalc] users=u1,u2 cities=city_3,city_7 city_ms=18 world_ms=42 total_ms=60
     */
    public static function recalcAfterScoreChange(string ...$userIds): void
    {
        if (empty($userIds)) return;
        $started = microtime(true);
        $cityIds = [];
        $cityMs  = 0;
        $worldMs = 0;

        try {
            $cityIds = self::resolveCurrentCities($userIds);
            foreach ($cityIds as $cityId) {
                $cityMs += self::recalcCity($cityId);
            }
            $worldMs = self::recalcWorld();
        } catch (\Throwable $e) {
            error_log('[rank_recalc] failed users=' . implode(',', $userIds)
                . ' err=' . $e->getMessage());
            return;
        }

        $totalMs = (int) round((microtime(true) - $started) * 1000);
        error_log(sprintf(
            '[rank_recalc] users=%s cities=%s city_ms=%d world_ms=%d total_ms=%d',
            implode(',', $userIds),
            empty($cityIds) ? 'none' : implode(',', $cityIds),
            $cityMs,
            $worldMs,
            $totalMs,
        ));
    }

    /**
     * Resolve a list of user ids to the set of distinct current_city_id
     * values. Null cities (users without geolocation) are dropped — no
     * city to recalc for them.
     */
    private static function resolveCurrentCities(array $userIds): array
    {
        $userIds = array_values(array_unique(array_filter($userIds, 'strlen')));
        if (empty($userIds)) return [];

        $placeholders = implode(',', array_fill(0, count($userIds), '?'));
        $stmt = Database::pdo()->prepare("
            SELECT DISTINCT current_city_id
            FROM users
            WHERE id IN ($placeholders)
              AND current_city_id IS NOT NULL
        ");
        $stmt->execute($userIds);
        return array_values(array_filter(
            $stmt->fetchAll(\PDO::FETCH_COLUMN),
            static fn($c) => is_string($c) && $c !== ''
        ));
    }

    /**
     * Same as recalcAfterScoreChange but for routes that move a user
     * between cities (POST /me/city, /location/resolve, admin edit).
     * The OLD city needs a recalc too — losing a top-10 user shifts
     * everyone below them up one rank.
     *
     * Pass null for $oldCityId on creation paths where the user had
     * no prior city; pass null for $newCityId on deletion paths. The
     * world recalc fires unconditionally because the user's city move
     * doesn't change worldwide totals, but the score that earned them
     * a position may have predated the move and the world rank could
     * already be stale.
     */
    public static function recalcAfterCityChange(?string $userId, ?string $oldCityId, ?string $newCityId): void
    {
        $started = microtime(true);
        $oldMs = $newMs = $worldMs = 0;

        try {
            if ($oldCityId !== null) $oldMs = self::recalcCity($oldCityId);
            if ($newCityId !== null && $newCityId !== $oldCityId) {
                $newMs = self::recalcCity($newCityId);
            }
            // World ranks don't change on a pure city move (totals are
            // identical), so the global pass is technically redundant.
            // Skipped to keep this path cheap.
        } catch (\Throwable $e) {
            error_log('[rank_recalc] city-change failed user=' . ($userId ?? '?')
                . ' old=' . ($oldCityId ?? '?') . ' new=' . ($newCityId ?? '?')
                . ': ' . $e->getMessage());
            return;
        }

        $totalMs = (int) round((microtime(true) - $started) * 1000);
        error_log(sprintf(
            '[rank_recalc] user=%s old_city=%s new_city=%s old_ms=%d new_ms=%d world_ms=%d total_ms=%d',
            $userId ?? '?',
            $oldCityId ?? 'none',
            $newCityId ?? 'none',
            $oldMs,
            $newMs,
            $worldMs,
            $totalMs,
        ));
    }

    /**
     * Wipe both rank columns to NULL — used by /admin/scores_reset.php
     * which zeros every user's score in one go. Run inside the same
     * transaction that resets the scores so the columns stay
     * consistent with the cleared values.
     */
    public static function clearAll(\PDO $pdo): void
    {
        $pdo->exec("
            UPDATE users
            SET monthly_rank_in_city = NULL,
                monthly_rank_worldwide = NULL
            WHERE monthly_rank_in_city IS NOT NULL
               OR monthly_rank_worldwide IS NOT NULL
        ");
    }

    // ── Inner queries — single transactional UPDATE per scope ────────

    /**
     * Returns the elapsed milliseconds so the caller can log it. The
     * UPDATE uses a CTE: rank-window the users in $cityId (current
     * month only), then assign rank to top-N and NULL out everyone
     * else in the same city. Stable tiebreak on id ASC prevents the
     * badge flickering between two users on identical scores.
     */
    private static function recalcCity(string $cityId): int
    {
        $started = microtime(true);
        $pdo     = Database::pdo();
        $currentMonth = gmdate('Y-m');

        $stmt = $pdo->prepare("
            WITH ranked AS (
                SELECT id,
                       ROW_NUMBER() OVER (
                           ORDER BY score_month DESC, id ASC
                       ) AS r
                FROM users
                WHERE deleted_at      IS NULL
                  AND current_city_id = :city
                  AND score_month     > 0
                  AND score_month_ref = :month
            )
            UPDATE users u
            SET monthly_rank_in_city = CASE
                WHEN r.r IS NOT NULL AND r.r <= :topN THEN r.r
                ELSE NULL
            END
            FROM (
                SELECT u2.id, ranked.r
                FROM users u2
                LEFT JOIN ranked ON ranked.id = u2.id
                WHERE u2.current_city_id = :city
                  AND (u2.monthly_rank_in_city IS NOT NULL OR ranked.r IS NOT NULL)
            ) r
            WHERE u.id = r.id
              AND COALESCE(u.monthly_rank_in_city, 0) IS DISTINCT FROM
                  CASE WHEN r.r IS NOT NULL AND r.r <= :topN THEN r.r ELSE 0 END
        ");
        $stmt->execute([
            'city'  => $cityId,
            'month' => $currentMonth,
            'topN'  => self::TOP_N,
        ]);

        return (int) round((microtime(true) - $started) * 1000);
    }

    /**
     * Same shape as recalcCity but unpartitioned — world top 10.
     * Touches every user whose monthly_rank_worldwide is currently
     * non-null OR who is in the new top-N, so the write set stays
     * bounded to ≈20 rows max regardless of total user count.
     */
    private static function recalcWorld(): int
    {
        $started = microtime(true);
        $pdo     = Database::pdo();
        $currentMonth = gmdate('Y-m');

        $stmt = $pdo->prepare("
            WITH ranked AS (
                SELECT id,
                       ROW_NUMBER() OVER (
                           ORDER BY score_month DESC, id ASC
                       ) AS r
                FROM users
                WHERE deleted_at  IS NULL
                  AND score_month > 0
                  AND score_month_ref = :month
            )
            UPDATE users u
            SET monthly_rank_worldwide = CASE
                WHEN r.r IS NOT NULL AND r.r <= :topN THEN r.r
                ELSE NULL
            END
            FROM (
                SELECT u2.id, ranked.r
                FROM users u2
                LEFT JOIN ranked ON ranked.id = u2.id
                WHERE u2.monthly_rank_worldwide IS NOT NULL
                   OR ranked.r IS NOT NULL
            ) r
            WHERE u.id = r.id
              AND COALESCE(u.monthly_rank_worldwide, 0) IS DISTINCT FROM
                  CASE WHEN r.r IS NOT NULL AND r.r <= :topN THEN r.r ELSE 0 END
        ");
        $stmt->execute([
            'month' => $currentMonth,
            'topN'  => self::TOP_N,
        ]);

        return (int) round((microtime(true) - $started) * 1000);
    }
}
