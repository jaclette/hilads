<?php

declare(strict_types=1);

admin_require_login();
csrf_verify();

// $banId is set by the boot.php route match.
try {
    $st = Database::pdo()->prepare("SELECT guest_id, ip_address, reason, created_by, created_at, expires_at FROM bans WHERE id = ?");
    $st->execute([(int) $banId]);
    $before = $st->fetch(PDO::FETCH_ASSOC) ?: null;
    BanRepository::unban((int) $banId);
    // The ban row is deleted: the audit line keeps what it was.
    AdminAuth::log('ban.lift', 'ban', (string) $banId, $before, ['lifted' => true]);
    flash_set('success', 'Ban lifted.');
} catch (\Throwable $e) {
    error_log('[admin-ban] unban failed: ' . $e->getMessage());
    flash_set('error', 'Could not lift the ban: ' . $e->getMessage());
}

admin_redirect('/admin/bans');
