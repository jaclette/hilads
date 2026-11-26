<?php

declare(strict_types=1);

/** Fully signed in (password + 2FA when needed), session not timed out, account active. */
function admin_is_logged_in(): bool
{
    static $ok = null;
    if ($ok !== null) return $ok;
    if (empty($_SESSION['admin_uid'])) return $ok = false;
    if (!AdminAuth::sessionAlive()) {
        $_SESSION = [];
        flash_set('error', 'You were signed out after a while without activity. Sign in again.');
        return $ok = false;
    }
    return $ok = AdminAuth::user() !== null;
}

/**
 * Every admin page and form handler calls this first: signed in, password not to be changed,
 * 2FA set up when the role needs it, and the role allowed on this page (GET) or action (POST).
 */
function admin_require_login(): void
{
    global $uri, $method;
    if (!admin_is_logged_in()) {
        if (($method ?? 'GET') === 'GET' && !str_starts_with((string) $uri, '/admin/api/')) {
            $_SESSION['admin_after_login'] = $_SERVER['REQUEST_URI'] ?? '/admin';
        }
        admin_redirect('/admin/login');
    }
    $u = AdminAuth::user();
    $onAccount = str_starts_with((string) $uri, '/admin/account');
    if (!$onAccount && $u['must_change_password']) {
        flash_set('error', 'Choose a new password before going on.');
        admin_redirect('/admin/account');
    }
    if (!$onAccount && AdminAuth::needs2fa($u) && !AdminAuth::has2fa($u)) {
        admin_redirect('/admin/account/2fa');
    }
    if (!AdminAuth::allowed((string) $uri, (string) $method)) {
        admin_forbidden(AdminAuth::area((string) $uri), (string) $method);
    }
    // Danger zone (and the other game-wide actions in its area): a fresh 2FA code first, even on a trusted device.
    if (AdminAuth::area((string) $uri) === 'danger' && AdminAuth::has2fa($u) && !AdminAuth::reauthFresh()) {
        if (($method ?? 'GET') === 'GET') {
            $_SESSION['admin_after_reauth'] = $_SERVER['REQUEST_URI'] ?? '/admin/danger';
        } else {
            $_SESSION['admin_after_reauth'] = '/admin/danger';
            flash_set('error', 'Confirm with a code from your app first. Nothing was changed.');
        }
        admin_redirect('/admin/account/verify');
    }
}

/** The signed-in admin's name, for "updated by" columns and logs. */
function admin_actor(): string
{
    return AdminAuth::name() ?? (string) (getenv('ADMIN_USERNAME') ?: 'admin');
}

function admin_can_edit(string $uriOrArea): bool
{
    $area = str_starts_with($uriOrArea, '/') ? AdminAuth::area($uriOrArea) : $uriOrArea;
    return AdminAuth::canEdit(AdminAuth::role(), $area);
}

function admin_forbidden(string $area, string $method): never
{
    http_response_code(403);
    $what  = AdminAuth::AREA_LABELS[$area] ?? 'this page';
    $role  = AdminAuth::ROLES[AdminAuth::role() ?? ''] ?? '';
    $title = $area === 'archive' && $method !== 'GET' ? 'The Archive is read-only' : 'Not allowed';
    $text  = $area === 'archive' && $method !== 'GET'
        ? 'Archived pages keep their data but can no longer be changed.'
        : ($method === 'GET'
            ? "Your role ({$role}) can't open {$what}."
            : "Your role ({$role}) can look at {$what} but not change it. Nothing was changed.");
    admin_head($title);
    admin_nav('');
    echo '<div class="admin-main"><h1 class="page-title">' . htmlspecialchars($title) . '</h1>'
       . '<div class="callout">' . htmlspecialchars($text) . ' Ask a super admin if you need it.</div>'
       . '<p style="margin-top:16px"><a class="btn btn-secondary" href="/admin">Back to the dashboard</a></p></div>';
    admin_foot();
    exit;
}

