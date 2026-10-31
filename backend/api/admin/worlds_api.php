<?php

declare(strict_types=1);

// JSON actions of the Worlds topic page (inline editing). POST + CSRF.

admin_require_login();
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['ok' => false, 'error' => 'POST only']);
    exit;
}
$token = $_POST['csrf_token'] ?? '';
if (!is_string($token) || !hash_equals(csrf_token(), $token)) {
    http_response_code(403);
    echo json_encode(['ok' => false, 'error' => 'Session expired, reload the page.']);
    exit;
}

try {
    switch ((string) ($_POST['action'] ?? '')) {
        case 'update_field':
            set_time_limit(60);
            $out = DwStudio::updateField((int) ($_POST['package_id'] ?? 0), (string) ($_POST['path'] ?? ''), (string) ($_POST['value'] ?? ''));
            echo json_encode(['ok' => true] + $out, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
            break;
        default:
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => 'Unknown action']);
    }
} catch (InvalidArgumentException $e) {
    http_response_code(422);
    echo json_encode(['ok' => false, 'error' => $e->getMessage()]);
} catch (Throwable $e) {
    error_log('[hilads] worlds api: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'Server error: ' . $e->getMessage()]);
}
