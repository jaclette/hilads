<?php

declare(strict_types=1);

/**
 * Friend-request flow.
 *
 * A request lives in `friend_requests` until the receiver accepts/declines or
 * the sender cancels. Only `accepted` requests promote the pair into the
 * existing `user_friends` table (bilateral rows, kept outside this repo for
 * symmetry with the legacy unfriend endpoint).
 *
 * Listing endpoints JOIN `users` here so the clients render avatars + names
 * without a second round-trip per row.
 */
class FriendRequestRepository
{
    // ── Write ─────────────────────────────────────────────────────────────────

    public static function create(string $senderId, string $receiverId): array
    {
        $id = bin2hex(random_bytes(16));
        $stmt = Database::pdo()->prepare("
            INSERT INTO friend_requests (id, sender_id, receiver_id, status)
            VALUES (?, ?, ?, 'pending')
            RETURNING id, sender_id, receiver_id, status,
                      to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS created_at,
                      to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS updated_at
        ");
        $stmt->execute([$id, $senderId, $receiverId]);
        return $stmt->fetch(\PDO::FETCH_ASSOC);
    }

    public static function setStatus(string $id, string $status): void
    {
        Database::pdo()
            ->prepare("UPDATE friend_requests SET status = ?, updated_at = now() WHERE id = ?")
            ->execute([$status, $id]);
    }

    // ── Read ──────────────────────────────────────────────────────────────────

    public static function findById(string $id): ?array
    {
        $stmt = Database::pdo()->prepare("
            SELECT id, sender_id, receiver_id, status,
                   to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS created_at,
                   to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS updated_at
            FROM friend_requests WHERE id = ?
        ");
        $stmt->execute([$id]);
        return $stmt->fetch(\PDO::FETCH_ASSOC) ?: null;
    }

    /**
     * The single pending row between two users in either direction (or null).
     * Used by the send endpoint to detect both idempotent re-sends and the
     * mutual-add case (B already sent A a pending request → auto-accept).
     */
    public static function findPendingBetween(string $userA, string $userB): ?array
    {
        $stmt = Database::pdo()->prepare("
            SELECT id, sender_id, receiver_id, status,
                   to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS created_at,
                   to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS updated_at
            FROM friend_requests
            WHERE status = 'pending'
              AND (
                    (sender_id = ? AND receiver_id = ?)
                 OR (sender_id = ? AND receiver_id = ?)
              )
            LIMIT 1
        ");
        $stmt->execute([$userA, $userB, $userB, $userA]);
        return $stmt->fetch(\PDO::FETCH_ASSOC) ?: null;
    }

    public static function listIncomingPending(string $userId, int $limit = 50, int $offset = 0): array
    {
        $stmt = Database::pdo()->prepare("
            SELECT
                fr.id, fr.sender_id, fr.receiver_id, fr.status,
                to_char(fr.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS created_at,
                to_char(fr.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS updated_at,
                u.id                AS other_user_id,
                u.display_name      AS other_display_name,
                u.profile_photo_url AS other_photo_url,
                u.vibe              AS other_vibe
            FROM friend_requests fr
            JOIN users u ON u.id = fr.sender_id AND u.deleted_at IS NULL
            WHERE fr.receiver_id = :uid AND fr.status = 'pending'
            ORDER BY fr.created_at DESC
            LIMIT :limit OFFSET :offset
        ");
        $stmt->bindValue(':uid', $userId);
        $stmt->bindValue(':limit',  $limit,  \PDO::PARAM_INT);
        $stmt->bindValue(':offset', $offset, \PDO::PARAM_INT);
        $stmt->execute();
        return $stmt->fetchAll(\PDO::FETCH_ASSOC);
    }

    public static function listOutgoingPending(string $userId, int $limit = 50, int $offset = 0): array
    {
        $stmt = Database::pdo()->prepare("
            SELECT
                fr.id, fr.sender_id, fr.receiver_id, fr.status,
                to_char(fr.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS created_at,
                to_char(fr.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS updated_at,
                u.id                AS other_user_id,
                u.display_name      AS other_display_name,
                u.profile_photo_url AS other_photo_url,
                u.vibe              AS other_vibe
            FROM friend_requests fr
            JOIN users u ON u.id = fr.receiver_id AND u.deleted_at IS NULL
            WHERE fr.sender_id = :uid AND fr.status = 'pending'
            ORDER BY fr.created_at DESC
            LIMIT :limit OFFSET :offset
        ");
        $stmt->bindValue(':uid', $userId);
        $stmt->bindValue(':limit',  $limit,  \PDO::PARAM_INT);
        $stmt->bindValue(':offset', $offset, \PDO::PARAM_INT);
        $stmt->execute();
        return $stmt->fetchAll(\PDO::FETCH_ASSOC);
    }

    public static function incomingPendingCount(string $userId): int
    {
        $stmt = Database::pdo()
            ->prepare("SELECT COUNT(*) FROM friend_requests WHERE receiver_id = ? AND status = 'pending'");
        $stmt->execute([$userId]);
        return (int) $stmt->fetchColumn();
    }

    /**
     * Are these two users already friends? Read from user_friends; either
     * direction is fine since the table is bilateral.
     */
    public static function areFriends(string $userA, string $userB): bool
    {
        $stmt = Database::pdo()
            ->prepare("SELECT 1 FROM user_friends WHERE user_id = ? AND friend_id = ?");
        $stmt->execute([$userA, $userB]);
        return (bool) $stmt->fetchColumn();
    }

    /**
     * Promote an accepted request into the bilateral friendship table. Idempotent
     * (ON CONFLICT DO NOTHING) so the request endpoint can call this without a
     * pre-check.
     */
    public static function insertFriendship(string $userA, string $userB): void
    {
        $pdo = Database::pdo();
        $pdo->prepare("INSERT INTO user_friends (user_id, friend_id) VALUES (?, ?) ON CONFLICT DO NOTHING")
            ->execute([$userA, $userB]);
        $pdo->prepare("INSERT INTO user_friends (user_id, friend_id) VALUES (?, ?) ON CONFLICT DO NOTHING")
            ->execute([$userB, $userA]);
    }
}
