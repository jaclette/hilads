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

    // PR4 — derived `effective_phase` reflects when the debrief panel unlocks.
    // `scheduled` flips to `debrief` once the meetup's end time is past. Both
    // proposed_*_at and now() are TIMESTAMPTZ (stored UTC), so the comparison
    // is timezone-agnostic at the moment level — the city tz only matters for
    // *display* of when something happens. If the proposal had no ends_at, we
    // fall back to starts_at + 2h (the same default the UI uses).
    //
    // Previously derived from a JOINed channel_events row, but date approval
    // no longer creates an event — the proposed_starts_at/ends_at columns on
    // the acceptance row are the source of truth.
    private const EFFECTIVE_PHASE = "
        CASE
          WHEN ca.phase = 'scheduled'
               AND ca.proposed_starts_at IS NOT NULL
               AND COALESCE(ca.proposed_ends_at, ca.proposed_starts_at + interval '2 hours') < now()
            THEN 'debrief'
          ELSE ca.phase
        END
    ";

    private const SELECT = "
        SELECT
            ca.id,
            ca.challenge_id,
            ca.acceptor_user_id,
            ca.thread_channel_id,
            ca.debrief_event_id,
            ca.phase,
            (" . self::EFFECTIVE_PHASE . ")                     AS effective_phase,
            EXTRACT(EPOCH FROM ca.proposed_starts_at)::INTEGER  AS proposed_starts_at,
            EXTRACT(EPOCH FROM ca.proposed_ends_at)::INTEGER    AS proposed_ends_at,
            ca.proposed_venue,
            ca.proposed_by_user_id,
            EXTRACT(EPOCH FROM ca.proposed_at)::INTEGER         AS proposed_at,
            EXTRACT(EPOCH FROM ca.date_approved_at)::INTEGER    AS date_approved_at,
            EXTRACT(EPOCH FROM ca.approved_at)::INTEGER         AS approved_at,
            EXTRACT(EPOCH FROM ca.rejected_at)::INTEGER         AS rejected_at,
            EXTRACT(EPOCH FROM ca.created_at)::INTEGER          AS created_at,
            EXTRACT(EPOCH FROM ca.updated_at)::INTEGER          AS updated_at
        FROM challenge_acceptances ca
    ";

    private static function format(array $row): array
    {
        return [
            'id'                  => $row['id'],
            'challenge_id'        => $row['challenge_id'],
            'acceptor_user_id'    => $row['acceptor_user_id'],
            'thread_channel_id'   => $row['thread_channel_id'],
            'debrief_event_id'    => $row['debrief_event_id'] ?? null,
            'phase'               => $row['phase'],
            // PR4 — derived. Same as `phase` except 'scheduled' flips to
            // 'debrief' once the meetup's end time is past. Clients render
            // off effective_phase; the raw `phase` is kept for debugging
            // + future "did this ever flip" audits.
            'effective_phase'     => $row['effective_phase'] ?? $row['phase'],
            // PR3 — date concertation
            'proposed_starts_at'  => isset($row['proposed_starts_at']) ? (int) $row['proposed_starts_at'] : null,
            'proposed_ends_at'    => isset($row['proposed_ends_at'])   ? (int) $row['proposed_ends_at']   : null,
            'proposed_venue'      => $row['proposed_venue'] ?? null,
            'proposed_by_user_id' => $row['proposed_by_user_id'] ?? null,
            'proposed_at'         => isset($row['proposed_at'])        ? (int) $row['proposed_at']        : null,
            'date_approved_at'    => isset($row['date_approved_at'])   ? (int) $row['date_approved_at']   : null,
            'approved_at'         => isset($row['approved_at']) ? (int) $row['approved_at'] : null,
            'rejected_at'         => isset($row['rejected_at']) ? (int) $row['rejected_at'] : null,
            'created_at'          => (int) $row['created_at'],
            'updated_at'          => (int) $row['updated_at'],
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
                (" . self::EFFECTIVE_PHASE . ")                      AS effective_phase,
                EXTRACT(EPOCH FROM ca.proposed_starts_at)::INTEGER   AS proposed_starts_at,
                EXTRACT(EPOCH FROM ca.proposed_ends_at)::INTEGER     AS proposed_ends_at,
                ca.proposed_venue,
                ca.proposed_by_user_id,
                EXTRACT(EPOCH FROM ca.proposed_at)::INTEGER          AS proposed_at,
                EXTRACT(EPOCH FROM ca.date_approved_at)::INTEGER     AS date_approved_at,
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
            GROUP BY ca.id,
                     cc.title, cc.challenge_type, cc.audience, cc.created_by,
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
                'debrief_event_id'     => $r['debrief_event_id'] ?? null,
                'phase'                => $r['phase'],
                'effective_phase'      => $r['effective_phase'] ?? $r['phase'],
                // PR3 proposal state (so the threads list can show "📅 awaiting", etc.)
                'proposed_starts_at'   => isset($r['proposed_starts_at']) ? (int) $r['proposed_starts_at'] : null,
                'proposed_ends_at'     => isset($r['proposed_ends_at'])   ? (int) $r['proposed_ends_at']   : null,
                'proposed_venue'       => $r['proposed_venue'] ?? null,
                'proposed_by_user_id'  => $r['proposed_by_user_id'] ?? null,
                'proposed_at'          => isset($r['proposed_at'])        ? (int) $r['proposed_at']        : null,
                'date_approved_at'     => isset($r['date_approved_at'])   ? (int) $r['date_approved_at']   : null,
                'approved_at'          => isset($r['approved_at'])        ? (int) $r['approved_at']        : null,
                'rejected_at'          => isset($r['rejected_at'])        ? (int) $r['rejected_at']        : null,
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

    // ── PR3: date concertation ────────────────────────────────────────────────

    /**
     * Either party proposes a date (counter-proposals overwrite). Caller has
     * already validated phase='accepted' and `proposerUserId` is a thread member.
     *
     * `endsAt` is nullable — if not given, the client default (start + 2h) is
     * applied client-side before this call. Server doesn't impose one so the
     * column stays NULL if neither side ever set it.
     */
    public static function proposeDate(
        string $acceptanceId,
        string $proposerUserId,
        int    $startsAtUnix,
        ?int   $endsAtUnix,
        ?string $venue
    ): ?array {
        $venue = $venue !== null ? mb_substr(trim($venue), 0, 200) : null;
        if ($venue === '') $venue = null;

        Database::pdo()->prepare("
            UPDATE challenge_acceptances
            SET proposed_starts_at  = to_timestamp(:starts),
                proposed_ends_at    = CASE WHEN :ends_set THEN to_timestamp(:ends) ELSE NULL END,
                proposed_venue      = :venue,
                proposed_by_user_id = :uid,
                proposed_at         = now(),
                updated_at          = now()
            WHERE id = :id AND phase = 'accepted'
        ")->execute([
            'id'       => $acceptanceId,
            'starts'   => $startsAtUnix,
            'ends_set' => $endsAtUnix !== null ? 1 : 0,
            'ends'     => $endsAtUnix ?? 0,
            'venue'    => $venue,
            'uid'      => $proposerUserId,
        ]);
        return self::findById($acceptanceId);
    }

    /** Clear the current proposal (proposer only — caller enforces). */
    public static function withdrawProposal(string $acceptanceId): ?array
    {
        Database::pdo()->prepare("
            UPDATE challenge_acceptances
            SET proposed_starts_at  = NULL,
                proposed_ends_at    = NULL,
                proposed_venue      = NULL,
                proposed_by_user_id = NULL,
                proposed_at         = NULL,
                updated_at          = now()
            WHERE id = :id AND phase = 'accepted'
        ")->execute(['id' => $acceptanceId]);
        return self::findById($acceptanceId);
    }

    /**
     * Creator approves the current proposal. Flips phase to 'scheduled' and
     * stamps date_approved_at. The thread chat IS the meet-up surface — no
     * standalone event row is created (the previous design did, but the auto-
     * "🎉 New event" system message was misleading in the thread + showed up
     * elsewhere; the lifecycle now derives effective_phase=debrief directly
     * from proposed_starts_at/ends_at on this row).
     *
     * Caller MUST enforce: caller is the creator, phase='accepted', proposal
     * fields are populated. Returns the updated acceptance, or null if the row
     * can't be found / has already moved on.
     */
    public static function approveDate(string $acceptanceId, string $challengeTitle): ?array
    {
        $row = self::findById($acceptanceId);
        if (!$row || $row['phase'] !== 'accepted' || $row['proposed_starts_at'] === null) {
            return null;
        }

        Database::pdo()->prepare("
            UPDATE challenge_acceptances
            SET phase            = 'scheduled',
                date_approved_at = now(),
                updated_at       = now()
            WHERE id = :id AND phase = 'accepted'
        ")->execute(['id' => $acceptanceId]);

        return ['acceptance' => self::findById($acceptanceId)];
    }

    // ── PR4: debrief approve / reject ────────────────────────────────────────

    /**
     * Creator approves the take-on after the meetup happened. Sets phase=
     * 'approved' + approved_at. Caller MUST enforce: caller is the creator,
     * effective_phase='debrief' (meetup has ended).
     */
    public static function approve(string $acceptanceId): ?array
    {
        Database::pdo()->prepare("
            UPDATE challenge_acceptances
            SET phase       = 'approved',
                approved_at = now(),
                updated_at  = now()
            WHERE id = :id AND phase = 'scheduled'
        ")->execute(['id' => $acceptanceId]);
        return self::findById($acceptanceId);
    }

    /**
     * Creator rejects the take-on (no-show, didn't actually meet, etc.). Sets
     * phase='rejected' + rejected_at. Same gate as approve(). Note this is
     * the FINAL verdict on this acceptance — there's no path back.
     */
    public static function reject(string $acceptanceId): ?array
    {
        Database::pdo()->prepare("
            UPDATE challenge_acceptances
            SET phase       = 'rejected',
                rejected_at = now(),
                updated_at  = now()
            WHERE id = :id AND phase = 'scheduled'
        ")->execute(['id' => $acceptanceId]);
        return self::findById($acceptanceId);
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
