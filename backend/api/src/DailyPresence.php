<?php

declare(strict_types=1);

/**
 * "Represent your city" (SPEC 9.16): a city is represented on a challenge day
 * when it has at least one approved proof for that day's challenge (seed and
 * demo proofs never count). A proof counts for the city it was posted in and
 * for its challenge's day, even when approved after the next drop.
 *
 * - presence: represented today, the city's streak (consecutive represented
 *   days, ending today when represented, else yesterday) and how many cities
 *   are on today's board. Cached briefly per city and day; approvals, rejections
 *   and removals forget it (late approvals recompute the streak).
 * - pioneers: the first approved proof ever in a city makes its author the
 *   city's Pioneer (daily_pioneers, one per city, permanent, badge only). Demo,
 *   seed and hidden_from_rankings accounts never become pioneers.
 */
final class DailyPresence
{
    private const CACHE_TTL = 60;
    /** How far back a streak is counted. */
    private const STREAK_DAYS = 400;

    // ── Pure helpers (unit-tested) ────────────────────────────────────────────

    /**
     * From the represented challenge dates of a city (Y-m-d, any order) and
     * today: ['represented' => today is, 'streak' => consecutive days ending
     * today when represented, else ending yesterday].
     */
    public static function streakFrom(array $dates, string $today): array
    {
        $set = array_flip($dates);
        $represented = isset($set[$today]);
        $day = new DateTimeImmutable($today, new DateTimeZone('UTC'));
        if (!$represented) {
            $day = $day->modify('-1 day');
        }
        $n = 0;
        while (isset($set[$day->format('Y-m-d')])) {
            $n++;
            $day = $day->modify('-1 day');
        }
        return ['represented' => $represented, 'streak' => $n];
    }

    // ── Reads ────────────────────────────────────────────────────────────────

