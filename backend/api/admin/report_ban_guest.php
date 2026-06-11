<?php

declare(strict_types=1);

admin_require_login();
csrf_verify();

$pdo  = Database::pdo();
$stmt = $pdo->prepare("SELECT target_guest_id, target_nickname FROM user_reports WHERE id = ?");
$stmt->execute([$reportId]);
$report = $stmt->fetch();

if ($report === false) {
    flash_set('error', 'Report not found.');
    admin_redirect('/admin/reports');
}

$guestId = $report['target_guest_id'] ?? null;
if (empty($guestId)) {
    flash_set('error', 'This report has no guest target to ban.');
    admin_redirect('/admin/reports');
}

try {
    $result = BanRepository::banGuest($guestId, 'admin: report #' . $reportId, 'admin', 7);
    // Resolve the report in the same click so the queue stays clean.
    $pdo->prepare("UPDATE user_reports SET status = 'reviewed' WHERE id = ? AND status = 'open'")
        ->execute([$reportId]);

    $name = $report['target_nickname'] ?: ('Guest ' . substr($guestId, 0, 8));
    flash_set('success', "Banned \"{$name}\" for {$result['days']} days (+{$result['ips']} IP(s)). Report marked reviewed.");
} catch (\Throwable $e) {
    error_log('[admin-ban] report #' . $reportId . ' ban failed: ' . $e->getMessage());
    flash_set('error', 'Ban failed - have you run the migration yet? (' . $e->getMessage() . ')');
}

admin_redirect('/admin/reports');
