<?php

declare(strict_types=1);

/**
 * Daily Challenge translations as a file, for a translation pass
 * (docs/daily-challenge/TRANSLATION.md): export today's and the upcoming
 * challenges with every translatable field, then import the file back
 * "translations only".
 *
 * The import never touches the English, a date, a theme or a status, so it is
 * safe on today's challenge and on published days (unlike the challenge
 * import, which skips them). A field is skipped when its English changed
 * since the export (the translation would be for another text). Locales absent
 * from the file keep their stored translation.
 */
final class DailyTranslations
{
    /** File field => [column, max characters of a translation, stamps _src]. */
    public const FIELDS = [
        'text'                => ['text_i18n', DailyAdminService::TEXT_MAX, true],
        'context'             => ['context_i18n', DailyAdminService::CONTEXT_MAX, true],
        'headline'            => ['headline_i18n', DailyAdminService::HEADLINE_MAX, false],
        'subtitle'            => ['subtitle_i18n', DailyAdminService::SUBTITLE_MAX, false],
        'shareQuestion'       => ['share_question_i18n', DailyAdminService::SHARE_QUESTION_MAX, false],
        'compareQuestion'     => ['compare_question_i18n', DailyCompare::QUESTION_TR_MAX, true],
        'compareUnit'         => ['compare_unit_i18n', DailyCompare::UNIT_TR_MAX, true],
        'compareTitle'        => ['compare_title_i18n', DailyCompare::QUESTION_TR_MAX, true],
        'priceLabel'          => ['price_label_i18n', DailyCompare::LABEL_TR_MAX, true],
    ];

