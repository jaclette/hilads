<?php

declare(strict_types=1);

header('Content-Type: application/json');

require_once __DIR__ . '/../src/Response.php';
require_once __DIR__ . '/../src/Router.php';
require_once __DIR__ . '/../src/Request.php';
require_once __DIR__ . '/../src/NicknameGenerator.php';
require_once __DIR__ . '/../src/CityRepository.php';
require_once __DIR__ . '/../src/MessageRepository.php';

session_start();

$router = new Router();

$router->add('GET', '/health', function () {
    Response::json(['status' => 'ok', 'service' => 'hilads-api']);
});

require_once __DIR__ . '/../routes/api.php';

$uri = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

$router->dispatch($method, $uri);
