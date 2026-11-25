<?php

declare(strict_types=1);

// Moderation › Photos: every photo people publish (Daily photos and selfies, chat photos, profile
// photos), live at once and checked here afterwards (PhotoWatch). Tabs: to check (not seen yet),
// reported, removed, all. Remove takes a photo out of the app; Keep dismisses its reports and puts
// it back if the reports had hidden it. Every action is in the audit log.

admin_require_login();

$pdo    = Database::pdo();
$self   = '/admin/photos';
$tab    = in_array($_GET['tab'] ?? '', PhotoWatch::TABS, true) ? (string) $_GET['tab'] : (($_GET['view'] ?? '') === 'all' ? 'all' : 'check');
$source = isset(PhotoWatch::SOURCES[$_GET['source'] ?? '']) ? (string) $_GET['source'] : null;
$q      = trim((string) ($_GET['q'] ?? ''));
$page   = max(1, (int) ($_GET['page'] ?? 1));
$url    = fn (array $over = []): string => $self . '?' . http_build_query(array_filter($over + ['tab' => $tab, 'source' => $source, 'q' => $q, 'page' => $page],
                                            fn ($v) => $v !== null && $v !== '' && $v !== 1));
$canEdit = admin_can_edit('moderation');

/** Take one photo out of the app (by its source), mark it seen and removed. */
$remove = function (array $row) use ($pdo): void {
    if ($row['removed_at'] !== null) return;
    if ($row['source'] === 'daily') {
        DailyAdminService::removeProof($row['ref_id'], 'Removed by a moderator.');
    } elseif ($row['source'] === 'chat') {
        // Same as Messages › Delete: the app shows its "deleted" placeholder.
        $pdo->prepare("UPDATE messages SET content = '', image_url = NULL, deleted_at = now() WHERE id = ? AND deleted_at IS NULL")->execute([$row['ref_id']]);
        $pdo->prepare("UPDATE message_reports SET status = 'reviewed' WHERE message_id = ? AND status = 'open'")->execute([$row['ref_id']]);
    } elseif ($row['source'] === 'avatar') {
        // Only while it is still their photo.
        $pdo->prepare('UPDATE users SET profile_photo_url = NULL, profile_thumb_photo_url = NULL, updated_at = ? WHERE id = ? AND profile_photo_url = ?')
            ->execute([time(), $row['ref_id'], $row['url']]);
    }
    $pdo->prepare('UPDATE photo_watch SET removed_at = now(), seen_at = coalesce(seen_at, now()) WHERE id = ?')->execute([$row['id']]);
    AdminAuth::log('photo.remove', 'photo', (string) $row['id'],
        ['source' => $row['source'], 'ref' => $row['ref_id'], 'author' => $row['author'], 'reports' => (int) $row['report_count'], 'url' => $row['url']], ['removed' => true]);
};

/** Dismiss its reports; a photo the reports had hidden comes back. */
$keep = function (array $row) use ($pdo): void {
    if ($row['source'] === 'daily') {
        DailyModerationService::resolveReports($row['ref_id'], 'dismissed');
        $proof = DailyProofRepository::findById($row['ref_id']);
        if ($proof !== null && $proof['moderation_status'] === 'pending') {
            DailyModerationService::approveProof($row['ref_id']);
        }
    } elseif ($row['source'] === 'chat') {
        $pdo->prepare("UPDATE message_reports SET status = 'dismissed' WHERE message_id = ? AND status = 'open'")->execute([$row['ref_id']]);
        if ($row['hidden_at'] !== null) {
            $pdo->prepare('UPDATE messages SET image_url = ?, deleted_at = NULL WHERE id = ? AND image_url IS NULL')->execute([$row['url'], $row['ref_id']]);
        }
    }
    $pdo->prepare('UPDATE photo_watch SET report_count = 0, hidden_at = NULL, seen_at = now() WHERE id = ?')->execute([$row['id']]);
    AdminAuth::log('photo.keep', 'photo', (string) $row['id'],
        ['source' => $row['source'], 'ref' => $row['ref_id'], 'author' => $row['author'], 'reports' => (int) $row['report_count'], 'hidden' => $row['hidden_at'] !== null],
        ['reports' => 0, 'hidden' => false]);
};

