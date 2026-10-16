<?php

declare(strict_types=1);

/**
 * Daily Challenge votes (SPEC 3.6): 3 per user per challenge, on any approved
 * proof worldwide except one's own, one per proof, open from the proof's
 * approval until the next drop. Registered users only (daily_votes needs a
 * user, like proofs).
 *
 * Concurrency: each vote takes one of 3 slots, unique per (challenge, voter),
 * and the proof is unique per voter, so two simultaneous requests can never
 * make a 4th vote or a double vote. A request that loses the race for a slot
 * re-reads and retries; no locks (the pooler runs in transaction mode).
 * Own-proof and not-approved are also refused by trg_daily_vote_check.
 *
 * The voter's "local" status (DailyRules::isLocalFor with the proof's city) is
 * snapshotted on the vote; a proof with one local vote shows "validated by a
 * local".
 */
final class DailyVotes
{
    public const MAX = 3;

    /**
     * Vote for a proof. Returns 'voted' or 'already_voted'; throws
     * InvalidArgumentException with code not_found, own_proof, voting_closed
     * or vote_limit.
     */
    public static function cast(array $proof, array $user): string
    {
        self::guard($proof, $user);
        $isLocal = DailyRules::isLocalFor($user['mode'] ?? null, $user['home_city'] ?? null, $proof['city_name'] ?? null);
        $pdo     = Database::pdo();

        for ($attempt = 0; $attempt < self::MAX + 1; $attempt++) {
            $stmt = $pdo->prepare("SELECT proof_id, vote_slot FROM daily_votes WHERE challenge_id = ? AND voter_user_id = ?");
            $stmt->execute([$proof['challenge_id'], $user['id']]);
            $used = $stmt->fetchAll(PDO::FETCH_KEY_PAIR);
            if (isset($used[$proof['id']])) {
                return 'already_voted';
            }
            $slot = self::freeSlot(array_map('intval', array_values($used)));
            if ($slot === null) {
                throw new InvalidArgumentException('vote_limit');
            }
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
                if ($e->getCode() !== '23505') {
                    throw $e;
                }
                // Lost a race (same slot, or the same proof from another tap): re-read and retry.
            }
        }
        throw new InvalidArgumentException('vote_limit');
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

    /** First free slot (1..MAX), or null. Pure. */
    public static function freeSlot(array $usedSlots): ?int
    {
        for ($s = 1; $s <= self::MAX; $s++) {
            if (!in_array($s, $usedSlots, true)) {
                return $s;
            }
        }
        return null;
    }

    /** My votes on a challenge: {used, left, proofIds}. */
    public static function mine(string $challengeId, string $userId): array
    {
        $stmt = Database::pdo()->prepare("SELECT proof_id FROM daily_votes WHERE challenge_id = ? AND voter_user_id = ?");
        $stmt->execute([$challengeId, $userId]);
        $ids = $stmt->fetchAll(PDO::FETCH_COLUMN);
        return ['used' => count($ids), 'left' => max(0, self::MAX - count($ids)), 'proofIds' => $ids];
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
