<?php

declare(strict_types=1);

admin_require_login();
csrf_verify();

// $banId is set by the boot.php route match.
try {
    BanRepository::unban((int) $banId);
    flash_set('success', 'Ban lifted.');
} catch (\Throwable $e) {
    error_log('[admin-ban] unban failed: ' . $e->getMessage());
    flash_set('error', 'Could not lift the ban: ' . $e->getMessage());
}

admin_redirect('/admin/bans');
