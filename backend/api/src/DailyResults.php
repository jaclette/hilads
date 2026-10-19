<?php

declare(strict_types=1);

/**
 * Daily Challenge results and streaks (SPEC 3.7, 3.8).
 *
 * Results are computed once a challenge closes (DailyDrop::closeChallenge):
 * - World top 3 by votes;
 * - every approved proof's rank within its city (scope = the city channel id);
 * - the best proof of each live city = its city rank 1.
 * Ties go to more votes from locals, then the earliest approval. Awards (top 3,
 * best of a city) need at least one vote; ranks within a city do not.
 * daily_results is rebuilt with delete + insert in one transaction, so a
 * rerun is idempotent (votes are frozen once the challenge closed).
 *
 * Streaks count consecutive published challenge dates with an approved proof;
 * a date with no published challenge neither counts nor breaks a streak.
 */
final class DailyResults
{
    public const MIN_VOTES_TO_WIN = 1;

    // ── Pure helpers (unit-tested) ────────────────────────────────────────────

    /**
     * Rows ordered best first: votes, then local votes, then earliest approval
     * (then id, so the order is stable). Rows need vote_count,
     * local_vote_count, approved_at, id.
     */
    public static function rankProofs(array $rows): array
    {
        usort($rows, static function (array $a, array $b): int {
            return [(int) $b['vote_count'], (int) $b['local_vote_count'], strtotime((string) $a['approved_at']), $a['id']]
               <=> [(int) $a['vote_count'], (int) $a['local_vote_count'], strtotime((string) $b['approved_at']), $b['id']];
        });
        return $rows;
    }

    /**
     * What to store and award for a closed challenge's approved proofs.
     * Returns world (top 3, ranked rows), cities (city => ranked rows) and
     * cityBest (city => row; live cities only).
     */
    public static function plan(array $rows, array $liveCityIds): array
    {
        $ranked = self::rankProofs($rows);
        $world  = array_values(array_slice(
            array_filter($ranked, static fn(array $r): bool => (int) $r['vote_count'] >= self::MIN_VOTES_TO_WIN),
            0, 3,
        ));

        $cities = [];
        foreach ($ranked as $r) {
            if ($r['city_id'] !== null) {
                $cities[$r['city_id']][] = $r;
            }
        }
        $cityBest = [];
        foreach ($cities as $cityId => $list) {
            if (in_array($cityId, $liveCityIds, true) && (int) $list[0]['vote_count'] >= self::MIN_VOTES_TO_WIN) {
                $cityBest[$cityId] = $list[0];
            }
        }
        return ['world' => $world, 'cities' => $cities, 'cityBest' => $cityBest];
    }

    /**
     * Streaks from published dates (ascending) and the set of dates done.
     * The current streak is still alive while $activeDate (today's challenge)
     * is not done yet: it then counts up to the day before.
     * Returns [current, best].
     */
    public static function countStreaks(array $datesAsc, array $done, ?string $activeDate): array
    {
        $best = 0;
        $run  = 0;
        foreach ($datesAsc as $d) {
            $run  = isset($done[$d]) ? $run + 1 : 0;
            $best = max($best, $run);
        }

        $current = 0;
        $desc    = array_reverse($datesAsc);
        if ($desc !== [] && $desc[0] === $activeDate && !isset($done[$activeDate])) {
            array_shift($desc);
        }
        foreach ($desc as $d) {
            if (!isset($done[$d])) {
                break;
            }
            $current++;
        }
        return [$current, $best];
    }

    // ── Results ──────────────────────────────────────────────────────────────

