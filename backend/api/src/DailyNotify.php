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
            $data = ['proofId' => $p['id'], 'date' => $date, 'voterId' => $voter['id']];
            // Once per voter and photo (a vote withdrawn and cast again tells nothing new).
            if (!self::alreadyTold($p['user_id'], self::TYPE_VOTE, $data, 'voterId')) {
                $name = self::name($voter);
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
            $city = (string) ($proof['city_name'] ?? '');
            $body = DailyPushText::render('bell_twist', self::locale((string) $author), ['name' => $name, 'city' => $city])
                    ?? "{$name} completed your Local Twist in {$city}.";
            self::bell((string) $author, self::TYPE_TWIST, $body, $data);
        } catch (\Throwable $e) {
            error_log('[daily] twist completion notification failed: ' . $e->getMessage());
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
