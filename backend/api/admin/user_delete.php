<?php

declare(strict_types=1);

admin_require_login();
csrf_verify();

if ($method !== 'POST') {
    http_response_code(405);
    exit;
}

$user = UserRepository::findById($userId);

if ($user === null) {
    flash_set('error', 'User not found.');
    admin_redirect('/admin/users');
}

if ($user['deleted_at'] !== null) {
    flash_set('error', 'User is already deleted.');
    admin_redirect('/admin/users');
}

UserRepository::softDelete($userId);

$name = $user['display_name'] ?? $userId;
flash_set('success', "User \"{$name}\" has been deleted (soft). Sessions cleared.");
admin_redirect('/admin/users');
