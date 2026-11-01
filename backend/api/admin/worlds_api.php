<?php

declare(strict_types=1);

// JSON actions of the Worlds topic page (inline editing; the import step by
// step: the version, then each slide, then the result, for the progress bar). POST + CSRF.

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
        case 'import_start':
            // The version is created and checked; its slides come next, one request each.
            set_time_limit(120);
            $doc = json_decode((string) ($_POST['json'] ?? ''), true);
            if (!is_array($doc)) {
                throw new InvalidArgumentException('That is not valid JSON.');
            }
            $report = DwStudio::import($doc, (int) ($_POST['topic_id'] ?? 0), false)[0] ?? null;
            if ($report === null) {
                throw new InvalidArgumentException('Nothing to import in that file.');
            }
            echo json_encode(['ok' => true, 'report' => $report], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
            break;
        case 'import_slide':
            set_time_limit(120);
            $warnings = DwStudio::renderPlannedSlide((int) ($_POST['package_id'] ?? 0), (int) ($_POST['position'] ?? 0));
            echo json_encode(['ok' => true, 'warnings' => $warnings], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
            break;
        case 'import_done':
            // The topic page shows the result once reloaded, as after a one-request import.
            $warnings = json_decode((string) ($_POST['warnings'] ?? '[]'), true);
            $_SESSION['dw_import_warnings'] = array_values(array_filter(is_array($warnings) ? $warnings : [], 'is_string'));
            flash_set('success', 'Version ' . (int) ($_POST['version'] ?? 0) . ' imported, slides rendered.');
            echo json_encode(['ok' => true]);
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
