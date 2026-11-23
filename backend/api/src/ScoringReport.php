<?php

declare(strict_types=1);

/**
 * Admin › Scoring (scoring v2, phase P0): read-only reports on real data, before
 * anything is migrated. Writes nothing.
 *
 * - simulate(): each active player's points over the last N closed challenges,
 *   as awarded (old rules) and under the v2 rules (photo + World podium + Perfect
 *   weeks; no votes; invites are 0 since nothing tracked them).
 * - The two fair-play switches replayed on the same days.
 * - fairPlay(): patterns to look at by hand (no auto-ban).
 *
 * Eligible = what v2 counts: approved, real photos (not demo / seed / suggestion)
 * of players who are not deleted, demo, admin (hidden_from_rankings) or the store
 * review account.
 */
final class ScoringReport
{
    private const ELIGIBLE = "p.moderation_status = 'approved' AND NOT p.is_demo AND NOT p.is_seed AND NOT p.is_suggestion
                              AND u.deleted_at IS NULL AND NOT u.is_demo AND NOT u.hidden_from_rankings AND NOT u.is_review";

    /** The last $days closed challenge dates: [from, to] ('Y-m-d'), to = yesterday's challenge. */
    public static function window(int $days, ?string $today = null): array
    {
        $today ??= DailyClock::currentDate();
        $d = new DateTimeImmutable($today, new DateTimeZone('UTC'));
        return [$d->modify('-' . $days . ' days')->format('Y-m-d'), $d->modify('-1 day')->format('Y-m-d')];
    }

