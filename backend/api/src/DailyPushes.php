<?php

declare(strict_types=1);

/**
 * Daily Challenge pushes: queued with a send time in each recipient's local
 * time, sent by the tick in bounded batches. English only in V1.
 *
 * daily_push_log is both the queue and the log. A recipient is a registered
 * user ('u:<id>') or a guest device ('g:<guestId>'). One row per (recipient,
 * challenge date, type):
 * - morning: queued at the drop for everyone with a device, with yesterday's
 *   outcome for those who posted or voted;
 * - reminder: queued at the drop for registered users active in the last 7
 *   days, at the latest daytime moment 3h before the end; skipped if they
 *   posted meanwhile;
 * - digest: queued when a proof is approved (its author) and at the drop
 *   (Local Twist authors); votes received and twist completions, computed at
 *   send time, skipped when there is no news.
 *
 * Language (prompt 15): the recipient's (users.locale, a guest token's
 * locale). Fixed phrases come from DailyPushText; the morning push carries the
 * founder's translation of the challenge, and is all English when that
 * translation is missing. Reminder and digest store the locale in payload.
 *
 * Cap: 3 Daily pushes per recipient per LOCAL day (local_day), checked when
 * sending. A digest over the cap waits for 09:00 the next local day, once;
 * a morning push or a reminder over the cap is skipped (they are tied to the
 * moment).
 */
final class DailyPushes
{
    public const CAP_PER_DAY   = 3;
    public const BATCH         = 500;   // rows sent per tick
    public const DAY_START     = 9;     // local daytime window: 09:00 ...
    public const DAY_END       = 21;    // ... to 21:00
    public const DIGEST_HOUR   = 20;    // digest at 20:00 local ...
    public const DIGEST_BEFORE = 3600;  // ... or 1h before the end if earlier
    public const DIGEST_AFTER  = 6 * 3600;  // never in the first 6h of the challenge
    public const REMIND_BEFORE = 3 * 3600;  // reminder at least 3h before the end
    public const ACTIVE_DAYS   = 7;     // reminder: app opened in the last 7 days
    public const DEEP_LINK     = 'https://hilads.live/today';
    public const EARLY_WINDOW  = 3 * 3600;  // speed bonus: posted within 3h of the user's start time (V2-07)
    // The Daily Challenge signature sound, on every Daily push (V2-07): the file bundled in the app
    // (assets/sounds, app.json expo-notifications "sounds") and, on Android, the
    // channel created with it (src/services/push.ts). A channel's sound can't
    // change once created: a new sound needs a new file name AND a new channel id.
    public const SIGNATURE_SOUND   = 'daily_signature.wav';
    public const SIGNATURE_CHANNEL = 'daily_challenge_v1';

    // ── Pure helpers (unit-tested) ────────────────────────────────────────────

    /**
     * When a morning push should go out: right away if it is daytime for the
     * recipient (09:00-21:00 local), otherwise at the next 09:00 local.
     */
    public static function morningSendAt(DateTimeImmutable $now, string $timezone): DateTimeImmutable
    {
        $tz    = self::zone($timezone);
        $local = $now->setTimezone($tz);
        $hour  = (int) $local->format('G');
        if ($hour >= self::DAY_START && $hour < self::DAY_END) {
            return $now->setTimezone(new DateTimeZone('UTC'));
        }
        $nine = $local->setTime(self::DAY_START, 0);
        if ($hour >= self::DAY_END) {
            $nine = $nine->modify('+1 day');
        }
        return $nine->setTimezone(new DateTimeZone('UTC'));
    }

    /**
     * A user's start time for a challenge date (V2-07 speed bonus): the
     * morning push rule applied to the drop - the drop if it falls in their
     * daytime, else the next 09:00 local.
     */
    public static function startAt(string $date, string $timezone): DateTimeImmutable
    {
        return self::morningSendAt(DailyClock::dropAt($date), $timezone);
    }

    /** End of the speed bonus window: the start time + 3h. */
    public static function earlyUntil(string $date, string $timezone): DateTimeImmutable
    {
        return self::startAt($date, $timezone)->modify('+' . self::EARLY_WINDOW . ' seconds');
    }

    /** True when a proof posted at $postedAt is early for $date in $timezone. */
    public static function isEarly(string $date, string $timezone, DateTimeImmutable $postedAt): bool
    {
        return $postedAt <= self::earlyUntil($date, $timezone);
    }

    /**
     * Reminder time: the latest moment between 09:00 and 21:00 local that is
     * at least 3h before the end. Null when that falls before the start.
     */
    public static function reminderSendAt(DateTimeImmutable $start, DateTimeImmutable $end, string $timezone): ?DateTimeImmutable
    {
        $local = $end->modify('-' . self::REMIND_BEFORE . ' seconds')->setTimezone(self::zone($timezone));
        $time  = $local->format('H:i:s');
        if ($time > sprintf('%02d:00:00', self::DAY_END)) {
            $local = $local->setTime(self::DAY_END, 0);
        } elseif ($time < sprintf('%02d:00:00', self::DAY_START)) {
            $local = $local->modify('-1 day')->setTime(self::DAY_END, 0);
        }
        $at = $local->setTimezone(new DateTimeZone('UTC'));
        return $at < $start ? null : $at;
    }

