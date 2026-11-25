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
