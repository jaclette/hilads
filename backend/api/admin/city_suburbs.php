<?php

declare(strict_types=1);

admin_require_login();

/**
 * Suburbs (geo_city_overrides): force a GeoNames place onto its main city
 * (Amadora → Lisbon: its people play in Lisbon) or keep it its own city
 * (Hội An never absorbed). Read live by the placement rule, for GPS and picks
 * from then on; people already placed keep their city until they move. A
 * suburb that already has its Hilads city: merge it from its page.
 */

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    csrf_verify();
    try {
        $gid = (int) ($_POST['geoname_id'] ?? 0);
        if (($_POST['action'] ?? '') === 'delete') {
            CityAdmin::deleteOverride($gid);
            flash_set('success', "Removed the rule of {$gid}: the placement rule decides again.");
        } else {
            $target = trim((string) ($_POST['target_geoname_id'] ?? ''));
            $own    = CityAdmin::setOverride($gid, $target === '' ? null : (int) $target, (string) ($_POST['note'] ?? ''));
            $msg    = 'Saved. New placements follow it now.';
            if ($own !== null && $target !== '') {
                $main = CityRepository::findByGeonameId((int) $target);
                $msg .= " This place already has its city {$own}: merge it from its page"
                    . ($main ? " into city_{$main['id']}." : '.');
            }
            flash_set('success', $msg);
        }
    } catch (\Throwable $e) {
        flash_set('error', $e->getMessage());
    }
    header('Location: /admin/cities/suburbs');
    exit;
}

$q     = trim((string) ($_GET['q'] ?? ''));
$found = [];
$rows  = [];
$err   = null;
try {
    $rows  = CityAdmin::overrides();
    $found = $q !== '' ? WorldCities::search($q, 'en', 15) : [];
} catch (\Throwable $e) {
    $err = 'Load the GeoNames base and run php migrate.php first (' . $e->getMessage() . ').';
}
$h = fn($v) => htmlspecialchars((string) $v, ENT_QUOTES);

admin_head('Suburbs');
admin_nav('/admin/cities');
?>
<div class="admin-main">
    <p style="margin-bottom:8px"><a href="/admin/cities">← Cities</a></p>
    <h1 class="page-title">Suburbs</h1>
    <p style="color:#777;margin:-8px 0 16px;font-size:13px;max-width:720px">
        Where a place plays. By default a place within 30 km of a city 3× bigger (200,000+) in the same region plays in that city. Here: force a place onto its main city, or keep it its own city. Applies to GPS and picks from now on.
    </p>
    <?= flash_html() ?>
    <?php if ($err): ?><p class="badge badge-deleted" style="display:inline-block;margin-bottom:12px"><?= $h($err) ?></p><?php endif; ?>

    <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:16px">
        <form method="GET" action="/admin/cities/suburbs" class="form-card" style="flex:1;min-width:320px">
            <h3 style="margin-bottom:8px">Find a GeoNames id</h3>
            <div style="display:flex;gap:6px">
                <input type="text" name="q" value="<?= $h($q) ?>" placeholder="Makati, Brooklyn…">
                <button type="submit" class="btn btn-secondary">Search</button>
            </div>
            <?php foreach ($found as $f): ?>
                <p style="font-size:13px;margin:6px 0">
                    <span class="td-mono"><?= $f['geonameId'] ?></span> <?= $h($f['name']) ?> (<?= $h($f['country']) ?>, <?= number_format($f['population']) ?>)
                    <?= $f['playsIn'] ? '→ plays in ' . $h($f['playsIn']['name']) . ' <span class="td-mono">' . $f['playsIn']['geonameId'] . '</span>' : '' ?>
                    <?= $f['channelId'] ? '<a href="/admin/cities/city_' . (int) $f['channelId'] . '">city_' . (int) $f['channelId'] . '</a>' : '' ?>
                </p>
            <?php endforeach; ?>
        </form>

        <form method="POST" action="/admin/cities/suburbs" class="form-card" style="flex:1;min-width:320px">
            <?= csrf_input() ?>
            <h3 style="margin-bottom:8px">Add or change a rule</h3>
            <div class="form-group"><label>Place (GeoNames id)</label><input type="text" name="geoname_id" required pattern="\d+"></div>
            <div class="form-group">
                <label>Plays in (GeoNames id)</label><input type="text" name="target_geoname_id" pattern="\d*" placeholder="empty = its own city, never absorbed">
            </div>
            <div class="form-group"><label>Note</label><input type="text" name="note" placeholder="why"></div>
            <button type="submit" class="btn btn-primary">Save</button>
        </form>
    </div>

    <div class="table-wrapper">
        <table>
            <thead><tr><th>Place</th><th>Plays in</th><th>Note</th><th>Hilads city</th><th>Since</th><th></th></tr></thead>
            <tbody>
            <?php foreach ($rows as $r): ?>
                <tr>
                    <td><?= $h($r['name'] ?? '?') ?> <span class="td-mono"><?= $r['geoname_id'] ?> <?= $h($r['country']) ?></span></td>
                    <td><?= $r['target_geoname_id'] !== null
                        ? $h($r['target_name'] ?? '?') . ' <span class="td-mono">' . $r['target_geoname_id'] . '</span>'
                        : '<span class="badge badge-active">its own city</span>' ?></td>
                    <td style="color:#aaa"><?= $h($r['note']) ?></td>
                    <td>
                        <?php if ($r['channel_id']): ?>
                            <a href="/admin/cities/<?= $h($r['channel_id']) ?>"><?= $h($r['channel_id']) ?></a>
                            <?php if ($r['target_geoname_id'] !== null && $r['channel_status'] === 'active'): ?>
                                <span class="badge badge-deleted">still its own city: merge it</span>
                            <?php endif; ?>
                        <?php endif; ?>
                    </td>
                    <td class="td-mono"><?= $h(substr((string) $r['created_at'], 0, 10)) ?></td>
                    <td>
                        <form method="POST" action="/admin/cities/suburbs" onsubmit="return confirm('Remove this rule?')">
                            <?= csrf_input() ?>
                            <input type="hidden" name="action" value="delete"><input type="hidden" name="geoname_id" value="<?= $r['geoname_id'] ?>">
                            <button type="submit" class="btn btn-sm btn-danger">Remove</button>
                        </form>
                    </td>
                </tr>
            <?php endforeach; ?>
            </tbody>
        </table>
    </div>
</div>
<?php admin_foot(); ?>
