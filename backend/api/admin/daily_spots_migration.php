<?php

declare(strict_types=1);

// Places migration (V3-02 / V3-05): the dry-run report of PlacesMigration, and
// a button to apply it. Same as scripts/places_migrate.php. Idempotent.

admin_require_login();
require_once __DIR__ . '/daily_common.php';

$report = null;
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    csrf_verify();
    $report = PlacesMigration::run(Database::pdo(), true);
    DailyAdminService::audit('places.migrate', 'places', null, null, [
        'pins' => count($report['pins']['groups']), 'google' => count($report['google']['series']), 'errors' => $report['errors'],
    ]);
}
$report ??= PlacesMigration::run(Database::pdo(), false);
$pins   = $report['pins'];
$new    = count(array_filter($pins['groups'], static fn(array $g): bool => $g['action'] === 'new'));
$todo   = $pins['groups'] !== [] || ($report['google']['series'] !== [] && !$report['google']['deleted']);

admin_head('Places migration');
admin_nav('/admin/daily');
daily_styles();
?>
<div class="admin-main">
    <h1 class="page-title">🧳 Places migration</h1>
    <?php daily_subnav('/admin/daily/spots'); ?>
    <?= flash_html() ?>
    <?php foreach ($report['errors'] as $e): ?><div class="form-card" style="border-color:#f87171">⚠️ <?= dh($e) ?></div><?php endforeach; ?>
    <p class="daily-muted"><?= $report['apply'] ? 'Applied. Below: what was done.' : 'Dry run: nothing has been written yet.' ?></p>

    <h3 style="margin:12px 0 8px">1. V1 pins → spots</h3>
    <p class="daily-muted"><?= $pins['total'] ?> approved pinned proof(s) without a place: <?= $new ?> new spot(s), <?= count($pins['groups']) - $new ?> joining an existing one, <?= count($pins['skipped']) ?> skipped.</p>
    <div class="table-wrapper"><table>
        <tbody>
        <?php foreach ($pins['groups'] as $g): ?>
            <tr><td><?= $g['action'] === 'new' ? 'New' : 'Join' ?></td><td><?= $g['place_id'] ? '<a href="/admin/daily/spots/' . dh($g['place_id']) . '">' . dh($g['name']) . '</a>' : dh($g['name']) ?></td>
                <td class="daily-muted"><?= dh($g['city_id']) ?></td><td class="daily-muted"><?= daily_osm_link($g['lat'], $g['lng']) ?></td><td><?= (int) $g['proofs'] ?> proof(s)</td></tr>
        <?php endforeach; ?>
        <?php foreach ($pins['skipped'] as $s): ?>
            <tr><td>Skip</td><td class="daily-muted">proof <?= dh($s['id']) ?></td><td colspan="3" class="daily-muted"><?= dh($s['why']) ?></td></tr>
        <?php endforeach; ?>
        <?php if ($pins['groups'] === [] && $pins['skipped'] === []): ?><tr><td class="no-results">Nothing to convert.</td></tr><?php endif; ?>
        </tbody>
    </table></div>

    <h3 style="margin:16px 0 8px">2. Validated user challenges with a venue (<?= count($report['challenges']) ?>)</h3>
    <p class="daily-muted">No coordinates and no Daily proof: seed the ones worth it with <a href="/admin/daily/spots/new">＋ Seed a spot</a>.</p>
    <div class="table-wrapper"><table>
        <tbody>
        <?php foreach ($report['challenges'] as $c): ?>
            <tr><td><?= dh($c['title']) ?></td><td><?= dh($c['venue']) ?></td><td class="daily-muted"><?= dh($c['city_name'] ?? $c['city_id']) ?></td>
                <td class="daily-muted"><?= dh((string) $c['validated_on']) ?></td></tr>
        <?php endforeach; ?>
        <?php if ($report['challenges'] === []): ?><tr><td class="no-results">None.</td></tr><?php endif; ?>
        </tbody>
    </table></div>

    <h3 style="margin:16px 0 8px">3. Google-seeded venues to delete (<?= count($report['google']['series']) ?>, <?= (int) $report['google']['channels'] ?> event channel(s))</h3>
    <p class="daily-muted"><?= $report['google']['deleted'] ? 'Deleted.' : 'Deleted on apply, with their messages and participants. This cannot be undone; static venues stay.' ?></p>
    <div class="table-wrapper"><table>
        <tbody>
        <?php foreach ($report['google']['series'] as $v): ?>
            <tr><td><?= dh($v['title']) ?></td><td class="daily-muted"><?= dh($v['city_id']) ?></td><td class="daily-muted"><?= dh($v['id']) ?></td></tr>
        <?php endforeach; ?>
        <?php if ($report['google']['series'] === []): ?><tr><td class="no-results">None left.</td></tr><?php endif; ?>
        </tbody>
    </table></div>

    <?php if (!$report['apply'] && $todo): ?>
        <form method="POST" action="/admin/daily/spots/migration" style="margin-top:16px"
              onsubmit="return confirm('Apply the migration? The Google venues are deleted for good.')">
            <?= csrf_input() ?>
            <button class="btn btn-primary" type="submit">Apply the migration</button>
        </form>
    <?php endif; ?>
</div>
<?php admin_foot();
