<?php

declare(strict_types=1);

admin_require_login();

csrf_verify();

// $challengeId is set by the boot.php route match (the challenge channel id).
$pdo = Database::pdo();

$stmt = $pdo->prepare("
    SELECT cc.title, cc.city_id, c.status
    FROM channel_challenges cc
    JOIN channels c ON c.id = cc.channel_id
    WHERE cc.channel_id = :id
");
$stmt->execute([':id' => $challengeId]);
$row = $stmt->fetch();

$city = $_POST['city'] ?? ($row['city_id'] ?? '');
$from = $_POST['from'] ?? '';
$to   = $_POST['to'] ?? '';
$view = $_POST['view'] ?? 'sum';
$back = '/admin/challenges?city=' . urlencode((string) $city)
      . '&from=' . urlencode((string) $from)
      . '&to=' . urlencode((string) $to)
      . '&view=' . urlencode((string) $view);

if (!$row) {
    flash_set('error', 'Challenge not found.');
    admin_redirect($city !== '' ? $back : '/admin/challenges');
}

if ($row['status'] === 'deleted') {
    flash_set('error', 'Challenge is already deleted.');
    admin_redirect($back);
}

// Soft-delete: hide the challenge channel (same convention as events / hangouts
// and the app's ChallengeRepository::delete).
$pdo->prepare("UPDATE channels SET status = 'deleted', updated_at = now() WHERE id = :id")
    ->execute([':id' => $challengeId]);

// Remove the persisted city-feed pill(s) (origin + target city for
// international) so the "X challenges the locals: …" entry doesn't dangle.
MessageRepository::deleteFeedAnnouncementsFor('challenge', $challengeId);

error_log('[admin] challenge deleted: ' . $challengeId . ' (' . ($row['title'] ?? '') . ')');
flash_set('success', 'Challenge "' . ($row['title'] ?? '') . '" deleted.');
admin_redirect($back);