/**
 * Typed confirmation, checked on the server: the posted `confirm_phrase` must equal $phrase
 * (case-insensitive, spaces trimmed), else nothing happens and the admin goes back to $back.
 */
function admin_require_phrase(string $phrase, string $back): void
{
    $typed = strtoupper(preg_replace('/\s+/', ' ', trim((string) ($_POST['confirm_phrase'] ?? ''))));
    if ($typed !== strtoupper($phrase)) {
        flash_set('error', 'Type "' . $phrase . '" exactly to confirm. Nothing was changed.');
        admin_redirect($back);
    }
}

function admin_require_super(string $back = '/admin'): void
{
    if (!AdminAuth::isSuper()) {
        flash_set('error', 'Only a super admin can do this. Nothing was changed.');
        admin_redirect($back);
    }
}

function admin_redirect(string $path): never
{
    header('Location: ' . $path);
    exit;
}

function admin_die(string $message): never
{
    http_response_code(400);
    admin_head('Error');
    admin_nav('');
    echo '<div class="admin-main"><h1 class="page-title">Something went wrong</h1>'
       . '<div class="flash flash-error">' . htmlspecialchars($message) . '</div>'
       . '<p style="margin-top:16px"><a class="btn btn-secondary" href="javascript:history.back()">Go back</a></p></div>';
    admin_foot();
    exit;
}

/**
 * Audit safety net (registered for every POST in boot.php): a change that went through but wrote
 * no audit line of its own gets a generic one, so every back office change is in the log with its
 * person, page, button and submitted fields (never passwords, tokens or typed phrases).
 * "Went through" = a success message was set, or the answer is a redirect / JSON without an error.
 */
function admin_audit_fallback(): void
{
    global $uri;
    if (DailyAdminService::$writes > 0 || !class_exists('AdminAuth') || AdminAuth::user() === null) return;
    $path = (string) $uri;
    foreach (['/admin/login', '/admin/logout', '/admin/account', '/admin/search', '/admin/assets'] as $skip) {
        if (str_starts_with($path, $skip)) return;
    }
    // Lookups sent by POST (counts, searches, previews) change nothing.
    $button = (string) ($_POST['action'] ?? $_POST['do'] ?? '');
    if (in_array($button, ['search_user', 'count', 'search', 'preview', 'check', 'lookup'], true)) return;
    $flash = $_SESSION['admin_flash'] ?? [];
    $types = array_column($flash, 'type');
    if (in_array('error', $types, true)) return;
    $headers = implode("\n", headers_list());
    $redirectOrJson = stripos($headers, 'Location:') !== false || stripos($headers, 'application/json') !== false;
    if (!in_array('success', $types, true) && !$redirectOrJson) return;

    $fields = [];
    foreach ($_POST as $k => $v) {
        if (preg_match('/csrf|password|phrase|token|secret|code$/i', (string) $k)) continue;
        $val = is_array($v) ? json_encode($v, JSON_UNESCAPED_UNICODE) : (string) $v;
        $fields[$k] = mb_strlen($val) > 300 ? mb_substr($val, 0, 300) . '…' : $val;
    }
    foreach ($_FILES as $k => $f) {
        if (is_array($f['name'] ?? null)) $fields[$k] = 'files: ' . implode(', ', array_filter($f['name']));
        elseif (($f['name'] ?? '') !== '') $fields[$k] = 'file: ' . $f['name'];
    }
    $slug = trim(preg_replace('#[^a-z0-9]+#', '_', strtolower(substr($path, strlen('/admin')))), '_') ?: 'dashboard';
    $json = json_encode($fields, JSON_UNESCAPED_UNICODE);
    if (strlen((string) $json) > 4000) $fields = ['fields' => mb_substr((string) $json, 0, 4000) . '…'];
    AdminAuth::log('page.' . $slug . ($button !== '' ? '.' . preg_replace('/[^a-z0-9_:-]/i', '', explode(':', $button)[0]) : ''),
        'page', $path, null, $fields + ($flash ? ['message' => (string) end($flash)['message']] : []));
}
