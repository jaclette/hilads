<?php

declare(strict_types=1);

/**
 * Challenge (Défi) — third primary entity alongside events + hangouts.
 *
 * Mirrors TopicRepository / EventRepository structure but with a status
 * lifecycle:
 *   - 'open'      → active feed (NOW screen, top 5 by recency)
 *   - 'validated' → archive (CTA "See past challenges"); chat still accessible
 *   - hard-delete → channels.status = 'deleted' (same as events/hangouts)
 *
 * Persistence model: no TTL. expires_at defaults to a 2999 sentinel so any
 * shared `expires_at > now()` guards keep working without conditional logic.
 *
 * Participation: mirrors event_participants (guest_id + optional user_id).
 * Guests CAN accept challenges — same anonymous-allowed UX as events.
 */
class ChallengeRepository
{
    public const ALLOWED_TYPES     = ['food', 'place', 'culture', 'help'];
    public const ALLOWED_AUDIENCES = ['locals', 'explorers'];
    public const ALLOWED_STATUSES  = ['open', 'validated'];

    // (Legacy) MAX_PARTICIPANTS_* constants removed when the model pivoted
    // to 1:1 persistent. The column remains in channel_challenges for one
    // release as a back-compat lever; nothing reads it now.

    // ── Shared SELECT (challenge + message stats) ─────────────────────────────

    // is_in_progress: true iff the challenge has an active acceptance
    // (1:1 model — the slot is busy). The "active" rule is shared with
    // ChallengeAcceptanceRepository::hasActiveAcceptance() via the
    // IS_ACTIVE_SQL constant — both call sites stay aligned, so the UI flag
    // and the /accept gate never disagree on what counts as in-progress.
    // EXISTS sub-select runs once per row; bounded by the LIMIT on the
    // parent query (egress-safe).
    private const SELECT = "
        SELECT
            c.id,
            cc.city_id,
            cc.created_by,
            cc.guest_id,
            cc.title,
            cc.challenge_type,
            cc.audience,
            cc.status,
            cc.max_participants,
            cc.return_clause,
            -- International-mode columns (PR1 schema). 'local' for all
            -- pre-International rows by DEFAULT; target_city_id null for
            -- local rows (and for 'anywhere' international); proof_requirements
            -- only set on international.
            cc.mode,
            cc.target_city_id,
            cc.proof_requirements,
            -- Creator's display info — surfaced on cards + detail header so
            -- the user sees who owns a challenge. LEFT JOIN: pure-guest
            -- challenges (created_by IS NULL) fall back to cc.guest_id /
            -- nickname captured at create-time; we keep the JOIN on user_id
            -- only because guest_id can collide across accounts on the same
            -- device (see isOwner notes elsewhere).
            u.display_name             AS creator_display_name,
            u.username                 AS creator_username,
            u.profile_thumb_photo_url  AS creator_thumb_avatar_url,
            COUNT(m.id)                                            AS message_count,
            EXTRACT(EPOCH FROM MAX(m.created_at))::INTEGER         AS last_activity_at,
            EXTRACT(EPOCH FROM cc.validated_at)::INTEGER           AS validated_at,
            EXTRACT(EPOCH FROM cc.created_at)::INTEGER             AS created_at,
            EXISTS (
                SELECT 1 FROM challenge_acceptances ca
                -- Correlate on c.id (in every GROUP BY clause below) rather
                -- than cc.channel_id — Postgres rejects ungrouped, non-
                -- aggregated outer references with GROUP BY queries. The two
                -- columns are equal via the JOIN; ca.challenge_id's FK
                -- references channels(id) so either works semantically.
                WHERE ca.challenge_id = c.id
                  AND " . \ChallengeAcceptanceRepository::IS_ACTIVE_SQL . "
            )                                                       AS is_in_progress
        FROM channels c
        JOIN channel_challenges cc ON cc.channel_id = c.id
        LEFT JOIN users u           ON u.id = cc.created_by
        LEFT JOIN messages m        ON m.channel_id = c.id AND m.type IN ('text', 'image')
    ";

