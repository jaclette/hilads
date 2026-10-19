<?php

declare(strict_types=1);

/**
 * Daily Challenge proofs: one photo per user per challenge.
 *
 * City and is_local are set here, server-side, from the poster's profile
 * (DailyRules::isLocalFor). New and edited proofs start as 'pending' and only
 * become visible to others once approved (moderation: prompt 04).
 */
final class DailyProofRepository
{
    public const CAPTION_MAX    = 140;
    public const PLACE_NAME_MAX = 80;

    /** Answer and Back home columns (DailyCompare::validateProofInput). */
    public const COMPARE_COLUMNS = [
        'answer_text', 'answer_number', 'answer_minutes',
        'home_city_id', 'home_city_name', 'home_country', 'home_answer_text', 'home_answer_number', 'home_answer_minutes',
        'home_price_amount', 'home_price_currency', 'home_line',
    ];

    private const SELECT = "
        SELECT p.*,
               dc.challenge_date, dc.theme AS challenge_theme, dc.compare_type, dc.compare_unit_i18n,
               dc.text_i18n AS challenge_text_i18n, dc.compare_question_i18n, dc.special_id AS challenge_special_id,
               u.username, u.display_name, u.profile_photo_url,
               ch.name AS city_name, cc.country AS city_country,
               wr.rank AS world_rank, cr.rank AS city_rank,
               (lp.user_id IS NOT NULL) AS author_local_pass,
               pl.name AS spot_name, pl.status AS spot_status
        FROM daily_proofs p
        JOIN daily_challenges dc ON dc.id = p.challenge_id
        JOIN users u             ON u.id  = p.user_id
        LEFT JOIN channels ch    ON ch.id = p.city_id
        LEFT JOIN cities cc      ON cc.channel_id = p.city_id
        LEFT JOIN daily_results wr
               ON wr.challenge_id = p.challenge_id AND wr.scope = 'world' AND wr.proof_id = p.id
        LEFT JOIN daily_results cr
               ON cr.challenge_id = p.challenge_id AND cr.scope = p.city_id AND cr.proof_id = p.id
        LEFT JOIN daily_local_passes lp
               ON lp.user_id = p.user_id AND lp.city_id = p.city_id
        LEFT JOIN places pl      ON pl.id = p.place_id
    ";

    /**
     * Validate a create/edit body. Returns [fields, null] or [[], errorCode].
     * In partial mode (edit) absent keys are left out; an explicit null clears
     * an optional field. photoUrl must be one of our own uploads.
     */
    public static function validateInput(array $body, bool $partial): array
    {
        $out = [];

        if (!$partial || array_key_exists('photoUrl', $body)) {
            $url = is_string($body['photoUrl'] ?? null) ? trim($body['photoUrl']) : '';
            if ($url === '' || R2Uploader::ownUploadFilename($url) === null) {
                return [[], 'invalid_photo'];
            }
            $out['photo_url'] = $url;
        }

        if (array_key_exists('caption', $body)) {
            $caption = $body['caption'];
            if ($caption !== null && !is_string($caption)) {
                return [[], 'invalid_caption'];
            }
            // One sentence: newlines collapse to spaces.
            $caption = $caption === null ? '' : trim((string) preg_replace('/\s+/u', ' ', $caption));
            if (mb_strlen($caption) > self::CAPTION_MAX) {
                return [[], 'invalid_caption'];
            }
            $out['caption'] = $caption === '' ? null : $caption;
        }

        if (array_key_exists('price', $body)) {
            $price = $body['price'];
            if ($price === null) {
                $out['price_amount'] = null;
                $out['price_currency'] = null;
            } else {
                $amount   = is_array($price) ? ($price['amount'] ?? null) : null;
                $currency = is_array($price) ? strtoupper(trim((string) ($price['currency'] ?? ''))) : '';
                if (!is_numeric($amount) || (float) $amount < 0 || (float) $amount > 1e12
                    || !preg_match('/^[A-Z]{3}$/', $currency)) {
                    return [[], 'invalid_price'];
                }
                $out['price_amount']   = round((float) $amount, 2);
                $out['price_currency'] = $currency;
            }
        }

        if (array_key_exists('place', $body)) {
            $place = $body['place'];
            if ($place === null) {
                $out['place_lat'] = null;
                $out['place_lng'] = null;
                $out['place_name'] = null;
            } else {
                $lat  = is_array($place) ? ($place['lat'] ?? null) : null;
                $lng  = is_array($place) ? ($place['lng'] ?? null) : null;
                $name = is_array($place) ? trim((string) ($place['name'] ?? '')) : '';
                if (!is_numeric($lat) || !is_numeric($lng)
                    || abs((float) $lat) > 90 || abs((float) $lng) > 180
                    || mb_strlen($name) > self::PLACE_NAME_MAX) {
                    return [[], 'invalid_place'];
                }
                $out['place_lat']  = (float) $lat;
                $out['place_lng']  = (float) $lng;
                $out['place_name'] = $name === '' ? null : $name;
            }
        }

        return [$out, null];
    }

