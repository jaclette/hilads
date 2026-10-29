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
            ON CONFLICT DO NOTHING
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
        // The challenge sheet shows players' photos only (never Hilads picks).
        $where = ["p.challenge_id = ?", "p.moderation_status = 'approved'", "NOT p.is_suggestion"];
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
     * first then the earliest posted (DailyResults::rankProofs), with the
     * scope's proof and country counts ($cityId null = World). $podium:
     * players' photos only, for yesterday's podium. Viewer-independent,
     * cached 15 s per scope.
     */
    public static function strip(string $challengeId, ?string $cityId, int $limit, bool $podium = false, bool $feed = false): array
    {
        $key   = "daily_strip_v2_{$challengeId}_" . ($cityId ?? 'world') . "_{$limit}" . ($podium ? '_podium' : '') . ($feed ? '_feed' : '');
        // The podium and the strip: DailyResults::rankProofs (votes, then the earliest posted); the feed: newest.
        $order = $feed ? 'p.approved_at DESC, p.id DESC' : 'p.vote_count DESC, p.created_at ASC, p.id';
        // The podium and the photo feed are players' photos only (never a Hilads suggestion).
        $players = $podium || $feed;
        return Cache::remember($key, 15, static function () use ($challengeId, $cityId, $limit, $order, $players): array {
            $pdo        = Database::pdo();
            $cityFilter = $cityId !== null ? " AND p.city_id = ?" : "";
            $args       = $cityId !== null ? [$challengeId, $cityId] : [$challengeId];
            // Hilads suggestions are never counted, never on the podium; in the strip they come after the players' photos.
            $listFilter = $players ? " AND NOT p.is_suggestion" : "";

            $stmt = $pdo->prepare("
                SELECT count(*) AS total, count(DISTINCT c.country) AS countries
                FROM daily_proofs p
                LEFT JOIN cities c ON c.channel_id = p.city_id
                WHERE p.challenge_id = ? AND p.moderation_status = 'approved' AND NOT p.is_suggestion{$cityFilter}
            ");
            $stmt->execute($args);
            $counts = $stmt->fetch(PDO::FETCH_ASSOC);

            $stmt = $pdo->prepare(self::SELECT . " WHERE p.challenge_id = ? AND p.moderation_status = 'approved'{$cityFilter}{$listFilter}
                ORDER BY p.is_suggestion, {$order} LIMIT ?");
            $stmt->execute([...$args, $limit]);

            return ['total' => (int) $counts['total'], 'countries' => (int) $counts['countries'], 'rows' => $stmt->fetchAll(PDO::FETCH_ASSOC)];
        });
    }

    /**
     * Today by country (Today's stories row and mosaic): every approved
     * player's photo of the challenge (never a Hilads suggestion), light rows
     * {id, user_id, city_id, city_name, country, vote_count, at, posted}, newest first.
     * Cached 15 s; blocks and "seen" are applied per viewer by the caller.
     */
    public static function countryRows(string $challengeId): array
    {
        return Cache::remember("daily_countries_v2_{$challengeId}", 15, static function () use ($challengeId): array {
            $stmt = Database::pdo()->prepare("
                SELECT p.id, p.user_id, p.city_id, ch.name AS city_name, cc.country, p.vote_count,
                       extract(epoch FROM coalesce(p.approved_at, p.created_at))::bigint AS at,
                       extract(epoch FROM p.created_at)::bigint AS posted
                FROM daily_proofs p
                JOIN channels ch ON ch.id = p.city_id
                JOIN cities cc   ON cc.channel_id = p.city_id
                WHERE p.challenge_id = ? AND p.moderation_status = 'approved' AND NOT p.is_suggestion AND cc.country IS NOT NULL
                ORDER BY at DESC, p.id DESC
                LIMIT 2000
            ");
            $stmt->execute([$challengeId]);
            return $stmt->fetchAll(PDO::FETCH_ASSOC);
        }) ?? [];
    }

    /**
     * Group countryRows (already filtered) by country: [{country, cityId,
     * cityName, ids (newest first), count, latestAt, topId}], the top being the
     * country's best photo (DailyResults::rankProofs: most votes, then the
     * earliest posted), its city the country's city. Ordered:
     * $firstCountry first, then the countries with a photo not in $seen
     * (null: unknown, not used), then the most recent.
     */
    public static function groupByCountry(array $rows, ?string $firstCountry, ?array $seen): array
    {
        $groups = [];
        foreach ($rows as $r) {
            $c = strtoupper((string) $r['country']);
            $g = &$groups[$c];
            $g ??= ['country' => $c, 'ids' => [], 'latestAt' => (int) $r['at'], 'top' => null, 'unseen' => false];
            $g['ids'][] = $r['id'];
            if ($seen !== null && !isset($seen[$r['id']])) {
                $g['unseen'] = true;
            }
            if ($g['top'] === null || self::betterThan($r, $g['top'])) {
                $g['top'] = $r;
            }
            unset($g);
        }
        $out = array_values($groups);
        usort($out, static function (array $a, array $b) use ($firstCountry): int {
            $fa = $a['country'] === $firstCountry ? 0 : 1;
            $fb = $b['country'] === $firstCountry ? 0 : 1;
            return [$fa, $b['unseen'] ? 1 : 0, $b['latestAt']] <=> [$fb, $a['unseen'] ? 1 : 0, $a['latestAt']];
        });
        return array_map(static fn(array $g): array => [
            'country'  => $g['country'],
            'cityId'   => $g['top']['city_id'],
            'cityName' => $g['top']['city_name'],
            'ids'      => $g['ids'],
            'count'    => count($g['ids']),
            'latestAt' => $g['latestAt'],
            'unseen'   => $seen === null ? null : $g['unseen'],
            'topId'    => $g['top']['id'],
        ], $out);
    }

    /**
     * Group countryRows (already filtered) by city: [{cityId, cityName,
     * country, ids (best first), count, authorIds (best first, distinct),
     * totalLikes, latestAt, unseen, topId}]. Ordered: $firstCity first, then
     * the cities with a photo not in $seen, then the most recent.
     */
    public static function groupByCity(array $rows, ?string $firstCity, ?array $seen): array
    {
        $groups = [];
        foreach ($rows as $r) {
            $g = &$groups[$r['city_id']];
            $g ??= ['cityId' => $r['city_id'], 'cityName' => $r['city_name'], 'country' => strtoupper((string) $r['country']),
                    'rows' => [], 'latestAt' => (int) $r['at'], 'unseen' => false, 'likes' => 0];
            $g['rows'][] = $r;
            $g['likes'] += (int) $r['vote_count'];
            if ($seen !== null && !isset($seen[$r['id']])) {
                $g['unseen'] = true;
            }
            unset($g);
        }
        $out = [];
        foreach ($groups as $g) {
            usort($g['rows'], static fn(array $a, array $b): int => self::betterThan($a, $b) ? -1 : (self::betterThan($b, $a) ? 1 : 0));
            $out[] = [
                'cityId'     => $g['cityId'],
                'cityName'   => $g['cityName'],
                'country'    => $g['country'],
                'ids'        => array_column($g['rows'], 'id'),
                'count'      => count($g['rows']),
                'authorIds'  => array_values(array_unique(array_column($g['rows'], 'user_id'))),
                'totalLikes' => $g['likes'],
                'latestAt'   => $g['latestAt'],
                'unseen'     => $seen === null ? null : $g['unseen'],
                'topId'      => $g['rows'][0]['id'],
            ];
        }
        usort($out, static function (array $a, array $b) use ($firstCity): int {
            $fa = $a['cityId'] === $firstCity ? 0 : 1;
            $fb = $b['cityId'] === $firstCity ? 0 : 1;
            return [$fa, $b['unseen'] ? 1 : 0, $b['latestAt']] <=> [$fb, $a['unseen'] ? 1 : 0, $a['latestAt']];
        });
        return $out;
    }

    /** {id: {id, username, displayName, photoUrl}} for the avatars of Today's cities. */
    public static function authorsByIds(array $ids): array
    {
        $ids = array_values(array_unique(array_filter($ids)));
        if ($ids === []) {
            return [];
        }
        $stmt = Database::pdo()->prepare("
            SELECT id, username, display_name, coalesce(profile_thumb_photo_url, profile_photo_url) AS photo
            FROM users WHERE id IN (" . implode(',', array_fill(0, count($ids), '?')) . ") AND deleted_at IS NULL
        ");
        $stmt->execute($ids);
        $out = [];
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $u) {
            $out[$u['id']] = ['id' => $u['id'], 'username' => $u['username'], 'displayName' => $u['display_name'], 'photoUrl' => $u['photo']];
        }
        return $out;
    }

    /** True when countryRows row $a ranks before $b (DailyResults::rankProofs: votes, earliest posted, id). */
    private static function betterThan(array $a, array $b): bool
    {
        return [-(int) $a['vote_count'], (int) ($a['posted'] ?? $a['at']), (string) $a['id']]
             < [-(int) $b['vote_count'], (int) ($b['posted'] ?? $b['at']), (string) $b['id']];
    }

    /** The full rows of these proofs (any order). */
    public static function rowsByIds(array $ids): array
    {
        if ($ids === []) {
            return [];
        }
        $stmt = Database::pdo()->prepare(self::SELECT . " WHERE p.id = ANY (string_to_array(?, ','))");
        $stmt->execute([implode(',', $ids)]);
        return array_column($stmt->fetchAll(PDO::FETCH_ASSOC), null, 'id');
    }

    /** The ids among $ids this user has viewed, as a set (id => true). */
    public static function seenSet(string $userId, array $ids): array
    {
        if ($ids === []) {
            return [];
        }
        $stmt = Database::pdo()->prepare("
            SELECT proof_id FROM daily_proof_views WHERE user_id = ? AND proof_id = ANY (string_to_array(?, ','))
        ");
        $stmt->execute([$userId, implode(',', $ids)]);
        return array_fill_keys($stmt->fetchAll(PDO::FETCH_COLUMN), true);
    }

    /** Remember these proofs as viewed by this user (unknown ids are skipped). Returns rows added. */
    public static function markSeen(string $userId, array $ids): int
    {
        if ($ids === []) {
            return 0;
        }
        $stmt = Database::pdo()->prepare("
            INSERT INTO daily_proof_views (user_id, proof_id)
            SELECT ?, p.id FROM daily_proofs p WHERE p.id = ANY (string_to_array(?, ','))
            ON CONFLICT DO NOTHING
        ");
        $stmt->execute([$userId, implode(',', $ids)]);
        return $stmt->rowCount();
    }

    /**
     * Today around the world (V4 votes): one proof per city, its most voted
     * (the results ranking: votes, local votes, earliest approval), the cities
     * with the most answers first: {total, countries, rows (+ city_count)}.
     * Approved proofs only, like the strip. Cached 15 s.
     */
    public static function perCity(string $challengeId, int $limit): array
    {
        return Cache::remember("daily_percity_v2_{$challengeId}_{$limit}", 15, static function () use ($challengeId, $limit): array {
            $pdo  = Database::pdo();
            $stmt = $pdo->prepare("
                SELECT id, city_count FROM (
                    SELECT p.id, count(*) FILTER (WHERE NOT p.is_suggestion) OVER (PARTITION BY p.city_id) AS city_count,
                           bool_and(p.is_suggestion) OVER (PARTITION BY p.city_id) AS only_suggestions,
                           row_number() OVER (PARTITION BY p.city_id
                                              ORDER BY p.is_suggestion, p.vote_count DESC, p.created_at ASC, p.id) AS rn
                    FROM daily_proofs p
                    WHERE p.challenge_id = ? AND p.moderation_status = 'approved' AND p.city_id IS NOT NULL
                ) x
                WHERE rn = 1
                ORDER BY only_suggestions, city_count DESC, id
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
                WHERE p.challenge_id = ? AND p.moderation_status = 'approved' AND NOT p.is_suggestion
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
    /**
     * The Today hero's photo (SPEC 9.3): the most voted approved answer of a
     * challenge in a city (or the world when $cityId is null), ties to the
     * most recent: {proofId, photoUrl, thumbUrl, username, city: {name,
     * country}, suggestion, credit}, or null before any answer. Cached 30 s.
     * $withSuggestions false (the challenge has its own cover, picked in the
     * back office): Hilads suggestions never take the hero, only players' photos.
     */
    public static function heroCover(string $challengeId, ?string $cityId, bool $withSuggestions = true): ?array
    {
        $key = 'daily_hero_cover_v1_' . $challengeId . '_' . ($cityId ?? 'world') . ($withSuggestions ? '' : '_nosugg');
        return Cache::remember($key, 30, static function () use ($challengeId, $cityId, $withSuggestions): array {
            $stmt = Database::pdo()->prepare("
                SELECT p.id, p.photo_url, p.photo_credit, to_jsonb(p)->>'photo_source_url' AS photo_source_url, p.is_suggestion,
                       u.username, ch.name AS city_name, cc.country AS city_country
                FROM daily_proofs p
                JOIN users u          ON u.id = p.user_id AND NOT u.is_demo
                LEFT JOIN channels ch ON ch.id = p.city_id
                LEFT JOIN cities cc   ON cc.channel_id = p.city_id
                WHERE p.challenge_id = ? AND p.moderation_status = 'approved' AND NOT p.is_seed AND NOT p.is_demo
                  AND (?::text IS NULL OR p.city_id = ?)" . ($withSuggestions ? '' : ' AND NOT p.is_suggestion') . "
                ORDER BY p.is_suggestion, p.vote_count DESC, p.created_at ASC, p.id
                LIMIT 1
            ");
            $stmt->execute([$challengeId, $cityId, $cityId]);
            $r = $stmt->fetch(PDO::FETCH_ASSOC);
            return $r === false ? [] : [
                'proofId'    => $r['id'],
                'photoUrl'   => $r['photo_url'],
                'thumbUrl'   => R2Uploader::thumbProxy($r['photo_url']),
                'username'   => $r['username'],
                'city'       => $r['city_name'] !== null ? ['name' => $r['city_name'], 'country' => $r['city_country']] : null,
                'suggestion' => self::bool($r['is_suggestion'] ?? false),
                'credit'     => self::bool($r['is_suggestion'] ?? false) ? $r['photo_credit'] : null,
                'creditUrl'  => self::bool($r['is_suggestion'] ?? false) ? $r['photo_source_url'] : null,
            ];
        }) ?: null;
    }

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
            // The licensed photo's source page, linked next to the full credit in the sheet.
            'creditUrl'        => self::bool($row['is_suggestion'] ?? false) ? ($row['photo_source_url'] ?? null) : null,
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
