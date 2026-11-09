<?php

declare(strict_types=1);

/**
 * The "reaction + ranking" format of a Different Worlds topic (dw_topics.format
 * = 'reaction'): one 8 s screen, a short funny reaction clip (Pixabay, DwPixabay)
 * in the top half and a ranking from ONE source under it (the video shows the top 10)
 * (tools/promo/src/Reaction.jsx renders the video and a PNG).
 *
 * A package's content: {format: "reaction", topic, headline, detail?, rows: [{rank,
 * country, flag, value, unit ("$": a price, shown $9.04), gap_before? (a "…" separator above, the ranking
 * skips to this row), highlight? (this row in the accent color too, e.g. a reference country)}], source, source_url?, data_year, data_years? (a range when the latest
 * year differs by country, e.g. "2010s"), value_format? ("ratio": 4.0, 8.9, 45; "one_decimal": 52.0), value_label?,
 * clip_query, clip?, caption, hashtags, outro_question, card_bg? (the ranking card's color: a CARD_THEMES name or a
 * light #rrggbb, cream by default), headline_accent? (words of the headline drawn in terracotta), warnings?}. clip, once
 * chosen: {pixabay_id, url (our R2 copy), source_url, author, license, license_url,
 * ai_generated, duration}; an import gives {pixabay_id} only (the server looks it up).
 */
