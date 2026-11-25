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
        BanRepository::banGuestId($value, $reason, admin_actor(), $days);
        AdminAuth::log('ban.add', 'ban', null, null, ['guest' => $value, 'days' => $days, 'reason' => $reason]);
        flash_set('success', 'Guest banned' . ($days > 0 ? " for {$days} day(s)." : ' permanently.'));
    } elseif ($target === 'guest_fanout') {
        $res = BanRepository::banGuest($value, $reason, admin_actor(), $days > 0 ? $days : 36500);
        AdminAuth::log('ban.add', 'ban', null, null, ['guest' => $value, 'with_ips' => $res['ips'], 'days' => $days, 'reason' => $reason]);
        flash_set('success', "Guest banned, with {$res['ips']} IP address(es).");
    } else { // ip
        BanRepository::banIp($value, $reason, admin_actor(), $days);
        AdminAuth::log('ban.add', 'ban', null, null, ['ip' => $value, 'days' => $days, 'reason' => $reason]);
        flash_set('success', 'IP address banned' . ($days > 0 ? " for {$days} day(s)." : ' permanently.'));
    }
} catch (\Throwable $e) {
    error_log('[admin-ban] add failed: ' . $e->getMessage());
    flash_set('error', 'The ban did not work: ' . $e->getMessage());
}

admin_redirect('/admin/bans');
