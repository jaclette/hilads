<?php

declare(strict_types=1);

/**
 * Daily Challenge pushes: queued at the drop with a send time in each
 * recipient's local time, sent by the tick in bounded batches.
 *
 * daily_push_log is both the queue and the log. A recipient is a registered
 * user ('u:<id>') or a guest device ('g:<guestId>'). One row per (recipient,
 * date, type) and three types make the cap of 3 Daily pushes per recipient per
 * challenge day structural; sendDue() still re-checks it, so phase 2 types
 * plug in without changing the rule. English only in V1.
 */
final class DailyPushes
{
    public const CAP_PER_DAY = 3;
    public const BATCH       = 500;   // rows sent per tick
    public const DAY_START   = 9;     // local daytime window: 09:00 ...
    public const DAY_END     = 21;    // ... to 21:00

    /**
     * When a morning push should go out: right away if it is daytime for the
     * recipient (09:00-21:00 local), otherwise at the next 09:00 local. Pure.
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

    /** First valid IANA zone among the candidates (device, token, city), else UTC. Pure. */
    public static function pickTimezone(?string ...$candidates): string
    {
        foreach ($candidates as $tz) {
            if (is_string($tz) && $tz !== '' && DailyRules::isValidTimezone($tz)) {
                return $tz;
            }
        }
        return 'UTC';
    }

