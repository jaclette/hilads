<?php

declare(strict_types=1);

/**
 * "Different Worlds by Hilads", race format (dw_topics.format 'race'): a bar chart race over the years from ONE source
 * and one definition, no clip (tools/promo/src/Reaction.jsx RaceVideo renders it): the headline hook, the top 10 of each
 * year (0.7 s a year, smooth overtakes), a pop banner at the striking year, a 2 s freeze on the last year (the crown on
 * #1), the closing slide (the question, the cta_line button). PNGs: 01 the first year, 02 the final ranking, 03 the
 * closing slide.
 *
 * A package's content: {format: "race", topic, headline, headline_accent?, detail? (the banner), banner_year?, series:
 * [{country, flag (emoji), values: {"2000": 77.2, …}}] (every country with a value for every year), unit? ("M"),
 * value_label, data_years, source, source_url?, outro_question, cta_line, card_bg?, highlight? [country], caption,
 * hashtags, warnings?}.
 */
final class DwRace
{
    public const MIN_YEARS = 5;
    public const MAX_YEARS = 40;
    public const SHOWN = 10;
    public const START = 2.2;          // tools/promo/src/reactionTiming.js RACE
    public const PER_YEAR = 0.7;
    public const FREEZE = 2.0;
    public const CLOSING = 3.0;
    public const HEADLINE_WORDS = 9;

    public static function isRace(array $c): bool
    {
        return ($c['format'] ?? null) === 'race';
    }

    /** The years of a package (sorted), from its series. Pure. */
    public static function years(array $c): array
    {
        $years = [];
        foreach ($c['series'] ?? [] as $s) {
            foreach (array_keys(is_array($s['values'] ?? null) ? $s['values'] : []) as $y) {
                $years[(int) $y] = true;
            }
        }
        ksort($years);
        return array_keys($years);
    }

    /** The video's length (seconds). Pure. */
    public static function videoSeconds(array $c): float
    {
        return self::START + max(0, count(self::years($c)) - 1) * self::PER_YEAR + self::FREEZE + self::CLOSING;
    }

