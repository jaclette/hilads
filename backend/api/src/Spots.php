<?php

declare(strict_types=1);

/**
 * Spots and the map (V3-03, SPEC 9.5). A spot is a Hilads place (Places) that
 * is approved, not hidden, not merged, with at least one approved proof.
 *
 * Its cover is its most voted approved proof (ties: the most recent), credited
 * to the proof's author ("Photo by @username").
 *
 * Its stats are computed from daily_proofs by one aggregate query, cached for
 * CACHE_TTL seconds: a proof changes state in many places (approve, reject,
 * remove, report-hide, edit, delete, votes), and a computed answer is never
 * staler than the cache. A proof's votes all fall on its challenge's date, so
 * weekly votes come from the proofs' vote_count too.
 *
 * Locate the place, never the person: spots carry the place's position;
 * proofs carry their challenge date, never a time of day.
 */
final class Spots
{
    public const PIN_LIMIT    = 300;
    public const NEAR_LIMIT   = 3;
    public const AWAY_M       = 30000;   // a position farther than this from the city's centre is not "in" it (Today: "Spots in <city>")
    public const SEARCH_LIMIT = 20;
    public const PHOTOS_PAGE  = 24;
    public const CAPTIONS     = 3;
    public const PLAN_DAYS    = 7;
    public const CACHE_TTL    = 30;
    public const TAG_MAX      = 40;
    public const TAGS_MAX     = 5;

    // ── Pure helpers ──────────────────────────────────────────────────────────

    /** Monday and Sunday of the Monday-to-Sunday week of a challenge date (SPEC 9.8). */
    public static function week(string $date): array
    {
        $d      = new DateTimeImmutable($date . ' 00:00:00', new DateTimeZone('UTC'));
        $monday = $d->modify('-' . ((int) $d->format('N') - 1) . ' days');
        return [$monday->format('Y-m-d'), $monday->modify('+6 days')->format('Y-m-d')];
    }

    /** "minLng,minLat,maxLng,maxLat" → [minLng, minLat, maxLng, maxLat], or null when invalid. */
    public static function parseBbox(?string $raw): ?array
    {
        $parts = explode(',', (string) $raw);
        if (count($parts) !== 4 || array_filter($parts, static fn(string $p): bool => !is_numeric(trim($p))) !== []) {
            return null;
        }
        [$minLng, $minLat, $maxLng, $maxLat] = array_map('floatval', $parts);
        if ($minLat < -90 || $maxLat > 90 || $minLng < -180 || $maxLng > 180 || $minLat >= $maxLat || $minLng >= $maxLng) {
            return null;
        }
        return [$minLng, $minLat, $maxLng, $maxLat];
    }

    /** Dish tags typed in the back office ("cơm tấm, sườn") → at most TAGS_MAX distinct tags. */
    public static function parseTags(?string $raw): array
    {
        $out = [];
        foreach (explode(',', (string) $raw) as $t) {
            $t = trim((string) preg_replace('/\s+/u', ' ', $t));
            if ($t === '' || mb_strlen($t) > self::TAG_MAX) {
                continue;
            }
            $key = Places::normalizeName($t);
            if ($key !== '' && !isset($out[$key])) {
                $out[$key] = mb_strtolower($t);
            }
        }
        return array_slice(array_values($out), 0, self::TAGS_MAX);
    }

    /** Distinct tags (first spelling wins), compared without accents or case. */
    public static function mergeTags(array ...$lists): array
    {
        $out = [];
        foreach ($lists as $list) {
            foreach ($list as $t) {
                $key = Places::normalizeName((string) $t);
                if ($key !== '' && !isset($out[$key])) {
                    $out[$key] = (string) $t;
                }
            }
        }
        return array_values($out);
    }

