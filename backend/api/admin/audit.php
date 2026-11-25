<?php

declare(strict_types=1);

// System › Audit log (super admins): who changed what and when, with the values before and after.
// One log for the whole back office (admin_audit_log), filterable by person, kind of change,
// target and dates.

admin_require_login();

$pdo = Database::pdo();
$e = fn ($s) => htmlspecialchars((string) $s, ENT_QUOTES);
$f = [
    'who'  => trim((string) ($_GET['who'] ?? '')),
    'kind' => trim((string) ($_GET['kind'] ?? '')),
    'type' => trim((string) ($_GET['type'] ?? '')),
    'id'   => trim((string) ($_GET['id'] ?? '')),
    'from' => preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) ($_GET['from'] ?? '')) ? (string) $_GET['from'] : '',
    'to'   => preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) ($_GET['to'] ?? '')) ? (string) $_GET['to'] : '',
];
$page = max(1, (int) ($_GET['page'] ?? 1));
$per  = 50;

$where = [];
$args  = [];
if ($f['who'] !== '')  { $where[] = 'admin_username = ?'; $args[] = $f['who']; }
if ($f['kind'] !== '') { $where[] = "split_part(action, '.', 1) = ?"; $args[] = $f['kind']; }
if ($f['type'] !== '') { $where[] = 'entity_type = ?'; $args[] = $f['type']; }
if ($f['id'] !== '')   { $where[] = 'entity_id = ?'; $args[] = $f['id']; }
if ($f['from'] !== '') { $where[] = "created_at >= (?::date)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh'"; $args[] = $f['from']; }
if ($f['to'] !== '')   { $where[] = "created_at < ((?::date + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')"; $args[] = $f['to']; }
$sqlWhere = $where ? 'WHERE ' . implode(' AND ', $where) : '';

$st = $pdo->prepare("SELECT count(*) FROM admin_audit_log {$sqlWhere}");
$st->execute($args);
$total = (int) $st->fetchColumn();
$st = $pdo->prepare("SELECT * FROM admin_audit_log {$sqlWhere} ORDER BY created_at DESC, id DESC LIMIT {$per} OFFSET " . (($page - 1) * $per));
$st->execute($args);
$rows = $st->fetchAll(\PDO::FETCH_ASSOC);

$people = $pdo->query("SELECT DISTINCT admin_username FROM admin_audit_log ORDER BY 1")->fetchAll(\PDO::FETCH_COLUMN);
$kinds  = $pdo->query("SELECT DISTINCT split_part(action, '.', 1) FROM admin_audit_log ORDER BY 1")->fetchAll(\PDO::FETCH_COLUMN);
$types  = $pdo->query("SELECT DISTINCT entity_type FROM admin_audit_log WHERE entity_type IS NOT NULL ORDER BY 1")->fetchAll(\PDO::FETCH_COLUMN);

