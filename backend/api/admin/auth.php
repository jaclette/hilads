<?php

declare(strict_types=1);

function admin_is_logged_in(): bool
{
    return isset($_SESSION['admin_logged_in']) && $_SESSION['admin_logged_in'] === true;
}

function admin_require_login(): void
{
    if (!admin_is_logged_in()) {
        header('Location: /admin/login');
        exit;
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
    echo '<html><body style="font-family:sans-serif;padding:40px;background:#0f0f0f;color:#e0e0e0">';
    echo '<h2>Error</h2><p>' . htmlspecialchars($message) . '</p>';
    echo '<p><a href="javascript:history.back()" style="color:#FF7A3C">← Go back</a></p>';
    echo '</body></html>';
    exit;
}