    /** Price range and median paid, in the most used currency: {min, max, median, currency}, or null. */
    public static function priceRange(array $prices): ?array
    {
        $byCurrency = [];
        foreach ($prices as [$amount, $currency]) {
            if ($amount !== null && $currency !== null) {
                $byCurrency[$currency][] = (float) $amount;
            }
        }
        if ($byCurrency === []) {
            return null;
        }
        uksort($byCurrency, static fn($a, $b): int =>
            [count($byCurrency[$b]), $a] <=> [count($byCurrency[$a]), $b]);
        $currency = array_key_first($byCurrency);
        $amounts  = $byCurrency[$currency];
        sort($amounts);
        $mid    = intdiv(count($amounts), 2);
        $median = count($amounts) % 2 ? $amounts[$mid] : ($amounts[$mid - 1] + $amounts[$mid]) / 2;
        return ['min' => $amounts[0], 'max' => end($amounts), 'median' => (float) $median, 'currency' => (string) $currency];
    }

    /**
     * Rank (1-based) of a spot among $spots by $key (votes or votesWeek),
     * proof count breaking ties. Null when it has no such votes.
     */
    public static function rankOf(array $spots, string $id, string $key): ?int
    {
        usort($spots, static fn(array $a, array $b): int =>
            [$b[$key], $b['proofCount'], $a['id']] <=> [$a[$key], $a['proofCount'], $b['id']]);
        foreach ($spots as $i => $s) {
            if ($s['id'] === $id) {
                return $s[$key] > 0 ? $i + 1 : null;
            }
        }
        return null;
    }

    /** Does a spot match a search (name or tags, accent and case insensitive)? */
    public static function matches(array $spot, string $query): bool
    {
        $q = Places::normalizeName($query);
        if ($q === '') {
            return false;
        }
        foreach (array_merge([$spot['name']], $spot['tags']) as $text) {
            if (str_contains(' ' . Places::normalizeName((string) $text), ' ' . $q)
                || str_contains(Places::normalizeName((string) $text), $q)) {
                return true;
            }
        }
        return false;
    }

    /** Spot (pin) payload from an aggregate row and its tags. */
    public static function format(array $r, array $tags): array
    {
        $cityId = $r['city_id'] !== null ? (int) substr((string) $r['city_id'], 5) : null;
        $prices = $r['prices'] !== null ? (json_decode((string) $r['prices'], true) ?: []) : [];
        return [
            'id'               => $r['id'],
            'name'             => $r['name'],
            'lat'              => (float) $r['lat'],
            'lng'              => (float) $r['lng'],
            'city'             => $cityId !== null ? ['id' => $cityId, 'name' => $r['city_name'], 'country' => $r['city_country'] ?? null] : null,
            'themes'           => $r['themes'] !== null ? DailyThemes::clientList(explode(',', (string) $r['themes'])) : [],
            'tags'             => $tags,
            'proofCount'       => (int) $r['proof_count'],
            'votes'            => (int) $r['votes'],
            'votesWeek'        => (int) $r['votes_week'],
            'validatedByLocal' => DailyProofRepository::bool($r['validated']),
            'priceRange'       => self::priceRange($prices),
            'lastProofDate'    => $r['last_date'],
            'cover'            => [
                'photoUrl' => $r['cover_photo'],
                'thumbUrl' => R2Uploader::thumbProxy($r['cover_photo']),
                'caption'  => $r['cover_caption'],
                // "Photo by @username": the proof's author.
                'proofId'  => $r['cover_proof_id'] ?? null,
                'by'       => ($r['cover_username'] ?? null) ?: null,
            ],
        ];
    }

    /** A spot photo (an approved proof): its challenge date, never a time of day. */
    public static function formatPhoto(array $r): array
    {
        $local = (int) $r['local_vote_count'];
        return [
            'id'               => $r['id'],
            'photoUrl'         => $r['photo_url'],
            'thumbUrl'         => R2Uploader::thumbProxy($r['photo_url']),
            'caption'          => $r['caption'],
            'price'            => $r['price_amount'] !== null
                ? ['amount' => (float) $r['price_amount'], 'currency' => $r['price_currency']] : null,
            'date'             => $r['challenge_date'],
            'theme'            => $r['theme'] !== null ? DailyThemes::client((string) $r['theme'], $r['challenge_date'] ?? null) : null,
            'user'             => [
                'id'          => $r['user_id'],
                'username'    => $r['username'],
                'displayName' => $r['display_name'],
                'photoUrl'    => R2Uploader::thumbProxy($r['profile_photo_url']),
            ],
            'isLocal'          => DailyProofRepository::bool($r['is_local']),
            'voteCount'        => (int) $r['vote_count'],
            'validatedByLocal' => $local > 0,
        ];
    }