    /** The morning push message for a challenge. */
    public static function morningMessage(array $challenge): array
    {
        $text = json_decode((string) $challenge['text_i18n'], true)['en'] ?? '';
        return [
            'title' => 'Daily Challenge',
            'body'  => "Today's Daily Challenge: {$text}",
            // No challengeId on purpose: the app's tap fallback would open the
            // legacy challenge screen with it. deepLink = the sheet of today.
            'data'  => ['date' => $challenge['challenge_date'], 'deepLink' => 'https://hilads.live/today'],
        ];
    }

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
        $n   = MobilePushService::sendToTokens($tokens, $msg['title'], $msg['body'], $msg['data'] + ['test' => true], 'daily_morning');
        MobilePushService::flush();
        return $n;
    }

    /**
     * Queue the morning push of $challenge for every recipient with a device:
     * registered users with the Daily toggle on, and guest devices (AUDIT Q8).
     * Idempotent (unique recipient/date/type). Returns rows queued.
     */
    public static function queueMorning(array $challenge, DateTimeImmutable $now): array
    {
        $pdo     = Database::pdo();
        $message = self::morningMessage($challenge);
        $date    = $challenge['challenge_date'];
        $rows    = [];

        // Registered users with at least one device and the toggle on.
        // Timezone: device (users.timezone) > a token's > current city's > UTC.
        $users = $pdo->query("
            WITH ut AS (
                SELECT user_id, max(timezone) AS token_tz
                FROM mobile_push_tokens WHERE user_id IS NOT NULL
                GROUP BY user_id
            )
            SELECT u.id, u.timezone AS user_tz, ut.token_tz, ci.timezone AS city_tz
            FROM ut
            JOIN users u ON u.id = ut.user_id AND u.deleted_at IS NULL
            LEFT JOIN cities ci ON ci.channel_id = u.current_city_id
            LEFT JOIN notification_preferences np ON np.user_id = u.id
            WHERE COALESCE(np.daily_challenge_push, true)
        ")->fetchAll(PDO::FETCH_ASSOC);
        foreach ($users as $u) {
            $tz = self::pickTimezone($u['user_tz'], $u['token_tz'], $u['city_tz']);
            $rows[] = ['u:' . $u['id'], $u['id'], null, self::morningSendAt($now, $tz)];
        }

        // Guest devices: tokens without an account, unless that guest id
        // already belongs to an account (that person is covered above).
        $guests = $pdo->query("
            SELECT t.guest_id, max(t.timezone) AS token_tz
            FROM mobile_push_tokens t
            WHERE t.user_id IS NULL AND t.guest_id IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM users u WHERE u.guest_id = t.guest_id)
            GROUP BY t.guest_id
        ")->fetchAll(PDO::FETCH_ASSOC);
        foreach ($guests as $g) {
            $tz = self::pickTimezone($g['token_tz']);
            $rows[] = ['g:' . $g['guest_id'], null, $g['guest_id'], self::morningSendAt($now, $tz)];
        }

        $payload = json_encode($message, JSON_UNESCAPED_UNICODE);
        $queued  = 0;
        $now0    = $now->getTimestamp();
        $later   = 0;
        foreach (array_chunk($rows, 500) as $chunk) {
            $values = [];
            $args   = [];
            foreach ($chunk as [$key, $userId, $guestId, $sendAt]) {
                $values[] = "(?, ?, ?, ?, 'morning', ?, ?::jsonb)";
                array_push($args, $key, $userId, $guestId, $date, $sendAt->format('Y-m-d H:i:sP'), $payload);
                if ($sendAt->getTimestamp() > $now0) $later++;
            }
            $stmt = $pdo->prepare("
                INSERT INTO daily_push_log (recipient_key, user_id, guest_id, challenge_date, type, send_at, payload)
                VALUES " . implode(', ', $values) . "
                ON CONFLICT (recipient_key, challenge_date, type) DO NOTHING
            ");
            $stmt->execute($args);
            $queued += $stmt->rowCount();
        }

        return ['users' => count($users), 'guests' => count($guests), 'queued' => $queued, 'deferred' => $later];
    }

    /**
     * Send the pushes due at $now, at most BATCH per call. Re-checks the cap,
     * the toggle and the device just before sending; failures are marked
     * 'skipped' with the reason. Returns counts.
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
            RETURNING id, recipient_key, user_id, guest_id, challenge_date, type, payload
        ");
        $claim->execute([$now->format('Y-m-d H:i:sP'), $limit]);
        $rows = $claim->fetchAll(PDO::FETCH_ASSOC);
        if ($rows === []) {
            return ['claimed' => 0, 'sent' => 0, 'skipped' => 0];
        }

        $keys    = array_values(array_unique(array_column($rows, 'recipient_key')));
        $userIds = array_values(array_filter(array_unique(array_column($rows, 'user_id'))));
        $guestIds = array_values(array_filter(array_unique(array_column($rows, 'guest_id'))));

        // Already sent per (recipient, date) - the cap.
        $sentStmt = $pdo->prepare("
            SELECT recipient_key, challenge_date, count(*) AS n FROM daily_push_log
            WHERE recipient_key = ANY (string_to_array(?, '|')) AND status = 'sent'
            GROUP BY recipient_key, challenge_date
        ");
        $sentStmt->execute([implode('|', $keys)]);
        $alreadySent = [];
        foreach ($sentStmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $alreadySent[$r['recipient_key'] . '|' . $r['challenge_date']] = (int) $r['n'];
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

        $sent = [];
        $skipped = [];
        foreach ($rows as $row) {
            $capKey = $row['recipient_key'] . '|' . $row['challenge_date'];
            $reason = null;
            if (($alreadySent[$capKey] ?? 0) >= self::CAP_PER_DAY) {
                $reason = 'cap';
            } elseif ($row['user_id'] !== null && isset($optedOut[$row['user_id']])) {
                $reason = 'opted_out';
            } elseif (empty($tokensByKey[$row['recipient_key']])) {
                $reason = 'no_device';
            }
            if ($reason !== null) {
                $skipped[$reason][] = $row['id'];
                continue;
            }
            $msg  = json_decode((string) $row['payload'], true) ?: [];
            $data = ($msg['data'] ?? []) + ['dailyPushId' => (int) $row['id']];
            MobilePushService::sendToTokens($tokensByKey[$row['recipient_key']], (string) ($msg['title'] ?? 'Daily Challenge'),
                                            (string) ($msg['body'] ?? ''), $data, 'daily_' . $row['type']);
            $alreadySent[$capKey] = ($alreadySent[$capKey] ?? 0) + 1;
            $sent[] = $row['id'];
        }

        // Hand everything to Expo now rather than at shutdown, then record it.
        MobilePushService::flush();
        if ($sent !== []) {
            $pdo->prepare("UPDATE daily_push_log SET status = 'sent', sent_at = now() WHERE id = ANY (string_to_array(?, ',')::bigint[])")
                ->execute([implode(',', $sent)]);
        }
        $skippedCount = 0;
        foreach ($skipped as $reason => $ids) {
            $pdo->prepare("UPDATE daily_push_log SET status = 'skipped', error = ? WHERE id = ANY (string_to_array(?, ',')::bigint[])")
                ->execute([$reason, implode(',', $ids)]);
            $skippedCount += count($ids);
        }

        $out = ['claimed' => count($rows), 'sent' => count($sent), 'skipped' => $skippedCount,
                'skippedBy' => array_map('count', $skipped)];
        error_log('[daily-push] ' . json_encode($out));
        return $out;
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
