<?php

declare(strict_types=1);

ini_set('display_errors', '0');
ini_set('display_startup_errors', '0');

set_exception_handler(function (Throwable $e) {
    error_log('[hilads] Uncaught ' . get_class($e) . ': ' . $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine());
    if (!headers_sent()) {
        http_response_code(500);
        header('Content-Type: application/json');
    }
    echo json_encode(['error' => 'Internal server error', 'detail' => $e->getMessage()]);
    exit();
});

session_set_cookie_params([
    'lifetime' => 0,
    'path'     => '/',
    'secure'   => true,
    'httponly' => true,
    'samesite' => 'None',
]);
session_start();

$uri    = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET' && $uri === '/health') {
    http_response_code(200);
    header('Content-Type: application/json');

    $dbUrl    = getenv('DATABASE_URL') ?: null;
    $dbTarget = 'not set';
    $dbStatus = 'not configured';
    $dbError  = null;

    if ($dbUrl) {
        $p        = parse_url($dbUrl);
        $dbTarget = ($p['host'] ?? '?') . ':' . ($p['port'] ?? 5432) . '/' . ltrim($p['path'] ?? '', '/');
        try {
            $dsn = sprintf('pgsql:host=%s;port=%s;dbname=%s;sslmode=require',
                $p['host'], $p['port'] ?? 5432, ltrim($p['path'], '/'));
            $pdo = new PDO($dsn,
                isset($p['user']) ? urldecode($p['user']) : null,
                isset($p['pass']) ? urldecode($p['pass']) : null,
                [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);

            $connRow    = $pdo->query("SELECT current_database(), current_user, current_schema()")->fetch(PDO::FETCH_NUM);
            $dbDatabase = $connRow[0];
            $dbUser     = $connRow[1];
            $dbSchema   = $connRow[2];

            // Check users table in ALL schemas (not just public — Render may default to user schema)
            $tblRow     = $pdo->query("SELECT table_schema FROM information_schema.tables WHERE table_name='users' LIMIT 1")->fetch(PDO::FETCH_NUM);
            $usersSchema = $tblRow ? $tblRow[0] : null;

            // Count rows in users if table exists
            $userCount = null;
            if ($usersSchema) {
                $cnt = $pdo->query("SELECT COUNT(*) FROM \"$usersSchema\".users")->fetch(PDO::FETCH_NUM);
                $userCount = (int)$cnt[0];
            }

            $dbStatus = 'connected';
        } catch (Throwable $ex) {
            $dbStatus = 'connection_failed';
            $dbError  = $ex->getMessage();
        }
    }

    error_log('[hilads:health] db_status=' . $dbStatus . ' database=' . ($dbDatabase ?? '?') . ' schema=' . ($dbSchema ?? '?') . ' users_table_schema=' . ($usersSchema ?? 'MISSING') . ' user_count=' . ($userCount ?? 'n/a') . ($dbError ? ' error=' . $dbError : ''));

    echo json_encode([
        'status'            => 'ok',
        'service'           => 'hilads-api',
        'db_status'         => $dbStatus,
        'db_target'         => $dbTarget,
        'db_database'       => $dbDatabase ?? null,
        'db_user'           => $dbUser ?? null,
        'db_current_schema' => $dbSchema ?? null,
        'users_table_schema'=> $usersSchema ?? null,   // null = table does not exist anywhere
        'users_row_count'   => $userCount,
        'db_error'          => $dbError ?? null,
        'session_user_id'   => $_SESSION['user_id'] ?? null,  // shows if session is carrying a user
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

// Ensure persistent storage directory exists (creates it on first boot after mounting disk)
$storageDir = Storage::dir();
if (!is_dir($storageDir)) {
    mkdir($storageDir, 0755, true);
}

require_once __DIR__ . '/../src/Response.php';
require_once __DIR__ . '/../src/Router.php';
require_once __DIR__ . '/../src/Request.php';
require_once __DIR__ . '/../src/NicknameGenerator.php';
require_once __DIR__ . '/../src/CityRepository.php';
require_once __DIR__ . '/../src/PresenceRepository.php';
require_once __DIR__ . '/../src/MessageRepository.php';
require_once __DIR__ . '/../src/EventRepository.php';
require_once __DIR__ . '/../src/ParticipantRepository.php';
require_once __DIR__ . '/../src/R2Uploader.php';
require_once __DIR__ . '/../src/TicketmasterImporter.php';

$router = new Router();

require_once __DIR__ . '/../routes/api.php';

$router->dispatch($method, $uri);