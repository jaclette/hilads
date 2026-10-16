<?php

declare(strict_types=1);

/**
 * Daily Challenge points (SPEC 3.8), through the existing score_events ledger.
 *
 * Values live in score_rules (role 'daily'): the one config to align with the
 * Most Local scale. Every award is one score_events row, unique per (user,
 * daily challenge, kind) (uq_score_events_daily), so ON CONFLICT DO NOTHING
 * makes each award happen once even when a job reruns. Admin accounts earn
 * nothing (trg_score_event_adjust discards their rows).
 *
 * When:
 * - approval of a proof: daily_proof, and daily_streak = 2 per consecutive
 *   day after the first, capped at +20 (day 1 +0, day 2 +2, day 11+ +20);
 * - the close (next drop): daily_vote (at least one vote standing at the close),
 *   daily_top1/2/3, daily_city_best, daily_twist (twist author), plus a safety
 *   pass for approved proofs that missed their approval award.
 *
 * Reversal: proof-linked rows carry daily_proof_id. Reject and admin removal
 * delete them, an owner delete cascades, and trg_score_event_daily_reverse
 * takes the points back off the user's totals.
 */
final class DailyPoints
{
    public const STREAK_CAP = 20;

    /** @var array<string,int>|null */
    private static ?array $rules = null;

    /** Points of a daily kind from score_rules (0 when missing). */
    public static function rule(string $kind): int
    {
        if (self::$rules === null) {
            self::$rules = [];
            $rows = Database::pdo()->query("SELECT kind, points FROM score_rules WHERE role = 'daily'")->fetchAll(PDO::FETCH_ASSOC);
            foreach ($rows as $r) {
                self::$rules[$r['kind']] = (int) $r['points'];
            }
        }
        return self::$rules[$kind] ?? 0;
    }

    /** Streak bonus for day $streak of a streak: $perDay per day after the first, capped. */
    public static function streakBonus(int $streak, int $perDay): int
    {
        return max(0, min(self::STREAK_CAP, $perDay * ($streak - 1)));
    }

    /**
     * Award an approved proof its points (proof + streak bonus). Idempotent.
     * $proof is a DailyProofRepository row. Returns the kinds awarded now.
     */
    public static function awardProof(array $proof, bool $recalcRanks = true): array
    {
        if ($proof['moderation_status'] !== 'approved') {
            return [];
        }
        $awarded = [];
        if (self::insert($proof['user_id'], $proof['challenge_id'], 'daily_proof', self::rule('daily_proof'),
                         $proof['city_id'], $proof['id'], null)) {
            $awarded[] = 'daily_proof';
        }
        $streak = DailyResults::streakEndingAt($proof['user_id'], (string) $proof['challenge_date']);
        $bonus  = self::streakBonus($streak, self::rule('daily_streak'));
        if ($bonus > 0 && self::insert($proof['user_id'], $proof['challenge_id'], 'daily_streak', $bonus,
                                       $proof['city_id'], $proof['id'], null)) {
            $awarded[] = 'daily_streak';
        }
        if ($awarded !== [] && $recalcRanks) {
            MonthlyRankService::recalcAfterScoreChange($proof['user_id']);
        }
        return $awarded;
    }

