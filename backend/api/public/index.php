<?php

declare(strict_types=1);

ini_set('display_errors', '0');
ini_set('display_startup_errors', '0');

set_exception_handler(function (Throwable $e) {
    error_log('[hilads] ' . get_class($e) . ': ' . $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine());
    if (!headers_sent()) {
        http_response_code(500);
        header('Content-Type: application/json');
    }
    echo json_encode(['error' => 'Internal server error']);
    exit();
});

// Auth uses DB-backed tokens in 'hilads_token' cookie — no PHP sessions needed.

$uri    = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET' && $uri === '/health') {
    http_response_code(200);
    header('Content-Type: application/json');

    $dbUrl    = getenv('DATABASE_URL') ?: null;
    $dbStatus = $dbUrl ? 'configured' : 'no DATABASE_URL';
    $dbError  = null;

    if ($dbUrl) {
        $p = parse_url($dbUrl);
        try {
            $dsn = sprintf('pgsql:host=%s;port=%s;dbname=%s;sslmode=require',
                $p['host'], $p['port'] ?? 5432, ltrim($p['path'], '/'));
            new PDO($dsn,
                isset($p['user']) ? urldecode($p['user']) : null,
                isset($p['pass']) ? urldecode($p['pass']) : null,
                [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
            $dbStatus = 'connected';
        } catch (Throwable $ex) {
            $dbStatus = 'connection_failed';
            $dbError  = $ex->getMessage();
        }
    }

    echo json_encode([
        'status'     => 'ok',
        'service'    => 'hilads-api',
        'db_status'  => $dbStatus,
        'db_error'   => $dbError ?? null,
    ]);
    exit();
}

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
header('Access-Control-Allow-Methods: GET, POST, PUT, OPTIONS');

if ($method === 'OPTIONS') {
    http_response_code(204);
    exit();
}

header('Content-Type: application/json');

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

require_once __DIR__ . '/../src/Storage.php';
require_once __DIR__ . '/../src/Database.php';
require_once __DIR__ . '/../src/UserRepository.php';
require_once __DIR__ . '/../src/AuthService.php';

require_once __DIR__ . '/../src/Response.php';
require_once __DIR__ . '/../src/Router.php';
require_once __DIR__ . '/../src/Request.php';
require_once __DIR__ . '/../src/NicknameGenerator.php';
require_once __DIR__ . '/../src/CityRepository.php';
require_once __DIR__ . '/../src/PresenceRepository.php';
require_once __DIR__ . '/../src/MessageRepository.php';
require_once __DIR__ . '/../src/EventRepository.php';
require_once __DIR__ . '/../src/ParticipantRepository.php';
require_once __DIR__ . '/../src/ConversationRepository.php';
require_once __DIR__ . '/../src/R2Uploader.php';
require_once __DIR__ . '/../src/TicketmasterImporter.php';

$router = new Router();

require_once __DIR__ . '/../routes/api.php';

$router->dispatch($method, $uri);