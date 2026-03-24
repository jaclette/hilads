<?php

declare(strict_types=1);

// ── WS broadcast helper ───────────────────────────────────────────────────────
// Fire-and-forget: tells the WS server to push a newMessage event to room members.
// channelId: int for city channels, string (hex) for event channels.
function broadcastMessageToWs(int|string $channelId, array $message): void
{
    $wsUrl   = rtrim(getenv('WS_INTERNAL_URL') ?: 'http://localhost:8082', '/');
    $payload = json_encode(['channelId' => $channelId, 'message' => $message]);

    $ctx = stream_context_create([
        'http' => [
            'method'        => 'POST',
            'header'        => "Content-Type: application/json\r\nContent-Length: " . strlen($payload) . "\r\n",
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

    $ctx = stream_context_create([
        'http' => [
            'method'        => 'POST',
            'header'        => "Content-Type: application/json\r\nContent-Length: " . strlen($payload) . "\r\n",
            'content'       => $payload,
            'timeout'       => 1,
            'ignore_errors' => true,
        ],
    ]);

    @file_get_contents($wsUrl . '/broadcast/conversation-message', false, $ctx);
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

    if (empty($sessionId) || !is_string($sessionId)) {
        Response::json(['error' => 'sessionId is required'], 400);
    }

    if (empty($guestId) || !is_string($guestId)) {
        Response::json(['error' => 'guestId is required'], 400);
    }

    if (empty($nickname) || !is_string($nickname)) {
        Response::json(['error' => 'nickname is required'], 400);
    }

    $nickname = mb_substr(trim(strip_tags($nickname)), 0, 20);

    if ($nickname === '') {
        Response::json(['error' => 'nickname must not be empty'], 400);
    }

    // If the user was in a previous room, leave it first
    $previousChannelId = isset($body['previousChannelId'])
        ? filter_var($body['previousChannelId'], FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]])
        : false;

    if ($previousChannelId !== false && $previousChannelId !== $channelId) {
        PresenceRepository::leave($previousChannelId, $sessionId);
    }

    PresenceRepository::join($channelId, $sessionId, $guestId, $nickname);

    $message = MessageRepository::addJoinEvent($channelId, $guestId, $nickname);

    // onlineUsers/onlineCount intentionally omitted — the WS presenceSnapshot
    // arrives within milliseconds and is the authoritative source for presence.
    Response::json(['message' => $message], 201);
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

    if (empty($sessionId) || !is_string($sessionId)) {
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

    if (empty($sessionId) || !is_string($sessionId)) {
        Response::json(['error' => 'sessionId is required'], 400);
    }

    if (empty($guestId) || !is_string($guestId)) {
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
    $channelId = filter_var($params['channelId'], FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);

    if ($channelId === false) {
        Response::json(['error' => 'Invalid channelId'], 400);
    }

    if (CityRepository::findById($channelId) === null) {
        Response::json(['error' => 'Channel not found'], 404);
    }

    $messages = MessageRepository::getByChannel($channelId);

    Response::json([
        'messages'    => $messages,
        'onlineUsers' => PresenceRepository::getOnline($channelId),
        'onlineCount' => PresenceRepository::getCount($channelId),
    ]);
});

$router->add('POST', '/api/v1/uploads', function () {
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
    $channelId = filter_var($params['channelId'], FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);

    if ($channelId === false) {
        Response::json(['error' => 'Invalid channelId'], 400);
    }

    $city = CityRepository::findById($channelId);

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

    TicketmasterImporter::syncIfNeeded($channelId, $lat, $lng, $city['name']);

    Response::json(['events' => EventRepository::getPublicByChannel($channelId)]);
});

$router->add('GET', '/api/v1/channels/{channelId}/events', function (array $params) {
    $channelId = filter_var($params['channelId'], FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);

    if ($channelId === false) {
        Response::json(['error' => 'Invalid channelId'], 400);
    }

    if (CityRepository::findById($channelId) === null) {
        Response::json(['error' => 'Channel not found'], 404);
    }

    Response::json(['events' => EventRepository::getByChannel($channelId)]);
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

    if (empty($guestId) || !is_string($guestId)) {
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

    if (!is_numeric($startsAt)) {
        Response::json(['error' => 'starts_at is required and must be a unix timestamp'], 400);
    }

    $startsAt = (int) $startsAt;

    if (!is_numeric($endsAt)) {
        Response::json(['error' => 'ends_at is required and must be a unix timestamp'], 400);
    }

    $endsAt = (int) $endsAt;

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
    $event = EventRepository::add($channelId, $guestId, $nickname, $title, $locationHint, $startsAt, $endsAt, $type, $authUser['id'] ?? null);

    Response::json($event, 201);
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

    if (empty($guestId) || !is_string($guestId)) {
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

    if (empty($guestId) || !is_string($guestId)) {
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

        $message = MessageRepository::addImage($eventId, $guestId, $nickname, $imageUrl);
    } else {
        if (empty($content) || !is_string($content)) {
            Response::json(['error' => 'content is required'], 400);
        }

        if (strlen($content) > 1000) {
            Response::json(['error' => 'content must not exceed 1000 characters'], 400);
        }

        $message = MessageRepository::add($eventId, $guestId, $nickname, $content);
    }

    broadcastMessageToWs($eventId, $message);

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

    if (empty($sessionId) || !is_string($sessionId)) {
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

    if (empty($sessionId) || !is_string($sessionId)) {
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

    if (empty($guestId) || !is_string($guestId)) {
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
    if (!empty($sessionId) && is_string($sessionId)) {
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
