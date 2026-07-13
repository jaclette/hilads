<?php

declare(strict_types=1);

// Admin: crown the winning photo for a GROUP photo-proof challenge. Needed for
// @hilads campaign challenges, where no human challenger is logged in to pick.
// Mirrors the core of POST /challenges/{id}/pick-winner (winner +40 [the campaign
// trigger doubles it], status→validated, winning proof approved, host rewards,
// reveal notifications). The World "won" hook + live WS pings are route-level and
// omitted here - clients refetch results on foreground.

admin_require_login();
csrf_verify();

// $challengeId is set by the boot.php route match ([a-f0-9]+).
$pdo   = Database::pdo();
$back  = '/admin/challenges/' . urlencode($challengeId) . '/submissions';
$month = gmdate('Y-m');

$winnerUserId = trim((string) ($_POST['winner_user_id'] ?? ''));
if (!preg_match('/^[a-f0-9]{32}$/', $winnerUserId)) {
    flash_set('error', 'Invalid winner user id.');
    admin_redirect($back);
}

$challenge = ChallengeRepository::findByIdUnchecked($challengeId);
if ($challenge === null) {
    flash_set('error', 'Challenge not found.');
    admin_redirect('/admin/challenges');
}
$isPhoto = ($challenge['validation_method'] ?? 'meet') === 'photo_proof' || ($challenge['mode'] ?? 'local') === 'international';
if (($challenge['challenge_format'] ?? 'legacy') !== 'group' || !$isPhoto) {
    flash_set('error', 'Not a group photo-proof challenge — no winner to pick.');
    admin_redirect($back);
}

// One winner per challenge (self-heal a stuck 'open' status on repeat).
$already = $pdo->prepare("SELECT 1 FROM score_events WHERE challenge_id = ? AND kind = 'winner' LIMIT 1");
$already->execute([$challengeId]);
if ($already->fetchColumn()) {
    $pdo->prepare("UPDATE channel_challenges SET status='validated', validated_at=COALESCE(validated_at,now()), updated_at=now() WHERE channel_id = ? AND status = 'open'")
        ->execute([$challengeId]);
    flash_set('error', 'A winner has already been picked for this challenge.');
    admin_redirect($back);
}

