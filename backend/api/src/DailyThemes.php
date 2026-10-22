<?php

declare(strict_types=1);

/**
 * The 7 weekly themes of the Daily Challenge (SPEC 3, 8.2), in one place,
 * plus "special" (a special day of world scope, SPEC 9.15).
 *
 * daily_challenges.theme stores the key, so renaming a theme is a change of
 * its name here. Names are English here; the apps and the push copy show them
 * in the user's language. Each weekday has a default theme (ISO day of week,
 * 1 = Monday), used for new and undated challenges and as the fallback of
 * every payload.
 *
 * Themes v2 (2026-10-19) replaced the first 7 (LEGACY). Keys from before are
 * still read (an unmigrated row, an old import file), and apps that don't send
 * "X-Themes: 2" (the builds before the change) get the old keys back, so they
 * keep showing a theme name and icon they know.
 */
final class DailyThemes
{
    /** key => [name, ISO weekday] */
    public const THEMES = [
        'hidden_gem' => ['Hidden gem', 1],
        'taste'      => ['Taste', 2],
        'join_in'    => ['Join in', 3],
        'local_find' => ['Local find', 4],
        'night_out'  => ['Night out', 5],
        'sip'        => ['Drinks', 6],
        'only_here'  => ['Only here', 7],
    ];

    /** Short English description of each theme, for the back office. */
    public const DESCRIPTIONS = [
        'join_in' => 'Jump into something locals do together.',
    ];

    /**
     * Themes whose image bundled in the apps (assets/covers, web public/covers)
     * is a placeholder: TODO replace join_in.jpg with the real Join in cover,
     * then empty this list.
     */
    public const PLACEHOLDER_COVERS = ['join_in'];

    /**
     * Keys renamed since themes v2: old key => current key. Apps sending
     * "X-Themes: 2" (built before the rename) get the old key back
     * (Join in, 2026-10-22, was Ask a local).
     */
    public const RENAMED = [
        'ask_local' => 'join_in',
    ];

    /** A special day of world scope (daily_specials): not a weekly theme, no Local Pass stamp. */
    public const SPECIAL = 'special';

    /** Themes v1 key => v2 key (the 2026-10-19 migration). */
    public const LEGACY = [
        'neighborhood' => 'hidden_gem',
        'street_food'  => 'taste',
        'language'     => 'join_in',
        'market'       => 'local_find',
        'night_out'    => 'night_out',
        'coffee'       => 'sip',
        'traditions'   => 'only_here',
    ];

    /** Themes v1 names, for old import files ("Street food" → taste). */
    private const LEGACY_NAMES = [
        'neighborhood' => 'Neighborhood', 'street_food' => 'Street food', 'language' => 'Language',
        'market' => 'Market', 'coffee' => 'Coffee', 'traditions' => 'Traditions',
    ];

    /** @return string[] */
    public static function keys(): array
    {
        return array_keys(self::THEMES);
    }

    public static function name(string $key): string
    {
        return $key === self::SPECIAL ? 'Special' : (self::THEMES[$key][0] ?? $key);
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
        return 'hidden_gem';
    }

    /**
     * A weekly theme key from a key or a name, current, renamed or v1 ("taste",
     * "Taste", "ask_local", "Ask a local", "Street food"), else null. Never
     * "special": see normalizeAny().
     */
    public static function normalize(mixed $v): ?string
    {
        if (!is_string($v)) {
            return null;
        }
        $t = strtolower(trim($v));
        $u = str_replace(' ', '_', $t);
        foreach (self::THEMES as $key => [$name]) {
            if ($t === $key || $t === strtolower($name) || $u === $key) {
                return $key;
            }
        }
        if (isset(self::RENAMED[$u]) || $t === 'ask a local') {
            return self::RENAMED[$u] ?? 'join_in';
        }
        foreach (self::LEGACY_NAMES as $old => $name) {
            if ($t === $old || $t === strtolower($name) || $u === $old) {
                return self::LEGACY[$old];
            }
        }
        return null;
    }

    /** normalize(), or "special" for "Special" (import files and the back office). */
    public static function normalizeAny(mixed $v): ?string
    {
        return is_string($v) && strtolower(trim($v)) === self::SPECIAL ? self::SPECIAL : self::normalize($v);
    }

    /** The stored theme (v1 and renamed keys read as the current key, "special" kept), else the date's default, else null. */
    public static function effective(?string $stored, ?string $date): ?string
    {
        if ($stored === self::SPECIAL || ($stored !== null && isset(self::THEMES[$stored]))) {
            return $stored;
        }
        if ($stored !== null && isset(self::RENAMED[$stored])) {
            return self::RENAMED[$stored];
        }
        if ($stored !== null && isset(self::LEGACY[$stored])) {
            return self::LEGACY[$stored];
        }
        return $date !== null ? self::forDate($date) : null;
    }

