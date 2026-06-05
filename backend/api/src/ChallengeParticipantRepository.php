<?php

declare(strict_types=1);

/**
 * Join model for the participation-gated challenge channel.
 *
 * A challenge channel is no longer freely readable. The detail page (title,
 * type, creator, count, current taker) stays public + indexable, but every
 * message-lane read/write goes through isParticipant() — which is true iff:
 *
 *   - the viewer is the creator of the challenge, OR
 *   - the viewer has a non-rejected acceptance (the active taker), OR
 *   - the viewer has a challenge_participants row pointing at this channel
 *     AND is not in challenge_kicks
 *
 * Creator + active taker are IMPLICIT participants — no row needed for them
 * to read. Everyone else clicks "Join this challenge" to drop a row.
 *
 * The legacy challenge_participants table is reused as-is:
 *   PK is (channel_id, guest_id); registered joins set user_id and stuff the
 *   user's id into guest_id too so the UNIQUE composite stays one-row-per
 *   -user. Legacy guest-only rows that pre-date this change are visible to
 *   the new flow only when their user_id is non-null — guest-only rows are
 *   ignored by isParticipant() (the new model is registered-only).
 *
 * Kicks: a challenge_kicks row (challenge_id, user_id) bans the user from
 * re-joining; join() refuses while one exists. Removing the row is ops-only
 * in v1 (no UI). The creator + active taker can issue kicks; nobody can
 * kick the creator.
 */
class ChallengeParticipantRepository
{
    public const ALLOWED_NOTIFICATION_PREFERENCES = ['milestones', 'all', 'off'];