    /** Checks a race content: [errors (block the import), warnings]. Pure (but for DwStudio::screenWords). */
    public static function validate(array $c): array
    {
        $errors = [];
        $warn = [];
        foreach (['topic', 'headline', 'source', 'value_label', 'caption', 'outro_question', 'cta_line'] as $f) {
            if (!is_string($c[$f] ?? null) || trim($c[$f]) === '') {
                $errors[] = "\"{$f}\" is missing.";
            }
        }
        if (is_string($c['cta_line'] ?? null) && trim($c['cta_line']) !== '' && stripos($c['cta_line'], 'hilads.live') === false) {
            $errors[] = '"cta_line" must include hilads.live.';
        }
        $series = $c['series'] ?? null;
        if (!is_array($series) || !array_is_list($series) || count($series) < self::SHOWN) {
            $errors[] = '"series" must be a list of at least ' . self::SHOWN . ' countries: {country, flag, values: {year: number}}.';
            return [$errors, $warn];
        }
        $years = self::years($c);
        if (count($years) < self::MIN_YEARS || count($years) > self::MAX_YEARS) {
            $errors[] = 'The race needs ' . self::MIN_YEARS . ' to ' . self::MAX_YEARS . ' years (' . count($years) . ').';
        } elseif ($years !== range($years[0], end($years))) {
            $errors[] = 'The years must follow each other (no missing year): ' . implode(', ', array_diff(range($years[0], end($years)), $years)) . '.';
        }
        $names = [];
        foreach ($series as $i => $s) {
            $n = $i + 1;
            $country = trim((string) ($s['country'] ?? ''));
            if ($country === '') {
                $errors[] = "Country {$n}: \"country\" is missing.";
            }
            if (!is_string($s['flag'] ?? null) || trim($s['flag']) === '') {
                $errors[] = "Country {$n} ({$country}): \"flag\" is missing.";
            } elseif (DwSlides::flagFile($s['flag']) === null) {
                $warn[] = "Country {$n} ({$country}): no flag image for \"{$s['flag']}\".";
            }
            $values = is_array($s['values'] ?? null) ? $s['values'] : [];
            $missing = array_diff($years, array_map('intval', array_keys($values)));
            if ($missing !== []) {
                $errors[] = "{$country}: no value for " . implode(', ', $missing) . ' (interpolate a one-year gap and say so in the source line, else drop the country or the years).';
            }
            foreach ($values as $y => $v) {
                if (!(is_int($v) || is_float($v)) || $v < 0) {
                    $errors[] = "{$country} {$y}: the value must be a number (0 or more).";
                    break;
                }
            }
            $names[] = mb_strtolower($country);
        }
        if (count(array_unique($names)) !== count($names)) {
            $errors[] = 'A country appears twice.';
        }
        if (isset($c['banner_year']) && $c['banner_year'] !== null && !in_array((int) $c['banner_year'], $years, true)) {
            $errors[] = '"banner_year" must be one of the race\'s years.';
        }
        if (isset($c['card_bg']) && !DwReaction::cardBgOk($c['card_bg'])) {
            $errors[] = '"card_bg" is ' . implode(', ', DwReaction::CARD_THEMES) . ' or a light color as #rrggbb.';
        }
        if (isset($c['headline_accent']) && trim((string) $c['headline_accent']) !== ''
            && mb_stripos((string) ($c['headline'] ?? ''), trim((string) $c['headline_accent'])) === false) {
            $errors[] = '"headline_accent" must be words of the headline.';
        }
        if (is_string($c['headline'] ?? null) && ($w = DwStudio::screenWords($c['headline'])) > self::HEADLINE_WORDS) {
            $warn[] = "The headline is {$w} words (max " . self::HEADLINE_WORDS . ').';
        }
        if (is_string($c['detail'] ?? null) && ($w = DwStudio::screenWords($c['detail'])) > DwReaction::DETAIL_WORDS) {
            $warn[] = "The banner is {$w} words (max " . DwReaction::DETAIL_WORDS . ').';
        }
        if (is_string($c['outro_question'] ?? null) && ($w = DwStudio::screenWords($c['outro_question'])) > DwReaction::QUESTION_WORDS) {
            $warn[] = "The question is {$w} words (max " . DwReaction::QUESTION_WORDS . ').';
        }
        $tags = $c['hashtags'] ?? null;
        if (!is_array($tags) || count($tags) < 5 || count($tags) > 8) {
            $warn[] = 'Use 5 to 8 hashtags.';
        }
        return [$errors, $warn];
    }

    /** The content as stored: values as numbers, texts trimmed, hashtags with #. Pure. */
    public static function normalize(array $c): array
    {
        $c['format'] = 'race';
        $c['series'] = array_map(static function ($s) {
            $values = [];
            foreach ($s['values'] ?? [] as $y => $v) {
                $values[(string) (int) $y] = round((float) $v, 2);
            }
            ksort($values);
            return ['country' => trim((string) $s['country']), 'flag' => trim((string) $s['flag']), 'values' => $values];
        }, array_values($c['series'] ?? []));
        foreach (['topic', 'headline', 'headline_accent', 'detail', 'value_label', 'data_years', 'source', 'source_url', 'unit', 'outro_question', 'cta_line', 'card_bg'] as $f) {
            if (isset($c[$f])) {
                $c[$f] = trim((string) $c[$f]);
            }
        }
        if (isset($c['banner_year'])) {
            $c['banner_year'] = $c['banner_year'] === null || $c['banner_year'] === '' ? null : (int) $c['banner_year'];
        }
        $c['hashtags'] = array_values(array_map(static fn($t) => '#' . ltrim(trim((string) $t), '#'), $c['hashtags'] ?? []));
        $c['warnings'] = array_values(array_map('strval', $c['warnings'] ?? []));
        return $c;
    }
}
