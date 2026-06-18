<?php

declare(strict_types=1);

admin_require_login();

// $challengeId is set by the boot.php route match (the challenge channel id).
$pdo    = Database::pdo();
$method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');

$TYPES        = ['food', 'place', 'culture', 'help'];
$VALIDATIONS  = ['meet', 'photo_proof'];
$VISIBILITIES = ['public', 'friends'];
$STATUSES     = ['open', 'validated'];

$stmt = $pdo->prepare("
    SELECT cc.channel_id, cc.title, cc.challenge_type, cc.audience, cc.mode,
           cc.validation_method, cc.return_clause, cc.proof_requirements,
           cc.visibility, cc.status, cc.city_id, cc.created_by, cc.guest_id,
           c.status AS channel_status, cy.name AS city_name
    FROM channel_challenges cc
    JOIN channels c ON c.id = cc.channel_id
    LEFT JOIN channels cy ON cy.id = cc.city_id
    WHERE cc.channel_id = :id
");
$stmt->execute([':id' => $challengeId]);
$ch = $stmt->fetch();

if (!$ch) {
    admin_head('Challenge Not Found');
    admin_nav('/admin/challenges');
    echo '<div class="admin-main"><h1 class="page-title">Challenge not found</h1>'
       . '<p style="margin-top:12px"><a href="/admin/challenges" class="btn btn-secondary btn-sm">← Back</a></p></div>';
    admin_foot();
    return;
}

$isIntl = ($ch['mode'] ?? 'local') === 'international';
$errors = [];

if ($method === 'POST') {
    csrf_verify();

    $newTitle      = mb_substr(trim(strip_tags($_POST['title'] ?? '')), 0, 100);
    $newType       = $_POST['challenge_type'] ?? $ch['challenge_type'];
    $newReturn     = mb_substr(trim(strip_tags($_POST['return_clause'] ?? '')), 0, 200);
    $newProofReq   = mb_substr(trim(strip_tags($_POST['proof_requirements'] ?? '')), 0, 300);
    // International is locked server-side: photo_proof + public.
    $newValidation = $isIntl ? 'photo_proof' : ($_POST['validation_method'] ?? $ch['validation_method'] ?? 'meet');
    $newVisibility = $isIntl ? 'public'      : ($_POST['visibility'] ?? $ch['visibility'] ?? 'public');
    $newStatus     = $_POST['status'] ?? $ch['status'] ?? 'open';

    if ($newTitle === '')                                   $errors[] = 'Title is required.';
    if (!in_array($newType, $TYPES, true))                 $errors[] = 'Invalid type.';
    if (!in_array($newValidation, $VALIDATIONS, true))     $errors[] = 'Invalid validation method.';
    if (!in_array($newVisibility, $VISIBILITIES, true))    $errors[] = 'Invalid visibility.';
    if (!in_array($newStatus, $STATUSES, true))            $errors[] = 'Invalid status.';

    if (empty($errors)) {
        $pdo->prepare("
            UPDATE channel_challenges SET
                title              = :t,
                challenge_type     = :tp,
                validation_method  = :vm,
                return_clause      = :rc,
                proof_requirements = :pr,
                visibility         = :viz,
                status             = :st,
                validated_at       = CASE WHEN :st2 = 'validated' THEN COALESCE(validated_at, now()) ELSE validated_at END,
                updated_at         = now()
            WHERE channel_id = :id
        ")->execute([
            't'   => $newTitle,
            'tp'  => $newType,
            'vm'  => $newValidation,
            'rc'  => $newReturn !== '' ? $newReturn : null,
            'pr'  => $isIntl && $newProofReq !== '' ? $newProofReq : null,
            'viz' => $newVisibility,
            'st'  => $newStatus,
            'st2' => $newStatus,
            'id'  => $challengeId,
        ]);
        // Keep the channel name in sync with the title (used as display name).
        $pdo->prepare("UPDATE channels SET name = :n, updated_at = now() WHERE id = :id")
            ->execute([':n' => $newTitle, ':id' => $challengeId]);

        error_log('[admin] challenge edited: ' . $challengeId);
        flash_set('success', 'Challenge updated. (The app reflects the change on its next load.)');
        admin_redirect('/admin/challenges/' . urlencode($challengeId) . '/edit');
    }
    // On error, re-fetch the (unchanged) row for the form, $_POST overlays it.
}

