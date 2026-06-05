<?php

declare(strict_types=1);

/**
 * ChallengeProofRepository — proof submissions for International challenges.
 *
 * One row per submission attempt. Acceptor can re-submit up to MAX_ATTEMPTS
 * times after creator rejections; the cap is enforced in the route layer so
 * we can flex without a migration. status: 'pending' → 'approved'|'rejected'.
 *
 * Phase model on the parent acceptance row:
 *   acceptance.phase='accepted' (or 'pending' until step 4 lands the auto-
 *   approve) → first submit → 'proof_submitted'.
 *   approve  → acceptance.phase='approved' (terminal, success)
 *   reject   → proof.status='rejected' + acceptance.phase stays
 *              'proof_submitted' so the acceptor can resubmit. When the
 *              attempt cap is reached, the route promotes acceptance.phase
 *              to 'rejected' (terminal, failure).
 */
final class ChallengeProofRepository
{
    /** Hard cap per acceptance — protects creator from infinite re-submissions. */
    public const MAX_ATTEMPTS = 3;

    /**
     * Insert a new pending proof. Caller has already validated:
     *   - acceptance exists + caller is acceptor
     *   - challenge is international
     *   - attempt count < MAX_ATTEMPTS
     *   - geotag is set + bbox-checked (geotagVerified result stored)
     */
    public static function create(
        string $acceptanceId,
        string $mediaUrl,
        string $mediaType,
        float  $lat,
        float  $lng,
        bool   $geotagVerified
    ): ?array {
        $id = bin2hex(random_bytes(16));
        $stmt = Database::pdo()->prepare("
            INSERT INTO challenge_proofs
                (id, acceptance_id, media_url, media_type, geotag_lat, geotag_lng, geotag_verified, status)
            VALUES
                (?, ?, ?, ?, ?, ?, ?, 'pending')
            RETURNING id, acceptance_id, media_url, media_type, geotag_lat, geotag_lng, geotag_verified,
                      status, rejection_reason,
                      to_char(submitted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS submitted_at,
                      to_char(reviewed_at  AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS reviewed_at
        ");
        $stmt->execute([$id, $acceptanceId, $mediaUrl, $mediaType, $lat, $lng, $geotagVerified ? 1 : 0]);
        $row = $stmt->fetch(\PDO::FETCH_ASSOC);
        return $row ? self::normalise($row) : null;
    }

    public static function findById(string $id): ?array
    {
        $stmt = Database::pdo()->prepare("
            SELECT id, acceptance_id, media_url, media_type, geotag_lat, geotag_lng, geotag_verified,
                   status, rejection_reason,
                   to_char(submitted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS submitted_at,
                   to_char(reviewed_at  AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS reviewed_at
            FROM challenge_proofs
            WHERE id = ?
        ");
        $stmt->execute([$id]);
        $row = $stmt->fetch(\PDO::FETCH_ASSOC);
        return $row ? self::normalise($row) : null;
    }

    /**
     * All proof attempts for an acceptance, newest first. Creator's review
     * queue + acceptor's history both render this. Bounded by MAX_ATTEMPTS
     * so no LIMIT needed (Supabase egress notes — every challenge list query
     * has a LIMIT, but this is bounded by the FK constraint).
     */
    public static function listByAcceptance(string $acceptanceId): array
    {
        $stmt = Database::pdo()->prepare("
            SELECT id, acceptance_id, media_url, media_type, geotag_lat, geotag_lng, geotag_verified,
                   status, rejection_reason,
                   to_char(submitted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS submitted_at,
                   to_char(reviewed_at  AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS reviewed_at
            FROM challenge_proofs
            WHERE acceptance_id = ?
            ORDER BY submitted_at DESC
            LIMIT 10
        ");
        $stmt->execute([$acceptanceId]);
        return array_map([self::class, 'normalise'], $stmt->fetchAll(\PDO::FETCH_ASSOC));
    }

    /** Count of submissions for the 3-attempt gate. */
    public static function attemptCountByAcceptance(string $acceptanceId): int
    {
        $stmt = Database::pdo()->prepare("
            SELECT COUNT(*) FROM challenge_proofs WHERE acceptance_id = ?
        ");
        $stmt->execute([$acceptanceId]);
        return (int) $stmt->fetchColumn();
    }

    /**
     * Flip 'pending' → 'approved'. Idempotent if already approved.
     * Returns the updated row or null if not found / wrong status.
     */
    public static function approve(string $id): ?array
    {
        $stmt = Database::pdo()->prepare("
            UPDATE challenge_proofs
            SET status = 'approved', reviewed_at = now()
            WHERE id = ? AND status = 'pending'
            RETURNING id, acceptance_id, media_url, media_type, geotag_lat, geotag_lng, geotag_verified,
                      status, rejection_reason,
                      to_char(submitted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS submitted_at,
                      to_char(reviewed_at  AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS reviewed_at
        ");
        $stmt->execute([$id]);
        $row = $stmt->fetch(\PDO::FETCH_ASSOC);
        // Already-terminal rows return the existing snapshot — caller can
        // distinguish (the route layer wants to know whether to fire pushes).
        return $row ? self::normalise($row) : self::findById($id);
    }

    /**
     * Flip 'pending' → 'rejected' with mandatory reason. Caller has already
     * validated the reason is 1–200 chars. Idempotent on the terminal state.
     */
    public static function reject(string $id, string $reason): ?array
    {
        $stmt = Database::pdo()->prepare("
            UPDATE challenge_proofs
            SET status = 'rejected', rejection_reason = ?, reviewed_at = now()
            WHERE id = ? AND status = 'pending'
            RETURNING id, acceptance_id, media_url, media_type, geotag_lat, geotag_lng, geotag_verified,
                      status, rejection_reason,
                      to_char(submitted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS submitted_at,
                      to_char(reviewed_at  AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS reviewed_at
        ");
        $stmt->execute([$reason, $id]);
        $row = $stmt->fetch(\PDO::FETCH_ASSOC);
        return $row ? self::normalise($row) : self::findById($id);
    }

    private static function normalise(array $row): array
    {
        $row['geotag_lat']      = (float) $row['geotag_lat'];
        $row['geotag_lng']      = (float) $row['geotag_lng'];
        $row['geotag_verified'] = (bool)  $row['geotag_verified'];
        return $row;
    }
}
