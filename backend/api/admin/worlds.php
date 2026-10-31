<?php

declare(strict_types=1);

// "Different Worlds by Hilads" calendar: one topic per day, by month, plus the
// brief to prepare packages from and the import of prepared packages.

admin_require_login();
require_once __DIR__ . '/worlds_common.php';

$today = DailyClock::currentDate();
$month = (string) ($_GET['month'] ?? substr($today, 0, 7));
if (!preg_match('/^\d{4}-(0[1-9]|1[0-2])$/', $month)) {
    $month = substr($today, 0, 7);
}
$self = '/admin/worlds?month=' . $month;

if (($_GET['brief'] ?? '') === '1') {
    $days = max(1, min(60, (int) ($_GET['days'] ?? 14)));
    header('Content-Type: application/json; charset=utf-8');
    header('Content-Disposition: attachment; filename="worlds-brief-' . $today . '.json"');
    echo json_encode(DwStudio::brief($days), JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

$report = null;
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    csrf_verify();
    $action = (string) ($_POST['action'] ?? '');
    if ($action === 'create') {
        worlds_action(function () {
            $id = DwStudio::createTopic($_POST);
            admin_redirect('/admin/worlds/' . $id);
        }, '', $self);
    }
    if ($action === 'import') {
        $json = (string) ($_POST['json'] ?? '');
        $file = $_FILES['file'] ?? null;
        if ($file && ($file['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_OK && is_uploaded_file($file['tmp_name'])) {
            $json = (string) file_get_contents($file['tmp_name']);
        }
        $doc = json_decode($json, true);
        if (!is_array($doc)) {
            flash_set('error', 'That is not valid JSON.');
            admin_redirect($self);
        }
        set_time_limit(300);
        $report = DwStudio::import($doc);
    }
}

$topics = DwStudio::topicsInMonth($month);
$prev = (new DateTimeImmutable($month . '-01'))->modify('-1 month')->format('Y-m');
$next = (new DateTimeImmutable($month . '-01'))->modify('+1 month')->format('Y-m');

admin_head('Different Worlds');
admin_nav('/admin/worlds');
worlds_styles();
?>
<div class="admin-main">
    <h1 class="page-title">🌍 Different Worlds</h1>
    <?php worlds_subnav('/admin/worlds'); ?>
    <?= flash_html() ?>

    <?php if ($report !== null): ?>
        <div class="form-card" style="max-width:none;margin-bottom:18px">
            <h3 style="margin-bottom:8px">Import</h3>
            <?php foreach ($report as $r): ?>
                <p><strong><?= wh($r['date']) ?></strong>
                    <?= $r['ok'] ? '<span style="color:#4ade80">✓ version ' . (int) $r['version'] . ' saved, slides rendered</span>'
                                 : '<span style="color:#f87171">not imported</span>' ?>
                    <?php $t = DailyClock::isValidDate($r['date']) ? DwStudio::topicByDate($r['date']) : null; if ($t): ?>
                        · <a href="/admin/worlds/<?= $t['id'] ?>">open</a><?php endif; ?></p>
                <ul class="worlds-report">
                    <?php foreach ($r['errors'] as $e): ?><li style="color:#f87171"><?= wh($e) ?></li><?php endforeach; ?>
                    <?php foreach ($r['warnings'] as $w): ?><li style="color:#fbbf24"><?= wh($w) ?></li><?php endforeach; ?>
                </ul>
            <?php endforeach; ?>
        </div>
    <?php endif; ?>

    <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
        <a class="btn btn-secondary btn-sm" href="/admin/worlds?month=<?= $prev ?>">←</a>
        <h2 style="font-size:18px"><?= wh((new DateTimeImmutable($month . '-01'))->format('F Y')) ?></h2>
        <a class="btn btn-secondary btn-sm" href="/admin/worlds?month=<?= $next ?>">→</a>
        <a class="btn btn-secondary btn-sm" href="/admin/worlds">Today</a>
    </div>

    <div class="table-wrapper" style="margin-bottom:22px"><table>
        <thead><tr><th>Date</th><th>Topic</th><th>Type</th><th>Status</th><th>Versions</th></tr></thead>
        <tbody>
        <?php if ($topics === []): ?><tr><td colspan="5" class="worlds-muted">No topic this month.</td></tr><?php endif; ?>
        <?php foreach ($topics as $t): ?>
            <tr class="<?= $t['date'] === $today ? 'worlds-today' : '' ?>">
                <td style="white-space:nowrap"><?= wh((new DateTimeImmutable($t['date']))->format('D j M')) ?><?= $t['date'] === $today ? ' <span class="badge badge-live">today</span>' : '' ?></td>
                <td><a href="/admin/worlds/<?= $t['id'] ?>"><?= wh($t['title']) ?></a>
                    <?= $t['needs_date_check'] ? ' <span title="Check the date of this event">⚠️</span>' : '' ?></td>
                <td class="worlds-muted"><?= wh($t['type']) ?></td>
                <td><?= worlds_status_badge($t['status']) ?></td>
                <td class="worlds-muted"><?= (int) $t['versions'] ?: '-' ?></td>
            </tr>
        <?php endforeach; ?>
        </tbody>
    </table></div>

    <div class="worlds-grid">
        <div class="form-card">
            <h3 style="margin-bottom:8px">Prepare packages</h3>
            <p class="worlds-muted" style="margin-bottom:10px">The brief has the settings (prompts, style, phase, countries) and the next days' topics. Packages are prepared from it in Claude Code, then imported here: the slides are rendered on import.</p>
            <a class="btn btn-primary" href="/admin/worlds?brief=1&days=14">Download brief (14 days)</a>
        </div>

        <form method="POST" action="<?= wh($self) ?>" enctype="multipart/form-data" class="form-card">
            <?= csrf_input() ?>
            <input type="hidden" name="action" value="import">
            <h3 style="margin-bottom:8px">Import packages</h3>
            <div class="form-group"><label>JSON file</label><input type="file" name="file" accept="application/json,.json"></div>
            <div class="form-group"><label>…or paste JSON</label><textarea name="json" rows="4" style="font-family:monospace;width:100%"></textarea>
                <div class="hint">{"packages": [{"date", "content"}]}: each package becomes a new version of its day's topic.</div></div>
            <button class="btn btn-primary" type="submit">Import and render</button>
        </form>

        <form method="POST" action="<?= wh($self) ?>" class="form-card">
            <?= csrf_input() ?>
            <input type="hidden" name="action" value="create">
            <h3 style="margin-bottom:8px">Add a topic</h3>
            <div class="form-group"><label>Date</label><input type="date" name="date" required value="<?= wh($today) ?>"></div>
            <div class="form-group"><label>Title</label><input type="text" name="title" required maxlength="200"></div>
            <div class="form-group"><label>Notes (optional)</label><textarea name="notes" rows="2"></textarea></div>
            <div class="form-group"><label>Type</label>
                <select name="type"><option value="evergreen">evergreen</option><option value="dated">dated (holiday / event)</option></select></div>
            <div class="form-group"><label><input type="checkbox" name="needs_date_check" value="1"> The event date needs checking</label></div>
            <button class="btn btn-primary" type="submit">Add</button>
        </form>
    </div>
</div>
<?php admin_foot();
