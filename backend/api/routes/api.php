<?php

declare(strict_types=1);

$router->add('POST', '/api/v1/guest/session', function () {
    $guestId = bin2hex(random_bytes(16));
    $nickname = NicknameGenerator::generate();

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
