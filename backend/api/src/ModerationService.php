<?php

declare(strict_types=1);

/**
 * Cheap, configurable text gate. Used on user-generated copy that ends up
 * persisted in the DB: challenge titles, return clauses, proof requirements,
 * messages, comments. The goal is to prevent the obvious - slurs, sexual
 * solicitation, blatant scam phrases - without becoming a brittle filter
 * that blocks legitimate use cases.
 *
 * Two layers, applied in order:
 *
 *   1. Word blocklist (literal, case-insensitive, accent-folded).
 *      Boundaries: matches whole words via \b so "Scunthorpe" doesn't trip
 *      on a slur substring. Loaded from CHALLENGE_MODERATION_BLOCKLIST
 *      (comma- or newline-separated) or, when absent, the small built-in
 *      default below.
 *
 *   2. Regex patterns (advanced - phone numbers, links to known scam
 *      domains, etc.). Loaded from CHALLENGE_MODERATION_REGEX (one PCRE
 *      per line; '#' delimiters recommended to avoid escaping forward
 *      slashes). Patterns must compile or they're skipped with an error
 *      log - never block the whole pipeline because one regex was malformed.
 *
 * Return shape from check():
 *   null                              → clean
 *   ['reason' => string, 'hit' => string] → matched; route should 422
 *
 * The 'hit' field is the offending token (or pattern label) - useful for
 * server logs + ops dashboards. NEVER surface it in the user-facing error
 * (we'd hand the spammer a hint about what to dodge); the route returns a
 * generic "your text was rejected by moderation" message instead.
 */
class ModerationService
{
    /**
     * Small built-in default. Intentionally narrow - the real list lives
     * in env. Kept here so a fresh dev environment with no env config still
     * blocks the worst cases.
     */
    private const DEFAULT_WORDS = [
        // Sexual solicitation patterns we've seen in spam.
        'onlyfans', 'cashapp $', 'sugar daddy', 'sugar baby',
        // Crypto / pig-butchering bait.
        'usdt giveaway', 'free bitcoin', 'whatsapp +',
        // Hate speech - narrow shortlist; the env-overridable list is where
        // the production blocklist actually lives.
        'kys',
    ];

    private static ?array $cachedWords    = null;
    private static ?array $cachedPatterns = null;

    /**
     * Main entry - returns null if the text is clean, an associative
     * array {'reason', 'hit'} if it's blocked. Whitespace-only or null
     * input is always clean (callers handle "required" elsewhere).
     */
    public static function check(?string $text): ?array
    {
        if ($text === null) return null;
        $text = trim($text);
        if ($text === '') return null;

        $normalized = self::normalize($text);

        foreach (self::words() as $w) {
            $needle = self::normalize($w);
            if ($needle === '') continue;

            // Phrase needles (with whitespace) fall back to plain contains -
            // \b doesn't behave well around multi-word matches and Unicode.
            if (str_contains($needle, ' ')) {
                if (str_contains($normalized, $needle)) {
                    return ['reason' => 'blocked_word', 'hit' => $w];
                }
                continue;
            }
            // Single word: anchor to word boundaries so "ass" doesn't match
            // "class". /u for Unicode; the needle is already escaped because
            // it came from a static list we control.
            $escaped = preg_quote($needle, '/');
            if (preg_match('/\b' . $escaped . '\b/u', $normalized) === 1) {
                return ['reason' => 'blocked_word', 'hit' => $w];
            }
        }

        foreach (self::patterns() as $label => $pattern) {
            // suppressErrors=true via @ - patterns came from env and may be
            // malformed; we logged them once at load-time, no need to spam.
            $matched = @preg_match($pattern, $normalized);
            if ($matched === 1) {
                return ['reason' => 'blocked_pattern', 'hit' => $label];
            }
        }

        return null;
    }

    /**
     * Lowercase, NFC-folded, common diacritic stripping. We keep this cheap
     * - full Unicode normalization is overkill for spam-tier text and
     * Postgres column collation already does most of what we need at
     * comparison time. iconv handles the bulk; the strtolower step catches
     * the trailing ASCII case.
     */
    private static function normalize(string $s): string
    {
        // iconv //TRANSLIT can fail on stray bytes - fall back to the raw
        // string then so we still get a SOME comparison.
        $folded = @iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $s);
        if ($folded === false) $folded = $s;
        return mb_strtolower($folded);
    }

    private static function words(): array
    {
        if (self::$cachedWords !== null) return self::$cachedWords;

        $raw = getenv('CHALLENGE_MODERATION_BLOCKLIST');
        if ($raw === false || trim((string) $raw) === '') {
            self::$cachedWords = self::DEFAULT_WORDS;
            return self::$cachedWords;
        }

        // Accept comma OR newline separators so ops can paste either form
        // into the env var. Each token is trimmed; empty entries dropped.
        $items = preg_split('/[,\n]+/', (string) $raw) ?: [];
        $items = array_map(static fn($s) => trim((string) $s), $items);
        $items = array_values(array_filter($items, static fn($s) => $s !== ''));

        self::$cachedWords = $items;
        return self::$cachedWords;
    }

    /**
     * Patterns come from CHALLENGE_MODERATION_REGEX, one PCRE per line.
     * Optional "label: pattern" syntax - the label shows up in logs as
     * the 'hit' field so ops can recognise which rule fired. If no label
     * is provided, the pattern itself is the label.
     *
     * Malformed patterns are logged once and skipped - never let bad ops
     * config 500 the API.
     */
    private static function patterns(): array
    {
        if (self::$cachedPatterns !== null) return self::$cachedPatterns;
        self::$cachedPatterns = [];

        $raw = getenv('CHALLENGE_MODERATION_REGEX');
        if ($raw === false || trim((string) $raw) === '') {
            return self::$cachedPatterns;
        }

        foreach (preg_split('/\n+/', (string) $raw) ?: [] as $line) {
            $line = trim($line);
            if ($line === '') continue;

            // "label: pattern" - split on the FIRST colon only (patterns
            // routinely contain colons).
            $label   = $line;
            $pattern = $line;
            if (str_contains($line, ': ')) {
                [$label, $pattern] = explode(': ', $line, 2);
                $label   = trim($label);
                $pattern = trim($pattern);
            }
            if ($pattern === '') continue;

            // Validate the pattern compiles. preg_match returns false on
            // syntax error; we surface to the log so the operator notices.
            if (@preg_match($pattern, '') === false) {
                error_log("[moderation] skipping malformed regex: $label");
                continue;
            }
            self::$cachedPatterns[$label] = $pattern;
        }

        return self::$cachedPatterns;
    }

    /**
     * Convenience for routes: check a bundle of fields at once. Returns
     * the FIRST hit (so the route stops on first failure and surfaces a
     * single 422). $fields is a map of field-name → value; field-name is
     * for logging only, not surfaced to the user.
     */
    public static function checkBundle(array $fields): ?array
    {
        foreach ($fields as $field => $value) {
            if (!is_string($value)) continue;
            $hit = self::check($value);
            if ($hit !== null) {
                $hit['field'] = (string) $field;
                return $hit;
            }
        }
        return null;
    }
}