admin_head('Edit challenge');
admin_nav('/admin/challenges');
$backHref = '/admin/challenges?city=' . urlencode($ch['city_id'] ?? '');
?>
<div class="admin-main">
    <div style="margin-bottom:16px">
        <a href="<?= $backHref ?>" class="btn btn-secondary btn-sm">← Challenges</a>
    </div>

    <h1 class="page-title">Edit challenge</h1>

    <?= flash_html() ?>

    <?php if (!empty($errors)): ?>
        <div class="flash flash-error">
            <?php foreach ($errors as $e): ?><div><?= htmlspecialchars($e, ENT_QUOTES) ?></div><?php endforeach; ?>
        </div>
    <?php endif; ?>

    <div class="form-card" style="margin-bottom:16px">
        <div class="info-section">
            <h3>Challenge Info</h3>
            <div class="info-grid">
                <div class="info-label">ID</div>     <div class="info-value td-mono"><?= htmlspecialchars($ch['channel_id'], ENT_QUOTES) ?></div>
                <div class="info-label">City</div>   <div class="info-value"><?= htmlspecialchars($ch['city_name'] ?? '-', ENT_QUOTES) ?></div>
                <div class="info-label">Mode</div>   <div class="info-value"><?= $isIntl ? '🌐 International (validation + visibility locked)' : '🏙️ Local' ?></div>
                <div class="info-label">Creator</div><div class="info-value"><?= htmlspecialchars($ch['created_by'] ?? ($ch['guest_id'] ? 'Guest' : '-'), ENT_QUOTES) ?></div>
            </div>
        </div>
    </div>

    <form method="POST" action="/admin/challenges/<?= urlencode($challengeId) ?>/edit" class="form-card">
        <?= csrf_input() ?>

        <div class="form-group">
            <label for="title">Title</label>
            <input type="text" id="title" name="title" maxlength="100" required
                   value="<?= htmlspecialchars($_POST['title'] ?? $ch['title'], ENT_QUOTES) ?>">
        </div>

        <div class="form-group">
            <label for="challenge_type">Type</label>
            <select id="challenge_type" name="challenge_type">
                <?php $curType = $_POST['challenge_type'] ?? $ch['challenge_type']; foreach ($TYPES as $tp): ?>
                    <option value="<?= $tp ?>"<?= $tp === $curType ? ' selected' : '' ?>><?= ucfirst($tp) ?></option>
                <?php endforeach; ?>
            </select>
        </div>

        <div class="form-group">
            <label for="validation_method">Validation method<?= $isIntl ? ' (locked to Photo proof on International)' : '' ?></label>
            <select id="validation_method" name="validation_method"<?= $isIntl ? ' disabled' : '' ?>>
                <?php $curVal = $isIntl ? 'photo_proof' : ($_POST['validation_method'] ?? $ch['validation_method'] ?? 'meet'); ?>
                <option value="meet"<?= $curVal === 'meet' ? ' selected' : '' ?>>Meet (in person)</option>
                <option value="photo_proof"<?= $curVal === 'photo_proof' ? ' selected' : '' ?>>Photo proof</option>
            </select>
        </div>

        <div class="form-group">
            <label for="return_clause">Return clause</label>
            <input type="text" id="return_clause" name="return_clause" maxlength="200"
                   value="<?= htmlspecialchars($_POST['return_clause'] ?? ($ch['return_clause'] ?? ''), ENT_QUOTES) ?>">
        </div>

        <?php if ($isIntl): ?>
        <div class="form-group">
            <label for="proof_requirements">Proof requirements (International)</label>
            <input type="text" id="proof_requirements" name="proof_requirements" maxlength="300"
                   value="<?= htmlspecialchars($_POST['proof_requirements'] ?? ($ch['proof_requirements'] ?? ''), ENT_QUOTES) ?>">
        </div>
        <?php endif; ?>

        <div class="form-group">
            <label for="visibility">Visibility<?= $isIntl ? ' (locked to Public on International)' : '' ?></label>
            <select id="visibility" name="visibility"<?= $isIntl ? ' disabled' : '' ?>>
                <?php $curViz = $isIntl ? 'public' : ($_POST['visibility'] ?? $ch['visibility'] ?? 'public'); foreach ($VISIBILITIES as $vz): ?>
                    <option value="<?= $vz ?>"<?= $vz === $curViz ? ' selected' : '' ?>><?= ucfirst($vz) ?></option>
                <?php endforeach; ?>
            </select>
        </div>

        <div class="form-group">
            <label for="status">Status</label>
            <select id="status" name="status">
                <?php $curSt = $_POST['status'] ?? $ch['status'] ?? 'open'; foreach ($STATUSES as $st): ?>
                    <option value="<?= $st ?>"<?= $st === $curSt ? ' selected' : '' ?>><?= ucfirst($st) ?></option>
                <?php endforeach; ?>
            </select>
        </div>

        <button type="submit" class="btn btn-primary">Save changes</button>
        <a href="<?= $backHref ?>" class="btn btn-secondary" style="margin-left:8px">Cancel</a>
    </form>
</div>
<?php
admin_foot();
