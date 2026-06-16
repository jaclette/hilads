<?php

declare(strict_types=1);

admin_require_login();
csrf_verify();

$target = $_POST['target'] ?? 'ip';
$value  = trim($_POST['value'] ?? '');
$reason = trim($_POST['reason'] ?? '') ?: null;
$days   = (int) ($_POST['days'] ?? 0);

if ($value === '') {
    flash_set('error', 'Enter an IP or guest id to block.');
    admin_redirect('/admin/bans');
}

try {
    if ($target === 'guest') {
        BanRepository::banGuestId($value, $reason, 'admin', $days);
        flash_set('success', 'Blocked guest ' . $value . ($days > 0 ? " for {$days} day(s)." : ' permanently.'));
    } elseif ($target === 'guest_fanout') {
        $res = BanRepository::banGuest($value, $reason, 'admin', $days > 0 ? $days : 36500);
        flash_set('success', "Blocked guest {$value} (+{$res['ips']} IP(s)).");
    } else { // ip
        BanRepository::banIp($value, $reason, 'admin', $days);
        flash_set('success', 'Blocked IP ' . $value . ($days > 0 ? " for {$days} day(s)." : ' permanently.'));
    }
} catch (\Throwable $e) {
    error_log('[admin-ban] add failed: ' . $e->getMessage());
    flash_set('error', 'Ban failed (migration run?): ' . $e->getMessage());
}

admin_redirect('/admin/bans');
