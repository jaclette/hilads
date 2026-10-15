<?php

declare(strict_types=1);

/**
 * Daily Challenge clock - the ONE place that knows when a challenge is active.
 *
 * Every day at the drop time (DAILY_DROP_UTC, "HH:MM", default 02:00 = 09:00 in
 * Saigon) a new challenge goes live everywhere and stays active until the next
 * drop. A challenge's date is the UTC date of its drop, so challenge D is live
 * from D at the drop time to D+1 at the drop time.
 *
 * Pure: no DB, no globals besides the env var. Every method takes "now" so it
 * can be tested at any instant.
 */
final class DailyClock
{
    public const DEFAULT_DROP = '02:00';

    /** Drop time as [hour, minute], from DAILY_DROP_UTC; invalid values fall back to 02:00. */
    public static function dropTime(): array
    {
        $raw = trim((string) getenv('DAILY_DROP_UTC'));
        if (!preg_match('/^([01]\d|2[0-3]):([0-5]\d)$/', $raw, $m)) {
            [$h, $min] = explode(':', self::DEFAULT_DROP);
            return [(int) $h, (int) $min];
        }
        return [(int) $m[1], (int) $m[2]];
    }

    /** The drop instant of a challenge date (Y-m-d). */
    public static function dropAt(string $date): DateTimeImmutable
    {
        [$h, $m] = self::dropTime();
        return (new DateTimeImmutable($date . ' 00:00:00', new DateTimeZone('UTC')))->setTime($h, $m);
    }

    /** Date (Y-m-d) of the challenge active at $now: before today's drop it is still yesterday's. */
    public static function currentDate(?DateTimeImmutable $now = null): string
    {
        $now   = self::utc($now);
        $today = $now->format('Y-m-d');
        return $now < self::dropAt($today)
            ? $now->modify('-1 day')->format('Y-m-d')
            : $today;
    }

    /** The next drop after $now (when the current challenge closes). */
    public static function nextDropAt(?DateTimeImmutable $now = null): DateTimeImmutable
    {
        $current = self::currentDate($now);
        return self::dropAt((new DateTimeImmutable($current, new DateTimeZone('UTC')))->modify('+1 day')->format('Y-m-d'));
    }

    /** Seconds until the next drop (never negative). */
    public static function secondsLeft(?DateTimeImmutable $now = null): int
    {
        $now = self::utc($now);
        return max(0, self::nextDropAt($now)->getTimestamp() - $now->getTimestamp());
    }

    /** True while the challenge of $date is the active one. */
    public static function isActive(string $date, ?DateTimeImmutable $now = null): bool
    {
        return $date === self::currentDate($now);
    }

    /** Start and end of a challenge date's 24 hours. */
    public static function window(string $date): array
    {
        $start = self::dropAt($date);
        return [$start, $start->modify('+1 day')];
    }

    public static function isValidDate(string $date): bool
    {
        $d = DateTimeImmutable::createFromFormat('!Y-m-d', $date, new DateTimeZone('UTC'));
        return $d !== false && $d->format('Y-m-d') === $date;
    }

    private static function utc(?DateTimeImmutable $now): DateTimeImmutable
    {
        return ($now ?? new DateTimeImmutable('now'))->setTimezone(new DateTimeZone('UTC'));
    }
}