final class DwReaction
{
    public const FORMATS = ['slides', 'reaction'];
    public const MAX_ROWS = 20;
    public const VIDEO_SECONDS = 12.5;   // the ranking 10 s, the end card 2.5 s
    /** The video shows the first 10 rows (the podium + #4 to #10), "Top 10" in its source line when there are more. */
    public const SHOWN_ROWS = 10;
    public const HEADLINE_WORDS = 6;
    public const DETAIL_WORDS = 8;
    /** The question: the caption's last line (the video's end card asks "What's YOUR country's answer?"). */
    public const QUESTION_WORDS = 7;
    /** The ranking card's colors by name (tools/promo/src/Reaction.jsx: CARD_THEMES); any light #rrggbb works too. */
    public const CARD_THEMES = ['cream', 'yellow', 'green', 'pink', 'blue'];

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
        if (isset($c['data_years']) && (!is_string($c['data_years']) || mb_strlen(trim($c['data_years'])) > 60)) {
            $errors[] = '"data_years" is the years of the data as text, e.g. "2015–2018", "2010s" or "2019, last year before the pandemic" (60 characters at most).';
        }
        if (isset($c['value_format']) && !in_array($c['value_format'], ['ratio', 'one_decimal'], true)) {
            $errors[] = '"value_format" is "ratio" (one decimal below 10, whole numbers from 10), "one_decimal" (always one: 52.0) or absent (as given).';
        }
        if (isset($c['card_bg']) && !self::cardBgOk($c['card_bg'])) {
            $errors[] = '"card_bg" is ' . implode(', ', self::CARD_THEMES) . ' or a light color as #rrggbb (the text stays dark on it).';
        }
        if (isset($c['headline_accent']) && trim((string) $c['headline_accent']) !== ''
            && (!is_string($c['headline_accent']) || !is_string($c['headline'] ?? null)
                || mb_stripos($c['headline'], trim($c['headline_accent'])) === false)) {
            $errors[] = '"headline_accent" must be words of the headline (they are drawn in terracotta).';
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
        if (is_array($c['rows'] ?? null) && count($c['rows']) > self::SHOWN_ROWS) {
            $rowWarn[] = count($c['rows']) . ' rows: the video shows the top ' . self::SHOWN_ROWS . ' ("Top ' . self::SHOWN_ROWS . '" in its source line); the others are for the caption only.';
        }
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
        if (is_string($c['outro_question'] ?? null) && ($w = DwStudio::screenWords($c['outro_question'])) > self::QUESTION_WORDS) {
            $warn[] = "The question is {$w} words (max " . self::QUESTION_WORDS . ': the caption\'s last line).';
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
     * The ranking's rules: 1 to 20 rows ranked 1, 2, 3… (equal values share the rank above), one unit, a value each, no country
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
        $group = 0;         // the current rank
        $same = 0;          // rows with it so far
        $next = 1;          // the rank a new row takes: $group + $same (competition ranking: 6, 6, 8…)
        $lastJump = false;  // the last row is an extra one further down (no separator)
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
            } elseif ($i > 0 && self::tiesWith($r, $rows[$i - 1])) {
                $same++;    // the rank of the row above, both values equal (a shared rank: 6, 6, 6, 9…)
            } elseif ((int) $rank === $next || ((int) $rank > $next && $i > 0 && !empty($r['gap_before']))) {
                // 1, 2, 3…, or further down after a "…" separator (gap_before: the cheapest ones under the dearest).
                [$group, $same] = [(int) $rank, 1];
            } elseif ($i === count($rows) - 1 && (int) $rank > $next) {
                // The extra row: its real rank, further down.
                $lastJump = true;
                if (empty($r['highlight']) && !in_array(mb_strtolower($country), array_map('mb_strtolower', $highlight), true)) {
                    $warn[] = "Row {$n} ({$country}, #{$rank}) is outside the top " . ($next - 1) . ': only a highlighted country (' . implode(', ', $highlight) . ') is added that way.';
                }
            } else {
                $errors[] = "Row {$n}: rank {$rank}, expected {$next} (the ranks go 1, 2, 3…; a row further down needs \"gap_before\" (a \"…\" separator above it), or is one extra last row).";
            }
            $next = $group + $same;
            if ($i === 0 && !empty($r['gap_before'])) {
                $errors[] = 'Row 1 cannot have a "…" separator above it.';
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
        if (count($rows) - ($lastJump ? 1 : 0) > self::MAX_ROWS) {
            $errors[] = 'At most ' . self::MAX_ROWS . ' rows (' . count($rows) . '), plus one extra last row.';
        }
        if (count($units) > 1) {
            $errors[] = 'Every row needs the same unit (one source, one definition): ' . implode(', ', array_keys($units)) . '.';
        }
        if (count($countries) !== count(array_unique($countries))) {
            $errors[] = 'A country appears twice.';
        }
        if ($errors === []) {
            $values = array_map(static fn($r) => (float) $r['value'], array_slice($rows, 0, count($rows) - ($lastJump ? 1 : 0)));
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

    /** A row tied with the one above: the same rank and the same value. Pure. */
    private static function tiesWith(array $row, mixed $above): bool
    {
        return is_array($above) && is_numeric($row['rank'] ?? null) && is_numeric($above['rank'] ?? null)
            && (int) $row['rank'] === (int) $above['rank'] && is_numeric($row['value'] ?? null) && is_numeric($above['value'] ?? null)
            && (float) $row['value'] === (float) $above['value'];
    }

    /** A card color: a CARD_THEMES name or a light #rrggbb (as Reaction.jsx cardColor: luminance 0.6 or more). Pure. */
    public static function cardBgOk(mixed $bg): bool
    {
        $v = strtolower(trim((string) (is_string($bg) ? $bg : '')));
        if (in_array($v, self::CARD_THEMES, true)) {
            return true;
        }
        if (!preg_match('/^#[0-9a-f]{6}$/', $v)) {
            return false;
        }
        [$r, $g, $b] = array_map('hexdec', str_split(substr($v, 1), 2));
        return (0.299 * $r + 0.587 * $g + 0.114 * $b) / 255 >= 0.6;
    }

    /** The content as stored: rows typed, hashtags with #, warnings a list. Pure. */
    public static function normalize(array $c): array
    {
        $c['format'] = 'reaction';
        $c['rows'] = array_map(static fn($r) => [
            'rank' => (int) $r['rank'], 'country' => trim((string) $r['country']), 'flag' => trim((string) $r['flag']),
            'value' => round((float) $r['value'], 2), 'unit' => trim((string) $r['unit']),
        ] + (!empty($r['gap_before']) ? ['gap_before' => true] : []) + (!empty($r['highlight']) ? ['highlight' => true] : []),
            array_values($c['rows'] ?? []));
        $c['data_year'] = (int) ($c['data_year'] ?? 0);
        foreach (['headline', 'detail', 'source', 'source_url', 'value_label', 'data_years', 'value_format', 'clip_query', 'outro_question', 'card_bg', 'headline_accent'] as $f) {
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
        // data_years: the range when the source's latest year differs by country ("2015–2018"), else data_year.
        $year = trim((string) ($c['data_years'] ?? '')) ?: ((int) ($c['data_year'] ?? 0) > 0 ? (string) (int) $c['data_year'] : '');
        $first = trim($label . ($year !== '' ? ($label !== '' ? ', ' : '') . $year : ''));
        $source = trim((string) ($c['source'] ?? ''));
        // "Sources:" for more than one (an approved exception, e.g. "UN Tourism, UN World Population Prospects").
        return ($first !== '' ? $first . ' · ' : '') . (str_contains($source, ', ') ? 'Sources: ' : 'Source: ') . $source;
    }

    /**
     * The clip's credit on the screen: "Video: author / Pixabay"; none for our own uploaded clip
     * (its credit stays in the admin, and an AI one is labelled on each platform when publishing). Pure.
     */
    public static function clipCredit(?array $clip): string
    {
        if (($clip['source'] ?? null) === 'upload') {
            return '';
        }
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
