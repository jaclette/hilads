<?php

declare(strict_types=1);

admin_require_login();

csrf_verify();

// $messageId is set by the boot.php route match.
$pdo = Database::pdo();

$stmt = $pdo->prepare("SELECT channel_id FROM messages WHERE id = :id");
$stmt->execute([':id' => $messageId]);
$row = $stmt->fetch();

// Preserve the moderator's context on redirect.
$channel = $_POST['channel'] ?? ($row['channel_id'] ?? '');
$q       = $_POST['q'] ?? '';
$type    = $_POST['type'] ?? 'all';
$from    = $_POST['from'] ?? '';
$to      = $_POST['to'] ?? '';
$view    = $_POST['view'] ?? 'sum';
$page    = $_POST['page'] ?? '1';
$back    = '/admin/messages?channel=' . urlencode((string) $channel)
         . '&q=' . urlencode((string) $q)
         . '&type=' . urlencode((string) $type)
         . '&from=' . urlencode((string) $from)
         . '&to=' . urlencode((string) $to)
         . '&view=' . urlencode((string) $view)
         . '&page=' . urlencode((string) $page);

if (!$row) {
    flash_set('error', 'Message not found.');
    admin_redirect($channel !== '' ? $back : '/admin/messages');
}

// Hard delete: physically remove the row AND its reactions. The FK on
// message_reactions(message_id) is ON DELETE CASCADE, so the reactions go
// automatically - we delete them explicitly too (and count them) so the action
// is unambiguous and survives a future schema change that drops the cascade.
try {
    $pdo->beginTransaction();
    $rStmt = $pdo->prepare("DELETE FROM message_reactions WHERE message_id = :id");
    $rStmt->execute([':id' => $messageId]);
    $reactionsRemoved = $rStmt->rowCount();
    $pdo->prepare("DELETE FROM messages WHERE id = :id")->execute([':id' => $messageId]);
    $pdo->commit();
} catch (\Throwable $e) {
    if ($pdo->inTransaction()) { $pdo->rollBack(); }
    error_log('[admin] message hard-delete failed: ' . $messageId . ' - ' . $e->getMessage());
    flash_set('error', 'Could not delete the message.');
    admin_redirect($back);
}

error_log('[admin] message HARD-deleted: ' . $messageId . ' in ' . ($row['channel_id'] ?? '?')
        . ' (' . $reactionsRemoved . ' reactions)');
flash_set('success', 'Message permanently deleted'
    . ($reactionsRemoved > 0 ? " ({$reactionsRemoved} reaction" . ($reactionsRemoved === 1 ? '' : 's') . " removed)" : '') . '.');
admin_redirect($back);
