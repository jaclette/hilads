<?php

declare(strict_types=1);

/**
 * Challenge acceptances — one row per (challenge, acceptor) relationship.
 *
 * A challenge ad lives in channel_challenges; each take-on creates:
 *   - a row here (the acceptance)
 *   - a channels row of type='challenge_thread' (the 1:1 chat between
 *     creator + acceptor, parent_id=challenge.id)
 *
 * Phases (PR2 only writes 'accepted'; PR3 introduces 'scheduled', PR4 the rest):
 *   accepted   → just opened
 *   scheduled  → creator approved a date, debrief_event_id set
 *   debrief    → derived (event.ends_at past in city tz) — not stored
 *   approved   → creator marked the challenge accomplished post-debrief
 *   rejected   → creator marked it not done
 *
 * Cap enforcement: the caller checks countByChallenge() < max_participants
 * BEFORE create(). Race against the cap is bounded by Postgres' UNIQUE on
 * (challenge_id, acceptor_user_id) — a duplicate accept always fails — but
 * two distinct users hitting the +1th slot simultaneously could over-fill
 * by one. Acceptable for the current scale; revisit with FOR UPDATE if it
 * becomes a real issue.
 */
class ChallengeAcceptanceRepository
{
    public const ALLOWED_PHASES = ['accepted', 'scheduled', 'debrief', 'approved', 'rejected'];

    private const SELECT = "
        SELECT
            ca.id,
            ca.challenge_id,
            ca.acceptor_user_id,
            ca.thread_channel_id,
            ca.debrief_event_id,
            ca.phase,
            EXTRACT(EPOCH FROM ca.approved_at)::INTEGER  AS approved_at,
            EXTRACT(EPOCH FROM ca.rejected_at)::INTEGER  AS rejected_at,
            EXTRACT(EPOCH FROM ca.created_at)::INTEGER   AS created_at,
            EXTRACT(EPOCH FROM ca.updated_at)::INTEGER   AS updated_at
        FROM challenge_acceptances ca
    ";

    private static function format(array $row): array
    {
        return [
            'id'                => $row['id'],
            'challenge_id'      => $row['challenge_id'],
            'acceptor_user_id'  => $row['acceptor_user_id'],
            'thread_channel_id' => $row['thread_channel_id'],
            'debrief_event_id'  => $row['debrief_event_id'] ?? null,
            'phase'             => $row['phase'],
            'approved_at'       => isset($row['approved_at']) ? (int) $row['approved_at'] : null,
            'rejected_at'       => isset($row['rejected_at']) ? (int) $row['rejected_at'] : null,
            'created_at'        => (int) $row['created_at'],
            'updated_at'        => (int) $row['updated_at'],
        ];
    }

    // ── Reads ────────────────────────────────────────────────────────────────

    public static function findById(string $id): ?array
    {
        $stmt = Database::pdo()->prepare(self::SELECT . " WHERE ca.id = :id");
        $stmt->execute(['id' => $id]);
        $row = $stmt->fetch();
        return $row ? self::format($row) : null;
    }

    public static function findByThreadChannelId(string $threadChannelId): ?array
    {
        $stmt = Database::pdo()->prepare(self::SELECT . " WHERE ca.thread_channel_id = :id");
        $stmt->execute(['id' => $threadChannelId]);
        $row = $stmt->fetch();
        return $row ? self::format($row) : null;
    }