    /**
     * Digest time: the first 20:00 local at least 6h into the challenge, or 1h
     * before the end if that is earlier. Either lands in daytime.
     */
    public static function digestSendAt(DateTimeImmutable $start, DateTimeImmutable $end, string $timezone): DateTimeImmutable
    {
        $from = $start->modify('+' . self::DIGEST_AFTER . ' seconds')->setTimezone(self::zone($timezone));
        $at   = $from->setTime(self::DIGEST_HOUR, 0);
        if ($at < $from) {
            $at = $at->modify('+1 day');
        }
        $latest = $end->modify('-' . self::DIGEST_BEFORE . ' seconds');
        return ($at > $latest ? $latest : $at)->setTimezone(new DateTimeZone('UTC'));
    }

    /** Local date (Y-m-d) of $at in $timezone. */
    public static function localDay(DateTimeImmutable $at, string $timezone): string
    {
        return $at->setTimezone(self::zone($timezone))->format('Y-m-d');
    }

    /** First valid IANA zone among the candidates (device, token, city), else UTC. */
    public static function pickTimezone(?string ...$candidates): string
    {
        foreach ($candidates as $tz) {
            if (is_string($tz) && $tz !== '' && DailyRules::isValidTimezone($tz)) {
                return $tz;
            }
        }
        return 'UTC';
    }

    /** 1st, 2nd, 3rd, 4th, 11th, 12th, 13th, 21st, 102nd... */
    public static function ordinal(int $n): string
    {
        $suffix = 'th';
        if (!in_array($n % 100, [11, 12, 13], true)) {
            $suffix = [1 => 'st', 2 => 'nd', 3 => 'rd'][$n % 10] ?? 'th';
        }
        return $n . $suffix;
    }

    /**
     * Yesterday's outcome sentence for the morning push, or null.
     * $mine (an approved proof): worldRank, cityRank, cityBest, votes, cityName.
     * $winner (World rank 1, for voters without a proof): name, cityName, votes.
     * Other locales use the DailyPushText phrases ("#2", no plurals).
     */
    public static function outcomeLine(?array $mine, ?array $winner, string $locale = 'en'): ?string
    {
        if ($locale !== 'en' && DailyPushText::has($locale)) {
            return self::outcomeLineIn($locale, $mine, $winner);
        }
        if ($mine !== null) {
            if ($mine['worldRank'] !== null) {
                return 'Yesterday your proof ranked ' . self::ordinal((int) $mine['worldRank']) . ' in the world 🏆';
            }
            if ($mine['cityBest'] && $mine['cityName'] !== null) {
                return "Yesterday your proof was the best in {$mine['cityName']} 🔥";
            }
            if ($mine['cityRank'] !== null && $mine['cityName'] !== null) {
                return 'Yesterday your proof ranked ' . self::ordinal((int) $mine['cityRank']) . " in {$mine['cityName']}.";
            }
            $votes = (int) $mine['votes'];
            return $votes > 0 ? 'Yesterday your proof got ' . self::plural($votes, 'vote') . '.' : null;
        }
        if ($winner !== null) {
            $where = $winner['cityName'] !== null ? " in {$winner['cityName']}" : '';
            return "Yesterday's winner: {$winner['name']}{$where}, " . self::plural((int) $winner['votes'], 'vote') . '.';
        }
        return null;
    }

    /** outcomeLine() in a non-English locale. */
    private static function outcomeLineIn(string $l, ?array $mine, ?array $winner): ?string
    {
        if ($mine !== null) {
            if ($mine['worldRank'] !== null) {
                return DailyPushText::render('world', $l, ['rank' => $mine['worldRank']]);
            }
            if ($mine['cityBest'] && $mine['cityName'] !== null) {
                return DailyPushText::render('city_best', $l, ['city' => $mine['cityName']]);
            }
            if ($mine['cityRank'] !== null && $mine['cityName'] !== null) {
                return DailyPushText::render('city_rank', $l, ['rank' => $mine['cityRank'], 'city' => $mine['cityName']]);
            }
            return (int) $mine['votes'] > 0 ? DailyPushText::render('votes', $l, ['n' => (int) $mine['votes']]) : null;
        }
        if ($winner !== null) {
            return $winner['cityName'] !== null
                ? DailyPushText::render('winner', $l, ['name' => $winner['name'], 'city' => $winner['cityName'], 'n' => (int) $winner['votes']])
                : DailyPushText::render('winner_nocity', $l, ['name' => $winner['name'], 'n' => (int) $winner['votes']]);
        }
        return null;
    }

    /**
     * The language a recipient's morning push goes out in: theirs when the
     * founder translated today's challenge into it, else English (never a mix).
     */
    public static function morningLocale(array $challenge, string $locale): string
    {
        if ($locale === 'en' || !DailyPushText::has($locale)) {
            return 'en';
        }
        $i18n = json_decode((string) $challenge['text_i18n'], true) ?: [];
        return DailyI18n::pick($i18n, $locale) !== null ? $locale : 'en';
    }