    /** A plan (Hi plan occurrence) as a dated map pin, or null when it can't be one. */
    public static function formatPlan(array $e, int $now): ?array
    {
        if (($e['source'] ?? null) !== 'hilads' || !empty($e['is_venue'])
            || $e['venue_lat'] === null || $e['venue_lng'] === null || (int) $e['ends_at'] <= $now) {
            return null;
        }
        return [
            'id'               => $e['id'],
            'title'            => $e['title'],
            'lat'              => (float) $e['venue_lat'],
            'lng'              => (float) $e['venue_lng'],
            'startsAt'         => (int) $e['starts_at'],
            'endsAt'           => (int) $e['ends_at'],
            'recurring'        => $e['series_id'] !== null,
            'participantCount' => (int) ($e['participant_count'] ?? 0),
        ];
    }

    // ── Database ──────────────────────────────────────────────────────────────

    /**
     * Spots in a scope, most voted first: ['cityId' => 'city_N'] or ['bbox' =>
     * [minLng, minLat, maxLng, maxLat]], plus optional 'theme', 'ids', 'near'
     * ([lat, lng]: nearest first) and 'limit'. Cached CACHE_TTL seconds.
     */
    public static function find(array $scope): array
    {
        // Payloads carry the client's theme keys (DailyThemes::legacyClient): cached apart.
        $key = 'spots_v2_' . md5(json_encode($scope) . '|' . DailyClock::currentDate() . (DailyThemes::legacyClient() ? '|v1' : ''));
        return Cache::remember($key, self::CACHE_TTL, static fn(): array => self::query($scope)) ?? [];
    }

    /** One spot (following merges), or null. */
    public static function findOne(string $id): ?array
    {
        for ($i = 0; $i < 5; $i++) {
            $place = Places::findById($id);
            if ($place === null || $place['merged_into'] === null) {
                break;
            }
            $id = (string) $place['merged_into'];
        }
        return self::find(['ids' => [$id]])[0] ?? null;
    }

    /**
     * Ranks of a spot in its city (top 3 only): ['week' => ?int, 'alltime' =>
     * ?int]. Null when the spot has no city.
     */
    public static function ranking(array $spot): ?array
    {
        if ($spot['city'] === null) {
            return null;
        }
        $all     = self::find(['cityId' => 'city_' . $spot['city']['id']]);
        $week    = self::rankOf($all, $spot['id'], 'votesWeek');
        $alltime = self::rankOf($all, $spot['id'], 'votes');
        return [
            'week'     => $week !== null && $week <= 3 ? $week : null,
            'alltime'  => $alltime !== null && $alltime <= 3 ? $alltime : null,
            'cityName' => $spot['city']['name'],
            'cityCountry' => $spot['city']['country'] ?? null,
        ];
    }

