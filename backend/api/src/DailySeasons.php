<?php

declare(strict_types=1);

/**
 * Monthly seasons (scoring v2, docs/scoring-v2-audit.md). A season is the calendar
 * month of the challenge dates (Scoring::season); its ranking is Ranks 'season'
 * (the v2 kinds, ties: podiums, days played, first to reach the score). Every drop:
 *
 * - when the closed challenge was the last of its month, the season is frozen:
 *   season_results gets every ranked player's final rank, the top 3 get a medal
 *   (rank <= 3 there) and everyone ranked a "season results" notification. The
 *   next season needs nothing: it is simply the new month.
 * - season_ending_days before the end, the ranked players get "Season ends in
 *   3 days: you're #5".
 *
 * Months before config first_season are a pre-season: ranked, never frozen, no medal.
 * Idempotent (seasons.frozen_at, notification dedupe keys).
 */
final class DailySeasons
{
    public const MEDALS = 3;

    /** The drop of $date (yesterday's challenge just closed): freeze and reminders. Never throws. */
    public static function atDrop(string $date, string $yesterday, DateTimeImmutable $now): array
    {
        $out = [];
        try {
            if (Scoring::since() === null) {
                return ['status' => 'v1'];
            }
            if (substr($yesterday, 0, 7) !== substr($date, 0, 7)) {
                $out['frozen'] = self::freeze(substr($yesterday, 0, 7));
            }
            $season = Scoring::season($date, $now);
            if ($season['daysLeft'] === (int) Scoring::config()['season_ending_days']) {
                $out['ending'] = self::notifyEnding($season, $date);
            }
        } catch (\Throwable $e) {
            error_log('[seasons] drop of ' . $date . ' failed: ' . $e->getMessage());
            $out['status'] = 'failed: ' . $e->getMessage();
        }
        return $out;
    }