    private static function format(array $row): array
    {
        return [
            'id'                   => $row['id'],
            'city_id'              => $row['city_id'],
            'created_by'           => $row['created_by'],
            'guest_id'             => $row['guest_id'],
            'title'                => $row['title'],
            'challenge_type'       => $row['challenge_type'],
            'audience'             => $row['audience'],
            'status'               => $row['status'],
            // Legacy field — kept in the response shape for one release so old
            // mobile/web builds don't blow up reading it. Always returns the
            // stored DB value (or 3 as the historical default).
            'max_participants'     => (int) ($row['max_participants'] ?? 3),
            'return_clause'        => $row['return_clause'] ?? null,
            'message_count'        => (int) ($row['message_count'] ?? 0),
            'last_activity_at'     => isset($row['last_activity_at']) ? (int) $row['last_activity_at'] : null,
            'validated_at'         => isset($row['validated_at'])     ? (int) $row['validated_at']     : null,
            'created_at'           => (int) $row['created_at'],
            // 1:1 model state — true iff this challenge currently has a
            // non-terminal acceptance. UI uses this to render Available /
            // In progress / Validated and to gate the Accept button.
            // Defaults to false on rows that pre-date the column (eg. cached
            // formats) — safe because the route still rechecks at /accept.
            'is_in_progress'       => isset($row['is_in_progress']) ? (bool) $row['is_in_progress'] : false,
            // International mode shape. 'local' is the default for every row
            // that pre-dates the migration. target_city_id is null for local
            // and for "anywhere" international rows; proof_requirements only
            // populated on international.
            'mode'                 => $row['mode']               ?? 'local',
            'target_city_id'       => $row['target_city_id']     ?? null,
            'proof_requirements'   => $row['proof_requirements'] ?? null,
            // Creator display — null for pure-guest challenges (created_by IS NULL).
            // Cards + the detail header render "by {creator_display_name}".
            'creator_display_name'     => $row['creator_display_name']     ?? null,
            'creator_username'         => $row['creator_username']         ?? null,
            'creator_thumb_avatar_url' => $row['creator_thumb_avatar_url'] ?? null,
            // Populated by batched queries; default so the field is always present.
            'participants_preview' => [],
            'participant_count'    => 0,
        ];
    }

    // ── Reads ─────────────────────────────────────────────────────────────────