    /** Compute and store the results of a challenge. Returns the plan plus counts. */
    public static function compute(string $challengeId): array
    {
        $pdo  = Database::pdo();
        $stmt = $pdo->prepare("
            SELECT p.id, p.user_id, p.city_id, p.vote_count, p.local_vote_count, p.approved_at
            FROM daily_proofs p
            JOIN users u ON u.id = p.user_id
            WHERE p.challenge_id = ? AND p.moderation_status = 'approved' AND NOT p.is_demo AND NOT p.is_seed AND NOT u.is_demo
        ");
        $stmt->execute([$challengeId]);
        DailyRules::forgetLiveCities();
        $plan = self::plan($stmt->fetchAll(PDO::FETCH_ASSOC), DailyRules::liveCityIds());

        $rows = [];
        foreach ($plan['world'] as $i => $r) {
            $rows[] = ['world', $i + 1, $r];
        }
        foreach ($plan['cities'] as $cityId => $list) {
            foreach ($list as $i => $r) {
                $rows[] = [$cityId, $i + 1, $r];
            }
        }

        $pdo->beginTransaction();
        try {
            $pdo->prepare("DELETE FROM daily_results WHERE challenge_id = ?")->execute([$challengeId]);
            foreach (array_chunk($rows, 500) as $chunk) {
                $values = [];
                $args   = [];
                foreach ($chunk as [$scope, $rank, $r]) {
                    $values[] = '(?, ?, ?, ?, ?, ?)';
                    array_push($args, $challengeId, $scope, $rank, $r['id'], (int) $r['vote_count'], (int) $r['local_vote_count']);
                }
                $pdo->prepare("
                    INSERT INTO daily_results (challenge_id, scope, rank, proof_id, vote_count, local_vote_count)
                    VALUES " . implode(', ', $values))->execute($args);
            }
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }

        return $plan + ['counts' => [
            'world'    => count($plan['world']),
            'cities'   => count($plan['cities']),
            'ranked'   => count($rows) - count($plan['world']),
            'cityBest' => count($plan['cityBest']),
        ]];
    }

    /** True once results were computed for the challenge. */
    public static function exist(string $challengeId): bool
    {
        $stmt = Database::pdo()->prepare("SELECT 1 FROM daily_results WHERE challenge_id = ? LIMIT 1");
        $stmt->execute([$challengeId]);
        return $stmt->fetchColumn() !== false;
    }

    /** World top 3 as proof rows (still approved), best first. */
    public static function worldTop3(string $challengeId): array
    {
        $stmt = Database::pdo()->prepare("
            SELECT r.proof_id FROM daily_results r
            JOIN daily_proofs p ON p.id = r.proof_id AND p.moderation_status = 'approved'
            WHERE r.challenge_id = ? AND r.scope = 'world'
            ORDER BY r.rank
        ");
        $stmt->execute([$challengeId]);
        return array_values(array_filter(array_map(
            static fn(string $id): ?array => DailyProofRepository::findById($id),
            $stmt->fetchAll(PDO::FETCH_COLUMN),
        )));
    }

    /** Best proof of a live city (rank 1 with at least one vote, still approved), or null. */
    public static function cityBest(string $challengeId, ?string $cityId): ?array
    {
        if ($cityId === null || !DailyRules::isLive($cityId)) {
            return null;
        }
        $stmt = Database::pdo()->prepare("
            SELECT r.proof_id FROM daily_results r
            JOIN daily_proofs p ON p.id = r.proof_id AND p.moderation_status = 'approved'
            WHERE r.challenge_id = ? AND r.scope = ? AND r.rank = 1 AND r.vote_count >= ?
        ");
        $stmt->execute([$challengeId, $cityId, self::MIN_VOTES_TO_WIN]);
        $id = $stmt->fetchColumn();
        return $id !== false ? DailyProofRepository::findById($id) : null;
    }

    /**
     * Sheet payload once closed: {world: [proofs], cityBest: proof|null (the
     * requested city), cities: [best proof of each live city]}, or null before the results.
     */
    public static function forSheet(string $challengeId, ?string $cityId, ?string $viewerId, array $blockedUserIds): ?array
    {
        if (!self::exist($challengeId)) {
            return null;
        }
        $visible = static fn(array $r): bool => !in_array($r['user_id'], $blockedUserIds, true);
        $fmt     = static fn(array $r): array => DailyProofRepository::format($r, $viewerId);
        $world   = array_values(array_filter(DailyVotes::annotate(self::worldTop3($challengeId), $viewerId), $visible));
        $best    = self::cityBest($challengeId, $cityId);
        $best    = $best !== null && $visible($best) ? DailyVotes::annotate([$best], $viewerId)[0] : null;
        $cities = [];
        foreach (DailyRules::liveCityIds() as $liveId) {
            $b = $liveId === $cityId ? $best : self::cityBest($challengeId, $liveId);
            if ($b !== null && $visible($b)) {
                $cities[] = $fmt($liveId === $cityId ? $b : DailyVotes::annotate([$b], $viewerId)[0]);
            }
        }
        return [
            'world'    => array_map($fmt, $world),
            'cityBest' => $best !== null ? $fmt($best) : null,
            'cities'   => $cities,
        ];
    }

    /** Compact top 3 for the World daily_challenge card. */
    public static function cardTop3(string $challengeId): array
    {
        $out = [];
        foreach (self::worldTop3($challengeId) as $i => $r) {
            $p = DailyProofRepository::format($r);
            $out[] = [
                'rank'      => $i + 1,
                'proofId'   => $p['id'],
                'thumbUrl'  => $p['thumbUrl'],
                'user'      => $p['user'],
                'city'      => $p['city'],
                'isLocal'   => $p['isLocal'],
                'voteCount' => $p['voteCount'],
            ];
        }
        return $out;
    }

    // ── Streaks and profile stats ────────────────────────────────────────────

    /** Published dates (ascending, up to $upTo) and the dates the user completed. */
    private static function history(string $userId, ?string $upTo = null): array
    {
        $stmt = Database::pdo()->prepare("
            SELECT dc.challenge_date::text AS d, (p.id IS NOT NULL) AS done
            FROM daily_challenges dc
            LEFT JOIN daily_proofs p
                   ON p.challenge_id = dc.id AND p.user_id = ? AND p.moderation_status = 'approved' AND NOT p.is_demo
            WHERE dc.status = 'published' AND dc.challenge_date <= ?
            ORDER BY dc.challenge_date
        ");
        $stmt->execute([$userId, $upTo ?? DailyClock::currentDate()]);
        $dates = [];
        $done  = [];
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $dates[] = $r['d'];
            if (DailyProofRepository::bool($r['done'])) {
                $done[$r['d']] = true;
            }
        }
        return [$dates, $done];
    }

    /** Length of the streak that ends on $date (0 when $date is not done). */
    public static function streakEndingAt(string $userId, string $date): int
    {
        [$dates, $done] = self::history($userId, $date);
        return self::countStreaks($dates, $done, null)[0];
    }

    /** [current, best] streak of a user. */
    public static function streaks(string $userId): array
    {
        [$dates, $done] = self::history($userId);
        return self::countStreaks($dates, $done, DailyClock::currentDate());
    }

    /** Current streak only (cheap enough for the today header). */
    public static function currentStreak(string $userId): int
    {
        [$dates, $done] = self::history($userId);
        return self::countStreaks($dates, $done, DailyClock::currentDate())[0];
    }

    /**
     * Profile stats: currentStreak, bestStreak, completed, bestProofs (up to
     * 6), localPasses and localPassProgress (V2-03).
     */
    public static function userStats(string $userId, ?string $viewerId): array
    {
        [$dates, $done] = self::history($userId);
        [$current, $best] = self::countStreaks($dates, $done, DailyClock::currentDate());

        $stmt = Database::pdo()->prepare("
            SELECT p.id
            FROM daily_proofs p
            LEFT JOIN daily_results wr ON wr.challenge_id = p.challenge_id AND wr.scope = 'world' AND wr.proof_id = p.id
            LEFT JOIN daily_results cr ON cr.challenge_id = p.challenge_id AND cr.scope = p.city_id AND cr.proof_id = p.id
            WHERE p.user_id = ? AND p.moderation_status = 'approved' AND NOT p.is_seed AND NOT p.is_demo
            ORDER BY wr.rank NULLS LAST,
                     (cr.rank = 1 AND p.vote_count >= ?) DESC NULLS LAST,
                     p.vote_count DESC, p.approved_at DESC
            LIMIT 6
        ");
        $stmt->execute([$userId, self::MIN_VOTES_TO_WIN]);
        $rows = array_values(array_filter(array_map(
            static fn(string $id): ?array => DailyProofRepository::findById($id),
            $stmt->fetchAll(PDO::FETCH_COLUMN),
        )));

        $passes = DailyLocalPass::forUser($userId);
        return [
            'currentStreak' => $current,
            'bestStreak'    => $best,
            'completed'     => count($done),
            'bestProofs'    => array_map(
                static fn(array $r): array => DailyProofRepository::format($r, $viewerId),
                DailyVotes::annotate($rows, $viewerId),
            ),
            'localPasses'       => $passes['passes'],
            'localPassProgress' => $passes['progress'],
            'specialStamps'     => $passes['specials'],
            // Represent your city (SPEC 9.16): "Pioneer of Saigon", one per city, permanent.
            'pioneerOf'         => DailyPresence::citiesOf($userId),
        ];
    }
}
