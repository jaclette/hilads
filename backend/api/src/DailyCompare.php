<?php

declare(strict_types=1);

/**
 * The comparison question (SPEC 10.2) and Back home (SPEC 10.4).
 *
 * A challenge carries one question whose short answer differs from city to
 * city: daily_challenges.compare_type (word, text, number, time),
 * compare_question_i18n and compare_unit_i18n (numbers only), stored like the
 * challenge text ({"en", "fr", ..., "_src"}).
 *
 * A proof's answer: answer_text (word, text), answer_number or answer_minutes
 * (time of day, rounded to 30 minutes). The answer is required to post a proof
 * of a challenge with a question, but only from apps that send "X-Compare: 1":
 * the store builds from before V4 keep posting without one.
 *
 * Back home: the same question for the poster's home city, with an optional
 * price in the home currency and one optional line (home_* columns, the city
 * copied at posting time). Answers are never translated: that is the point.
 */
final class DailyCompare
{
    /** type => max characters (text types) or null. */
    public const TYPES = ['word' => 30, 'text' => 80, 'number' => null, 'time' => null];

    public const QUESTION_MAX    = 60;   // English
    public const QUESTION_TR_MAX = 90;   // other locales
    public const UNIT_MAX        = 20;
    public const UNIT_TR_MAX     = 30;
    public const HOME_LINE_MAX   = 80;
    public const NUMBER_MAX      = 1_000_000_000;
    public const CITY_NAME_MAX   = 60;

    // ── The question (back office, import) ───────────────────────────────────

    /**
     * Validated question from a form or an import: {"type", "unit", "question"}
     * where question and unit are a string (English) or {locale: text}, "en"
     * required. Returns null for an absent question, else
     * {type, question: {en, ...}, unit: {en, ...}|null}. Throws
     * InvalidArgumentException ("<label>: ...").
     */
    public static function cleanQuestion(mixed $in, string $label = 'compare'): ?array
    {
        if ($in === null) {
            return null;
        }
        if (!is_array($in)) {
            throw new InvalidArgumentException("{$label}: must be an object with type and question.");
        }
        $type = is_string($in['type'] ?? null) ? strtolower(trim($in['type'])) : '';
        if (!array_key_exists($type, self::TYPES)) {
            throw new InvalidArgumentException("{$label}: type is word, text, number or time.");
        }
        $question = self::i18nField($in['question'] ?? null, self::QUESTION_MAX, self::QUESTION_TR_MAX, "{$label}: question");
        if ($question === null) {
            throw new InvalidArgumentException("{$label}: question.en is required.");
        }
        $unit = $type === 'number'
            ? self::i18nField($in['unit'] ?? null, self::UNIT_MAX, self::UNIT_TR_MAX, "{$label}: unit")
            : null;
        return ['type' => $type, 'question' => $question, 'unit' => $unit];
    }

    /** A string (English) or {locale: text} as a stored i18n map, or null when there is no English. */
    private static function i18nField(mixed $v, int $max, int $trMax, string $label): ?array
    {
        $map = is_string($v) ? ['en' => $v] : (is_array($v) ? $v : []);
        $en  = is_string($map['en'] ?? null) ? trim((string) preg_replace('/\s+/u', ' ', $map['en'])) : '';
        if ($en === '') {
            return null;
        }
        if (mb_strlen($en) > $max) {
            throw new InvalidArgumentException("{$label} (en) is longer than {$max} characters.");
        }
        if (ModerationService::check($en) !== null) {
            throw new InvalidArgumentException("{$label} (en) was flagged by the text filter.");
        }
        return DailyI18n::merge([], $en, DailyI18n::clean($map, $trMax, $label));
    }

