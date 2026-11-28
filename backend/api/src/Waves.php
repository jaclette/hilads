<?php

declare(strict_types=1);

/**
 * Wave 👋: a one-tap hello from one member to another (Members screen first;
 * built to be reused on profiles, plan attendees and like lists).
 *
 * - One wave per pair and direction per UTC day; at most MAX_PER_DAY waves sent a day.
 * - Never across a block (either way), never to someone who turned off "Allow
 *   waves", never to a deleted, test or review account, never to yourself.
 * - The recipient gets a bell row and a push "kitty_3 waved at you 👋" (type
 *   wave, push action "Wave back"); a wave that answers theirs is a wave back
 *   (type wave_back, "kitty_3 waved back 🎉"), which suggests opening a chat.
 *
 * The state between the viewer and someone, over the last WINDOW_DAYS days:
 * none (can wave) · sent (waved today, no answer yet) · received (they waved,
 * wave back) · mutual (both waved: "Waved back 🎉", suggest a chat).
 */
final class Waves
{
    public const MAX_PER_DAY = 30;
    public const WINDOW_DAYS = 7;
    public const SOURCES     = ['members', 'here_now', 'profile', 'plan', 'likes', 'notification', 'push'];

    /** The state from the latest wave each way (unix times or null) and today's start (pure, unit-tested). */
    public static function state(?int $lastOut, ?int $lastIn, int $todayStart): string
    {
        if ($lastOut !== null && $lastIn !== null) return 'mutual';
        if ($lastOut !== null && $lastOut >= $todayStart) return 'sent';
        if ($lastIn !== null) return 'received';
        return 'none';
    }

    private static function todayStart(): int
    {
        return (new DateTimeImmutable('today', new DateTimeZone('UTC')))->getTimestamp();
    }

    /** [userId => state] between the viewer and each of $ids. */
    public static function states(string $viewerId, array $ids): array
    {
        $ids = array_values(array_unique(array_filter(array_map('strval', $ids), static fn($i) => $i !== '' && $i !== $viewerId)));
        if ($ids === []) return [];
        try {
            $in   = implode(',', array_fill(0, count($ids), '?'));
            $stmt = Database::pdo()->prepare("
                SELECT from_user_id, to_user_id, extract(epoch FROM max(created_at))::bigint AS at
                FROM waves
                WHERE created_at > now() - interval '" . self::WINDOW_DAYS . " days'
                  AND ((from_user_id = ? AND to_user_id IN ({$in})) OR (to_user_id = ? AND from_user_id IN ({$in})))
                GROUP BY from_user_id, to_user_id
            ");
            $stmt->execute([$viewerId, ...$ids, $viewerId, ...$ids]);
            $sentAt = $gotAt = [];
            foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
                if ($r['from_user_id'] === $viewerId) $sentAt[$r['to_user_id']] = (int) $r['at'];
                else $gotAt[$r['from_user_id']] = (int) $r['at'];
            }
            $today = self::todayStart();
            $res = [];
            foreach ($ids as $id) {
                $res[$id] = self::state($sentAt[$id] ?? null, $gotAt[$id] ?? null, $today);
            }
            return $res;
        } catch (\Throwable $e) {
            error_log('[waves] states failed: ' . $e->getMessage());   // before the migration
            return [];
        }
    }

    /**
     * Send a wave. Returns {state, back}; throws InvalidArgumentException with a
     * code the client can show: not_found (missing, blocked, hidden), self,
     * waves_off, already (today), limit (the daily cap).
     */
    public static function send(array $from, string $toId, string $source = 'members'): array
    {
        $fromId = (string) $from['id'];
        if ($toId === $fromId) throw new InvalidArgumentException('self');
        $pdo  = Database::pdo();
        $stmt = $pdo->prepare("SELECT id, coalesce(allow_waves, true) AS allow FROM users
                               WHERE id = ? AND deleted_at IS NULL AND NOT coalesce(is_fake, false)
                                 AND NOT coalesce(is_demo, false) AND NOT coalesce(is_review, false)");
        $stmt->execute([$toId]);
        $to = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$to || BlockRepository::isBlockedBetween($fromId, null, $toId, null)) throw new InvalidArgumentException('not_found');
        if (!DailyProofRepository::bool($to['allow'])) throw new InvalidArgumentException('waves_off');

        $stmt = $pdo->prepare("SELECT count(*) FROM waves WHERE from_user_id = ? AND wave_day = (now() AT TIME ZONE 'UTC')::date");
        $stmt->execute([$fromId]);
        if ((int) $stmt->fetchColumn() >= self::MAX_PER_DAY) throw new InvalidArgumentException('limit');

        // A wave back: they waved at me in the window and I had not answered since.
        $before = self::states($fromId, [$toId])[$toId] ?? 'none';
        $back   = $before === 'received';

        $stmt = $pdo->prepare("
            INSERT INTO waves (from_user_id, to_user_id, wave_day, is_back, source)
            VALUES (?, ?, (now() AT TIME ZONE 'UTC')::date, ?, ?)
            ON CONFLICT (from_user_id, to_user_id, wave_day) DO NOTHING
            RETURNING id
        ");
        $stmt->execute([$fromId, $toId, $back ? 1 : 0, in_array($source, self::SOURCES, true) ? $source : 'members']);
        $id = $stmt->fetchColumn();
        if ($id === false) throw new InvalidArgumentException('already');

        $name = (string) ($from['username'] ?? '') ?: (string) ($from['display_name'] ?? 'Someone');
        $data = ['actorId' => $fromId, 'actorName' => $name, 'waveId' => (string) $id];
        if ($back) {
            NotificationRepository::create($toId, 'wave_back', "{$name} waved back 🎉", 'Say hi in a chat', $data);
        } else {
            NotificationRepository::create($toId, 'wave', "{$name} waved at you 👋", null, $data);
        }
        return ['state' => self::states($fromId, [$toId])[$toId] ?? 'sent', 'back' => $back];
    }
}
