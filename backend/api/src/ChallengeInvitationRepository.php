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
    /**
     * Idempotent invite. Returns the row (newly inserted or pre-existing) and
     * a flag indicating which it was. Re-inviting someone:
     *   - already 'ignored' → flips back to 'pending' (creator clearly wants
     *     to re-engage; the previous dismiss was the invitee's call but a
     *     fresh push is reasonable behaviour).
     *   - already 'accepted' → stays 'accepted'; the caller should skip the
     *     push (they're already in the take-on flow, no need to re-ping).
     *   - already 'pending' → stays 'pending', refreshed push fires.
     *
     * The `isNew` flag lets the caller distinguish first-send from re-send so
     * it can produce sensible analytics + count semantics.
     *
     * @return array{row: array, isNew: bool, wasAccepted: bool}|null
     */
    public static function createOrTouch(string $challengeId, string $inviterUserId, string $inviteeUserId): ?array
    {
        $id = bin2hex(random_bytes(16));

        // ON CONFLICT … DO UPDATE — flip ignored→pending, keep accepted as-is,
        // pending re-touches to pending. We compare xmax=0 to detect insert vs
        // update; xmax is the deletion txid and is 0 for fresh inserts only.
        $stmt = Database::pdo()->prepare("
            INSERT INTO challenge_invitations (id, challenge_id, inviter_user_id, invitee_user_id, status)
            VALUES (?, ?, ?, ?, 'pending')
            ON CONFLICT (challenge_id, invitee_user_id) DO UPDATE SET
                status       = CASE WHEN challenge_invitations.status = 'accepted'
                                    THEN 'accepted'
                                    ELSE 'pending' END,
                responded_at = CASE WHEN challenge_invitations.status = 'accepted'
                                    THEN challenge_invitations.responded_at
                                    ELSE NULL END
            RETURNING id, challenge_id, inviter_user_id, invitee_user_id, status,
                      to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS created_at,
                      (xmax = 0) AS is_new
        ");
        $stmt->execute([$id, $challengeId, $inviterUserId, $inviteeUserId]);
        $row = $stmt->fetch(\PDO::FETCH_ASSOC);
        if (!$row) return null;

        $isNew = (bool) $row['is_new'];
        unset($row['is_new']);
        return [
            'row'         => $row,
            'isNew'       => $isNew,
            'wasAccepted' => $row['status'] === 'accepted',
        ];
    }

    /** Backwards-compat shim — older callers that just need the row. */
    public static function create(string $challengeId, string $inviterUserId, string $inviteeUserId): ?array
    {
        $res = self::createOrTouch($challengeId, $inviterUserId, $inviteeUserId);
        return $res ? $res['row'] : null;
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
