<?php

declare(strict_types=1);

/**
 * Daily Challenge content translations, written by hand (no provider).
 *
 * The founder translates challenge text, context and Local Twists in the back
 * office (or in the import JSON). They are stored per locale next to the
 * English original: daily_challenges.text_i18n / context_i18n
 * ({"en": "...", "fr": "...", "_src": "<English at save time>"}) and
 * daily_twists.text_i18n (other locales only; daily_twists.text is English).
 * "_src" lets the editor flag translations older than the English.
 *
 * Readers get the viewer's locale when a translation exists, else English.
 * Proof captions are never translated. Brand terms stay English: the editor
 * warns when a translation drops one.
 */
final class DailyI18n
{
    /** The app's 19 locales (apps/mobile/src/i18n/locales). */
    public const LOCALES = ['en', 'fr', 'vi', 'es', 'it', 'pt-br', 'pt-pt', 'de', 'nl', 'zh-hans', 'zh-hant',
                            'ja', 'ko', 'fil', 'th', 'id', 'hi', 'ru', 'ar'];
    public const BRAND_TERMS = ['Hilads', 'Daily Challenge', 'Local Twist', 'challenge', 'Most Local'];

    private static ?string $current = null;

    /** Locales other than English, in the app's order. */
    public static function others(): array
    {
        return array_values(array_diff(self::LOCALES, ['en']));
    }

    /**
     * One of LOCALES from a device / browser tag ("pt-PT", "zh_TW", "tl",
     * "fr-FR"), else 'en'. Pure.
     */
    public static function normalize(?string $tag): string
    {
        $t = strtolower(str_replace('_', '-', trim((string) $tag)));
        if ($t === '') {
            return 'en';
        }
        if (in_array($t, self::LOCALES, true)) {
            return $t;
        }
        $aliases = [
            'pt'      => 'pt-br', 'pt-pt' => 'pt-pt', 'pt-ao' => 'pt-pt', 'pt-mz' => 'pt-pt',
            'zh'      => 'zh-hans', 'zh-cn' => 'zh-hans', 'zh-sg' => 'zh-hans',
            'zh-tw'   => 'zh-hant', 'zh-hk' => 'zh-hant', 'zh-mo' => 'zh-hant',
            'tl'      => 'fil', 'in' => 'id',
        ];
        if (isset($aliases[$t])) {
            return $aliases[$t];
        }
        if (str_starts_with($t, 'zh-hant')) return 'zh-hant';
        if (str_starts_with($t, 'zh-hans')) return 'zh-hans';
        if (str_starts_with($t, 'pt-')) return 'pt-br';
        $base = explode('-', $t)[0];
        return isset($aliases[$base]) ? $aliases[$base] : (in_array($base, self::LOCALES, true) ? $base : 'en');
    }

    /**
     * Locale of the current API request: ?locale= (the app sends its UI
     * language), else the signed-in user's users.locale, else English. Jobs
     * and the CLI read English.
     */
    public static function current(): string
    {
        if (self::$current !== null) {
            return self::$current;
        }
        if (PHP_SAPI === 'cli') {
            return 'en';
        }
        if (isset($_GET['locale']) && is_string($_GET['locale'])) {
            return self::$current = self::normalize($_GET['locale']);
        }
        $user = class_exists('AuthService') ? AuthService::currentUser() : null;
        return self::$current = self::normalize($user['locale'] ?? null);
    }

    /** Force the request locale (tests, jobs rendering for one recipient). */
    public static function setCurrent(?string $locale): void
    {
        self::$current = $locale === null ? null : self::normalize($locale);
    }

    /** The translation of $locale in an i18n map, or null (English or missing). Pure. */
    public static function pick(array $i18n, string $locale): ?string
    {
        if ($locale === 'en') {
            return null;
        }
        $v = $i18n[$locale] ?? null;
        return is_string($v) && trim($v) !== '' ? $v : null;
    }

    /** Locales (other than English) that have a non-empty value. Pure. */
    public static function translated(array $i18n): array
    {
        return array_values(array_filter(self::others(), static fn(string $l) => self::pick($i18n, $l) !== null));
    }

    /** True when translations were saved for an older English text. Pure. */
    public static function isStale(array $i18n, string $english): bool
    {
        return self::translated($i18n) !== [] && isset($i18n['_src']) && $i18n['_src'] !== $english;
    }

    /** Brand terms present in the English but missing from the translation (case-insensitive). Pure. */
    public static function missingBrandTerms(string $english, string $translated): array
    {
        $missing = [];
        foreach (self::BRAND_TERMS as $term) {
            // The bare word "challenge" is checked outside "Daily Challenge" (reported on its own).
            $en = $term === 'challenge' ? str_ireplace('Daily Challenge', '', $english) : $english;
            $tr = $term === 'challenge' ? str_ireplace('Daily Challenge', '', $translated) : $translated;
            if (mb_stripos($en, $term) !== false && mb_stripos($tr, $term) === false) {
                $missing[] = $term;
            }
        }
        return $missing;
    }

    /**
     * Clean a {locale: text} map from a form or an import: keeps known
     * non-English locales, trims, drops empty values. Throws
     * InvalidArgumentException ("<field> (<locale>) ...") when a value is too
     * long or flagged by the text filter.
     */
    public static function clean(mixed $map, int $max, string $field): array
    {
        $out = [];
        foreach (is_array($map) ? $map : [] as $locale => $value) {
            $locale = self::normalize((string) $locale);
            if ($locale === 'en' || !is_string($value)) {
                continue;
            }
            $value = trim($value);
            if ($value === '') {
                continue;
            }
            if (mb_strlen($value) > $max) {
                throw new InvalidArgumentException("{$field} ({$locale}) is longer than {$max} characters.");
            }
            if (ModerationService::check($value) !== null) {
                throw new InvalidArgumentException("{$field} ({$locale}) was flagged by the text filter.");
            }
            $out[$locale] = $value;
        }
        return $out;
    }

    /**
     * Merge cleaned translations into a stored map, keeping 'en' and stamping
     * '_src' with the current English. Locales absent from $translations are
     * removed (the form always sends all of them). Pure.
     */
    public static function merge(array $stored, string $english, array $translations): array
    {
        $out = ['en' => $english];
        foreach (self::others() as $l) {
            if (isset($translations[$l])) {
                $out[$l] = $translations[$l];
            }
        }
        if (count($out) > 1) {
            $out['_src'] = $english;
        }
        return $out;
    }

    /**
     * Viewer-facing text: [text, original|null]. original is the English when
     * a translation is shown. Pure.
     */
    public static function localize(array $i18n, string $english, string $locale): array
    {
        $t = self::pick($i18n, $locale);
        return $t === null ? [$english, null] : [$t, $english];
    }
}