    /** Columns of a cleaned question (null = no question). */
    public static function columns(?array $q): array
    {
        return [
            'compare_type'          => $q['type'] ?? null,
            'compare_question_i18n' => $q !== null ? json_encode($q['question'], JSON_UNESCAPED_UNICODE) : null,
            'compare_unit_i18n'     => ($q['unit'] ?? null) !== null ? json_encode($q['unit'], JSON_UNESCAPED_UNICODE) : null,
        ];
    }

    /**
     * Challenge payload {type, question, unit, original}: question and unit in
     * $locale (English fallback), original = the English question when a
     * translation is shown. Null without a question.
     */
    public static function payload(array $row, string $locale): ?array
    {
        $type = $row['compare_type'] ?? null;
        if (!is_string($type) || !array_key_exists($type, self::TYPES)) {
            return null;
        }
        $q  = self::decode($row['compare_question_i18n'] ?? null);
        $en = (string) ($q['en'] ?? '');
        if ($en === '') {
            return null;
        }
        [$text, $original] = DailyI18n::localize($q, $en, $locale);
        return [
            'type'     => $type,
            'question' => $text,
            'unit'     => self::unitIn($row['compare_unit_i18n'] ?? null, $locale),
            'original' => $original,
            'maxLength' => self::TYPES[$type],
        ];
    }

    // ── Answers (proofs) ─────────────────────────────────────────────────────

    /**
     * One answer of $type: a string (word, text), an integer (number), "HH:MM"
     * or minutes since midnight (time). Returns [text, number, minutes] with
     * one value set, or null when invalid. Pure.
     */
    public static function cleanAnswer(string $type, mixed $raw): ?array
    {
        switch ($type) {
            case 'word':
            case 'text':
                if (!is_string($raw)) {
                    return null;
                }
                $v = trim((string) preg_replace('/\s+/u', ' ', $raw));
                return $v !== '' && mb_strlen($v) <= self::TYPES[$type] ? [$v, null, null] : null;
            case 'number':
                if (is_string($raw) && preg_match('/^\s*\d+\s*$/', $raw)) {
                    $raw = (int) trim($raw);
                }
                if (is_float($raw) && floor($raw) === $raw) {
                    $raw = (int) $raw;
                }
                return is_int($raw) && $raw >= 0 && $raw <= self::NUMBER_MAX ? [null, $raw, null] : null;
            case 'time':
                $m = self::parseTime($raw);
                return $m === null ? null : [null, null, self::roundTime($m)];
        }
        return null;
    }

    /** Minutes since midnight from "HH:MM" (0-23, 0-59) or an integer 0..1439, else null. Pure. */
    public static function parseTime(mixed $raw): ?int
    {
        if (is_int($raw)) {
            return $raw >= 0 && $raw < 1440 ? $raw : null;
        }
        if (is_string($raw) && preg_match('/^\s*(\d{1,2}):(\d{2})\s*$/', $raw, $m)) {
            $h = (int) $m[1];
            $i = (int) $m[2];
            return $h < 24 && $i < 60 ? $h * 60 + $i : null;
        }
        return null;
    }

    /** Rounded to the nearest 30 minutes, 23:45 and later wrapping to 00:00. Pure. */
    public static function roundTime(int $minutes): int
    {
        return ((int) round($minutes / 30) * 30) % 1440;
    }

    /** "19:30" from minutes since midnight. Pure. */
    public static function formatTime(int $minutes): string
    {
        return sprintf('%02d:%02d', intdiv($minutes, 60), $minutes % 60);
    }

