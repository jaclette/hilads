<?php

declare(strict_types=1);

/**
 * Yesterday around the world (SPEC 10.7): the world tour of a closed
 * challenge, every approved photo (since 2026-10-25; one per city before),
 * grouped by city, each city's photos best first (DailyResults::rankProofs:
 * most votes, then the earliest posted). Demo and seed proofs never count.
 *
 * Built once at the drop's closing step (DailyDrop::closeChallenge) and stored
 * in daily_world_tours (the city slides with their proof ids); a past day
 * without a stored tour is built on first read. Only real players' photos:
 * never demo, seed or Hilads suggestion proofs, and never a photo that is gone
 * from storage (checked at the build). Proofs are resolved on read: a stored
 * slide whose proof no longer qualifies (removed, moderated, a suggestion from
 * an older build) rebuilds the tour, so the city shows its next best photo or
 * leaves the tour.
 *
 * Order (per viewer): the cities of the global podium first (rank 1 to 3),
 * then the viewer's city, then the other cities, most proofs first; inside a
 * city, its photos best first.
 */
final class DailyTour
{
    private const CACHE_TTL = 60;

    // ── Pure helpers (unit-tested) ────────────────────────────────────────────

    /**
     * Slides from proof rows (id, city_id, vote_count, created_at) and the
     * World top 3 proof ids (rank order): one per photo, [{cityId, proofId,
     * count (the city's photos), rank (0 = the city's best), podium (1-3|null)}],
     * each city's photos best first. Pure.
     */
    public static function slides(array $proofs, array $worldTop3): array
    {
        $byCity = [];
        foreach ($proofs as $p) {
            $byCity[(string) $p['city_id']][] = $p;
        }
        $podium = array_flip(array_values($worldTop3));
        $out    = [];
        foreach ($byCity as $cityId => $list) {
            foreach (DailyResults::rankProofs($list) as $i => $p) {
                $out[] = ['cityId' => $cityId, 'proofId' => $p['id'], 'count' => count($list), 'rank' => $i,
                          'podium' => isset($podium[$p['id']]) ? $podium[$p['id']] + 1 : null];
            }
        }
        return $out;
    }

    /**
     * Slides in the viewer's order, grouped by city: the podium's cities (by
     * their best podium rank), the viewer's city, the others (most proofs, then
     * city id); inside a city, best first. Pure.
     */
    public static function order(array $slides, ?string $viewerCityId): array
    {
        $cityPodium = [];
        foreach ($slides as $s) {
            if ($s['podium'] !== null) {
                $cityPodium[$s['cityId']] = min($cityPodium[$s['cityId']] ?? 9, $s['podium']);
            }
        }
        $key = static fn(array $s): array => [$cityPodium[$s['cityId']] ?? 9, $s['cityId'] === $viewerCityId ? 0 : 1,
                                              -$s['count'], $s['cityId'], $s['rank'] ?? 0];
        usort($slides, static fn(array $a, array $b): int => $key($a) <=> $key($b));
        return $slides;
    }

    /** The moment of the day of a local hour: morning (5-12), afternoon (12-17), evening (17-22), night. Never an exact time. Pure. */
    public static function moment(int $hour): string
    {
        return match (true) {
            $hour >= 5 && $hour < 12  => 'morning',
            $hour >= 12 && $hour < 17 => 'afternoon',
            $hour >= 17 && $hour < 22 => 'evening',
            default                   => 'night',
        };
    }

    // ── Build and store ──────────────────────────────────────────────────────

