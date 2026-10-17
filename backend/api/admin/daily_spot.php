<?php

declare(strict_types=1);

// One spot (V3-05): its proofs, rename, dish tags, hide / show, approve /
// reject, merge into another spot, seed a photo. $spotId comes from boot.php.

admin_require_login();
require_once __DIR__ . '/daily_common.php';

$self = '/admin/daily/spots/' . $spotId;

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    csrf_verify();
    $p = $_POST;
    match ((string) ($p['action'] ?? '')) {
        'rename'  => daily_action(fn() => SpotsAdmin::rename($spotId, (string) ($p['name'] ?? '')), 'Renamed.', $self),
        'tags'    => daily_action(fn() => SpotsAdmin::setTags($spotId, (string) ($p['tags'] ?? '')), 'Tags saved.', $self),
        'hide'    => daily_action(fn() => SpotsAdmin::setHidden($spotId, true), 'Hidden from the map.', $self),
        'show'    => daily_action(fn() => SpotsAdmin::setHidden($spotId, false), 'Back on the map.', $self),
        'approve' => daily_action(fn() => SpotsAdmin::setStatus($spotId, 'approved'), 'Approved.', $self),
        'reject'  => daily_action(fn() => SpotsAdmin::setStatus($spotId, 'rejected'), 'Rejected.', $self),
        'merge'   => daily_action(function () use ($spotId, $p) {
                $keep = trim((string) ($p['keep_id'] ?? ''));
                if (preg_match('#([a-f0-9]{16})/?$#', $keep, $m)) {
                    $keep = $m[1];   // a pasted spot URL works too
                }
                SpotsAdmin::merge($spotId, $keep);
            }, 'Merged.', $self),
        default => admin_redirect($self),
    };
}

$spot = SpotsAdmin::find($spotId);
if ($spot === null) {
    flash_set('error', 'Spot not found.');
    admin_redirect('/admin/daily/spots');
}
$proofs = SpotsAdmin::proofs($spotId);
$tags   = SpotsAdmin::tags($spotId);
$nearby = SpotsAdmin::nearby($spot);
$merged = $spot['merged_into'] !== null ? SpotsAdmin::find((string) $spot['merged_into']) : null;