    /**
     * Answer and Back home fields of a proof body, for a challenge whose
     * question is $type (null: no question, the answer is ignored).
     * Returns [fields, null] or [[], errorCode]: invalid_answer,
     * invalid_back_home. Absent keys are left out (edit); null clears.
     * Pure apart from the city lookup.
     */
    public static function validateProofInput(array $body, ?string $type, ?callable $findCity = null): array
    {
        $out = [];
        if ($type !== null && array_key_exists('answer', $body)) {
            if ($body['answer'] === null) {
                [$out['answer_text'], $out['answer_number'], $out['answer_minutes']] = [null, null, null];
            } else {
                $a = self::cleanAnswer($type, $body['answer']);
                if ($a === null) {
                    return [[], 'invalid_answer'];
                }
                [$out['answer_text'], $out['answer_number'], $out['answer_minutes']] = $a;
            }
        }

        if (array_key_exists('backHome', $body)) {
            $b = $body['backHome'];
            $home = [
                'home_city_id' => null, 'home_city_name' => null, 'home_country' => null,
                'home_answer_text' => null, 'home_answer_number' => null, 'home_answer_minutes' => null,
                'home_price_amount' => null, 'home_price_currency' => null, 'home_line' => null,
            ];
            if ($b !== null) {
                if (!is_array($b)) {
                    return [[], 'invalid_back_home'];
                }
                $city = self::cleanCity($b['city'] ?? null, $findCity);
                if ($city === null) {
                    return [[], 'invalid_back_home'];
                }
                [$home['home_city_id'], $home['home_city_name'], $home['home_country']] = $city;

                if ($type !== null && ($b['answer'] ?? null) !== null) {
                    $a = self::cleanAnswer($type, $b['answer']);
                    if ($a === null) {
                        return [[], 'invalid_back_home'];
                    }
                    [$home['home_answer_text'], $home['home_answer_number'], $home['home_answer_minutes']] = $a;
                }
                if (($b['price'] ?? null) !== null) {
                    $p        = $b['price'];
                    $amount   = is_array($p) ? ($p['amount'] ?? null) : null;
                    $currency = is_array($p) ? strtoupper(trim((string) ($p['currency'] ?? ''))) : '';
                    if (!is_numeric($amount) || (float) $amount < 0 || (float) $amount > 1e12 || !Currencies::isCode($currency)) {
                        return [[], 'invalid_back_home'];
                    }
                    $home['home_price_amount']   = round((float) $amount, 2);
                    $home['home_price_currency'] = $currency;
                }
                if (($b['line'] ?? null) !== null) {
                    if (!is_string($b['line'])) {
                        return [[], 'invalid_back_home'];
                    }
                    $line = trim((string) preg_replace('/\s+/u', ' ', $b['line']));
                    if (mb_strlen($line) > self::HOME_LINE_MAX) {
                        return [[], 'invalid_back_home'];
                    }
                    $home['home_line'] = $line === '' ? null : $line;
                }
                if ($home['home_answer_text'] === null && $home['home_answer_number'] === null && $home['home_answer_minutes'] === null
                    && $home['home_price_amount'] === null && $home['home_line'] === null) {
                    return [[], 'invalid_back_home'];   // a city alone says nothing
                }
            }
            $out += $home;
        }
        return [$out, null];
    }

