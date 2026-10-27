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
try {
    $rows = $view === 'auto' ? CityAdmin::autoCreated() : CityAdmin::search($q, $merged);
} catch (\Throwable $e) {
    $err = 'Run php migrate.php first (' . $e->getMessage() . ').';
}
$h = fn($v) => htmlspecialchars((string) $v, ENT_QUOTES);

admin_head('Cities');
admin_nav('/admin/cities');
?>
<div class="admin-main">
    <h1 class="page-title">Cities</h1>
    <p style="color:#777;margin:-8px 0 16px;font-size:13px;max-width:720px">
        Every city where people play. A city is created the first time someone plays there (GPS or a pick in the app's city search), on the GeoNames world base.
        <a href="/admin/cities/suburbs">Suburbs</a>: force a place onto its main city, or keep it its own city.
    </p>

    <?= flash_html() ?>
    <?php if ($err): ?><p class="badge badge-deleted" style="display:inline-block;margin-bottom:12px"><?= $h($err) ?></p><?php endif; ?>

    <div style="display:flex;gap:8px;align-items:center;margin-bottom:14px;flex-wrap:wrap">
        <a class="btn btn-sm <?= $view === 'search' ? 'btn-primary' : 'btn-secondary' ?>" href="/admin/cities">All cities</a>
        <a class="btn btn-sm <?= $view === 'auto' ? 'btn-primary' : 'btn-secondary' ?>" href="/admin/cities?view=auto">Created automatically</a>
        <?php if ($view === 'search'): ?>
            <form method="GET" action="/admin/cities" style="display:flex;gap:6px;align-items:center;margin-left:8px">
                <input type="text" name="q" value="<?= $h($q) ?>" placeholder="Name, alias, country (VN), city_20…" style="width:260px">
                <label style="color:#888;font-size:12px"><input type="checkbox" name="merged" value="1" <?= $merged ? 'checked' : '' ?>> merged too</label>
                <button type="submit" class="btn btn-sm btn-secondary">Search</button>
            </form>
        <?php endif; ?>
    </div>

    <div class="table-wrapper">
        <table>
            <thead><tr>
                <th>City</th><th>Short name · aliases</th><th>Country</th><th>Members</th><th>Photos</th><th>GeoNames</th><th>Created</th><th></th>
            </tr></thead>
            <tbody>
            <?php foreach ($rows as $c): ?>
                <tr>
                    <td>
                        <a href="/admin/cities/<?= $h($c['id']) ?>"><?= $h($c['name']) ?></a>
                        <span class="td-mono"><?= $h($c['id']) ?></span>
                        <?php if ($c['status'] !== 'active'): ?><span class="badge badge-expired">merged → <?= $h($c['merged_into']) ?></span><?php endif; ?>
                        <?php if ($c['force_live']): ?><span class="badge badge-live">live</span><?php endif; ?>
                    </td>
                    <td style="color:#aaa"><?= $h(implode(' · ', array_filter(array_merge([$c['short_name']], $c['aliases'])))) ?></td>
                    <td><?= $h($c['country']) ?></td>
                    <td><?= $c['members'] ?></td>
                    <td><?= $c['photos'] ?></td>
                    <td class="td-mono"><?= $c['geoname_id'] ?? '<span style="color:#f87171">unmapped</span>' ?></td>
                    <td class="td-mono"><?= $h(substr((string) $c['created_at'], 0, 16)) ?><?= $c['auto_created'] ? ' <span class="badge badge-recurring">auto</span>' : '' ?></td>
                    <td><a class="btn btn-sm btn-secondary" href="/admin/cities/<?= $h($c['id']) ?>">Edit</a></td>
                </tr>
            <?php endforeach; ?>
            <?php if (!$rows && !$err): ?><tr><td colspan="8" class="no-results">No city.</td></tr><?php endif; ?>
            </tbody>
        </table>
    </div>
</div>
<?php admin_foot(); ?>
