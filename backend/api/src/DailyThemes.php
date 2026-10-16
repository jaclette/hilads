<?php

declare(strict_types=1);

/**
 * The 7 weekly themes of the Daily Challenge (SPEC 8.2), in one place.
 *
 * daily_challenges.theme stores the key, so renaming a theme is a change of
 * its name here. Names are Daily Challenge content: English everywhere. Each
 * weekday has a default theme (ISO day of week, 1 = Monday), used for new and
 * undated challenges and as the fallback of every payload. migrate.php's
 * backfill repeats this table in SQL.
 */
final class DailyThemes
{
    /** key => [name, ISO weekday] */
    public const THEMES = [
        'language'     => ['Language', 1],
        'street_food'  => ['Street food', 2],
        'coffee'       => ['Coffee', 3],
        'market'       => ['Market', 4],
        'night_out'    => ['Night out', 5],
        'neighborhood' => ['Neighborhood', 6],
        'traditions'   => ['Traditions', 7],
    ];

    /** @return string[] */
    public static function keys(): array
    {
        return array_keys(self::THEMES);
    }

    public static function name(string $key): string
    {
        return self::THEMES[$key][0] ?? $key;
    }

    /** Default theme of a date (Y-m-d) from its weekday. */
    public static function forDate(string $date): string
    {
        $dow = (int) (new DateTimeImmutable($date, new DateTimeZone('UTC')))->format('N');
        foreach (self::THEMES as $key => [, $day]) {
            if ($day === $dow) {
                return $key;
            }
        }
        return 'language';
    }

    /** A theme key from a key or a name ("street_food", "Street food", "street food"), else null. */
    public static function normalize(mixed $v): ?string
    {
        if (!is_string($v)) {
            return null;
        }
        $t = strtolower(trim($v));
        foreach (self::THEMES as $key => [$name]) {
            if ($t === $key || $t === strtolower($name) || str_replace(' ', '_', $t) === $key) {
                return $key;
            }
        }
        return null;
    }

    /** The stored theme, else the date's default, else null (undated reserve without one). */
    public static function effective(?string $stored, ?string $date): ?string
    {
        if ($stored !== null && isset(self::THEMES[$stored])) {
            return $stored;
        }
        return $date !== null ? self::forDate($date) : null;
    }

    /** Payload shape {key, name}, or null. */
    public static function format(?string $stored, ?string $date): ?array
    {
        $key = self::effective($stored, $date);
        return $key === null ? null : ['key' => $key, 'name' => self::name($key)];
    }

    /** Every theme in weekday order, for pickers: [{key, name, weekday}]. */
    public static function all(): array
    {
        $out = [];
        foreach (self::THEMES as $key => [$name, $day]) {
            $out[] = ['key' => $key, 'name' => $name, 'weekday' => $day];
        }
        return $out;
    }
}
