<?php

declare(strict_types=1);

/**
 * How the world answered (SPEC 10.6): the comparison board of a challenge,
 * one row per city with at least one approved proof, and Today's live teaser.
 *
 * A city's row shows the answer of its best proof (the results ranking,
 * DailyResults::rankProofs: votes, then local votes, then earliest approval,
 * SPEC 10.12), else of its best proof that has an answer (proofs from apps
 * before V4 have none); the median price in EUR (Currencies) and the proof
 * count. Number and time questions also get the range across cities. Demo and
 * seed proofs never count; blocked authors are left out per viewer.
 *
 * The raw rows are cached 30 s per challenge; approvals and removals forget
 * them (DailyPresence::forget).
 */
final class DailyBoard
{
    private const CACHE_TTL = 30;
    /** The card's live ticker cycles through this many cities' answers (other cities first). */
    public const TEASER_ANSWERS = 12;

    public static function cacheKey(string $challengeId): string
    {
        return 'daily_board_v1_' . $challengeId;
    }

    // ── Pure helpers (unit-tested) ────────────────────────────────────────────

    /** Median of numbers, or null for none. */
    public static function median(array $values): ?float
    {
        $v = array_values(array_filter($values, static fn($x) => $x !== null));
        if ($v === []) {
            return null;
        }
        sort($v);
        $n = count($v);
        return $n % 2 ? (float) $v[intdiv($n, 2)] : ($v[$n / 2 - 1] + $v[$n / 2]) / 2;
    }

    /**
     * Rows of the board from proof rows (city_id, city_name, country, vote
     * counts, approved_at, answer_*, price_eur), $type the question's type.
     * Each row: {cityId, cityName, country, best (proof row with the answer, or
     * the city's best), count, prices (EUR list)}. Most proofs first, then name. Pure.
     */
    public static function group(array $proofs, ?string $type): array
    {
        $byCity = [];
        foreach ($proofs as $p) {
            $byCity[(string) $p['city_id']][] = $p;
        }
        $rows = [];
        foreach ($byCity as $cityId => $list) {
            $ranked = DailyResults::rankProofs($list);
            $best   = $ranked[0];
            if ($type !== null) {
                foreach ($ranked as $r) {
                    if (self::hasAnswer($r)) {
                        $best = $r;
                        break;
                    }
                }
            }
            $rows[] = [
                'cityId'   => $cityId,
                'cityName' => (string) ($best['city_name'] ?? ''),
                'country'  => $best['country'] ?? null,
                'best'     => $best,
                'count'    => count($list),
                'prices'   => array_values(array_filter(array_map(static fn($r) => $r['price_eur'] ?? null, $list), static fn($x) => $x !== null)),
            ];
        }
        usort($rows, static fn(array $a, array $b): int => [$b['count'], $a['cityName']] <=> [$a['count'], $b['cityName']]);
        return $rows;
    }

    public static function hasAnswer(array $p): bool
    {
        return ($p['answer_text'] ?? null) !== null || ($p['answer_number'] ?? null) !== null || ($p['answer_minutes'] ?? null) !== null;
    }

    /** The comparable value of a row's answer (number, minutes), or null. Pure. */
    public static function numeric(array $p, string $type): ?float
    {
        $v = $type === 'number' ? ($p['answer_number'] ?? null) : ($type === 'time' ? ($p['answer_minutes'] ?? null) : null);
        return $v === null ? null : (float) $v;
    }

    /**
     * Lowest and highest answer across cities for number and time questions:
     * [minRow, maxRow] (board rows), or null with fewer than 2 distinct values. Pure.
     */
    public static function range(array $rows, ?string $type): ?array
    {
        if ($type !== 'number' && $type !== 'time') {
            return null;
        }
        $min = $max = null;
        foreach ($rows as $r) {
            $v = self::numeric($r['best'], $type);
            if ($v === null) {
                continue;
            }
            if ($min === null || $v < self::numeric($min['best'], $type)) {
                $min = $r;
            }
            if ($max === null || $v > self::numeric($max['best'], $type)) {
                $max = $r;
            }
        }
        return $min !== null && self::numeric($min['best'], $type) !== self::numeric($max['best'], $type) ? [$min, $max] : null;
    }

    /** Cities need this many priced answers for the price range and the fun fact (COPY.md 5). */
    public const MIN_PRICED = 3;

