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
 *   day after the first, capped at +20 (day 1 +0, day 2 +2, day 11+ +20),
 *   and early_proof (+5) for a proof posted early (V2-07);
 * - the close (next drop): daily_vote (at least one vote standing at the close),
 *   daily_top1/2/3, daily_city_best, daily_twist (twist author), plus a safety
 *   pass for approved proofs that missed their approval award.
 *
 * Since 2026-10-22 only three kinds earn (EARNING_KINDS, the founder's call:
 * "too complicated"): posting a photo, voting, the World top 3. Streak, early,
 * city best, twist, proposal and Local Pass awards stop; the streak, the early
 * badge and the Local Pass stay, without points. Past rows are kept.
 *
 * Scoring v2 (2026-11, docs/scoring-v2-audit.md, values in config/scoring.php):
 * from the challenge dated Scoring::since() on, votes earn nothing, a Perfect
 * week (a photo on every published challenge of a Mon–Sun week) earns
 * perfect_week, and invites earn friend_joined / crew_bonus (P3). The podium
 * pays only 🥇 on a day with fewer photos than the podium_min_photos switch.
 *
 * Reversal: proof-linked rows carry daily_proof_id. Reject and admin removal
 * delete them, an owner delete cascades, and trg_score_event_daily_reverse
 * takes the points back off the user's totals.
 */
final class DailyPoints
{
    public const STREAK_CAP = 20;
    /** The only kinds that still earn points (see the class comment). */
    public const EARNING_KINDS = ['daily_proof', 'daily_vote', 'daily_top1', 'daily_top2', 'daily_top3',
                                  'perfect_week', 'friend_joined', 'crew_bonus'];

    /** @var array<string,int>|null */
    private static ?array $rules = null;

    /** Points of a daily kind: config/scoring.php for the v2 kinds, else score_rules (0 when missing). */
    public static function rule(string $kind): int
    {
        if (isset(Scoring::config()['points'][$kind])) {
            return Scoring::points($kind);
        }
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
        // Speed bonus (V2-07): posted within 3h of the user's start time.
        if (DailyProofRepository::bool($proof['is_early'] ?? false)
            && self::insert($proof['user_id'], $proof['challenge_id'], 'early_proof', self::rule('early_proof'),
                            $proof['city_id'], $proof['id'], null)) {
            $awarded[] = 'early_proof';
        }
        if (Scoring::isV2((string) $proof['challenge_date'])
            && self::awardPerfectWeek($proof['user_id'], (string) $proof['challenge_date'], $proof['city_id'])) {
            $awarded[] = 'perfect_week';
        }
        if ($awarded !== [] && $recalcRanks) {
            MonthlyRankService::recalcAfterScoreChange($proof['user_id']);
        }
        return $awarded;
    }

