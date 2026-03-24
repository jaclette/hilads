<?php

declare(strict_types=1);

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

    // ── 3. Summary query ──────────────────────────────────────────────────────

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
    unset($_SESSION['user_id']);
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
    // Single query: active event counts for all cities
    $eventCounts = EventRepository::getCountsPerCity();

    // Message stats still come from JSON files (migrated in phase 4)
    $storageDir = Storage::dir() . '/';
    $activeIds  = [];
    foreach (glob($storageDir . 'messages_*.json') as $f) {
        if (preg_match('/messages_(\d+)\.json$/', $f, $m)) {
            $activeIds[(int) $m[1]] = true;
        }
    }
    foreach (glob($storageDir . 'presence_*.json') as $f) {
        if (preg_match('/presence_(\d+)\.json$/', $f, $m)) {
            $activeIds[(int) $m[1]] = true;
        }
    }

    $channels = [];

    foreach (CityRepository::all() as $city) {
        $id    = $city['id'];
        $stats = isset($activeIds[$id])
            ? MessageRepository::getStats($id)
            : ['messageCount' => 0, 'activeUsers' => 0, 'lastActivityAt' => null];

        $channels[] = [
            'channelId'      => $id,
            'city'           => $city['name'],
            'country'        => $city['country'] ?? null,
            'timezone'       => $city['timezone'],
            'messageCount'   => $stats['messageCount'],
            'activeUsers'    => $stats['activeUsers'],
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

    Response::json([
        'message'     => $message,
        'onlineUsers' => PresenceRepository::getOnline($channelId),
        'onlineCount' => PresenceRepository::getCount($channelId),
    ], 201);
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

    Response::json([
        'onlineUsers' => PresenceRepository::getOnline($channelId),
        'onlineCount' => PresenceRepository::getCount($channelId),
    ]);
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

    Response::json([
        'onlineUsers' => PresenceRepository::getOnline($channelId),
        'onlineCount' => PresenceRepository::getCount($channelId),
    ]);
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

    $allowedTypes = ['drinks', 'party', 'music', 'food', 'coffee', 'sport', 'meetup', 'other'];

    if (empty($type) || !in_array($type, $allowedTypes, true)) {
        Response::json(['error' => 'type is required and must be one of: ' . implode(', ', $allowedTypes)], 400);
    }

    $event = EventRepository::add($channelId, $guestId, $nickname, $title, $locationHint, $startsAt, $type);

    Response::json($event, 201);
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

    $isIn  = ParticipantRepository::toggle($eventId, $sessionId);
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

    Response::json($message, 201);
});
