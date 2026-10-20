<?php

declare(strict_types=1);

/**
 * Provisional leaderboard of the active Daily Challenge (SPEC 8.1): the World
 * top 10, the top 3 of each live city and the viewer's own rank. The official
 * podium is still computed at the drop (DailyResults); this one is live.
 *
 * Same order as the official results (votes, local votes, earliest approval),
 * but ties on votes share a rank (1, 1, 3). Only proofs with a vote are
 * listed, and nothing is ranked below MIN_PROOFS approved proofs.
 *
 * No realtime: the app polls GET /daily/leaderboard every 30 s while the
 * screen is visible. The ranking is one query, cached CACHE_TTL seconds per
 * instance and shared by every viewer; blocks and "me" are applied per viewer.
 *
 * The "You're in today's top 10!" push: the tick queues it for the first 10
 * proofs in order (shared ranks aside) with at least TOP10_MIN_VOTES votes,
 * once per user per challenge (daily_push_log unique key).
 */
final class DailyLeaderboard
{
    public const MIN_PROOFS      = 5;    // no ranking below this many approved proofs
    public const WORLD_SIZE      = 10;
    public const CITY_SIZE       = 3;
    public const TOP10_MIN_VOTES = 2;    // the top 10 push needs at least this many votes
    public const CACHE_TTL       = 15;   // seconds

    // ── Pure helpers (unit-tested) ────────────────────────────────────────────

    /** Rows ordered best first (DailyResults order), each with a shared 'rank'. */
    public static function withRanks(array $rows): array
    {
        $ranked = DailyResults::rankProofs($rows);
        $rank   = 0;
        $prev   = null;
        foreach ($ranked as $i => &$r) {
            if ((int) $r['vote_count'] !== $prev) {
                $rank = $i + 1;
                $prev = (int) $r['vote_count'];
            }
            $r['rank'] = $rank;
        }
        unset($r);
        return $ranked;
    }

    /**
     * The leaderboard rows for a viewer: {ranked, world, cities, me}. world
     * and city entries are proof rows with 'rank'; cities is a list of
     * [cityId, rows], the city with the best proof first. Blocked authors are
     * hidden without renumbering. $mine is the viewer's approved proof row
     * (id, city_id, vote_count) or null. Rows need user_id, city_id,
     * vote_count, local_vote_count, approved_at, id.
     */
    public static function build(int $approvedCount, array $rows, array $liveCityIds, array $blockedUserIds, ?array $mine): array
    {
        if ($approvedCount < self::MIN_PROOFS) {
            return ['ranked' => false, 'world' => [], 'cities' => [], 'me' => null];
        }
        $voted   = array_values(array_filter($rows, static fn(array $r): bool => (int) $r['vote_count'] >= 1));
        $blocked = array_flip($blockedUserIds);
        $visible = static fn(array $list): array => array_values(array_filter(
            $list, static fn(array $r): bool => !isset($blocked[$r['user_id']]),
        ));

        $byCity = [];
        foreach (DailyResults::rankProofs($voted) as $r) {
            if ($r['city_id'] !== null && in_array($r['city_id'], $liveCityIds, true)) {
                $byCity[$r['city_id']][] = $r;
            }
        }
        $cities = [];
        foreach ($byCity as $cityId => $list) {
            $top = array_slice($visible(self::withRanks($list)), 0, self::CITY_SIZE);
            if ($top !== []) {
                $cities[] = [$cityId, $top];
            }
        }

        $me = null;
        if ($mine !== null) {
            $votes = (int) $mine['vote_count'];
            $ahead = static fn(array $r): bool => (int) $r['vote_count'] > $votes;
            $me = [
                'proofId'   => $mine['id'],
                'rank'      => 1 + count(array_filter($voted, $ahead)),
                'cityRank'  => $mine['city_id'] !== null
                    ? 1 + count(array_filter($voted, static fn(array $r): bool => $r['city_id'] === $mine['city_id'] && $ahead($r)))
                    : null,
                'voteCount' => $votes,
            ];
        }

        return [
            'ranked' => true,
            'world'  => array_slice($visible(self::withRanks($voted)), 0, self::WORLD_SIZE),
            'cities' => $cities,
            'me'     => $me,
        ];
    }

    /**
     * Proofs that earn the top 10 push: the first WORLD_SIZE in order with at
     * least TOP10_MIN_VOTES votes, each with its shared 'rank'. Pure.
     */
    public static function pushEntrants(int $approvedCount, array $rows): array
    {
        if ($approvedCount < self::MIN_PROOFS) {
            return [];
        }
        $voted = array_values(array_filter($rows, static fn(array $r): bool => (int) $r['vote_count'] >= 1));
        return array_values(array_filter(
            array_slice(self::withRanks($voted), 0, self::WORLD_SIZE),
            static fn(array $r): bool => (int) $r['vote_count'] >= self::TOP10_MIN_VOTES,
        ));
    }

    // ── API ──────────────────────────────────────────────────────────────────