    /** Build and store the tour of a challenge (closing step). Idempotent: a rerun replaces it. Returns the city count. */
    public static function build(array $challenge): int
    {
        $stmt = Database::pdo()->prepare("
            SELECT p.id, p.city_id, p.vote_count, p.local_vote_count, p.approved_at, p.created_at, p.photo_url
            FROM daily_proofs p
            JOIN channels ch ON ch.id = p.city_id
            JOIN users u     ON u.id = p.user_id
            WHERE p.challenge_id = ? AND p.moderation_status = 'approved' AND NOT p.is_seed AND NOT p.is_demo AND NOT u.is_demo AND NOT p.is_suggestion
              AND coalesce(p.photo_url, '') <> ''
        ");
        $stmt->execute([$challenge['id']]);
        $top3   = array_column(DailyResults::worldTop3((string) $challenge['id']), 'id');
        $rows   = $stmt->fetchAll(PDO::FETCH_ASSOC);
        // A photo gone from storage (e.g. a cleanup) leaves the tour.
        $rows   = array_values(array_filter($rows, static fn(array $r): bool => self::photoExists((string) $r['photo_url'])));
        $slides = self::slides($rows, $top3);
        Database::pdo()->prepare("
            INSERT INTO daily_world_tours (challenge_id, slides, built_at) VALUES (?, ?::jsonb, now())
            ON CONFLICT (challenge_id) DO UPDATE SET slides = EXCLUDED.slides, built_at = now()
        ")->execute([$challenge['id'], json_encode($slides)]);
        Cache::forget(self::key((string) $challenge['id']));
        return count($slides);
    }

    /** The stored slides of a challenge, built now for a closed day without one. Cached. */
    public static function stored(array $challenge): array
    {
        return Cache::remember(self::key((string) $challenge['id']), self::CACHE_TTL, static function () use ($challenge): array {
            $stmt = Database::pdo()->prepare("SELECT slides FROM daily_world_tours WHERE challenge_id = ?");
            $stmt->execute([$challenge['id']]);
            $raw = $stmt->fetchColumn();
            if ($raw === false) {
                if ((string) $challenge['challenge_date'] >= DailyClock::currentDate()) {
                    return [];   // still open: no tour yet
                }
                self::build($challenge);
                $stmt->execute([$challenge['id']]);
                $raw = $stmt->fetchColumn();
            }
            $slides = $raw === false ? [] : (json_decode((string) $raw, true) ?: []);
            // A tour stored before every photo had its slide (no 'rank'), or a slide whose proof
            // no longer qualifies (an older build, a removal): rebuild once.
            $rows = DailyProofRepository::rowsByIds(array_column($slides, 'proofId'));
            foreach ($slides as $s) {
                if (!array_key_exists('rank', $s) || !self::qualifies($rows[$s['proofId']] ?? null)) {
                    self::build($challenge);
                    $stmt->execute([$challenge['id']]);
                    $raw = $stmt->fetchColumn();
                    return $raw === false ? [] : (json_decode((string) $raw, true) ?: []);
                }
            }
            return $slides;
        }) ?? [];
    }

    /** A real player's approved photo: not demo, seed or a Hilads suggestion, with a photo. */
    private static function qualifies(?array $row): bool
    {
        return $row !== null && $row['moderation_status'] === 'approved'
            && !DailyProofRepository::bool($row['is_seed'] ?? false) && !DailyProofRepository::bool($row['is_demo'] ?? false)
            && !DailyProofRepository::bool($row['is_suggestion'] ?? false) && trim((string) ($row['photo_url'] ?? '')) !== '';
    }

    /** False only when the storage answers that the photo is gone (404/410); any doubt keeps it. */
    private static function photoExists(string $url): bool
    {
        if (!preg_match('#^https?://#', $url)) {
            return $url !== '';
        }
        $ch = curl_init($url);
        curl_setopt_array($ch, [CURLOPT_NOBODY => true, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 3, CURLOPT_CONNECTTIMEOUT => 2, CURLOPT_FOLLOWLOCATION => true]);
        curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);
        return $code !== 404 && $code !== 410;
    }

    /**
     * GET /daily/tour: {date, challenge, slides: [{city, proof, moment, podium}],
     * today: today's challenge (the last slide) | null}. Slides whose proof is
     * no longer approved, or whose author the viewer blocked, are left out.
     */
    public static function forViewer(array $challenge, ?string $viewerCityId, ?string $viewerId, array $blockedUserIds = []): array
    {
        $blocked = array_flip($blockedUserIds);
        $stored  = self::order(self::stored($challenge), $viewerCityId);
        $rows    = DailyProofRepository::rowsByIds(array_column($stored, 'proofId'));
        $cities  = [];
        $slides  = [];
        foreach ($stored as $s) {
            $row = $rows[$s['proofId']] ?? null;
            if (!self::qualifies($row) || isset($blocked[$row['user_id']])) {
                continue;
            }
            $city   = $cities[$s['cityId']] ??= CityRepository::findById((int) substr((string) $s['cityId'], 5));
            $slides[] = [
                'city'   => ['id' => (int) substr((string) $s['cityId'], 5), 'name' => $city['name'] ?? $row['city_name'],
                             'country' => $city['country'] ?? null],
                'proof'  => DailyProofRepository::format($row, $viewerId),
                'moment' => self::momentOf((string) $row['created_at'], $city['timezone'] ?? 'UTC'),
                'podium' => $s['podium'],
                'count'  => $s['count'],
            ];
        }
        $today = DailyChallengeRepository::findPublishedByDate(DailyClock::currentDate());
        return [
            'date'      => (string) $challenge['challenge_date'],
            'challenge' => DailyChallengeRepository::formatChallenge($challenge),
            'slides'    => $slides,
            'today'     => $today !== null && $today['id'] !== $challenge['id'] ? DailyChallengeRepository::formatChallenge($today) : null,
        ];
    }

    /** user id => city name of the authors whose proof represents their city (its best) in a challenge's tour (the morning push). */
    public static function authors(array $challenge): array
    {
        $out = [];
        $stored = array_values(array_filter(self::stored($challenge), static fn(array $s): bool => ($s['rank'] ?? 0) === 0));
        $rows   = DailyProofRepository::rowsByIds(array_column($stored, 'proofId'));
        foreach ($stored as $s) {
            $row = $rows[$s['proofId']] ?? null;
            if (self::qualifies($row)) {
                $out[(string) $row['user_id']] = (string) ($row['city_name'] ?? '');
            }
        }
        return $out;
    }

    private static function momentOf(string $createdAt, string $timezone): string
    {
        try {
            $at = (new DateTimeImmutable($createdAt))->setTimezone(new DateTimeZone($timezone));
        } catch (\Throwable $e) {
            $at = new DateTimeImmutable($createdAt);
        }
        return self::moment((int) $at->format('G'));
    }

    private static function key(string $challengeId): string
    {
        return 'daily_tour_v3_' . $challengeId;
    }
}
