<?php

declare(strict_types=1);

// Daily Challenge bulk import (format: docs/daily-challenge/daily-challenges.example.json).
// Step 1 checks the file as a dry run and shows the per-entry report; step 2
// applies the same JSON (kept in a hidden field). Same code as the CLI.

admin_require_login();
require_once __DIR__ . '/daily_common.php';

$json   = '';
$result = null;

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    csrf_verify();
    $json = (string) ($_POST['json'] ?? '');
    $file = $_FILES['file'] ?? null;
    if ($file && ($file['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_OK && is_uploaded_file($file['tmp_name'])) {
        $json = (string) file_get_contents($file['tmp_name']);
    }
    $doc = json_decode($json, true);
    if (!is_array($doc)) {
        flash_set('error', 'That is not valid JSON.');
    } else {
        $apply  = ($_POST['step'] ?? '') === 'apply';
        $result = DailyAdminService::import($doc, !$apply);
        if ($apply && $result['ok']) {
            $counts = array_count_values(array_column($result['report'], 'action'));
            flash_set('success', 'Imported: ' . implode(', ', array_map(fn($a, $n) => "{$n} {$a}", array_keys($counts), $counts)) . '.');
            admin_redirect('/admin/daily');
        }
    }
}

admin_head('Daily import');
admin_nav('/admin/daily');
daily_styles();
?>
<div class="admin-main">
    <h1 class="page-title">⬆️ Import challenges</h1>
    <?php daily_subnav('/admin/daily/import'); ?>
    <?= flash_html() ?>

    <?php if ($result !== null): ?>
        <div class="form-card">
            <?php if (!$result['ok']): ?>
                <h3 style="color:#f87171;margin-bottom:8px">Nothing can be imported - fix these first</h3>
                <ul style="margin-left:18px"><?php foreach ($result['errors'] as $e): ?><li><?= dh($e) ?></li><?php endforeach; ?></ul>
            <?php else: ?>
                <h3 style="margin-bottom:8px">Dry run - nothing written yet</h3>
                <div class="table-wrapper"><table>
                    <thead><tr><th>Entry</th><th>Action</th><th>Detail</th><th>Translations</th></tr></thead>
                    <tbody>
                    <?php foreach ($result['report'] as $line): ?>
                        <tr><td><?= dh($line['entry']) ?></td><td><?= dh($line['action']) ?></td>
                            <td class="daily-muted"><?= dh($line['reason'] ?? ($line['date'] ?? '')) ?></td>
                            <td class="daily-muted"><?php $miss = $line['missingLocales'] ?? null; ?>
                                <?= $miss === null ? '' : ($miss === [] ? '18/18' : dh((18 - count($miss)) . '/18 · missing ' . implode(', ', $miss))) ?></td></tr>
                    <?php endforeach; ?>
                    </tbody>
                </table></div>
                <form method="POST" action="/admin/daily/import" style="margin-top:12px">
                    <?= csrf_input() ?>
                    <input type="hidden" name="step" value="apply">
                    <input type="hidden" name="json" value="<?= dh($json) ?>">
                    <button class="btn btn-primary" type="submit">Apply this import</button>
                </form>
            <?php endif; ?>
        </div>
    <?php endif; ?>

    <form method="POST" action="/admin/daily/import" enctype="multipart/form-data" class="form-card">
        <?= csrf_input() ?>
        <input type="hidden" name="step" value="check">
        <div class="form-group"><label>JSON file</label><input type="file" name="file" accept="application/json,.json"></div>
        <div class="form-group"><label>…or paste JSON</label><textarea name="json" rows="10" style="font-family:monospace"><?= dh($json) ?></textarea>
            <div class="hint">Dated entries create or update that day (published days and past dates are skipped); reserve entries skip texts already in the reserve; twist cities are city slugs such as ho-chi-minh-city. Nothing is written if any entry is invalid.</div></div>
        <div class="form-actions"><button class="btn btn-primary" type="submit">Check (dry run)</button></div>
    </form>
</div>
<?php admin_foot();
