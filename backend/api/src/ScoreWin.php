<?php

declare(strict_types=1);

/**
 * The points reward's victory screen (2026-11-07): what /me/score-celebration
 * adds as `win` for the redesigned modal. Built from the unacknowledged
 * score_events (the same set the popin celebrates):
 *
 * - period: the Ranks period the reward lands in: today when one of its
 *   events is for today's challenge, else this week when they all are in it,
 *   else all time;
 * - theme, challenge, proof: the rewarded Daily challenge (the latest one),
 *   for the day's color, the "what earned it" chip and the share card;
 * - sources: the points by source (photo, likes given, top 3, other), one
 *   "+X" chip each;
 * - medals: me among the players of my city, me in the World, my city among
 *   the cities, each with the rank it had before this reward (prevRank, so
 *   the app shows ▲ when it improved; null = new on the board);
 * - goal: the closest next goal: passing the player just above me, the streak
 *   continuing tomorrow, or the next stamp of my city's Local Pass.
 *
 * City names are Hilads' short names ("Saigon"), in the viewer's language.
 */
final class ScoreWin
{
    /** Kind → source chip. Kinds not listed are "other" (older challenge kinds). */
    private const SOURCES = [
        'daily_proof' => 'photo', 'daily_vote' => 'votes',
        'daily_top1' => 'top', 'daily_top2' => 'top', 'daily_top3' => 'top',
        'daily_streak' => 'streak', 'early_proof' => 'early', 'local_pass' => 'stamp',
    ];

    /** A gap this small (points) makes "pass @x" the goal before the streak or a stamp. */
    private const CLOSE_GAP = 15;

    /**
     * $events: the unacknowledged rows [{kind, points, daily_challenge_id, challenge_date, city_id}].
     * $me: the users row (id, current_city_id). Never throws: null when it can't be built.
     */
    public static function build(array $events, array $me): ?array
    {
        try {
            return self::make($events, $me);
        } catch (\Throwable $e) {
            error_log('[score-win] ' . $e->getMessage());
            return null;
        }
    }

    private static function make(array $events, array $me): ?array
    {
        if ($events === []) {
            return null;
        }
        $userId = (string) $me['id'];
        $cityId = is_string($me['current_city_id'] ?? null) && preg_match('/^city_\d+$/', $me['current_city_id']) ? $me['current_city_id'] : null;
        $today  = DailyClock::currentDate();
        $locale = DailyI18n::current();

        // Sources: one chip per source, in a fixed order.
        $sources = [];
        foreach ($events as $e) {
            $src = self::SOURCES[$e['kind']] ?? 'other';
            $sources[$src] = ($sources[$src] ?? 0) + (int) $e['points'];
        }
        $order = ['photo', 'votes', 'top', 'streak', 'early', 'stamp', 'other'];
        $chips = [];
        foreach ($order as $src) {
            if (($sources[$src] ?? 0) > 0) $chips[] = ['source' => $src, 'points' => $sources[$src]];
        }

        // The period: today, else this week, else all time.
        $dates  = array_values(array_filter(array_map(static fn($e) => $e['challenge_date'] ?? null, $events)));
        [$weekFrom, $weekTo] = Spots::week($today);
        $period = in_array($today, $dates, true) ? 'today'
            : ($dates !== [] && count(array_filter($dates, static fn($d) => $d >= $weekFrom && $d <= $weekTo)) === count($events) ? 'week' : 'alltime');
        $inPeriod = static function (array $e) use ($period, $today, $weekFrom, $weekTo): bool {
            $d = $e['challenge_date'] ?? null;
            return match ($period) {
                'today'  => $d === $today,
                'week'   => $d !== null && $d >= $weekFrom && $d <= $weekTo,
                default  => true,
            };
        };
        // What the Ranks rankings count: Daily kinds of dated challenges (all time: every kind).
        $counted = $period === 'alltime' ? $events
            : array_filter($events, static fn($e) => isset(self::SOURCES[$e['kind']]) && ($e['challenge_date'] ?? null) !== null);
        $delta     = array_sum(array_map(static fn($e) => $inPeriod($e) ? (int) $e['points'] : 0, $counted));
        $deltaCity = array_sum(array_map(static fn($e) => $inPeriod($e) && $e['city_id'] === $cityId ? (int) $e['points'] : 0, $counted));

        // The rewarded challenge (the latest dated event) and my photo for it.
        $challenge = null;
        $proof     = null;
        $theme     = null;
        $latest    = null;
        foreach ($events as $e) {
            if (($e['daily_challenge_id'] ?? null) !== null && ($latest === null || (string) $e['challenge_date'] > (string) $latest['challenge_date'])) {
                $latest = $e;
            }
        }
        if ($latest !== null) {
            $stmt = Database::pdo()->prepare('SELECT * FROM daily_challenges WHERE id = ?');
            $stmt->execute([$latest['daily_challenge_id']]);
            $row = $stmt->fetch(PDO::FETCH_ASSOC);
            if ($row) {
                $challenge = DailyChallengeRepository::formatChallenge($row, null, $locale);
                $theme     = $challenge['theme']['key'] ?? null;
                $mine      = DailyProofRepository::findMine((string) $row['id'], $userId);
                if ($mine !== null && $mine['moderation_status'] === 'approved') {
                    $proof = DailyProofRepository::format($mine, $userId);
                }
            }
        }

        // The medals.
        $cityRow = null;
        if ($cityId !== null) {
            $n       = (int) substr($cityId, 5);
            $cityRow = ['id' => $n, 'name' => CityNames::short(CityRepository::findById($n)['name'] ?? null, $locale), 'country' => CityRepository::countryOf($n)];
        }
        $medals   = [];
        $cityRank = null;
        if ($cityId !== null) {
            $cityRank = self::playerRank(Ranks::playerRows($period, $cityId, $today), $userId, $deltaCity);
            if ($cityRank !== null) $medals[] = ['key' => 'city', 'city' => $cityRow] + $cityRank;
        }
        $worldRank = self::playerRank(Ranks::playerRows($period, null, $today), $userId, $delta);
        if ($worldRank !== null) $medals[] = ['key' => 'world'] + $worldRank;
        if ($cityId !== null) {
            $race = self::cityRank($period, $cityId, $today, ($sources['photo'] ?? 0) > 0 && $period !== 'alltime' ? 1 : 0);
            if ($race !== null) $medals[] = ['key' => 'cities', 'city' => $cityRow] + $race;
        }

        return [
            'period'    => $period,
            'theme'     => $theme,
            'challenge' => $challenge,
            'proof'     => $proof,
            'sources'   => $chips,
            'medals'    => $medals,
            'goal'      => self::goal($userId, $cityId, $cityRow, $cityRank, $worldRank, $today),
        ];
    }

