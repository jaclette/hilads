<?php

declare(strict_types=1);

/**
 * The Local Pass (SPEC 8.3): an approved proof in all 7 themes in the same
 * city earns that city's pass, once (daily_local_passes, unique per user and
 * city), with points through score_events (kind local_pass, score_rules).
 * Locals and travelers alike. Never taken back: deleting or removing a proof
 * later leaves the pass and its points.
 *
 * A proof's theme is its challenge's theme (DailyThemes::effective). Proofs
 * without a city never count.
 */
final class DailyLocalPass
{
    // ── Pure helpers (unit-tested) ────────────────────────────────────────────

    /** Distinct theme keys from [theme, challenge_date] rows, in the weekly order. */
    public static function themesOf(array $rows): array
    {
        $done = [];
        foreach ($rows as $r) {
            $key = DailyThemes::effective($r['theme'] ?? null, $r['challenge_date'] ?? null);
            if ($key !== null) {
                $done[$key] = true;
            }
        }
        return array_values(array_filter(DailyThemes::keys(), static fn(string $k): bool => isset($done[$k])));
    }

    public static function isComplete(array $themes): bool
    {
        return count(array_intersect(DailyThemes::keys(), $themes)) === count(DailyThemes::THEMES);
    }

    // ── Award ────────────────────────────────────────────────────────────────

    /**
     * After a proof's approval: earn the pass of its city if this completes
     * the 7 themes. True when the pass was earned now.
     */
    public static function checkAfterApproval(?array $proof): bool
    {
        if ($proof === null || $proof['moderation_status'] !== 'approved' || $proof['city_id'] === null) {
            return false;
        }
        $pdo  = Database::pdo();
        $stmt = $pdo->prepare("SELECT 1 FROM daily_local_passes WHERE user_id = ? AND city_id = ?");
        $stmt->execute([$proof['user_id'], $proof['city_id']]);
        if ($stmt->fetchColumn() !== false) {
            return false;
        }
        if (!self::isComplete(self::themesIn($proof['user_id'], (string) $proof['city_id']))) {
            return false;
        }
        $stmt = $pdo->prepare("
            INSERT INTO daily_local_passes (user_id, city_id, daily_challenge_id) VALUES (?, ?, ?)
            ON CONFLICT DO NOTHING
            RETURNING user_id
        ");
        $stmt->execute([$proof['user_id'], $proof['city_id'], $proof['challenge_id']]);
        if ($stmt->fetchColumn() === false) {
            return false;
        }
        DailyPoints::awardLocalPass($proof['user_id'], $proof['challenge_id'], (string) $proof['city_id']);
        return true;
    }

    // ── Reads ────────────────────────────────────────────────────────────────

    /** Theme keys of a user's approved proofs in a city ('city_N'). */
    public static function themesIn(string $userId, string $cityId): array
    {
        $stmt = Database::pdo()->prepare("
            SELECT DISTINCT dc.theme, dc.challenge_date
            FROM daily_proofs p
            JOIN daily_challenges dc ON dc.id = p.challenge_id
            WHERE p.user_id = ? AND p.city_id = ? AND p.moderation_status = 'approved' AND NOT p.is_seed
        ");
        $stmt->execute([$userId, $cityId]);
        return self::themesOf($stmt->fetchAll(PDO::FETCH_ASSOC));
    }

    /** My progress in one city: {city, done, total, themes, earned, earnedAt}. */
    public static function progressIn(string $userId, string $cityId): array
    {
        $themes = self::themesIn($userId, $cityId);
        $stmt   = Database::pdo()->prepare("SELECT earned_at FROM daily_local_passes WHERE user_id = ? AND city_id = ?");
        $stmt->execute([$userId, $cityId]);
        $earnedAt = $stmt->fetchColumn();
        $n = (int) substr($cityId, 5);
        return [
            'city'     => ['id' => $n, 'name' => CityRepository::findById($n)['name'] ?? null],
            'done'     => count($themes),
            'total'    => count(DailyThemes::THEMES),
            'themes'   => $themes,
            'earned'   => $earnedAt !== false,
            'earnedAt' => $earnedAt !== false ? strtotime((string) $earnedAt) : null,
        ];
    }

    /**
     * A user's passes and per-city progress (profile): passes [{city,
     * earnedAt}], progress [{city, done, total, themes, earned}] for every
     * city with an approved proof, most advanced first.
     */
    public static function forUser(string $userId): array
    {
        $pdo  = Database::pdo();
        $stmt = $pdo->prepare("
            SELECT p.city_id, ch.name AS city_name, dc.theme, dc.challenge_date
            FROM daily_proofs p
            JOIN daily_challenges dc ON dc.id = p.challenge_id
            JOIN channels ch         ON ch.id = p.city_id
            WHERE p.user_id = ? AND p.moderation_status = 'approved' AND NOT p.is_seed
        ");
        $stmt->execute([$userId]);
        $byCity = [];
        $names  = [];
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $byCity[$r['city_id']][] = $r;
            $names[$r['city_id']]    = $r['city_name'];
        }

        $stmt = $pdo->prepare("
            SELECT lp.city_id, ch.name AS city_name, lp.earned_at
            FROM daily_local_passes lp
            JOIN channels ch ON ch.id = lp.city_id
            WHERE lp.user_id = ?
            ORDER BY lp.earned_at
        ");
        $stmt->execute([$userId]);
        $passes = [];
        $earned = [];
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $earned[$r['city_id']] = true;
            $passes[] = ['city' => self::city($r['city_id'], $r['city_name']), 'earnedAt' => strtotime((string) $r['earned_at'])];
        }

        $progress = [];
        foreach ($byCity as $cityId => $rows) {
            $themes = self::themesOf($rows);
            $progress[] = [
                'city'   => self::city($cityId, $names[$cityId]),
                'done'   => count($themes),
                'total'  => count(DailyThemes::THEMES),
                'themes' => $themes,
                'earned' => isset($earned[$cityId]),
            ];
        }
        usort($progress, static fn(array $a, array $b): int => $b['done'] <=> $a['done']);
        return ['passes' => $passes, 'progress' => $progress];
    }

    /**
     * Which of $userIds hold the Local Pass of $cityId, as a set. Never throws
     * (chat badges must not fail because of it): empty on any error.
     */
    public static function holdersIn(array $userIds, string $cityId): array
    {
        if ($userIds === []) {
            return [];
        }
        try {
            $stmt = Database::pdo()->prepare("
                SELECT user_id FROM daily_local_passes
                WHERE city_id = ? AND user_id = ANY (string_to_array(?, ','))
            ");
            $stmt->execute([$cityId, implode(',', $userIds)]);
            return array_flip($stmt->fetchAll(PDO::FETCH_COLUMN));
        } catch (\Throwable $e) {
            error_log('[daily] local pass holders failed: ' . $e->getMessage());
            return [];
        }
    }

    private static function city(string $cityId, ?string $name): array
    {
        return ['id' => (int) substr($cityId, 5), 'name' => $name];
    }
}
