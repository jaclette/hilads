<?php

declare(strict_types=1);

// Back office › Photos: every photo people publish (Daily photos and selfies,
// chat photos, profile photos), newest first (PhotoWatch). Photos are live at
// once: this is where they are checked after. "New" = not marked seen yet.

admin_require_login();
require_once __DIR__ . '/daily_common.php';

$pdo  = Database::pdo();
$self = '/admin/photos';
$view = ($_GET['view'] ?? 'new') === 'all' ? 'all' : 'new';
$page = max(1, (int) ($_GET['page'] ?? 1));
$back = $self . '?view=' . $view . '&page=' . $page;

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    csrf_verify();
    $action = (string) ($_POST['action'] ?? '');
    $id     = (int) ($_POST['id'] ?? 0);
    try {
        if ($action === 'seen_page') {
            $n = PhotoWatch::markSeen(array_map('intval', explode(',', (string) ($_POST['ids'] ?? ''))));
            flash_set('success', $n === 1 ? '1 photo marked as seen.' : "{$n} photos marked as seen.");
        } elseif ($action === 'seen_all') {
            $n = PhotoWatch::markSeen(null, (int) ($_POST['up_to'] ?? 0));
            flash_set('success', $n === 1 ? '1 photo marked as seen.' : "{$n} photos marked as seen.");
        } elseif ($action === 'remove' && $id > 0) {
            $st = $pdo->prepare('SELECT * FROM photo_watch WHERE id = ?');
            $st->execute([$id]);
            $row = $st->fetch(PDO::FETCH_ASSOC);
            if (!$row) {
                throw new InvalidArgumentException('Photo not found.');
            }
            if ($row['source'] === 'daily') {
                DailyAdminService::removeProof($row['ref_id'], 'Removed by a moderator.');
            } elseif ($row['source'] === 'chat') {
                // Same as Messages › Delete: the app shows its "deleted" tombstone.
                $pdo->prepare("UPDATE messages SET content = '', image_url = NULL, deleted_at = now() WHERE id = ? AND deleted_at IS NULL")
                    ->execute([$row['ref_id']]);
            } elseif ($row['source'] === 'avatar') {
                // Only while it is still their photo.
                $pdo->prepare('UPDATE users SET profile_photo_url = NULL, profile_thumb_photo_url = NULL, updated_at = ? WHERE id = ? AND profile_photo_url = ?')
                    ->execute([time(), $row['ref_id'], $row['url']]);
            }
            PhotoWatch::markSeen([$id]);
            $pdo->prepare('UPDATE photo_watch SET removed_at = now() WHERE id = ?')->execute([$id]);
            error_log('[admin] photo removed: ' . $row['source'] . ' ' . $row['ref_id']);
            flash_set('success', 'Photo removed.');
        }
    } catch (InvalidArgumentException $e) {
        flash_set('error', $e->getMessage());
    }
    admin_redirect($back);
}

$perPage = 60;
$missing = false;
try {
    $rows   = PhotoWatch::list($view === 'new', $perPage + 1, ($page - 1) * $perPage);
    $unseen = PhotoWatch::unseenCount();
} catch (\Throwable $e) {
    $rows = [];
    $unseen = 0;
    $missing = true;   // php migrate.php not run yet
}
$more = count($rows) > $perPage;
$rows = array_slice($rows, 0, $perPage);
$ids  = array_map(static fn($r) => (int) $r['id'], array_filter($rows, static fn($r) => $r['seen_at'] === null));
$maxId = $rows !== [] ? max(array_map(static fn($r) => (int) $r['id'], $rows)) : 0;

$SOURCE_COLOR = ['daily' => '#FF7A3C', 'chat' => '#3b82f6', 'avatar' => '#a855f7'];

