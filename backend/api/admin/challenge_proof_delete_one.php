<?php

declare(strict_types=1);

admin_require_login();

csrf_verify();

// $challengeId + $proofId are set by the boot.php route match. Deletes ONE
// specific submission from a GROUP photo-proof contest (the per-photo moderation
// path - the legacy single-proof delete lives in challenge_proof_delete.php).
$pdo = Database::pdo();

$city = $_POST['city'] ?? '';
$from = $_POST['from'] ?? '';
$to   = $_POST['to']   ?? '';
$view = $_POST['view'] ?? 'sum';
$back = '/admin/challenges?city=' . urlencode((string) $city)
      . '&from=' . urlencode((string) $from)
      . '&to='   . urlencode((string) $to)
      . '&view=' . urlencode((string) $view);

// Verify the proof belongs to this challenge before deleting (don't trust the
// id in the URL on its own).
$stmt = $pdo->prepare("
    SELECT p.id
    FROM challenge_proofs p
    JOIN challenge_acceptances a ON a.id = p.acceptance_id
    WHERE p.id = :pid AND a.challenge_id = :cid
    LIMIT 1
");
$stmt->execute([':pid' => $proofId, ':cid' => $challengeId]);
if (!$stmt->fetchColumn()) {
    flash_set('error', 'That photo does not belong to this challenge.');
    admin_redirect($back);
}

$pdo->prepare("DELETE FROM challenge_proofs WHERE id = :id")->execute([':id' => $proofId]);

error_log('[admin] group submission deleted: challenge=' . $challengeId . ' proof=' . $proofId);
flash_set('success', 'Photo submission deleted.');
admin_redirect($back);
