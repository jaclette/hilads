<?php

declare(strict_types=1);

/**
 * Back office services for the Daily Challenge (pages in admin/, prompt 06,
 * and the import CLI). Plain PHP, called directly - there is no admin API.
 *
 * Every change is written to admin_audit_log. The back office has one shared
 * env login, so the actor is ADMIN_USERNAME + IP (or "cli" for scripts).
 * Methods throw InvalidArgumentException with a short, admin-readable message
 * when a request is refused.
 */
final class DailyAdminService
{
    public const TEXT_MAX    = 500;   // hard cap; the editor counts to 120
    public const CONTEXT_MAX = 1000;
    public const TWIST_MAX   = 280;

    /** Set to 'cli' by scripts; null = the logged-in back office admin. */
    public static ?string $actor = null;

    // ── Challenges ───────────────────────────────────────────────────────────

    /**
     * $in: text (string, required), context (string|null), date (Y-m-d|null),
     * status ('draft'|'scheduled'), theme (key or name; default: the date's
     * weekday theme). A dated challenge must be for a future drop and its day
     * must be free.
     */
    public static function createChallenge(array $in): array
    {
        $text    = self::cleanText($in['text'] ?? null, self::TEXT_MAX, 'Text');
        $context = self::cleanOptional($in['context'] ?? null, self::CONTEXT_MAX, 'Context');
        $date    = self::optionalDate($in['date'] ?? null);
        $status  = self::editableStatus($in['status'] ?? 'draft');
        [$theme, $specialId] = self::themeAndSpecial($in['theme'] ?? null);
        $theme ??= $date !== null ? DailyThemes::forDate($date) : null;
        if ($status === 'scheduled' && $date === null) {
            throw new InvalidArgumentException('A scheduled challenge needs a date.');
        }
        if ($date !== null) {
            self::assertFutureDate($date);
            self::assertDateFree($date, null);
        }

        $id = bin2hex(random_bytes(8));
        Database::pdo()->prepare("
            INSERT INTO daily_challenges (id, challenge_date, text_i18n, context_i18n, status, theme, special_id, created_by, updated_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ")->execute([$id, $date, self::i18n($text), self::i18n($context), $status, $theme, $specialId, self::actorName(), self::actorName()]);

        $row = self::find($id);
        self::audit('daily_challenge.create', 'daily_challenge', $id, null, $row);
        return $row;
    }

    /**
     * Edit text, context, theme and (unless published) status. Editing a
     * published challenge's text is allowed and logged - it is live everywhere.
     * An empty theme goes back to the date's weekday theme.
     * Dates change through moveChallenge().
     */
    public static function updateChallenge(string $id, array $in): array
    {
        $before = self::mustFind($id);
        $sets = ['updated_at = now()', 'updated_by = ?'];
        $args = [self::actorName()];

        // Only the English changes; translations stay (the editor flags them as older).
        if (array_key_exists('text', $in)) {
            $sets[] = "text_i18n = text_i18n || jsonb_build_object('en', ?::text)";
            $args[] = self::cleanText($in['text'], self::TEXT_MAX, 'Text');
        }
        if (array_key_exists('context', $in)) {
            $ctx = self::cleanOptional($in['context'], self::CONTEXT_MAX, 'Context');
            if ($ctx === null) {
                $sets[] = "context_i18n = context_i18n - 'en'";
            } else {
                $sets[] = "context_i18n = context_i18n || jsonb_build_object('en', ?::text)";
                $args[] = $ctx;
            }
        }
        if (array_key_exists('theme', $in)) {
            [$theme, $specialId] = self::themeAndSpecial($in['theme']);
            $sets[] = 'theme = ?';
            $args[] = $theme ?? ($before['challenge_date'] !== null ? DailyThemes::forDate((string) $before['challenge_date']) : null);
            $sets[] = 'special_id = ?';
            $args[] = $specialId;
        }
        if (array_key_exists('status', $in) && $before['status'] !== 'published') {
            $status = self::editableStatus($in['status']);
            if ($status === 'scheduled' && $before['challenge_date'] === null && !$before['is_reserve']) {
                throw new InvalidArgumentException('A scheduled challenge needs a date.');
            }
            $sets[] = 'status = ?';
            $args[] = $status;
        }
        $args[] = $id;
        Database::pdo()->prepare("UPDATE daily_challenges SET " . implode(', ', $sets) . " WHERE id = ?")->execute($args);

        $after = self::find($id);
        self::forgetCachedDate($after['challenge_date']);
        self::audit('daily_challenge.update', 'daily_challenge', $id, $before, $after);
        return $after;
    }

    /**
     * Save the hand-written translations of a challenge: $text and $context
     * are {locale: string} maps for the 18 other locales; an empty or absent
     * locale removes that translation. Stamps _src with the current English.
     */
    public static function setChallengeTranslations(string $id, array $text, array $context): array
    {
        $before  = self::mustFind($id);
        $textMap = json_decode((string) $before['text_i18n'], true) ?: [];
        $ctxMap  = json_decode((string) $before['context_i18n'], true) ?: [];
        $newText = DailyI18n::merge($textMap, (string) ($textMap['en'] ?? ''),
                                    DailyI18n::clean($text, self::TEXT_MAX, 'Text'));
        $newCtx  = DailyI18n::merge($ctxMap, (string) ($ctxMap['en'] ?? ''),
                                    DailyI18n::clean($context, self::CONTEXT_MAX, 'Context'));
        if (($ctxMap['en'] ?? null) === null) {
            unset($newCtx['en']);
        }
        Database::pdo()->prepare("
            UPDATE daily_challenges SET text_i18n = ?::jsonb, context_i18n = ?::jsonb, updated_at = now(), updated_by = ?
            WHERE id = ?
        ")->execute([json_encode($newText, JSON_UNESCAPED_UNICODE), json_encode((object) $newCtx, JSON_UNESCAPED_UNICODE),
                     self::actorName(), $id]);
        $after = self::find($id);
        self::forgetCachedDate($after['challenge_date']);
        self::audit('daily_challenge.translations', 'daily_challenge', $id,
                    ['text_i18n' => $before['text_i18n'], 'context_i18n' => $before['context_i18n']],
                    ['text_i18n' => $after['text_i18n'], 'context_i18n' => $after['context_i18n']]);
        return $after;
    }

    public const HEADLINE_MAX = 45;

    /**
     * The headline of a challenge as stored: en (required unless all empty)
     * plus {locale: text} translations, each at most HEADLINE_MAX characters.
     * Null when en is empty (the hero shows the challenge text). Throws.
     */
    public static function headlineJson(?string $en, array $translations, string $label = 'Headline'): ?string
    {
        $en = trim((string) preg_replace('/\s+/u', ' ', (string) $en));
        if ($en === '') {
            return null;
        }
        if (mb_strlen($en) > self::HEADLINE_MAX) {
            throw new InvalidArgumentException("{$label} is longer than " . self::HEADLINE_MAX . " characters: \"{$en}\".");
        }
        $all = ['en' => $en];
        foreach ($translations as $loc => $text) {
            $loc  = DailyI18n::normalize((string) $loc);
            $text = trim((string) preg_replace('/\s+/u', ' ', (string) $text));
            if ($loc === 'en' || $text === '' || !in_array($loc, DailyI18n::LOCALES, true)) {
                continue;
            }
            if (mb_strlen($text) > self::HEADLINE_MAX) {
                throw new InvalidArgumentException("{$label} ({$loc}) is longer than " . self::HEADLINE_MAX . ' characters.');
            }
            $all[$loc] = $text;
        }
        return json_encode($all, JSON_UNESCAPED_UNICODE);
    }

    /** Back office: set (or clear, en empty) a challenge's headline. Audited. */
    public static function setChallengeHeadline(string $id, ?string $en, array $translations): array
    {
        $before = self::mustFind($id);
        $json   = self::headlineJson($en, $translations);
        Database::pdo()->prepare("UPDATE daily_challenges SET headline_i18n = ?::jsonb, updated_at = now(), updated_by = ? WHERE id = ?")
            ->execute([$json, self::actorName(), $id]);
        $after = self::find($id);
        self::forgetCachedDate($after['challenge_date']);
        self::audit('daily_challenge.headline', 'daily_challenge', $id, ['headline_i18n' => $before['headline_i18n'] ?? null], ['headline_i18n' => $json]);
        return $after;
    }

    /** Save the hand-written translations of a twist ({locale: string}; empty removes). */
    public static function setTwistTranslations(string $twistId, array $text): array
    {
        $before = self::findTwist($twistId);
        if ($before === null) {
            throw new InvalidArgumentException('Twist not found.');
        }
        $map = DailyI18n::merge([], (string) $before['text'], DailyI18n::clean($text, self::TWIST_MAX, 'Twist'));
        unset($map['en']);   // daily_twists.text holds the English
        Database::pdo()->prepare("UPDATE daily_twists SET text_i18n = ?::jsonb, updated_at = now() WHERE id = ?")
            ->execute([json_encode((object) $map, JSON_UNESCAPED_UNICODE), $twistId]);
        $after = self::findTwist($twistId);
        self::audit('daily_twist.translations', 'daily_twist', $twistId,
                    ['text_i18n' => $before['text_i18n']], ['text_i18n' => $after['text_i18n']]);
        return $after;
    }

    /** Give a challenge a date and schedule it. */
    public static function scheduleChallenge(string $id, string $date): array
    {
        $before = self::mustFind($id);
        if ($before['status'] === 'published') {
            throw new InvalidArgumentException('This challenge is already published.');
        }
        if ($before['is_reserve']) {
            throw new InvalidArgumentException('Reserve challenges are published by the drop, not scheduled.');
        }
        self::assertValidDate($date);
        self::assertFutureDate($date);
        self::assertDateFree($date, $id);

        Database::pdo()->prepare("
            UPDATE daily_challenges SET challenge_date = ?, status = 'scheduled', theme = COALESCE(theme, ?),
                                        updated_at = now(), updated_by = ?
            WHERE id = ?
        ")->execute([$date, DailyThemes::forDate($date), self::actorName(), $id]);

        $after = self::find($id);
        self::audit('daily_challenge.schedule', 'daily_challenge', $id, $before, $after);
        return $after;
    }

    /** Move an unpublished challenge to another free future date (keeps its status and twists). */
    public static function moveChallenge(string $id, string $date): array
    {
        $before = self::mustFind($id);
        if ($before['status'] === 'published') {
            throw new InvalidArgumentException('A published challenge cannot be moved.');
        }
        if ($before['is_reserve']) {
            throw new InvalidArgumentException('Reserve challenges have no date to move.');
        }
        self::assertValidDate($date);
        self::assertFutureDate($date);
        self::assertDateFree($date, $id);

        Database::pdo()->prepare("
            UPDATE daily_challenges SET challenge_date = ?, theme = COALESCE(theme, ?), updated_at = now(), updated_by = ?
            WHERE id = ?
        ")->execute([$date, DailyThemes::forDate($date), self::actorName(), $id]);

        $after = self::find($id);
        self::audit('daily_challenge.move', 'daily_challenge', $id, $before, $after);
        return $after;
    }

    /**
     * Copy a challenge (text, context, selected twists) as a new draft, on
     * $date if given (must be free and in the future) or undated.
     */
    public static function duplicateChallenge(string $id, ?string $date = null): array
    {
        $src = self::mustFind($id);
        if ($date !== null) {
            self::assertValidDate($date);
            self::assertFutureDate($date);
            self::assertDateFree($date, null);
        }

        $pdo   = Database::pdo();
        $newId = bin2hex(random_bytes(8));
        $pdo->beginTransaction();
        try {
            $pdo->prepare("
                INSERT INTO daily_challenges (id, challenge_date, text_i18n, context_i18n, status, theme,
                                              compare_type, compare_question_i18n, compare_unit_i18n,
                                              compare_key, compare_title_i18n, price_key, price_label_i18n, created_by, updated_by)
                SELECT ?, ?, text_i18n, context_i18n, 'draft', theme,
                       compare_type, compare_question_i18n, compare_unit_i18n,
                       compare_key, compare_title_i18n, price_key, price_label_i18n, ?, ? FROM daily_challenges WHERE id = ?
            ")->execute([$newId, $date, self::actorName(), self::actorName(), $id]);
            $pdo->prepare("
                INSERT INTO daily_twists (id, challenge_id, city_id, text, text_i18n, author_user_id, author_credit,
                                          status, moderation_status, created_by)
                SELECT encode(gen_random_bytes(8), 'hex'), ?, city_id, text, text_i18n, author_user_id, author_credit,
                       'selected', 'approved', ?
                FROM daily_twists WHERE challenge_id = ? AND status = 'selected'
            ")->execute([$newId, self::actorName(), $id]);
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }

        $row = self::find($newId);
        self::audit('daily_challenge.duplicate', 'daily_challenge', $newId, ['from' => $src['id']], $row);
        return $row;
    }

    /** Delete an unpublished challenge (its twists cascade). */
    public static function deleteChallenge(string $id): void
    {
        $before = self::mustFind($id);
        if ($before['status'] === 'published') {
            throw new InvalidArgumentException('A published challenge cannot be deleted.');
        }
        Database::pdo()->prepare("DELETE FROM daily_challenges WHERE id = ?")->execute([$id]);
        self::audit('daily_challenge.delete', 'daily_challenge', $id, $before, null);
    }

    // ── Reserve ──────────────────────────────────────────────────────────────

    /**
     * An evergreen challenge without a date, ready for a day with nothing
     * scheduled. Without a theme it takes the theme of the day it is used.
     */
    public static function createReserve(string $text, ?string $context = null, ?string $theme = null): array
    {
        $text    = self::cleanText($text, self::TEXT_MAX, 'Text');
        $context = self::cleanOptional($context, self::CONTEXT_MAX, 'Context');
        $theme   = self::theme($theme);
        $id      = bin2hex(random_bytes(8));
        Database::pdo()->prepare("
            INSERT INTO daily_challenges (id, is_reserve, text_i18n, context_i18n, status, theme, created_by, updated_by)
            VALUES (?, true, ?, ?, 'scheduled', ?, ?, ?)
        ")->execute([$id, self::i18n($text), self::i18n($context), $theme, self::actorName(), self::actorName()]);

        $row = self::find($id);
        self::audit('daily_challenge.create_reserve', 'daily_challenge', $id, null, $row);
        return $row;
    }

    /** Every reserve challenge, unused first (oldest first = next to be used), then used ones by date. */
    public static function listReserve(): array
    {
        return Database::pdo()->query("
            SELECT id, challenge_date, text_i18n, context_i18n, status, theme, created_at,
                   challenge_date IS NOT NULL AS used
            FROM daily_challenges
            WHERE is_reserve
            ORDER BY (challenge_date IS NOT NULL), challenge_date DESC, created_at
        ")->fetchAll(PDO::FETCH_ASSOC);
    }

    // ── Calendar ─────────────────────────────────────────────────────────────

    /**
     * One entry per day from $from to $to (inclusive), with that day's
     * challenge if any. state: empty | draft | scheduled | published | reserve_used.
     */
    public static function calendar(string $from, string $to): array
    {
        self::assertValidDate($from);
        self::assertValidDate($to);
        $stmt = Database::pdo()->prepare("
            SELECT dc.*,
                   (SELECT count(*) FROM daily_twists t
                     WHERE t.challenge_id = dc.id AND t.status = 'selected') AS twist_count
            FROM daily_challenges dc
            WHERE dc.challenge_date BETWEEN ? AND ?
        ");
        $stmt->execute([$from, $to]);
        $byDate = [];
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $byDate[$row['challenge_date']] = $row;
        }

        $days = [];
        $d    = new DateTimeImmutable($from, new DateTimeZone('UTC'));
        $end  = new DateTimeImmutable($to, new DateTimeZone('UTC'));
        for (; $d <= $end; $d = $d->modify('+1 day')) {
            $key = $d->format('Y-m-d');
            $row = $byDate[$key] ?? null;
            $state = 'empty';
            if ($row !== null) {
                $state = DailyProofRepository::bool($row['is_reserve']) ? 'reserve_used' : $row['status'];
            }
            $days[] = ['date' => $key, 'state' => $state, 'challenge' => $row];
        }
        return $days;
    }

    /**
     * Dates among the next $days drops with no scheduled or published
     * challenge, counted after $afterDate (default: today's challenge date).
     */
    public static function gapsInNextDays(int $days = 3, ?string $afterDate = null): array
    {
        $first = (new DateTimeImmutable($afterDate ?? DailyClock::currentDate(), new DateTimeZone('UTC')))->modify('+1 day');
        $last  = $first->modify('+' . ($days - 1) . ' days');
        $gaps  = [];
        foreach (self::calendar($first->format('Y-m-d'), $last->format('Y-m-d')) as $day) {
            if (!in_array($day['state'], ['scheduled', 'published'], true)) {
                $gaps[] = $day['date'];
            }
        }
        return $gaps;
    }

    // ── Local Twists ─────────────────────────────────────────────────────────

    /**
     * Set or replace the selected twist of (challenge, city). Founder-written
     * twists are approved directly. $cityId is a channel id ('city_N').
     * $dishTags ("cơm tấm, sườn", V3-03): null keeps the current tags.
     */
    public static function setTwist(string $challengeId, string $cityId, string $text,
                                    ?string $authorUserId = null, ?string $credit = null,
                                    ?string $dishTags = null): array
    {
        self::mustFind($challengeId);
        self::assertCity($cityId);
        $text   = self::cleanText($text, self::TWIST_MAX, 'Twist');
        if (ModerationService::check($text) !== null) {
            throw new InvalidArgumentException('This twist was flagged by the text filter - please rephrase.');
        }
        $credit = self::cleanOptional($credit, 120, 'Credit');
        $tags   = $dishTags === null ? null : implode(', ', Spots::parseTags($dishTags));
        if ($authorUserId !== null) {
            $stmt = Database::pdo()->prepare("SELECT 1 FROM users WHERE id = ? AND deleted_at IS NULL");
            $stmt->execute([$authorUserId]);
            if (!$stmt->fetchColumn()) {
                throw new InvalidArgumentException('Unknown author user.');
            }
        }

        $pdo = Database::pdo();
        $pdo->beginTransaction();
        try {
            $stmt = $pdo->prepare("
                SELECT * FROM daily_twists
                WHERE challenge_id = ? AND city_id = ? AND status = 'selected'
                FOR UPDATE
            ");
            $stmt->execute([$challengeId, $cityId]);
            $before = $stmt->fetch(PDO::FETCH_ASSOC) ?: null;

            if ($before !== null) {
                $pdo->prepare("
                    UPDATE daily_twists
                    SET text = ?, author_user_id = ?, author_credit = ?, moderation_status = 'approved',
                        dish_tags = CASE WHEN ?::boolean THEN NULLIF(?, '') ELSE dish_tags END, updated_at = now()
                    WHERE id = ?
                ")->execute([$text, $authorUserId, $credit, $tags !== null ? 'true' : 'false', (string) $tags, $before['id']]);
                $id = $before['id'];
            } else {
                $id = bin2hex(random_bytes(8));
                $pdo->prepare("
                    INSERT INTO daily_twists (id, challenge_id, city_id, text, author_user_id, author_credit,
                                              status, moderation_status, created_by, dish_tags)
                    VALUES (?, ?, ?, ?, ?, ?, 'selected', 'approved', ?, NULLIF(?, ''))
                ")->execute([$id, $challengeId, $cityId, $text, $authorUserId, $credit, self::actorName(), (string) $tags]);
            }
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }

        $after = self::findTwist($id);
        self::audit('daily_twist.set', 'daily_twist', $id, $before, $after);
        return $after;
    }

    /** setTwist() by challenge date. */
    public static function setTwistForDate(string $date, string $cityId, string $text,
                                           ?string $authorUserId = null, ?string $credit = null): array
    {
        self::assertValidDate($date);
        $stmt = Database::pdo()->prepare("SELECT id FROM daily_challenges WHERE challenge_date = ?");
        $stmt->execute([$date]);
        $challengeId = $stmt->fetchColumn();
        if ($challengeId === false) {
            throw new InvalidArgumentException("No challenge on {$date}.");
        }
        return self::setTwist((string) $challengeId, $cityId, $text, $authorUserId, $credit);
    }

    /** Remove a twist (its points cascade and are reversed). */
    public static function removeTwist(string $twistId): void
    {
        $before = self::findTwist($twistId);
        if ($before === null) {
            throw new InvalidArgumentException('Twist not found.');
        }
        Database::pdo()->prepare("DELETE FROM daily_twists WHERE id = ?")->execute([$twistId]);
        self::audit('daily_twist.remove', 'daily_twist', $twistId, $before, null);
    }

    // ── Cities and proofs ────────────────────────────────────────────────────

    public static function setForceLive(string $cityId, bool $live): void
    {
        self::assertCity($cityId);
        $stmt = Database::pdo()->prepare("SELECT force_live FROM cities WHERE channel_id = ?");
        $stmt->execute([$cityId]);
        $before = DailyProofRepository::bool($stmt->fetchColumn());

        Database::pdo()->prepare("UPDATE cities SET force_live = ? WHERE channel_id = ?")
            ->execute([$live ? 'true' : 'false', $cityId]);
        DailyRules::forgetLiveCities();
        self::audit('city.force_live', 'city', $cityId, ['force_live' => $before], ['force_live' => $live]);
    }

    /**
     * Admin removal: the proof stays for the record as 'removed' (never shown,
     * blocks a repost), its points are taken back and its channel cards deleted.
     */
    public static function removeProof(string $proofId, ?string $reason = null): void
    {
        $before = DailyProofRepository::findById($proofId);
        if ($before === null) {
            throw new InvalidArgumentException('Proof not found.');
        }
        $pdo = Database::pdo();
        $pdo->beginTransaction();
        try {
            $pdo->prepare("
                UPDATE daily_proofs
                SET moderation_status = 'removed', rejection_reason = ?, approved_at = NULL,
                    moderated_at = now(), updated_at = now()
                WHERE id = ?
            ")->execute([self::cleanOptional($reason, 280, 'Reason'), $proofId]);
            $pdo->prepare("DELETE FROM score_events WHERE daily_proof_id = ?")->execute([$proofId]);
            $pdo->prepare("UPDATE daily_proof_reports SET status = 'reviewed' WHERE proof_id = ? AND status = 'open'")
                ->execute([$proofId]);
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        DailyCards::hideProof($proofId, $before['city_id']);
        DailyPresence::forget($before['city_id'] ?? null, $before['challenge_id'] ?? null);
        self::audit('daily_proof.remove', 'daily_proof', $proofId, $before, DailyProofRepository::findById($proofId));
    }

    // ── Import ───────────────────────────────────────────────────────────────

    /**
     * Validate an import document shaped like daily-challenges.example.json.
     * Pure: $resolveCity maps a city slug to a channel id ('city_N') or null.
     * Returns ['entries' => normalized entries, 'errors' => list of strings].
     */
    public static function validateImport(mixed $doc, callable $resolveCity): array
    {
        $errors  = [];
        $entries = [];
        if (!is_array($doc) || !isset($doc['challenges']) || !is_array($doc['challenges'])) {
            return ['entries' => [], 'errors' => ['The file must contain a "challenges" array.']];
        }

        $seenDates = [];
        foreach (array_values($doc['challenges']) as $i => $c) {
            $label = '#' . ($i + 1);
            if (!is_array($c)) {
                $errors[] = "{$label}: not an object.";
                continue;
            }
            $date    = $c['date'] ?? null;
            $reserve = ($c['reserve'] ?? false) === true;
            $text    = is_array($c['text'] ?? null) ? trim((string) ($c['text']['en'] ?? '')) : '';
            $context = is_array($c['context'] ?? null) ? trim((string) ($c['context']['en'] ?? '')) : '';
            $theme   = DailyThemes::normalizeAny($c['theme'] ?? null);
            if (($c['theme'] ?? null) !== null && $theme === null) {
                $errors[] = "{$label}: unknown theme \"" . (is_scalar($c['theme']) ? $c['theme'] : '') . "\" (one of: "
                          . implode(', ', array_map([DailyThemes::class, 'name'], DailyThemes::keys())) . ", Special).";
            }
            // A special day of world scope: theme "Special" and "special": {"id", "name": {"en", ...}}.
            $special = null;
            if ($theme === DailyThemes::SPECIAL || isset($c['special'])) {
                $sp    = is_array($c['special'] ?? null) ? $c['special'] : [];
                $names = [];
                foreach (is_array($sp['name'] ?? null) ? $sp['name'] : (is_string($sp['name'] ?? null) ? ['en' => $sp['name']] : []) as $l => $v) {
                    if (is_string($v) && trim($v) !== '') {
                        $names[DailyI18n::normalize((string) $l)] = trim($v);
                    }
                }
                if ($theme !== DailyThemes::SPECIAL) {
                    $errors[] = "{$label}: \"special\" needs \"theme\": \"Special\".";
                } elseif (!DailySpecials::isValidId($sp['id'] ?? null)) {
                    $errors[] = "{$label}: special.id is required (lowercase letters, digits and dashes, e.g. halloween).";
                } elseif (($names['en'] ?? '') === '') {
                    $errors[] = "{$label}: special.name.en is required.";
                } elseif ($reserve) {
                    $errors[] = "{$label}: a special day has a date (not the reserve).";
                } else {
                    $special = ['id' => $sp['id'], 'names' => $names];
                }
            }

            if ($text === '') {
                $errors[] = "{$label}: text.en is required.";
            } elseif (mb_strlen($text) > self::TEXT_MAX) {
                $errors[] = "{$label}: text.en is longer than " . self::TEXT_MAX . " characters.";
            }
            if (mb_strlen($context) > self::CONTEXT_MAX) {
                $errors[] = "{$label}: context.en is too long.";
            }
            if ($reserve && $date !== null) {
                $errors[] = "{$label}: a reserve challenge has no date.";
            }
            if (!$reserve) {
                if (!is_string($date) || !DailyClock::isValidDate($date)) {
                    $errors[] = "{$label}: date must be YYYY-MM-DD (or set \"reserve\": true).";
                } elseif (isset($seenDates[$date])) {
                    $errors[] = "{$label}: date {$date} appears twice in the file.";
                } else {
                    $seenDates[$date] = true;
                }
            }

            // Translations: any of the app's other locales next to "en".
            $textTr = $ctxTr = [];
            try {
                $textTr = DailyI18n::clean($c['text'] ?? null, self::TEXT_MAX, "{$label}: text");
                $ctxTr  = DailyI18n::clean($c['context'] ?? null, self::CONTEXT_MAX, "{$label}: context");
            } catch (InvalidArgumentException $e) {
                $errors[] = $e->getMessage();
            }

            // SPEC 10.2: every challenge carries a comparison question.
            $compare = null;
            try {
                $compare = DailyCompare::cleanQuestion($c['compare'] ?? null, "{$label}: compare");
                if ($compare === null) {
                    $errors[] = "{$label}: compare is required (type and question).";
                }
            } catch (InvalidArgumentException $e) {
                $errors[] = $e->getMessage();
            }

            $twists = [];
            foreach (is_array($c['twists'] ?? null) ? $c['twists'] : [] as $j => $t) {
                $tLabel = "{$label} twist " . ($j + 1);
                $slug   = is_array($t) ? (string) ($t['city'] ?? '') : '';
                // "text": "English" or {"en": "...", "fr": "...", ...}
                $tRaw   = is_array($t) ? ($t['text'] ?? '') : '';
                $tText  = trim((string) (is_array($tRaw) ? ($tRaw['en'] ?? '') : $tRaw));
                $tTr    = [];
                if (is_array($tRaw)) {
                    try {
                        $tTr = DailyI18n::clean($tRaw, self::TWIST_MAX, $tLabel);
                    } catch (InvalidArgumentException $e) {
                        $errors[] = $e->getMessage();
                        continue;
                    }
                }
                $cityId = $slug !== '' ? $resolveCity($slug) : null;
                if ($cityId === null) {
                    $errors[] = "{$tLabel}: unknown city \"{$slug}\".";
                    continue;
                }
                if ($tText === '' || mb_strlen($tText) > self::TWIST_MAX) {
                    $errors[] = "{$tLabel}: text is required (max " . self::TWIST_MAX . " characters).";
                    continue;
                }
                if (ModerationService::check($tText) !== null) {
                    $errors[] = "{$tLabel}: flagged by the text filter.";
                    continue;
                }
                $credit = is_array($t) && is_string($t['credit'] ?? null) && trim($t['credit']) !== ''
                    ? trim($t['credit']) : null;
                $twists[] = ['cityId' => $cityId, 'text' => $tText, 'credit' => $credit, 'translations' => $tTr];
            }

            // The Today hero's headline (SPEC 9.3): {en, fr, ...}, 45 characters each, optional.
            $headline = null;
            if (isset($c['headline'])) {
                try {
                    $hl = is_array($c['headline']) ? $c['headline'] : ['en' => (string) $c['headline']];
                    $headline = self::headlineJson((string) ($hl['en'] ?? ''), array_diff_key($hl, ['en' => true]), "{$label}: headline");
                } catch (InvalidArgumentException $e) {
                    $errors[] = $e->getMessage();
                }
            }

            $entries[] = [
                'headline' => $headline,
                'label'   => $label,
                'date'    => $reserve ? null : $date,
                'reserve' => $reserve,
                'text'    => $text,
                'context' => $context === '' ? null : $context,
                // Missing: the date's weekday theme (a reserve gets one when used).
                'theme'   => $theme ?? (!$reserve && is_string($date) && DailyClock::isValidDate($date) ? DailyThemes::forDate($date) : null),
                'themeGiven' => $theme !== null,
                'special' => $special,
                'twists'  => $twists,
                'textTranslations'    => $textTr,
                'contextTranslations' => $ctxTr,
                'missingLocales'      => array_values(array_diff(DailyI18n::others(), array_keys($textTr))),
                'compare'             => $compare,
                'compareMissingLocales' => $compare !== null
                    ? array_values(array_diff(DailyI18n::others(), DailyI18n::translated($compare['question']))) : [],
            ];
        }

        return ['entries' => $entries, 'errors' => $errors];
    }

    /**
     * Import a document. Nothing is written if any entry is invalid; with
     * $dryRun nothing is written at all. A dated entry creates the day's
     * challenge (scheduled), or updates it if not yet published; published
     * days and past dates are skipped. Reserve entries are skipped when a
     * reserve with the same English text exists. Returns a per-entry report.
     *
     * $replace: the file replaces what is scheduled. Unpublished future days
     * between the file's first and last date that are not in the file are
     * deleted; a day in the file gets the file's texts and translations only
     * (nothing merged), its own cover is cleared when the text changes, and
     * its founder twists not in the file are removed (locals' proposals stay).
     * When the file has reserve entries, the unused reserve is deleted first.
     * Report lines carry what was there ("was").
     */
    public static function import(mixed $doc, bool $dryRun, bool $replace = false): array
    {
        $check = self::validateImport($doc, fn(string $slug): ?string => self::cityIdForSlug($slug));
        if ($check['errors'] !== []) {
            return ['ok' => false, 'dryRun' => $dryRun, 'errors' => $check['errors'], 'report' => []];
        }

        $pdo    = Database::pdo();
        $report = [];
        $today  = DailyClock::currentDate();
        $was    = static fn(array $r): array => [
            'text'  => (json_decode((string) $r['text_i18n'], true) ?: [])['en'] ?? '',
            'theme' => $r['theme'],
        ];
        $pdo->beginTransaction();
        try {
            if ($replace) {
                $dates = array_values(array_filter(array_column($check['entries'], 'date')));
                if ($dates !== []) {
                    $stmt = $pdo->prepare("
                        SELECT id, challenge_date::text AS challenge_date, text_i18n, theme FROM daily_challenges
                        WHERE challenge_date BETWEEN ? AND ? AND challenge_date > ? AND status <> 'published'
                        ORDER BY challenge_date
                    ");
                    $stmt->execute([min($dates), max($dates), $today]);
                    $inFile = array_flip($dates);
                    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
                        if (!isset($inFile[$r['challenge_date']])) {
                            $pdo->prepare("DELETE FROM daily_challenges WHERE id = ?")->execute([$r['id']]);
                            $report[] = ['entry' => '-', 'action' => 'delete', 'id' => $r['id'], 'date' => $r['challenge_date'], 'was' => $was($r)];
                        }
                    }
                }
                if (in_array(true, array_column($check['entries'], 'reserve'), true)) {
                    $rows = $pdo->query("
                        SELECT id, text_i18n, theme FROM daily_challenges
                        WHERE is_reserve AND challenge_date IS NULL AND status <> 'published' ORDER BY created_at
                    ")->fetchAll(PDO::FETCH_ASSOC);
                    foreach ($rows as $r) {
                        $pdo->prepare("DELETE FROM daily_challenges WHERE id = ?")->execute([$r['id']]);
                        $report[] = ['entry' => '-', 'action' => 'delete_reserve', 'id' => $r['id'], 'was' => $was($r)];
                    }
                }
            }

            foreach ($check['entries'] as $e) {
                if ($e['special'] !== null && $e['date'] > $today) {
                    DailySpecials::upsertFromImport($e['special']['id'], $e['date'], $e['special']['names']);
                }
                $specialId = $e['special']['id'] ?? null;

                if ($e['reserve']) {
                    $stmt = $pdo->prepare("SELECT id, compare_type, compare_key, price_key FROM daily_challenges WHERE is_reserve AND text_i18n->>'en' = ?");
                    $stmt->execute([$e['text']]);
                    if (($row = $stmt->fetch(PDO::FETCH_ASSOC)) !== false) {
                        // A stored reserve keeps its text; it gets the file's question when it has none.
                        if ($row['compare_type'] === null && $e['compare'] !== null) {
                            self::setCompare($row['id'], $e['compare']);
                            $report[] = ['entry' => $e['label'], 'action' => 'compare_added', 'id' => $row['id'],
                                         'compare' => $e['compare']['question']['en'], 'compareMissingLocales' => $e['compareMissingLocales']];
                            continue;
                        }
                        $report[] = self::fillIndexKeys($row, $e['compare'])
                            ? ['entry' => $e['label'], 'action' => 'keys_added', 'id' => $row['id'], 'key' => $e['compare']['key'] ?? null, 'priceKey' => $e['compare']['price']['key'] ?? null]
                            : ['entry' => $e['label'], 'action' => 'skip', 'reason' => 'reserve already exists'];
                        continue;
                    }
                    $id = bin2hex(random_bytes(8));
                    $pdo->prepare("
                        INSERT INTO daily_challenges (id, is_reserve, text_i18n, context_i18n, status, theme, created_by, updated_by)
                        VALUES (?, true, ?, ?, 'scheduled', ?, ?, ?)
                    ")->execute([$id, self::importI18n($e['text'], $e['textTranslations']),
                                 self::importI18n($e['context'], $e['contextTranslations']), $e['theme'], self::actorName(), self::actorName()]);
                    self::setCompare($id, $e['compare']);
                    $report[] = ['entry' => $e['label'], 'action' => 'create_reserve', 'id' => $id, 'theme' => $e['theme'], 'text' => $e['text'], 'missingLocales' => $e['missingLocales'],
                                     'compare' => $e['compare']['question']['en'] ?? null, 'compareMissingLocales' => $e['compareMissingLocales']];
                } else {
                    $stmt = $pdo->prepare("SELECT id, status, text_i18n, theme, compare_type, compare_key, price_key FROM daily_challenges WHERE challenge_date = ? FOR UPDATE");
                    $stmt->execute([$e['date']]);
                    $existing = $stmt->fetch(PDO::FETCH_ASSOC);
                    // Today's and published challenges keep their text; they only
                    // get the file's comparison question when they have none (SPEC 10.2).
                    if ($existing && $e['date'] >= $today && ($existing['status'] === 'published' || $e['date'] === $today)) {
                        if ($existing['compare_type'] === null && $e['compare'] !== null) {
                            self::setCompare($existing['id'], $e['compare']);
                            $report[] = ['entry' => $e['label'], 'action' => 'compare_added', 'id' => $existing['id'], 'date' => $e['date'],
                                         'compare' => $e['compare']['question']['en'], 'compareMissingLocales' => $e['compareMissingLocales']];
                        } elseif (self::fillIndexKeys($existing, $e['compare'])) {
                            $report[] = ['entry' => $e['label'], 'action' => 'keys_added', 'id' => $existing['id'], 'date' => $e['date'],
                                         'key' => $e['compare']['key'] ?? null, 'priceKey' => $e['compare']['price']['key'] ?? null];
                        } else {
                            $report[] = ['entry' => $e['label'], 'action' => 'skip', 'reason' => "{$e['date']} is already published"];
                        }
                        continue;
                    }
                    if ($e['date'] <= $today) {
                        // A past day keeps everything, but gets the Index keys it lacks (its answers then count).
                        $report[] = $existing && self::fillIndexKeys($existing, $e['compare'])
                            ? ['entry' => $e['label'], 'action' => 'keys_added', 'id' => $existing['id'], 'date' => $e['date'],
                               'key' => $e['compare']['key'] ?? null, 'priceKey' => $e['compare']['price']['key'] ?? null]
                            : ['entry' => $e['label'], 'action' => 'skip', 'reason' => "{$e['date']} is not a future drop"];
                        continue;
                    }
                    if ($existing && $existing['status'] === 'published') {
                        $report[] = ['entry' => $e['label'], 'action' => 'skip', 'reason' => "{$e['date']} is already published"];
                        continue;
                    }
                    if ($existing && $replace) {
                        $id      = $existing['id'];
                        $changed = ($was($existing)['text']) !== $e['text'];
                        $pdo->prepare("
                            UPDATE daily_challenges
                            SET text_i18n = ?::jsonb, context_i18n = ?::jsonb, status = 'scheduled', theme = ?, special_id = ?,
                                cover_url = CASE WHEN ? THEN NULL ELSE cover_url END,
                                updated_at = now(), updated_by = ?
                            WHERE id = ?
                        ")->execute([
                            self::importI18n($e['text'], $e['textTranslations']), self::importI18n($e['context'], $e['contextTranslations']),
                            $e['theme'], $specialId, $changed ? 'true' : 'false', self::actorName(), $id,
                        ]);
                        $keep = array_column($e['twists'], 'cityId');
                        $stmt = $pdo->prepare("
                            DELETE FROM daily_twists
                            WHERE challenge_id = ? AND proposed_at IS NULL AND NOT (city_id = ANY (string_to_array(?, ',')))
                        ");
                        $stmt->execute([$id, implode(',', $keep)]);
                        self::setCompare($id, $e['compare']);
                        $report[] = ['entry' => $e['label'], 'action' => 'replace', 'id' => $id, 'date' => $e['date'], 'theme' => $e['theme'],
                                     'text' => $e['text'], 'was' => $was($existing), 'twistsRemoved' => $stmt->rowCount(),
                                     'missingLocales' => $e['missingLocales'],
                                     'compare' => $e['compare']['question']['en'] ?? null, 'compareMissingLocales' => $e['compareMissingLocales']];
                    } elseif ($existing) {
                        $id = $existing['id'];
                        // Without translations in the file, the stored ones are kept.
                        $pdo->prepare("
                            UPDATE daily_challenges
                            SET text_i18n = CASE WHEN ? THEN ?::jsonb ELSE text_i18n || jsonb_build_object('en', ?::text) END,
                                context_i18n = CASE WHEN ? THEN ?::jsonb ELSE (context_i18n - 'en') || ?::jsonb END,
                                status = 'scheduled',
                                theme = CASE WHEN ? THEN ? ELSE COALESCE(theme, ?) END,
                                special_id = ?,
                                updated_at = now(), updated_by = ?
                            WHERE id = ?
                        ")->execute([
                            $e['textTranslations'] !== [] ? 'true' : 'false', self::importI18n($e['text'], $e['textTranslations']), $e['text'],
                            $e['contextTranslations'] !== [] ? 'true' : 'false', self::importI18n($e['context'], $e['contextTranslations']), self::i18n($e['context']),
                            $e['themeGiven'] ? 'true' : 'false', $e['theme'], $e['theme'], $specialId,
                            self::actorName(), $id,
                        ]);
                        self::setCompare($id, $e['compare']);
                        $report[] = ['entry' => $e['label'], 'action' => 'update', 'id' => $id, 'date' => $e['date'], 'theme' => $e['theme'], 'text' => $e['text'], 'was' => $was($existing), 'missingLocales' => $e['missingLocales'],
                                     'compare' => $e['compare']['question']['en'] ?? null, 'compareMissingLocales' => $e['compareMissingLocales']];
                    } else {
                        $id = bin2hex(random_bytes(8));
                        $pdo->prepare("
                            INSERT INTO daily_challenges (id, challenge_date, text_i18n, context_i18n, status, theme, special_id, created_by, updated_by)
                            VALUES (?, ?, ?, ?, 'scheduled', ?, ?, ?, ?)
                        ")->execute([$id, $e['date'], self::importI18n($e['text'], $e['textTranslations']),
                                     self::importI18n($e['context'], $e['contextTranslations']), $e['theme'], $specialId, self::actorName(), self::actorName()]);
                        self::setCompare($id, $e['compare']);
                        $report[] = ['entry' => $e['label'], 'action' => 'create', 'id' => $id, 'date' => $e['date'], 'theme' => $e['theme'], 'text' => $e['text'], 'missingLocales' => $e['missingLocales'],
                                     'compare' => $e['compare']['question']['en'] ?? null, 'compareMissingLocales' => $e['compareMissingLocales']];
                    }
                }

                foreach ($e['twists'] as $t) {
                    $tI18n = $t['translations'] !== [] ? self::twistI18nJson($t['text'], $t['translations']) : null;
                    $stmt = $pdo->prepare("
                        UPDATE daily_twists SET text = ?, author_credit = ?, moderation_status = 'approved', updated_at = now(),
                                                text_i18n = COALESCE(?::jsonb, text_i18n)
                        WHERE challenge_id = ? AND city_id = ? AND status = 'selected'
                    ");
                    $stmt->execute([$t['text'], $t['credit'], $tI18n, $id, $t['cityId']]);
                    if ($stmt->rowCount() === 0) {
                        $pdo->prepare("
                            INSERT INTO daily_twists (id, challenge_id, city_id, text, text_i18n, author_credit, status, moderation_status, created_by)
                            VALUES (?, ?, ?, ?, ?::jsonb, ?, 'selected', 'approved', ?)
                        ")->execute([bin2hex(random_bytes(8)), $id, $t['cityId'], $t['text'], $tI18n ?? '{}', $t['credit'], self::actorName()]);
                    }
                }
            }

            // Headlines last, on whatever row each entry maps to (published days too): the file wins.
            foreach ($check['entries'] as $e) {
                if ($e['headline'] === null) {
                    continue;
                }
                $stmt = $e['reserve']
                    ? $pdo->prepare("UPDATE daily_challenges SET headline_i18n = ?::jsonb WHERE is_reserve AND text_i18n->>'en' = ? AND headline_i18n IS DISTINCT FROM ?::jsonb")
                    : $pdo->prepare("UPDATE daily_challenges SET headline_i18n = ?::jsonb WHERE challenge_date = ? AND headline_i18n IS DISTINCT FROM ?::jsonb");
                $stmt->execute([$e['headline'], $e['reserve'] ? $e['text'] : $e['date'], $e['headline']]);
                if ($stmt->rowCount() > 0) {
                    $report[] = ['entry' => $e['label'], 'action' => 'headline_set', 'date' => $e['date'], 'headline' => json_decode($e['headline'], true)['en']];
                }
            }

            if ($dryRun) {
                $pdo->rollBack();
            } else {
                $counts = array_count_values(array_column($report, 'action'));
                self::audit('daily_challenge.import', 'daily_challenge', null, null, ['counts' => $counts, 'replace' => $replace]);
                $pdo->commit();
            }
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }

        return ['ok' => true, 'dryRun' => $dryRun, 'errors' => [], 'report' => $report];
    }

    /**
     * Back office: set or clear ($in null) a challenge's comparison question.
     * $in = {type, question: {en, ...}, unit: {en, ...}, key, title, price: {key, label}} (DailyCompare::cleanQuestion). Audited.
     */
    public static function setChallengeCompare(string $id, ?array $in): array
    {
        $before = self::mustFind($id);
        $q      = DailyCompare::cleanQuestion($in, 'Question');
        self::setCompare($id, $q);
        $after = self::find($id);
        if (PHP_SAPI !== 'cli' && $after['challenge_date'] !== null) {
            Cache::forget('daily_challenge_v2_' . $after['challenge_date']);
        }
        self::audit('daily_challenge.compare', 'daily_challenge', $id,
            ['compare_type' => $before['compare_type'] ?? null, 'compare_question_i18n' => $before['compare_question_i18n'] ?? null],
            ['compare_type' => $after['compare_type'] ?? null, 'compare_question_i18n' => $after['compare_question_i18n'] ?? null]);
        return $after;
    }

    /**
     * The Index keys of a file entry (compare key and title, price key and
     * label) on a stored challenge that has a question but lacks them: never
     * overwrites a key, never touches the question. True when written.
     */
    private static function fillIndexKeys(array $row, ?array $compare): bool
    {
        if ($compare === null || $row['compare_type'] === null) {
            return false;
        }
        $c = DailyCompare::columns($compare);
        $setKey   = $row['compare_key'] === null && $c['compare_key'] !== null;
        $setPrice = $row['price_key'] === null && $c['price_key'] !== null;
        if (!$setKey && !$setPrice) {
            return false;
        }
        Database::pdo()->prepare("
            UPDATE daily_challenges
            SET compare_key = CASE WHEN ? THEN ? ELSE compare_key END,
                compare_title_i18n = CASE WHEN ? THEN ?::jsonb ELSE compare_title_i18n END,
                price_key = CASE WHEN ? THEN ? ELSE price_key END,
                price_label_i18n = CASE WHEN ? THEN ?::jsonb ELSE price_label_i18n END
            WHERE id = ?
        ")->execute([$setKey ? 'true' : 'false', $c['compare_key'], $setKey ? 'true' : 'false', $c['compare_title_i18n'],
                     $setPrice ? 'true' : 'false', $c['price_key'], $setPrice ? 'true' : 'false', $c['price_label_i18n'], $row['id']]);
        return true;
    }

    /** Store a challenge's comparison question (null clears it). */
    public static function setCompare(string $id, ?array $compare): void
    {
        $c = DailyCompare::columns($compare);
        Database::pdo()->prepare("
            UPDATE daily_challenges SET compare_type = ?, compare_question_i18n = ?::jsonb, compare_unit_i18n = ?::jsonb,
                   compare_key = ?, compare_title_i18n = ?::jsonb, price_key = ?, price_label_i18n = ?::jsonb
            WHERE id = ?
        ")->execute([$c['compare_type'], $c['compare_question_i18n'], $c['compare_unit_i18n'],
                     $c['compare_key'], $c['compare_title_i18n'], $c['price_key'], $c['price_label_i18n'], $id]);
    }

    public static function cityIdForSlug(string $slug): ?string
    {
        $slug = DailyRules::slug($slug);
        foreach (CityRepository::all() as $c) {
            if (DailyRules::slug((string) $c['name']) === $slug) {
                return 'city_' . $c['id'];
            }
        }
        return null;
    }

    // ── Back office reads ────────────────────────────────────────────────────

    /** Selected twists of a challenge with their author's username, keyed by city id ('city_N'). */
    public static function twistsFor(string $challengeId): array
    {
        $stmt = Database::pdo()->prepare("
            SELECT t.*, u.username AS author_username
            FROM daily_twists t
            LEFT JOIN users u ON u.id = t.author_user_id
            WHERE t.challenge_id = ? AND t.status = 'selected'
        ");
        $stmt->execute([$challengeId]);
        $out = [];
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $out[$row['city_id']] = $row;
        }
        return $out;
    }

    /** Approved proofs per city and the pending count, for the today panel. */
    public static function todayStats(string $challengeId): array
    {
        $stmt = Database::pdo()->prepare("
            SELECT city_id, count(*) FILTER (WHERE moderation_status = 'approved') AS approved,
                   count(*) FILTER (WHERE moderation_status = 'pending') AS pending
            FROM daily_proofs WHERE challenge_id = ? GROUP BY city_id
        ");
        $stmt->execute([$challengeId]);
        $byCity   = [];
        $approved = 0;
        $pending  = 0;
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $approved += (int) $r['approved'];
            $pending  += (int) $r['pending'];
            if ($r['city_id'] !== null && (int) $r['approved'] > 0) {
                $byCity[$r['city_id']] = (int) $r['approved'];
            }
        }
        arsort($byCity);
        return ['approved' => $approved, 'pending' => $pending, 'byCity' => $byCity];
    }

    /** Latest audit entries, newest first, optionally for one entity type (and id). */
    public static function listAuditLog(int $limit = 100, ?string $entityType = null, ?string $entityId = null): array
    {
        $where = [];
        $args  = [];
        if ($entityType !== null && $entityType !== '') {
            $where[] = 'entity_type = ?';
            $args[]  = $entityType;
        }
        if ($entityId !== null && $entityId !== '') {
            $where[] = 'entity_id = ?';
            $args[]  = $entityId;
        }
        $args[] = $limit;
        $stmt = Database::pdo()->prepare(
            "SELECT * FROM admin_audit_log" . ($where ? ' WHERE ' . implode(' AND ', $where) : '')
            . " ORDER BY id DESC LIMIT ?"
        );
        $stmt->execute($args);
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    /** Resolve "@username" or "username" to a user id, or null. */
    public static function userIdForUsername(string $username): ?string
    {
        $username = ltrim(trim($username), '@');
        if ($username === '') {
            return null;
        }
        $stmt = Database::pdo()->prepare("SELECT id FROM users WHERE lower(username) = lower(?) AND deleted_at IS NULL");
        $stmt->execute([$username]);
        $id = $stmt->fetchColumn();
        return $id === false ? null : (string) $id;
    }

    // ── Internals ────────────────────────────────────────────────────────────

    public static function find(string $id): ?array
    {
        $stmt = Database::pdo()->prepare("SELECT * FROM daily_challenges WHERE id = ?");
        $stmt->execute([$id]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$row) {
            return null;
        }
        $row['is_reserve'] = DailyProofRepository::bool($row['is_reserve']);
        return $row;
    }

    /** Set or clear ($url null) a challenge's cover image (an own upload). Audited. */
    public static function setCover(string $id, ?string $url): array
    {
        $before = self::mustFind($id);
        if ($url !== null && R2Uploader::ownUploadFilename($url) === null) {
            throw new InvalidArgumentException('The cover must be an uploaded image.');
        }
        Database::pdo()->prepare("UPDATE daily_challenges SET cover_url = ?, updated_at = now(), updated_by = ? WHERE id = ?")
            ->execute([$url, self::actorName(), $id]);
        $after = self::mustFind($id);
        self::audit('daily_challenge.cover', 'daily_challenge', $id, ['cover_url' => $before['cover_url'] ?? null], ['cover_url' => $url]);
        return $after;
    }

    private static function mustFind(string $id): array
    {
        $row = self::find($id);
        if ($row === null) {
            throw new InvalidArgumentException('Challenge not found.');
        }
        return $row;
    }

    private static function findTwist(string $id): ?array
    {
        $stmt = Database::pdo()->prepare("SELECT * FROM daily_twists WHERE id = ?");
        $stmt->execute([$id]);
        return $stmt->fetch(PDO::FETCH_ASSOC) ?: null;
    }

    public static function audit(string $action, string $entityType, ?string $entityId, ?array $before, ?array $after): void
    {
        try {
            Database::pdo()->prepare("
                INSERT INTO admin_audit_log (admin_username, admin_ip, action, entity_type, entity_id, before, after)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            ")->execute([
                self::actorName(),
                self::$actor === null ? self::actorIp() : null,
                $action,
                $entityType,
                $entityId,
                $before !== null ? json_encode($before, JSON_UNESCAPED_UNICODE) : null,
                $after !== null ? json_encode($after, JSON_UNESCAPED_UNICODE) : null,
            ]);
        } catch (\Throwable $e) {
            // The change itself succeeded; a lost log line must not undo it.
            error_log("[daily-admin] audit log failed for {$action}: " . $e->getMessage());
        }
    }

    /** Admin IP for the log. The admin bootstrap does not load Request, so fall back to REMOTE_ADDR. */
    private static function actorIp(): ?string
    {
        $ip = class_exists('Request') ? Request::ip() : ($_SERVER['REMOTE_ADDR'] ?? null);
        return is_string($ip) && filter_var($ip, FILTER_VALIDATE_IP) ? $ip : null;
    }

    private static function actorName(): string
    {
        return self::$actor ?? (getenv('ADMIN_USERNAME') ?: 'admin');
    }

    private static function forgetCachedDate(?string $date): void
    {
        if ($date !== null && PHP_SAPI !== 'cli') {
            @unlink(sys_get_temp_dir() . '/hilads_cache_' . md5('daily_challenge_v1_' . $date));
        }
    }

    /** text_i18n JSON for an imported text with its translations (stamped _src). */
    private static function importI18n(?string $en, array $translations): string
    {
        $map = DailyI18n::merge([], $en ?? '', $translations);
        if ($en === null) {
            unset($map['en']);   // no English context: translations only
        }
        return json_encode((object) $map, JSON_UNESCAPED_UNICODE);
    }

    /** daily_twists.text_i18n JSON: translations only, stamped _src with the English. */
    private static function twistI18nJson(string $en, array $translations): string
    {
        $map = DailyI18n::merge([], $en, $translations);
        unset($map['en']);
        return json_encode((object) $map, JSON_UNESCAPED_UNICODE);
    }

    private static function i18n(?string $en): string
    {
        return json_encode($en === null ? new stdClass() : ['en' => $en], JSON_UNESCAPED_UNICODE);
    }

    /**
     * [theme, special id] from the back office theme <select>: a weekly theme
     * (key or name), "special:<id>" (a world special day), or empty ([null, null]).
     */
    private static function themeAndSpecial(mixed $v): array
    {
        if (is_string($v) && str_starts_with($v, 'special:')) {
            $row = DailySpecials::find(substr($v, 8));
            if ($row === null || $row['scope'] !== 'world') {
                throw new InvalidArgumentException('Unknown special day (only world specials replace the theme).');
            }
            return [DailyThemes::SPECIAL, $row['id']];
        }
        return [self::theme($v), null];
    }

    /** A theme key from a form or import value; null when empty. Throws on an unknown theme. */
    private static function theme(mixed $v): ?string
    {
        if ($v === null || (is_string($v) && trim($v) === '')) {
            return null;
        }
        $key = DailyThemes::normalize($v);
        if ($key === null) {
            throw new InvalidArgumentException('Unknown theme.');
        }
        return $key;
    }

    private static function cleanText(mixed $v, int $max, string $field): string
    {
        $s = is_string($v) ? trim($v) : '';
        if ($s === '') {
            throw new InvalidArgumentException("{$field} is required.");
        }
        if (mb_strlen($s) > $max) {
            throw new InvalidArgumentException("{$field} is longer than {$max} characters.");
        }
        return $s;
    }

    private static function cleanOptional(mixed $v, int $max, string $field): ?string
    {
        $s = is_string($v) ? trim($v) : '';
        if ($s === '') {
            return null;
        }
        if (mb_strlen($s) > $max) {
            throw new InvalidArgumentException("{$field} is longer than {$max} characters.");
        }
        return $s;
    }

    private static function editableStatus(mixed $v): string
    {
        if (!in_array($v, ['draft', 'scheduled'], true)) {
            throw new InvalidArgumentException('Status must be draft or scheduled.');
        }
        return $v;
    }

    private static function optionalDate(mixed $v): ?string
    {
        if ($v === null || $v === '') {
            return null;
        }
        self::assertValidDate((string) $v);
        return (string) $v;
    }

    private static function assertValidDate(string $date): void
    {
        if (!DailyClock::isValidDate($date)) {
            throw new InvalidArgumentException('Date must be YYYY-MM-DD.');
        }
    }

    /** Only future drops can be planned: today's challenge is already live (or handled by the drop). */
    private static function assertFutureDate(string $date): void
    {
        if ($date <= DailyClock::currentDate()) {
            throw new InvalidArgumentException("{$date} is not a future drop.");
        }
    }

    private static function assertDateFree(string $date, ?string $exceptId): void
    {
        $stmt = Database::pdo()->prepare("SELECT id FROM daily_challenges WHERE challenge_date = ? AND id IS DISTINCT FROM ?");
        $stmt->execute([$date, $exceptId]);
        if ($stmt->fetchColumn() !== false) {
            throw new InvalidArgumentException("{$date} already has a challenge.");
        }
    }

    private static function assertCity(string $cityId): void
    {
        if (!preg_match('/^city_(\d+)$/', $cityId, $m) || CityRepository::findById((int) $m[1]) === null) {
            throw new InvalidArgumentException('Unknown city.');
        }
    }
}
