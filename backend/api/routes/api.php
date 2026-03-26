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
    $headers = "Content-Type: application/json\r\nContent-Length: " . strlen($payload) . "\r\n";
    if ($token !== '') {
        $headers .= "X-Internal-Token: {$token}\r\n";
    }

    $ctx = stream_context_create([
        'http' => [
            'method'        => 'POST',
            'header'        => $headers,
            'content'       => $payload,
            'timeout'       => 1,
            'ignore_errors' => true,
        ],
    ]);

    @file_get_contents($wsUrl . '/broadcast/message', false, $ctx);
}

// ── Conversation broadcast helper ─────────────────────────────────────────────
// Fire-and-forget: tells the WS server to push a newConversationMessage event.
function broadcastConversationMessageToWs(string $conversationId, array $message): void
{
    $wsUrl   = rtrim(getenv('WS_INTERNAL_URL') ?: 'http://localhost:8082', '/');
    $payload = json_encode(['conversationId' => $conversationId, 'message' => $message]);
    $token   = getenv('WS_INTERNAL_TOKEN') ?: '';
    $headers = "Content-Type: application/json\r\nContent-Length: " . strlen($payload) . "\r\n";
    if ($token !== '') {
        $headers .= "X-Internal-Token: {$token}\r\n";
    }

    $ctx = stream_context_create([
        'http' => [
            'method'        => 'POST',
            'header'        => $headers,
            'content'       => $payload,
            'timeout'       => 1,
            'ignore_errors' => true,
        ],
    ]);

    @file_get_contents($wsUrl . '/broadcast/conversation-message', false, $ctx);
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

    // ── 5. Summary query ──────────────────────────────────────────────────────

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

    $user = AuthService::signup(
        email:       $body['email']        ?? '',
        password:    $body['password']     ?? '',
        displayName: $body['display_name'] ?? '',
        guestId:     isset($body['guest_id']) && is_string($body['guest_id']) ? $body['guest_id'] : null,
    );

    Response::json(['user' => AuthService::ownFields($user)], 201);
});

$router->add('POST', '/api/v1/auth/login', function () {
    enforceRateLimit('auth_login', 12, 600);
    $body = Request::json();
    if ($body === null) Response::json(['error' => 'Invalid JSON body'], 400);

    $user = AuthService::login(
        email:    $body['email']    ?? '',
        password: $body['password'] ?? '',
    );

    Response::json(['user' => AuthService::ownFields($user)]);
});

$router->add('POST', '/api/v1/auth/logout', function () {
    AuthService::destroyDbSession();
    Response::json(['ok' => true]);
});