if ($method === 'POST') {
    csrf_verify();
    $do  = (string) ($_POST['do'] ?? '');
    $ids = array_values(array_filter(array_map('intval', (array) ($_POST['ids'] ?? []))));
    if (preg_match('/^(remove|keep|seen):(\d+)$/', $do, $m)) {   // a row's own button
        $do = $m[1];
        $ids = [(int) $m[2]];
    }
    try {
        if ($do === 'seen_all') {
            $n = PhotoWatch::markSeen(null, (int) ($_POST['up_to'] ?? 0));
            AdminAuth::log('photo.seen_all', 'photo', null, null, ['marked' => $n]);
            flash_set('success', $n === 1 ? '1 photo marked as checked.' : "{$n} photos marked as checked.");
        } elseif ($ids === []) {
            flash_set('error', 'Select at least one photo.');
        } elseif ($do === 'seen') {
            $n = PhotoWatch::markSeen($ids);
            AdminAuth::log('photo.seen', 'photo', null, null, ['ids' => $ids, 'marked' => $n]);
            flash_set('success', $n === 1 ? '1 photo marked as checked.' : "{$n} photos marked as checked.");
        } elseif ($do === 'remove' || $do === 'keep') {
            $done = 0;
            foreach ($ids as $id) {
                $row = PhotoWatch::find($id);
                if ($row === null) continue;
                $do === 'remove' ? $remove($row) : $keep($row);
                $done++;
            }
            flash_set('success', ($do === 'remove' ? 'Removed ' : 'Kept ') . ($done === 1 ? '1 photo.' : "{$done} photos.")
                . ($do === 'keep' ? ' Their reports are dismissed.' : ''));
        }
    } catch (InvalidArgumentException $e) {
        flash_set('error', $e->getMessage());
    }
    admin_badges_changed();
    admin_redirect($url());
}

$perPage = 50;
$missing = false;
try {
    $counts = PhotoWatch::counts($source, $q);
    $rows   = PhotoWatch::search($tab, $source, $q, $perPage, ($page - 1) * $perPage);
} catch (\Throwable $e) {
    $counts = array_fill_keys(PhotoWatch::TABS, 0);
    $rows = [];
    $missing = true;   // php migrate.php not run yet
}
$maxId = $rows !== [] ? max(array_map(static fn($r) => (int) $r['id'], $rows)) : 0;
$sourceBadge = ['daily' => 'b-brand', 'chat' => 'b-info', 'avatar' => 'b-violet'];

$help = '<h3>What lands here</h3><p>Every photo people publish: Daily photos (and their selfie), photos in city chats, and profile photos. '
      . 'Private messages are never listed. Photos are live at once; this list is for checking them afterwards.</p>'
      . '<h3>To check</h3><p>Photos nobody has looked at yet. Reported ones come first. Select a page and mark it checked when it looks fine.</p>'
      . '<h3>Remove</h3><p>Takes the photo out of the app at once (a Daily photo also loses its points). The row stays here under Removed.</p>'
      . '<h3>Keep</h3><p>For a reported photo that is fine: its reports are dismissed, and if enough reports had hidden it, it comes back.</p>';

admin_head('Photos');
admin_nav($self);
echo '<div class="admin-main">';
echo ui_page_head('Moderation', 'Photos', 'Everything people publish, live at once. Check new photos, remove what breaks the rules, keep what was reported for nothing.',
    ui_help('How moderation works', $help));