/** Plain words for the kinds of change (the action's first part). */
$kindLabel = fn (string $k): string => [
    'admin' => 'Sign-in', 'admin_user' => 'Admin accounts', 'daily_challenge' => 'Daily challenges', 'daily_twist' => 'Local twists',
    'daily_proof' => 'Daily photos', 'city' => 'Cities', 'place' => 'Places', 'places' => 'Places', 'scores' => 'Scores',
    'ranks' => 'Ranks', 'thumbs' => 'Thumbnails', 'email' => 'Email', 'app_settings' => 'App versions & switches',
    'daily_proposal' => 'Proposals', 'daily_special' => 'Special days', 'photo' => 'Photos', 'report' => 'Reports',
    'message' => 'Messages', 'comment' => 'Photo comments', 'ban' => 'Bans', 'page' => 'Other changes',
][$k] ?? ucfirst(str_replace('_', ' ', $k));
$actionLabel = fn (string $a): string => [
    'admin.sign_in' => 'Signed in', 'admin.sign_out' => 'Signed out', 'admin_user.create' => 'Added an admin',
    'admin_user.role' => 'Changed a role', 'admin_user.disable' => 'Disabled an admin', 'admin_user.enable' => 'Enabled an admin',
    'admin_user.2fa_on' => 'Turned 2FA on', 'admin_user.2fa_off' => 'Turned 2FA off', 'admin_user.2fa_reset' => 'Reset someone\'s 2FA',
    'admin_user.recovery_codes_new' => 'Made new recovery codes', 'admin_user.password_change' => 'Changed their password',
    'admin_user.password_reset' => 'Gave a temporary password', 'admin_user.sessions_end' => 'Signed out other sessions',
    'admin_user.recover' => 'Recovered access (Render shell)', 'scores.reset_all' => 'Reset all scores', 'ranks.recalc_all' => 'Recalculated every rank',
    'thumbs.backfill' => 'Made profile thumbnails', 'email.send_all' => 'Emailed every registered user', 'app_settings.save' => 'Saved app versions & switches',
    'city.merge' => 'Merged cities', 'city.update' => 'Edited a city',
    'photo.remove' => 'Removed a photo', 'photo.keep' => 'Kept a reported photo', 'photo.seen' => 'Marked photos checked',
    'photo.seen_all' => 'Marked every photo checked', 'report.status' => 'Changed a report\'s status', 'ban.guest' => 'Banned a guest from a report',
    'ban.add' => 'Added a ban', 'ban.lift' => 'Lifted a ban', 'message.keep' => 'Kept a reported message', 'message.remove' => 'Removed a reported message',
    'message.delete' => 'Deleted a message', 'message.erase' => 'Erased a message for good', 'comment.keep' => 'Kept a reported comment',
    'comment.remove' => 'Removed a reported comment',
][$a] ?? ucfirst(str_replace(['_', '.'], [' ', ' › '], $a));

/** What changed between before and after: [key, before, after] for the keys that differ. */
$diff = function (?string $b, ?string $a): array {
    $before = $b !== null ? (json_decode($b, true) ?? []) : [];
    $after  = $a !== null ? (json_decode($a, true) ?? []) : [];
    if (!is_array($before)) $before = ['value' => $before];
    if (!is_array($after)) $after = ['value' => $after];
    $out = [];
    foreach (array_unique(array_merge(array_keys($before), array_keys($after))) as $k) {
        $x = $before[$k] ?? null; $y = $after[$k] ?? null;
        if ($x !== $y) $out[] = [$k, $x, $y];
    }
    return $out;
};
$show = fn ($v): string => $v === null ? '–' : (is_scalar($v) ? (is_bool($v) ? ($v ? 'yes' : 'no') : (string) $v) : json_encode($v, JSON_UNESCAPED_UNICODE));
$qs = fn (array $over): string => '?' . http_build_query(array_filter($over + $f + ['page' => $page], fn ($v) => $v !== '' && $v !== null));

