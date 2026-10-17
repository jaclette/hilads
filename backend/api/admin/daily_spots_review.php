<?php

declare(strict_types=1);

// New places in review (V3-05): places created from proofs ("New place" in the
// app, or a 1.7.1 pin). Approve (optionally renamed), merge into a spot close
// by, or reject. Approving a proof also approves its place.

admin_require_login();
require_once __DIR__ . '/daily_common.php';

$self = '/admin/daily/spots/review';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    csrf_verify();
    $p  = $_POST;
    $id = preg_match('/^[a-f0-9]{16}$/', (string) ($p['id'] ?? '')) ? (string) $p['id'] : '';
    match ((string) ($p['action'] ?? '')) {
        'approve' => daily_action(function () use ($id, $p) {
                $name = trim((string) ($p['name'] ?? ''));
                if ($name !== '' && $name !== (SpotsAdmin::find($id)['name'] ?? '')) {
                    SpotsAdmin::rename($id, $name);
                }
                SpotsAdmin::setStatus($id, 'approved');
            }, 'Approved.', $self),
        'merge'   => daily_action(fn() => SpotsAdmin::merge($id, (string) ($p['keep_id'] ?? '')), 'Merged.', $self),
        'reject'  => daily_action(fn() => SpotsAdmin::setStatus($id, 'rejected'), 'Rejected.', $self),
        default   => admin_redirect($self),
    };
}

$queue = SpotsAdmin::reviewQueue();

admin_head('New places');
admin_nav('/admin/daily');
daily_styles();
?>
<div class="admin-main">
    <h1 class="page-title">🆕 New places in review (<?= count($queue) ?>)</h1>
    <?php daily_subnav('/admin/daily/spots'); ?>
    <?= flash_html() ?>
    <p class="daily-muted">The name is typed by the user, the position is their phone's when posting. Check both, merge duplicates into the spot close by.</p>

    <?php foreach ($queue as $r): ?>
        <div class="form-card" style="display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap">
            <?php if ($r['photo_url']): ?>
                <a href="<?= dh($r['photo_url']) ?>" target="_blank"><img class="daily-thumb" src="<?= dh(R2Uploader::thumbProxy($r['photo_url'])) ?>" alt=""></a>
            <?php endif; ?>
            <div style="flex:1;min-width:240px">
                <p><a href="/admin/daily/spots/<?= dh($r['id']) ?>"><strong><?= dh($r['name']) ?></strong></a>
                    · <?= dh($r['city_name'] ?? 'no city') ?> · by @<?= dh($r['creator'] ?? '?') ?></p>
                <p class="daily-muted"><?= daily_osm_link((float) $r['lat'], (float) $r['lng']) ?>
                    · <?= (int) $r['proof_count'] ?> proof(s)<?= $r['proof_status'] ? ' · latest ' . dh($r['proof_status']) : '' ?>
                    <?= $r['caption'] ? '<br>“' . dh($r['caption']) . '”' : '' ?></p>

                <form method="POST" action="<?= $self ?>" class="daily-inline" style="margin-top:6px">
                    <?= csrf_input() ?><input type="hidden" name="action" value="approve"><input type="hidden" name="id" value="<?= dh($r['id']) ?>">
                    <input type="text" name="name" value="<?= dh($r['name']) ?>" maxlength="<?= Places::NAME_MAX ?>">
                    <button class="btn btn-primary btn-sm" type="submit">Approve</button>
                </form>
                <?php foreach ($r['nearby'] as $n): ?>
                    <form method="POST" action="<?= $self ?>" style="margin-top:6px">
                        <?= csrf_input() ?><input type="hidden" name="action" value="merge"><input type="hidden" name="id" value="<?= dh($r['id']) ?>">
                        <input type="hidden" name="keep_id" value="<?= dh($n['id']) ?>">
                        <button class="btn btn-secondary btn-sm" type="submit">Merge into <?= dh($n['name']) ?></button>
                        <span class="daily-muted"><?= (int) $n['distanceM'] ?> m · <?= (int) $n['approved'] ?> proof(s)</span>
                    </form>
                <?php endforeach; ?>
                <form method="POST" action="<?= $self ?>" style="margin-top:6px">
                    <?= csrf_input() ?><input type="hidden" name="action" value="reject"><input type="hidden" name="id" value="<?= dh($r['id']) ?>">
                    <button class="btn btn-danger btn-sm" type="submit">Reject</button>
                </form>
            </div>
        </div>
    <?php endforeach; ?>
    <?php if ($queue === []): ?><p class="daily-muted">Nothing waiting.</p><?php endif; ?>
</div>
<?php admin_foot();