// Winner must have a real submitted photo.
$accStmt = $pdo->prepare("
    SELECT ca.id FROM challenge_acceptances ca
    WHERE ca.challenge_id = ? AND ca.acceptor_user_id = ?
      AND EXISTS (SELECT 1 FROM challenge_proofs p WHERE p.acceptance_id = ca.id)
    ORDER BY ca.created_at DESC LIMIT 1");
$accStmt->execute([$challengeId, $winnerUserId]);
$winnerAcc = $accStmt->fetchColumn();
if (!$winnerAcc) {
    flash_set('error', 'That participant has no submitted photo.');
    admin_redirect($back);
}

$challengerUserId = $challenge['created_by'] ?? null;   // @hilads for a campaign

// ── Winner +40 (campaign trigger doubles). International → winner's own board. ──
$pts = (int) ($pdo->query("SELECT points FROM score_rules WHERE kind='winner' AND role='taker'")->fetchColumn() ?: 0);
if ($pts > 0) {
    $city = $challenge['city_id'] ?? null;
    if (($challenge['mode'] ?? 'local') === 'international') {
        $cs = $pdo->prepare("SELECT current_city_id FROM users WHERE id = ?");
        $cs->execute([$winnerUserId]);
        $city = $cs->fetchColumn() ?: ($challenge['city_id'] ?? null);
    }
    $pdo->prepare("
        INSERT INTO score_events (id, user_id, challenge_id, role, kind, points, city_id, month_ref, acceptance_id)
        VALUES (encode(gen_random_bytes(8),'hex'), ?, ?, 'taker', 'winner', ?, ?, ?, ?)
        ON CONFLICT DO NOTHING
    ")->execute([$winnerUserId, $challengeId, $pts, $city, $month, $winnerAcc]);
}

// Status → validated + approve the winning proof (surfaces in the showcase).
$pdo->prepare("UPDATE channel_challenges SET status='validated', validated_at=COALESCE(validated_at,now()), updated_at=now() WHERE channel_id = ?")
    ->execute([$challengeId]);
$pdo->prepare("
    UPDATE challenge_proofs SET status = 'approved', reviewed_at = now()
    WHERE id = (SELECT id FROM challenge_proofs WHERE acceptance_id = ? ORDER BY submitted_at DESC LIMIT 1)
")->execute([$winnerAcc]);

// ── Host rewards to the creator (@hilads earns nothing via the is_admin score
// trigger, but insert for parity with the normal flow) + reveal notifications. ──
if ($challengerUserId) {
    $basePts = (int) ($pdo->query("SELECT points FROM score_rules WHERE kind='present_host_base' AND role='challenger'")->fetchColumn() ?: 10);
    $perHead = (int) ($pdo->query("SELECT points FROM score_rules WHERE kind='photo_host' AND role='challenger'")->fetchColumn() ?: 5);
    $hostCity = $challenge['city_id'] ?? null;

    $subStmt = $pdo->prepare("
        SELECT a.id AS acceptance_id, a.acceptor_user_id AS user_id
        FROM challenge_acceptances a
        WHERE a.challenge_id = ?
          AND EXISTS (SELECT 1 FROM challenge_proofs p WHERE p.acceptance_id = a.id)
    ");
    $subStmt->execute([$challengeId]);
    $submitters = $subStmt->fetchAll(\PDO::FETCH_ASSOC);

    $pdo->prepare("
        INSERT INTO score_events (id, user_id, challenge_id, role, kind, points, city_id, month_ref, acceptance_id)
        VALUES (encode(gen_random_bytes(8),'hex'), ?, ?, 'challenger', 'present_host_base', ?, ?, ?, NULL)
        ON CONFLICT DO NOTHING
    ")->execute([$challengerUserId, $challengeId, $basePts, $hostCity, $month]);
    $phStmt = $pdo->prepare("
        INSERT INTO score_events (id, user_id, challenge_id, role, kind, points, city_id, month_ref, acceptance_id)
        VALUES (encode(gen_random_bytes(8),'hex'), ?, ?, 'challenger', 'photo_host', ?, ?, ?, ?)
        ON CONFLICT (user_id, challenge_id, role, kind, acceptance_id) DO NOTHING
    ");
    foreach ($submitters as $s) {
        $phStmt->execute([$challengerUserId, $challengeId, $perHead, $hostCity, $month, $s['acceptance_id']]);
    }

    // Reveal fan-out: notify every submitter (winner + losers) with their result.
    $subsFull    = ChallengeProofRepository::listGroupSubmissions($challengeId);
    $winnerName  = null; $winnerPhoto = null;
    foreach ($subsFull as $r) {
        if (($r['user_id'] ?? null) === $winnerUserId) { $winnerName = $r['display_name'] ?? null; $winnerPhoto = $r['media_url'] ?? null; break; }
    }
    foreach ($submitters as $s) {
        $isWin = $s['user_id'] === $winnerUserId;
        try {
            NotificationRepository::notifyGroupResult($s['user_id'], $challengeId, 'photo', 'Hilads', [
                'format'           => 'photo',
                'myRole'           => $isWin ? 'winner' : 'loser',
                'myPoints'         => $isWin ? $pts : 5,
                'winnerUserId'     => $winnerUserId,
                'winnerName'       => $winnerName,
                'winnerPhotoUrl'   => $winnerPhoto,
                'participantCount' => count($submitters),
                'challengeTitle'   => $challenge['title'] ?? '',
            ]);
        } catch (\Throwable $e) {
            error_log('[admin] pick-winner reveal notify failed (non-fatal): ' . $e->getMessage());
        }
    }
}

error_log('[admin] winner crowned for ' . $challengeId . ' → ' . $winnerUserId);
flash_set('success', 'Winner crowned 🏆 — points awarded (2× for the campaign).');
admin_redirect($back);