    /** GET /daily/leaderboard payload for a viewer. */
    public static function forViewer(?string $viewerId, array $blockedUserIds, ?DateTimeImmutable $now = null): array
    {
        $date      = DailyClock::currentDate($now);
        $challenge = DailyChallengeRepository::findPublishedByDate($date);
        $out = ['date' => null, 'endsAt' => null, 'provisional' => true, 'approvedCount' => 0,
                'minProofs' => self::MIN_PROOFS, 'ranked' => false, 'world' => [], 'cities' => [], 'me' => null];
        if ($challenge === null) {
            return $out;
        }
        $snap = self::snapshot($challenge['id']);
        $mine = $viewerId !== null ? DailyProofRepository::findMine($challenge['id'], $viewerId) : null;
        if ($mine !== null && $mine['moderation_status'] !== 'approved') {
            $mine = null;
        }
        $board = self::build($snap['approvedCount'], $snap['rows'], DailyRules::liveCityIds(), $blockedUserIds, $mine);

        return [
            'date'          => $date,
            'endsAt'        => DailyClock::window($date)[1]->getTimestamp(),
            'provisional'   => true,
            'approvedCount' => $snap['approvedCount'],
            'minProofs'     => self::MIN_PROOFS,
            'ranked'        => $board['ranked'],
            'world'         => array_map([self::class, 'entry'], $board['world']),
            'cities'        => array_map(static fn(array $c): array => [
                'city'    => ['id' => (int) substr((string) $c[0], 5), 'name' => $c[1][0]['city_name'], 'country' => CityRepository::countryOf($c[0])],
                'entries' => array_map([self::class, 'entry'], $c[1]),
            ], $board['cities']),
            'me'            => $board['me'],
        ];
    }

    // ── Top 10 push ──────────────────────────────────────────────────────────

    /** Tick step: queue the top 10 push for today's new entrants. */
    public static function queueTop10(DateTimeImmutable $now): array
    {
        $date      = DailyClock::currentDate($now);
        $challenge = DailyChallengeRepository::findPublishedByDate($date);
        if ($challenge === null) {
            return ['queued' => 0];
        }
        [$count, $rows] = self::realOnly(self::snapshot($challenge['id']));
        $entrants  = self::pushEntrants($count, $rows);
        return ['queued' => DailyPushes::queueTop10($date, array_column($entrants, 'user_id'), $now)];
    }

    /** The user's shared rank if their proof still earns the top 10 push on $date, else null. */
    public static function top10RankOf(string $date, string $userId): ?int
    {
        $challenge = DailyChallengeRepository::findPublishedByDate($date);
        if ($challenge === null) {
            return null;
        }
        [$count, $rows] = self::realOnly(self::snapshot($challenge['id']));
        foreach (self::pushEntrants($count, $rows) as $r) {
            if ($r['user_id'] === $userId) {
                return (int) $r['rank'];
            }
        }
        return null;
    }

    // ── Internals ────────────────────────────────────────────────────────────

    /**
     * The snapshot without demo proofs (DailyDemo), for the top 10 push: demo
     * content shows in the Top 10 but never pushes or bumps anyone. Pure.
     */
    public static function realOnly(array $snap): array
    {
        $rows = array_values(array_filter($snap['rows'], static fn(array $r): bool => !DailyProofRepository::bool($r['is_demo'] ?? false)));
        return [$snap['approvedCount'] - ($snap['demoCount'] ?? 0), $rows];
    }

    /**
     * The approved count and every approved proof with a vote (with what an
     * entry shows), cached CACHE_TTL seconds and shared by every viewer.
     */
    private static function snapshot(string $challengeId): array
    {
        return Cache::remember('daily_leaderboard_v4_' . $challengeId, self::CACHE_TTL, function () use ($challengeId): array {
            $pdo  = Database::pdo();
            $stmt = $pdo->prepare("
                SELECT count(*) AS n, count(*) FILTER (WHERE is_demo) AS demo
                FROM daily_proofs WHERE challenge_id = ? AND moderation_status = 'approved' AND NOT is_suggestion
            ");
            $stmt->execute([$challengeId]);
            $counts = $stmt->fetch(PDO::FETCH_ASSOC);
            $count  = (int) $counts['n'];

            $stmt = $pdo->prepare("
                SELECT p.id, p.user_id, p.city_id, p.vote_count, p.local_vote_count, p.approved_at, p.is_local, p.is_demo,
                       p.photo_url, u.username, u.display_name, u.profile_photo_url, ch.name AS city_name,
                       (lp.user_id IS NOT NULL) AS author_local_pass
                FROM daily_proofs p
                JOIN users u          ON u.id  = p.user_id
                LEFT JOIN channels ch ON ch.id = p.city_id
                LEFT JOIN daily_local_passes lp ON lp.user_id = p.user_id AND lp.city_id = p.city_id
                WHERE p.challenge_id = ? AND p.moderation_status = 'approved' AND NOT p.is_suggestion AND p.vote_count >= 1
            ");
            $stmt->execute([$challengeId]);
            return ['approvedCount' => $count, 'demoCount' => (int) $counts['demo'], 'rows' => $stmt->fetchAll(PDO::FETCH_ASSOC)];
        }) ?? ['approvedCount' => 0, 'demoCount' => 0, 'rows' => []];
    }

    private static function entry(array $r): array
    {
        return [
            'rank'      => (int) $r['rank'],
            'proofId'   => $r['id'],
            'voteCount' => (int) $r['vote_count'],
            'isLocal'   => DailyProofRepository::bool($r['is_local']),
            'user'      => [
                'id'          => $r['user_id'],
                'username'    => $r['username'],
                'displayName' => $r['display_name'],
                'photoUrl'    => R2Uploader::thumbProxy($r['profile_photo_url']),
                'localPass'   => DailyProofRepository::bool($r['author_local_pass'] ?? false),
            ],
            'city'      => $r['city_id'] !== null
                ? ['id' => (int) substr((string) $r['city_id'], 5), 'name' => $r['city_name'], 'country' => CityRepository::countryOf($r['city_id'])]
                : null,
            'thumbUrl'  => R2Uploader::thumbProxy($r['photo_url']),
        ];
    }
}