    /** Approved proofs of a spot, most voted first, without blocked authors. */
    public static function photos(string $placeId, int $offset, array $blockedUserIds): array
    {
        $stmt = Database::pdo()->prepare("
            SELECT p.id, p.photo_url, p.caption, p.price_amount, p.price_currency, p.user_id, p.is_local,
                   p.vote_count, p.local_vote_count, dc.challenge_date, dc.theme,
                   u.username, u.display_name, u.profile_photo_url
            FROM daily_proofs p
            JOIN daily_challenges dc ON dc.id = p.challenge_id
            JOIN users u             ON u.id  = p.user_id
            WHERE p.place_id = ? AND p.moderation_status = 'approved'
              AND NOT (p.user_id = ANY (string_to_array(?, ',')))
            ORDER BY p.vote_count DESC, dc.challenge_date DESC, p.id
            LIMIT ? OFFSET ?
        ");
        $stmt->execute([$placeId, implode(',', $blockedUserIds), self::PHOTOS_PAGE + 1, $offset]);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
        return [
            'items'      => array_map([self::class, 'formatPhoto'], array_slice($rows, 0, self::PHOTOS_PAGE)),
            'nextOffset' => count($rows) > self::PHOTOS_PAGE ? $offset + self::PHOTOS_PAGE : null,
        ];
    }

    /** The latest captions of a spot: [{text, date, username}], newest challenge first. */
    public static function captions(string $placeId, array $blockedUserIds): array
    {
        $stmt = Database::pdo()->prepare("
            SELECT p.caption, dc.challenge_date, u.username
            FROM daily_proofs p
            JOIN daily_challenges dc ON dc.id = p.challenge_id
            JOIN users u             ON u.id  = p.user_id
            WHERE p.place_id = ? AND p.moderation_status = 'approved' AND p.caption IS NOT NULL
              AND NOT (p.user_id = ANY (string_to_array(?, ',')))
            ORDER BY dc.challenge_date DESC, p.approved_at DESC
            LIMIT ?
        ");
        $stmt->execute([$placeId, implode(',', $blockedUserIds), self::CAPTIONS]);
        return array_map(static fn(array $r): array => [
            'text' => $r['caption'], 'date' => $r['challenge_date'], 'username' => $r['username'],
        ], $stmt->fetchAll(PDO::FETCH_ASSOC));
    }

    /**
     * Hi plans of a city as dated pins: ongoing ones and those starting in the
     * next PLAN_DAYS days, with coordinates. Never Hi now (a person's position).
     */
    public static function plans(int $cityChannel): array
    {
        return Cache::remember('spots_plans_v1_' . $cityChannel, self::CACHE_TTL, static function () use ($cityChannel): array {
            $now   = time();
            $seen  = [];
            $out   = [];
            // Today's feed (ongoing included) + the coming days.
            $all   = array_merge(EventRepository::getAllByChannel($cityChannel)['hilads'] ?? [],
                                 EventRepository::getUpcoming($cityChannel, self::PLAN_DAYS));
            foreach ($all as $e) {
                $pin = self::formatPlan($e, $now);
                $key = $e['id'] . '@' . $e['starts_at'];
                if ($pin === null || isset($seen[$key])) {
                    continue;
                }
                $seen[$key] = true;
                $out[]      = $pin;
            }
            usort($out, static fn(array $a, array $b): int => $a['startsAt'] <=> $b['startsAt']);
            return $out;
        }) ?? [];
    }

    private static function query(array $scope): array
    {
        [$weekStart, $weekEnd] = self::week(DailyClock::currentDate());
        $where = ["pl.status = 'approved'", 'NOT pl.hidden', 'pl.merged_into IS NULL'];
        $args  = [$weekStart, $weekEnd];

        if (isset($scope['ids'])) {
            $where[] = "pl.id = ANY (string_to_array(?, ','))";
            $args[]  = implode(',', $scope['ids']);
        }
        if (isset($scope['cityId'])) {
            $where[] = 'pl.city_id = ?';
            $args[]  = $scope['cityId'];
        }
        if (isset($scope['bbox'])) {
            [$minLng, $minLat, $maxLng, $maxLat] = $scope['bbox'];
            $where[] = 'pl.lat BETWEEN ? AND ? AND pl.lng BETWEEN ? AND ?';
            array_push($args, $minLat, $maxLat, $minLng, $maxLng);
        }
        $having = '';
        if (isset($scope['theme'])) {
            $having = 'HAVING bool_or(dc.theme = ?)';
            $args[] = $scope['theme'];
        }
        $order = 'votes DESC, proof_count DESC, pl.id';
        if (isset($scope['near'])) {
            // Equirectangular approximation: enough to order by distance.
            [$lat, $lng] = $scope['near'];
            $order  = sprintf('power(pl.lat - %F, 2) + power((pl.lng - %F) * %F, 2), pl.id',
                              $lat, $lng, cos(deg2rad($lat)));
        }
        $args[] = (int) ($scope['limit'] ?? self::PIN_LIMIT + 1);

        $stmt = Database::pdo()->prepare("
            SELECT pl.id, pl.name, pl.lat, pl.lng, pl.city_id, ch.name AS city_name, cc.country AS city_country,
                   count(*)                                   AS proof_count,
                   string_agg(DISTINCT dc.theme, ',')         AS themes,
                   COALESCE(sum(p.vote_count), 0)             AS votes,
                   COALESCE(sum(p.vote_count) FILTER (WHERE dc.challenge_date BETWEEN ?::date AND ?::date), 0) AS votes_week,
                   bool_or(p.is_local OR p.local_vote_count > 0) AS validated,
                   max(dc.challenge_date)::text               AS last_date,
                   json_agg(json_build_array(p.price_amount, p.price_currency))
                       FILTER (WHERE p.price_amount IS NOT NULL) AS prices,
                   -- The cover (SPEC 9.5): the most voted approved proof, ties to the most recent.
                   (array_agg(p.photo_url ORDER BY p.vote_count DESC, p.approved_at DESC, p.id DESC))[1] AS cover_photo,
                   (array_agg(p.caption   ORDER BY p.vote_count DESC, p.approved_at DESC, p.id DESC))[1] AS cover_caption,
                   (array_agg(p.id        ORDER BY p.vote_count DESC, p.approved_at DESC, p.id DESC))[1] AS cover_proof_id,
                   (array_agg(cu.username ORDER BY p.vote_count DESC, p.approved_at DESC, p.id DESC))[1] AS cover_username
            FROM places pl
            JOIN daily_proofs p      ON p.place_id = pl.id AND p.moderation_status = 'approved'
            JOIN users cu            ON cu.id = p.user_id
            JOIN daily_challenges dc ON dc.id = p.challenge_id
            LEFT JOIN channels ch    ON ch.id = pl.city_id
            LEFT JOIN cities cc      ON cc.channel_id = pl.city_id
            WHERE " . implode(' AND ', $where) . "
            GROUP BY pl.id, ch.name, cc.country
            {$having}
            ORDER BY {$order}
            LIMIT ?
        ");
        $stmt->execute($args);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
        $tags = self::tagsOf(array_column($rows, 'id'));
        return array_map(static fn(array $r): array => self::format($r, $tags[$r['id']] ?? []), $rows);
    }

    /** Tags per place: admin tags, then the dish tags of the Local Twists of its proofs' days. */
    private static function tagsOf(array $placeIds): array
    {
        if ($placeIds === []) {
            return [];
        }
        $ids  = implode(',', $placeIds);
        $pdo  = Database::pdo();
        $own  = $pdo->prepare("SELECT place_id, tag FROM place_tags WHERE place_id = ANY (string_to_array(?, ',')) ORDER BY created_at");
        $own->execute([$ids]);
        $twist = $pdo->prepare("
            SELECT DISTINCT p.place_id, t.dish_tags
            FROM daily_proofs p
            JOIN daily_twists t ON t.challenge_id = p.challenge_id AND t.city_id = p.city_id
                               AND t.status = 'selected' AND t.moderation_status = 'approved'
            WHERE p.place_id = ANY (string_to_array(?, ',')) AND p.moderation_status = 'approved'
              AND t.dish_tags IS NOT NULL
        ");
        $twist->execute([$ids]);

        $admin = $fromTwists = [];
        foreach ($own->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $admin[$r['place_id']][] = $r['tag'];
        }
        foreach ($twist->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $fromTwists[$r['place_id']] = array_merge($fromTwists[$r['place_id']] ?? [], self::parseTags($r['dish_tags']));
        }
        $out = [];
        foreach ($placeIds as $id) {
            $out[$id] = self::mergeTags($admin[$id] ?? [], $fromTwists[$id] ?? []);
        }
        return $out;
    }
}