    /**
     * Close awards for a challenge whose results were just computed ($plan from
     * DailyResults::compute). Idempotent. Returns counts per kind.
     */
    public static function awardClose(string $challengeId, array $plan): array
    {
        $pdo    = Database::pdo();
        $counts = ['proof_catchup' => 0, 'daily_vote' => 0, 'top' => 0, 'daily_city_best' => 0, 'daily_twist' => 0];

        // Safety pass: approved proofs without their approval award.
        $stmt = $pdo->prepare("
            SELECT p.id FROM daily_proofs p
            WHERE p.challenge_id = ? AND p.moderation_status = 'approved'
              AND NOT EXISTS (SELECT 1 FROM score_events se WHERE se.daily_proof_id = p.id AND se.kind = 'daily_proof')
        ");
        $stmt->execute([$challengeId]);
        foreach ($stmt->fetchAll(PDO::FETCH_COLUMN) as $proofId) {
            $proof = DailyProofRepository::findById($proofId);
            if ($proof !== null && self::awardProof($proof, false) !== []) {
                $counts['proof_catchup']++;
            }
        }

        // Voters with at least one vote standing at the close (unvoting gave it back).
        $votePts = self::rule('daily_vote');
        if ($votePts > 0) {
            $stmt = $pdo->prepare("
                INSERT INTO score_events (id, user_id, role, kind, points, city_id, month_ref, daily_challenge_id)
                SELECT encode(gen_random_bytes(8), 'hex'), v.voter_user_id, 'daily', 'daily_vote', ?,
                       (SELECT c.id FROM channels c WHERE c.id = u.current_city_id), ?, ?
                FROM (SELECT DISTINCT voter_user_id FROM daily_votes WHERE challenge_id = ?) v
                JOIN users u ON u.id = v.voter_user_id
                ON CONFLICT DO NOTHING
            ");
            $stmt->execute([$votePts, gmdate('Y-m'), $challengeId, $challengeId]);
            $counts['daily_vote'] = $stmt->rowCount();
        }

        foreach ($plan['world'] as $i => $row) {
            $kind = 'daily_top' . ($i + 1);
            if (self::insert($row['user_id'], $challengeId, $kind, self::rule($kind), $row['city_id'], $row['id'], null)) {
                $counts['top']++;
            }
        }
        foreach ($plan['cityBest'] as $row) {
            if (self::insert($row['user_id'], $challengeId, 'daily_city_best', self::rule('daily_city_best'),
                             $row['city_id'], $row['id'], null)) {
                $counts['daily_city_best']++;
            }
        }

        $stmt = $pdo->prepare("
            SELECT id, author_user_id, city_id FROM daily_twists
            WHERE challenge_id = ? AND status = 'selected' AND moderation_status = 'approved'
              AND author_user_id IS NOT NULL
        ");
        $stmt->execute([$challengeId]);
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $t) {
            if (self::insert($t['author_user_id'], $challengeId, 'daily_twist', self::rule('daily_twist'),
                             $t['city_id'], null, $t['id'])) {
                $counts['daily_twist']++;
            }
        }

        if (array_sum($counts) > 0) {
            MonthlyRankService::recalcAll();
        }
        return $counts;
    }

    /**
     * The Local Pass award (V2-03), once per user (one pass per city, the
     * challenge whose proof completed it). Not proof-linked: deleting a proof
     * never takes it back.
     */
    public static function awardLocalPass(string $userId, string $challengeId, string $cityId): bool
    {
        $awarded = self::insert($userId, $challengeId, 'local_pass', self::rule('local_pass'), $cityId, null, null);
        if ($awarded) {
            MonthlyRankService::recalcAfterScoreChange($userId);
        }
        return $awarded;
    }

    /** Points for the author of a proposed challenge, when it goes live (V2-05). Once per challenge. */
    public static function awardProposal(string $userId, string $challengeId): bool
    {
        $awarded = self::insert($userId, $challengeId, 'proposal_selected', self::rule('proposal_selected'), null, null, null);
        if ($awarded) {
            MonthlyRankService::recalcAfterScoreChange($userId);
        }
        return $awarded;
    }

        /** One award row. True when it was inserted now (false: already awarded, admin, or 0 points). */
    private static function insert(string $userId, string $challengeId, string $kind, int $points,
                                   ?string $cityId, ?string $proofId, ?string $twistId): bool
    {
        if ($points <= 0) {
            return false;
        }
        $stmt = Database::pdo()->prepare("
            INSERT INTO score_events (id, user_id, role, kind, points, city_id, month_ref,
                                      daily_challenge_id, daily_proof_id, daily_twist_id)
            VALUES (?, ?, 'daily', ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT DO NOTHING
            RETURNING id
        ");
        $stmt->execute([bin2hex(random_bytes(8)), $userId, $kind, $points, $cityId, gmdate('Y-m'),
                        $challengeId, $proofId, $twistId]);
        return $stmt->fetchColumn() !== false;
    }
}