    /** My rank in a players ranking, the rank I had before $delta points, and the gap to the one above. */
    private static function playerRank(array $rows, string $userId, int $delta): ?array
    {
        $mine = null;
        foreach ($rows as $i => $r) {
            if ($r['id'] === $userId) { $mine = $i; break; }
        }
        if ($mine === null) {
            return null;
        }
        $points = (int) $rows[$mine]['points'];
        $before = $points - $delta;
        $prev   = null;
        if ($before > 0) {
            $prev = 1;
            foreach ($rows as $r) {
                if ($r['id'] === $userId) continue;
                $p = (int) $r['points'];
                if ($p > $before || ($p === $before && strcmp((string) $r['id'], $userId) < 0)) $prev++;
            }
        }
        $out = ['rank' => $mine + 1, 'prevRank' => $prev, 'points' => $points];
        if ($mine > 0) {
            $above = $rows[$mine - 1];
            $out['gap']  = (int) $above['points'] - $points + 1;
            $out['next'] = ['username' => $above['username'], 'displayName' => $above['display_name']];
        }
        return $out;
    }

    /** My city in the city race (photos), and its rank before my photo ($added = 1 when the reward is a photo). */
    private static function cityRank(string $period, string $cityId, string $today, int $added): ?array
    {
        $rows = Ranks::cityRows($period, $today);
        $mine = null;
        foreach ($rows as $i => $r) {
            if ($r['city_id'] === $cityId) { $mine = $i; break; }
        }
        if ($mine === null) {
            return null;
        }
        $before = (int) $rows[$mine]['photos'] - $added;
        $prev   = null;
        if ($before > 0) {
            $prev = 1;
            foreach ($rows as $i => $r) {
                if ($i !== $mine && (int) $r['photos'] >= $before && ($i < $mine || (int) $r['photos'] > $before)) $prev++;
            }
        }
        return ['rank' => $mine + 1, 'prevRank' => $added > 0 ? $prev : $mine + 1];
    }

    /**
     * The closest next goal: pass the player just above me when the gap is small,
     * else keep the streak going (when I played today), else the next stamp of my
     * city's Local Pass, else pass whoever is above me. {type, progress 0..1, ...}.
     */
    private static function goal(string $userId, ?string $cityId, ?array $city, ?array $cityRank, ?array $worldRank, string $today): ?array
    {
        $pass = null;
        foreach ([[$cityRank, 'city'], [$worldRank, 'world']] as [$r, $scope]) {
            if ($r !== null && isset($r['gap'], $r['next'])) {
                $pass = ['type' => 'pass', 'scope' => $scope, 'gap' => $r['gap'], 'username' => $r['next']['username'], 'displayName' => $r['next']['displayName'],
                         'progress' => round($r['points'] / max(1, $r['points'] + $r['gap']), 3)];
                break;
            }
        }
        if ($pass !== null && $pass['gap'] <= self::CLOSE_GAP) {
            return $pass;
        }

        $streak = DailyResults::currentStreak($userId);
        $challenge = DailyChallengeRepository::findPublishedByDate($today);
        $playedToday = $challenge !== null && ($p = DailyProofRepository::findMine((string) $challenge['id'], $userId)) !== null && $p['moderation_status'] === 'approved';
        if ($playedToday && $streak >= 1) {
            $milestone = $streak < 7 ? 7 : ($streak < 14 ? 14 : ($streak < 30 ? 30 : ($streak < 100 ? 100 : $streak + 1)));
            return ['type' => 'streak', 'day' => $streak + 1, 'milestone' => $milestone, 'progress' => round($streak / $milestone, 3)];
        }

        if ($cityId !== null) {
            $lp = DailyLocalPass::progressIn($userId, $cityId);
            if (!$lp['earned'] && $lp['done'] > 0 && $lp['done'] < $lp['total']) {
                return ['type' => 'stamp', 'done' => $lp['done'], 'total' => $lp['total'], 'city' => $city, 'progress' => round($lp['done'] / max(1, $lp['total']), 3)];
            }
        }
        return $pass;
    }
}
