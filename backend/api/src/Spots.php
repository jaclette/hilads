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
            // The spot of its city's first approved proof ever: "Spot #1 in Saigon" (SPEC 9.16).
            'pioneerCity'      => DailyPresence::pioneerSpots()[$r['id']] ?? null,
            'priceRange'       => self::priceRange($prices),
            'lastProofDate'    => $r['last_date'],
            'cover'            => [
                'photoUrl' => $r['cover_photo'],
                'thumbUrl' => R2Uploader::thumbProxy($r['cover_photo']),
                'caption'  => $r['cover_caption'],
                // "Photo by @username": the proof's author; a pick's photo carries its credit instead.
                'proofId'  => $r['cover_proof_id'] ?? null,
                'by'       => ($r['cover_credit'] ?? null) ? null : (($r['cover_username'] ?? null) ?: null),
                'credit'   => ($r['cover_credit'] ?? null) ?: null,
            ],
            // A Hilads pick (editorial): its "Good to know" text in the viewer's language. pickOnly: no player answered there yet.
            'pick'             => ($r['pick_status'] ?? null) === 'published' && ($r['pick_note_i18n'] ?? null) !== null
                ? ['note' => self::pickNote((string) $r['pick_note_i18n']), 'pickOnly' => DailyProofRepository::bool($r['pick_only'] ?? false)]
                : null,
        ];
    }

    /**
     * The Compare tab's "Meanwhile, from our picks" (never the board): the
     * published picks attached to a challenge, [{city, place: {id, name}, answer,
     * note}], with the pick's own answer to the question when one was checked.
     */
    public static function picksFor(array $challenge, ?string $locale = null, ?string $viewerId = null): array
    {
        if (!self::picksReady()) {
            return [];
        }
        $locale = $locale ?? DailyI18n::current();
        $rows = Cache::remember('daily_picks_for_v1_' . $challenge['id'], self::CACHE_TTL, static function () use ($challenge): array {
            $stmt = Database::pdo()->prepare("
                SELECT pl.id, pl.name, pl.city_id, ch.name AS city_name, cc.country, pl.pick_note_i18n,
                       a.answer_text, a.answer_number, a.answer_minutes,
                       (SELECT p.photo_url FROM daily_proofs p WHERE p.place_id = pl.id AND p.is_pick ORDER BY p.created_at DESC LIMIT 1) AS photo_url,
                       (SELECT p.photo_credit FROM daily_proofs p WHERE p.place_id = pl.id AND p.is_pick ORDER BY p.created_at DESC LIMIT 1) AS photo_credit
                FROM daily_pick_answers a
                JOIN places pl          ON pl.id = a.place_id AND pl.pick_status = 'published' AND NOT pl.hidden AND pl.merged_into IS NULL
                LEFT JOIN channels ch   ON ch.id = pl.city_id
                LEFT JOIN cities cc     ON cc.channel_id = pl.city_id
                WHERE a.challenge_id = ?
                ORDER BY ch.name, pl.name
            ");
            $stmt->execute([$challenge['id']]);
            return $stmt->fetchAll(PDO::FETCH_ASSOC);
        }) ?? [];
        $votes = self::pickVotes((string) $challenge['id'], $viewerId);
        $out = array_map(static fn(array $r): array => [
            'city'   => $r['city_id'] !== null ? ['id' => (int) substr((string) $r['city_id'], 5), 'name' => $r['city_name'], 'country' => $r['country']] : null,
            'place'  => ['id' => $r['id'], 'name' => $r['name']],
            'photo'  => $r['photo_url'] !== null ? ['url' => $r['photo_url'], 'thumbUrl' => R2Uploader::thumbProxy($r['photo_url']), 'credit' => $r['photo_credit']] : null,
            // Pick votes: their own count, never a player answer's (no ranking, tour, Index or points).
            'voteCount' => $votes[$r['id']]['n'] ?? 0,
            'myVote'    => $votes[$r['id']]['mine'] ?? false,
            'answer' => DailyCompare::answerPayload($challenge['compare_type'] ?? null, $r['answer_text'], $r['answer_number'] !== null ? (int) $r['answer_number'] : null,
                                                    $r['answer_minutes'] !== null ? (int) $r['answer_minutes'] : null, $challenge['compare_unit_i18n'] ?? null, $locale),
            'note'   => $r['pick_note_i18n'] !== null ? self::pickNote((string) $r['pick_note_i18n']) : null,
        ], $rows);
        // Most loved first; ties keep the city order.
        usort($out, static fn(array $a, array $b): int => $b['voteCount'] <=> $a['voteCount']);
        return $out;
    }

    /** Votes on a challenge's picks: [placeId => {n, mine}]. Live (not cached): a vote shows at once. */
    public static function pickVotes(string $challengeId, ?string $viewerId): array
    {
        try {
            $stmt = Database::pdo()->prepare("
                SELECT place_id, count(*) AS n, bool_or(voter_user_id = ?) AS mine
                FROM daily_pick_votes WHERE challenge_id = ? GROUP BY place_id
            ");
            $stmt->execute([$viewerId ?? '', $challengeId]);
        } catch (\Throwable $e) {
            return [];   // before migrate.php
        }
        $out = [];
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $out[$r['place_id']] = ['n' => (int) $r['n'], 'mine' => DailyProofRepository::bool($r['mine'])];
        }
        return $out;
    }

    /**
     * Vote for (or withdraw from) a pick attached to today's open challenge.
     * Returns {voted, voteCount}; throws InvalidArgumentException not_found or voting_closed.
     */
    public static function pickVote(string $placeId, string $userId, bool $on): array
    {
        $challenge = DailyChallengeRepository::findPublishedByDate(DailyClock::currentDate());
        if ($challenge === null || !DailyClock::isActive((string) $challenge['challenge_date'])) {
            throw new InvalidArgumentException('voting_closed');
        }
        $pdo  = Database::pdo();
        $stmt = $pdo->prepare("
            SELECT 1 FROM daily_pick_answers a JOIN places pl ON pl.id = a.place_id AND pl.pick_status = 'published' AND NOT pl.hidden
            WHERE a.challenge_id = ? AND a.place_id = ?
        ");
        $stmt->execute([$challenge['id'], $placeId]);
        if ($stmt->fetchColumn() === false) {
            throw new InvalidArgumentException('not_found');
        }
        if ($on) {
            $pdo->prepare("INSERT INTO daily_pick_votes (challenge_id, place_id, voter_user_id) VALUES (?, ?, ?) ON CONFLICT DO NOTHING")
                ->execute([$challenge['id'], $placeId, $userId]);
        } else {
            $pdo->prepare("DELETE FROM daily_pick_votes WHERE challenge_id = ? AND place_id = ? AND voter_user_id = ?")
                ->execute([$challenge['id'], $placeId, $userId]);
        }
        $v = self::pickVotes((string) $challenge['id'], $userId)[$placeId] ?? ['n' => 0, 'mine' => false];
        return ['voted' => $v['mine'], 'voteCount' => $v['n']];
    }

    /** A pick's "Good to know" in the request's language, else English. */
    public static function pickNote(string $json): ?string
    {
        $all = json_decode($json, true) ?: [];
        $loc = DailyI18n::current();
        return ($all[$loc] ?? null) ?: (($all['en'] ?? null) ?: null);
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
            // A Hilads pick's photo: no votes, its credit instead of "Photo by @username".
            'pick'             => DailyProofRepository::bool($r['is_pick'] ?? false),
            'credit'           => ($r['photo_credit'] ?? null) ?: null,
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
        // Payloads carry a pick's "Good to know" in the request's language: cached apart too.
        $key = 'spots_v2_' . md5(json_encode($scope) . '|' . DailyClock::currentDate() . (DailyThemes::legacyClient() ? '|v1' : '') . '|' . DailyI18n::current());
        return Cache::remember($key, self::CACHE_TTL, static fn(): array => self::query($scope)) ?? [];
    }

    /**
     * The World map's city bubbles: every city with at least one spot (in a
     * theme), with its spot count, most spots first:
     * [{city: {id, name, country, lat, lng}, spots}]. Cached CACHE_TTL seconds.
     */
    public static function cities(?string $theme = null): array
    {
        $key = 'spots_cities_v1_' . ($theme ?? 'all');
        return Cache::remember($key, self::CACHE_TTL, static function () use ($theme): array {
            $stmt = Database::pdo()->prepare("
                SELECT pl.city_id, count(DISTINCT pl.id) AS spots
                FROM places pl
                JOIN daily_proofs p      ON p.place_id = pl.id AND p.moderation_status = 'approved' AND NOT p.is_demo
                                            " . (self::picksReady() ? "AND (NOT p.is_pick OR pl.pick_status = 'published')" : '') . "
                JOIN users cu            ON cu.id = p.user_id AND NOT cu.is_demo
                JOIN daily_challenges dc ON dc.id = p.challenge_id
                WHERE pl.status = 'approved' AND NOT pl.hidden AND pl.merged_into IS NULL AND pl.city_id IS NOT NULL
                  AND (?::text IS NULL OR dc.theme = ?)
                GROUP BY pl.city_id
                ORDER BY spots DESC, pl.city_id
            ");
            $stmt->execute([$theme, $theme]);
            $out = [];
            foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
                $city = CityRepository::findById((int) substr((string) $r['city_id'], 5));
                if ($city === null || $city['lat'] === null || $city['lng'] === null) {
                    continue;
                }
                $out[] = [
                    'city'  => ['id' => (int) $city['id'], 'name' => $city['name'], 'country' => $city['country'] ?? null,
                                'lat' => (float) $city['lat'], 'lng' => (float) $city['lng']],
                    'spots' => (int) $r['spots'],
                ];
            }
            return $out;
        }) ?? [];
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
        // Picks never rank: only spots with players' answers compete.
        if ($spot['proofCount'] === 0) {
            return ['week' => null, 'alltime' => null, 'cityName' => $spot['city']['name'], 'cityCountry' => $spot['city']['country'] ?? null];
        }
        $all     = array_values(array_filter(self::find(['cityId' => 'city_' . $spot['city']['id']]), static fn(array $s): bool => $s['proofCount'] > 0));
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
                   " . (self::picksReady() ? ', p.is_pick, p.photo_credit' : '') . "
            FROM daily_proofs p
            JOIN daily_challenges dc ON dc.id = p.challenge_id
            JOIN users u             ON u.id  = p.user_id
            JOIN places pl           ON pl.id = p.place_id
            WHERE p.place_id = ? AND p.moderation_status = 'approved' AND NOT p.is_demo AND NOT u.is_demo
              AND NOT (p.user_id = ANY (string_to_array(?, ',')))
              " . (self::picksReady() ? "AND (NOT p.is_pick OR pl.pick_status = 'published')" : '') . "
            ORDER BY " . (self::picksReady() ? 'p.is_pick, ' : '') . "p.vote_count DESC, dc.challenge_date DESC, p.id
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
            WHERE p.place_id = ? AND p.moderation_status = 'approved' AND NOT p.is_demo AND NOT u.is_demo AND p.caption IS NOT NULL
              " . (self::picksReady() ? 'AND NOT p.is_pick' : '') . "
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

    /** Whether migrate.php added the Hilads picks columns (checked once per process). */
    public static function picksReady(): bool
    {
        static $ready = null;
        if ($ready === null) {
            try {
                $stmt  = Database::pdo()->query("
                    SELECT 1 FROM information_schema.columns WHERE table_name = 'daily_proofs' AND column_name = 'is_pick'
                ");
                $ready = $stmt !== false && $stmt->fetchColumn() !== false;
            } catch (\Throwable $e) {
                $ready = false;
            }
        }
        return $ready;
    }

    private static function query(array $scope): array
    {
        [$weekStart, $weekEnd] = self::week(DailyClock::currentDate());
        // Hilads picks (editorial): their photo backs the spot only once published, never
        // counts as an answer (proofs, local validation) and gives way to a player's photo as cover.
        $pk     = self::picksReady();
        $player = $pk ? 'NOT p.is_pick' : 'true';
        $cover  = ($pk ? 'p.is_pick, ' : '') . 'p.vote_count DESC, p.approved_at DESC, p.id DESC';
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
                   count(*) FILTER (WHERE {$player})          AS proof_count,
                   string_agg(DISTINCT dc.theme, ',')         AS themes,
                   COALESCE(sum(p.vote_count), 0)             AS votes,
                   COALESCE(sum(p.vote_count) FILTER (WHERE dc.challenge_date BETWEEN ?::date AND ?::date), 0) AS votes_week,
                   bool_or(p.is_local OR p.local_vote_count > 0) FILTER (WHERE {$player}) AS validated,
                   max(dc.challenge_date)::text               AS last_date,
                   json_agg(json_build_array(p.price_amount, p.price_currency))
                       FILTER (WHERE p.price_amount IS NOT NULL) AS prices,
                   -- The cover (SPEC 9.5): the most voted approved proof, ties to the most recent; a player's before a pick's.
                   (array_agg(p.photo_url ORDER BY {$cover}))[1] AS cover_photo,
                   (array_agg(p.caption   ORDER BY {$cover}))[1] AS cover_caption,
                   (array_agg(p.id        ORDER BY {$cover}))[1] AS cover_proof_id,
                   (array_agg(cu.username ORDER BY {$cover}))[1] AS cover_username,
                   " . ($pk ? "(array_agg(p.photo_credit ORDER BY {$cover}))[1] AS cover_credit,
                   bool_or(p.is_pick) AS cover_pick_any, bool_and(p.is_pick) AS pick_only,
                   pl.pick_note_i18n, pl.pick_status"
                          : "NULL AS cover_credit, false AS cover_pick_any, false AS pick_only, NULL AS pick_note_i18n, NULL AS pick_status") . "
            FROM places pl
            -- A spot exists with an approved proof: a player's or a back office seed (never a demo one), and its cover is its most voted one.
            JOIN daily_proofs p      ON p.place_id = pl.id AND p.moderation_status = 'approved' AND NOT p.is_demo
                                        " . ($pk ? "AND (NOT p.is_pick OR pl.pick_status = 'published')" : '') . "
            JOIN users cu            ON cu.id = p.user_id AND NOT cu.is_demo
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
            WHERE p.place_id = ANY (string_to_array(?, ',')) AND p.moderation_status = 'approved' AND NOT p.is_demo
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
