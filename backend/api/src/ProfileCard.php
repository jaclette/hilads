<?php

declare(strict_types=1);

/**
 * The player profile (a "mini Passport", docs/mockups/hilads_profile_mockup.html):
 * what a profile adds to GET /users/{id}/daily.
 *
 * - card(): daily wins (World 🥇 days), this season's rank in the player's city
 *   and in the World with points (Ranks 'season': the same numbers as World ›
 *   Players), a crown when they lead either, and the first photos of the grid.
 * - photos(): the player's photos, best first (most likes, then posted first),
 *   with the World podium place each one won.
 * - duels(): the viewer vs the player on the challenges they both played: per
 *   challenge the better photo wins (the podium's rule: likes, then posted first).
 *
 * Only approved, real photos (no demo / seed / suggestion); hidden accounts
 * (admins, store review) never rank.
 */
final class ProfileCard
{
    private const REAL = "p.moderation_status = 'approved' AND NOT p.is_demo AND NOT p.is_seed AND NOT p.is_suggestion";

    public static function card(string $userId, ?string $viewerId): array
    {
        $pdo  = Database::pdo();
        $stmt = $pdo->prepare("
            SELECT count(*) FROM daily_results r JOIN daily_proofs p ON p.id = r.proof_id
            WHERE r.scope = 'world' AND r.rank = 1 AND p.user_id = ? AND " . self::REAL);
        $stmt->execute([$userId]);
        $wins = (int) $stmt->fetchColumn();

        $stmt = $pdo->prepare("SELECT current_city_id, hidden_from_rankings FROM users WHERE id = ?");
        $stmt->execute([$userId]);
        $u = $stmt->fetch(PDO::FETCH_ASSOC) ?: [];
        $today  = DailyClock::currentDate();
        $cityId = is_string($u['current_city_id'] ?? null) && preg_match('/^city_\d+$/', $u['current_city_id']) ? $u['current_city_id'] : null;
        $rankIn = static function (?string $city) use ($userId, $today): ?array {
            $rows  = Ranks::playerRows('season', $city, $today);
            $ranks = Ranks::rankBy($rows, 'id', 'points');
            if (!isset($ranks[$userId])) return null;
            return ['rank' => $ranks[$userId], 'points' => (int) $rows[$ranks[$userId] - 1]['points']];
        };
        $world = $rankIn(null);
        $city  = $cityId !== null ? $rankIn($cityId) : null;
        $cityInfo = null;
        if ($cityId !== null) {
            $n = (int) substr($cityId, 5);
            $cityInfo = ['id' => $n, 'name' => CityNames::short(CityRepository::findById($n)['name'] ?? null, DailyI18n::current()),
                         'country' => CityRepository::countryOf($n)];
        }
        return [
            'wins'   => $wins,
            'season' => Scoring::season($today) + [
                'world' => $world,
                'city'  => $city !== null && $cityInfo !== null ? $city + ['city' => $cityInfo] : null,
            ],
            'crown'  => ($world['rank'] ?? null) === 1 || ($city['rank'] ?? null) === 1,
            'photos' => self::photos($userId, $viewerId, 0, 6),
        ];
    }

    /** A page of the player's photos, best first: {items: [{proof, podium}], total, nextOffset}. */
    public static function photos(string $userId, ?string $viewerId, int $offset = 0, int $limit = 30): array
    {
        $pdo  = Database::pdo();
        $stmt = $pdo->prepare("SELECT count(*) FROM daily_proofs p WHERE p.user_id = ? AND " . self::REAL);
        $stmt->execute([$userId]);
        $total = (int) $stmt->fetchColumn();
        $stmt = $pdo->prepare("
            SELECT p.id, (SELECT r.rank FROM daily_results r WHERE r.proof_id = p.id AND r.scope = 'world' LIMIT 1) AS podium
            FROM daily_proofs p
            WHERE p.user_id = ? AND " . self::REAL . "
            ORDER BY p.vote_count DESC, p.created_at ASC, p.id
            LIMIT ? OFFSET ?
        ");
        $stmt->execute([$userId, max(1, min(60, $limit)), max(0, $offset)]);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
        $podium = array_column($rows, 'podium', 'id');
        $byId = [];
        foreach (DailyVotes::annotate(DailyProofRepository::findApprovedMany(array_column($rows, 'id')), $viewerId) as $r) {
            $byId[$r['id']] = DailyProofRepository::format($r, $viewerId);
        }
        $items = [];
        foreach ($rows as $r) {
            if (!isset($byId[$r['id']])) continue;
            $items[] = ['proof' => $byId[$r['id']], 'podium' => $podium[$r['id']] !== null ? (int) $podium[$r['id']] : null];
        }
        return ['items' => $items, 'total' => $total, 'nextOffset' => $offset + $limit < $total ? $offset + $limit : null];
    }

    /**
     * The viewer vs the player on the challenges they both played (closed ones count; today's
     * too, as it stands): {me, them, total, duels: [{date, theme, mine, theirs,
     * winner: 'me' | 'them' | null}]}, newest first. Empty when they never played the same challenge.
     */
    public static function duels(string $viewerId, string $userId, int $limit = 3, int $offset = 0): array
    {
        $stmt = Database::pdo()->prepare("
            SELECT dc.id AS challenge_id, dc.challenge_date::text AS date, dc.theme,
                   a.id AS a_id, a.vote_count AS a_votes, a.created_at AS a_at,
                   b.id AS b_id, b.vote_count AS b_votes, b.created_at AS b_at
            FROM daily_proofs a
            JOIN daily_proofs b      ON b.challenge_id = a.challenge_id AND b.user_id = ?
            JOIN daily_challenges dc ON dc.id = a.challenge_id
            WHERE a.user_id = ?
              AND a.moderation_status = 'approved' AND NOT a.is_demo AND NOT a.is_seed AND NOT a.is_suggestion
              AND b.moderation_status = 'approved' AND NOT b.is_demo AND NOT b.is_seed AND NOT b.is_suggestion
            ORDER BY dc.challenge_date DESC
        ");
        $stmt->execute([$userId, $viewerId]);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
        $me = $them = 0;
        $winner = static function (array $r): ?string {
            $ranked = DailyResults::rankProofs([
                ['id' => $r['a_id'], 'vote_count' => $r['a_votes'], 'created_at' => $r['a_at']],
                ['id' => $r['b_id'], 'vote_count' => $r['b_votes'], 'created_at' => $r['b_at']],
            ]);
            return $ranked[0]['id'] === $r['a_id'] ? 'me' : 'them';
        };
        foreach ($rows as &$r) {
            $r['winner'] = $winner($r);
            $r['winner'] === 'me' ? $me++ : $them++;
        }
        unset($r);
        $page = array_slice($rows, max(0, $offset), max(1, min(50, $limit)));
        $ids  = array_merge(array_column($page, 'a_id'), array_column($page, 'b_id'));
        $byId = [];
        foreach ($ids === [] ? [] : DailyVotes::annotate(DailyProofRepository::findApprovedMany($ids), $viewerId) as $p) {
            $byId[$p['id']] = DailyProofRepository::format($p, $viewerId);
        }
        $duels = [];
        foreach ($page as $r) {
            if (!isset($byId[$r['a_id']], $byId[$r['b_id']])) continue;
            $duels[] = ['date' => $r['date'], 'theme' => $r['theme'], 'mine' => $byId[$r['a_id']], 'theirs' => $byId[$r['b_id']], 'winner' => $r['winner']];
        }
        return ['me' => $me, 'them' => $them, 'total' => count($rows), 'duels' => $duels,
                'nextOffset' => $offset + $limit < count($rows) ? $offset + $limit : null];
    }
}
