<?php
// Health check, served by Apache directly (.htaccess maps GET /health here): no bootstrap,
// no vendor autoload. Render's health check path: a new deploy only takes traffic once
// this answers 200, so it checks what a request really needs, the database (SELECT 1,
// 3 s connect timeout). 503 while Postgres is unreachable.
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$url = getenv('DATABASE_URL');
$db = 'unconfigured';
if ($url) {
    $p = parse_url($url);
    $dsn = sprintf('pgsql:host=%s;port=%d;dbname=%s;sslmode=%s;connect_timeout=3',
        $p['host'] ?? '', (int) ($p['port'] ?? 5432), ltrim($p['path'] ?? '', '/'), getenv('PG_SSLMODE') ?: 'require');
    $t = microtime(true);
    try {
        $pdo = new PDO($dsn, isset($p['user']) ? urldecode($p['user']) : null, isset($p['pass']) ? urldecode($p['pass']) : null,
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_TIMEOUT => 3, PDO::ATTR_EMULATE_PREPARES => true]);
        $pdo->query('SELECT 1');
        $db = 'ok';
    } catch (\Throwable $e) {
        $db = 'down';
        error_log('[health] database unreachable: ' . $e->getMessage());
    }
    $ms = (int) round((microtime(true) - $t) * 1000);
}

http_response_code($db === 'down' ? 503 : 200);
echo json_encode(['status' => $db === 'down' ? 'degraded' : 'ok', 'service' => 'hilads-api', 'db' => $db, 'dbMs' => $ms ?? null]);
