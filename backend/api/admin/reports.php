<?php

declare(strict_types=1);

// Moderation › Reports: what players reported. Three kinds: players (a profile or a chat
// nickname, user_reports), chat messages (message_reports on text messages; reported chat photos are
// on the Photos page) and comments on Daily photos (photo_comment_reports). Every decision is in the
// audit log.

admin_require_login();

$pdo     = Database::pdo();
$self    = '/admin/reports';
$kind    = in_array($_GET['kind'] ?? '', ['messages', 'comments'], true) ? (string) $_GET['kind'] : 'players';
$status  = in_array($_GET['status'] ?? '', ['open', 'reviewed', 'dismissed', 'all'], true) ? (string) $_GET['status'] : 'open';
$page    = max(1, (int) ($_GET['page'] ?? 1));
$perPage = 50;
$url     = fn (array $over = []): string => $self . '?' . http_build_query(array_filter($over + ['kind' => $kind, 'status' => $status, 'page' => $page],
                                             fn ($v) => $v !== null && $v !== '' && $v !== 1 && $v !== 'players' && $v !== 'open'));
$canEdit = admin_can_edit('moderation');
$STATUS  = ['open' => ['Open', 'b-brand'], 'reviewed' => ['Handled', 'b-ok'], 'dismissed' => ['Dismissed', 'b-mute']];

$report = function (int $id) use ($pdo): ?array {
    $st = $pdo->prepare("SELECT * FROM user_reports WHERE id = ?");
    $st->execute([$id]);
    return $st->fetch(PDO::FETCH_ASSOC) ?: null;
};

if ($method === 'POST') {
    csrf_verify();
    $do = (string) ($_POST['do'] ?? '');
    try {
        if (preg_match('/^status:(\d+):(open|reviewed|dismissed)$/', $do, $m)) {
            $r = $report((int) $m[1]) ?? throw new InvalidArgumentException('Report not found.');
            $pdo->prepare("UPDATE user_reports SET status = ? WHERE id = ?")->execute([$m[2], $r['id']]);
            AdminAuth::log('report.status', 'report', (string) $r['id'], ['status' => $r['status']], ['status' => $m[2]]);
            flash_set('success', ['reviewed' => 'Report marked handled.', 'dismissed' => 'Report dismissed.', 'open' => 'Report reopened.'][$m[2]]);
        } elseif (preg_match('/^ban:(\d+)$/', $do, $m)) {
            $r = $report((int) $m[1]) ?? throw new InvalidArgumentException('Report not found.');
            if (empty($r['target_guest_id'])) throw new InvalidArgumentException('This report is not about a guest.');
            $res = BanRepository::banGuest($r['target_guest_id'], 'admin: report #' . $r['id'], admin_actor(), 7);
            $pdo->prepare("UPDATE user_reports SET status = 'reviewed' WHERE id = ? AND status = 'open'")->execute([$r['id']]);
            AdminAuth::log('ban.guest', 'report', (string) $r['id'], null,
                ['guest' => $r['target_guest_id'], 'nickname' => $r['target_nickname'], 'days' => $res['days'], 'ips' => $res['ips']]);
            $name = $r['target_nickname'] ?: ('Guest ' . substr((string) $r['target_guest_id'], 0, 8));
            flash_set('success', "{$name} can't post for {$res['days']} days ({$res['ips']} IP address" . ($res['ips'] === 1 ? '' : 'es') . " too). Report marked handled.");
        } elseif (preg_match('/^message:(keep|remove):([A-Za-z0-9_-]+)$/', $do, $m)) {
            $st = $pdo->prepare("SELECT id, content, deleted_at, nickname, channel_id FROM messages WHERE id = ?");
            $st->execute([$m[2]]);
            $msg = $st->fetch(PDO::FETCH_ASSOC) ?: throw new InvalidArgumentException('Message not found.');
            if ($m[1] === 'keep') {
                // Reports dismissed; a message the reports had hidden (deleted_at set, text kept) comes back.
                $pdo->prepare("UPDATE message_reports SET status = 'dismissed' WHERE message_id = ? AND status = 'open'")->execute([$msg['id']]);
                $pdo->prepare("UPDATE messages SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL AND content <> ''")->execute([$msg['id']]);
            } else {
                $pdo->prepare("UPDATE message_reports SET status = 'reviewed' WHERE message_id = ? AND status = 'open'")->execute([$msg['id']]);
                $pdo->prepare("UPDATE messages SET content = '', image_url = NULL, deleted_at = coalesce(deleted_at, now()) WHERE id = ?")->execute([$msg['id']]);
            }
            AdminAuth::log('message.' . $m[1], 'message', (string) $msg['id'],
                ['author' => $msg['nickname'], 'channel' => $msg['channel_id'], 'text' => $msg['content'], 'hidden' => $msg['deleted_at'] !== null], ['decision' => $m[1]]);
            flash_set('success', $m[1] === 'keep' ? 'Message kept, its reports dismissed.' : 'Message removed.');
        } elseif (preg_match('/^comment:(keep|remove):(\d+)$/', $do, $m)) {
            $st = $pdo->prepare("SELECT c.id, c.body, c.hidden_at, u.username FROM photo_comments c JOIN users u ON u.id = c.user_id WHERE c.id = ?");
            $st->execute([(int) $m[2]]);
            $c = $st->fetch(PDO::FETCH_ASSOC) ?: throw new InvalidArgumentException('Comment not found.');
            PhotoComments::resolveReports((int) $c['id'], $m[1]);
            AdminAuth::log('comment.' . $m[1], 'photo_comment', (string) $c['id'],
                ['author' => $c['username'], 'body' => $c['body'], 'hidden' => $c['hidden_at'] !== null], ['decision' => $m[1]]);
            flash_set('success', $m[1] === 'keep' ? 'Comment kept, its reports dismissed.' : 'Comment removed.');
        }
    } catch (InvalidArgumentException $e) {
        flash_set('error', $e->getMessage());
    } catch (\Throwable $e) {
        error_log('[admin-reports] ' . $e->getMessage());
        flash_set('error', 'That did not work: ' . $e->getMessage());
    }
    admin_badges_changed();
    admin_redirect($url());
}

