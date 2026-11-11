<?php

declare(strict_types=1);

/**
 * "Different Worlds by Hilads", race format (dw_topics.format 'race'): a bar chart race over the years from ONE source
 * and one definition, no clip (tools/promo/src/Reaction.jsx RaceVideo renders it): no hook (the headline in its header,
 * the year big under it with a timeline), the top 10 of each
 * year (0.7 s a year, smooth overtakes), a pop banner at the striking year, a 2 s freeze on the last year (the crown on
 * #1), the closing slide (the question, the cta_line button). PNGs: 01 the first year, 02 the final ranking, 03 the
 * closing slide.
 *
 * A package's content: {format: "race", topic, headline, headline_accent?, detail? (the banner), banner_year?, series:
 * [{country, flag (emoji), values: {"2000": 77.2, …}, ranks?: {"2000": 1, …}}] (every country with a value for every year), unit? ("M"),
 * decimals? (0: whole numbers, default 1), extra_row? (a country of the series shown under the top 10, its real rank each
 * year from its ranks, e.g. Vietnam), year_labels? ({"2022": "2022/23"}: an edition's label), step_seconds? (a year's step,
 * 0.7 by default; few editions: 2.5), start_seconds? (0.6), hold? (the share of a step held still after its move, 0 to 0.8),
 * value_label, data_years, source, source_url?, outro_question, cta_line, card_bg?, highlight? [country], caption,
 * hashtags, warnings?}. Count races: value_prefix? ("👑 x", before each value), slow_from? + slow_step? (the years from
 * slow_from go at slow_step: fast early decades), a series' order? ({"2009": 1, …}: its place among tied values at a year).
 * Pace: year_step? (one year out of N, always with the last), hold_first? (each step holds still `hold` of its length,
 * then moves), freeze_seconds? (2 by default), bar_scale? ('step': each year's bars start just below its top 10's lowest
 * value, the source line says so; 'zero' by default).
 */
final class DwRace
{
    public const MIN_YEARS = 4;
    public const MAX_YEARS = 80;
    public const SHOWN = 10;
    public const START = 0.6;          // tools/promo/src/reactionTiming.js RACE (no hook: the race starts right away)
    public const PER_YEAR = 0.7;
    public const FREEZE = 2.0;
    public const CLOSING = 3.0;
    public const HEADLINE_WORDS = 9;
    /** The pace fields an editor can change on a race (DwStudio::updateField), typed by paceValue(). */
    public const PACE_FIELDS = ['year_step', 'hold_first', 'step_seconds', 'hold', 'freeze_seconds', 'bar_scale', 'slow_from', 'slow_step'];
    public const BAR_SCALES = ['zero', 'step'];

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

    /** The years the video shows: one out of year_step from the first, always with the last (worlds.mjs). Pure. */
    public static function shownYears(array $c): array
    {
        $years = self::years($c);
        $every = max(1, (int) ($c['year_step'] ?? 1));
        return array_values(array_filter($years, static fn($y, $i) => $i % $every === 0 || $i === count($years) - 1, ARRAY_FILTER_USE_BOTH));
    }

    /** A pace field from the editor's text, typed (null: back to the default). Throws when out of range. */
    public static function paceValue(string $field, string $value): mixed
    {
        $value = trim($value);
        if ($value === '') {
            return null;
        }
        if ($field === 'hold_first') {
            return in_array(strtolower($value), ['1', 'true', 'yes', 'on'], true);
        }
        if ($field === 'bar_scale') {
            if (!in_array($value, self::BAR_SCALES, true)) {
                throw new InvalidArgumentException('The bar scale: zero, or step (each year\'s bars start just below its top 10).');
            }
            return $value;
        }
        if (!is_numeric($value)) {
            throw new InvalidArgumentException("\"{$field}\" is a number.");
        }
        return in_array($field, ['year_step', 'slow_from'], true) ? (int) $value : (float) $value;
    }

