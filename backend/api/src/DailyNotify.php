<?php

declare(strict_types=1);

/**
 * Daily Challenge activity for the bell, and the vote push:
 * - every vote a proof receives: a bell row for its author, in real time
 *   (WebSocket "newNotification"), and a push right away with the voter's
 *   name ("Linh voted for your photo.", every vote since 2026-10-25);
 * - every approved proof in the city of a selected Local Twist, by someone
 *   else: a bell row for the twist's author, in real time, never a push.
 *
 * Rows are written in the recipient's language (DailyPushText). Demo proofs
 * never notify, and the same vote or completion is never told twice (a vote
 * withdrawn and cast again, a proof approved again after an edit). Best
 * effort: a failure here never fails the vote or the approval.
 */
final class DailyNotify
{
    public const TYPE_VOTE  = 'daily_vote';
    public const TYPE_TWIST = 'daily_twist_completed';

    /** After a vote was cast on $proof by $voter. */
    public static function onVote(array $proof, array $voter): void
    {
        try {
            $p = DailyProofRepository::findById((string) $proof['id']);
            if ($p === null || DailyProofRepository::bool($p['is_demo'] ?? false) || $p['user_id'] === $voter['id']) {
                return;
            }
            $date = (string) $p['challenge_date'];
            $name = self::name($voter);
            // voterName: the inbox shows who ("Lan and 3 others liked your photo").
            $data = ['proofId' => $p['id'], 'date' => $date, 'voterId' => $voter['id'], 'voterName' => $name];
            // Once per voter and photo (a vote withdrawn and cast again tells nothing new).
            // V6: the "Likes" toggle mutes both the row and the push.
            if (NotificationRepository::enabledFor($p['user_id'], self::TYPE_VOTE)
                && !self::alreadyTold($p['user_id'], self::TYPE_VOTE, $data, 'voterId')) {
                $body = DailyPushText::render('bell_vote', self::locale($p['user_id']), ['name' => $name])
                        ?? "{$name} voted for your photo.";
                self::bell($p['user_id'], self::TYPE_VOTE, $body, $data);
                DailyPushes::sendVote($p['user_id'], $date, $p['id'], $name);
            }
        } catch (\Throwable $e) {
            error_log('[daily] vote notification failed: ' . $e->getMessage());
        }
    }

