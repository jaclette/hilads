<?php

declare(strict_types=1);

/**
 * The "reaction + ranking" format of a Different Worlds topic (dw_topics.format
 * = 'reaction'): one 8 s screen, a short funny reaction clip (Pixabay, DwPixabay)
 * in the top third and a ranking of up to 20 countries from ONE source under it
 * (tools/promo/src/Reaction.jsx renders the video and a PNG).
 *
 * A package's content: {format: "reaction", topic, headline, detail?, rows: [{rank,
 * country, flag, value, unit}], source, source_url?, data_year, value_label?,
 * clip_query, clip?, caption, hashtags, outro_question, warnings?}. clip, once
 * chosen: {pixabay_id, url (our R2 copy), source_url, author, license, license_url,
 * ai_generated, duration}; an import gives {pixabay_id} only (the server looks it up).
 */
final class DwReaction
{
    public const FORMATS = ['slides', 'reaction'];
    public const MAX_ROWS = 20;
    public const VIDEO_SECONDS = 8;
    public const HEADLINE_WORDS = 6;
    public const DETAIL_WORDS = 8;

    /** A content in this format (its "format" or, older files, its rows). Pure. */
    public static function isReaction(array $c): bool
    {
        return ($c['format'] ?? null) === 'reaction';
    }

    /**
     * Checks a reaction content: [errors (block the import), warnings]. $highlight: the
     * countries always shown (dw_settings, Vietnam): a warning when one isn't ranked. Pure.
     */
    public static function validate(array $c, array $highlight = []): array
    {
        $errors = [];
        $warn = [];
        foreach (['topic', 'headline', 'source', 'clip_query', 'caption', 'outro_question'] as $f) {
            if (!is_string($c[$f] ?? null) || trim($c[$f]) === '') {
                $errors[] = "\"{$f}\" is missing.";
            }
        }
        $year = $c['data_year'] ?? null;
        if (!is_numeric($year) || (int) $year < 1950 || (int) $year > (int) gmdate('Y')) {
            $errors[] = '"data_year" must be the year of the data (e.g. 2024).';
        }
        if (isset($c['source_url']) && trim((string) $c['source_url']) !== '' && !preg_match('#^https?://\S+$#', trim((string) $c['source_url']))) {
            $errors[] = 'source_url is not a URL.';
        }
        if (is_string($c['headline'] ?? null) && ($w = DwStudio::screenWords($c['headline'])) > self::HEADLINE_WORDS) {
            $warn[] = "The headline is {$w} words (max " . self::HEADLINE_WORDS . ').';
        }
        if (is_string($c['detail'] ?? null) && ($w = DwStudio::screenWords($c['detail'])) > self::DETAIL_WORDS) {
            $warn[] = "The detail is {$w} words (max " . self::DETAIL_WORDS . ').';
        }
        [$rowErrors, $rowWarn] = self::checkRows($c['rows'] ?? null, $highlight);
        array_push($errors, ...$rowErrors);
        array_push($warn, ...$rowWarn);

        $clip = $c['clip'] ?? null;
        if ($clip !== null && (!is_array($clip) || (int) ($clip['pixabay_id'] ?? 0) <= 0)) {
            $errors[] = '"clip" must be {"pixabay_id": <the Pixabay video id>}.';
        }
        if (is_string($c['caption'] ?? null)) {
            if (DwStudio::words($c['caption']) > 150) {
                $warn[] = 'The caption is ' . DwStudio::words($c['caption']) . ' words (under 150).';
            }
            if (stripos($c['caption'], 'Different Worlds by Hilads') === false) {
                $warn[] = 'The caption does not mention "Different Worlds by Hilads".';
            }
        }
        if (is_string($c['outro_question'] ?? null) && DwStudio::words($c['outro_question']) > 12) {
            $warn[] = 'The outro question is ' . DwStudio::words($c['outro_question']) . ' words (max 12).';
        }
        $tags = $c['hashtags'] ?? null;
        if (!is_array($tags) || array_filter($tags, static fn($t) => !is_string($t) || trim($t) === '') !== []) {
            $errors[] = '"hashtags" must be a list of strings.';
        } elseif (count($tags) < 5 || count($tags) > 8) {
            $warn[] = count($tags) . ' hashtags (5 to 8).';
        }
        if (isset($c['warnings']) && !is_array($c['warnings'])) {
            $errors[] = '"warnings" must be a list.';
        }
        return [$errors, $warn];
    }

