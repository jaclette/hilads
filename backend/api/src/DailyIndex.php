<?php

declare(strict_types=1);

/**
 * The Hilads Index (SPEC 10.9): every Monday, cards built from last week's
 * price and time answers, for example "A coffee this week: Saigon 0.90 €,
 * Lisbon 1.20 €, Paris 2.80 €".
 *
 * One card per comparable question of the week (Monday to Sunday challenge
 * dates): a price card for a challenge whose proofs carry prices, a time card
 * for a time question. A city appears only with at least 3 proofs with that
 * value; a card needs at least 2 cities. Prices are medians in EUR (the
 * viewer's app converts them), times medians in minutes rounded to 30.
 * Demo and seed proofs never count.
 *
 * Built at Monday's drop (DailyDrop) and stored in daily_index_weeks; a past
 * week without one is built on first read.
 */
final class DailyIndex
{
    public const MIN_PROOFS = 3;
    public const MIN_CITIES = 2;
    private const CACHE_TTL = 300;

    // ── Pure helpers (unit-tested) ────────────────────────────────────────────

    /** The Monday of a date's ISO week (Y-m-d). Pure. */
    public static function weekStart(string $date): string
    {
        $d = new DateTimeImmutable($date, new DateTimeZone('UTC'));
        return $d->modify('-' . ((int) $d->format('N') - 1) . ' days')->format('Y-m-d');
    }

    /** The last complete week before a date's week: its Monday. Pure. */
    public static function lastWeek(string $date): string
    {
        return (new DateTimeImmutable(self::weekStart($date), new DateTimeZone('UTC')))->modify('-7 days')->format('Y-m-d');
    }

    /**
     * Rows of a card from [city_id => [values]]: cities with at least
     * MIN_PROOFS values, their median, lowest first: [{cityId, value, count}].
     * $roundTo rounds the median (30 for times). Pure.
     */
    public static function rows(array $valuesByCity, ?int $roundTo = null): array
    {
        $out = [];
        foreach ($valuesByCity as $cityId => $values) {
            if (count($values) < self::MIN_PROOFS) {
                continue;
            }
            $m = DailyBoard::median($values);
            if ($roundTo !== null) {
                $m = (float) (((int) round($m / $roundTo) * $roundTo) % 1440);
            }
            $out[] = ['cityId' => (string) $cityId, 'value' => round($m, 4), 'count' => count($values)];
        }
        usort($out, static fn(array $a, array $b): int => [$a['value'], $a['cityId']] <=> [$b['value'], $b['cityId']]);
        return $out;
    }

    // ── Build and store ──────────────────────────────────────────────────────

    /** Build and store the cards of a week (its Monday). Idempotent. Returns the card count. */
    public static function build(string $weekStart): int
    {
        $weekEnd = (new DateTimeImmutable($weekStart, new DateTimeZone('UTC')))->modify('+6 days')->format('Y-m-d');
        $stmt = Database::pdo()->prepare("
            SELECT dc.id, dc.challenge_date::text AS date, dc.compare_type,
                   p.city_id, p.price_amount, p.price_currency, p.answer_minutes
            FROM daily_challenges dc
            JOIN daily_proofs p ON p.challenge_id = dc.id
            JOIN channels ch    ON ch.id = p.city_id
            JOIN users u        ON u.id = p.user_id
            WHERE dc.status = 'published' AND dc.challenge_date BETWEEN ? AND ?
              AND p.moderation_status = 'approved' AND NOT p.is_seed AND NOT p.is_demo AND NOT u.is_demo AND NOT p.is_suggestion
            ORDER BY dc.challenge_date
        ");
        $stmt->execute([$weekStart, $weekEnd]);
        $prices = $times = $dates = [];
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $dates[$r['id']] = $r['date'];
            if ($r['price_amount'] !== null) {
                $eur = Currencies::toBase((float) $r['price_amount'], trim((string) $r['price_currency']));
                if ($eur !== null) {
                    $prices[$r['id']][$r['city_id']][] = $eur;
                }
            }
            if ($r['compare_type'] === 'time' && $r['answer_minutes'] !== null) {
                $times[$r['id']][$r['city_id']][] = (float) $r['answer_minutes'];
            }
        }
        $cards = [];
        foreach ($dates as $id => $date) {
            foreach (['price' => [$prices[$id] ?? [], null], 'time' => [$times[$id] ?? [], 30]] as $kind => [$byCity, $round]) {
                $rows = self::rows($byCity, $round);
                if (count($rows) >= self::MIN_CITIES) {
                    $cards[] = ['id' => "{$kind}-{$id}", 'kind' => $kind, 'challengeId' => $id, 'date' => $date, 'rows' => $rows];
                }
            }
        }
        Database::pdo()->prepare("
            INSERT INTO daily_index_weeks (week_start, cards, built_at) VALUES (?, ?::jsonb, now())
            ON CONFLICT (week_start) DO UPDATE SET cards = EXCLUDED.cards, built_at = now()
        ")->execute([$weekStart, json_encode($cards)]);
        Cache::forget(self::key($weekStart));
        return count($cards);
    }

    /** The stored cards of a week, built now for a past week without them. Cached. */
    public static function stored(string $weekStart): array
    {
        return Cache::remember(self::key($weekStart), self::CACHE_TTL, static function () use ($weekStart): array {
            $stmt = Database::pdo()->prepare("SELECT cards FROM daily_index_weeks WHERE week_start = ?");
            $stmt->execute([$weekStart]);
            $raw = $stmt->fetchColumn();
            if ($raw === false) {
                if ($weekStart > self::lastWeek(DailyClock::currentDate())) {
                    return [];   // not over yet
                }
                self::build($weekStart);
                $stmt->execute([$weekStart]);
                $raw = $stmt->fetchColumn();
            }
            return $raw === false ? [] : (json_decode((string) $raw, true) ?: []);
        }) ?? [];
    }

    /**
     * GET /daily/index: {weekStart, weekEnd, cards: [{id, kind (price|time),
     * date, challenge, rows: [{city, value (EUR | minutes), count}]}]} with
     * each challenge in the viewer's language.
     */
    public static function forWeek(string $weekStart, ?string $locale = null): array
    {
        $cards = [];
        foreach (self::stored($weekStart) as $c) {
            $challenge = DailyChallengeRepository::findPublishedByDate((string) $c['date']);
            if ($challenge === null) {
                continue;
            }
            $cards[] = [
                'id'        => $c['id'],
                'kind'      => $c['kind'],
                'date'      => $c['date'],
                'challenge' => DailyChallengeRepository::formatChallenge($challenge, null, $locale),
                'rows'      => array_map(static function (array $r): array {
                    $city = CityRepository::findById((int) substr($r['cityId'], 5));
                    return ['city' => ['id' => (int) substr($r['cityId'], 5), 'name' => $city['name'] ?? null, 'country' => $city['country'] ?? null],
                            'value' => $r['value'], 'count' => $r['count']];
                }, $c['rows']),
            ];
        }
        return [
            'weekStart' => $weekStart,
            'weekEnd'   => (new DateTimeImmutable($weekStart, new DateTimeZone('UTC')))->modify('+6 days')->format('Y-m-d'),
            'cards'     => $cards,
        ];
    }

    private static function key(string $weekStart): string
    {
        return 'daily_index_v1_' . $weekStart;
    }
}
