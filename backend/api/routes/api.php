<?php

declare(strict_types=1);

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
    ]);
});

$router->add('GET', '/api/v1/channels', function () {
    $channels = [];

    foreach (CityRepository::all() as $city) {
        $stats = MessageRepository::getStats($city['id']);

        $channels[] = [
            'channelId'      => $city['id'],
            'city'           => $city['name'],
            'messageCount'   => $stats['messageCount'],
            'activeUsers'    => $stats['activeUsers'],
            'lastActivityAt' => $stats['lastActivityAt'],
        ];
    }

    Response::json(['channels' => $channels]);
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

    Response::json(['messages' => $messages]);
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

    $guestId  = $body['guestId']  ?? null;
    $nickname = $body['nickname'] ?? null;
    $content  = $body['content']  ?? null;

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

    if (empty($content) || !is_string($content)) {
        Response::json(['error' => 'content is required'], 400);
    }

    if (strlen($content) > 1000) {
        Response::json(['error' => 'content must not exceed 1000 characters'], 400);
    }

    $message = MessageRepository::add($channelId, $guestId, $nickname, $content);

    Response::json($message, 201);
});
