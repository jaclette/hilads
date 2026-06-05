<?php

declare(strict_types=1);

/**
 * Per-challenge display mask — "remove my name from this challenge".
 *
 * A user (creator or acceptor) can flip themselves to anonymous on a single
 * challenge. The row is a display directive only; the user keeps receiving
 * notifications and can still act on the challenge. Read-path formatters in
 * ChallengeRepository and ChallengeAcceptanceRepository consult the set
 * returned by getForChallenge() / getForChallengeBatch() and substitute the
 * display fields when a user_id is in the set.
 *
 * The flip is idempotent (ON CONFLICT DO NOTHING). Reversing is a plain
 * DELETE — no soft delete, no audit. We keep the row's anonymized_at for
 * future "you anonymized yourself on N challenges" UI but don't expose it
 * outside this repo.
 */
class ChallengeAnonymizationRepository
{
    /** Display tokens used when a user is anonymized — UI never localizes these. */
    public const DISPLAY_NAME    = 'Anonymous';
    public const DISPLAY_HANDLE  = null; // null username → no profile link

    public static function anonymize(string $challengeId, string $userId): void
    {
        $stmt = Database::pdo()->prepare("
            INSERT INTO challenge_anonymized_users (challenge_id, user_id)
            VALUES (?, ?)
            ON CONFLICT (challenge_id, user_id) DO NOTHING
        ");
        $stmt->execute([$challengeId, $userId]);
    }

    public static function removeAnonymization(string $challengeId, string $userId): bool
    {
        $stmt = Database::pdo()->prepare("
            DELETE FROM challenge_anonymized_users
            WHERE challenge_id = ? AND user_id = ?
        ");
        $stmt->execute([$challengeId, $userId]);
        return $stmt->rowCount() > 0;
    }

    public static function isAnonymized(string $challengeId, string $userId): bool
    {
        $stmt = Database::pdo()->prepare("
            SELECT 1 FROM challenge_anonymized_users
            WHERE challenge_id = ? AND user_id = ?
        ");
        $stmt->execute([$challengeId, $userId]);
        return (bool) $stmt->fetchColumn();
    }

    /**
     * Anonymized user_ids on a single challenge. Returned as a hash-set
     * (user_id => true) so callers can do O(1) `isset()` lookups in
     * format/preview loops.
     */
    public static function getForChallenge(string $challengeId): array
    {
        $stmt = Database::pdo()->prepare("
            SELECT user_id FROM challenge_anonymized_users WHERE challenge_id = ?
        ");
        $stmt->execute([$challengeId]);
        $set = [];
        foreach ($stmt->fetchAll(\PDO::FETCH_COLUMN) as $uid) {
            $set[$uid] = true;
        }
        return $set;
    }

    /**
     * Batched variant for the NOW feed and similar list paths. Returns a
     * map of challenge_id → (user_id => true). Empty challenges absent
     * from the map; callers must default to []/empty-set.
     */
    public static function getForChallengeBatch(array $challengeIds): array
    {
        if (empty($challengeIds)) return [];
        $in   = implode(',', array_fill(0, count($challengeIds), '?'));
        $stmt = Database::pdo()->prepare("
            SELECT challenge_id, user_id FROM challenge_anonymized_users
            WHERE challenge_id IN ($in)
        ");
        $stmt->execute(array_values($challengeIds));
        $map = [];
        foreach ($stmt->fetchAll(\PDO::FETCH_ASSOC) as $r) {
            $map[$r['challenge_id']][$r['user_id']] = true;
        }
        return $map;
    }
}
