<?php

declare(strict_types=1);

// Spots (V3-05): every Hilads place with its stats, filters and search. A spot
// is an approved, visible place with an approved proof; places in review wait
// in /admin/daily/spots/review.

admin_require_login();
require_once __DIR__ . '/daily_common.php';

$f = [
    'city'   => preg_match('/^city_\d+$/', (string) ($_GET['city'] ?? '')) ? $_GET['city'] : '',
    'theme'  => DailyThemes::normalize($_GET['theme'] ?? null) ?? '',
    'status' => (string) ($_GET['status'] ?? ''),
    'hidden' => (string) ($_GET['hidden'] ?? ''),
    'q'      => trim((string) ($_GET['q'] ?? '')),
];
$rows    = SpotsAdmin::list($f);
$cities  = Database::pdo()->query("
    SELECT DISTINCT pl.city_id, ch.name FROM places pl JOIN channels ch ON ch.id = pl.city_id ORDER BY ch.name
")->fetchAll(PDO::FETCH_KEY_PAIR);
$inReview = (int) Database::pdo()->query("SELECT count(*) FROM places WHERE status = 'pending' AND merged_into IS NULL")->fetchColumn();

/** <option>s with one selected. */
$options = static function (array $values, string $current): string {
    $html = '';
    foreach ($values as $v => $label) {
        $html .= '<option value="' . dh((string) $v) . '"' . ((string) $v === $current ? ' selected' : '') . '>' . dh($label) . '</option>';
    }
    return $html;
};
$themes = ['' => 'Any theme'];
foreach (DailyThemes::all() as $t) {
    $themes[$t['key']] = $t['name'];
}

admin_head('Spots');
admin_nav('/admin/daily');
daily_styles();
?>
<div class="admin-main">
    <h1 class="page-title">📍 Spots</h1>
    <?php daily_subnav('/admin/daily/spots'); ?>
    <?= flash_html() ?>

    <div class="daily-inline" style="margin-bottom:12px">
        <a class="btn btn-primary btn-sm" href="/admin/daily/spots/new">＋ Seed a spot</a>
        <a class="btn btn-secondary btn-sm" href="/admin/daily/spots/review">🆕 New places in review (<?= $inReview ?>)</a>
        <a class="btn btn-secondary btn-sm" href="/admin/daily/spots/migration">🧳 Migration</a>
    </div>

    <form method="GET" action="/admin/daily/spots" class="daily-inline" style="margin-bottom:12px">
        <input type="text" name="q" value="<?= dh($f['q']) ?>" placeholder="Name or tag">
        <select name="city"><?= $options(['' => 'Every city'] + $cities, $f['city']) ?></select>
        <select name="theme"><?= $options($themes, $f['theme']) ?></select>
        <select name="status"><?= $options(['' => 'Any status', 'approved' => 'Approved', 'pending' => 'In review', 'rejected' => 'Rejected'], $f['status']) ?></select>
        <select name="hidden"><?= $options(['' => 'Hidden or not', '0' => 'Visible', '1' => 'Hidden'], $f['hidden']) ?></select>
        <button class="btn btn-secondary btn-sm" type="submit">Filter</button>
    </form>

    <div class="table-wrapper"><table class="daily-stack">
        <thead><tr><th>Spot</th><th>City</th><th>Status</th><th>Proofs</th><th>Votes (week / all)</th><th>Themes</th><th>Tags</th><th>Created</th></tr></thead>
        <tbody>
        <?php foreach ($rows as $r): ?>
            <tr>
                <td><a href="/admin/daily/spots/<?= dh($r['id']) ?>"><strong><?= dh($r['name']) ?></strong></a>
                    <div class="daily-muted">by @<?= dh($r['creator'] ?? '?') ?></div></td>
                <td><?= dh($r['city_name'] ?? '') ?></td>
                <td><?= daily_place_badges($r) ?></td>
                <td><?= (int) $r['approved'] ?><?= (int) $r['pending'] ? ' <span class="daily-muted">+' . (int) $r['pending'] . ' pending</span>' : '' ?>
                    <?= (int) $r['seeds'] ? '<div class="daily-muted">' . (int) $r['seeds'] . ' seed(s)</div>' : '' ?></td>
                <td><?= (int) $r['votes_week'] ?> / <?= (int) $r['votes'] ?></td>
                <td class="daily-muted"><?= dh(implode(', ', array_map([DailyThemes::class, 'name'], array_filter(explode(',', (string) $r['themes']))))) ?></td>
                <td class="daily-muted"><?= dh((string) $r['tags']) ?></td>
                <td class="daily-muted"><?= dh(date('j M Y', strtotime($r['created_at']))) ?></td>
            </tr>
        <?php endforeach; ?>
        <?php if ($rows === []): ?><tr><td colspan="8" class="no-results">No spot matches.</td></tr><?php endif; ?>
        </tbody>
    </table></div>
    <?php if (count($rows) >= SpotsAdmin::LIST_LIMIT): ?><p class="daily-muted">First <?= SpotsAdmin::LIST_LIMIT ?> shown - narrow the filters.</p><?php endif; ?>
</div>
<?php admin_foot();
