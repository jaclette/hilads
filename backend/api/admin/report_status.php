<?php

declare(strict_types=1);

admin_require_login();
csrf_verify();

$allowed = ['open', 'reviewed', 'dismissed'];
$newStatus = $_POST['status'] ?? '';

if (!in_array($newStatus, $allowed, true)) {
    flash_set('error', 'Invalid status.');
    header('Location: /admin/reports');
    exit;
}

$pdo  = Database::pdo();
$stmt = $pdo->prepare("UPDATE user_reports SET status = ? WHERE id = ?");
$stmt->execute([$newStatus, $reportId]);

if ($stmt->rowCount() === 0) {
    flash_set('error', 'Report not found.');
} else {
    flash_set('success', 'Report marked as ' . $newStatus . '.');
}

header('Location: /admin/reports');
exit;