    /**
     * A home city: {id} (one of our cities) or {name, country} (anywhere).
     * Returns [cityId|null, name, country] or null. $findCity(int) returns
     * the city row {name, country} or null.
     */
    public static function cleanCity(mixed $c, ?callable $findCity): ?array
    {
        if (!is_array($c)) {
            return null;
        }
        if (isset($c['id'])) {
            $id  = filter_var($c['id'], FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
            $row = $id !== false && $findCity !== null ? $findCity($id) : null;
            return $row !== null ? ['city_' . $id, (string) $row['name'], strtoupper((string) $row['country'])] : null;
        }
        $name    = is_string($c['name'] ?? null) ? trim(strip_tags($c['name'])) : '';
        $country = is_string($c['country'] ?? null) ? strtoupper(trim($c['country'])) : '';
        if ($name === '' || mb_strlen($name) > self::CITY_NAME_MAX || !preg_match('/^[A-Z]{2}$/', $country)) {
            return null;
        }
        return [null, $name, $country];
    }

    /** True when the app sends "X-Compare: 1" (it asks the question, so the answer can be required). */
    public static function clientSupports(): bool
    {
        return trim((string) ($_SERVER['HTTP_X_COMPARE'] ?? '')) === '1';
    }

    /** True when a fields set (create) has an answer. */
    public static function hasAnswer(array $fields): bool
    {
        return ($fields['answer_text'] ?? null) !== null || ($fields['answer_number'] ?? null) !== null
            || ($fields['answer_minutes'] ?? null) !== null;
    }

    /**
     * The first Back home sets the user's home city (asked once, then
     * remembered); an existing one is never overwritten from a proof. Best effort.
     */
    public static function rememberHomeCity(string $userId, array $fields): void
    {
        if (($fields['home_country'] ?? null) === null) {
            return;
        }
        try {
            Database::pdo()->prepare("
                UPDATE users SET home_city_id = ?, home_city_name = ?, home_country = ?
                WHERE id = ? AND home_city_id IS NULL AND home_country IS NULL
            ")->execute([$fields['home_city_id'], $fields['home_city_name'], $fields['home_country'], $userId]);
        } catch (\Throwable $e) {
            error_log('[daily] home city not saved: ' . $e->getMessage());
        }
    }

    // ── Proof payload ────────────────────────────────────────────────────────

    /** {type, value, unit} of an answer, or null. value: a string (word, text, "19:30") or an integer. */
    public static function answerPayload(?string $type, mixed $text, mixed $number, mixed $minutes, mixed $unitI18n, string $locale): ?array
    {
        if ($type === null) {
            return null;
        }
        $value = match ($type) {
            'word', 'text' => $text !== null ? (string) $text : null,
            'number'       => $number !== null ? (int) $number : null,
            'time'         => $minutes !== null ? self::formatTime((int) $minutes) : null,
            default        => null,
        };
        if ($value === null) {
            return null;
        }
        return ['type' => $type, 'value' => $value, 'unit' => $type === 'number' ? self::unitIn($unitI18n, $locale) : null];
    }

    /** {answer, backHome} of a proof row (joined with its challenge's compare_type and compare_unit_i18n). */
    public static function proofPayload(array $row, string $locale): array
    {
        $type   = $row['compare_type'] ?? null;
        $unit   = $row['compare_unit_i18n'] ?? null;
        $answer = self::answerPayload($type, $row['answer_text'] ?? null, $row['answer_number'] ?? null, $row['answer_minutes'] ?? null, $unit, $locale);

        $home = null;
        if (($row['home_city_name'] ?? null) !== null) {
            $amount = $row['home_price_amount'] ?? null;
            $home = [
                'city'   => [
                    'id'      => ($row['home_city_id'] ?? null) !== null ? (int) substr((string) $row['home_city_id'], 5) : null,
                    'name'    => $row['home_city_name'],
                    'country' => $row['home_country'] !== null ? trim((string) $row['home_country']) : null,
                ],
                'answer' => self::answerPayload($type, $row['home_answer_text'] ?? null, $row['home_answer_number'] ?? null, $row['home_answer_minutes'] ?? null, $unit, $locale),
                'price'  => $amount !== null ? self::price((float) $amount, (string) $row['home_price_currency']) : null,
                'line'   => $row['home_line'] ?? null,
            ];
        }
        return ['answer' => $answer, 'backHome' => $home];
    }

    /** A price payload {amount, currency, eur}: eur = the amount in EUR (the base), null without rates. */
    public static function price(float $amount, string $currency): array
    {
        $currency = trim($currency);
        return ['amount' => $amount, 'currency' => $currency, 'eur' => Currencies::toBase($amount, $currency)];
    }

    private static function unitIn(mixed $i18n, string $locale): ?string
    {
        $u  = self::decode($i18n);
        $en = (string) ($u['en'] ?? '');
        return $en === '' ? null : (DailyI18n::pick($u, $locale) ?? $en);
    }

    private static function decode(mixed $v): array
    {
        return is_array($v) ? $v : (is_string($v) ? (json_decode($v, true) ?: []) : []);
    }
}
