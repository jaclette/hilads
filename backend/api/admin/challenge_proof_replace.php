<?php

declare(strict_types=1);

admin_require_login();

csrf_verify();

// $challengeId is set by the boot.php route match (the challenge channel id).
$pdo = Database::pdo();

$city = $_POST['city'] ?? '';
$from = $_POST['from'] ?? '';
$to   = $_POST['to']   ?? '';
$view = $_POST['view'] ?? 'sum';
$back = '/admin/challenges?city=' . urlencode((string) $city)
      . '&from=' . urlencode((string) $from)
      . '&to='   . urlencode((string) $to)
      . '&view=' . urlencode((string) $view);

// Latest proof across this challenge's acceptances (what the row displays).
$stmt = $pdo->prepare("
    SELECT p.id
    FROM challenge_proofs p
    JOIN challenge_acceptances a ON a.id = p.acceptance_id
    WHERE a.challenge_id = :id
    ORDER BY p.submitted_at DESC
    LIMIT 1
");
$stmt->execute([':id' => $challengeId]);
$proofId = $stmt->fetchColumn();

if (!$proofId) {
    flash_set('error', 'No photo proof found for this challenge.');
    admin_redirect($back);
}

// Reuse the admin image-upload helper (validates type/size, uploads to R2).
try {
    $url = admin_upload_avatar($_FILES['photo'] ?? null);
} catch (\RuntimeException $e) {
    flash_set('error', $e->getMessage());
    admin_redirect($back);
}
if ($url === null) {
    flash_set('error', 'No photo selected.');
    admin_redirect($back);
}

$pdo->prepare("UPDATE challenge_proofs SET media_url = :url, media_type = 'image' WHERE id = :id")
    ->execute([':url' => $url, ':id' => $proofId]);

error_log('[admin] challenge proof replaced: challenge=' . $challengeId . ' proof=' . $proofId);
flash_set('success', 'Photo proof replaced.');
admin_redirect($back);
