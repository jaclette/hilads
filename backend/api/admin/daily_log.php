<?php

declare(strict_types=1);

// Back office audit log: who changed what (admin_audit_log). "Who" is the
// shared ADMIN_USERNAME plus the IP (AUDIT Q10), or "cli" / "auto-approve".

admin_require_login();
require_once __DIR__ . '/daily_common.php';

$type    = (string) ($_GET['type'] ?? '');
$entity  = (string) ($_GET['id'] ?? '');
$entries = DailyAdminService::listAuditLog(100, $type !== '' ? $type : null, $entity !== '' ? $entity : null);

/** Compact one-line JSON, trimmed. */
$compact = fn(?string $json): string => $json === null ? '' : mb_strimwidth((string) json_encode(json_decode($json, true), JSON_UNESCAPED_UNICODE), 0, 220, '…');

admin_head('Daily log');
admin_nav('/admin/daily');
daily_styles();
?>
<div class="admin-main">
    <h1 class="page-title">📜 Audit log</h1>
    <?php daily_subnav('/admin/daily/log'); ?>

    <form method="GET" action="/admin/daily/log" class="toolbar daily-inline" style="margin-bottom:12px">
        <select name="type">
            <option value="">All entities</option>
            <?php foreach (['daily_challenge', 'daily_twist', 'daily_proof', 'city'] as $t): ?>
                <option value="<?= $t ?>" <?= $type === $t ? 'selected' : '' ?>><?= $t ?></option>
            <?php endforeach; ?>
        </select>
        <input type="text" name="id" placeholder="entity id" value="<?= dh($entity) ?>">
        <button class="btn btn-secondary btn-sm" type="submit">Filter</button>
    </form>

    <div class="table-wrapper"><table>
        <thead><tr><th>When (Saigon)</th><th>Who</th><th>Action</th><th>Entity</th><th>Before</th><th>After</th></tr></thead>
        <tbody>
        <?php foreach ($entries as $e): ?>
            <tr>
                <td class="td-mono"><?= dh(date('j M H:i:s', strtotime($e['created_at']))) ?></td>
                <td><?= dh($e['admin_username']) ?><div class="daily-muted"><?= dh($e['admin_ip']) ?></div></td>
                <td><?= dh($e['action']) ?></td>
                <td class="td-mono"><a href="/admin/daily/log?type=<?= dh($e['entity_type']) ?>&id=<?= dh($e['entity_id']) ?>"><?= dh($e['entity_type']) ?> <?= dh($e['entity_id']) ?></a></td>
                <td class="daily-muted" style="max-width:280px;word-break:break-all"><?= dh($compact($e['before'])) ?></td>
                <td class="daily-muted" style="max-width:280px;word-break:break-all"><?= dh($compact($e['after'])) ?></td>
            </tr>
        <?php endforeach; ?>
        <?php if ($entries === []): ?><tr><td colspan="6" class="no-results">No entries.</td></tr><?php endif; ?>
        </tbody>
    </table></div>
</div>
<?php admin_foot();