    /**
     * Freeze a finished season ('YYYY-MM'): final ranks into season_results, medals, results
     * notifications. Returns {status, players}. A pre-season, an unfinished or an already frozen
     * season is left alone.
     */
    public static function freeze(string $key, ?DateTimeImmutable $now = null): array
    {
        if (!preg_match('/^\d{4}-\d{2}$/', $key)) {
            throw new InvalidArgumentException('Season key must be YYYY-MM.');
        }
        $season = Scoring::season($key . '-01', $now);
        if ($season['pre']) {
            return ['status' => 'pre_season'];
        }
        $now ??= new DateTimeImmutable('now', new DateTimeZone('UTC'));
        if ($now < new DateTimeImmutable($season['endsAt'])) {
            return ['status' => 'not_finished'];
        }
        $pdo = Database::pdo();
        $pdo->prepare("INSERT INTO seasons (key, starts_on, ends_on) VALUES (?, ?, ?) ON CONFLICT (key) DO NOTHING")
            ->execute([$key, $season['startsOn'], $season['endsOn']]);
        $pdo->beginTransaction();
        try {
            $lock = $pdo->prepare("SELECT frozen_at FROM seasons WHERE key = ? FOR UPDATE");
            $lock->execute([$key]);
            if ($lock->fetchColumn() !== null) {
                $pdo->rollBack();
                return ['status' => 'already_frozen'];
            }
            Cache::forget('ranks_players_v2_' . md5("season||{$season['endsOn']}"));
            $rows = Ranks::playerRows('season', null, $season['endsOn']);
            $ins  = $pdo->prepare("INSERT INTO season_results (season, user_id, rank, points, podiums, days)
                                   VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (season, user_id) DO NOTHING");
            foreach ($rows as $i => $r) {
                $ins->execute([$key, $r['id'], $i + 1, (int) $r['points'], (int) $r['podiums'], (int) $r['days']]);
            }
            $pdo->prepare("UPDATE seasons SET frozen_at = now(), players = ? WHERE key = ?")->execute([count($rows), $key]);
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        $notified = self::notifyResults($key, $rows ?? []);
        return ['status' => 'frozen', 'players' => count($rows ?? []), 'notified' => $notified];
    }

    /** "Season results": every ranked player, their final rank (a medal for the top 3). */
    private static function notifyResults(string $key, array $rows): int
    {
        $n = 0;
        foreach ($rows as $i => $r) {
            $rank = $i + 1;
            if (!NotificationRepository::enabledFor((string) $r['id'], 'daily_season_result')) continue;
            $data  = ['season' => $key, 'rank' => $rank, 'points' => (int) $r['points'], 'medal' => $rank <= self::MEDALS ? ['🥇', '🥈', '🥉'][$rank - 1] : null,
                      'variant' => $rank <= self::MEDALS ? 'medal' : 'default'];
            [$title, $body] = NotificationI18n::scoring('daily_season_result', 'en', $data);
            try {
                $n += NotificationRepository::createUnchecked((string) $r['id'], 'daily_season_result', $title, $body, $data) !== [] ? 1 : 0;
            } catch (\Throwable $e) {
                error_log('[seasons] result notification failed: ' . $e->getMessage());
            }
        }
        return $n;
    }

    /** "Season ends in 3 days": the season's ranked players, their rank and the gap to the one above. */
    private static function notifyEnding(array $season, string $today): int
    {
        if ($season['pre']) {
            return 0;
        }
        $rows = Ranks::playerRows('season', null, $today);
        $n = 0;
        foreach ($rows as $i => $r) {
            if (!NotificationRepository::enabledFor((string) $r['id'], 'daily_season_ending')) continue;
            $rank = $i + 1;
            $gap  = $i > 0 ? (int) $rows[$i - 1]['points'] - (int) $r['points'] + 1 : null;
            $data = ['season' => $season['key'], 'days' => $season['daysLeft'], 'rank' => $rank, 'gap' => $gap, 'prev' => $rank - 1,
                     'endsAt' => $season['endsAt'], 'variant' => $rank === 1 ? 'first' : 'default'];
            [$title, $body] = NotificationI18n::scoring('daily_season_ending', 'en', $data);
            try {
                $n += NotificationRepository::createUnchecked((string) $r['id'], 'daily_season_ending', $title, $body, $data) !== [] ? 1 : 0;
            } catch (\Throwable $e) {
                error_log('[seasons] ending notification failed: ' . $e->getMessage());
            }
        }
        return $n;
    }

    /** "November 2026" (English; the apps show their own month names). */
    public static function label(string $key): string
    {
        return (new DateTimeImmutable($key . '-01'))->format('F Y');
    }

    /** A player's season medals, newest first: [{season, rank, points}]. */
    public static function medals(string $userId): array
    {
        try {
            $stmt = Database::pdo()->prepare("SELECT season, rank, points FROM season_results WHERE user_id = ? AND rank <= ? ORDER BY season DESC");
            $stmt->execute([$userId, self::MEDALS]);
            return array_map(static fn(array $r): array => ['season' => $r['season'], 'rank' => (int) $r['rank'], 'points' => (int) $r['points']],
                             $stmt->fetchAll(PDO::FETCH_ASSOC));
        } catch (\Throwable) {
            return [];   // before the migration
        }
    }

    /** My latest frozen season result not celebrated yet (the app's results screen), else null. */
    public static function unseenResult(string $userId): ?array
    {
        try {
            $stmt = Database::pdo()->prepare("
                SELECT r.season, r.rank, r.points, r.podiums, r.days, s.players
                FROM season_results r JOIN seasons s ON s.key = r.season
                WHERE r.user_id = ? AND r.seen_at IS NULL
                ORDER BY r.season DESC LIMIT 1
            ");
            $stmt->execute([$userId]);
            $r = $stmt->fetch(PDO::FETCH_ASSOC);
        } catch (\Throwable) {
            return null;
        }
        if (!$r) return null;
        return ['season' => $r['season'], 'rank' => (int) $r['rank'], 'points' => (int) $r['points'], 'podiums' => (int) $r['podiums'],
                'days' => (int) $r['days'], 'players' => (int) $r['players'], 'medal' => (int) $r['rank'] <= self::MEDALS,
                'podium' => self::podium((string) $r['season'])];
    }

    public static function markSeen(string $userId, string $key): void
    {
        Database::pdo()->prepare("UPDATE season_results SET seen_at = now() WHERE user_id = ? AND season = ? AND seen_at IS NULL")
            ->execute([$userId, $key]);
    }

    /** A frozen season's top 3: [{rank, points, user: {id, displayName, username, photoUrl}}]. */
    public static function podium(string $key): array
    {
        $stmt = Database::pdo()->prepare("
            SELECT r.rank, r.points, u.id, u.display_name, u.username, u.profile_thumb_photo_url AS thumb
            FROM season_results r JOIN users u ON u.id = r.user_id
            WHERE r.season = ? AND r.rank <= ? ORDER BY r.rank
        ");
        $stmt->execute([$key, self::MEDALS]);
        return array_map(static fn(array $r): array => [
            'rank' => (int) $r['rank'], 'points' => (int) $r['points'],
            'user' => ['id' => $r['id'], 'displayName' => $r['display_name'], 'username' => $r['username'], 'photoUrl' => R2Uploader::thumbProxy($r['thumb'])],
        ], $stmt->fetchAll(PDO::FETCH_ASSOC));
    }
}