    /**
     * Active (open) challenge count per city — for the city list summary.
     * Returns an array keyed by integer city channel ID (e.g. 3), value = count.
     *
     * Counts both:
     *   - rows whose city_id is this city (origin), and
     *   - international rows whose target_city_id is this city (mirrored),
     * unioned into a single per-city tally so the city list reflects what the
     * user would actually see in the feed when they tap in.
     */
    public static function getCountsPerCity(): array
    {
        $stmt = Database::pdo()->prepare("
            WITH all_active AS (
                SELECT cc.city_id        AS surface_city_id FROM channel_challenges cc
                JOIN channels c ON c.id = cc.channel_id
                WHERE c.status = 'active' AND cc.status = 'open'
                UNION ALL
                SELECT cc.target_city_id AS surface_city_id FROM channel_challenges cc
                JOIN channels c ON c.id = cc.channel_id
                WHERE c.status = 'active' AND cc.status = 'open'
                  AND cc.target_city_id IS NOT NULL
                  AND cc.target_city_id <> cc.city_id
            )
            SELECT surface_city_id AS city_id, COUNT(*) AS challenge_count
            FROM all_active
            WHERE surface_city_id IS NOT NULL
            GROUP BY surface_city_id
        ");
        $stmt->execute();
        $result = [];
        foreach ($stmt->fetchAll() as $row) {
            // city_id is stored as 'city_3' — extract the numeric ID to match EventRepository.
            $numericId           = (int) str_replace('city_', '', $row['city_id']);
            $result[$numericId]  = (int) $row['challenge_count'];
        }
        return $result;
    }

    /**
     * Active (open) challenges for a city, sorted by created_at DESC.
     * $cityId is the channel ID string, e.g. 'city_3'.
     * $limit is capped at 200 — feed is meant for "top 5" display anyway, but
     * the See-All screen can request more.
     */
    public static function getByCity(string $cityId, int $limit = 50): array
    {
        $limit = max(1, min(200, $limit));
        $pdo   = Database::pdo();

        // 24h grace window: validated challenges stay in the active feed for 1 day
        // after validated_at, so the city sees "Défi relevé" status before it
        // drops into the past archive. After 24h, getValidatedByCity() picks it up.
        //
        // (cc.city_id = :cid OR cc.target_city_id = :cid) — International
        // challenges targeting this city mirror into its feed (per spec). The
        // partial index `idx_channel_challenges_target_city` covers the
        // target-side scan; "anywhere" intl rows (target_city_id IS NULL)
        // stay origin-only because NULL doesn't satisfy either clause for
        // any city other than the creator's.
        $stmt = $pdo->prepare(self::SELECT . "
            WHERE (cc.city_id = :city_id OR cc.target_city_id = :city_id)
              AND c.status   = 'active'
              AND (
                cc.status = 'open'
                OR (cc.status = 'validated' AND cc.validated_at > now() - interval '1 day')
              )
            GROUP BY c.id, cc.city_id, cc.created_by, cc.guest_id,
                     cc.title, cc.challenge_type, cc.audience, cc.status,
                     cc.max_participants, cc.return_clause,
                     cc.mode, cc.target_city_id, cc.proof_requirements,
                     cc.validated_at, cc.created_at,
                     u.display_name, u.username, u.profile_thumb_photo_url
            ORDER BY cc.created_at DESC
            LIMIT $limit
        ");
        $stmt->execute(['city_id' => $cityId]);
        $rows = $stmt->fetchAll();
        if (empty($rows)) return [];

        $out = array_map(static fn(array $r): array => self::format($r), $rows);
        return self::enrichWithParticipants($out);
    }

    /**
     * Validated (archived) challenges for a city — feeds the "See past
     * challenges" CTA. Most-recently-validated first.
     */
    public static function getValidatedByCity(string $cityId, int $limit = 30, ?int $beforeTs = null): array
    {
        $limit  = max(1, min(100, $limit));
        $params = ['city_id' => $cityId];
        // Past archive — only challenges that are past the 24h grace window
        // (otherwise they're still showing in the active feed via getByCity()).
        // Same mirroring rule as getByCity — past archive of a city includes
        // international challenges that targeted it.
        $where  = "(cc.city_id = :city_id OR cc.target_city_id = :city_id) AND c.status = 'active' AND cc.status = 'validated' AND cc.validated_at <= now() - interval '1 day'";
        if ($beforeTs !== null) {
            $where             .= " AND cc.validated_at < to_timestamp(:before)";
            $params['before']   = $beforeTs;
        }

        $stmt = Database::pdo()->prepare(self::SELECT . "
            WHERE $where
            GROUP BY c.id, cc.city_id, cc.created_by, cc.guest_id,
                     cc.title, cc.challenge_type, cc.audience, cc.status,
                     cc.max_participants, cc.return_clause,
                     cc.mode, cc.target_city_id, cc.proof_requirements,
                     cc.validated_at, cc.created_at,
                     u.display_name, u.username, u.profile_thumb_photo_url
            ORDER BY cc.validated_at DESC NULLS LAST, cc.created_at DESC
            LIMIT $limit
        ");
        $stmt->execute($params);
        $rows = $stmt->fetchAll();
        if (empty($rows)) return [];

        return self::enrichWithParticipants(array_map(static fn(array $r): array => self::format($r), $rows));
    }

    public static function findById(string $challengeId): ?array
    {
        $stmt = Database::pdo()->prepare(self::SELECT . "
            WHERE c.id     = :id
              AND c.status = 'active'
            GROUP BY c.id, cc.city_id, cc.created_by, cc.guest_id,
                     cc.title, cc.challenge_type, cc.audience, cc.status,
                     cc.max_participants, cc.return_clause,
                     cc.mode, cc.target_city_id, cc.proof_requirements,
                     cc.validated_at, cc.created_at,
                     u.display_name, u.username, u.profile_thumb_photo_url
        ");
        $stmt->execute(['id' => $challengeId]);
        $row = $stmt->fetch();
        if (!$row) return null;

        $item                       = self::format($row);
        $item['participant_count']  = self::participantCount($challengeId);
        $item['participants_preview'] = self::participantPreview($challengeId, 5);
        return $item;
    }

    /**
     * Challenges a user created OR accepted — for the profile "Challenges" tab.
     * Includes is_owner flag. Most-recent first.
     *
     * Acceptance is sourced from BOTH:
     *   - challenge_participants (legacy pooled-acceptance model) — kept for
     *     back-compat with any pre-1:1 rows still in the table.
     *   - challenge_acceptances (the 1:1 take-on model used since PR2) —
     *     covers everyone who took on a challenge via the new flow.
     * Without the second EXISTS, the profile would silently omit every
     * challenge taken on after the model switch.
     */
    public static function getByUser(string $userId): array
    {
        $pdo  = Database::pdo();
        $stmt = $pdo->prepare("
            SELECT c.id, cc.city_id, cc.created_by, cc.guest_id, cc.title,
                   cc.challenge_type, cc.audience, cc.status,
                   cc.max_participants, cc.return_clause,
                   cc.mode, cc.target_city_id, cc.proof_requirements,
                   EXTRACT(EPOCH FROM cc.validated_at)::INTEGER AS validated_at,
                   EXTRACT(EPOCH FROM cc.created_at)::INTEGER   AS created_at
            FROM channels c
            JOIN channel_challenges cc ON cc.channel_id = c.id
            WHERE c.status = 'active'
              AND (cc.created_by = :owner_id
                   OR EXISTS (SELECT 1 FROM challenge_participants cp
                              WHERE cp.channel_id = c.id AND cp.user_id = :part_id)
                   OR EXISTS (SELECT 1 FROM challenge_acceptances ca
                              WHERE ca.challenge_id = c.id AND ca.acceptor_user_id = :acc_id))
            ORDER BY cc.created_at DESC
            LIMIT 50
        ");
        $stmt->execute(['owner_id' => $userId, 'part_id' => $userId, 'acc_id' => $userId]);
        $challenges = $stmt->fetchAll();
        if (empty($challenges)) return [];

        // Batch message stats.
        $ids = array_column($challenges, 'id');
        $in  = implode(',', array_fill(0, count($ids), '?'));
        $s2  = $pdo->prepare("
            SELECT channel_id, COUNT(*) AS message_count,
                   EXTRACT(EPOCH FROM MAX(created_at))::INTEGER AS last_activity_at
            FROM messages WHERE channel_id IN ($in) AND type IN ('text','image') GROUP BY channel_id
        ");
        $s2->execute($ids);
        $statsMap = [];
        foreach ($s2->fetchAll() as $r) $statsMap[$r['channel_id']] = $r;

        $out = [];
        foreach ($challenges as $ch) {
            $stats         = $statsMap[$ch['id']] ?? null;
            $item          = self::format([
                'id'                 => $ch['id'],
                'city_id'            => $ch['city_id'],
                'created_by'         => $ch['created_by'],
                'guest_id'           => $ch['guest_id'],
                'title'              => $ch['title'],
                'challenge_type'     => $ch['challenge_type'],
                'audience'           => $ch['audience'],
                'status'             => $ch['status'],
                'max_participants'   => $ch['max_participants'],
                'return_clause'      => $ch['return_clause'],
                'mode'               => $ch['mode']               ?? 'local',
                'target_city_id'     => $ch['target_city_id']     ?? null,
                'proof_requirements' => $ch['proof_requirements'] ?? null,
                'message_count'      => $stats['message_count']    ?? 0,
                'last_activity_at'   => $stats['last_activity_at'] ?? null,
                'validated_at'       => $ch['validated_at'],
                'created_at'         => $ch['created_at'],
            ]);
            $item['is_owner'] = ($ch['created_by'] === $userId);
            $out[]            = $item;
        }
        return self::enrichWithParticipants($out);
    }

    // ── Writes ────────────────────────────────────────────────────────────────

    /**
     * Create a new challenge channel + metadata row.
     * Auto-joins the creator as the first participant (mirror events).
     * Returns the freshly-built challenge via findById (consistent shape).
     */
    public const ALLOWED_MODES = ['local', 'international'];

    public static function create(
        string $cityId,
        string $guestId,
        ?string $userId,
        ?string $nickname,
        string $title,
        string $challengeType,
        string $audience,
        ?string $returnClause = null,
        string $mode = 'local',
        ?string $targetCityId = null,
        ?string $proofRequirements = null
    ): array {
        if (!in_array($challengeType, self::ALLOWED_TYPES,     true)) $challengeType = 'food';
        if (!in_array($audience,      self::ALLOWED_AUDIENCES, true)) $audience      = 'locals';
        if (!in_array($mode,          self::ALLOWED_MODES,     true)) $mode          = 'local';

        // Normalize return_clause: trim, treat empty string as null. Client is
        // expected to send the per-type template pre-filled; nulls fall back to
        // a generic clause at the display layer.
        $returnClause = $returnClause !== null ? trim($returnClause) : null;
        if ($returnClause === '') $returnClause = null;

        // International-mode hygiene:
        //   - target_city_id only meaningful when mode='international'; force
        //     null for local so a misbehaving client can't smuggle a target.
        //   - proof_requirements same logic — local stores nothing.
        //   - audience is irrelevant for international (no in-person meetup);
        //     keep the column populated (NOT NULL) but force a stable value
        //     so int'l rows don't accidentally surface in audience-filtered
        //     queries written for local.
        if ($mode !== 'international') {
            $targetCityId      = null;
            $proofRequirements = null;
        } else {
            $proofRequirements = $proofRequirements !== null ? trim($proofRequirements) : null;
            if ($proofRequirements === '') $proofRequirements = null;
        }

        $pdo = Database::pdo();
        $id  = bin2hex(random_bytes(8));

        $pdo->prepare("
            INSERT INTO channels (id, type, parent_id, name, status, created_at, updated_at)
            VALUES (:id, 'challenge', :parent_id, :name, 'active', now(), now())
        ")->execute([
            'id'        => $id,
            'parent_id' => $cityId,
            'name'      => $title,
        ]);

        // expires_at uses the table default (2999 sentinel) — challenges are persistent.
        // max_participants column kept for back-compat (one-release reversible
        // path) but no longer written — the DB default fills it. The new model
        // is 1:1: one challenge has at most one active acceptance at a time;
        // commit 2 wires that gate. The column will be dropped in a separate
        // migration once the new model has run stable.
        $pdo->prepare("
            INSERT INTO channel_challenges
                (channel_id, city_id, created_by, guest_id, title, challenge_type, audience, status, return_clause,
                 mode, target_city_id, proof_requirements)
            VALUES
                (:channel_id, :city_id, :created_by, :guest_id, :title, :challenge_type, :audience, 'open', :return_clause,
                 :mode, :target_city_id, :proof_requirements)
        ")->execute([
            'channel_id'         => $id,
            'city_id'            => $cityId,
            'created_by'         => $userId,
            'guest_id'           => $guestId,
            'title'              => $title,
            'challenge_type'     => $challengeType,
            'audience'           => $audience,
            'return_clause'      => $returnClause,
            'mode'               => $mode,
            'target_city_id'     => $targetCityId,
            'proof_requirements' => $proofRequirements,
        ]);

        // Auto-join the creator (guests included).
        self::addParticipant($id, $guestId, $userId, $nickname);

        return self::findById($id) ?? [
            'id'                   => $id,
            'city_id'              => $cityId,
            'created_by'           => $userId,
            'guest_id'             => $guestId,
            'title'                => $title,
            'challenge_type'       => $challengeType,
            'audience'             => $audience,
            'status'               => 'open',
            'return_clause'        => $returnClause,
            'mode'                 => $mode,
            'target_city_id'       => $targetCityId,
            'proof_requirements'   => $proofRequirements,
            'message_count'        => 0,
            'last_activity_at'     => null,
            'validated_at'         => null,
            'created_at'           => time(),
            'participants_preview' => [],
            'participant_count'    => 1,
        ];
    }

    /**
     * Owner-gated edit of title / challenge_type / audience / return_clause.
     * Returns the updated challenge, or null if not found / not the owner.
     * Status cannot be flipped here — use validate() instead.
     *
     * max_participants is no longer editable from the form (new 1:1 model);
     * the column stays in the DB for back-compat but isn't touched here.
     */
    public static function update(
        string $challengeId,
        string $guestId,
        ?string $userId,
        string $title,
        string $challengeType,
        string $audience,
        ?string $returnClause = null,
        ?string $targetCityId = null,
        ?string $proofRequirements = null
    ): ?array {
        if (!self::ownerCheck($challengeId, $guestId, $userId)) return null;

        if (!in_array($challengeType, self::ALLOWED_TYPES,     true)) $challengeType = 'food';
        if (!in_array($audience,      self::ALLOWED_AUDIENCES, true)) $audience      = 'locals';

        $returnClause = $returnClause !== null ? trim($returnClause) : null;
        if ($returnClause === '') $returnClause = null;

        // Mode is intentionally NOT editable here — flipping mode mid-flight
        // would invalidate any in-flight acceptances (local-style phases vs
        // international's proof flow). If a creator wants the other mode, the
        // expected path is delete + recreate. We do let International creators
        // re-target the city + adjust the proof requirements (common edits).
        $pdo = Database::pdo();
        $modeRow = $pdo->prepare("SELECT mode FROM channel_challenges WHERE channel_id = :id");
        $modeRow->execute(['id' => $challengeId]);
        $currentMode = $modeRow->fetchColumn() ?: 'local';
        if ($currentMode !== 'international') {
            // Local rows ignore international-only fields on edit.
            $targetCityId      = null;
            $proofRequirements = null;
        } else {
            $proofRequirements = $proofRequirements !== null ? trim($proofRequirements) : null;
            if ($proofRequirements === '') $proofRequirements = null;
        }

        $pdo->prepare("
            UPDATE channel_challenges
            SET title              = :t,
                challenge_type     = :tp,
                audience           = :a,
                return_clause      = :rc,
                target_city_id     = :tci,
                proof_requirements = :pr,
                updated_at         = now()
            WHERE channel_id = :id
        ")->execute([
            't'   => $title,
            'tp'  => $challengeType,
            'a'   => $audience,
            'rc'  => $returnClause,
            'tci' => $targetCityId,
            'pr'  => $proofRequirements,
            'id'  => $challengeId,
        ]);

        // Keep the channel name in sync with the title (used as display name).
        $pdo->prepare("UPDATE channels SET name = :n, updated_at = now() WHERE id = :id")
            ->execute(['n' => $title, 'id' => $challengeId]);

        return self::findById($challengeId);
    }

    /**
     * Move challenge from 'open' → 'validated'. Idempotent: a re-validate is a
     * no-op but still returns the row.
     *
     * Returns:
     *   - array on success
     *   - null  if not found / not the owner
     */
    public static function validate(
        string $challengeId,
        string $guestId,
        ?string $userId
    ): ?array {
        if (!self::ownerCheck($challengeId, $guestId, $userId)) return null;

        Database::pdo()->prepare("
            UPDATE channel_challenges
            SET status = 'validated',
                validated_at = COALESCE(validated_at, now()),
                updated_at   = now()
            WHERE channel_id = :id AND status = 'open'
        ")->execute(['id' => $challengeId]);

        return self::findById($challengeId);
    }

    /**
     * Reverse of validate(): flip 'validated' → 'open'. Used when the creator
     * marked the challenge done by mistake. validated_at is wiped so the
     * 24h grace window resets cleanly if they re-validate later.
     */
    public static function unvalidate(
        string $challengeId,
        string $guestId,
        ?string $userId
    ): ?array {
        if (!self::ownerCheck($challengeId, $guestId, $userId)) return null;

        Database::pdo()->prepare("
            UPDATE channel_challenges
            SET status = 'open',
                validated_at = NULL,
                updated_at   = now()
            WHERE channel_id = :id AND status = 'validated'
        ")->execute(['id' => $challengeId]);

        return self::findById($challengeId);
    }

    /**
     * Soft-delete (channels.status='deleted'). Caller must own the challenge.
     * Returns false if not found / not the owner.
     */
    public static function delete(string $challengeId, string $guestId, ?string $userId): bool
    {
        if (!self::ownerCheck($challengeId, $guestId, $userId)) return false;

        Database::pdo()->prepare("UPDATE channels SET status = 'deleted', updated_at = now() WHERE id = :id")
            ->execute(['id' => $challengeId]);

        return true;
    }

    /**
     * Owner check — accepts the request if EITHER the guest_id OR the
     * registered user_id matches the creator. Identical pattern to Topics.
     */
    private static function ownerCheck(string $challengeId, string $guestId, ?string $userId): bool
    {
        $pdo = Database::pdo();
        if ($userId !== null) {
            $stmt = $pdo->prepare("
                SELECT 1 FROM channel_challenges
                WHERE channel_id = :id AND (guest_id = :guest_id OR created_by = :user_id)
            ");
            $stmt->execute(['id' => $challengeId, 'guest_id' => $guestId, 'user_id' => $userId]);
        } else {
            $stmt = $pdo->prepare("
                SELECT 1 FROM channel_challenges WHERE channel_id = :id AND guest_id = :guest_id
            ");
            $stmt->execute(['id' => $challengeId, 'guest_id' => $guestId]);
        }
        return (bool) $stmt->fetchColumn();
    }

    // ── Participants ──────────────────────────────────────────────────────────

    /** Idempotent join. Updates nickname if the row already exists. */
    public static function addParticipant(
        string $challengeId,
        string $guestId,
        ?string $userId,
        ?string $nickname
    ): void {
        Database::pdo()->prepare("
            INSERT INTO challenge_participants (channel_id, guest_id, user_id, nickname)
            VALUES (:channel_id, :guest_id, :user_id, :nickname)
            ON CONFLICT (channel_id, guest_id) DO UPDATE
            SET user_id  = COALESCE(EXCLUDED.user_id, challenge_participants.user_id),
                nickname = COALESCE(EXCLUDED.nickname, challenge_participants.nickname)
        ")->execute([
            'channel_id' => $challengeId,
            'guest_id'   => $guestId,
            'user_id'    => $userId,
            'nickname'   => $nickname,
        ]);
    }

    public static function removeParticipant(string $challengeId, string $guestId): void
    {
        Database::pdo()->prepare("
            DELETE FROM challenge_participants WHERE channel_id = ? AND guest_id = ?
        ")->execute([$challengeId, $guestId]);
    }

    public static function isParticipant(string $challengeId, string $guestId): bool
    {
        $stmt = Database::pdo()->prepare("
            SELECT 1 FROM challenge_participants WHERE channel_id = ? AND guest_id = ? LIMIT 1
        ");
        $stmt->execute([$challengeId, $guestId]);
        return (bool) $stmt->fetchColumn();
    }

    // ── Acceptor reads (new model, PR2+) ─────────────────────────────────────
    //
    // These methods source from challenge_acceptances, NOT the legacy
    // challenge_participants pool. The field names stay "participant" for
    // backward compatibility with the API response shape used by mobile +
    // web cards, but semantically these are now "acceptors" — people who
    // took on the challenge via the new POST /accept flow.
    //
    // The creator is NOT in this list (they own the challenge, they don't
    // accept it). 'rejected' acceptances are excluded — the relationship
    // is closed, no longer an active "is taking on this challenge".

    public static function participantCount(string $challengeId): int
    {
        $stmt = Database::pdo()->prepare("
            SELECT COUNT(*) FROM challenge_acceptances
            WHERE challenge_id = ? AND phase != 'rejected'
        ");
        $stmt->execute([$challengeId]);
        return (int) $stmt->fetchColumn();
    }

    /** Registered user_ids of a challenge's acceptors (push fan-out on validate). */
    public static function participantUserIds(string $challengeId): array
    {
        $stmt = Database::pdo()->prepare("
            SELECT acceptor_user_id FROM challenge_acceptances
            WHERE challenge_id = ? AND phase != 'rejected'
        ");
        $stmt->execute([$challengeId]);
        return $stmt->fetchAll(\PDO::FETCH_COLUMN);
    }

    /** Up to $limit acceptor avatar previews (most-recent first). */
    public static function participantPreview(string $challengeId, int $limit = 5): array
    {
        $limit = max(1, min(20, $limit));
        $stmt  = Database::pdo()->prepare("
            SELECT u.id, u.display_name, u.profile_thumb_photo_url, u.profile_photo_url
            FROM challenge_acceptances ca
            JOIN users u ON u.id = ca.acceptor_user_id AND u.deleted_at IS NULL
            WHERE ca.challenge_id = ? AND ca.phase != 'rejected'
            ORDER BY ca.created_at DESC
            LIMIT " . $limit);
        $stmt->execute([$challengeId]);
        return array_map(static fn(array $r): array => [
            'id'             => $r['id'],
            'displayName'    => $r['display_name'] ?? 'Member',
            'thumbAvatarUrl' => $r['profile_thumb_photo_url'] ?? $r['profile_photo_url'] ?? null,
        ], $stmt->fetchAll(\PDO::FETCH_ASSOC));
    }

    /** Batched preview for the NOW feed (one windowed query). */
    public static function participantPreviewBatch(array $challengeIds, int $limit = 5): array
    {
        if (empty($challengeIds)) return [];
        $limit = max(1, min(20, $limit));
        $in    = implode(',', array_fill(0, count($challengeIds), '?'));
        $stmt  = Database::pdo()->prepare("
            SELECT challenge_id, id, display_name, thumb_url, full_url FROM (
                SELECT ca.challenge_id, u.id, u.display_name,
                       u.profile_thumb_photo_url AS thumb_url,
                       u.profile_photo_url       AS full_url,
                       row_number() OVER (PARTITION BY ca.challenge_id ORDER BY ca.created_at DESC) AS rn
                FROM challenge_acceptances ca
                JOIN users u ON u.id = ca.acceptor_user_id AND u.deleted_at IS NULL
                WHERE ca.challenge_id IN ($in) AND ca.phase != 'rejected'
            ) t WHERE rn <= " . $limit);
        $stmt->execute(array_values($challengeIds));
        $map = [];
        foreach ($stmt->fetchAll(\PDO::FETCH_ASSOC) as $r) {
            $map[$r['challenge_id']][] = [
                'id'             => $r['id'],
                'displayName'    => $r['display_name'] ?? 'Member',
                'thumbAvatarUrl' => $r['thumb_url'] ?? $r['full_url'] ?? null,
            ];
        }
        return $map;
    }

    /** Batched count for the NOW feed. */
    public static function participantCountBatch(array $challengeIds): array
    {
        if (empty($challengeIds)) return [];
        $in   = implode(',', array_fill(0, count($challengeIds), '?'));
        $stmt = Database::pdo()->prepare("
            SELECT challenge_id, COUNT(*) AS cnt
            FROM challenge_acceptances
            WHERE challenge_id IN ($in) AND phase != 'rejected'
            GROUP BY challenge_id
        ");
        $stmt->execute(array_values($challengeIds));
        $map = [];
        foreach ($stmt->fetchAll(\PDO::FETCH_ASSOC) as $r) {
            $map[$r['challenge_id']] = (int) $r['cnt'];
        }
        return $map;
    }

    /**
     * Full acceptor list for the members modal — canonical UserDTOs in
     * accept-order. PR2+ acceptors are always registered users (the new
     * /accept flow requires a session), so no guest branch here.
     * 'rejected' acceptances are excluded.
     */
    public static function getParticipants(string $challengeId): array
    {
        $stmt = Database::pdo()->prepare("
            SELECT ca.acceptor_user_id AS user_id,
                   EXTRACT(EPOCH FROM ca.created_at)::int AS joined_at,
                   CASE WHEN u.deleted_at IS NULL THEN u.display_name      ELSE NULL END AS display_name,
                   CASE WHEN u.deleted_at IS NULL THEN u.profile_photo_url ELSE NULL END AS profile_photo_url,
                   CASE WHEN u.deleted_at IS NULL THEN u.vibe              ELSE NULL END AS vibe,
                   CASE WHEN u.deleted_at IS NULL THEN u.created_at        ELSE NULL END AS user_created_at
            FROM challenge_acceptances ca
            LEFT JOIN users u ON u.id = ca.acceptor_user_id
            WHERE ca.challenge_id = ? AND ca.phase != 'rejected'
            ORDER BY ca.created_at ASC
        ");
        $stmt->execute([$challengeId]);
        return array_map(static function (array $r): array {
            $joinedAt = (int) $r['joined_at'];
            // Live account → full UserDTO.
            if ($r['display_name'] !== null) {
                return array_merge(UserResource::fromUser([
                    'id'                => $r['user_id'],
                    'display_name'      => $r['display_name'],
                    'profile_photo_url' => $r['profile_photo_url'],
                    'vibe'              => $r['vibe'],
                    'created_at'        => $r['user_created_at'],
                    'home_city'         => null,
                ]), ['joinedAt' => $joinedAt]);
            }
            // Account was deleted after accepting — discreet placeholder so
            // the slot is preserved (cap math etc.) without surfacing PII.
            return array_merge(UserResource::fromGuest($r['user_id'], 'Former member'), ['joinedAt' => $joinedAt]);
        }, $stmt->fetchAll(\PDO::FETCH_ASSOC));
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /** Hydrate a batch of challenge rows with participant preview + count. */
    private static function enrichWithParticipants(array $challenges): array
    {
        if (empty($challenges)) return [];
        $ids      = array_map(static fn(array $c): string => $c['id'], $challenges);
        $previews = self::participantPreviewBatch($ids, 5);
        $counts   = self::participantCountBatch($ids);
        foreach ($challenges as &$c) {
            $c['participants_preview'] = $previews[$c['id']] ?? [];
            $c['participant_count']    = $counts[$c['id']]   ?? 0;
        }
        return $challenges;
    }

    public static function allowedTypes(): array     { return self::ALLOWED_TYPES; }
    public static function allowedAudiences(): array { return self::ALLOWED_AUDIENCES; }
    public static function allowedModes(): array     { return self::ALLOWED_MODES; }
}
