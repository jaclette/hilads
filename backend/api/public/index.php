<?php

declare(strict_types=1);

// Never let PHP warnings or notices bleed into the JSON response body.
// Errors are logged server-side; the API always returns structured JSON.
ini_set('display_errors', '0');
ini_set('display_startup_errors', '0');

$allowedOrigins = [
    'https://hilads.vercel.app',
];

$origin = $_SERVER['HTTP_ORIGIN'] ?? null;

if ($origin !== null && in_array($origin, $allowedOrigins, true)) {
    header("Access-Control-Allow-Origin: $origin");
    header('Vary: Origin');
    header('Access-Control-Allow-Credentials: true');
}

header('Access-Control-Allow-Headers: Content-Type');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
    http_response_code(204);
    exit();
}

header('Content-Type: application/json');

// Load .env for local development; in production set vars in the server environment.
// Use @ to suppress parse warnings — PHP's INI parser chokes on characters like
// parentheses inside # comment lines, which would otherwise leak HTML into responses.
$envFile = __DIR__ . '/../.env';
if (file_exists($envFile)) {
    $vars = @parse_ini_file($envFile);
    if (is_array($vars)) {
        foreach ($vars as $key => $value) {
            putenv("$key=$value");
        }
    }
}

require_once __DIR__ . '/../vendor/autoload.php';

require_once __DIR__ . '/../src/Response.php';
require_once __DIR__ . '/../src/Router.php';
require_once __DIR__ . '/../src/Request.php';
require_once __DIR__ . '/../src/NicknameGenerator.php';
require_once __DIR__ . '/../src/CityRepository.php';
require_once __DIR__ . '/../src/PresenceRepository.php';
require_once __DIR__ . '/../src/MessageRepository.php';
require_once __DIR__ . '/../src/R2Uploader.php';

session_set_cookie_params([
    'lifetime' => 0,
    'path' => '/',
    'secure' => true,
    'httponly' => true,
    'samesite' => 'None',
]);

session_start();

$router = new Router();

$router->add('GET', '/health', function () {
    Response::json(['status' => 'ok', 'service' => 'hilads-api']);
});

require_once __DIR__ . '/../routes/api.php';

$uri = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

$router->dispatch($method, $uri);