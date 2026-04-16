<?php

declare(strict_types=1);

ini_set('display_errors', '0');
ini_set('display_startup_errors', '0');

set_exception_handler(function (Throwable $e) {
    $uri     = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
    $isAdmin = str_starts_with($uri, '/admin');
    error_log('[hilads] ' . get_class($e) . ': ' . $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine());
    if (!headers_sent()) {
        http_response_code(500);
        if ($isAdmin) {
            header('Content-Type: text/html; charset=utf-8');
            echo '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Admin Error</title>'
               . '<style>body{font-family:system-ui,sans-serif;background:#0f0f0f;color:#e0e0e0;padding:40px}'
               . 'h1{color:#f87171;margin-bottom:16px}pre{background:#1a1a1a;border:1px solid #2a2a2a;'
               . 'border-radius:6px;padding:16px;font-size:13px;overflow:auto;white-space:pre-wrap}'
               . 'a{color:#FF7A3C}</style></head><body>'
               . '<h1>Admin Error (500)</h1>'
               . '<pre>' . htmlspecialchars($e->getMessage() . "\n\nin " . $e->getFile() . ':' . $e->getLine(), ENT_QUOTES) . '</pre>'
               . '<p style="margin-top:20px"><a href="/admin">← Dashboard</a></p>'
               . '</body></html>';
        } else {
            header('Content-Type: application/json; charset=utf-8');
            echo json_encode(['error' => 'Internal server error'], JSON_UNESCAPED_UNICODE);
        }
    }
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
    require_once __DIR__ . '/../src/CityRepository.php';
    require_once __DIR__ . '/../src/UserRepository.php';
    require_once __DIR__ . '/../src/EventRepository.php';
    require_once __DIR__ . '/../src/EventSeriesRepository.php';
    require_once __DIR__ . '/../src/TopicRepository.php';
    require_once __DIR__ . '/../src/R2Uploader.php';
    require_once __DIR__ . '/../admin/boot.php';
    exit;
}
// ─────────────────────────────────────────────────────────────────────────────

if ($method === 'GET' && $uri === '/health') {
    // Fast path — no DB, no bootstrap. Render just needs 200 to pass the deploy check.
    // (The .htaccess rewrite sends /health → health.php before this ever runs,
    //  but this fallback keeps the endpoint working even if .htaccess is bypassed.)
    http_response_code(200);
    header('Content-Type: application/json; charset=utf-8');
    echo '{"status":"ok","service":"hilads-api"}';
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

// Buffer output so fastcgi_finish_request() reliably flushes the full response
// before any post-response deferred work runs.
ob_start();

require_once __DIR__ . '/../vendor/autoload.php';

// Guard: initialize Sentry only once per FPM worker process.
// Without this, \Sentry\init() runs on every request — it re-registers error
// handlers, creates a new Hub/Client, and registers shutdown functions each time.
// define() persists for the lifetime of the worker process.
if (getenv('SENTRY_DSN') && !defined('SENTRY_INITIALIZED')) {
    define('SENTRY_INITIALIZED', true);
    \Sentry\init([
        'dsn'                => getenv('SENTRY_DSN'),
        'environment'        => getenv('APP_ENV') ?: 'production',
        'traces_sample_rate' => 0.0, // disable performance tracing overhead
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
require_once __DIR__ . '/../src/TopicRepository.php';
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