    /**
     * Create the user's proof for $challenge. Returns the proof row, or null
     * when the user already has one for this challenge.
     */
    public static function create(array $user, array $challenge, array $fields): ?array
    {
        $cityId   = $user['current_city_id'] ?? null;
        $cityName = null;
        if ($cityId !== null && preg_match('/^city_(\d+)$/', $cityId, $m)) {
            $cityName = CityRepository::findById((int) $m[1])['name'] ?? null;
        }
        if ($cityName === null) {
            $cityId = null;
        }
        // Every proof carries a currency (SPEC 10.5): the price's, else its city's.
        $currency = $fields['price_currency'] ?? ($cityId !== null ? Currencies::forCity($cityId) : null);

        $stmt = Database::pdo()->prepare("
            INSERT INTO daily_proofs (
                id, challenge_id, user_id, city_id, photo_url, caption,
                price_amount, price_currency, place_lat, place_lng, place_name, is_local, is_early,
                place_id, distance_m,
                answer_text, answer_number, answer_minutes,
                home_city_id, home_city_name, home_country, home_answer_text, home_answer_number, home_answer_minutes,
                home_price_amount, home_price_currency, home_line
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (challenge_id, user_id) WHERE NOT is_seed DO NOTHING
            RETURNING id
        ");
        $stmt->execute([
            bin2hex(random_bytes(8)),
            $challenge['id'],
            $user['id'],
            $cityId,
            $fields['photo_url'],
            $fields['caption'] ?? null,
            $fields['price_amount'] ?? null,
            $currency,
            $fields['place_lat'] ?? null,
            $fields['place_lng'] ?? null,
            $fields['place_name'] ?? null,
            DailyRules::isLocalFor($user['mode'] ?? null, $user['home_city'] ?? null, $cityName) ? 'true' : 'false',
            // Speed bonus (V2-07): set once, here; an edit never changes it.
            DailyPushes::isEarly((string) $challenge['challenge_date'], DailyPushes::userTimezone($user['id']),
                                 new DateTimeImmutable('now')) ? 'true' : 'false',
            $fields['place_id'] ?? null,
            $fields['distance_m'] ?? null,
            ...array_map(static fn(string $c) => $fields[$c] ?? null, self::COMPARE_COLUMNS),
        ]);
        $id = $stmt->fetchColumn();
        return $id === false ? null : self::findById((string) $id);
    }

    /** Apply an edit and send the proof back to moderation. */
    public static function update(string $id, array $fields): ?array
    {
        $allowed = ['photo_url', 'caption', 'price_amount', 'price_currency', 'place_lat', 'place_lng', 'place_name',
                    'place_id', 'distance_m', ...self::COMPARE_COLUMNS];
        $sets = [];
        $args = [];
        foreach ($allowed as $col) {
            if (array_key_exists($col, $fields)) {
                // A cleared price keeps the proof's currency (every proof has one).
                $sets[] = $col === 'price_currency' ? "$col = COALESCE(?, $col)" : "$col = ?";
                $args[] = $fields[$col];
            }
        }
        $sets[] = "moderation_status = 'pending'";
        $sets[] = "approved_at = NULL";
        $sets[] = "rejection_reason = NULL";
        $sets[] = "edited_at = now()";
        $sets[] = "updated_at = now()";
        $args[] = $id;

        Database::pdo()
            ->prepare("UPDATE daily_proofs SET " . implode(', ', $sets) . " WHERE id = ?")
            ->execute($args);
        return self::findById($id);
    }

    /** Hard delete: votes, results and points cascade (points reversed by trigger). */
    public static function delete(string $id): void
    {
        Database::pdo()->prepare("DELETE FROM daily_proofs WHERE id = ?")->execute([$id]);
    }

    public static function findById(string $id): ?array
    {
        $stmt = Database::pdo()->prepare(self::SELECT . " WHERE p.id = ?");
        $stmt->execute([$id]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row ?: null;
    }

    /** Approved proofs by id, in the order given (unknown or unapproved left out). */
    public static function findApprovedMany(array $ids): array
    {
        if ($ids === []) {
            return [];
        }
        $stmt = Database::pdo()->prepare(self::SELECT . " WHERE p.id = ANY (string_to_array(?, ',')) AND p.moderation_status = 'approved'");
        $stmt->execute([implode(',', $ids)]);
        $byId = [];
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $byId[$r['id']] = $r;
        }
        return array_values(array_filter(array_map(static fn(string $id): ?array => $byId[$id] ?? null, $ids)));
    }

    public static function findMine(string $challengeId, string $userId): ?array
    {
        $stmt = Database::pdo()->prepare(self::SELECT . " WHERE p.challenge_id = ? AND p.user_id = ?");
        $stmt->execute([$challengeId, $userId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row ?: null;
    }

    /**
     * Approved proofs of a challenge, newest approval first. $cityId null =
     * World (every city). $before is a unix time cursor on approved_at.
     */
    public static function listApproved(string $challengeId, ?string $cityId, ?int $before, int $limit): array
    {
        $where = ["p.challenge_id = ?", "p.moderation_status = 'approved'"];
        $args  = [$challengeId];
        if ($cityId !== null) {
            $where[] = "p.city_id = ?";
            $args[]  = $cityId;
        }
        if ($before !== null) {
            $where[] = "p.approved_at < to_timestamp(?)";
            $args[]  = $before;
        }
        $args[] = $limit;
        $stmt = Database::pdo()->prepare(
            self::SELECT . " WHERE " . implode(' AND ', $where) . " ORDER BY p.approved_at DESC, p.id DESC LIMIT ?"
        );
        $stmt->execute($args);
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    /**
     * Today's proof strip (SPEC 9.3): a scope's approved proofs, most voted
     * first then newest, with the scope's proof and country counts ($cityId
     * null = World). $podium: the official results order instead (votes, local
     * votes, earliest approval), for yesterday's podium. Viewer-independent,
     * cached 15 s per scope.
     */
    public static function strip(string $challengeId, ?string $cityId, int $limit, bool $podium = false): array
    {
        $key   = "daily_strip_v1_{$challengeId}_" . ($cityId ?? 'world') . "_{$limit}" . ($podium ? '_podium' : '');
        $order = $podium ? 'p.vote_count DESC, p.local_vote_count DESC, p.approved_at ASC, p.id'
                         : 'p.vote_count DESC, p.approved_at DESC, p.id DESC';
        return Cache::remember($key, 15, static function () use ($challengeId, $cityId, $limit, $order): array {
            $pdo        = Database::pdo();
            $cityFilter = $cityId !== null ? " AND p.city_id = ?" : "";
            $args       = $cityId !== null ? [$challengeId, $cityId] : [$challengeId];

            $stmt = $pdo->prepare("
                SELECT count(*) AS total, count(DISTINCT c.country) AS countries
                FROM daily_proofs p
                LEFT JOIN cities c ON c.channel_id = p.city_id
                WHERE p.challenge_id = ? AND p.moderation_status = 'approved'{$cityFilter}
            ");
            $stmt->execute($args);
            $counts = $stmt->fetch(PDO::FETCH_ASSOC);

            $stmt = $pdo->prepare(self::SELECT . " WHERE p.challenge_id = ? AND p.moderation_status = 'approved'{$cityFilter}
                ORDER BY {$order} LIMIT ?");
            $stmt->execute([...$args, $limit]);

            return ['total' => (int) $counts['total'], 'countries' => (int) $counts['countries'], 'rows' => $stmt->fetchAll(PDO::FETCH_ASSOC)];
        });
    }

    /**
     * Today around the world (V4 votes): one proof per city, its most voted
     * (the results ranking: votes, local votes, earliest approval), the cities
     * with the most answers first: {total, countries, rows (+ city_count)}.
     * Approved proofs only, like the strip. Cached 15 s.
     */
    public static function perCity(string $challengeId, int $limit): array
    {
        return Cache::remember("daily_percity_v1_{$challengeId}_{$limit}", 15, static function () use ($challengeId, $limit): array {
            $pdo  = Database::pdo();
            $stmt = $pdo->prepare("
                SELECT id, city_count FROM (
                    SELECT p.id, count(*) OVER (PARTITION BY p.city_id) AS city_count,
                           row_number() OVER (PARTITION BY p.city_id
                                              ORDER BY p.vote_count DESC, p.local_vote_count DESC, p.approved_at ASC, p.id) AS rn
                    FROM daily_proofs p
                    WHERE p.challenge_id = ? AND p.moderation_status = 'approved' AND p.city_id IS NOT NULL
                ) x
                WHERE rn = 1
                ORDER BY city_count DESC, id
                LIMIT ?
            ");
            $stmt->execute([$challengeId, $limit]);
            $top = $stmt->fetchAll(PDO::FETCH_KEY_PAIR);
            $rows = [];
            if ($top !== []) {
                $stmt = $pdo->prepare(self::SELECT . " WHERE p.id = ANY (string_to_array(?, ','))");
                $stmt->execute([implode(',', array_keys($top))]);
                $byId = array_column($stmt->fetchAll(PDO::FETCH_ASSOC), null, 'id');
                foreach ($top as $id => $n) {
                    if (isset($byId[$id])) {
                        $rows[] = $byId[$id] + ['city_count' => (int) $n];
                    }
                }
            }
            $stmt = $pdo->prepare("
                SELECT count(*) AS total, count(DISTINCT c.country) AS countries
                FROM daily_proofs p
                LEFT JOIN cities c ON c.channel_id = p.city_id
                WHERE p.challenge_id = ? AND p.moderation_status = 'approved'
            ");
            $stmt->execute([$challengeId]);
            $counts = $stmt->fetch(PDO::FETCH_ASSOC);
            return ['total' => (int) $counts['total'], 'countries' => (int) $counts['countries'], 'rows' => $rows];
        }) ?? ['total' => 0, 'countries' => 0, 'rows' => []];
    }

    /** True once the user posted a proof, any day (pending or approved; removed ones don't count). */
    public static function hasAny(string $userId): bool
    {
        $stmt = Database::pdo()->prepare("SELECT 1 FROM daily_proofs WHERE user_id = ? AND moderation_status <> 'removed' LIMIT 1");
        $stmt->execute([$userId]);
        return $stmt->fetchColumn() !== false;
    }

    /** Moderation queue: pending proofs, oldest first (the longest wait is reviewed first). */
    public static function listPending(int $limit): array
    {
        $stmt = Database::pdo()->prepare(
            self::SELECT . " WHERE p.moderation_status = 'pending' ORDER BY p.created_at ASC LIMIT ?"
        );
        $stmt->execute([$limit]);
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    /** Approved proofs with open reports, most reported first, with report_count and reasons. */
    public static function listReported(int $limit): array
    {
        $stmt = Database::pdo()->prepare("
            SELECT x.*, r.report_count, r.reasons
            FROM (" . self::SELECT . " WHERE p.moderation_status = 'approved') x
            JOIN (
                SELECT proof_id, count(*) AS report_count, string_agg(DISTINCT reason_code, ',') AS reasons
                FROM daily_proof_reports WHERE status = 'open' GROUP BY proof_id
            ) r ON r.proof_id = x.id
            ORDER BY r.report_count DESC, x.approved_at DESC
            LIMIT ?
        ");
        $stmt->execute([$limit]);
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    /**
     * API shape. Owner-only fields (rejectionReason) need $viewerId to match.
     * myVote comes from DailyVotes::annotate; the ranks exist once the
     * challenge closed (worldRank: top 3 only).
     */
    public static function format(array $row, ?string $viewerId = null): array
    {
        $isMine = $viewerId !== null && $viewerId === $row['user_id'];
        $cityId = $row['city_id'] !== null ? (int) substr((string) $row['city_id'], 5) : null;
        $local  = (int) $row['local_vote_count'];

        return [
            'id'               => $row['id'],
            'challengeId'      => $row['challenge_id'],
            'date'             => $row['challenge_date'],
            'user'             => [
                'id'          => $row['user_id'],
                'username'    => $row['username'],
                'displayName' => $row['display_name'],
                'photoUrl'    => R2Uploader::thumbProxy($row['profile_photo_url']),
                // Holds the Local Pass of the proof's city (V2-03).
                'localPass'   => self::bool($row['author_local_pass'] ?? false),
            ],
            'city'             => $cityId !== null ? ['id' => $cityId, 'name' => $row['city_name'], 'country' => $row['city_country'] ?? null] : null,
            'isLocal'          => self::bool($row['is_local']),
            'isEarly'          => self::bool($row['is_early'] ?? false),
            'photoUrl'         => $row['photo_url'],
            'thumbUrl'         => R2Uploader::thumbProxy($row['photo_url']),
            'caption'          => $row['caption'],
            // amount and currency, plus eur: the amount in EUR (SPEC 10.5; null before the first rates).
            'price'            => $row['price_amount'] !== null
                ? DailyCompare::price((float) $row['price_amount'], (string) $row['price_currency'])
                : null,
            // The proof's currency, with or without a price (its city's by default).
            'currency'         => $row['price_currency'] !== null ? trim((string) $row['price_currency']) : null,
            'place'            => $row['place_lat'] !== null
                ? ['lat' => (float) $row['place_lat'], 'lng' => (float) $row['place_lng'], 'name' => $row['place_name']]
                : null,
            // V3-02: the Hilads place (spot) the proof is attached to.
            'spot'             => ($row['place_id'] ?? null) !== null
                ? ['id' => $row['place_id'], 'name' => $row['spot_name'], 'inReview' => ($row['spot_status'] ?? null) === 'pending']
                : null,
            'status'           => $row['moderation_status'],
            'rejectionReason'  => $isMine ? $row['rejection_reason'] : null,
            'voteCount'        => (int) $row['vote_count'],
            'localVoteCount'   => $local,
            'validatedByLocal' => $local > 0,
            'myVote'           => (bool) ($row['my_vote'] ?? false),
            'worldRank'        => isset($row['world_rank']) ? (int) $row['world_rank'] : null,
            'cityRank'         => isset($row['city_rank']) ? (int) $row['city_rank'] : null,
            'isMine'           => $isMine,
            'approvedAt'       => self::ts($row['approved_at']),
            'editedAt'         => self::ts($row['edited_at']),
            'createdAt'        => self::ts($row['created_at']),
            // A Hilads suggestion (the official account's answer): its badge and photo credit instead of a person.
            'suggestion'       => self::bool($row['is_suggestion'] ?? false),
            'credit'           => self::bool($row['is_suggestion'] ?? false) ? ($row['photo_credit'] ?? null) : null,
            // SPEC 10: the answer to the challenge's question {type, value, unit}, and Back home.
        ] + DailyCompare::proofPayload($row, DailyI18n::current()) + ['context' => self::context($row)];
    }

    /**
     * The proof's challenge in the viewer's language, for a proof seen on its
     * own (a shared link, the viewer): {theme, special, question, text}, or
     * null when the row has no challenge columns.
     */
    private static function context(array $row): ?array
    {
        if (!array_key_exists('challenge_text_i18n', $row)) {
            return null;
        }
        $locale = DailyI18n::current();
        $text   = json_decode((string) $row['challenge_text_i18n'], true) ?: [];
        $date   = (string) $row['challenge_date'];
        $q      = DailyCompare::payload($row, $locale);
        $theme  = DailyThemes::format($row['challenge_theme'] ?? null, $date);
        return [
            'theme'    => $theme,
            'special'  => ($theme['key'] ?? null) === DailyThemes::SPECIAL ? DailySpecials::payload($row['challenge_special_id'] ?? null, $locale) : null,
            'question' => $q['question'] ?? null,
            'text'     => DailyI18n::pick($text, $locale) ?? (string) ($text['en'] ?? ''),
        ];
    }

    public static function bool(mixed $v): bool
    {
        return $v === true || $v === 't' || $v === 'true' || $v === 1 || $v === '1';
    }

    public static function ts(?string $v): ?int
    {
        return $v === null ? null : strtotime($v);
    }
}