    /** After $proof was approved: tell the author of its city's selected Local Twist. */
    public static function onApproved(array $proof): void
    {
        try {
            if (DailyProofRepository::bool($proof['is_demo'] ?? false) || ($proof['city_id'] ?? null) === null) {
                return;
            }
            $stmt = Database::pdo()->prepare("
                SELECT author_user_id FROM daily_twists
                WHERE challenge_id = ? AND city_id = ? AND status = 'selected' AND moderation_status = 'approved'
                  AND author_user_id IS NOT NULL AND author_user_id <> ?
                LIMIT 1
            ");
            $stmt->execute([$proof['challenge_id'], $proof['city_id'], $proof['user_id']]);
            $author = $stmt->fetchColumn();
            if (!$author) {
                return;
            }
            $data = ['proofId' => $proof['id'], 'date' => (string) $proof['challenge_date']];
            if (self::alreadyTold((string) $author, self::TYPE_TWIST, $data)) {
                return;
            }
            $name = self::name($proof);
            $loc  = self::locale((string) $author);
            $city = CityNames::short((string) ($proof['city_name'] ?? ''), $loc);
            $body = DailyPushText::render('bell_twist', $loc, ['name' => $name, 'city' => $city])
                    ?? "{$name} completed your Local Twist in {$city}.";
            self::bell((string) $author, self::TYPE_TWIST, $body, $data);
        } catch (\Throwable $e) {
            error_log('[daily] twist completion notification failed: ' . $e->getMessage());
        }
    }

    /**
     * V6: once a challenge closed (DailyDrop::closeChallenge), each player's
     * outcome in the bell (Game): "Yesterday your photo ranked 2nd in the
     * world." Never a push (the morning push already says it). One row per
     * player and day (dedupe key). Returns the number of rows.
     */
    public static function onResults(array $challenge): int
    {
        $n = 0;
        try {
            $stmt = Database::pdo()->prepare("
                SELECT DISTINCT ON (p.user_id) p.id, p.user_id, p.city_id, p.vote_count, ch.name AS city_name, u.locale,
                       wr.rank AS world_rank, cr.rank AS city_rank
                FROM daily_proofs p
                JOIN users u ON u.id = p.user_id
                LEFT JOIN channels ch ON ch.id = p.city_id
                LEFT JOIN daily_results wr ON wr.challenge_id = p.challenge_id AND wr.scope = 'world' AND wr.proof_id = p.id
                LEFT JOIN daily_results cr ON cr.challenge_id = p.challenge_id AND cr.scope = p.city_id AND cr.proof_id = p.id
                WHERE p.challenge_id = ? AND p.moderation_status = 'approved'
                  AND NOT p.is_demo AND NOT p.is_seed AND NOT p.is_suggestion AND NOT u.is_demo
                ORDER BY p.user_id, wr.rank NULLS LAST, cr.rank NULLS LAST, p.vote_count DESC
            ");
            $stmt->execute([$challenge['id']]);
            $live = array_flip(DailyRules::liveCityIds());
            $date = (string) $challenge['challenge_date'];
            foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $p) {
                $loc      = DailyI18n::normalize($p['locale'] ?? null);
                $cityRank = $p['city_rank'] !== null ? (int) $p['city_rank'] : null;
                $mine = [
                    'worldRank' => $p['world_rank'] !== null ? (int) $p['world_rank'] : null,
                    'cityRank'  => $cityRank,
                    'cityBest'  => $cityRank === 1 && (int) $p['vote_count'] >= DailyResults::MIN_VOTES_TO_WIN && isset($live[$p['city_id']]),
                    'votes'     => (int) $p['vote_count'],
                    'cityName'  => $p['city_name'],
                ];
                $line = DailyPushes::outcomeLine($mine, null, $loc);
                if ($line === null || !NotificationRepository::enabledFor((string) $p['user_id'], 'daily_result')) continue;
                $data = ['date' => $date, 'proofId' => $p['id'], 'cityId' => $p['city_id'], 'cityName' => $p['city_name'],
                         'worldRank' => $mine['worldRank'], 'cityRank' => $cityRank, 'cityBest' => $mine['cityBest'],
                         'votes' => $mine['votes'], 'theme' => $challenge['theme'] ?? null];
                $n += NotificationRepository::createUnchecked((string) $p['user_id'], 'daily_result', 'Daily Challenge', $line, $data, $loc, false) !== [] ? 1 : 0;
            }
        } catch (\Throwable $e) {
            error_log('[daily] results notifications failed: ' . $e->getMessage());
        }
        return $n;
    }

    /** V6: a Local Pass earned (all 7 themes in a city), in the bell (Game), live. */
    public static function onLocalPass(array $proof): void
    {
        try {
            if (!NotificationRepository::enabledFor((string) $proof['user_id'], 'daily_local_pass')) return;
            $loc  = self::locale((string) $proof['user_id']);
            $stmt = Database::pdo()->prepare("SELECT name FROM channels WHERE id = ?");
            $stmt->execute([$proof['city_id']]);
            $city = CityNames::short((string) ($stmt->fetchColumn() ?: ''), $loc);
            $body = DailyPushText::render('bell_local_pass', $loc, ['city' => $city]) ?? "You earned the Local Pass of {$city}! 🎟️";
            self::bell((string) $proof['user_id'], 'daily_local_pass', $body,
                       ['cityId' => (string) $proof['city_id'], 'proofId' => $proof['id'], 'date' => (string) ($proof['challenge_date'] ?? '')]);
        } catch (\Throwable $e) {
            error_log('[daily] local pass notification failed: ' . $e->getMessage());
        }
    }

    /** A bell row without a push, then the same row to the user's open apps (real time). */
    private static function bell(string $userId, string $type, string $body, array $data): void
    {
        $notif = NotificationRepository::createUnchecked($userId, $type, 'Daily Challenge', $body, $data, 'en', false);
        if ($notif !== [] && function_exists('broadcastUserEventToWs')) {
            broadcastUserEventToWs($userId, 'newNotification', $notif);
        }
    }

    /** True when this user already got this notification for the proof (and voter). */
    private static function alreadyTold(string $userId, string $type, array $data, ?string $alsoKey = null): bool
    {
        $sql  = "SELECT 1 FROM notifications WHERE user_id = ? AND type = ? AND data->>'proofId' = ?";
        $args = [$userId, $type, $data['proofId']];
        if ($alsoKey !== null) {
            $sql   .= " AND data->>'{$alsoKey}' = ?";
            $args[] = $data[$alsoKey];
        }
        $stmt = Database::pdo()->prepare($sql . ' LIMIT 1');
        $stmt->execute($args);
        return $stmt->fetchColumn() !== false;
    }

    private static function name(array $person): string
    {
        $name = trim((string) ($person['display_name'] ?? ''));
        return $name !== '' ? $name : (string) ($person['username'] ?? 'Someone');
    }

    private static function locale(string $userId): string
    {
        $stmt = Database::pdo()->prepare("SELECT locale FROM users WHERE id = ?");
        $stmt->execute([$userId]);
        return DailyI18n::normalize($stmt->fetchColumn() ?: null);
    }
}
