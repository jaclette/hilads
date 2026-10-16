<?php

declare(strict_types=1);

// Daily Challenge reserve: evergreen challenges the drop publishes (oldest
// unused first) on a day with nothing scheduled.

admin_require_login();
require_once __DIR__ . '/daily_common.php';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    csrf_verify();
    daily_action(
        fn() => DailyAdminService::createReserve((string) ($_POST['text'] ?? ''), (string) ($_POST['context'] ?? ''), (string) ($_POST['theme'] ?? '')),
        'Reserve challenge added.',
        '/admin/daily/reserve'
    );
}

$rows   = DailyAdminService::listReserve();
$unused = array_values(array_filter($rows, fn($r) => !DailyProofRepository::bool($r['used'])));
$used   = array_values(array_filter($rows, fn($r) => DailyProofRepository::bool($r['used'])));

admin_head('Daily reserve');
admin_nav('/admin/daily');
daily_styles();
?>
<div class="admin-main">
    <h1 class="page-title">🧺 Reserve</h1>
    <?php daily_subnav('/admin/daily/reserve'); ?>
    <?= flash_html() ?>

    <form method="POST" action="/admin/daily/reserve" class="form-card">
        <?= csrf_input() ?>
        <div class="form-group"><label>New reserve challenge (English)</label><textarea name="text" rows="2" required></textarea></div>
        <div class="form-group"><label>Context (optional)</label><textarea name="context" rows="2"></textarea></div>
        <div class="form-group"><label>Theme</label><?= daily_theme_select(null, null) ?>
            <div class="hint">Weekday default: the theme of the day it is used.</div></div>
        <div class="form-actions"><button class="btn btn-primary" type="submit">Add to reserve</button></div>
    </form>

    <h3 style="margin:18px 0 8px">Unused (<?= count($unused) ?>) - next to be used first</h3>
    <div class="table-wrapper"><table>
        <thead><tr><th>#</th><th>Theme</th><th>Challenge</th><th>Added</th><th></th></tr></thead>
        <tbody>
        <?php foreach ($unused as $i => $r): ?>
            <tr>
                <td><?= $i + 1 ?></td>
                <td class="daily-muted"><?= $r['theme'] ? dh(DailyThemes::name($r['theme'])) : 'weekday default' ?></td>
                <td><?= dh(daily_text($r['text_i18n'])) ?></td>
                <td class="daily-muted"><?= dh(date('j M Y', strtotime($r['created_at']))) ?></td>
                <td class="td-actions"><a class="btn btn-secondary btn-sm" href="/admin/daily/<?= dh($r['id']) ?>">Edit</a></td>
            </tr>
        <?php endforeach; ?>
        <?php if ($unused === []): ?><tr><td colspan="5" class="no-results">The reserve is empty.</td></tr><?php endif; ?>
        </tbody>
    </table></div>

    <h3 style="margin:18px 0 8px">Used (<?= count($used) ?>)</h3>
    <div class="table-wrapper"><table>
        <thead><tr><th>Went live</th><th>Theme</th><th>Challenge</th><th></th></tr></thead>
        <tbody>
        <?php foreach ($used as $r): ?>
            <tr>
                <td class="td-mono"><?= dh($r['challenge_date']) ?></td>
                <td class="daily-muted"><?= dh(daily_theme_label($r['theme'], $r['challenge_date'])) ?></td>
                <td><?= dh(daily_text($r['text_i18n'])) ?></td>
                <td class="td-actions"><a class="btn btn-secondary btn-sm" href="/admin/daily/<?= dh($r['id']) ?>">Open</a></td>
            </tr>
        <?php endforeach; ?>
        <?php if ($used === []): ?><tr><td colspan="4" class="no-results">No reserve challenge used yet.</td></tr><?php endif; ?>
        </tbody>
    </table></div>
</div>
<?php admin_foot();
