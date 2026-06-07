<?php

declare(strict_types=1);

// ── WS broadcast helper ───────────────────────────────────────────────────────
// Fire-and-forget: tells the WS server to push a newMessage event to room members.
// channelId: int for city channels, string (hex) for event channels.
function apiLog(string $scope, string $message, array $context = []): void
{
    $parts = [];
    foreach ($context as $key => $value) {
        if ($value === null) {
            continue;
        }
        if (is_bool($value)) {
            $value = $value ? 'true' : 'false';
        }
        if (is_scalar($value)) {
            $parts[] = $key . '=' . $value;
        } else {
            $parts[] = $key . '=' . json_encode($value);
        }
    }

    error_log(sprintf('[%s] %s%s', $scope, $message, $parts ? ' | ' . implode(' ', $parts) : ''));
}

function apiElapsedMs(float $startedAt): int
{
    return (int) round((microtime(true) - $startedAt) * 1000);
}

function broadcastMessageToWs(int|string $channelId, array $message): void
{
    $wsUrl   = rtrim(getenv('WS_INTERNAL_URL') ?: 'http://localhost:8082', '/');
    $payload = json_encode(['channelId' => $channelId, 'message' => $message]);
    $token   = getenv('WS_INTERNAL_TOKEN') ?: '';
    $target  = $wsUrl . '/broadcast/message';

    $headers = "Content-Type: application/json\r\nContent-Length: " . strlen($payload) . "\r\n";
    if ($token !== '') {
        $headers .= "X-Internal-Token: {$token}\r\n";
    }

    $ctx = stream_context_create([
        'http' => [
            'method'        => 'POST',
            'header'        => $headers,
            'content'       => $payload,
            'timeout'       => 2,
            'ignore_errors' => true,
        ],
    ]);

    $result = @file_get_contents($target, false, $ctx);
    if ($result === false) {
        $err = error_get_last();
        error_log("[ws-broadcast] ✗ FAILED target={$target} channelId=" . json_encode($channelId) . " error=" . ($err['message'] ?? 'unknown'));
    }
}

// ── Enrich broadcast message with sender identity ─────────────────────────────
// Attaches primaryBadge, contextBadge, mode, and vibe to a message array before
// it is broadcast over WS, so real-time recipients get the same context as
// messages loaded from history.
// contextBadge is always null here (ambassador check costs an extra query;
// the rare ambassador user still gets it on history reload).
function enrichBroadcastMessage(array $message, ?array $senderUser): array
{
    if ($senderUser !== null) {
        $message['primaryBadge'] = UserBadgeService::primaryForUser($senderUser);
        $message['mode']         = $senderUser['mode'] ?? 'exploring';
        $message['vibe']         = $senderUser['vibe'] ?? null;
    } else {
        $message['primaryBadge'] = ['key' => 'ghost', 'label' => '👻 Ghost'];
        $message['mode']         = null;
        $message['vibe']         = null;
    }
    $message['contextBadge'] = null;
    return $message;
}

// ── Reply snapshot helper ─────────────────────────────────────────────────────
// Looks up a message by ID and returns the snapshot fields needed to store with
// a reply. Returns null when the ID is missing or invalid (no 400 error — we
// just store a reply without a snapshot rather than blocking the send).
function resolveReplySnapshot(?string $replyToId, string $table = 'messages'): ?array
{
    if (empty($replyToId)) return null;
    $col = $table === 'conversation_messages' ? 'cm' : 'm';
    $sql = $table === 'conversation_messages'
        ? "SELECT cm.id,
                  COALESCE(u.display_name, 'Deleted user') AS nickname,
                  cm.content, cm.type
             FROM conversation_messages cm
             LEFT JOIN users u ON u.id = cm.sender_id
            WHERE cm.id = ?"
        : "SELECT m.id, m.nickname, m.content, m.type
             FROM messages m
            WHERE m.id = ?";
    $stmt = Database::pdo()->prepare($sql);
    $stmt->execute([$replyToId]);
    $row = $stmt->fetch();
    if (!$row) return null;
    return [
        'id'       => $row['id'],
        'nickname' => $row['nickname'] ?? '',
        'content'  => $row['type'] === 'image' ? '' : mb_substr((string)($row['content'] ?? ''), 0, 200),
        'type'     => $row['type'] ?? 'text',
    ];
}

// ── Broadcast helpers ─────────────────────────────────────────────────────────
// Fire-and-forget: post a payload to the WS server's internal broadcast endpoint.
// Shared by new-event and new-topic broadcasts.
function postToWs(string $path, array $payload): void
{
    $wsUrl   = rtrim(getenv('WS_INTERNAL_URL') ?: 'http://localhost:8082', '/');
    $json    = json_encode($payload);
    $token   = getenv('WS_INTERNAL_TOKEN') ?: '';
    $target  = $wsUrl . $path;

    $headers = "Content-Type: application/json\r\nContent-Length: " . strlen($json) . "\r\n";
    if ($token !== '') {
        $headers .= "X-Internal-Token: {$token}\r\n";
    }

    $ctx = stream_context_create([
        'http' => [
            'method'        => 'POST',
            'header'        => $headers,
            'content'       => $json,
            'timeout'       => 2,
            'ignore_errors' => true,
        ],
    ]);

    $result = @file_get_contents($target, false, $ctx);
    $status = isset($http_response_header) ? ($http_response_header[0] ?? 'no-header') : 'no-response';
    if ($result === false) {
        $err = error_get_last();
        error_log("[ws-broadcast] ✗ FAILED target={$target} error=" . ($err['message'] ?? 'unknown'));
    } else {
        error_log("[ws-broadcast] ✓ OK status=\"{$status}\" path={$path}");
    }
}

// channelId: integer city room key (matches WS server rooms Map).
// ── Reaction broadcast helper ─────────────────────────────────────────────────
// Fire-and-forget: pushes a reactionUpdate event to channel/conversation rooms.
function broadcastReactionToWs(int|string $channelId, string $messageId, array $reactions): void
{
    postToWs('/broadcast/reaction', [
        'channelId' => $channelId,
        'messageId' => $messageId,
        'reactions' => $reactions,
    ]);
}

function broadcastDmReactionToWs(string $conversationId, string $messageId, array $reactions): void
{
    postToWs('/broadcast/dm-reaction', [
        'conversationId' => $conversationId,
        'messageId'      => $messageId,
        'reactions'      => $reactions,
    ]);
}

// ── Edit / delete broadcast helpers ───────────────────────────────────────────
// Fire-and-forget: pushes messageEdited / messageDeleted events to channel or
// conversation rooms so all live viewers update the bubble (or render the
// "(edited)" tag / tombstone) without a refetch.

function broadcastMessageEditedToWs(int|string $channelId, string $messageId, string $content, int $editedAt): void
{
    postToWs('/broadcast/message-edited', [
        'channelId' => $channelId,
        'messageId' => $messageId,
        'content'   => $content,
        'editedAt'  => $editedAt,
    ]);
}

function broadcastMessageDeletedToWs(int|string $channelId, string $messageId, int $deletedAt): void
{
    postToWs('/broadcast/message-deleted', [
        'channelId' => $channelId,
        'messageId' => $messageId,
        'deletedAt' => $deletedAt,
    ]);
}

function broadcastDmMessageEditedToWs(string $conversationId, string $messageId, string $content, string $editedAt): void
{
    postToWs('/broadcast/dm-message-edited', [
        'conversationId' => $conversationId,
        'messageId'      => $messageId,
        'content'        => $content,
        'editedAt'       => $editedAt,
    ]);
}

function broadcastDmMessageDeletedToWs(string $conversationId, string $messageId, string $deletedAt): void
{
    postToWs('/broadcast/dm-message-deleted', [
        'conversationId' => $conversationId,
        'messageId'      => $messageId,
        'deletedAt'      => $deletedAt,
    ]);
}

// ── Reaction toggle helper ────────────────────────────────────────────────────
// Shared by channel and event reaction endpoints (both use `message_reactions` table).
// Returns ['reactions' => [...], 'added' => bool].
function toggleMessageReaction(string $messageId, string $emoji, ?string $guestId, ?string $userId): array
{
    $pdo = Database::pdo();

    if ($userId !== null) {
        // Registered user — keyed on user_id
        $stmt = $pdo->prepare("SELECT id FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?");
        $stmt->execute([$messageId, $userId, $emoji]);
        $existing = $stmt->fetch();
        if ($existing) {
            $pdo->prepare("DELETE FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?")->execute([$messageId, $userId, $emoji]);
            $added = false;
        } else {
            $pdo->prepare("INSERT INTO message_reactions (message_id, user_id, guest_id, emoji) VALUES (?, ?, ?, ?)")->execute([$messageId, $userId, $guestId, $emoji]);
            $added = true;
        }
    } elseif ($guestId !== null) {
        // Guest user — keyed on guest_id, no user_id row
        $stmt = $pdo->prepare("SELECT id FROM message_reactions WHERE message_id = ? AND guest_id = ? AND user_id IS NULL AND emoji = ?");
        $stmt->execute([$messageId, $guestId, $emoji]);
        $existing = $stmt->fetch();
        if ($existing) {
            $pdo->prepare("DELETE FROM message_reactions WHERE message_id = ? AND guest_id = ? AND user_id IS NULL AND emoji = ?")->execute([$messageId, $guestId, $emoji]);
            $added = false;
        } else {
            $pdo->prepare("INSERT INTO message_reactions (message_id, guest_id, emoji) VALUES (?, ?, ?)")->execute([$messageId, $guestId, $emoji]);
            $added = true;
        }
    } else {
        Response::json(['error' => 'Actor identity required (guestId or auth token)'], 400);
    }

    // Return updated reactions for this message with self flag for current actor.
    // Dynamic self-expression avoids ? IS NULL / ? IS NOT NULL — PostgreSQL native
    // prepared statements cannot infer the type of a NULL parameter with no context.
    $selfExpr   = 'FALSE';
    $selfParams = [];
    if ($userId !== null) {
        $selfExpr   = 'user_id = ?';
        $selfParams = [$userId];
    } elseif ($guestId !== null) {
        $selfExpr   = '(guest_id = ? AND user_id IS NULL)';
        $selfParams = [$guestId];
    }

    $stmt2 = $pdo->prepare("
        SELECT emoji,
               COUNT(*)               AS cnt,
               BOOL_OR({$selfExpr})   AS self_reacted
          FROM message_reactions
         WHERE message_id = ?
         GROUP BY emoji
         ORDER BY MIN(created_at) ASC
    ");
    $stmt2->execute(array_merge($selfParams, [$messageId]));

    $reactions = array_map(fn($r) => [
        'emoji' => $r['emoji'],
        'count' => (int) $r['cnt'],
        'self'  => (bool) $r['self_reacted'],
    ], $stmt2->fetchAll());

    return ['reactions' => $reactions, 'added' => $added];
}

function broadcastNewEventToWs(int $channelId, array $hiladsEvent): void
{
    error_log("[ws-broadcast] → new-event channelId={$channelId}");
    postToWs('/broadcast/new-event', ['channelId' => $channelId, 'hiladsEvent' => $hiladsEvent]);
}

function broadcastNewTopicToWs(int $channelId, array $topic): void
{
    error_log("[ws-broadcast] → new-topic channelId={$channelId} topicId=" . ($topic['id'] ?? 'null'));
    postToWs('/broadcast/new-topic', ['channelId' => $channelId, 'topic' => $topic]);
}

function broadcastNewChallengeToWs(int $channelId, array $challenge): void
{
    error_log("[ws-broadcast] → new-challenge channelId={$channelId} challengeId=" . ($challenge['id'] ?? 'null'));
    postToWs('/broadcast/new-challenge', ['channelId' => $channelId, 'challenge' => $challenge]);
}

function broadcastChallengeValidatedToWs(int $channelId, array $challenge): void
{
    error_log("[ws-broadcast] → challenge-validated channelId={$channelId} challengeId=" . ($challenge['id'] ?? 'null'));
    postToWs('/broadcast/challenge-validated', ['channelId' => $channelId, 'challenge' => $challenge]);
}

function broadcastChallengeUnvalidatedToWs(int $channelId, array $challenge): void
{
    error_log("[ws-broadcast] → challenge-unvalidated channelId={$channelId} challengeId=" . ($challenge['id'] ?? 'null'));
    postToWs('/broadcast/challenge-unvalidated', ['channelId' => $channelId, 'challenge' => $challenge]);
}

/**
 * PR2 — challenge take-on lifecycle. Both events use the generic /broadcast/user-event
 * route on the WS server, which fans out to a single user's connected sessions.
 * No new WS routes needed for accept/cancel notifications.
 *
 * Chat messages inside the thread channel (type='challenge_thread') use the
 * existing /broadcast/message path; the WS server needs join/leave + a
 * challengeThreadRooms map to route them (PR2.B).
 */
function broadcastChallengeAcceptedToWs(string $creatorUserId, array $payload): void
{
    error_log("[ws-broadcast] → challenge-accepted target=user:{$creatorUserId} acceptanceId=" . ($payload['acceptance']['id'] ?? 'null'));
    postToWs('/broadcast/user-event', [
        'userId'  => $creatorUserId,
        'event'   => 'challenge_accepted',
        'payload' => $payload,
    ]);
}

function broadcastChallengeAcceptanceCancelledToWs(string $targetUserId, array $payload): void
{
    error_log("[ws-broadcast] → challenge-acceptance-cancelled target=user:{$targetUserId} acceptanceId=" . ($payload['acceptanceId'] ?? 'null'));
    postToWs('/broadcast/user-event', [
        'userId'  => $targetUserId,
        'event'   => 'challenge_acceptance_cancelled',
        'payload' => $payload,
    ]);
}

/**
 * PR3 — date concertation events. All three reuse /broadcast/user-event and
 * fire to a single target user (the OTHER party of the thread). For sync
 * across the proposer's own devices, the proposer fans-out client-side after
 * the HTTP response — keeps server WS push to one packet per state change.
 */
function broadcastChallengeDateProposedToWs(string $targetUserId, array $payload): void
{
    error_log("[ws-broadcast] → challenge-date-proposed target=user:{$targetUserId} acceptanceId=" . ($payload['acceptanceId'] ?? 'null'));
    postToWs('/broadcast/user-event', [
        'userId'  => $targetUserId,
        'event'   => 'challenge_date_proposed',
        'payload' => $payload,
    ]);
}

function broadcastChallengeDateApprovedToWs(string $targetUserId, array $payload): void
{
    error_log("[ws-broadcast] → challenge-date-approved target=user:{$targetUserId} acceptanceId=" . ($payload['acceptanceId'] ?? 'null'));
    postToWs('/broadcast/user-event', [
        'userId'  => $targetUserId,
        'event'   => 'challenge_date_approved',
        'payload' => $payload,
    ]);
}

function broadcastChallengeDateWithdrawnToWs(string $targetUserId, array $payload): void
{
    error_log("[ws-broadcast] → challenge-date-withdrawn target=user:{$targetUserId} acceptanceId=" . ($payload['acceptanceId'] ?? 'null'));
    postToWs('/broadcast/user-event', [
        'userId'  => $targetUserId,
        'event'   => 'challenge_date_withdrawn',
        'payload' => $payload,
    ]);
}

/** PR5 — creator approved or rejected a pending take-on request. payload.decision = 'approved' | 'rejected' */
function broadcastChallengeTakeOnReviewedToWs(string $targetUserId, array $payload): void
{
    error_log("[ws-broadcast] → challenge-takeon-reviewed target=user:{$targetUserId} acceptanceId=" . ($payload['acceptanceId'] ?? 'null') . ' decision=' . ($payload['decision'] ?? 'null'));
    postToWs('/broadcast/user-event', [
        'userId'  => $targetUserId,
        'event'   => 'challenge_takeon_reviewed',
        'payload' => $payload,
    ]);
}

/** PR4 — debrief verdicts. Same shape as proposed/approved/withdrawn. */
function broadcastChallengeVerdictToWs(string $targetUserId, string $verdict, array $payload): void
{
    $event = $verdict === 'approved' ? 'challenge_verdict_approved' : 'challenge_verdict_rejected';
    error_log("[ws-broadcast] → {$event} target=user:{$targetUserId} acceptanceId=" . ($payload['acceptanceId'] ?? 'null'));
    postToWs('/broadcast/user-event', [
        'userId'  => $targetUserId,
        'event'   => $event,
        'payload' => $payload,
    ]);
}


// ── Now-feed DTO helpers ──────────────────────────────────────────────────────
// Normalize raw repository rows into a consistent FeedItem shape consumed by
// both the web app and the React Native app.
//
// Canonical fields on EVERY item:
//   kind             "event" | "topic"
//   id               string
//   title            string
//   description      string|null   (event location/venue -or- topic description)
//   created_at       int           unix timestamp
//   last_activity_at int|null      unix timestamp (null for events)
//   active_now       bool          true if live event or topic active in last 30 min
//
// Additional event-only fields:
//   event_type       string        canonical (same value as legacy "type")
//   source_type      string        canonical (same value as legacy "source")
//   type             string        kept for backward-compat web rendering
//   source           string        kept for backward-compat web rendering
//   starts_at, ends_at, expires_at, location, venue, participant_count,
//   participants_preview, is_participating, recurrence_label, guest_id, created_by, series_id
//
// Additional topic-only fields:
//   category, message_count, expires_at, city_id

function normalizeFeedEvent(array $e, int $now): array
{
    $isLive = ($e['starts_at'] ?? 0) <= $now && ($e['expires_at'] ?? 0) > $now;
    return array_merge($e, [
        'kind'             => 'event',
        // Canonical aliases — these are the field names native uses
        'event_type'       => $e['type']   ?? $e['event_type']   ?? 'other',
        'source_type'      => $e['source'] ?? $e['source_type']  ?? 'hilads',
        // Shared normalised fields
        'description'      => $e['location'] ?? $e['venue'] ?? null,
        'active_now'       => $isLive,
        'last_activity_at' => null,
        // Participation defaults so the field is always present
        'participant_count' => (int) ($e['participant_count'] ?? 0),
        'is_participating'  => (bool) ($e['is_participating']  ?? false),
    ]);
}

function normalizeFeedTopic(array $t, int $now): array
{
    $activeNow = isset($t['last_activity_at']) && $t['last_activity_at'] > ($now - 1800);
    return array_merge($t, [
        'kind'        => 'topic',
        'description' => $t['description'] ?? null,
        'active_now'  => $activeNow,
    ]);
}

// Past archive entry for a validated challenge — mirrors normalizeFeedEvent /
// normalizeFeedTopic so the /past endpoint can return a homogeneous FeedItem
// array regardless of source. Validated challenges are evergreen (no expiry),
// so active_now is always false in this archive context.
function normalizeFeedChallenge(array $c, int $now): array
{
    return array_merge($c, [
        'kind'       => 'challenge',
        'active_now' => false,
    ]);
}

// ── Conversation broadcast helper ─────────────────────────────────────────────
// Fire-and-forget: tells the WS server to push a newConversationMessage event.
function broadcastConversationMessageToWs(string $conversationId, array $message): void
{
    $wsUrl   = rtrim(getenv('WS_INTERNAL_URL') ?: 'http://localhost:8082', '/');
    $payload = json_encode(['conversationId' => $conversationId, 'message' => $message]);
    $token   = getenv('WS_INTERNAL_TOKEN') ?: '';
    $target  = $wsUrl . '/broadcast/conversation-message';

    error_log("[ws-broadcast] → target={$target} conversationId=" . substr($conversationId, 0, 8) . " token=" . ($token !== '' ? 'set' : 'none'));

    $headers = "Content-Type: application/json\r\nContent-Length: " . strlen($payload) . "\r\n";
    if ($token !== '') {
        $headers .= "X-Internal-Token: {$token}\r\n";
    }

    $ctx = stream_context_create([
        'http' => [
            'method'        => 'POST',
            'header'        => $headers,
            'content'       => $payload,
            'timeout'       => 2,
            'ignore_errors' => true,
        ],
    ]);

    $result = @file_get_contents($target, false, $ctx);
    $status = isset($http_response_header) ? ($http_response_header[0] ?? 'no-header') : 'no-response';
    if ($result === false) {
        $err = error_get_last();
        error_log("[ws-broadcast] ✗ FAILED target={$target} error=" . ($err['message'] ?? 'unknown'));
    } else {
        error_log("[ws-broadcast] ✓ OK status=\"{$status}\" body=" . substr((string)$result, 0, 100));
    }
}

// ── Per-user broadcast helper ─────────────────────────────────────────────────
// Pushes an event to every WS socket the given userId has open. Used by
// friend-request flows so the sender's profile flips state instantly when the
// receiver accepts/declines, and the receiver's inbox updates when the sender
// cancels. Fire-and-forget — failure to reach the WS server is logged but
// never fails the HTTP request.
function broadcastUserEventToWs(string $userId, string $event, array $payload = []): void
{
    postToWs('/broadcast/user-event', ['userId' => $userId, 'event' => $event, 'payload' => $payload]);
}

// Read a boolean feature flag from the environment. Truthy values: "1",
// "true", "on", "yes" (case-insensitive). Anything else (including unset)
// is falsy. Used for Phase C/D rollouts of the city-membership refactor.
function featureEnabled(string $name): bool
{
    $v = strtolower(trim((string) getenv($name)));
    return $v === '1' || $v === 'true' || $v === 'on' || $v === 'yes';
}

function enforceRateLimit(string $bucket, int $limit, int $windowSeconds, ?string $suffix = null): void
{
    $key = $bucket . '|' . Request::ip();
    if ($suffix !== null && $suffix !== '') {
        $key .= '|' . $suffix;
    }

    if (!RateLimiter::allow($key, $limit, $windowSeconds)) {
        Response::json(['error' => 'Too many requests'], 429);
    }
}

function isValidGuestId(mixed $guestId): bool
{
    return is_string($guestId) && preg_match('/^[a-f0-9]{32}$/', $guestId) === 1;
}

function isValidSessionId(mixed $sessionId): bool
{
    return is_string($sessionId)
        && preg_match('/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i', $sessionId) === 1;
}

/**
 * Sanitize client-supplied @mentions against a context's mentionable user set.
 * $context: 'city' | 'event' | 'topic'. $dbChannelId: the messages.channel_id key
 * ('city_N', eventId, or topicId). Returns clean [{userId,offset,length}].
 */
function sanitizeMentions(mixed $raw, string $context, string $dbChannelId, string $content): array
{
    if (empty($raw) || !is_array($raw)) return [];
    $allowed = MentionService::mentionableUserIds($context, $dbChannelId);

    // Online guests are mentionable too — but only in a CITY channel and only
    // while currently present (live-only). Resolve the online-guest set lazily:
    // only when the client actually included a guest mention, so the common
    // members-only message path pays no extra presence query.
    $allowedGuests = [];
    if ($context === 'city' && preg_match('/^city_(\d+)$/', $dbChannelId, $mm)) {
        $hasGuestMention = false;
        foreach ($raw as $m) {
            if (is_array($m) && isset($m['guestId']) && is_string($m['guestId'])) { $hasGuestMention = true; break; }
        }
        if ($hasGuestMention) {
            foreach (PresenceRepository::getOnline((int) $mm[1]) as $row) {
                // Only true guests (no users row) are guest-mentionable; registered
                // users present here are mentioned via the member (userId) path.
                if (empty($row['userId']) && !empty($row['guestId'])) {
                    $allowedGuests[] = $row['guestId'];
                }
            }
        }
    }

    if (empty($allowed) && empty($allowedGuests)) return [];
    return MentionService::sanitize($raw, $allowed, strlen($content), $allowedGuests);
}

/**
 * Fire a 'mention' notification to each mentioned user — deduped by userId, author
 * excluded. NotificationRepository::create gates on the recipient's mention_push
 * pref. $data carries the deep-link context (eventId|topicId|channelId) + messageId.
 * Non-fatal: a notification failure never blocks the message response.
 */
function notifyMentions(array $mentions, ?string $senderUserId, string $title, ?string $body, array $data): void
{
    $seen = [];
    foreach ($mentions as $m) {
        $uid = $m['userId'] ?? null;
        if (!is_string($uid) || $uid === '' || $uid === $senderUserId || isset($seen[$uid])) continue;
        $seen[$uid] = true;
        try {
            NotificationRepository::create($uid, 'mention', $title, $body, array_merge($data, ['mentionedUserId' => $uid]));
        } catch (\Throwable $e) {
            error_log('[mention] notify failed for ' . $uid . ': ' . $e->getMessage());
        }
    }
}

/**
 * Block-filter helper: returns the bidirectional block ID set for a viewer,
 * formatted for fast lookup. Wraps BlockRepository::getBidirectional so route
 * handlers don't need to know about the repo.
 *
 * Returns ['user_ids' => [...], 'guest_ids' => [...]] — the IDs of every user
 * or guest the viewer has blocked OR been blocked by. Apple Guideline 1.2
 * requires mutual invisibility, so both directions are baked in.
 */
function viewerBlockSet(?string $viewerUserId, ?string $viewerGuestId): array
{
    if ($viewerUserId === null && $viewerGuestId === null) {
        return ['user_ids' => [], 'guest_ids' => []];
    }
    return BlockRepository::getBidirectional($viewerUserId, $viewerGuestId);
}

/**
 * Filter an in-memory list of items by a block set. Each item is checked
 * against $userIdKey and $guestIdKey; matches are removed.
 *
 * Filtering in PHP (rather than splicing NOT IN into every SQL query) keeps
 * the change localized and avoids parameterised-query gymnastics across
 * positional/named-param call sites. Page sizes here are O(50-100), so the
 * cost is invisible.
 */
function filterByBlocks(
    array $items,
    array $blocks,
    string $userIdKey  = 'userId',
    string $guestIdKey = 'guestId'
): array {
    $userBlocked  = array_flip($blocks['user_ids']  ?? []);
    $guestBlocked = array_flip($blocks['guest_ids'] ?? []);
    if (empty($userBlocked) && empty($guestBlocked)) {
        return $items;
    }
    return array_values(array_filter($items, static function ($item) use ($userBlocked, $guestBlocked, $userIdKey, $guestIdKey) {
        $uid = $item[$userIdKey]  ?? null;
        $gid = $item[$guestIdKey] ?? null;
        if ($uid !== null && isset($userBlocked[$uid]))  return false;
        if ($gid !== null && isset($guestBlocked[$gid])) return false;
        return true;
    }));
}

function normalizeUnixTimestamp(mixed $value): ?int
{
    if (!is_numeric($value)) {
        return null;
    }

    $timestamp = (int) $value;

    // Accept JavaScript millisecond timestamps from manual/API clients.
    if ($timestamp > 1000000000000) {
        $timestamp = (int) floor($timestamp / 1000);
    }

    return $timestamp > 0 ? $timestamp : null;
}

// ── Internal migration endpoint ───────────────────────────────────────────────
// TEMPORARY — disable by removing MIGRATION_KEY from Render env vars.
// Protected: returns 404 if MIGRATION_KEY is not set.
// Call: GET /internal/run-migrations?key=YOUR_KEY

$router->add('GET', '/internal/run-migrations', function () {
    $expectedKey = getenv('MIGRATION_KEY') ?: null;

    // Endpoint does not exist unless MIGRATION_KEY is configured
    if ($expectedKey === null) {
        Response::json(['error' => 'Not found'], 404);
    }

    $providedKey = $_GET['key'] ?? '';
    if (!hash_equals($expectedKey, $providedKey)) {
        Response::json(['error' => 'Forbidden'], 403);
    }

    $pdo    = Database::pdo();
    $now    = time();
    $log    = [];
    $errors = [];

    // ── 1. Seed cities ────────────────────────────────────────────────────────

    $cities = require __DIR__ . '/../src/cities_data.php';

    $chanStmt = $pdo->prepare("
        INSERT INTO channels (id, type, name, created_at, updated_at)
        VALUES (:id, 'city', :name, now(), now())
        ON CONFLICT (id) DO NOTHING
    ");
    $cityStmt = $pdo->prepare("
        INSERT INTO cities (channel_id, country, lat, lng, timezone)
        VALUES (:channel_id, :country, :lat, :lng, :timezone)
        ON CONFLICT (channel_id) DO NOTHING
    ");

    $citiesInserted = 0;
    $citiesSkipped  = 0;

    foreach ($cities as $city) {
        $id = 'city_' . $city['id'];
        $chanStmt->execute(['id' => $id, 'name' => $city['name']]);
        $cityStmt->execute([
            'channel_id' => $id,
            'country'    => $city['country'],
            'lat'        => $city['lat'],
            'lng'        => $city['lng'],
            'timezone'   => $city['timezone'],
        ]);
        if ($chanStmt->rowCount() > 0) $citiesInserted++;
        else $citiesSkipped++;
    }

    $log[] = "cities: inserted=$citiesInserted skipped=$citiesSkipped total=" . count($cities);

    // ── 2. Migrate events from JSON files ─────────────────────────────────────

    $evChanStmt = $pdo->prepare("
        INSERT INTO channels (id, type, parent_id, name, status, created_at, updated_at)
        VALUES (:id, 'event', :parent_id, :name, :status, :created_at, :updated_at)
        ON CONFLICT (id) DO NOTHING
    ");
    $hiladsStmt = $pdo->prepare("
        INSERT INTO channel_events
            (channel_id, source_type, guest_id, title, event_type,
             venue, location, venue_lat, venue_lng,
             starts_at, expires_at, image_url, external_url)
        VALUES
            (:channel_id, 'hilads', :guest_id, :title, :event_type,
             :venue, :location, :venue_lat, :venue_lng,
             to_timestamp(:starts_at), to_timestamp(:expires_at),
             :image_url, :external_url)
        ON CONFLICT (channel_id) DO NOTHING
    ");
    $tmStmt = $pdo->prepare("
        INSERT INTO channel_events
            (channel_id, source_type, external_id, title, event_type,
             venue, location, venue_lat, venue_lng,
             starts_at, expires_at, image_url, external_url, synced_at)
        VALUES
            (:channel_id, 'ticketmaster', :external_id, :title, :event_type,
             :venue, :location, :venue_lat, :venue_lng,
             to_timestamp(:starts_at), to_timestamp(:expires_at),
             :image_url, :external_url, :synced_at)
        ON CONFLICT (source_type, external_id) DO UPDATE SET
            title        = EXCLUDED.title,
            venue        = EXCLUDED.venue,
            location     = EXCLUDED.location,
            venue_lat    = EXCLUDED.venue_lat,
            venue_lng    = EXCLUDED.venue_lng,
            starts_at    = EXCLUDED.starts_at,
            expires_at   = EXCLUDED.expires_at,
            image_url    = EXCLUDED.image_url,
            external_url = EXCLUDED.external_url,
            synced_at    = EXCLUDED.synced_at
    ");

    $evMigrated = 0;
    $evSkipped  = 0;

    foreach (glob(Storage::dir() . '/events_*.json') ?: [] as $file) {
        if (!preg_match('/events_(\d+)\.json$/', $file, $m)) continue;

        $parentId = 'city_' . $m[1];
        $check    = $pdo->prepare("SELECT 1 FROM channels WHERE id = ?");
        $check->execute([$parentId]);
        if (!$check->fetchColumn()) {
            $errors[] = "parent $parentId not found, skipping $file";
            continue;
        }

        $events = json_decode(file_get_contents($file), true) ?? [];
        foreach ($events as $ev) {
            if (empty($ev['id']) || empty($ev['title']) || empty($ev['starts_at'])) {
                $evSkipped++;
                continue;
            }

            $source    = $ev['source'] ?? 'hilads';
            $status    = ($ev['expires_at'] ?? 0) < $now ? 'expired' : 'active';
            $createdAt = date('c', $ev['created_at'] ?? $now);
            $updatedAt = date('c', $ev['updated_at'] ?? $ev['created_at'] ?? $now);

            try {
                $pdo->beginTransaction();

                $evChanStmt->execute([
                    'id'         => $ev['id'],
                    'parent_id'  => $parentId,
                    'name'       => mb_substr($ev['title'], 0, 100),
                    'status'     => $status,
                    'created_at' => $createdAt,
                    'updated_at' => $updatedAt,
                ]);

                $common = [
                    'channel_id'  => $ev['id'],
                    'title'       => mb_substr($ev['title'], 0, 100),
                    'event_type'  => $ev['type'] ?? null,
                    'venue'       => $ev['venue'] ?? null,
                    'location'    => $ev['location'] ?? ($ev['location_hint'] ?? null),
                    'venue_lat'   => isset($ev['venue_lat']) ? (float) $ev['venue_lat'] : null,
                    'venue_lng'   => isset($ev['venue_lng']) ? (float) $ev['venue_lng'] : null,
                    'starts_at'   => (int) $ev['starts_at'],
                    'expires_at'  => (int) ($ev['expires_at'] ?? ($ev['starts_at'] + 10800)),
                    'image_url'   => $ev['image_url'] ?? null,
                    'external_url'=> $ev['external_url'] ?? null,
                ];

                if ($source === 'ticketmaster') {
                    $tmStmt->execute(array_merge($common, [
                        'external_id' => $ev['external_id'] ?? null,
                        'synced_at'   => $updatedAt,
                    ]));
                } else {
                    $hiladsStmt->execute(array_merge($common, [
                        'guest_id' => $ev['guest_id'] ?? null,
                    ]));
                }

                $pdo->commit();
                $evMigrated++;
            } catch (Throwable $e) {
                if ($pdo->inTransaction()) $pdo->rollBack();
                $errors[] = "event {$ev['id']}: " . $e->getMessage();
                $evSkipped++;
            }
        }
    }

    $log[] = "events: migrated=$evMigrated skipped=$evSkipped";

    // ── 3. Migrate messages from JSON files ───────────────────────────────────

    $msgStmt = $pdo->prepare("
        INSERT INTO messages (id, channel_id, type, event, guest_id, nickname, content, image_url, created_at)
        VALUES (:id, :channel_id, :type, :event, :guest_id, :nickname, :content, :image_url, to_timestamp(:created_at))
        ON CONFLICT (id) DO NOTHING
    ");

    $msgMigrated = 0;
    $msgSkipped  = 0;

    foreach (glob(Storage::dir() . '/messages_*.json') ?: [] as $file) {
        if (!preg_match('/messages_(.+)\.json$/', $file, $m)) continue;

        $rawId     = $m[1];
        // Numeric = city channel, hex string = event channel
        $channelId = ctype_digit($rawId) ? 'city_' . $rawId : $rawId;

        // Verify channel exists in DB before inserting messages
        $chk = $pdo->prepare("SELECT 1 FROM channels WHERE id = ?");
        $chk->execute([$channelId]);
        if (!$chk->fetchColumn()) {
            $errors[] = "channel $channelId not found for $file — skipped";
            continue;
        }

        $msgs = json_decode(file_get_contents($file), true) ?? [];

        foreach ($msgs as $msg) {
            $type      = $msg['type'] ?? 'text';
            $createdAt = $msg['createdAt'] ?? $msg['created_at'] ?? time();

            try {
                $msgStmt->execute([
                    'id'         => $msg['id'] ?? bin2hex(random_bytes(8)),
                    'channel_id' => $channelId,
                    'type'       => $type,
                    'event'      => $type === 'system' ? ($msg['event'] ?? null) : null,
                    'guest_id'   => $msg['guestId'] ?? $msg['guest_id'] ?? null,
                    'nickname'   => $msg['nickname'] ?? '',
                    'content'    => $msg['content'] ?? null,
                    'image_url'  => $msg['imageUrl'] ?? $msg['image_url'] ?? null,
                    'created_at' => (int) $createdAt,
                ]);
                if ($msgStmt->rowCount() > 0) $msgMigrated++;
                else $msgSkipped++;
            } catch (Throwable $e) {
                $errors[] = "msg in $channelId: " . $e->getMessage();
                $msgSkipped++;
            }
        }
    }

    $log[] = "messages: migrated=$msgMigrated skipped=$msgSkipped";

    // ── 4. Add new performance indexes (idempotent) ───────────────────────────

    $pdo->exec("CREATE INDEX IF NOT EXISTS idx_presence_count        ON presence (channel_id, last_seen_at DESC, guest_id)");
    $pdo->exec("CREATE INDEX IF NOT EXISTS idx_channels_active_events ON channels (parent_id) WHERE type = 'event' AND status = 'active'");
    $log[] = "indexes: applied";

    // ── 5. Add notification_preferences columns added after initial schema ───────
    // All three were added post-launch and may be absent in production.
    // IF NOT EXISTS is PostgreSQL 9.6+ — safe to run repeatedly.
    // friend_added_push was renamed to friend_request_push when the friend
    // request flow shipped — see migrate.php for the rename.
    foreach ([
        ['friend_request_push',     'BOOLEAN NOT NULL DEFAULT TRUE'],
        ['vibe_received_push',      'BOOLEAN NOT NULL DEFAULT TRUE'],
        ['profile_view_push',       'BOOLEAN NOT NULL DEFAULT TRUE'],
        ['admin_announcement_push', 'BOOLEAN NOT NULL DEFAULT TRUE'],
    ] as [$col, $def]) {
        try {
            $pdo->exec("ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS $col $def");
            $log[] = "notification_preferences: $col column ensured";
        } catch (\Throwable $e) {
            $errors[] = "notification_preferences.$col migration: " . $e->getMessage();
        }
    }

    // ── 6. user_reports table (added post-launch) ─────────────────────────────

    try {
        $pdo->exec("
            CREATE TABLE IF NOT EXISTS user_reports (
                id                BIGSERIAL   PRIMARY KEY,
                reporter_user_id  TEXT        REFERENCES users(id) ON DELETE SET NULL,
                reporter_guest_id TEXT,
                target_user_id    TEXT        REFERENCES users(id) ON DELETE SET NULL,
                target_guest_id   TEXT,
                target_nickname   TEXT,
                reason            TEXT        NOT NULL,
                status            TEXT        NOT NULL DEFAULT 'open',
                created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
                CONSTRAINT chk_reporter_identity CHECK (reporter_user_id IS NOT NULL OR reporter_guest_id IS NOT NULL),
                CONSTRAINT chk_target_identity   CHECK (target_user_id   IS NOT NULL OR target_guest_id   IS NOT NULL),
                CONSTRAINT chk_no_self_report    CHECK (reporter_user_id IS NULL OR reporter_user_id != target_user_id),
                CONSTRAINT chk_status            CHECK (status IN ('open', 'reviewed', 'dismissed'))
            )
        ");
        $pdo->exec("CREATE INDEX IF NOT EXISTS idx_user_reports_target_user  ON user_reports (target_user_id)  WHERE target_user_id IS NOT NULL");
        $pdo->exec("CREATE INDEX IF NOT EXISTS idx_user_reports_target_guest ON user_reports (target_guest_id) WHERE target_guest_id IS NOT NULL");
        $pdo->exec("CREATE INDEX IF NOT EXISTS idx_user_reports_status_time  ON user_reports (status, created_at DESC)");
        $log[] = "user_reports: table and indexes ensured";
    } catch (\Throwable $e) {
        $errors[] = "user_reports: " . $e->getMessage();
    }

    // ── 7. blocks table (UGC moderation — Apple Guideline 1.2) ────────────────
    //
    // Mirrors the user_reports identity model: blocker and blocked can each be
    // either a registered user or a guest. Mutual invisibility is enforced
    // server-side by joining content queries against this table.

    try {
        $pdo->exec("
            CREATE TABLE IF NOT EXISTS blocks (
                id                BIGSERIAL   PRIMARY KEY,
                blocker_user_id   TEXT        REFERENCES users(id) ON DELETE CASCADE,
                blocker_guest_id  TEXT,
                blocked_user_id   TEXT        REFERENCES users(id) ON DELETE CASCADE,
                blocked_guest_id  TEXT,
                target_nickname   TEXT,
                reason            TEXT,
                created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
                CONSTRAINT chk_blocker_identity     CHECK (blocker_user_id IS NOT NULL OR blocker_guest_id IS NOT NULL),
                CONSTRAINT chk_blocked_identity     CHECK (blocked_user_id IS NOT NULL OR blocked_guest_id IS NOT NULL),
                CONSTRAINT chk_no_self_block_user   CHECK (blocker_user_id  IS NULL OR blocker_user_id  != blocked_user_id),
                CONSTRAINT chk_no_self_block_guest  CHECK (blocker_guest_id IS NULL OR blocker_guest_id != blocked_guest_id)
            )
        ");

        // Unique partial indexes — one block row per (blocker, blocked) pair, per identity-type combination.
        // Postgres treats NULLs as distinct in unique indexes, so we need 4 partial indexes (user/user,
        // user/guest, guest/user, guest/guest) to enforce idempotence across all identity combos.
        $pdo->exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_blocks_uu_unique ON blocks (blocker_user_id,  blocked_user_id)  WHERE blocker_user_id  IS NOT NULL AND blocked_user_id  IS NOT NULL");
        $pdo->exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_blocks_ug_unique ON blocks (blocker_user_id,  blocked_guest_id) WHERE blocker_user_id  IS NOT NULL AND blocked_guest_id IS NOT NULL");
        $pdo->exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_blocks_gu_unique ON blocks (blocker_guest_id, blocked_user_id)  WHERE blocker_guest_id IS NOT NULL AND blocked_user_id  IS NOT NULL");
        $pdo->exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_blocks_gg_unique ON blocks (blocker_guest_id, blocked_guest_id) WHERE blocker_guest_id IS NOT NULL AND blocked_guest_id IS NOT NULL");

        // Lookup indexes for content-filter queries (read-heavy: every list endpoint hits these).
        $pdo->exec("CREATE INDEX IF NOT EXISTS idx_blocks_blocker_user  ON blocks (blocker_user_id)  WHERE blocker_user_id  IS NOT NULL");
        $pdo->exec("CREATE INDEX IF NOT EXISTS idx_blocks_blocker_guest ON blocks (blocker_guest_id) WHERE blocker_guest_id IS NOT NULL");
        $pdo->exec("CREATE INDEX IF NOT EXISTS idx_blocks_blocked_user  ON blocks (blocked_user_id)  WHERE blocked_user_id  IS NOT NULL");
        $pdo->exec("CREATE INDEX IF NOT EXISTS idx_blocks_blocked_guest ON blocks (blocked_guest_id) WHERE blocked_guest_id IS NOT NULL");

        $log[] = "blocks: table and indexes ensured";
    } catch (\Throwable $e) {
        $errors[] = "blocks: " . $e->getMessage();
    }

    // ── 8. users.eula_accepted_at (Apple G1.2 EULA acceptance tracking) ───────
    //
    // Tracks when the user accepted Hilads' Terms / EULA. NULL means not yet
    // accepted — used by the mobile client to decide whether to show the
    // mandatory EULA prompt (new signups always set this; existing users get
    // the modal once on next launch and POST /users/me/eula to clear it).

    try {
        $pdo->exec("ALTER TABLE users ADD COLUMN IF NOT EXISTS eula_accepted_at TIMESTAMPTZ");
        $log[] = "users.eula_accepted_at: column ensured";
    } catch (\Throwable $e) {
        $errors[] = "users.eula_accepted_at: " . $e->getMessage();
    }

    // ── 9. Summary query ──────────────────────────────────────────────────────

    $cityCount  = (int) $pdo->query("SELECT COUNT(*) FROM channels WHERE type='city'")->fetchColumn();
    $eventCount = (int) $pdo->query("SELECT COUNT(*) FROM channel_events")->fetchColumn();
    $activeCount = (int) $pdo->query("SELECT COUNT(*) FROM channel_events WHERE expires_at > now()")->fetchColumn();

    $bySource = $pdo->query("SELECT source_type, COUNT(*) AS n FROM channel_events GROUP BY source_type")
                    ->fetchAll(PDO::FETCH_KEY_PAIR);

    Response::json([
        'ok'      => empty($errors),
        'log'     => $log,
        'errors'  => $errors,
        'db' => [
            'cities_total'   => $cityCount,
            'events_total'   => $eventCount,
            'events_active'  => $activeCount,
            'events_by_source' => $bySource,
        ],
    ]);
});

// ── Auth ─────────────────────────────────────────────────────────────────────

$router->add('POST', '/api/v1/auth/signup', function () {
    enforceRateLimit('auth_signup', 10, 600);
    $body = Request::json();
    if ($body === null) Response::json(['error' => 'Invalid JSON body'], 400);

    // Apple G1.2 — EULA must be explicitly accepted at signup.
    // The mobile client gates its submit button on the in-app checkbox; the
    // server enforces the same rule so direct API callers (or older clients)
    // can't bypass it.
    if (empty($body['eula_accepted']) || $body['eula_accepted'] !== true) {
        Response::json(['error' => 'EULA acceptance required'], 422);
    }

    $user  = AuthService::signup(
        email:        $body['email']        ?? '',
        password:     $body['password']     ?? '',
        displayName:  $body['display_name'] ?? '',
        username:     isset($body['username']) && is_string($body['username']) ? $body['username'] : '',
        guestId:      isset($body['guest_id']) && is_string($body['guest_id']) ? $body['guest_id'] : null,
        mode:         isset($body['mode'])    && is_string($body['mode'])    ? $body['mode']    : null,
        eulaAccepted: true,
    );

    AnalyticsService::capture('user_registered', $user['id'], [
        'guest_id' => isset($body['guest_id']) ? $body['guest_id'] : null,
        'user_id'  => $user['id'],
        'is_guest' => false,
    ]);

    // _token is included so mobile clients can persist it directly (set-cookie
    // headers are not reliably accessible from React Native fetch on Android).
    Response::json(['user' => AuthService::ownFields($user), 'token' => $user['_token']], 201);
});

$router->add('POST', '/api/v1/auth/login', function () {
    enforceRateLimit('auth_login', 12, 600);
    $body = Request::json();
    if ($body === null) Response::json(['error' => 'Invalid JSON body'], 400);

    $user = AuthService::login(
        email:    $body['email']    ?? '',
        password: $body['password'] ?? '',
    );

    AnalyticsService::capture('user_authenticated', $user['id'], [
        'user_id'  => $user['id'],
        'is_guest' => false,
    ]);

    // _token is included so mobile clients can persist it directly (set-cookie
    // headers are not reliably accessible from React Native fetch on Android).
    Response::json(['user' => AuthService::ownFields($user), 'token' => $user['_token']]);
});

// ── DELETE /api/v1/auth/me — soft-delete the current user's account ──────────
// Marks deleted_at, kills all sessions + push tokens.
// Historical data (messages, events, DMs) is preserved for data integrity.
$router->add('DELETE', '/api/v1/auth/me', function () {
    $user = AuthService::requireAuth();
    enforceRateLimit('delete_account', 3, 3600);
    UserRepository::softDelete($user['id']);
    // Destroy the current session cookie so the client is immediately signed out
    AuthService::destroyDbSession();
    Response::json(['ok' => true]);
});

$router->add('POST', '/api/v1/auth/logout', function () {
    $user = AuthService::currentUser(); // capture before session is destroyed
    AuthService::destroyDbSession();
    if ($user) {
        AnalyticsService::capture('auth_logout', $user['id'], [
            'user_id'  => $user['id'],
            'is_guest' => false,
        ]);
    }
    Response::json(['ok' => true]);
});

$router->add('GET', '/api/v1/auth/me', function () {
    $user = AuthService::requireAuth();
    $fields = AuthService::ownFields($user);

    // current_city: live source of truth for membership + notifications.
    // null when the user has never had location resolved and has no home_city
    // backfill match. channelId is returned as integer to match the rest of the
    // city API contract (see /location/resolve).
    $fields['current_city']        = null;
    $fields['current_city_set_at'] = null;
    if (!empty($user['current_city_id'])) {
        $stmt = Database::pdo()->prepare("
            SELECT ch.id, ch.name, ci.country, ci.timezone
              FROM channels ch
              JOIN cities ci ON ci.channel_id = ch.id
             WHERE ch.id = ?
        ");
        $stmt->execute([$user['current_city_id']]);
        $row = $stmt->fetch(\PDO::FETCH_ASSOC);
        if ($row) {
            $fields['current_city'] = [
                'channelId' => (int) preg_replace('/^city_/', '', $row['id']),
                'name'      => $row['name'],
                'country'   => $row['country'],
                'timezone'  => $row['timezone'],
            ];
            $fields['current_city_set_at'] = $user['current_city_set_at'] ?? null;
        }
    }

    Response::json(['user' => $fields]);
});

$router->add('POST', '/api/v1/auth/forgot-password', function () {
    enforceRateLimit('auth_forgot_password', 5, 600);
    $body  = Request::json();
    $email = trim((string) ($body['email'] ?? ''));
    // Always call forgotPassword — it handles missing users silently
    AuthService::forgotPassword($email);
    Response::json([
        'success' => true,
        'message' => "If an account exists for this email, we've sent a reset link.",
    ]);
});

$router->add('GET', '/api/v1/auth/reset-password/validate', function () {
    $token = trim($_GET['token'] ?? '');
    if ($token === '') {
        Response::json(['valid' => false]);
    }
    Response::json(['valid' => AuthService::validateResetToken($token)]);
});

$router->add('POST', '/api/v1/auth/reset-password', function () {
    enforceRateLimit('auth_reset_password', 10, 600);
    $body     = Request::json();
    $token    = trim((string) ($body['token']    ?? ''));
    $password = (string) ($body['password']      ?? '');
    $confirm  = (string) ($body['passwordConfirmation'] ?? '');

    if ($token === '') {
        Response::json(['error' => 'Token is required'], 400);
    }
    if ($password !== $confirm) {
        Response::json(['error' => 'Passwords do not match'], 422);
    }

    $user = AuthService::resetPassword($token, $password);
    Response::json(['user' => AuthService::ownFields($user), 'token' => $user['_token']]);
});

// ── Profile ───────────────────────────────────────────────────────────────────

$router->add('PUT', '/api/v1/profile', function () {
    $user = AuthService::requireAuth();
    $body = Request::json();
    if ($body === null) Response::json(['error' => 'Invalid JSON body'], 400);

    $fields = AuthService::sanitiseProfileFields($body);

    // Username change — validate format + case-insensitive uniqueness (excluding
    // the caller's own row so re-saving an unchanged username is a no-op). The DB
    // unique index is the race-safe backstop.
    if (array_key_exists('username', $body)) {
        $username = is_string($body['username']) ? UsernameService::normalize($body['username']) : '';
        $err = UsernameService::validate($username);
        if ($err !== null) Response::json(['error' => $err], 422);
        if (!UsernameService::isAvailable($username, $user['id'])) {
            Response::json(['error' => 'That username is taken'], 409);
        }
        $fields['username'] = $username;
    }

    try {
        $updated = UserRepository::update($user['id'], $fields);
    } catch (\RuntimeException $e) {
        if ($e->getMessage() === 'username_taken') Response::json(['error' => 'That username is taken'], 409);
        throw $e;
    }

    Response::json(['user' => AuthService::ownFields($updated)]);
});

// Real-time availability + format check for the @-handle picker (signup + profile).
// Excludes the caller's own row when authenticated, so editing back to your
// current username reads as available.
$router->add('GET', '/api/v1/username/check', function () {
    enforceRateLimit('username_check', 120, 60);
    $raw = trim((string) ($_GET['username'] ?? ''));

    $err = UsernameService::validate($raw);
    if ($err !== null) {
        Response::json(['valid' => false, 'available' => false, 'reason' => $err]);
    }

    $viewer    = AuthService::currentUser(); // null for guests/signup
    $available = UsernameService::isAvailable($raw, $viewer['id'] ?? null);
    Response::json([
        'valid'     => true,
        'available' => $available,
        'reason'    => $available ? null : 'That username is taken',
    ]);
});

$router->add('GET', '/api/v1/users/{userId}', function (array $params) {
    $userId = $params['userId'] ?? '';
    if (!preg_match('/^[a-f0-9]{32}$/', $userId)) {
        Response::json(['error' => 'Invalid userId'], 400);
    }

    // Access rule: only registered users can view registered profiles.
    // Guests (no token OR guest accountType) are blocked with PROFILE_LOCKED.
    $viewer = AuthService::currentUser();
    if ($viewer === null) {
        Response::json([
            'error'   => 'PROFILE_LOCKED',
            'message' => 'Profile access requires registration',
        ], 403);
    }

    // Try primary userId lookup first; fall back to guest_id for city-channel
    // taps where the navigation ID may be a guestId rather than a registered userId.
    $user = UserRepository::findById($userId) ?? UserRepository::findByGuestId($userId);
    if ($user === null || !empty($user['deleted_at'])) {
        Response::json(['error' => 'User not found'], 404);
    }

    // Mutual invisibility: if the viewer has blocked this user OR been blocked
    // by them, the profile is unreachable from either side. Surface as 404 so
    // a blocker isn't told they were blocked.
    $blocks = viewerBlockSet($viewer['id'], null);
    if (in_array($user['id'], $blocks['user_ids'], true)
     || (!empty($user['guest_id']) && in_array($user['guest_id'], $blocks['guest_ids'], true))) {
        Response::json(['error' => 'User not found'], 404);
    }

    // isFriend: whether the current authenticated viewer has friended this user
    $isFriend = false;
    if ($viewer !== null && $viewer['id'] !== $user['id']) {
        $chk = Database::pdo()->prepare("SELECT 1 FROM user_friends WHERE user_id = ? AND friend_id = ?");
        $chk->execute([$viewer['id'], $user['id']]);
        $isFriend = (bool) $chk->fetchColumn();
    }

    // pendingFriendRequest: surface the open request (if any) between the
    // viewer and this user. Direction tells the client which button to show:
    //   "outgoing" → viewer sent the request, button = "Request sent" (cancel)
    //   "incoming" → viewer received the request, button = "Accept request"
    // Null when no pending row exists in either direction.
    $pendingFriendRequest = null;
    if (!$isFriend && $viewer !== null && $viewer['id'] !== $user['id']) {
        $req = FriendRequestRepository::findPendingBetween($viewer['id'], $user['id']);
        if ($req !== null) {
            $pendingFriendRequest = [
                'id'        => $req['id'],
                'direction' => $req['sender_id'] === $viewer['id'] ? 'outgoing' : 'incoming',
            ];
        }
    }

    $vibeScore = VibeRepository::scoreForUser($user['id']);

    // Base canonical DTO + public profile extensions
    $ambassadorPicks = null;
    $ambassadorPicksRaw = array_filter([
        'restaurant' => $user['ambassador_restaurant'] ?? null,
        'spot'       => $user['ambassador_spot']       ?? null,
        'tip'        => $user['ambassador_tip']        ?? null,
        'story'      => $user['ambassador_story']      ?? null,
    ], static fn($v) => $v !== null && $v !== '');
    if (!empty($ambassadorPicksRaw)) {
        $ambassadorPicks = $ambassadorPicksRaw;
    }

    $dto = array_merge(
        UserResource::fromUser($user, [], ['isFriend' => $isFriend]),
        [
            'age'                  => isset($user['birth_year']) && $user['birth_year'] !== null
                                       ? (int) date('Y') - (int) $user['birth_year']
                                       : null,
            'homeCity'             => $user['home_city'] ?? null,
            'aboutMe'              => $user['about_me'] ?? null,
            'interests'            => json_decode($user['interests'] ?? '[]', true),
            'vibeScore'            => $vibeScore['score'],
            'vibeCount'            => $vibeScore['count'],
            'ambassadorPicks'      => $ambassadorPicks,
            'pendingFriendRequest' => $pendingFriendRequest,
        ],
    );

    // Profile view notification — deferred so PushService HTTP calls don't block the response.
    if ($viewer['id'] !== $user['id']) {
        $targetId   = $user['id'];
        $viewerId   = $viewer['id'];
        $viewerName = $viewer['display_name'] ?? 'Someone';
        register_shutdown_function(static function () use ($targetId, $viewerId, $viewerName): void {
            if (function_exists('fastcgi_finish_request')) {
                fastcgi_finish_request();
            }
            // A notification side effect must never surface as a 500 on the
            // profile fetch — especially without FPM, where this shutdown runs
            // before the response is flushed (an uncaught error here becomes the
            // HTTP status). Catch everything and log.
            try {
                // Atomic 10-min per-(viewer, target) cooldown. Replaces a racy
                // SELECT-then-create dedup that, under deferred concurrent profile
                // fetches, let multiple notifications + pushes through at once.
                if (NotificationRepository::shouldNotifyProfileView($viewerId, $targetId, 600)) {
                    NotificationRepository::create(
                        $targetId,
                        'profile_view',
                        "👀 {$viewerName} checked your profile",
                        null,
                        ['viewerId' => $viewerId, 'viewerName' => $viewerName, 'senderUserId' => $viewerId]
                    );
                }
            } catch (\Throwable $e) {
                error_log('[profile_view] notify failed: ' . $e->getMessage());
            }
        });
    }

    Response::json(['user' => $dto]);
});

// ── /me/events MUST be registered before /{userId}/events ────────────────────
// The dynamic {userId} pattern matches ANY path segment, including the literal
// string "me". If /{userId}/events is registered first, requests to /me/events
// are captured with userId="me", which fails the hex-id validation and returns
// "Invalid userId". The specific /me route must come first.
$router->add('GET', '/api/v1/users/me/events', function () {
    $authUser = AuthService::requireAuth(); // 401 for guests — event ownership is registered-only
    $guestId  = $_GET['guestId'] ?? null;

    if (!isValidGuestId($guestId)) {
        Response::json(['error' => 'guestId is required'], 400);
    }

    $events = EventRepository::getByUser($guestId, $authUser['id']);
    Response::json(['events' => $events]);
});

// Preflight for the "1 event per calendar day" rule. Cheap (single COUNT),
// idempotent, safe to call on every CTA tap. Guests allowed (rule applies
// to them too, keyed by guest_id).
//
//   GET /api/v1/users/me/can-create-event?channelId=N&guestId=...
//   →   { canCreate, isLegend, todayCount, limit }
$router->add('GET', '/api/v1/users/me/can-create-event', function () {
    $authUser = AuthService::currentUser();         // nullable — guests too
    $guestId  = $_GET['guestId']   ?? null;
    $channel  = (int) ($_GET['channelId'] ?? 0);
    // Optional ?date=YYYY-MM-DD lets the create form re-check after the user
    // picks a non-today date. Defaults to today in city tz, which is what the
    // FAB preflight on the Now tab still wants.
    $dateParam = $_GET['date'] ?? null;

    if (!isValidGuestId($guestId) && $authUser === null) {
        Response::json(['error' => 'Identity required'], 401);
    }

    $city = $channel > 0 ? CityRepository::findById($channel) : null;
    $tz   = $city['timezone'] ?? 'UTC';

    $dateYmd = (is_string($dateParam) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $dateParam))
        ? $dateParam
        : (new DateTime('today', new DateTimeZone($tz)))->format('Y-m-d');

    $isLegend = (bool) ($authUser['_is_ambassador'] ?? false);
    $count    = EventRepository::eventsHostedOnDateCount(
        Database::pdo(),
        $authUser['id'] ?? null,
        $guestId,
        $dateYmd,
        $tz,
    );

    Response::json([
        'canCreate'  => $isLegend || $count === 0,
        'isLegend'   => $isLegend,
        'todayCount' => $count,  // historical key name; reflects $dateYmd's count
        'date'       => $dateYmd,
        'limit'      => 1,
    ]);
});

$router->add('GET', '/api/v1/users/{userId}/events', function (array $params) {
    $userId = $params['userId'] ?? '';
    if (!preg_match('/^[a-f0-9]{32}$/', $userId)) {
        Response::json(['error' => 'Invalid userId'], 400);
    }

    // Resolve guestId → userId if necessary so events are keyed on the registered account.
    $user = UserRepository::findById($userId) ?? UserRepository::findByGuestId($userId);
    if ($user === null) {
        Response::json(['events' => []]);
        return;
    }

    $events = EventRepository::getPublicByUserId($user['id']);
    Response::json(['events' => $events]);
});

// GET /api/v1/users/{userId}/hangouts — active hangouts the user created or
// joined, for the profile "Hangouts" tab. Each item has `is_owner`.
$router->add('GET', '/api/v1/users/{userId}/hangouts', function (array $params) {
    $userId = $params['userId'] ?? '';
    if (!preg_match('/^[a-f0-9]{32}$/', $userId)) {
        Response::json(['error' => 'Invalid userId'], 400);
    }
    $user = UserRepository::findById($userId) ?? UserRepository::findByGuestId($userId);
    if ($user === null) {
        Response::json(['hangouts' => []]);
        return;
    }
    Response::json(['hangouts' => TopicRepository::getByUser($user['id'])]);
});

// ── Friends ───────────────────────────────────────────────────────────────────

// POST /api/v1/users/{userId}/friends — send a friend request to {userId}.
//
// Behaviour change (vs. the legacy auto-add): the receiver must explicitly
// accept before user_friends gets populated. Mutual-add short-circuits: if the
// receiver had already sent the sender a pending request, that reverse request
// is auto-accepted and both users become friends immediately.
$router->add('POST', '/api/v1/users/{userId}/friends', function (array $params) {
    $viewer   = AuthService::requireAuth();
    $targetId = $params['userId'] ?? '';
    if (!preg_match('/^[a-f0-9]{32}$/', $targetId)) {
        Response::json(['error' => 'Invalid userId'], 400);
    }
    if ($targetId === $viewer['id']) {
        Response::json(['error' => 'Cannot friend yourself'], 400);
    }

    enforceRateLimit('friend_request_send', 30, 3600, $viewer['id']);

    $target = UserRepository::findById($targetId);
    if ($target === null || !empty($target['deleted_at'])) {
        Response::json(['error' => 'User not found'], 404);
    }

    // Block check (Apple G1.2): no contact across a block in either direction.
    // Surface as 404 so neither side leaks block state.
    if (BlockRepository::isBlockedBetween($viewer['id'], null, $targetId, null)) {
        Response::json(['error' => 'User not found'], 404);
    }

    // Already friends → nothing to do, but report it as a 200 so the client can
    // reconcile its local state (UI may have flipped optimistically).
    if (FriendRequestRepository::areFriends($viewer['id'], $targetId)) {
        Response::json(['ok' => true, 'friend' => true]);
    }

    $pending = FriendRequestRepository::findPendingBetween($viewer['id'], $targetId);

    // Mutual-add: receiver had already sent us a pending request → auto-accept.
    if ($pending !== null && $pending['sender_id'] === $targetId) {
        FriendRequestRepository::setStatus($pending['id'], 'accepted');
        FriendRequestRepository::insertFriendship($viewer['id'], $targetId);

        // Notify the original sender that their request was accepted (as if the
        // receiver had tapped Accept manually). Plus a WS event to flip their
        // open profile screen instantly.
        $accepterName = $viewer['display_name'] ?? 'Someone';
        NotificationRepository::create(
            $targetId,
            'friend_request_accepted',
            "{$accepterName} accepted your friend request 🎉",
            null,
            [
                'accepterUserId' => $viewer['id'],
                'accepterName'   => $accepterName,
            ]
        );
        broadcastUserEventToWs($targetId, 'friendRequestAccepted', [
            'requestId'      => $pending['id'],
            'accepterUserId' => $viewer['id'],
        ]);

        AnalyticsService::capture('friend_request_accepted', $viewer['id'], [
            'request_id' => $pending['id'],
            'sender_id'  => $targetId,
            'mutual'     => true,
        ]);

        Response::json(['ok' => true, 'friend' => true, 'request' => array_merge($pending, ['status' => 'accepted'])]);
    }

    // Idempotent re-send of an already-pending outgoing request.
    if ($pending !== null && $pending['sender_id'] === $viewer['id']) {
        Response::json(['ok' => true, 'request' => $pending]);
    }

    // Fresh request.
    $request = FriendRequestRepository::create($viewer['id'], $targetId);

    $senderName = $viewer['display_name'] ?? 'Someone';
    NotificationRepository::create(
        $targetId,
        'friend_request_received',
        "{$senderName} sent you a friend request",
        null,
        [
            'requestId'    => $request['id'],
            'senderUserId' => $viewer['id'],
            'senderName'   => $senderName,
        ]
    );
    broadcastUserEventToWs($targetId, 'friendRequestReceived', [
        'request' => array_merge($request, [
            'other_user_id'      => $viewer['id'],
            'other_display_name' => $senderName,
            'other_photo_url'    => $viewer['profile_photo_url'] ?? null,
            'other_vibe'         => $viewer['vibe'] ?? null,
        ]),
    ]);

    AnalyticsService::capture('friend_request_sent', $viewer['id'], ['target_id' => $targetId]);

    Response::json(['ok' => true, 'request' => $request], 201);
});

// GET /api/v1/friend-requests/incoming — pending requests where I am the receiver.
$router->add('GET', '/api/v1/friend-requests/incoming', function () {
    $viewer = AuthService::requireAuth();

    $limit  = max(1, min(50, (int) ($_GET['limit'] ?? 50)));
    $page   = max(1, (int) ($_GET['page']  ?? 1));
    $offset = ($page - 1) * $limit;

    $rows  = FriendRequestRepository::listIncomingPending($viewer['id'], $limit, $offset);
    $total = FriendRequestRepository::incomingPendingCount($viewer['id']);

    Response::json([
        'requests' => $rows,
        'total'    => $total,
        'page'     => $page,
        'hasMore'  => ($offset + count($rows)) < $total,
    ]);
});

// GET /api/v1/friend-requests/outgoing — pending requests where I am the sender.
$router->add('GET', '/api/v1/friend-requests/outgoing', function () {
    $viewer = AuthService::requireAuth();

    $limit  = max(1, min(50, (int) ($_GET['limit'] ?? 50)));
    $page   = max(1, (int) ($_GET['page']  ?? 1));
    $offset = ($page - 1) * $limit;

    $rows = FriendRequestRepository::listOutgoingPending($viewer['id'], $limit, $offset);

    Response::json([
        'requests' => $rows,
        'page'     => $page,
        'hasMore'  => count($rows) === $limit,
    ]);
});

// GET /api/v1/friend-requests/incoming-count — drives the Me-tab badge.
// Cheap COUNT(*) so the client can refresh on focus without paging the list.
$router->add('GET', '/api/v1/friend-requests/incoming-count', function () {
    $viewer = AuthService::requireAuth();
    Response::json(['count' => FriendRequestRepository::incomingPendingCount($viewer['id'])]);
});

// POST /api/v1/friend-requests/{id}/accept — receiver accepts a pending request.
$router->add('POST', '/api/v1/friend-requests/{id}/accept', function (array $params) {
    $viewer = AuthService::requireAuth();
    $id     = $params['id'] ?? '';
    if (!preg_match('/^[a-f0-9]{32}$/', $id)) {
        Response::json(['error' => 'Invalid request id'], 400);
    }

    $req = FriendRequestRepository::findById($id);
    if ($req === null) {
        Response::json(['error' => 'Request not found'], 404);
    }
    if ($req['receiver_id'] !== $viewer['id']) {
        Response::json(['error' => 'Forbidden'], 403);
    }
    if ($req['status'] !== 'pending') {
        Response::json(['error' => 'Request is no longer pending'], 409);
    }

    FriendRequestRepository::setStatus($id, 'accepted');
    FriendRequestRepository::insertFriendship($req['sender_id'], $req['receiver_id']);

    $accepterName = $viewer['display_name'] ?? 'Someone';
    NotificationRepository::create(
        $req['sender_id'],
        'friend_request_accepted',
        "{$accepterName} accepted your friend request 🎉",
        null,
        [
            'accepterUserId' => $viewer['id'],
            'accepterName'   => $accepterName,
        ]
    );
    broadcastUserEventToWs($req['sender_id'], 'friendRequestAccepted', [
        'requestId'      => $id,
        'accepterUserId' => $viewer['id'],
    ]);

    AnalyticsService::capture('friend_request_accepted', $viewer['id'], [
        'request_id' => $id,
        'sender_id'  => $req['sender_id'],
    ]);

    Response::json(['ok' => true]);
});

// POST /api/v1/friend-requests/{id}/decline — receiver declines a pending request.
// Per spec: NO notification to sender (avoids awkwardness). WS event still
// fires so an open profile screen on the sender's side returns to "Add friend".
$router->add('POST', '/api/v1/friend-requests/{id}/decline', function (array $params) {
    $viewer = AuthService::requireAuth();
    $id     = $params['id'] ?? '';
    if (!preg_match('/^[a-f0-9]{32}$/', $id)) {
        Response::json(['error' => 'Invalid request id'], 400);
    }

    $req = FriendRequestRepository::findById($id);
    if ($req === null) {
        Response::json(['error' => 'Request not found'], 404);
    }
    if ($req['receiver_id'] !== $viewer['id']) {
        Response::json(['error' => 'Forbidden'], 403);
    }
    if ($req['status'] !== 'pending') {
        Response::json(['error' => 'Request is no longer pending'], 409);
    }

    FriendRequestRepository::setStatus($id, 'declined');
    broadcastUserEventToWs($req['sender_id'], 'friendRequestDeclined', ['requestId' => $id]);

    AnalyticsService::capture('friend_request_declined', $viewer['id'], [
        'request_id' => $id,
        'sender_id'  => $req['sender_id'],
    ]);

    Response::json(['ok' => true]);
});

// DELETE /api/v1/friend-requests/{id} — sender cancels their own pending request.
$router->add('DELETE', '/api/v1/friend-requests/{id}', function (array $params) {
    $viewer = AuthService::requireAuth();
    $id     = $params['id'] ?? '';
    if (!preg_match('/^[a-f0-9]{32}$/', $id)) {
        Response::json(['error' => 'Invalid request id'], 400);
    }

    $req = FriendRequestRepository::findById($id);
    if ($req === null) {
        Response::json(['error' => 'Request not found'], 404);
    }
    if ($req['sender_id'] !== $viewer['id']) {
        Response::json(['error' => 'Forbidden'], 403);
    }
    if ($req['status'] !== 'pending') {
        Response::json(['error' => 'Request is no longer pending'], 409);
    }

    FriendRequestRepository::setStatus($id, 'cancelled');
    broadcastUserEventToWs($req['receiver_id'], 'friendRequestCancelled', ['requestId' => $id]);

    AnalyticsService::capture('friend_request_cancelled', $viewer['id'], [
        'request_id'  => $id,
        'receiver_id' => $req['receiver_id'],
    ]);

    Response::json(['ok' => true]);
});

// DELETE /api/v1/users/{userId}/friends — remove {userId} from my friends (auth required).
$router->add('DELETE', '/api/v1/users/{userId}/friends', function (array $params) {
    $viewer   = AuthService::requireAuth();
    $targetId = $params['userId'] ?? '';
    if (!preg_match('/^[a-f0-9]{32}$/', $targetId)) {
        Response::json(['error' => 'Invalid userId'], 400);
    }

    // Remove both directions so the friendship ends for both users.
    $pdo = Database::pdo();
    $pdo->prepare("DELETE FROM user_friends WHERE user_id = ? AND friend_id = ?")
        ->execute([$viewer['id'], $targetId]);
    $pdo->prepare("DELETE FROM user_friends WHERE user_id = ? AND friend_id = ?")
        ->execute([$targetId, $viewer['id']]);

    AnalyticsService::capture('friend_removed', $viewer['id'], ['target_id' => $targetId]);

    Response::json(['ok' => true]);
});

// GET /api/v1/users/{userId}/friends — list a user's friends (public, paginated).
$router->add('GET', '/api/v1/users/{userId}/friends', function (array $params) {
    $userId = $params['userId'] ?? '';
    if (!preg_match('/^[a-f0-9]{32}$/', $userId)) {
        Response::json(['error' => 'Invalid userId'], 400);
    }

    $limit  = max(1, min(50, (int) ($_GET['limit'] ?? 20)));
    $page   = max(1, (int) ($_GET['page']  ?? 1));
    $offset = ($page - 1) * $limit;

    $pdo = Database::pdo();

    $countStmt = $pdo->prepare("SELECT COUNT(*) FROM user_friends WHERE user_id = ?");
    $countStmt->execute([$userId]);
    $total = (int) $countStmt->fetchColumn();

    $stmt = $pdo->prepare("
        SELECT u.id, u.display_name, u.profile_photo_url, u.vibe, u.created_at
        FROM user_friends f
        JOIN users u ON u.id = f.friend_id AND u.deleted_at IS NULL
        WHERE f.user_id = :uid
        ORDER BY f.created_at DESC
        LIMIT :limit OFFSET :offset
    ");
    $stmt->bindValue(':uid', $userId);
    $stmt->bindValue(':limit',  $limit,  \PDO::PARAM_INT);
    $stmt->bindValue(':offset', $offset, \PDO::PARAM_INT);
    $stmt->execute();
    $rows = $stmt->fetchAll();

    $friends = array_map(static function (array $u): array {
        return UserResource::fromUser($u);
    }, $rows);

    Response::json([
        'friends' => $friends,
        'total'   => $total,
        'page'    => $page,
        'hasMore' => ($offset + count($rows)) < $total,
    ]);
});

// ── Vibes ─────────────────────────────────────────────────────────────────────
// POST /api/v1/users/{userId}/vibes  — create or update a vibe (auth required)
// GET  /api/v1/users/{userId}/vibes  — list vibes for a user + score

$router->add('POST', '/api/v1/users/{userId}/vibes', function (array $params) {
    $viewer = AuthService::requireAuth();
    $targetId = $params['userId'];

    if ($viewer['id'] === $targetId) {
        Response::json(['error' => 'You cannot leave a vibe for yourself'], 400);
        return;
    }

    // Check target exists and is not deleted
    $targetStmt = Database::pdo()->prepare("SELECT id FROM users WHERE id = ? AND deleted_at IS NULL");
    $targetStmt->execute([$targetId]);
    if (!$targetStmt->fetchColumn()) {
        Response::json(['error' => 'User not found'], 404);
        return;
    }

    // Block check (Apple G1.2): no contact across a block in either direction.
    if (BlockRepository::isBlockedBetween($viewer['id'], null, $targetId, null)) {
        Response::json(['error' => 'User not found'], 404);
        return;
    }

    $body    = Request::json() ?? [];
    $rating  = isset($body['rating']) ? (int) $body['rating'] : 0;
    $message = isset($body['message']) ? mb_substr(trim(strip_tags($body['message'])), 0, 300) : null;

    if ($rating < 1 || $rating > 5) {
        Response::json(['error' => 'rating must be between 1 and 5'], 400);
        return;
    }

    // Detect new vs update before upsert so we only notify on first-time vibes.
    $existsStmt = Database::pdo()->prepare("SELECT 1 FROM user_vibes WHERE author_id = ? AND target_id = ?");
    $existsStmt->execute([$viewer['id'], $targetId]);
    $isNewVibe = !$existsStmt->fetchColumn();

    $vibe = VibeRepository::upsert($viewer['id'], $targetId, $rating, $message ?: null);

    if ($isNewVibe) {
        $actorName = $viewer['display_name'] ?? 'Someone';
        NotificationRepository::create(
            $targetId,
            'vibe_received',
            "{$actorName} sent you a vibe ✨",
            null,
            [
                'actorId'   => $viewer['id'],
                'actorName' => $actorName,
                'vibeId'    => $vibe['id'],
            ]
        );
    }

    Response::json(['vibe' => $vibe], 201);
});

$router->add('GET', '/api/v1/users/{userId}/vibes', function (array $params) {
    $targetId = $params['userId'];
    $limit    = max(1, min(50, (int) ($_GET['limit'] ?? 20)));
    $offset   = max(0, (int) ($_GET['offset'] ?? 0));

    $vibes = VibeRepository::listForUser($targetId, $limit, $offset);
    $score = VibeRepository::scoreForUser($targetId);

    // My vibe — only if authenticated
    $myVibe = null;
    $viewer = AuthService::currentUser();
    if ($viewer && $viewer['id'] !== $targetId) {
        $myVibe = VibeRepository::myVibeFor($viewer['id'], $targetId);
    }

    Response::json([
        'vibes'   => $vibes,
        'score'   => $score['score'],
        'count'   => $score['count'],
        'myVibe'  => $myVibe,
    ]);
});

// ── Guest sessions ────────────────────────────────────────────────────────────

$router->add('POST', '/api/v1/guest/session', function () {
    // Crawlers / link previewers occasionally still execute JS and hit this.
    // Defense in depth: return a stub so we don't burn rate-limit slots or
    // pollute analytics with bot "guest_created" events. The web SPA also
    // skips React hydration for these UAs upstream (apps/web/src/main.jsx).
    if (Request::isBot()) {
        Response::json(['guestId' => 'bot', 'nickname' => 'bot'], 201);
    }

    enforceRateLimit('guest_session', 15, 3600);
    $guestId = bin2hex(random_bytes(16));

    $body = Request::json();
    $custom = trim(strip_tags($body['nickname'] ?? ''));
    $nickname = ($custom !== '' && mb_strlen($custom) <= 20)
        ? $custom
        : NicknameGenerator::generate();

    AnalyticsService::defer('guest_created', $guestId, ['nickname' => $nickname]);

    Response::json(['guestId' => $guestId, 'nickname' => $nickname], 201);
});

$router->add('POST', '/api/v1/location/resolve', function () {
    $body = Request::json();

    if ($body === null) {
        Response::json(['error' => 'Invalid JSON body'], 400);
    }

    $lat = $body['lat'] ?? null;
    $lng = $body['lng'] ?? null;

    if (!is_numeric($lat) || !is_numeric($lng)) {
        Response::json(['error' => 'lat and lng are required and must be numeric'], 400);
    }

    $lat = (float) $lat;
    $lng = (float) $lng;

    if ($lat < -90 || $lat > 90) {
        Response::json(['error' => 'lat must be between -90 and 90'], 400);
    }

    if ($lng < -180 || $lng > 180) {
        Response::json(['error' => 'lng must be between -180 and 180'], 400);
    }

    // Optional ISO-2 country code from the client's reverse-geocode (mobile:
    // native, web: Nominatim). Used to constrain nearest-city to the same
    // country and avoid cross-border snaps. Garbage / missing → ignored,
    // falls back to global nearest (back-compat for old clients).
    $country = $body['country'] ?? null;
    if ($country !== null) {
        if (!is_string($country) || !preg_match('/^[A-Za-z]{2}$/', $country)) {
            $country = null;
        } else {
            $country = strtoupper($country);
        }
    }

    $city = CityRepository::nearest($lat, $lng, $country);

    // Two-signal transition rule for users.current_city_id.
    // Only runs for authenticated users (guests don't have a row in users).
    // State machine, atomic single-UPDATE:
    //   current IS NULL                                 → commit (first city ever)
    //   current = geo                                   → bump last_confirmed_at, clear pending
    //   pending = geo AND first_seen ≥ 10 min ago       → commit (second signal)
    //   pending = geo AND first_seen < 10 min ago       → keep pending (too soon)
    //   else                                            → set pending = geo, first_seen = now
    //
    // last_confirmed_at only advances when a signal matches current_city_id,
    // so the 30-day inactive TTL in Phase D measures actual presence.
    $authUserForCity = AuthService::currentUser();
    if ($authUserForCity !== null) {
        $geoChannelId = 'city_' . $city['id'];
        Database::pdo()->prepare("
            UPDATE users SET
              current_city_id = CASE
                WHEN current_city_id IS NULL THEN :geo
                WHEN current_city_id = :geo THEN current_city_id
                WHEN pending_city_id = :geo AND pending_city_first_seen_at < now() - interval '10 minutes' THEN :geo
                ELSE current_city_id
              END,
              current_city_set_at = CASE
                WHEN current_city_id IS NULL THEN now()
                WHEN current_city_id = :geo THEN current_city_set_at
                WHEN pending_city_id = :geo AND pending_city_first_seen_at < now() - interval '10 minutes' THEN now()
                ELSE current_city_set_at
              END,
              current_city_last_confirmed_at = CASE
                WHEN current_city_id IS NULL THEN now()
                WHEN current_city_id = :geo THEN now()
                WHEN pending_city_id = :geo AND pending_city_first_seen_at < now() - interval '10 minutes' THEN now()
                ELSE current_city_last_confirmed_at
              END,
              pending_city_id = CASE
                WHEN current_city_id IS NULL THEN NULL
                WHEN current_city_id = :geo THEN NULL
                WHEN pending_city_id = :geo AND pending_city_first_seen_at < now() - interval '10 minutes' THEN NULL
                WHEN pending_city_id = :geo THEN pending_city_id
                ELSE :geo
              END,
              pending_city_first_seen_at = CASE
                WHEN current_city_id IS NULL THEN NULL
                WHEN current_city_id = :geo THEN NULL
                WHEN pending_city_id = :geo AND pending_city_first_seen_at < now() - interval '10 minutes' THEN NULL
                WHEN pending_city_id = :geo THEN pending_city_first_seen_at
                ELSE now()
              END
            WHERE id = :user_id
        ")->execute([
            'geo'     => $geoChannelId,
            'user_id' => $authUserForCity['id'],
        ]);
    }

    Response::json([
        'city'      => $city['name'],
        'channelId' => $city['id'],
        'timezone'  => $city['timezone'],
        'country'   => $city['country'] ?? null,
    ]);
});

// POST /api/v1/me/city
// Explicit manual city switch from the city picker. Immediately commits the
// chosen city as current_city_id, bypassing the two-signal rule.
// Body: { channelId: int | string }  — accepts either 42 or "city_42".
$router->add('POST', '/api/v1/me/city', function () {
    $user = AuthService::requireAuth();
    $body = Request::json();
    if ($body === null) Response::json(['error' => 'Invalid JSON body'], 400);

    $raw = $body['channelId'] ?? null;
    if ($raw === null || $raw === '') Response::json(['error' => 'channelId is required'], 400);

    // Accept "city_42" or 42 (number/string). Reject anything else.
    $channelId = is_int($raw) || ctype_digit((string) $raw)
        ? 'city_' . $raw
        : (is_string($raw) && preg_match('/^city_\d+$/', $raw) ? $raw : null);
    if ($channelId === null) Response::json(['error' => 'Invalid channelId'], 400);

    // Validate the channel exists and is an active city.
    $stmt = Database::pdo()->prepare("
        SELECT 1 FROM channels WHERE id = ? AND type = 'city' AND status = 'active' LIMIT 1
    ");
    $stmt->execute([$channelId]);
    if (!$stmt->fetchColumn()) Response::json(['error' => 'Unknown city'], 404);

    Database::pdo()->prepare("
        UPDATE users SET
          current_city_id                = :city,
          current_city_set_at            = now(),
          current_city_last_confirmed_at = now(),
          pending_city_id                = NULL,
          pending_city_first_seen_at     = NULL
        WHERE id = :user_id
    ")->execute([
        'city'    => $channelId,
        'user_id' => $user['id'],
    ]);

    // PR16 — also upsert the legacy user_city_memberships row so the manual
    // switch counts as membership under BOTH feature-flag modes:
    //   - MEMBERS_USE_CURRENT_CITY=on  → the UPDATE above already covers it
    //     (members list filters on current_city_id).
    //   - MEMBERS_USE_CURRENT_CITY=off (default) → members list unions on
    //     user_city_memberships rows; without this insert, switching cities
    //     wouldn't add the user to the new city's roster until they later
    //     hit POST /channels/:id/join (the explicit join path).
    // Same shape as the upsert in /channels/:id/join.
    try {
        Database::pdo()->prepare("
            INSERT INTO user_city_memberships (user_id, channel_id, first_seen_at, last_seen_at)
            VALUES (?, ?, now(), now())
            ON CONFLICT (user_id, channel_id) DO UPDATE SET last_seen_at = now()
        ")->execute([$user['id'], $channelId]);
    } catch (\Throwable $e) {
        // Non-fatal — the current_city_id update is the primary signal; the
        // membership row is a belt-and-braces backup for the legacy union.
        error_log('[me/city] membership upsert failed: ' . $e->getMessage());
    }

    Response::json(['ok' => true, 'channelId' => $channelId]);
});

// POST /api/v1/me/dismiss-public-optin
// Called once when the user dismisses the first-time public-default opt-in
// modal on the challenge create form. Flips users.has_seen_public_optin to
// TRUE so we never show the modal again to this user. Idempotent — calling
// again is a no-op.
//
// Body: none (or empty {}). Auth required (the modal only shows to logged-
// in users; guests can't create challenges anyway).
$router->add('POST', '/api/v1/me/dismiss-public-optin', function () {
    $user = AuthService::requireAuth();
    Database::pdo()
        ->prepare("UPDATE users SET has_seen_public_optin = TRUE WHERE id = ?")
        ->execute([$user['id']]);
    Response::json(['ok' => true, 'hasSeenPublicOptin' => true]);
});

// ── Deep link / share resolution ──────────────────────────────────────────────

// GET /api/v1/cities/by-slug/{slug}
// Resolves a URL slug to a city. Slug is derived from city name (lowercase, hyphens).
// Used when a shared /city/:slug link is opened cold.
$router->add('GET', '/api/v1/cities/by-slug/{slug}', function (array $params) {
    $slug = strtolower(trim($params['slug'] ?? ''));
    if ($slug === '') {
        Response::json(['error' => 'Missing slug'], 400);
    }

    $build = static function () use ($slug): ?array {
        foreach (CityRepository::all() as $city) {
            $citySlug = trim(preg_replace('/[^a-z0-9]+/', '-', strtolower($city['name'])), '-');
            if ($citySlug !== $slug) continue;
            // Chat volume drives SEO indexability (consumed by the prerender's
            // robots logic). City chat messages are keyed by the 'city_<id>'
            // channel; count every row (text/image + system) — a city with any
            // activity at all is worth indexing.
            $stmt = Database::pdo()->prepare("SELECT COUNT(*) FROM messages WHERE channel_id = ?");
            $stmt->execute(['city_' . $city['id']]);
            return [
                'channelId'    => $city['id'],
                'city'         => $city['name'],
                'country'      => $city['country'] ?? null,
                'timezone'     => $city['timezone'],
                'slug'         => $citySlug,
                'messageCount' => (int) $stmt->fetchColumn(),
            ];
        }
        return null;
    };

    // Crawler hits (prerender, ×19 locales) are cached to spare Postgres; the
    // live app computes fresh. City metadata is very stable → 30 min.
    $payload = isset($_SERVER['HTTP_X_HILADS_SSR'])
        ? Cache::remember("city_by_slug:$slug", 1800, $build)
        : $build();

    if ($payload === null) {
        Response::json(['error' => 'City not found'], 404);
    }
    Response::json($payload);
});

// GET /api/v1/events/{eventId}/venue-redirect
// Resolve a (possibly expired) event-occurrence channel_id to its venue,
// regardless of expires_at. Used by the prerender to keep 301s working
// during the SEO transition window after we stop materializing venue
// occurrences — Google has /event/<hash> URLs cached that we need to
// keep redirecting to /venue/<series_id> for weeks.
$router->add('GET', '/api/v1/events/{eventId}/venue-redirect', function (array $params) {
    $eventId = $params['eventId'] ?? '';
    if (!preg_match('/^[a-f0-9]{16}$/', $eventId)) {
        Response::json(['error' => 'Invalid eventId'], 400);
    }

    $stmt = Database::pdo()->prepare("
        SELECT es.id AS series_id, es.title
          FROM channel_events ce
          JOIN event_series es ON es.id = ce.series_id
         WHERE ce.channel_id = ?
           AND es.source = 'import'
           AND (es.source_key LIKE 'places:v1:%' OR es.source_key LIKE 'static:v1:%')
         LIMIT 1
    ");
    $stmt->execute([$eventId]);
    $row = $stmt->fetch(\PDO::FETCH_ASSOC);
    if (!$row) Response::json(['venue' => null], 404);

    $slug = trim(preg_replace('/[^a-z0-9]+/', '-', strtolower((string) $row['title'])), '-');
    Response::json(['venue' => [
        'id'   => $row['series_id'],
        'slug' => $slug,
    ]]);
});

// GET /api/v1/events/{eventId}/redirect
// Maps a retired recurring-occurrence channel_id → its surviving canonical
// event channel_id (event_redirects table, populated by the collapse migration).
// The prerender's 404-fallback uses this to 301 old /event/<occurrence-hex> URLs
// Google cached to the canonical event. Returns the bare canonical hex; the
// prerender's own bare-hex→slug 301 produces the final slug URL.
$router->add('GET', '/api/v1/events/{eventId}/redirect', function (array $params) {
    $eventId = strtolower(trim($params['eventId'] ?? ''));
    if (!preg_match('/^[a-f0-9]{16}$/', $eventId)) {
        Response::json(['error' => 'Invalid eventId'], 400);
    }
    $to = EventRedirectRepository::resolve($eventId);
    if ($to === null) {
        Response::json(['to' => null], 404);
    }
    Response::json(['to' => $to]);
});

// GET /api/v1/link-preview?url=<URL>
// Open Graph preview for a URL posted in chat. SSRF-guarded + 24h cached so
// the same URL across many messages costs one upstream fetch. Returns
// { preview: { url, title, description, image, site_name } } where any field
// may be null (missing OG / fetch failure — still cached so we don't retry hot).
$router->add('GET', '/api/v1/link-preview', function () {
    $url = trim((string) ($_GET['url'] ?? ''));
    if ($url === '') {
        Response::json(['error' => 'Missing url'], 400);
    }
    enforceRateLimit('link_preview', 120, 60); // 120/min/IP — plenty for chat browsing

    $preview = LinkPreviewService::get($url);
    if ($preview === null) {
        Response::json(['error' => 'Unsafe or invalid url'], 400);
    }

    // Browser caches 1h, Vercel CDN 24h with SWR — the URL is highly cacheable.
    header('Cache-Control: public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400');
    Response::json(['preview' => $preview]);
});

// GET /api/v1/venues/{venueId}
// Returns a single venue (coffee shop / bar) by its event_series.id (16-hex).
// SEO target: venues get their own LocalBusiness page, distinct from events.
// Returns 404 for any event_series row that isn't a seeded venue.
$router->add('GET', '/api/v1/venues/{venueId}', function (array $params) {
    $venueId = $params['venueId'] ?? '';
    if (!preg_match('/^[a-f0-9]{16}$/', $venueId)) {
        Response::json(['error' => 'Invalid venueId'], 400);
    }

    $venue = EventSeriesRepository::findVenue($venueId);
    if ($venue === null) {
        Response::json(['error' => 'Venue not found'], 404);
    }

    Response::json(['venue' => $venue]);
});

// ── Category × city pages ────────────────────────────────────────────────────
// Category × city URL pattern: /city/<slug>/<category>. Targets long-tail
// queries like "coffee meetups paris" or "drinks london". Allowlist matches
// EVENT_TYPES used by the SPA so the SPA can pre-apply the filter when a
// category deep-link lands.

// Allowlist of indexable categories. Anything else returns 404 so we don't
// open arbitrary thin pages to crawlers. Order here defines the order in
// the city page's "Browse by category" section.
function categoryMeta(): array
{
    return [
        'coffee' => ['label' => 'coffee meetups',       'venue_event_type' => 'coffee'],
        'drinks' => ['label' => 'drinks & nightlife',   'venue_event_type' => 'drinks'],
        'music'  => ['label' => 'music events',         'venue_event_type' => null],
        'food'   => ['label' => 'food meetups',         'venue_event_type' => null],
        'meetup' => ['label' => 'meetups',              'venue_event_type' => null],
        'party'  => ['label' => 'parties',              'venue_event_type' => null],
    ];
}

function resolveCityBySlug(string $slug): ?array
{
    $slug = strtolower(trim($slug));
    if ($slug === '') return null;
    foreach (CityRepository::all() as $c) {
        $citySlug = trim(preg_replace('/[^a-z0-9]+/', '-', strtolower($c['name'])), '-');
        if ($citySlug === $slug) return $c;
    }
    return null;
}

// GET /api/v1/cities/{slug}/categories/{category}
// Returns events + venues in the category bucket. 404 when both are empty.
// Body is consumed by the prerender to build /city/<slug>/<category> body
// and JSON-LD.
$router->add('GET', '/api/v1/cities/{slug}/categories/{category}', function (array $params) {
    $slug      = $params['slug']     ?? '';
    $category  = strtolower($params['category'] ?? '');
    $catMeta   = categoryMeta();

    if (!isset($catMeta[$category])) {
        Response::json(['error' => 'Unknown category'], 404);
    }

    $city = resolveCityBySlug($slug);
    if ($city === null) {
        Response::json(['error' => 'City not found'], 404);
    }

    $cityChannel = 'city_' . $city['id'];
    $pdo         = Database::pdo();

    // Events with this event_type, excluding venue-derived occurrences.
    // Joins event_series so we can filter out the seeded-venue series via
    // the same source_key pattern used elsewhere. expires_at > now() keeps
    // it to active/upcoming rows.
    $stmt = $pdo->prepare("
        SELECT ce.channel_id AS id,
               ce.title,
               ce.event_type AS type,
               ce.location,
               EXTRACT(EPOCH FROM ce.starts_at)::INTEGER AS starts_at,
               ce.series_id,
               ce.host_nickname
          FROM channel_events ce
          LEFT JOIN event_series es ON es.id = ce.series_id
         WHERE ce.city_id      = ?
           AND ce.event_type   = ?
           AND ce.expires_at   > now()
           AND (es.id IS NULL
                OR es.source <> 'import'
                OR (es.source_key NOT LIKE 'places:v1:%'
                    AND es.source_key NOT LIKE 'static:v1:%'))
         ORDER BY ce.starts_at ASC
         LIMIT 50
    ");
    $stmt->execute([$cityChannel, $category]);
    $events = $stmt->fetchAll(\PDO::FETCH_ASSOC);

    // Venues that match this category's venue_event_type (coffee → cafes,
    // drinks → bars). Categories without a venue mapping return empty here.
    $venues = [];
    if ($catMeta[$category]['venue_event_type'] !== null) {
        $vStmt = $pdo->prepare("
            SELECT es.id, es.title, es.location, es.event_type
              FROM event_series es
             WHERE es.city_id   = ?
               AND es.event_type = ?
               AND (es.ends_on IS NULL OR es.ends_on >= CURRENT_DATE)
               AND es.source = 'import'
               AND (es.source_key LIKE 'places:v1:%' OR es.source_key LIKE 'static:v1:%')
             ORDER BY es.title
             LIMIT 50
        ");
        $vStmt->execute([$cityChannel, $catMeta[$category]['venue_event_type']]);
        $venues = $vStmt->fetchAll(\PDO::FETCH_ASSOC);
    }

    // Truly empty bucket → 404 so the prerender doesn't generate a thin page.
    if (empty($events) && empty($venues)) {
        Response::json(['error' => 'No content in this category'], 404);
    }

    Response::json([
        'category' => [
            'slug'   => $category,
            'label'  => $catMeta[$category]['label'],
        ],
        'city' => [
            'channelId' => (int) $city['id'],
            'name'      => $city['name'],
            'country'   => $city['country'] ?? null,
            'timezone'  => $city['timezone'] ?? 'UTC',
            'slug'      => $slug,
        ],
        'events' => array_map(static fn(array $e) => [
            'id'             => $e['id'],
            'title'          => $e['title'],
            'type'           => $e['type'],
            'location'       => $e['location'],
            'starts_at'      => (int) $e['starts_at'],
            'host_nickname'  => $e['host_nickname'] ?? null,
        ], $events),
        'venues' => array_map(static fn(array $v) => [
            'id'         => $v['id'],
            'name'       => $v['title'],
            'address'    => $v['location'],
            'category'   => $v['event_type'] === 'drinks' ? 'bar' : 'cafe',
        ], $venues),
        'total_events' => count($events),
        'total_venues' => count($venues),
    ]);
});

// GET /api/v1/sitemap/categories
// Returns all (city slug, category) pairs that pass the threshold for
// inclusion in the sitemap. Threshold: combined events + venues ≥ 3.
$router->add('GET', '/api/v1/sitemap/categories', function () {
    $cats    = categoryMeta();
    $pdo     = Database::pdo();
    $pairs   = [];

    // Single query: counts of (city, event_type) for active non-venue events.
    $eventStmt = $pdo->query("
        SELECT ce.city_id,
               ce.event_type,
               COUNT(*) AS n
          FROM channel_events ce
          LEFT JOIN event_series es ON es.id = ce.series_id
         WHERE ce.expires_at > now()
           AND (es.id IS NULL
                OR es.source <> 'import'
                OR (es.source_key NOT LIKE 'places:v1:%'
                    AND es.source_key NOT LIKE 'static:v1:%'))
         GROUP BY ce.city_id, ce.event_type
    ");
    $eventCounts = [];
    foreach ($eventStmt as $row) {
        $eventCounts[$row['city_id']][$row['event_type']] = (int) $row['n'];
    }

    // Venue counts by (city, event_type). Only coffee + drinks.
    $venueStmt = $pdo->query("
        SELECT es.city_id,
               es.event_type,
               COUNT(*) AS n
          FROM event_series es
         WHERE (es.ends_on IS NULL OR es.ends_on >= CURRENT_DATE)
           AND es.source = 'import'
           AND (es.source_key LIKE 'places:v1:%' OR es.source_key LIKE 'static:v1:%')
         GROUP BY es.city_id, es.event_type
    ");
    $venueCounts = [];
    foreach ($venueStmt as $row) {
        $venueCounts[$row['city_id']][$row['event_type']] = (int) $row['n'];
    }

    foreach (CityRepository::all() as $c) {
        $cityChannel = 'city_' . $c['id'];
        $citySlug    = trim(preg_replace('/[^a-z0-9]+/', '-', strtolower($c['name'])), '-');
        foreach ($cats as $key => $meta) {
            $evCount  = $eventCounts[$cityChannel][$key] ?? 0;
            $vKey     = $meta['venue_event_type'];
            $venCount = $vKey ? ($venueCounts[$cityChannel][$vKey] ?? 0) : 0;
            if (($evCount + $venCount) >= 3) {
                $pairs[] = [
                    'city_slug' => $citySlug,
                    'category'  => $key,
                    'events'    => $evCount,
                    'venues'    => $venCount,
                ];
            }
        }
    }

    Response::json(['pairs' => $pairs, 'total' => count($pairs)]);
});

// GET /api/v1/sitemap/venues
// Global venue list across every city. Single-call endpoint used by
// gen-sitemap.mjs. Returns minimum fields to compose /venue/<slug>-<id> URLs.
$router->add('GET', '/api/v1/sitemap/venues', function () {
    $stmt = Database::pdo()->query("
        SELECT es.id,
               es.title,
               c.name AS city_name,
               EXTRACT(EPOCH FROM es.created_at)::INTEGER AS created_at
          FROM event_series es
          JOIN channels c ON c.id = es.city_id
         WHERE es.source = 'import'
           AND (es.source_key LIKE 'places:v1:%' OR es.source_key LIKE 'static:v1:%')
           AND (es.ends_on IS NULL OR es.ends_on >= CURRENT_DATE)
         ORDER BY es.city_id, es.title
    ");
    $rows = $stmt->fetchAll(\PDO::FETCH_ASSOC);

    Response::json([
        'venues' => array_map(static fn(array $r) => [
            'id'         => $r['id'],
            'name'       => $r['title'],
            'city_name'  => $r['city_name'],
            'updated_at' => (int) $r['created_at'],
        ], $rows),
        'total'  => count($rows),
    ]);
});

// GET /api/v1/sitemap/events
// Global list of indexable event pages (/event/<slug>-<id>) across every city.
// Single-call endpoint used by the dynamic sitemap (apps/web/api/sitemap.mjs).
//
// Inclusion rules — must match what /event/<id> actually serves as indexable:
//   - expires_at > now() ⇒ excludes both expired AND soft-deleted events
//     (soft-deleted events get expires_at pushed into the past), so we never
//     list a 410/removed page.
//   - NOT a venue occurrence — venues have their own /venue/<slug>-<id> page;
//     this is the same non-venue filter used by /api/v1/sitemap/categories.
//   - ONE occurrence per recurring series — a recurring series (e.g. a daily
//     "happy hours") generates many near-identical dated occurrence pages.
//     Advertising them all made Google cluster them as duplicates ("Google
//     chose a different canonical"). We emit only the soonest non-expired
//     occurrence per series (via DISTINCT ON); one-off events (series_id NULL)
//     are all kept. Cuts crawl sprawl and the response payload.
// Hangouts/topics are a different entity entirely and never appear here.
// Index-backed by idx_channel_events_expires. LIMIT keeps us inside one
// 50k-URL sitemap file; realistic active-event counts are far below it.
$router->add('GET', '/api/v1/sitemap/events', function () {
    // updated_at is bumped on every Hilads-event edit (EventRepository::update)
    // so this is a real change-signal for Google. TM-imported events keep
    // updated_at = created_at because re-syncs are no-ops most of the time
    // and we don't want false re-crawl signals every cron tick.
    $stmt = Database::pdo()->query("
        SELECT id, title, updated_at FROM (
            SELECT DISTINCT ON (COALESCE(ce.series_id, ce.channel_id))
                   ce.channel_id                              AS id,
                   ce.title                                   AS title,
                   ce.starts_at                               AS starts_at,
                   EXTRACT(EPOCH FROM ce.updated_at)::INTEGER AS updated_at
              FROM channel_events ce
              LEFT JOIN event_series es ON es.id = ce.series_id
             WHERE ce.expires_at > now()
               AND (es.id IS NULL
                    OR es.source <> 'import'
                    OR (es.source_key NOT LIKE 'places:v1:%'
                        AND es.source_key NOT LIKE 'static:v1:%'))
             -- Prefer the canonical recurring row (occurrence_date IS NULL → sorts
             -- first) over any legacy materialized occurrence during the migration
             -- window, so DISTINCT ON never emits a soon-to-be-deleted occurrence.
             ORDER BY COALESCE(ce.series_id, ce.channel_id),
                      (ce.occurrence_date IS NOT NULL),
                      ce.starts_at
        ) dedup
        ORDER BY dedup.starts_at
        LIMIT 40000
    ");
    $rows = $stmt->fetchAll(\PDO::FETCH_ASSOC);

    Response::json([
        'events' => array_map(static fn(array $r) => [
            'id'         => $r['id'],
            'title'      => $r['title'],
            'updated_at' => (int) $r['updated_at'],
        ], $rows),
        'total'  => count($rows),
    ]);
});

// GET /api/v1/cities/{slug}/venues
// Lists active venues in a city. Used by the city page + sitemap generator.
// Resolves slug to a city channel before query.
$router->add('GET', '/api/v1/cities/{slug}/venues', function (array $params) {
    $slug = strtolower(trim($params['slug'] ?? ''));
    if ($slug === '') {
        Response::json(['error' => 'Missing slug'], 400);
    }

    $build = static function () use ($slug): ?array {
        $city = null;
        foreach (CityRepository::all() as $c) {
            $citySlug = trim(preg_replace('/[^a-z0-9]+/', '-', strtolower($c['name'])), '-');
            if ($citySlug === $slug) { $city = $c; break; }
        }
        if ($city === null) return null;

        $venues = EventSeriesRepository::listVenuesByCity((int) $city['id']);
        return [
            'venues'  => array_map(static fn(array $v) => [
                'id'         => $v['id'],
                'name'       => $v['title'],
                'address'    => $v['location'],
                'category'   => $v['event_type'] === 'drinks' ? 'bar' : 'cafe',
                'event_type' => $v['event_type'],
                'updated_at' => (int) $v['created_at'],
            ], $venues),
            'total'   => count($venues),
        ];
    };

    // Crawler hits cached (×19 locales collapse to one query); app computes fresh.
    // Venue lists change rarely → 30 min.
    $payload = isset($_SERVER['HTTP_X_HILADS_SSR'])
        ? Cache::remember("city_venues:$slug", 1800, $build)
        : $build();

    if ($payload === null) {
        Response::json(['error' => 'City not found'], 404);
    }
    Response::json($payload);
});

// GET /api/v1/events/{eventId}
// Returns a single event by hex channel ID. Used for deep-linked event URLs.
// Optional query params: guestId (32-char hex) — when provided, adds participant_count
// and is_participating to the event object so the CTA renders correctly on first load.
$router->add('GET', '/api/v1/events/{eventId}', function (array $params) {
    $eventId = $params['eventId'] ?? '';

    if (!preg_match('/^[a-f0-9]{16}$/', $eventId)) {
        Response::json(['error' => 'Invalid eventId'], 400);
    }

    // Use findByIdAnyState so PAST events keep returning 200 (the "Past event"
    // view) instead of 404ing out of Google's index. The state branches:
    //   null              → 404 (never existed)
    //   status 'deleted'  → 410 Gone (moderated/removed — deindex permanently)
    //   else              → 200 (past, current, or future; carries is_past)
    $event = EventRepository::findByIdAnyState($eventId);
    if ($event === null) {
        Response::json(['error' => 'Event not found'], 404);
    }
    if (($event['event_status'] ?? 'scheduled') === 'deleted') {
        Response::json(['error' => 'Event removed'], 410);
    }

    // Block check (Apple G1.2): hide the event if the viewer has blocked the
    // host or been blocked by them. Mirror "not found" so neither side leaks
    // block state.
    $viewerForBlocks = AuthService::currentUser();
    $viewerGuestForBlocks = isValidGuestId($_GET['guestId'] ?? null) ? $_GET['guestId'] : null;
    $blocks = viewerBlockSet($viewerForBlocks['id'] ?? null, $viewerGuestForBlocks);
    if ((!empty($event['user_id'])  && in_array($event['user_id'],  $blocks['user_ids'],  true))
     || (!empty($event['guest_id']) && in_array($event['guest_id'], $blocks['guest_ids'], true))) {
        Response::json(['error' => 'Event not found or expired'], 404);
    }

    // Embed participation state when caller passes their persistent guestId.
    // This eliminates a round-trip and avoids the race condition where the CTA
    // briefly shows "Join" before the secondary /participants fetch completes.
    // $viewerForBlocks is the logged-in user (or null) — already resolved above.
    // Pass their user_id so a registered user reads as participating even when
    // their current guestId/sessionId differs from the one stored at join time.
    $viewerUserId = $viewerForBlocks['id'] ?? null;
    $guestId   = trim($_GET['guestId']   ?? '');
    $sessionId = trim($_GET['sessionId'] ?? '');
    $event['participant_count'] = ParticipantRepository::getCount($eventId);
    if (isValidGuestId($guestId)) {
        $event['is_participating'] = ParticipantRepository::isIn($eventId, $guestId, $viewerUserId);
    } elseif (isValidSessionId($sessionId)) {
        $event['is_participating'] = ParticipantRepository::isIn($eventId, $sessionId, $viewerUserId);
    } elseif ($viewerUserId !== null) {
        // No valid session key, but a logged-in user may have joined elsewhere.
        $event['is_participating'] = ParticipantRepository::isIn($eventId, '', $viewerUserId);
    } else {
        $event['is_participating'] = false;
    }

    // Also resolve the city name so the frontend can hydrate city context
    $city = CityRepository::findById($event['channel_id']);
    Response::json([
        'event'    => $event,
        'cityName' => $city['name'] ?? null,
        'country'  => $city['country'] ?? null,
        'timezone' => $city['timezone'] ?? 'UTC',
    ]);
});

$router->add('GET', '/api/v1/channels', function () {
    // Five batch queries — no per-city loops
    $eventCounts    = EventRepository::getCountsPerCity();
    $topicCounts    = TopicRepository::getCountsPerCity();
    $messageStats   = MessageRepository::getStatsBatch();
    $presenceCounts = PresenceRepository::getCountBatch();

    $channels = [];

    foreach (CityRepository::all() as $city) {
        $id    = $city['id'];
        $stats = $messageStats[$id] ?? ['messageCount' => 0, 'recentMessageCount' => 0, 'lastActivityAt' => null];

        $channels[] = [
            'channelId'          => $id,
            'city'               => $city['name'],
            'country'            => $city['country'] ?? null,
            'timezone'           => $city['timezone'],
            'messageCount'       => $stats['messageCount'],
            'recentMessageCount' => $stats['recentMessageCount'] ?? 0,
            'activeUsers'        => $presenceCounts[$id] ?? 0,
            'lastActivityAt'     => $stats['lastActivityAt'],
            'eventCount'         => $eventCounts[$id] ?? 0,
            'topicCount'         => $topicCounts[$id]  ?? 0,
        ];
    }

    // Optional ranking filter — sort + return top 10 when ?sort= is provided
    $sort = $_GET['sort'] ?? null;
    if ($sort !== null) {
        usort($channels, function ($a, $b) use ($sort) {
            switch ($sort) {
                case 'events':
                    $d = ($b['eventCount'] ?? 0) <=> ($a['eventCount'] ?? 0);
                    return $d !== 0 ? $d : (($b['recentMessageCount'] ?? 0) <=> ($a['recentMessageCount'] ?? 0));
                case 'online':
                    $d = ($b['activeUsers'] ?? 0) <=> ($a['activeUsers'] ?? 0);
                    return $d !== 0 ? $d : (($b['recentMessageCount'] ?? 0) <=> ($a['recentMessageCount'] ?? 0));
                default: // 'active' — most messages in last 24 h, tiebreak total messages
                    $d = ($b['recentMessageCount'] ?? 0) <=> ($a['recentMessageCount'] ?? 0);
                    return $d !== 0 ? $d : (($b['messageCount'] ?? 0) <=> ($a['messageCount'] ?? 0));
            }
        });
        $channels = array_slice($channels, 0, 10);
    }

    Response::json(['channels' => $channels]);
});

$router->add('POST', '/api/v1/channels/{channelId}/join', function (array $params) {
    $startedAt = microtime(true);
    $channelId = filter_var($params['channelId'], FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);

    if ($channelId === false) {
        Response::json(['error' => 'Invalid channelId'], 400);
    }

    try {
        $body = Request::json();

        if ($body === null) {
            Response::json(['error' => 'Invalid JSON body'], 400);
        }

        $sessionId = $body['sessionId'] ?? null;
        $guestId   = $body['guestId']  ?? null;
        $nickname  = $body['nickname'] ?? null;

        // ── Phase timing ──────────────────────────────────────────────────────
        // $startedAt is set at handler entry (before body parse).
        // $t0 is set here, after body parse.
        // 'pre_phase' in the log captures: router scan + Request::json().
        // Should be ~0ms. If >5ms, something unexpected is blocking body parse.
        $t0 = microtime(true);

        // ── DB connection acquisition (timed separately from query execution) ─
        //
        // SINGLE CONNECTION GUARANTEE: Database::pdo() is a per-request singleton.
        // All subsequent calls (joinWithAuth, membership upsert, MessageRepository)
        // return the same PDO instance — no multiple connections per request.
        //
        // With PDO::ATTR_PERSISTENT, PHP-FPM reuses the underlying TCP socket
        // across requests in the same worker process:
        //   <5 ms  → TCP reused (warm worker, persistent conn alive)
        //   >100 ms → new TCP+TLS handshake (cold worker or Supabase idle timeout)
        //
        // Database::lastConnMs() tells us which case we're in so we can distinguish
        // "slow query" from "slow connection" in the logs.
        Database::pdo();
        $tConn = microtime(true);

        enforceRateLimit('channel_join', 90, 300);

        $tRateLimit = microtime(true);

        // City validation intentionally removed from the synchronous path.
        // Previously: CityRepository::findById triggered a DB round-trip on cold
        // workers (the first call establishes the DB connection AND runs a
        // SELECT FROM channels JOIN cities — adding up to 400ms before joinWithAuth).
        // The client always provides a valid channelId (from the /channels list),
        // so a 404 guard here has no practical value. An invalid channelId would
        // fail at the presence upsert with a FK violation (→ 500), which is fine.
        // City data is still loaded (APCu-cached) in post-response analytics below.

        if (!isValidSessionId($sessionId)) {
            Response::json(['error' => 'sessionId is required'], 400);
        }

        if (!isValidGuestId($guestId)) {
            Response::json(['error' => 'guestId is required'], 400);
        }

        if (empty($nickname) || !is_string($nickname)) {
            Response::json(['error' => 'nickname is required'], 400);
        }

        $nickname = mb_substr(trim(strip_tags($nickname)), 0, 20);

        if ($nickname === '') {
            Response::json(['error' => 'nickname must not be empty'], 400);
        }

        $tValidation = microtime(true);

        // ── Single DB round-trip: presence upsert + auth user resolution ──────
        //
        // One CTE handles presence upsert, new-session check, and auth lookup.
        // The auth subquery is a simple PK lookup — ~0ms overhead over the upsert.
        // Guests (no cookie/token) skip the auth subquery entirely.
        $authToken = $_COOKIE['hilads_token'] ?? null;
        if ($authToken === null) {
            $authHeader = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
            if (str_starts_with($authHeader, 'Bearer ')) {
                $authToken = substr($authHeader, 7);
            }
        }

        $joinResult   = PresenceRepository::joinWithAuth($channelId, $sessionId, $guestId, $nickname, $authToken);
        $isNewSession = $joinResult['isNew'];
        $joinUserId   = $joinResult['authUserId']; // null for guests

        $tPresenceAuth = microtime(true);

        // ── Build response message (no DB — pure PHP) ─────────────────────────
        // IDENTITY RULE: userId comes strictly from the authenticated session token —
        // never from a guest_id → users table lookup.
        $message = null;
        if ($isNewSession) {
            $message = [
                'type'      => 'system',
                'event'     => 'join',
                'guestId'   => $guestId,
                'userId'    => $joinUserId,
                'nickname'  => $nickname,
                'createdAt' => time(),
            ];
        }

        $tDone = microtime(true);
        apiLog('channel_join', 'success', [
            'channelId'   => $channelId,
            'isNew'       => $isNewSession,
            'isAuth'      => $joinUserId !== null,
            'elapsedMs'   => apiElapsedMs($startedAt),
            // ── Per-phase breakdown ───────────────────────────────────────────
            // conn_acquire: time to call Database::pdo() — <5ms = TCP reused,
            //               >100ms = new TCP+TLS handshake to Supabase pooler.
            // conn_new_tcp: true when new PDO() took >50ms (new TCP connection).
            // rate_limit:   APCu lookup — should always be ~0ms.
            // validation:   input parsing — should always be ~0ms.
            // presence_auth: the CTE query RTT (upsert + optional auth lookup).
            //                This is PURE query time, no connection setup included.
            // build:        JSON assembly — should always be ~0ms.
            // ─────────────────────────────────────────────────────────────────
            'phases_ms'   => [
                // pre_phase: time from handler entry to start of phase tracking.
                // Covers router scan (82 routes × regex) + Request::json() body parse.
                // Should be ~0–2ms. If higher, investigate Request::json() or OPcache.
                'pre_phase'     => round(($t0            - $startedAt)     * 1000, 1),
                // conn_acquire: new PDO() call. <5ms = TCP reused; >100ms = new TCP+TLS.
                'conn_acquire'  => round(($tConn         - $t0)            * 1000, 1),
                'conn_new_tcp'  => Database::lastConnMs() > 50,
                'rate_limit'    => round(($tRateLimit    - $tConn)         * 1000, 1),
                'validation'    => round(($tValidation   - $tRateLimit)    * 1000, 1),
                // presence_auth: pure query RTT (no connection setup — that's conn_acquire).
                // Expected: ~2× one-way network RTT to Supabase + query execution time.
                'presence_auth' => round(($tPresenceAuth - $tValidation)   * 1000, 1),
                'build'         => round(($tDone         - $tPresenceAuth) * 1000, 1),
            ],
        ]);

    } catch (\Throwable $e) {
        apiLog('channel_join', 'failure', [
            'channelId' => $channelId,
            'elapsedMs' => apiElapsedMs($startedAt),
            'error' => get_class($e) . ': ' . $e->getMessage(),
        ]);
        throw $e;
    }

    // ── Flush response to client ──────────────────────────────────────────────
    //
    // Explicitly drain ALL output buffer levels before fastcgi_finish_request().
    //
    // Why: index.php calls ob_start(), and PHP-FPM may also enable output_buffering
    // in php.ini (typically 4096 bytes). That creates two ob levels. If the inner
    // level is not flushed first, fastcgi_finish_request() may not deliver the
    // response to the client before post-response work begins — causing all deferred
    // DB queries + analytics curl to block the client.
    //
    // The explicit while-loop guarantees every ob level is flushed regardless of
    // environment (Render, Docker, nginx proxy, php.ini settings).
    http_response_code(201);
    echo json_encode(['message' => $message ?? null]);

    while (ob_get_level() > 0) {
        ob_end_flush();
    }
    flush();
    if (function_exists('fastcgi_finish_request')) {
        fastcgi_finish_request(); // close FPM ↔ nginx FastCGI pipe — client has response NOW
    }

    // ── Post-response: previous channel leave ─────────────────────────────────
    $previousChannelId = isset($body['previousChannelId'])
        ? filter_var($body['previousChannelId'], FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]])
        : false;

    if ($previousChannelId !== false && $previousChannelId !== $channelId) {
        try {
            PresenceRepository::leave($previousChannelId, $sessionId);
        } catch (\Throwable $e) {
            error_log('[channel_join] previous leave failed: ' . $e->getMessage());
        }
    }

    // ── Post-response: city membership upsert (auth users only) ──────────────
    // Only tracked for authenticated users — $joinUserId comes from the CTE
    // resolved in joinWithAuth(), no extra query needed.
    //
    // Guests without an auth token are intentionally excluded: looking up a
    // user by guest_id would add a full DB round trip (~220ms to Tokyo) for
    // near-zero value. If a guest later registers, the membership is written
    // on their first authenticated join.
    if ($joinUserId) {
        try {
            Database::pdo()->prepare("
                INSERT INTO user_city_memberships (user_id, channel_id, first_seen_at, last_seen_at)
                VALUES (?, ?, now(), now())
                ON CONFLICT (user_id, channel_id) DO UPDATE SET last_seen_at = now()
            ")->execute([$joinUserId, 'city_' . $channelId]);
        } catch (\Throwable $e) {
            error_log('[channel_join] membership upsert failed: ' . $e->getMessage());
        }
        // Stamp user_id onto the live presence row so city-wide pushes
        // (city_join / channel_message) can find this member online.
        try { PresenceRepository::stampUser($channelId, $sessionId, $joinUserId); }
        catch (\Throwable $e) { error_log('[channel_join] presence stamp failed: ' . $e->getMessage()); }
    }

    // ── Post-response: analytics ──────────────────────────────────────────────
    if ($isNewSession) {
        $cityInfo = CityRepository::findById($channelId); // in-process cache — 0ms
        AnalyticsService::capture('joined_city', $joinUserId ?? $guestId, [
            'channel_id' => $channelId,
            'city'       => $cityInfo['name']    ?? null,
            'country'    => $cityInfo['country'] ?? null,
            'is_guest'   => $joinUserId === null,
            'user_id'    => $joinUserId ?? null,
            'guest_id'   => $joinUserId === null ? $guestId : null,
        ]);

        // Arrival: ONE genuine-arrival gate drives BOTH the feed "X just landed"
        // system message AND the city push. emitCityArrival self-excludes the
        // arriver (push) and enforces the per-(arriver, city) cooldown atomically,
        // so a foreground/reconnect/quick-return emits neither a feed msg nor a push.
        try {
            NotificationRepository::emitCityArrival(
                $channelId,
                $joinUserId,
                $guestId,
                $nickname,
                $cityInfo['name'] ?? null,
            );
        } catch (\Throwable $e) {
            error_log('[channel_join] arrival emit failed: ' . $e->getMessage());
        }
    }

    exit;
});

// ── Channel bootstrap ─────────────────────────────────────────────────────────
// Fast join endpoint: presence + messages + auth badges only.
// Events and topics are NOT included — clients fetch /now in background after render.
//
// DB queries: 4-6 synchronous.
// Deferred after response: presence-leave, membership upsert, weather inject, TM sync, analytics.
//
// Request body: { sessionId, guestId, nickname, previousChannelId? }
// Query params: before_id?, limit? (for messages pagination)
//
// Response:
//   joinMessage        — join feed entry, or null for re-joins
//   messages           — last N chat messages (badge-enriched)
//   hasMore            — pagination cursor flag
//   onlineUsers        — always [] (clients use WebSocket presenceSnapshot)
//   onlineCount        — integer (from presence UPSERT, no extra query)
//   hasUnreadDMs       — bool (auth users) or null (guests)
//   unreadNotifications — int (auth users) or null (guests)
//   currentUser        — public user fields (auth users) or null (guests)
$router->add('POST', '/api/v1/channels/{channelId}/bootstrap', function (array $params) {
    $startedAt = microtime(true);
    $channelId = filter_var($params['channelId'], FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);

    if ($channelId === false) {
        Response::json(['error' => 'Invalid channelId'], 400);
    }

    try {
        $body = Request::json();
        if ($body === null) {
            Response::json(['error' => 'Invalid JSON body'], 400);
        }

        $sessionId = $body['sessionId'] ?? null;
        $guestId   = $body['guestId']  ?? null;
        $nickname  = $body['nickname'] ?? null;

        // ── startup timing: rate-limit + city lookup ──────────────────────────
        // These run before $t0. Rate-limit uses APCu (fast) or file-lock (slow).
        // City lookup runs a DB query only on the first call per worker; subsequent
        // calls hit the in-process cache. Both are invisible in the old phases_ms.
        $tRlA = microtime(true);
        enforceRateLimit('channel_join', 90, 300);
        $tRlB = microtime(true);

        // ── q1: city lookup (worker-level cached after first call) ────────────
        $tCityA = microtime(true);
        $city = CityRepository::findById($channelId);
        $tCityB = microtime(true);
        if ($city === null) {
            Response::json(['error' => 'Channel not found'], 404);
        }

        if (!isValidSessionId($sessionId)) {
            Response::json(['error' => 'sessionId is required'], 400);
        }
        if (!isValidGuestId($guestId)) {
            Response::json(['error' => 'guestId is required'], 400);
        }
        if (empty($nickname) || !is_string($nickname)) {
            Response::json(['error' => 'nickname is required'], 400);
        }

        $nickname = mb_substr(trim(strip_tags($nickname)), 0, 20);
        if ($nickname === '') {
            Response::json(['error' => 'nickname must not be empty'], 400);
        }

        // ?lean=1 — skip auth queries (q3/q7/q8) and badge enrichment (q6).
        // Web passes this flag; mobile omits it and gets the full response.
        // Saves 3–5 sequential DB queries on the critical path for web clients.
        $lean = isset($_GET['lean']) && $_GET['lean'] === '1';

        // ── Phase 1: join ────────────────────────────────────────────────────
        $t0 = microtime(true);

        $previousChannelId = isset($body['previousChannelId'])
            ? filter_var($body['previousChannelId'], FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]])
            : false;

        // Defer presence-leave — pure side-effect, never blocks response.
        if ($previousChannelId !== false && $previousChannelId !== $channelId) {
            $deferPrev = $previousChannelId;
            $deferSid  = $sessionId;
            register_shutdown_function(static function () use ($deferPrev, $deferSid): void {
                if (function_exists('fastcgi_finish_request')) fastcgi_finish_request();
                try { PresenceRepository::leave($deferPrev, $deferSid); }
                catch (\Throwable $e) { error_log('[bootstrap] leave failed: ' . $e->getMessage()); }
            });
        }

        // ── q2: presence join + online count (single round-trip) ────────────────
        $tq2a         = microtime(true);
        $joinResult   = PresenceRepository::join($channelId, $sessionId, $guestId, $nickname, true);
        $isNewSession = $joinResult['isNew'];
        $onlineCount  = $joinResult['onlineCount'];
        $tq2b         = microtime(true);

        // ── q3: auth lookup (request-level cached) ────────────────────────────
        // Skipped in lean mode — web never reads currentUser/unread from bootstrap.
        $authUser        = $lean ? null : AuthService::currentUser();
        $tq3b            = microtime(true);
        $deferAuthUserId = $authUser ? $authUser['id'] : null;

        // Defer persistent city membership upsert.
        $deferGuestId = $guestId;
        $deferChannel = 'city_' . $channelId;
        register_shutdown_function(static function () use ($deferAuthUserId, $deferGuestId, $deferChannel, $channelId, $sessionId): void {
            if (function_exists('fastcgi_finish_request')) fastcgi_finish_request();
            try {
                $pdo = Database::pdo();
                $uid = $deferAuthUserId;
                if (!$uid) {
                    $stmt = $pdo->prepare("SELECT id FROM users WHERE guest_id = ?");
                    $stmt->execute([$deferGuestId]);
                    $uid = $stmt->fetchColumn() ?: null;
                }
                if ($uid) {
                    $pdo->prepare("
                        INSERT INTO user_city_memberships (user_id, channel_id, first_seen_at, last_seen_at)
                        VALUES (?, ?, now(), now())
                        ON CONFLICT (user_id, channel_id) DO UPDATE SET last_seen_at = now()
                    ")->execute([$uid, $deferChannel]);
                    // Stamp user_id onto the live presence row so city-wide pushes
                    // (city_join / channel_message) can find this member online.
                    try { PresenceRepository::stampUser($channelId, $sessionId, $uid); }
                    catch (\Throwable $e) { error_log('[bootstrap] presence stamp failed: ' . $e->getMessage()); }
                }
            } catch (\Throwable $e) {
                error_log('[bootstrap] membership upsert failed: ' . $e->getMessage());
            }
        });

        // ── q4 (conditional): join feed event — deferred ─────────────────────
        // The joining user never consumes joinMessage from the bootstrap response
        // (it is parsed but unused on mobile). Deferring saves ~100ms on new sessions
        // while ensuring the event still appears for other users on their next poll.
        $joinMessage = null;
        if ($isNewSession) {
            $deferJoinChannelId = $channelId;
            $deferJoinGuestId   = $guestId;
            $deferJoinNickname  = $nickname;
            $deferJoinUserId    = $deferAuthUserId;
            register_shutdown_function(
                static function () use ($deferJoinChannelId, $deferJoinGuestId, $deferJoinNickname, $deferJoinUserId): void {
                    if (function_exists('fastcgi_finish_request')) fastcgi_finish_request();
                    // Arrival: ONE genuine-arrival gate drives BOTH the feed "X just
                    // landed" system message AND the city push. emitCityArrival resolves
                    // the arriver's user id (lean bootstrap skips auth, so $deferJoinUserId
                    // is null here) to self-exclude them, and enforces the per-(arriver,
                    // city) cooldown atomically — so a foreground/reconnect/quick-return
                    // emits neither a feed message nor a push.
                    try {
                        $cityInfo = CityRepository::findById($deferJoinChannelId);
                        NotificationRepository::emitCityArrival(
                            $deferJoinChannelId,
                            $deferJoinUserId,
                            $deferJoinGuestId,
                            $deferJoinNickname,
                            $cityInfo['name'] ?? null,
                        );
                    } catch (\Throwable $e) {
                        error_log('[bootstrap] arrival emit failed: ' . $e->getMessage());
                    }
                }
            );
        }

        $t1 = microtime(true); // after join

        // ── Phase 2: messages + badge enrichment ────────────────────────────────
        // Online presence (full list) is intentionally NOT fetched here.
        // Clients receive presence via the WebSocket presenceSnapshot event immediately
        // after connecting, which always supersedes any bootstrap list. Skipping getOnline
        // removes 1 sequential DB query (DISTINCT ON + LEFT JOIN) from the critical path.
        $beforeId = isset($_GET['before_id']) && is_string($_GET['before_id'])
            ? trim($_GET['before_id']) : null;
        // 25 messages for initial bootstrap — faster query + smaller payload.
        // Client can fetch older pages via before_id pagination.
        $limit = min(100, max(10, (int) ($_GET['limit'] ?? 25)));

        // ── q5: chat messages ─────────────────────────────────────────────────
        $tq5a        = microtime(true);
        $msgResult   = MessageRepository::getByChannel($channelId, $beforeId ?: null, $limit);
        $messages    = $msgResult['messages'];
        $hasMore     = $msgResult['hasMore'];
        $tq5b        = microtime(true);

        // ── Block filter (Apple G1.2) ─────────────────────────────────────────
        // Drop messages from anyone the viewer has blocked or been blocked by.
        // Filtered after the fetch so we don't have to splice IDs into every
        // call site of MessageRepository::getByChannel.
        $bootstrapBlocks = viewerBlockSet($deferAuthUserId, $guestId);
        $messages        = filterByBlocks($messages, $bootstrapBlocks);

        // ── q6: badge enrichment for message authors ──────────────────────────
        // Skipped in lean mode — web fetches badges via /message-badges after first render.
        // In all-guest rooms msgUserIds is empty → batchFull skips the query anyway.
        $msgUserIds = [];
        foreach ($messages as $msg) {
            $t = $msg['type'] ?? 'text';
            if (($t === 'text' || $t === 'image') && !empty($msg['userId'])) {
                $msgUserIds[] = $msg['userId'];
            }
        }
        $msgUserIds = array_values(array_unique($msgUserIds));
        $tq6a = microtime(true);

        if (!$lean && !empty($msgUserIds)) {
            $badgeMap = UserBadgeService::batchFull($msgUserIds, $channelId, $city['name']);
        } else {
            $badgeMap = [];
        }
        $tq6b = microtime(true);

        foreach ($messages as &$msg) {
            $t = $msg['type'] ?? 'text';
            if ($t === 'text' || $t === 'image') {
                $uid = $msg['userId'] ?? null;
                if ($uid && isset($badgeMap[$uid])) {
                    $b = $badgeMap[$uid];
                    $msg['primaryBadge'] = $b['primaryBadge'];
                    $msg['contextBadge'] = $b['contextBadge'];
                    $msg['vibe']         = $b['vibe'] ?? 'chill';
                    $msg['mode']         = $b['mode'] ?? 'exploring';
                } else {
                    $msg['primaryBadge'] = ['key' => 'ghost', 'label' => '👻 Ghost'];
                    $msg['contextBadge'] = null;
                    $msg['vibe']         = null;
                    $msg['mode']         = null;
                }
            }
        }
        unset($msg);

        $t2 = microtime(true); // after messages + badges (lean: messages only)

        // ── reactions ────────────────────────────────────────────────────────
        // Attach emoji reactions to every message in the bootstrap payload.
        // The $guestId comes from the POST body. userId is derived from the
        // active session (same AuthService call used by the messages endpoint;
        // it's request-level cached so calling it here costs nothing in lean mode).
        $bootstrapViewerUserId = AuthService::currentUser()['id'] ?? null;
        MessageRepository::attachReactions($messages, $guestId ?: null, $bootstrapViewerUserId);

        // ── Phase 3: auth-conditional unread data ────────────────────────────
        // Skipped entirely in lean mode — web fetches these independently with a 2 s delay.
        // For full (mobile) mode: only run for authenticated users.
        $hasUnreadDMs        = null;
        $unreadNotifications = null;
        $currentUser         = null;

        $tq7a = microtime(true);
        if (!$lean && $authUser !== null) {
            // ── q7: DM + event-chat unread check ─────────────────────────────
            $hasUnreadDMs = ConversationRepository::hasAnyUnread($authUser['id']);
            $tq7b = microtime(true);

            // ── q8: notification unread count ─────────────────────────────────
            $unreadNotifications = NotificationRepository::unreadCount($authUser['id']);
            $tq8b = microtime(true);

            // currentUser — no extra query (data already in $authUser row)
            $currentUser = AuthService::publicFields($authUser);
        } else {
            $tq7b = $tq7a;
            $tq8b = $tq7a;
        }

        $t3 = microtime(true); // after auth data (lean: instant, no queries)

        // ── Deferred side-effects ────────────────────────────────────────────

        // Weather injection (after response flush)
        $bCid = $channelId; $bCty = $city;
        register_shutdown_function(static function () use ($bCid, $bCty): void {
            if (function_exists('fastcgi_finish_request')) fastcgi_finish_request();
            try { WeatherService::maybeInject($bCid, $bCty); }
            catch (\Throwable $e) { error_log('[bootstrap] weather failed: ' . $e->getMessage()); }
        });

        // Ticketmaster sync (replaces /city-events deferred sync)
        $tmCid  = $channelId;
        $tmName = $city['name'];
        register_shutdown_function(static function () use ($tmCid, $tmName): void {
            if (function_exists('fastcgi_finish_request')) fastcgi_finish_request();
            try { TicketmasterImporter::syncIfNeeded($tmCid, null, null, $tmName); }
            catch (\Throwable $e) { error_log('[bootstrap] TM sync failed: ' . $e->getMessage()); }
        });

        // Analytics
        if ($isNewSession) {
            AnalyticsService::defer('joined_city', $deferAuthUserId ?? $guestId, [
                'channel_id' => $channelId,
                'city'       => $city['name']    ?? null,
                'country'    => $city['country'] ?? null,
                'is_guest'   => $deferAuthUserId === null,
                'user_id'    => $deferAuthUserId ?? null,
                'guest_id'   => $deferAuthUserId === null ? $guestId : null,
            ]);
        }

        // ── serialize: measure json_encode cost on the full response payload ────
        $responsePayload = [
            'joinMessage'         => $joinMessage,
            'messages'            => $messages,
            'hasMore'             => $hasMore,
            'onlineUsers'         => [],
            'onlineCount'         => $onlineCount,
            'hasUnreadDMs'        => $hasUnreadDMs,
            'unreadNotifications' => $unreadNotifications,
            'currentUser'         => $currentUser,
        ];
        $tSerA = microtime(true);
        $responseJson = json_encode($responsePayload, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
        $tSerB = microtime(true);

        // phases_ms accounts for every millisecond in elapsedMs:
        //   startup + join + messages + auth + serialize + overhead ≈ elapsedMs
        // "overhead" is the tiny gap between phase boundaries (array construction,
        // register_shutdown_function calls, this apiLog call itself).
        apiLog('channel_bootstrap', 'success', [
            'channelId'    => $channelId,
            'lean'         => $lean,
            'isNew'        => $isNewSession,
            'isAuth'       => $authUser !== null,
            'msgCount'     => count($messages),
            'badgeUsers'   => $lean ? 0 : count($msgUserIds),
            'onlineCount'  => $onlineCount,
            'elapsedMs'    => apiElapsedMs($startedAt),
            'phases_ms'    => [
                'startup'   => round(($t0 - $startedAt) * 1000, 1),
                'join'      => round(($t1 - $t0) * 1000, 1),
                'messages'  => round(($t2 - $t1) * 1000, 1),
                'auth'      => round(($t3 - $t2) * 1000, 1),
                'serialize' => round(($tSerB - $tSerA) * 1000, 1),
            ],
            'queries_ms'   => [
                'rate_limit'  => round(($tRlB  - $tRlA)  * 1000, 1),
                'city_lookup' => round(($tCityB - $tCityA) * 1000, 1),
                'presence'    => round(($tq2b  - $tq2a)  * 1000, 1),
                'auth_user'   => $lean ? null : round(($tq3b  - $tq2b)  * 1000, 1),
                'messages'    => round(($tq5b  - $tq5a)  * 1000, 1),
                'badges'      => $lean ? null : round(($tq6b  - $tq6a)  * 1000, 1),
                'unread_dm'   => $lean ? null : round(($tq7b  - $tq7a)  * 1000, 1),
                'notif_cnt'   => $lean ? null : round(($tq8b  - $tq7b)  * 1000, 1),
            ],
        ]);

        Response::json($responsePayload, 201, $responseJson);
    } catch (\Throwable $e) {
        apiLog('channel_bootstrap', 'failure', [
            'channelId' => $channelId,
            'elapsedMs' => apiElapsedMs($startedAt),
            'error'     => get_class($e) . ': ' . $e->getMessage(),
        ]);
        throw $e;
    }
});

// ── Message badge enrichment (deferred — called by web after first render) ──────
// GET /api/v1/channels/{channelId}/message-badges?ids[]=uid1&ids[]=uid2
// Returns badge data for the given registered user IDs.
// Web uses lean bootstrap (no badges), then enriches the feed with this endpoint
// after the city channel is already usable — keeping bootstrap under 500 ms.
$router->add('GET', '/api/v1/channels/{channelId}/message-badges', function (array $params) {
    $channelId = filter_var($params['channelId'], FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    if ($channelId === false) {
        Response::json(['error' => 'Invalid channelId'], 400);
    }

    $city = CityRepository::findById($channelId);
    if ($city === null) {
        Response::json(['error' => 'Channel not found'], 404);
    }

    // Collect and validate user IDs from query string: ?ids[]=uid1&ids[]=uid2
    $rawIds = isset($_GET['ids']) && is_array($_GET['ids']) ? $_GET['ids'] : [];
    $ids    = array_values(array_unique(array_filter(
        array_map('strval', $rawIds),
        static fn($id) => preg_match('/^[0-9a-f\-]{8,64}$/i', $id) === 1
    )));

    if (empty($ids)) {
        Response::json(['badges' => (object) []]);
    }

    // Limit to 50 IDs — a page of 25 messages has at most ~25 unique authors
    $ids     = array_slice($ids, 0, 50);
    $badges  = UserBadgeService::batchFull($ids, $channelId, $city['name']);

    Response::json(['badges' => empty($badges) ? (object) [] : $badges]);
});

$router->add('POST', '/api/v1/channels/{channelId}/leave', function (array $params) {
    $channelId = filter_var($params['channelId'], FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);

    if ($channelId === false) {
        Response::json(['error' => 'Invalid channelId'], 400);
    }

    if (CityRepository::findById($channelId) === null) {
        Response::json(['error' => 'Channel not found'], 404);
    }

    $body = Request::json();

    if ($body === null) {
        Response::json(['error' => 'Invalid JSON body'], 400);
    }

    $sessionId = $body['sessionId'] ?? null;

    if (!isValidSessionId($sessionId)) {
        Response::json(['error' => 'sessionId is required'], 400);
    }

    PresenceRepository::leave($channelId, $sessionId);

    Response::json(['ok' => true]);
});

$router->add('POST', '/api/v1/channels/{channelId}/heartbeat', function (array $params) {
    $channelId = filter_var($params['channelId'], FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);

    if ($channelId === false) {
        Response::json(['error' => 'Invalid channelId'], 400);
    }

    if (CityRepository::findById($channelId) === null) {
        Response::json(['error' => 'Channel not found'], 404);
    }

    $body = Request::json();

    if ($body === null) {
        Response::json(['error' => 'Invalid JSON body'], 400);
    }

    $sessionId = $body['sessionId'] ?? null;
    $guestId   = $body['guestId']  ?? null;
    $nickname  = $body['nickname'] ?? null;

    enforceRateLimit('channel_heartbeat', 240, 300, (string) $channelId);

    if (!isValidSessionId($sessionId)) {
        Response::json(['error' => 'sessionId is required'], 400);
    }

    if (!isValidGuestId($guestId)) {
        Response::json(['error' => 'guestId is required'], 400);
    }

    if (empty($nickname) || !is_string($nickname)) {
        Response::json(['error' => 'nickname is required'], 400);
    }

    $nickname = mb_substr(trim(strip_tags($nickname)), 0, 20);

    PresenceRepository::heartbeat($channelId, $sessionId, $guestId, $nickname);

    Response::json(['ok' => true]);
});

$router->add('GET', '/api/v1/channels/{channelId}/messages', function (array $params) {
    $startedAt = microtime(true);
    $channelId = filter_var($params['channelId'], FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);

    if ($channelId === false) {
        Response::json(['error' => 'Invalid channelId'], 400);
    }

    try {
        $city = CityRepository::findById($channelId);
        if ($city === null) {
            Response::json(['error' => 'Channel not found'], 404);
        }

        // Inject a live weather system message if 4 h have elapsed since the last one.
        // Deferred: the Open-Meteo HTTP call (up to 4 s) runs after the response is sent
        // so it never adds latency to the messages fetch.
        $cid  = $channelId;
        $cty  = $city;
        register_shutdown_function(static function () use ($cid, $cty): void {
            if (function_exists('fastcgi_finish_request')) {
                fastcgi_finish_request();
            }
            try {
                WeatherService::maybeInject($cid, $cty);
            } catch (\Throwable $e) {
                error_log('[weather] injection failed (non-fatal): ' . $e->getMessage());
            }
        });

        // lean=1: skip presence + badge enrichment — web uses this for the parallel
        // fast-path fetch (fired concurrently with POST /join). Badges are enriched
        // deferred via GET /message-badges after first render.
        $lean = isset($_GET['lean']) && $_GET['lean'] === '1';

        $beforeId = isset($_GET['before_id']) && is_string($_GET['before_id'])
            ? trim($_GET['before_id'])
            : null;
        $limit    = min(100, max(10, (int) ($_GET['limit'] ?? 50)));

        $tMsg0       = microtime(true);
        $msgResult   = MessageRepository::getByChannel($channelId, $beforeId ?: null, $limit);
        $messages    = $msgResult['messages'];
        $hasMore     = $msgResult['hasMore'];
        $tMsg1       = microtime(true); // after message fetch

        // ── Block filter (Apple G1.2) ─────────────────────────────────────────
        $msgViewerGuestId = $_SERVER['HTTP_X_GUEST_ID'] ?? ($_COOKIE['guestId'] ?? null);
        $msgViewerUserId  = AuthService::currentUser()['id'] ?? null;
        $messages = filterByBlocks(
            $messages,
            viewerBlockSet($msgViewerUserId, isValidGuestId($msgViewerGuestId) ? $msgViewerGuestId : null)
        );

        if ($lean) {
            // Ghost badges for all messages — client enriches deferred
            foreach ($messages as &$msg) {
                $t = $msg['type'] ?? 'text';
                if ($t === 'text' || $t === 'image') {
                    $msg['primaryBadge'] = ['key' => 'ghost', 'label' => '👻 Ghost'];
                    $msg['contextBadge'] = null;
                    $msg['vibe']         = null;
                    $msg['mode']         = null;
                }
            }
            unset($msg);

            // Reactions are not skipped in lean mode — they're small and must be
            // present on initial load so users see stored reactions immediately.
            $leanViewerGuestId = $_SERVER['HTTP_X_GUEST_ID'] ?? ($_COOKIE['guestId'] ?? null);
            $leanViewerUserId  = AuthService::currentUser()['id'] ?? null;
            MessageRepository::attachReactions($messages, $leanViewerGuestId ?: null, $leanViewerUserId);

            apiLog('channel_messages', 'success', [
                'channelId' => $channelId,
                'messages'  => count($messages),
                'lean'      => true,
                'elapsedMs' => apiElapsedMs($startedAt),
                'phases_ms' => ['msg_fetch' => round(($tMsg1 - $tMsg0) * 1000, 1)],
            ]);

            Response::json(['messages' => $messages, 'hasMore' => $hasMore]);
        }

        $onlineUsers = PresenceRepository::getOnline($channelId);
        $onlineCount = count($onlineUsers);
        $tMsg2       = microtime(true); // after presence fetch

        // ── Badge enrichment — 1 query covers both messages and presence ─────────
        // Collect unique registered user IDs from messages AND presence together,
        // then call batchFull() once (1 query) instead of the previous 3-query pattern
        // (batchForCity: 2 queries + ambassadorsForCity: 1 query).
        $msgUserIds = [];
        foreach ($messages as $msg) {
            $t = $msg['type'] ?? 'text';
            if (($t === 'text' || $t === 'image') && !empty($msg['userId'])) {
                $msgUserIds[] = $msg['userId'];
            }
        }
        $presenceUserIds = array_values(array_unique(array_filter(
            array_column($onlineUsers, 'userId'),
            fn($id) => !empty($id)
        )));
        $allUserIds = array_values(array_unique(array_merge($msgUserIds, $presenceUserIds)));
        $badgeMap   = UserBadgeService::batchFull($allUserIds, $channelId, $city['name']);
        $tMsg3      = microtime(true); // after badge enrichment

        foreach ($messages as &$msg) {
            $t = $msg['type'] ?? 'text';
            if ($t === 'text' || $t === 'image') {
                if (!empty($msg['userId']) && isset($badgeMap[$msg['userId']])) {
                    $entry = $badgeMap[$msg['userId']];
                    $msg['primaryBadge'] = $entry['primaryBadge'];
                    $msg['contextBadge'] = $entry['contextBadge'];
                    $msg['vibe']         = $entry['vibe'] ?? 'chill';
                    $msg['mode']         = $entry['mode'] ?? 'exploring';
                } else {
                    $msg['primaryBadge'] = ['key' => 'ghost', 'label' => '👻 Ghost'];
                    $msg['contextBadge'] = null;
                    $msg['vibe']         = null;
                    $msg['mode']         = null;
                }
            }
        }
        unset($msg);

        foreach ($onlineUsers as &$u) {
            $uid = $u['userId'] ?? null;
            if (empty($uid)) {
                $u['primaryBadge'] = ['key' => 'ghost', 'label' => '👻 Ghost'];
                $u['contextBadge'] = null;
            } elseif (isset($badgeMap[$uid])) {
                $entry = $badgeMap[$uid];
                $u['primaryBadge'] = $entry['primaryBadge'];
                $u['contextBadge'] = $entry['contextBadge'];
                $u['vibe']         = $entry['vibe'] ?? 'chill';
            } else {
                $u['primaryBadge'] = UserBadgeService::primaryForUser([
                    'created_at' => $u['userCreatedAt'],
                ]);
                $u['contextBadge'] = null;
                $u['vibe']         = $u['userVibe'] ?? 'chill';
            }
            unset($u['userCreatedAt'], $u['userHomeCity'], $u['userVibe']);
        }
        unset($u);
        // ─────────────────────────────────────────────────────────────────────

        // Attach emoji reactions — reads viewer identity from request context
        $viewerGuestId = $_SERVER['HTTP_X_GUEST_ID'] ?? ($_COOKIE['guestId'] ?? null);
        $viewerUserId  = AuthService::currentUser()['id'] ?? null;
        MessageRepository::attachReactions($messages, $viewerGuestId ?: null, $viewerUserId);

        apiLog('channel_messages', 'success', [
            'channelId'   => $channelId,
            'messages'    => count($messages),
            'onlineCount' => $onlineCount,
            'elapsedMs'   => apiElapsedMs($startedAt),
            'phases_ms'   => [
                'msg_fetch'    => round(($tMsg1 - $tMsg0) * 1000, 1),
                'presence'     => round(($tMsg2 - $tMsg1) * 1000, 1),
                'badge_enrich' => round(($tMsg3 - $tMsg2) * 1000, 1),
            ],
        ]);

        Response::json([
            'messages'    => $messages,
            'hasMore'     => $hasMore,
            'onlineUsers' => $onlineUsers,
            'onlineCount' => $onlineCount,
        ]);
    } catch (\Throwable $e) {
        apiLog('channel_messages', 'failure', [
            'channelId' => $channelId,
            'elapsedMs' => apiElapsedMs($startedAt),
            'error' => get_class($e) . ': ' . $e->getMessage(),
        ]);
        throw $e;
    }
});

// ── Avatar thumbnail generation ───────────────────────────────────────────────
//
// Called from the upload endpoint. Scales the source image down to ≤400 px on
// its longest side and re-encodes as JPEG (quality 80).
//
// Returns the path to a temporary file on success, or null on any failure
// (missing GD extension, unsupported type, or an error during resizing).
// Callers MUST unlink the returned path when done with it.
//
// Safe to call on any valid image: if the source is already small, it is
// re-encoded as JPEG but not enlarged.
function generateAvatarThumbnail(string $srcPath, string $srcMime, int $maxDim = 400, int $quality = 80): ?string
{
    if (!extension_loaded('gd')) {
        return null;
    }

    $info = @getimagesize($srcPath);
    if (!$info || empty($info[0]) || empty($info[1])) {
        return null;
    }

    [$srcW, $srcH] = $info;

    $src = match ($srcMime) {
        'image/jpeg' => @imagecreatefromjpeg($srcPath),
        'image/png'  => @imagecreatefrompng($srcPath),
        'image/webp' => @imagecreatefromwebp($srcPath),
        default      => null,
    };
    if (!$src) {
        return null;
    }

    if ($srcW >= $srcH) {
        $newW = min($srcW, $maxDim);
        $newH = (int) round($srcH * $newW / $srcW);
    } else {
        $newH = min($srcH, $maxDim);
        $newW = (int) round($srcW * $newH / $srcH);
    }

    $dst = imagecreatetruecolor($newW, $newH);
    if (!$dst) {
        imagedestroy($src);
        return null;
    }

    // Preserve transparency for PNG sources
    imagealphablending($dst, false);
    imagesavealpha($dst, true);
    $white = imagecolorallocate($dst, 255, 255, 255);
    imagefilledrectangle($dst, 0, 0, $newW, $newH, $white);
    imagealphablending($dst, true);

    imagecopyresampled($dst, $src, 0, 0, 0, 0, $newW, $newH, $srcW, $srcH);

    $tmpPath = tempnam(sys_get_temp_dir(), 'hilads_thumb_');
    $ok      = imagejpeg($dst, $tmpPath, $quality);

    imagedestroy($src);
    imagedestroy($dst);

    if (!$ok) {
        @unlink($tmpPath);
        return null;
    }

    return $tmpPath;
}

$router->add('POST', '/api/v1/uploads', function () {
    enforceRateLimit('uploads', 20, 600);
    $file = $_FILES['file'] ?? null;

    if ($file === null || $file['error'] !== UPLOAD_ERR_OK) {
        $errMap = [
            UPLOAD_ERR_INI_SIZE   => 'File exceeds server upload limit',
            UPLOAD_ERR_FORM_SIZE  => 'File exceeds form upload limit',
            UPLOAD_ERR_NO_FILE    => 'No file uploaded',
        ];
        $code = $file['error'] ?? UPLOAD_ERR_NO_FILE;
        Response::json(['error' => $errMap[$code] ?? 'Upload error'], 400);
    }

    // Size: 10 MB hard limit
    $maxBytes = 10 * 1024 * 1024;
    if ($file['size'] > $maxBytes) {
        Response::json(['error' => 'File size exceeds the 10 MB limit'], 400);
    }

    if (!is_uploaded_file($file['tmp_name'])) {
        Response::json(['error' => 'Invalid upload'], 400);
    }

    // Validate MIME type by inspecting the file content — never trust the client header
    $finfo    = new finfo(FILEINFO_MIME_TYPE);
    $mimeType = $finfo->file($file['tmp_name']);

    $allowed = [
        'image/jpeg' => 'jpg',
        'image/png'  => 'png',
        'image/webp' => 'webp',
    ];

    if (!array_key_exists($mimeType, $allowed)) {
        Response::json(['error' => 'Only JPEG, PNG, and WebP images are allowed'], 415);
    }

    $imageInfo = @getimagesize($file['tmp_name']);
    if ($imageInfo === false || empty($imageInfo[0]) || empty($imageInfo[1])) {
        Response::json(['error' => 'Invalid image file'], 415);
    }
    if ($imageInfo[0] > 6000 || $imageInfo[1] > 6000 || ($imageInfo[0] * $imageInfo[1]) > 40000000) {
        Response::json(['error' => 'Image dimensions are too large'], 400);
    }

    // Cryptographically random filename — client-supplied name is never used
    $ext      = $allowed[$mimeType];
    $filename = bin2hex(random_bytes(16)) . '.' . $ext;

    try {
        $url = R2Uploader::put($file['tmp_name'], $filename, $mimeType);
    } catch (RuntimeException $e) {
        Response::json(['error' => $e->getMessage()], 500);
    }

    // ── Generate avatar thumbnail ──────────────────────────────────────────────
    // Max 400px longest side, JPEG 80%. If anything fails we return thumbUrl: null
    // and the client falls back to the full-size URL — no broken images.
    $thumbUrl = null;
    $thumbTmp = generateAvatarThumbnail($file['tmp_name'], $mimeType);
    if ($thumbTmp !== null) {
        try {
            $thumbFilename = 'thumb_' . bin2hex(random_bytes(8)) . '.jpg';
            $thumbUrl      = R2Uploader::put($thumbTmp, $thumbFilename, 'image/jpeg');
        } catch (RuntimeException) {
            // Thumbnail upload failed — not fatal; caller uses full URL as fallback
        } finally {
            @unlink($thumbTmp);
        }
    }

    Response::json(['url' => $url, 'thumbUrl' => $thumbUrl], 201);
});

// ── Local legends — city ambassadors with their picks ────────────────────────
// GET /api/v1/channels/{channelId}/ambassadors
// Public endpoint. Returns up to 10 ambassadors for this city, most recently
// active first. Each DTO includes ambassadorPicks when the ambassador has set them.
$router->add('GET', '/api/v1/channels/{channelId}/ambassadors', function (array $params) {
    $channelId = filter_var($params['channelId'], FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    if ($channelId === false) {
        Response::json(['error' => 'Invalid channelId'], 400);
        return;
    }

    $channelKey = 'city_' . $channelId;
    $pdo        = Database::pdo();

    $stmt = $pdo->prepare("
        SELECT u.*,
               COALESCE(EXTRACT(EPOCH FROM m.last_seen_at)::INTEGER, u.created_at) AS sort_at
        FROM user_city_roles r
        JOIN  users u ON u.id = r.user_id
        LEFT  JOIN user_city_memberships m
               ON m.user_id = u.id AND m.channel_id = :channel_key
        WHERE r.city_id = :channel_key2 AND r.role = 'ambassador' AND u.deleted_at IS NULL
        ORDER BY sort_at DESC
        LIMIT 10
    ");
    $stmt->execute([':channel_key' => $channelKey, ':channel_key2' => $channelKey]);
    $rows = $stmt->fetchAll();

    $ambassadors = array_map(static function (array $u): array {
        $primary = UserBadgeService::primaryForUser($u);
        $dto     = UserResource::fromUser($u, [$primary['key'], 'host']);

        $picks = array_filter([
            'restaurant' => $u['ambassador_restaurant'] ?? null,
            'spot'       => $u['ambassador_spot']       ?? null,
            'tip'        => $u['ambassador_tip']        ?? null,
            'story'      => $u['ambassador_story']      ?? null,
        ], static fn($v) => $v !== null && $v !== '');

        if (!empty($picks)) {
            $dto['ambassadorPicks'] = $picks;
        }

        return $dto;
    }, $rows);

    Response::json(['ambassadors' => $ambassadors]);
});

// ── City crew — registered users associated with this city ────────────────────
// GET /api/v1/channels/{channelId}/members
// Returns paginated registered users whose home_city matches this channel's city.
// Query params:
//   page  (int, default 1)
//   limit (int, default 10, max 50)
//   badge (fresh|regular|host — optional)
//   vibe  (party|coffee|etc — optional)
$router->add('GET', '/api/v1/channels/{channelId}/members', function (array $params) {
    $channelId = filter_var($params['channelId'], FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    if ($channelId === false) {
        Response::json(['error' => 'Invalid channelId'], 400);
        return;
    }

    $city = CityRepository::findById($channelId);
    if ($city === null) {
        Response::json(['error' => 'Channel not found'], 404);
        return;
    }

    $limit      = max(1, min(50, (int) ($_GET['limit'] ?? 10)));
    $page       = max(1, (int) ($_GET['page']  ?? 1));
    $offset     = ($page - 1) * $limit;
    $vibeFilter = isset($_GET['vibe'])  && $_GET['vibe']  !== '' ? $_GET['vibe']  : null;
    $modeFilter = isset($_GET['mode'])  && $_GET['mode']  !== '' ? $_GET['mode']  : null;
    $badgeFilter= isset($_GET['badge']) && $_GET['badge'] !== '' ? $_GET['badge'] : null;

    $pdo        = Database::pdo();
    $channelKey = 'city_' . $channelId;
    $cityName   = $city['name'];

    // Phase C rollout: when MEMBERS_USE_CURRENT_CITY=on, membership is defined
    // as `users.current_city_id = X` — the single source of truth populated by
    // the two-signal transition rule in /location/resolve and by manual switch
    // via /me/city. This fixes the sticky-roster bug: users only appear in
    // exactly one city's "Here" list — the one they're currently in.
    //
    // Default (flag off): legacy union — explicit memberships row OR home_city
    // text match OR ever-sent-a-message. Sticky but backward-compatible.
    if (featureEnabled('MEMBERS_USE_CURRENT_CITY')) {
        $baseJoin   = '';
        $sortExpr   = "COALESCE(EXTRACT(EPOCH FROM u.current_city_set_at)::INTEGER, u.created_at)";
        $conditions = [
            "u.deleted_at IS NULL",
            "u.current_city_id = :channel_key",
        ];
        $binds = [':channel_key' => $channelKey];
    } else {
        // A user is a city crew member if any of these is true:
        //   1. explicit row in user_city_memberships (populated on channel join for registered users)
        //   2. home_city text matches this city's name (optional profile field)
        //   3. has sent at least one text message in this channel (historical participation —
        //      covers all users who were active before the memberships table existed)
        //
        // The msg_senders derived table is computed once against the indexed channel_id column,
        // then joined on guest_id — far cheaper than a correlated subquery per user.
        $baseJoin = "
            LEFT JOIN user_city_memberships m
                   ON m.user_id = u.id AND m.channel_id = :channel_key
            LEFT JOIN (
                SELECT DISTINCT guest_id
                FROM messages
                WHERE channel_id = :chan_msg AND type = 'text' AND guest_id IS NOT NULL
            ) msg_senders ON msg_senders.guest_id = u.guest_id AND u.guest_id IS NOT NULL";

        $sortExpr   = "COALESCE(EXTRACT(EPOCH FROM m.last_seen_at)::INTEGER, u.created_at)";
        $conditions = [
            "u.deleted_at IS NULL",
            "(m.channel_id IS NOT NULL
              OR LOWER(TRIM(u.home_city)) = LOWER(TRIM(:city_name))
              OR msg_senders.guest_id IS NOT NULL)",
        ];
        $binds = [':channel_key' => $channelKey, ':city_name' => $cityName, ':chan_msg' => $channelKey];
    }

    if ($vibeFilter !== null) {
        $conditions[] = 'u.vibe = :vibe';
        $binds[':vibe'] = $vibeFilter;
    }

    if ($modeFilter !== null) {
        $conditions[] = 'u.mode = :mode';
        $binds[':mode'] = $modeFilter;
    }

    if ($badgeFilter === 'fresh') {
        // created_at is stored as INTEGER (Unix epoch) — compare against epoch arithmetic
        $conditions[] = "u.created_at > EXTRACT(EPOCH FROM NOW() - INTERVAL '60 days')::INTEGER";
    } elseif ($badgeFilter === 'regular') {
        $conditions[] = "u.created_at <= EXTRACT(EPOCH FROM NOW() - INTERVAL '60 days')::INTEGER";
    } elseif ($badgeFilter === 'host') {
        $conditions[] = "EXISTS (
            SELECT 1 FROM user_city_roles r
            WHERE r.user_id = u.id AND r.city_id = :city_key AND r.role = 'ambassador'
        )";
        $binds[':city_key'] = $channelKey;
    }
    $where = implode(' AND ', $conditions);

    // Total count
    $countStmt = $pdo->prepare("SELECT COUNT(*) FROM users u $baseJoin WHERE $where");
    $countStmt->execute($binds);
    $total = (int) $countStmt->fetchColumn();

    // Paginated fetch — order by the most recent positive signal for this city
    // (membership last_seen_at in legacy mode, current_city_set_at in new mode)
    // so recent visitors appear first. Fall back to created_at for users with
    // no timestamp (home_city-backfilled rows when flag is on).
    // NOTE: both timestamp sources are TIMESTAMPTZ; u.created_at is INTEGER
    //       (Unix epoch). COALESCE requires matching types — cast to epoch.
    $sql = "SELECT u.id, u.display_name, u.profile_photo_url, u.vibe, u.mode, u.created_at, u.home_city,
                   $sortExpr AS sort_at
            FROM users u
            $baseJoin
            WHERE $where
            ORDER BY sort_at DESC
            LIMIT :limit OFFSET :offset";
    $stmt = $pdo->prepare($sql);
    foreach ($binds as $k => $v) {
        $stmt->bindValue($k, $v);
    }
    $stmt->bindValue(':limit',  $limit,  \PDO::PARAM_INT);
    $stmt->bindValue(':offset', $offset, \PDO::PARAM_INT);
    $stmt->execute();
    $rows = $stmt->fetchAll();

    // Resolve ambassador roles for badge computation
    $userIds     = array_column($rows, 'id');
    $ambassadors = UserBadgeService::ambassadorsForCity($userIds, $channelId);

    $members = array_map(static function (array $u) use ($ambassadors, $cityName): array {
        return UserResource::fromUserInCity($u, $ambassadors, $cityName);
    }, $rows);

    // Block filter (Apple G1.2). Guests don't appear in `users`, so only the
    // user_ids slice applies. Total/hasMore stay best-effort; the page may
    // shrink by 0-2 rows when blocked users are present, which is invisible
    // to anyone who isn't blocking 50+ users.
    $membersViewerUserId = AuthService::currentUser()['id'] ?? null;
    if ($membersViewerUserId !== null) {
        $members = filterByBlocks(
            $members,
            viewerBlockSet($membersViewerUserId, null),
            'id',
            'guest_id'
        );
    }

    Response::json([
        'members' => $members,
        'total'   => $total,
        'page'    => $page,
        'hasMore' => ($offset + count($rows)) < $total,
    ]);
});

$router->add('GET', '/api/v1/channels/{channelId}/city-events', function (array $params) {
    $startedAt = microtime(true);
    $channelId = filter_var($params['channelId'], FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);

    if ($channelId === false) {
        Response::json(['error' => 'Invalid channelId'], 400);
    }

    try {
        $city = CityRepository::findById($channelId);
    } catch (\Throwable $e) {
        error_log("[city-events] DB error on city lookup ch={$channelId} — " . $e->getMessage());
        Response::json(['events' => []], 200);
    }

    if ($city === null) {
        Response::json(['error' => 'Channel not found'], 404);
    }

    $lat = $_GET['lat'] ?? null;
    $lng = $_GET['lng'] ?? null;

    if ($lat !== null && $lng !== null) {
        if (!is_numeric($lat) || !is_numeric($lng)) {
            Response::json(['error' => 'lat and lng must be numeric'], 400);
        }
        $lat = (float) $lat;
        $lng = (float) $lng;
    } else {
        $lat = null;
        $lng = null;
    }

    // Defer Ticketmaster sync until AFTER the response is sent.
    // Previously this blocked the entire response by up to 5 s (TIMEOUT) whenever
    // the 7-day cooldown expired — a synchronous external API call on the hot path.
    // register_shutdown_function runs after fastcgi_finish_request flushes the response.
    $syncChannelId = $channelId;
    $syncLat       = $lat;
    $syncLng       = $lng;
    $syncCityName  = $city['name'];
    register_shutdown_function(static function () use ($syncChannelId, $syncLat, $syncLng, $syncCityName): void {
        if (function_exists('fastcgi_finish_request')) {
            fastcgi_finish_request();
        }
        try {
            TicketmasterImporter::syncIfNeeded($syncChannelId, $syncLat, $syncLng, $syncCityName);
        } catch (\Throwable $e) {
            error_log("[city-events] TM sync failed (deferred): " . $e->getMessage());
        }
    });

    try {
        $events = EventRepository::getPublicByChannel($channelId);
    } catch (\Throwable $e) {
        error_log("[city-events] DB error on events read ch={$channelId} — " . $e->getMessage());
        $events = [];
    }

    apiLog('city_events', 'success', [
        'channelId' => $channelId,
        'events' => count($events),
        'elapsedMs' => apiElapsedMs($startedAt),
    ]);
    Response::json(['events' => $events]);
});

// Past archive — finished one-off hangouts + expired pulses for a city.
// ?type=both|hangouts|pulses, ?limit (≤20), ?before=<unix> cursor, and an
// optional ?from=YYYY-MM-DD&to=YYYY-MM-DD window clamped to ≤14 days. Default
// (no range, no cursor) = the 10 most recent past items. Public, no auth.
$router->add('GET', '/api/v1/channels/{channelId}/past', function (array $params) {
    $channelId = filter_var($params['channelId'], FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    if ($channelId === false) Response::json(['error' => 'Invalid channelId'], 400);

    $type   = in_array($_GET['type'] ?? 'both', ['both', 'hangouts', 'pulses', 'challenges'], true) ? $_GET['type'] : 'both';
    $limit  = max(1, min(20, (int) ($_GET['limit'] ?? 10)));
    $before = isset($_GET['before']) && ctype_digit((string) $_GET['before']) ? (int) $_GET['before'] : null;

    // Date window (city-local YYYY-MM-DD). Clamp to ≤14 days — backend backstop
    // for the UI limit; can't be bypassed.
    $city   = CityRepository::findById($channelId);
    $tz     = new DateTimeZone(is_array($city) ? ($city['timezone'] ?? 'UTC') : 'UTC');
    $fromTs = $toTs = null;
    $from   = $_GET['from'] ?? null;
    $to     = $_GET['to']   ?? null;
    if (is_string($from) && is_string($to)
        && preg_match('/^\d{4}-\d{2}-\d{2}$/', $from) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $to)) {
        try {
            $fromTs = (new DateTime($from . ' 00:00:00', $tz))->getTimestamp();
            $toTs   = (new DateTime($to   . ' 00:00:00', $tz))->modify('+1 day')->getTimestamp(); // to-date inclusive
            if ($toTs <= $fromTs) {
                $fromTs = $toTs = null;
            } elseif ($toTs - $fromTs > 14 * 86400) {
                $fromTs = $toTs - 14 * 86400; // clamp window to 14 days
            }
        } catch (\Throwable) { $fromTs = $toTs = null; }
    }

    // Each fetch is gated so the three filter shortcuts ('hangouts', 'pulses',
    // 'challenges') skip the other two source queries. 'both' = all three.
    $now      = time();
    $hangouts = in_array($type, ['both', 'hangouts'],   true) ? EventRepository::getPastOneOff($channelId, $before, $limit, $fromTs, $toTs) : [];
    $pulses   = in_array($type, ['both', 'pulses'],     true) ? TopicRepository::getPastByCity($channelId, $before, $limit, $fromTs, $toTs) : [];
    $challenges = in_array($type, ['both', 'challenges'], true)
        ? ChallengeRepository::getValidatedByCity('city_' . $channelId, $limit, $before, $membersViewerUserId)
        : [];

    // Attach participant_count + avatar preview to hangouts (mirror the now feed).
    if (!empty($hangouts)) {
        $ids = array_column($hangouts, 'id');
        $ph  = implode(',', array_fill(0, count($ids), '?'));
        $cs  = Database::pdo()->prepare("SELECT channel_id, COUNT(*) AS cnt FROM event_participants WHERE channel_id IN ($ph) GROUP BY channel_id");
        $cs->execute($ids);
        $counts   = array_column($cs->fetchAll(\PDO::FETCH_ASSOC), 'cnt', 'channel_id');
        $previews = ParticipantRepository::getPreviewBatch($ids);
        foreach ($hangouts as &$h) {
            $h['participant_count']    = (int) ($counts[$h['id']] ?? 0);
            $h['participants_preview'] = $previews[$h['id']] ?? [];
        }
        unset($h);
    }

    // Normalize to the shared FeedItem shape (kind = event|topic|challenge)
    // the cards use, tag a recency sort key, merge, sort newest-first, slice
    // to the page size. Challenges use validated_at as their recency anchor
    // (mirrors the order returned by getValidatedByCity).
    $items = [];
    foreach ($hangouts   as $h) { $fi = normalizeFeedEvent($h, $now);     $fi['_sort'] = (int) ($h['ends_at']      ?? 0); $items[] = $fi; }
    foreach ($pulses     as $p) { $fi = normalizeFeedTopic($p, $now);     $fi['_sort'] = (int) ($p['expires_at']   ?? 0); $items[] = $fi; }
    foreach ($challenges as $c) { $fi = normalizeFeedChallenge($c, $now); $fi['_sort'] = (int) ($c['validated_at'] ?? $c['created_at'] ?? 0); $items[] = $fi; }
    usort($items, static fn($a, $b) => $b['_sort'] <=> $a['_sort']);
    $items = array_slice($items, 0, $limit);

    $nextCursor = (count($items) === $limit) ? (int) end($items)['_sort'] : null;
    foreach ($items as &$it) unset($it['_sort']);
    unset($it);

    Response::json(['items' => $items, 'nextCursor' => $nextCursor]);
});

$router->add('GET', '/api/v1/channels/{channelId}/events/upcoming', function (array $params) {
    $channelId = filter_var($params['channelId'], FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    if ($channelId === false) {
        Response::json(['error' => 'Invalid channelId'], 400);
    }

    // Crawler hits (prerender, ×19 locales) cached to spare Postgres; the live
    // app computes fresh so attendee counts stay current. SSR-only, 10 min.
    $ssr = isset($_SERVER['HTTP_X_HILADS_SSR']);

    // Range mode: ?from=YYYY-MM-DD&to=YYYY-MM-DD — used by the calendar
    // strip on the upcoming-events screen. Both must be present and within
    // ~6 months of today. Falls back to ?days= when range is missing.
    $from = $_GET['from'] ?? null;
    $to   = $_GET['to']   ?? null;
    if ($from !== null && $to !== null) {
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $from) ||
            !preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $to)) {
            Response::json(['error' => 'from/to must be YYYY-MM-DD'], 400);
        }
        if ($from > $to) {
            Response::json(['error' => 'from must be <= to'], 422);
        }
        $build  = static fn(): array => ['events' => EventRepository::getUpcoming($channelId, 7, $from, $to)];
        $payload = $ssr ? Cache::remember("ev_up:$channelId:$from:$to", 600, $build) : $build();
        Response::json($payload);
    }

    $days = filter_var($_GET['days'] ?? 7, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 90]]);
    if ($days === false) $days = 7;
    $build  = static fn(): array => ['events' => EventRepository::getUpcoming($channelId, $days)];
    $payload = $ssr ? Cache::remember("ev_up:$channelId:d$days", 600, $build) : $build();
    Response::json($payload);
});

// GET /api/v1/channels/{channelId}/events/calendar-summary?from=&to=
// Returns per-day event counts for the calendar strip's dot indicators.
$router->add('GET', '/api/v1/channels/{channelId}/events/calendar-summary', function (array $params) {
    $channelId = filter_var($params['channelId'], FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    if ($channelId === false) {
        Response::json(['error' => 'Invalid channelId'], 400);
    }
    $from = $_GET['from'] ?? null;
    $to   = $_GET['to']   ?? null;
    if (!is_string($from) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $from) ||
        !is_string($to)   || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $to)) {
        Response::json(['error' => 'from and to are required (YYYY-MM-DD)'], 400);
    }
    if ($from > $to) {
        Response::json(['error' => 'from must be <= to'], 422);
    }
    // Cap range at ~6 months to bound query cost.
    $diffDays = (strtotime($to) - strtotime($from)) / 86400;
    if ($diffDays > 200) {
        Response::json(['error' => 'Range too large (max ~6 months)'], 422);
    }
    Response::json(['summary' => EventRepository::calendarSummary($channelId, $from, $to)]);
});

$router->add('GET', '/api/v1/channels/{channelId}/events', function (array $params) {
    $startedAt = microtime(true);
    $channelId = filter_var($params['channelId'], FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);

    if ($channelId === false) {
        Response::json(['error' => 'Invalid channelId'], 400);
    }

    // Resolve participant key: prefer guestId (persistent) over sessionId (ephemeral).
    // Used to embed participant_count + is_participating in each event, eliminating N+1 fetches.
    $guestId   = trim($_GET['guestId']   ?? '');
    $sessionId = trim($_GET['sessionId'] ?? '');
    $participantKey = isValidGuestId($guestId)   ? $guestId
                    : (isValidSessionId($sessionId) ? $sessionId
                    : null);

    try {
        if (CityRepository::findById($channelId) === null) {
            Response::json(['error' => 'Channel not found'], 404);
        }

        $events = EventRepository::getByChannel($channelId, $participantKey);
        apiLog('hilads_events', 'success', [
            'channelId' => $channelId,
            'events' => count($events),
            'elapsedMs' => apiElapsedMs($startedAt),
        ]);
        Response::json(['events' => $events]);
    } catch (\Throwable $e) {
        apiLog('hilads_events', 'failure', [
            'channelId' => $channelId,
            'elapsedMs' => apiElapsedMs($startedAt),
            'error' => get_class($e) . ': ' . $e->getMessage(),
        ]);
        Response::json(['events' => []], 200);
    }
});

$router->add('POST', '/api/v1/channels/{channelId}/events', function (array $params) {
    $channelId = filter_var($params['channelId'], FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);

    if ($channelId === false) {
        Response::json(['error' => 'Invalid channelId'], 400);
    }

    if (CityRepository::findById($channelId) === null) {
        Response::json(['error' => 'Channel not found'], 404);
    }

    $body = Request::json();

    if ($body === null) {
        Response::json(['error' => 'Invalid JSON body'], 400);
    }

    $guestId      = $body['guestId']       ?? null;
    $nickname     = $body['nickname']      ?? null;
    $title        = $body['title']         ?? null;
    $locationHint = $body['location_hint'] ?? null;
    $startsAt     = $body['starts_at']     ?? null;
    $endsAt       = $body['ends_at']       ?? null;
    $type         = $body['type']          ?? null;

    enforceRateLimit('event_create', 8, 3600, (string) $channelId);

    if (!isValidGuestId($guestId)) {
        Response::json(['error' => 'guestId is required'], 400);
    }

    if (empty($nickname) || !is_string($nickname)) {
        Response::json(['error' => 'nickname is required'], 400);
    }

    $nickname = mb_substr(trim(strip_tags($nickname)), 0, 20);

    if ($nickname === '') {
        Response::json(['error' => 'nickname must not be empty'], 400);
    }

    if (empty($title) || !is_string($title)) {
        Response::json(['error' => 'title is required'], 400);
    }

    $title = mb_substr(trim(strip_tags($title)), 0, 100);

    if (mb_strlen($title) < 3) {
        Response::json(['error' => 'title must be at least 3 characters'], 400);
    }

    if ($locationHint !== null) {
        if (!is_string($locationHint)) {
            Response::json(['error' => 'location_hint must be a string'], 400);
        }
        $locationHint = mb_substr(trim(strip_tags($locationHint)), 0, 100);
        if ($locationHint === '') {
            $locationHint = null;
        }
    }

    // Optional precise coordinates from the map picker. Stored on the event so
    // the detail screen can open the exact spot in Google Maps. Both must be
    // present and within valid ranges, else we drop them (text location stands).
    $venueLat = null;
    $venueLng = null;
    if (isset($body['lat'], $body['lng']) && is_numeric($body['lat']) && is_numeric($body['lng'])) {
        $latF = (float) $body['lat'];
        $lngF = (float) $body['lng'];
        if ($latF >= -90 && $latF <= 90 && $lngF >= -180 && $lngF <= 180 && !($latF === 0.0 && $lngF === 0.0)) {
            $venueLat = $latF;
            $venueLng = $lngF;
        }
    }

    // No precise pin from the map picker but a text location → best-effort
    // geocode (Nominatim) so the NOW feed can show distance. Non-fatal: on a
    // miss the text location stands and the card shows the address.
    if (($venueLat === null || $venueLng === null) && $locationHint !== null && $locationHint !== '') {
        $cityRow = CityRepository::findById($channelId);
        $coords  = Geocoder::forward($locationHint, $cityRow['name'] ?? null, $cityRow['country'] ?? null);
        if ($coords !== null) {
            $venueLat = $coords['lat'];
            $venueLng = $coords['lng'];
        }
    }

    $startsAt = normalizeUnixTimestamp($startsAt);
    if ($startsAt === null) {
        Response::json(['error' => 'starts_at is required and must be a unix timestamp'], 400);
    }

    $endsAt = normalizeUnixTimestamp($endsAt);
    if ($endsAt === null) {
        Response::json(['error' => 'ends_at is required and must be a unix timestamp'], 400);
    }

    if ($endsAt <= $startsAt) {
        Response::json(['error' => 'End time must be after start time'], 422);
    }

    if ($endsAt - $startsAt < 15 * 60) {
        Response::json(['error' => 'Event must last at least 15 minutes'], 422);
    }

    // Date bounds: events must start no earlier than ~now (1h clock-skew
    // buffer) and no later than 6 months out. Matches the create form's
    // date picker range. The 6-month cap also bounds Postgres query plans
    // for the upcoming-events / calendar-summary endpoints.
    $nowTs = time();
    if ($startsAt < $nowTs - 3600) {
        Response::json(['error' => 'Event start time cannot be in the past'], 422);
    }
    if ($startsAt > $nowTs + 180 * 86400) {
        Response::json(['error' => 'Event start time cannot be more than 6 months in the future'], 422);
    }

    $allowedTypes = ['drinks', 'party', 'music', 'food', 'coffee', 'sport', 'meetup', 'other'];

    if (empty($type) || !in_array($type, $allowedTypes, true)) {
        Response::json(['error' => 'type is required and must be one of: ' . implode(', ', $allowedTypes)], 400);
    }

    // Event creation requires a registered account — guests may browse and chat
    // but cannot host events.
    $authUser     = AuthService::requireAuth();
    $userId       = $authUser['id'];
    $isAmbassador = (bool) ($authUser['_is_ambassador'] ?? false);

    error_log("[event-create] channelId={$channelId} guestId={$guestId} userId={$userId} ambassador=" . ($isAmbassador ? 'yes' : 'no') . " title=" . json_encode($title));

    try {
        $event = EventRepository::add($channelId, $guestId, $nickname, $title, $locationHint, $startsAt, $endsAt, $type, $userId, $isAmbassador, $venueLat, $venueLng);
    } catch (\Throwable $e) {
        error_log("[event-create] FAILED: " . get_class($e) . ': ' . $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine());
        throw $e; // re-throw so global handler returns 500 — but now it's in the logs
    }

    // Broadcast new_event to WS room so in-app banners appear for all connected users.
    try {
        broadcastNewEventToWs((int) $channelId, $event);
    } catch (\Throwable $e) {
        error_log("[event-create] ws broadcast failed (non-fatal): " . $e->getMessage());
    }

    // Notify registered users currently online in this city (non-fatal side effect).
    try {
        $cityChannelId = "city_{$channelId}";
        $cityNameStmt  = Database::pdo()->prepare("SELECT name FROM channels WHERE id = ?");
        $cityNameStmt->execute([$cityChannelId]);
        $cityName  = $cityNameStmt->fetchColumn() ?: 'your city';
        $notifBody = $title . ($locationHint ? ' · ' . $locationHint : '');
        NotificationRepository::notifyCityOnlineUsers(
            $cityChannelId,
            $authUser['id'] ?? null,
            'new_event',
            '🔥 New event in ' . $cityName,
            $notifBody,
            ['eventId' => $event['id'], 'channelId' => $cityChannelId, 'cityName' => $cityName, 'channelSlug' => strtolower(preg_replace('/[^a-z0-9]+/i', '-', $cityName)), 'senderUserId' => $authUser['id'] ?? null]
        );
    } catch (\Throwable $e) {
        error_log("[event-create] notify failed (non-fatal): " . $e->getMessage());
    }

    $eventCityInfo = CityRepository::findById($channelId); // cached in memory
    // date_offset_days = how many days from "today (city-local)" the event is
    // scheduled for. 0 = today, 1 = tomorrow, etc. Lets us measure how often
    // the new date picker is exercised once it ships.
    $cityTz   = $eventCityInfo['timezone'] ?? 'UTC';
    $hostDay  = (new DateTime('@' . $startsAt))->setTimezone(new DateTimeZone($cityTz))->format('Y-m-d');
    $todayDay = (new DateTime('today',         new DateTimeZone($cityTz)))->format('Y-m-d');
    $dateOffsetDays = (int) ((new DateTime($hostDay))->diff(new DateTime($todayDay))->format('%r%a')) * -1;
    AnalyticsService::defer('event_created', $authUser['id'], [
        'channel_id'        => $channelId,
        'city'              => $eventCityInfo['name']    ?? null,
        'country'           => $eventCityInfo['country'] ?? null,
        'event_type'        => $type,
        'event_id'          => $event['id'],
        'is_guest'          => false,
        'user_id'           => $authUser['id'],
        'date_offset_days'  => $dateOffsetDays,
    ]);

    Response::json($event, 201);
});

// ── Event ownership: edit + delete ───────────────────────────────────────────
// NOTE: GET /me/events is registered earlier in this file, before /{userId}/events,
// to avoid the dynamic segment shadowing the literal "me" path.

$router->add('PUT', '/api/v1/events/{eventId}', function (array $params) {
    $eventId = $params['eventId'] ?? null;
    if (!$eventId || !preg_match('/^[a-f0-9]{16}$/', $eventId)) {
        Response::json(['error' => 'Invalid eventId'], 400);
    }

    $body = Request::json();
    if ($body === null) {
        Response::json(['error' => 'Invalid JSON body'], 400);
    }

    $guestId      = $body['guestId']       ?? null;
    $title        = $body['title']         ?? null;
    $locationHint = $body['location_hint'] ?? null;
    $startsAt     = $body['starts_at']     ?? null;
    $endsAt       = $body['ends_at']       ?? null;
    $type         = $body['type']          ?? null;

    if (!isValidGuestId($guestId)) {
        Response::json(['error' => 'guestId is required'], 400);
    }

    if (empty($title) || !is_string($title)) {
        Response::json(['error' => 'title is required'], 400);
    }
    $title = mb_substr(trim(strip_tags($title)), 0, 100);
    if (mb_strlen($title) < 3) {
        Response::json(['error' => 'title must be at least 3 characters'], 400);
    }

    if ($locationHint !== null) {
        $locationHint = mb_substr(trim(strip_tags((string) $locationHint)), 0, 100) ?: null;
    }

    $startsAt = normalizeUnixTimestamp($startsAt);
    $endsAt   = normalizeUnixTimestamp($endsAt);
    if ($startsAt === null || $endsAt === null) {
        Response::json(['error' => 'starts_at and ends_at are required unix timestamps'], 400);
    }
    if ($endsAt <= $startsAt) {
        Response::json(['error' => 'End time must be after start time'], 422);
    }
    if ($endsAt - $startsAt < 15 * 60) {
        Response::json(['error' => 'Event must last at least 15 minutes'], 422);
    }

    $allowedTypes = ['drinks', 'party', 'music', 'food', 'coffee', 'sport', 'meetup', 'other'];
    if (empty($type) || !in_array($type, $allowedTypes, true)) {
        Response::json(['error' => 'type must be one of: ' . implode(', ', $allowedTypes)], 400);
    }

    $authUser = AuthService::currentUser();
    $updated  = EventRepository::update($eventId, $guestId, $authUser['id'] ?? null, $title, $locationHint, $startsAt, $endsAt, $type);

    if ($updated === null) {
        Response::json(['error' => 'Event not found or you are not the creator'], 403);
    }

    Response::json($updated);
});

$router->add('DELETE', '/api/v1/events/{eventId}', function (array $params) {
    $eventId = $params['eventId'] ?? null;
    if (!$eventId || !preg_match('/^[a-f0-9]{16}$/', $eventId)) {
        Response::json(['error' => 'Invalid eventId'], 400);
    }

    $body    = Request::json();
    $guestId = $body['guestId'] ?? null;
    $mode    = $body['mode']    ?? 'single'; // 'single' | 'series'

    if (!isValidGuestId($guestId)) {
        Response::json(['error' => 'guestId is required'], 400);
    }

    $authUser = AuthService::currentUser();
    $userId   = $authUser['id'] ?? null;
    $pdo      = Database::pdo();

    if ($mode === 'series') {
        // Resolve the series_id from this occurrence
        $stmt = $pdo->prepare("
            SELECT ce.series_id, ce.created_by, ce.guest_id
            FROM channel_events ce
            WHERE ce.channel_id   = ?
              AND ce.source_type  = 'hilads'
              AND ce.series_id IS NOT NULL
            LIMIT 1
        ");
        $stmt->execute([$eventId]);
        $row = $stmt->fetch();

        if (!$row) {
            Response::json(['error' => 'Event is not part of a recurring series'], 400);
        }

        // Ownership: creator guest_id OR registered user
        $isOwner = ($row['guest_id'] === $guestId)
                || ($userId !== null && $row['created_by'] === $userId);
        if (!$isOwner) {
            Response::json(['error' => 'You are not the creator of this series'], 403);
        }

        EventSeriesRepository::deleteSeries($row['series_id']);
        Response::json(['ok' => true, 'deleted' => 'series']);
    } else {
        $deleted = EventRepository::delete($eventId, $guestId, $userId);
        if (!$deleted) {
            Response::json(['error' => 'Event not found or you are not the creator'], 403);
        }
        Response::json(['ok' => true, 'deleted' => 'occurrence']);
    }
});

// ── Recurring event series ────────────────────────────────────────────────────

$router->add('POST', '/api/v1/channels/{channelId}/event-series', function (array $params) {
    $channelId = filter_var($params['channelId'], FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);

    if ($channelId === false) {
        Response::json(['error' => 'Invalid channelId'], 400);
    }

    $city = CityRepository::findById($channelId);
    if ($city === null) {
        Response::json(['error' => 'Channel not found'], 404);
    }

    // Recurring events are for registered users only
    $authUser = AuthService::currentUser();
    if ($authUser === null) {
        Response::json(['error' => 'Login required to create recurring events'], 401);
    }

    $body = Request::json();
    if ($body === null) {
        Response::json(['error' => 'Invalid JSON body'], 400);
    }

    $guestId        = $body['guestId']          ?? null;
    $title          = $body['title']            ?? null;
    $locationHint   = $body['location_hint']    ?? null;
    $startTime      = $body['start_time']       ?? null;
    $endTime        = $body['end_time']         ?? null;
    $type           = $body['type']             ?? null;
    $recurrenceType = $body['recurrence_type']  ?? null;
    $weekdays       = $body['weekdays']         ?? null;
    $intervalDays   = $body['interval_days']    ?? null;
    $startsOn       = $body['starts_on']        ?? null;
    $endsOn         = $body['ends_on']          ?? null;

    enforceRateLimit('event_series_create', 6, 3600, (string) $channelId);

    if (!isValidGuestId($guestId)) {
        Response::json(['error' => 'guestId is required'], 400);
    }

    if (empty($title) || !is_string($title)) {
        Response::json(['error' => 'title is required'], 400);
    }
    $title = mb_substr(trim(strip_tags($title)), 0, 100);
    if (mb_strlen($title) < 3) {
        Response::json(['error' => 'title must be at least 3 characters'], 400);
    }

    if ($locationHint !== null) {
        $locationHint = mb_substr(trim(strip_tags((string) $locationHint)), 0, 100);
        if ($locationHint === '') $locationHint = null;
    }

    if (!preg_match('/^\d{2}:\d{2}$/', (string) $startTime)) {
        Response::json(['error' => 'start_time must be HH:MM'], 400);
    }

    if (!preg_match('/^\d{2}:\d{2}$/', (string) $endTime)) {
        Response::json(['error' => 'end_time must be HH:MM'], 400);
    }

    $allowedTypes = ['drinks', 'party', 'music', 'food', 'coffee', 'sport', 'meetup', 'other'];
    if (empty($type) || !in_array($type, $allowedTypes, true)) {
        Response::json(['error' => 'type is required'], 400);
    }

    $allowedRecurrences = ['daily', 'weekly', 'every_n_days'];
    if (empty($recurrenceType) || !in_array($recurrenceType, $allowedRecurrences, true)) {
        Response::json(['error' => 'recurrence_type must be: daily, weekly, or every_n_days'], 400);
    }

    if ($recurrenceType === 'weekly') {
        if (!is_array($weekdays) || empty($weekdays)) {
            Response::json(['error' => 'weekdays is required for weekly recurrence'], 400);
        }
        $weekdays = array_values(array_filter(array_map('intval', $weekdays), fn($d) => $d >= 0 && $d <= 6));
        if (empty($weekdays)) {
            Response::json(['error' => 'weekdays must contain values 0–6'], 400);
        }
    } else {
        $weekdays = null;
    }

    if ($recurrenceType === 'every_n_days') {
        $intervalDays = filter_var($intervalDays, FILTER_VALIDATE_INT, ['options' => ['min_range' => 2, 'max_range' => 365]]);
        if ($intervalDays === false) {
            Response::json(['error' => 'interval_days must be between 2 and 365'], 400);
        }
    } else {
        $intervalDays = null;
    }

    if ($startsOn !== null) {
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $startsOn)) {
            Response::json(['error' => 'starts_on must be YYYY-MM-DD'], 400);
        }
        // Same bounds as the one-off create — series can't start in the past
        // or more than 6 months in the future.
        $startsOnDt = DateTime::createFromFormat('!Y-m-d', $startsOn, new DateTimeZone($city['timezone']));
        if ($startsOnDt === false) {
            Response::json(['error' => 'starts_on is not a valid date'], 400);
        }
        $startsOnTs = $startsOnDt->getTimestamp();
        $nowTs = time();
        $todayTs = (new DateTime('today', new DateTimeZone($city['timezone'])))->getTimestamp();
        if ($startsOnTs < $todayTs) {
            Response::json(['error' => 'starts_on cannot be before today'], 422);
        }
        if ($startsOnTs > $nowTs + 180 * 86400) {
            Response::json(['error' => 'starts_on cannot be more than 6 months in the future'], 422);
        }
    }

    if ($endsOn !== null) {
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $endsOn)) {
            Response::json(['error' => 'ends_on must be YYYY-MM-DD'], 400);
        }
    }

    $result = EventSeriesRepository::create(
        $channelId,
        $authUser['id'],
        $guestId,
        $title,
        $type,
        $locationHint,
        $startTime,
        $endTime,
        $city['timezone'],
        $recurrenceType,
        $weekdays,
        $intervalDays,
        $startsOn,
        $endsOn,
    );

    Response::json($result, 201);
});

// ── Internal: force-refresh Ticketmaster events for one city ─────────────────
// Protected by MIGRATION_KEY. Safe backfill path for refreshing stored location data.
// Call: POST /internal/city-events/resync?key=YOUR_KEY
// Body: { "channelId": 17 }

$router->add('POST', '/internal/city-events/resync', function () {
    $expectedKey = getenv('MIGRATION_KEY') ?: null;
    if ($expectedKey === null) {
        Response::json(['error' => 'Not found'], 404);
    }

    $providedKey = $_SERVER['HTTP_X_API_KEY']
        ?? $_SERVER['HTTP_X_API_Key']
        ?? ($_GET['key'] ?? '');

    if (!is_string($providedKey) || !hash_equals($expectedKey, $providedKey)) {
        Response::json(['error' => 'Forbidden'], 403);
    }

    $body = Request::json();
    if ($body === null) {
        Response::json(['error' => 'Invalid JSON body'], 400);
    }

    $channelId = filter_var($body['channelId'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    if ($channelId === false) {
        Response::json(['error' => 'channelId is required'], 400);
    }

    $city = CityRepository::findById($channelId);
    if ($city === null) {
        Response::json(['error' => 'Channel not found'], 404);
    }

    apiLog('internal_resync_city_events', 'start', [
        'channelId' => $channelId,
        'city' => $city['name'],
        'ip' => Request::ip(),
    ]);

    TicketmasterImporter::forceSync($channelId, $city['lat'] ?? null, $city['lng'] ?? null, $city['name']);
    $events = EventRepository::getPublicByChannel($channelId);

    apiLog('internal_resync_city_events', 'success', [
        'channelId' => $channelId,
        'events' => count($events),
    ]);

    Response::json([
        'ok' => true,
        'channelId' => $channelId,
        'city' => $city['name'],
        'public_events' => count($events),
    ]);
});

// ── Internal: geocode-backfill — fill missing coords so NOW shows distance ───
// Protected by MIGRATION_KEY. Idempotent + resumable: only touches rows that
// still lack coordinates, so it's safe to re-run. Throttled to ~1 req/s for
// Nominatim, with a per-call `limit` budget to stay under the HTTP timeout —
// call repeatedly until `remaining` is 0.
// Call: POST /internal/geocode-backfill?key=YOUR_KEY
// Body (all optional): { "channelId": 20, "limit": 20, "dryRun": true }
$router->add('POST', '/internal/geocode-backfill', function () {
    $expectedKey = getenv('MIGRATION_KEY') ?: null;
    if ($expectedKey === null) {
        Response::json(['error' => 'Not found'], 404);
    }
    $providedKey = $_SERVER['HTTP_X_API_KEY'] ?? ($_GET['key'] ?? '');
    if (!is_string($providedKey) || !hash_equals($expectedKey, $providedKey)) {
        Response::json(['error' => 'Forbidden'], 403);
    }

    $body      = Request::json() ?? [];
    $channelId = filter_var($body['channelId'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    $limit     = filter_var($body['limit'] ?? 10, FILTER_VALIDATE_INT, ['options' => ['default' => 10, 'min_range' => 1, 'max_range' => 40]]);
    $dryRun    = !empty($body['dryRun']);
    $cityKey   = $channelId ? ('city_' . $channelId) : null;

    $pdo = Database::pdo();

    @set_time_limit(0);

    $cityWhere = $cityKey ? " AND es.city_id = " . $pdo->quote($cityKey) : "";
    $seriesRows = $pdo->query("
        SELECT es.id, es.location, ch.name AS city_name, ci.country
          FROM event_series es
          JOIN channels ch ON ch.id = es.city_id
          LEFT JOIN cities ci ON ci.channel_id = ch.id
         WHERE es.location IS NOT NULL AND btrim(es.location) <> ''
           AND (es.lat IS NULL OR es.lng IS NULL)
           $cityWhere
         ORDER BY es.id
         LIMIT $limit
    ")->fetchAll(\PDO::FETCH_ASSOC);

    $seriesUpd  = $pdo->prepare("UPDATE event_series SET lat = ?, lng = ? WHERE id = ?");
    $seriesHit  = 0; $seriesMiss = 0; $budget = $limit;
    foreach ($seriesRows as $r) {
        if ($budget <= 0) break;
        $coords = Geocoder::forward($r['location'], $r['city_name'] ?? null, $r['country'] ?? null);
        $budget--;
        if ($coords !== null) {
            if (!$dryRun) $seriesUpd->execute([$coords['lat'], $coords['lng'], $r['id']]);
            $seriesHit++;
        } else {
            $seriesMiss++;
        }
        // Geocoder self-throttles to ~1 req/s — no extra sleep needed here.
    }

    // Propagate freshly-stored series coords onto their materialized occurrences.
    $propagated = 0;
    if (!$dryRun) {
        $propagated = (int) $pdo->exec("
            UPDATE channel_events ce
               SET venue_lat = es.lat, venue_lng = es.lng
              FROM event_series es
             WHERE ce.series_id = es.id
               AND es.lat IS NOT NULL AND es.lng IS NOT NULL
               AND (ce.venue_lat IS NULL OR ce.venue_lng IS NULL)
        ");
    }

    // One-off events (no series) — only active ones, to avoid spending the
    // budget on past events that will never show in the feed again.
    $ceCityWhere = $cityKey ? " AND ce.city_id = " . $pdo->quote($cityKey) : "";
    $oneoffHit = 0; $oneoffMiss = 0;
    if ($budget > 0) {
        $oneoffRows = $pdo->query("
            SELECT ce.channel_id, ce.location, ch.name AS city_name, ci.country
              FROM channel_events ce
              JOIN channels ch ON ch.id = ce.city_id
              LEFT JOIN cities ci ON ci.channel_id = ch.id
             WHERE ce.series_id IS NULL
               AND ce.source_type = 'hilads'
               AND ce.location IS NOT NULL AND btrim(ce.location) <> ''
               AND (ce.venue_lat IS NULL OR ce.venue_lng IS NULL)
               AND ce.expires_at > now()
               $ceCityWhere
             ORDER BY ce.starts_at
             LIMIT $budget
        ")->fetchAll(\PDO::FETCH_ASSOC);

        $oneoffUpd = $pdo->prepare("UPDATE channel_events SET venue_lat = ?, venue_lng = ? WHERE channel_id = ?");
        foreach ($oneoffRows as $r) {
            if ($budget <= 0) break;
            $coords = Geocoder::forward($r['location'], $r['city_name'] ?? null, $r['country'] ?? null);
            $budget--;
            if ($coords !== null) {
                if (!$dryRun) $oneoffUpd->execute([$coords['lat'], $coords['lng'], $r['channel_id']]);
                $oneoffHit++;
            } else {
                $oneoffMiss++;
            }
        }
    }

    // How many rows still lack coords after this run (so the caller knows
    // whether to call again).
    $remSeries = (int) $pdo->query("
        SELECT COUNT(*) FROM event_series es
         WHERE es.location IS NOT NULL AND btrim(es.location) <> ''
           AND (es.lat IS NULL OR es.lng IS NULL)$cityWhere
    ")->fetchColumn();
    $remOneoff = (int) $pdo->query("
        SELECT COUNT(*) FROM channel_events ce
         WHERE ce.series_id IS NULL AND ce.source_type = 'hilads'
           AND ce.location IS NOT NULL AND btrim(ce.location) <> ''
           AND (ce.venue_lat IS NULL OR ce.venue_lng IS NULL)
           AND ce.expires_at > now()$ceCityWhere
    ")->fetchColumn();

    Response::json([
        'ok'                     => true,
        'dryRun'                 => $dryRun,
        'channelId'              => $channelId ?: null,
        'series_geocoded'        => $seriesHit,
        'series_missed'          => $seriesMiss,
        'occurrences_propagated' => $propagated,
        'oneoff_geocoded'        => $oneoffHit,
        'oneoff_missed'          => $oneoffMiss,
        'remaining'              => $remSeries + $remOneoff,
    ]);
});

// ── Internal: seed recurring venue events via Google Places ──────────────────
// Protected by X-Api-Key header matching MIGRATION_KEY env var.
// Supports dryRun=true for safe previewing before any DB writes.

$router->add('POST', '/internal/seed-recurring-venues', function () {
    $expectedKey = getenv('MIGRATION_KEY') ?: null;
    if ($expectedKey === null) {
        Response::json(['error' => 'Not found'], 404);
    }

    // Accept key via header (preferred) or query param (legacy compat)
    $providedKey = $_SERVER['HTTP_X_API_KEY']
        ?? $_SERVER['HTTP_X_API_Key']
        ?? ($_GET['key'] ?? '');

    if (!is_string($providedKey) || !hash_equals($expectedKey, $providedKey)) {
        Response::json(['error' => 'Forbidden'], 403);
    }

    $body = Request::json();
    if ($body === null) {
        Response::json(['error' => 'Invalid JSON body'], 400);
    }

    // ── Parse + validate inputs ───────────────────────────────────────────────

    $rawCityIds = $body['cityIds'] ?? null;
    if (!is_array($rawCityIds) || empty($rawCityIds)) {
        Response::json(['error' => 'cityIds must be a non-empty array of integers'], 400);
    }

    $cityIds = array_values(array_filter(array_map('intval', $rawCityIds), fn($id) => $id > 0));
    if (empty($cityIds)) {
        Response::json(['error' => 'cityIds must contain at least one valid positive integer'], 400);
    }

    if (count($cityIds) > 50) {
        Response::json(['error' => 'Max 50 cities per request'], 400);
    }

    $dryRun     = isset($body['dryRun']) && $body['dryRun'] === true;
    $limits     = $body['limitPerCategory'] ?? [];
    $barsLimit  = isset($limits['bars'])   ? max(1, min(10, (int) $limits['bars']))   : 4;
    $coffeeLimit= isset($limits['coffee']) ? max(1, min(10, (int) $limits['coffee'])) : 2;

    // ── Run ───────────────────────────────────────────────────────────────────

    error_log("[seed-recurring-venues] cities=" . implode(',', $cityIds)
        . " dryRun=" . ($dryRun ? 'true' : 'false')
        . " bars={$barsLimit} coffee={$coffeeLimit}");

    try {
        $result = VenueSeeder::run($cityIds, $dryRun, $barsLimit, $coffeeLimit);
    } catch (RuntimeException $e) {
        error_log("[seed-recurring-venues] fatal: " . $e->getMessage());
        Response::json(['error' => $e->getMessage()], 500);
    }

    Response::json([
        'ok'      => empty($result['errors']),
        'dry_run' => $dryRun,
        'created' => $result['created'],
        'skipped' => $result['skipped'],
        'errors'  => $result['errors'],
        'cities'  => $result['cities'],
        'preview' => $result['preview'] ?? null,
    ]);
});

// ── Internal: seed static curated venues ──────────────────────────────────────
// Reads venues_seed.php (static array) and upserts them as recurring event series.
// Idempotent — safe to run repeatedly. Protected by X-Api-Key or ?key= query param.
$router->add('POST', '/internal/seed-static-venues', function () {
    $expectedKey = getenv('MIGRATION_KEY') ?: null;
    if ($expectedKey === null) {
        Response::json(['error' => 'Not found'], 404);
    }

    $providedKey = $_SERVER['HTTP_X_API_KEY'] ?? ($_GET['key'] ?? '');
    if (!hash_equals($expectedKey, $providedKey)) {
        Response::json(['error' => 'Forbidden'], 403);
    }

    $body   = json_decode(file_get_contents('php://input'), true) ?? [];
    $dryRun = !empty($body['dryRun']);

    $venues = require __DIR__ . '/../src/venues_seed.php';

    $items = [];
    foreach ($venues as $v) {
        $isBar = $v['category'] === 'bar';
        $slug  = trim(strtolower(preg_replace('/[^a-z0-9]+/', '-', $v['title'])), '-');
        $items[] = [
            'city_id'         => (int) $v['city_id'],
            'title'           => $v['title'],
            'event_type'      => $isBar ? 'drinks' : 'coffee',
            'location'        => $v['location'],
            'start_time'      => $isBar ? '18:00' : '10:00',
            'end_time'        => $isBar ? '01:00' : '18:00',
            'recurrence_type' => 'daily',
            'source_key'      => "static:v1:city_{$v['city_id']}:{$slug}:{$v['category']}",
        ];
    }

    error_log('[seed-static-venues] items=' . count($items) . ' dryRun=' . ($dryRun ? 'true' : 'false'));

    try {
        $result = EventSeriesRepository::importBatch($items, $dryRun, true);
    } catch (RuntimeException $e) {
        error_log('[seed-static-venues] fatal: ' . $e->getMessage());
        Response::json(['error' => $e->getMessage()], 500);
    }

    Response::json([
        'ok'      => empty($result['errors']),
        'dry_run' => $dryRun,
        'created' => $result['created'],
        'updated' => $result['updated'] ?? 0,
        'skipped' => $result['skipped'],
        'errors'  => $result['errors'],
        'preview' => $result['preview'] ?? null,
    ]);
});

// Internal: batch-import recurring event series from an external source (e.g. seed script).
// Idempotent: items are deduplicated via source_key. Supports ?dry_run=1.
$router->add('POST', '/internal/event-series/import', function () {
    $expectedKey = getenv('MIGRATION_KEY') ?: null;
    if ($expectedKey === null) {
        Response::json(['error' => 'Not found'], 404);
    }

    $providedKey = $_GET['key'] ?? '';
    if (!hash_equals($expectedKey, $providedKey)) {
        Response::json(['error' => 'Forbidden'], 403);
    }

    $dryRun = !empty($_GET['dry_run']) && $_GET['dry_run'] !== '0';

    $body = Request::json();
    if ($body === null || !isset($body['series']) || !is_array($body['series'])) {
        Response::json(['error' => 'Body must be { "series": [...] }'], 400);
    }

    if (count($body['series']) > 200) {
        Response::json(['error' => 'Max 200 items per batch'], 400);
    }

    $result = EventSeriesRepository::importBatch($body['series'], $dryRun);

    Response::json([
        'ok'      => empty($result['errors']),
        'dry_run' => $dryRun,
        ...$result,
    ]);
});

// ── Internal: message + channel retention cleanup ─────────────────────────────
// Run daily via cron. Deletes stale messages by channel type and expires old channels.
//
// Rules:
//   city     → messages older than today
//   event    → messages from channels expired >1h ago (then the channels themselves)
//   dm       → conversation_messages older than 7 days
//
// Call: POST /internal/cleanup?key=YOUR_KEY
$router->add('POST', '/internal/cleanup', function () {
    $expectedKey = getenv('MIGRATION_KEY') ?: null;
    if ($expectedKey === null) {
        Response::json(['error' => 'Not found'], 404);
    }

    $providedKey = $_GET['key'] ?? '';
    if (!hash_equals($expectedKey, $providedKey)) {
        Response::json(['error' => 'Forbidden'], 403);
    }

    $pdo = Database::pdo();

    // 1. City channel messages — keep only today
    // Messages are stored with 'city_N' keys; channels.id is numeric — prefix to match.
    $stmt = $pdo->query("
        DELETE FROM messages
        WHERE channel_id IN (SELECT 'city_' || id FROM channels WHERE type = 'city')
          AND created_at < CURRENT_DATE
    ");
    $cityDeleted = $stmt->rowCount();

    // 2. Expired event channels — delete the channel (CASCADE removes messages +
    //    event_participants). The 1-hour buffer prevents cutting off active viewers.
    //    Recurring occurrences from past days are included automatically.
    $stmt = $pdo->query("
        DELETE FROM channels
        WHERE type = 'event'
          AND id IN (
              SELECT channel_id FROM channel_events
              WHERE expires_at < now() - INTERVAL '1 hour'
          )
    ");
    $eventChannelsDeleted = $stmt->rowCount();

    // 3. Direct message history — keep 7 days
    $stmt = $pdo->query("
        DELETE FROM conversation_messages
        WHERE created_at < now() - INTERVAL '7 days'
    ");
    $dmDeleted = $stmt->rowCount();

    error_log("[cleanup] city_messages={$cityDeleted} event_channels={$eventChannelsDeleted} dm_messages={$dmDeleted}");

    Response::json([
        'ok'                    => true,
        'city_messages_deleted' => $cityDeleted,
        'event_channels_deleted'=> $eventChannelsDeleted,
        'dm_messages_deleted'   => $dmDeleted,
    ]);
});


// Internal: ONE-TIME migration — collapse each recurring (hilads) series to a
// single canonical channel_events row. Idempotent + resumable (per-series
// transactions). For each series: create the canonical row, merge per-date
// participants into it, repoint chat messages, record redirects for the old
// occurrence URLs, then delete the legacy occurrence channels.
$router->add('POST', '/internal/event-series/collapse', function () {
    $expectedKey = getenv('MIGRATION_KEY') ?: null;
    if ($expectedKey === null) {
        Response::json(['error' => 'Not found'], 404);
    }
    $providedKey = $_GET['key'] ?? '';
    if (!hash_equals($expectedKey, $providedKey)) {
        Response::json(['error' => 'Forbidden'], 403);
    }

    $pdo = Database::pdo();

    // Hilads recurring series only (user/admin-created). Venues are source
    // 'import' and were never materialized — left untouched.
    $series = $pdo->query("
        SELECT es.* FROM event_series es WHERE es.source IN ('user', 'admin')
    ")->fetchAll(\PDO::FETCH_ASSOC);

    $processed = 0; $canonicals = 0; $occDeleted = 0; $partsMerged = 0;
    $msgsMoved = 0; $redirects = 0; $errors = [];

    foreach ($series as $s) {
        $sid = $s['id'];
        try {
            $pdo->beginTransaction();

            $occStmt = $pdo->prepare(
                "SELECT channel_id FROM channel_events WHERE series_id = ? AND occurrence_date IS NOT NULL"
            );
            $occStmt->execute([$sid]);
            $ids = $occStmt->fetchAll(\PDO::FETCH_COLUMN);

            // 1. Canonical row (idempotent; auto-joins the creator).
            $canonicalId = EventSeriesRepository::createCanonical($s);
            $canonicals++;

            if (!empty($ids)) {
                $ph = implode(',', array_fill(0, count($ids), '?'));

                // 2. Merge participants → canonical (one row per guest_id).
                $stmt = $pdo->prepare("
                    INSERT INTO event_participants (channel_id, guest_id, user_id, nickname, joined_at, last_read_at)
                    SELECT ?, guest_id,
                           (array_agg(user_id) FILTER (WHERE user_id IS NOT NULL))[1],
                           (array_agg(nickname ORDER BY joined_at))[1],
                           MIN(joined_at),
                           MAX(last_read_at)
                      FROM event_participants
                     WHERE channel_id IN ($ph)
                     GROUP BY guest_id
                    ON CONFLICT (channel_id, guest_id) DO UPDATE
                       SET joined_at    = LEAST(event_participants.joined_at, EXCLUDED.joined_at),
                           user_id      = COALESCE(event_participants.user_id, EXCLUDED.user_id),
                           nickname     = CASE WHEN EXCLUDED.nickname <> '' THEN EXCLUDED.nickname
                                               ELSE event_participants.nickname END,
                           last_read_at = GREATEST(COALESCE(event_participants.last_read_at, to_timestamp(0)),
                                                   COALESCE(EXCLUDED.last_read_at,            to_timestamp(0)))
                ");
                $stmt->execute(array_merge([$canonicalId], $ids));
                $partsMerged += $stmt->rowCount();

                // 3. Repoint chat messages → canonical (consolidate threads).
                $stmt = $pdo->prepare("UPDATE messages SET channel_id = ? WHERE channel_id IN ($ph)");
                $stmt->execute(array_merge([$canonicalId], $ids));
                $msgsMoved += $stmt->rowCount();

                // 4. Redirects (old occurrence URL → canonical) for cached links.
                $stmt = $pdo->prepare("
                    INSERT INTO event_redirects (from_channel_id, to_channel_id)
                    SELECT channel_id, ? FROM channel_events
                     WHERE series_id = ? AND occurrence_date IS NOT NULL
                    ON CONFLICT (from_channel_id) DO NOTHING
                ");
                $stmt->execute([$canonicalId, $sid]);
                $redirects += $stmt->rowCount();

                // 5. Delete legacy occurrence channels (cascades channel_events,
                //    presence, leftover participants on those channels).
                $stmt = $pdo->prepare("DELETE FROM channels WHERE id IN ($ph)");
                $stmt->execute($ids);
                $occDeleted += $stmt->rowCount();
            }

            $pdo->commit();
            $processed++;
        } catch (\Throwable $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            $errors[] = $sid . ': ' . $e->getMessage();
            error_log('[collapse] series ' . $sid . ' failed: ' . $e->getMessage());
        }
    }

    Response::json([
        'ok'                  => empty($errors),
        'series_processed'    => $processed,
        'canonicals_created'  => $canonicals,
        'participants_merged' => $partsMerged,
        'messages_repointed'  => $msgsMoved,
        'redirects_inserted'  => $redirects,
        'occurrences_deleted' => $occDeleted,
        'errors'              => $errors,
    ]);
});

// Internal: ONE-TIME cleanup — dedupe duplicate registered-user participant
// rows to one per (channel_id, user_id). The recurring-event collapse merged
// per-occurrence joins (web uses an ephemeral sessionId as guest_id, so one
// user accrued many guest_id rows), surfacing as duplicate attendees. Keeps the
// earliest join; guest-only rows (user_id NULL) are left untouched. Idempotent.
$router->add('POST', '/internal/participants/dedupe', function () {
    $expectedKey = getenv('MIGRATION_KEY') ?: null;
    if ($expectedKey === null) {
        Response::json(['error' => 'Not found'], 404);
    }
    $providedKey = $_GET['key'] ?? '';
    if (!hash_equals($expectedKey, $providedKey)) {
        Response::json(['error' => 'Forbidden'], 403);
    }

    $pdo = Database::pdo();

    // (1) Dedupe registered-user rows to one per (channel_id, user_id).
    $userDedupe = $pdo->query("
        DELETE FROM event_participants
        WHERE (channel_id, guest_id) IN (
            SELECT channel_id, guest_id FROM (
                SELECT channel_id, guest_id,
                       row_number() OVER (
                           PARTITION BY channel_id, user_id
                           ORDER BY joined_at ASC, guest_id ASC
                       ) AS rn
                FROM event_participants
                WHERE user_id IS NOT NULL
            ) t WHERE t.rn > 1
        )
    ")->rowCount();

    // (2) Delete nameless guests (user_id NULL + empty nickname) — they have no
    // visible identity in the UI (auto-join cruft / joins without a nickname).
    $namelessGuests = $pdo->query("
        DELETE FROM event_participants
        WHERE user_id IS NULL
          AND trim(nickname) = ''
    ")->rowCount();

    Response::json([
        'ok'                    => true,
        'user_duplicates_deleted' => $userDedupe,
        'nameless_guests_deleted' => $namelessGuests,
    ]);
});

// Internal: delete event_participants rows for specific bot-identified guest
// nicknames. Targets only user_id IS NULL rows so we never touch registered
// users who happen to share a display name. Idempotent. Defaults to the two
// known Googlebot-generated nicknames; pass {"nicknames": [...]} to override.
$router->add('POST', '/internal/participants/cleanup-bot-rows', function () {
    $expectedKey = getenv('MIGRATION_KEY') ?: null;
    if ($expectedKey === null) {
        Response::json(['error' => 'Not found'], 404);
    }
    $providedKey = $_GET['key'] ?? '';
    if (!hash_equals($expectedKey, $providedKey)) {
        Response::json(['error' => 'Forbidden'], 403);
    }

    $body = Request::json();
    $nicknames = is_array($body['nicknames'] ?? null)
        ? array_values(array_filter(array_map('strval', $body['nicknames']), fn($s) => $s !== ''))
        : ['calm_regular_4138', 'sunny_nomad_5259'];

    if (empty($nicknames)) {
        Response::json(['ok' => true, 'rows_deleted' => 0, 'nicknames' => []]);
    }

    $placeholders = implode(',', array_fill(0, count($nicknames), '?'));
    $stmt = Database::pdo()->prepare("
        DELETE FROM event_participants
        WHERE user_id IS NULL
          AND nickname IN ($placeholders)
    ");
    $stmt->execute($nicknames);

    Response::json([
        'ok'           => true,
        'rows_deleted' => $stmt->rowCount(),
        'nicknames'    => $nicknames,
    ]);
});

$router->add('POST', '/internal/event-series/refresh-static-occurrences', function () {
    $expectedKey = getenv('MIGRATION_KEY') ?: null;
    if ($expectedKey === null) {
        Response::json(['error' => 'Not found'], 404);
    }

    $providedKey = $_SERVER['HTTP_X_API_KEY']
        ?? $_SERVER['HTTP_X_API_Key']
        ?? ($_GET['key'] ?? '');

    if (!is_string($providedKey) || !hash_equals($expectedKey, $providedKey)) {
        Response::json(['error' => 'Forbidden'], 403);
    }

    $body = Request::json() ?? [];
    $channelId = null;
    if (array_key_exists('channelId', $body) && $body['channelId'] !== null) {
        $channelId = filter_var($body['channelId'], FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
        if ($channelId === false) {
            Response::json(['error' => 'Invalid channelId'], 400);
        }
        if (CityRepository::findById($channelId) === null) {
            Response::json(['error' => 'Channel not found'], 404);
        }
    }

    $result = EventSeriesRepository::refreshImportedOccurrences($channelId);
    Response::json([
        'ok' => true,
        'channelId' => $channelId,
        'result' => $result,
    ]);
});

$router->add('GET', '/api/v1/events/{eventId}/messages', function (array $params) {
    $eventId = $params['eventId'] ?? '';

    if (!preg_match('/^[a-f0-9]{16}$/', $eventId)) {
        Response::json(['error' => 'Invalid eventId'], 400);
        return;
    }

    try {
        // Read view: serve past events too (any-state) so the archive can show a
        // finished hangout's chat history. Writes (POST below) still use findById
        // so posting to an expired event stays blocked. Deleted → 410.
        $event = EventRepository::findByIdAnyState($eventId);
        if ($event === null) {
            Response::json(['error' => 'Event not found'], 404);
            return;
        }
        if (($event['event_status'] ?? 'scheduled') === 'deleted') {
            Response::json(['error' => 'Event removed'], 410);
            return;
        }

        // Cursor pagination (events are channels → reuse getByChannel). No
        // before_id = latest page; before_id = the 50 immediately older.
        $beforeId = isset($_GET['before_id']) && is_string($_GET['before_id']) ? trim($_GET['before_id']) : null;
        $limit    = min(100, max(1, (int) ($_GET['limit'] ?? 50)));
        $res      = MessageRepository::getByChannel($eventId, $beforeId ?: null, $limit);
        $messages = $res['messages'];
        $hasMore  = $res['hasMore'];

        $viewerGuestId = $_SERVER['HTTP_X_GUEST_ID'] ?? ($_COOKIE['guestId'] ?? null);
        $viewerUserId  = AuthService::currentUser()['id'] ?? null;

        // Block filter (Apple G1.2)
        $messages = filterByBlocks(
            $messages,
            viewerBlockSet($viewerUserId, isValidGuestId($viewerGuestId) ? $viewerGuestId : null)
        );

        MessageRepository::attachReactions($messages, $viewerGuestId ?: null, $viewerUserId);

        Response::json(['messages' => $messages, 'hasMore' => $hasMore]);
    } catch (\Throwable $e) {
        error_log('[event-messages] GET failed for event ' . $eventId . ': ' . $e->getMessage());
        Response::json(['error' => 'Failed to load messages'], 500);
    }
});

$router->add('POST', '/api/v1/events/{eventId}/messages', function (array $params) {
    $eventId = $params['eventId'] ?? '';

    error_log("[event-msg] POST eventId={$eventId}");

    if (!preg_match('/^[a-f0-9]{16}$/', $eventId)) {
        Response::json(['error' => 'Invalid eventId'], 400);
    }

    if (EventRepository::findById($eventId) === null) {
        Response::json(['error' => 'Event not found or expired'], 404);
    }

    $body = Request::json();

    if ($body === null) {
        Response::json(['error' => 'Invalid JSON body'], 400);
    }

    $guestId  = $body['guestId']  ?? null;
    $nickname = $body['nickname'] ?? null;
    $content  = $body['content']  ?? null;
    $type     = $body['type']     ?? 'text';
    $imageUrl = $body['imageUrl'] ?? null;

    enforceRateLimit('event_message', 45, 300, $eventId);

    if (!isValidGuestId($guestId)) {
        Response::json(['error' => 'guestId is required'], 400);
    }

    if (empty($nickname) || !is_string($nickname)) {
        Response::json(['error' => 'nickname is required'], 400);
    }

    $nickname = mb_substr(trim(strip_tags($nickname)), 0, 20);

    if ($nickname === '') {
        Response::json(['error' => 'nickname must not be empty'], 400);
    }

    if (!in_array($type, ['text', 'image'], true)) {
        Response::json(['error' => 'type must be text or image'], 400);
    }

    if ($type === 'image') {
        if (empty($imageUrl) || !is_string($imageUrl)) {
            Response::json(['error' => 'imageUrl is required for image messages'], 400);
        }

        $r2Base = rtrim(getenv('R2_PUBLIC_URL') ?: '', '/') . '/';
        if (!str_starts_with($imageUrl, $r2Base)) {
            Response::json(['error' => 'Invalid image URL'], 400);
        }

        $filename = basename(parse_url($imageUrl, PHP_URL_PATH) ?? '');
        if (!preg_match('/^[a-f0-9]{32}\.(jpg|png|webp)$/', $filename)) {
            Response::json(['error' => 'Invalid image reference'], 400);
        }

        try {
            $senderUser   = AuthService::currentUser();
            $senderUserId = $senderUser['id'] ?? null;
            $message = MessageRepository::addImage($eventId, $guestId, $nickname, $imageUrl, $senderUserId);
        } catch (\Throwable $e) {
            error_log("[event-msg] DB error inserting image message eventId={$eventId}: " . $e->getMessage());
            Response::json(['error' => 'Failed to send message'], 500);
        }
    } else {
        if (empty($content) || !is_string($content)) {
            Response::json(['error' => 'content is required'], 400);
        }

        if (strlen($content) > 1000) {
            Response::json(['error' => 'content must not exceed 1000 characters'], 400);
        }

        try {
            $senderUser   = AuthService::currentUser();
            $senderUserId = $senderUser['id'] ?? null;
            $replySnap    = resolveReplySnapshot($body['replyToMessageId'] ?? null);
            $mentions     = sanitizeMentions($body['mentions'] ?? null, 'event', $eventId, $content);
            $message = MessageRepository::add(
                $eventId, $guestId, $nickname, $content, $senderUserId,
                $replySnap['id'] ?? null,
                $replySnap['nickname'] ?? null,
                $replySnap['content']  ?? null,
                $replySnap['type']     ?? 'text',
                $mentions
            );
        } catch (\Throwable $e) {
            error_log("[event-msg] DB error inserting message eventId={$eventId}: " . $e->getMessage());
            Response::json(['error' => 'Failed to send message'], 500);
        }
    }

    error_log("[event-msg] message saved id={$message['id']} eventId={$eventId}");

    $message = enrichBroadcastMessage($message, $senderUser ?? null);
    broadcastMessageToWs($eventId, $message);

    // Notify registered event participants — non-fatal: a notification failure must never
    // prevent the message response from reaching the sender.
    try {
        $eventForNotif = EventRepository::findById($eventId);
        $eventTitle    = is_array($eventForNotif) ? ($eventForNotif['title'] ?? 'event') : 'event';
        $bodyPreview   = $type === 'image' ? '📸 Sent an image' : mb_substr((string)($content ?? ''), 0, 100);
        NotificationRepository::notifyEventParticipants(
            $eventId,
            $senderUserId,
            'event_message',
            $nickname . ' in ' . $eventTitle,
            $bodyPreview,
            ['eventId' => $eventId, 'eventTitle' => $eventTitle, 'senderName' => $nickname, 'senderUserId' => $senderUserId]
        );
        // @mention notifications — higher-signal than the participant ping above.
        if (!empty($mentions ?? [])) {
            notifyMentions(
                $mentions,
                $senderUserId,
                $nickname . ' mentioned you in ' . $eventTitle,
                $bodyPreview,
                ['eventId' => $eventId, 'eventTitle' => $eventTitle, 'messageId' => $message['id'], 'senderName' => $nickname, 'senderUserId' => $senderUserId]
            );
        }
    } catch (\Throwable $e) {
        error_log("[event-msg] notification error eventId={$eventId}: " . get_class($e) . ': ' . $e->getMessage());
        // Do not rethrow — the message was already saved and broadcast successfully.
    }

    Response::json($message, 201);
});

// POST /api/v1/events/{eventId}/messages/{messageId}/reactions
$router->add('POST', '/api/v1/events/{eventId}/messages/{messageId}/reactions', function (array $params) {
    $eventId   = $params['eventId']   ?? '';
    $messageId = $params['messageId'] ?? '';

    if (!preg_match('/^[a-f0-9]{16}$/', $eventId)) {
        Response::json(['error' => 'Invalid eventId'], 400);
    }
    if (empty($messageId)) {
        Response::json(['error' => 'Invalid messageId'], 400);
    }

    $body    = Request::json();
    $emoji   = trim((string) ($body['emoji'] ?? ''));
    $guestId = $body['guestId'] ?? null;

    $allowedEmojis = ['❤️', '👍', '😂', '😮', '🔥'];
    if (!in_array($emoji, $allowedEmojis, true)) {
        Response::json(['error' => 'Invalid emoji'], 400);
    }

    $userId = AuthService::currentUser()['id'] ?? null;
    if ($userId === null && !isValidGuestId($guestId)) {
        Response::json(['error' => 'guestId or auth token required'], 400);
    }

    $result = toggleMessageReaction($messageId, $emoji, $guestId, $userId);
    broadcastReactionToWs($eventId, $messageId, $result['reactions']);

    Response::json(['reactions' => $result['reactions']]);
});

$router->add('GET', '/api/v1/events/{eventId}/participants', function (array $params) {
    $eventId = $params['eventId'] ?? '';

    if (!preg_match('/^[a-f0-9]{16}$/', $eventId)) {
        Response::json(['error' => 'Invalid eventId'], 400);
    }

    // Read view: serve past events too (any-state) so the archive can show who
    // went to a finished hangout. RSVP toggle (POST below) still uses findById
    // so joining an expired event stays blocked. Deleted → 410.
    $event = EventRepository::findByIdAnyState($eventId);
    if ($event === null) {
        Response::json(['error' => 'Event not found'], 404);
    }
    if (($event['event_status'] ?? 'scheduled') === 'deleted') {
        Response::json(['error' => 'Event removed'], 410);
    }

    // Prefer guestId (persistent across sessions) over sessionId (ephemeral).
    // Native app sends guestId; web sends sessionId — both are valid participant keys.
    $guestId   = trim($_GET['guestId']   ?? '');
    $sessionId = trim($_GET['sessionId'] ?? '');

    if ($guestId !== '' && !isValidGuestId($guestId)) {
        Response::json(['error' => 'Invalid guestId'], 400);
    }
    if ($sessionId !== '' && !isValidSessionId($sessionId)) {
        Response::json(['error' => 'Invalid sessionId'], 400);
    }

    $participantKey = $guestId !== '' ? $guestId : ($sessionId !== '' ? $sessionId : '');

    // Logged-in user's id — lets isIn match their row by user_id even when the
    // session/guest key differs (web's sessionId is per-page; native guestId is
    // per-device), keeping the Join/Going button in sync with count + list.
    $viewerUserId = AuthService::currentUser()['id'] ?? null;

    // ?lite=1 — skip the full participant list (user JOIN + mapping).
    // Use this when only count + isIn are needed (event card / status check).
    $lite = ($_GET['lite'] ?? '') === '1';

    Response::json([
        'participants' => $lite ? [] : ParticipantRepository::getParticipants($eventId),
        'count'        => ParticipantRepository::getCount($eventId),
        'isIn'         => ($participantKey !== '' || $viewerUserId !== null)
            ? ParticipantRepository::isIn($eventId, $participantKey, $viewerUserId)
            : false,
    ]);
});

$router->add('POST', '/api/v1/events/{eventId}/participants/toggle', function (array $params) {
    $eventId = $params['eventId'] ?? '';

    if (!preg_match('/^[a-f0-9]{16}$/', $eventId)) {
        Response::json(['error' => 'Invalid eventId'], 400);
    }

    if (EventRepository::findById($eventId) === null) {
        Response::json(['error' => 'Event not found or expired'], 404);
    }

    $body = Request::json();

    if ($body === null) {
        Response::json(['error' => 'Invalid JSON body'], 400);
    }

    // Prefer guestId (persistent across sessions) over sessionId (ephemeral).
    // Native app sends guestId; web sends sessionId — both are valid participant keys.
    $guestId   = $body['guestId']   ?? null;
    $sessionId = $body['sessionId'] ?? null;

    enforceRateLimit('event_participant_toggle', 60, 300, $eventId);

    if (isValidGuestId($guestId)) {
        $participantKey = $guestId;
    } elseif (isValidSessionId($sessionId)) {
        $participantKey = $sessionId;
    } else {
        Response::json(['error' => 'guestId or sessionId is required'], 400);
    }

    $nickname    = isset($body['nickname']) ? mb_substr(trim((string) $body['nickname']), 0, 64) : '';
    $currentUser = AuthService::currentUser(); // null for guests
    $isIn  = ParticipantRepository::toggle($eventId, $participantKey, $currentUser['id'] ?? null, $nickname);
    $count = ParticipantRepository::getCount($eventId);

    ParticipantRepository::broadcastToWs($eventId, $count);

    // Notify other registered participants when a registered user joins (not on leave)
    if ($isIn && $currentUser !== null) {
        $event = EventRepository::findById($eventId);
        if ($event !== null) {
            $joinerName = $currentUser['display_name'] ?? ($nickname ?: 'Someone');
            $eventTitle = $event['title'] ?? 'an event';
            NotificationRepository::notifyEventParticipants(
                $eventId,
                $currentUser['id'],
                'event_join',
                "👋 {$joinerName} joined {$eventTitle}",
                null,
                ['eventId' => $eventId, 'senderUserId' => $currentUser['id'], 'senderName' => $joinerName, 'eventTitle' => $eventTitle]
            );
        }
    }

    if ($isIn) {
        $evtDistinctId = $currentUser['id'] ?? $participantKey;
        AnalyticsService::defer('joined_event', $evtDistinctId, [
            'event_id' => $eventId,
            'is_guest' => $currentUser === null,
            'user_id'  => $currentUser['id'] ?? null,
            'guest_id' => $currentUser === null ? $participantKey : null,
        ]);
    }

    Response::json(['count' => $count, 'isIn' => $isIn]);
});

$router->add('POST', '/api/v1/disconnect', function () {
    $body = Request::json();

    if ($body === null) {
        Response::json(['error' => 'Invalid JSON body'], 400);
    }

    $sessionId = $body['sessionId'] ?? null;

    if (!isValidSessionId($sessionId)) {
        Response::json(['error' => 'sessionId is required'], 400);
    }

    PresenceRepository::disconnect($sessionId);

    Response::json(['ok' => true]);
});

$router->add('POST', '/api/v1/channels/{channelId}/messages', function (array $params) {
    $channelId = filter_var($params['channelId'], FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);

    if ($channelId === false) {
        Response::json(['error' => 'Invalid channelId'], 400);
    }

    if (CityRepository::findById($channelId) === null) {
        Response::json(['error' => 'Channel not found'], 404);
    }

    $body = Request::json();

    if ($body === null) {
        Response::json(['error' => 'Invalid JSON body'], 400);
    }

    $sessionId = $body['sessionId'] ?? null;
    $guestId   = $body['guestId']  ?? null;
    $nickname  = $body['nickname'] ?? null;
    $content   = $body['content']  ?? null;
    $type      = $body['type']     ?? 'text';
    $imageUrl  = $body['imageUrl'] ?? null;

    enforceRateLimit('channel_message', 60, 300, (string) $channelId);

    if (!isValidGuestId($guestId)) {
        Response::json(['error' => 'guestId is required'], 400);
    }

    if (empty($nickname) || !is_string($nickname)) {
        Response::json(['error' => 'nickname is required'], 400);
    }

    $nickname = mb_substr(trim(strip_tags($nickname)), 0, 20);

    if ($nickname === '') {
        Response::json(['error' => 'nickname must not be empty'], 400);
    }

    if (!in_array($type, ['text', 'image'], true)) {
        Response::json(['error' => 'type must be text or image'], 400);
    }

    // Sending a message also refreshes presence (sessionId optional for backward compat)
    if (!empty($sessionId) && isValidSessionId($sessionId)) {
        PresenceRepository::heartbeat($channelId, $sessionId, $guestId, $nickname);
    }

    if ($type === 'image') {
        if (empty($imageUrl) || !is_string($imageUrl)) {
            Response::json(['error' => 'imageUrl is required for image messages'], 400);
        }

        // Verify the URL belongs to our R2 bucket — prevents injecting arbitrary image URLs.
        $r2Base = rtrim(getenv('R2_PUBLIC_URL') ?: '', '/') . '/';
        if (!str_starts_with($imageUrl, $r2Base)) {
            Response::json(['error' => 'Invalid image URL'], 400);
        }

        // Filename must match the pattern we generate — no traversal, no surprises.
        $filename = basename(parse_url($imageUrl, PHP_URL_PATH) ?? '');
        if (!preg_match('/^[a-f0-9]{32}\.(jpg|png|webp)$/', $filename)) {
            Response::json(['error' => 'Invalid image reference'], 400);
        }

        $msgSender       = AuthService::currentUser();
        $msgSenderUserId = $msgSender['id'] ?? null;
        $message = MessageRepository::addImage($channelId, $guestId, $nickname, $imageUrl, $msgSenderUserId);
    } else {
        if (empty($content) || !is_string($content)) {
            Response::json(['error' => 'content is required'], 400);
        }

        if (strlen($content) > 1000) {
            Response::json(['error' => 'content must not exceed 1000 characters'], 400);
        }

        $msgSender       = AuthService::currentUser();
        $msgSenderUserId = $msgSender['id'] ?? null;
        $replySnap       = resolveReplySnapshot($body['replyToMessageId'] ?? null);
        $mentions        = sanitizeMentions($body['mentions'] ?? null, 'city', "city_{$channelId}", $content);
        $message = MessageRepository::add(
            $channelId, $guestId, $nickname, $content, $msgSenderUserId,
            $replySnap['id'] ?? null,
            $replySnap['nickname'] ?? null,
            $replySnap['content']  ?? null,
            $replySnap['type']     ?? 'text',
            $mentions
        );
    }

    $message = enrichBroadcastMessage($message, $msgSender ?? null);
    broadcastMessageToWs($channelId, $message);

    // Notify registered users currently online in this city — non-fatal side effect.
    // Sender is excluded if they have a registered account; guests are excluded via null.
    // MobilePushService applies a 5-minute cooldown per recipient per channel.
    try {
        $msgCityChannelId = "city_{$channelId}";
        $msgPreview       = $type === 'image' ? '📸 Sent an image' : mb_substr((string) ($content ?? ''), 0, 100);
        NotificationRepository::notifyCityOnlineUsers(
            $msgCityChannelId,
            $msgSenderUserId,
            'channel_message',
            $nickname . ' in the city chat',
            $msgPreview,
            ['channelId' => $msgCityChannelId, 'senderName' => $nickname, 'senderUserId' => $msgSenderUserId]
        );
        if (!empty($mentions ?? [])) {
            notifyMentions(
                $mentions,
                $msgSenderUserId,
                $nickname . ' mentioned you in the city chat',
                $msgPreview,
                ['channelId' => $msgCityChannelId, 'messageId' => $message['id'], 'senderName' => $nickname, 'senderUserId' => $msgSenderUserId]
            );
        }
    } catch (\Throwable $e) {
        error_log("[channel-msg] notify failed (non-fatal): " . $e->getMessage());
    }

    $msgCityInfo   = CityRepository::findById($channelId); // cached in memory
    $msgDistinctId = $msgSenderUserId ?? $guestId;
    AnalyticsService::defer('sent_message', $msgDistinctId, [
        'channel_id'   => $channelId,
        'channel_type' => 'city',
        'message_type' => $type,
        'city'         => $msgCityInfo['name']    ?? null,
        'country'      => $msgCityInfo['country'] ?? null,
        'is_guest'     => $msgSenderUserId === null,
        'user_id'      => $msgSenderUserId ?? null,
        'guest_id'     => $msgSenderUserId === null ? $guestId : null,
    ]);

    Response::json($message, 201);
});

// POST /api/v1/channels/{channelId}/messages/{messageId}/reactions
$router->add('POST', '/api/v1/channels/{channelId}/messages/{messageId}/reactions', function (array $params) {
    $channelId = filter_var($params['channelId'], FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    $messageId = $params['messageId'] ?? '';

    if ($channelId === false) {
        Response::json(['error' => 'Invalid channelId'], 400);
    }
    if (empty($messageId)) {
        Response::json(['error' => 'Invalid messageId'], 400);
    }

    $body    = Request::json();
    $emoji   = trim((string) ($body['emoji'] ?? ''));
    $guestId = $body['guestId'] ?? null;

    $allowedEmojis = ['❤️', '👍', '😂', '😮', '🔥'];
    if (!in_array($emoji, $allowedEmojis, true)) {
        Response::json(['error' => 'Invalid emoji'], 400);
    }

    $userId = AuthService::currentUser()['id'] ?? null;
    if ($userId === null && !isValidGuestId($guestId)) {
        Response::json(['error' => 'guestId or auth token required'], 400);
    }

    $result = toggleMessageReaction($messageId, $emoji, $guestId, $userId);
    broadcastReactionToWs("city_{$channelId}", $messageId, $result['reactions']);

    Response::json(['reactions' => $result['reactions']]);
});

// ── Conversations ─────────────────────────────────────────────────────────────

// GET /api/v1/conversations
// Returns the current user's DMs + event channels they created/joined.
$router->add('GET', '/api/v1/conversations', function () {
    $user = AuthService::requireAuth();

    $dms    = ConversationRepository::listDmsForUser($user['id']);
    $events = ConversationRepository::listEventChannelsForUser($user['id']);

    // Block filter (Apple G1.2): hide DM threads with blocked users from the
    // inbox. The DM list query returns `other_user_id` per row.
    $dms = filterByBlocks(
        $dms,
        viewerBlockSet($user['id'], null),
        'other_user_id',
        'other_guest_id' // not present in DM list shape but harmless if missing
    );

    Response::json([
        'dms'    => $dms,
        'events' => $events,
    ]);
});

// GET /api/v1/conversations/unread
// Lightweight poll endpoint — returns only whether the user has any unread DM or event-channel message.
// Used for the Messages icon dot on city channel; avoids running the full conversations query on boot.
$router->add('GET', '/api/v1/conversations/unread', function () {
    $user = AuthService::requireAuth();
    Response::json(['has_unread' => ConversationRepository::hasAnyUnread($user['id'])]);
});

// POST /api/v1/conversations/direct
// Find or create a DM conversation with another registered user.
// Returns the conversation object so the frontend can navigate to it.
$router->add('POST', '/api/v1/conversations/direct', function () {
    $user = AuthService::requireAuth();
    $body = Request::json();

    $targetUserId = isset($body['targetUserId']) && is_string($body['targetUserId'])
        ? trim($body['targetUserId'])
        : null;

    if (!$targetUserId) {
        Response::json(['error' => 'targetUserId is required'], 400);
    }

    if ($targetUserId === $user['id']) {
        Response::json(['error' => 'Cannot message yourself'], 400);
    }

    $target = UserRepository::findById($targetUserId);
    if (!$target || !empty($target['deleted_at'])) {
        Response::json(['error' => 'User not found'], 404);
    }

    // Block check (Apple G1.2): refuse opening a DM across a block in either
    // direction. 404 so neither side leaks the block state.
    if (BlockRepository::isBlockedBetween($user['id'], null, $targetUserId, null)) {
        Response::json(['error' => 'User not found'], 404);
    }

    $conversation = ConversationRepository::findOrCreateDirect($user['id'], $targetUserId);

    Response::json([
        'conversation' => $conversation,
        'otherUser'    => AuthService::publicFields($target),
    ]);
});

// ── Edit + delete (channel messages — city/event/topic share `messages`) ─────

// PATCH /api/v1/messages/{messageId}  body: { content, guestId? }
// Owner-only. Caller is identified by Authorization cookie/header (user_id) and
// the optional guestId in the body (legacy guest sessions). Only text messages
// can be edited; deleted rows are 410.
$router->add('PATCH', '/api/v1/messages/{messageId}', function (array $params) {
    $messageId = strtolower(trim((string) ($params['messageId'] ?? '')));
    if (!preg_match('/^[a-f0-9]{16}$/', $messageId)) {
        Response::json(['error' => 'Invalid messageId'], 400);
    }
    $body = Request::json();
    if ($body === null) Response::json(['error' => 'Invalid body'], 400);
    $content = trim((string) ($body['content'] ?? ''));
    if ($content === '')              Response::json(['error' => 'Content required'], 422);
    if (mb_strlen($content) > 4000)   Response::json(['error' => 'Content too long'], 422);

    $viewer  = AuthService::currentUser();
    $userId  = $viewer['id'] ?? null;
    $guestId = isset($body['guestId']) && is_string($body['guestId']) ? $body['guestId'] : null;

    $row = MessageRepository::findOwned($messageId, $userId, $guestId);
    if (!$row)                                Response::json(['error' => 'Not found or not owned'], 404);
    if (($row['type'] ?? 'text') !== 'text')  Response::json(['error' => 'Only text messages can be edited'], 422);
    if (!empty($row['deleted_at']))           Response::json(['error' => 'Cannot edit a deleted message'], 410);

    $editedAt = MessageRepository::edit($messageId, $content);

    // Channels share the messages table; channel_id is "city_<n>" for cities and
    // raw 16-hex for event/topic. WS broadcastNewMessage handler expects int for
    // cities, string otherwise — match that contract.
    $rawChan  = (string) $row['channel_id'];
    $wsChanId = str_starts_with($rawChan, 'city_') ? (int) substr($rawChan, 5) : $rawChan;
    broadcastMessageEditedToWs($wsChanId, $messageId, $content, $editedAt);

    Response::json([
        'ok'        => true,
        'messageId' => $messageId,
        'content'   => $content,
        'editedAt'  => $editedAt,
    ]);
});

// DELETE /api/v1/messages/{messageId}  body: { guestId? } — soft-delete (tombstone).
$router->add('DELETE', '/api/v1/messages/{messageId}', function (array $params) {
    $messageId = strtolower(trim((string) ($params['messageId'] ?? '')));
    if (!preg_match('/^[a-f0-9]{16}$/', $messageId)) {
        Response::json(['error' => 'Invalid messageId'], 400);
    }
    $body    = Request::json() ?? [];
    $viewer  = AuthService::currentUser();
    $userId  = $viewer['id'] ?? null;
    $guestId = isset($body['guestId']) && is_string($body['guestId']) ? $body['guestId'] : null;

    $row = MessageRepository::findOwned($messageId, $userId, $guestId);
    if (!$row)                       Response::json(['error' => 'Not found or not owned'], 404);
    if (!empty($row['deleted_at'])) {
        // Idempotent — second delete is a no-op.
        Response::json(['ok' => true, 'messageId' => $messageId, 'alreadyDeleted' => true]);
    }

    $deletedAt = MessageRepository::softDelete($messageId);
    $rawChan   = (string) $row['channel_id'];
    $wsChanId  = str_starts_with($rawChan, 'city_') ? (int) substr($rawChan, 5) : $rawChan;
    broadcastMessageDeletedToWs($wsChanId, $messageId, $deletedAt);

    Response::json([
        'ok'        => true,
        'messageId' => $messageId,
        'deletedAt' => $deletedAt,
    ]);
});

// ── Edit + delete (DM messages — registered users only) ─────────────────────

$router->add('PATCH', '/api/v1/dm-messages/{messageId}', function (array $params) {
    $user      = AuthService::requireAuth();
    $messageId = strtolower(trim((string) ($params['messageId'] ?? '')));
    if (!preg_match('/^[a-f0-9]{16}$/', $messageId)) {
        Response::json(['error' => 'Invalid messageId'], 400);
    }
    $body = Request::json();
    if ($body === null) Response::json(['error' => 'Invalid body'], 400);
    $content = trim((string) ($body['content'] ?? ''));
    if ($content === '')              Response::json(['error' => 'Content required'], 422);
    if (mb_strlen($content) > 4000)   Response::json(['error' => 'Content too long'], 422);

    $row = ConversationRepository::findOwnedMessage($messageId, $user['id']);
    if (!$row)                                Response::json(['error' => 'Not found or not owned'], 404);
    if (($row['type'] ?? 'text') !== 'text')  Response::json(['error' => 'Only text messages can be edited'], 422);
    if (!empty($row['deleted_at']))           Response::json(['error' => 'Cannot edit a deleted message'], 410);

    $editedAt = ConversationRepository::editMessage($messageId, $content);
    broadcastDmMessageEditedToWs($row['conversation_id'], $messageId, $content, $editedAt);

    Response::json([
        'ok'        => true,
        'messageId' => $messageId,
        'content'   => $content,
        'editedAt'  => $editedAt,
    ]);
});

$router->add('DELETE', '/api/v1/dm-messages/{messageId}', function (array $params) {
    $user      = AuthService::requireAuth();
    $messageId = strtolower(trim((string) ($params['messageId'] ?? '')));
    if (!preg_match('/^[a-f0-9]{16}$/', $messageId)) {
        Response::json(['error' => 'Invalid messageId'], 400);
    }

    $row = ConversationRepository::findOwnedMessage($messageId, $user['id']);
    if (!$row)                       Response::json(['error' => 'Not found or not owned'], 404);
    if (!empty($row['deleted_at'])) {
        Response::json(['ok' => true, 'messageId' => $messageId, 'alreadyDeleted' => true]);
    }

    $deletedAt = ConversationRepository::softDeleteMessage($messageId);
    broadcastDmMessageDeletedToWs($row['conversation_id'], $messageId, $deletedAt);

    Response::json([
        'ok'        => true,
        'messageId' => $messageId,
        'deletedAt' => $deletedAt,
    ]);
});

// GET /api/v1/conversations/{conversationId}/messages
$router->add('GET', '/api/v1/conversations/{conversationId}/messages', function (array $params) {
    $user           = AuthService::requireAuth();
    $conversationId = $params['conversationId'] ?? '';

    if (!ConversationRepository::isParticipant($conversationId, $user['id'])) {
        Response::json(['error' => 'Not a participant'], 403);
    }

    // Cursor pagination: no before_id = latest page; before_id = the 50 older.
    $beforeId = isset($_GET['before_id']) && is_string($_GET['before_id']) ? trim($_GET['before_id']) : null;
    $limit    = min(100, max(1, (int) ($_GET['limit'] ?? 50)));
    $res      = ConversationRepository::listMessagesPaged($conversationId, $beforeId ?: null, $limit);
    $messages = $res['messages'];
    MessageRepository::attachReactions($messages, null, $user['id'], 'conversation_message_reactions');

    Response::json(['messages' => $messages, 'hasMore' => $res['hasMore']]);
});

// POST /api/v1/conversations/{conversationId}/messages
$router->add('POST', '/api/v1/conversations/{conversationId}/messages', function (array $params) {
    $user           = AuthService::requireAuth();
    $conversationId = $params['conversationId'] ?? '';
    $body           = Request::json();

    enforceRateLimit('conversation_message', 50, 300, $conversationId);

    if (!ConversationRepository::isParticipant($conversationId, $user['id'])) {
        Response::json(['error' => 'Not a participant'], 403);
    }

    // Block check (Apple G1.2): refuse sends if the other participant has a
    // block in either direction. The DM is a 2-person thread, so we look up
    // the other side once.
    $otherIdStmt = Database::pdo()->prepare("
        SELECT user_id FROM conversation_participants
        WHERE conversation_id = ? AND user_id != ?
        LIMIT 1
    ");
    $otherIdStmt->execute([$conversationId, $user['id']]);
    $otherParticipantId = $otherIdStmt->fetchColumn() ?: null;
    if ($otherParticipantId !== null
     && BlockRepository::isBlockedBetween($user['id'], null, $otherParticipantId, null)) {
        Response::json(['error' => 'This conversation is no longer available'], 403);
    }

    $content  = trim((string) ($body['content'] ?? ''));
    $type     = $body['type'] ?? 'text';
    $imageUrl = $body['imageUrl'] ?? null;

    if (!in_array($type, ['text', 'image'], true)) {
        Response::json(['error' => 'type must be text or image'], 400);
    }

    if ($type === 'image') {
        if (empty($imageUrl) || !is_string($imageUrl)) {
            Response::json(['error' => 'imageUrl is required for image messages'], 400);
        }

        $r2Base = rtrim(getenv('R2_PUBLIC_URL') ?: '', '/') . '/';
        if (!str_starts_with($imageUrl, $r2Base)) {
            Response::json(['error' => 'Invalid image URL'], 400);
        }

        $filename = basename(parse_url($imageUrl, PHP_URL_PATH) ?? '');
        if (!preg_match('/^[a-f0-9]{32}\.(jpg|png|webp)$/', $filename)) {
            Response::json(['error' => 'Invalid image reference'], 400);
        }

        $message = ConversationRepository::addImageMessage($conversationId, $user['id'], $imageUrl);
    } else {
        if ($content === '') {
            Response::json(['error' => 'content is required'], 400);
        }

        if (mb_strlen($content) > 1000) {
            Response::json(['error' => 'content must not exceed 1000 characters'], 400);
        }

        $replySnap = resolveReplySnapshot($body['replyToMessageId'] ?? null, 'conversation_messages');
        $message = ConversationRepository::addMessage(
            $conversationId, $user['id'], $content,
            $replySnap['id'] ?? null,
            $replySnap['nickname'] ?? null,
            $replySnap['content']  ?? null,
            $replySnap['type']     ?? 'text'
        );
    }

    $message = enrichBroadcastMessage($message, $user);
    broadcastConversationMessageToWs($conversationId, $message);

    // Sending a message also implicitly reads the conversation for the sender
    ConversationRepository::markRead($conversationId, $user['id']);

    // Notify the other participant — explicitly exclude the sender by user_id.
    $otherStmt = Database::pdo()->prepare("
        SELECT user_id FROM conversation_participants
        WHERE conversation_id = ? AND user_id != ?
        LIMIT 1
    ");
    $otherStmt->execute([$conversationId, $user['id']]);
    $otherUserId = $otherStmt->fetchColumn();
    if ($otherUserId) {
        $preview = $type === 'image' ? '📸 Sent an image' : mb_substr($content, 0, 100);
        NotificationRepository::create(
            $otherUserId,
            'dm_message',
            ($user['display_name'] ?? 'Someone') . ' sent you a message',
            $preview,
            [
                'conversationId' => $conversationId,
                'senderName'     => $user['display_name'] ?? '',
                'senderUserId'   => $user['id'],   // lets client reject if push token was re-assigned
            ]
        );
    }

    Response::json(['message' => $message], 201);
});

// POST /api/v1/conversations/{conversationId}/messages/{messageId}/reactions
$router->add('POST', '/api/v1/conversations/{conversationId}/messages/{messageId}/reactions', function (array $params) {
    $user           = AuthService::requireAuth();
    $conversationId = $params['conversationId'] ?? '';
    $messageId      = $params['messageId']      ?? '';

    if (!ConversationRepository::isParticipant($conversationId, $user['id'])) {
        Response::json(['error' => 'Not a participant'], 403);
    }
    if (empty($messageId)) {
        Response::json(['error' => 'Invalid messageId'], 400);
    }

    $body  = Request::json();
    $emoji = trim((string) ($body['emoji'] ?? ''));

    $allowedEmojis = ['❤️', '👍', '😂', '😮', '🔥'];
    if (!in_array($emoji, $allowedEmojis, true)) {
        Response::json(['error' => 'Invalid emoji'], 400);
    }

    $pdo = Database::pdo();
    $stmt = $pdo->prepare("SELECT id FROM conversation_message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?");
    $stmt->execute([$messageId, $user['id'], $emoji]);
    if ($stmt->fetch()) {
        $pdo->prepare("DELETE FROM conversation_message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?")->execute([$messageId, $user['id'], $emoji]);
    } else {
        $pdo->prepare("INSERT INTO conversation_message_reactions (message_id, user_id, emoji) VALUES (?, ?, ?)")->execute([$messageId, $user['id'], $emoji]);
    }

    // Return updated reactions with self flag
    $stmt2 = $pdo->prepare("
        SELECT emoji, COUNT(*) AS cnt,
               BOOL_OR(user_id = ?) AS self_reacted
          FROM conversation_message_reactions
         WHERE message_id = ?
         GROUP BY emoji
         ORDER BY MIN(created_at) ASC
    ");
    $stmt2->execute([$user['id'], $messageId]);
    $reactions = array_map(fn($r) => [
        'emoji' => $r['emoji'],
        'count' => (int) $r['cnt'],
        'self'  => (bool) $r['self_reacted'],
    ], $stmt2->fetchAll());

    broadcastDmReactionToWs($conversationId, $messageId, $reactions);

    Response::json(['reactions' => $reactions]);
});

// POST /api/v1/events/{eventId}/mark-read
// Sets last_read_at = now() on the event_participants row for the current user. Idempotent.
// No-op (200 OK) for users who are creators but have no participant row.
$router->add('POST', '/api/v1/events/{eventId}/mark-read', function (array $params) {
    $user    = AuthService::requireAuth();
    $eventId = $params['eventId'] ?? '';

    if (!preg_match('/^[a-f0-9]{16}$/', $eventId)) {
        Response::json(['error' => 'Invalid eventId'], 400);
    }

    ConversationRepository::markEventRead($eventId, $user['id']);

    Response::json(['ok' => true]);
});

// POST /api/v1/conversations/{conversationId}/mark-read
// Sets last_read_at = now() for the current user. Idempotent.
$router->add('POST', '/api/v1/conversations/{conversationId}/mark-read', function (array $params) {
    $user           = AuthService::requireAuth();
    $conversationId = $params['conversationId'] ?? '';

    if (!ConversationRepository::isParticipant($conversationId, $user['id'])) {
        Response::json(['error' => 'Not a participant'], 403);
    }

    ConversationRepository::markRead($conversationId, $user['id']);

    Response::json(['ok' => true]);
});

// ── Notifications ─────────────────────────────────────────────────────────────

// GET /api/v1/notifications[?limit=5&offset=0]
// Returns paginated notifications for the current user plus total unread count.
// Preview screen: limit=5  |  Full-history screen: limit=50&offset=N
// limit is capped at 100 server-side.
$router->add('GET', '/api/v1/notifications', function () {
    $user   = AuthService::requireAuth();
    $limit  = max(1, min(100, (int) ($_GET['limit']  ?? 50)));
    $offset = max(0, (int) ($_GET['offset'] ?? 0));

    $notifications = NotificationRepository::listForUser($user['id'], $limit, $offset);

    // Block filter (Apple G1.2): drop friend-request/vibe/profile-view notifs
    // whose actor is a user the viewer has blocked or been blocked by. We
    // inspect the well-known actor keys inside each notification's data blob.
    $notifBlocks = viewerBlockSet($user['id'], null);
    if (!empty($notifBlocks['user_ids'])) {
        $blockedSet = array_flip($notifBlocks['user_ids']);
        $notifications = array_values(array_filter($notifications, static function ($n) use ($blockedSet) {
            $data = $n['data'] ?? [];
            foreach (['senderUserId', 'accepterUserId', 'actorId', 'viewerUserId'] as $k) {
                if (!empty($data[$k]) && isset($blockedSet[$data[$k]])) return false;
            }
            return true;
        }));
    }

    Response::json([
        'notifications' => $notifications,
        'unread_count'  => NotificationRepository::unreadCount($user['id']),
    ]);
});

// GET /api/v1/notifications/unread-count
// Lightweight poll endpoint — returns only the unread count.
$router->add('GET', '/api/v1/notifications/unread-count', function () {
    $startedAt = microtime(true);
    $user = AuthService::requireAuth();
    try {
        $count = NotificationRepository::unreadCount($user['id']);
        apiLog('notifications_unread', 'success', [
            'userId' => substr($user['id'], 0, 8),
            'count' => $count,
            'elapsedMs' => apiElapsedMs($startedAt),
        ]);
        Response::json(['count' => $count]);
    } catch (\Throwable $e) {
        apiLog('notifications_unread', 'failure', [
            'userId' => substr($user['id'], 0, 8),
            'elapsedMs' => apiElapsedMs($startedAt),
            'error' => get_class($e) . ': ' . $e->getMessage(),
        ]);
        throw $e;
    }
});

// POST /api/v1/notifications/mark-read
// Body: { ids: [1,2,3] }  OR  { all: true }
$router->add('POST', '/api/v1/notifications/mark-read', function () {
    $user = AuthService::requireAuth();
    $body = Request::json();

    if (!empty($body['all'])) {
        NotificationRepository::markAllRead($user['id']);
    } elseif (!empty($body['ids']) && is_array($body['ids'])) {
        NotificationRepository::markRead($user['id'], $body['ids']);
    } else {
        Response::json(['error' => 'Provide ids or all:true'], 400);
    }

    Response::json(['ok' => true]);
});

// GET /api/v1/notification-preferences
$router->add('GET', '/api/v1/notification-preferences', function () {
    $user = AuthService::requireAuth();
    try {
        Response::json(['preferences' => NotificationPreferencesRepository::get($user['id'])]);
    } catch (\Throwable $e) {
        error_log('[notification-preferences] route GET failed: ' . $e->getMessage());
        Response::json(['preferences' => NotificationPreferencesRepository::defaults()]);
    }
});

// PUT /api/v1/notification-preferences
// Body: any subset of { dm_push, event_message_push, event_join_push, new_event_push, ... }
$router->add('PUT', '/api/v1/notification-preferences', function () {
    $user = AuthService::requireAuth();
    $body = Request::json() ?? [];
    error_log('[notification-preferences] PUT user=' . $user['id'] . ' body=' . json_encode($body));
    try {
        $prefs = NotificationPreferencesRepository::upsert($user['id'], $body);
        Response::json(['preferences' => $prefs]);
    } catch (\Throwable $e) {
        error_log('[notification-preferences] route PUT failed: ' . get_class($e) . ': ' . $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine());
        Response::json(['error' => 'Failed to save preferences'], 500);
    }
});

// ── Web Push ──────────────────────────────────────────────────────────────────

// GET /api/v1/push/vapid-public-key
// Returns the VAPID public key so the frontend can subscribe.
// The public key is safe to expose — it is not secret.
$router->add('GET', '/api/v1/push/vapid-public-key', function () {
    $key = getenv('VAPID_PUBLIC_KEY') ?: null;
    if (!$key) {
        Response::json(['error' => 'Push not configured'], 503);
    }
    Response::json(['key' => $key]);
});

// POST /api/v1/push/subscribe
// Registers (or refreshes) a browser push subscription for the current user.
// Upserts on endpoint — safe to call on every login.
$router->add('POST', '/api/v1/push/subscribe', function () {
    $user = AuthService::requireAuth();
    $body = Request::json();

    $endpoint = trim((string) ($body['endpoint'] ?? ''));
    $p256dh   = trim((string) ($body['keys']['p256dh'] ?? ''));
    $auth     = trim((string) ($body['keys']['auth']   ?? ''));

    if (!$endpoint || !$p256dh || !$auth) {
        Response::json(['error' => 'endpoint, keys.p256dh and keys.auth are required'], 400);
    }

    // Remember the browser language so notifications (push + bell) are localized.
    $locale = strtolower(substr(trim((string) ($body['locale'] ?? '')), 0, 2));
    if (in_array($locale, ['en', 'fr', 'vi', 'es'], true)) {
        try {
            Database::pdo()->prepare("UPDATE users SET locale = ? WHERE id = ?")
                ->execute([$locale, $user['id']]);
        } catch (\Throwable $e) {
            error_log("[push-subscribe-web] locale update failed: " . $e->getMessage());
        }
    }

    Database::pdo()->prepare("
        INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth_key)
        VALUES (?, ?, ?, ?)
        ON CONFLICT (endpoint) DO UPDATE
           SET user_id      = EXCLUDED.user_id,
               p256dh       = EXCLUDED.p256dh,
               auth_key     = EXCLUDED.auth_key,
               last_used_at = now()
    ")->execute([$user['id'], $endpoint, $p256dh, $auth]);

    Response::json(['ok' => true]);
});

// DELETE /api/v1/push/unsubscribe
// Removes a push subscription (called on logout or when browser unsubscribes).
$router->add('DELETE', '/api/v1/push/unsubscribe', function () {
    $user = AuthService::requireAuth();
    $body = Request::json();

    $endpoint = trim((string) ($body['endpoint'] ?? ''));
    if (!$endpoint) {
        Response::json(['error' => 'endpoint is required'], 400);
    }

    Database::pdo()->prepare(
        "DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?"
    )->execute([$user['id'], $endpoint]);

    Response::json(['ok' => true]);
});

// ── Native (Expo) Push Tokens ─────────────────────────────────────────────────

// POST /api/v1/push/mobile-token
// Registers or refreshes an Expo push token for the current user's device.
// Safe to call on every login — upserts on token value.
// Body: { token: string, platform: 'android' | 'ios' }
$router->add('POST', '/api/v1/push/mobile-token', function () {
    // Log BEFORE requireAuth so we can detect 401 cases in logs.
    // If this line appears but "[push-subscribe] user=..." does not → auth failed.
    $rawCookie = $_COOKIE['hilads_token'] ?? '(none)';
    error_log("[push-subscribe] request received — cookie present: " . ($rawCookie !== '(none)' ? 'yes (' . strlen($rawCookie) . ' chars)' : 'NO'));

    $user  = AuthService::requireAuth();
    $body  = Request::json();

    $token    = trim((string) ($body['token']    ?? ''));
    $platform = trim((string) ($body['platform'] ?? 'unknown'));
    $locale   = strtolower(substr(trim((string) ($body['locale'] ?? '')), 0, 2));

    error_log("[push-subscribe] user={$user['id']} platform=$platform token=$token locale=$locale");

    // Remember the device language so notifications (push + bell) are localized.
    if (in_array($locale, ['en', 'fr', 'vi', 'es'], true)) {
        try {
            Database::pdo()->prepare("UPDATE users SET locale = ? WHERE id = ?")
                ->execute([$locale, $user['id']]);
        } catch (\Throwable $e) {
            error_log("[push-subscribe] locale update failed: " . $e->getMessage());
        }
    }

    if (!$token || !str_starts_with($token, 'ExponentPushToken[')) {
        error_log("[push-subscribe] REJECTED — invalid token format: '$token'");
        Response::json(['error' => 'Invalid Expo push token'], 400);
    }

    $allowed = ['android', 'ios', 'unknown'];
    if (!in_array($platform, $allowed, true)) $platform = 'unknown';

    try {
        $stmt = Database::pdo()->prepare("
            INSERT INTO mobile_push_tokens (user_id, token, platform)
            VALUES (?, ?, ?)
            ON CONFLICT (token) DO UPDATE
               SET user_id      = EXCLUDED.user_id,
                   platform     = EXCLUDED.platform,
                   last_used_at = now()
            RETURNING id
        ");
        $stmt->execute([$user['id'], $token, $platform]);
        $row = $stmt->fetch(\PDO::FETCH_ASSOC);
        error_log("[push-subscribe] upsert success for user={$user['id']} row_id=" . ($row['id'] ?? '?'));
    } catch (\Throwable $e) {
        error_log("[push-subscribe] DB ERROR for user={$user['id']}: " . $e->getMessage());
        Response::json(['error' => 'Failed to store push token: ' . $e->getMessage()], 500);
    }

    Response::json(['ok' => true]);
});

// DELETE /api/v1/push/mobile-token
// Removes the Expo push token for the current user's device (called on logout).
// Body: { token: string }
$router->add('DELETE', '/api/v1/push/mobile-token', function () {
    $user  = AuthService::requireAuth();
    $body  = Request::json();

    $token = trim((string) ($body['token'] ?? ''));
    if (!$token) {
        Response::json(['error' => 'token is required'], 400);
    }

    Database::pdo()->prepare(
        "DELETE FROM mobile_push_tokens WHERE user_id = ? AND token = ?"
    )->execute([$user['id'], $token]);

    Response::json(['ok' => true]);
});

// ══════════════════════════════════════════════════════════════════════════════
// TOPICS — city conversation subchannels
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/v1/channels/{channelId}/topics
// Returns active topics for a city, sorted by most-recent activity.
$router->add('GET', '/api/v1/channels/{channelId}/topics', function (array $params) {
    $channelId = filter_var($params['channelId'], FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);

    if ($channelId === false) {
        Response::json(['error' => 'Invalid channelId'], 400);
    }

    try {
        if (CityRepository::findById($channelId) === null) {
            Response::json(['error' => 'Channel not found'], 404);
        }

        $topics = TopicRepository::getByCity('city_' . $channelId);
        Response::json(['topics' => $topics]);
    } catch (\Throwable $e) {
        error_log('[topics] GET list failed ch=' . $channelId . ': ' . $e->getMessage());
        Response::json(['topics' => []], 200);
    }
});

// POST /api/v1/channels/{channelId}/topics
// Create a new topic. Auth optional — guests can create too.
$router->add('POST', '/api/v1/channels/{channelId}/topics', function (array $params) {
    $channelId = filter_var($params['channelId'], FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);

    if ($channelId === false) {
        Response::json(['error' => 'Invalid channelId'], 400);
    }

    if (CityRepository::findById($channelId) === null) {
        Response::json(['error' => 'Channel not found'], 404);
    }

    $body = Request::json();
    if ($body === null) {
        Response::json(['error' => 'Invalid JSON body'], 400);
    }

    $guestId     = $body['guestId']     ?? null;
    $title       = $body['title']       ?? null;
    $description = $body['description'] ?? null;
    $category    = $body['category']    ?? 'general';

    enforceRateLimit('topic_create', 3, 300, (string) $channelId);

    if (!isValidGuestId($guestId)) {
        Response::json(['error' => 'guestId is required'], 400);
    }

    if (empty($title) || !is_string($title)) {
        Response::json(['error' => 'title is required'], 400);
    }

    $title = mb_substr(trim(strip_tags($title)), 0, 80);
    if ($title === '') {
        Response::json(['error' => 'title must not be empty'], 400);
    }

    if (!in_array($category, TopicRepository::allowedCategories(), true)) {
        $category = 'general';
    }

    if ($description !== null) {
        $description = mb_substr(trim(strip_tags((string) $description)), 0, 200) ?: null;
    }

    $currentUser = AuthService::currentUser();
    $userId      = $currentUser['id'] ?? null;

    // One active hangout per user: you must have zero running hangouts to start
    // a new one (they auto-expire in 24h). Returns the existing one so the client
    // can route there. Guests can't create hangouts (gated client-side) so this
    // only applies to registered users. Legends (city ambassadors, "👑 Legend")
    // are exempt — they can run multiple hangouts at once.
    $isLegend = (bool) ($currentUser['_is_ambassador'] ?? false);
    if ($userId !== null && !$isLegend) {
        $existing = TopicRepository::findActiveByUser($userId);
        if ($existing !== null) {
            Response::json([
                'error'           => 'hangout_limit',
                'message'         => 'You already have an active hangout.',
                'existingTopicId' => $existing['id'],
                'existingTitle'   => $existing['title'],
            ], 409);
        }
    }

    // Hangouts have no address — capture the creator's coordinates (sent by the
    // client from the same location source that powers NOW distance) so the
    // hangout can show a distance. Optional: invalid/absent → no coords, no crash.
    $lat = null;
    $lng = null;
    if (isset($body['lat'], $body['lng']) && is_numeric($body['lat']) && is_numeric($body['lng'])) {
        $latF = (float) $body['lat'];
        $lngF = (float) $body['lng'];
        if ($latF >= -90 && $latF <= 90 && $lngF >= -180 && $lngF <= 180 && !($latF === 0.0 && $lngF === 0.0)) {
            $lat = $latF;
            $lng = $lngF;
        }
    }

    try {
        $topic = TopicRepository::create(
            'city_' . $channelId,
            $guestId,
            $title,
            $description,
            $category,
            $userId,
            24,        // default TTL hours
            $lat,
            $lng,
        );

        // Broadcast new topic to city room so clients append it instantly (no poll needed).
        try {
            broadcastNewTopicToWs($channelId, $topic);
        } catch (\Throwable $e) {
            error_log('[topics] ws broadcast failed (non-fatal): ' . $e->getMessage());
        }

        Response::json($topic, 201);
    } catch (\Throwable $e) {
        error_log('[topics] POST create failed ch=' . $channelId . ': ' . $e->getMessage());
        Response::json(['error' => 'Failed to create topic'], 500);
    }
});

// GET /api/v1/topics/{topicId}
// Single topic detail (includes message_count + last_activity_at).
$router->add('GET', '/api/v1/topics/{topicId}', function (array $params) {
    $topicId = $params['topicId'] ?? '';

    if (!preg_match('/^[a-f0-9]{16}$/', $topicId)) {
        Response::json(['error' => 'Invalid topicId'], 400);
    }

    $topic = TopicRepository::findById($topicId);
    if ($topic === null) {
        Response::json(['error' => 'Topic not found or expired'], 404);
    }

    // Resolve city info so the frontend can hydrate city context on deep link.
    // city_id is stored as 'city_N' — extract the integer part for CityRepository.
    $cityIntId = (int) substr($topic['city_id'], 5);
    $city = CityRepository::findById($cityIntId);
    Response::json([
        'topic'      => $topic,
        'channelId'  => $cityIntId,
        'cityName'   => $city['name'] ?? null,
        'country'    => $city['country'] ?? null,
        'timezone'   => $city['timezone'] ?? 'UTC',
    ]);
});

// GET /api/v1/topics/{topicId}/messages
// Chat messages for a topic — same shape as event messages.
$router->add('GET', '/api/v1/topics/{topicId}/messages', function (array $params) {
    $topicId = $params['topicId'] ?? '';

    if (!preg_match('/^[a-f0-9]{16}$/', $topicId)) {
        Response::json(['error' => 'Invalid topicId'], 400);
    }

    try {
        if (TopicRepository::findById($topicId) === null) {
            Response::json(['error' => 'Topic not found or expired'], 404);
        }

        // Members-only: hangouts are private. Only accepted participants (and the
        // creator, who is auto-joined) may read. A pending requester is NOT a
        // member → 403. Guests are never members. Do not leak message content.
        $viewer   = AuthService::currentUser();
        $viewerId = $viewer['id'] ?? null;
        if ($viewerId === null || !TopicRepository::isParticipant($topicId, $viewerId)) {
            // Tell the client whether this user already has a pending request, so
            // the gated screen shows "Requested" instead of "Request to join"
            // after they navigate away and back.
            Response::json([
                'error'               => 'not_a_member',
                'has_pending_request' => $viewerId !== null && TopicRepository::hasPendingRequest($topicId, $viewerId),
            ], 403);
        }

        // Cursor pagination (topics are channels → reuse getByChannel).
        $beforeId = isset($_GET['before_id']) && is_string($_GET['before_id']) ? trim($_GET['before_id']) : null;
        $limit    = min(100, max(1, (int) ($_GET['limit'] ?? 50)));
        $res = MessageRepository::getByChannel($topicId, $beforeId ?: null, $limit);
        Response::json(['messages' => $res['messages'], 'hasMore' => $res['hasMore']]);
    } catch (\Throwable $e) {
        error_log('[topic-messages] GET failed for topic ' . $topicId . ': ' . $e->getMessage());
        Response::json(['error' => 'Failed to load messages'], 500);
    }
});

// POST /api/v1/topics/{topicId}/messages
// Send a message to a topic. Reuses event-message logic.
$router->add('POST', '/api/v1/topics/{topicId}/messages', function (array $params) {
    $topicId = $params['topicId'] ?? '';

    if (!preg_match('/^[a-f0-9]{16}$/', $topicId)) {
        Response::json(['error' => 'Invalid topicId'], 400);
    }

    if (TopicRepository::findById($topicId) === null) {
        Response::json(['error' => 'Topic not found or expired'], 404);
    }

    // Members-only write gate: only accepted participants (and the auto-joined
    // creator) may post. A pending requester or non-member gets 403 — requesting
    // access does NOT grant it. Guests are never members.
    $senderUser   = AuthService::currentUser();
    $senderUserId = $senderUser['id'] ?? null;
    if ($senderUserId === null || !TopicRepository::isParticipant($topicId, $senderUserId)) {
        Response::json(['error' => 'not_a_member'], 403);
    }

    $body = Request::json();
    if ($body === null) {
        Response::json(['error' => 'Invalid JSON body'], 400);
    }

    $guestId  = $body['guestId']  ?? null;
    $nickname = $body['nickname'] ?? null;
    $content  = $body['content']  ?? null;
    $type     = $body['type']     ?? 'text';
    $imageUrl = $body['imageUrl'] ?? null;

    enforceRateLimit('topic_message', 45, 300, $topicId);

    if (!isValidGuestId($guestId)) {
        Response::json(['error' => 'guestId is required'], 400);
    }

    if (empty($nickname) || !is_string($nickname)) {
        Response::json(['error' => 'nickname is required'], 400);
    }

    $nickname = mb_substr(trim(strip_tags($nickname)), 0, 20);
    if ($nickname === '') {
        Response::json(['error' => 'nickname must not be empty'], 400);
    }

    if (!in_array($type, ['text', 'image'], true)) {
        Response::json(['error' => 'type must be text or image'], 400);
    }

    // $senderUser / $senderUserId already resolved above (membership gate).

    if ($type === 'image') {
        if (empty($imageUrl) || !is_string($imageUrl)) {
            Response::json(['error' => 'imageUrl is required for image messages'], 400);
        }

        $r2Base = rtrim(getenv('R2_PUBLIC_URL') ?: '', '/') . '/';
        if (!str_starts_with($imageUrl, $r2Base)) {
            Response::json(['error' => 'Invalid image URL'], 400);
        }

        $filename = basename(parse_url($imageUrl, PHP_URL_PATH) ?? '');
        if (!preg_match('/^[a-f0-9]{32}\.(jpg|png|webp)$/', $filename)) {
            Response::json(['error' => 'Invalid image reference'], 400);
        }

        try {
            $message = MessageRepository::addImage($topicId, $guestId, $nickname, $imageUrl, $senderUserId);
        } catch (\Throwable $e) {
            error_log("[topic-msg] DB error inserting image message topicId={$topicId}: " . $e->getMessage());
            Response::json(['error' => 'Failed to send message'], 500);
        }
    } else {
        if (empty($content) || !is_string($content)) {
            Response::json(['error' => 'content is required'], 400);
        }

        if (strlen($content) > 1000) {
            Response::json(['error' => 'content must not exceed 1000 characters'], 400);
        }

        try {
            $replySnap = resolveReplySnapshot($body['replyToMessageId'] ?? null);
            $mentions  = sanitizeMentions($body['mentions'] ?? null, 'topic', $topicId, $content);
            $message = MessageRepository::add(
                $topicId, $guestId, $nickname, $content, $senderUserId,
                $replySnap['id'] ?? null,
                $replySnap['nickname'] ?? null,
                $replySnap['content']  ?? null,
                $replySnap['type']     ?? 'text',
                $mentions
            );
        } catch (\Throwable $e) {
            error_log("[topic-msg] DB error inserting message topicId={$topicId}: " . $e->getMessage());
            Response::json(['error' => 'Failed to send message'], 500);
        }
    }

    $message = enrichBroadcastMessage($message, $senderUser ?? null);
    broadcastMessageToWs($topicId, $message);

    // Auto-subscribe registered sender + notify other subscribers.
    // Non-fatal: a notification failure must never prevent the message response.
    try {
        if ($senderUserId !== null) {
            TopicRepository::subscribe($topicId, $senderUserId);
        }
        $topicForNotif = TopicRepository::findById($topicId);
        $topicTitle    = is_array($topicForNotif) ? ($topicForNotif['title'] ?? 'topic') : 'topic';
        $bodyPreview   = $type === 'image' ? '📸 Sent an image' : mb_substr((string) ($content ?? ''), 0, 100);
        NotificationRepository::notifyTopicSubscribers(
            $topicId,
            $senderUserId,
            'topic_message',
            $nickname . ' in ' . $topicTitle,
            $bodyPreview,
            [
                'topicId'      => $topicId,
                'topicTitle'   => $topicTitle,
                'senderName'   => $nickname,
                'senderUserId' => $senderUserId,
            ]
        );
        if (!empty($mentions ?? [])) {
            notifyMentions(
                $mentions,
                $senderUserId,
                $nickname . ' mentioned you in ' . $topicTitle,
                $bodyPreview,
                ['topicId' => $topicId, 'topicTitle' => $topicTitle, 'messageId' => $message['id'], 'senderName' => $nickname, 'senderUserId' => $senderUserId]
            );
        }
    } catch (\Throwable $e) {
        error_log("[topic-msg] notification error topicId={$topicId}: " . get_class($e) . ': ' . $e->getMessage());
    }

    Response::json($message, 201);
});

// ── Hangout join-requests (request-to-join) ──────────────────────────────────
// Members only (guests are routed to signup client-side). A request notifies
// every participant + drops an Accept/Reject feed item; ANY participant can
// resolve it, and the FIRST write wins (resolveJoinRequest only matches a
// pending row, so concurrent taps can't double-resolve).
$router->add('POST', '/api/v1/topics/{topicId}/join-requests', function (array $params) {
    $topicId = $params['topicId'] ?? '';
    if (!preg_match('/^[a-f0-9]{16}$/', $topicId)) Response::json(['error' => 'Invalid topicId'], 400);

    $user = AuthService::requireAuth();   // members only
    $uid  = $user['id'];
    $name = $user['display_name'] ?? 'Someone';

    $topic = TopicRepository::findById($topicId);
    if ($topic === null) Response::json(['error' => 'Hangout not found or expired'], 404);

    enforceRateLimit('join_request', 10, 3600, $uid);

    $res = TopicRepository::createJoinRequest($topicId, $uid, $name);
    if (isset($res['error'])) {
        // Graceful no-ops, not failures: already in, duplicate pending, or cooldown.
        Response::json(['status' => $res['error']], $res['error'] === 'already_participant' ? 200 : 409);
    }
    $requestId = $res['id'];

    // Feed item — a persisted join_request message; content carries the payload
    // the clients render with Accept/Reject. Its id == the request id so the
    // resolve handler can update it in place.
    $payload = json_encode([
        'kind' => 'join_request', 'requestId' => $requestId,
        'requesterId' => $uid, 'requesterName' => $name,
        'status' => 'pending', 'resolvedByName' => null,
    ]);
    Database::pdo()->prepare("
        INSERT INTO messages (id, channel_id, type, user_id, nickname, content)
        VALUES (?, ?, 'join_request', ?, ?, ?)
    ")->execute([$requestId, $topicId, $uid, $name, $payload]);

    $message = ['id' => $requestId, 'type' => 'join_request', 'guestId' => null,
                'userId' => $uid, 'nickname' => $name, 'content' => $payload, 'createdAt' => time()];
    broadcastMessageToWs($topicId, $message);

    // Push every participant except the requester.
    try {
        $title = $topic['title'] ?? 'your hangout';
        foreach (TopicRepository::participantUserIds($topicId) as $pid) {
            if ($pid === $uid) continue;
            NotificationRepository::create(
                $pid, 'join_request', $name . ' wants to join',
                $name . ' asked to join ' . $title,
                ['topicId' => $topicId, 'topicTitle' => $title, 'requestId' => $requestId, 'requesterName' => $name],
            );
        }
    } catch (\Throwable $e) {
        error_log('[join-request] participant notify failed: ' . $e->getMessage());
    }

    Response::json(['status' => 'pending', 'requestId' => $requestId, 'message' => $message], 201);
});

$router->add('POST', '/api/v1/topics/{topicId}/join-requests/{requestId}/resolve', function (array $params) {
    $topicId   = $params['topicId']   ?? '';
    $requestId = $params['requestId'] ?? '';
    if (!preg_match('/^[a-f0-9]{16}$/', $topicId) || !preg_match('/^[a-f0-9]{16}$/', $requestId)) {
        Response::json(['error' => 'Invalid id'], 400);
    }

    $user = AuthService::requireAuth();
    $uid  = $user['id'];
    $name = $user['display_name'] ?? 'Someone';

    if (!TopicRepository::isParticipant($topicId, $uid)) {
        Response::json(['error' => 'Only participants can decide'], 403);
    }

    $body   = Request::json() ?? [];
    $action = in_array($body['action'] ?? '', ['accept', 'reject'], true) ? $body['action'] : null;
    if ($action === null) Response::json(['error' => 'action must be accept or reject'], 400);

    $resolved = TopicRepository::resolveJoinRequest($requestId, $topicId, $action, $uid, $name);
    if ($resolved === null) {
        // Someone already resolved it — first-write-wins. 409 the client swallows.
        Response::json(['status' => 'already_resolved'], 409);
    }

    // Update + re-broadcast the feed item so the CTAs resolve for everyone.
    $payload = json_encode([
        'kind' => 'join_request', 'requestId' => $requestId,
        'requesterId' => $resolved['requester_id'], 'requesterName' => $resolved['requester_name'],
        'status' => $resolved['status'], 'resolvedByName' => $name,
    ]);
    Database::pdo()->prepare("UPDATE messages SET content = ? WHERE id = ?")->execute([$payload, $requestId]);
    broadcastMessageToWs($topicId, [
        'id' => $requestId, 'type' => 'join_request', 'guestId' => null,
        'userId' => $resolved['requester_id'], 'nickname' => $resolved['requester_name'],
        'content' => $payload, 'createdAt' => time(), 'updated' => true,
    ]);

    // Accept → tell the requester (push). Reject → silent (no shaming).
    if ($resolved['status'] === 'accepted') {
        try {
            $title = TopicRepository::findById($topicId)['title'] ?? 'the hangout';
            NotificationRepository::create(
                $resolved['requester_id'], 'join_request_accepted',
                "You're in! 🎉", $name . ' added you to ' . $title,
                ['topicId' => $topicId, 'topicTitle' => $title, 'name' => $name],
            );
        } catch (\Throwable $e) {
            error_log('[join-request] accept notify failed: ' . $e->getMessage());
        }
    }

    Response::json(['status' => $resolved['status'], 'requestId' => $requestId, 'resolvedByName' => $name]);
});

// ── @mention autocomplete suggestions ───────────────────────────────────────
// Registered, in-context users only (guests excluded), prefix-matched on
// username, caller excluded, capped. One endpoint per context.
$router->add('GET', '/api/v1/channels/{channelId}/mention-suggestions', function (array $params) {
    enforceRateLimit('mention_suggest', 120, 60);
    $channelId = $params['channelId'] ?? '';
    if (!ctype_digit((string) $channelId)) Response::json(['error' => 'Invalid channelId'], 400);
    $viewer = AuthService::currentUser();
    Response::json(['suggestions' => MentionService::suggest('city', 'city_' . $channelId, (string) ($_GET['q'] ?? ''), $viewer['id'] ?? null)]);
});

$router->add('GET', '/api/v1/events/{eventId}/mention-suggestions', function (array $params) {
    enforceRateLimit('mention_suggest', 120, 60);
    $eventId = $params['eventId'] ?? '';
    if (!preg_match('/^[a-f0-9]{16}$/', $eventId)) Response::json(['error' => 'Invalid eventId'], 400);
    $viewer = AuthService::currentUser();
    Response::json(['suggestions' => MentionService::suggest('event', $eventId, (string) ($_GET['q'] ?? ''), $viewer['id'] ?? null)]);
});

$router->add('GET', '/api/v1/topics/{topicId}/mention-suggestions', function (array $params) {
    enforceRateLimit('mention_suggest', 120, 60);
    $topicId = $params['topicId'] ?? '';
    if (!preg_match('/^[a-f0-9]{16}$/', $topicId)) Response::json(['error' => 'Invalid topicId'], 400);
    $viewer = AuthService::currentUser();
    Response::json(['suggestions' => MentionService::suggest('topic', $topicId, (string) ($_GET['q'] ?? ''), $viewer['id'] ?? null)]);
});

$router->add('GET', '/api/v1/challenges/{challengeId}/mention-suggestions', function (array $params) {
    enforceRateLimit('mention_suggest', 120, 60);
    $challengeId = $params['challengeId'] ?? '';
    if (!preg_match('/^[a-f0-9]{16}$/', $challengeId)) Response::json(['error' => 'Invalid challengeId'], 400);
    $viewer = AuthService::currentUser();
    Response::json(['suggestions' => MentionService::suggest('challenge', $challengeId, (string) ($_GET['q'] ?? ''), $viewer['id'] ?? null)]);
});

// POST /api/v1/topics/{topicId}/mark-read
// Upserts an event_participants row (reuses same unread-tracking table) and sets last_read_at.
// Idempotent — safe to call on every topic open.
$router->add('POST', '/api/v1/topics/{topicId}/mark-read', function (array $params) {
    $user    = AuthService::requireAuth();
    $topicId = $params['topicId'] ?? '';

    if (!preg_match('/^[a-f0-9]{16}$/', $topicId)) {
        Response::json(['error' => 'Invalid topicId'], 400);
    }

    // Upsert participation row (created lazily — topic viewers don't explicitly join).
    Database::pdo()->prepare("
        INSERT INTO event_participants (channel_id, guest_id, user_id, last_read_at)
        VALUES (?, ?, ?, now())
        ON CONFLICT (channel_id, guest_id) DO UPDATE SET last_read_at = now()
    ")->execute([$topicId, $user['id'], $user['id']]);

    Response::json(['ok' => true]);
});

// DELETE /api/v1/topics/{topicId}
// Soft-deletes a topic. Only the creator can delete their own topic.
// GET /api/v1/topics/{topicId}/participants — members list for the avatar-row
// modal. Public (same names/avatars already shown in the card preview).
$router->add('GET', '/api/v1/topics/{topicId}/participants', function (array $params) {
    $topicId = $params['topicId'] ?? '';
    if (!preg_match('/^[a-f0-9]{16}$/', $topicId)) {
        Response::json(['error' => 'Invalid topicId'], 400);
    }
    Response::json([
        'participants' => TopicRepository::getParticipants($topicId),
        'count'        => TopicRepository::participantCount($topicId),
    ]);
});

// PUT /api/v1/topics/{topicId} — owner edits the hangout title/details.
$router->add('PUT', '/api/v1/topics/{topicId}', function (array $params) {
    $topicId = $params['topicId'] ?? '';
    if (!preg_match('/^[a-f0-9]{16}$/', $topicId)) {
        Response::json(['error' => 'Invalid topicId'], 400);
    }

    $body    = Request::json() ?? [];
    $guestId = $body['guestId'] ?? null;
    if (!isValidGuestId($guestId)) {
        Response::json(['error' => 'guestId is required'], 400);
    }

    $title = isset($body['title']) ? mb_substr(trim(strip_tags((string) $body['title'])), 0, 80) : '';
    if ($title === '') {
        Response::json(['error' => 'title is required'], 400);
    }
    $description = null;
    if (isset($body['description']) && $body['description'] !== null) {
        $description = mb_substr(trim(strip_tags((string) $body['description'])), 0, 200) ?: null;
    }
    $category = is_string($body['category'] ?? null) ? $body['category'] : 'general';

    $currentUser = AuthService::currentUser();
    $userId      = $currentUser['id'] ?? null;

    $updated = TopicRepository::update($topicId, $guestId, $userId, $title, $description, $category);
    if ($updated === null) {
        Response::json(['error' => 'Topic not found or not owned by you'], 404);
    }
    Response::json($updated);
});

$router->add('DELETE', '/api/v1/topics/{topicId}', function (array $params) {
    $topicId = $params['topicId'] ?? '';

    if (!preg_match('/^[a-f0-9]{16}$/', $topicId)) {
        Response::json(['error' => 'Invalid topicId'], 400);
    }

    $body    = Request::json() ?? [];
    $guestId = $body['guestId'] ?? null;

    if (!isValidGuestId($guestId)) {
        Response::json(['error' => 'guestId is required'], 400);
    }

    $currentUser = AuthService::currentUser();
    $userId      = $currentUser['id'] ?? null;

    $deleted = TopicRepository::delete($topicId, $guestId, $userId);

    if (!$deleted) {
        Response::json(['error' => 'Topic not found or not owned by you'], 404);
    }

    Response::json(['ok' => true]);
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/v1/channels/{channelId}/now
// Mixed feed: Hilads events (today + next 2 days) + active topics, sorted for
// liveness. Events happening now → topics by latest activity → upcoming events.
// ──────────────────────────────────────────────────────────────────────────────
$router->add('GET', '/api/v1/channels/{channelId}/now', function (array $params) {
    $startedAt = microtime(true);
    $channelId = filter_var($params['channelId'], FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);

    if ($channelId === false) {
        Response::json(['error' => 'Invalid channelId'], 400);
    }

    $guestId   = trim($_GET['guestId']   ?? '');
    $sessionId = trim($_GET['sessionId'] ?? '');
    $participantKey = isValidGuestId($guestId)    ? $guestId
                    : (isValidSessionId($sessionId) ? $sessionId
                    : null);

    try {
        $city = CityRepository::findById($channelId);
        if ($city === null) {
            Response::json(['error' => 'Channel not found'], 404);
        }

        $cityId   = 'city_' . $channelId;
        $timezone = $city['timezone'] ?? 'UTC';

        // One round-trip for both hilads + ticketmaster events (was two separate calls).
        // Recurring events are single canonical rows; getAllByChannel synthesizes
        // today's occurrence on-read. Uses SELECT_CITY + combined source_type IN (...).
        $t0       = microtime(true);
        $allEvs   = EventRepository::getAllByChannel($channelId, $participantKey, $city);
        $events   = $allEvs['hilads'];
        $publicEvents = $allEvs['ticketmaster'];
        $t1       = microtime(true);

        $topics   = TopicRepository::getByCity($cityId);
        $t2       = microtime(true);

        // Normalize each item into a consistent FeedItem DTO.
        $now   = time();
        $items = [];

        foreach ($events as $e) {
            $items[] = normalizeFeedEvent($e, $now);
        }
        foreach ($topics as $t) {
            $items[] = normalizeFeedTopic($t, $now);
        }

        // Sort: live events first, then all items by most-recent activity DESC.
        // "Live" = event happening right now (started, not yet expired).
        usort($items, function (array $a, array $b) use ($now): int {
            $aLive = $a['kind'] === 'event' && $a['active_now'];
            $bLive = $b['kind'] === 'event' && $b['active_now'];

            if ($aLive !== $bLive) return $aLive ? -1 : 1;

            // Both live events: chronological by start time
            if ($aLive && $bLive) return ($a['starts_at'] ?? 0) <=> ($b['starts_at'] ?? 0);

            // Everything else: most recently active first.
            // Events use created_at as proxy (no message activity).
            // Topics use last_activity_at (last reply timestamp).
            $aAct = $a['last_activity_at'] ?? $a['created_at'] ?? 0;
            $bAct = $b['last_activity_at'] ?? $b['created_at'] ?? 0;
            return $bAct <=> $aAct;
        });

        apiLog('now_feed', 'success', [
            'channelId'   => $channelId,
            'events'      => count($events),
            'publicEvents'=> count($publicEvents),
            'topics'      => count($topics),
            'elapsedMs'   => apiElapsedMs($startedAt),
            'phases_ms'   => [
                'events' => round(($t1 - $t0) * 1000, 1),
                'topics' => round(($t2 - $t1) * 1000, 1),
            ],
        ]);

        // Normalize public events and include in response so mobile avoids a second request.
        $publicEventItems = array_map(fn(array $e) => normalizeFeedEvent($e, $now), $publicEvents);

        Response::json(['items' => $items, 'publicEvents' => $publicEventItems]);
    } catch (\Throwable $e) {
        apiLog('now_feed', 'failure', [
            'channelId' => $channelId,
            'elapsedMs' => apiElapsedMs($startedAt),
            'error'     => get_class($e) . ': ' . $e->getMessage(),
        ]);
        Response::json(['items' => []], 200);
    }
});

// ── POST /api/v1/reports — submit a user report ──────────────────────────────
$router->add('POST', '/api/v1/reports', function () {
    $pdo     = Database::pdo();
    $body    = json_decode(file_get_contents('php://input'), true) ?? [];

    // Resolve reporter identity: registered user takes priority over guest.
    $viewer  = AuthService::currentUser();
    $reporterUserId  = $viewer['id'] ?? null;
    // Guests pass their guestId in the body (same pattern as messages/reactions).
    $reporterGuestId = ($reporterUserId === null)
        ? (isValidGuestId($body['guestId'] ?? null) ? $body['guestId'] : null)
        : null;

    if ($reporterUserId === null && $reporterGuestId === null) {
        Response::json(['error' => 'Identity required'], 401);
    }

    enforceRateLimit('user_report', 5, 3600);

    $reason         = trim($body['reason']          ?? '');
    $targetUserId   = $body['target_user_id']        ?? null;
    $targetGuestId  = $body['target_guest_id']       ?? null;
    $targetNickname = trim($body['target_nickname']  ?? '');

    if (strlen($reason) < 10) {
        Response::json(['error' => 'Reason must be at least 10 characters'], 422);
    }
    if (empty($targetUserId) && empty($targetGuestId)) {
        Response::json(['error' => 'Target identity required'], 422);
    }
    if (!empty($targetUserId) && $targetUserId === $reporterUserId) {
        Response::json(['error' => 'Cannot report yourself'], 422);
    }

    // Dup check: one report per (reporter, target) pair forever, across all statuses.
    $existing = findExistingUserReport(
        $pdo,
        $reporterUserId,
        $reporterGuestId,
        $targetUserId  ?: null,
        $targetGuestId ?: null
    );
    if ($existing) {
        Response::json([
            'error'           => 'already_reported',
            'message'         => 'You have already reported this user.',
            'existing_report' => $existing,
        ], 409);
    }

    try {
        $stmt = $pdo->prepare("
            INSERT INTO user_reports
                (reporter_user_id, reporter_guest_id,
                 target_user_id, target_guest_id, target_nickname, reason)
            VALUES (?, ?, ?, ?, ?, ?)
        ");
        $stmt->execute([
            $reporterUserId,
            $reporterGuestId,
            $targetUserId  ?: null,
            $targetGuestId ?: null,
            $targetNickname ?: null,
            $reason,
        ]);
    } catch (\PDOException $e) {
        // Race: another request for the same pair won the unique index first.
        if ((string) $e->getCode() === '23505') {
            $existing = findExistingUserReport(
                $pdo,
                $reporterUserId,
                $reporterGuestId,
                $targetUserId  ?: null,
                $targetGuestId ?: null
            );
            Response::json([
                'error'           => 'already_reported',
                'message'         => 'You have already reported this user.',
                'existing_report' => $existing,
            ], 409);
        }
        throw $e;
    }

    Response::json(['ok' => true], 201);
});

// ── GET /api/v1/reports/status — has the viewer already reported this target? ─
$router->add('GET', '/api/v1/reports/status', function () {
    $pdo = Database::pdo();

    $viewer          = AuthService::currentUser();
    $reporterUserId  = $viewer['id'] ?? null;
    $reporterGuestId = ($reporterUserId === null)
        ? (isValidGuestId($_GET['guestId'] ?? null) ? $_GET['guestId'] : null)
        : null;

    if ($reporterUserId === null && $reporterGuestId === null) {
        Response::json(['error' => 'Identity required'], 401);
    }

    $targetUserId  = $_GET['target_user_id']  ?? null;
    $targetGuestId = $_GET['target_guest_id'] ?? null;

    if (empty($targetUserId) && empty($targetGuestId)) {
        Response::json(['error' => 'Target identity required'], 422);
    }

    $existing = findExistingUserReport(
        $pdo,
        $reporterUserId,
        $reporterGuestId,
        $targetUserId  ?: null,
        $targetGuestId ?: null
    );

    Response::json($existing
        ? ['reported' => true, 'existing_report' => $existing]
        : ['reported' => false]
    );
});

/**
 * Look up an existing user_report for the given (reporter, target) pair.
 * Returns [id, created_at, status] or null. Queries all statuses — one per pair forever.
 */
function findExistingUserReport(
    PDO $pdo,
    ?string $reporterUserId,
    ?string $reporterGuestId,
    ?string $targetUserId,
    ?string $targetGuestId
): ?array {
    $stmt = $pdo->prepare("
        SELECT id, created_at, status
          FROM user_reports
         WHERE (
                 (:ruid::text IS NOT NULL AND reporter_user_id  = :ruid) OR
                 (:rgid::text IS NOT NULL AND reporter_guest_id = :rgid)
               )
           AND (
                 (:tuid::text IS NOT NULL AND target_user_id  = :tuid) OR
                 (:tgid::text IS NOT NULL AND target_guest_id = :tgid)
               )
         ORDER BY created_at ASC
         LIMIT 1
    ");
    $stmt->execute([
        ':ruid' => $reporterUserId,
        ':rgid' => $reporterGuestId,
        ':tuid' => $targetUserId,
        ':tgid' => $targetGuestId,
    ]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row) return null;
    return [
        'id'         => (int) $row['id'],
        'created_at' => $row['created_at'],
        'status'     => $row['status'],
    ];
}

// ── POST /api/v1/blocks — block a user or guest ──────────────────────────────
//
// Body: { target_user_id?, target_guest_id?, target_nickname?, reason?, guestId? }
// Either target_user_id or target_guest_id required. Viewer is the registered
// user (preferred) or a guest passing guestId in the body.
//
// Side effects when both sides are registered users:
//   - any pending friend_request between the pair is set to 'cancelled'
//   - any user_friends rows between the pair are deleted
//
// Idempotent: re-blocking returns the existing row with 200 instead of 201.
$router->add('POST', '/api/v1/blocks', function () {
    $pdo  = Database::pdo();
    $body = json_decode(file_get_contents('php://input'), true) ?? [];

    $viewer         = AuthService::currentUser();
    $blockerUserId  = $viewer['id'] ?? null;
    $blockerGuestId = ($blockerUserId === null)
        ? (isValidGuestId($body['guestId'] ?? null) ? $body['guestId'] : null)
        : null;

    if ($blockerUserId === null && $blockerGuestId === null) {
        Response::json(['error' => 'Identity required'], 401);
    }

    enforceRateLimit('user_block', 30, 3600);

    $targetUserId   = $body['target_user_id']        ?: null;
    $targetGuestId  = $body['target_guest_id']       ?: null;
    $targetNickname = trim($body['target_nickname']  ?? '') ?: null;
    $reason         = trim($body['reason']           ?? '') ?: null;

    if (empty($targetUserId) && empty($targetGuestId)) {
        Response::json(['error' => 'Target identity required'], 422);
    }
    if (!empty($targetUserId)  && $targetUserId  === $blockerUserId)  {
        Response::json(['error' => 'Cannot block yourself'], 422);
    }
    if (!empty($targetGuestId) && $targetGuestId === $blockerGuestId) {
        Response::json(['error' => 'Cannot block yourself'], 422);
    }

    // Idempotent: surface existing row instead of creating a duplicate.
    $existing       = BlockRepository::find($blockerUserId, $blockerGuestId, $targetUserId ?: null, $targetGuestId ?: null);
    $alreadyBlocked = $existing !== null;
    $row = $alreadyBlocked
        ? $existing
        : BlockRepository::create(
            $blockerUserId,
            $blockerGuestId,
            $targetUserId  ?: null,
            $targetGuestId ?: null,
            $targetNickname,
            $reason
        );

    // Side-effects only on FIRST block (skip on idempotent re-block).
    // Restricted to user×user blocks because friend_requests + user_friends
    // are registered-user-only relations.
    if (!$alreadyBlocked && $blockerUserId !== null && !empty($targetUserId)) {
        $pdo->prepare("
            UPDATE friend_requests
               SET status = 'cancelled', updated_at = now()
             WHERE status = 'pending'
               AND ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?))
        ")->execute([$blockerUserId, $targetUserId, $targetUserId, $blockerUserId]);

        $pdo->prepare("DELETE FROM user_friends WHERE user_id = ? AND friend_id = ?")
            ->execute([$blockerUserId, $targetUserId]);
        $pdo->prepare("DELETE FROM user_friends WHERE user_id = ? AND friend_id = ?")
            ->execute([$targetUserId, $blockerUserId]);

        // Tell the blocked user's other devices that the friendship is gone.
        // We do NOT signal the block itself — Apple's mutual-invisibility model
        // means the blocked party should just see the friendship vanish.
        broadcastUserEventToWs($targetUserId, 'friendRemoved', ['userId' => $blockerUserId]);
    }

    if ($blockerUserId !== null) {
        AnalyticsService::capture('user_blocked', $blockerUserId, [
            'target_user_id'  => $targetUserId,
            'target_guest_id' => $targetGuestId,
            'idempotent'      => $alreadyBlocked,
        ]);
    }

    Response::json(['block' => $row], $alreadyBlocked ? 200 : 201);
});

// ── DELETE /api/v1/blocks/{id} — unblock by row id ───────────────────────────
$router->add('DELETE', '/api/v1/blocks/{id}', function (array $params) {
    $body  = json_decode(file_get_contents('php://input'), true) ?? [];

    $viewer         = AuthService::currentUser();
    $blockerUserId  = $viewer['id'] ?? null;
    $blockerGuestId = ($blockerUserId === null)
        ? (isValidGuestId($body['guestId'] ?? $_GET['guestId'] ?? null)
            ? ($body['guestId'] ?? $_GET['guestId'])
            : null)
        : null;

    if ($blockerUserId === null && $blockerGuestId === null) {
        Response::json(['error' => 'Identity required'], 401);
    }

    $id = (int) ($params['id'] ?? 0);
    if ($id <= 0) {
        Response::json(['error' => 'Invalid block id'], 400);
    }

    $deleted = BlockRepository::deleteById($id, $blockerUserId, $blockerGuestId);
    if (!$deleted) {
        Response::json(['error' => 'Not found'], 404);
    }

    if ($blockerUserId !== null) {
        AnalyticsService::capture('user_unblocked', $blockerUserId, ['block_id' => $id]);
    }

    Response::json(['ok' => true]);
});

// ── DELETE /api/v1/blocks — unblock by target identity ───────────────────────
//
// Body OR query: { target_user_id?, target_guest_id?, guestId? }
// Used when the client has the target's identity but not the row id (e.g. the
// "re-block from the same screen" path or the unblock confirm modal).
$router->add('DELETE', '/api/v1/blocks', function () {
    $body = json_decode(file_get_contents('php://input'), true) ?? [];

    $viewer         = AuthService::currentUser();
    $blockerUserId  = $viewer['id'] ?? null;
    $blockerGuestId = ($blockerUserId === null)
        ? (isValidGuestId($body['guestId'] ?? $_GET['guestId'] ?? null)
            ? ($body['guestId'] ?? $_GET['guestId'])
            : null)
        : null;

    if ($blockerUserId === null && $blockerGuestId === null) {
        Response::json(['error' => 'Identity required'], 401);
    }

    $targetUserId  = $body['target_user_id']  ?? $_GET['target_user_id']  ?? null;
    $targetGuestId = $body['target_guest_id'] ?? $_GET['target_guest_id'] ?? null;

    if (empty($targetUserId) && empty($targetGuestId)) {
        Response::json(['error' => 'Target identity required'], 422);
    }

    $deleted = BlockRepository::deleteByTarget(
        $blockerUserId,
        $blockerGuestId,
        $targetUserId  ?: null,
        $targetGuestId ?: null
    );
    if (!$deleted) {
        Response::json(['error' => 'Not blocked'], 404);
    }

    if ($blockerUserId !== null) {
        AnalyticsService::capture('user_unblocked', $blockerUserId, [
            'target_user_id'  => $targetUserId,
            'target_guest_id' => $targetGuestId,
        ]);
    }

    Response::json(['ok' => true]);
});

// ── GET /api/v1/users/me/blocks — list of blocks I've made ───────────────────
//
// Auth required (registered users only). Powers the Settings → Blocked Users
// management screen. Returns each row joined with the blocked user's display
// name and avatar (or target_nickname for guest blocks).
$router->add('GET', '/api/v1/users/me/blocks', function () {
    $viewer = AuthService::requireAuth();
    $rows   = BlockRepository::listOutgoing($viewer['id'], null);
    Response::json(['blocks' => $rows]);
});

// ── POST /api/v1/users/me/eula — accept the EULA (Apple G1.2) ────────────────
//
// Used by the mobile re-prompt modal: existing registered users (created
// before the moderation update shipped) get a blocking modal on next launch
// when their /auth/me response shows eula_accepted_at == null. Idempotent —
// re-calling preserves the original acceptance moment.
$router->add('POST', '/api/v1/users/me/eula', function () {
    $viewer = AuthService::requireAuth();
    $user   = UserRepository::acceptEula($viewer['id']);
    AnalyticsService::capture('eula_accepted', $viewer['id'], [
        'first_time' => $viewer['eula_accepted_at'] === null,
    ]);
    Response::json(['user' => AuthService::ownFields($user)]);
});

// ── Challenges (Défis) ───────────────────────────────────────────────────────
// Third primary entity alongside events + hangouts. Created by a local or
// explorer in a city, accepted by others, and validated by the creator when
// done. See ChallengeRepository for the data model. URLs use the bare hex form
// server-side (slug-id is a client-only concern, like events).

// GET /api/v1/channels/{channelId}/challenges
// Active (status='open') challenges for a city, most-recent first.
// Optional ?limit query (capped at 200 in the repository).
$router->add('GET', '/api/v1/channels/{channelId}/challenges', function (array $params) {
    $channelId = filter_var($params['channelId'], FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    if ($channelId === false) {
        Response::json(['error' => 'Invalid channelId'], 400);
    }
    if (CityRepository::findById($channelId) === null) {
        Response::json(['error' => 'Channel not found'], 404);
    }

    $limit    = isset($_GET['limit']) ? (int) $_GET['limit'] : 50;
    $viewerId = AuthService::currentUser()['id'] ?? null;
    try {
        $challenges = ChallengeRepository::getByCity('city_' . $channelId, $limit, $viewerId);
        Response::json(['challenges' => $challenges]);
    } catch (\Throwable $e) {
        error_log('[challenges] GET list failed ch=' . $channelId . ': ' . $e->getMessage());
        Response::json(['challenges' => []], 200);
    }
});

// GET /api/v1/channels/{channelId}/challenges/validated
// Past (status='validated') challenges for a city — feeds the "See past
// challenges" CTA. Most-recently-validated first.
$router->add('GET', '/api/v1/channels/{channelId}/challenges/validated', function (array $params) {
    $channelId = filter_var($params['channelId'], FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    if ($channelId === false) {
        Response::json(['error' => 'Invalid channelId'], 400);
    }
    if (CityRepository::findById($channelId) === null) {
        Response::json(['error' => 'Channel not found'], 404);
    }

    $limit    = isset($_GET['limit'])  ? (int) $_GET['limit']  : 30;
    $beforeTs = isset($_GET['before']) ? (int) $_GET['before'] : null;
    $viewerId = AuthService::currentUser()['id'] ?? null;
    try {
        $challenges = ChallengeRepository::getValidatedByCity('city_' . $channelId, $limit, $beforeTs, $viewerId);
        Response::json(['challenges' => $challenges]);
    } catch (\Throwable $e) {
        error_log('[challenges] GET validated failed ch=' . $channelId . ': ' . $e->getMessage());
        Response::json(['challenges' => []], 200);
    }
});

// POST /api/v1/channels/{channelId}/challenges
// Create a new challenge. Requires a registered account — guests may browse,
// accept, and chat but cannot author challenges (same rule as events).
// Rate-limit: 5 challenges per hour per city (challenges are persistent, so
// stricter than topics' 3/5min but more lenient than events' 1/day).
$router->add('POST', '/api/v1/channels/{channelId}/challenges', function (array $params) {
    $channelId = filter_var($params['channelId'], FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    if ($channelId === false) {
        Response::json(['error' => 'Invalid channelId'], 400);
    }
    if (CityRepository::findById($channelId) === null) {
        Response::json(['error' => 'Channel not found'], 404);
    }

    $body = Request::json();
    if ($body === null) {
        Response::json(['error' => 'Invalid JSON body'], 400);
    }

    $guestId         = $body['guestId']         ?? null;
    $title           = $body['title']           ?? null;
    $challengeType   = $body['challengeType']   ?? $body['type']     ?? null;
    $audience        = $body['audience']        ?? null;
    $nickname        = $body['nickname']        ?? null;
    // `maxParticipants` may still arrive from older clients — accept it
    // silently but ignore (the model is 1:1 now; column stays at DB default).
    $returnClause    = $body['returnClause']    ?? null;
    // International mode (PR2 schema reads). Optional everywhere — older
    // clients omit them and we default mode to 'local'.
    $mode               = $body['mode']               ?? 'local';
    $targetChannelIdRaw = $body['targetCityChannelId'] ?? null;
    $proofRequirements  = $body['proofRequirements']   ?? null;
    // Visibility — older clients omit it; default 'public'. Only 'public' /
    // 'friends' accepted at create-time; 'private' is reachable only via
    // the mutual privacy_requests flow (PR #4) post-acceptance.
    $visibility         = $body['visibility']          ?? 'public';

    enforceRateLimit('challenge_create', 5, 3600, (string) $channelId);

    if (!isValidGuestId($guestId)) {
        Response::json(['error' => 'guestId is required'], 400);
    }
    if (empty($title) || !is_string($title)) {
        Response::json(['error' => 'title is required'], 400);
    }
    $title = mb_substr(trim(strip_tags($title)), 0, 100);
    if ($title === '') {
        Response::json(['error' => 'title must not be empty'], 400);
    }
    if (!in_array($challengeType, ChallengeRepository::allowedTypes(), true)) {
        Response::json(['error' => 'challengeType must be one of: ' . implode(', ', ChallengeRepository::allowedTypes())], 400);
    }
    if (!in_array($audience, ChallengeRepository::allowedAudiences(), true)) {
        Response::json(['error' => 'audience must be one of: ' . implode(', ', ChallengeRepository::allowedAudiences())], 400);
    }
    if (!in_array($mode, ChallengeRepository::ALLOWED_MODES, true)) {
        Response::json(['error' => 'mode must be one of: ' . implode(', ', ChallengeRepository::ALLOWED_MODES)], 400);
    }
    if (!in_array($visibility, ChallengeRepository::allowedVisibilitiesAtInput(), true)) {
        // 'private' explicitly excluded — the route surfaces a tailored message
        // so a future client doesn't waste cycles wondering why the flip fails.
        Response::json([
            'error' => "visibility must be 'public' or 'friends' at create-time; 'private' is reachable only via the mutual privacy flow",
            'code'  => 'visibility_invalid',
        ], 400);
    }
    if ($nickname !== null) {
        $nickname = mb_substr(trim(strip_tags((string) $nickname)), 0, 32) ?: null;
    }
    if ($returnClause !== null) {
        $returnClause = mb_substr(trim(strip_tags((string) $returnClause)), 0, 200);
    }
    if ($proofRequirements !== null) {
        $proofRequirements = mb_substr(trim(strip_tags((string) $proofRequirements)), 0, 300);
    }

    // Moderation gate — title + return clause + proof requirements all run
    // through the blocklist/regex check. First hit wins and the create is
    // refused with 422; we never leak the offending word so spammers don't
    // get a sneaky test loop. Server-side log captures the hit + field for
    // ops review.
    $modHit = ModerationService::checkBundle([
        'title'              => $title,
        'returnClause'       => $returnClause,
        'proofRequirements'  => $proofRequirements,
    ]);
    if ($modHit !== null) {
        error_log("[moderation] challenge create blocked field={$modHit['field']} reason={$modHit['reason']} hit={$modHit['hit']}");
        Response::json([
            'error' => 'Your text was flagged by moderation — please rephrase.',
            'code'  => 'moderation_blocked',
            'field' => $modHit['field'],
        ], 422);
    }

    // Resolve + validate target city channel for International mode. Client
    // sends the numeric channel id (matching the rest of the API surface);
    // we translate to the 'city_<id>' channels-row id stored on the row.
    // For Local, the field is ignored regardless of what's sent.
    $targetCityId = null;
    if ($mode === 'international' && $targetChannelIdRaw !== null && $targetChannelIdRaw !== '') {
        $tc = filter_var($targetChannelIdRaw, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
        if ($tc === false) {
            Response::json(['error' => 'targetCityChannelId must be a positive integer'], 400);
        }
        if (CityRepository::findById($tc) === null) {
            Response::json(['error' => 'targetCityChannelId references an unknown city'], 400);
        }
        $targetCityId = 'city_' . $tc;
    }

    // Registered account required — mirrors event creation. Guests get a
    // 401 here (the web SPA + mobile both gate this at the UI layer too,
    // so this is defense in depth).
    $authUser = AuthService::requireAuth();
    $userId   = $authUser['id'];

    try {
        $challenge = ChallengeRepository::create(
            'city_' . $channelId,
            $guestId,
            $userId,
            $nickname,
            $title,
            $challengeType,
            $audience,
            $returnClause,
            $mode,
            $targetCityId,
            $proofRequirements,
            $visibility,
        );

        try {
            // Enrich the WS payload with the creator's nickname — the
            // challenge row itself doesn't carry it (created_by / guest_id
            // only), but the city-feed pill on web + mobile needs it for
            // "{name} défie les locaux : {title}". Falls back to a generic
            // placeholder if the client didn't pass one (rare guest path).
            $wsPayload = array_merge($challenge, ['nickname' => $nickname ?? 'Someone']);
            broadcastNewChallengeToWs($channelId, $wsPayload);

            // International mirroring: when a target city is set, the SAME
            // challenge surfaces in the target city's chat feed + NOW feed.
            // Reuses the existing broadcast — clients in the target room
            // listen on the same event name and inject the feed pill.
            // "Anywhere" challenges (target_city_id IS NULL) intentionally
            // do NOT fan out: per spec, origin-only with a future Discover
            // surface picking them up later.
            if ($mode === 'international' && $targetCityId !== null) {
                $targetChannelInt = (int) str_replace('city_', '', $targetCityId);
                if ($targetChannelInt > 0) {
                    broadcastNewChallengeToWs($targetChannelInt, $wsPayload);
                }
            }
        } catch (\Throwable $e) {
            error_log('[challenges] ws broadcast failed (non-fatal): ' . $e->getMessage());
        }

        // ── Cross-city push fan-out (International with target_city_id) ─────
        // Notify users whose current_city_id matches the target city. Uses
        // NotificationRepository::notifyCityOnlineUsers which:
        //   - drops dormant accounts (no positive city signal in 30 days)
        //   - caps fan-out at CITY_PUSH_FANOUT_CAP per call
        //   - rate-limits per (recipient, city, type) — 10 min window so a
        //     re-create within minutes won't double-ping
        //   - localizes the title+body per recipient (NotificationI18n
        //     templates shipped in step 5)
        // Excludes the creator from their own push, and skipped entirely for
        // "anywhere" intl challenges (no target = no city to fan out to).
        try {
            if ($mode === 'international' && $targetCityId !== null) {
                // Origin city name (used by the {originCity} placeholder
                // in the localized push body). Lookup is cached in
                // CityRepository so this is cheap.
                $originCity = CityRepository::findById($channelId);
                $targetInt  = (int) str_replace('city_', '', $targetCityId);
                $targetCity = CityRepository::findById($targetInt);

                NotificationRepository::notifyCityOnlineUsers(
                    $targetCityId,
                    $userId, // exclude the creator
                    'challenge_international_target',
                    "🌐 New cross-city challenge",
                    'Someone in ' . ($originCity['name'] ?? 'another city')
                        . ' wants a taker in ' . ($targetCity['name'] ?? 'your city'),
                    [
                        'challengeId'     => $challenge['id'],
                        'challengeTitle' => $challenge['title'] ?? '',
                        'challengeType'  => $challengeType,
                        'mode'           => 'international',
                        // Both city placeholders for NotificationI18n templates.
                        'cityName'       => $targetCity['name']  ?? '',
                        'originCityName' => $originCity['name'] ?? '',
                    ],
                );
            }
        } catch (\Throwable $e) {
            error_log('[challenges] intl fan-out push failed (non-fatal): ' . $e->getMessage());
        }

        AnalyticsService::defer('created_challenge', $userId ?? $guestId, [
            'challenge_id'   => $challenge['id'],
            'challenge_type' => $challengeType,
            'audience'       => $audience,
            'mode'           => $mode,
            // Resolved visibility — `create()` may have overridden the input
            // ('public' forced on international), so analytics reflects the
            // post-write state, not the body.
            'visibility'     => $challenge['visibility'] ?? 'public',
            'target_city_id' => $targetCityId,
            'city_id'        => $channelId,
            'is_guest'       => $userId === null,
        ]);

        Response::json($challenge, 201);
    } catch (\Throwable $e) {
        error_log('[challenges] POST create failed ch=' . $channelId . ': ' . $e->getMessage());
        Response::json(['error' => 'Failed to create challenge'], 500);
    }
});

// GET /api/v1/challenges/{challengeId}
// Single challenge detail + city context for deep links.
$router->add('GET', '/api/v1/challenges/{challengeId}', function (array $params) {
    $challengeId = $params['challengeId'] ?? '';
    if (!preg_match('/^[a-f0-9]{16}$/', $challengeId)) {
        Response::json(['error' => 'Invalid challengeId'], 400);
    }

    // Visibility-aware: returns null when the viewer isn't entitled to see
    // this challenge (anon viewing a friends/private row, non-friend
    // viewing a friends row, third party viewing a private row). 404 is
    // the right surface — "doesn't exist" from the caller's POV.
    $viewerId  = AuthService::currentUser()['id'] ?? null;
    $challenge = ChallengeRepository::findById($challengeId, $viewerId);
    if ($challenge === null) {
        Response::json(['error' => 'Challenge not found'], 404);
    }

    $cityIntId = (int) substr($challenge['city_id'], 5);
    $city      = CityRepository::findById($cityIntId);

    // For International challenges with a target_city_id, also return the
    // target city's display info — used by the SSR prerender for the
    // dual-city meta title ("Paris → Tokyo · …") and the JSON-LD
    // recipientLocation node.
    $targetCity = null;
    if (!empty($challenge['target_city_id'])) {
        $targetIntId = (int) substr($challenge['target_city_id'], 5);
        $targetCity  = CityRepository::findById($targetIntId);
    }

    Response::json([
        'challenge'      => $challenge,
        'channelId'      => $cityIntId,
        'cityName'       => $city['name']     ?? null,
        'country'        => $city['country']  ?? null,
        'timezone'       => $city['timezone'] ?? 'UTC',
        'targetCityName' => $targetCity['name']    ?? null,
        'targetCountry'  => $targetCity['country'] ?? null,
    ]);
});

// PUT /api/v1/challenges/{challengeId}
// Owner-gated edit of title / type / audience. Status is NOT editable here —
// use POST /validate to flip open → validated.
$router->add('PUT', '/api/v1/challenges/{challengeId}', function (array $params) {
    $challengeId = $params['challengeId'] ?? '';
    if (!preg_match('/^[a-f0-9]{16}$/', $challengeId)) {
        Response::json(['error' => 'Invalid challengeId'], 400);
    }

    $body = Request::json();
    if ($body === null) {
        Response::json(['error' => 'Invalid JSON body'], 400);
    }

    $guestId         = $body['guestId']         ?? null;
    $title           = $body['title']           ?? null;
    $challengeType   = $body['challengeType']   ?? $body['type'] ?? null;
    $audience        = $body['audience']        ?? null;
    // `maxParticipants` silently accepted but ignored (1:1 model).
    $returnClause    = $body['returnClause']    ?? null;
    // International edit-time fields. The repo ignores them on local rows
    // (resolved from the DB row's mode). target_city_id can be re-targeted;
    // proof requirements can be revised. Mode itself is NOT editable here.
    $targetChannelIdRaw = $body['targetCityChannelId'] ?? null;
    $proofRequirements  = $body['proofRequirements']   ?? null;
    // Visibility — optional on edit. null = "don't change". Only 'public'
    // and 'friends' accepted; 'private' is reachable only via the mutual
    // privacy_requests flow. The repo also forces 'public' on International.
    $visibilityRaw      = $body['visibility']          ?? null;

    if (!isValidGuestId($guestId)) {
        Response::json(['error' => 'guestId is required'], 400);
    }
    if (empty($title) || !is_string($title)) {
        Response::json(['error' => 'title is required'], 400);
    }
    $title = mb_substr(trim(strip_tags($title)), 0, 100);
    if ($title === '') {
        Response::json(['error' => 'title must not be empty'], 400);
    }
    if (!in_array($challengeType, ChallengeRepository::allowedTypes(), true)) {
        Response::json(['error' => 'challengeType invalid'], 400);
    }
    if (!in_array($audience, ChallengeRepository::allowedAudiences(), true)) {
        Response::json(['error' => 'audience invalid'], 400);
    }
    if ($returnClause !== null) {
        $returnClause = mb_substr(trim(strip_tags((string) $returnClause)), 0, 200);
    }
    if ($proofRequirements !== null) {
        $proofRequirements = mb_substr(trim(strip_tags((string) $proofRequirements)), 0, 300);
    }
    if ($visibilityRaw !== null && !in_array($visibilityRaw, ChallengeRepository::allowedVisibilitiesAtInput(), true)) {
        // Mirror the POST error so an admin tool wiring up edit knows why
        // a 'private' attempt fails.
        Response::json([
            'error' => "visibility must be 'public' or 'friends' on edit; 'private' is reachable only via the mutual privacy flow",
            'code'  => 'visibility_invalid',
        ], 400);
    }

    // Moderation gate — same shape as the create path.
    $modHitEdit = ModerationService::checkBundle([
        'title'              => $title,
        'returnClause'       => $returnClause,
        'proofRequirements'  => $proofRequirements,
    ]);
    if ($modHitEdit !== null) {
        error_log("[moderation] challenge edit blocked challengeId={$challengeId} field={$modHitEdit['field']} reason={$modHitEdit['reason']} hit={$modHitEdit['hit']}");
        Response::json([
            'error' => 'Your text was flagged by moderation — please rephrase.',
            'code'  => 'moderation_blocked',
            'field' => $modHitEdit['field'],
        ], 422);
    }

    // Optional target-city change. Validated only if the row is actually
    // international (the repo will ignore the field for local rows). We
    // can't see the row's mode here without an extra read; validate the
    // format anyway so a bad client value 400s rather than silently
    // bypasses on local.
    $targetCityId = null;
    if ($targetChannelIdRaw !== null && $targetChannelIdRaw !== '') {
        $tc = filter_var($targetChannelIdRaw, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
        if ($tc === false) {
            Response::json(['error' => 'targetCityChannelId must be a positive integer'], 400);
        }
        if (CityRepository::findById($tc) === null) {
            Response::json(['error' => 'targetCityChannelId references an unknown city'], 400);
        }
        $targetCityId = 'city_' . $tc;
    }

    $userId  = AuthService::currentUser()['id'] ?? null;
    $updated = ChallengeRepository::update(
        $challengeId, $guestId, $userId,
        $title, $challengeType, $audience,
        $returnClause,
        $targetCityId,
        $proofRequirements,
        $visibilityRaw,
    );
    if ($updated === null) {
        Response::json(['error' => 'Challenge not found or you are not the creator'], 403);
    }

    Response::json($updated);
});

// DELETE /api/v1/challenges/{challengeId}
// Owner-gated soft-delete (channels.status='deleted').
$router->add('DELETE', '/api/v1/challenges/{challengeId}', function (array $params) {
    $challengeId = $params['challengeId'] ?? '';
    if (!preg_match('/^[a-f0-9]{16}$/', $challengeId)) {
        Response::json(['error' => 'Invalid challengeId'], 400);
    }

    $body    = Request::json();
    $guestId = $body['guestId'] ?? null;
    if (!isValidGuestId($guestId)) {
        Response::json(['error' => 'guestId is required'], 400);
    }

    $userId  = AuthService::currentUser()['id'] ?? null;
    $deleted = ChallengeRepository::delete($challengeId, $guestId, $userId);
    if (!$deleted) {
        Response::json(['error' => 'Challenge not found or you are not the creator'], 403);
    }

    Response::json(['ok' => true]);
});

// POST /api/v1/challenges/{challengeId}/validate
// Creator flips status: 'open' → 'validated'. Idempotent. Fans out a push
// notification to every other registered participant ("X validated the
// challenge"). Broadcasts a city-room WS event so live feeds drop the bubble
// from the active list without a refetch.
$router->add('POST', '/api/v1/challenges/{challengeId}/validate', function (array $params) {
    $challengeId = $params['challengeId'] ?? '';
    if (!preg_match('/^[a-f0-9]{16}$/', $challengeId)) {
        Response::json(['error' => 'Invalid challengeId'], 400);
    }

    $body    = Request::json();
    $guestId = $body['guestId'] ?? null;
    if (!isValidGuestId($guestId)) {
        Response::json(['error' => 'guestId is required'], 400);
    }

    $currentUser = AuthService::currentUser();
    $userId      = $currentUser['id'] ?? null;
    $updated     = ChallengeRepository::validate($challengeId, $guestId, $userId);
    if ($updated === null) {
        Response::json(['error' => 'Challenge not found or you are not the creator'], 403);
    }

    // Fan-out notification to participants (creator excluded).
    try {
        $creatorName = $currentUser['display_name'] ?? 'Someone';
        NotificationRepository::notifyChallengeParticipants(
            $challengeId,
            $userId,                  // exclude the creator
            'challenge_validated',
            "🎉 Challenge validated",
            "{$creatorName} validated \"{$updated['title']}\"",
            [
                'challengeId' => $challengeId,
                'senderUserId' => $userId,
                'senderName'  => $creatorName,
                'title'       => $updated['title'],
            ],
        );
    } catch (\Throwable $e) {
        error_log('[challenges] validate notif fanout failed (non-fatal): ' . $e->getMessage());
    }

    // Live update so the feed flips the badge without a refetch + injects
    // a "Challenge done!" pill into the city chat. Enriched with the
    // creator's display name (same fallback as the create broadcast).
    try {
        $cityIntId = (int) substr($updated['city_id'], 5);
        broadcastChallengeValidatedToWs(
            $cityIntId,
            array_merge($updated, ['nickname' => $creatorName ?? 'Someone']),
        );
    } catch (\Throwable $e) {
        error_log('[challenges] ws validate broadcast failed (non-fatal): ' . $e->getMessage());
    }

    AnalyticsService::defer('validated_challenge', $userId ?? $guestId, [
        'challenge_id' => $challengeId,
    ]);

    Response::json($updated);
});

// POST /api/v1/challenges/{challengeId}/unvalidate
// Creator flips status back: 'validated' → 'open'. Used when they tapped the
// status CTA by mistake. No notifications (silent undo). Broadcasts the WS
// event so live feeds + open detail screens flip back without a refetch.
$router->add('POST', '/api/v1/challenges/{challengeId}/unvalidate', function (array $params) {
    $challengeId = $params['challengeId'] ?? '';
    if (!preg_match('/^[a-f0-9]{16}$/', $challengeId)) {
        Response::json(['error' => 'Invalid challengeId'], 400);
    }

    $body    = Request::json();
    $guestId = $body['guestId'] ?? null;
    if (!isValidGuestId($guestId)) {
        Response::json(['error' => 'guestId is required'], 400);
    }

    $currentUser = AuthService::currentUser();
    $userId      = $currentUser['id'] ?? null;
    $updated     = ChallengeRepository::unvalidate($challengeId, $guestId, $userId);
    if ($updated === null) {
        Response::json(['error' => 'Challenge not found or you are not the creator'], 403);
    }

    try {
        $cityIntId = (int) substr($updated['city_id'], 5);
        broadcastChallengeUnvalidatedToWs(
            $cityIntId,
            array_merge($updated, ['nickname' => $currentUser['display_name'] ?? 'Someone']),
        );
    } catch (\Throwable $e) {
        error_log('[challenges] ws unvalidate broadcast failed (non-fatal): ' . $e->getMessage());
    }

    Response::json($updated);
});

// POST /api/v1/challenges/{challengeId}/participants/toggle
// LEGACY toggle for the existing mobile build. Routes through the new
// ChallengeParticipantRepository so the kick + closed_to_new_joins gates
// can't be bypassed. New web/mobile builds use /join + DELETE /participants/me.
$router->add('POST', '/api/v1/challenges/{challengeId}/participants/toggle', function (array $params) {
    $challengeId = $params['challengeId'] ?? '';
    if (!preg_match('/^[a-f0-9]{16}$/', $challengeId)) {
        Response::json(['error' => 'Invalid challengeId'], 400);
    }
    $authUser  = AuthService::requireAuth();
    $userId    = $authUser['id'];

    // Visibility-aware: anon hitting a friends/private challenge URL gets
    // 404, same surface as the read path.
    $challenge = ChallengeRepository::findById($challengeId, $userId);
    if ($challenge === null) {
        Response::json(['error' => 'Challenge not found'], 404);
    }

    enforceRateLimit('challenge_participant_toggle', 60, 300, $challengeId);

    $alreadyIn = ChallengeParticipantRepository::isParticipant($challengeId, $userId);
    if ($alreadyIn) {
        ChallengeParticipantRepository::leave($challengeId, $userId);
        $isIn = false;
    } else {
        if (ChallengeParticipantRepository::isKicked($challengeId, $userId)) {
            Response::json(['error' => "You can't join — you've been removed from this challenge.", 'code' => 'kicked'], 403);
        }
        if (!empty($challenge['closed_to_new_joins'])) {
            Response::json(['error' => 'This challenge is closed to new joins.', 'code' => 'closed_to_new_joins'], 403);
        }
        ChallengeParticipantRepository::join($challengeId, $userId);
        $isIn = true;
    }
    $count = ChallengeParticipantRepository::countForChannel($challengeId);

    if ($isIn) {
        AnalyticsService::defer('joined_challenge', $userId, ['challenge_id' => $challengeId]);
    }

    Response::json(['count' => $count, 'isIn' => $isIn]);
});

// POST /api/v1/challenges/{challengeId}/join
// Explicit join — instant, registered-only, idempotent. Refused on kick,
// closed_to_new_joins, or visibility scope (the read gate catches the latter
// via findById). Returns the updated count + isIn=true so the client can
// flip to the participant view in one round-trip.
$router->add('POST', '/api/v1/challenges/{challengeId}/join', function (array $params) {
    $challengeId = $params['challengeId'] ?? '';
    if (!preg_match('/^[a-f0-9]{16}$/', $challengeId)) {
        Response::json(['error' => 'Invalid challengeId'], 400);
    }
    $authUser = AuthService::requireAuth();
    $userId   = $authUser['id'];

    $challenge = ChallengeRepository::findById($challengeId, $userId);
    if ($challenge === null) {
        Response::json(['error' => 'Challenge not found'], 404);
    }
    if (ChallengeParticipantRepository::isKicked($challengeId, $userId)) {
        Response::json(['error' => "You can't join — you've been removed from this challenge.", 'code' => 'kicked'], 403);
    }
    if (!empty($challenge['closed_to_new_joins'])) {
        Response::json(['error' => 'This challenge is closed to new joins.', 'code' => 'closed_to_new_joins'], 403);
    }
    enforceRateLimit('challenge_join', 30, 300, $challengeId);

    ChallengeParticipantRepository::join($challengeId, $userId);
    $count = ChallengeParticipantRepository::countForChannel($challengeId);
    AnalyticsService::defer('joined_challenge', $userId, ['challenge_id' => $challengeId]);

    Response::json(['count' => $count, 'isIn' => true]);
});

// DELETE /api/v1/challenges/{challengeId}/participants/me
// Caller leaves the channel. No notifications, no penalty. The creator
// can't "leave" their own challenge — they delete it instead, which is a
// different endpoint.
$router->add('DELETE', '/api/v1/challenges/{challengeId}/participants/me', function (array $params) {
    $challengeId = $params['challengeId'] ?? '';
    if (!preg_match('/^[a-f0-9]{16}$/', $challengeId)) {
        Response::json(['error' => 'Invalid challengeId'], 400);
    }
    $authUser = AuthService::requireAuth();
    $userId   = $authUser['id'];

    $challenge = ChallengeRepository::findByIdUnchecked($challengeId);
    if ($challenge === null) {
        Response::json(['error' => 'Challenge not found'], 404);
    }
    if (($challenge['created_by'] ?? null) === $userId) {
        Response::json([
            'error' => "You're the creator — delete the challenge instead of leaving.",
            'code'  => 'cant_leave_own_challenge',
        ], 422);
    }

    $removed = ChallengeParticipantRepository::leave($challengeId, $userId);
    $count   = ChallengeParticipantRepository::countForChannel($challengeId);
    Response::json(['ok' => true, 'isIn' => false, 'removed' => $removed, 'count' => $count]);
});

// POST /api/v1/challenges/{challengeId}/participants/{userId}/kick
// Remove a participant + ban re-join. Creator OR active acceptor only.
// Creator can never be kicked (the repo refuses). Optional { reason } in
// body — server-side log only, not surfaced to the kicked user beyond a
// generic "removed" notification.
$router->add('POST', '/api/v1/challenges/{challengeId}/participants/{userId}/kick', function (array $params) {
    $challengeId = $params['challengeId'] ?? '';
    $targetId    = $params['userId']      ?? '';
    if (!preg_match('/^[a-f0-9]{16}$/', $challengeId)) {
        Response::json(['error' => 'Invalid challengeId'], 400);
    }
    if (!preg_match('/^[a-f0-9]{32}$/', $targetId)) {
        Response::json(['error' => 'Invalid userId'], 400);
    }
    $authUser  = AuthService::requireAuth();
    $callerId  = $authUser['id'];

    $challenge = ChallengeRepository::findByIdUnchecked($challengeId);
    if ($challenge === null) {
        Response::json(['error' => 'Challenge not found'], 404);
    }

    // Authority: creator OR active (non-rejected) acceptor.
    $isCreator   = ($challenge['created_by'] ?? null) === $callerId;
    $acceptance  = ChallengeAcceptanceRepository::findExisting($challengeId, $callerId);
    $isActiveTaker = $acceptance !== null && ($acceptance['phase'] ?? null) !== 'rejected';
    if (!$isCreator && !$isActiveTaker) {
        Response::json(['error' => 'Creator or current taker only.', 'code' => 'not_authorized'], 403);
    }
    if ($targetId === $callerId) {
        Response::json(['error' => "You can't kick yourself — leave instead.", 'code' => 'cant_kick_self'], 422);
    }

    $body   = Request::json();
    $reason = is_array($body) && isset($body['reason']) && is_string($body['reason'])
        ? mb_substr(trim($body['reason']), 0, 200) : null;

    $ok = ChallengeParticipantRepository::kick($challengeId, $targetId, $callerId, $reason ?: null);
    if (!$ok) {
        Response::json(['error' => "Can't kick the creator.", 'code' => 'cant_kick_creator'], 422);
    }

    error_log("[challenges] kick challenge={$challengeId} target={$targetId} by={$callerId} reason=" . ($reason ?? '-'));
    Response::json(['ok' => true]);
});

// POST /api/v1/challenges/{challengeId}/visibility
// Creator-only flip between 'public' and 'friends'. 'private' is NOT
// reachable here — that's the mutual go-private flow (kept in the
// privacy_requests endpoints) and refusing here keeps the simple pill
// inline on the detail page from gaining hidden states. International
// rows are forced 'public' regardless (the repo's setVisibility refuses
// to write a non-public value on mode='international').
$router->add('POST', '/api/v1/challenges/{challengeId}/visibility', function (array $params) {
    $challengeId = $params['challengeId'] ?? '';
    if (!preg_match('/^[a-f0-9]{16}$/', $challengeId)) {
        Response::json(['error' => 'Invalid challengeId'], 400);
    }
    $authUser  = AuthService::requireAuth();
    $userId    = $authUser['id'];
    $challenge = ChallengeRepository::findByIdUnchecked($challengeId);
    if ($challenge === null) {
        Response::json(['error' => 'Challenge not found'], 404);
    }
    if (($challenge['created_by'] ?? null) !== $userId) {
        Response::json(['error' => 'Creator-only', 'code' => 'not_creator'], 403);
    }
    if (($challenge['mode'] ?? 'local') === 'international') {
        Response::json(['error' => 'International challenges are always public', 'code' => 'intl_locked'], 422);
    }

    $body = Request::json();
    $viz  = is_array($body) ? ($body['visibility'] ?? null) : null;
    if (!in_array($viz, ['public', 'friends'], true)) {
        Response::json([
            'error' => "visibility must be 'public' or 'friends'",
            'code'  => 'invalid_visibility',
        ], 400);
    }
    ChallengeRepository::setVisibility($challengeId, $viz);
    Response::json(['ok' => true, 'visibility' => $viz]);
});

// POST /api/v1/challenges/{challengeId}/close-to-new-joins
// Creator-only toggle. Body { closed: bool } — when true, /join refuses
// new participants. Existing participants stay.
$router->add('POST', '/api/v1/challenges/{challengeId}/close-to-new-joins', function (array $params) {
    $challengeId = $params['challengeId'] ?? '';
    if (!preg_match('/^[a-f0-9]{16}$/', $challengeId)) {
        Response::json(['error' => 'Invalid challengeId'], 400);
    }
    $authUser  = AuthService::requireAuth();
    $userId    = $authUser['id'];
    $challenge = ChallengeRepository::findByIdUnchecked($challengeId);
    if ($challenge === null) {
        Response::json(['error' => 'Challenge not found'], 404);
    }
    if (($challenge['created_by'] ?? null) !== $userId) {
        Response::json(['error' => 'Creator-only', 'code' => 'not_creator'], 403);
    }

    $body   = Request::json();
    $closed = is_array($body) ? (bool) ($body['closed'] ?? true) : true;

    Database::pdo()->prepare("
        UPDATE channel_challenges SET closed_to_new_joins = ?, updated_at = now()
        WHERE channel_id = ?
    ")->execute([$closed ? 1 : 0, $challengeId]);

    Response::json(['ok' => true, 'closed_to_new_joins' => $closed]);
});

// POST /api/v1/challenges/{challengeId}/notification-preference
// Per-participant preference: 'milestones' (default), 'all', or 'off'.
// Caller must be a participant (the row to update exists for them).
$router->add('POST', '/api/v1/challenges/{challengeId}/notification-preference', function (array $params) {
    $challengeId = $params['challengeId'] ?? '';
    if (!preg_match('/^[a-f0-9]{16}$/', $challengeId)) {
        Response::json(['error' => 'Invalid challengeId'], 400);
    }
    $authUser = AuthService::requireAuth();
    $userId   = $authUser['id'];

    $body = Request::json();
    $pref = is_array($body) ? ($body['preference'] ?? null) : null;
    if (!in_array($pref, ChallengeParticipantRepository::ALLOWED_NOTIFICATION_PREFERENCES, true)) {
        Response::json([
            'error' => "preference must be one of: " . implode(', ', ChallengeParticipantRepository::ALLOWED_NOTIFICATION_PREFERENCES),
            'code'  => 'invalid_preference',
        ], 400);
    }
    $ok = ChallengeParticipantRepository::setNotificationPreference($challengeId, $userId, $pref);
    if (!$ok) {
        Response::json(['error' => 'Not a participant — join the challenge first.', 'code' => 'not_participant'], 403);
    }
    Response::json(['ok' => true, 'preference' => $pref]);
});

// GET /api/v1/challenges/{challengeId}/participants/me
// Cheap "am I in?" probe used by the detail page to decide whether to render
// the public hero or the participant chat. Returns the caller's
// participant + notification state.
$router->add('GET', '/api/v1/challenges/{challengeId}/participants/me', function (array $params) {
    $challengeId = $params['challengeId'] ?? '';
    if (!preg_match('/^[a-f0-9]{16}$/', $challengeId)) {
        Response::json(['error' => 'Invalid challengeId'], 400);
    }
    $userId = AuthService::currentUser()['id'] ?? null;
    if ($userId === null) {
        Response::json(['isIn' => false, 'reason' => 'anon']);
    }
    $isIn = ChallengeParticipantRepository::isParticipant($challengeId, $userId);
    Response::json([
        'isIn'                 => $isIn,
        'isKicked'             => ChallengeParticipantRepository::isKicked($challengeId, $userId),
        'notificationPreference' => $isIn
            ? ChallengeParticipantRepository::getNotificationPreference($challengeId, $userId)
            : null,
    ]);
});

// ── Challenge ratings (PR6 — mutual rating + scoring) ─────────────────────────
// Scope: Local challenges only. International challenges keep their existing
// proof → creator-verdict flow (ChallengeProofBlock + /submit-proof, /approve,
// /reject) untouched. The rating endpoints below 422-out on mode='international'.
//
// All scoring + the phase='approved' flip are handled by the DB trigger
// trg_chrate_mutual_complete (see migrate.php:1524). PHP NEVER computes points.
//
// Mutual-reveal: a rating about the caller is exposed via the visible_ratings
// view only once BOTH parties have rated. /of-me returns { revealed: false }
// until that happens — the UI can show "waiting for X to rate".

// POST /api/v1/challenges/{challengeId}/ratings
// Body: { stars: 1..5, comment?: string<=500 }
//
// Resolves caller's role: challenger if cc.created_by, taker if the active
// (non-rejected) acceptor. Other party = ratee. Inserts one challenge_ratings
// row. UNIQUE(challenge_id, rater_id) → 409 on second submit from same user.
//
// Rate-eligibility (Local only): there must be a non-rejected acceptance for
// this challenge whose effective_phase is 'debrief' (meetup ended) or
// 'approved' (legacy verdict already fired, or the trigger has — but a second
// distinct rater still slots in). Otherwise 403 with code='not_rate_eligible'.
//
// Returns { rating, revealed } — revealed=true when this insert was the
// second rating (so the trigger just fired). Lets the client refetch /of-me
// in the same tick without polling.
$router->add('POST', '/api/v1/challenges/{challengeId}/ratings', function (array $params) {
    $challengeId = $params['challengeId'] ?? '';
    if (!preg_match('/^[a-f0-9]{16}$/', $challengeId)) {
        Response::json(['error' => 'Invalid challengeId'], 400);
    }

    $authUser = AuthService::requireAuth();
    $callerId = $authUser['id'];

    $challenge = ChallengeRepository::findByIdUnchecked($challengeId);
    if ($challenge === null) {
        Response::json(['error' => 'Challenge not found'], 404);
    }

    // International challenges have no IRL meetup — their truth is the proof
    // verdict, not a mutual rating. Refuse cleanly so a confused client doesn't
    // double-write into two outcome systems.
    if (($challenge['mode'] ?? 'local') === 'international') {
        Response::json([
            'error' => 'International challenges use proof verdicts, not ratings.',
            'code'  => 'intl_no_ratings',
        ], 422);
    }

    // Body validation.
    $body = Request::json();
    if ($body === null) {
        Response::json(['error' => 'Invalid JSON body'], 400);
    }
    $stars = filter_var(
        $body['stars'] ?? null,
        FILTER_VALIDATE_INT,
        ['options' => ['min_range' => 1, 'max_range' => 5]],
    );
    if ($stars === false) {
        Response::json(['error' => 'stars must be an integer between 1 and 5'], 400);
    }
    $comment = $body['comment'] ?? null;
    if ($comment !== null) {
        $comment = mb_substr(trim(strip_tags((string) $comment)), 0, 500);
        if ($comment === '') $comment = null;
    }

    // Moderation gate — same shape as challenge create/edit. Hits log the
    // field for ops review; client gets a tailored 422 + code.
    if ($comment !== null) {
        $modHit = ModerationService::checkBundle(['comment' => $comment]);
        if ($modHit !== null) {
            error_log("[moderation] rating blocked challengeId={$challengeId} reason={$modHit['reason']} hit={$modHit['hit']}");
            Response::json([
                'error' => 'Your comment was flagged by moderation — please rephrase.',
                'code'  => 'moderation_blocked',
                'field' => 'comment',
            ], 422);
        }
    }

    // Modest rate limit — the UNIQUE constraint is the real dedup; this just
    // bounds malformed-body spam attempts.
    enforceRateLimit('rating_create', 10, 600, $callerId);

    // Pick the rate-target acceptance for this caller + challenge.
    //
    // Bug fix (Jun 2026): the previous SELECT used `ORDER BY created_at DESC
    // LIMIT 1` over all non-rejected rows. When a challenge has had multiple
    // acceptances over time — e.g. an OLD phase='approved' (mutually
    // completed, caller still hasn't written their rating) AND a NEWER
    // phase='accepted' (a different taker just took it on) — that picker
    // grabbed the new one and the effective_phase gate refused. The result
    // was a 403 not_rate_eligible for a rating the caller legitimately
    // wanted to leave on the older meet-up.
    //
    // Two-branch resolution that mirrors /me/rate-prompts exactly:
    //   - Caller is creator → any rate-eligible acceptance on this challenge
    //     (phase='approved', OR phase='scheduled' with end past). Most
    //     recent first.
    //   - Caller is acceptor → their own acceptance for this challenge
    //     (unique per UNIQUE(challenge_id, acceptor_user_id)). The
    //     downstream effective_phase check handles the gate.
    $isChallengerEarly = $challenge['created_by'] === $callerId;
    if ($isChallengerEarly) {
        $stmt = Database::pdo()->prepare("
            SELECT ca.id
            FROM challenge_acceptances ca
            WHERE ca.challenge_id = :cid
              AND ca.phase <> 'rejected'
              AND (
                  ca.phase = 'approved'
                  OR (ca.phase = 'scheduled'
                      AND ca.proposed_starts_at IS NOT NULL
                      AND COALESCE(ca.proposed_ends_at, ca.proposed_starts_at) < now())
              )
            ORDER BY ca.created_at DESC
            LIMIT 1
        ");
        $stmt->execute(['cid' => $challengeId]);
    } else {
        $stmt = Database::pdo()->prepare("
            SELECT ca.id
            FROM challenge_acceptances ca
            WHERE ca.challenge_id = :cid AND ca.acceptor_user_id = :uid
            LIMIT 1
        ");
        $stmt->execute(['cid' => $challengeId, 'uid' => $callerId]);
    }
    $accId = $stmt->fetchColumn();
    if ($accId === false) {
        Response::json([
            'error' => $isChallengerEarly
                ? "No rate-eligible meet-up on this challenge yet."
                : "You're not a party to this challenge.",
            'code'  => $isChallengerEarly ? 'no_acceptance' : 'not_a_party',
        ], 403);
    }
    // findById gives us the derived effective_phase alongside the row.
    $acceptance = ChallengeAcceptanceRepository::findById((string) $accId);

    // Rate-eligibility — meetup must be over. 'debrief' = scheduled + meetup
    // end is past. 'approved' = trigger already fired OR legacy verdict path.
    // A second distinct rater still slots in cleanly on 'approved'. For the
    // CREATOR branch above, the SQL already filtered to rate-eligible rows,
    // so this check is effectively for the ACCEPTOR branch (whose own
    // acceptance might be in pending / accepted / scheduled-not-past).
    if (!in_array($acceptance['effective_phase'], ['debrief', 'approved'], true)) {
        $msg = $acceptance['phase'] === 'pending'
            ? "Wait until the creator accepts your take-on."
            : ($acceptance['phase'] === 'accepted'
                ? "Lock in a meet-up date first."
                : "Wait until the meet-up is over.");
        Response::json([
            'error' => $msg,
            'code'  => 'not_rate_eligible',
            'phase' => $acceptance['effective_phase'],
        ], 403);
    }

    // Role resolution. Either party may rate; nobody else.
    $isChallenger = $challenge['created_by']        === $callerId;
    $isTaker      = $acceptance['acceptor_user_id'] === $callerId;
    if (!$isChallenger && !$isTaker) {
        Response::json([
            'error' => "You're not a party to this challenge.",
            'code'  => 'not_a_party',
        ], 403);
    }
    $raterRole = $isChallenger ? 'challenger' : 'taker';
    $rateeId   = $isChallenger ? $acceptance['acceptor_user_id'] : $challenge['created_by'];

    // Insert. The trigger handles all scoring + the phase flip on the second
    // rating; we never touch score_events.
    $ratingId = bin2hex(random_bytes(8));
    try {
        Database::pdo()->prepare("
            INSERT INTO challenge_ratings
                (id, challenge_id, rater_id, ratee_id, rater_role, stars, comment)
            VALUES
                (:id, :cid, :rater, :ratee, :role, :stars, :comment)
        ")->execute([
            'id'      => $ratingId,
            'cid'     => $challengeId,
            'rater'   => $callerId,
            'ratee'   => $rateeId,
            'role'    => $raterRole,
            'stars'   => $stars,
            'comment' => $comment,
        ]);
    } catch (\PDOException $e) {
        // 23505 = unique_violation on (challenge_id, rater_id).
        if ($e->getCode() === '23505') {
            Response::json([
                'error' => "You already rated this challenge.",
                'code'  => 'already_rated',
            ], 409);
        }
        error_log('[ratings] insert failed ch=' . $challengeId . ' uid=' . $callerId . ': ' . $e->getMessage());
        Response::json(['error' => 'Failed to submit rating'], 500);
    }

    // Did this insert trigger the mutual-reveal? Cheap: count ratings for
    // this challenge — 2 means the trigger has fired (or is firing).
    $stmt = Database::pdo()->prepare("
        SELECT COUNT(*) FROM challenge_ratings WHERE challenge_id = ?
    ");
    $stmt->execute([$challengeId]);
    $revealed = ((int) $stmt->fetchColumn()) >= 2;

    AnalyticsService::defer('challenge_rated', $callerId, [
        'challenge_id' => $challengeId,
        'rater_role'   => $raterRole,
        'stars'        => $stars,
        'revealed'     => $revealed,
    ]);

    Response::json([
        'rating' => [
            'id'           => $ratingId,
            'challenge_id' => $challengeId,
            'rater_id'     => $callerId,
            'ratee_id'     => $rateeId,
            'rater_role'   => $raterRole,
            'stars'        => $stars,
            'comment'      => $comment,
        ],
        'revealed' => $revealed,
    ], 201);
});

// GET /api/v1/challenges/{challengeId}/ratings/mine
// The caller's own rating — always visible to its writer (no mutual-reveal
// gate on the rater's own row). Returns { rating: null } when the caller
// hasn't rated yet so the client can branch cleanly without catching a 404.
$router->add('GET', '/api/v1/challenges/{challengeId}/ratings/mine', function (array $params) {
    $challengeId = $params['challengeId'] ?? '';
    if (!preg_match('/^[a-f0-9]{16}$/', $challengeId)) {
        Response::json(['error' => 'Invalid challengeId'], 400);
    }

    $authUser = AuthService::requireAuth();
    $callerId = $authUser['id'];

    $stmt = Database::pdo()->prepare("
        SELECT id, challenge_id, rater_id, ratee_id, rater_role, stars, comment,
               EXTRACT(EPOCH FROM created_at)::INTEGER AS created_at
        FROM challenge_ratings
        WHERE challenge_id = :cid AND rater_id = :uid
        LIMIT 1
    ");
    $stmt->execute(['cid' => $challengeId, 'uid' => $callerId]);
    $row = $stmt->fetch(\PDO::FETCH_ASSOC);

    if (!$row) {
        Response::json(['rating' => null]);
    }

    Response::json([
        'rating' => [
            'id'           => $row['id'],
            'challenge_id' => $row['challenge_id'],
            'rater_id'     => $row['rater_id'],
            'ratee_id'     => $row['ratee_id'],
            'rater_role'   => $row['rater_role'],
            'stars'        => (int) $row['stars'],
            'comment'      => $row['comment'],
            'created_at'   => (int) $row['created_at'],
        ],
    ]);
});

// GET /api/v1/challenges/{challengeId}/ratings/of-me
// The rating ABOUT the caller — mutual-reveal gated. Reads from
// visible_ratings, which only exposes a row once both parties have rated
// (see migrate.php:1538). Filtering by ratee_id = caller.id therefore yields:
//   - waiting on caller to rate          → empty (revealed=false)
//   - waiting on the other party to rate → empty (revealed=false)
//   - both rated                         → the row, revealed=true
// The two empty cases are intentionally indistinguishable here; the client
// disambiguates "I haven't rated yet" vs. "the other party hasn't rated yet"
// by also calling /ratings/mine, which is paid-for in the same UI tick.
$router->add('GET', '/api/v1/challenges/{challengeId}/ratings/of-me', function (array $params) {
    $challengeId = $params['challengeId'] ?? '';
    if (!preg_match('/^[a-f0-9]{16}$/', $challengeId)) {
        Response::json(['error' => 'Invalid challengeId'], 400);
    }

    $authUser = AuthService::requireAuth();
    $callerId = $authUser['id'];

    $stmt = Database::pdo()->prepare("
        SELECT id, challenge_id, rater_id, ratee_id, rater_role, stars, comment,
               EXTRACT(EPOCH FROM created_at)::INTEGER AS created_at
        FROM visible_ratings
        WHERE challenge_id = :cid AND ratee_id = :uid
        LIMIT 1
    ");
    $stmt->execute(['cid' => $challengeId, 'uid' => $callerId]);
    $row = $stmt->fetch(\PDO::FETCH_ASSOC);

    if (!$row) {
        Response::json(['revealed' => false]);
    }

    Response::json([
        'revealed' => true,
        'rating' => [
            'id'           => $row['id'],
            'challenge_id' => $row['challenge_id'],
            'rater_id'     => $row['rater_id'],
            'ratee_id'     => $row['ratee_id'],
            'rater_role'   => $row['rater_role'],
            'stars'        => (int) $row['stars'],
            'comment'      => $row['comment'],
            'created_at'   => (int) $row['created_at'],
        ],
    ]);
});

// ── Challenge acceptances (PR2 — new take-on flow) ────────────────────────────
// The old /participants/toggle above is the legacy pooled-acceptance path
// (kept for backward-compat with the live mobile build until the next app
// release). The endpoints below are the new model: each accept creates a
// 1:1 thread channel between creator + acceptor.

// POST /api/v1/challenges/{challengeId}/accept
// New take-on. Creates a challenge_acceptances row + a channels.type='challenge_thread'
// row (the 1:1 chat). Idempotent — re-accepting returns the existing row.
//
// Gates (all 403 with `code` field for client to disambiguate):
//   - not_creator       : you can't accept your own challenge
//   - mode_required     : your users.mode is null — set it before accepting
//   - mode_mismatch     : you're a local but the challenge is for travelers (or vice-versa)
//   - cap_reached       : challenge already at max_participants
$router->add('POST', '/api/v1/challenges/{challengeId}/accept', function (array $params) {
    $challengeId = $params['challengeId'] ?? '';
    if (!preg_match('/^[a-f0-9]{16}$/', $challengeId)) {
        Response::json(['error' => 'Invalid challengeId'], 400);
    }

    $authUser = AuthService::requireAuth();
    $userId   = $authUser['id'];

    // Visibility-aware: out-of-scope viewers get a 404 (matches read path).
    // Invitees on private/friends challenges go through the invitation
    // /respond endpoint instead, which uses findByIdUnchecked.
    $challenge = ChallengeRepository::findById($challengeId, $userId);
    if ($challenge === null) {
        Response::json(['error' => 'Challenge not found'], 404);
    }

    // Gate: not the creator.
    if ($challenge['created_by'] === $userId) {
        Response::json(['error' => "You created this challenge — you can't accept it", 'code' => 'not_creator'], 403);
    }

    // Idempotency: already accepted? Return the existing acceptance (201 would
    // be misleading; 200 = "you're already in, here's your acceptance").
    $existing = ChallengeAcceptanceRepository::findExisting($challengeId, $userId);
    if ($existing !== null) {
        Response::json($existing);
    }

    // Mode/audience gate — Local-only. International challenges target
    // anyone (or anyone in city B) and have no in-person meetup, so neither
    // the user's local/traveler mode nor the challenge.audience field gates
    // take-on. The proof verdict is the gate that matters.
    $isInternational = ($challenge['mode'] ?? 'local') === 'international';
    if (!$isInternational) {
        $expectedMode = $challenge['audience'] === 'locals' ? 'local' : 'exploring';
        $actualMode   = $authUser['mode'] ?? null;
        if (empty($actualMode)) {
            Response::json([
                'error'         => 'Set your mode (local or traveler) before accepting challenges',
                'code'          => 'mode_required',
                'required_mode' => $expectedMode,
            ], 403);
        }
        if ($actualMode !== $expectedMode) {
            $needLabel = $expectedMode === 'local' ? 'locals' : 'travelers';
            Response::json([
                'error'         => "Only {$needLabel} can accept this challenge",
                'code'          => 'mode_mismatch',
                'required_mode' => $expectedMode,
            ], 403);
        }
    }

    // 1:1 gate — refuse a new take-on while the challenge has any
    // non-terminal acceptance. The first taker holds the challenge until
    // their meet-up wraps up (approved / rejected) or they cancel — at which
    // point the row frees and the next traveler can take it on. Commit 3
    // adds a lazy "ghosted taker" rule so a long-stale debrief also frees
    // the challenge without manual intervention.
    //
    // International challenges share the same 1:1 lock at the data layer
    // (one open acceptance at a time) — but the lock releases on proof
    // verdict instead of meetup completion. Same semantics, different flow.
    if (ChallengeAcceptanceRepository::hasActiveAcceptance($challengeId)) {
        Response::json([
            'error' => "Someone's already on this one — check back when it's done",
            'code'  => 'in_progress',
        ], 403);
    }

    enforceRateLimit('challenge_accept', 20, 3600, $userId);

    // International challenges auto-approve the take-on (no IRL filter step).
    // Local stays gated at 'pending' so the creator can vet the meet-up.
    $initialPhase = $isInternational ? 'accepted' : 'pending';

    try {
        $acceptance = ChallengeAcceptanceRepository::create($challengeId, $userId, $initialPhase);
    } catch (\Throwable $e) {
        error_log('[challenges] accept failed ch=' . $challengeId . ' uid=' . $userId . ': ' . $e->getMessage());
        Response::json(['error' => 'Failed to accept challenge'], 500);
    }

    // Live push to the creator so their threads list updates without polling.
    try {
        if (!empty($challenge['created_by'])) {
            broadcastChallengeAcceptedToWs($challenge['created_by'], [
                'acceptance' => $acceptance,
                'challenge'  => [
                    'id'             => $challenge['id'],
                    'title'          => $challenge['title'],
                    'challenge_type' => $challenge['challenge_type'],
                    'mode'           => $challenge['mode'] ?? 'local',
                ],
                'acceptor' => [
                    'id'             => $userId,
                    'displayName'    => $authUser['display_name'] ?? null,
                    'thumbAvatarUrl' => $authUser['profile_thumb_photo_url'] ?? null,
                ],
            ]);
        }
    } catch (\Throwable $e) {
        error_log('[challenges] ws accept broadcast failed (non-fatal): ' . $e->getMessage());
    }

    // Push notification to the creator — copy differs by mode:
    //   Local         → "take-on REQUEST" (creator must review)
    //   International → "challenge accepted" (auto-approved; creator just
    //                   knows someone's on it, waiting for proof)
    // Same type for now (challenge_takeon_request) — keeps NotificationI18n
    // and the bell row simple. Future step can split if the difference
    // becomes UX-meaningful, but for now the body distinction below is
    // enough — clients render off `data.mode` to differentiate CTAs.
    try {
        if (!empty($challenge['created_by'])) {
            $acceptorName = $authUser['display_name'] ?? 'Someone';
            $title = $isInternational ? "🌐 Challenge accepted" : "🤝 New take-on request";
            $body  = $isInternational
                ? "{$acceptorName} accepted \"{$challenge['title']}\". Wait for the proof."
                : "{$acceptorName} wants to take on \"{$challenge['title']}\"";
            NotificationRepository::create(
                $challenge['created_by'],
                'challenge_takeon_request',
                $title,
                $body,
                [
                    'challengeId'    => $challengeId,
                    'acceptanceId'   => $acceptance['id'],
                    'acceptorName'   => $acceptorName,
                    // Plumbed through so NotificationI18n templates can render
                    // a localized body for non-EN recipients.
                    'challengeTitle' => $challenge['title'] ?? '',
                    'mode'           => $challenge['mode'] ?? 'local',
                ],
            );
        }
    } catch (\Throwable $e) {
        error_log('[challenges] takeon-request push failed (non-fatal): ' . $e->getMessage());
    }

    AnalyticsService::defer('challenge_take_on', $userId, [
        'challenge_id'  => $challengeId,
        'acceptance_id' => $acceptance['id'],
        'mode'          => $challenge['mode'] ?? 'local',
        'auto_approved' => $isInternational,
    ]);

    Response::json($acceptance, 201);
});

// ── PR5: pending take-on review (creator approve / reject) ──────────────────

/**
 * Shared validator for the two take-on review routes. Returns
 * [acceptance, challenge, authUser] on success, or short-circuits with a JSON
 * error. Gate: caller is the challenge creator, acceptance phase='pending'.
 */
function gateTakeOnReview(string $acceptanceId): array
{
    if (!preg_match('/^[a-f0-9]{16}$/', $acceptanceId)) {
        Response::json(['error' => 'Invalid acceptanceId'], 400);
    }
    $authUser = AuthService::requireAuth();
    $acceptance = ChallengeAcceptanceRepository::findById($acceptanceId);
    if ($acceptance === null) {
        Response::json(['error' => 'Acceptance not found'], 404);
    }
    $challenge = ChallengeRepository::findByIdUnchecked($acceptance['challenge_id']);
    if ($challenge === null) {
        Response::json(['error' => 'Challenge not found'], 404);
    }
    if ($challenge['created_by'] !== $authUser['id']) {
        Response::json(['error' => 'Only the challenge creator can review take-on requests'], 403);
    }
    if ($acceptance['phase'] !== 'pending') {
        Response::json([
            'error' => "This take-on isn't pending review",
            'code'  => 'phase_locked',
        ], 409);
    }
    return [$acceptance, $challenge, $authUser];
}

// POST /api/v1/acceptances/{acceptanceId}/approve-takeon
// Creator accepts a pending take-on request → phase flips to 'accepted'.
// The thread chat unlocks for the acceptor; a system message lands in the
// thread; the acceptor gets a push.
$router->add('POST', '/api/v1/acceptances/{acceptanceId}/approve-takeon', function (array $params) {
    [$acceptance, $challenge, $authUser] = gateTakeOnReview($params['acceptanceId'] ?? '');
    $userId       = $authUser['id'];
    $acceptanceId = $params['acceptanceId'];

    try {
        $updated = ChallengeAcceptanceRepository::approveTakeOn($acceptanceId);
    } catch (\Throwable $e) {
        error_log('[challenges] approve-takeon failed acc=' . $acceptanceId . ': ' . $e->getMessage());
        Response::json(['error' => 'Failed to approve take-on'], 500);
    }
    if ($updated === null) {
        Response::json(['error' => 'Failed to approve take-on'], 500);
    }

    // System message in the thread — "✅ X accepted your take-on. Let's plan!"
    // Sent as a regular message of type='system' so it persists in history
    // and shows up the moment the chat unlocks.
    try {
        $creatorName = $authUser['display_name'] ?? 'The creator';
        $sysMsg = MessageRepository::addSystemMessage(
            $acceptance['thread_channel_id'],
            "✅ {$creatorName} accepted your take-on — let's plan the meet-up!",
        );
        broadcastMessageToWs($acceptance['thread_channel_id'], $sysMsg);
    } catch (\Throwable $e) {
        error_log('[challenges] approve-takeon system msg failed (non-fatal): ' . $e->getMessage());
    }

    // WS broadcast to the acceptor — their UI flips from "Waiting..." to chat.
    try {
        if (!empty($acceptance['acceptor_user_id'])) {
            broadcastChallengeTakeOnReviewedToWs($acceptance['acceptor_user_id'], [
                'acceptanceId'    => $acceptanceId,
                'challengeId'     => $acceptance['challenge_id'],
                'threadChannelId' => $acceptance['thread_channel_id'],
                'decision'        => 'approved',
                'acceptance'      => $updated,
            ]);
        }
    } catch (\Throwable $e) {
        error_log('[challenges] approve-takeon WS broadcast failed (non-fatal): ' . $e->getMessage());
    }

    // Push to the acceptor — their take-on is now active.
    try {
        if (!empty($acceptance['acceptor_user_id'])) {
            $creatorName = $authUser['display_name'] ?? 'The creator';
            NotificationRepository::create(
                $acceptance['acceptor_user_id'],
                'challenge_takeon_approved',
                "✅ Take-on accepted",
                "{$creatorName} accepted your take-on of \"{$challenge['title']}\". Time to plan!",
                [
                    'challengeId'    => $acceptance['challenge_id'],
                    'acceptanceId'   => $acceptanceId,
                    'creatorName'    => $creatorName,
                    'challengeTitle' => $challenge['title'] ?? '',
                ],
            );
        }
    } catch (\Throwable $e) {
        error_log('[challenges] approve-takeon push failed (non-fatal): ' . $e->getMessage());
    }

    Response::json(['acceptance' => $updated]);
});

// POST /api/v1/acceptances/{acceptanceId}/reject-takeon
// Creator declines a pending take-on request → phase flips to 'rejected'.
// The thread chat stays hidden; a system message lands in the thread
// (audit trail) and the acceptor gets a push.
$router->add('POST', '/api/v1/acceptances/{acceptanceId}/reject-takeon', function (array $params) {
    [$acceptance, $challenge, $authUser] = gateTakeOnReview($params['acceptanceId'] ?? '');
    $userId       = $authUser['id'];
    $acceptanceId = $params['acceptanceId'];

    try {
        $updated = ChallengeAcceptanceRepository::rejectTakeOn($acceptanceId);
    } catch (\Throwable $e) {
        error_log('[challenges] reject-takeon failed acc=' . $acceptanceId . ': ' . $e->getMessage());
        Response::json(['error' => 'Failed to reject take-on'], 500);
    }
    if ($updated === null) {
        Response::json(['error' => 'Failed to reject take-on'], 500);
    }

    // System message in the thread — audit trail even though the chat
    // doesn't unlock. The acceptor's "Waiting..." state morphs into a
    // rejection notice that references this message.
    try {
        $creatorName = $authUser['display_name'] ?? 'The creator';
        $sysMsg = MessageRepository::addSystemMessage(
            $acceptance['thread_channel_id'],
            "✕ {$creatorName} declined your take-on.",
        );
        broadcastMessageToWs($acceptance['thread_channel_id'], $sysMsg);
    } catch (\Throwable $e) {
        error_log('[challenges] reject-takeon system msg failed (non-fatal): ' . $e->getMessage());
    }

    // WS broadcast + push to acceptor — same payload as approve, different decision.
    try {
        if (!empty($acceptance['acceptor_user_id'])) {
            broadcastChallengeTakeOnReviewedToWs($acceptance['acceptor_user_id'], [
                'acceptanceId'    => $acceptanceId,
                'challengeId'     => $acceptance['challenge_id'],
                'threadChannelId' => $acceptance['thread_channel_id'],
                'decision'        => 'rejected',
                'acceptance'      => $updated,
            ]);
        }
    } catch (\Throwable $e) {
        error_log('[challenges] reject-takeon WS broadcast failed (non-fatal): ' . $e->getMessage());
    }

    try {
        if (!empty($acceptance['acceptor_user_id'])) {
            $creatorName = $authUser['display_name'] ?? 'The creator';
            NotificationRepository::create(
                $acceptance['acceptor_user_id'],
                'challenge_takeon_rejected',
                "✕ Take-on declined",
                "{$creatorName} declined your take-on of \"{$challenge['title']}\".",
                [
                    'challengeId'    => $acceptance['challenge_id'],
                    'acceptanceId'   => $acceptanceId,
                    'creatorName'    => $creatorName,
                    'challengeTitle' => $challenge['title'] ?? '',
                ],
            );
        }
    } catch (\Throwable $e) {
        error_log('[challenges] reject-takeon push failed (non-fatal): ' . $e->getMessage());
    }

    Response::json(['acceptance' => $updated]);
});

// POST /api/v1/acceptances/{acceptanceId}/cancel
// Either party can cancel — but only in phase 'accepted'. Hard-delete: the
// thread channel goes (cascade kills messages + the acceptance row via FK).
// PR3+ phases (scheduled, debrief, approved, rejected) return 409.
$router->add('POST', '/api/v1/acceptances/{acceptanceId}/cancel', function (array $params) {
    $acceptanceId = $params['acceptanceId'] ?? '';
    if (!preg_match('/^[a-f0-9]{16}$/', $acceptanceId)) {
        Response::json(['error' => 'Invalid acceptanceId'], 400);
    }

    $authUser = AuthService::requireAuth();
    $userId   = $authUser['id'];

    $acceptance = ChallengeAcceptanceRepository::findById($acceptanceId);
    if ($acceptance === null) {
        Response::json(['error' => 'Acceptance not found'], 404);
    }
    $challenge = ChallengeRepository::findByIdUnchecked($acceptance['challenge_id']);
    if ($challenge === null) {
        Response::json(['error' => 'Challenge not found'], 404);
    }

    $isAcceptor = $acceptance['acceptor_user_id'] === $userId;
    $isCreator  = $challenge['created_by'] === $userId;
    if (!$isAcceptor && !$isCreator) {
        Response::json(['error' => 'Not allowed'], 403);
    }
    // Cancel is allowed while the take-on is still under review ('pending')
    // OR after acceptance but before a date is scheduled ('accepted'). Once a
    // date is scheduled the chat history matters and we lock the row.
    if ($acceptance['phase'] !== 'accepted' && $acceptance['phase'] !== 'pending') {
        Response::json([
            'error' => "Can't cancel after a date is scheduled",
            'code'  => 'phase_locked',
        ], 409);
    }

    // Snapshot the IDs BEFORE delete — the cascade wipes them.
    $otherUserId    = $isAcceptor ? $challenge['created_by'] : $acceptance['acceptor_user_id'];
    $threadId       = $acceptance['thread_channel_id'];
    $challengeIdSnap = $acceptance['challenge_id'];

    if (!ChallengeAcceptanceRepository::cancel($acceptanceId)) {
        Response::json(['error' => 'Failed to cancel'], 500);
    }

    try {
        if ($otherUserId !== null) {
            broadcastChallengeAcceptanceCancelledToWs($otherUserId, [
                'cancelledBy'      => $userId,
                'acceptanceId'     => $acceptanceId,
                'challengeId'      => $challengeIdSnap,
                'threadChannelId'  => $threadId,
            ]);
        }
    } catch (\Throwable $e) {
        error_log('[challenges] ws cancel broadcast failed (non-fatal): ' . $e->getMessage());
    }

    Response::json(['ok' => true]);
});

// ── Date concertation (PR3) ───────────────────────────────────────────────────

// POST /api/v1/acceptances/{acceptanceId}/propose-date
// Either party proposes; counter-proposals overwrite.
// Body: {startsAt: unix_int, endsAt?: unix_int, venue?: string}
$router->add('POST', '/api/v1/acceptances/{acceptanceId}/propose-date', function (array $params) {
    $acceptanceId = $params['acceptanceId'] ?? '';
    if (!preg_match('/^[a-f0-9]{16}$/', $acceptanceId)) {
        Response::json(['error' => 'Invalid acceptanceId'], 400);
    }

    $authUser = AuthService::requireAuth();
    $userId   = $authUser['id'];

    $acceptance = ChallengeAcceptanceRepository::findById($acceptanceId);
    if ($acceptance === null) {
        Response::json(['error' => 'Acceptance not found'], 404);
    }
    $challenge = ChallengeRepository::findByIdUnchecked($acceptance['challenge_id']);
    if ($challenge === null) {
        Response::json(['error' => 'Challenge not found'], 404);
    }

    $isAcceptor = $acceptance['acceptor_user_id'] === $userId;
    $isCreator  = $challenge['created_by'] === $userId;
    if (!$isAcceptor && !$isCreator) {
        Response::json(['error' => 'Not a thread member'], 403);
    }
    // 'accepted' = initial proposal/counter-proposal. 'scheduled' = either
    // party reschedules an already-approved date — the repo flips it back to
    // 'accepted' so the other party re-approves. After 'scheduled' (debrief /
    // approved / rejected) the date is final.
    if ($acceptance['phase'] !== 'accepted' && $acceptance['phase'] !== 'scheduled') {
        Response::json(['error' => "Can't change the date at this stage", 'code' => 'phase_locked'], 409);
    }

    $body     = Request::json() ?? [];
    $startsAt = filter_var($body['startsAt'] ?? null, FILTER_VALIDATE_INT);
    $endsAt   = isset($body['endsAt']) ? filter_var($body['endsAt'], FILTER_VALIDATE_INT) : null;
    $venue    = isset($body['venue']) && is_string($body['venue']) ? $body['venue'] : null;

    if ($startsAt === false || $startsAt <= 0) {
        Response::json(['error' => 'startsAt is required (unix timestamp)'], 400);
    }
    // 5 years out is the realistic ceiling — beyond that is almost certainly a
    // client bug (ms vs s confusion, etc.). Also reject anything in the past
    // by more than a day (clock skew + UX honesty).
    $nowTs = time();
    if ($startsAt < $nowTs - 86400) {
        Response::json(['error' => 'startsAt is in the past'], 400);
    }
    if ($startsAt > $nowTs + 5 * 365 * 86400) {
        Response::json(['error' => 'startsAt is too far in the future'], 400);
    }
    if ($endsAt !== false && $endsAt !== null) {
        if ($endsAt <= $startsAt) {
            Response::json(['error' => 'endsAt must be after startsAt'], 400);
        }
        if ($endsAt > $startsAt + 30 * 86400) {
            Response::json(['error' => 'endsAt is more than 30 days after startsAt'], 400);
        }
    }

    enforceRateLimit('challenge_propose_date', 30, 3600, $userId);

    $updated = ChallengeAcceptanceRepository::proposeDate(
        $acceptanceId,
        $userId,
        (int) $startsAt,
        $endsAt === false || $endsAt === null ? null : (int) $endsAt,
        $venue,
    );
    if ($updated === null) {
        Response::json(['error' => 'Failed to propose'], 500);
    }

    // Push to the OTHER party (the proposer's own devices update via the
    // HTTP response + a client-side fan-out / state set).
    try {
        $otherUserId = $isAcceptor ? $challenge['created_by'] : $acceptance['acceptor_user_id'];
        if ($otherUserId !== null) {
            broadcastChallengeDateProposedToWs($otherUserId, [
                'acceptanceId'     => $acceptanceId,
                'challengeId'      => $acceptance['challenge_id'],
                'threadChannelId'  => $acceptance['thread_channel_id'],
                'acceptance'       => $updated,
                'proposedBy'       => $userId,
            ]);
        }
    } catch (\Throwable $e) {
        error_log('[challenges] ws propose-date broadcast failed (non-fatal): ' . $e->getMessage());
    }

    Response::json($updated);
});

// POST /api/v1/acceptances/{acceptanceId}/withdraw-proposal
// Proposer-only — clears the current proposal. Phase stays 'accepted'.
$router->add('POST', '/api/v1/acceptances/{acceptanceId}/withdraw-proposal', function (array $params) {
    $acceptanceId = $params['acceptanceId'] ?? '';
    if (!preg_match('/^[a-f0-9]{16}$/', $acceptanceId)) {
        Response::json(['error' => 'Invalid acceptanceId'], 400);
    }

    $authUser   = AuthService::requireAuth();
    $userId     = $authUser['id'];
    $acceptance = ChallengeAcceptanceRepository::findById($acceptanceId);
    if ($acceptance === null) {
        Response::json(['error' => 'Acceptance not found'], 404);
    }
    $challenge = ChallengeRepository::findByIdUnchecked($acceptance['challenge_id']);
    if ($challenge === null) {
        Response::json(['error' => 'Challenge not found'], 404);
    }
    if ($acceptance['proposed_by_user_id'] !== $userId) {
        Response::json(['error' => 'Only the proposer can withdraw'], 403);
    }
    if ($acceptance['phase'] !== 'accepted' || $acceptance['proposed_starts_at'] === null) {
        Response::json(['error' => 'No active proposal'], 409);
    }

    $updated = ChallengeAcceptanceRepository::withdrawProposal($acceptanceId);

    try {
        $otherUserId = $acceptance['acceptor_user_id'] === $userId
            ? $challenge['created_by']
            : $acceptance['acceptor_user_id'];
        if ($otherUserId !== null) {
            broadcastChallengeDateWithdrawnToWs($otherUserId, [
                'acceptanceId'    => $acceptanceId,
                'challengeId'     => $acceptance['challenge_id'],
                'threadChannelId' => $acceptance['thread_channel_id'],
                'acceptance'      => $updated,
                'withdrawnBy'     => $userId,
            ]);
        }
    } catch (\Throwable $e) {
        error_log('[challenges] ws withdraw-proposal broadcast failed (non-fatal): ' . $e->getMessage());
    }

    Response::json($updated);
});

// POST /api/v1/acceptances/{acceptanceId}/approve-date
// CREATOR ONLY. Approves the current proposal and flips phase to 'scheduled'.
// The thread chat IS the meet-up surface — no event row, no system message
// (previously inserted a "🎉 New event" card which was misleading inside the
// thread; the pipeline's Meet step is the visible cue now).
$router->add('POST', '/api/v1/acceptances/{acceptanceId}/approve-date', function (array $params) {
    $acceptanceId = $params['acceptanceId'] ?? '';
    if (!preg_match('/^[a-f0-9]{16}$/', $acceptanceId)) {
        Response::json(['error' => 'Invalid acceptanceId'], 400);
    }

    $authUser   = AuthService::requireAuth();
    $userId     = $authUser['id'];
    $acceptance = ChallengeAcceptanceRepository::findById($acceptanceId);
    if ($acceptance === null) {
        Response::json(['error' => 'Acceptance not found'], 404);
    }
    $challenge = ChallengeRepository::findByIdUnchecked($acceptance['challenge_id']);
    if ($challenge === null) {
        Response::json(['error' => 'Challenge not found'], 404);
    }
    if ($challenge['created_by'] !== $userId) {
        Response::json(['error' => 'Only the challenge creator can approve'], 403);
    }
    if ($acceptance['phase'] !== 'accepted') {
        Response::json(['error' => 'Date already scheduled', 'code' => 'phase_locked'], 409);
    }
    if ($acceptance['proposed_starts_at'] === null) {
        Response::json(['error' => 'No date proposed yet'], 409);
    }

    try {
        $result = ChallengeAcceptanceRepository::approveDate($acceptanceId, (string) $challenge['title']);
    } catch (\Throwable $e) {
        error_log('[challenges] approve-date failed acc=' . $acceptanceId . ': ' . $e->getMessage());
        Response::json(['error' => 'Failed to approve date'], 500);
    }
    if ($result === null) {
        Response::json(['error' => 'Failed to approve date'], 500);
    }
    $updated = $result['acceptance'];

    // Push to the acceptor — their phase pill flips to "scheduled".
    try {
        if (!empty($acceptance['acceptor_user_id'])) {
            broadcastChallengeDateApprovedToWs($acceptance['acceptor_user_id'], [
                'acceptanceId'    => $acceptanceId,
                'challengeId'     => $acceptance['challenge_id'],
                'threadChannelId' => $acceptance['thread_channel_id'],
                'acceptance'      => $updated,
            ]);
        }
    } catch (\Throwable $e) {
        error_log('[challenges] ws approve-date broadcast failed (non-fatal): ' . $e->getMessage());
    }

    Response::json(['acceptance' => $updated]);
});

// ── PR4: debrief verdicts (approve / reject the challenge) ────────────────────

/**
 * Shared gate for both verdict routes. Returns [acceptance, challenge] on
 * success, or short-circuits with the right error JSON. Both verdicts share:
 *   - creator-only
 *   - effective_phase must be 'debrief' (i.e. phase='scheduled' + meetup ended)
 *
 * effective_phase is recomputed server-side (the repo SELECT carries it) so
 * the client can't bypass the gate by lying about when the event ended.
 */
function gateForVerdict(string $acceptanceId): array
{
    $authUser   = AuthService::requireAuth();
    $userId     = $authUser['id'];
    $acceptance = ChallengeAcceptanceRepository::findById($acceptanceId);
    if ($acceptance === null) {
        Response::json(['error' => 'Acceptance not found'], 404);
    }
    $challenge = ChallengeRepository::findByIdUnchecked($acceptance['challenge_id']);
    if ($challenge === null) {
        Response::json(['error' => 'Challenge not found'], 404);
    }
    if ($challenge['created_by'] !== $userId) {
        Response::json(['error' => 'Only the challenge creator can decide the outcome'], 403);
    }
    if ($acceptance['effective_phase'] !== 'debrief') {
        Response::json([
            'error' => $acceptance['phase'] === 'scheduled'
                ? "Wait until the meetup is over"
                : "This take-on is already decided",
            'code'  => 'phase_locked',
        ], 409);
    }
    return [$acceptance, $challenge, $authUser];
}

// POST /api/v1/acceptances/{acceptanceId}/approve-challenge
$router->add('POST', '/api/v1/acceptances/{acceptanceId}/approve-challenge', function (array $params) {
    $acceptanceId = $params['acceptanceId'] ?? '';
    if (!preg_match('/^[a-f0-9]{16}$/', $acceptanceId)) {
        Response::json(['error' => 'Invalid acceptanceId'], 400);
    }
    [$acceptance, $challenge, $authUser] = gateForVerdict($acceptanceId);

    $updated = ChallengeAcceptanceRepository::approve($acceptanceId);
    if ($updated === null) {
        Response::json(['error' => 'Failed to approve'], 500);
    }

    // Push notif to the acceptor — they've earned a 🎉.
    try {
        $creatorName = $authUser['display_name'] ?? 'Someone';
        $title       = $challenge['title'] ?? 'a challenge';
        NotificationRepository::create(
            $acceptance['acceptor_user_id'],
            'challenge_verdict_approved',
            '🎉 Challenge accomplished',
            "{$creatorName} marked \"{$title}\" as done",
            [
                'acceptanceId'    => $acceptanceId,
                'challengeId'     => $acceptance['challenge_id'],
                'threadChannelId' => $acceptance['thread_channel_id'],
                'senderUserId'    => $authUser['id'],
                'senderName'      => $creatorName,
                'challengeTitle'  => $title,
            ],
        );
    } catch (\Throwable $e) {
        error_log('[challenges] approve-challenge notif failed (non-fatal): ' . $e->getMessage());
    }

    try {
        broadcastChallengeVerdictToWs($acceptance['acceptor_user_id'], 'approved', [
            'acceptanceId'    => $acceptanceId,
            'challengeId'     => $acceptance['challenge_id'],
            'threadChannelId' => $acceptance['thread_channel_id'],
            'acceptance'      => $updated,
        ]);
    } catch (\Throwable $e) {
        error_log('[challenges] approve-challenge ws failed (non-fatal): ' . $e->getMessage());
    }

    AnalyticsService::defer('challenge_verdict_approved', $authUser['id'], [
        'challenge_id'  => $acceptance['challenge_id'],
        'acceptance_id' => $acceptanceId,
    ]);

    Response::json($updated);
});

// POST /api/v1/acceptances/{acceptanceId}/reject-challenge
// "Reject" is the negative verdict — no-show, didn't really meet, etc.
// Tone is gentler in copy (the acceptor sees "closed", not "rejected").
$router->add('POST', '/api/v1/acceptances/{acceptanceId}/reject-challenge', function (array $params) {
    $acceptanceId = $params['acceptanceId'] ?? '';
    if (!preg_match('/^[a-f0-9]{16}$/', $acceptanceId)) {
        Response::json(['error' => 'Invalid acceptanceId'], 400);
    }
    [$acceptance, $challenge, $authUser] = gateForVerdict($acceptanceId);

    $updated = ChallengeAcceptanceRepository::reject($acceptanceId);
    if ($updated === null) {
        Response::json(['error' => 'Failed to reject'], 500);
    }

    try {
        $creatorName = $authUser['display_name'] ?? 'Someone';
        $title       = $challenge['title'] ?? 'a challenge';
        NotificationRepository::create(
            $acceptance['acceptor_user_id'],
            'challenge_verdict_rejected',
            'Challenge closed',
            "{$creatorName} closed \"{$title}\"",
            [
                'acceptanceId'    => $acceptanceId,
                'challengeId'     => $acceptance['challenge_id'],
                'threadChannelId' => $acceptance['thread_channel_id'],
                'senderUserId'    => $authUser['id'],
                'senderName'      => $creatorName,
                'challengeTitle'  => $title,
            ],
        );
    } catch (\Throwable $e) {
        error_log('[challenges] reject-challenge notif failed (non-fatal): ' . $e->getMessage());
    }

    try {
        broadcastChallengeVerdictToWs($acceptance['acceptor_user_id'], 'rejected', [
            'acceptanceId'    => $acceptanceId,
            'challengeId'     => $acceptance['challenge_id'],
            'threadChannelId' => $acceptance['thread_channel_id'],
            'acceptance'      => $updated,
        ]);
    } catch (\Throwable $e) {
        error_log('[challenges] reject-challenge ws failed (non-fatal): ' . $e->getMessage());
    }

    AnalyticsService::defer('challenge_verdict_rejected', $authUser['id'], [
        'challenge_id'  => $acceptance['challenge_id'],
        'acceptance_id' => $acceptanceId,
    ]);

    Response::json($updated);
});

// ── International challenge proofs ───────────────────────────────────────────
// Acceptor submits a proof for an international challenge; creator approves
// or rejects (with mandatory reason). Capped at 3 attempts per acceptance.
// Geotag is verified server-side against the target city (if set) using
// per-city tolerance with an env fallback.
//
//   POST /api/v1/acceptances/:id/submit-proof — acceptor only
//   POST /api/v1/proofs/:id/approve           — creator only
//   POST /api/v1/proofs/:id/reject            — creator only, body.reason

/**
 * Shared gate for proof submission. Returns [$acceptance, $challenge, $authUser]
 * or short-circuits with a JSON error. Caller is the acceptor; challenge is
 * international; phase is not terminal-rejected/-approved.
 */
function gateProofSubmit(string $acceptanceId): array
{
    if (!preg_match('/^[a-f0-9]{16}$/', $acceptanceId)) {
        Response::json(['error' => 'Invalid acceptanceId'], 400);
    }
    $authUser   = AuthService::requireAuth();
    $acceptance = ChallengeAcceptanceRepository::findById($acceptanceId);
    if ($acceptance === null) {
        Response::json(['error' => 'Acceptance not found'], 404);
    }
    if ($acceptance['acceptor_user_id'] !== $authUser['id']) {
        Response::json(['error' => 'Not your acceptance'], 403);
    }
    $challenge = ChallengeRepository::findByIdUnchecked($acceptance['challenge_id']);
    if ($challenge === null) {
        Response::json(['error' => 'Challenge not found'], 404);
    }
    if (($challenge['mode'] ?? 'local') !== 'international') {
        Response::json(['error' => 'Proof submission is only for international challenges', 'code' => 'wrong_mode'], 403);
    }
    if (in_array($acceptance['phase'] ?? '', ['approved', 'rejected'], true)) {
        Response::json(['error' => 'This take-on is closed', 'code' => 'terminal'], 403);
    }
    return [$acceptance, $challenge, $authUser];
}

/**
 * Shared gate for proof review (approve/reject). Returns [$proof, $acceptance,
 * $challenge, $authUser]. Caller is the challenge creator.
 */
function gateProofReview(string $proofId): array
{
    if (!preg_match('/^[a-f0-9]{32}$/', $proofId)) {
        Response::json(['error' => 'Invalid proofId'], 400);
    }
    $authUser = AuthService::requireAuth();
    $proof    = ChallengeProofRepository::findById($proofId);
    if ($proof === null) {
        Response::json(['error' => 'Proof not found'], 404);
    }
    $acceptance = ChallengeAcceptanceRepository::findById($proof['acceptance_id']);
    if ($acceptance === null) {
        Response::json(['error' => 'Acceptance not found'], 404);
    }
    $challenge = ChallengeRepository::findByIdUnchecked($acceptance['challenge_id']);
    if ($challenge === null) {
        Response::json(['error' => 'Challenge not found'], 404);
    }
    if (($challenge['created_by'] ?? null) !== $authUser['id']) {
        Response::json(['error' => 'Only the creator can review proofs'], 403);
    }
    return [$proof, $acceptance, $challenge, $authUser];
}

// POST /api/v1/acceptances/{acceptanceId}/submit-proof
// body: { mediaUrl, mediaType: 'image'|'video', lat, lng }
$router->add('POST', '/api/v1/acceptances/{acceptanceId}/submit-proof', function (array $params) {
    [$acceptance, $challenge, $authUser] = gateProofSubmit($params['acceptanceId'] ?? '');
    $acceptanceId = $acceptance['id'];

    $body = Request::json();
    if (!is_array($body)) {
        Response::json(['error' => 'Invalid JSON body'], 400);
    }
    $mediaUrl  = $body['mediaUrl']  ?? null;
    $mediaType = $body['mediaType'] ?? null;
    $latRaw    = $body['lat']       ?? null;
    $lngRaw    = $body['lng']       ?? null;

    if (!is_string($mediaUrl) || $mediaUrl === '') {
        Response::json(['error' => 'mediaUrl is required'], 400);
    }
    if (!in_array($mediaType, ['image', 'video'], true)) {
        Response::json(['error' => "mediaType must be 'image' or 'video'"], 400);
    }
    if (!is_numeric($latRaw) || !is_numeric($lngRaw)) {
        Response::json(['error' => 'lat and lng are required and must be numeric'], 400);
    }
    $lat = (float) $latRaw;
    $lng = (float) $lngRaw;
    if ($lat < -90.0 || $lat > 90.0 || $lng < -180.0 || $lng > 180.0) {
        Response::json(['error' => 'lat/lng out of range'], 400);
    }

    // 3-attempt cap. We enforce in the route (not the DB) so we can flex
    // later without a migration. Bounded at the create-row level — no
    // way for a client to bypass via concurrency unless they pre-stuff
    // the table directly.
    $attempts = ChallengeProofRepository::attemptCountByAcceptance($acceptanceId);
    if ($attempts >= ChallengeProofRepository::MAX_ATTEMPTS) {
        Response::json([
            'error' => 'Maximum proof attempts reached',
            'code'  => 'max_attempts',
            'attempts' => $attempts,
            'maxAttempts' => ChallengeProofRepository::MAX_ATTEMPTS,
        ], 403);
    }

    // Geotag verification (only when target_city_id is set). The result is
    // stored on the row so the creator's review UI can render "geotag
    // verified ✓" or "geotag mismatch" without recomputing.
    $geotagOk = ChallengeProofGeotag::verify($challenge['target_city_id'] ?? null, $lat, $lng);

    enforceRateLimit('challenge_proof_submit', 10, 3600, $authUser['id']);

    try {
        $proof = ChallengeProofRepository::create($acceptanceId, $mediaUrl, $mediaType, $lat, $lng, $geotagOk);
    } catch (\Throwable $e) {
        error_log('[proof] insert failed acc=' . $acceptanceId . ': ' . $e->getMessage());
        Response::json(['error' => 'Failed to submit proof'], 500);
    }
    if ($proof === null) {
        Response::json(['error' => 'Failed to submit proof'], 500);
    }

    // Flip acceptance phase → 'proof_submitted' so the UI lifts the
    // submission CTA and shows "waiting for verdict". We don't expose a
    // dedicated repo method (one-line update); keep it inline for now.
    Database::pdo()->prepare("
        UPDATE challenge_acceptances SET phase = 'proof_submitted', updated_at = now()
        WHERE id = ?
    ")->execute([$acceptanceId]);

    // Push to the creator — they have a proof to review. English placeholder
    // body; step 5 wires NotificationI18n for the 18 non-EN locales.
    try {
        if (!empty($challenge['created_by'])) {
            $acceptorName = $authUser['display_name'] ?? 'Someone';
            NotificationRepository::create(
                $challenge['created_by'],
                'challenge_proof_submitted',
                "📸 New proof to review",
                "{$acceptorName} sent proof for \"{$challenge['title']}\"",
                [
                    'challengeId'    => $challenge['id'],
                    'acceptanceId'   => $acceptanceId,
                    'proofId'        => $proof['id'],
                    'acceptorName'   => $acceptorName,
                    'challengeTitle' => $challenge['title'] ?? '',
                ],
            );
        }
    } catch (\Throwable $e) {
        error_log('[proof] submit push failed (non-fatal): ' . $e->getMessage());
    }

    AnalyticsService::defer('challenge_proof_submitted', $authUser['id'], [
        'challenge_id'  => $challenge['id'],
        'acceptance_id' => $acceptanceId,
        'attempt'       => $attempts + 1,
        'geotag_ok'     => $geotagOk,
    ]);

    Response::json([
        'proof'       => $proof,
        'attempt'     => $attempts + 1,
        'maxAttempts' => ChallengeProofRepository::MAX_ATTEMPTS,
    ], 201);
});

// POST /api/v1/proofs/{proofId}/approve
$router->add('POST', '/api/v1/proofs/{proofId}/approve', function (array $params) {
    [$proof, $acceptance, $challenge, $authUser] = gateProofReview($params['proofId'] ?? '');
    $proofId      = $proof['id'];
    $acceptanceId = $acceptance['id'];

    if ($proof['status'] !== 'pending') {
        // Idempotent — already-terminal is a no-op success.
        Response::json(['proof' => $proof]);
    }

    try {
        $updated = ChallengeProofRepository::approve($proofId);
    } catch (\Throwable $e) {
        error_log('[proof] approve failed proof=' . $proofId . ': ' . $e->getMessage());
        Response::json(['error' => 'Failed to approve'], 500);
    }
    if ($updated === null) {
        Response::json(['error' => 'Failed to approve'], 500);
    }

    // Promote the parent acceptance to 'approved' — final state, mirror the
    // Local verdict flow so client phase logic stays uniform.
    Database::pdo()->prepare("
        UPDATE challenge_acceptances
        SET phase = 'approved', approved_at = now(), updated_at = now()
        WHERE id = ?
    ")->execute([$acceptanceId]);

    // Push to the acceptor — they nailed it.
    try {
        if (!empty($acceptance['acceptor_user_id'])) {
            $creatorName = $authUser['display_name'] ?? 'The creator';
            NotificationRepository::create(
                $acceptance['acceptor_user_id'],
                'challenge_proof_approved',
                "🎉 Proof approved",
                "{$creatorName} approved your proof for \"{$challenge['title']}\"",
                [
                    'challengeId'    => $challenge['id'],
                    'acceptanceId'   => $acceptanceId,
                    'proofId'        => $proofId,
                    'creatorName'    => $creatorName,
                    'challengeTitle' => $challenge['title'] ?? '',
                ],
            );
        }
    } catch (\Throwable $e) {
        error_log('[proof] approve push failed (non-fatal): ' . $e->getMessage());
    }

    AnalyticsService::defer('challenge_proof_approved', $authUser['id'], [
        'challenge_id'  => $challenge['id'],
        'acceptance_id' => $acceptanceId,
        'proof_id'      => $proofId,
    ]);

    Response::json(['proof' => $updated]);
});

// POST /api/v1/proofs/{proofId}/reject
// body: { reason: string (1–200 chars, required) }
$router->add('POST', '/api/v1/proofs/{proofId}/reject', function (array $params) {
    [$proof, $acceptance, $challenge, $authUser] = gateProofReview($params['proofId'] ?? '');
    $proofId      = $proof['id'];
    $acceptanceId = $acceptance['id'];

    $body   = Request::json();
    $reason = $body['reason'] ?? null;
    if (!is_string($reason)) {
        Response::json(['error' => 'reason is required'], 400);
    }
    $reason = trim(strip_tags($reason));
    if ($reason === '') {
        Response::json(['error' => 'reason cannot be empty'], 400);
    }
    if (mb_strlen($reason) > 200) {
        Response::json(['error' => 'reason must be 200 characters or fewer'], 400);
    }

    if ($proof['status'] !== 'pending') {
        Response::json(['proof' => $proof]);
    }

    try {
        $updated = ChallengeProofRepository::reject($proofId, $reason);
    } catch (\Throwable $e) {
        error_log('[proof] reject failed proof=' . $proofId . ': ' . $e->getMessage());
        Response::json(['error' => 'Failed to reject'], 500);
    }
    if ($updated === null) {
        Response::json(['error' => 'Failed to reject'], 500);
    }

    // If this rejection was the acceptor's MAX_ATTEMPTS-th try, terminally
    // close the acceptance. Otherwise keep phase='proof_submitted' so the
    // acceptor can re-submit (UI will offer "Try again" with attempts left).
    $attempts = ChallengeProofRepository::attemptCountByAcceptance($acceptanceId);
    $isFinal  = $attempts >= ChallengeProofRepository::MAX_ATTEMPTS;
    if ($isFinal) {
        Database::pdo()->prepare("
            UPDATE challenge_acceptances
            SET phase = 'rejected', rejected_at = now(), updated_at = now()
            WHERE id = ?
        ")->execute([$acceptanceId]);
    }

    // Push to the acceptor — reason carries verbatim in the body so they
    // know what to fix on re-submit.
    try {
        if (!empty($acceptance['acceptor_user_id'])) {
            $creatorName = $authUser['display_name'] ?? 'The creator';
            $body        = $isFinal
                ? "{$creatorName} rejected your proof for \"{$challenge['title']}\" — no more attempts"
                : "{$creatorName} rejected your proof for \"{$challenge['title']}\". Reason: {$reason}";
            NotificationRepository::create(
                $acceptance['acceptor_user_id'],
                'challenge_proof_rejected',
                "✕ Proof rejected",
                $body,
                [
                    'challengeId'     => $challenge['id'],
                    'acceptanceId'    => $acceptanceId,
                    'proofId'         => $proofId,
                    'creatorName'     => $creatorName,
                    'challengeTitle'  => $challenge['title'] ?? '',
                    'rejectionReason' => $reason,
                    'attemptsLeft'    => max(0, ChallengeProofRepository::MAX_ATTEMPTS - $attempts),
                    'isFinal'         => $isFinal,
                ],
            );
        }
    } catch (\Throwable $e) {
        error_log('[proof] reject push failed (non-fatal): ' . $e->getMessage());
    }

    AnalyticsService::defer('challenge_proof_rejected', $authUser['id'], [
        'challenge_id'  => $challenge['id'],
        'acceptance_id' => $acceptanceId,
        'proof_id'      => $proofId,
        'is_final'      => $isFinal,
        'attempts'      => $attempts,
    ]);

    Response::json([
        'proof'        => $updated,
        'isFinal'      => $isFinal,
        'attemptsLeft' => max(0, ChallengeProofRepository::MAX_ATTEMPTS - $attempts),
    ]);
});

// GET /api/v1/acceptances/{acceptanceId}/proofs
// Both acceptor and creator can list — acceptor sees their attempts history;
// creator sees the queue. Returns at most MAX_ATTEMPTS rows (bounded by FK).
$router->add('GET', '/api/v1/acceptances/{acceptanceId}/proofs', function (array $params) {
    $acceptanceId = $params['acceptanceId'] ?? '';
    if (!preg_match('/^[a-f0-9]{16}$/', $acceptanceId)) {
        Response::json(['error' => 'Invalid acceptanceId'], 400);
    }
    $authUser   = AuthService::requireAuth();
    $acceptance = ChallengeAcceptanceRepository::findById($acceptanceId);
    if ($acceptance === null) {
        Response::json(['error' => 'Acceptance not found'], 404);
    }
    $challenge = ChallengeRepository::findByIdUnchecked($acceptance['challenge_id']);
    if ($challenge === null) {
        Response::json(['error' => 'Challenge not found'], 404);
    }
    $isAcceptor = $acceptance['acceptor_user_id'] === $authUser['id'];
    $isCreator  = ($challenge['created_by'] ?? null) === $authUser['id'];
    if (!$isAcceptor && !$isCreator) {
        Response::json(['error' => 'Not allowed'], 403);
    }
    Response::json([
        'proofs'      => ChallengeProofRepository::listByAcceptance($acceptanceId),
        'attempts'    => ChallengeProofRepository::attemptCountByAcceptance($acceptanceId),
        'maxAttempts' => ChallengeProofRepository::MAX_ATTEMPTS,
    ]);
});

// GET /api/v1/me/acceptances
// "My threads" — every acceptance where I'm either the acceptor OR the creator.
// One enriched row per thread: challenge metadata + counter-party + last-message
// preview. Sorted by last activity. Capped at 100 (bounded read for low egress).
$router->add('GET', '/api/v1/me/acceptances', function () {
    $authUser = AuthService::requireAuth();
    Response::json([
        'threads' => ChallengeAcceptanceRepository::getMineWithMeta($authUser['id']),
    ]);
});

// GET /api/v1/me/scores
// Caller's cached scores (alltime + this month) and bounded ranks in their
// current city + globally — both alltime and this-month.
//
// "Bounded" means each rank query is capped at scanning at most TOP_N+1 = 101
// candidate rows. We use the strictly-greater COUNT trick wrapped in a LIMIT:
//
//   SELECT COUNT(*) FROM (
//     SELECT 1 FROM users
//     WHERE score_alltime > :caller_score AND deleted_at IS NULL
//     LIMIT 101
//   ) bounded
//
// The inner LIMIT caps work at 101 ROWS RETURNED — for callers in the top 100
// the scan stops near-immediately. For callers below the top 100 the scan may
// continue further (up to a full table scan without an index — see indexing
// note below) but the result is still capped at "out of top 100" and the
// inner LIMIT ensures we never emit more than 101 rows over the network.
//
// Rank semantics: standard competition ranking. N users with strictly higher
// scores → caller rank = N+1, so a tie at the top is rank 1 for everyone tied.
// Beyond TOP_N → rank=null, the response carries top_n so the client can
// render "100+" or "—".
//
// Indexes: idx_users_current_city already exists for the city slice;
// users_score_alltime_desc + users_score_month_desc are added in migrate.php
// in the same patch as this route. They make the global queries truly
// bounded regardless of caller rank.
//
// Stale score_month: the trigger only refreshes users.score_month on the
// next earning event, so a user who earned in May and not since carries May's
// score on the row through June. We compare users.score_month_ref to the
// current calendar month (UTC, same expression the trigger uses) and treat
// any mismatch as 0 — both for the caller and for the global comparand.
$router->add('GET', '/api/v1/me/scores', function () {
    $authUser = AuthService::requireAuth();
    $callerId = $authUser['id'];

    $pdo = Database::pdo();

    $stmt = $pdo->prepare("
        SELECT score_alltime, score_month, score_month_ref, current_city_id
        FROM users
        WHERE id = ?
    ");
    $stmt->execute([$callerId]);
    $me = $stmt->fetch(\PDO::FETCH_ASSOC);
    if (!$me) {
        Response::json(['error' => 'User not found'], 404);
    }

    $alltime      = (int) $me['score_alltime'];
    $cachedMonth  = (int) $me['score_month'];
    $monthRef     = $me['score_month_ref'];   // 'YYYY-MM' or null
    $cityId       = $me['current_city_id'];   // 'city_<int>' or null

    $currentMonth   = gmdate('Y-m');
    $effectiveMonth = ($monthRef === $currentMonth) ? $cachedMonth : 0;

    $TOP_N = 100;

    $boundedRank = function (string $whereExtra, array $bind) use ($pdo, $TOP_N): array {
        $sql = "
            SELECT COUNT(*) FROM (
                SELECT 1 FROM users
                WHERE {$whereExtra} AND deleted_at IS NULL
                LIMIT " . ($TOP_N + 1) . "
            ) bounded
        ";
        $stmt = $pdo->prepare($sql);
        $stmt->execute($bind);
        $cnt    = (int) $stmt->fetchColumn();
        $inTopN = $cnt < $TOP_N;
        return [$inTopN ? $cnt + 1 : null, $inTopN];
    };

    // Alltime — global.
    [$alltimeGlobalRank] = $boundedRank(
        'score_alltime > :s',
        ['s' => $alltime],
    );

    // Alltime — city (skipped when caller has no current_city_id).
    $alltimeCityRank = null;
    if ($cityId !== null) {
        [$alltimeCityRank] = $boundedRank(
            'score_alltime > :s AND current_city_id = :c',
            ['s' => $alltime, 'c' => $cityId],
        );
    }

    // Monthly — global. Comparand restricted to users whose cached month_ref
    // matches the current month, so a stale row from a prior month never
    // outranks an active player whose effective month score is 0.
    [$monthGlobalRank] = $boundedRank(
        'score_month > :s AND score_month_ref = :m',
        ['s' => $effectiveMonth, 'm' => $currentMonth],
    );

    // Monthly — city.
    $monthCityRank = null;
    if ($cityId !== null) {
        [$monthCityRank] = $boundedRank(
            'score_month > :s AND score_month_ref = :m AND current_city_id = :c',
            ['s' => $effectiveMonth, 'm' => $currentMonth, 'c' => $cityId],
        );
    }

    Response::json([
        'score_alltime' => $alltime,
        'score_month'   => $effectiveMonth,
        'month_ref'     => $currentMonth,
        'top_n'         => $TOP_N,
        'rank_alltime' => [
            'city'   => $alltimeCityRank,
            'global' => $alltimeGlobalRank,
        ],
        'rank_month' => [
            'city'   => $monthCityRank,
            'global' => $monthGlobalRank,
        ],
    ]);
});

// PR17 ── Score celebration popin ─────────────────────────────────────────
//
// GET  /api/v1/me/score-celebration
//   Returns the pending "+X points!" celebration: sum of score_events.points
//   the caller has earned strictly AFTER users.score_celebrated_at, plus the
//   current city + global ranks (alltime + this month, same shape as
//   /me/scores). The client opens a popin when `points > 0`, displays the
//   delta + ranks, then acks via POST below. Idempotent — calling twice
//   without acking returns the same payload.
//
// POST /api/v1/me/score-celebration/seen { seen_until }
//   Marks the caller's watermark up to `seen_until` (ISO timestamp returned
//   by the GET). Server clamps so the watermark never decreases — multiple
//   acks with stale timestamps are no-ops.
//
// Frequency: one popin per app open at most, gated client-side. The
// watermark guarantees the same delta is never celebrated twice across
// devices either: device A acks → device B's next GET returns 0.
$router->add('GET', '/api/v1/me/score-celebration', function () {
    $authUser = AuthService::requireAuth();
    $callerId = $authUser['id'];
    $pdo      = Database::pdo();

    // Pull the watermark + cached scores in one shot (reused for the rank
    // queries below — no need to re-read).
    $stmt = $pdo->prepare("
        SELECT score_alltime, score_month, score_month_ref,
               current_city_id, score_celebrated_at
        FROM users
        WHERE id = ?
    ");
    $stmt->execute([$callerId]);
    $me = $stmt->fetch(\PDO::FETCH_ASSOC);
    if (!$me) {
        Response::json(['error' => 'User not found'], 404);
    }

    // Aggregate the unacknowledged events. `'-infinity'::timestamptz` is the
    // canonical Postgres sentinel for "any timestamp is greater" — handles
    // the very-first-launch case where the column might still be NULL
    // despite the backfill (defensive; shouldn't happen post-migration).
    // We also pull the top kind (largest single contribution) so the client
    // can render a contextual subtitle per challenge step.
    $watermark = $me['score_celebrated_at']; // may be NULL on a never-migrated row
    $aggStmt   = $pdo->prepare("
        SELECT
            COALESCE(SUM(points), 0)                                  AS total_points,
            COUNT(*)                                                  AS event_count,
            COALESCE(MAX(created_at), NULL)                           AS max_created_at
        FROM score_events
        WHERE user_id = :uid
          AND created_at > COALESCE(:wm::timestamptz, '-infinity'::timestamptz)
    ");
    $aggStmt->execute(['uid' => $callerId, 'wm' => $watermark]);
    $agg          = $aggStmt->fetch(\PDO::FETCH_ASSOC) ?: [];
    $totalPoints  = (int) ($agg['total_points'] ?? 0);
    $eventCount   = (int) ($agg['event_count']  ?? 0);
    $maxCreatedAt = $agg['max_created_at'] ?? null;

    // Short-circuit when there's nothing to celebrate — keeps the wire
    // payload tiny and the client's "has popin to show" check trivial.
    if ($totalPoints <= 0) {
        Response::json(['points' => 0]);
    }

    // Top-kind lookup — the kind that contributed the most. Ties broken by
    // most recent first (so a +30 debrief outranks a stale +5 acceptance).
    $topStmt = $pdo->prepare("
        SELECT kind, SUM(points) AS pts
        FROM score_events
        WHERE user_id = :uid
          AND created_at > COALESCE(:wm::timestamptz, '-infinity'::timestamptz)
        GROUP BY kind
        ORDER BY pts DESC, MAX(created_at) DESC
        LIMIT 1
    ");
    $topStmt->execute(['uid' => $callerId, 'wm' => $watermark]);
    $topRow  = $topStmt->fetch(\PDO::FETCH_ASSOC) ?: [];
    $topKind = $topRow['kind'] ?? null;

    // Ranks — same bounded-LIMIT-101 trick as /me/scores. The caller's
    // cached score columns are already up to date (sync_user_scores trigger
    // fired on each score_events INSERT), so we can rank against them
    // directly without re-aggregating the ledger.
    $alltime      = (int) $me['score_alltime'];
    $cachedMonth  = (int) $me['score_month'];
    $monthRef     = $me['score_month_ref'];
    $cityId       = $me['current_city_id'];
    $currentMonth = gmdate('Y-m');
    $effectiveMonth = ($monthRef === $currentMonth) ? $cachedMonth : 0;
    $TOP_N        = 100;

    $boundedRank = function (string $whereExtra, array $bind) use ($pdo, $TOP_N): ?int {
        $sql = "
            SELECT COUNT(*) FROM (
                SELECT 1 FROM users
                WHERE {$whereExtra} AND deleted_at IS NULL
                LIMIT " . ($TOP_N + 1) . "
            ) bounded
        ";
        $stmt = $pdo->prepare($sql);
        $stmt->execute($bind);
        $cnt = (int) $stmt->fetchColumn();
        return $cnt < $TOP_N ? $cnt + 1 : null;
    };

    $alltimeGlobalRank = $boundedRank(
        'score_alltime > :s',
        ['s' => $alltime],
    );
    $alltimeCityRank = $cityId === null ? null : $boundedRank(
        'score_alltime > :s AND current_city_id = :c',
        ['s' => $alltime, 'c' => $cityId],
    );
    $monthGlobalRank = $boundedRank(
        'score_month > :s AND score_month_ref = :m',
        ['s' => $effectiveMonth, 'm' => $currentMonth],
    );
    $monthCityRank = $cityId === null ? null : $boundedRank(
        'score_month > :s AND score_month_ref = :m AND current_city_id = :c',
        ['s' => $effectiveMonth, 'm' => $currentMonth, 'c' => $cityId],
    );

    // City name for the popin's "in {{city}}" copy. The city catalog lookup
    // is in-memory (CityRepository::load() caches per request) so this is
    // free.
    $cityName    = null;
    $cityCountry = null;
    if ($cityId !== null && preg_match('/^city_(\d+)$/', $cityId, $cm)) {
        $cityRow = CityRepository::findById((int) $cm[1]);
        if ($cityRow !== null) {
            $cityName    = $cityRow['name']    ?? null;
            $cityCountry = $cityRow['country'] ?? null;
        }
    }

    // Per-event breakdown — the popin's "what did I just earn?" surface.
    // Title comes from channel_challenges; LEFT JOIN handles the rare case
    // of a deleted challenge (we keep the event row but render a fallback
    // label client-side). Capped at EVENT_LIMIT to keep the wire small and
    // the modal scannable — the headline +X covers totals beyond the cap.
    $EVENT_LIMIT  = 6;
    $eventStmt    = $pdo->prepare("
        SELECT
            se.id,
            se.challenge_id,
            se.kind,
            se.role,
            se.points,
            se.created_at,
            cc.title AS challenge_title
        FROM score_events se
        LEFT JOIN channel_challenges cc ON cc.channel_id = se.challenge_id
        WHERE se.user_id = :uid
          AND se.created_at > COALESCE(:wm::timestamptz, '-infinity'::timestamptz)
        ORDER BY se.created_at DESC
        LIMIT :lim
    ");
    $eventStmt->bindValue(':uid', $callerId);
    $eventStmt->bindValue(':wm',  $watermark);
    $eventStmt->bindValue(':lim', $EVENT_LIMIT, \PDO::PARAM_INT);
    $eventStmt->execute();
    $events = array_map(static function (array $row): array {
        return [
            'id'              => $row['id'],
            'challenge_id'    => $row['challenge_id'],
            'challenge_title' => $row['challenge_title'], // may be null if deleted
            'kind'            => $row['kind'],
            'role'            => $row['role'],
            'points'          => (int) $row['points'],
            'created_at'      => $row['created_at'],
        ];
    }, $eventStmt->fetchAll(\PDO::FETCH_ASSOC) ?: []);

    Response::json([
        'points'       => $totalPoints,
        'event_count'  => $eventCount,
        'top_kind'     => $topKind,
        'events'       => $events,                                // PR17.1
        'events_truncated' => $eventCount > $EVENT_LIMIT,         // PR17.1
        'seen_until'   => $maxCreatedAt,
        'city_id'      => $cityId,
        'city_name'    => $cityName,
        'city_country' => $cityCountry,
        'top_n'        => $TOP_N,
        'rank_alltime' => [
            'city'   => $alltimeCityRank,
            'global' => $alltimeGlobalRank,
        ],
        'rank_month' => [
            'city'   => $monthCityRank,
            'global' => $monthGlobalRank,
        ],
    ]);
});

$router->add('POST', '/api/v1/me/score-celebration/seen', function () {
    $authUser = AuthService::requireAuth();
    $callerId = $authUser['id'];

    $body      = json_decode(file_get_contents('php://input') ?: '{}', true) ?: [];
    $seenUntil = trim((string) ($body['seen_until'] ?? ''));
    if ($seenUntil === '') {
        Response::json(['error' => 'seen_until required'], 400);
    }

    // GREATEST clamps so a stale ack from a slow client can't roll the
    // watermark back. Postgres' GREATEST(null, x) yields null, hence the
    // explicit COALESCE — without it, a row whose score_celebrated_at is
    // still NULL would stay NULL after this ack.
    $stmt = Database::pdo()->prepare("
        UPDATE users
           SET score_celebrated_at = GREATEST(
               COALESCE(score_celebrated_at, '-infinity'::timestamptz),
               :su::timestamptz
           )
         WHERE id = :uid
    ");
    $stmt->execute(['su' => $seenUntil, 'uid' => $callerId]);

    Response::json(['ok' => true]);
});

// GET /api/v1/me/rate-prompts
// Single bounded read returning the caller's currently rate-eligible
// challenges. The client polls this on app open / threads-screen mount and
// surfaces an in-app prompt; there is intentionally NO server-driven push,
// per the on-app-open decision in the (B) audit.
//
// Eligibility — same gate as POST /ratings, expressed as a list filter:
//   - mode='local'                              (International uses proofs)
//   - caller is creator OR active acceptor
//   - acceptance phase = 'scheduled' AND meetup ended  (effective 'debrief'),
//       OR phase = 'approved'                          (legacy / post-trigger)
//   - caller has NOT already rated this challenge
//
// `other_rated` lets the UI warm the prompt copy ("they're waiting on you")
// vs. neutral. Sorted oldest-meetup-first so the most-overdue prompt is at
// the top of the banner stack. LIMIT 50 — above any realistic backlog; we
// log if we hit it.
$router->add('GET', '/api/v1/me/rate-prompts', function () {
    $authUser = AuthService::requireAuth();
    $callerId = $authUser['id'];

    $LIMIT = 50;

    $stmt = Database::pdo()->prepare("
        SELECT
            ca.id                                                AS acceptance_id,
            cc.channel_id                                        AS challenge_id,
            cc.title                                             AS challenge_title,
            cc.created_by                                        AS creator_user_id,
            ca.acceptor_user_id,
            EXTRACT(EPOCH FROM
                COALESCE(ca.proposed_ends_at, ca.proposed_starts_at)
            )::INTEGER                                           AS meetup_ended_at,
            ca.phase                                             AS phase,
            creator.display_name                                 AS creator_display_name,
            creator.profile_thumb_photo_url                      AS creator_thumb,
            acceptor.display_name                                AS acceptor_display_name,
            acceptor.profile_thumb_photo_url                     AS acceptor_thumb,
            EXISTS(
                SELECT 1 FROM challenge_ratings cr_other
                WHERE cr_other.challenge_id = cc.channel_id
                  AND cr_other.rater_id = CASE
                      WHEN cc.created_by = :uid THEN ca.acceptor_user_id
                      ELSE cc.created_by
                  END
            )                                                    AS other_rated
        FROM challenge_acceptances ca
        JOIN channel_challenges cc ON cc.channel_id = ca.challenge_id
        JOIN users creator         ON creator.id    = cc.created_by
        JOIN users acceptor        ON acceptor.id   = ca.acceptor_user_id
        WHERE
            (cc.created_by = :uid OR ca.acceptor_user_id = :uid)
            AND cc.mode = 'local'
            AND (
                (ca.phase = 'scheduled'
                 AND ca.proposed_starts_at IS NOT NULL
                 AND COALESCE(ca.proposed_ends_at, ca.proposed_starts_at) < now())
                OR ca.phase = 'approved'
            )
            AND NOT EXISTS (
                SELECT 1 FROM challenge_ratings cr_me
                WHERE cr_me.challenge_id = cc.channel_id
                  AND cr_me.rater_id     = :uid
            )
        ORDER BY COALESCE(ca.proposed_ends_at, ca.proposed_starts_at) ASC
        LIMIT {$LIMIT}
    ");
    $stmt->execute(['uid' => $callerId]);
    $rows = $stmt->fetchAll(\PDO::FETCH_ASSOC);

    if (count($rows) >= $LIMIT) {
        error_log("[rate-prompts] caller {$callerId} hit LIMIT {$LIMIT} — backlog unusually large");
    }

    $prompts = [];
    foreach ($rows as $r) {
        $isChallenger = $r['creator_user_id'] === $callerId;
        $prompts[] = [
            'acceptance_id'   => $r['acceptance_id'],
            'challenge_id'    => $r['challenge_id'],
            'challenge_title' => $r['challenge_title'],
            'role'            => $isChallenger ? 'challenger' : 'taker',
            'counterparty'    => [
                'id'             => $isChallenger ? $r['acceptor_user_id']        : $r['creator_user_id'],
                'displayName'    => $isChallenger ? $r['acceptor_display_name']   : $r['creator_display_name'],
                'thumbAvatarUrl' => $isChallenger ? $r['acceptor_thumb']          : $r['creator_thumb'],
            ],
            'meetup_ended_at' => isset($r['meetup_ended_at']) ? (int) $r['meetup_ended_at'] : null,
            'other_rated'     => (bool) $r['other_rated'],
        ];
    }

    Response::json([
        'prompts' => $prompts,
        'count'   => count($prompts),
    ]);
});

// GET /api/v1/leaderboard
// Powers the MY CITY pill ("You're #N in {city}") AND the dedicated
// Leaderboard screen. Single bounded read; same shape for both surfaces.
//
// Query params:
//   - scope  : 'city' (default) | 'world'
//   - period : 'month' (default) | 'alltime'
//   - limit  : 1..100, default 50
//   - offset : 0..10000, default 0
//   - city_id: optional override for scope='city'; format 'city_<int>'.
//              Falls back to caller's current_city_id when omitted.
//
// All queries are bounded:
//   - World: ORDER BY users.score_alltime / score_month DESC LIMIT/OFFSET on
//     users_score_alltime_desc / users_score_month_desc (idx in migrate.php).
//   - City : aggregates score_events via idx_score_events_city_month. Bounded
//     by city activity (rated challenges × 5 events each), NOT user count.
//
// Caller's own row (me.rank/points) computed with a strictly-greater COUNT
// against the same indexed scan, so a caller outside the page still gets
// their real rank. me.rank=null when the caller has no points in this
// scope/period — UI shows the "play to get on the board" prompt instead.
//
// List ranks are offset+i+1 (no tie-dedup — paginated leaderboard standard).
// me.rank uses true competition ranking, so ties at the top all show
// me.rank=1 if the caller is one of them.
$router->add('GET', '/api/v1/leaderboard', function () {
    $authUser = AuthService::requireAuth();
    $callerId = $authUser['id'];

    $scope  = in_array($_GET['scope']  ?? '', ['city', 'world'],   true) ? $_GET['scope']  : 'city';
    $period = in_array($_GET['period'] ?? '', ['month', 'alltime'], true) ? $_GET['period'] : 'month';

    $limit  = (int) ($_GET['limit']  ?? 50);
    if ($limit < 1)   $limit = 1;
    if ($limit > 100) $limit = 100;

    $offset = (int) ($_GET['offset'] ?? 0);
    if ($offset < 0)     $offset = 0;
    if ($offset > 10000) $offset = 10000;

    $currentMonth = gmdate('Y-m');

    // ── Resolve city for scope='city' ─────────────────────────────────────
    $cityId = null;
    if ($scope === 'city') {
        $cityIdRaw = $_GET['city_id'] ?? null;
        if ($cityIdRaw !== null && $cityIdRaw !== '') {
            if (!preg_match('/^city_[0-9]+$/', (string) $cityIdRaw)) {
                Response::json([
                    'error' => 'city_id must look like city_<integer>',
                    'code'  => 'invalid_city_id',
                ], 400);
            }
            $intId = (int) substr((string) $cityIdRaw, 5);
            if (CityRepository::findById($intId) === null) {
                Response::json(['error' => 'Unknown city', 'code' => 'unknown_city'], 404);
            }
            $cityId = $cityIdRaw;
        } else {
            $stmt = Database::pdo()->prepare("SELECT current_city_id FROM users WHERE id = ?");
            $stmt->execute([$callerId]);
            $cityId = $stmt->fetchColumn() ?: null;
            if ($cityId === null) {
                Response::json([
                    'error' => 'No city set — pick a city before viewing the leaderboard.',
                    'code'  => 'no_city',
                ], 400);
            }
        }
    }

    $pdo = Database::pdo();
    $listRows = [];
    $myPoints = 0;
    $myRank   = null;

    if ($scope === 'world') {
        if ($period === 'alltime') {
            $list = $pdo->prepare("
                SELECT u.id, u.display_name, u.profile_thumb_photo_url, u.score_alltime AS points,
                       city_ch.name AS city_name, city_meta.country AS city_country
                FROM users u
                LEFT JOIN channels city_ch  ON city_ch.id        = u.current_city_id
                LEFT JOIN cities   city_meta ON city_meta.channel_id = u.current_city_id
                WHERE u.deleted_at IS NULL AND u.score_alltime > 0
                ORDER BY u.score_alltime DESC, u.id ASC
                LIMIT :limit OFFSET :offset
            ");
            $list->execute([':limit' => $limit, ':offset' => $offset]);
            $listRows = $list->fetchAll(\PDO::FETCH_ASSOC);

            $me = $pdo->prepare("
                SELECT u.score_alltime AS my_points,
                       (SELECT COUNT(*) FROM users u2
                          WHERE u2.deleted_at IS NULL
                            AND u2.score_alltime > u.score_alltime) + 1 AS my_rank
                FROM users u
                WHERE u.id = ?
            ");
            $me->execute([$callerId]);
            $row = $me->fetch(\PDO::FETCH_ASSOC);
            $myPoints = $row ? (int) $row['my_points'] : 0;
            $myRank   = ($row && $myPoints > 0) ? (int) $row['my_rank'] : null;
        } else {
            $list = $pdo->prepare("
                SELECT u.id, u.display_name, u.profile_thumb_photo_url, u.score_month AS points,
                       city_ch.name AS city_name, city_meta.country AS city_country
                FROM users u
                LEFT JOIN channels city_ch   ON city_ch.id           = u.current_city_id
                LEFT JOIN cities   city_meta ON city_meta.channel_id = u.current_city_id
                WHERE u.deleted_at IS NULL
                  AND u.score_month > 0
                  AND u.score_month_ref = :month
                ORDER BY u.score_month DESC, u.id ASC
                LIMIT :limit OFFSET :offset
            ");
            $list->execute([':month' => $currentMonth, ':limit' => $limit, ':offset' => $offset]);
            $listRows = $list->fetchAll(\PDO::FETCH_ASSOC);

            $me1 = $pdo->prepare("SELECT score_month, score_month_ref FROM users WHERE id = ?");
            $me1->execute([$callerId]);
            $r1 = $me1->fetch(\PDO::FETCH_ASSOC);
            $myPoints = ($r1 && $r1['score_month_ref'] === $currentMonth) ? (int) $r1['score_month'] : 0;

            if ($myPoints > 0) {
                $me2 = $pdo->prepare("
                    SELECT COUNT(*) + 1 FROM users
                    WHERE deleted_at IS NULL
                      AND score_month_ref = :month
                      AND score_month > :mine
                ");
                $me2->execute([':month' => $currentMonth, ':mine' => $myPoints]);
                $myRank = (int) $me2->fetchColumn();
            }
        }
    } else {
        $monthFilterSql = $period === 'month' ? "AND month_ref = :month" : "";

        $list = $pdo->prepare("
            WITH per_user AS (
                SELECT user_id, SUM(points) AS points
                FROM score_events
                WHERE city_id = :city
                  {$monthFilterSql}
                GROUP BY user_id
                HAVING SUM(points) > 0
            )
            SELECT u.id, u.display_name, u.profile_thumb_photo_url, pu.points,
                   city_ch.name AS city_name, city_meta.country AS city_country
            FROM per_user pu
            JOIN users u ON u.id = pu.user_id
            LEFT JOIN channels city_ch   ON city_ch.id           = u.current_city_id
            LEFT JOIN cities   city_meta ON city_meta.channel_id = u.current_city_id
            WHERE u.deleted_at IS NULL
            ORDER BY pu.points DESC, u.id ASC
            LIMIT :limit OFFSET :offset
        ");
        $bind = [':city' => $cityId, ':limit' => $limit, ':offset' => $offset];
        if ($period === 'month') $bind[':month'] = $currentMonth;
        $list->execute($bind);
        $listRows = $list->fetchAll(\PDO::FETCH_ASSOC);

        $me1 = $pdo->prepare("
            SELECT COALESCE(SUM(points), 0) AS my_points
            FROM score_events
            WHERE city_id = :city AND user_id = :uid
              {$monthFilterSql}
        ");
        $b1 = [':city' => $cityId, ':uid' => $callerId];
        if ($period === 'month') $b1[':month'] = $currentMonth;
        $me1->execute($b1);
        $myPoints = (int) $me1->fetchColumn();

        if ($myPoints > 0) {
            $me2 = $pdo->prepare("
                SELECT COUNT(*) + 1 FROM (
                    SELECT user_id
                    FROM score_events
                    WHERE city_id = :city
                      {$monthFilterSql}
                    GROUP BY user_id
                    HAVING SUM(points) > :mine
                ) higher
            ");
            $b2 = [':city' => $cityId, ':mine' => $myPoints];
            if ($period === 'month') $b2[':month'] = $currentMonth;
            $me2->execute($b2);
            $myRank = (int) $me2->fetchColumn();
        }
    }

    $entries = [];
    foreach ($listRows as $i => $r) {
        $entries[] = [
            'rank'           => $offset + $i + 1,
            'user_id'        => $r['id'],
            'displayName'    => $r['display_name'],
            'thumbAvatarUrl' => $r['profile_thumb_photo_url'],
            'points'         => (int) $r['points'],
            // PR13: city + country for world-scope rendering. Null when the
            // user has no current_city_id set yet (rare). UI only renders
            // the pill on scope='world'; city scope hides it as redundant.
            'cityName'       => $r['city_name']    ?? null,
            'cityCountry'    => $r['city_country'] ?? null,
        ];
    }

    Response::json([
        'scope'      => $scope,
        'period'     => $period,
        'city_id'    => $scope === 'city' ? $cityId : null,
        'month_ref'  => $period === 'month' ? $currentMonth : null,
        'limit'      => $limit,
        'offset'     => $offset,
        'entries'    => $entries,
        'me' => [
            'user_id' => $callerId,
            'rank'    => $myRank,
            'points'  => $myPoints,
        ],
    ]);
});

// GET /api/v1/challenges/{challengeId}/acceptances
// Creator-only — list of who took on this challenge. For the challenge
// detail "Threads" tab in the new UI.
$router->add('GET', '/api/v1/challenges/{challengeId}/acceptances', function (array $params) {
    $challengeId = $params['challengeId'] ?? '';
    if (!preg_match('/^[a-f0-9]{16}$/', $challengeId)) {
        Response::json(['error' => 'Invalid challengeId'], 400);
    }
    $authUser  = AuthService::requireAuth();
    // Creator-only — own gate via created_by check below, so visibility
    // is irrelevant here (creator always passes the visibility filter
    // anyway, but unchecked makes the intent explicit).
    $challenge = ChallengeRepository::findByIdUnchecked($challengeId);
    if ($challenge === null || $challenge['created_by'] !== $authUser['id']) {
        Response::json(['error' => 'Not allowed'], 403);
    }
    Response::json([
        'acceptances' => ChallengeAcceptanceRepository::getByChallenge($challengeId),
    ]);
});

// ── Personal invitations ─────────────────────────────────────────────────────
// After publishing, the creator can hand-pick city members and ping them with
// an in-app notification + push (with Accept / Ignore action buttons in the
// notification tray on native). Accepting just runs the same gated take-on
// path everyone else uses — invitations don't bypass mode/in-progress checks.

// POST /api/v1/challenges/{challengeId}/invite — body { userIds: [...] }
$router->add('POST', '/api/v1/challenges/{challengeId}/invite', function (array $params) {
    $challengeId = $params['challengeId'] ?? '';
    if (!preg_match('/^[a-f0-9]{16}$/', $challengeId)) {
        Response::json(['error' => 'Invalid challengeId'], 400);
    }
    $authUser = AuthService::requireAuth();
    $inviter  = $authUser['id'];

    // Unchecked — creator gate below is the real authorization; creator
    // always passes visibility anyway.
    $challenge = ChallengeRepository::findByIdUnchecked($challengeId);
    if ($challenge === null) {
        Response::json(['error' => 'Challenge not found'], 404);
    }
    // Creator-only (the "invite people to take this on" button only shows for
    // the creator anyway — defence in depth).
    if (($challenge['created_by'] ?? null) !== $inviter) {
        Response::json(['error' => 'Only the creator can invite'], 403);
    }

    $body    = json_decode(file_get_contents('php://input'), true) ?? [];
    $userIds = array_values(array_filter(array_unique($body['userIds'] ?? []), fn($v) => is_string($v) && $v !== ''));
    if (empty($userIds)) {
        Response::json(['error' => 'No invitees'], 400);
    }
    // Cap fan-out per call — keeps the in-request loop bounded on non-FPM
    // (every send is in-request). 50 is plenty for a hand-picked list.
    if (count($userIds) > 50) {
        Response::json(['error' => 'Too many invitees (max 50)'], 400);
    }
    // No self-invite.
    $userIds = array_values(array_filter($userIds, fn($u) => $u !== $inviter));

    enforceRateLimit('challenge_invite', 60, 3600, $inviter);

    $inviterName = $authUser['display_name'] ?? 'Someone';
    $title       = $challenge['title'] ?? '';

    // Every selected invitee gets a fresh push. We used to skip people whose
    // invitation row was already 'accepted' on the assumption "they're in the
    // flow, no need to re-ping" — but that broke the creator's mental model:
    // they pick a name, hit send, see "Sent to 0", and assume the feature is
    // broken. A prior acceptance can also be stale (the take-on may have
    // since been cancelled / completed). The recipient is the better judge —
    // we send, the rate limit (60/h per inviter) prevents abuse, the accept
    // endpoint re-checks the take-on gates on tap.
    $sent   = [];
    $failed = [];
    foreach ($userIds as $inviteeId) {
        try {
            $res = ChallengeInvitationRepository::createOrTouch($challengeId, $inviter, $inviteeId);
            if ($res === null) {
                $failed[] = $inviteeId;
                continue;
            }
            $invitation = $res['row'];
            NotificationRepository::create(
                $inviteeId,
                'challenge_invitation',
                "🔥 {$inviterName} challenges you",
                $title,
                [
                    'challengeId'   => $challengeId,
                    'invitationId'  => $invitation['id'],
                    'inviterUserId' => $inviter,
                    'inviterName'   => $inviterName,
                    'challengeTitle'=> $title,
                ],
            );
            $sent[] = $inviteeId;
            error_log("[invite] sent challenge_invitation ch={$challengeId} from={$inviter} to={$inviteeId} invId=" . ($invitation['id'] ?? 'null'));
        } catch (\Throwable $e) {
            error_log('[challenges] invite send failed inv=' . $inviteeId . ': ' . $e->getMessage());
            $failed[] = $inviteeId;
        }
    }

    Response::json([
        'invited' => $sent,
        'count'   => count($sent),
        // `duplicates` kept for back-compat with older clients — now strictly
        // equals failed (the only non-sent bucket).
        'duplicates' => count($failed),
    ], 201);
});

// POST /api/v1/invitations/{invitationId}/accept
// Called from the push action button OR from the in-app notification list.
// Marks the invitation accepted, then forwards into the standard take-on path
// (same gating: mode match, not creator, no in-progress acceptance). If the
// take-on can't proceed (mode mismatch, in-progress…), we still mark the
// invitation accepted but return the gate error so the client can show it.
$router->add('POST', '/api/v1/invitations/{invitationId}/accept', function (array $params) {
    $invitationId = $params['invitationId'] ?? '';
    if (!preg_match('/^[a-f0-9]{32}$/', $invitationId)) {
        Response::json(['error' => 'Invalid invitationId'], 400);
    }
    $authUser   = AuthService::requireAuth();
    $userId     = $authUser['id'];

    $invitation = ChallengeInvitationRepository::findById($invitationId);
    if ($invitation === null) {
        Response::json(['error' => 'Invitation not found'], 404);
    }
    if ($invitation['invitee_user_id'] !== $userId) {
        Response::json(['error' => 'Not your invitation'], 403);
    }

    ChallengeInvitationRepository::respond($invitationId, $userId, 'accepted');

    // Mirror the same gates as /challenges/:id/accept. If any fails, the
    // invitation is marked accepted but we surface the gate error so the
    // client can deep-link them to the challenge page with the right toast.
    $challengeId = $invitation['challenge_id'];
    // Unchecked — the invitation row itself is the authorization. Invitees
    // need to reach private/friends challenges even when they aren't yet
    // in the visibility scope.
    $challenge   = ChallengeRepository::findByIdUnchecked($challengeId);
    if ($challenge === null) {
        Response::json(['error' => 'Challenge not found', 'code' => 'gone'], 404);
    }
    if ($challenge['created_by'] === $userId) {
        Response::json(['error' => 'You created this', 'code' => 'not_creator', 'challengeId' => $challengeId], 403);
    }

    $existing = ChallengeAcceptanceRepository::findExisting($challengeId, $userId);
    if ($existing !== null) {
        Response::json(['acceptance' => $existing, 'challengeId' => $challengeId]);
    }

    // Local-only audience gate (international skips — same logic as
    // POST /challenges/:id/accept).
    $isInternational = ($challenge['mode'] ?? 'local') === 'international';
    if (!$isInternational) {
        $expectedMode = $challenge['audience'] === 'locals' ? 'local' : 'exploring';
        $actualMode   = $authUser['mode'] ?? null;
        if (empty($actualMode) || $actualMode !== $expectedMode) {
            Response::json([
                'error'         => 'Mode required',
                'code'          => empty($actualMode) ? 'mode_required' : 'mode_mismatch',
                'required_mode' => $expectedMode,
                'challengeId'   => $challengeId,
            ], 403);
        }
    }
    if (ChallengeAcceptanceRepository::hasActiveAcceptance($challengeId)) {
        Response::json([
            'error'       => 'In progress',
            'code'        => 'in_progress',
            'challengeId' => $challengeId,
        ], 403);
    }

    // International invitations auto-approve at take-on; Local stays gated.
    $initialPhase = $isInternational ? 'accepted' : 'pending';

    try {
        $acceptance = ChallengeAcceptanceRepository::create($challengeId, $userId, $initialPhase);
    } catch (\Throwable $e) {
        error_log('[invite-accept] take-on create failed ch=' . $challengeId . ' uid=' . $userId . ': ' . $e->getMessage());
        Response::json(['error' => 'Failed to take on'], 500);
    }

    // Broadcast + push to the creator (same as POST /challenges/:id/accept).
    try {
        if (!empty($challenge['created_by'])) {
            broadcastChallengeAcceptedToWs($challenge['created_by'], [
                'acceptance' => $acceptance,
                'challenge'  => [
                    'id'             => $challenge['id'],
                    'title'          => $challenge['title'],
                    'challenge_type' => $challenge['challenge_type'],
                ],
                'acceptor' => [
                    'id'             => $userId,
                    'displayName'    => $authUser['display_name'] ?? null,
                    'thumbAvatarUrl' => $authUser['profile_thumb_photo_url'] ?? null,
                ],
            ]);
        }
    } catch (\Throwable $e) {
        error_log('[invite-accept] ws broadcast failed (non-fatal): ' . $e->getMessage());
    }
    try {
        if (!empty($challenge['created_by'])) {
            $acceptorName = $authUser['display_name'] ?? 'Someone';
            NotificationRepository::create(
                $challenge['created_by'],
                'challenge_takeon_request',
                "🤝 New take-on request",
                "{$acceptorName} wants to take on \"{$challenge['title']}\"",
                [
                    'challengeId'    => $challengeId,
                    'acceptanceId'   => $acceptance['id'],
                    'acceptorName'   => $acceptorName,
                    // Plumbed through so NotificationI18n templates can render
                    // a localized body for non-EN recipients.
                    'challengeTitle' => $challenge['title'] ?? '',
                ],
            );
        }
    } catch (\Throwable $e) {
        error_log('[invite-accept] takeon-request push failed: ' . $e->getMessage());
    }

    Response::json(['acceptance' => $acceptance, 'challengeId' => $challengeId], 201);
});

// POST /api/v1/invitations/{invitationId}/ignore
$router->add('POST', '/api/v1/invitations/{invitationId}/ignore', function (array $params) {
    $invitationId = $params['invitationId'] ?? '';
    if (!preg_match('/^[a-f0-9]{32}$/', $invitationId)) {
        Response::json(['error' => 'Invalid invitationId'], 400);
    }
    $authUser   = AuthService::requireAuth();
    $userId     = $authUser['id'];

    $invitation = ChallengeInvitationRepository::findById($invitationId);
    if ($invitation === null) {
        Response::json(['error' => 'Invitation not found'], 404);
    }
    if ($invitation['invitee_user_id'] !== $userId) {
        Response::json(['error' => 'Not your invitation'], 403);
    }

    $updated = ChallengeInvitationRepository::respond($invitationId, $userId, 'ignored');
    Response::json($updated);
});

// Thread message routes removed — the 1:1 chat between creator + acceptor
// moved into the unified challenge channel (see /challenges/:id/messages).
// Acceptances no longer get an auto-created thread channel; the column
// stays on challenge_acceptances for historical rows but isn't surfaced.

// GET /api/v1/users/{userId}/challenges — challenges the user created or
// accepted, for the profile "Challenges" tab. Each item carries `is_owner`.
$router->add('GET', '/api/v1/users/{userId}/challenges', function (array $params) {
    $userId = $params['userId'] ?? '';
    if (!preg_match('/^[a-f0-9]{32}$/', $userId)) {
        Response::json(['error' => 'Invalid userId'], 400);
    }
    $user = UserRepository::findById($userId) ?? UserRepository::findByGuestId($userId);
    if ($user === null) {
        Response::json(['challenges' => []]);
        return;
    }
    // Visibility-aware: anon visitor sees public-only; logged-in viewer
    // also sees friends rows the profile-owner is in (via friend-of-creator
    // OR friend-of-acceptor branches in the helper) + private rows when
    // the viewer is the counterparty.
    $viewerId = AuthService::currentUser()['id'] ?? null;
    Response::json(['challenges' => ChallengeRepository::getByUser($user['id'], $viewerId)]);
});

// GET /api/v1/challenges/{challengeId}/participants
// LEGACY acceptor list — used by older read paths that want the active taker
// row + display name. Kept for back-compat with the existing mobile build.
// New code uses /channel-participants below.
$router->add('GET', '/api/v1/challenges/{challengeId}/participants', function (array $params) {
    $challengeId = $params['challengeId'] ?? '';
    if (!preg_match('/^[a-f0-9]{16}$/', $challengeId)) {
        Response::json(['error' => 'Invalid challengeId'], 400);
    }
    Response::json([
        'participants' => ChallengeRepository::getParticipants($challengeId),
        'count'        => ChallengeRepository::participantCount($challengeId),
    ]);
});

// GET /api/v1/challenges/{challengeId}/channel-participants
// Publicly visible list of channel members (people who clicked Join). Per
// spec the list is open — anyone can see who's in. Creator + active taker
// are NOT injected here (they have their own surfaces); a UI overlay
// composes "Challenger / Taker / Members" client-side.
//
// Capped at 100; clients can paginate later if a single challenge ever
// reaches that bound.
$router->add('GET', '/api/v1/challenges/{challengeId}/channel-participants', function (array $params) {
    $challengeId = $params['challengeId'] ?? '';
    if (!preg_match('/^[a-f0-9]{16}$/', $challengeId)) {
        Response::json(['error' => 'Invalid challengeId'], 400);
    }
    // Visibility-aware: anon hitting a friends/private challenge gets 404
    // (matches the rest of the surface; the list reveals existence too).
    $viewerId  = AuthService::currentUser()['id'] ?? null;
    if (ChallengeRepository::findById($challengeId, $viewerId) === null) {
        Response::json(['error' => 'Challenge not found'], 404);
    }
    Response::json([
        'members' => ChallengeParticipantRepository::listForChannel($challengeId, 100),
        'count'   => ChallengeParticipantRepository::countForChannel($challengeId),
    ]);
});

// GET /api/v1/challenges/{challengeId}/messages
// Channel chat — participation-gated. Creator + active acceptor are implicit
// participants; everyone else needs a challenge_participants row (created by
// clicking "Join this challenge"). Non-participants get 403 with
// code:'not_participant' so the client can render the public detail page
// instead of the chat.
$router->add('GET', '/api/v1/challenges/{challengeId}/messages', function (array $params) {
    $challengeId = $params['challengeId'] ?? '';
    if (!preg_match('/^[a-f0-9]{16}$/', $challengeId)) {
        Response::json(['error' => 'Invalid challengeId'], 400);
    }

    try {
        $viewerId = AuthService::currentUser()['id'] ?? null;
        // Visibility-aware existence check — anon/out-of-scope viewers
        // can't read messages on a friends/private challenge.
        if (ChallengeRepository::findById($challengeId, $viewerId) === null) {
            Response::json(['error' => 'Challenge not found'], 404);
        }
        // Participation gate. Anon viewers never pass; registered viewers
        // pass on creator / active-taker / join-row branches.
        if (!ChallengeParticipantRepository::isParticipant($challengeId, $viewerId)) {
            Response::json([
                'error' => 'Join this challenge to read the conversation.',
                'code'  => 'not_participant',
            ], 403);
        }

        $beforeId = isset($_GET['before_id']) && is_string($_GET['before_id']) ? trim($_GET['before_id']) : null;
        $limit    = min(100, max(1, (int) ($_GET['limit'] ?? 50)));
        $res = MessageRepository::getByChannel($challengeId, $beforeId ?: null, $limit);
        Response::json(['messages' => $res['messages'], 'hasMore' => $res['hasMore']]);
    } catch (\Throwable $e) {
        error_log('[challenge-messages] GET failed for challenge ' . $challengeId . ': ' . $e->getMessage());
        Response::json(['error' => 'Failed to load messages'], 500);
    }
});

// POST /api/v1/challenges/{challengeId}/messages
// Send a message in the participation-gated channel. Only participants
// (creator / active taker implicitly, anyone else who joined) can post.
// Guest senders no longer have a path in — the new model is registered-only.
$router->add('POST', '/api/v1/challenges/{challengeId}/messages', function (array $params) {
    $challengeId = $params['challengeId'] ?? '';
    if (!preg_match('/^[a-f0-9]{16}$/', $challengeId)) {
        Response::json(['error' => 'Invalid challengeId'], 400);
    }

    // Visibility-aware — anon/out-of-scope can't post to a friends/private
    // challenge.
    $viewerIdForVisibility = AuthService::currentUser()['id'] ?? null;
    if (ChallengeRepository::findById($challengeId, $viewerIdForVisibility) === null) {
        Response::json(['error' => 'Challenge not found'], 404);
    }
    // Participation gate — same shape as the GET. Non-participants get a
    // friendlier 403 so the client can prompt them to Join first.
    if (!ChallengeParticipantRepository::isParticipant($challengeId, $viewerIdForVisibility)) {
        Response::json([
            'error' => 'Join this challenge to post in the conversation.',
            'code'  => 'not_participant',
        ], 403);
    }

    $body = Request::json();
    if ($body === null) {
        Response::json(['error' => 'Invalid JSON body'], 400);
    }

    $guestId  = $body['guestId']  ?? null;
    $nickname = $body['nickname'] ?? null;
    $content  = $body['content']  ?? null;
    $type     = $body['type']     ?? 'text';
    $imageUrl = $body['imageUrl'] ?? null;

    enforceRateLimit('challenge_message', 45, 300, $challengeId);

    if (!isValidGuestId($guestId)) {
        Response::json(['error' => 'guestId is required'], 400);
    }
    if (empty($nickname) || !is_string($nickname)) {
        Response::json(['error' => 'nickname is required'], 400);
    }
    $nickname = mb_substr(trim(strip_tags($nickname)), 0, 32);
    if ($nickname === '') {
        Response::json(['error' => 'nickname must not be empty'], 400);
    }
    if (!in_array($type, ['text', 'image'], true)) {
        Response::json(['error' => 'type must be text or image'], 400);
    }

    $senderUser   = AuthService::currentUser();
    $senderUserId = $senderUser['id'] ?? null;

    if ($type === 'image') {
        if (empty($imageUrl) || !is_string($imageUrl)) {
            Response::json(['error' => 'imageUrl is required for image messages'], 400);
        }
        $r2Base = rtrim(getenv('R2_PUBLIC_URL') ?: '', '/') . '/';
        if (!str_starts_with($imageUrl, $r2Base)) {
            Response::json(['error' => 'Invalid image URL'], 400);
        }
        $filename = basename(parse_url($imageUrl, PHP_URL_PATH) ?? '');
        if (!preg_match('/^[a-f0-9]{32}\.(jpg|png|webp)$/', $filename)) {
            Response::json(['error' => 'Invalid image reference'], 400);
        }
        try {
            $message = MessageRepository::addImage($challengeId, $guestId, $nickname, $imageUrl, $senderUserId);
        } catch (\Throwable $e) {
            error_log("[challenge-msg] DB error inserting image message challengeId={$challengeId}: " . $e->getMessage());
            Response::json(['error' => 'Failed to send message'], 500);
        }
    } else {
        if (empty($content) || !is_string($content)) {
            Response::json(['error' => 'content is required'], 400);
        }
        if (strlen($content) > 1000) {
            Response::json(['error' => 'content must not exceed 1000 characters'], 400);
        }
        $modMsgHit = ModerationService::check($content);
        if ($modMsgHit !== null) {
            error_log("[moderation] challenge message blocked challengeId={$challengeId} reason={$modMsgHit['reason']} hit={$modMsgHit['hit']}");
            Response::json([
                'error' => 'Your message was flagged by moderation — please rephrase.',
                'code'  => 'moderation_blocked',
            ], 422);
        }
        try {
            $replySnap = resolveReplySnapshot($body['replyToMessageId'] ?? null);
            $mentions  = sanitizeMentions($body['mentions'] ?? null, 'challenge', $challengeId, $content);
            $message = MessageRepository::add(
                $challengeId, $guestId, $nickname, $content, $senderUserId,
                $replySnap['id'] ?? null,
                $replySnap['nickname'] ?? null,
                $replySnap['content']  ?? null,
                $replySnap['type']     ?? 'text',
                $mentions
            );
        } catch (\Throwable $e) {
            error_log("[challenge-msg] DB error inserting message challengeId={$challengeId}: " . $e->getMessage());
            Response::json(['error' => 'Failed to send message'], 500);
        }
    }

    $message = enrichBroadcastMessage($message, $senderUser ?? null);
    broadcastMessageToWs($challengeId, $message);

    Response::json($message, 201);
});

// ── Challenge privacy votes ─────────────────────────────────────────────────
//
// Mutual go-private flow for Local challenges (International is always
// public, enforced in ChallengeRepository::update/create). Both the creator
// and the single acceptor must vote 'agreed' before the channel flips to
// visibility='private'. Spec confirmed: no notification fires on the
// public → private transition itself (silent flip), only on the initial
// request so the other party knows to respond.

// GET /api/v1/challenges/{challengeId}/privacy
// Returns both vote rows (if any) + a small `state` summary the UI uses
// to render the privacy panel. Available to creator + acceptor only.
$router->add('GET', '/api/v1/challenges/{challengeId}/privacy', function (array $params) {
    $challengeId = $params['challengeId'] ?? '';
    if (!preg_match('/^[a-f0-9]{16}$/', $challengeId)) {
        Response::json(['error' => 'Invalid challengeId'], 400);
    }
    $authUser  = AuthService::requireAuth();
    $userId    = $authUser['id'];
    // Unchecked — privacy view is gated by participation (creator OR
    // acceptor); we don't want to leak the row's existence to friends
    // who happen to see it on the public surface.
    $challenge = ChallengeRepository::findByIdUnchecked($challengeId);
    if ($challenge === null) {
        Response::json(['error' => 'Challenge not found'], 404);
    }

    // Participation is signalled as a flag, not a status code, so the
    // browser console stays clean. Non-participants get a minimal payload
    // (mode + isParticipant=false) — enough for the client to silently
    // hide the panel. International rows are kept on the 200 path too (the
    // panel still has work to do for them: the intl-locked explainer +
    // the current-visibility line).
    $isCreator  = ($challenge['created_by'] ?? null) === $userId;
    $acceptance = ChallengeAcceptanceRepository::findExisting($challengeId, $userId);
    $isAcceptor = $acceptance !== null && ($acceptance['phase'] ?? null) !== 'rejected';
    $mode       = $challenge['mode'] ?? 'local';

    if (!$isCreator && !$isAcceptor) {
        Response::json([
            'mode'              => $mode,
            'currentVisibility' => $challenge['visibility'] ?? 'public',
            'isParticipant'     => false,
            'canVote'           => false,
            'votes'             => [],
        ]);
    }

    $votes        = ($mode === 'local')
        ? ChallengePrivacyRepository::getByChallenge($challengeId)
        : [];
    $byUser       = [];
    foreach ($votes as $v) { $byUser[$v['user_id']] = $v; }
    $myVote       = $byUser[$userId]['status']                     ?? null;
    $creatorVote  = $byUser[$challenge['created_by'] ?? '']['status'] ?? null;
    $acceptorRow  = ChallengeAcceptanceRepository::getByChallenge($challengeId)[0] ?? null;
    $acceptorId   = $acceptorRow['acceptor_user_id'] ?? null;
    $acceptorVote = $acceptorId !== null ? ($byUser[$acceptorId]['status'] ?? null) : null;

    Response::json([
        'mode'              => $mode,
        'currentVisibility' => $challenge['visibility'] ?? 'public',
        'isParticipant'     => true,
        'myVote'            => $myVote,
        'creatorVote'       => $creatorVote,
        'acceptorVote'      => $acceptorVote,
        'acceptorUserId'    => $acceptorId,
        // canVote = Local + counterparty exists + not already private. The
        // panel hides the vote block when this is false (and shows the
        // appropriate hint instead).
        'canVote'           => $mode === 'local'
                                 && $acceptorId !== null
                                 && ($challenge['visibility'] ?? 'public') !== 'private',
        'votes'             => $votes,
    ]);
});

// POST /api/v1/challenges/{challengeId}/privacy/vote — body { vote: 'agreed' | 'denied' }
// Records the caller's vote. On the second 'agreed' we flip visibility to
// 'private' and clear the vote rows (so a future round starts clean).
$router->add('POST', '/api/v1/challenges/{challengeId}/privacy/vote', function (array $params) {
    $challengeId = $params['challengeId'] ?? '';
    if (!preg_match('/^[a-f0-9]{16}$/', $challengeId)) {
        Response::json(['error' => 'Invalid challengeId'], 400);
    }
    $authUser = AuthService::requireAuth();
    $userId   = $authUser['id'];

    $challenge = ChallengeRepository::findByIdUnchecked($challengeId);
    if ($challenge === null) {
        Response::json(['error' => 'Challenge not found'], 404);
    }
    if ($challenge['mode'] !== 'local') {
        Response::json(['error' => 'International challenges are always public', 'code' => 'intl_locked'], 422);
    }
    if (($challenge['visibility'] ?? 'public') === 'private') {
        Response::json(['error' => 'Already private', 'code' => 'already_private'], 409);
    }

    $body = Request::json();
    $vote = is_array($body) ? ($body['vote'] ?? null) : null;
    if (!in_array($vote, ChallengePrivacyRepository::ALLOWED_STATUSES, true)) {
        Response::json([
            'error' => 'vote must be "agreed" or "denied"',
            'code'  => 'invalid_vote',
        ], 400);
    }

    $isCreator  = ($challenge['created_by'] ?? null) === $userId;
    $acceptance = ChallengeAcceptanceRepository::findExisting($challengeId, $userId);
    $isAcceptor = $acceptance !== null && ($acceptance['phase'] ?? null) !== 'rejected';
    if (!$isCreator && !$isAcceptor) {
        Response::json(['error' => 'Not a participant', 'code' => 'not_participant'], 403);
    }

    // Need a counterparty for the mutual flow — refuse the vote if the
    // challenge is still available (no acceptor yet) or the acceptor's
    // row is rejected. Frontend should hide the action in those states
    // anyway; this is defence-in-depth.
    $acceptances = ChallengeAcceptanceRepository::getByChallenge($challengeId);
    $acceptorId  = null;
    foreach ($acceptances as $a) {
        if (($a['phase'] ?? null) !== 'rejected') {
            $acceptorId = $a['acceptor_user_id'];
            break;
        }
    }
    if ($acceptorId === null) {
        Response::json([
            'error' => 'No counterparty — challenge has not been taken on yet',
            'code'  => 'no_counterparty',
        ], 409);
    }

    enforceRateLimit('challenge_privacy_vote', 20, 300, $challengeId);

    ChallengePrivacyRepository::vote($challengeId, $userId, $vote);

    $creatorId = $challenge['created_by'] ?? null;
    $flipped   = false;
    if ($vote === 'agreed' && $creatorId !== null
        && ChallengePrivacyRepository::bothAgreed($challengeId, $creatorId, $acceptorId)) {
        // Use the internal setVisibility — update()'s owner gate would
        // reject the acceptor as caller, and update()'s input rule strips
        // 'private'. Both are correct for the regular edit form; the
        // mutual flow is the one exception.
        ChallengeRepository::setVisibility($challengeId, 'private');
        ChallengePrivacyRepository::reset($challengeId);
        $flipped = true;
    }

    // Notify the other party of the vote (only on first signal, not on the
    // silent flip — spec). We don't push when the action was 'agreed' AND
    // it caused the flip — the other side already voted 'agreed', they
    // know what's happening; the visibility change itself is intentionally
    // quiet (no surprise UI for them).
    if (!$flipped) {
        $otherId = $userId === $creatorId ? $acceptorId : $creatorId;
        if ($otherId !== null) {
            try {
                $voterUser  = UserRepository::findById($userId);
                $voterName  = $voterUser['display_name'] ?? 'Someone';
                $title      = $challenge['title']        ?? 'this challenge';
                $body       = $vote === 'agreed'
                    ? "{$voterName} wants to make \"{$title}\" private — your turn to vote"
                    : "{$voterName} declined to make \"{$title}\" private";
                NotificationRepository::create(
                    $otherId,
                    'challenge_privacy_vote',
                    $vote === 'agreed' ? '🔒 Go private?' : '🔓 Stays public',
                    $body,
                    [
                        'challengeId' => $challengeId,
                        'vote'        => $vote,
                        'voterUserId' => $userId,
                        'voterName'   => $voterName,
                    ]
                );
            } catch (\Throwable $e) {
                error_log('[challenges] privacy-vote notif failed (non-fatal): ' . $e->getMessage());
            }
        }
    }

    Response::json([
        'ok'              => true,
        'myVote'          => $vote,
        'flippedToPrivate' => $flipped,
        'visibility'      => $flipped ? 'private' : ($challenge['visibility'] ?? 'public'),
    ]);
});

// DELETE /api/v1/challenges/{challengeId}/privacy/vote
// Withdraw the caller's vote. Used when a user opens the privacy flow
// then changes their mind before the other party has responded.
$router->add('DELETE', '/api/v1/challenges/{challengeId}/privacy/vote', function (array $params) {
    $challengeId = $params['challengeId'] ?? '';
    if (!preg_match('/^[a-f0-9]{16}$/', $challengeId)) {
        Response::json(['error' => 'Invalid challengeId'], 400);
    }
    $authUser = AuthService::requireAuth();
    $userId   = $authUser['id'];

    $challenge = ChallengeRepository::findByIdUnchecked($challengeId);
    if ($challenge === null) {
        Response::json(['error' => 'Challenge not found'], 404);
    }

    $cleared = ChallengePrivacyRepository::clearVote($challengeId, $userId);
    Response::json(['ok' => true, 'cleared' => $cleared]);
});

// Challenge anonymization endpoints removed — pseudonymous-by-default
// identities already serve this purpose. The SSR layer strips participant
// usernames from indexable HTML/JSON-LD (see composeChallengeJsonLd) so
// crawlers never index member display names anyway; in-app the UI keeps
// showing the real username (chosen by the user, expected by them).

// Challenge comments lane endpoints removed — Hilads channels are
// conversational by default, so we use the unified challenge channel
// (existing /challenges/:id/messages) for ALL chatter. Participant roles
// surface as render-time badges on the message rows (Challenger / Taker).

// GET /api/v1/sitemap/challenges
// All indexable challenges (open + validated) across every city. Validated
// ones stay indexed — they're permanent content, not removed pages. Used by
// apps/web/api/sitemap.mjs to advertise /challenge/<slug>-<id> to crawlers.
// LIMIT 40000 = one sitemap file; realistic counts are far below it.
$router->add('GET', '/api/v1/sitemap/challenges', function () {
    // updated_at is bumped on every edit + validate, so this is a real
    // change-signal — Google re-crawls when the <lastmod> moves. Pre-migration
    // rows defaulted to migration time, so they had a single "everything
    // changed" wave once and then went quiet.
    // Only public challenges are indexable. Friends/private rows are kept
    // out of the sitemap and rely on the per-page meta tag (`noindex` for
    // non-public) to keep crawlers from caching them via direct URL.
    $stmt = Database::pdo()->query("
        SELECT cc.channel_id                              AS id,
               cc.title                                   AS title,
               EXTRACT(EPOCH FROM cc.updated_at)::INTEGER AS updated_at
        FROM channel_challenges cc
        JOIN channels c ON c.id = cc.channel_id
        WHERE c.status = 'active'
          AND cc.visibility = 'public'
        ORDER BY cc.updated_at DESC
        LIMIT 40000
    ");
    $rows = $stmt->fetchAll(\PDO::FETCH_ASSOC);

    Response::json([
        'challenges' => array_map(static fn(array $r) => [
            'id'         => $r['id'],
            'title'      => $r['title'],
            'updated_at' => (int) $r['updated_at'],
        ], $rows),
        'total'      => count($rows),
    ]);
});

// ── TEMPORARY: Sentry test endpoint ──────────────────────────────────────────
// Remove this route once Sentry integration is confirmed.
// Protected: only active when MIGRATION_KEY is set in env.
// Usage: GET /internal/sentry-test?key=YOUR_MIGRATION_KEY
$router->add('GET', '/internal/sentry-test', function () {
    $expectedKey = getenv('MIGRATION_KEY') ?: null;
    if ($expectedKey === null) {
        Response::json(['error' => 'Not found'], 404);
    }
    $providedKey = $_GET['key'] ?? '';
    if (!hash_equals($expectedKey, $providedKey)) {
        Response::json(['error' => 'Forbidden'], 403);
    }

    \Sentry\captureMessage('Hilads backend Sentry test — OK');

    Response::json(['ok' => true, 'message' => 'Sentry test event sent']);
});
// ── END TEMPORARY ─────────────────────────────────────────────────────────────
