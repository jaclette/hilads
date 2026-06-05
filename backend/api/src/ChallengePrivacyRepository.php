<?php

declare(strict_types=1);

/**
 * Privacy votes — mutual go-private for challenges already in progress.
 *
 * Local challenges flip from public → private only when BOTH the creator AND
 * the (single) acceptor have voted 'agreed'. International rows are always
 * public (enforced at create/update time in ChallengeRepository).
 *
 * Statuses we actually write here:
 *   'agreed' — this user wants the flip to private
 *   'denied' — this user has explicitly declined (locks the request; the
 *              other side has to clear & re-open)
 *
 * The migration also documents 'pending'; we never write that — absence of a
 * row is the implicit pending state. Keeping the column definition open
 * lets future flows (e.g. timed expiry) re-introduce it without a migration.
 *
 * Lifecycle:
 *   1. First user votes 'agreed' → row inserted; other side gets a push.
 *   2. Second user votes 'agreed' → bothAgreed() returns true; route layer
 *      flips channel_challenges.visibility to 'private' and reset()s the votes.
 *   3. Either side can vote 'denied' → request is dead until someone clears
 *      and re-votes (UI shows "Declined — try again").
 *   4. clearVote() lets a user withdraw their own vote (e.g. abandon the
 *      flow before the other side has responded).
 */
class ChallengePrivacyRepository
{
    public const ALLOWED_STATUSES = ['agreed', 'denied'];

    /**
     * Upsert a vote for (challenge, user). New row → 'agreed' starts the
     * request; an existing row can flip (e.g. someone changes their mind
     * from 'denied' back to 'agreed'). Returns the row that exists after
     * the upsert.
     */
    public static function vote(string $challengeId, string $userId, string $status): ?array
    {
        if (!in_array($status, self::ALLOWED_STATUSES, true)) return null;

        $id = bin2hex(random_bytes(16));
        $stmt = Database::pdo()->prepare("
            INSERT INTO challenge_privacy_requests (id, challenge_id, user_id, status)
            VALUES (?, ?, ?, ?)
            ON CONFLICT (challenge_id, user_id) DO UPDATE SET
                status     = EXCLUDED.status,
                updated_at = now()
            RETURNING id, challenge_id, user_id, status,
                      to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS created_at,
                      to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS updated_at
        ");
        $stmt->execute([$id, $challengeId, $userId, $status]);
        $row = $stmt->fetch(\PDO::FETCH_ASSOC);
        return $row ?: null;
    }

    /**
     * All vote rows for a challenge (max 2 in the 1:1 model). Returned in
     * created-order so the UI can show "X opened the request, waiting for Y".
     */
    public static function getByChallenge(string $challengeId): array
    {
        $stmt = Database::pdo()->prepare("
            SELECT id, challenge_id, user_id, status,
                   to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS created_at,
                   to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS updated_at
            FROM challenge_privacy_requests
            WHERE challenge_id = ?
            ORDER BY created_at ASC
        ");
        $stmt->execute([$challengeId]);
        return $stmt->fetchAll(\PDO::FETCH_ASSOC) ?: [];
    }

    /**
     * Convenience — true iff exactly two rows exist and both are 'agreed'.
     * Caller drives the visibility flip + reset on this returning true.
     */
    public static function bothAgreed(string $challengeId, string $creatorUserId, string $acceptorUserId): bool
    {
        $stmt = Database::pdo()->prepare("
            SELECT user_id, status
            FROM challenge_privacy_requests
            WHERE challenge_id = ?
              AND user_id IN (?, ?)
              AND status = 'agreed'
        ");
        $stmt->execute([$challengeId, $creatorUserId, $acceptorUserId]);
        $agreed = $stmt->fetchAll(\PDO::FETCH_COLUMN);
        return count($agreed) === 2;
    }

    /**
     * Drop one user's vote (withdraw). Returns true if a row was deleted.
     */
    public static function clearVote(string $challengeId, string $userId): bool
    {
        $stmt = Database::pdo()->prepare("
            DELETE FROM challenge_privacy_requests
            WHERE challenge_id = ? AND user_id = ?
        ");
        $stmt->execute([$challengeId, $userId]);
        return $stmt->rowCount() > 0;
    }

    /**
     * Drop ALL votes for a challenge. Called after a successful flip to
     * private (so the same row can later go through another cycle if needed)
     * AND when the challenge moves into a terminal state (validated/rejected)
     * to avoid stale rows lingering.
     */
    public static function reset(string $challengeId): void
    {
        $stmt = Database::pdo()->prepare("
            DELETE FROM challenge_privacy_requests WHERE challenge_id = ?
        ");
        $stmt->execute([$challengeId]);
    }
}
