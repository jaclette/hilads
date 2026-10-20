<?php

declare(strict_types=1);

/**
 * Yesterday around the world (SPEC 10.7): the world tour of a closed
 * challenge, one slide per city with at least one approved proof, using the
 * city's best proof (the results ranking, SPEC 10.12). Demo and seed proofs
 * never count.
 *
 * Built once at the drop's closing step (DailyDrop::closeChallenge) and stored
 * in daily_world_tours (the city slides with their proof ids); a past day
 * without a stored tour is built on first read. Proofs are resolved on read,
 * so a proof removed after the close drops its slide.
 *
 * Order (per viewer): the cities of the global podium first (rank 1 to 3),
 * then the viewer's city, then the other cities, most proofs first.
 */
final class DailyTour
{
    private const CACHE_TTL = 60;

    // ── Pure helpers (unit-tested) ────────────────────────────────────────────

    /**
     * Slides from proof rows (id, city_id, vote counts, approved_at) and the
     * World top 3 proof ids (rank order): [{cityId, proofId, count, podium (1-3|null)}]. Pure.
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
            $best  = DailyResults::rankProofs($list)[0];
            // A city on the podium shows its podium proof (the best of the city may tie it).
            $onPodium = null;
            foreach ($list as $p) {
                if (isset($podium[$p['id']]) && ($onPodium === null || $podium[$p['id']] < $podium[$onPodium['id']])) {
                    $onPodium = $p;
                }
            }
            $pick  = $onPodium ?? $best;
            $out[] = ['cityId' => $cityId, 'proofId' => $pick['id'], 'count' => count($list),
                      'podium' => isset($podium[$pick['id']]) ? $podium[$pick['id']] + 1 : null];
        }
        return $out;
    }

    /** Slides in the viewer's order: podium (by rank), the viewer's city, the others (most proofs, then city id). Pure. */
    public static function order(array $slides, ?string $viewerCityId): array
    {
        usort($slides, static function (array $a, array $b) use ($viewerCityId): int {
            $ka = [$a['podium'] ?? 9, $a['cityId'] === $viewerCityId ? 0 : 1, -$a['count'], $a['cityId']];
            $kb = [$b['podium'] ?? 9, $b['cityId'] === $viewerCityId ? 0 : 1, -$b['count'], $b['cityId']];
            return $ka <=> $kb;
        });
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
            SELECT p.id, p.city_id, p.vote_count, p.local_vote_count, p.approved_at
            FROM daily_proofs p
            JOIN channels ch ON ch.id = p.city_id
            JOIN users u     ON u.id = p.user_id
            WHERE p.challenge_id = ? AND p.moderation_status = 'approved' AND NOT p.is_seed AND NOT p.is_demo AND NOT u.is_demo AND NOT p.is_suggestion
        ");
        $stmt->execute([$challenge['id']]);
        $top3   = array_column(DailyResults::worldTop3((string) $challenge['id']), 'id');
        $slides = self::slides($stmt->fetchAll(PDO::FETCH_ASSOC), $top3);
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
            return $raw === false ? [] : (json_decode((string) $raw, true) ?: []);
        }) ?? [];
    }

    /**
     * GET /daily/tour: {date, challenge, slides: [{city, proof, moment, podium}],
     * today: today's challenge (the last slide) | null}. Slides whose proof is
     * no longer approved, or whose author the viewer blocked, are left out.
     */
    public static function forViewer(array $challenge, ?string $viewerCityId, ?string $viewerId, array $blockedUserIds = []): array
    {
        $blocked = array_flip($blockedUserIds);
        $slides  = [];
        foreach (self::order(self::stored($challenge), $viewerCityId) as $s) {
            $row = DailyProofRepository::findById((string) $s['proofId']);
            if ($row === null || $row['moderation_status'] !== 'approved' || isset($blocked[$row['user_id']])) {
                continue;
            }
            $city   = CityRepository::findById((int) substr((string) $s['cityId'], 5));
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

    /** user id => city name of the authors whose proof represents their city in a challenge's tour (the morning push). */
    public static function authors(array $challenge): array
    {
        $out = [];
        foreach (self::stored($challenge) as $s) {
            $row = DailyProofRepository::findById((string) $s['proofId']);
            if ($row !== null && $row['moderation_status'] === 'approved') {
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
        return 'daily_tour_v1_' . $challengeId;
    }
}
