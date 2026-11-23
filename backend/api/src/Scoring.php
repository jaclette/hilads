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