    /**
     * The ranking's rules: 1 to 20 rows ranked 1, 2, 3…, one unit, a value each, no country
     * twice; then at most one extra row further down (a highlighted country outside the
     * top, with its real rank). [errors, warnings]. Pure.
     */
    public static function checkRows(mixed $rows, array $highlight = []): array
    {
        $errors = [];
        $warn = [];
        if (!is_array($rows) || !array_is_list($rows) || $rows === []) {
            return [['"rows" must be a list of 1 to ' . self::MAX_ROWS . ' rows.'], []];
        }
        $units = [];
        $countries = [];
        $top = 0;
        foreach ($rows as $i => $r) {
            $n = $i + 1;
            if (!is_array($r)) {
                $errors[] = "Row {$n} is not an object.";
                continue;
            }
            $rank = $r['rank'] ?? null;
            $country = trim((string) ($r['country'] ?? ''));
            if (!is_int($rank) && !(is_string($rank) && ctype_digit($rank))) {
                $errors[] = "Row {$n}: \"rank\" must be a whole number.";
            } elseif ((int) $rank === $n && $top === $i) {
                $top = $n;
            } elseif ($i === count($rows) - 1 && $i === $top && (int) $rank > $top + 1) {
                // The extra row: its real rank, further down.
                if (!in_array(mb_strtolower($country), array_map('mb_strtolower', $highlight), true)) {
                    $warn[] = "Row {$n} ({$country}, #{$rank}) is outside the top {$top}: only a highlighted country (" . implode(', ', $highlight) . ') is added that way.';
                }
            } else {
                $errors[] = "Row {$n}: rank {$rank}, expected " . ($top + 1) . ' (the ranks go 1, 2, 3…; one extra row with a larger rank may end the list).';
            }
            if ($country === '') {
                $errors[] = "Row {$n}: \"country\" is missing.";
            }
            if (!is_string($r['flag'] ?? null) || trim($r['flag']) === '') {
                $errors[] = "Row {$n}: \"flag\" is missing.";
            } elseif (DwSlides::flagFile($r['flag']) === null) {
                $warn[] = "Row {$n}: no flag image for \"{$r['flag']}\".";
            }
            $value = $r['value'] ?? null;
            if (!(is_int($value) || is_float($value)) || $value < 0) {
                $errors[] = "Row {$n}: \"value\" must be a number (0 or more).";
            }
            $unit = trim((string) ($r['unit'] ?? ''));
            if ($unit === '') {
                $errors[] = "Row {$n}: \"unit\" is missing.";
            }
            $units[$unit] = true;
            $countries[] = mb_strtolower($country);
        }
        if ($top > self::MAX_ROWS) {
            $errors[] = 'At most ' . self::MAX_ROWS . " ranked rows ({$top}).";
        }
        if (count($units) > 1) {
            $errors[] = 'Every row needs the same unit (one source, one definition): ' . implode(', ', array_keys($units)) . '.';
        }
        if (count($countries) !== count(array_unique($countries))) {
            $errors[] = 'A country appears twice.';
        }
        if ($errors === []) {
            $values = array_map(static fn($r) => (float) $r['value'], array_slice($rows, 0, $top));
            $sorted = $values;
            rsort($sorted);
            if ($values !== $sorted) {
                $warn[] = 'The values are not in decreasing order: check the ranks.';
            }
            foreach ($highlight as $h) {
                if (!in_array(mb_strtolower(trim($h)), $countries, true)) {
                    $warn[] = "{$h} is not in the ranking: add its row with its real rank only if the same source ranks it.";
                }
            }
        }
        return [$errors, $warn];
    }

    /** The content as stored: rows typed, hashtags with #, warnings a list. Pure. */
    public static function normalize(array $c): array
    {
        $c['format'] = 'reaction';
        $c['rows'] = array_map(static fn($r) => [
            'rank' => (int) $r['rank'], 'country' => trim((string) $r['country']), 'flag' => trim((string) $r['flag']),
            'value' => round((float) $r['value'], 2), 'unit' => trim((string) $r['unit']),
        ], array_values($c['rows'] ?? []));
        $c['data_year'] = (int) ($c['data_year'] ?? 0);
        foreach (['headline', 'detail', 'source', 'source_url', 'value_label', 'clip_query', 'outro_question'] as $f) {
            if (isset($c[$f])) {
                $c[$f] = trim((string) $c[$f]);
            }
        }
        $c['hashtags'] = array_values(array_map(static fn($t) => '#' . ltrim(trim((string) $t), '#'), $c['hashtags'] ?? []));
        $c['warnings'] = array_values(array_map('strval', $c['warnings'] ?? []));
        return $c;
    }

    /** The line under the table: "<value_label>, <year> · Source: <source>". Pure. */
    public static function sourceLine(array $c): string
    {
        $label = trim((string) ($c['value_label'] ?? ''));
        $year = (int) ($c['data_year'] ?? 0);
        $first = trim($label . ($year > 0 ? ($label !== '' ? ', ' : '') . $year : ''));
        return ($first !== '' ? $first . ' · ' : '') . 'Source: ' . trim((string) ($c['source'] ?? ''));
    }

    /** The clip's credit on the screen: "Video: author / Pixabay". Pure. */
    public static function clipCredit(?array $clip): string
    {
        return $clip !== null && trim((string) ($clip['author'] ?? '')) !== '' ? 'Video: ' . trim($clip['author']) . ' / Pixabay' : '';
    }

    /** The stored clip of a Pixabay video, once copied to R2. Pure. */
    public static function clipOf(array $hit, string $r2Url): array
    {
        return [
            'pixabay_id' => $hit['id'], 'url' => $r2Url, 'source_url' => $hit['page'], 'author' => $hit['author'],
            'license' => DwPixabay::LICENSE, 'license_url' => DwPixabay::LICENSE_URL,
            'ai_generated' => $hit['ai'], 'duration' => $hit['duration'],
        ];
    }
}