    /**
     * Cheapest and priciest median price among cities with at least
     * MIN_PRICED priced answers: [cheapestRow, priciestRow, median, median, ratio],
     * or null with fewer than 2 such cities. Pure.
     */
    public static function priceSpread(array $rows): ?array
    {
        $priced = [];
        foreach ($rows as $r) {
            if (count($r['prices']) >= self::MIN_PRICED) {
                $priced[] = [$r, self::median($r['prices'])];
            }
        }
        if (count($priced) < 2) {
            return null;
        }
        usort($priced, static fn(array $a, array $b): int => $a[1] <=> $b[1]);
        [$lo, $loM] = $priced[0];
        [$hi, $hiM] = $priced[count($priced) - 1];
        return [$lo, $hi, $loM, $hiM, $loM > 0 ? $hiM / $loM : null];
    }

    /** Up to $n answered rows for the teaser: other cities first, then the viewer's. Pure. */
    public static function teaserPick(array $rows, ?string $viewerCityId, int $n = 3): array
    {
        $answered = array_values(array_filter($rows, static fn(array $r) => self::hasAnswer($r['best'])));
        $others   = array_values(array_filter($answered, static fn(array $r) => $r['cityId'] !== $viewerCityId));
        $mine     = array_values(array_filter($answered, static fn(array $r) => $r['cityId'] === $viewerCityId));
        return array_slice(array_merge($others, $mine), 0, $n);
    }

    // ── Reads ────────────────────────────────────────────────────────────────