    /**
     * The morning push message for a challenge, with an optional outcome
     * sentence first. $locale must come from morningLocale() (translated text exists).
     */
    public static function morningMessage(array $challenge, ?string $outcome = null, string $locale = 'en'): array
    {
        $i18n = json_decode((string) $challenge['text_i18n'], true) ?: [];
        $text = $i18n['en'] ?? '';
        $body = "Today's Daily Challenge: {$text}";
        $translated = $locale !== 'en' ? DailyI18n::pick($i18n, $locale) : null;
        if ($translated !== null && DailyPushText::has($locale)) {
            $body = (string) DailyPushText::render('frame', $locale, ['text' => $translated]);
        }
        return [
            'title' => 'Daily Challenge',
            'body'  => $outcome !== null ? "{$outcome} {$body}" : $body,
            // No challengeId on purpose: the app's tap fallback would open the
            // legacy challenge screen with it. deepLink = the sheet of today.
            'data'  => self::data((string) $challenge['challenge_date']),
        ];
    }

    /** The reminder, with the hours left at send time (rounded down, at least 1). */
    public static function reminderMessage(string $date, int $secondsLeft, string $locale = 'en'): array
    {
        $hours = max(1, intdiv($secondsLeft, 3600));
        return [
            'title' => 'Daily Challenge',
            'body'  => DailyPushText::render('reminder', $locale, ['h' => $hours])
                       ?? "Only {$hours}h left for today's Daily Challenge.",
            'data'  => self::data($date),
        ];
    }

    /** The digest, or null when there is nothing to tell. */
    public static function digestMessage(string $date, int $votes, int $twistCompletions, string $locale = 'en'): ?array
    {
        $parts = [];
        if ($votes > 0) {
            $parts[] = DailyPushText::render('digest_votes', $locale, ['n' => $votes])
                       ?? self::plural($votes, 'person', 'people') . ' voted for your proof.';
        }
        if ($twistCompletions > 0) {
            $parts[] = DailyPushText::render('digest_twist', $locale, ['n' => $twistCompletions])
                       ?? self::plural($twistCompletions, 'person', 'people') . ' completed your Local Twist.';
        }
        if ($parts === []) {
            return null;
        }
        return ['title' => 'Daily Challenge', 'body' => implode(' ', $parts), 'data' => self::data($date)];
    }

    /** Proposal approved (V2-05, English): its date, or the reserve. */
    public static function proposalApprovedMessage(?string $date): array
    {
        $body = $date !== null
            ? 'Your challenge goes live on ' . (new DateTimeImmutable($date, new DateTimeZone('UTC')))->format('l, F j') . '.'
            : 'Your challenge is in the reserve: it goes live on a day with nothing planned.';
        return ['title' => 'Daily Challenge', 'body' => $body, 'data' => self::data($date ?? DailyClock::currentDate())];
    }

    /** The author's morning push on the day of their challenge (V2-05, English). */
    public static function proposalDayMessage(string $date): array
    {
        return ['title' => 'Daily Challenge', 'body' => 'Today, everyone is doing your challenge.', 'data' => self::data($date)];
    }

    /** The morning after (V2-05, English): how many completed it. */
    public static function proposalResultMessage(string $date, int $completed): array
    {
        return ['title' => 'Daily Challenge',
                'body'  => self::plural($completed, 'person', 'people') . ' completed your challenge.',
                'data'  => self::data($date)];
    }

    /** The top 10 push, with the proof's current World rank (shared on ties). */
    public static function top10Message(string $date, int $rank, string $locale = 'en'): array
    {
        return [
            'title' => 'Daily Challenge',
            'body'  => DailyPushText::render('top10', $locale, ['rank' => $rank])
                       ?? "You're in today's top 10! 🏆 Your proof is #{$rank} in the world right now.",
            'data'  => self::data($date),
        ];
    }

    // ── Test push ────────────────────────────────────────────────────────────

    /**
     * Send the morning push of $challenge to one user's devices now (back
     * office "test push"). Outside daily_push_log, so the cap is untouched.
     * Returns the number of devices it went to.
     */
    public static function sendTest(array $challenge, string $userId): int
    {
        $stmt = Database::pdo()->prepare("SELECT token FROM mobile_push_tokens WHERE user_id = ?");
        $stmt->execute([$userId]);
        $tokens = $stmt->fetchAll(PDO::FETCH_COLUMN);
        if ($tokens === []) {
            return 0;
        }
        $msg = self::morningMessage($challenge);
        $n   = self::sendToDevices($tokens, $msg['title'], $msg['body'], $msg['data'] + ['test' => true], 'daily_morning');
        MobilePushService::flush();
        return $n;
    }

    // ── Queueing ─────────────────────────────────────────────────────────────