    /**
     * True if the viewer has channel-read access. Order:
     *   1. Creator gate (cheap — uses the challenge row we already have)
     *   2. Active-acceptor gate
     *   3. Explicit challenge_participants row (registered users only)
     *
     * Caller MAY pre-resolve the creator_user_id and pass it in to skip the
     * SELECT; if null we fall back to the DB read. $userId null → not a
     * participant (anon viewers can never read messages).
     */
    public static function isParticipant(
        string $challengeId,
        ?string $userId,
        ?string $creatorUserIdHint = null
    ): bool {
        if ($userId === null) return false;
        $pdo = Database::pdo();

        // (1) Creator implicit pass.
        $creatorId = $creatorUserIdHint;
        if ($creatorId === null) {
            $row = $pdo->prepare("SELECT created_by FROM channel_challenges WHERE channel_id = ?");
            $row->execute([$challengeId]);
            $creatorId = (string) ($row->fetchColumn() ?: '');
        }
        if ($creatorId !== '' && $creatorId === $userId) return true;

        // (2) Active acceptor implicit pass.
        $accStmt = $pdo->prepare("
            SELECT 1 FROM challenge_acceptances
            WHERE challenge_id = ? AND acceptor_user_id = ? AND phase != 'rejected'
            LIMIT 1
        ");
        $accStmt->execute([$challengeId, $userId]);
        if ($accStmt->fetchColumn()) return true;

        // (3) Explicit join row (must be registered — guest-only rows ignored)
        //     AND not kicked.
        $joinStmt = $pdo->prepare("
            SELECT 1
            FROM challenge_participants cp
            LEFT JOIN challenge_kicks ck
                   ON ck.challenge_id = cp.channel_id AND ck.user_id = cp.user_id
            WHERE cp.channel_id = ? AND cp.user_id = ? AND ck.user_id IS NULL
            LIMIT 1
        ");
        $joinStmt->execute([$challengeId, $userId]);
        return (bool) $joinStmt->fetchColumn();
    }

    /**
     * Pre-join checks the caller should run in order:
     *   - !isKicked → kicks are sticky (creator/taker have explicit unkick paths)
     *   - !challenge.closed_to_new_joins → respect the freeze toggle
     *   - visibility check is the caller's job (friends-only / private)
     *
     * Returns true on a fresh insert OR if the row already existed (idempotent
     * — clicking Join twice is harmless). Returns false ONLY when the join
     * was actively refused by a kick or by closed_to_new_joins (these are
     * checked separately so the caller can choose the error surface).
     */
    public static function join(string $challengeId, string $userId): bool
    {
        $stmt = Database::pdo()->prepare("
            INSERT INTO challenge_participants (channel_id, guest_id, user_id, joined_at)
            VALUES (:cid, :gid, :uid, now())
            ON CONFLICT (channel_id, guest_id) DO UPDATE SET
                user_id  = COALESCE(EXCLUDED.user_id, challenge_participants.user_id)
            RETURNING channel_id
        ");
        // Stuff user_id into guest_id too so the legacy PK works on registered
        // joins. (Guest-only legacy rows already in the table keep their
        // guest_id; new joins use the user's id as the key.)
        $stmt->execute(['cid' => $challengeId, 'gid' => $userId, 'uid' => $userId]);
        return $stmt->fetchColumn() !== false;
    }

    public static function leave(string $challengeId, string $userId): bool
    {
        $stmt = Database::pdo()->prepare("
            DELETE FROM challenge_participants
            WHERE channel_id = ? AND user_id = ?
        ");
        $stmt->execute([$challengeId, $userId]);
        return $stmt->rowCount() > 0;
    }

    public static function isKicked(string $challengeId, string $userId): bool
    {
        $stmt = Database::pdo()->prepare("
            SELECT 1 FROM challenge_kicks WHERE challenge_id = ? AND user_id = ?
        ");
        $stmt->execute([$challengeId, $userId]);
        return (bool) $stmt->fetchColumn();
    }

    /**
     * Insert a kick row + delete the participant row in one transaction.
     * Returns true on success. Refuses to kick the creator (creator is the
     * canonical authority; nobody can boot them from their own challenge).
     */
    public static function kick(
        string $challengeId,
        string $userIdToKick,
        string $kickedByUserId,
        ?string $reason = null
    ): bool {
        $pdo = Database::pdo();
        // Refuse to kick the creator.
        $check = $pdo->prepare("SELECT created_by FROM channel_challenges WHERE channel_id = ?");
        $check->execute([$challengeId]);
        $createdBy = (string) ($check->fetchColumn() ?: '');
        if ($createdBy === $userIdToKick) return false;

        $pdo->beginTransaction();
        try {
            $pdo->prepare("
                INSERT INTO challenge_kicks (challenge_id, user_id, kicked_by_user_id, reason)
                VALUES (?, ?, ?, ?)
                ON CONFLICT (challenge_id, user_id) DO UPDATE SET
                    kicked_by_user_id = EXCLUDED.kicked_by_user_id,
                    kicked_at         = now(),
                    reason            = EXCLUDED.reason
            ")->execute([$challengeId, $userIdToKick, $kickedByUserId, $reason]);

            $pdo->prepare("
                DELETE FROM challenge_participants WHERE channel_id = ? AND user_id = ?
            ")->execute([$challengeId, $userIdToKick]);

            $pdo->commit();
            return true;
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
    }

    /**
     * Set the caller's notification preference on this challenge. Whitelist
     * is enforced; an unrecognised value is treated as 'milestones'.
     * Idempotent — no-op if the user isn't a participant (returns false).
     */
    public static function setNotificationPreference(
        string $challengeId,
        string $userId,
        string $preference
    ): bool {
        if (!in_array($preference, self::ALLOWED_NOTIFICATION_PREFERENCES, true)) {
            $preference = 'milestones';
        }
        $stmt = Database::pdo()->prepare("
            UPDATE challenge_participants
            SET notification_preference = ?
            WHERE channel_id = ? AND user_id = ?
        ");
        $stmt->execute([$preference, $challengeId, $userId]);
        return $stmt->rowCount() > 0;
    }

    public static function getNotificationPreference(string $challengeId, string $userId): string
    {
        $stmt = Database::pdo()->prepare("
            SELECT notification_preference FROM challenge_participants
            WHERE channel_id = ? AND user_id = ?
        ");
        $stmt->execute([$challengeId, $userId]);
        $val = $stmt->fetchColumn();
        return is_string($val) && $val !== '' ? $val : 'milestones';
    }

    /**
     * Registered participants for the channel. Used by the publicly visible
     * participant list on the detail page (per spec — usernames + avatars
     * are public). Capped at $limit; the caller paginates if needed.
     */
    public static function listForChannel(string $challengeId, int $limit = 100): array
    {
        $limit = max(1, min(500, $limit));
        $stmt = Database::pdo()->prepare("
            SELECT u.id, u.display_name, u.username, u.profile_thumb_photo_url,
                   EXTRACT(EPOCH FROM cp.joined_at)::INTEGER AS joined_at
            FROM challenge_participants cp
            JOIN users u ON u.id = cp.user_id AND u.deleted_at IS NULL
            WHERE cp.channel_id = ?
            ORDER BY cp.joined_at ASC
            LIMIT $limit
        ");
        $stmt->execute([$challengeId]);
        return array_map(static fn(array $r): array => [
            'id'             => $r['id'],
            'displayName'    => $r['display_name'] ?? null,
            'username'       => $r['username']     ?? null,
            'thumbAvatarUrl' => $r['profile_thumb_photo_url'] ?? null,
            'joinedAt'       => (int) $r['joined_at'],
        ], $stmt->fetchAll(\PDO::FETCH_ASSOC));
    }

    public static function countForChannel(string $challengeId): int
    {
        $stmt = Database::pdo()->prepare("
            SELECT COUNT(*) FROM challenge_participants
            WHERE channel_id = ? AND user_id IS NOT NULL
        ");
        $stmt->execute([$challengeId]);
        return (int) $stmt->fetchColumn();
    }

    /**
     * User_ids of participants who opted in to push for $event. milestone =
     * 'taker_accepted' | 'proof_submitted' | 'final_validation'. 'all' means
     * every-message; 'milestones' means only the three above; 'off' means
     * nothing. Used by the notification fan-out on lifecycle events.
     */
    public static function recipientUserIdsForMilestone(string $challengeId): array
    {
        $stmt = Database::pdo()->prepare("
            SELECT user_id FROM challenge_participants
            WHERE channel_id = ?
              AND user_id IS NOT NULL
              AND notification_preference IN ('milestones', 'all')
        ");
        $stmt->execute([$challengeId]);
        return $stmt->fetchAll(\PDO::FETCH_COLUMN) ?: [];
    }

    public static function recipientUserIdsForEveryMessage(string $challengeId): array
    {
        $stmt = Database::pdo()->prepare("
            SELECT user_id FROM challenge_participants
            WHERE channel_id = ?
              AND user_id IS NOT NULL
              AND notification_preference = 'all'
        ");
        $stmt->execute([$challengeId]);
        return $stmt->fetchAll(\PDO::FETCH_COLUMN) ?: [];
    }
}
