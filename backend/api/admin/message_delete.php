<?php

declare(strict_types=1);

admin_require_login();

csrf_verify();

// $messageId is set by the boot.php route match.
$pdo = Database::pdo();

$stmt = $pdo->prepare("SELECT channel_id, deleted_at FROM messages WHERE id = :id");
$stmt->execute([':id' => $messageId]);
$row = $stmt->fetch();

// Where to send the moderator back to (preserve their search context).
$channel = $_POST['channel'] ?? ($row['channel_id'] ?? '');
$q       = $_POST['q'] ?? '';
$type    = $_POST['type'] ?? 'all';
$page    = $_POST['page'] ?? '1';
$back    = '/admin/messages?channel=' . urlencode((string) $channel)
         . '&q=' . urlencode((string) $q)
         . '&type=' . urlencode((string) $type)
         . '&page=' . urlencode((string) $page);

if (!$row) {
    flash_set('error', 'Message not found.');
    admin_redirect($channel !== '' ? $back : '/admin/messages');
}

if (!empty($row['deleted_at'])) {
    flash_set('error', 'Message is already deleted.');
    admin_redirect($back);
}

// Soft-delete: clear content + image, stamp deleted_at. Mirrors
// MessageRepository::softDelete() (not loaded on the admin require path) so the
// client renders its usual "deleted" tombstone and reply references stay intact.
$pdo->prepare("
    UPDATE messages
       SET content    = '',
           image_url  = NULL,
           deleted_at = now()
     WHERE id = :id
")->execute([':id' => $messageId]);

error_log('[admin] message soft-deleted: ' . $messageId . ' in ' . ($row['channel_id'] ?? '?'));
flash_set('success', 'Message deleted.');
admin_redirect($back);