    /** Represented today and the streak of a city ('city_N'), today = DailyClock's. Cached. */
    public static function forCity(string $cityId, ?string $today = null): array
    {
        $today ??= DailyClock::currentDate();
        return Cache::remember(self::key($cityId, $today), self::CACHE_TTL, static function () use ($cityId, $today): array {
            $stmt = Database::pdo()->prepare("
                SELECT DISTINCT dc.challenge_date::text
                FROM daily_proofs p
                JOIN daily_challenges dc ON dc.id = p.challenge_id
                WHERE p.city_id = ? AND p.moderation_status = 'approved' AND NOT p.is_seed AND NOT p.is_demo
                  AND dc.status = 'published' AND dc.challenge_date BETWEEN ?::date - " . self::STREAK_DAYS . " AND ?::date
            ");
            $stmt->execute([$cityId, $today, $today]);
            return self::streakFrom($stmt->fetchAll(PDO::FETCH_COLUMN), $today);
        }) ?? ['represented' => false, 'streak' => 0];
    }

    /** Cities with an approved proof for a challenge (today's board). Cached. */
    public static function citiesOn(string $challengeId): int
    {
        $row = Cache::remember('daily_cities_on_v1_' . $challengeId, self::CACHE_TTL, static function () use ($challengeId): array {
            $stmt = Database::pdo()->prepare("
                SELECT count(DISTINCT city_id) FROM daily_proofs
                WHERE challenge_id = ? AND moderation_status = 'approved' AND city_id IS NOT NULL AND NOT is_seed AND NOT is_demo
            ");
            $stmt->execute([$challengeId]);
            return ['n' => (int) $stmt->fetchColumn()];
        });
        return (int) ($row['n'] ?? 0);
    }

    /**
     * Today's presence block for a city: {represented, streak, citiesToday,
     * pioneer}. represented is the viewer's: their own pending or approved
     * proof posted in this city counts for them (a rejected one doesn't).
     */
    public static function payload(string $cityId, string $challengeId, ?array $myProof = null): array
    {
        $p    = self::forCity($cityId);
        $mine = $myProof !== null && ($myProof['city_id'] ?? null) === $cityId
            && in_array($myProof['moderation_status'] ?? null, ['pending', 'approved'], true);
        $pioneer = self::pioneerOf($cityId);
        return [
            'represented' => $p['represented'] || $mine,
            // The city's run of represented days (ending today when represented, else yesterday).
            'streak'      => $p['streak'],
            'citiesToday' => self::citiesOn($challengeId),
            'pioneer'     => $pioneer !== null ? ['username' => $pioneer['username']] : null,
        ];
    }

    /**
     * Whether a proof would be its city's first of its day: no other proof
     * (approved, or pending when $countPending) from that city for its challenge.
     */
    public static function isFirstOfDay(array $proof, bool $countPending): bool
    {
        if (($proof['city_id'] ?? null) === null) {
            return false;
        }
        $statuses = $countPending ? "('approved', 'pending')" : "('approved')";
        $stmt = Database::pdo()->prepare("
            SELECT 1 FROM daily_proofs
            WHERE challenge_id = ? AND city_id = ? AND id <> ? AND moderation_status IN {$statuses}
              AND NOT is_seed AND NOT is_demo
            LIMIT 1
        ");
        $stmt->execute([$proof['challenge_id'], $proof['city_id'], $proof['id']]);
        return $stmt->fetchColumn() === false;
    }

    /** Forget the cached presence of a city and the board of a challenge (approval, rejection, removal). */
    public static function forget(?string $cityId, ?string $challengeId): void
    {
        if ($cityId !== null) {
            Cache::forget(self::key($cityId, DailyClock::currentDate()));
        }
        if ($challengeId !== null) {
            Cache::forget('daily_cities_on_v1_' . $challengeId);
        }
    }

    // ── After a moderation decision ──────────────────────────────────────────

    /**
     * After a proof's approval: forget the presence caches, track the city's
     * first proof of its day (city_represented_first; city_streak_saved when
     * it keeps a streak of 1 day or more alive) and award the city's Pioneer.
     */
    public static function afterApproval(?array $proof): void
    {
        if ($proof === null || $proof['moderation_status'] !== 'approved' || ($proof['city_id'] ?? null) === null
            || DailyProofRepository::bool($proof['is_seed'] ?? false) || DailyProofRepository::bool($proof['is_demo'] ?? false)) {
            return;
        }
        $cityId = (string) $proof['city_id'];
        self::forget($cityId, (string) $proof['challenge_id']);
        if (self::isFirstOfDay($proof, false)) {
            $date   = (string) $proof['challenge_date'];
            $before = self::forCity($cityId, (new DateTimeImmutable($date, new DateTimeZone('UTC')))->modify('-1 day')->format('Y-m-d'));
            $props  = ['city_id' => $cityId, 'challenge_date' => $date, 'late' => $date !== DailyClock::currentDate()];
            AnalyticsService::capture('city_represented_first', (string) $proof['user_id'], $props);
            if ($before['represented'] && $before['streak'] >= 1) {
                AnalyticsService::capture('city_streak_saved', (string) $proof['user_id'], $props + ['streak' => $before['streak'] + 1]);
            }
        }
        self::awardPioneer($proof);
    }

    /** The Pioneer of the proof's city, when it has none yet and the author is a real player. True when awarded now. */
    public static function awardPioneer(array $proof): bool
    {
        $stmt = Database::pdo()->prepare("
            INSERT INTO daily_pioneers (city_id, user_id, proof_id)
            SELECT p.city_id, p.user_id, p.id
            FROM daily_proofs p
            JOIN users u ON u.id = p.user_id
            WHERE p.id = ? AND p.moderation_status = 'approved' AND p.city_id IS NOT NULL
              AND NOT p.is_seed AND NOT p.is_demo AND NOT u.is_demo AND NOT u.hidden_from_rankings
            ON CONFLICT (city_id) DO NOTHING
            RETURNING city_id
        ");
        $stmt->execute([$proof['id']]);
        $awarded = $stmt->fetchColumn() !== false;
        if ($awarded) {
            Cache::forget('daily_pioneer_spots_v1');
            unset(self::$pioneers[(string) $proof['city_id']]);
        }
        return $awarded;
    }

    // ── Pioneers ─────────────────────────────────────────────────────────────

    /** @var array<string, ?array> per request */
    private static array $pioneers = [];

    /** A city's Pioneer {user_id, username}, or null. */
    public static function pioneerOf(string $cityId): ?array
    {
        if (!array_key_exists($cityId, self::$pioneers)) {
            try {
                $stmt = Database::pdo()->prepare("
                    SELECT dp.user_id, u.username FROM daily_pioneers dp LEFT JOIN users u ON u.id = dp.user_id WHERE dp.city_id = ?
                ");
                $stmt->execute([$cityId]);
                self::$pioneers[$cityId] = $stmt->fetch(PDO::FETCH_ASSOC) ?: null;
            } catch (\Throwable $e) {
                self::$pioneers[$cityId] = null;   // before the migration
            }
        }
        return self::$pioneers[$cityId];
    }

    /** The cities a user is the Pioneer of, oldest first: [{city: {id, name, country}, since}]. */
    public static function citiesOf(string $userId): array
    {
        try {
            $stmt = Database::pdo()->prepare("
                SELECT dp.city_id, ch.name, dp.awarded_at FROM daily_pioneers dp
                JOIN channels ch ON ch.id = dp.city_id
                WHERE dp.user_id = ? ORDER BY dp.awarded_at
            ");
            $stmt->execute([$userId]);
        } catch (\Throwable $e) {
            return [];
        }
        return array_map(static fn(array $r): array => [
            'city'  => ['id' => (int) substr((string) $r['city_id'], 5), 'name' => $r['name'], 'country' => CityRepository::countryOf((string) $r['city_id'])],
            'since' => strtotime((string) $r['awarded_at']),
        ], $stmt->fetchAll(PDO::FETCH_ASSOC));
    }

    /** Places holding their city's pioneer proof: place id => city name ("Spot #1 in Saigon"). Cached. */
    public static function pioneerSpots(): array
    {
        return Cache::remember('daily_pioneer_spots_v1', 300, static function (): array {
            try {
                return Database::pdo()->query("
                    SELECT p.place_id, ch.name FROM daily_pioneers dp
                    JOIN daily_proofs p ON p.id = dp.proof_id
                    JOIN channels ch ON ch.id = dp.city_id
                    WHERE p.place_id IS NOT NULL
                ")->fetchAll(PDO::FETCH_KEY_PAIR);
            } catch (\Throwable $e) {
                return [];
            }
        }) ?? [];
    }

    private static function key(string $cityId, string $today): string
    {
        return 'daily_presence_v1_' . $cityId . '_' . $today;
    }
}