    /** Approved, real proofs of a challenge with their city and answer. Cached 30 s. */
    public static function proofs(string $challengeId): array
    {
        return Cache::remember(self::cacheKey($challengeId), self::CACHE_TTL, static function () use ($challengeId): array {
            $stmt = Database::pdo()->prepare("
                SELECT p.id, p.user_id, p.city_id, ch.name AS city_name, cc.country,
                       p.vote_count, p.local_vote_count, p.approved_at,
                       p.answer_text, p.answer_number, p.answer_minutes, p.price_amount, p.price_currency
                FROM daily_proofs p
                JOIN channels ch    ON ch.id = p.city_id
                JOIN users u        ON u.id = p.user_id
                LEFT JOIN cities cc ON cc.channel_id = p.city_id
                -- Demo and seed proofs never count, nor any proof of a demo account (a second guard).
                WHERE p.challenge_id = ? AND p.moderation_status = 'approved' AND NOT p.is_seed AND NOT p.is_demo AND NOT u.is_demo
            ");
            $stmt->execute([$challengeId]);
            $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
            foreach ($rows as &$r) {
                $r['price_eur'] = $r['price_amount'] !== null ? Currencies::toBase((float) $r['price_amount'], trim((string) $r['price_currency'])) : null;
            }
            return $rows;
        }) ?? [];
    }

    /** The board's rows for a challenge row, without blocked authors. */
    private static function rows(array $challenge, array $blockedUserIds): array
    {
        $proofs = self::proofs((string) $challenge['id']);
        if ($blockedUserIds !== []) {
            $blocked = array_flip($blockedUserIds);
            $proofs  = array_values(array_filter($proofs, static fn(array $p) => !isset($blocked[$p['user_id']])));
        }
        return self::group($proofs, $challenge['compare_type'] ?? null);
    }

    /**
     * GET /daily/challenges/{date}/compare: {compare, cities, countries, rows:
     * [{city, answer, bestProofId, count, priceMedianEur, priceCount}], range:
     * {min: {city, answer}, max: {city, answer}} | null}.
     */
    public static function board(array $challenge, array $blockedUserIds = [], ?string $locale = null): array
    {
        $locale = $locale ?? DailyI18n::current();
        $type   = $challenge['compare_type'] ?? null;
        $rows   = self::rows($challenge, $blockedUserIds);
        $out    = array_map(static fn(array $r) => [
            'city'           => self::city($r),
            'answer'         => self::answer($r, $challenge, $locale),
            'bestProofId'    => $r['best']['id'],
            'count'          => $r['count'],
            'priceMedianEur' => ($m = self::median($r['prices'])) !== null ? round($m, 4) : null,
            'priceCount'     => count($r['prices']),
        ], $rows);
        $range  = self::range($rows, $type);
        $spread = self::priceSpread($rows);
        return [
            'compare'   => DailyCompare::payload($challenge, $locale),
            'cities'    => count($rows),
            'countries' => count(array_unique(array_filter(array_column($rows, 'country')))),
            'rows'      => $out,
            'range'     => $range === null ? null : [
                'min' => ['city' => self::city($range[0]), 'answer' => self::answer($range[0], $challenge, $locale)],
                'max' => ['city' => self::city($range[1]), 'answer' => self::answer($range[1], $challenge, $locale)],
            ],
            // Cheapest / priciest median (EUR) among cities with 3 priced answers or more, and their ratio
            // (the apps show "3× the price in Oslo than in Saigon." only from 2).
            'prices'    => $spread === null ? null : [
                'cheapest' => ['city' => self::city($spread[0]), 'eur' => round($spread[2], 4)],
                'priciest' => ['city' => self::city($spread[1]), 'eur' => round($spread[3], 4)],
                'ratio'    => $spread[4] !== null ? round($spread[4], 1) : null,
            ],
        ];
    }

    /**
     * Today's live teaser (SPEC 10.6): {cities, countries, flags (up to 5
     * country codes), answers: [{city, answer}] (up to TEASER_ANSWERS, the
     * card's ticker)} once a city answered, else
     * null. Other cities first. The card's row shows the flags, "Already N
     * countries answered" and the answers from 2 countries, "See today's
     * answers" before.
     */
    public static function teaser(array $challenge, ?string $viewerCityId, array $blockedUserIds = [], ?string $locale = null): ?array
    {
        $locale   = $locale ?? DailyI18n::current();
        $rows     = self::rows($challenge, $blockedUserIds);
        // No question: every city with an approved answer counts (flags and countries, no answer lines).
        $asked    = ($challenge['compare_type'] ?? null) !== null;
        $answered = $asked ? array_values(array_filter($rows, static fn(array $r) => self::hasAnswer($r['best']))) : $rows;
        if ($answered === []) {
            return self::suggestedTeaser($challenge, $locale);
        }
        return [
            'cities'    => count($answered),
            'countries' => count(array_unique(array_filter(array_column($answered, 'country')))),
            // The card's flag stack: up to 5 countries that answered, most answers first.
            'flags'     => array_slice(array_values(array_unique(array_filter(array_column($answered, 'country')))), 0, 5),
            'answers'   => $asked ? array_map(static fn(array $r) => ['city' => self::city($r), 'answer' => self::answer($r, $challenge, $locale)],
                                              self::teaserPick($rows, $viewerCityId, self::TEASER_ANSWERS)) : [],
        ];
    }

    /**
     * No player answered yet: the world block shows the Hilads suggestions
     * attached to the challenge instead (flagged suggested, never counted as
     * answers: pushes and presence read real answers only). Null when none.
     */
    private static function suggestedTeaser(array $challenge, string $locale): ?array
    {
        try {
            $picks = Spots::picksFor($challenge, $locale);
        } catch (\Throwable $e) {
            return null;
        }
        $picks = array_values(array_filter($picks, static fn(array $p): bool => $p['city'] !== null));
        if ($picks === []) {
            return null;
        }
        $countries = array_values(array_unique(array_filter(array_map(static fn(array $p) => $p['city']['country'] ?? null, $picks))));
        return [
            'suggested' => true,
            'cities'    => count(array_unique(array_map(static fn(array $p) => $p['city']['id'], $picks))),
            'countries' => count($countries),
            'flags'     => array_slice($countries, 0, 5),
            'answers'   => array_map(static fn(array $p): array => ['city' => $p['city'], 'answer' => $p['answer'], 'place' => $p['place']['name']],
                                     array_slice($picks, 0, self::TEASER_ANSWERS)),
        ];
    }

    private static function city(array $r): array
    {
        return ['id' => (int) substr($r['cityId'], 5), 'name' => $r['cityName'], 'country' => $r['country']];
    }

    private static function answer(array $r, array $challenge, string $locale): ?array
    {
        $b = $r['best'];
        return DailyCompare::answerPayload($challenge['compare_type'] ?? null, $b['answer_text'] ?? null, $b['answer_number'] ?? null,
                                           $b['answer_minutes'] ?? null, $challenge['compare_unit_i18n'] ?? null, $locale);
    }
}