admin_head('Photos');
admin_nav($self);
?>
<div class="admin-main">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:12px">
        <h1 class="page-title" style="margin-bottom:0">Photos
            <span style="color:#555;font-size:14px;font-weight:400"><?= $unseen ?> new · everything people publish, live at once</span>
        </h1>
        <div style="display:flex;gap:8px;align-items:center">
            <a class="btn btn-sm <?= $view === 'new' ? 'btn-primary' : 'btn-secondary' ?>" href="<?= $self ?>?view=new">New</a>
            <a class="btn btn-sm <?= $view === 'all' ? 'btn-primary' : 'btn-secondary' ?>" href="<?= $self ?>?view=all">All</a>
            <?php if ($ids !== []): ?>
                <form method="POST" action="<?= dh($back) ?>" style="margin:0"><?= csrf_input() ?>
                    <input type="hidden" name="action" value="seen_page"><input type="hidden" name="ids" value="<?= dh(implode(',', $ids)) ?>">
                    <button class="btn btn-secondary btn-sm" type="submit">Mark this page seen</button></form>
                <?php if ($view === 'new' && $unseen > count($ids)): ?>
                <form method="POST" action="<?= dh($back) ?>" style="margin:0" onsubmit="return confirm('Mark all <?= $unseen ?> photos as seen?')"><?= csrf_input() ?>
                    <input type="hidden" name="action" value="seen_all"><input type="hidden" name="up_to" value="<?= $maxId ?>">
                    <button class="btn btn-secondary btn-sm" type="submit">Mark all seen</button></form>
                <?php endif; ?>
            <?php endif; ?>
        </div>
    </div>
    <?= flash_html() ?>

    <?php if ($missing): ?>
        <p class="no-results">The photo_watch table is missing: run <code>php migrate.php</code>.</p>
    <?php elseif ($rows === []): ?>
        <p class="no-results"><?= $view === 'new' ? 'No new photo. All checked.' : 'No photo yet.' ?></p>
    <?php else: ?>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px">
        <?php foreach ($rows as $r):
            $color   = $SOURCE_COLOR[$r['source']] ?? '#666';
            $removed = !empty($r['removed_at']);
            $isNew   = $r['seen_at'] === null;
            $thumb   = R2Uploader::thumbProxy($r['url']) ?? $r['url'];
            $open    = match ($r['source']) {
                'avatar' => '/admin/users/' . rawurlencode((string) $r['ref_id']) . '/edit',
                'daily'  => '/admin/daily/today#latest',
                default  => null,
            };
        ?>
        <div style="background:#141414;border:1px solid <?= $isNew ? $color : '#262626' ?>;border-radius:10px;overflow:hidden;<?= $removed ? 'opacity:.4' : '' ?>">
            <a href="<?= dh($r['url']) ?>" target="_blank" rel="noopener">
                <img src="<?= dh($thumb) ?>" alt="" loading="lazy" style="display:block;width:100%;aspect-ratio:1;object-fit:cover;background:#222">
            </a>
            <div style="padding:8px 10px;font-size:12px;line-height:1.45">
                <span class="badge" style="background:<?= $color ?>22;color:<?= $color ?>;border:1px solid <?= $color ?>55"><?= dh(PhotoWatch::SOURCES[$r['source']] ?? $r['source']) ?></span>
                <?php if ($isNew): ?><span class="badge" style="background:#22c55e22;color:#4ade80">new</span><?php endif; ?>
                <?php if ($removed): ?><span class="badge" style="background:#ef444422;color:#f87171">removed</span><?php endif; ?>
                <div style="margin-top:4px;color:#ddd">
                    <?php if ($r['user_id']): ?><a href="/admin/users/<?= rawurlencode((string) $r['user_id']) ?>/edit"><?= dh((string) $r['author']) ?></a>
                    <?php else: ?><?= dh((string) $r['author']) ?> <span style="color:#666">(guest)</span><?php endif; ?>
                </div>
                <?php if ($r['place']): ?><div style="color:#888"><?= dh((string) $r['place']) ?></div><?php endif; ?>
                <div style="color:#666"><?= dh(date('M j, H:i', (int) $r['created_ts'] + 7 * 3600)) ?> <span style="color:#444">UTC+7</span></div>
                <div style="display:flex;gap:6px;margin-top:6px">
                    <?php if ($open): ?><a class="btn btn-secondary btn-sm" href="<?= dh($open) ?>">Open</a><?php endif; ?>
                    <?php if (!$removed): ?>
                    <form method="POST" action="<?= dh($back) ?>" style="margin:0" onsubmit="return confirm('Remove this photo from the app?')"><?= csrf_input() ?>
                        <input type="hidden" name="action" value="remove"><input type="hidden" name="id" value="<?= (int) $r['id'] ?>">
                        <button class="btn btn-danger btn-sm" type="submit">Remove</button></form>
                    <?php endif; ?>
                </div>
            </div>
        </div>
        <?php endforeach; ?>
    </div>
    <div style="display:flex;gap:8px;margin-top:16px">
        <?php if ($page > 1): ?><a class="btn btn-secondary btn-sm" href="<?= $self ?>?view=<?= $view ?>&page=<?= $page - 1 ?>">← Newer</a><?php endif; ?>
        <?php if ($more): ?><a class="btn btn-secondary btn-sm" href="<?= $self ?>?view=<?= $view ?>&page=<?= $page + 1 ?>">Older →</a><?php endif; ?>
    </div>
    <?php endif; ?>
</div>
<?php admin_foot(); ?>
