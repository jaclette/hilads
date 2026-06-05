<?php

declare(strict_types=1);

/**
 * ChallengeInvitationRepository — one row per (challenge, invitee) ping.
 *
 * The creator hand-picks city members after publishing a challenge and sends
 * them a personalised invitation. The invitation does NOT bypass the regular
 * take-on flow — it just deep-links the invitee to the challenge (or fires the
 * take-on path on Accept tap) so the existing pending-review machinery owns
 * the actual acceptance lifecycle. We track invitations separately so the
 * creator can see who they already invited and so push action buttons can
 * close the loop by invitation_id.
 *
 * Status: pending → accepted | ignored.
 */
class ChallengeInvitationRepository
{
    public static function create(string $challengeId, string $inviterUserId, string $inviteeUserId): ?array
    {
        $id = bin2hex(random_bytes(16));

        // ON CONFLICT DO NOTHING — re-inviting the same person is a no-op
        // rather than an error (creator may multi-select someone who was
        // already invited in a previous send).
        $stmt = Database::pdo()->prepare("
            INSERT INTO challenge_invitations (id, challenge_id, inviter_user_id, invitee_user_id, status)
            VALUES (?, ?, ?, ?, 'pending')
            ON CONFLICT (challenge_id, invitee_user_id) DO NOTHING
            RETURNING id, challenge_id, inviter_user_id, invitee_user_id, status,
                      to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS created_at
        ");
        $stmt->execute([$id, $challengeId, $inviterUserId, $inviteeUserId]);
        $row = $stmt->fetch(\PDO::FETCH_ASSOC);
        return $row ?: null;
    }

    public static function findById(string $id): ?array
    {
        $stmt = Database::pdo()->prepare("
            SELECT id, challenge_id, inviter_user_id, invitee_user_id, status,
                   to_char(created_at  AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS created_at,
                   to_char(responded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS responded_at
            FROM challenge_invitations
            WHERE id = ?
        ");
        $stmt->execute([$id]);
        $row = $stmt->fetch(\PDO::FETCH_ASSOC);
        return $row ?: null;
    }

    /**
     * Mark an invitation as accepted/ignored. Returns the updated row or null.
     * Idempotent: if the row is already in a terminal state we leave it alone.
     */
    public static function respond(string $id, string $inviteeUserId, string $status): ?array
    {
        if (!in_array($status, ['accepted', 'ignored'], true)) return null;

        $stmt = Database::pdo()->prepare("
            UPDATE challenge_invitations
            SET status = ?, responded_at = now()
            WHERE id = ? AND invitee_user_id = ? AND status = 'pending'
            RETURNING id, challenge_id, inviter_user_id, invitee_user_id, status,
                      to_char(created_at   AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS created_at,
                      to_char(responded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS responded_at
        ");
        $stmt->execute([$status, $id, $inviteeUserId]);
        $row = $stmt->fetch(\PDO::FETCH_ASSOC);
        if ($row) return $row;

        return self::findById($id);
    }

    /** All invitees already invited to a given challenge (for de-dup on resend). */
    public static function inviteeIdsForChallenge(string $challengeId): array
    {
        $stmt = Database::pdo()->prepare("
            SELECT invitee_user_id FROM challenge_invitations WHERE challenge_id = ?
        ");
        $stmt->execute([$challengeId]);
        return $stmt->fetchAll(\PDO::FETCH_COLUMN) ?: [];
    }
}