$router->add('GET', '/api/v1/auth/me', function () {
    $user = AuthService::requireAuth();
    Response::json(['user' => AuthService::ownFields($user)]);
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

    $user = UserRepository::findById($userId);
    if ($user === null) {
        Response::json(['error' => 'User not found'], 404);
    }

    Response::json(['user' => AuthService::publicFields($user)]);
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

    $_SESSION['guests'][$guestId] = [
        'nickname' => $nickname,
        'created_at' => time(),
    ];

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

    $city = CityRepository::nearest($lat, $lng);

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
$router->add('GET', '/api/v1/events/{eventId}', function (array $params) {
    $eventId = $params['eventId'] ?? '';

    if (!preg_match('/^[a-f0-9]{16}$/', $eventId)) {
        Response::json(['error' => 'Invalid eventId'], 400);
    }

    $event = EventRepository::findById($eventId);
    if ($event === null) {
        Response::json(['error' => 'Event not found or expired'], 404);
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
    // Four batch queries — no per-city loops
    $eventCounts    = EventRepository::getCountsPerCity();
    $messageStats   = MessageRepository::getStatsBatch();
    $presenceCounts = PresenceRepository::getCountBatch();

    $channels = [];

    foreach (CityRepository::all() as $city) {
        $id    = $city['id'];
        $stats = $messageStats[$id] ?? ['messageCount' => 0, 'lastActivityAt' => null];

        $channels[] = [
            'channelId'      => $id,
            'city'           => $city['name'],
            'country'        => $city['country'] ?? null,
            'timezone'       => $city['timezone'],
            'messageCount'   => $stats['messageCount'],
            'activeUsers'    => $presenceCounts[$id] ?? 0,
            'lastActivityAt' => $stats['lastActivityAt'],
            'eventCount'     => $eventCounts[$id] ?? 0,
        ];
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

        apiLog('channel_join', 'start', [
            'channelId' => $channelId,
            'sessionId' => is_string($sessionId) ? substr($sessionId, 0, 8) : null,
            'guestId' => is_string($guestId) ? substr($guestId, 0, 8) : null,
            'ip' => Request::ip(),
        ]);

        enforceRateLimit('channel_join', 90, 300);

        if (CityRepository::findById($channelId) === null) {
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

        $previousChannelId = isset($body['previousChannelId'])
            ? filter_var($body['previousChannelId'], FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]])
            : false;

        if ($previousChannelId !== false && $previousChannelId !== $channelId) {
            try {
                PresenceRepository::leave($previousChannelId, $sessionId);
            } catch (\Throwable $e) {
                apiLog('channel_join', 'previous leave failed', [
                    'channelId' => $channelId,
                    'previousChannelId' => $previousChannelId,
                    'error' => $e->getMessage(),
                ]);
            }
        }

        PresenceRepository::join($channelId, $sessionId, $guestId, $nickname);

        $message = [
            'type' => 'system',
            'event' => 'join',
            'guestId' => $guestId,
            'nickname' => $nickname,
            'createdAt' => time(),
        ];

        try {
            $message = MessageRepository::addJoinEvent($channelId, $guestId, $nickname);
        } catch (\Throwable $e) {
            apiLog('channel_join', 'join event write failed', [
                'channelId' => $channelId,
                'error' => $e->getMessage(),
            ]);
        }

        apiLog('channel_join', 'success', [
            'channelId' => $channelId,
            'elapsedMs' => apiElapsedMs($startedAt),
        ]);

        Response::json(['message' => $message], 201);
    } catch (\Throwable $e) {
        apiLog('channel_join', 'failure', [
            'channelId' => $channelId,
            'elapsedMs' => apiElapsedMs($startedAt),
            'error' => get_class($e) . ': ' . $e->getMessage(),
        ]);
        throw $e;
    }
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
        if (CityRepository::findById($channelId) === null) {
            Response::json(['error' => 'Channel not found'], 404);
        }

        $messages = MessageRepository::getByChannel($channelId);
        $onlineUsers = PresenceRepository::getOnline($channelId);
        $onlineCount = PresenceRepository::getCount($channelId);

        apiLog('channel_messages', 'success', [
            'channelId' => $channelId,
            'messages' => count($messages),
            'onlineCount' => $onlineCount,
            'elapsedMs' => apiElapsedMs($startedAt),
        ]);

        Response::json([
            'messages'    => $messages,
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

    Response::json(['url' => $url], 201);
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

    try {
        TicketmasterImporter::syncIfNeeded($channelId, $lat, $lng, $city['name']);
    } catch (\Throwable $e) {
        apiLog('city_events', 'sync failed', [
            'channelId' => $channelId,
            'error' => $e->getMessage(),
        ]);
    }

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

$router->add('GET', '/api/v1/channels/{channelId}/events', function (array $params) {
    $startedAt = microtime(true);
    $channelId = filter_var($params['channelId'], FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);

    if ($channelId === false) {
        Response::json(['error' => 'Invalid channelId'], 400);
    }

    try {
        if (CityRepository::findById($channelId) === null) {
            Response::json(['error' => 'Channel not found'], 404);
        }

        $events = EventRepository::getByChannel($channelId);
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

    $authUser = AuthService::currentUser(); // null for guests — that's fine
    $userId   = $authUser['id'] ?? null;

    error_log("[event-create] channelId={$channelId} guestId={$guestId} userId={$userId} title=" . json_encode($title));

    try {
        $event = EventRepository::add($channelId, $guestId, $nickname, $title, $locationHint, $startsAt, $endsAt, $type, $userId);
    } catch (\Throwable $e) {
        error_log("[event-create] FAILED: " . get_class($e) . ': ' . $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine());
        throw $e; // re-throw so global handler returns 500 — but now it's in the logs
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
            ['eventId' => $event['id'], 'channelId' => $cityChannelId, 'channelSlug' => strtolower(preg_replace('/[^a-z0-9]+/i', '-', $cityName))]
        );
    } catch (\Throwable $e) {
        error_log("[event-create] notify failed (non-fatal): " . $e->getMessage());
    }

    Response::json($event, 201);
});

// ── Event ownership: my events + edit + delete ────────────────────────────────

$router->add('GET', '/api/v1/users/me/events', function () {
    $guestId  = $_GET['guestId'] ?? null;
    $authUser = AuthService::currentUser();

    if (!isValidGuestId($guestId)) {
        Response::json(['error' => 'guestId is required'], 400);
    }

    $events = EventRepository::getByUser($guestId, $authUser['id'] ?? null);
    Response::json(['events' => $events]);
});

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

    if (!isValidGuestId($guestId)) {
        Response::json(['error' => 'guestId is required'], 400);
    }

    $authUser = AuthService::currentUser();
    $deleted  = EventRepository::delete($eventId, $guestId, $authUser['id'] ?? null);

    if (!$deleted) {
        Response::json(['error' => 'Event not found or you are not the creator'], 403);
    }

    Response::json(['ok' => true]);
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
    $stmt = $pdo->query("
        DELETE FROM messages
        WHERE channel_id IN (SELECT id FROM channels WHERE type = 'city')
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
    }

    if (EventRepository::findById($eventId) === null) {
        Response::json(['error' => 'Event not found or expired'], 404);
    }

    Response::json(['messages' => MessageRepository::getByChannel($eventId)]);
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
            $message = MessageRepository::addImage($eventId, $guestId, $nickname, $imageUrl);
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
            $message = MessageRepository::add($eventId, $guestId, $nickname, $content);
        } catch (\Throwable $e) {
            error_log("[event-msg] DB error inserting message eventId={$eventId}: " . $e->getMessage());
            Response::json(['error' => 'Failed to send message'], 500);
        }
    }

    error_log("[event-msg] message saved id={$message['id']} eventId={$eventId}");

    broadcastMessageToWs($eventId, $message);

    // Notify registered event participants — non-fatal: a notification failure must never
    // prevent the message response from reaching the sender.
    try {
        $eventForNotif = EventRepository::findById($eventId);
        $senderUser    = AuthService::currentUser();
        $senderUserId  = $senderUser['id'] ?? null;
        $eventTitle    = is_array($eventForNotif) ? ($eventForNotif['title'] ?? 'event') : 'event';
        $bodyPreview   = $type === 'image' ? '📸 Sent an image' : mb_substr((string)($content ?? ''), 0, 100);
        NotificationRepository::notifyEventParticipants(
            $eventId,
            $senderUserId,
            'event_message',
            $nickname . ' in ' . $eventTitle,
            $bodyPreview,
            ['eventId' => $eventId, 'eventTitle' => $eventTitle, 'senderName' => $nickname]
        );
    } catch (\Throwable $e) {
        error_log("[event-msg] notification error eventId={$eventId}: " . get_class($e) . ': ' . $e->getMessage());
        // Do not rethrow — the message was already saved and broadcast successfully.
    }

    Response::json($message, 201);
});

$router->add('GET', '/api/v1/events/{eventId}/participants', function (array $params) {
    $eventId = $params['eventId'] ?? '';

    if (!preg_match('/^[a-f0-9]{16}$/', $eventId)) {
        Response::json(['error' => 'Invalid eventId'], 400);
    }

    if (EventRepository::findById($eventId) === null) {
        Response::json(['error' => 'Event not found or expired'], 404);
    }

    $sessionId = trim($_GET['sessionId'] ?? '');
    if ($sessionId !== '' && !isValidSessionId($sessionId)) {
        Response::json(['error' => 'Invalid sessionId'], 400);
    }

    Response::json([
        'count' => ParticipantRepository::getCount($eventId),
        'isIn'  => $sessionId !== '' ? ParticipantRepository::isIn($eventId, $sessionId) : false,
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

    $sessionId = $body['sessionId'] ?? null;

    enforceRateLimit('event_participant_toggle', 60, 300, $eventId);

    if (!isValidSessionId($sessionId)) {
        Response::json(['error' => 'sessionId is required'], 400);
    }

    $currentUser = AuthService::currentUser(); // null for guests
    $isIn  = ParticipantRepository::toggle($eventId, $sessionId, $currentUser['id'] ?? null);
    $count = ParticipantRepository::getCount($eventId);

    ParticipantRepository::broadcastToWs($eventId, $count);

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

        $message = MessageRepository::addImage($channelId, $guestId, $nickname, $imageUrl);
    } else {
        if (empty($content) || !is_string($content)) {
            Response::json(['error' => 'content is required'], 400);
        }

        if (strlen($content) > 1000) {
            Response::json(['error' => 'content must not exceed 1000 characters'], 400);
        }

        $message = MessageRepository::add($channelId, $guestId, $nickname, $content);
    }

    broadcastMessageToWs($channelId, $message);

    Response::json($message, 201);
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
    if (!$target) {
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

    $content = trim((string) ($body['content'] ?? ''));

    if ($content === '') {
        Response::json(['error' => 'content is required'], 400);
    }

    if (mb_strlen($content) > 1000) {
        Response::json(['error' => 'content must not exceed 1000 characters'], 400);
    }

    $message = ConversationRepository::addMessage($conversationId, $user['id'], $content);

    broadcastConversationMessageToWs($conversationId, $message);

    // Sending a message also implicitly reads the conversation for the sender
    ConversationRepository::markRead($conversationId, $user['id']);

    // Notify the other participant (in-app only for Phase 1 — no push yet)
    $otherStmt = Database::pdo()->prepare("
        SELECT user_id FROM conversation_participants
        WHERE conversation_id = ? AND user_id != ?
        LIMIT 1
    ");
    $otherStmt->execute([$conversationId, $user['id']]);
    $otherUserId = $otherStmt->fetchColumn();
    if ($otherUserId) {
        $preview = mb_substr($content, 0, 100);
        NotificationRepository::create(
            $otherUserId,
            'dm_message',
            ($user['display_name'] ?? 'Someone') . ' sent you a message',
            $preview,
            ['conversationId' => $conversationId, 'senderName' => $user['display_name'] ?? '']
        );
    }

    Response::json(['message' => $message], 201);
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

// GET /api/v1/notifications
// Returns last 50 notifications for the current user, plus total unread count.
$router->add('GET', '/api/v1/notifications', function () {
    $user = AuthService::requireAuth();
    Response::json([
        'notifications' => NotificationRepository::listForUser($user['id']),
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
    Response::json(['preferences' => NotificationPreferencesRepository::get($user['id'])]);
});

// PUT /api/v1/notification-preferences
// Body: any subset of { dm_push, event_message_push, new_event_push }
$router->add('PUT', '/api/v1/notification-preferences', function () {
    $user  = AuthService::requireAuth();
    $body  = Request::json() ?? [];
    $prefs = NotificationPreferencesRepository::upsert($user['id'], $body);
    Response::json(['preferences' => $prefs]);
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
