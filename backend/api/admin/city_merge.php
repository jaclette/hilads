<?php

declare(strict_types=1);

admin_require_login();

/**
 * Merge $cityId into ?into= : GET shows what moves (dry run), POST does it
 * (CityAdmin::merge, one transaction, then results and ranks recomputed).
 */

$into = trim((string) ($_POST['into'] ?? $_GET['into'] ?? ''));
$h    = fn($v) => htmlspecialchars((string) $v, ENT_QUOTES);

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    csrf_verify();
    try {
        $moved = CityAdmin::merge($cityId, $into);
        flash_set('success', "Merged {$cityId} into {$into}: " . array_sum($moved) . ' rows moved. Apps see it within the hour (city list cache).');
        header('Location: /admin/cities/' . $into);
    } catch (\Throwable $e) {
        flash_set('error', 'Merge failed, nothing changed: ' . $e->getMessage());
        header('Location: /admin/cities/' . $cityId);
    }
    exit;
}

$err  = null;
$plan = [];
try {
    $plan = CityAdmin::mergePlan($cityId, $into);
    $from = CityAdmin::get($cityId);
    $to   = CityAdmin::get($into);
} catch (\Throwable $e) {
    $err = $e->getMessage();
}

admin_head('Merge');
admin_nav('/admin/cities');
?>
<div class="admin-main">
    <p style="margin-bottom:8px"><a href="/admin/cities/<?= $h($cityId) ?>">← <?= $h($cityId) ?></a></p>
    <?php if ($err): ?>
        <p class="badge badge-deleted" style="display:inline-block"><?= $h($err) ?></p>
    <?php else: ?>
    <h1 class="page-title">Merge <?= $h($from['name']) ?> into <?= $h($to['name']) ?></h1>
    <p style="color:#aaa;margin:-8px 0 16px;font-size:13px;max-width:720px">
        <strong><?= $h($from['name']) ?></strong> <span class="td-mono"><?= $h($cityId) ?></span> (<?= $h($from['country']) ?>, <?= $from['members'] ?> members, <?= $from['photos'] ?> photos)
        → <strong><?= $h($to['name']) ?></strong> <span class="td-mono"><?= $h($into) ?></span> (<?= $h($to['country']) ?>, <?= $to['members'] ?> members, <?= $to['photos'] ?> photos).
        Rows that would exist twice keep <?= $h($to['name']) ?>'s (a pioneer or Local pass keeps the earliest). <?= $h($from['name']) ?> becomes an alias, its page and saved links go to <?= $h($to['name']) ?>. This cannot be undone.
    </p>
    <?php if ($from['country'] !== $to['country']): ?>
        <p class="badge badge-deleted" style="display:inline-block;margin-bottom:12px">Not the same country (<?= $h($from['country']) ?> → <?= $h($to['country']) ?>).</p>
    <?php endif; ?>

    <div class="table-wrapper" style="max-width:520px;margin-bottom:16px">
        <table>
            <thead><tr><th>What moves</th><th>Rows</th></tr></thead>
            <tbody>
            <?php foreach ($plan as $label => $n): ?>
                <tr><td class="td-mono"><?= $h($label) ?></td><td><?= $n ?></td></tr>
            <?php endforeach; ?>
            <?php if (!$plan): ?><tr><td colspan="2" class="no-results">Nothing to move: only the city itself.</td></tr><?php endif; ?>
            </tbody>
        </table>
    </div>

    <form method="POST" action="/admin/cities/<?= $h($cityId) ?>/merge" onsubmit="return confirm(<?= $h(json_encode("Merge {$from['name']} into {$to['name']}? This cannot be undone.", JSON_UNESCAPED_UNICODE)) ?>)">
        <?= csrf_input() ?>
        <input type="hidden" name="into" value="<?= $h($into) ?>">
        <button type="submit" class="btn btn-danger">Merge into <?= $h($to['name']) ?></button>
        <a class="btn btn-secondary" href="/admin/cities/<?= $h($cityId) ?>">Cancel</a>
    </form>
    <?php endif; ?>
</div>
<?php admin_foot(); ?>