    /**
     * Queue the morning push of $challenge for every recipient with a device:
     * registered users with the Daily toggle on, and guest devices (AUDIT Q8).
     * Registered users who posted or voted yesterday get their outcome first.
     * Idempotent (unique recipient/date/type). Returns counts.
     */
    public static function queueMorning(array $challenge, DateTimeImmutable $now): array
    {
        $pdo      = Database::pdo();
        $date     = (string) $challenge['challenge_date'];
        $outcomes = self::outcomes($date);
        $rows     = [];

        $users       = self::userRecipients();
        $withOutcome = 0;
        $author      = $challenge['proposed_by_user_id'] ?? null;
        foreach ($users as $u) {
            if ($u['id'] === $author) {
                // V2-05: the author of today's challenge gets this instead of the usual morning push.
                $rows[] = ['u:' . $u['id'], $u['id'], null, $date, 'proposal_day',
                           self::morningSendAt($now, $u['tz']), $u['tz'], self::proposalDayMessage($date) + ['locale' => 'en']];
                continue;
            }
            $loc          = self::morningLocale($challenge, $u['locale']);
            $o            = $outcomes[$u['id']] ?? null;
            $line         = $o !== null ? self::outcomeLine($o['mine'], $o['winner'], $loc) : null;
            $withOutcome += $line !== null ? 1 : 0;
            $rows[] = ['u:' . $u['id'], $u['id'], null, $date, 'morning',
                       self::morningSendAt($now, $u['tz']), $u['tz'], self::morningMessage($challenge, $line, $loc)];
        }

        // Guest devices: tokens without an account, unless that guest id
        // already belongs to an account (that person is covered above).
        $guests = $pdo->query("
            SELECT t.guest_id, max(t.timezone) AS token_tz, max(t.locale) AS token_locale
            FROM mobile_push_tokens t
            WHERE t.user_id IS NULL AND t.guest_id IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM users u WHERE u.guest_id = t.guest_id)
            GROUP BY t.guest_id
        ")->fetchAll(PDO::FETCH_ASSOC);
        foreach ($guests as $g) {
            $tz     = self::pickTimezone($g['token_tz']);
            $loc    = self::morningLocale($challenge, DailyI18n::normalize($g['token_locale']));
            $rows[] = ['g:' . $g['guest_id'], null, $g['guest_id'], $date, 'morning',
                       self::morningSendAt($now, $tz), $tz, self::morningMessage($challenge, null, $loc)];
        }

        $later = count(array_filter($rows, static fn(array $r): bool => $r[5] > $now));
        return ['users' => count($users), 'guests' => count($guests), 'withOutcome' => $withOutcome,
                'queued' => self::insert($rows), 'deferred' => $later];
    }

    /**
     * Queue the reminder of $date for registered users with a device, the
     * toggle on and the app opened in the last 7 days. Returns counts.
     */
    public static function queueReminders(string $date, DateTimeImmutable $now): array
    {
        [$start, $end] = DailyClock::window($date);
        $users = self::userRecipients(null, $now->modify('-' . self::ACTIVE_DAYS . ' days'));
        $rows  = [];
        foreach ($users as $u) {
            $at = self::reminderSendAt($start, $end, $u['tz']);
            if ($at !== null && $at > $now) {
                // Text built at send time (hours left).
                $rows[] = ['u:' . $u['id'], $u['id'], null, $date, 'reminder', $at, $u['tz'],
                           ['data' => self::data($date), 'locale' => $u['locale']]];
            }
        }
        return ['active' => count($users), 'queued' => self::insert($rows)];
    }

    /**
     * Queue the digest of $date for these users (proof or twist authors).
     * Past its time: the next daytime moment, unless the challenge is over by
     * then. Idempotent. Returns rows queued.
     */
    public static function queueDigests(string $date, array $userIds, DateTimeImmutable $now): int
    {
        if ($userIds === []) {
            return 0;
        }
        [$start, $end] = DailyClock::window($date);
        $rows = [];
        foreach (self::userRecipients(array_values(array_unique($userIds))) as $u) {
            $at = self::digestSendAt($start, $end, $u['tz']);
            if ($at < $now) {
                $at = self::morningSendAt($now, $u['tz']);
            }
            if ($at < $end) {
                // Text built at send time (votes and completions so far).
                $rows[] = ['u:' . $u['id'], $u['id'], null, $date, 'digest', $at, $u['tz'],
                           ['data' => self::data($date), 'locale' => $u['locale']]];
            }
        }
        return self::insert($rows);
    }

    /**
     * One push to one registered user (V2-05 proposal pushes): right away in
     * their daytime, else at 09:00 local. $message is sent as stored. Once per
     * (user, date, type). Returns rows queued (0 without a device or the toggle).
     */
    public static function queueFor(string $type, string $userId, string $date, array $message, DateTimeImmutable $now): int
    {
        $rows = [];
        foreach (self::userRecipients([$userId]) as $u) {
            $rows[] = ['u:' . $u['id'], $u['id'], null, $date, $type, self::morningSendAt($now, $u['tz']), $u['tz'],
                       $message + ['locale' => 'en']];
        }
        return self::insert($rows);
    }