// Counts for the tabs.
$counts = $pdo->query("SELECT status, count(*) FROM user_reports GROUP BY status")->fetchAll(PDO::FETCH_KEY_PAIR);
$counts['all'] = array_sum($counts);
$comments = [];
try {
    $comments = PhotoComments::reportedQueue(100);
} catch (\Throwable) { /* older schema */ }

$messages = [];
try {
    $messages = $pdo->query("
        SELECT m.id, m.content, m.nickname, m.user_id, m.guest_id, m.deleted_at, m.created_at, m.channel_id,
               c.name AS channel_name, c.type AS channel_type,
               count(r.message_id) AS report_count, string_agg(DISTINCT r.reason_code, ',') AS reasons
        FROM message_reports r
        JOIN messages m ON m.id = r.message_id AND m.type = 'text'
        LEFT JOIN channels c ON c.id = m.channel_id
        WHERE r.status = 'open'
        GROUP BY m.id, c.name, c.type
        ORDER BY count(r.message_id) DESC, m.created_at DESC
        LIMIT 100
    ")->fetchAll(PDO::FETCH_ASSOC);
} catch (\Throwable) { /* older schema */ }

$rows = [];
$total = 0;
if ($kind === 'players') {
    $where = $status === 'all' ? '' : 'WHERE r.status = ?';
    $args  = $status === 'all' ? [] : [$status];
    $total = (int) ($status === 'all' ? $counts['all'] : ($counts[$status] ?? 0));
    $st = $pdo->prepare("
        SELECT r.*, ru.display_name AS reporter_name, ru.username AS reporter_username,
               tu.display_name AS target_name, tu.username AS target_username, tu.deleted_at AS target_deleted_at,
               (SELECT count(*) FROM user_reports r2 WHERE r2.status = 'open'
                  AND (r2.target_user_id = r.target_user_id OR r2.target_guest_id = r.target_guest_id)) AS open_on_target
        FROM user_reports r
        LEFT JOIN users ru ON ru.id = r.reporter_user_id
        LEFT JOIN users tu ON tu.id = r.target_user_id
        {$where}
        ORDER BY r.created_at DESC LIMIT {$perPage} OFFSET " . (($page - 1) * $perPage));
    $st->execute($args);
    $rows = $st->fetchAll(PDO::FETCH_ASSOC);
}

$help = '<h3>Players</h3><p>Someone reported a player (from a profile or a chat). Look at the player first (their name opens the profile), then:</p>'
      . '<ul><li><b>Handled</b>: you acted (warned, edited, deleted the account…).</li><li><b>Dismiss</b>: nothing wrong.</li>'
      . '<li><b>Ban 7 days</b> (guests only): the guest and the IPs of their recent messages can\'t post for 7 days; lift it on the Bans page.</li>'
      . '<li>A registered player who breaks the rules: open them in Users to delete the account.</li></ul>'
      . '<h3>Messages</h3><p>Chat messages. After ' . PhotoWatch::REPORT_HIDE_THRESHOLD . ' reports a message is hidden until you decide: '
      . '<b>Keep</b> shows it again, <b>Remove</b> shows it as deleted.</p>'
      . '<h3>Comments</h3><p>Comments on Daily photos. After ' . PhotoComments::REPORT_HIDE_THRESHOLD . ' reports a comment is hidden until you decide: '
      . '<b>Keep</b> shows it again, <b>Remove</b> deletes it.</p><h3>Photos</h3><p>Reported photos are on the <a href="/admin/photos?tab=reported">Photos</a> page.</p>';

admin_head('Reports');
admin_nav($self);
echo '<div class="admin-main">';
echo ui_page_head('Moderation', 'Reports', 'What players reported: other players, chat messages, and comments on Daily photos. Reported photos are under <a href="/admin/photos?tab=reported">Photos</a>.',
    ui_help('How to handle a report', $help));
echo flash_html();
?>
<div class="card">
    <div class="toolbar">
        <?= ui_tabs([
            ['Players', $self, $counts['open'] ?? 0, $kind === 'players'],
            ['Messages', $self . '?kind=messages', count($messages), $kind === 'messages'],
            ['Comments', $self . '?kind=comments', count($comments), $kind === 'comments'],
        ], 'Kind of report') ?>
        <?php if ($kind === 'players'): ?>
            <?= ui_tabs([
                ['Open', $url(['status' => 'open', 'page' => 1]), null, $status === 'open'],
                ['Handled', $url(['status' => 'reviewed', 'page' => 1]), null, $status === 'reviewed'],
                ['Dismissed', $url(['status' => 'dismissed', 'page' => 1]), null, $status === 'dismissed'],
                ['All', $url(['status' => 'all', 'page' => 1]), null, $status === 'all'],
            ], 'Status') ?>
        <?php endif; ?>
    </div>

<?php if ($kind === 'messages'): ?>
    <?php if ($messages === []): ?>
        <?= ui_empty('No reported message', 'Nothing waiting for a decision.') ?>
    <?php else: ?>
    <form method="POST" action="<?= ui_e($url()) ?>"><?= csrf_input() ?>
    <div class="table-wrapper"><table class="data">
        <thead><tr><th>Message</th><th>By</th><th>In</th><th>Reports</th><th>Status</th><th></th></tr></thead>
        <tbody>
        <?php foreach ($messages as $mm):
            $hidden = $mm['deleted_at'] !== null && $mm['content'] !== ''; ?>
            <tr>
                <td style="max-width:420px">“<?= ui_e($mm['content'] !== '' ? $mm['content'] : '(already deleted)') ?>”<div class="hint" title="<?= ui_e(ui_when($mm['created_at'])) ?>"><?= ui_e(ui_ago($mm['created_at'])) ?></div></td>
                <td><div class="who"><b><?php if ($mm['user_id']): ?><a href="/admin/users/<?= ui_e(rawurlencode((string) $mm['user_id'])) ?>/edit" style="color:var(--text)"><?= ui_e($mm['nickname']) ?></a><?php else: ?><?= ui_e($mm['nickname']) ?><?php endif; ?></b>
                    <span><?= $mm['user_id'] ? 'player' : 'guest' ?></span></div></td>
                <td><a href="/admin/messages?channel=<?= ui_e(rawurlencode((string) $mm['channel_id'])) ?>"><?= ui_e($mm['channel_type'] === 'world' ? 'World chat' : ($mm['channel_name'] ?? $mm['channel_id'])) ?></a></td>
                <td><span class="badge b-bad dot"><?= (int) $mm['report_count'] ?></span><div class="reasons"><?= ui_e(str_replace(['_', ','], [' ', ', '], (string) $mm['reasons'])) ?></div></td>
                <td><?= $hidden ? '<span class="badge b-bad dot">Hidden by reports</span>' : ($mm['deleted_at'] ? '<span class="badge b-mute">Deleted</span>' : '<span class="badge b-brand dot">Visible</span>') ?></td>
                <td><div class="row-actions" style="display:flex;gap:6px;justify-content:flex-end">
                    <?php if ($canEdit): ?>
                        <button class="btn btn-sm" name="do" value="message:keep:<?= ui_e($mm['id']) ?>"<?= $hidden ? ' title="Dismiss the reports and show it again"' : '' ?>>Keep</button>
                        <button class="btn btn-sm btn-danger" name="do" value="message:remove:<?= ui_e($mm['id']) ?>" data-confirm="Remove this message?" data-confirm-text="The chat shows it as deleted for everyone." data-confirm-button="Remove">Remove</button>
                    <?php endif; ?>
                </div></td>
            </tr>
        <?php endforeach; ?>
        </tbody>
    </table></div>
    </form>
    <?php endif; ?>

<?php elseif ($kind === 'comments'): ?>
    <?php if ($comments === []): ?>
        <?= ui_empty('No reported comment', 'Nothing waiting for a decision.') ?>
    <?php else: ?>
    <form method="POST" action="<?= ui_e($url()) ?>"><?= csrf_input() ?>
    <div class="table-wrapper"><table class="data">
        <thead><tr><th class="thumb-cell">On photo</th><th>Comment</th><th>By</th><th>Reports</th><th>Status</th><th></th></tr></thead>
        <tbody>
        <?php foreach ($comments as $c): ?>
            <tr>
                <td class="thumb-cell"><a href="<?= ui_e($c['photo_url']) ?>" target="_blank" rel="noopener"><img class="thumb" src="<?= ui_e(R2Uploader::thumbProxy($c['photo_url'])) ?>" alt="" loading="lazy"></a></td>
                <td style="max-width:420px">“<?= ui_e($c['body']) ?>”<div class="hint" title="<?= ui_e(ui_when($c['created_at'])) ?>"><?= ui_e(ui_ago($c['created_at'])) ?></div></td>
                <td><div class="who"><b><?= ui_e($c['display_name']) ?></b><span>@<?= ui_e($c['username']) ?></span></div></td>
                <td><span class="badge b-bad dot"><?= (int) $c['report_count'] ?></span><div class="reasons"><?= ui_e(str_replace(['_', ','], [' ', ', '], (string) $c['reasons'])) ?></div></td>
                <td><?= $c['hidden_at'] ? '<span class="badge b-bad dot">Hidden by reports</span>' : '<span class="badge b-brand dot">Visible</span>' ?></td>
                <td><div class="row-actions" style="display:flex;gap:6px;justify-content:flex-end">
                    <?php if ($canEdit): ?>
                        <button class="btn btn-sm" name="do" value="comment:keep:<?= (int) $c['id'] ?>">Keep</button>
                        <button class="btn btn-sm btn-danger" name="do" value="comment:remove:<?= (int) $c['id'] ?>" data-confirm="Remove this comment?" data-confirm-text="It disappears from the photo for everyone." data-confirm-button="Remove">Remove</button>
                    <?php endif; ?>
                </div></td>
            </tr>
        <?php endforeach; ?>
        </tbody>
    </table></div>
    </form>
    <?php endif; ?>

<?php else: ?>
    <?php if ($rows === []): ?>
        <?= $status === 'open' ? ui_empty('No open report', 'Nothing waiting for a decision.') : ui_empty('No report here') ?>
    <?php else: ?>
    <form method="POST" action="<?= ui_e($url()) ?>"><?= csrf_input() ?>
    <div class="table-wrapper"><table class="data">
        <thead><tr><th>Reported</th><th>Reason</th><th>By</th><th>When</th><th>Status</th><th></th></tr></thead>
        <tbody>
        <?php foreach ($rows as $r):
            $targetName = $r['target_name'] ?? ($r['target_nickname'] ?: ($r['target_guest_id'] ? 'Guest ' . substr((string) $r['target_guest_id'], 0, 8) : '–'));
            $reporter = $r['reporter_name'] ?? ($r['reporter_guest_id'] ? 'Guest ' . substr((string) $r['reporter_guest_id'], 0, 8) : '–');
            [$sLabel, $sClass] = $STATUS[$r['status']] ?? [$r['status'], 'b-mute']; ?>
            <tr>
                <td><div class="who"><b><?php if ($r['target_user_id']): ?><a href="/admin/users/<?= ui_e(rawurlencode((string) $r['target_user_id'])) ?>/edit" style="color:var(--text)"><?= ui_e($targetName) ?></a><?php else: ?><?= ui_e($targetName) ?><?php endif; ?></b>
                    <span><?= $r['target_user_id'] ? ($r['target_username'] ? '@' . ui_e($r['target_username']) : 'player') : 'guest' ?>
                        <?= $r['target_deleted_at'] ? ' · account deleted' : '' ?><?= (int) $r['open_on_target'] > 1 ? ' · ' . (int) $r['open_on_target'] . ' open reports' : '' ?></span></div></td>
                <td style="max-width:360px"><?= ui_e($r['reason']) ?></td>
                <td><?php if ($r['reporter_user_id']): ?><a href="/admin/users/<?= ui_e(rawurlencode((string) $r['reporter_user_id'])) ?>/edit"><?= ui_e($reporter) ?></a><?php else: ?><span class="muted"><?= ui_e($reporter) ?></span><?php endif; ?></td>
                <td title="<?= ui_e(ui_when($r['created_at'])) ?>" style="white-space:nowrap"><?= ui_e(ui_ago($r['created_at'])) ?></td>
                <td><span class="badge <?= $sClass ?> dot"><?= ui_e($sLabel) ?></span></td>
                <td><div class="row-actions" style="display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap">
                <?php if ($canEdit): ?>
                    <?php if ($r['status'] === 'open'): ?>
                        <button class="btn btn-sm" name="do" value="status:<?= (int) $r['id'] ?>:reviewed" title="You acted on it">Handled</button>
                        <button class="btn btn-sm btn-ghost" name="do" value="status:<?= (int) $r['id'] ?>:dismissed" title="Nothing wrong">Dismiss</button>
                        <?php if ($r['target_guest_id'] && !$r['target_user_id']): ?>
                            <button class="btn btn-sm btn-danger" name="do" value="ban:<?= (int) $r['id'] ?>" data-confirm="Ban <?= ui_e($targetName) ?> for 7 days?"
                                    data-confirm-text="The guest and the IPs of their recent messages can't post for 7 days. You can lift it on the Bans page." data-confirm-button="Ban 7 days">Ban 7 days</button>
                        <?php endif; ?>
                    <?php else: ?>
                        <button class="btn btn-sm btn-ghost" name="do" value="status:<?= (int) $r['id'] ?>:open">Reopen</button>
                    <?php endif; ?>
                <?php endif; ?>
                </div></td>
            </tr>
        <?php endforeach; ?>
        </tbody>
    </table></div>
    </form>
    <?= ui_pager($page, $perPage, $total, fn (int $p) => $url(['page' => $p])) ?>
    <?php endif; ?>
<?php endif; ?>
</div>
</div>
<?php
admin_foot();
