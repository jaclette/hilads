<?php

declare(strict_types=1);

/**
 * Daily Challenge read side: today's challenge, the challenge sheet and the
 * per-city archive. Only published challenges are ever exposed; timing comes
 * from DailyClock, the live-city rule from DailyRules.
 */
final class DailyChallengeRepository
{
    /** Published challenge of a date, or null. Cached 60 s (one row per date). */
    public static function findPublishedByDate(string $date): ?array
    {
        return Cache::remember('daily_challenge_v2_' . $date, 60, function () use ($date): ?array {
            $stmt = Database::pdo()->prepare("
                -- * (not a column list): works before and after the cover_url migration.
                SELECT *
                FROM daily_challenges
                WHERE challenge_date = ? AND status = 'published'
            ");
            $stmt->execute([$date]);
            $row = $stmt->fetch(PDO::FETCH_ASSOC);
            return $row ?: null;
        });
    }

    /** Selected, approved twist of (challenge, city) with its author, or null. */
    public static function twistFor(string $challengeId, string $cityId, ?string $locale = null): ?array
    {
        $stmt = Database::pdo()->prepare("
            SELECT t.id, t.text, t.text_i18n, t.author_credit, t.author_user_id,
                   u.username, u.display_name, u.profile_photo_url
            FROM daily_twists t
            LEFT JOIN users u ON u.id = t.author_user_id
            WHERE t.challenge_id = ? AND t.city_id = ?
              AND t.status = 'selected' AND t.moderation_status = 'approved'
        ");
        $stmt->execute([$challengeId, $cityId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row ? self::formatTwist($row, $locale) : null;
    }

    /** A twist's translations map (text_i18n), for the channel cards. */
    public static function twistI18n(string $twistId): array
    {
        $stmt = Database::pdo()->prepare("SELECT text_i18n FROM daily_twists WHERE id = ?");
        $stmt->execute([$twistId]);
        return json_decode((string) ($stmt->fetchColumn() ?: '{}'), true) ?: [];
    }

    /** Approved players' photo counts, World and (when given) city, and the countries that played (the sheet opens on Compare from 2). */
    public static function counts(string $challengeId, ?string $cityId): array
    {
        $stmt = Database::pdo()->prepare("
            SELECT count(*) AS world,
                   count(*) FILTER (WHERE p.city_id = ?) AS city,
                   count(DISTINCT c.country) AS countries
            FROM daily_proofs p
            LEFT JOIN cities c ON c.channel_id = p.city_id
            WHERE p.challenge_id = ? AND p.moderation_status = 'approved' AND NOT p.is_suggestion
        ");
        $stmt->execute([$cityId ?? '', $challengeId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return ['world' => (int) $row['world'], 'city' => $cityId !== null ? (int) $row['city'] : null, 'countries' => (int) $row['countries']];
    }

    /**
     * Practical info from approved proofs: price ranges per currency (most
     * used first; the app shows the first) and up to 50 pinned places.
     */
    public static function practical(string $challengeId, ?string $cityId, array $blockedUserIds = []): array
    {
        $cityFilter = $cityId !== null ? " AND city_id = ?" : "";
        $args = $cityId !== null ? [$challengeId, $cityId] : [$challengeId];
        $pdo  = Database::pdo();

        $stmt = $pdo->prepare("
            SELECT price_currency AS currency, min(price_amount) AS min, max(price_amount) AS max, count(*) AS n
            FROM daily_proofs
            WHERE challenge_id = ? AND moderation_status = 'approved' AND NOT is_suggestion AND price_amount IS NOT NULL{$cityFilter}
            GROUP BY price_currency
            ORDER BY n DESC, price_currency
        ");
        $stmt->execute($args);
        $prices = array_map(fn(array $r): array => [
            'currency' => $r['currency'],
            'min'      => (float) $r['min'],
            'max'      => (float) $r['max'],
            'count'    => (int) $r['n'],
        ], $stmt->fetchAll(PDO::FETCH_ASSOC));

        // Places users explicitly pinned on their proof (never derived from photo metadata).
        $stmt = $pdo->prepare("
            SELECT p.id, p.user_id, p.place_lat, p.place_lng, p.place_name, p.photo_url,
                   u.username, u.display_name, ch.name AS city_name, cc.country AS city_country
            FROM daily_proofs p
            JOIN users u          ON u.id = p.user_id
            LEFT JOIN channels ch ON ch.id = p.city_id
            LEFT JOIN cities cc   ON cc.channel_id = p.city_id
            WHERE p.challenge_id = ? AND p.moderation_status = 'approved' AND NOT p.is_suggestion AND p.place_lat IS NOT NULL"
            . str_replace('city_id', 'p.city_id', $cityFilter) . "
            ORDER BY p.approved_at DESC
            LIMIT 50
        ");
        $stmt->execute($args);
        $places = [];
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
            if (!in_array($r['user_id'], $blockedUserIds, true)) {
                $places[] = self::formatPin($r);
            }
        }

        return ['priceRanges' => $prices, 'places' => $places];
    }

    /**
     * Pinned places of past challenges ("Already done" map), newest first: a
     * live city's, or the World selection for a dead city (or none), like the
     * archive. Approved proofs with an explicit pin only; blocked authors left out.
     */
    public static function places(?string $cityId, int $limit, array $blockedUserIds = []): array
    {
        $isLive = DailyRules::isLive($cityId);
        $stmt   = Database::pdo()->prepare("
            SELECT p.id, p.user_id, p.place_lat, p.place_lng, p.place_name, p.photo_url,
                   u.username, u.display_name, dc.challenge_date, dc.text_i18n
            FROM daily_proofs p
            JOIN daily_challenges dc ON dc.id = p.challenge_id
            JOIN users u ON u.id = p.user_id
            WHERE p.moderation_status = 'approved' AND p.place_lat IS NOT NULL
              AND dc.status = 'published' AND dc.challenge_date < ?
              AND (CAST(? AS TEXT) IS NULL OR p.city_id = ?)
            ORDER BY dc.challenge_date DESC, p.approved_at DESC
            LIMIT ?
        ");
        $city = $isLive ? $cityId : null;
        $stmt->execute([DailyClock::currentDate(), $city, $city, $limit]);
        $items  = [];
        $locale = DailyI18n::current();
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
            if (in_array($r['user_id'], $blockedUserIds, true)) {
                continue;
            }
            $text = json_decode((string) $r['text_i18n'], true) ?: [];
            $items[] = self::formatPin($r) + [
                'date'          => (string) $r['challenge_date'],
                'challengeText' => DailyI18n::localize($text, (string) ($text['en'] ?? ''), $locale)[0],
            ];
        }
        return ['scope' => $isLive ? 'city' : 'world', 'items' => $items];
    }

    /** One map pin: proof id, coordinates, place name, photo thumb, author. Pure. */
    public static function formatPin(array $r): array
    {
        return [
            'proofId'  => $r['id'],
            'lat'      => (float) $r['place_lat'],
            'lng'      => (float) $r['place_lng'],
            'name'     => $r['place_name'],
            'thumbUrl' => R2Uploader::thumbProxy($r['photo_url']),
            'user'     => ['id' => $r['user_id'], 'username' => $r['username'], 'displayName' => $r['display_name']],
            // The place's city ("🇲🇽 Churrería El Moro · Mexico City"), when the query has it.
            'city'     => ($r['city_name'] ?? null) !== null ? ['name' => $r['city_name'], 'country' => $r['city_country'] ?? null] : null,
        ];
    }

    /**
     * Everything a screen needs about one date's challenge: the challenge,
     * timing, the city with its live flag, the twist (live cities only),
     * counts, and for a signed-in viewer their proof, votes and current streak.
     * $challenge null = nothing published.
     */
    public static function header(string $date, ?string $cityId, ?array $viewer): array
    {
        $challenge = self::findPublishedByDate($date);
        $now       = DailyClock::now();
        $isLive    = DailyRules::isLive($cityId);
        $city      = null;
        if ($cityId !== null) {
            $n    = (int) substr($cityId, 5);
            $city = ['id' => $n, 'name' => CityRepository::findById($n)['name'] ?? null, 'country' => CityRepository::countryOf($n), 'isLive' => $isLive];
        }

        $out = [
            'challenge'   => $challenge !== null ? self::formatChallenge($challenge, $now) : null,
            'nextDropAt'  => DailyClock::nextDropAt($now)->getTimestamp(),
            'secondsLeft' => DailyClock::secondsLeft($now),
            'serverTime'  => $now->getTimestamp(),
            'city'        => $city,
            'twist'       => null,
            'counts'      => ['world' => 0, 'city' => $cityId !== null ? 0 : null, 'countries' => 0],
            'myProof'     => null,
            'myVotes'     => null,
            'streak'      => $viewer !== null ? DailyResults::currentStreak($viewer['id']) : null,
            // Tomorrow's theme as a teaser; never its text.
            'tomorrow'    => self::tomorrow(DailyClock::currentDate($now)),
            // Speed bonus window (V2-07): until when my proof would be early (signed in, not posted yet, still open).
            'early'       => null,
            // My Local Pass progress in this city (signed in, with a city).
            'localPass'   => $viewer !== null && $cityId !== null ? DailyLocalPass::progressIn($viewer['id'], $cityId) : null,
            // Represent your city (SPEC 9.16): {represented, streak, citiesToday, pioneer}, with a city.
            'presence'    => null,
        ];
        if ($challenge === null) {
            return $out;
        }

        if ($isLive) {
            $out['twist'] = self::twistFor($challenge['id'], $cityId);
        }
        $out['counts'] = self::counts($challenge['id'], $cityId);
        $mine = $viewer !== null ? DailyProofRepository::findMine($challenge['id'], $viewer['id']) : null;
        if ($cityId !== null) {
            try {
                $out['presence'] = DailyPresence::payload($cityId, $challenge['id'], $mine ?: null);
            } catch (\Throwable $e) {
                error_log('[daily] presence failed: ' . $e->getMessage());   // before the migration
            }
        }
        if ($viewer !== null) {
            $out['myProof'] = $mine ? DailyProofRepository::format($mine, $viewer['id']) : null;
            $votes = DailyVotes::mine($challenge['id'], $viewer['id']);
            $out['myVotes'] = ['used' => $votes['used'], 'left' => $votes['left']];
            if ($mine === null) {
                $tz    = DailyPushes::userTimezone($viewer['id']);
                $until = DailyPushes::earlyUntil((string) $challenge['challenge_date'], $tz);
                if ($now < $until) {
                    $out['early'] = ['startsAt' => DailyPushes::startAt((string) $challenge['challenge_date'], $tz)->getTimestamp(),
                                     'until'    => $until->getTimestamp()];
                }
            }
        }
        return $out;
    }

    /** Tomorrow's date and theme (the scheduled challenge's, else its weekday's). Cached 60 s. */
    public static function tomorrow(string $today): array
    {
        $date = (new DateTimeImmutable($today, new DateTimeZone('UTC')))->modify('+1 day')->format('Y-m-d');
        $row  = Cache::remember('daily_tomorrow_theme_v2_' . $date, 60, function () use ($date): array {
            $stmt = Database::pdo()->prepare("
                SELECT * FROM daily_challenges WHERE challenge_date = ? AND status IN ('scheduled', 'published')
            ");
            $stmt->execute([$date]);
            $r = $stmt->fetch(PDO::FETCH_ASSOC) ?: [];
            return ['theme' => $r['theme'] ?? null, 'special_id' => $r['special_id'] ?? null];
        });
        $theme = DailyThemes::format($row['theme'] ?? null, $date);
        return ['date' => $date, 'theme' => $theme,
                'special' => DailyThemes::effective($row['theme'] ?? null, $date) === DailyThemes::SPECIAL ? DailySpecials::payload($row['special_id'] ?? null) : null];
    }

    /**
     * Past challenges (before today's), newest first, as informative cards for
     * a city. A dead city (or none) gets the World selection: best proof from
     * anywhere, no twist. Best proof = stored result rank 1 once results exist
     * (phase 2), else most votes, then latest approval. $theme filters by theme key.
     */
    public const ARCHIVE_PHOTOS = 4;

    /** Per challenge: its best photos [{proofId, thumbUrl}] and its countries, in a city or World ($cityId null). */
    private static function archiveExtras(array $challengeIds, ?string $cityId): array
    {
        if ($challengeIds === []) {
            return [[], []];
        }
        $pdo        = Database::pdo();
        $ids        = implode(',', $challengeIds);
        $cityFilter = $cityId !== null ? ' AND p.city_id = ?' : '';
        $args       = $cityId !== null ? [$ids, $cityId] : [$ids];

        $stmt = $pdo->prepare("
            SELECT challenge_id, id, photo_url FROM (
                SELECT p.challenge_id, p.id, p.photo_url,
                       row_number() OVER (PARTITION BY p.challenge_id ORDER BY p.is_suggestion, p.vote_count DESC, p.created_at ASC, p.id) AS rn
                FROM daily_proofs p
                WHERE p.challenge_id = ANY (string_to_array(?, ',')) AND p.moderation_status = 'approved'{$cityFilter}
            ) x WHERE rn <= " . self::ARCHIVE_PHOTOS . " ORDER BY challenge_id, rn
        ");
        $stmt->execute($args);
        $photos = [];
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $photos[$r['challenge_id']][] = ['proofId' => $r['id'], 'thumbUrl' => R2Uploader::thumbProxy($r['photo_url'])];
        }

        $stmt = $pdo->prepare("
            SELECT p.challenge_id, count(DISTINCT c.country) AS n
            FROM daily_proofs p LEFT JOIN cities c ON c.channel_id = p.city_id
            WHERE p.challenge_id = ANY (string_to_array(?, ',')) AND p.moderation_status = 'approved' AND NOT p.is_suggestion{$cityFilter}
            GROUP BY p.challenge_id
        ");
        $stmt->execute($args);
        $countries = [];
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $countries[$r['challenge_id']] = (int) $r['n'];
        }
        return [$photos, $countries];
    }

    public static function archive(?string $cityId, ?string $beforeDate, int $limit, ?string $theme = null): array
    {
        $isLive = DailyRules::isLive($cityId);
        $scope  = $isLive ? $cityId : 'world';
        $cityArg = $isLive ? $cityId : null;

        $before = DailyClock::currentDate();
        if ($beforeDate !== null && $beforeDate < $before) {
            $before = $beforeDate;
        }

        // In World scope the proof filters below compare city_id to NULL,
        // which the "? IS NULL OR ..." guard turns into "every city".
        $stmt = Database::pdo()->prepare("
            SELECT dc.id, dc.challenge_date, dc.text_i18n, dc.context_i18n, dc.theme, dc.special_id, dc.cover_url, dc.proposed_by_user_id,
                   dc.compare_type, dc.compare_question_i18n, dc.compare_unit_i18n,
                   best.id AS best_proof_id,
                   tw.text AS twist_text, tw.text_i18n AS twist_i18n, tw.author_credit AS twist_credit,
                   tu.id AS twist_user_id, tu.username AS twist_username,
                   tu.display_name AS twist_display_name, tu.profile_photo_url AS twist_photo,
                   price.currency, price.min_amount, price.max_amount,
                   stats.world_count, stats.city_count, stats.pinned_count
            FROM daily_challenges dc
            LEFT JOIN LATERAL (
                SELECT p.id
                FROM daily_proofs p
                LEFT JOIN daily_results r
                       ON r.proof_id = p.id AND r.challenge_id = dc.id AND r.scope = :scope
                WHERE p.challenge_id = dc.id AND p.moderation_status = 'approved'
                  AND (CAST(:city1 AS TEXT) IS NULL OR p.city_id = :city2)
                ORDER BY p.is_suggestion, r.rank NULLS LAST, p.vote_count DESC, p.created_at ASC, p.id
                LIMIT 1
            ) best ON true
            LEFT JOIN daily_twists tw
                   ON tw.challenge_id = dc.id AND tw.city_id = :city3
                  AND tw.status = 'selected' AND tw.moderation_status = 'approved'
            LEFT JOIN users tu ON tu.id = tw.author_user_id
            LEFT JOIN LATERAL (
                SELECT p.price_currency AS currency,
                       min(p.price_amount) AS min_amount, max(p.price_amount) AS max_amount
                FROM daily_proofs p
                WHERE p.challenge_id = dc.id AND p.moderation_status = 'approved'
                  AND p.price_amount IS NOT NULL
                  AND (CAST(:city4 AS TEXT) IS NULL OR p.city_id = :city5)
                GROUP BY p.price_currency
                ORDER BY count(*) DESC, p.price_currency
                LIMIT 1
            ) price ON true
            LEFT JOIN LATERAL (
                SELECT count(*) AS world_count,
                       count(*) FILTER (WHERE p.city_id = :city6) AS city_count,
                       count(*) FILTER (WHERE p.place_lat IS NOT NULL
                                        AND (CAST(:city7 AS TEXT) IS NULL OR p.city_id = :city8)) AS pinned_count
                FROM daily_proofs p
                WHERE p.challenge_id = dc.id AND p.moderation_status = 'approved' AND NOT p.is_suggestion
            ) stats ON true
            WHERE dc.status = 'published' AND dc.challenge_date < :before
              AND (CAST(:theme1 AS TEXT) IS NULL OR dc.theme = :theme2)
            ORDER BY dc.challenge_date DESC
            LIMIT :lim
        ");
        $stmt->execute([
            'scope' => $scope,
            'city1' => $cityArg, 'city2' => $cityArg, 'city3' => $cityArg ?? '',
            'city4' => $cityArg, 'city5' => $cityArg, 'city6' => $cityArg ?? '',
            'city7' => $cityArg, 'city8' => $cityArg,
            'before' => $before,
            'theme1' => $theme, 'theme2' => $theme,
            'lim'    => $limit,
        ]);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
        [$photos, $countries] = self::archiveExtras(array_column($rows, 'id'), $cityArg);

        $items = [];
        foreach ($rows as $r) {
            $best = $r['best_proof_id'] ? DailyProofRepository::findById($r['best_proof_id']) : null;
            $items[] = [
                'challenge'    => self::formatChallenge($r),
                'bestProof'    => $best ? DailyProofRepository::format($best) : null,
                'twist'        => $r['twist_text'] !== null ? self::formatTwist([
                    'id' => null, 'text' => $r['twist_text'], 'text_i18n' => $r['twist_i18n'], 'author_credit' => $r['twist_credit'],
                    'author_user_id' => $r['twist_user_id'], 'username' => $r['twist_username'],
                    'display_name' => $r['twist_display_name'], 'profile_photo_url' => $r['twist_photo'],
                ]) : null,
                'priceRange'   => $r['currency'] !== null ? [
                    'currency' => $r['currency'],
                    'min'      => (float) $r['min_amount'],
                    'max'      => (float) $r['max_amount'],
                ] : null,
                'counts'       => [
                    'world'     => (int) $r['world_count'],
                    'city'      => $isLive ? (int) $r['city_count'] : null,
                    // Countries of the scope's proofs (the archive's "N proofs in M countries").
                    'countries' => $countries[$r['id']] ?? 0,
                ],
                'pinnedPlaces' => (int) $r['pinned_count'],
                // The mosaic: the scope's best photos (up to ARCHIVE_PHOTOS), most voted first.
                'photos'       => $photos[$r['id']] ?? [],
            ];
        }

        return [
            'scope'   => $isLive ? 'city' : 'world',
            'items'   => $items,
            'hasMore' => count($rows) >= $limit,
        ];
    }

    /**
     * City guide (V2-03): one entry per theme, in weekly order, over past
     * published challenges - challengesDone (with at least one approved proof
     * in scope), proofs, bestPhotos (top 3 by votes), priceRange (most common
     * currency) and pinnedPlaces. A dead city (or none) gets the World
     * selection, like the archive. The shared part is cached 5 minutes; blocked
     * authors are filtered per viewer.
     */
    public static function guide(?string $cityId, array $blockedUserIds = []): array
    {
        $isLive = DailyRules::isLive($cityId);
        $scope  = $isLive ? (string) $cityId : null;
        $today  = DailyClock::currentDate();
        $data   = Cache::remember('daily_guide_v1_' . ($scope ?? 'world') . '_' . $today, 300, function () use ($scope, $today): array {
            $pdo   = Database::pdo();
            $from  = "
                FROM daily_proofs p
                JOIN daily_challenges dc ON dc.id = p.challenge_id
                WHERE dc.status = 'published' AND dc.challenge_date < :today AND dc.theme IS NOT NULL
                  AND p.moderation_status = 'approved'
                  AND (CAST(:city1 AS TEXT) IS NULL OR p.city_id = :city2)
            ";
            $args  = ['today' => $today, 'city1' => $scope, 'city2' => $scope];

            $stmt = $pdo->prepare("
                SELECT dc.theme, count(DISTINCT dc.id) AS challenges, count(*) AS proofs,
                       count(*) FILTER (WHERE p.place_lat IS NOT NULL) AS pinned
                {$from}
                GROUP BY dc.theme
            ");
            $stmt->execute($args);
            $agg = [];
            foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
                $agg[$r['theme']] = $r;
            }

            $stmt = $pdo->prepare("
                SELECT DISTINCT ON (theme) theme, currency, min_amount, max_amount
                FROM (
                    SELECT dc.theme, p.price_currency AS currency, min(p.price_amount) AS min_amount,
                           max(p.price_amount) AS max_amount, count(*) AS n
                    {$from} AND p.price_amount IS NOT NULL
                    GROUP BY dc.theme, p.price_currency
                ) x
                ORDER BY theme, n DESC, currency
            ");
            $stmt->execute($args);
            $prices = [];
            foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
                $prices[$r['theme']] = ['currency' => $r['currency'], 'min' => (float) $r['min_amount'], 'max' => (float) $r['max_amount']];
            }

            // A few extra per theme, so blocked authors can be dropped per viewer.
            $stmt = $pdo->prepare("
                SELECT theme, id, user_id, photo_url, vote_count, challenge_date FROM (
                    SELECT dc.theme, p.id, p.user_id, p.photo_url, p.vote_count, dc.challenge_date,
                           row_number() OVER (PARTITION BY dc.theme ORDER BY p.vote_count DESC, p.approved_at DESC) AS rn
                    {$from}
                ) x
                WHERE rn <= 6
                ORDER BY theme, rn
            ");
            $stmt->execute($args);
            $photos = [];
            foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
                $photos[$r['theme']][] = $r;
            }
            return ['agg' => $agg, 'prices' => $prices, 'photos' => $photos];
        }) ?? ['agg' => [], 'prices' => [], 'photos' => []];

        $blocked = array_flip($blockedUserIds);
        $themes  = [];
        foreach (DailyThemes::keys() as $key) {
            $a = $data['agg'][$key] ?? null;
            $best = array_values(array_filter($data['photos'][$key] ?? [], static fn(array $r): bool => !isset($blocked[$r['user_id']])));
            $themes[] = [
                'theme'          => DailyThemes::format($key, null),
                'challengesDone' => (int) ($a['challenges'] ?? 0),
                'proofs'         => (int) ($a['proofs'] ?? 0),
                'bestPhotos'     => array_map(static fn(array $r): array => [
                    'proofId'   => $r['id'],
                    'date'      => $r['challenge_date'],
                    'thumbUrl'  => R2Uploader::thumbProxy($r['photo_url']),
                    'voteCount' => (int) $r['vote_count'],
                ], array_slice($best, 0, 3)),
                'priceRange'     => $data['prices'][$key] ?? null,
                'pinnedPlaces'   => (int) ($a['pinned'] ?? 0),
            ];
        }
        return ['scope' => $isLive ? 'city' : 'world', 'themes' => $themes];
    }

    /**
     * Days from $from to $to (inclusive), for the week strip and the month
     * calendar: [{date, theme, published, myStatus}]. Pure. $rows are the
     * challenges of the range with challenge_date, theme, status and my
     * proof's status (my_status). Future days carry their theme (a teaser),
     * never a text.
     */
    public static function calendarDays(string $from, string $to, array $rows): array
    {
        $byDate = [];
        foreach ($rows as $r) {
            $byDate[(string) $r['challenge_date']] = $r;
        }
        $days = [];
        $end  = new DateTimeImmutable($to, new DateTimeZone('UTC'));
        for ($d = new DateTimeImmutable($from, new DateTimeZone('UTC')); $d <= $end; $d = $d->modify('+1 day')) {
            $key = $d->format('Y-m-d');
            $r   = $byDate[$key] ?? null;
            $days[] = [
                'date'      => $key,
                'theme'     => DailyThemes::format($r['theme'] ?? null, $key),
                'special'   => DailyThemes::effective($r['theme'] ?? null, $key) === DailyThemes::SPECIAL
                    ? DailySpecials::payload($r['special_id'] ?? null) : null,
                'published' => $r !== null && $r['status'] === 'published',
                'myStatus'  => $r !== null && $r['status'] === 'published' ? ($r['my_status'] ?? null) : null,
            ];
        }
        return $days;
    }

    /** The calendar of a range (at most 62 days) for a viewer (null = guest). */
    public static function calendar(string $from, string $to, ?string $viewerId): array
    {
        $stmt = Database::pdo()->prepare("
            SELECT dc.challenge_date, dc.theme, dc.special_id, dc.status, p.moderation_status AS my_status
            FROM daily_challenges dc
            LEFT JOIN daily_proofs p ON p.challenge_id = dc.id AND p.user_id = ?
            WHERE dc.challenge_date BETWEEN ? AND ? AND dc.status IN ('scheduled', 'published')
        ");
        $stmt->execute([$viewerId ?? '', $from, $to]);
        $streaks = $viewerId !== null ? DailyResults::streaks($viewerId) : null;
        return [
            'today'  => DailyClock::currentDate(),
            'days'   => self::calendarDays($from, $to, $stmt->fetchAll(PDO::FETCH_ASSOC)),
            'streak' => $streaks !== null ? ['current' => $streaks[0], 'best' => $streaks[1]] : null,
        ];
    }

    /**
     * Challenge object in $locale (default: the request's, DailyI18n::current).
     * text/context are translated when the founder wrote a translation;
     * original {text, context} and lang are then set (else null).
     */
    public static function formatChallenge(array $row, ?DateTimeImmutable $now = null, ?string $locale = null): array
    {
        $date = (string) $row['challenge_date'];
        [$start, $end] = DailyClock::window($date);
        $locale  = $locale ?? DailyI18n::current();
        $text    = json_decode((string) $row['text_i18n'], true) ?: [];
        $context = json_decode((string) ($row['context_i18n'] ?? '{}'), true) ?: [];
        $enText  = (string) ($text['en'] ?? '');
        $enCtx   = ($context['en'] ?? '') !== '' ? (string) $context['en'] : null;
        $tText   = DailyI18n::pick($text, $locale);
        $tCtx    = $enCtx !== null ? DailyI18n::pick($context, $locale) : null;
        $isTranslated = $tText !== null;
        $themeKey = DailyThemes::effective($row['theme'] ?? null, $date);
        $special  = $themeKey === DailyThemes::SPECIAL ? DailySpecials::payload($row['special_id'] ?? null, $locale) : null;
        return [
            'id'       => $row['id'],
            'date'     => $date,
            'text'     => $tText ?? $enText,
            // The Today hero's short headline (SPEC 9.3) in the viewer's language, else English; null = show the text.
            'headline' => self::headline($row['headline_i18n'] ?? null, $locale),
            // The challenge screen's subtitle under the question, same fallback; null = show the text.
            'subtitle' => self::headline($row['subtitle_i18n'] ?? null, $locale),
            // The share card's question in the viewer's language, else English; null = the apps' "What's YOUR city's answer?".
            'shareQuestion' => self::headline($row['share_question_i18n'] ?? null, $locale),
            'context'  => $isTranslated ? ($tCtx ?? $enCtx) : $enCtx,
            'original' => $isTranslated ? ['text' => $enText, 'context' => $enCtx] : null,
            'lang'     => $isTranslated ? $locale : null,
            'startsAt' => $start->getTimestamp(),
            'endsAt'   => $end->getTimestamp(),
            'isActive' => DailyClock::isActive($date, $now),
            'theme'    => DailyThemes::format($row['theme'] ?? null, $date),
            // A special day (theme "special"): {id, name, emoji, icon, coverUrl, scope}.
            'special'  => $special,
            // The card's cover: the challenge's own (back office upload), else the
            // special's, else the theme's uploaded default; null = the image bundled in the apps.
            'coverUrl' => ($row['cover_url'] ?? null) ?: ($special['coverUrl'] ?? null) ?: (DailyThemes::covers()[$themeKey] ?? null),
            'proposedBy' => self::credit($row['id'], $row['proposed_by_user_id'] ?? null),
            // SPEC 10.2: the comparison question {type, question, unit, original, maxLength}, or null.
            'compare'  => DailyCompare::payload($row, $locale),
        ];
    }

    private static function headline(mixed $json, string $locale): ?string
    {
        $all = is_string($json) ? (json_decode($json, true) ?: []) : [];
        return ($all[$locale] ?? null) ?: (($all['en'] ?? null) ?: null);
    }

    /** @var array<string, ?array> challenge id => credit, per request */
    private static array $credits = [];

    /**
     * "Proposed by <name> · <city>" of a challenge from a user's proposal
     * (V2-05): {user, city}, or null. One small lookup per proposed challenge.
     */
    public static function credit(string $challengeId, ?string $userId): ?array
    {
        if ($userId === null || $userId === '') {
            return null;
        }
        if (!array_key_exists($challengeId, self::$credits)) {
            $stmt = Database::pdo()->prepare("
                SELECT u.id, u.username, u.display_name, u.profile_photo_url, p.city_id, ch.name AS city_name
                FROM users u
                LEFT JOIN daily_proposals p ON p.created_challenge_id = ?
                LEFT JOIN channels ch       ON ch.id = p.city_id
                WHERE u.id = ? AND u.deleted_at IS NULL
            ");
            $stmt->execute([$challengeId, $userId]);
            $r = $stmt->fetch(PDO::FETCH_ASSOC);
            self::$credits[$challengeId] = $r ? [
                'user' => ['id' => $r['id'], 'username' => $r['username'], 'displayName' => $r['display_name'],
                           'photoUrl' => R2Uploader::thumbProxy($r['profile_photo_url'])],
                'city' => $r['city_id'] !== null ? ['id' => (int) substr((string) $r['city_id'], 5), 'name' => $r['city_name'], 'country' => CityRepository::countryOf($r['city_id'])] : null,
            ] : null;
        }
        return self::$credits[$challengeId];
    }

    private static function formatTwist(array $row, ?string $locale = null): array
    {
        $i18n = json_decode((string) ($row['text_i18n'] ?? '{}'), true) ?: [];
        [$text, $original] = DailyI18n::localize($i18n, (string) $row['text'], $locale ?? DailyI18n::current());
        return [
            'id'     => $row['id'],
            'text'   => $text,
            'originalText' => $original,
            'lang'   => $original !== null ? ($locale ?? DailyI18n::current()) : null,
            'author' => $row['author_user_id'] !== null ? [
                'id'          => $row['author_user_id'],
                'username'    => $row['username'],
                'displayName' => $row['display_name'],
                'photoUrl'    => R2Uploader::thumbProxy($row['profile_photo_url']),
            ] : null,
            'credit' => $row['author_credit'],
        ];
    }
}