    /** Payload shape {key, name}, or null. Keys are the client's (v1 for an old app, ask_local for a v2 one). */
    public static function format(?string $stored, ?string $date): ?array
    {
        $key = self::effective($stored, $date);
        if ($key === null) {
            return null;
        }
        if (self::legacyClient()) {
            $old = self::toLegacy($key, $date);
            return ['key' => $old, 'name' => self::LEGACY_NAMES[$old] ?? self::name(self::LEGACY[$old] ?? $old)];
        }
        return ['key' => self::client($key, $date), 'name' => self::name($key)];
    }

    /** A theme key as the client knows it (v1 for an old app, the pre-rename key for a v2 one). For raw key lists (spot themes, stamps). */
    public static function client(string $key, ?string $date = null): string
    {
        $key = self::effective($key, $date) ?? $key;
        $version = self::clientVersion();
        if ($version === 1) {
            return self::toLegacy($key, $date);
        }
        if ($version === 2) {
            $old = array_search($key, self::RENAMED, true);
            return $old === false ? $key : $old;
        }
        return $key;
    }

    /** Distinct client keys of stored keys (spot themes), without specials, in the stored order. */
    public static function clientList(array $stored): array
    {
        $out = [];
        foreach ($stored as $k) {
            $k = trim((string) $k);
            if ($k === '' || $k === self::SPECIAL) {
                continue;
            }
            $out[self::client($k)] = true;
        }
        return array_keys($out);
    }

    /** v2 key → v1 key; "special" → the v1 theme of its weekday. */
    public static function toLegacy(string $key, ?string $date = null): string
    {
        if ($key === self::SPECIAL) {
            $key = $date !== null ? self::forDate($date) : 'only_here';
        }
        $old = array_search($key, self::LEGACY, true);
        return $old === false ? $key : $old;
    }

    /**
     * The theme keys the client knows: "X-Themes: 2" (the app) or "?themes=2"
     * (the web: a query parameter, no CORS preflight) = themes v2, plus
     * "X-Themes-Rev: 3" / "?themesRev=3" = current (Join in), else v2 before
     * the renames (RENAMED); none = an app built before themes v2 (v1 keys).
     * The 2 stays so a backend from before 3 still sends v2 keys. CLI
     * (pushes, scripts) is always current.
     */
    public static function clientVersion(): int
    {
        if (!isset($_SERVER['REQUEST_METHOD'])) {   // CLI: jobs, scripts
            return 3;
        }
        $v = max((int) trim((string) ($_SERVER['HTTP_X_THEMES'] ?? '')), (int) ($_GET['themes'] ?? 0));
        $rev = max((int) trim((string) ($_SERVER['HTTP_X_THEMES_REV'] ?? '')), (int) ($_GET['themesRev'] ?? 0));
        if ($v >= 3 || ($v === 2 && $rev >= 3)) {
            return 3;
        }
        return $v === 2 ? 2 : 1;
    }

    /** True for an app built before themes v2 (v1 keys). */
    public static function legacyClient(): bool
    {
        return self::clientVersion() === 1;
    }

    /**
     * Default covers uploaded in the back office (daily_theme_covers): key =>
     * URL, for the 7 themes and "special". Cached 60 s; empty before the migration.
     */
    public static function covers(): array
    {
        return Cache::remember('daily_theme_covers_v1', 60, static function (): array {
            try {
                return Database::pdo()->query("SELECT theme, cover_url FROM daily_theme_covers")->fetchAll(PDO::FETCH_KEY_PAIR);
            } catch (\Throwable $e) {
                return [];
            }
        }) ?? [];
    }

    public static function setCover(string $key, ?string $url): void
    {
        $pdo = Database::pdo();
        if ($url === null) {
            $pdo->prepare("DELETE FROM daily_theme_covers WHERE theme = ?")->execute([$key]);
        } else {
            $pdo->prepare("
                INSERT INTO daily_theme_covers (theme, cover_url) VALUES (?, ?)
                ON CONFLICT (theme) DO UPDATE SET cover_url = EXCLUDED.cover_url, updated_at = now()
            ")->execute([$key, $url]);
        }
        Cache::forget('daily_theme_covers_v1');
    }

    /** Every weekly theme in weekday order, for pickers: [{key, name, weekday}]. */
    public static function all(): array
    {
        $out = [];
        foreach (self::THEMES as $key => [$name, $day]) {
            $out[] = ['key' => self::client($key), 'name' => $name, 'weekday' => $day];
        }
        return $out;
    }
}