admin_head('Spot: ' . $spot['name']);
admin_nav('/admin/daily');
daily_styles();
?>
<div class="admin-main">
    <h1 class="page-title">📍 <?= dh($spot['name']) ?></h1>
    <?php daily_subnav('/admin/daily/spots'); ?>
    <?= flash_html() ?>

    <?php if ($merged): ?>
        <div class="form-card"><strong>Merged</strong> into <a href="/admin/daily/spots/<?= dh($merged['id']) ?>"><?= dh($merged['name']) ?></a>. Links to this spot open that one.</div>
    <?php endif; ?>

    <div class="daily-cols">
        <div>
            <div class="form-card">
                <p><?= daily_place_badges($spot) ?> · <?= dh($spot['city_name'] ?? 'no city') ?> · <?= daily_osm_link((float) $spot['lat'], (float) $spot['lng']) ?></p>
                <p class="daily-muted">Created by @<?= dh($spot['creator'] ?? '?') ?> on <?= dh(date('j M Y', strtotime($spot['created_at']))) ?> · id <?= dh($spot['id']) ?></p>
                <?php if (!$merged): ?>
                <div class="daily-inline" style="margin-top:8px">
                    <?php foreach ($spot['status'] === 'approved' ? ['reject' => 'Reject'] : ($spot['status'] === 'pending' ? ['approve' => 'Approve', 'reject' => 'Reject'] : ['approve' => 'Approve']) as $a => $label): ?>
                        <form method="POST" action="<?= $self ?>"><?= csrf_input() ?><input type="hidden" name="action" value="<?= $a ?>">
                            <button class="btn btn-<?= $a === 'approve' ? 'primary' : 'danger' ?> btn-sm" type="submit"><?= $label ?></button></form>
                    <?php endforeach; ?>
                    <form method="POST" action="<?= $self ?>"><?= csrf_input() ?>
                        <input type="hidden" name="action" value="<?= DailyProofRepository::bool($spot['hidden']) ? 'show' : 'hide' ?>">
                        <button class="btn btn-secondary btn-sm" type="submit"><?= DailyProofRepository::bool($spot['hidden']) ? 'Show on the map' : 'Hide from the map' ?></button></form>
                    <a class="btn btn-secondary btn-sm" href="/admin/daily/spots/new?spot=<?= dh($spot['id']) ?>">＋ Seed a photo here</a>
                </div>
                <?php endif; ?>
            </div>

            <h3 style="margin:14px 0 8px">Proofs (<?= count($proofs) ?>)</h3>
            <div class="table-wrapper"><table class="daily-stack">
                <tbody>
                <?php foreach ($proofs as $pr): ?>
                    <tr>
                        <td style="width:80px"><a href="<?= dh($pr['photo_url']) ?>" target="_blank"><img class="daily-thumb" src="<?= dh(R2Uploader::thumbProxy($pr['photo_url'])) ?>" alt=""></a></td>
                        <td><strong>@<?= dh($pr['username'] ?: $pr['display_name']) ?></strong>
                            <?= daily_state_badge($pr['moderation_status']) ?>
                            <?= DailyProofRepository::bool($pr['is_seed']) ? '<span class="badge" style="background:#1e3a5f;color:#93c5fd">seed</span>' : '' ?>
                            <div><?= $pr['caption'] !== null ? dh($pr['caption']) : '<span class="daily-muted">no caption</span>' ?></div>
                            <div class="daily-muted">
                                <?= dh(daily_theme_label($pr['theme'], $pr['challenge_date'])) ?>
                                <?= $pr['challenge_date'] ? ' · <a href="/admin/daily/today">' . dh($pr['challenge_date']) . '</a>' : '' ?>
                                <?= $pr['price_amount'] !== null ? ' · ' . dh(rtrim(rtrim((string) $pr['price_amount'], '0'), '.') . ' ' . $pr['price_currency']) : '' ?>
                                · <?= (int) $pr['vote_count'] ?> vote(s)
                                <?= $pr['distance_m'] !== null ? ' · ' . (int) $pr['distance_m'] . ' m away when posted' : '' ?>
                            </div></td>
                    </tr>
                <?php endforeach; ?>
                <?php if ($proofs === []): ?><tr><td class="no-results">No proof yet.</td></tr><?php endif; ?>
                </tbody>
            </table></div>
        </div>

        <div>
            <?php if (!$merged): ?>
            <form method="POST" action="<?= $self ?>" class="form-card">
                <?= csrf_input() ?><input type="hidden" name="action" value="rename">
                <div class="form-group"><label>Name (shown in the app)</label>
                    <input type="text" name="name" value="<?= dh($spot['name']) ?>" maxlength="<?= Places::NAME_MAX ?>" required></div>
                <div class="form-actions"><button class="btn btn-primary btn-sm" type="submit">Rename</button></div>
            </form>

            <form method="POST" action="<?= $self ?>" class="form-card">
                <?= csrf_input() ?><input type="hidden" name="action" value="tags">
                <div class="form-group"><label>Dish tags (max 5, comma-separated)</label>
                    <input type="text" name="tags" value="<?= dh(implode(', ', $tags['admin'])) ?>" placeholder="cơm tấm, sườn">
                    <?php if ($tags['twists'] !== []): ?><div class="hint">From Local Twists: <?= dh(implode(', ', $tags['twists'])) ?></div><?php endif; ?></div>
                <div class="form-actions"><button class="btn btn-primary btn-sm" type="submit">Save tags</button></div>
            </form>

            <div class="form-card">
                <h3 style="margin-bottom:6px">Merge into another spot</h3>
                <p class="daily-muted">Proofs, votes and tags move to the spot you keep; this one disappears from the map.</p>
                <?php foreach ($nearby as $n): ?>
                    <form method="POST" action="<?= $self ?>" style="margin-top:6px" onsubmit="return confirm('Merge this spot into the one you picked?')">
                        <?= csrf_input() ?><input type="hidden" name="action" value="merge"><input type="hidden" name="keep_id" value="<?= dh($n['id']) ?>">
                        <button class="btn btn-secondary btn-sm" type="submit">Into <?= dh($n['name']) ?></button>
                        <span class="daily-muted"><?= (int) $n['distanceM'] ?> m · <?= (int) $n['approved'] ?> proof(s) · <?= dh($n['status']) ?></span>
                    </form>
                <?php endforeach; ?>
                <?php if ($nearby === []): ?><p class="daily-muted">No other spot within <?= SpotsAdmin::NEARBY_M ?> m.</p><?php endif; ?>
                <form method="POST" action="<?= $self ?>" class="daily-inline" style="margin-top:10px" onsubmit="return confirm('Merge this spot?')">
                    <?= csrf_input() ?><input type="hidden" name="action" value="merge">
                    <input type="text" name="keep_id" placeholder="Spot id or its admin link" required>
                    <button class="btn btn-secondary btn-sm" type="submit">Merge</button>
                </form>
            </div>
            <?php endif; ?>
        </div>
    </div>
</div>
<?php admin_foot();
