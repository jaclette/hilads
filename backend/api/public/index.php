<?php

declare(strict_types=1);

header('Content-Type: application/json');

$uri = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($uri === '/health' && $method === 'GET') {
    http_response_code(200);
    echo json_encode([
        'status' => 'ok',
        'service' => 'hilads-api',
    ], JSON_PRETTY_PRINT);
    exit;
}

http_response_code(404);
echo json_encode([
    'error' => 'Not Found',
    'path' => $uri,
], JSON_PRETTY_PRINT);