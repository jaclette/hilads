<?php

declare(strict_types=1);

// Admin backoffice bootstrap.
// Loaded from public/index.php when URI starts with /admin.

session_name('hilads_admin');
session_set_cookie_params([
    'lifetime' => 0,          // session cookie (browser close = logout)
    'path'     => '/admin',
    'secure'   => isset($_SERVER['HTTPS']),
    'httponly' => true,
    'samesite' => 'Strict',
]);
session_start();

require_once __DIR__ . '/auth.php';
require_once __DIR__ . '/csrf.php';
require_once __DIR__ . '/flash.php';
require_once __DIR__ . '/layout.php';

$uri    = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');

// Simple admin router
if ($uri === '/admin' || $uri === '/admin/') {
    require __DIR__ . '/dashboard.php';

} elseif ($uri === '/admin/login') {
    require __DIR__ . '/login.php';

} elseif ($uri === '/admin/logout' && $method === 'POST') {
    require __DIR__ . '/logout.php';

} elseif ($uri === '/admin/users') {
    require __DIR__ . '/users.php';

} elseif ($uri === '/admin/users/create') {
    require __DIR__ . '/user_create.php';

} elseif (preg_match('#^/admin/users/([^/]+)/edit$#', $uri, $m)) {
    $userId = $m[1];
    require __DIR__ . '/user_edit.php';

} elseif (preg_match('#^/admin/users/([^/]+)/delete$#', $uri, $m) && $method === 'POST') {
    $userId = $m[1];
    require __DIR__ . '/user_delete.php';

} elseif (preg_match('#^/admin/users/([^/]+)/roles$#', $uri, $m)) {
    $userId = $m[1];
    require __DIR__ . '/user_roles.php';

} elseif ($uri === '/admin/events') {
    require __DIR__ . '/events.php';

} elseif ($uri === '/admin/events/create') {
    require __DIR__ . '/event_create.php';

} elseif (preg_match('#^/admin/api/cities/(\d+)/members$#', $uri, $m) && $method === 'GET') {
    admin_require_login();
    $cId  = (int) $m[1];
    $city = CityRepository::findById($cId);
    if (!$city) { http_response_code(404); echo '[]'; exit; }
    $ck   = 'city_' . $cId;
    $stmt = Database::pdo()->prepare("
        SELECT DISTINCT u.id, u.display_name
        FROM users u
        LEFT JOIN user_city_memberships m ON m.user_id = u.id AND m.channel_id = :ck
        WHERE m.channel_id IS NOT NULL
           OR LOWER(TRIM(COALESCE(u.home_city, ''))) = LOWER(TRIM(:cn))
        ORDER BY u.display_name ASC
        LIMIT 100
    ");
    $stmt->execute([':ck' => $ck, ':cn' => $city['name']]);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($stmt->fetchAll(PDO::FETCH_ASSOC));
    exit;

} elseif (preg_match('#^/admin/events/([a-zA-Z0-9]+)/edit$#', $uri, $m)) {
    $eventId = $m[1];
    require __DIR__ . '/event_edit.php';

} elseif (preg_match('#^/admin/events/([a-zA-Z0-9]+)/delete$#', $uri, $m) && $method === 'POST') {
    $eventId = $m[1];
    require __DIR__ . '/event_delete.php';

} else {
    http_response_code(404);
    admin_head('Not Found');
    echo '<div class="admin-main"><h1 class="page-title">404 Not Found</h1>';
    echo '<p style="color:#666">The page you\'re looking for doesn\'t exist.</p>';
    echo '<p style="margin-top:12px"><a href="/admin" class="btn btn-secondary btn-sm">← Dashboard</a></p>';
    echo '</div>';
    admin_foot();
}
