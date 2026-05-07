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
//   is_participating, recurrence_label, guest_id, created_by, series_id
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
        ['friend_request_push', 'BOOLEAN NOT NULL DEFAULT TRUE'],
        ['vibe_received_push',  'BOOLEAN NOT NULL DEFAULT TRUE'],
        ['profile_view_push',   'BOOLEAN NOT NULL DEFAULT TRUE'],
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

    // ── 7. Summary query ──────────────────────────────────────────────────────

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

    $user  = AuthService::signup(
        email:       $body['email']        ?? '',
        password:    $body['password']     ?? '',
        displayName: $body['display_name'] ?? '',
        guestId:     isset($body['guest_id']) && is_string($body['guest_id']) ? $body['guest_id'] : null,
        mode:        isset($body['mode'])    && is_string($body['mode'])    ? $body['mode']    : null,
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
    Response::json(['user' => AuthService::ownFields($user)]);
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
    $updated = UserRepository::update($user['id'], $fields);

    Response::json(['user' => AuthService::ownFields($updated)]);
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
            $dedup = Database::pdo()->prepare("
                SELECT 1 FROM notifications
                WHERE user_id = ? AND type = 'profile_view'
                  AND data->>'viewerId' = ?
                  AND created_at > NOW() - INTERVAL '60 minutes'
                LIMIT 1
            ");
            $dedup->execute([$targetId, $viewerId]);
            if (!$dedup->fetch()) {
                NotificationRepository::create(
                    $targetId,
                    'profile_view',
                    "👀 {$viewerName} checked your profile",
                    null,
                    ['viewerId' => $viewerId, 'viewerName' => $viewerName, 'senderUserId' => $viewerId]
                );
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

    if (!isValidGuestId($guestId) && $authUser === null) {
        Response::json(['error' => 'Identity required'], 401);
    }

    $city = $channel > 0 ? CityRepository::findById($channel) : null;
    $tz   = $city['timezone'] ?? 'UTC';

    $isLegend = (bool) ($authUser['_is_ambassador'] ?? false);
    $count    = EventRepository::guestCreatedEventTodayCount(
        Database::pdo(),
        $authUser['id'] ?? null,
        $guestId,
        $tz,
    );

    Response::json([
        'canCreate'  => $isLegend || $count === 0,
        'isLegend'   => $isLegend,
        'todayCount' => $count,
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

    Response::json([
        'city'      => $city['name'],
        'channelId' => $city['id'],
        'timezone'  => $city['timezone'],
        'country'   => $city['country'] ?? null,
    ]);
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

    foreach (CityRepository::all() as $city) {
        $citySlug = preg_replace('/[^a-z0-9]+/', '-', strtolower($city['name']));
        $citySlug = trim($citySlug, '-');
        if ($citySlug === $slug) {
            Response::json([
                'channelId' => $city['id'],
                'city'      => $city['name'],
                'country'   => $city['country'] ?? null,
                'timezone'  => $city['timezone'],
                'slug'      => $citySlug,
            ]);
        }
    }

    Response::json(['error' => 'City not found'], 404);
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

    $event = EventRepository::findById($eventId);
    if ($event === null) {
        Response::json(['error' => 'Event not found or expired'], 404);
    }

    // Embed participation state when caller passes their persistent guestId.
    // This eliminates a round-trip and avoids the race condition where the CTA
    // briefly shows "Join" before the secondary /participants fetch completes.
    $guestId   = trim($_GET['guestId']   ?? '');
    $sessionId = trim($_GET['sessionId'] ?? '');
    if (isValidGuestId($guestId)) {
        $event['participant_count']  = ParticipantRepository::getCount($eventId);
        $event['is_participating']   = ParticipantRepository::isIn($eventId, $guestId);
    } elseif (isValidSessionId($sessionId)) {
        $event['participant_count']  = ParticipantRepository::getCount($eventId);
        $event['is_participating']   = ParticipantRepository::isIn($eventId, $sessionId);
    } else {
        $event['participant_count']  = ParticipantRepository::getCount($eventId);
        $event['is_participating']   = false;
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
    }

    // ── Post-response: join message INSERT ────────────────────────────────────
    if ($isNewSession) {
        try {
            MessageRepository::addJoinEvent($channelId, $guestId, $nickname, $joinUserId);
        } catch (\Throwable $e) {
            error_log('[channel_join] join event write failed: ' . $e->getMessage());
        }
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
        register_shutdown_function(static function () use ($deferAuthUserId, $deferGuestId, $deferChannel): void {
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
                    try {
                        MessageRepository::addJoinEvent($deferJoinChannelId, $deferJoinGuestId, $deferJoinNickname, $deferJoinUserId);
                    } catch (\Throwable $e) {
                        error_log('[bootstrap] join event write failed: ' . $e->getMessage());
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

    $conditions = [
        "u.deleted_at IS NULL",
        "(m.channel_id IS NOT NULL
          OR LOWER(TRIM(u.home_city)) = LOWER(TRIM(:city_name))
          OR msg_senders.guest_id IS NOT NULL)",
    ];
    $binds      = [':channel_key' => $channelKey, ':city_name' => $cityName, ':chan_msg' => $channelKey];

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

    // Paginated fetch — order by last_seen_at so recent visitors appear first.
    // NOTE: m.last_seen_at is TIMESTAMPTZ, u.created_at is INTEGER (Unix epoch).
    //       COALESCE requires matching types — cast both to epoch seconds.
    $sql = "SELECT u.id, u.display_name, u.profile_photo_url, u.vibe, u.mode, u.created_at, u.home_city,
                   COALESCE(EXTRACT(EPOCH FROM m.last_seen_at)::INTEGER, u.created_at) AS sort_at
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

$router->add('GET', '/api/v1/channels/{channelId}/events/upcoming', function (array $params) {
    $channelId = filter_var($params['channelId'], FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    if ($channelId === false) {
        Response::json(['error' => 'Invalid channelId'], 400);
    }
    $days = filter_var($_GET['days'] ?? 7, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 30]]);
    if ($days === false) $days = 7;
    $events = EventRepository::getUpcoming($channelId, $days);
    Response::json(['events' => $events]);
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
        $event = EventRepository::add($channelId, $guestId, $nickname, $title, $locationHint, $startsAt, $endsAt, $type, $userId, $isAmbassador);
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
            ['eventId' => $event['id'], 'channelId' => $cityChannelId, 'channelSlug' => strtolower(preg_replace('/[^a-z0-9]+/i', '-', $cityName)), 'senderUserId' => $authUser['id'] ?? null]
        );
    } catch (\Throwable $e) {
        error_log("[event-create] notify failed (non-fatal): " . $e->getMessage());
    }

    $eventCityInfo = CityRepository::findById($channelId); // cached in memory
    AnalyticsService::defer('event_created', $authUser['id'], [
        'channel_id' => $channelId,
        'city'       => $eventCityInfo['name']    ?? null,
        'country'    => $eventCityInfo['country'] ?? null,
        'event_type' => $type,
        'event_id'   => $event['id'],
        'is_guest'   => false,
        'user_id'    => $authUser['id'],
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

// Internal: generate upcoming occurrences for all active series (call from a daily cron)
$router->add('POST', '/internal/event-series/generate', function () {
    $expectedKey = getenv('MIGRATION_KEY') ?: null;
    if ($expectedKey === null) {
        Response::json(['error' => 'Not found'], 404);
    }

    $providedKey = $_GET['key'] ?? '';
    if (!hash_equals($expectedKey, $providedKey)) {
        Response::json(['error' => 'Forbidden'], 403);
    }

    $lookahead = filter_var($_GET['days'] ?? 7, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 30]]);
    if ($lookahead === false) $lookahead = 7;

    $results = EventSeriesRepository::generateAll($lookahead);

    Response::json(['ok' => true, 'results' => $results]);
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
        if (EventRepository::findById($eventId) === null) {
            Response::json(['error' => 'Event not found or expired'], 404);
            return;
        }

        $res      = MessageRepository::getByChannel($eventId);
        $messages = $res['messages'];

        $viewerGuestId = $_SERVER['HTTP_X_GUEST_ID'] ?? ($_COOKIE['guestId'] ?? null);
        $viewerUserId  = AuthService::currentUser()['id'] ?? null;
        MessageRepository::attachReactions($messages, $viewerGuestId ?: null, $viewerUserId);

        Response::json(['messages' => $messages]);
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
            $message = MessageRepository::add(
                $eventId, $guestId, $nickname, $content, $senderUserId,
                $replySnap['id'] ?? null,
                $replySnap['nickname'] ?? null,
                $replySnap['content']  ?? null,
                $replySnap['type']     ?? 'text'
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

    if (EventRepository::findById($eventId) === null) {
        Response::json(['error' => 'Event not found or expired'], 404);
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

    // ?lite=1 — skip the full participant list (user JOIN + mapping).
    // Use this when only count + isIn are needed (event card / status check).
    $lite = ($_GET['lite'] ?? '') === '1';

    Response::json([
        'participants' => $lite ? [] : ParticipantRepository::getParticipants($eventId),
        'count'        => ParticipantRepository::getCount($eventId),
        'isIn'         => $participantKey !== '' ? ParticipantRepository::isIn($eventId, $participantKey) : false,
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
                ['eventId' => $eventId, 'senderUserId' => $currentUser['id'], 'senderName' => $joinerName]
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
        $message = MessageRepository::add(
            $channelId, $guestId, $nickname, $content, $msgSenderUserId,
            $replySnap['id'] ?? null,
            $replySnap['nickname'] ?? null,
            $replySnap['content']  ?? null,
            $replySnap['type']     ?? 'text'
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

    $conversation = ConversationRepository::findOrCreateDirect($user['id'], $targetUserId);

    Response::json([
        'conversation' => $conversation,
        'otherUser'    => AuthService::publicFields($target),
    ]);
});

// GET /api/v1/conversations/{conversationId}/messages
$router->add('GET', '/api/v1/conversations/{conversationId}/messages', function (array $params) {
    $user           = AuthService::requireAuth();
    $conversationId = $params['conversationId'] ?? '';

    if (!ConversationRepository::isParticipant($conversationId, $user['id'])) {
        Response::json(['error' => 'Not a participant'], 403);
    }

    $messages = ConversationRepository::listMessages($conversationId);
    MessageRepository::attachReactions($messages, null, $user['id'], 'conversation_message_reactions');

    Response::json(['messages' => $messages]);
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
    Response::json([
        'notifications' => NotificationRepository::listForUser($user['id'], $limit, $offset),
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

    error_log("[push-subscribe] user={$user['id']} platform=$platform token=$token");

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

    try {
        $topic = TopicRepository::create(
            'city_' . $channelId,
            $guestId,
            $title,
            $description,
            $category,
            $userId,
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

        $res = MessageRepository::getByChannel($topicId);
        Response::json(['messages' => $res['messages']]);
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
            $message = MessageRepository::add(
                $topicId, $guestId, $nickname, $content, $senderUserId,
                $replySnap['id'] ?? null,
                $replySnap['nickname'] ?? null,
                $replySnap['content']  ?? null,
                $replySnap['type']     ?? 'text'
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
    } catch (\Throwable $e) {
        error_log("[topic-msg] notification error topicId={$topicId}: " . get_class($e) . ': ' . $e->getMessage());
    }

    Response::json($message, 201);
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
// Mixed feed: Hilads events (today) + active topics, sorted for liveness.
// Events happening now → topics by latest activity → upcoming events.
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
        // getAllByChannel defers ensureTodayOccurrences internally.
        // getAllByChannel uses SELECT_CITY (no channels JOIN) + combined WHERE source_type IN (...)
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
