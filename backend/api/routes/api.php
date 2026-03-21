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