    /**
     * Top 10 push (V2-01) for proof authors who entered the World top 10:
     * right away in their daytime (09:00-21:00 local), else at the next 09:00
     * local, and not at all if that is after the end. Once per user per
     * challenge (unique key), so the tick can call it every time.
     */
    public static function queueTop10(string $date, array $userIds, DateTimeImmutable $now): int
    {
        if ($userIds === []) {
            return 0;
        }
        [, $end] = DailyClock::window($date);
        $rows = [];
        foreach (self::userRecipients(array_values(array_unique($userIds))) as $u) {
            $at = self::morningSendAt($now, $u['tz']);
            if ($at < $end) {
                // Text built at send time (the rank then).
                $rows[] = ['u:' . $u['id'], $u['id'], null, $date, 'top10', $at, $u['tz'],
                           ['data' => self::data($date), 'locale' => $u['locale']]];
            }
        }
        return self::insert($rows);
    }

    /** Digests of the selected Local Twists' authors (registered users), at the drop. */
    public static function queueTwistDigests(array $challenge, DateTimeImmutable $now): int
    {
        $stmt = Database::pdo()->prepare("
            SELECT DISTINCT author_user_id FROM daily_twists
            WHERE challenge_id = ? AND status = 'selected' AND moderation_status = 'approved'
              AND author_user_id IS NOT NULL
        ");
        $stmt->execute([$challenge['id']]);
        return self::queueDigests((string) $challenge['challenge_date'], $stmt->fetchAll(PDO::FETCH_COLUMN), $now);
    }

    // ── Sending ──────────────────────────────────────────────────────────────

    /**
     * Send the pushes due at $now, at most BATCH per call. Re-checks the
     * toggle, the device, the content (reminder already done, digest without
     * news, challenge over) and the cap just before sending. Returns counts.
     */
    public static function sendDue(DateTimeImmutable $now, int $limit = self::BATCH): array
    {
        $pdo   = Database::pdo();
        $claim = $pdo->prepare("
            UPDATE daily_push_log SET status = 'sending'
            WHERE id IN (
                SELECT id FROM daily_push_log
                WHERE status = 'queued' AND send_at <= ?
                ORDER BY send_at
                LIMIT ?
                FOR UPDATE SKIP LOCKED
            )
            RETURNING id, recipient_key, user_id, guest_id, challenge_date, type, payload, timezone
        ");
        $claim->execute([$now->format('Y-m-d H:i:sP'), $limit]);
        $rows = $claim->fetchAll(PDO::FETCH_ASSOC);
        if ($rows === []) {
            return ['claimed' => 0, 'sent' => 0, 'skipped' => 0];
        }

        $keys     = array_values(array_unique(array_column($rows, 'recipient_key')));
        $userIds  = array_values(array_filter(array_unique(array_column($rows, 'user_id'))));
        $guestIds = array_values(array_filter(array_unique(array_column($rows, 'guest_id'))));

        // Already sent per (recipient, local day) - the cap.
        $sentStmt = $pdo->prepare("
            SELECT recipient_key, local_day, count(*) AS n FROM daily_push_log
            WHERE recipient_key = ANY (string_to_array(?, '|')) AND status = 'sent'
              AND local_day >= ?::date - 2
            GROUP BY recipient_key, local_day
        ");
        $sentStmt->execute([implode('|', $keys), $now->format('Y-m-d')]);
        $alreadySent = [];
        foreach ($sentStmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $alreadySent[$r['recipient_key'] . '|' . $r['local_day']] = (int) $r['n'];
        }

        // Users who switched the Daily toggle off since the push was queued.
        $optedOut = [];
        if ($userIds !== []) {
            $s = $pdo->prepare("
                SELECT user_id FROM notification_preferences
                WHERE user_id = ANY (string_to_array(?, ',')) AND NOT daily_challenge_push
            ");
            $s->execute([implode(',', $userIds)]);
            $optedOut = array_flip($s->fetchAll(PDO::FETCH_COLUMN));
        }

        // Devices, by user and by guest.
        $tokensByKey = [];
        if ($userIds !== []) {
            $s = $pdo->prepare("SELECT user_id, token FROM mobile_push_tokens WHERE user_id = ANY (string_to_array(?, ','))");
            $s->execute([implode(',', $userIds)]);
            foreach ($s->fetchAll(PDO::FETCH_ASSOC) as $t) $tokensByKey['u:' . $t['user_id']][] = $t['token'];
        }
        if ($guestIds !== []) {
            $s = $pdo->prepare("
                SELECT guest_id, token FROM mobile_push_tokens
                WHERE user_id IS NULL AND guest_id = ANY (string_to_array(?, ','))
            ");
            $s->execute([implode(',', $guestIds)]);
            foreach ($s->fetchAll(PDO::FETCH_ASSOC) as $t) $tokensByKey['g:' . $t['guest_id']][] = $t['token'];
        }

        $facts = self::sendFacts($rows);

        $sent     = [];   // [id, localDay, payload]
        $skipped  = [];
        $deferred = [];
        foreach ($rows as $row) {
            $tz     = $row['timezone'] ?: 'UTC';
            $day    = self::localDay($now, $tz);
            $capKey = $row['recipient_key'] . '|' . $day;
            $msg    = json_decode((string) $row['payload'], true) ?: [];
            $fk     = $row['user_id'] . '|' . $row['challenge_date'];
            $reason = null;
            if ($row['user_id'] !== null && isset($optedOut[$row['user_id']])) {
                $reason = 'opted_out';
            } elseif (empty($tokensByKey[$row['recipient_key']])) {
                $reason = 'no_device';
            } elseif ($row['type'] === 'reminder') {
                if (!DailyClock::isActive((string) $row['challenge_date'], $now)) {
                    $reason = 'expired';
                } elseif (isset($facts['posted'][$fk])) {
                    $reason = 'done';
                } else {
                    $msg = self::reminderMessage((string) $row['challenge_date'], DailyClock::secondsLeft($now),
                                                 (string) ($msg['locale'] ?? 'en')) + ['locale' => $msg['locale'] ?? 'en'];
                }
            } elseif ($row['type'] === 'digest') {
                $digest = self::digestMessage((string) $row['challenge_date'],
                                              $facts['votes'][$fk] ?? 0, $facts['twist'][$fk] ?? 0, (string) ($msg['locale'] ?? 'en'));
                if ($digest === null) {
                    $reason = 'no_news';
                } else {
                    $msg = $digest + ['deferred' => !empty($msg['deferred']), 'locale' => $msg['locale'] ?? 'en'];
                }
            } elseif ($row['type'] === 'top10') {
                if (!DailyClock::isActive((string) $row['challenge_date'], $now)) {
                    $reason = 'expired';
                } elseif (($rank = DailyLeaderboard::top10RankOf((string) $row['challenge_date'], (string) $row['user_id'])) === null) {
                    $reason = 'left_top10';
                } else {
                    $msg = self::top10Message((string) $row['challenge_date'], $rank, (string) ($msg['locale'] ?? 'en'))
                           + ['locale' => $msg['locale'] ?? 'en'];
                }
            }
            if ($reason === null && ($alreadySent[$capKey] ?? 0) >= self::CAP_PER_DAY) {
                $reason = 'cap';
                if ($row['type'] === 'digest' && empty($msg['deferred'])) {
                    // Wait for the next local day, once.
                    $next = (new DateTimeImmutable($day . ' 00:00:00', self::zone($tz)))
                        ->modify('+1 day')->setTime(self::DAY_START, 0)->setTimezone(new DateTimeZone('UTC'));
                    $deferred[] = [$row['id'], $next, self::localDay($next, $tz)];
                    continue;
                }
            }
            if ($reason !== null) {
                $skipped[$reason][] = $row['id'];
                continue;
            }
            $data = ($msg['data'] ?? self::data((string) $row['challenge_date'])) + ['dailyPushId' => (int) $row['id']];
            self::sendToDevices($tokensByKey[$row['recipient_key']], (string) ($msg['title'] ?? 'Daily Challenge'),
                                (string) ($msg['body'] ?? ''), $data, 'daily_' . $row['type']);
            $alreadySent[$capKey] = ($alreadySent[$capKey] ?? 0) + 1;
            $sent[] = [$row['id'], $day, $msg];
        }

        // Hand everything to Expo now rather than at shutdown, then record it.
        MobilePushService::flush();
        foreach (array_chunk($sent, 200) as $chunk) {
            $values = [];
            $args   = [];
            foreach ($chunk as [$id, $day, $msg]) {
                $values[] = '(?::bigint, ?::date, ?::jsonb)';
                array_push($args, $id, $day, json_encode($msg, JSON_UNESCAPED_UNICODE));
            }
            $pdo->prepare("
                UPDATE daily_push_log d SET status = 'sent', sent_at = now(), local_day = v.day, payload = v.payload
                FROM (VALUES " . implode(', ', $values) . ") AS v(id, day, payload)
                WHERE d.id = v.id
            ")->execute($args);
        }
        $skippedCount = 0;
        foreach ($skipped as $reason => $ids) {
            $pdo->prepare("UPDATE daily_push_log SET status = 'skipped', error = ? WHERE id = ANY (string_to_array(?, ',')::bigint[])")
                ->execute([$reason, implode(',', $ids)]);
            $skippedCount += count($ids);
        }
        foreach ($deferred as [$id, $at, $day]) {
            $pdo->prepare("
                UPDATE daily_push_log
                SET status = 'queued', send_at = ?, local_day = ?, error = 'cap_deferred',
                    payload = payload || '{\"deferred\": true}'::jsonb
                WHERE id = ?
            ")->execute([$at->format('Y-m-d H:i:sP'), $day, $id]);
        }

        $out = ['claimed' => count($rows), 'sent' => count($sent), 'skipped' => $skippedCount,
                'deferred' => count($deferred), 'skippedBy' => array_map('count', $skipped)];
        error_log('[daily-push] ' . json_encode($out));
        return $out;
    }

    // ── Internals ────────────────────────────────────────────────────────────

    /**
     * Facts the reminder and digest rows need, keyed "userId|date":
     * posted (any proof), votes (on the approved proof), twist (approved
     * proofs by others in the city of the user's selected twist).
     */
    private static function sendFacts(array $rows): array
    {
        $facts = ['posted' => [], 'votes' => [], 'twist' => []];
        $users = [];
        $dates = [];
        foreach ($rows as $r) {
            if (($r['type'] === 'reminder' || $r['type'] === 'digest') && $r['user_id'] !== null) {
                $users[$r['user_id']] = true;
                $dates[$r['challenge_date']] = true;
            }
        }
        if ($users === []) {
            return $facts;
        }
        $args = [implode(',', array_keys($users)), implode(',', array_keys($dates))];
        $pdo  = Database::pdo();

        $stmt = $pdo->prepare("
            SELECT p.user_id, c.challenge_date, p.moderation_status, p.vote_count
            FROM daily_proofs p
            JOIN daily_challenges c ON c.id = p.challenge_id
            WHERE p.user_id = ANY (string_to_array(?, ','))
              AND c.challenge_date = ANY (string_to_array(?, ',')::date[])
        ");
        $stmt->execute($args);
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $p) {
            $k = $p['user_id'] . '|' . $p['challenge_date'];
            $facts['posted'][$k] = true;
            if ($p['moderation_status'] === 'approved') {
                $facts['votes'][$k] = (int) $p['vote_count'];
            }
        }

        $stmt = $pdo->prepare("
            SELECT t.author_user_id, c.challenge_date, count(p.id) AS n
            FROM daily_twists t
            JOIN daily_challenges c ON c.id = t.challenge_id
            JOIN daily_proofs p ON p.challenge_id = t.challenge_id AND p.city_id = t.city_id
                               AND p.moderation_status = 'approved' AND p.user_id <> t.author_user_id
            WHERE t.status = 'selected' AND t.moderation_status = 'approved'
              AND t.author_user_id = ANY (string_to_array(?, ','))
              AND c.challenge_date = ANY (string_to_array(?, ',')::date[])
            GROUP BY t.author_user_id, c.challenge_date
        ");
        $stmt->execute($args);
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $t) {
            $facts['twist'][$t['author_user_id'] . '|' . $t['challenge_date']] = (int) $t['n'];
        }
        return $facts;
    }

    /**
     * Yesterday's outcome for the morning of $date, keyed by user id:
     * {mine, winner} for outcomeLine() - approved proofs' authors (mine), then
     * voters without a sentence of their own (winner).
     */
    private static function outcomes(string $date): array
    {
        $yesterday = (new DateTimeImmutable($date, new DateTimeZone('UTC')))->modify('-1 day')->format('Y-m-d');
        $prev      = DailyChallengeRepository::findPublishedByDate($yesterday);
        if ($prev === null) {
            return [];
        }
        $pdo  = Database::pdo();
        $live = array_flip(DailyRules::liveCityIds());
        $out  = [];

        $stmt = $pdo->prepare("
            SELECT p.user_id, p.city_id, p.vote_count, ch.name AS city_name,
                   wr.rank AS world_rank, cr.rank AS city_rank
            FROM daily_proofs p
            LEFT JOIN channels ch ON ch.id = p.city_id
            LEFT JOIN daily_results wr ON wr.challenge_id = p.challenge_id AND wr.scope = 'world' AND wr.proof_id = p.id
            LEFT JOIN daily_results cr ON cr.challenge_id = p.challenge_id AND cr.scope = p.city_id AND cr.proof_id = p.id
            WHERE p.challenge_id = ? AND p.moderation_status = 'approved'
        ");
        $stmt->execute([$prev['id']]);
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $p) {
            $cityRank = $p['city_rank'] !== null ? (int) $p['city_rank'] : null;
            $mine = [
                'worldRank' => $p['world_rank'] !== null ? (int) $p['world_rank'] : null,
                'cityRank'  => $cityRank,
                'cityBest'  => $cityRank === 1 && (int) $p['vote_count'] >= DailyResults::MIN_VOTES_TO_WIN
                               && isset($live[$p['city_id']]),
                'votes'     => (int) $p['vote_count'],
                'cityName'  => $p['city_name'],
            ];
            if (self::outcomeLine($mine, null) !== null) {
                $out[$p['user_id']] = ['mine' => $mine, 'winner' => null];
            }
        }

        $stmt = $pdo->prepare("
            SELECT u.display_name, ch.name AS city_name, r.vote_count
            FROM daily_results r
            JOIN daily_proofs p ON p.id = r.proof_id
            JOIN users u ON u.id = p.user_id
            LEFT JOIN channels ch ON ch.id = p.city_id
            WHERE r.challenge_id = ? AND r.scope = 'world' AND r.rank = 1
        ");
        $stmt->execute([$prev['id']]);
        $w = $stmt->fetch(PDO::FETCH_ASSOC);
        if ($w) {
            $winner = ['name' => $w['display_name'], 'cityName' => $w['city_name'], 'votes' => (int) $w['vote_count']];
            $stmt = $pdo->prepare("SELECT DISTINCT voter_user_id FROM daily_votes WHERE challenge_id = ?");
            $stmt->execute([$prev['id']]);
            foreach ($stmt->fetchAll(PDO::FETCH_COLUMN) as $voterId) {
                $out[$voterId] ??= ['mine' => null, 'winner' => $winner];
            }
        }
        return $out;
    }

    /**
     * Registered users with a device and the Daily toggle on, with their
     * timezone (device > a token's > current city's > UTC). Optionally only
     * $userIds, and only those whose app opened since $activeSince.
     * Returns [{id, tz, locale}].
     */
    /**
     * Send a Daily push to devices with the signature sound (V2-07, the
     * founder's choice: every Daily push) where the device can take it - iOS,
     * and Android once the app declared the Daily channel - and the default
     * sound and channel elsewhere. Other Hilads pushes keep the default.
     * Returns the number of devices.
     */
    public static function sendToDevices(array $tokens, string $title, string $body, array $data, string $type): int
    {
        [$signature, $plain] = MobilePushService::splitForDailySound($tokens, self::SIGNATURE_CHANNEL);
        $n = 0;
        if ($signature !== []) {
            $n += MobilePushService::sendToTokens($signature, $title, $body, $data, $type, self::SIGNATURE_SOUND, self::SIGNATURE_CHANNEL);
        }
        if ($plain !== []) {
            $n += MobilePushService::sendToTokens($plain, $title, $body, $data, $type);
        }
        return $n;
    }

    /** A user's timezone, picked like the pushes': device > a token's > current city's > UTC. */
    public static function userTimezone(string $userId): string
    {
        $stmt = Database::pdo()->prepare("
            SELECT u.timezone AS user_tz, ci.timezone AS city_tz,
                   (SELECT max(t.timezone) FROM mobile_push_tokens t WHERE t.user_id = u.id) AS token_tz
            FROM users u
            LEFT JOIN cities ci ON ci.channel_id = u.current_city_id
            WHERE u.id = ?
        ");
        $stmt->execute([$userId]);
        $r = $stmt->fetch(PDO::FETCH_ASSOC) ?: [];
        return self::pickTimezone($r['user_tz'] ?? null, $r['token_tz'] ?? null, $r['city_tz'] ?? null);
    }

    private static function userRecipients(?array $userIds = null, ?DateTimeImmutable $activeSince = null): array
    {
        $where = 'user_id IS NOT NULL';
        $args  = [];
        if ($userIds !== null) {
            if ($userIds === []) {
                return [];
            }
            $where .= " AND user_id = ANY (string_to_array(?, ','))";
            $args[] = implode(',', $userIds);
        }
        $having = '';
        if ($activeSince !== null) {
            $having = 'HAVING max(last_used_at) >= ?';
            $args[] = $activeSince->format('Y-m-d H:i:sP');
        }
        $stmt = Database::pdo()->prepare("
            WITH ut AS (
                SELECT user_id, max(timezone) AS token_tz
                FROM mobile_push_tokens WHERE {$where}
                GROUP BY user_id {$having}
            )
            SELECT u.id, u.timezone AS user_tz, u.locale, ut.token_tz, ci.timezone AS city_tz
            FROM ut
            JOIN users u ON u.id = ut.user_id AND u.deleted_at IS NULL
            LEFT JOIN cities ci ON ci.channel_id = u.current_city_id
            LEFT JOIN notification_preferences np ON np.user_id = u.id
            WHERE COALESCE(np.daily_challenge_push, true)
        ");
        $stmt->execute($args);
        $out = [];
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $u) {
            $out[] = ['id' => $u['id'], 'tz' => self::pickTimezone($u['user_tz'], $u['token_tz'], $u['city_tz']),
                      'locale' => DailyI18n::normalize($u['locale'])];
        }
        return $out;
    }

    /**
     * Insert queue rows [key, userId, guestId, date, type, sendAt, tz, payload].
     * Idempotent. Returns rows inserted.
     */
    private static function insert(array $rows): int
    {
        $queued = 0;
        foreach (array_chunk($rows, 500) as $chunk) {
            $values = [];
            $args   = [];
            foreach ($chunk as [$key, $userId, $guestId, $date, $type, $sendAt, $tz, $payload]) {
                $values[] = '(?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb)';
                array_push($args, $key, $userId, $guestId, $date, $type, $sendAt->format('Y-m-d H:i:sP'),
                           self::localDay($sendAt, $tz), $tz, json_encode($payload, JSON_UNESCAPED_UNICODE));
            }
            $stmt = Database::pdo()->prepare("
                INSERT INTO daily_push_log (recipient_key, user_id, guest_id, challenge_date, type, send_at, local_day, timezone, payload)
                VALUES " . implode(', ', $values) . "
                ON CONFLICT (recipient_key, challenge_date, type) DO NOTHING
            ");
            $stmt->execute($args);
            $queued += $stmt->rowCount();
        }
        return $queued;
    }

    /** Push data: the challenge date and the web link of today (never a challengeId). */
    private static function data(string $date): array
    {
        return ['date' => $date, 'deepLink' => self::DEEP_LINK];
    }

    private static function plural(int $n, string $one, ?string $many = null): string
    {
        return $n . ' ' . ($n === 1 ? $one : ($many ?? $one . 's'));
    }

    private static function zone(string $timezone): DateTimeZone
    {
        try {
            return new DateTimeZone($timezone);
        } catch (\Throwable) {
            return new DateTimeZone('UTC');
        }
    }
}
