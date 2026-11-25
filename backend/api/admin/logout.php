<?php

declare(strict_types=1);

csrf_verify();

if (admin_is_logged_in()) {
    AdminAuth::log('admin.sign_out', 'admin_user', (string) AdminAuth::id());
}
$_SESSION = [];
session_destroy();

admin_redirect('/admin/login');
