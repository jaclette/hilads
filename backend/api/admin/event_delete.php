<?php

declare(strict_types=1);

admin_require_login();

csrf_verify();

$pdo = Database::pdo();

// Verify event exists
$stmt = $pdo->prepare("
    SELECT ce.channel_id, ce.title, c.status
    FROM channel_events ce
    JOIN channels c ON c.id = ce.channel_id
    WHERE ce.channel_id = :id AND c.type = 'event'
");
$stmt->execute([':id' => $eventId]);
$event = $stmt->fetch();

if (!$event) {
    flash_set('error', 'Event not found.');
    admin_redirect('/admin/events');
}

if ($event['status'] === 'deleted') {
    flash_set('error', 'Event is already deleted.');
    admin_redirect('/admin/events');
}

// Soft delete: mark channel as deleted + expire immediately.
// Mirrors the existing product behavior (same as frontend DELETE /api/v1/events/{id}).
$pdo->prepare("
    UPDATE channels SET status = 'deleted', updated_at = now() WHERE id = :id
")->execute([':id' => $eventId]);

$pdo->prepare("
    UPDATE channel_events SET expires_at = now() WHERE channel_id = :id
")->execute([':id' => $eventId]);

error_log('[admin] event deleted: ' . $eventId . ' (' . $event['title'] . ')');

flash_set('success', 'Event "' . $event['title'] . '" deleted.');
admin_redirect('/admin/events');
