<?php

declare(strict_types=1);

admin_require_login();

$pdo     = Database::pdo();
$perPage = 50;
$page    = max(1, (int)($_GET['page'] ?? 1));
$offset  = ($page - 1) * $perPage;
$status  = $_GET['status'] ?? 'open';  // open | reviewed | dismissed | all

// ── Build WHERE clause ────────────────────────────────────────────────────────

$where  = [];
$params = [];

if ($status !== 'all') {
    $where[]            = 'r.status = :status';
    $params[':status']  = $status;
}

$whereClause = $where ? ('WHERE ' . implode(' AND ', $where)) : '';
$baseQuery   = "FROM user_reports r $whereClause";

// ── Count ─────────────────────────────────────────────────────────────────────

$countStmt = $pdo->prepare("SELECT COUNT(*) $baseQuery");
$countStmt->execute($params);
$total = (int)$countStmt->fetchColumn();
$pages = (int)ceil($total / $perPage);

// ── Fetch page ────────────────────────────────────────────────────────────────

$params[':lim'] = $perPage;
$params[':off'] = $offset;

$stmt = $pdo->prepare("
    SELECT r.id, r.reason, r.status, r.created_at,
           r.reporter_user_id, r.reporter_guest_id,
           r.target_user_id,   r.target_guest_id, r.target_nickname,
           ru.display_name AS reporter_name,
           tu.display_name AS target_name
    $baseQuery
    LEFT JOIN users ru ON ru.id = r.reporter_user_id
    LEFT JOIN users tu ON tu.id = r.target_user_id
    ORDER BY r.created_at DESC
    LIMIT :lim OFFSET :off
");
$stmt->execute($params);
$reports = $stmt->fetchAll();

// ── Open count badge ──────────────────────────────────────────────────────────

$openCount = (int)$pdo->query("SELECT COUNT(*) FROM user_reports WHERE status = 'open'")->fetchColumn();

// ── Render ────────────────────────────────────────────────────────────────────

admin_head('Reports');
admin_nav('/admin/reports');
?>
<div class="admin-main">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
        <h1 class="page-title" style="margin-bottom:0">
            Reports
            <span style="color:#555;font-size:14px;font-weight:400"><?= number_format($total) ?> <?= htmlspecialchars($status === 'all' ? 'total' : $status, ENT_QUOTES) ?></span>
            <?php if ($openCount > 0): ?>
                <span class="badge badge-live" style="font-size:11px;margin-left:6px"><?= $openCount ?> open</span>
            <?php endif; ?>
        </h1>
    </div>

    <?= flash_html() ?>

    <form method="GET" action="/admin/reports" class="toolbar">
        <select name="status">
            <?php
            $statuses = ['open' => 'Open', 'reviewed' => 'Reviewed', 'dismissed' => 'Dismissed', 'all' => 'All'];
            foreach ($statuses as $val => $label):
            ?>
                <option value="<?= $val ?>" <?= $status === $val ? 'selected' : '' ?>><?= $label ?></option>
            <?php endforeach; ?>
        </select>
        <button type="submit" class="btn btn-primary btn-sm">Filter</button>
        <?php if ($status !== 'open'): ?>
            <a href="/admin/reports" class="btn btn-secondary btn-sm">Clear</a>
        <?php endif; ?>
    </form>

    <div class="table-wrapper">
        <table>
            <thead>
                <tr>
                    <th>#</th>
                    <th>Reporter</th>
                    <th>Target</th>
                    <th>Reason</th>
                    <th>Status</th>
                    <th>Date</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody>
                <?php if (empty($reports)): ?>
                    <tr><td colspan="7" class="no-results">No reports found.</td></tr>
                <?php else: ?>
                    <?php foreach ($reports as $r): ?>
                        <?php
                        $reporterName = $r['reporter_name']
                            ?? ($r['reporter_guest_id'] ? 'Guest ' . substr($r['reporter_guest_id'], 0, 8) : '—');
                        $targetName = $r['target_name']
                            ?? ($r['target_nickname'] ?: ($r['target_guest_id'] ? 'Guest ' . substr($r['target_guest_id'], 0, 8) : '—'));
                        $statusClass = match($r['status']) {
                            'open'      => 'badge-live',
                            'reviewed'  => 'badge-registered',
                            'dismissed' => 'badge-deleted',
                            default     => '',
                        };
                        ?>
                        <tr>
                            <td class="td-mono"><?= (int)$r['id'] ?></td>
                            <td>
                                <?php if ($r['reporter_user_id']): ?>
                                    <a href="/admin/users/<?= urlencode($r['reporter_user_id']) ?>/edit">
                                        <?= htmlspecialchars($reporterName, ENT_QUOTES) ?>
                                    </a>
                                <?php else: ?>
                                    <span style="color:#888"><?= htmlspecialchars($reporterName, ENT_QUOTES) ?></span>
                                <?php endif; ?>
                            </td>
                            <td>
                                <?php if ($r['target_user_id']): ?>
                                    <a href="/admin/users/<?= urlencode($r['target_user_id']) ?>/edit">
                                        <?= htmlspecialchars($targetName, ENT_QUOTES) ?>
                                    </a>
                                <?php else: ?>
                                    <span style="color:#888"><?= htmlspecialchars($targetName, ENT_QUOTES) ?></span>
                                <?php endif; ?>
                            </td>
                            <td class="td-clip" style="max-width:300px" title="<?= htmlspecialchars($r['reason'], ENT_QUOTES) ?>">
                                <?= htmlspecialchars($r['reason'], ENT_QUOTES) ?>
                            </td>
                            <td>
                                <span class="badge <?= $statusClass ?>"><?= htmlspecialchars($r['status'], ENT_QUOTES) ?></span>
                            </td>
                            <td style="white-space:nowrap;color:#666">
                                <?= date('Y-m-d H:i', strtotime($r['created_at'])) ?>
                            </td>
                            <td>
                                <div class="td-actions">
                                    <?php if ($r['status'] === 'open'): ?>
                                        <form method="POST" action="/admin/reports/<?= (int)$r['id'] ?>/status">
                                            <?= csrf_input() ?>
                                            <input type="hidden" name="status" value="reviewed">
                                            <button type="submit" class="btn btn-secondary btn-sm">Mark reviewed</button>
                                        </form>
                                        <form method="POST" action="/admin/reports/<?= (int)$r['id'] ?>/status">
                                            <?= csrf_input() ?>
                                            <input type="hidden" name="status" value="dismissed">
                                            <button type="submit" class="btn btn-danger btn-sm">Dismiss</button>
                                        </form>
                                    <?php elseif ($r['status'] !== 'open'): ?>
                                        <form method="POST" action="/admin/reports/<?= (int)$r['id'] ?>/status">
                                            <?= csrf_input() ?>
                                            <input type="hidden" name="status" value="open">
                                            <button type="submit" class="btn btn-secondary btn-sm">Reopen</button>
                                        </form>
                                    <?php endif; ?>
                                </div>
                            </td>
                        </tr>
                    <?php endforeach; ?>
                <?php endif; ?>
            </tbody>
        </table>
    </div>

    <?php if ($pages > 1): ?>
        <div style="display:flex;gap:6px;margin-top:16px;align-items:center">
            <?php if ($page > 1): ?>
                <a href="?status=<?= urlencode($status) ?>&page=<?= $page - 1 ?>" class="btn btn-secondary btn-sm">← Prev</a>
            <?php endif; ?>
            <span style="color:#666;font-size:12px">Page <?= $page ?> / <?= $pages ?></span>
            <?php if ($page < $pages): ?>
                <a href="?status=<?= urlencode($status) ?>&page=<?= $page + 1 ?>" class="btn btn-secondary btn-sm">Next →</a>
            <?php endif; ?>
        </div>
    <?php endif; ?>
</div>

<?php admin_foot(); ?>
