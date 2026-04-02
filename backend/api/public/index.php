<?php

declare(strict_types=1);

ini_set('display_errors', '0');
ini_set('display_startup_errors', '0');

set_exception_handler(function (Throwable $e) {
    error_log('[hilads] ' . get_class($e) . ': ' . $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine());
    if (!headers_sent()) {
        http_response_code(500);
        header('Content-Type: application/json; charset=utf-8');
    }
    echo json_encode(['error' => 'Internal server error'], JSON_UNESCAPED_UNICODE);
    exit();
});

// Auth uses DB-backed tokens in 'hilads_token' cookie — no PHP sessions needed.

$uri    = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

// ── Admin backoffice ──────────────────────────────────────────────────────────
// Handled before the JSON API path to avoid CORS/Content-Type conflicts.
if (str_starts_with($uri, '/admin')) {
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
    require_once __DIR__ . '/../src/Database.php';
    require_once __DIR__ . '/../admin/boot.php';
    exit;
}
// ─────────────────────────────────────────────────────────────────────────────

if ($method === 'GET' && $uri === '/health') {
    http_response_code(200);
    header('Content-Type: application/json; charset=utf-8');

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
            error_log('[hilads] health DB check failed: ' . $ex->getMessage());
            $dbError  = 'redacted';
        }
    }

    echo json_encode([
        'status'     => 'ok',
        'service'    => 'hilads-api',
        'db_status'  => $dbStatus,
        'db_error'   => $dbError ?? null,
    ], JSON_UNESCAPED_UNICODE);
    exit();
}

// CORS_ORIGINS env var overrides the hard-coded list (comma-separated, no spaces).
// e.g. CORS_ORIGINS=https://hilads.live,https://hilads.vercel.app
$allowedOrigins = getenv('CORS_ORIGINS')
    ? array_filter(explode(',', getenv('CORS_ORIGINS')))
    : ['https://hilads.live', 'https://hilads.vercel.app'];

$origin = $_SERVER['HTTP_ORIGIN'] ?? null;

if ($origin !== null && in_array($origin, $allowedOrigins, true)) {
    header("Access-Control-Allow-Origin: $origin");
    header('Vary: Origin');
    header('Access-Control-Allow-Credentials: true');
}

header('Access-Control-Allow-Headers: Content-Type');
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');

if ($method === 'OPTIONS') {
    http_response_code(204);
    exit();
}

header('Content-Type: application/json; charset=utf-8');

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

if (getenv('SENTRY_DSN')) {
    \Sentry\init([
        'dsn'         => getenv('SENTRY_DSN'),
        'environment' => getenv('APP_ENV') ?: 'production',
    ]);
}

require_once __DIR__ . '/../src/Storage.php';
require_once __DIR__ . '/../src/Database.php';
require_once __DIR__ . '/../src/UserRepository.php';
require_once __DIR__ . '/../src/AuthService.php';

require_once __DIR__ . '/../src/Response.php';
require_once __DIR__ . '/../src/Router.php';
require_once __DIR__ . '/../src/Request.php';
require_once __DIR__ . '/../src/RateLimiter.php';
require_once __DIR__ . '/../src/NicknameGenerator.php';
require_once __DIR__ . '/../src/CityRepository.php';
require_once __DIR__ . '/../src/PresenceRepository.php';
require_once __DIR__ . '/../src/MessageRepository.php';
require_once __DIR__ . '/../src/EventRepository.php';
require_once __DIR__ . '/../src/EventSeriesRepository.php';
require_once __DIR__ . '/../src/PlacesService.php';
require_once __DIR__ . '/../src/VenueSeeder.php';
require_once __DIR__ . '/../src/ParticipantRepository.php';
require_once __DIR__ . '/../src/VibeRepository.php';
require_once __DIR__ . '/../src/ConversationRepository.php';
require_once __DIR__ . '/../src/NotificationRepository.php';
require_once __DIR__ . '/../src/NotificationPreferencesRepository.php';
require_once __DIR__ . '/../src/PushService.php';
require_once __DIR__ . '/../src/MobilePushService.php';
require_once __DIR__ . '/../src/R2Uploader.php';
require_once __DIR__ . '/../src/TicketmasterImporter.php';
require_once __DIR__ . '/../src/WeatherService.php';
require_once __DIR__ . '/../src/UserBadgeService.php';
require_once __DIR__ . '/../src/UserResource.php';
require_once __DIR__ . '/../src/AnalyticsService.php';

$router = new Router();

require_once __DIR__ . '/../routes/api.php';

$router->dispatch($method, $uri);