echo flash_html();
?>
<div class="card">
    <form class="toolbar" method="GET" action="<?= $self ?>">
        <input type="hidden" name="tab" value="<?= ui_e($tab) ?>">
        <?= ui_tabs([
            ['To check', $url(['tab' => 'check', 'page' => 1]), $counts['check'], $tab === 'check'],
            ['Reported', $url(['tab' => 'reported', 'page' => 1]), $counts['reported'], $tab === 'reported'],
            ['Removed', $url(['tab' => 'removed', 'page' => 1]), null, $tab === 'removed'],
            ['All', $url(['tab' => 'all', 'page' => 1]), null, $tab === 'all'],
        ], 'Photos to show') ?>
        <select class="select" name="source" data-autosubmit aria-label="Where">
            <option value="">Everywhere</option>
            <?php foreach (PhotoWatch::SOURCES as $k => $label): ?><option value="<?= $k ?>"<?= $source === $k ? ' selected' : '' ?>><?= ui_e($label) ?></option><?php endforeach; ?>
        </select>
        <input class="input" type="search" name="q" value="<?= ui_e($q) ?>" placeholder="Player or place" style="width:220px">
        <button class="btn btn-sm" type="submit">Search</button>
        <?php if ($source !== null || $q !== ''): ?><a class="btn btn-sm btn-ghost" href="<?= ui_e($self . '?tab=' . $tab) ?>">Clear</a><?php endif; ?>
    </form>

    <?php if ($missing): ?>
        <?= ui_empty('Not set up yet', 'Run php migrate.php to create the photo list.') ?>
    <?php elseif ($rows === []): ?>
        <?= $tab === 'check' ? ui_empty('All checked', 'No new photo since the last check.') : ui_empty('No photo here', $q !== '' || $source !== null ? 'Nothing matches these filters.' : '') ?>
    <?php else: ?>
    <form method="POST" action="<?= ui_e($url()) ?>" data-bulk>
        <?= csrf_input() ?>
        <?php if ($canEdit): ?>
        <div class="bulk" hidden>
            <span><span class="bulk-count">0</span> selected</span>
            <button class="btn btn-sm" name="do" value="seen">Mark checked</button>
            <?php if ($tab === 'reported' || $tab === 'check'): ?><button class="btn btn-sm" name="do" value="keep" data-confirm="Keep the selected photos?" data-confirm-text="Their reports are dismissed; hidden ones come back in the app." data-confirm-button="Keep" data-danger="0">Keep</button><?php endif; ?>
            <button class="btn btn-sm btn-danger" name="do" value="remove" data-confirm="Remove the selected photos?" data-confirm-text="They disappear from the app at once. Daily photos lose their points." data-confirm-button="Remove">Remove</button>
        </div>
        <?php endif; ?>
        <div class="table-wrapper">
        <table class="data">
            <thead><tr>
                <?php if ($canEdit): ?><th style="width:36px"><input type="checkbox" class="sel-all" aria-label="Select all on this page"></th><?php endif; ?>
                <th class="thumb-cell">Photo</th><th>Player</th><th>Where</th><th>Posted</th><th>Reports</th><th>Status</th><th></th>
            </tr></thead>
            <tbody>
            <?php foreach ($rows as $r):
                $removed  = $r['removed_at'] !== null;
                $reported = (int) $r['report_count'] > 0 && !$removed;
                $isNew    = $r['seen_at'] === null;
                $thumb    = R2Uploader::thumbProxy($r['url']) ?? $r['url'];
                $open     = match ($r['source']) {
                    'avatar' => '/admin/users/' . rawurlencode((string) $r['ref_id']) . '/edit',
                    'daily'  => '/admin/daily/today#latest',
                    'chat'   => '/admin/messages?q=' . rawurlencode((string) $r['ref_id']),
                    default  => null,
                };
            ?>
                <tr>
                    <?php if ($canEdit): ?><td><input type="checkbox" class="sel-row" name="ids[]" value="<?= (int) $r['id'] ?>" aria-label="Select"></td><?php endif; ?>
                    <td class="thumb-cell"><a href="<?= ui_e($r['url']) ?>" target="_blank" rel="noopener" title="Open the full photo">
                        <img class="thumb" src="<?= ui_e($thumb) ?>" alt="" loading="lazy" style="<?= $removed ? 'opacity:.35' : '' ?>"
                             onerror="this.onerror=null;this.src=<?= ui_e(json_encode($r['url'])) ?>"></a></td>
                    <td><div class="who"><b><?php if ($r['user_id']): ?><a href="/admin/users/<?= rawurlencode((string) $r['user_id']) ?>/edit" style="color:var(--text)"><?= ui_e($r['author']) ?></a>
                        <?php else: ?><?= ui_e($r['author']) ?><?php endif; ?></b>
                        <span><?= $r['user_id'] ? '' : 'guest' ?></span></div></td>
                    <td><span class="badge <?= $sourceBadge[$r['source']] ?? '' ?>"><?= ui_e(PhotoWatch::SOURCES[$r['source']] ?? $r['source']) ?></span>
                        <?php if ($r['place']): ?><div class="hint" style="margin-top:3px"><?= ui_e($r['place']) ?></div><?php endif; ?></td>
                    <td title="<?= ui_e(ui_when((int) $r['created_ts'])) ?>"><?= ui_e(ui_ago((int) $r['created_ts'])) ?></td>
                    <td><?php if ((int) $r['report_count'] > 0): ?><span class="badge b-bad dot"><?= (int) $r['report_count'] ?></span>
                        <div class="reasons"><?= ui_e(str_replace(['_', ','], [' ', ', '], (string) $r['report_reasons'])) ?></div>
                        <?php else: ?><span class="faint">–</span><?php endif; ?></td>
                    <td><?= $removed ? '<span class="badge b-mute">Removed</span>'
                        : ($reported && $r['hidden_at'] ? '<span class="badge b-bad dot">Hidden by reports</span>'
                        : ($reported ? '<span class="badge b-bad dot">Reported</span>'
                        : ($isNew ? '<span class="badge b-info dot">To check</span>' : '<span class="badge b-ok dot">Checked</span>'))) ?></td>
                    <td><div class="row-actions" style="display:flex;gap:6px;justify-content:flex-end">
                        <?php if ($open): ?><a class="btn btn-sm btn-ghost" href="<?= ui_e($open) ?>">Open</a><?php endif; ?>
                        <?php if ($canEdit && !$removed): ?>
                            <?php if ($reported): ?>
                                <button class="btn btn-sm" name="do" value="keep:<?= (int) $r['id'] ?>" title="Dismiss the reports<?= $r['hidden_at'] ? ' and put the photo back' : '' ?>">Keep</button>
                            <?php elseif ($isNew): ?>
                                <button class="btn btn-sm" name="do" value="seen:<?= (int) $r['id'] ?>">Fine</button>
                            <?php endif; ?>
                            <button class="btn btn-sm btn-danger" name="do" value="remove:<?= (int) $r['id'] ?>"
                                    data-confirm="Remove this photo?" data-confirm-text="It disappears from the app at once<?= $r['source'] === 'daily' ? ' and loses its points' : '' ?>." data-confirm-button="Remove">Remove</button>
                        <?php endif; ?>
                    </div></td>
                </tr>
            <?php endforeach; ?>
            </tbody>
        </table>
        </div>
    </form>
    <div style="display:flex;align-items:center">
        <?= ui_pager($page, $perPage, $counts[$tab], fn (int $p) => $url(['page' => $p])) ?>
        <?php if ($canEdit && $tab === 'check' && $counts['check'] > count($rows)): ?>
            <form method="POST" action="<?= ui_e($url()) ?>" style="margin:0 16px 0 auto" data-confirm="Mark all <?= $counts['check'] ?> photos as checked?" data-confirm-text="Including the ones on the next pages you haven't looked at." data-confirm-button="Mark all checked" data-danger="0">
                <?= csrf_input() ?><input type="hidden" name="do" value="seen_all"><input type="hidden" name="up_to" value="<?= $maxId ?>">
                <button class="btn btn-sm btn-ghost" type="submit">Mark all <?= number_format($counts['check']) ?> checked</button></form>
        <?php endif; ?>
    </div>
    <?php endif; ?>
</div>
</div>
<?php
admin_foot();