    /**
     * The before / after simulation. Returns:
     *  window [from, to], days (published challenges), players: [{user_id, username, old, old_vote,
     *  old_photo, old_top, old_other, photos, podiums, top_points, weeks, new, new_min_photos{N:pts},
     *  new_play{pts}}] (best new first), switches: impact summaries.
     */
    public static function simulate(int $days = 30, array $minPhotos = [3, 5, 10, 20]): array
    {
        [$from, $to] = self::window($days);
        $pdo = Database::pdo();
        $cfg = Scoring::config();

        // Published challenges of the window, plus the 6 days before (weeks ending in the window).
        $weekFrom = (new DateTimeImmutable($from))->modify('-6 days')->format('Y-m-d');
        $stmt = $pdo->prepare("SELECT id, challenge_date::text AS date FROM daily_challenges
                               WHERE status = 'published' AND challenge_date BETWEEN ?::date AND ?::date ORDER BY challenge_date");
        $stmt->execute([$weekFrom, $to]);
        $challenges = $stmt->fetchAll(PDO::FETCH_KEY_PAIR);   // id => date
        $inWindow   = array_filter($challenges, static fn(string $d): bool => $d >= $from);

        // Eligible photos, with the likes from voters who also posted that day (vote_requires_play).
        $stmt = $pdo->prepare("
            SELECT p.id, p.user_id, p.challenge_id, p.vote_count, p.created_at,
                   (SELECT count(*) FROM daily_votes v
                     WHERE v.proof_id = p.id
                       AND EXISTS (SELECT 1 FROM daily_proofs vp WHERE vp.challenge_id = p.challenge_id
                                     AND vp.user_id = v.voter_user_id AND vp.moderation_status = 'approved'
                                     AND NOT vp.is_seed AND NOT vp.is_suggestion)) AS played_votes
            FROM daily_proofs p
            JOIN users u ON u.id = p.user_id
            JOIN daily_challenges dc ON dc.id = p.challenge_id
            WHERE dc.status = 'published' AND dc.challenge_date BETWEEN ?::date AND ?::date AND " . self::ELIGIBLE);
        $stmt->execute([$weekFrom, $to]);
        $photos = $stmt->fetchAll(PDO::FETCH_ASSOC);

        $byChallenge = [];
        $played      = [];   // user => [date => true]
        $players     = [];
        $blank = static fn(): array => ['old' => 0, 'old_vote' => 0, 'old_photo' => 0, 'old_top' => 0, 'old_other' => 0,
                                        'photos' => 0, 'podiums' => 0, 'top_points' => 0, 'weeks' => 0,
                                        'new_min_photos' => array_fill_keys($minPhotos, 0), 'new_play' => 0];
        foreach ($photos as $p) {
            $date = $challenges[$p['challenge_id']];
            $played[$p['user_id']][$date] = true;
            if ($date < $from) continue;
            $byChallenge[$p['challenge_id']][] = $p;
            $players[$p['user_id']] ??= $blank();
            $players[$p['user_id']]['photos']++;
        }

        // The podium of each day: as v2 pays it, and under each switch.
        $minVotes = (int) $cfg['min_votes_to_win'];
        $points   = static fn(int $i): int => Scoring::points('daily_top' . ($i + 1));
        $impact   = ['min_photos' => array_fill_keys($minPhotos, ['days' => 0, 'points' => 0]),
                     'play' => ['podiums_changed' => 0, 'days' => 0]];
        foreach ($byChallenge as $rows) {
            $base = Scoring::podium($rows, $minVotes);
            foreach ($base as $i => $r) {
                $players[$r['user_id']]['podiums']++;
                $players[$r['user_id']]['top_points'] += $points($i);
            }
            foreach ($minPhotos as $n) {
                $only = Scoring::podium($rows, $minVotes, $n);
                foreach ($only as $i => $r) $players[$r['user_id']]['new_min_photos'][$n] += $points($i);
                if (count($only) < count($base)) {
                    $impact['min_photos'][$n]['days']++;
                    foreach (array_slice($base, count($only)) as $j => $r) {
                        $impact['min_photos'][$n]['points'] += $points($j + count($only));
                    }
                }
            }
            $playRows = array_map(static fn(array $r): array => ['vote_count' => (int) $r['played_votes']] + $r, $rows);
            $play = Scoring::podium($playRows, $minVotes);
            foreach ($play as $i => $r) $players[$r['user_id']]['new_play'] += $points($i);
            $impact['play']['days']++;
            if (array_column($play, 'id') !== array_column($base, 'id')) $impact['play']['podiums_changed']++;
        }

        // Perfect weeks ending in the window.
        $published = array_values($challenges);
        foreach ($played as $userId => $dates) {
            $weeks = array_filter(Scoring::perfectWeeks($published, $dates, $to), static fn(string $s): bool => $s >= $from);
            if ($weeks === []) continue;
            $players[$userId] ??= $blank();
            $players[$userId]['weeks'] = count($weeks);
        }

        // Old points, as awarded on the window's challenges.
        if ($inWindow !== []) {
            $in   = implode(',', array_fill(0, count($inWindow), '?'));
            $stmt = $pdo->prepare("SELECT se.user_id, se.kind, sum(se.points) AS pts FROM score_events se
                                   JOIN users u ON u.id = se.user_id
                                   WHERE se.daily_challenge_id IN ({$in}) AND u.deleted_at IS NULL AND NOT u.is_demo
                                   GROUP BY se.user_id, se.kind");
            $stmt->execute(array_keys($inWindow));
            foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
                $players[$r['user_id']] ??= $blank();
                $pl  = &$players[$r['user_id']];
                $pts = (int) $r['pts'];
                $pl['old'] += $pts;
                match (true) {
                    $r['kind'] === 'daily_vote'              => $pl['old_vote'] += $pts,
                    $r['kind'] === 'daily_proof'             => $pl['old_photo'] += $pts,
                    str_starts_with($r['kind'], 'daily_top') => $pl['old_top'] += $pts,
                    default                                  => $pl['old_other'] += $pts,
                };
                unset($pl);
            }
        }

        // New totals.
        $photoPts = Scoring::points('daily_proof');
        $weekPts  = Scoring::points('perfect_week');
        foreach ($players as &$pl) {
            $common = $pl['photos'] * $photoPts + $pl['weeks'] * $weekPts;
            $pl['new'] = $common + $pl['top_points'];
            foreach ($pl['new_min_photos'] as $n => $top) $pl['new_min_photos'][$n] = $common + $top;
            $pl['new_play'] += $common;
        }
        unset($pl);

        // Names, and the players hidden from rankings (they only show in the old column).
        $ids = array_keys($players);
        $names = [];
        $hidden = [];
        if ($ids !== []) {
            $in   = implode(',', array_fill(0, count($ids), '?'));
            $stmt = $pdo->prepare("SELECT id, username, (hidden_from_rankings OR is_review) AS hidden FROM users WHERE id IN ({$in})");
            $stmt->execute($ids);
            foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
                $names[$r['id']] = $r['username'];
                if ($r['hidden'] === true || $r['hidden'] === 't') $hidden[$r['id']] = true;
            }
        }
        $rows = [];
        foreach ($players as $userId => $pl) {
            $rows[] = ['user_id' => $userId, 'username' => $names[$userId] ?? '?', 'hidden' => isset($hidden[$userId])] + $pl;
        }
        usort($rows, static fn(array $a, array $b): int => [$b['new'], $b['podiums'], $b['photos'], $a['username']]
                                                        <=> [$a['new'], $a['podiums'], $a['photos'], $b['username']]);

        // Old and new ranks (hidden players take no rank).
        $rank = static function (array $rows, string $key): array {
            $ranked = array_values(array_filter($rows, static fn(array $r): bool => !$r['hidden'] && $r[$key] > 0));
            usort($ranked, static fn(array $a, array $b): int => [$b[$key], $a['username']] <=> [$a[$key], $b['username']]);
            $out = [];
            foreach ($ranked as $i => $r) $out[$r['user_id']] = $i + 1;
            return $out;
        };
        $oldRank = $rank($rows, 'old');
        $newRank = $rank($rows, 'new');
        foreach ($rows as &$r) {
            $r['old_rank'] = $oldRank[$r['user_id']] ?? null;
            $r['new_rank'] = $newRank[$r['user_id']] ?? null;
        }
        unset($r);

        // What each switch takes away per player (the biggest losses).
        foreach ($minPhotos as $n) {
            $losers = array_filter($rows, static fn(array $r): bool => $r['new_min_photos'][$n] < $r['new']);
            $impact['min_photos'][$n]['players'] = count($losers);
        }
        $changed = array_filter($rows, static fn(array $r): bool => $r['new_play'] !== $r['new']);
        $impact['play']['players'] = count($changed);
        $impact['play']['likes'] = self::likesFromNonPlayers($from, $to);

        return ['window' => [$from, $to], 'days' => count($inWindow), 'players' => $rows, 'switches' => $impact];
    }

    /** Likes on the window's photos, and how many came from people with no photo that day. */
    private static function likesFromNonPlayers(string $from, string $to): array
    {
        $stmt = Database::pdo()->prepare("
            SELECT count(*) AS likes,
                   count(*) FILTER (WHERE NOT EXISTS (
                       SELECT 1 FROM daily_proofs vp WHERE vp.challenge_id = v.challenge_id AND vp.user_id = v.voter_user_id
                         AND vp.moderation_status = 'approved' AND NOT vp.is_seed AND NOT vp.is_suggestion)) AS non_players,
                   count(DISTINCT v.voter_user_id) AS voters,
                   count(DISTINCT v.voter_user_id) FILTER (WHERE NOT EXISTS (
                       SELECT 1 FROM daily_proofs vp WHERE vp.challenge_id = v.challenge_id AND vp.user_id = v.voter_user_id
                         AND vp.moderation_status = 'approved' AND NOT vp.is_seed AND NOT vp.is_suggestion)) AS non_player_voters
            FROM daily_votes v
            JOIN daily_challenges dc ON dc.id = v.challenge_id
            WHERE dc.challenge_date BETWEEN ?::date AND ?::date
        ");
        $stmt->execute([$from, $to]);
        return array_map('intval', $stmt->fetch(PDO::FETCH_ASSOC) ?: []);
    }

    /**
     * Patterns to check by hand (never acted on automatically):
     * - shared_device: accounts on the same device identity (guest_id; install ids come with P3);
     * - one_fan: likers whose likes mostly go to one player (>= 5 likes, >= 80 % to one);
     * - hidden_podium: podium points given to admin / review accounts (excluded from v2);
     * - heavy_voters: DailyVotes' existing flags.
     */
    public static function fairPlay(int $days = 30): array
    {
        [$from, $to] = self::window($days);
        $pdo = Database::pdo();

        $shared = $pdo->query("
            SELECT u.guest_id, count(*) AS accounts,
                   string_agg(coalesce(u.username, u.id), ', ' ORDER BY u.created_at) AS usernames,
                   to_char(to_timestamp(min(u.created_at)), 'YYYY-MM-DD') AS first, to_char(to_timestamp(max(u.created_at)), 'YYYY-MM-DD') AS last
            FROM users u
            WHERE u.guest_id IS NOT NULL AND u.guest_id <> '' AND u.deleted_at IS NULL AND NOT u.is_demo
            GROUP BY u.guest_id HAVING count(*) > 1
            ORDER BY accounts DESC, last DESC LIMIT 50
        ")->fetchAll(PDO::FETCH_ASSOC);

        $stmt = $pdo->prepare("
            WITH likes AS (
                SELECT v.voter_user_id, p.user_id AS author, count(*) AS n
                FROM daily_votes v
                JOIN daily_proofs p      ON p.id = v.proof_id
                JOIN daily_challenges dc ON dc.id = v.challenge_id
                WHERE dc.challenge_date BETWEEN ?::date AND ?::date
                GROUP BY v.voter_user_id, p.user_id
            ), totals AS (
                SELECT voter_user_id, sum(n) AS total, max(n) AS top FROM likes GROUP BY voter_user_id
            )
            SELECT vu.username AS voter, au.username AS author, l.n AS likes, t.total,
                   round(100.0 * l.n / t.total) AS share, to_char(to_timestamp(vu.created_at), 'YYYY-MM-DD') AS voter_since
            FROM totals t
            JOIN likes l  ON l.voter_user_id = t.voter_user_id AND l.n = t.top
            JOIN users vu ON vu.id = t.voter_user_id
            JOIN users au ON au.id = l.author
            WHERE t.total >= 5 AND l.n >= 0.8 * t.total
            ORDER BY l.n DESC LIMIT 50
        ");
        $stmt->execute([$from, $to]);
        $oneFan = $stmt->fetchAll(PDO::FETCH_ASSOC);

        $stmt = $pdo->prepare("
            SELECT u.username, se.kind, se.points, dc.challenge_date::text AS date
            FROM score_events se
            JOIN users u             ON u.id = se.user_id
            JOIN daily_challenges dc ON dc.id = se.daily_challenge_id
            WHERE se.kind IN ('daily_top1', 'daily_top2', 'daily_top3') AND (u.hidden_from_rankings OR u.is_review)
              AND dc.challenge_date BETWEEN ?::date AND ?::date
            ORDER BY dc.challenge_date DESC
        ");
        $stmt->execute([$from, $to]);
        $hiddenPodium = $stmt->fetchAll(PDO::FETCH_ASSOC);

        return [
            'window'        => [$from, $to],
            'shared_device' => $shared,
            'one_fan'       => $oneFan,
            'hidden_podium' => $hiddenPodium,
            'heavy_voters'  => DailyVotes::flaggedVoters($days),
        ];
    }
}
