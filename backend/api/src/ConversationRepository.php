<?php

declare(strict_types=1);

class ConversationRepository
{
    // ── DM conversations ──────────────────────────────────────────────────────

    /**
     * Find an existing DM between two users, or create one.
     * Guaranteed unique per pair (order-independent).
     */
    public static function findOrCreateDirect(string $userA, string $userB): array
    {
        $pdo = Database::pdo();

        $stmt = $pdo->prepare("
            SELECT cp1.conversation_id
            FROM conversation_participants cp1
            JOIN conversation_participants cp2
              ON cp1.conversation_id = cp2.conversation_id
             AND cp2.user_id = :userB
            WHERE cp1.user_id = :userA
            LIMIT 1
        ");
        $stmt->execute([':userA' => $userA, ':userB' => $userB]);
        $id = $stmt->fetchColumn();

        if ($id) {
            return self::findById($id);
        }

        $id = bin2hex(random_bytes(16));
        $pdo->prepare("INSERT INTO conversations (id) VALUES (?)")->execute([$id]);
        $pdo->prepare("
            INSERT INTO conversation_participants (conversation_id, user_id) VALUES (?, ?), (?, ?)
        ")->execute([$id, $userA, $id, $userB]);

        return self::findById($id);
    }

    public static function findById(string $id): ?array
    {
        $stmt = Database::pdo()->prepare("SELECT * FROM conversations WHERE id = ?");
        $stmt->execute([$id]);
        return $stmt->fetch(\PDO::FETCH_ASSOC) ?: null;
    }

    public static function isParticipant(string $conversationId, string $userId): bool
    {
        $stmt = Database::pdo()->prepare("
            SELECT 1 FROM conversation_participants
            WHERE conversation_id = ? AND user_id = ?
        ");
        $stmt->execute([$conversationId, $userId]);
        return (bool) $stmt->fetchColumn();
    }

    public static function touchUpdatedAt(string $conversationId): void
    {
        Database::pdo()->prepare("
            UPDATE conversations SET updated_at = now() WHERE id = ?
        ")->execute([$conversationId]);
    }

    /**
     * DM list for a user — with other participant info, last message preview, and unread flag.
     * Two-query approach: main query fetches conversations + last_read_at, then a single batch
     * query checks unread status — avoids one correlated EXISTS subquery per row.
     */
    public static function listDmsForUser(string $userId): array
    {
        $stmt = Database::pdo()->prepare("
            SELECT
                c.id                                            AS id,
                c.updated_at                                    AS updated_at,
                cp2.user_id                                     AS other_user_id,
                COALESCE(u.display_name, 'Deleted user')        AS other_display_name,
                u.profile_photo_url                             AS other_photo_url,
                lm.content              AS last_message,
                lm.created_at           AS last_message_at,
                lm.sender_id            AS last_sender_id,
                cp.last_read_at         AS last_read_at
            FROM conversations c
            JOIN conversation_participants cp  ON cp.conversation_id = c.id AND cp.user_id = :userId
            JOIN conversation_participants cp2 ON cp2.conversation_id = c.id AND cp2.user_id != :userId2
            -- LEFT JOIN + deleted_at filter: deleted users produce NULLs → COALESCE shows fallback
            LEFT JOIN users u ON u.id = cp2.user_id AND u.deleted_at IS NULL
            LEFT JOIN LATERAL (
                SELECT
                    CASE WHEN type = 'image' THEN '📸 Image' ELSE content END AS content,
                    created_at,
                    sender_id
                FROM conversation_messages
                WHERE conversation_id = c.id
                ORDER BY created_at DESC
                LIMIT 1
            ) lm ON true
            ORDER BY COALESCE(lm.created_at, c.updated_at) DESC
            LIMIT 50
        ");
        $stmt->execute([':userId' => $userId, ':userId2' => $userId]);
        $rows = $stmt->fetchAll(\PDO::FETCH_ASSOC);

        if (empty($rows)) {
            return [];
        }

        // Batch unread check — one query for all conversation IDs
        $ids          = array_column($rows, 'id');
        $placeholders = implode(',', array_fill(0, count($ids), '?'));
        $unreadStmt   = Database::pdo()->prepare("
            SELECT conversation_id, MAX(created_at) AS last_other_at
            FROM conversation_messages
            WHERE conversation_id IN ($placeholders)
              AND sender_id != ?
            GROUP BY conversation_id
        ");
        $unreadStmt->execute([...$ids, $userId]);
        $lastOtherAt = [];
        foreach ($unreadStmt->fetchAll(\PDO::FETCH_ASSOC) as $r) {
            $lastOtherAt[$r['conversation_id']] = $r['last_other_at'];
        }

        foreach ($rows as &$row) {
            $convId      = $row['id'];
            $lastOther   = $lastOtherAt[$convId] ?? null;
            $lastRead    = $row['last_read_at'];
            $row['has_unread'] = $lastOther !== null && ($lastRead === null || $lastOther > $lastRead);
            unset($row['last_read_at']);
        }
        return $rows;
    }

    /**
     * Mark a conversation as read for a participant (sets last_read_at = now()).
     * Safe to call multiple times — idempotent.
     */
    public static function markRead(string $conversationId, string $userId): void
    {
        Database::pdo()->prepare("
            UPDATE conversation_participants
            SET last_read_at = now()
            WHERE conversation_id = ? AND user_id = ?
        ")->execute([$conversationId, $userId]);
    }

    /**
     * Event channels this user created or joined (by user_id).
     * Used for the "event chats" section in the conversations list.
     * Two-query approach: main query fetches channels + ep.last_read_at, then a single batch
     * query checks for newer messages — avoids one correlated EXISTS per row.
     */
    public static function listEventChannelsForUser(string $userId): array
    {
        $stmt = Database::pdo()->prepare("
            SELECT
                ch.id                                        AS channel_id,
                ce.title                                     AS title,
                EXTRACT(EPOCH FROM ce.starts_at)::INTEGER    AS starts_at,
                ce.location                                  AS location,
                (ce.created_by = :userId)                    AS is_creator,
                ep.last_read_at                              AS last_read_at
            FROM channels ch
            JOIN channel_events ce ON ce.channel_id = ch.id
            LEFT JOIN event_participants ep
              ON ep.channel_id = ch.id AND ep.user_id = :userId2
            WHERE ch.type   = 'event'
              AND ch.status = 'active'
              AND ce.expires_at > now()
              AND (ce.created_by = :userId3 OR ep.user_id = :userId4)
              AND (
                  ce.occurrence_date IS NULL
                  OR ce.occurrence_date = CURRENT_DATE
              )
            ORDER BY starts_at DESC
            LIMIT 30
        ");
        $stmt->execute([':userId' => $userId, ':userId2' => $userId, ':userId3' => $userId, ':userId4' => $userId]);
        $rows = $stmt->fetchAll(\PDO::FETCH_ASSOC);

        if (empty($rows)) {
            return [];
        }

        // Batch unread check — one query for all channel IDs
        $channelIds   = array_column($rows, 'channel_id');
        $placeholders = implode(',', array_fill(0, count($channelIds), '?'));
        $unreadStmt   = Database::pdo()->prepare("
            SELECT channel_id, MAX(created_at) AS last_msg_at
            FROM messages
            WHERE channel_id IN ($placeholders)
              AND type IN ('text', 'image')
              AND user_id IS DISTINCT FROM ?
            GROUP BY channel_id
        ");
        $unreadStmt->execute([...$channelIds, $userId]);
        $lastMsgAt = [];
        foreach ($unreadStmt->fetchAll(\PDO::FETCH_ASSOC) as $r) {
            $lastMsgAt[$r['channel_id']] = $r['last_msg_at'];
        }

        foreach ($rows as &$row) {
            $chId    = $row['channel_id'];
            $lastMsg = $lastMsgAt[$chId] ?? null;
            $lastRead = $row['last_read_at'];
            $row['has_unread'] = $lastMsg !== null && ($lastRead === null || $lastMsg > $lastRead);
            $row['is_creator'] = (bool) $row['is_creator'];
            $row['starts_at']  = (int)  $row['starts_at'];
            unset($row['last_read_at']);
        }
        return $rows;
    }

    /**
     * Lightweight unread check — returns true if the user has any unread DM or event-channel message.
     * Single query, no lateral joins, no per-row subqueries. Used for the Messages icon dot.
     */
    /**
     * Lightweight unread check — returns true if the user has any unread DM or event-channel message.
     *
     * Event-channel scope intentionally matches listEventChannelsForUser:
     *   - channel must be active (ch.status = 'active')
     *   - event must be today or undated (occurrence_date IS NULL OR = CURRENT_DATE)
     * This prevents expired events from permanently holding stale unread state.
     *
     * Own messages (identified by user_id) are excluded from the unread check.
     */
    public static function hasAnyUnread(string $userId): bool
    {
        $stmt = Database::pdo()->prepare("
            SELECT (
                -- DM conversations: messages from others not yet read
                EXISTS (
                    SELECT 1
                    FROM conversation_participants cp
                    JOIN conversation_messages cm ON cm.conversation_id = cp.conversation_id
                    WHERE cp.user_id = :u1
                      AND cm.sender_id != :u2
                      AND (cp.last_read_at IS NULL OR cm.created_at > cp.last_read_at)
                    LIMIT 1
                )
                OR
                -- Active event chats the user participates in: messages from others not yet read
                EXISTS (
                    SELECT 1
                    FROM event_participants ep
                    JOIN channels ch ON ch.id = ep.channel_id AND ch.status = 'active'
                    JOIN channel_events ce ON ce.channel_id = ep.channel_id
                    JOIN messages m ON m.channel_id = ep.channel_id
                    WHERE ep.user_id = :u3
                      AND ce.expires_at > now()
                      AND m.type IN ('text', 'image')
                      AND m.user_id IS DISTINCT FROM :u4
                      AND (ep.last_read_at IS NULL OR m.created_at > ep.last_read_at)
                      AND (ce.occurrence_date IS NULL OR ce.occurrence_date = CURRENT_DATE)
                    LIMIT 1
                )
            ) AS has_unread
        ");
        $stmt->execute([':u1' => $userId, ':u2' => $userId, ':u3' => $userId, ':u4' => $userId]);
        return (bool) $stmt->fetchColumn();
    }

    /**
     * Mark an event chat as read for a user.
     * Updates last_read_at on the event_participants row where user_id matches.
     * No-op for creator-only users (no participant row) — acceptable for v1.
     */
    public static function markEventRead(string $channelId, string $userId): void
    {
        Database::pdo()->prepare("
            UPDATE event_participants
            SET last_read_at = now()
            WHERE channel_id = ? AND user_id = ?
        ")->execute([$channelId, $userId]);
    }

    // ── Messages ──────────────────────────────────────────────────────────────

    public static function addMessage(
        string $conversationId,
        string $senderId,
        string $content,
        ?string $replyToId = null,
        ?string $replyToNickname = null,
        ?string $replyToContent = null,
        string $replyToType = 'text'
    ): array {
        $id = bin2hex(random_bytes(16));
        Database::pdo()->prepare("
            INSERT INTO conversation_messages
                (id, conversation_id, sender_id, content, type,
                 reply_to_id, reply_to_nickname, reply_to_content, reply_to_type)
            VALUES (?, ?, ?, ?, 'text', ?, ?, ?, ?)
        ")->execute([$id, $conversationId, $senderId, $content,
                     $replyToId, $replyToNickname, $replyToContent, $replyToType]);

        self::touchUpdatedAt($conversationId);

        return self::findMessageById($id);
    }

    public static function addImageMessage(string $conversationId, string $senderId, string $imageUrl): array
    {
        $id = bin2hex(random_bytes(16));
        Database::pdo()->prepare("
            INSERT INTO conversation_messages (id, conversation_id, sender_id, content, type, image_url)
            VALUES (?, ?, ?, '', 'image', ?)
        ")->execute([$id, $conversationId, $senderId, $imageUrl]);

        self::touchUpdatedAt($conversationId);

        return self::findMessageById($id);
    }

    public static function listMessages(string $conversationId, int $limit = 100): array
    {
        $stmt = Database::pdo()->prepare("
            SELECT
                cm.id,
                cm.conversation_id,
                cm.sender_id,
                cm.content,
                cm.type,
                cm.image_url,
                cm.created_at,
                cm.reply_to_id,
                cm.reply_to_nickname,
                cm.reply_to_content,
                cm.reply_to_type,
                COALESCE(u.display_name, 'Deleted user') AS sender_name,
                u.profile_photo_url                       AS sender_photo
            FROM conversation_messages cm
            LEFT JOIN users u ON u.id = cm.sender_id AND u.deleted_at IS NULL
            WHERE cm.conversation_id = ?
            ORDER BY cm.created_at ASC
            LIMIT ?
        ");
        $stmt->execute([$conversationId, $limit]);
        return $stmt->fetchAll(\PDO::FETCH_ASSOC);
    }

    public static function findMessageById(string $id): ?array
    {
        $stmt = Database::pdo()->prepare("
            SELECT
                cm.id,
                cm.conversation_id,
                cm.sender_id,
                cm.content,
                cm.type,
                cm.image_url,
                cm.created_at,
                cm.reply_to_id,
                cm.reply_to_nickname,
                cm.reply_to_content,
                cm.reply_to_type,
                COALESCE(u.display_name, 'Deleted user') AS sender_name,
                u.profile_photo_url                       AS sender_photo
            FROM conversation_messages cm
            LEFT JOIN users u ON u.id = cm.sender_id AND u.deleted_at IS NULL
            WHERE cm.id = ?
        ");
        $stmt->execute([$id]);
        return $stmt->fetch(\PDO::FETCH_ASSOC) ?: null;
    }
}