    /** The video's length (seconds). Pure. */
    public static function videoSeconds(array $c): float
    {
        $start = (float) ($c['start_seconds'] ?? self::START);
        $step = (float) ($c['step_seconds'] ?? self::PER_YEAR);
        $slowFrom = isset($c['slow_from']) && $c['slow_from'] !== null ? (int) $c['slow_from'] : null;
        $slowStep = (float) ($c['slow_step'] ?? $step);
        $total = $start;
        foreach (array_slice(self::shownYears($c), 1) as $y) {   // a step ends at year $y (reactionTiming.js raceSteps)
            $total += $slowFrom !== null && $y >= $slowFrom ? $slowStep : $step;
        }
        return $total + (float) ($c['freeze_seconds'] ?? self::FREEZE) + self::CLOSING;
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
        $extra = mb_strtolower(trim((string) ($c['extra_row'] ?? '')));
        if ($extra !== '' && is_array($series) && !in_array($extra, array_map(static fn($s) => mb_strtolower(trim((string) ($s['country'] ?? ''))), $series), true)) {
            $errors[] = '"extra_row" must be one of the series\' countries.';
        }
        if (!is_array($series) || !array_is_list($series) || count($series) - ($extra !== '' ? 1 : 0) < self::SHOWN) {
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
        foreach (['step_seconds' => [0.25, 4], 'slow_step' => [0.25, 4], 'start_seconds' => [0.3, 4], 'hold' => [0, 0.8]] as $f => [$lo, $hi]) {
            if (isset($c[$f]) && (!is_numeric($c[$f]) || (float) $c[$f] < $lo || (float) $c[$f] > $hi)) {
                $errors[] = "\"{$f}\" is a number from {$lo} to {$hi}.";
            }
        }
        foreach (['year_step' => [1, 5], 'freeze_seconds' => [1, 5]] as $f => [$lo, $hi]) {
            if (isset($c[$f]) && (!is_numeric($c[$f]) || (float) $c[$f] < $lo || (float) $c[$f] > $hi)) {
                $errors[] = "\"{$f}\" is a number from {$lo} to {$hi}.";
            }
        }
        if (isset($c['bar_scale']) && !in_array($c['bar_scale'], self::BAR_SCALES, true)) {
            $errors[] = '"bar_scale" is "zero" or "step".';
        }
        if (isset($c['hold_first']) && !is_bool($c['hold_first'])) {
            $errors[] = '"hold_first" is true or false.';
        }
        if (isset($c['banner_year'], $c['year_step']) && $c['banner_year'] !== null && !in_array((int) $c['banner_year'], self::shownYears($c), true)) {
            $errors[] = '"banner_year" must be one of the years shown (year_step ' . (int) $c['year_step'] . ').';
        }
        if (isset($c['slow_from']) && $c['slow_from'] !== null && !in_array((int) $c['slow_from'], $years, true)) {
            $errors[] = '"slow_from" must be one of the race\'s years (the years from it go at slow_step).';
        }
        if (isset($c['value_prefix']) && mb_strlen((string) $c['value_prefix']) > 6) {
            $errors[] = '"value_prefix" is a short text before each value (6 characters at most, e.g. "👑 x").';
        }
        if (isset($c['year_labels']) && (!is_array($c['year_labels']) || array_diff(array_map('intval', array_keys($c['year_labels'])), $years) !== [])) {
            $errors[] = '"year_labels" maps the race\'s years to their labels (e.g. {"2022": "2022/23"}).';
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
            $ranks = [];
            foreach (is_array($s['ranks'] ?? null) ? $s['ranks'] : [] as $y => $r) {
                $ranks[(string) (int) $y] = (int) $r;
            }
            ksort($ranks);
            $order = [];
            foreach (is_array($s['order'] ?? null) ? $s['order'] : [] as $y => $o) {
                $order[(string) (int) $y] = (int) $o;
            }
            ksort($order);
            return ['country' => trim((string) $s['country']), 'flag' => trim((string) $s['flag']), 'values' => $values]
                + ($ranks ? ['ranks' => $ranks] : []) + ($order ? ['order' => $order] : []);
        }, array_values($c['series'] ?? []));
        foreach (['year_step'] as $f) {
            if (isset($c[$f])) {
                $c[$f] = (int) $c[$f];
            }
        }
        if (isset($c['hold_first'])) {
            $c['hold_first'] = (bool) $c['hold_first'];
        }
        foreach (['step_seconds', 'slow_step', 'start_seconds', 'hold', 'freeze_seconds'] as $f) {
            if (isset($c[$f])) {
                $c[$f] = (float) $c[$f];
            }
        }
        if (isset($c['year_labels']) && is_array($c['year_labels'])) {
            $c['year_labels'] = array_map(static fn($l) => trim((string) $l), $c['year_labels']);
        }
        if (isset($c['decimals'])) {
            $c['decimals'] = max(0, min(2, (int) $c['decimals']));
        }
        foreach (['extra_row', 'topic', 'headline', 'headline_accent', 'detail', 'value_label', 'data_years', 'source', 'source_url', 'unit', 'outro_question', 'cta_line', 'card_bg'] as $f) {
            if (isset($c[$f])) {
                $c[$f] = trim((string) $c[$f]);
            }
        }
        if (array_key_exists('slow_from', $c)) {
            $c['slow_from'] = $c['slow_from'] === null || $c['slow_from'] === '' ? null : (int) $c['slow_from'];
        }
        if (isset($c['value_prefix'])) {
            $c['value_prefix'] = (string) $c['value_prefix'];   // kept as is: "👑 x" ends without a space
        }
        if (isset($c['banner_year'])) {
            $c['banner_year'] = $c['banner_year'] === null || $c['banner_year'] === '' ? null : (int) $c['banner_year'];
        }
        $c['hashtags'] = array_values(array_map(static fn($t) => '#' . ltrim(trim((string) $t), '#'), $c['hashtags'] ?? []));
        $c['warnings'] = array_values(array_map('strval', $c['warnings'] ?? []));
        return $c;
    }
}
