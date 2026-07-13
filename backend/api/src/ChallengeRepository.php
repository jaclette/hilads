<?php

declare(strict_types=1);

/**
 * Challenge (Défi) - third primary entity alongside events + hangouts.
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
 * Guests CAN accept challenges - same anonymous-allowed UX as events.
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

    // is_in_progress: true iff the challenge has a POST-APPROVAL active
    // acceptance - i.e., someone the creator has accepted and is actually
    // working on the challenge. Uses IS_IN_PROGRESS_SQL (not IS_ACTIVE_SQL)
    // so a pending request the creator hasn't reviewed yet still reads
    // as "Available" on the city feed. The /accept gate keeps using
    // IS_ACTIVE_SQL (wider - pending DOES block new requests) so two
    // people can't race the same slot. See ChallengeAcceptanceRepository
    // for the SQL fragments' contracts and PR36 for the UX rationale.
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
            cc.challenge_format,
            cc.target_city_id,
            cc.proof_requirements,
            -- Validation method (Meet vs Photo). International is locked to
            -- 'photo_proof' (DB column + UI + create-route enforcement); local
            -- creators pick at creation. Card + ProofBlock branch off this.
            cc.validation_method,
            cc.is_campaign,
            -- Visibility (privacy round 2). 'public' default; 'friends' / 'private'
            -- gate the row out of sitemap, public city feed, and crawler-visible
            -- surfaces at the route layer.
            cc.visibility,
            cc.closed_to_new_joins,
            -- Group model (Phase 1+): the single group meet's date/time +
            -- location, set at creation. NULL on legacy rows.
            cc.meet_at,
            cc.meet_ends_at,
            cc.venue,
            cc.venue_lat,
            cc.venue_lng,
            EXTRACT(EPOCH FROM cc.meet_at)::BIGINT      AS meet_at_ts,
            EXTRACT(EPOCH FROM cc.meet_ends_at)::BIGINT AS meet_ends_at_ts,
            -- Creator's display info - surfaced on cards + detail header so
            -- the user sees who owns a challenge. LEFT JOIN: pure-guest
            -- challenges (created_by IS NULL) fall back to cc.guest_id /
            -- nickname captured at create-time; we keep the JOIN on user_id
            -- only because guest_id can collide across accounts on the same
            -- device (see isOwner notes elsewhere).
            u.display_name             AS creator_display_name,
            u.username                 AS creator_username,
            COALESCE(u.profile_thumb_photo_url, u.profile_photo_url) AS creator_thumb_avatar_url,
            COUNT(m.id)                                            AS message_count,
            EXTRACT(EPOCH FROM MAX(m.created_at))::INTEGER         AS last_activity_at,
            EXTRACT(EPOCH FROM cc.validated_at)::INTEGER           AS validated_at,
            EXTRACT(EPOCH FROM cc.created_at)::INTEGER             AS created_at,
            EXISTS (
                SELECT 1 FROM challenge_acceptances ca
                -- Correlate on c.id (in every GROUP BY clause below) rather
                -- than cc.channel_id - Postgres rejects ungrouped, non-
                -- aggregated outer references with GROUP BY queries. The two
                -- columns are equal via the JOIN; ca.challenge_id's FK
                -- references channels(id) so either works semantically.
                WHERE ca.challenge_id = c.id
                  AND " . \ChallengeAcceptanceRepository::IS_IN_PROGRESS_SQL . "
            )                                                       AS is_in_progress,
            -- closed: the challenge was SUCCESSFULLY completed (an acceptance
            -- reached the terminal 'approved' phase). A completed challenge is
            -- one-shot - it does NOT reopen for new takers (see /accept gate).
            -- Distinct from status='validated' (a reversible manual archive).
            EXISTS (
                SELECT 1 FROM challenge_acceptances cax
                WHERE cax.challenge_id = c.id AND cax.phase = 'approved'
            )                                                       AS is_completed,
            -- Versus-layout: the active taker's identity for the right-hand
            -- avatar slot. LATERAL pulls the most-recent non-rejected
            -- acceptance per challenge (1 row max via LIMIT 1). All three
            -- non-terminal phases (pending/accepted/scheduled) AND the
            -- terminal approved phase resolve here, so the card renders the
            -- taker on both in-progress AND validated state. Rejected rows
            -- are filtered out so a declined request doesn't leak into the
            -- avatar. acceptor_country is derived from the taker's CURRENT
            -- city (NOT the challenge target) - flag = identity.
            ac.acceptor_user_id,
            ac.phase                    AS acceptor_phase,
            ac.acceptance_id            AS acceptor_acceptance_id,
            au.display_name             AS acceptor_display_name,
            COALESCE(au.profile_thumb_photo_url, au.profile_photo_url) AS acceptor_thumb_avatar_url,
            au.current_city_id          AS acceptor_current_city_id,
            -- Monthly rank badges (Top 10 + podium for Top 3) for both
            -- avatars on the versus row. NULL = outside top-10 in that
            -- scope. Both creator AND acceptor expose both scopes - the
            -- card chooses which to read based on challenge mode (local
            -- → in_city, international → worldwide). Plus the formatter
            -- below applies a score_month_ref staleness guard so month
            -- rollover never surfaces yesterday's badge.
            u.monthly_rank_in_city      AS creator_monthly_rank_in_city,
            u.monthly_rank_worldwide    AS creator_monthly_rank_worldwide,
            u.score_month_ref           AS creator_score_month_ref,
            au.monthly_rank_in_city     AS acceptor_monthly_rank_in_city,
            au.monthly_rank_worldwide   AS acceptor_monthly_rank_worldwide,
            au.score_month_ref          AS acceptor_score_month_ref,
            -- All-time rank badges. All-time rank isn't denormalised onto users
            -- (only monthly is), so compute it on-read via COUNT of higher scorers -
            -- the same method as the /leaderboard my-rank endpoint. NULL for guests
            -- (no user row) and 0-score users. The card picks worldwide
            -- (international) vs in_city (local) by challenge mode; the formatter
            -- bounds these to the Top-10 medal threshold.
            CASE WHEN cc.created_by IS NOT NULL AND u.score_alltime > 0
                 THEN (SELECT COUNT(*) FROM users ru WHERE ru.deleted_at IS NULL AND ru.score_alltime > u.score_alltime) END      AS creator_alltime_higher_worldwide,
            CASE WHEN cc.created_by IS NOT NULL AND u.score_alltime > 0 AND u.current_city_id IS NOT NULL
                 THEN (SELECT COUNT(*) FROM users ru WHERE ru.deleted_at IS NULL AND ru.current_city_id = u.current_city_id AND ru.score_alltime > u.score_alltime) END AS creator_alltime_higher_in_city,
            CASE WHEN ac.acceptor_user_id IS NOT NULL AND au.score_alltime > 0
                 THEN (SELECT COUNT(*) FROM users ru WHERE ru.deleted_at IS NULL AND ru.score_alltime > au.score_alltime) END     AS acceptor_alltime_higher_worldwide,
            CASE WHEN ac.acceptor_user_id IS NOT NULL AND au.score_alltime > 0 AND au.current_city_id IS NOT NULL
                 THEN (SELECT COUNT(*) FROM users ru WHERE ru.deleted_at IS NULL AND ru.current_city_id = au.current_city_id AND ru.score_alltime > au.score_alltime) END AS acceptor_alltime_higher_in_city
        FROM channels c
        JOIN channel_challenges cc ON cc.channel_id = c.id
        LEFT JOIN users u           ON u.id = cc.created_by
        LEFT JOIN messages m        ON m.channel_id = c.id AND m.type IN ('text', 'image')
        LEFT JOIN LATERAL (
            -- Pick the taker to render in the right-hand avatar slot.
            -- The slot must vacate the moment the previous round ends -
            -- otherwise an Available card still shows the last winner's
            -- face. Two cases that DO surface a taker:
            --   1. An in-progress acceptance (same definition as
            --      IS_IN_PROGRESS_SQL - drives the 'In progress' pill).
            --   2. The winning acceptance, but only while the challenge
            --      itself is still in its validated state. Once the
            --      creator unvalidates / reopens the channel for a new
            --      round, the prior 'approved' row no longer counts.
            -- Pending requests (creator hasn't reviewed yet) and rejected
            -- ones never show in the slot.
            SELECT ca.acceptor_user_id, ca.phase, ca.id AS acceptance_id
            FROM challenge_acceptances ca
            WHERE ca.challenge_id = c.id
              AND (
                  " . \ChallengeAcceptanceRepository::IS_IN_PROGRESS_SQL . "
                  OR (ca.phase = 'approved' AND cc.status = 'validated')
              )
            ORDER BY ca.created_at DESC
            LIMIT 1
        ) ac ON TRUE
        LEFT JOIN users au          ON au.id = ac.acceptor_user_id
    ";

    /**
     * Resolve an ISO-2 country code for a 'city_<int>' channel id via the
     * APCU-cached city list. Returns null for null / malformed input or
     * cities we don't know about. Cheap - no DB round-trip after warmup.
     */
    private static function countryForCityId(?string $cityId): ?string
    {
        if (!is_string($cityId) || !preg_match('/^city_(\d+)$/', $cityId, $m)) return null;
        $city = CityRepository::findById((int) $m[1]);
        return $city['country'] ?? null;
    }

    /**
     * Resolve the display city name for a 'city_<int>' channel id via the
     * APCU-cached city list. Mirror of countryForCityId - used so the
     * International pill can fall back to a readable city name when the
     * flag emoji doesn't render on a given device's font.
     */
    private static function cityNameForCityId(?string $cityId): ?string
    {
        if (!is_string($cityId) || !preg_match('/^city_(\d+)$/', $cityId, $m)) return null;
        $city = CityRepository::findById((int) $m[1]);
        return $city['name'] ?? null;
    }

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
            // Legacy field - kept in the response shape for one release so old
            // mobile/web builds don't blow up reading it. Always returns the
            // stored DB value (or 3 as the historical default).
            'max_participants'     => (int) ($row['max_participants'] ?? 3),
            'return_clause'        => $row['return_clause'] ?? null,
            'message_count'        => (int) ($row['message_count'] ?? 0),
            'last_activity_at'     => isset($row['last_activity_at']) ? (int) $row['last_activity_at'] : null,
            'validated_at'         => isset($row['validated_at'])     ? (int) $row['validated_at']     : null,
            'created_at'           => (int) $row['created_at'],
            // 1:1 model state - true iff this challenge currently has a
            // non-terminal acceptance. UI uses this to render Available /
            // In progress / Validated and to gate the Accept button.
            // Defaults to false on rows that pre-date the column (eg. cached
            // formats) - safe because the route still rechecks at /accept.
            'is_in_progress'       => isset($row['is_in_progress']) ? (bool) $row['is_in_progress'] : false,
            // closed: successfully completed (an approved acceptance exists) →
            // one-shot, no new take-ons. Clients hide Accept + show completed.
            'closed'               => isset($row['is_completed']) ? (bool) $row['is_completed'] : false,
            // International mode shape. 'local' is the default for every row
            // that pre-dates the migration. target_city_id is null for local
            // and for "anywhere" international rows; proof_requirements only
            // populated on international.
            'mode'                 => $row['mode']               ?? 'local',
            // Group-challenge model flag: 'legacy' (1-to-1 accept→date→rate) vs
            // 'group' (join→meet→validate). Drives which flow + UI the clients use.
            'challenge_format'     => $row['challenge_format']   ?? 'legacy',
            // Group meet date/time (unix) + location. NULL on legacy rows.
            'meet_at'              => isset($row['meet_at_ts'])      ? (int) $row['meet_at_ts']      : null,
            'meet_ends_at'         => isset($row['meet_ends_at_ts']) ? (int) $row['meet_ends_at_ts'] : null,
            'venue'                => $row['venue']     ?? null,
            'venue_lat'            => isset($row['venue_lat']) ? (float) $row['venue_lat'] : null,
            'venue_lng'            => isset($row['venue_lng']) ? (float) $row['venue_lng'] : null,
            // 'meet' default keeps every pre-PR row on the historical IRL
            // flow. International rows are forced to 'photo_proof' by the
            // migrate backfill + the create/update routes.
            'validation_method'    => $row['validation_method']  ?? 'meet',
            'is_campaign'          => (bool) ($row['is_campaign'] ?? false),
            'target_city_id'       => $row['target_city_id']     ?? null,
            'proof_requirements'   => $row['proof_requirements'] ?? null,
            // Origin + target country (ISO-2). Resolved via the cached
            // CityRepository so we avoid a SQL join + GROUP BY rewrite.
            // Used by clients to render flag emojis on the International
            // pill ("🇩🇪 → 🇻🇳" etc.). Null for guest-only or unknown rows.
            'country'              => self::countryForCityId($row['city_id']        ?? null),
            'target_country'       => self::countryForCityId($row['target_city_id'] ?? null),
            // PR15 - target city DISPLAY NAME for the International pill on
            // surfaces where the flag emoji might not render (Android font
            // gaps on country flags). Resolved from the same APCU-cached
            // city list as country. Null for "anywhere" / local rows.
            'target_city_name'     => self::cityNameForCityId($row['target_city_id'] ?? null),
            // Origin city name - for the "origin → target" route on international cards.
            'city_name'            => self::cityNameForCityId($row['city_id'] ?? null),
            // Visibility - 'public' default for pre-migration rows.
            'visibility'           => $row['visibility']         ?? 'public',
            'closed_to_new_joins'  => (bool) ($row['closed_to_new_joins'] ?? false),
            // Creator display - null for pure-guest challenges (created_by IS NULL).
            // Cards + the detail header render "by {creator_display_name}".
            'creator_display_name'     => $row['creator_display_name']     ?? null,
            'creator_username'         => $row['creator_username']         ?? null,
            'creator_thumb_avatar_url' => R2Uploader::thumbProxy($row['creator_thumb_avatar_url'] ?? null),
            // Versus-layout: the active taker's identity. Powers the
            // right-hand avatar on the card (and the same on detail).
            // Populated via the LATERAL acceptance join in SELECT above;
            // null when the challenge has no non-rejected acceptance yet
            // (State 1 / 3 - open or participants-only).
            // acceptor_country is the taker's CURRENT city (their flag =
            // identity), distinct from the challenge's target_country.
            'acceptor_user_id'         => $row['acceptor_user_id']         ?? null,
            'acceptor_phase'           => $row['acceptor_phase']           ?? null,
            'acceptor_acceptance_id'   => $row['acceptor_acceptance_id']   ?? null,
            'acceptor_display_name'    => $row['acceptor_display_name']    ?? null,
            'acceptor_thumb_avatar_url'=> R2Uploader::thumbProxy($row['acceptor_thumb_avatar_url']?? null),
            'acceptor_country'         => self::countryForCityId($row['acceptor_current_city_id'] ?? null),
            // Monthly rank badges (Top 10 + podium for Top 3). Staleness
            // guard: only expose the rank when the user's score_month_ref
            // matches the current UTC month. After a month rollover the
            // stored value reflects last month's standings; without this
            // check a "winner" badge would linger until the next score
            // event in their city triggered a recalc. NULL on miss =
            // no badge, fastest path.
            'creator_monthly_rank_in_city'    => self::staleGuard($row['creator_monthly_rank_in_city']    ?? null, $row['creator_score_month_ref']  ?? null),
            'creator_monthly_rank_worldwide'  => self::staleGuard($row['creator_monthly_rank_worldwide']  ?? null, $row['creator_score_month_ref']  ?? null),
            'acceptor_monthly_rank_in_city'   => self::staleGuard($row['acceptor_monthly_rank_in_city']   ?? null, $row['acceptor_score_month_ref'] ?? null),
            'acceptor_monthly_rank_worldwide' => self::staleGuard($row['acceptor_monthly_rank_worldwide'] ?? null, $row['acceptor_score_month_ref'] ?? null),
            // All-time rank badges (Top 10). rank = higher-scorers + 1; NULL past
            // the top-10 medal threshold or for guest/0-score users.
            'creator_alltime_rank_worldwide'  => self::rankFromHigher($row['creator_alltime_higher_worldwide']  ?? null),
            'creator_alltime_rank_in_city'    => self::rankFromHigher($row['creator_alltime_higher_in_city']    ?? null),
            'acceptor_alltime_rank_worldwide' => self::rankFromHigher($row['acceptor_alltime_higher_worldwide'] ?? null),
            'acceptor_alltime_rank_in_city'   => self::rankFromHigher($row['acceptor_alltime_higher_in_city']   ?? null),
            // Populated by batched queries; default so the field is always present.
            'participants_preview' => [],
            'participant_count'    => 0,
            'submission_count'     => 0,
        ];
    }

    /**
     * Pass-through that NULLs the rank when score_month_ref is stale.
     * Anything older than the current UTC month signals "this rank
     * reflects a prior month" - drop it so the badge surface doesn't
     * lie until the next recalc.
     */
    private static function staleGuard(mixed $rank, ?string $monthRef): ?int
    {
        if ($rank === null) return null;
        $current = gmdate('Y-m');
        if ($monthRef !== $current) return null;
        return (int) $rank;
    }

    // Number of higher scorers → 1-based rank, bounded to the Top-10 medal
    // threshold (NULL past it, matching the monthly badge behaviour). NULL in =
    // NULL out (guest / 0-score user).
    private static function rankFromHigher(mixed $higher): ?int
    {
        if ($higher === null) return null;
        $rank = (int) $higher + 1;
        return $rank <= 10 ? $rank : null;
    }

    // ── Reads ─────────────────────────────────────────────────────────────────

    /**
     * Active (open) challenge count per city - for the city list summary.
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
        // Public-only - the city-list summary feeds the always-visible
        // city picker (anon viewers, crawlers). Friends/private rows must
        // not bump the count or they'd leak existence to non-viewers.
        $stmt = Database::pdo()->prepare("
            WITH all_active AS (
                SELECT cc.city_id        AS surface_city_id FROM channel_challenges cc
                JOIN channels c ON c.id = cc.channel_id
                WHERE c.status = 'active' AND cc.status = 'open' AND cc.visibility = 'public'
                  AND NOT EXISTS (SELECT 1 FROM challenge_acceptances ca_done
                                  WHERE ca_done.challenge_id = cc.channel_id AND ca_done.phase = 'approved')
                UNION ALL
                SELECT cc.target_city_id AS surface_city_id FROM channel_challenges cc
                JOIN channels c ON c.id = cc.channel_id
                WHERE c.status = 'active' AND cc.status = 'open' AND cc.visibility = 'public'
                  AND cc.target_city_id IS NOT NULL
                  AND cc.target_city_id <> cc.city_id
                  AND NOT EXISTS (SELECT 1 FROM challenge_acceptances ca_done
                                  WHERE ca_done.challenge_id = cc.channel_id AND ca_done.phase = 'approved')
            )
            SELECT surface_city_id AS city_id, COUNT(*) AS challenge_count
            FROM all_active
            WHERE surface_city_id IS NOT NULL
            GROUP BY surface_city_id
        ");
        $stmt->execute();
        $result = [];
        foreach ($stmt->fetchAll() as $row) {
            // city_id is stored as 'city_3' - extract the numeric ID to match EventRepository.
            $numericId           = (int) str_replace('city_', '', $row['city_id']);
            $result[$numericId]  = (int) $row['challenge_count'];
        }
        return $result;
    }

    /**
     * Active (open) challenges for a city, sorted by created_at DESC.
     * $cityId is the channel ID string, e.g. 'city_3'.
     * $limit is capped at 200 - feed is meant for "top 5" display anyway, but
     * the See-All screen can request more.
     */
    public static function getByCity(string $cityId, int $limit = 50, ?string $viewerUserId = null): array
    {
        $limit = max(1, min(200, $limit));
        $pdo   = Database::pdo();

        // 24h grace window: validated challenges stay in the active feed for 1 day
        // after validated_at, so the city sees "Défi relevé" status before it
        // drops into the past archive. After 24h, getValidatedByCity() picks it up.
        //
        // (cc.city_id = :cid OR cc.target_city_id = :cid) - International
        // challenges targeting this city mirror into its feed (per spec). The
        // partial index `idx_channel_challenges_target_city` covers the
        // target-side scan; "anywhere" intl rows (target_city_id IS NULL)
        // stay origin-only because NULL doesn't satisfy either clause for
        // any city other than the creator's.
        //
        // Visibility: viewer-aware via visibilityWhereClause(). Anonymous
        // viewers see public-only; logged-in viewers also see friends-of-
        // them and challenges they're a participant in.
        $visClause = self::visibilityWhereClause($viewerUserId);
        $params    = ['city_id' => $cityId];
        if ($viewerUserId !== null) $params['viewer_id'] = $viewerUserId;

        $stmt = $pdo->prepare(self::SELECT . "
            WHERE (cc.city_id = :city_id OR cc.target_city_id = :city_id
                   -- Global Hilads campaigns surface in EVERY city's feed.
                   OR (cc.is_campaign = true AND cc.mode = 'global'))
              AND c.status   = 'active'
              -- Active feed = still-open challenges PLUS a 24h grace window for
              -- ones that were just validated / completed, so the city keeps
              -- seeing the done card for a day before it drops to the past
              -- archive (getValidatedByCity) / Success showcase.
              AND (
                  (cc.status = 'open' AND NOT EXISTS (
                      SELECT 1 FROM challenge_acceptances ca_done
                      WHERE ca_done.challenge_id = c.id AND ca_done.phase = 'approved'
                  ))
                  -- Group / manually validated: stays for 24h after validated_at.
                  OR (cc.validated_at IS NOT NULL AND cc.validated_at > now() - interval '24 hours')
                  -- Legacy 1-1 completed (acceptance approved, status still open):
                  -- stays for 24h after the approval.
                  OR EXISTS (
                      SELECT 1 FROM challenge_acceptances ca_grace
                      WHERE ca_grace.challenge_id = c.id AND ca_grace.phase = 'approved'
                        AND ca_grace.approved_at > now() - interval '24 hours'
                  )
              )
              AND $visClause
            GROUP BY c.id, cc.city_id, cc.created_by, cc.guest_id,
                     cc.title, cc.challenge_type, cc.audience, cc.status,
                     cc.max_participants, cc.return_clause,
                     cc.mode, cc.challenge_format, cc.target_city_id, cc.proof_requirements, cc.validation_method,
                     cc.is_campaign, cc.visibility,
            cc.closed_to_new_joins,
                     cc.meet_at, cc.meet_ends_at, cc.venue, cc.venue_lat, cc.venue_lng,
                     cc.validated_at, cc.created_at,
                     u.display_name, u.username,
                     u.profile_thumb_photo_url, u.profile_photo_url,
                     u.monthly_rank_in_city, u.monthly_rank_worldwide, u.score_month_ref,
                     u.score_alltime, u.current_city_id,
                     ac.acceptor_user_id, ac.phase, ac.acceptance_id, au.display_name,
                     au.profile_thumb_photo_url, au.profile_photo_url,
                     au.current_city_id, au.score_alltime,
                     au.monthly_rank_in_city, au.monthly_rank_worldwide, au.score_month_ref
            ORDER BY cc.created_at DESC
            LIMIT $limit
        ");
        $stmt->execute($params);
        $rows = $stmt->fetchAll();
        if (empty($rows)) return [];

        $out = array_map(static fn(array $r): array => self::format($r), $rows);
        return self::enrichWithParticipants($out);
    }

    /**
     * Global cross-city feed: ALL open, public international challenges worldwide,
     * newest first. Powers the World "See all" screen - distinct from getByCity's
     * International filter, which is scoped to a single city (its origin/target).
     * Returns full card DTOs (same shape as getByCity) so the existing cards render.
     */
    public static function getInternationalWorldwide(int $limit = 60): array
    {
        $limit = max(1, min(200, $limit));
        $stmt  = Database::pdo()->prepare(self::SELECT . "
            WHERE cc.mode       = 'international'
              AND cc.status     = 'open'
              AND cc.visibility = 'public'
              AND c.status      = 'active'
            GROUP BY c.id, cc.city_id, cc.created_by, cc.guest_id,
                     cc.title, cc.challenge_type, cc.audience, cc.status,
                     cc.max_participants, cc.return_clause,
                     cc.mode, cc.challenge_format, cc.target_city_id, cc.proof_requirements, cc.validation_method,
                     cc.is_campaign, cc.visibility,
            cc.closed_to_new_joins,
                     cc.meet_at, cc.meet_ends_at, cc.venue, cc.venue_lat, cc.venue_lng,
                     cc.validated_at, cc.created_at,
                     u.display_name, u.username,
                     u.profile_thumb_photo_url, u.profile_photo_url,
                     u.monthly_rank_in_city, u.monthly_rank_worldwide, u.score_month_ref,
                     u.score_alltime, u.current_city_id,
                     ac.acceptor_user_id, ac.phase, ac.acceptance_id, au.display_name,
                     au.profile_thumb_photo_url, au.profile_photo_url,
                     au.current_city_id, au.score_alltime,
                     au.monthly_rank_in_city, au.monthly_rank_worldwide, au.score_month_ref
            ORDER BY cc.created_at DESC
            LIMIT $limit
        ");
        $stmt->execute();
        $rows = $stmt->fetchAll();
        if (empty($rows)) return [];

        $out = array_map(static fn(array $r): array => self::format($r), $rows);
        return self::enrichWithParticipants($out);
    }

    /**
     * Inspiration block for the zero-challenge empty state. Picks the single
     * most-active OTHER city that currently has open PUBLIC challenges by a
     * registered creator, and returns up to 3 of them as a read-only
     * "recipe book". Deliberately NOT a takeable feed: callers render these
     * in an inert card whose only action routes back to LOCAL creation, so
     * we return the bare minimum (title, type, creator name + avatar) - no
     * challenge id, no acceptance/visibility/participant state, nothing the
     * client could use to open or take the remote challenge.
     *
     * "Most active" here = most open public challenges, tie-broken by
     * recency. That's the relevant signal for "which city has the richest
     * idea book", and keeps this to two small, fully-indexed queries
     * (idx_channel_challenges_city_status) instead of the heavy GROUP-BY +
     * participant enrichment of getByCity. Egress-safe: the candidate scan
     * is bounded by the (small) set of currently-open public challenges, the
     * sample is LIMIT 3.
     *
     * Returns [] when no other city qualifies, so the whole block renders
     * nothing in that case.
     *
     * @param string $excludeCityId The caller's current city ('city_<int>'),
     *                              excluded so we never show a city its own
     *                              challenges as "elsewhere".
     * @return array{city: ?string, cityId: ?string, examples: array<int, array<string, mixed>>}
     */
    public static function getInspiration(string $excludeCityId): array
    {
        $empty = ['city' => null, 'cityId' => null, 'examples' => []];
        $pdo   = Database::pdo();

        // 1) Pick the most-active OTHER city with open public challenges.
        $pick = $pdo->prepare("
            SELECT cc.city_id, COUNT(*) AS n, MAX(cc.created_at) AS recent
            FROM channel_challenges cc
            JOIN channels c ON c.id = cc.channel_id
            WHERE cc.status      = 'open'
              AND cc.visibility  = 'public'
              AND c.status       = 'active'
              AND cc.created_by IS NOT NULL
              AND cc.city_id    <> :exclude
            GROUP BY cc.city_id
            ORDER BY n DESC, recent DESC
            LIMIT 1
        ");
        $pick->execute(['exclude' => $excludeCityId]);
        $cityId = $pick->fetchColumn();
        if ($cityId === false || $cityId === null) return $empty;

        // 2) Up to 3 examples from that city. Lean projection - only what an
        //    inert example card renders. JOIN users (not LEFT): created_by is
        //    NOT NULL per the candidate filter, so the creator always exists.
        $sample = $pdo->prepare("
            SELECT cc.channel_id AS id, cc.title, cc.challenge_type, cc.mode, cc.target_city_id,
                   u.username AS creator_username,
                   u.display_name AS creator_display_name,
                   COALESCE(u.profile_thumb_photo_url, u.profile_photo_url) AS creator_thumb_avatar_url
            FROM channel_challenges cc
            JOIN channels c ON c.id = cc.channel_id
            JOIN users    u ON u.id = cc.created_by
            WHERE cc.city_id     = :city
              AND cc.status      = 'open'
              AND cc.visibility  = 'public'
              AND c.status       = 'active'
            ORDER BY cc.created_at DESC
            LIMIT 3
        ");
        $sample->execute(['city' => $cityId]);
        $rows = $sample->fetchAll();
        if (empty($rows)) return $empty;

        // Origin country = the inspiration city (same for every row). target
        // country only set on international challenges (target_city_id non-null),
        // which the card renders as a "from -> to" flag pair. id lets the card
        // open the real challenge.
        $originCountry = self::countryForCityId($cityId);
        $examples = array_map(static fn(array $r): array => [
            'id'                       => $r['id'],
            'title'                    => $r['title'],
            'challenge_type'           => $r['challenge_type'],
            'mode'                     => $r['mode'] ?? 'local',
            'country'                  => $originCountry,
            'target_country'           => self::countryForCityId($r['target_city_id']),
            'creator_username'         => $r['creator_username'],
            'creator_display_name'     => $r['creator_display_name'],
            'creator_thumb_avatar_url' => R2Uploader::thumbProxy($r['creator_thumb_avatar_url']),
        ], $rows);

        return [
            'city'     => self::cityNameForCityId($cityId),
            'cityId'   => $cityId,
            'examples' => $examples,
        ];
    }

    /**
     * The N most recent OPEN, public, international (cross-city) challenges,
     * globally. Powers the World-channel hero carousel. Lean projection - only
     * what a carousel slide renders (owner + avatar, title, type, id to open).
     */
    public static function recentInternational(int $limit = 5): array
    {
        $limit = max(1, min(10, $limit));
        $stmt = Database::pdo()->prepare("
            SELECT cc.channel_id AS id, cc.title, cc.challenge_type, cc.mode,
                   cc.city_id, cc.target_city_id,
                   u.username     AS creator_username,
                   u.display_name AS creator_display_name,
                   COALESCE(u.profile_thumb_photo_url, u.profile_photo_url) AS creator_thumb_avatar_url
            FROM channel_challenges cc
            JOIN channels c ON c.id = cc.channel_id
            JOIN users    u ON u.id = cc.created_by
            WHERE cc.mode       = 'international'
              AND cc.status     = 'open'
              AND cc.visibility = 'public'
              AND c.status      = 'active'
            ORDER BY cc.created_at DESC
            LIMIT {$limit}
        ");
        $stmt->execute();

        return array_map(static fn(array $r): array => [
            'id'                       => $r['id'],
            'title'                    => $r['title'],
            'challenge_type'           => $r['challenge_type'],
            'mode'                     => $r['mode'] ?? 'international',
            'country'                  => self::countryForCityId($r['city_id']),
            'target_country'           => self::countryForCityId($r['target_city_id']),
            'city'                     => self::cityNameForCityId($r['city_id']),
            'target_city'              => self::cityNameForCityId($r['target_city_id']),
            'creator_username'         => $r['creator_username'],
            'creator_display_name'     => $r['creator_display_name'],
            'creator_thumb_avatar_url' => R2Uploader::thumbProxy($r['creator_thumb_avatar_url']),
        ], $stmt->fetchAll());
    }

    /**
     * Validated (archived) challenges for a city - feeds the "See past
     * challenges" CTA. Most-recently-validated first.
     */
    public static function getValidatedByCity(string $cityId, int $limit = 30, ?int $beforeTs = null, ?string $viewerUserId = null): array
    {
        $limit  = max(1, min(100, $limit));
        $params = ['city_id' => $cityId];
        // Past archive - only challenges that are past the 24h grace window
        // (otherwise they're still showing in the active feed via getByCity()).
        // Same mirroring rule as getByCity - past archive of a city includes
        // international challenges that targeted it.
        $visClause = self::visibilityWhereClause($viewerUserId);
        if ($viewerUserId !== null) $params['viewer_id'] = $viewerUserId;

        // No grace delay: a validated challenge appears in the past archive
        // immediately (it left the active feed the moment it was validated).
        $where  = "(cc.city_id = :city_id OR cc.target_city_id = :city_id) AND c.status = 'active' AND cc.status = 'validated' AND $visClause";
        if ($beforeTs !== null) {
            $where             .= " AND cc.validated_at < to_timestamp(:before)";
            $params['before']   = $beforeTs;
        }

        $stmt = Database::pdo()->prepare(self::SELECT . "
            WHERE $where
            GROUP BY c.id, cc.city_id, cc.created_by, cc.guest_id,
                     cc.title, cc.challenge_type, cc.audience, cc.status,
                     cc.max_participants, cc.return_clause,
                     cc.mode, cc.challenge_format, cc.target_city_id, cc.proof_requirements, cc.validation_method,
                     cc.is_campaign, cc.visibility,
            cc.closed_to_new_joins,
                     cc.meet_at, cc.meet_ends_at, cc.venue, cc.venue_lat, cc.venue_lng,
                     cc.validated_at, cc.created_at,
                     u.display_name, u.username,
                     u.profile_thumb_photo_url, u.profile_photo_url,
                     u.monthly_rank_in_city, u.monthly_rank_worldwide, u.score_month_ref,
                     u.score_alltime, u.current_city_id,
                     ac.acceptor_user_id, ac.phase, ac.acceptance_id, au.display_name,
                     au.profile_thumb_photo_url, au.profile_photo_url,
                     au.current_city_id, au.score_alltime,
                     au.monthly_rank_in_city, au.monthly_rank_worldwide, au.score_month_ref
            ORDER BY cc.validated_at DESC NULLS LAST, cc.created_at DESC
            LIMIT $limit
        ");
        $stmt->execute($params);
        $rows = $stmt->fetchAll();
        if (empty($rows)) return [];

        return self::enrichWithParticipants(array_map(static fn(array $r): array => self::format($r), $rows));
    }

    /**
     * Public "Success challenges" showcase - completed, well-rated challenges
     * for discovery. GLOBAL by default; pass $cityId ('city_N') to filter to a
     * city (origin OR target). PUBLIC visibility only (it's a public, guest-
     * readable surface). A challenge qualifies when it has been rated by BOTH
     * parties (visible_ratings → revealed) with an AVERAGE of >= $minStars.
     * Returns a lean showcase DTO per card: title, creator + country, mode,
     * avg stars, a comment preview (the longest visible note), and the approved
     * photo proof (international only). Cursor-paginated by completion time.
     */
    public static function getShowcase(?string $cityId, int $limit = 30, ?int $before = null, float $minStars = 3.0): array
    {
        $limit    = max(1, min(50, $limit));
        $minStars = max(1.0, min(5.0, $minStars));
        $minStarsSql = number_format($minStars, 2, '.', '');

        $params      = [];
        $cityClause  = '';
        if ($cityId !== null && $cityId !== '' && preg_match('/^city_\d+$/', $cityId)) {
            $cityClause      = ' AND (cc.city_id = :city OR cc.target_city_id = :city)';
            $params['city']  = $cityId;
        }
        $beforeClause = '';
        if ($before !== null) {
            $beforeClause     = ' AND r.completed_at < to_timestamp(:before)';
            $params['before'] = $before;
        }

        // r = both-rated ratings per challenge (the trigger only flips
        // phase='approved' once both parties rate, so an entry here is a
        // completed challenge). avg + count + the longest non-empty comment.
        $sql = "
            SELECT c.id AS channel_id, cc.title, cc.challenge_type, cc.mode,
                   cc.city_id, cc.target_city_id, cc.created_by,
                   u.display_name AS creator_display_name,
                   COALESCE(u.profile_thumb_photo_url, u.profile_photo_url) AS creator_thumb_avatar_url,
                   ac.acceptor_user_id,
                   au.display_name AS acceptor_display_name,
                   COALESCE(au.profile_thumb_photo_url, au.profile_photo_url) AS acceptor_thumb_avatar_url,
                   au.current_city_id AS acceptor_city_id,
                   r.avg_stars, r.rating_count, r.comment,
                   -- Each side's own note, so the preview can attribute them by
                   -- name (challenger said X, taker said Y).
                   (SELECT vc.comment FROM visible_ratings vc
                      WHERE vc.challenge_id = cc.channel_id AND vc.rater_id = cc.created_by
                        AND COALESCE(vc.comment, '') <> '' LIMIT 1) AS creator_comment,
                   (SELECT va.comment FROM visible_ratings va
                      WHERE va.challenge_id = cc.channel_id AND va.rater_id = ac.acceptor_user_id
                        AND COALESCE(va.comment, '') <> '' LIMIT 1) AS acceptor_comment,
                   EXTRACT(EPOCH FROM r.completed_at)::INTEGER AS completed_ts,
                   pr.media_url AS proof_media_url, pr.media_type AS proof_media_type
            FROM channel_challenges cc
            JOIN channels c ON c.id = cc.channel_id AND c.status = 'active'
            LEFT JOIN users u ON u.id = cc.created_by
            JOIN (
                SELECT vr.challenge_id,
                       AVG(vr.stars)        AS avg_stars,
                       COUNT(*)             AS rating_count,
                       MAX(vr.created_at)   AS completed_at,
                       (SELECT v2.comment FROM visible_ratings v2
                         WHERE v2.challenge_id = vr.challenge_id AND COALESCE(v2.comment, '') <> ''
                         ORDER BY length(v2.comment) DESC LIMIT 1) AS comment
                FROM visible_ratings vr
                GROUP BY vr.challenge_id
                HAVING AVG(vr.stars) >= $minStarsSql
            ) r ON r.challenge_id = cc.channel_id
            LEFT JOIN LATERAL (
                SELECT a.id AS acceptance_id, a.acceptor_user_id
                FROM challenge_acceptances a
                WHERE a.challenge_id = cc.channel_id AND a.phase = 'approved'
                ORDER BY a.approved_at DESC NULLS LAST LIMIT 1
            ) ac ON true
            LEFT JOIN users au ON au.id = ac.acceptor_user_id
            LEFT JOIN LATERAL (
                SELECT p.media_url, p.media_type
                FROM challenge_proofs p
                WHERE p.acceptance_id = ac.acceptance_id AND p.status = 'approved'
                ORDER BY p.submitted_at DESC LIMIT 1
            ) pr ON true
            WHERE cc.visibility = 'public'$cityClause$beforeClause
            -- Showcase prioritises challenges that have photo proof (more
            -- compelling for discovery), then most-recently completed.
            ORDER BY (pr.media_url IS NOT NULL) DESC, r.completed_at DESC
            LIMIT $limit
        ";
        $stmt = Database::pdo()->prepare($sql);
        $stmt->execute($params);
        $rows = $stmt->fetchAll();

        // GROUP photo-proof winners resolve via pick-winner (no mutual rating),
        // so they never hit the visible_ratings JOIN above and were missing from
        // the showcase. Pull them separately - the winner's approved proof is the
        // photo, the winner is the "acceptor", no star rating. Then merge + sort.
        $groupBefore = ($before !== null) ? ' AND cc.validated_at < to_timestamp(:before)' : '';
        $groupSql = "
            SELECT c.id AS channel_id, cc.title, cc.challenge_type, cc.mode,
                   cc.city_id, cc.target_city_id, cc.created_by,
                   u.display_name AS creator_display_name,
                   COALESCE(u.profile_thumb_photo_url, u.profile_photo_url) AS creator_thumb_avatar_url,
                   w.user_id AS acceptor_user_id,
                   au.display_name AS acceptor_display_name,
                   COALESCE(au.profile_thumb_photo_url, au.profile_photo_url) AS acceptor_thumb_avatar_url,
                   au.current_city_id AS acceptor_city_id,
                   -- Real host rating when the challenger left one (photo reveal
                   -- modal); else 5.0 fallback (a won contest = top success), NOT
                   -- null - the live mobile build does avg_stars.toFixed(1) with
                   -- no null guard and would crash.
                   COALESCE(cc.host_rating::numeric, 5.0) AS avg_stars,
                   CASE WHEN cc.host_rating IS NOT NULL THEN 1 ELSE 0 END AS rating_count,
                   cc.host_comment AS comment,
                   -- Attribute: challenger's host note + the winner's own taker note.
                   cc.host_comment AS creator_comment, wa.taker_comment AS acceptor_comment,
                   EXTRACT(EPOCH FROM cc.validated_at)::INTEGER AS completed_ts,
                   pr.media_url AS proof_media_url, pr.media_type AS proof_media_type
            FROM channel_challenges cc
            JOIN channels c ON c.id = cc.channel_id AND c.status = 'active'
            LEFT JOIN users u ON u.id = cc.created_by
            JOIN LATERAL (
                SELECT se.user_id, se.acceptance_id
                FROM score_events se
                WHERE se.challenge_id = cc.channel_id AND se.kind = 'winner'
                ORDER BY se.created_at DESC LIMIT 1
            ) w ON true
            LEFT JOIN users au ON au.id = w.user_id
            LEFT JOIN challenge_acceptances wa ON wa.id = w.acceptance_id
            LEFT JOIN LATERAL (
                SELECT p.media_url, p.media_type
                FROM challenge_proofs p
                WHERE p.acceptance_id = w.acceptance_id AND p.status = 'approved'
                ORDER BY p.submitted_at DESC LIMIT 1
            ) pr ON true
            WHERE cc.visibility = 'public'
              AND cc.challenge_format = 'group'
              AND cc.status = 'validated'
              AND pr.media_url IS NOT NULL$cityClause$groupBefore
            ORDER BY cc.validated_at DESC
            LIMIT $limit
        ";
        $gstmt = Database::pdo()->prepare($groupSql);
        $gstmt->execute($params);
        $rows = array_merge($rows, $gstmt->fetchAll());

        // GROUP meet challenges have no winner proof; they're surfaced here when
        // the challenger left a host_rating (>= minStars) and the channel has at
        // least one shared photo to use as the card image. The rating is the
        // real star (no fabricated 5.0). The "acceptor" slot shows one present
        // taker so the card still reads as a two-person success.
        $meetSql = "
            SELECT c.id AS channel_id, cc.title, cc.challenge_type, cc.mode,
                   cc.city_id, cc.target_city_id, cc.created_by,
                   u.display_name AS creator_display_name,
                   COALESCE(u.profile_thumb_photo_url, u.profile_photo_url) AS creator_thumb_avatar_url,
                   pt.user_id AS acceptor_user_id,
                   au.display_name AS acceptor_display_name,
                   COALESCE(au.profile_thumb_photo_url, au.profile_photo_url) AS acceptor_thumb_avatar_url,
                   au.current_city_id AS acceptor_city_id,
                   cc.host_rating::numeric AS avg_stars, 1 AS rating_count, cc.host_comment AS comment,
                   -- Attribute: challenger's host note + the present taker's own note.
                   cc.host_comment AS creator_comment, pt.taker_comment AS acceptor_comment,
                   EXTRACT(EPOCH FROM cc.validated_at)::INTEGER AS completed_ts,
                   img.image_url AS proof_media_url, 'image' AS proof_media_type
            FROM channel_challenges cc
            JOIN channels c ON c.id = cc.channel_id AND c.status = 'active'
            LEFT JOIN users u ON u.id = cc.created_by
            JOIN LATERAL (
                SELECT m.image_url FROM messages m
                WHERE m.channel_id = cc.channel_id AND m.type = 'image' AND m.image_url IS NOT NULL
                ORDER BY m.created_at DESC LIMIT 1
            ) img ON true
            LEFT JOIN LATERAL (
                SELECT a.acceptor_user_id AS user_id, a.taker_comment FROM challenge_acceptances a
                WHERE a.challenge_id = cc.channel_id AND a.phase = 'present'
                ORDER BY a.updated_at DESC LIMIT 1
            ) pt ON true
            LEFT JOIN users au ON au.id = pt.user_id
            WHERE cc.visibility = 'public'
              AND cc.challenge_format  = 'group'
              AND cc.validation_method = 'meet'
              AND cc.status            = 'validated'
              AND cc.host_rating IS NOT NULL
              AND cc.host_rating >= $minStarsSql$cityClause$groupBefore
            ORDER BY cc.validated_at DESC
            LIMIT $limit
        ";
        $mstmt = Database::pdo()->prepare($meetSql);
        $mstmt->execute($params);
        $rows = array_merge($rows, $mstmt->fetchAll());

        // De-dupe by challenge: a single challenge can match more than one branch
        // (e.g. an international group challenge with BOTH mutual ratings AND a
        // winner proof), which surfaced the same card twice. Keep the first match
        // - branches are merged legacy → photo → meet, and legacy carries the
        // richest data (real ratings + both-side comments).
        $seenChallenge = [];
        $rows = array_values(array_filter($rows, static function (array $r) use (&$seenChallenge): bool {
            $cid = $r['channel_id'] ?? null;
            if ($cid === null || isset($seenChallenge[$cid])) return false;
            $seenChallenge[$cid] = true;
            return true;
        }));

        $mapped = array_map(static function (array $r): array {
            return [
                'id'                        => $r['channel_id'],
                'title'                     => $r['title'],
                'challenge_type'            => $r['challenge_type'],
                'mode'                      => $r['mode'] ?? 'local',
                'created_by'                => $r['created_by'],
                'creator_display_name'      => $r['creator_display_name'],
                'creator_thumb_avatar_url'  => R2Uploader::thumbProxy($r['creator_thumb_avatar_url']),
                'country'                   => self::countryForCityId($r['city_id']),
                'city_name'                 => self::cityNameForCityId($r['city_id']),
                'target_country'            => $r['target_city_id'] ? self::countryForCityId($r['target_city_id']) : null,
                'target_city_name'          => $r['target_city_id'] ? self::cityNameForCityId($r['target_city_id']) : null,
                'acceptor_user_id'          => $r['acceptor_user_id'],
                'acceptor_display_name'     => $r['acceptor_display_name'],
                'acceptor_thumb_avatar_url' => R2Uploader::thumbProxy($r['acceptor_thumb_avatar_url']),
                'acceptor_country'          => $r['acceptor_city_id'] ? self::countryForCityId($r['acceptor_city_id']) : null,
                // null for group winners (no star rating) - the card hides the pill.
                'avg_stars'                 => $r['avg_stars'] !== null ? round((float) $r['avg_stars'], 1) : null,
                'rating_count'              => (int) $r['rating_count'],
                'comment'                   => $r['comment'],
                'creator_comment'           => $r['creator_comment'],
                'acceptor_comment'          => $r['acceptor_comment'],
                'proof_media_url'           => $r['proof_media_url'],
                'proof_media_type'          => $r['proof_media_type'],
                'completed_at'              => (int) $r['completed_ts'],
            ];
        }, $rows);

        // Same order as the legacy query: photo-proof first, then most recent.
        usort($mapped, static function (array $a, array $b): int {
            $ap = $a['proof_media_url'] ? 1 : 0;
            $bp = $b['proof_media_url'] ? 1 : 0;
            if ($ap !== $bp) return $bp <=> $ap;
            return $b['completed_at'] <=> $a['completed_at'];
        });
        return array_slice($mapped, 0, $limit);
    }

    /**
     * Real, recently-resolved GROUP challenges with a human-readable point
     * breakdown - the "See 3 real examples" teaching surface. For each challenge
     * we aggregate score_events into structured lines (who earned what) the
     * client localizes + renders. Public, anonymous-readable.
     */
    public static function getExamples(int $limit = 3): array
    {
        $limit = max(1, min(5, $limit));
        $pdo   = Database::pdo();

        // Recent validated PUBLIC group challenges that actually credited points.
        $stmt = $pdo->prepare("
            SELECT cc.channel_id, cc.title, cc.challenge_type, cc.validation_method, cc.mode,
                   cc.created_by, u.display_name AS creator_name
            FROM channel_challenges cc
            JOIN channels c ON c.id = cc.channel_id AND c.status = 'active'
            LEFT JOIN users u ON u.id = cc.created_by
            WHERE cc.visibility = 'public'
              AND cc.challenge_format = 'group'
              AND cc.status = 'validated'
              AND EXISTS (SELECT 1 FROM score_events se WHERE se.challenge_id = cc.channel_id)
            ORDER BY cc.validated_at DESC
            LIMIT " . $limit);
        $stmt->execute();
        $challenges = $stmt->fetchAll(\PDO::FETCH_ASSOC) ?: [];

        $out = [];
        foreach ($challenges as $ch) {
            $cid     = $ch['channel_id'];
            $creator = $ch['creator_name'] ?? 'The challenger';
            $isPhoto = ($ch['validation_method'] ?? 'meet') === 'photo_proof' || ($ch['mode'] ?? 'local') === 'international';

            $ev = $pdo->prepare("
                SELECT se.kind, se.points, se.user_id, u.display_name
                FROM score_events se
                LEFT JOIN users u ON u.id = se.user_id
                WHERE se.challenge_id = ?
            ");
            $ev->execute([$cid]);
            $events = $ev->fetchAll(\PDO::FETCH_ASSOC) ?: [];

            $winnerName = null; $winnerPts = 0;
            $presentUsers = []; $presentPts = 0;
            $submitUsers = [];  $submitPts = 0;
            $createdPts = 0;
            $hostPts = 0;
            foreach ($events as $e) {
                $k = $e['kind']; $p = (int) $e['points'];
                if ($k === 'winner')           { $winnerName = $e['display_name']; $winnerPts = $p; }
                elseif ($k === 'present')      { $presentUsers[$e['user_id']] = true; $presentPts = $p ?: $presentPts; }
                elseif ($k === 'submission')   { $submitUsers[$e['user_id']] = true; $submitPts = $p ?: $submitPts; }
                elseif ($k === 'challenge_created') { $createdPts += $p; }
                elseif (in_array($k, ['present_host_base', 'present_host', 'photo_host'], true)) { $hostPts += $p; }
            }

            // Structured lines (client maps kind → localized label + icon).
            $lines = [];
            if ($createdPts > 0) $lines[] = ['kind' => 'created', 'name' => $creator, 'points' => $createdPts];
            if ($isPhoto) {
                if (count($submitUsers) > 0) $lines[] = ['kind' => 'submission', 'count' => count($submitUsers), 'points' => $submitPts ?: 5, 'per' => true];
                if ($winnerName !== null)    $lines[] = ['kind' => 'winner', 'name' => $winnerName, 'points' => $winnerPts ?: 40];
            } else {
                if (count($presentUsers) > 0) $lines[] = ['kind' => 'present', 'count' => count($presentUsers), 'points' => $presentPts ?: 40, 'per' => true];
            }
            if ($hostPts > 0) $lines[] = ['kind' => 'host', 'name' => $creator, 'points' => $hostPts];

            $out[] = [
                'id'          => $cid,
                'title'       => $ch['title'],
                'type'        => $ch['challenge_type'],
                'format'      => $isPhoto ? 'photo' : 'meet',
                'creatorName' => $creator,
                'lines'       => $lines,
            ];
        }
        return $out;
    }

    /**
     * Single-challenge detail. When $viewerUserId is provided, the visibility
     * clause hides friends/private rows the viewer can't see - caller treats
     * a null return as 404 (same as deleted/never-existed). Default null
     * viewer = anonymous, so callers that DON'T pass a viewer effectively
     * see public-only. Crawlers + the prerender pipeline hit this path.
     */
    public static function findById(string $challengeId, ?string $viewerUserId = null): ?array
    {
        $visClause = self::visibilityWhereClause($viewerUserId);
        $params    = ['id' => $challengeId];
        if ($viewerUserId !== null) $params['viewer_id'] = $viewerUserId;

        $stmt = Database::pdo()->prepare(self::SELECT . "
            WHERE c.id     = :id
              AND c.status = 'active'
              AND $visClause
            GROUP BY c.id, cc.city_id, cc.created_by, cc.guest_id,
                     cc.title, cc.challenge_type, cc.audience, cc.status,
                     cc.max_participants, cc.return_clause,
                     cc.mode, cc.challenge_format, cc.target_city_id, cc.proof_requirements, cc.validation_method,
                     cc.is_campaign, cc.visibility,
            cc.closed_to_new_joins,
                     cc.meet_at, cc.meet_ends_at, cc.venue, cc.venue_lat, cc.venue_lng,
                     cc.validated_at, cc.created_at,
                     u.display_name, u.username,
                     u.profile_thumb_photo_url, u.profile_photo_url,
                     u.monthly_rank_in_city, u.monthly_rank_worldwide, u.score_month_ref,
                     u.score_alltime, u.current_city_id,
                     ac.acceptor_user_id, ac.phase, ac.acceptance_id, au.display_name,
                     au.profile_thumb_photo_url, au.profile_photo_url,
                     au.current_city_id, au.score_alltime,
                     au.monthly_rank_in_city, au.monthly_rank_worldwide, au.score_month_ref
        ");
        $stmt->execute($params);
        $row = $stmt->fetch();
        if (!$row) return null;

        $item                       = self::format($row);
        $item['participant_count']  = self::participantCount($challengeId);
        $item['participants_preview'] = self::participantPreview($challengeId, 5);
        return $item;
    }

    /**
     * Server-internal lookup that bypasses the visibility gate. Use only for
     * authorisation flows that need to know the row exists regardless of who
     * the caller is (e.g. take-on accept, proof submit, mutual-private flow,
     * anonymization). Callers must apply their own access check after.
     */
    public static function findByIdUnchecked(string $challengeId): ?array
    {
        $stmt = Database::pdo()->prepare(self::SELECT . "
            WHERE c.id     = :id
              AND c.status = 'active'
            GROUP BY c.id, cc.city_id, cc.created_by, cc.guest_id,
                     cc.title, cc.challenge_type, cc.audience, cc.status,
                     cc.max_participants, cc.return_clause,
                     cc.mode, cc.challenge_format, cc.target_city_id, cc.proof_requirements, cc.validation_method,
                     cc.is_campaign, cc.visibility,
            cc.closed_to_new_joins,
                     cc.meet_at, cc.meet_ends_at, cc.venue, cc.venue_lat, cc.venue_lng,
                     cc.validated_at, cc.created_at,
                     u.display_name, u.username,
                     u.profile_thumb_photo_url, u.profile_photo_url,
                     u.monthly_rank_in_city, u.monthly_rank_worldwide, u.score_month_ref,
                     u.score_alltime, u.current_city_id,
                     ac.acceptor_user_id, ac.phase, ac.acceptance_id, au.display_name,
                     au.profile_thumb_photo_url, au.profile_photo_url,
                     au.current_city_id, au.score_alltime,
                     au.monthly_rank_in_city, au.monthly_rank_worldwide, au.score_month_ref
        ");
        $stmt->execute(['id' => $challengeId]);
        $row = $stmt->fetch();
        if (!$row) return null;

        $item                         = self::format($row);
        $item['participant_count']    = self::participantCount($challengeId);
        $item['participants_preview'] = self::participantPreview($challengeId, 5);
        return $item;
    }

    /**
     * Challenges a user created OR accepted - for the profile "Challenges" tab.
     * Includes is_owner flag. Most-recent first.
     *
     * Acceptance is sourced from BOTH:
     *   - challenge_participants (legacy pooled-acceptance model) - kept for
     *     back-compat with any pre-1:1 rows still in the table.
     *   - challenge_acceptances (the 1:1 take-on model used since PR2) -
     *     covers everyone who took on a challenge via the new flow.
     * Without the second EXISTS, the profile would silently omit every
     * challenge taken on after the model switch.
     */
    public static function getByUser(string $userId, ?string $viewerUserId = null): array
    {
        $pdo  = Database::pdo();
        // Visibility gating happens against the VIEWER (the person browsing
        // the profile), not the profile-owner. Helper expects `cc`/`c`
        // aliases in scope - they are.
        $visClause = self::visibilityWhereClause($viewerUserId);
        $params    = ['owner_id' => $userId, 'part_id' => $userId, 'acc_id' => $userId];
        if ($viewerUserId !== null) $params['viewer_id'] = $viewerUserId;

        $stmt = $pdo->prepare("
            SELECT c.id, cc.city_id, cc.created_by, cc.guest_id, cc.title,
                   cc.challenge_type, cc.audience, cc.status,
                   cc.max_participants, cc.return_clause,
                   cc.mode, cc.target_city_id, cc.proof_requirements, cc.validation_method,
                   cc.visibility,
            cc.closed_to_new_joins,
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
              AND $visClause
            ORDER BY cc.created_at DESC
            LIMIT 50
        ");
        $stmt->execute($params);
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
                'validation_method'  => $ch['validation_method']  ?? 'meet',
                'visibility'         => $ch['visibility']         ?? 'public',
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
    // 'global' = a Hilads campaign shown in EVERY city's feed (no single origin
    // audience). Only meaningful together with is_campaign; created from the
    // admin back-office. Rooted in an origin city channel like any challenge,
    // but getByCity() surfaces it for all cities.
    public const ALLOWED_MODES         = ['local', 'international', 'global'];
    /** Validation methods. International is locked to photo_proof in the
     *  create/update routes regardless of input. Local creators pick. */
    public const ALLOWED_VALIDATION_METHODS = ['meet', 'photo_proof'];
    /** Values acceptable at CREATE / EDIT time. 'private' is intentionally
     *  excluded - it's reachable only via the mutual privacy_requests flow
     *  (PR #4). Smuggling it via the body would bypass the mutual gate. */
    public const ALLOWED_VISIBILITIES_AT_INPUT = ['public', 'friends'];

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
        ?string $proofRequirements = null,
        string $visibility = 'public',
        string $validationMethod = 'meet',
        ?array $group = null,
        bool $isCampaign = false
    ): array {
        if (!in_array($challengeType, self::ALLOWED_TYPES,     true)) $challengeType = 'food';
        if (!in_array($audience,      self::ALLOWED_AUDIENCES, true)) $audience      = 'locals';
        if (!in_array($mode,          self::ALLOWED_MODES,     true)) $mode          = 'local';
        if (!in_array($visibility,    self::ALLOWED_VISIBILITIES_AT_INPUT, true)) $visibility = 'public';
        if (!in_array($validationMethod, self::ALLOWED_VALIDATION_METHODS, true)) $validationMethod = 'meet';
        // International is always photo_proof - the route should already
        // have forced it, but defense in depth so a misbehaving caller
        // can't smuggle a 'meet' international row.
        if ($mode === 'international') $validationMethod = 'photo_proof';

        // Normalize return_clause: trim, treat empty string as null. Client is
        // expected to send the per-type template pre-filled; nulls fall back to
        // a generic clause at the display layer.
        $returnClause = $returnClause !== null ? trim($returnClause) : null;
        if ($returnClause === '') $returnClause = null;

        // International-mode hygiene:
        //   - target_city_id only meaningful when mode='international'; force
        //     null for local so a misbehaving client can't smuggle a target.
        //   - proof_requirements same logic - local stores nothing.
        //   - audience is irrelevant for international (no in-person meetup);
        //     keep the column populated (NOT NULL) but force a stable value
        //     so int'l rows don't accidentally surface in audience-filtered
        //     queries written for local.
        //   - visibility forced 'public' on international (defeats cross-city
        //     model otherwise - covered in the spec, enforced server-side).
        if ($mode !== 'international') {
            $targetCityId      = null;
            $proofRequirements = null;
        } else {
            $proofRequirements = $proofRequirements !== null ? trim($proofRequirements) : null;
            if ($proofRequirements === '') $proofRequirements = null;
            $visibility = 'public';
        }

        // Group model: a LOCAL MEET challenge created with a meet date becomes a
        // 'group' challenge (date + location set at creation, multiple joiners,
        // challenger validates presence). Everything else stays 'legacy' for now
        // (international + the photo-proof group track land later).
        $format     = 'legacy';
        $meetAt     = null; $meetEndsAt = null; $venue = null; $venueLat = null; $venueLng = null;
        $wantsGroup = is_array($group) && ($group['format'] ?? null) === 'group';
        // MEET group: local + meet → date + place. PHOTO-PROOF group: photo_proof
        // (local or international) → meet_at doubles as the submission DEADLINE,
        // no venue (it's at a distance).
        $isGroupMeet  = $wantsGroup && $mode === 'local' && $validationMethod === 'meet';
        $isGroupPhoto = $wantsGroup && $validationMethod === 'photo_proof';
        if ($isGroupMeet || $isGroupPhoto) {
            $format     = 'group';
            $meetAt     = isset($group['meet_at'])      ? (int) $group['meet_at']      : null;
            $meetEndsAt = isset($group['meet_ends_at']) ? (int) $group['meet_ends_at'] : null;
            if ($isGroupMeet) {
                $venue    = isset($group['venue'])     ? (trim((string) $group['venue']) ?: null) : null;
                $venueLat = isset($group['venue_lat']) && $group['venue_lat'] !== null ? (float) $group['venue_lat'] : null;
                $venueLng = isset($group['venue_lng']) && $group['venue_lng'] !== null ? (float) $group['venue_lng'] : null;
            }
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

        // expires_at uses the table default (2999 sentinel) - challenges are persistent.
        // max_participants column kept for back-compat (one-release reversible
        // path) but no longer written - the DB default fills it. The new model
        // is 1:1: one challenge has at most one active acceptance at a time;
        // commit 2 wires that gate. The column will be dropped in a separate
        // migration once the new model has run stable.
        $pdo->prepare("
            INSERT INTO channel_challenges
                (channel_id, city_id, created_by, guest_id, title, challenge_type, audience, status, return_clause,
                 mode, target_city_id, proof_requirements, validation_method, visibility,
                 challenge_format, meet_at, meet_ends_at, venue, venue_lat, venue_lng, is_campaign)
            VALUES
                (:channel_id, :city_id, :created_by, :guest_id, :title, :challenge_type, :audience, 'open', :return_clause,
                 :mode, :target_city_id, :proof_requirements, :validation_method, :visibility,
                 :format, to_timestamp(:meet_at), to_timestamp(:meet_ends_at), :venue, :venue_lat, :venue_lng, :is_campaign)
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
            'validation_method'  => $validationMethod,
            'visibility'         => $visibility,
            'format'             => $format,
            'meet_at'            => $meetAt,
            'meet_ends_at'       => $meetEndsAt,
            'venue'              => $venue,
            'venue_lat'          => $venueLat,
            'venue_lng'          => $venueLng,
            'is_campaign'        => $isCampaign ? 'true' : 'false',
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
            'visibility'           => $visibility,
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
     * Status cannot be flipped here - use validate() instead.
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
        ?string $proofRequirements = null,
        ?string $visibility = null,
        ?string $validationMethod = null
    ): ?array {
        if (!self::ownerCheck($challengeId, $guestId, $userId)) return null;

        if (!in_array($challengeType, self::ALLOWED_TYPES,     true)) $challengeType = 'food';
        if (!in_array($audience,      self::ALLOWED_AUDIENCES, true)) $audience      = 'locals';

        $returnClause = $returnClause !== null ? trim($returnClause) : null;
        if ($returnClause === '') $returnClause = null;

        // Mode is intentionally NOT editable here - flipping mode mid-flight
        // would invalidate any in-flight acceptances (local-style phases vs
        // international's proof flow). If a creator wants the other mode, the
        // expected path is delete + recreate. We do let International creators
        // re-target the city + adjust the proof requirements (common edits).
        $pdo = Database::pdo();
        $modeRow = $pdo->prepare("SELECT mode, visibility FROM channel_challenges WHERE channel_id = :id");
        $modeRow->execute(['id' => $challengeId]);
        $current = $modeRow->fetch(\PDO::FETCH_ASSOC) ?: ['mode' => 'local', 'visibility' => 'public'];
        $currentMode       = $current['mode']       ?: 'local';
        $currentVisibility = $current['visibility'] ?: 'public';

        if ($currentMode !== 'international') {
            // Local rows ignore international-only fields on edit.
            $targetCityId      = null;
            $proofRequirements = null;
        } else {
            $proofRequirements = $proofRequirements !== null ? trim($proofRequirements) : null;
            if ($proofRequirements === '') $proofRequirements = null;
        }

        // Visibility-on-edit rules:
        //   - International stays 'public' forever - block any attempt to
        //     flip it from the edit form (defence in depth; the route layer
        //     also rejects).
        //   - Local can toggle between 'public' and 'friends' here.
        //   - 'private' is NOT settable at edit time - only via the mutual
        //     privacy_requests flow in PR #4. If the row is already 'private'
        //     (from the mutual flow), the creator can still revert it back
        //     to 'public' or 'friends' via this edit path; the mutual flow
        //     is one-way "open the private door together", not a lock.
        //   - When the client omits visibility entirely, keep the current
        //     value (typical edit doesn't touch visibility).
        $nextVisibility = $currentVisibility;
        if ($visibility !== null) {
            if ($currentMode === 'international') {
                $nextVisibility = 'public';
            } elseif (in_array($visibility, self::ALLOWED_VISIBILITIES_AT_INPUT, true)) {
                $nextVisibility = $visibility;
            }
            // unrecognised value → silently keep current (already validated upstream too)
        }

        // Validation method - editable on LOCAL rows (meet ⇄ photo_proof), which
        // swaps the whole pipeline (Date/Meet vs Proof/Verdict). International is
        // always photo_proof, so force it there. null = don't change.
        $nextValidation = null;
        if ($currentMode === 'international') {
            $nextValidation = 'photo_proof';
        } elseif ($validationMethod !== null && in_array($validationMethod, ['meet', 'photo_proof'], true)) {
            $nextValidation = $validationMethod;
        }

        $pdo->prepare("
            UPDATE channel_challenges
            SET title              = :t,
                challenge_type     = :tp,
                audience           = :a,
                return_clause      = :rc,
                target_city_id     = :tci,
                proof_requirements = :pr,
                visibility         = :viz,
                validation_method  = COALESCE(:vm, validation_method),
                updated_at         = now()
            WHERE channel_id = :id
        ")->execute([
            't'   => $title,
            'tp'  => $challengeType,
            'a'   => $audience,
            'rc'  => $returnClause,
            'tci' => $targetCityId,
            'pr'  => $proofRequirements,
            'viz' => $nextVisibility,
            'vm'  => $nextValidation,
            'id'  => $challengeId,
        ]);

        // Keep the channel name in sync with the title (used as display name).
        $pdo->prepare("UPDATE channels SET name = :n, updated_at = now() WHERE id = :id")
            ->execute(['n' => $title, 'id' => $challengeId]);

        return self::findById($challengeId);
    }

    /**
     * Relaunch an ended challenge: restart it with the SAME countdown the creator
     * set the first time. The original duration = meet_at - created_at; the new
     * deadline is now + that duration, so a "3-day submission" challenge gets a
     * fresh 3 days. created_at is bumped to now so the duration stays stable across
     * repeated relaunches (and the challenge resurfaces as freshly active). The
     * "Ended" state is derived purely from meet_at < now, so this reopens it.
     * Creator-only. Returns the updated row, or null if not found / not the owner.
     */
    public static function relaunch(
        string $challengeId,
        string $guestId,
        ?string $userId
    ): ?array {
        if (!self::ownerCheck($challengeId, $guestId, $userId)) return null;

        $pdo = Database::pdo();
        $cur = $pdo->prepare("
            SELECT EXTRACT(EPOCH FROM meet_at)::BIGINT      AS meet_at,
                   EXTRACT(EPOCH FROM meet_ends_at)::BIGINT AS meet_ends_at,
                   EXTRACT(EPOCH FROM created_at)::BIGINT   AS created_at
            FROM channel_challenges WHERE channel_id = :id
        ");
        $cur->execute(['id' => $challengeId]);
        $row = $cur->fetch(\PDO::FETCH_ASSOC) ?: [];

        $origMeet    = isset($row['meet_at'])      ? (int) $row['meet_at']      : null;
        $origEnds    = isset($row['meet_ends_at']) ? (int) $row['meet_ends_at'] : null;
        $origCreated = isset($row['created_at'])   ? (int) $row['created_at']   : null;

        $now      = time();
        // Same countdown as originally set. Clamp to ≥1h; fall back to 7 days if
        // the row somehow has no meet date.
        $duration = ($origMeet !== null && $origCreated !== null)
            ? max(3600, $origMeet - $origCreated)
            : 604800;
        $window   = ($origEnds !== null && $origMeet !== null && $origEnds > $origMeet)
            ? ($origEnds - $origMeet)
            : 10800;

        $newMeet = $now + $duration;
        $newEnds = $newMeet + $window;

        $pdo->prepare("
            UPDATE channel_challenges
            SET meet_at      = to_timestamp(:m),
                meet_ends_at = to_timestamp(:e),
                created_at   = now(),
                updated_at   = now()
            WHERE channel_id = :id
        ")->execute(['m' => $newMeet, 'e' => $newEnds, 'id' => $challengeId]);

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
     * Internal-only - flip visibility directly, bypassing the owner gate
     * and the "private not allowed at input" rule that update() enforces.
     *
     * The ONLY legitimate caller is the mutual go-private flow (route
     * /challenges/:id/privacy/vote, when both sides have voted 'agreed').
     * That flow runs in the acceptor's request, so the regular owner-gated
     * update() would reject it. We also need to actually write 'private'
     * here, which update() filters out.
     *
     * Allowed values: 'public', 'friends', 'private'. Anything else is a
     * no-op (defensive - callers should validate at the route layer).
     */
    public static function setVisibility(string $challengeId, string $visibility): bool
    {
        if (!in_array($visibility, ['public', 'friends', 'private'], true)) {
            return false;
        }
        $pdo = Database::pdo();
        // International stays public - keep that invariant even on the
        // mutual-flow path. Returns 0 rows updated if the row is
        // international, which the caller can ignore (the flow shouldn't
        // have reached this method for an international row anyway, but
        // belt-and-braces).
        $stmt = $pdo->prepare("
            UPDATE channel_challenges
            SET visibility = :viz, updated_at = now()
            WHERE channel_id = :id AND mode != 'international'
        ");
        $stmt->execute(['viz' => $visibility, 'id' => $challengeId]);
        return $stmt->rowCount() > 0;
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
     * Owner check - accepts the request if EITHER the guest_id OR the
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
    // web cards, but semantically these are now "acceptors" - people who
    // took on the challenge via the new POST /accept flow.
    //
    // The creator is NOT in this list (they own the challenge, they don't
    // accept it). 'rejected' acceptances are excluded - the relationship
    // is closed, no longer an active "is taking on this challenge".

    public static function participantCount(string $challengeId): int
    {
        // DISTINCT user: a single acceptor who took, finished, and re-took the
        // challenge in successive rounds has two non-rejected rows. They're
        // one participant, not two.
        $stmt = Database::pdo()->prepare("
            SELECT COUNT(DISTINCT acceptor_user_id) FROM challenge_acceptances
            WHERE challenge_id = ? AND phase != 'rejected'
        ");
        $stmt->execute([$challengeId]);
        return (int) $stmt->fetchColumn();
    }

    /** Registered user_ids of a challenge's acceptors (push fan-out on validate). */
    public static function participantUserIds(string $challengeId): array
    {
        $stmt = Database::pdo()->prepare("
            SELECT DISTINCT acceptor_user_id FROM challenge_acceptances
            WHERE challenge_id = ? AND phase != 'rejected'
        ");
        $stmt->execute([$challengeId]);
        return $stmt->fetchAll(\PDO::FETCH_COLUMN);
    }

    /** Up to $limit acceptor avatar previews (most-recent acceptance per user, newest first). */
    public static function participantPreview(string $challengeId, int $limit = 5): array
    {
        $limit = max(1, min(20, $limit));
        // PARTITION BY user → keep one row per user (the most-recent
        // acceptance). Otherwise a re-take after a finished round would
        // duplicate the same avatar in the preview strip.
        $stmt  = Database::pdo()->prepare("
            SELECT id, display_name, profile_thumb_photo_url, profile_photo_url FROM (
                SELECT u.id, u.display_name, u.profile_thumb_photo_url, u.profile_photo_url,
                       ca.created_at,
                       row_number() OVER (PARTITION BY ca.acceptor_user_id ORDER BY ca.created_at DESC) AS rn
                FROM challenge_acceptances ca
                JOIN users u ON u.id = ca.acceptor_user_id AND u.deleted_at IS NULL
                WHERE ca.challenge_id = ? AND ca.phase != 'rejected'
            ) t WHERE rn = 1
            ORDER BY created_at DESC
            LIMIT " . $limit);
        $stmt->execute([$challengeId]);
        return array_map(static fn(array $r): array => [
            'id'             => $r['id'],
            'displayName'    => $r['display_name'] ?? 'Member',
            'thumbAvatarUrl' => R2Uploader::thumbProxy($r['profile_thumb_photo_url'] ?? $r['profile_photo_url'] ?? null),
        ], $stmt->fetchAll(\PDO::FETCH_ASSOC));
    }

    /** Batched preview for the NOW feed (one windowed query). */
    public static function participantPreviewBatch(array $challengeIds, int $limit = 5): array
    {
        if (empty($challengeIds)) return [];
        $limit = max(1, min(20, $limit));
        $in    = implode(',', array_fill(0, count($challengeIds), '?'));
        // Two-stage window: first reduce to one row per (challenge, user) by
        // taking the latest acceptance, then rank within each challenge so
        // the per-row limit clips to N distinct users (not N acceptance rows).
        $stmt  = Database::pdo()->prepare("
            SELECT challenge_id, id, display_name, thumb_url, full_url FROM (
                SELECT challenge_id, id, display_name, thumb_url, full_url,
                       row_number() OVER (PARTITION BY challenge_id ORDER BY created_at DESC) AS rn
                FROM (
                    SELECT ca.challenge_id, u.id, u.display_name,
                           u.profile_thumb_photo_url AS thumb_url,
                           u.profile_photo_url       AS full_url,
                           ca.created_at,
                           row_number() OVER (PARTITION BY ca.challenge_id, ca.acceptor_user_id ORDER BY ca.created_at DESC) AS user_rn
                    FROM challenge_acceptances ca
                    JOIN users u ON u.id = ca.acceptor_user_id AND u.deleted_at IS NULL
                    WHERE ca.challenge_id IN ($in) AND ca.phase != 'rejected'
                ) latest_per_user WHERE user_rn = 1
            ) t WHERE rn <= " . $limit);
        $stmt->execute(array_values($challengeIds));
        $map = [];
        foreach ($stmt->fetchAll(\PDO::FETCH_ASSOC) as $r) {
            $map[$r['challenge_id']][] = [
                'id'             => $r['id'],
                'displayName'    => $r['display_name'] ?? 'Member',
                'thumbAvatarUrl' => R2Uploader::thumbProxy($r['thumb_url'] ?? $r['full_url'] ?? null),
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
            SELECT challenge_id, COUNT(DISTINCT acceptor_user_id) AS cnt
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
     * Distinct submitters per challenge - i.e. how many people actually uploaded
     * a photo (NOT how many joined). Powers the "{n} photos" count on group
     * photo-proof cards, which must reflect real submissions, not joins.
     */
    public static function submissionCountBatch(array $challengeIds): array
    {
        if (empty($challengeIds)) return [];
        $in   = implode(',', array_fill(0, count($challengeIds), '?'));
        $stmt = Database::pdo()->prepare("
            SELECT a.challenge_id, COUNT(DISTINCT a.acceptor_user_id) AS cnt
            FROM challenge_proofs p
            JOIN challenge_acceptances a ON a.id = p.acceptance_id
            WHERE a.challenge_id IN ($in)
            GROUP BY a.challenge_id
        ");
        $stmt->execute(array_values($challengeIds));
        $map = [];
        foreach ($stmt->fetchAll(\PDO::FETCH_ASSOC) as $r) {
            $map[$r['challenge_id']] = (int) $r['cnt'];
        }
        return $map;
    }

    /**
     * Full acceptor list for the members modal - canonical UserDTOs in
     * accept-order. PR2+ acceptors are always registered users (the new
     * /accept flow requires a session), so no guest branch here.
     * 'rejected' acceptances are excluded.
     */
    public static function getParticipants(string $challengeId): array
    {
        // PARTITION BY user → keep one row per user even when a re-take left
        // a second non-rejected acceptance behind. Order remains by FIRST
        // join time (oldest acceptance the user has on this challenge) so
        // the members list reflects when they first appeared.
        $stmt = Database::pdo()->prepare("
            SELECT user_id, joined_at, display_name, profile_photo_url, vibe, user_created_at FROM (
                SELECT ca.acceptor_user_id AS user_id,
                       EXTRACT(EPOCH FROM ca.created_at)::int AS joined_at,
                       CASE WHEN u.deleted_at IS NULL THEN u.display_name      ELSE NULL END AS display_name,
                       CASE WHEN u.deleted_at IS NULL THEN u.profile_photo_url ELSE NULL END AS profile_photo_url,
                       CASE WHEN u.deleted_at IS NULL THEN u.vibe              ELSE NULL END AS vibe,
                       CASE WHEN u.deleted_at IS NULL THEN u.created_at        ELSE NULL END AS user_created_at,
                       row_number() OVER (PARTITION BY ca.acceptor_user_id ORDER BY ca.created_at ASC) AS rn
                FROM challenge_acceptances ca
                LEFT JOIN users u ON u.id = ca.acceptor_user_id
                WHERE ca.challenge_id = ? AND ca.phase != 'rejected'
            ) t WHERE rn = 1
            ORDER BY joined_at ASC
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
            // Account was deleted after accepting - discreet placeholder so
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
        $subCounts = self::submissionCountBatch($ids);
        foreach ($challenges as &$c) {
            $c['participants_preview'] = $previews[$c['id']] ?? [];
            $c['participant_count']    = $counts[$c['id']]   ?? 0;
            $c['submission_count']     = $subCounts[$c['id']] ?? 0;
        }
        return $challenges;
    }

    public static function allowedTypes(): array     { return self::ALLOWED_TYPES; }
    public static function allowedAudiences(): array { return self::ALLOWED_AUDIENCES; }
    public static function allowedModes(): array     { return self::ALLOWED_MODES; }
    public static function allowedVisibilitiesAtInput(): array { return self::ALLOWED_VISIBILITIES_AT_INPUT; }

    /**
     * SQL fragment for the visibility WHERE clause. Goes inside the WHERE of
     * any query that lists challenges to a viewer. Caller must:
     *   - splice it into the WHERE,
     *   - bind :viewer_id to $viewerUserId when one is given (or skip the
     *     bind entirely for the anonymous branch),
     *   - have `cc` aliased to channel_challenges and `c` to channels in the
     *     surrounding query (the existing SELECT does both).
     *
     * Rules baked in:
     *   - anonymous viewer (crawler / signed-out)   → public only
     *   - registered viewer                          → public, or visibility=
     *     'friends' where the viewer is a friend of the creator OR a friend
     *     of an acceptor, or the viewer is the creator / acceptor themselves
     *     (this catches the visibility='private' case too - only participants
     *     ever see private rows).
     *
     * `user_friends` is symmetric (both directions inserted at friendship
     * acceptance - see FriendRequestRepository::insertFriendship), so the
     * EXISTS clauses only need a single direction.
     */
    public static function visibilityWhereClause(?string $viewerUserId): string
    {
        if ($viewerUserId === null) {
            return "cc.visibility = 'public'";
        }
        return "(
            cc.visibility = 'public'
            OR cc.created_by = :viewer_id
            OR EXISTS (
                SELECT 1 FROM challenge_acceptances ca_vis
                WHERE ca_vis.challenge_id = c.id
                  AND ca_vis.acceptor_user_id = :viewer_id
            )
            OR (cc.visibility = 'friends' AND (
                EXISTS (
                    SELECT 1 FROM user_friends f
                    WHERE f.user_id = :viewer_id AND f.friend_id = cc.created_by
                )
                OR EXISTS (
                    SELECT 1 FROM challenge_acceptances ca_fri
                    JOIN user_friends f ON f.user_id = :viewer_id
                                       AND f.friend_id = ca_fri.acceptor_user_id
                    WHERE ca_fri.challenge_id = c.id
                )
            ))
        )";
    }
}
