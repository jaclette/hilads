<?php

declare(strict_types=1);

/**
 * The world, compared (SPEC 10.9, the Hilads Index by comparison): answers add
 * up by comparison, not by challenge. A comparison is a shared key:
 * daily_challenges.compare_key (the question: "dinner_time", "cheers_word")
 * or price_key (what the price is for: "coffee_price"), so every challenge
 * that asks the same thing, whatever its date, feeds the same card.
 *
 * Kinds: price (proofs' prices, in EUR), time (time questions), number and
 * word (the city's usual answer). Free text questions are never compared. A
 * city counts with at least MIN_ANSWERS answers; a card needs MIN_CITIES
 * such cities. Prices, times and numbers use the city's median ("usual"),
 * words the most frequent answer. Demo and seed proofs never count.
 *
 * Two scopes: last week (Today's carousel) and all time (the Index screen,
 * where "Two cities" is filtered by the apps).
 */
final class DailyComparisons
{
    public const MIN_ANSWERS = 3;
    public const MIN_CITIES  = 2;
    public const FUN_RATIO   = 2.0;
    private const CACHE_TTL  = 600;

    // ── Pure helpers (unit-tested) ────────────────────────────────────────────

    /**
     * Rows of a card from [city_id => [values]]: the cities with at least
     * MIN_ANSWERS values and their usual value, [{cityId, value, count}].
     * price, time, number: the median (times rounded to 30 minutes), lowest
     * first; word: the most frequent answer (case, spaces and end punctuation
     * ignored) in its most common spelling, most answers first. Pure.
     */
    public static function rows(string $kind, array $valuesByCity): array
    {
        $out = [];
        foreach ($valuesByCity as $cityId => $values) {
            if (count($values) < self::MIN_ANSWERS) {
                continue;
            }
            if ($kind === 'word') {
                $value = self::usualWord($values);
            } else {
                $m = (float) DailyBoard::median($values);
                $value = match ($kind) {
                    'time'  => (float) (((int) round($m / 30) * 30) % 1440),
                    'price' => round($m, 4),
                    default => round($m, 1),
                };
            }
            $out[] = ['cityId' => (string) $cityId, 'value' => $value, 'count' => count($values)];
        }
        usort($out, $kind === 'word'
            ? static fn(array $a, array $b): int => [$b['count'], $a['cityId']] <=> [$a['count'], $b['cityId']]
            : static fn(array $a, array $b): int => [$a['value'], $a['cityId']] <=> [$b['value'], $b['cityId']]);
        return $out;
    }

    /** The most frequent answer of a list, in its most common spelling ("Salud!" for salud, Salud!, SALUD). Pure. */
    public static function usualWord(array $answers): string
    {
        $groups = [];
        foreach ($answers as $a) {
            $norm = rtrim(mb_strtolower(trim((string) preg_replace('/\s+/u', ' ', (string) $a))), " !.?¡¿");
            $groups[$norm][] = trim((string) $a);
        }
        uasort($groups, static fn(array $x, array $y): int => count($y) <=> count($x));
        $spellings = array_count_values(reset($groups));
        arsort($spellings);
        return (string) array_key_first($spellings);
    }

    /** A price card's fun fact: {ratio, hi (cityId), lo (cityId)} when the priciest is at least FUN_RATIO times the cheapest. Pure. */
    public static function funFact(array $rows): ?array
    {
        if (count($rows) < 2) {
            return null;
        }
        $lo = $rows[0];
        $hi = $rows[count($rows) - 1];
        if ($lo['value'] <= 0 || $hi['value'] / $lo['value'] < self::FUN_RATIO) {
            return null;
        }
        return ['ratio' => round($hi['value'] / $lo['value'], 1), 'hi' => $hi['cityId'], 'lo' => $lo['cityId']];
    }

    // ── Reads ────────────────────────────────────────────────────────────────

    /**
     * GET /daily/compared?scope=week|all: {scope, from, to, cards: [{key, kind
     * (price|time|number|word), title (null for a price card), priceLabel
     * (price cards: "a coffee"), unit (numbers), date (its latest challenge),
     * rows: [{city, value, count}], funFact: {ratio, priciest, cheapest}|null}]},
     * in $locale. Week: last Monday to Sunday; all: every published day.
     */
    public static function forScope(string $scope, string $locale): array
    {
        [$from, $to] = $scope === 'week'
            ? [DailyIndex::lastWeek(DailyClock::currentDate()), null]
            : [null, null];
        if ($from !== null) {
            $to = (new DateTimeImmutable($from, new DateTimeZone('UTC')))->modify('+6 days')->format('Y-m-d');
        }
        $cards = [];
        foreach (self::cards($from, $to) as $c) {
            $meta = $c['meta'];
            $cards[] = [
                'key'        => $c['key'],
                'kind'       => $c['kind'],
                'title'      => $c['kind'] === 'price' ? null
                                : (DailyCompare::labelIn($meta['compare_title_i18n'] ?? null, $locale)
                                   ?? DailyCompare::labelIn($meta['compare_question_i18n'] ?? null, $locale)),
                'priceLabel' => $c['kind'] === 'price' ? DailyCompare::labelIn($meta['price_label_i18n'] ?? null, $locale) : null,
                'unit'       => $c['kind'] === 'number' ? DailyCompare::labelIn($meta['compare_unit_i18n'] ?? null, $locale) : null,
                'date'       => $meta['date'],
                'rows'       => array_map(static fn(array $r): array => ['city' => self::city($r['cityId']), 'value' => $r['value'], 'count' => $r['count']], $c['rows']),
                'funFact'    => $c['funFact'] === null ? null : [
                    'ratio' => $c['funFact']['ratio'], 'priciest' => self::city($c['funFact']['hi']), 'cheapest' => self::city($c['funFact']['lo']),
                ],
            ];
        }
        return ['scope' => $scope, 'from' => $from, 'to' => $to, 'cards' => $cards];
    }