admin_head('Audit log');
admin_nav('/admin/audit');
?>
<div class="admin-main">
    <div class="page-head">
        <div>
            <div class="crumbs">System ›</div>
            <h1 class="page-title">Audit log</h1>
            <p class="sub">Every change made in the back office, by whom, when, and what it was before and after. Times in Saigon time.</p>
        </div>
    </div>

    <div class="card">
        <form class="toolbar" method="GET" action="/admin/audit">
            <select class="select" name="who" data-autosubmit aria-label="Person">
                <option value="">Everyone</option>
                <?php foreach ($people as $p): ?><option value="<?= $e($p) ?>"<?= $f['who'] === $p ? ' selected' : '' ?>><?= $e($p) ?></option><?php endforeach; ?>
            </select>
            <select class="select" name="kind" data-autosubmit aria-label="Kind of change">
                <option value="">Every kind of change</option>
                <?php foreach ($kinds as $k): ?><option value="<?= $e($k) ?>"<?= $f['kind'] === $k ? ' selected' : '' ?>><?= $e($kindLabel($k)) ?></option><?php endforeach; ?>
            </select>
            <select class="select" name="type" data-autosubmit aria-label="Target">
                <option value="">Any target</option>
                <?php foreach ($types as $t): ?><option value="<?= $e($t) ?>"<?= $f['type'] === $t ? ' selected' : '' ?>><?= $e(ucfirst(str_replace('_', ' ', $t))) ?></option><?php endforeach; ?>
            </select>
            <input class="input" name="id" placeholder="Target id" value="<?= $e($f['id']) ?>" style="width:150px">
            <label class="hint" for="from">From</label><input class="input" type="date" id="from" name="from" value="<?= $e($f['from']) ?>">
            <label class="hint" for="to">to</label><input class="input" type="date" id="to" name="to" value="<?= $e($f['to']) ?>">
            <button class="btn btn-sm" type="submit">Filter</button>
            <?php if (array_filter($f)): ?><a class="btn btn-sm btn-ghost" href="/admin/audit">Clear</a><?php endif; ?>
            <span class="hint" style="margin-left:auto"><?= number_format($total) ?> entr<?= $total === 1 ? 'y' : 'ies' ?></span>
        </form>
        <div class="table-wrapper"><table>
            <thead><tr><th>When</th><th>Who</th><th>What</th><th>Target</th><th>Change</th></tr></thead>
            <tbody>
            <?php foreach ($rows as $r): $changes = $diff($r['before'], $r['after']); ?>
                <tr>
                    <td style="white-space:nowrap"><?= $e(date('j M Y', strtotime((string) $r['created_at']))) ?><div class="hint"><?= $e(date('H:i:s', strtotime((string) $r['created_at']))) ?></div></td>
                    <td><a href="<?= $e($qs(['who' => $r['admin_username'], 'page' => 1])) ?>"><?= $e($r['admin_username']) ?></a><div class="hint"><?= $e($r['admin_ip']) ?></div></td>
                    <td><?= $e($actionLabel((string) $r['action'])) ?><div class="hint mono"><?= $e($r['action']) ?></div></td>
                    <td><?php if ($r['entity_type']): ?><a href="<?= $e($qs(['type' => $r['entity_type'], 'id' => (string) $r['entity_id'], 'page' => 1])) ?>"><?= $e(ucfirst(str_replace('_', ' ', (string) $r['entity_type']))) ?></a>
                        <div class="hint mono"><?= $e($r['entity_id']) ?></div><?php endif; ?></td>
                    <td style="max-width:520px">
                        <?php if ($changes === []): ?><span class="faint">–</span>
                        <?php elseif (count($changes) <= 3): ?>
                            <?php foreach ($changes as [$k, $x, $y]): ?>
                                <div style="font-size:var(--fs-xs);word-break:break-word"><b><?= $e($k) ?></b>:
                                    <?php if ($x !== null): ?><span class="muted"><?= $e(mb_strimwidth($show($x), 0, 80, '…')) ?></span> → <?php endif; ?><?= $e(mb_strimwidth($show($y), 0, 120, '…')) ?></div>
                            <?php endforeach; ?>
                        <?php else: ?>
                            <details><summary class="hint" style="cursor:pointer"><?= count($changes) ?> fields changed</summary>
                                <?php foreach ($changes as [$k, $x, $y]): ?>
                                    <div style="font-size:var(--fs-xs);word-break:break-word;margin-top:3px"><b><?= $e($k) ?></b>:
                                        <?php if ($x !== null): ?><span class="muted"><?= $e(mb_strimwidth($show($x), 0, 120, '…')) ?></span> → <?php endif; ?><?= $e(mb_strimwidth($show($y), 0, 200, '…')) ?></div>
                                <?php endforeach; ?>
                            </details>
                        <?php endif; ?>
                    </td>
                </tr>
            <?php endforeach; ?>
            <?php if ($rows === []): ?><tr><td colspan="5"><div class="empty"><b>Nothing here</b>No change matches these filters.</div></td></tr><?php endif; ?>
            </tbody>
        </table></div>
        <?php if ($total > $per): $pages = (int) ceil($total / $per); ?>
        <div class="pager" style="padding:12px 16px;margin:0">
            <?php if ($page > 1): ?><a class="btn btn-sm" href="<?= $e($qs(['page' => $page - 1])) ?>">Newer</a><?php endif; ?>
            <span>Page <?= $page ?> of <?= $pages ?></span>
            <?php if ($page < $pages): ?><a class="btn btn-sm" href="<?= $e($qs(['page' => $page + 1])) ?>">Older</a><?php endif; ?>
        </div>
        <?php endif; ?>
    </div>
</div>
<?php
admin_foot();
