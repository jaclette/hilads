<?php

declare(strict_types=1);

/**
 * Daily Challenge votes (SPEC 3.6): as many as a user likes per challenge, on
 * any approved proof worldwide except one's own, one per proof, open from the
 * proof's approval until the next drop. Registered users only (daily_votes
 * needs a user, like proofs).
 *
 * Concurrency: the proof is unique per voter, so two simultaneous requests can
 * never make a double vote. vote_slot is just the vote's rank for the voter
 * (the 3-vote limit is gone; until migrate.php drops its constraints, a 4th
 * slot is refused as vote_limit). Own-proof and not-approved are also refused
 * by trg_daily_vote_check.
 *
 * The voter's "local" status (DailyRules::isLocalFor with the proof's city) is
 * snapshotted on the vote; a proof with one local vote shows "validated by a
 * local".
 */
final class DailyVotes
{
    /**
     * Vote for a proof. Returns 'voted' or 'already_voted'; throws
     * InvalidArgumentException with code not_found, own_proof, voting_closed
     * (or vote_limit, only before migrate.php drops the old 3-slot constraints).
     */
    public static function cast(array $proof, array $user): string
    {
        self::guard($proof, $user);
        $isLocal = DailyRules::isLocalFor($user['mode'] ?? null, $user['home_city'] ?? null, $proof['city_name'] ?? null);
        $pdo     = Database::pdo();

        for ($attempt = 0; $attempt < 4; $attempt++) {
            $stmt = $pdo->prepare("SELECT proof_id, vote_slot FROM daily_votes WHERE challenge_id = ? AND voter_user_id = ?");
            $stmt->execute([$proof['challenge_id'], $user['id']]);
            $used = $stmt->fetchAll(PDO::FETCH_KEY_PAIR);
            if (isset($used[$proof['id']])) {
                return 'already_voted';
            }
            $slot = self::nextSlot(array_map('intval', array_values($used)));
            try {
                $pdo->prepare("
                    INSERT INTO daily_votes (challenge_id, proof_id, voter_user_id, voter_is_local, vote_slot)
                    VALUES (?, ?, ?, ?, ?)
                ")->execute([$proof['challenge_id'], $proof['id'], $user['id'], $isLocal ? 'true' : 'false', $slot]);
                return 'voted';
            } catch (PDOException $e) {
                $msg = $e->getMessage();
                if (str_contains($msg, 'daily_vote_own_proof')) {
                    throw new InvalidArgumentException('own_proof');
                }
                if (str_contains($msg, 'daily_vote_proof_not_approved') || str_contains($msg, 'daily_vote_proof_not_found')) {
                    throw new InvalidArgumentException('not_found');
                }
                if ($e->getCode() === '23514') {
                    throw new InvalidArgumentException('vote_limit');   // the old CHECK (slot 1..3), before migrate.php
                }
                if ($e->getCode() !== '23505') {
                    throw $e;
                }
                // Lost a race (same slot, or the same proof from another tap): re-read and retry.
            }
        }
        throw new RuntimeException('Could not record the vote, try again.');
    }

    /** Withdraw my vote on a proof while voting is open. True when a vote was removed. */
    public static function withdraw(array $proof, array $user): bool
    {
        if (!DailyClock::isActive((string) $proof['challenge_date'])) {
            throw new InvalidArgumentException('voting_closed');
        }
        $stmt = Database::pdo()->prepare("DELETE FROM daily_votes WHERE proof_id = ? AND voter_user_id = ?");
        $stmt->execute([$proof['id'], $user['id']]);
        return $stmt->rowCount() > 0;
    }

    /** Heavy voting, flagged (never blocked): at least this share of a city's answers… */
    public const FLAG_SHARE       = 0.8;
    /** …in a city with at least this many approved answers that day. */
    public const FLAG_MIN_ANSWERS = 5;

    /**
     * At the close: flag the voters who voted for FLAG_SHARE or more of a
     * city's approved answers (FLAG_MIN_ANSWERS or more) on a challenge, for
     * the back office to review. Blocks nothing. Returns the new flags.
     */
    public static function flagHeavyVoters(string $challengeId): int
    {
        $stmt = Database::pdo()->prepare("
            INSERT INTO daily_vote_flags (challenge_id, user_id, city_id, votes, answers)
            SELECT ?, v.voter_user_id, p.city_id, count(*), c.answers
            FROM daily_votes v
            JOIN daily_proofs p ON p.id = v.proof_id AND p.city_id IS NOT NULL
            JOIN (SELECT city_id, count(*) AS answers FROM daily_proofs
                  WHERE challenge_id = ? AND moderation_status = 'approved' AND NOT is_seed AND NOT is_demo AND city_id IS NOT NULL
                  GROUP BY city_id) c ON c.city_id = p.city_id
            WHERE v.challenge_id = ? AND c.answers >= ?::int
            GROUP BY v.voter_user_id, p.city_id, c.answers
            HAVING count(*) >= ceil(c.answers * ?::numeric)
            ON CONFLICT DO NOTHING
        ");
        $stmt->execute([$challengeId, $challengeId, $challengeId, self::FLAG_MIN_ANSWERS, self::FLAG_SHARE]);
        return $stmt->rowCount();
    }

    /** The back office's flagged voters of the last $days days: one row per voter, most flagged days first. */
    public static function flaggedVoters(int $days = 14): array
    {
        $stmt = Database::pdo()->prepare("
            SELECT u.id, u.username, count(DISTINCT f.challenge_id) AS days, count(*) AS flags,
                   max(round(100.0 * f.votes / f.answers)) AS max_share, max(dc.challenge_date)::text AS last_date
            FROM daily_vote_flags f
            JOIN users u ON u.id = f.user_id
            JOIN daily_challenges dc ON dc.id = f.challenge_id
            WHERE dc.challenge_date >= CURRENT_DATE - (? * INTERVAL '1 day')
            GROUP BY u.id, u.username
            ORDER BY days DESC, flags DESC
            LIMIT 50
        ");
        $stmt->execute([$days]);
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    /** The next vote's rank for a voter: one past the highest used. Pure. */
    public static function nextSlot(array $usedSlots): int
    {
        return $usedSlots === [] ? 1 : max($usedSlots) + 1;
    }

    /** My votes on a challenge: {used, left (null: no limit), proofIds}. */
    public static function mine(string $challengeId, string $userId): array
    {
        $stmt = Database::pdo()->prepare("SELECT proof_id FROM daily_votes WHERE challenge_id = ? AND voter_user_id = ?");
        $stmt->execute([$challengeId, $userId]);
        $ids = $stmt->fetchAll(PDO::FETCH_COLUMN);
        return ['used' => count($ids), 'left' => null, 'proofIds' => $ids];
    }

    /** Set my_vote on proof rows for the viewer (read by DailyProofRepository::format). */
    public static function annotate(array $rows, ?string $viewerId): array
    {
        if ($viewerId === null || $rows === []) {
            return $rows;
        }
        $ids  = array_column($rows, 'id');
        $stmt = Database::pdo()->prepare("
            SELECT proof_id FROM daily_votes
            WHERE voter_user_id = ? AND proof_id = ANY (string_to_array(?, ','))
        ");
        $stmt->execute([$viewerId, implode(',', $ids)]);
        $voted = array_flip($stmt->fetchAll(PDO::FETCH_COLUMN));
        foreach ($rows as &$r) {
            $r['my_vote'] = isset($voted[$r['id']]);
        }
        unset($r);
        return $rows;
    }

    /**
     * Live vote state of a proof row for a viewer: {voteCount, validatedByLocal,
     * myVote, isMine, votingOpen}. Row needs user_id, vote_count,
     * local_vote_count, challenge_date and my_vote. Pure (given the clock).
     */
    public static function stateOf(array $row, ?string $viewerId, ?DateTimeImmutable $now = null): array
    {
        return [
            'voteCount'        => (int) $row['vote_count'],
            'validatedByLocal' => (int) $row['local_vote_count'] > 0,
            'myVote'           => DailyProofRepository::bool($row['my_vote'] ?? false),
            'isMine'           => $viewerId !== null && $viewerId === $row['user_id'],
            'votingOpen'       => DailyClock::isActive((string) $row['challenge_date'], $now),
        ];
    }

    /**
     * Vote state of several approved proofs (channel cards), keyed by proof id.
     * Unknown, unapproved and blocked authors' proofs are left out. One query.
     */
    public static function states(array $ids, ?string $viewerId, array $blockedUserIds): array
    {
        if ($ids === []) {
            return [];
        }
        $stmt = Database::pdo()->prepare("
            SELECT p.id, p.user_id, p.vote_count, p.local_vote_count, dc.challenge_date,
                   (v.proof_id IS NOT NULL) AS my_vote
            FROM daily_proofs p
            JOIN daily_challenges dc ON dc.id = p.challenge_id
            LEFT JOIN daily_votes v ON v.proof_id = p.id AND v.voter_user_id = ?
            WHERE p.id = ANY (string_to_array(?, ',')) AND p.moderation_status = 'approved'
        ");
        $stmt->execute([$viewerId ?? '', implode(',', $ids)]);
        $out = [];
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
            if (!in_array($r['user_id'], $blockedUserIds, true)) {
                $out[$r['id']] = self::stateOf($r, $viewerId);
            }
        }
        return $out;
    }

    private static function guard(array $proof, array $user): void
    {
        if ($proof['moderation_status'] !== 'approved') {
            throw new InvalidArgumentException('not_found');
        }
        if ($proof['user_id'] === $user['id']) {
            throw new InvalidArgumentException('own_proof');
        }
        if (!DailyClock::isActive((string) $proof['challenge_date'])) {
            throw new InvalidArgumentException('voting_closed');
        }
    }
}
