<?php

declare(strict_types=1);

/**
 * Seasonal events (Admin › Daily › Seasonal events): a theme the apps put on
 * the Daily screens around a date, Halloween first. The look itself (colors,
 * decorations, copy) lives in the apps, picked by the theme key; an app that
 * doesn't know the key keeps its normal look, so future events only need the
 * back office once their theme ships.
 *
 * Kept as one JSON list in app_settings (key seasonal_events), no table:
 *   {id, name, theme, teaserStart, start, end, previewUsers[], previewPhase}
 * Dates are challenge dates (DailyClock), never a device's calendar, so the
 * look always matches the challenge on screen:
 * - teaser: teaserStart ≤ date < start (a countdown: startsInDays)
 * - live:   start ≤ date ≤ end
 * - recap:  the day after end (the Yesterday card keeps a touch)
 * Preview: the accounts in previewUsers (usernames) see previewPhase now,
 * whatever the date, on the apps and the web.
 */
final class SeasonalEvents
{
    public const SETTING = 'seasonal_events';
    public const PHASES  = ['teaser', 'live', 'recap'];
    /** The themes the apps know (the back office offers these; any slug is accepted). */
    public const THEMES  = ['halloween'];

    /** @return list<array> every saved event (empty when none or unreadable). */
    public static function all(): array
    {
        $raw = AppConfig::settings()[self::SETTING] ?? '';
        $list = $raw !== '' ? json_decode($raw, true) : [];
        return is_array($list) ? array_values(array_filter($list, 'is_array')) : [];
    }

    /** Validate a back office form into an event. Throws InvalidArgumentException. */
    public static function clean(array $in): array
    {
        $id = strtolower(trim((string) ($in['id'] ?? '')));
        if (!preg_match('/^[a-z0-9][a-z0-9-]{0,47}$/', $id)) {
            throw new InvalidArgumentException('Id: lowercase letters, digits and dashes (e.g. halloween-2026).');
        }
        $theme = strtolower(trim((string) ($in['theme'] ?? '')));
        if (!preg_match('/^[a-z0-9_]{1,32}$/', $theme)) {
            throw new InvalidArgumentException('Theme key: lowercase letters, digits and underscores (e.g. halloween).');
        }
        $dates = [];
        foreach (['teaserStart' => 'Teaser start', 'start' => 'Start', 'end' => 'End'] as $k => $label) {
            $v = trim((string) ($in[$k] ?? ''));
            if ($k === 'teaserStart' && $v === '') {
                $dates[$k] = null;
                continue;
            }
            if (!DailyClock::isValidDate($v)) {
                throw new InvalidArgumentException("{$label}: a date (YYYY-MM-DD).");
            }
            $dates[$k] = $v;
        }
        if ($dates['end'] < $dates['start']) {
            throw new InvalidArgumentException('End must be on or after the start.');
        }
        if ($dates['teaserStart'] !== null && $dates['teaserStart'] >= $dates['start']) {
            throw new InvalidArgumentException('Teaser start must be before the start (or empty: no teaser).');
        }
        $users = $in['previewUsers'] ?? [];
        if (is_string($users)) {
            $users = preg_split('/[\s,]+/', $users) ?: [];
        }
        $users = array_values(array_unique(array_filter(array_map(
            static fn($u): string => strtolower(ltrim(trim((string) $u), '@')), $users))));
        $phase = (string) ($in['previewPhase'] ?? '');
        return [
            'id'           => $id,
            'name'         => mb_substr(trim((string) ($in['name'] ?? '')), 0, 80) ?: $id,
            'theme'        => $theme,
            'teaserStart'  => $dates['teaserStart'],
            'start'        => $dates['start'],
            'end'          => $dates['end'],
            'previewUsers' => $users,
            'previewPhase' => in_array($phase, self::PHASES, true) ? $phase : 'live',
        ];
    }

    /** Add or replace (same id) an event. */
    public static function save(array $event, string $by): void
    {
        $list = array_values(array_filter(self::all(), static fn(array $e): bool => ($e['id'] ?? '') !== $event['id']));
        $list[] = $event;
        usort($list, static fn(array $a, array $b): int => strcmp((string) $a['start'], (string) $b['start']));
        self::write($list, $by);
    }

    public static function delete(string $id, string $by): void
    {
        self::write(array_values(array_filter(self::all(), static fn(array $e): bool => ($e['id'] ?? '') !== $id)), $by);
    }

    /** An event's phase on a challenge date, else null. */
    public static function phase(array $e, string $date): ?string
    {
        $start = (string) ($e['start'] ?? '');
        $end   = (string) ($e['end'] ?? '');
        if ($start === '' || $end === '') {
            return null;
        }
        if ($date >= $start && $date <= $end) {
            return 'live';
        }
        if (!empty($e['teaserStart']) && $date >= $e['teaserStart'] && $date < $start) {
            return 'teaser';
        }
        return $date === self::addDays($end, 1) ? 'recap' : null;
    }

    /**
     * The event a viewer sees on a challenge date, for GET /daily/today:
     * {id, theme, phase, start, end, startsInDays}, or null. A preview
     * account sees its event's preview phase; otherwise live beats teaser
     * beats recap when events overlap.
     */
    public static function forViewer(string $date, ?array $user, ?array $events = null): ?array
    {
        $events ??= self::all();
        $username = strtolower((string) ($user['username'] ?? ''));
        $best = null;
        $rank = ['live' => 0, 'teaser' => 1, 'recap' => 2];
        foreach ($events as $e) {
            $preview = $username !== '' && in_array($username, (array) ($e['previewUsers'] ?? []), true);
            $phase   = $preview ? (string) ($e['previewPhase'] ?? 'live') : self::phase($e, $date);
            if ($phase === null || !isset($rank[$phase])) {
                continue;
            }
            $out = [
                'id'           => (string) $e['id'],
                'theme'        => (string) $e['theme'],
                'phase'        => $phase,
                'start'        => (string) $e['start'],
                'end'          => (string) $e['end'],
                // A preview's teaser counts down like the real one (2 days before).
                'startsInDays' => $phase === 'teaser'
                    ? ($preview ? 2 : max(1, self::daysBetween($date, (string) $e['start'])))
                    : null,
                'preview'      => $preview,
            ];
            if ($preview) {
                return $out;
            }
            if ($best === null || $rank[$phase] < $rank[$best['phase']]) {
                $best = $out;
            }
        }
        return $best;
    }

    private static function write(array $list, string $by): void
    {
        $stmt = Database::pdo()->prepare("
            INSERT INTO app_settings (key, value, updated_at, updated_by) VALUES (?, ?, now(), ?)
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by
        ");
        $stmt->execute([self::SETTING, json_encode($list, JSON_UNESCAPED_UNICODE), $by]);
        AppConfig::forgetSettings();
    }

    private static function addDays(string $date, int $days): string
    {
        return (new DateTimeImmutable($date, new DateTimeZone('UTC')))->modify("{$days} day")->format('Y-m-d');
    }

    private static function daysBetween(string $from, string $to): int
    {
        $a = new DateTimeImmutable($from, new DateTimeZone('UTC'));
        $b = new DateTimeImmutable($to, new DateTimeZone('UTC'));
        return (int) $a->diff($b)->format('%r%a');
    }
}