    /**
     * Today's challenge and the next $days days: {challenges: [{date, theme,
     * status, <field>: {en, fr, …}, twists: [{id, city, text: {en, …}}]}]}.
     */
    public static function export(int $days = 21): array
    {
        $today = DailyClock::currentDate();
        $cols  = implode(', ', array_map(static fn(array $f) => $f[0], self::FIELDS));
        $stmt  = Database::pdo()->prepare("
            SELECT id, challenge_date::text AS date, theme, status, {$cols}
            FROM daily_challenges
            WHERE challenge_date BETWEEN ?::date AND ?::date + ?::int
            ORDER BY challenge_date
        ");
        $stmt->execute([$today, $today, $days]);
        $out = [];
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $c = ['date' => $r['date'], 'theme' => $r['theme'], 'status' => $r['status']];
            foreach (self::FIELDS as $field => [$col]) {
                $map = json_decode((string) ($r[$col] ?? ''), true);
                if (is_array($map) && ($map['en'] ?? '') !== '') {
                    unset($map['_src']);
                    $c[$field] = $map;
                }
            }
            $tw = Database::pdo()->prepare("
                SELECT t.id, t.city_id, c.name AS city, t.text, t.text_i18n
                FROM daily_twists t LEFT JOIN cities c ON c.id = t.city_id
                WHERE t.challenge_id = ? AND t.status = 'selected' ORDER BY t.city_id
            ");
            $tw->execute([$r['id']]);
            foreach ($tw->fetchAll(PDO::FETCH_ASSOC) as $t) {
                $map = json_decode((string) ($t['text_i18n'] ?? ''), true) ?: [];
                unset($map['_src']);
                $c['twists'][] = ['id' => $t['id'], 'city' => $t['city'] ?? $t['city_id'], 'text' => ['en' => $t['text']] + $map];
            }
            $out[] = $c;
        }
        return ['_note' => 'Hilads Daily Challenge translations, exported ' . gmdate('Y-m-d H:i') . ' UTC. Translate with docs/daily-challenge/TRANSLATION.md, keep "en" as is, import in Admin › Daily › Translations.',
                'challenges' => $out];
    }

    /**
     * New stored map for one field: the stored one with the file's
     * translations over it. Pure. Returns [map|null, changed locales, error|null];
     * null map = skip (English changed, or nothing to do).
     */
    public static function mergeField(array $stored, mixed $file, int $max, bool $src, string $label): array
    {
        if (!is_array($file)) {
            return [null, [], "{$label}: not an object of translations"];
        }
        $en = trim((string) ($file['en'] ?? ''));
        if ($en === '' || $en !== trim((string) ($stored['en'] ?? ''))) {
            return [null, [], "{$label}: the English changed since the export, skipped"];
        }
        try {
            $clean = DailyI18n::clean($file, $max, $label);
        } catch (InvalidArgumentException $e) {
            return [null, [], $e->getMessage()];
        }
        $map = $stored;
        $changed = [];
        foreach ($clean as $l => $v) {
            if (($map[$l] ?? null) !== $v) {
                $map[$l] = $v;
                $changed[] = $l;
            }
        }
        if ($changed === []) {
            return [null, [], null];
        }
        if ($src) {
            $map['_src'] = $stored['en'];
        }
        return [$map, $changed, null];
    }

    /**
     * Import a file made by export(). Nothing is written with $dryRun.
     * Returns {ok, dryRun, report: [{date, field, locales|error}]}.
     */
    public static function import(mixed $doc, bool $dryRun): array
    {
        if (!is_array($doc) || !is_array($doc['challenges'] ?? null)) {
            return ['ok' => false, 'dryRun' => $dryRun, 'errors' => ['The file must contain a "challenges" array.'], 'report' => []];
        }
        $pdo = Database::pdo();
        $report = [];
        $cols = implode(', ', array_map(static fn(array $f) => $f[0], self::FIELDS));
        $pdo->beginTransaction();
        try {
            foreach ($doc['challenges'] as $c) {
                $date = is_array($c) ? ($c['date'] ?? null) : null;
                if (!is_string($date) || !DailyClock::isValidDate($date)) {
                    $report[] = ['date' => '?', 'field' => '-', 'error' => 'an entry without a valid date, skipped'];
                    continue;
                }
                $stmt = $pdo->prepare("SELECT id, {$cols} FROM daily_challenges WHERE challenge_date = ? FOR UPDATE");
                $stmt->execute([$date]);
                $row = $stmt->fetch(PDO::FETCH_ASSOC);
                if ($row === false) {
                    $report[] = ['date' => $date, 'field' => '-', 'error' => 'no challenge on this date, skipped'];
                    continue;
                }
                foreach (self::FIELDS as $field => [$col, $max, $src]) {
                    if (!array_key_exists($field, $c)) {
                        continue;
                    }
                    $stored = json_decode((string) ($row[$col] ?? ''), true) ?: [];
                    [$map, $changed, $error] = self::mergeField($stored, $c[$field], $max, $src, "{$date} {$field}");
                    if ($error !== null) {
                        $report[] = ['date' => $date, 'field' => $field, 'error' => $error];
                    } elseif ($map !== null) {
                        $pdo->prepare("UPDATE daily_challenges SET {$col} = ?::jsonb, updated_at = now() WHERE id = ?")
                            ->execute([json_encode($map, JSON_UNESCAPED_UNICODE), $row['id']]);
                        $report[] = ['date' => $date, 'field' => $field, 'locales' => $changed];
                    }
                }
                foreach (is_array($c['twists'] ?? null) ? $c['twists'] : [] as $t) {
                    $tid = is_array($t) ? (string) ($t['id'] ?? '') : '';
                    $tw = $pdo->prepare("SELECT text, text_i18n FROM daily_twists WHERE id = ? AND challenge_id = ? FOR UPDATE");
                    $tw->execute([$tid, $row['id']]);
                    $trow = $tw->fetch(PDO::FETCH_ASSOC);
                    if ($trow === false) {
                        $report[] = ['date' => $date, 'field' => 'twist', 'error' => "twist {$tid} not found on this day, skipped"];
                        continue;
                    }
                    $stored = (json_decode((string) ($trow['text_i18n'] ?? ''), true) ?: []) + ['en' => $trow['text']];
                    [$map, $changed, $error] = self::mergeField($stored, $t['text'] ?? null, DailyAdminService::TWIST_MAX, true, "{$date} twist " . ($t['city'] ?? $tid));
                    if ($error !== null) {
                        $report[] = ['date' => $date, 'field' => 'twist', 'error' => $error];
                    } elseif ($map !== null) {
                        unset($map['en']);   // daily_twists.text is the English
                        $pdo->prepare("UPDATE daily_twists SET text_i18n = ?::jsonb, updated_at = now() WHERE id = ?")
                            ->execute([json_encode($map, JSON_UNESCAPED_UNICODE), $tid]);
                        $report[] = ['date' => $date, 'field' => 'twist ' . ($t['city'] ?? ''), 'locales' => $changed];
                    }
                }
            }
            if ($dryRun) {
                $pdo->rollBack();
            } else {
                DailyAdminService::audit('daily_challenge.translations', 'daily_challenge', null, null,
                    ['fields' => count(array_filter($report, static fn($l) => isset($l['locales'])))]);
                $pdo->commit();
                Cache::forget('daily_challenge_v2_' . DailyClock::currentDate());
            }
        } catch (Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        return ['ok' => true, 'dryRun' => $dryRun, 'errors' => [], 'report' => $report];
    }
}