    /**
     * The Perfect week of the Mon–Sun week holding $date, once the week is over (its Sunday's
     * challenge is today's or past) and from the switch week on: a photo (approved, real) on
     * every published challenge of the week. Anchored on the week's last published challenge,
     * so it is once per week and in the season of that day; not proof-linked (deleting one's
     * own photo keeps it, moderation takes it back: revokeForModeration). Idempotent.
     */
    public static function awardPerfectWeek(string $userId, string $date, ?string $cityId): bool
    {
        [$monday, $sunday] = Scoring::week($date);
        if (!Scoring::isV2($sunday) || DailyClock::currentDate() < $sunday) {
            return false;
        }
        $stmt = Database::pdo()->prepare("
            SELECT dc.id, dc.challenge_date::text AS date,
                   EXISTS (SELECT 1 FROM daily_proofs p WHERE p.challenge_id = dc.id AND p.user_id = ?
                             AND p.moderation_status = 'approved' AND NOT p.is_demo AND NOT p.is_seed AND NOT p.is_suggestion) AS played
            FROM daily_challenges dc
            WHERE dc.status = 'published' AND dc.challenge_date BETWEEN ?::date AND ?::date
            ORDER BY dc.challenge_date
        ");
        $stmt->execute([$userId, $monday, $sunday]);
        $days = $stmt->fetchAll(PDO::FETCH_ASSOC);
        if ($days === []) {
            return false;
        }
        $played = [];
        foreach ($days as $d) {
            if (DailyProofRepository::bool($d['played'])) $played[$d['date']] = true;
        }
        if (Scoring::perfectWeeks(array_column($days, 'date'), $played, $sunday) === []) {
            return false;
        }
        $anchor = end($days)['id'];
        return self::insert($userId, $anchor, 'perfect_week', self::rule('perfect_week'), $cityId, null, null);
    }

    /**
     * Moderation rejected or removed a photo: its own rows go (+10, podium: proof-linked,
     * deleted by the caller) and so does the Perfect week of its week. Call inside the
     * moderation transaction.
     */
    public static function revokePerfectWeek(string $userId, string $date): int
    {
        [$monday, $sunday] = Scoring::week($date);
        $stmt = Database::pdo()->prepare("
            DELETE FROM score_events se
            USING daily_challenges dc
            WHERE dc.id = se.daily_challenge_id AND se.user_id = ? AND se.kind = 'perfect_week'
              AND dc.challenge_date BETWEEN ?::date AND ?::date
        ");
        $stmt->execute([$userId, $monday, $sunday]);
        return $stmt->rowCount();
    }

    /**
     * Close awards for a challenge whose results were just computed ($plan from
     * DailyResults::compute). Idempotent. Returns counts per kind.
     */
    public static function awardClose(string $challengeId, array $plan): array
    {
        $pdo    = Database::pdo();
        $counts = ['proof_catchup' => 0, 'daily_vote' => 0, 'top' => 0, 'daily_city_best' => 0, 'daily_twist' => 0, 'perfect_week' => 0];
        $date   = (string) $pdo->query("SELECT challenge_date::text FROM daily_challenges WHERE id = " . $pdo->quote($challengeId))->fetchColumn();
        $v2     = $date !== '' && Scoring::isV2($date);

        // Safety pass: approved proofs without their approval award.
        $stmt = $pdo->prepare("
            SELECT p.id FROM daily_proofs p
            WHERE p.challenge_id = ? AND p.moderation_status = 'approved' AND NOT p.is_demo
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
        // v2: likes give no points (past rows stay).
        $votePts = $v2 ? 0 : self::rule('daily_vote');
        if ($votePts > 0) {
            $stmt = $pdo->prepare("
                INSERT INTO score_events (id, user_id, role, kind, points, city_id, month_ref, daily_challenge_id)
                SELECT encode(gen_random_bytes(8), 'hex'), v.voter_user_id, 'daily', 'daily_vote', ?,
                       (SELECT c.id FROM channels c WHERE c.id = u.current_city_id), ?, ?
                -- Demo proofs and demo voters never count (DailyDemo).
                FROM (SELECT DISTINCT dv.voter_user_id FROM daily_votes dv
                      JOIN daily_proofs dp ON dp.id = dv.proof_id AND NOT dp.is_demo
                      WHERE dv.challenge_id = ?) v
                JOIN users u ON u.id = v.voter_user_id AND NOT u.is_demo
                ON CONFLICT DO NOTHING
            ");
            $stmt->execute([$votePts, gmdate('Y-m'), $challengeId, $challengeId]);
            $counts['daily_vote'] = $stmt->rowCount();
        }

        // v2 switch podium_min_photos: a day with fewer photos worldwide pays only the first.
        $world = $plan['world'];
        $minPhotos = $v2 ? (int) Scoring::switch('podium_min_photos') : 0;
        if ($minPhotos > 0 && (int) ($plan['photos'] ?? PHP_INT_MAX) < $minPhotos) {
            $world = array_slice($world, 0, 1);
        }
        foreach ($world as $i => $row) {
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

        // Perfect weeks: the close of a week's last challenge checks everyone who played it
        // (the approval already did; this catches a late approval or a rerun).
        if ($v2 && $date === Scoring::week($date)[1]) {
            $stmt = $pdo->prepare("SELECT DISTINCT user_id, city_id FROM daily_proofs
                                   WHERE challenge_id = ? AND moderation_status = 'approved' AND NOT is_demo AND NOT is_seed AND NOT is_suggestion");
            $stmt->execute([$challengeId]);
            foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $p) {
                if (self::awardPerfectWeek($p['user_id'], $date, $p['city_id'])) $counts['perfect_week']++;
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
        if ($points <= 0 || !in_array($kind, self::EARNING_KINDS, true)) {
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
