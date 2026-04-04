<?php

declare(strict_types=1);

admin_require_login();

csrf_verify();

$pdo  = Database::pdo();
$mode = $_POST['mode'] ?? 'single'; // 'single' | 'series'

// Verify event exists
$stmt = $pdo->prepare("
    SELECT ce.channel_id, ce.title, ce.series_id, c.status
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

if ($mode === 'series') {
    if (empty($event['series_id'])) {
        flash_set('error', 'This event is not part of a recurring series.');
        admin_redirect('/admin/events');
    }

    EventSeriesRepository::deleteSeries($event['series_id']);

    error_log('[admin] series deleted: series_id=' . $event['series_id'] . ' triggered by event=' . $eventId);
    flash_set('success', 'Recurring series "' . $event['title'] . '" and all future occurrences deleted.');
} else {
    // Single occurrence: soft-delete channel + expire immediately
    $pdo->prepare("
        UPDATE channels SET status = 'deleted', updated_at = now() WHERE id = :id
    ")->execute([':id' => $eventId]);

    $pdo->prepare("
        UPDATE channel_events SET expires_at = now() WHERE channel_id = :id
    ")->execute([':id' => $eventId]);

    error_log('[admin] event deleted: ' . $eventId . ' (' . $event['title'] . ')');
    flash_set('success', 'Event "' . $event['title'] . '" deleted.');
}

admin_redirect('/admin/events');
