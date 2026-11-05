<?php

declare(strict_types=1);

// Daily Challenge covers in bulk: each file named after its day (2026-11-16.jpg,
// 2026-11-16-chilies.webp…) becomes that day's own cover, as the Upload cover
// button on the day's page does. Days without a challenge are skipped.

admin_require_login();
require_once __DIR__ . '/daily_common.php';

$report = null;

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    // Over post_max_size PHP drops the whole body (no CSRF token, no files): say why.
    if ($_POST === [] && (int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > 0) {
        flash_set('error', 'Too much at once (the limit is ' . ini_get('post_max_size') . ' per upload): send the files in smaller batches.');
        admin_redirect('/admin/daily/covers');
    }
    csrf_verify();
    $files = $_FILES['covers'] ?? null;
    $report = [];
    $count = is_array($files['name'] ?? null) ? count($files['name']) : 0;
    for ($i = 0; $i < $count; $i++) {
        $name = (string) $files['name'][$i];
        if (($files['error'][$i] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE) {
            continue;
        }
        $line = ['file' => $name, 'date' => null, 'ok' => false, 'detail' => '', 'url' => null, 'id' => null];
        if (!preg_match('/^(\d{4}-\d{2}-\d{2})/', $name, $m)) {
            $line['detail'] = 'The file name must start with the day, e.g. 2026-11-16.jpg.';
            $report[] = $line;
            continue;
        }
        $line['date'] = $m[1];
        $stmt = Database::pdo()->prepare("SELECT id, cover_url FROM daily_challenges WHERE challenge_date = ?");
        $stmt->execute([$m[1]]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$row) {
            $line['detail'] = 'No challenge on that day: import it first.';
            $report[] = $line;
            continue;
        }
        $line['id'] = $row['id'];
        try {
            $url = daily_cover_upload([
                'name' => $name, 'tmp_name' => $files['tmp_name'][$i], 'error' => $files['error'][$i], 'size' => $files['size'][$i],
            ]);
            DailyAdminService::setCover((string) $row['id'], $url);
            $line['ok'] = true;
            $line['url'] = $url;
            $line['detail'] = $row['cover_url'] ? 'Saved, replaces its previous cover.' : 'Saved.';
        } catch (InvalidArgumentException $e) {
            $line['detail'] = $e->getMessage();
        }
        $report[] = $line;
    }
    usort($report, fn($a, $b) => strcmp((string) $a['date'] . $a['file'], (string) $b['date'] . $b['file']));
    if ($report === []) {
        flash_set('error', 'Choose the cover images to upload.');
    }
}

admin_head('Daily covers');
admin_nav('/admin/daily');
daily_styles();
?>
<div class="admin-main">
    <h1 class="page-title">🖼️ Covers</h1>
    <?php daily_subnav('/admin/daily/covers'); ?>
    <?= flash_html() ?>

    <?php if ($report): ?>
        <?php $saved = count(array_filter($report, fn($l) => $l['ok'])); ?>
        <div class="form-card">
            <h3 style="margin-bottom:8px"><?= $saved ?> of <?= count($report) ?> cover(s) saved</h3>
            <div class="table-wrapper"><table class="daily-stack">
                <thead><tr><th>Day</th><th>File</th><th>Cover</th><th>Result</th></tr></thead>
                <tbody>
                <?php foreach ($report as $l): ?>
                    <tr><td><?= $l['id'] ? '<a href="/admin/daily/' . dh($l['id']) . '#cover">' . dh($l['date']) . '</a>' : dh($l['date'] ?? '') ?></td>
                        <td class="daily-muted"><?= dh($l['file']) ?></td>
                        <td><?php if ($l['url']): ?><img src="<?= dh($l['url']) ?>" alt="" style="width:200px;aspect-ratio:5/2;object-fit:cover;border-radius:6px;display:block"><?php endif; ?></td>
                        <td style="color:<?= $l['ok'] ? '#4ade80' : '#f87171' ?>"><?= dh($l['detail']) ?></td></tr>
                <?php endforeach; ?>
                </tbody>
            </table></div>
        </div>
    <?php endif; ?>

    <form method="POST" action="/admin/daily/covers" enctype="multipart/form-data" class="form-card">
        <?= csrf_input() ?>
        <div class="form-group"><label>Cover images</label>
            <input type="file" name="covers[]" accept="image/jpeg,image/png,image/webp" multiple required>
            <div class="hint">Each file is named after its day (<code>2026-11-16.jpg</code>, or <code>2026-11-16-anything.jpg</code>) and becomes that day's own cover, replacing the one it had. JPEG, PNG or WebP under 10 MB; best at 1200×480 (the card's 5:2 band). Up to <?= (int) ini_get('max_file_uploads') ?> files and <?= dh(ini_get('post_max_size')) ?> per upload. Import the days first: an import that changes a day's text clears its cover.</div></div>
        <div class="form-actions"><button class="btn btn-primary" type="submit">Upload covers</button></div>
    </form>
</div>
<?php admin_foot();
