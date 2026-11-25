<?php

declare(strict_types=1);

admin_require_login();

/**
 * Cities (V5-01): search by name, short name, alias, country (2 letters) or id
 * (city_N, N, a GeoNames id), and the cities created at a first visit (GPS or
 * a pick in the app's search), newest first. A city opens its edit page
 * (names, aliases, live switch, merge).
 */

$q      = trim((string) ($_GET['q'] ?? ''));
$view   = ($_GET['view'] ?? '') === 'auto' ? 'auto' : 'search';
$merged = !empty($_GET['merged']);
$err    = null;
$rows   = [];
$seenAt = '';
try {
    $rows = $view === 'auto' ? CityAdmin::autoCreated() : CityAdmin::search($q, $merged);
    if ($view === 'auto') {
        // Opening the list clears the count on the nav; the rows created since the last visit say "new".
        $seenAt = CityAdmin::autoSeenAt();
        CityAdmin::markAutoSeen(admin_actor());
    }
} catch (\Throwable $e) {
    $err = 'Run php migrate.php first (' . $e->getMessage() . ').';
}
$h = fn($v) => htmlspecialchars((string) $v, ENT_QUOTES);

admin_head('Cities');
admin_nav('/admin/cities');
?>
<div class="admin-main">
    <?= ui_page_head('Community', 'Cities', 'Every city where people play. A city is created the first time someone plays there (GPS or the app\'s city search). Check the new ones, merge duplicates.',
        '<a class="btn" href="/admin/cities/suburbs">Suburbs</a>') ?>
    <?= flash_html() ?>
    <?php if ($err): ?><div class="flash flash-error"><?= $h($err) ?></div><?php endif; ?>

    <div class="card">
    <div class="toolbar">
        <?= ui_tabs([['All cities', '/admin/cities', null, $view === 'search'], ['New, created automatically', '/admin/cities?view=auto', null, $view === 'auto']], 'Cities') ?>
        <?php if ($view === 'search'): ?>
            <form method="GET" action="/admin/cities" style="display:flex;gap:8px;align-items:center;margin:0">
                <input type="search" name="q" value="<?= $h($q) ?>" placeholder="Name, alias, country code (VN) or id" style="width:280px">
                <label class="check"><input type="checkbox" name="merged" value="1" <?= $merged ? 'checked' : '' ?>> include merged</label>
                <button type="submit" class="btn btn-sm">Search</button>
            </form>
        <?php endif; ?>
    </div>
    <div class="table-wrapper">
        <table class="data" data-sortable>
            <thead><tr>
                <th data-sort>City</th><th>Short name, other names</th><th data-sort>Country</th><th data-sort="num">Members</th><th data-sort="num">Photos</th><th>World city base</th><th data-sort>Created</th><th></th>
            </tr></thead>
            <tbody>
            <?php foreach ($rows as $c): ?>
                <tr>
                    <td>
                        <a href="/admin/cities/<?= $h($c['id']) ?>" style="font-weight:700;color:var(--text)"><?= $h($c['name']) ?></a>
                        <div class="td-mono"><?= $h($c['id']) ?></div>
                        <?php if ($c['status'] !== 'active'): ?><span class="badge b-mute">merged into <?= $h($c['merged_into']) ?></span><?php endif; ?>
                        <?php if ($c['force_live']): ?><span class="badge b-brand" title="Shown as live even with few players">forced live</span><?php endif; ?>
                    </td>
                    <td style="color:var(--muted)"><?= $h(implode(' · ', array_filter(array_merge([$c['short_name']], $c['aliases'])))) ?></td>
                    <td><?= $h($c['country']) ?></td>
                    <td><?= $c['members'] ?></td>
                    <td><?= $c['photos'] ?></td>
                    <td class="td-mono"><?= $c['geoname_id'] ?? '<span class="badge b-warn">not matched</span>' ?></td>
                    <td class="td-mono"><?= $h(substr((string) $c['created_at'], 0, 16)) ?><?= $c['auto_created'] ? ' <span class="badge b-violet">automatic</span>' : '' ?>
                        <?php if ($view === 'auto' && ($seenAt === '' || strtotime((string) $c['created_at']) > strtotime($seenAt))): ?><span class="badge b-brand">new</span><?php endif; ?></td>
                    <td><a class="btn btn-sm" href="/admin/cities/<?= $h($c['id']) ?>">Open</a></td>
                </tr>
            <?php endforeach; ?>
            <?php if (!$rows && !$err): ?><tr><td colspan="8"><?= ui_empty('No city here', $view === 'auto' ? 'No city was created automatically recently.' : 'Nothing matches this search.') ?></td></tr><?php endif; ?>
            </tbody>
        </table>
    </div>
    </div>
</div>
<?php admin_foot(); ?>
