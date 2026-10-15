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
        return Cache::remember('daily_challenge_v1_' . $date, 60, function () use ($date): ?array {
            $stmt = Database::pdo()->prepare("
                SELECT id, challenge_date, text_i18n, context_i18n, published_at
                FROM daily_challenges
                WHERE challenge_date = ? AND status = 'published'
            ");
            $stmt->execute([$date]);
            $row = $stmt->fetch(PDO::FETCH_ASSOC);
            return $row ?: null;
        });
    }

    /** Selected, approved twist of (challenge, city) with its author, or null. */
    public static function twistFor(string $challengeId, string $cityId): ?array
    {
        $stmt = Database::pdo()->prepare("
            SELECT t.id, t.text, t.author_credit, t.author_user_id,
                   u.username, u.display_name, u.profile_photo_url
            FROM daily_twists t
            LEFT JOIN users u ON u.id = t.author_user_id
            WHERE t.challenge_id = ? AND t.city_id = ?
              AND t.status = 'selected' AND t.moderation_status = 'approved'
        ");
        $stmt->execute([$challengeId, $cityId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row ? self::formatTwist($row) : null;
    }

    /** Approved proof counts, World and (when given) city. */
    public static function counts(string $challengeId, ?string $cityId): array
    {
        $stmt = Database::pdo()->prepare("
            SELECT count(*) AS world,
                   count(*) FILTER (WHERE city_id = ?) AS city
            FROM daily_proofs
            WHERE challenge_id = ? AND moderation_status = 'approved'
        ");
        $stmt->execute([$cityId ?? '', $challengeId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return ['world' => (int) $row['world'], 'city' => $cityId !== null ? (int) $row['city'] : null];
    }

    /**
     * Practical info from approved proofs: price ranges per currency (most
     * used first; the app shows the first) and up to 50 pinned places.
     */
    public static function practical(string $challengeId, ?string $cityId): array
    {
        $cityFilter = $cityId !== null ? " AND city_id = ?" : "";
        $args = $cityId !== null ? [$challengeId, $cityId] : [$challengeId];
        $pdo  = Database::pdo();

        $stmt = $pdo->prepare("
            SELECT price_currency AS currency, min(price_amount) AS min, max(price_amount) AS max, count(*) AS n
            FROM daily_proofs
            WHERE challenge_id = ? AND moderation_status = 'approved' AND price_amount IS NOT NULL{$cityFilter}
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

        $stmt = $pdo->prepare("
            SELECT id, place_lat, place_lng, place_name
            FROM daily_proofs
            WHERE challenge_id = ? AND moderation_status = 'approved' AND place_lat IS NOT NULL{$cityFilter}
            ORDER BY approved_at DESC
            LIMIT 50
        ");
        $stmt->execute($args);
        $places = array_map(fn(array $r): array => [
            'proofId' => $r['id'],
            'lat'     => (float) $r['place_lat'],
            'lng'     => (float) $r['place_lng'],
            'name'    => $r['place_name'],
        ], $stmt->fetchAll(PDO::FETCH_ASSOC));

        return ['priceRanges' => $prices, 'places' => $places];
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
        $now       = new DateTimeImmutable('now');
        $isLive    = DailyRules::isLive($cityId);
        $city      = null;
        if ($cityId !== null) {
            $n    = (int) substr($cityId, 5);
            $city = ['id' => $n, 'name' => CityRepository::findById($n)['name'] ?? null, 'isLive' => $isLive];
        }

        $out = [
            'challenge'   => $challenge !== null ? self::formatChallenge($challenge, $now) : null,
            'nextDropAt'  => DailyClock::nextDropAt($now)->getTimestamp(),
            'secondsLeft' => DailyClock::secondsLeft($now),
            'serverTime'  => $now->getTimestamp(),
            'city'        => $city,
            'twist'       => null,
            'counts'      => ['world' => 0, 'city' => $cityId !== null ? 0 : null],
            'myProof'     => null,
            'myVotes'     => null,
            'streak'      => $viewer !== null ? DailyResults::currentStreak($viewer['id']) : null,
        ];
        if ($challenge === null) {
            return $out;
        }

        if ($isLive) {
            $out['twist'] = self::twistFor($challenge['id'], $cityId);
        }
        $out['counts'] = self::counts($challenge['id'], $cityId);
        if ($viewer !== null) {
            $mine = DailyProofRepository::findMine($challenge['id'], $viewer['id']);
            $out['myProof'] = $mine ? DailyProofRepository::format($mine, $viewer['id']) : null;
            $votes = DailyVotes::mine($challenge['id'], $viewer['id']);
            $out['myVotes'] = ['used' => $votes['used'], 'left' => $votes['left']];
        }
        return $out;
    }

    /**
     * Past challenges (before today's), newest first, as informative cards for
     * a city. A dead city (or none) gets the World selection: best proof from
     * anywhere, no twist. Best proof = stored result rank 1 once results exist
     * (phase 2), else most votes, then latest approval.
     */
    public static function archive(?string $cityId, ?string $beforeDate, int $limit): array
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
            SELECT dc.id, dc.challenge_date, dc.text_i18n, dc.context_i18n,
                   best.id AS best_proof_id,
                   tw.text AS twist_text, tw.author_credit AS twist_credit,
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
                ORDER BY r.rank NULLS LAST, p.vote_count DESC, p.approved_at DESC
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
                WHERE p.challenge_id = dc.id AND p.moderation_status = 'approved'
            ) stats ON true
            WHERE dc.status = 'published' AND dc.challenge_date < :before
            ORDER BY dc.challenge_date DESC
            LIMIT :lim
        ");
        $stmt->execute([
            'scope' => $scope,
            'city1' => $cityArg, 'city2' => $cityArg, 'city3' => $cityArg ?? '',
            'city4' => $cityArg, 'city5' => $cityArg, 'city6' => $cityArg ?? '',
            'city7' => $cityArg, 'city8' => $cityArg,
            'before' => $before,
            'lim'    => $limit,
        ]);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

        $items = [];
        foreach ($rows as $r) {
            $best = $r['best_proof_id'] ? DailyProofRepository::findById($r['best_proof_id']) : null;
            $items[] = [
                'challenge'    => self::formatChallenge($r),
                'bestProof'    => $best ? DailyProofRepository::format($best) : null,
                'twist'        => $r['twist_text'] !== null ? self::formatTwist([
                    'id' => null, 'text' => $r['twist_text'], 'author_credit' => $r['twist_credit'],
                    'author_user_id' => $r['twist_user_id'], 'username' => $r['twist_username'],
                    'display_name' => $r['twist_display_name'], 'profile_photo_url' => $r['twist_photo'],
                ]) : null,
                'priceRange'   => $r['currency'] !== null ? [
                    'currency' => $r['currency'],
                    'min'      => (float) $r['min_amount'],
                    'max'      => (float) $r['max_amount'],
                ] : null,
                'counts'       => [
                    'world' => (int) $r['world_count'],
                    'city'  => $isLive ? (int) $r['city_count'] : null,
                ],
                'pinnedPlaces' => (int) $r['pinned_count'],
            ];
        }

        return [
            'scope'   => $isLive ? 'city' : 'world',
            'items'   => $items,
            'hasMore' => count($rows) >= $limit,
        ];
    }

    public static function formatChallenge(array $row, ?DateTimeImmutable $now = null): array
    {
        $date = (string) $row['challenge_date'];
        [$start, $end] = DailyClock::window($date);
        $text    = json_decode((string) $row['text_i18n'], true) ?: [];
        $context = json_decode((string) ($row['context_i18n'] ?? '{}'), true) ?: [];
        return [
            'id'       => $row['id'],
            'date'     => $date,
            'text'     => $text['en'] ?? '',
            'context'  => ($context['en'] ?? '') !== '' ? $context['en'] : null,
            'startsAt' => $start->getTimestamp(),
            'endsAt'   => $end->getTimestamp(),
            'isActive' => DailyClock::isActive($date, $now),
        ];
    }

    private static function formatTwist(array $row): array
    {
        return [
            'id'     => $row['id'],
            'text'   => $row['text'],
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