    /** The qualifying cards of a date range (null = all time), most cities first. Locale-free, cached. */
    private static function cards(?string $from, ?string $to): array
    {
        $key = 'daily_compared_v1_' . ($from ?? 'all') . '_' . DailyClock::currentDate();
        return Cache::remember($key, self::CACHE_TTL, static function () use ($from, $to): array {
            $pdo  = Database::pdo();
            $stmt = $pdo->prepare("
                SELECT dc.compare_type, dc.compare_key, dc.price_key, p.city_id,
                       p.price_amount, p.price_currency, p.answer_text, p.answer_number, p.answer_minutes
                FROM daily_challenges dc
                JOIN daily_proofs p ON p.challenge_id = dc.id
                JOIN users u        ON u.id = p.user_id
                WHERE dc.status = 'published' AND (dc.compare_key IS NOT NULL OR dc.price_key IS NOT NULL)
                  AND (?::date IS NULL OR dc.challenge_date >= ?::date) AND (?::date IS NULL OR dc.challenge_date <= ?::date)
                  AND p.moderation_status = 'approved' AND NOT p.is_seed AND NOT p.is_demo AND NOT u.is_demo
            ");
            $stmt->execute([$from, $from, $to, $to]);
            $groups = [];   // "kind|key" => [city_id => [values]]
            foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
                if ($r['price_key'] !== null && $r['price_amount'] !== null) {
                    $eur = Currencies::toBase((float) $r['price_amount'], trim((string) $r['price_currency']));
                    if ($eur !== null) {
                        $groups['price|' . $r['price_key']][$r['city_id']][] = $eur;
                    }
                }
                if ($r['compare_key'] === null) {
                    continue;
                }
                $value = match ($r['compare_type']) {
                    'time'   => $r['answer_minutes'] !== null ? (float) $r['answer_minutes'] : null,
                    'number' => $r['answer_number'] !== null ? (float) $r['answer_number'] : null,
                    'word'   => $r['answer_text'] !== null && trim((string) $r['answer_text']) !== '' ? (string) $r['answer_text'] : null,
                    default  => null,   // free text is never compared
                };
                if ($value !== null) {
                    $groups[$r['compare_type'] . '|' . $r['compare_key']][$r['city_id']][] = $value;
                }
            }
            $cards = [];
            foreach ($groups as $gk => $byCity) {
                [$kind, $key] = explode('|', $gk, 2);
                $rows = self::rows($kind, $byCity);
                if (count($rows) < self::MIN_CITIES) {
                    continue;
                }
                $cards[] = ['key' => $key, 'kind' => $kind, 'rows' => $rows,
                            'funFact' => $kind === 'price' ? self::funFact($rows) : null, 'meta' => self::meta($kind, $key)];
            }
            usort($cards, static fn(array $a, array $b): int => [count($b['rows']), $a['key']] <=> [count($a['rows']), $b['key']]);
            return $cards;
        }) ?? [];
    }

    /** The latest published challenge of a comparison: its title, question, unit or price label, and date. */
    private static function meta(string $kind, string $key): array
    {
        $col  = $kind === 'price' ? 'price_key' : 'compare_key';
        $stmt = Database::pdo()->prepare("
            SELECT challenge_date::text AS date, compare_title_i18n, compare_question_i18n, compare_unit_i18n, price_label_i18n
            FROM daily_challenges
            WHERE {$col} = ? AND status = 'published'
            ORDER BY challenge_date DESC LIMIT 1
        ");
        $stmt->execute([$key]);
        return $stmt->fetch(PDO::FETCH_ASSOC) ?: ['date' => null];
    }

    private static function city(string $cityId): array
    {
        $id   = (int) substr($cityId, 5);
        $city = CityRepository::findById($id);
        return ['id' => $id, 'name' => $city['name'] ?? null, 'country' => $city['country'] ?? null];
    }
}
