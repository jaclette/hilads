<?php

declare(strict_types=1);

/**
 * Scoring v2 (docs/scoring-v2-audit.md): the config (config/scoring.php) and the
 * pure rules shared by the awards, the seasons and the Admin › Scoring reports.
 */
final class Scoring
{
    /** @var array<string,mixed>|null */
    private static ?array $config = null;

    /** config/scoring.php, read once per request. */
    public static function config(): array
    {
        return self::$config ??= require __DIR__ . '/../config/scoring.php';
    }

    /** Points of a v2 kind (0 when it earns nothing). */
    public static function points(string $kind): int
    {
        return (int) (self::config()['points'][$kind] ?? 0);
    }

    /**
     * The first challenge date under v2 (app_settings.scoring_v2_since, written by P1's
     * migration), else the config's switch_date; null = v2 is not live yet (old rules).
     */
    public static function since(): ?string
    {
        if (class_exists('AppConfig')) {
            $v = AppConfig::settings()['scoring_v2_since'] ?? null;
        } else {
            // A script that did not load AppConfig: read the setting itself (never the old rules by mistake).
            try {
                $v = Database::pdo()->query("SELECT value FROM app_settings WHERE key = 'scoring_v2_since'")->fetchColumn() ?: null;
            } catch (\Throwable) {
                $v = null;
            }
        }
        $v ??= self::config()['switch_date'] ?? null;
        return is_string($v) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $v) ? $v : null;
    }

    /** True when a challenge of this date is scored with the v2 rules. */
    public static function isV2(string $challengeDate): bool
    {
        $since = self::since();
        return $since !== null && $challengeDate >= $since;
    }

    /** A fair-play switch: the Admin › Scoring value (app_settings) when set, else the config default. */
    public static function switch(string $name): int|bool
    {
        $default = self::config()['switches'][$name] ?? null;
        $saved   = class_exists('AppConfig') ? (AppConfig::settings()['scoring_' . $name] ?? null) : null;
        $value   = $saved ?? $default;
        return is_bool($default) ? (bool) $value : (int) $value;
    }

    /**
     * The World podium of one challenge: the 3 best photos (most likes, then posted first,
     * DailyResults::rankProofs) with at least $minVotes likes. $minPhotos > 0: a day with
     * fewer photos than that pays only the first. Rows need id, user_id, vote_count, created_at.
     *
     * @return list<array> best first, at most 3
     */
    public static function podium(array $rows, int $minVotes = 1, int $minPhotos = 0): array
    {
        $ranked = array_values(array_filter(
            DailyResults::rankProofs($rows),
            static fn(array $r): bool => (int) $r['vote_count'] >= $minVotes,
        ));
        $paid = $minPhotos > 0 && count($rows) < $minPhotos ? 1 : 3;
        return array_slice($ranked, 0, $paid);
    }

    /**
     * The season of a challenge date: its calendar month. It ends when its last challenge
     * closes, at the drop of the 1st of the next month (02:00 UTC). pre = before
     * config first_season (no medals). {key, startsOn, endsOn, endsAt (ISO UTC), daysLeft, pre}.
     */
    public static function season(string $date, ?DateTimeImmutable $now = null): array
    {
        $first = new DateTimeImmutable(substr($date, 0, 7) . '-01', new DateTimeZone('UTC'));
        $next  = $first->modify('first day of next month');
        $endsAt = DailyClock::dropAt($next->format('Y-m-d'));
        $now  ??= new DateTimeImmutable('now', new DateTimeZone('UTC'));
        $key  = $first->format('Y-m');
        return [
            'key'      => $key,
            'startsOn' => $first->format('Y-m-d'),
            'endsOn'   => $next->modify('-1 day')->format('Y-m-d'),
            'endsAt'   => $endsAt->format('Y-m-d\TH:i:s\Z'),
            'daysLeft' => max(0, (int) ceil(($endsAt->getTimestamp() - $now->getTimestamp()) / 86400)),
            'pre'      => $key < (string) self::config()['first_season'],
        ];
    }

    /** Monday and Sunday ('Y-m-d') of a date's week. */
    public static function week(string $date): array
    {
        $d      = new DateTimeImmutable($date . ' 00:00:00', new DateTimeZone('UTC'));
        $monday = $d->modify('-' . ((int) $d->format('N') - 1) . ' days');
        return [$monday->format('Y-m-d'), $monday->modify('+6 days')->format('Y-m-d')];
    }

    /**
     * The Perfect weeks of a player: the Sundays ('Y-m-d') of the Mon–Sun weeks whose every
     * published challenge has a photo of theirs, the week fully closed (Sunday <= $lastClosed).
     * A day without a published challenge is not required.
     *
     * @param list<string>        $published every published challenge date the weeks may hold
     * @param array<string,mixed> $played    the player's dates with an approved photo, as keys
     * @return list<string>
     */
    public static function perfectWeeks(array $published, array $played, string $lastClosed): array
    {
        $weeks = [];
        foreach ($published as $date) {
            $weeks[self::week($date)[1]][] = $date;
        }
        $out = [];
        foreach ($weeks as $sunday => $dates) {
            if ($sunday > $lastClosed) continue;
            foreach ($dates as $date) {
                if (!isset($played[$date])) continue 2;
            }
            $out[] = $sunday;
        }
        sort($out);
        return $out;
    }
}