    /** All acceptances for a challenge — creator's "who took it on" view. */
    public static function getByChallenge(string $challengeId): array
    {
        $stmt = Database::pdo()->prepare(self::SELECT . "
            WHERE ca.challenge_id = :id
            ORDER BY ca.created_at ASC
        ");
        $stmt->execute(['id' => $challengeId]);
        return array_map(static fn($r) => self::format($r), $stmt->fetchAll());
    }

    /**
     * Count of NON-rejected acceptances. Used by the cap check before create().
     * Rejected acceptances don't count against the cap (the slot reopens).
     */
    public static function countByChallenge(string $challengeId): int
    {
        $stmt = Database::pdo()->prepare("
            SELECT COUNT(*) FROM challenge_acceptances
            WHERE challenge_id = :id AND phase != 'rejected'
        ");
        $stmt->execute(['id' => $challengeId]);
        return (int) $stmt->fetchColumn();
    }

    /**
     * Thread-channel access gate. True iff the given user is one of the two
     * parties of this thread (the acceptor OR the challenge creator).
     * Used by the thread message read/write routes.
     */
    public static function isThreadMember(string $threadChannelId, string $userId): bool
    {
        $stmt = Database::pdo()->prepare("
            SELECT 1 FROM challenge_acceptances ca
            JOIN channel_challenges cc ON cc.channel_id = ca.challenge_id
            WHERE ca.thread_channel_id = :tid
              AND (ca.acceptor_user_id = :uid OR cc.created_by = :uid)
            LIMIT 1
        ");
        $stmt->execute(['tid' => $threadChannelId, 'uid' => $userId]);
        return (bool) $stmt->fetchColumn();
    }

    /** Idempotency probe — has this user already accepted this challenge? */
    public static function findExisting(string $challengeId, string $acceptorUserId): ?array
    {
        $stmt = Database::pdo()->prepare(self::SELECT . "
            WHERE ca.challenge_id = :cid AND ca.acceptor_user_id = :uid
        ");
        $stmt->execute(['cid' => $challengeId, 'uid' => $acceptorUserId]);
        $row = $stmt->fetch();
        return $row ? self::format($row) : null;
    }

    /**
     * "My threads" — every acceptance where the user is acceptor OR creator,
     * enriched with the challenge title, counter-party display info, and last
     * message preview. Single query — important for low Supabase egress.
     *
     * Ordered by last message timestamp (or acceptance creation if no messages
     * yet), most-recent first. Capped at 100 — bounded read.
     */
    public static function getMineWithMeta(string $userId): array
    {
        $stmt = Database::pdo()->prepare("
            SELECT
                ca.id                                                AS acceptance_id,
                ca.challenge_id,
                ca.acceptor_user_id,
                ca.thread_channel_id,
                ca.debrief_event_id,
                ca.phase,
                EXTRACT(EPOCH FROM ca.approved_at)::INTEGER          AS approved_at,
                EXTRACT(EPOCH FROM ca.rejected_at)::INTEGER          AS rejected_at,
                EXTRACT(EPOCH FROM ca.created_at)::INTEGER           AS created_at,
                cc.title                                             AS challenge_title,
                cc.challenge_type,
                cc.audience,
                cc.created_by                                        AS creator_user_id,
                creator.display_name                                 AS creator_display_name,
                creator.profile_thumb_photo_url                      AS creator_thumb,
                acceptor.display_name                                AS acceptor_display_name,
                acceptor.profile_thumb_photo_url                     AS acceptor_thumb,
                EXTRACT(EPOCH FROM MAX(m.created_at))::INTEGER       AS last_message_at,
                (SELECT m2.content FROM messages m2
                   WHERE m2.channel_id = ca.thread_channel_id
                     AND m2.type IN ('text','image')
                   ORDER BY m2.created_at DESC LIMIT 1)              AS last_message_content
            FROM challenge_acceptances ca
            JOIN channel_challenges cc ON cc.channel_id = ca.challenge_id
            JOIN users creator         ON creator.id    = cc.created_by
            JOIN users acceptor        ON acceptor.id   = ca.acceptor_user_id
            LEFT JOIN messages m       ON m.channel_id  = ca.thread_channel_id
                                       AND m.type IN ('text','image')
            WHERE ca.acceptor_user_id = :uid OR cc.created_by = :uid
            GROUP BY ca.id, cc.title, cc.challenge_type, cc.audience, cc.created_by,
                     creator.display_name, creator.profile_thumb_photo_url,
                     acceptor.display_name, acceptor.profile_thumb_photo_url
            ORDER BY COALESCE(MAX(m.created_at), ca.created_at) DESC
            LIMIT 100
        ");
        $stmt->execute(['uid' => $userId]);

        $out = [];
        foreach ($stmt->fetchAll() as $r) {
            $isCreator    = $r['creator_user_id'] === $userId;
            $counterparty = $isCreator
                ? ['id' => $r['acceptor_user_id'], 'displayName' => $r['acceptor_display_name'], 'thumbAvatarUrl' => $r['acceptor_thumb']]
                : ['id' => $r['creator_user_id'],  'displayName' => $r['creator_display_name'],  'thumbAvatarUrl' => $r['creator_thumb']];
            $out[] = [
                'id'                   => $r['acceptance_id'],
                'challenge_id'         => $r['challenge_id'],
                'challenge_title'      => $r['challenge_title'],
                'challenge_type'       => $r['challenge_type'],
                'thread_channel_id'    => $r['thread_channel_id'],
                'phase'                => $r['phase'],
                'created_at'           => (int) $r['created_at'],
                'last_message_at'      => isset($r['last_message_at']) ? (int) $r['last_message_at'] : null,
                'last_message_content' => $r['last_message_content'],
                'i_am_creator'         => $isCreator,
                'counterparty'         => $counterparty,
            ];
        }
        return $out;
    }

    // ── Writes ───────────────────────────────────────────────────────────────

    /**
     * Atomically create the thread channel + acceptance row.
     *
     * Caller is responsible for ALL gates (mode/audience, cap, not-creator,
     * idempotency). This is the raw write. Returns the freshly-built acceptance.
     */
    public static function create(string $challengeId, string $acceptorUserId): array
    {
        $pdo = Database::pdo();
        $pdo->beginTransaction();
        try {
            $threadId = bin2hex(random_bytes(8));
            $accId    = bin2hex(random_bytes(8));

            // Thread channel — type 'challenge_thread' is new in PR2. parent_id
            // points at the challenge (NOT the city) so deleting the challenge
            // cascades the thread + its messages. The 'thread' name is a
            // placeholder; client renders "<challenge title> · <counter-party>".
            $pdo->prepare("
                INSERT INTO channels (id, type, parent_id, name, status, created_at, updated_at)
                VALUES (:id, 'challenge_thread', :parent_id, 'thread', 'active', now(), now())
            ")->execute(['id' => $threadId, 'parent_id' => $challengeId]);

            $pdo->prepare("
                INSERT INTO challenge_acceptances
                    (id, challenge_id, acceptor_user_id, thread_channel_id, phase, created_at, updated_at)
                VALUES
                    (:id, :cid, :uid, :tcid, 'accepted', now(), now())
            ")->execute([
                'id'   => $accId,
                'cid'  => $challengeId,
                'uid'  => $acceptorUserId,
                'tcid' => $threadId,
            ]);

            $pdo->commit();
            return self::findById($accId);
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
    }

    /**
     * Cancel — hard-deletes the thread channel; the acceptance row goes via
     * FK CASCADE on thread_channel_id. Chat history is gone forever (clean
     * rollback; if you want to re-accept later, you get a fresh thread).
     *
     * Caller MUST enforce: only acceptor or creator, only in phase 'accepted'.
     * PR3+ phases (scheduled, debrief, approved, rejected) lock cancel.
     *
     * Returns true on success, false if the acceptance didn't exist.
     */
    public static function cancel(string $acceptanceId): bool
    {
        $row = self::findById($acceptanceId);
        if (!$row) return false;
        Database::pdo()->prepare("DELETE FROM channels WHERE id = :id")
            ->execute(['id' => $row['thread_channel_id']]);
        return true;
    }
}
