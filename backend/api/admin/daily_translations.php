<?php

declare(strict_types=1);

// Daily Challenge translations as a file (docs/daily-challenge/TRANSLATION.md):
// download today's and the upcoming challenges, translate them with the
// guide, upload the file back. Translations only: the English, dates, themes
// and statuses never change, so today's and published days are fixed too.
// One language by hand: the challenge's own page (Translations block).

admin_require_login();
require_once __DIR__ . '/daily_common.php';

if (($_GET['download'] ?? '') === '1') {
    $days = max(0, min(60, (int) ($_GET['days'] ?? 21)));
    header('Content-Type: application/json; charset=utf-8');
    header('Content-Disposition: attachment; filename="daily-translations-' . DailyClock::currentDate() . '.json"');
    echo json_encode(DailyTranslations::export($days), JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

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
        $result = DailyTranslations::import($doc, !$apply);
        if ($apply && $result['ok']) {
            $n = count(array_filter($result['report'], static fn($l) => isset($l['locales'])));
            flash_set('success', "Translations saved: {$n} field(s).");
            admin_redirect('/admin/daily/translations');
        }
    }
}

admin_head('Daily translations');
admin_nav('/admin/daily');
daily_styles();
?>
<div class="admin-main">
    <h1 class="page-title">🌐 Translations</h1>
    <?php daily_subnav('/admin/daily/translations'); ?>
    <?= flash_html() ?>

    <div class="form-card">
        <h3 style="margin-bottom:8px">1. Download</h3>
        <p class="daily-muted">Today's challenge and the next days, every field with its 19 languages (text, context, headline, subtitle, share question, comparison question / unit / title, price label, Local Twists).</p>
        <a class="btn btn-primary" href="/admin/daily/translations?download=1&days=21">Download today + 21 days</a>
        <p class="hint" style="margin-top:10px">2. Translate it with the prompt in <code>docs/daily-challenge/TRANSLATION.md</code> (keep every <code>"en"</code> as it is). 3. Upload it below. To fix one language by hand, open the challenge (Calendar) and edit its Translations block.</p>
    </div>

    <?php if ($result !== null): ?>
        <div class="form-card">
            <?php if (!$result['ok']): ?>
                <h3 style="color:#f87171;margin-bottom:8px">Nothing can be imported</h3>
                <ul style="margin-left:18px"><?php foreach ($result['errors'] as $e): ?><li><?= dh($e) ?></li><?php endforeach; ?></ul>
            <?php else: ?>
                <h3 style="margin-bottom:8px">Dry run - nothing written yet</h3>
                <?php if ($result['report'] === []): ?><p class="daily-muted">No change: every translation in the file is already saved.</p><?php endif; ?>
                <div class="table-wrapper"><table>
                    <thead><tr><th>Date</th><th>Field</th><th>Result</th></tr></thead>
                    <tbody>
                    <?php foreach ($result['report'] as $line): ?>
                        <tr><td><?= dh($line['date']) ?></td><td><?= dh($line['field']) ?></td>
                            <td class="daily-muted"><?= isset($line['error'])
                                ? '<span style="color:#f87171">' . dh($line['error']) . '</span>'
                                : dh(count($line['locales']) . ' language(s): ' . implode(', ', $line['locales'])) ?></td></tr>
                    <?php endforeach; ?>
                    </tbody>
                </table></div>
                <form method="POST" action="/admin/daily/translations" style="margin-top:12px">
                    <?= csrf_input() ?>
                    <input type="hidden" name="step" value="apply">
                    <input type="hidden" name="json" value="<?= dh($json) ?>">
                    <button class="btn btn-primary" type="submit">Save these translations</button>
                </form>
            <?php endif; ?>
        </div>
    <?php endif; ?>

    <form method="POST" action="/admin/daily/translations" enctype="multipart/form-data" class="form-card">
        <?= csrf_input() ?>
        <input type="hidden" name="step" value="check">
        <h3 style="margin-bottom:8px">Upload translations</h3>
        <div class="form-group"><label>JSON file</label><input type="file" name="file" accept="application/json,.json"></div>
        <div class="form-group"><label>…or paste JSON</label><textarea name="json" rows="8" style="font-family:monospace"><?= dh($json) ?></textarea>
            <div class="hint">Only translations change. A field whose English changed since the download is skipped; languages missing from the file keep what is saved.</div></div>
        <div class="form-actions"><button class="btn btn-primary" type="submit">Check (dry run)</button></div>
    </form>
</div>
<?php admin_foot();
