<?php

declare(strict_types=1);

admin_require_login();

$pdo     = Database::pdo();
$perPage = 50;
$page    = max(1, (int)($_GET['page'] ?? 1));
$offset  = ($page - 1) * $perPage;
$search  = trim($_GET['q'] ?? '');
$filter  = $_GET['filter'] ?? 'all';   // all | active | expired | deleted | recurring | one-shot

// Build WHERE clauses
$where  = ['c.type = \'event\''];
$params = [];

// Search
if ($search !== '') {
    $where[]              = '(ce.title ILIKE :search OR ce.channel_id = :exact OR ce.guest_id = :exact2 OR ce.created_by = :exact3)';
    $params[':search']    = '%' . $search . '%';
    $params[':exact']     = $search;
    $params[':exact2']    = $search;
    $params[':exact3']    = $search;
}

// Status filter
switch ($filter) {
    case 'active':
        $where[] = "c.status = 'active' AND ce.expires_at > now()";
        break;
    case 'expired':
        $where[] = "c.status = 'active' AND ce.expires_at <= now()";
        break;
    case 'deleted':
        $where[] = "c.status = 'deleted'";
        break;
    case 'recurring':
        $where[] = "ce.series_id IS NOT NULL";
        break;
    case 'one-shot':
        $where[] = "ce.series_id IS NULL";
        break;
}

$whereClause = 'WHERE ' . implode(' AND ', $where);

$baseQuery = "
    FROM channel_events ce
    JOIN channels c      ON c.id = ce.channel_id
    LEFT JOIN channels p ON p.id = c.parent_id
    $whereClause
";

$countStmt = $pdo->prepare("SELECT COUNT(*) $baseQuery");
$countStmt->execute($params);
$total = (int)$countStmt->fetchColumn();
$pages = (int)ceil($total / $perPage);

$params[':lim'] = $perPage;
$params[':off'] = $offset;

$stmt = $pdo->prepare("
    SELECT
        ce.channel_id,
        ce.title,
        ce.event_type,
        ce.source_type,
        ce.series_id,
        ce.created_by,
        ce.guest_id,
        ce.starts_at,
        ce.ends_at,
        ce.expires_at,
        ce.location,
        ce.venue,
        c.status   AS channel_status,
        c.created_at AS created_at,
        p.name     AS city_name,
        p.id       AS city_id
    $baseQuery
    ORDER BY c.created_at DESC
    LIMIT :lim OFFSET :off
");
$stmt->execute($params);
$events = $stmt->fetchAll();

$now = time();

admin_head('Events');
admin_nav('/admin/events');
?>
<div class="admin-main">
    <h1 class="page-title">Events <span style="color:#555;font-size:14px;font-weight:400"><?= number_format($total) ?> total</span></h1>

    <?= flash_html() ?>

    <form method="GET" action="/admin/events" class="toolbar">
        <input type="text" name="q" value="<?= htmlspecialchars($search, ENT_QUOTES) ?>" placeholder="Search by title, event ID or creator ID…">
        <select name="filter">
            <?php
            $filters = [
                'all'      => 'All events',
                'active'   => 'Active',
                'expired'  => 'Expired',
                'deleted'  => 'Deleted',
                'recurring'=> 'Recurring',
                'one-shot' => 'One-shot',
            ];
            foreach ($filters as $val => $label):
            ?>
                <option value="<?= $val ?>" <?= $filter === $val ? 'selected' : '' ?>><?= $label ?></option>
            <?php endforeach; ?>
        </select>
        <button type="submit" class="btn btn-primary btn-sm">Filter</button>
        <?php if ($search !== '' || $filter !== 'all'): ?>
            <a href="/admin/events" class="btn btn-secondary btn-sm">Clear</a>
        <?php endif; ?>
    </form>

    <div class="table-wrapper">
        <table>
            <thead>
                <tr>
                    <th>ID</th>
                    <th>Title</th>
                    <th>City</th>
                    <th>Type</th>
                    <th>Kind</th>
                    <th>Creator</th>
                    <th>Starts at</th>
                    <th>Expires at</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody>
                <?php if (empty($events)): ?>
                    <tr><td colspan="11" class="no-results">No events found.</td></tr>
                <?php else: ?>
                    <?php foreach ($events as $ev): ?>
                        <?php
                        $startsTs  = $ev['starts_at']  ? strtotime($ev['starts_at'])  : 0;
                        $expiresTs = $ev['expires_at'] ? strtotime($ev['expires_at']) : 0;
                        $isLive    = $startsTs <= $now && $expiresTs > $now && $ev['channel_status'] === 'active';
                        $isExpired = $expiresTs > 0 && $expiresTs <= $now;
                        $isDeleted = $ev['channel_status'] === 'deleted';
                        $isRecurring = $ev['series_id'] !== null;

                        if ($isDeleted) {
                            $statusBadge = '<span class="badge badge-deleted">Deleted</span>';
                        } elseif ($isLive) {
                            $statusBadge = '<span class="badge badge-live">Live</span>';
                        } elseif ($isExpired) {
                            $statusBadge = '<span class="badge badge-expired">Expired</span>';
                        } else {
                            $statusBadge = '<span class="badge badge-active">Upcoming</span>';
                        }
                        ?>
                        <tr>
                            <td class="td-mono"><?= htmlspecialchars(substr($ev['channel_id'], 0, 10), ENT_QUOTES) ?>…</td>
                            <td class="td-clip" title="<?= htmlspecialchars($ev['title'], ENT_QUOTES) ?>">
                                <strong><?= htmlspecialchars($ev['title'], ENT_QUOTES) ?></strong>
                            </td>
                            <td style="color:#888"><?= htmlspecialchars($ev['city_name'] ?? '—', ENT_QUOTES) ?></td>
                            <td style="color:#666"><?= htmlspecialchars($ev['event_type'] ?? '—', ENT_QUOTES) ?></td>
                            <td>
                                <?php if ($isRecurring): ?>
                                    <span class="badge badge-recurring">↻ Recurring</span>
                                <?php else: ?>
                                    <span style="color:#555">One-shot</span>
                                <?php endif; ?>
                            </td>
                            <td>
                                <?php if ($ev['created_by'] !== null): ?>
                                    <span class="badge badge-registered" title="<?= htmlspecialchars($ev['created_by'], ENT_QUOTES) ?>">Reg.</span>
                                <?php elseif ($ev['guest_id'] !== null): ?>
                                    <span class="badge badge-guest" title="<?= htmlspecialchars($ev['guest_id'], ENT_QUOTES) ?>">Guest</span>
                                <?php else: ?>
                                    <span style="color:#444">—</span>
                                <?php endif; ?>
                            </td>
                            <td style="color:#888; white-space:nowrap">
                                <?= $startsTs > 0 ? date('M d, H:i', $startsTs) : '—' ?>
                            </td>
                            <td style="color:#888; white-space:nowrap">
                                <?= $expiresTs > 0 ? date('M d, H:i', $expiresTs) : '—' ?>
                            </td>
                            <td><?= $statusBadge ?></td>
                            <td style="color:#666; white-space:nowrap">
                                <?= $ev['created_at'] ? date('M d, H:i', strtotime($ev['created_at'])) : '—' ?>
                            </td>
                            <td>
                                <div class="td-actions">
                                    <a href="/admin/events/<?= urlencode($ev['channel_id']) ?>/edit" class="btn btn-secondary btn-sm">Edit</a>
                                    <?php if (!$isDeleted): ?>
                                        <form method="POST" action="/admin/events/<?= urlencode($ev['channel_id']) ?>/delete" onsubmit="return confirm('Delete event «<?= htmlspecialchars(addslashes($ev['title']), ENT_QUOTES) ?>»? This cannot be undone.')">
                                            <?= csrf_input() ?>
                                            <button type="submit" class="btn btn-danger btn-sm">Delete</button>
                                        </form>
                                    <?php else: ?>
                                        <span style="color:#444;font-size:11px">deleted</span>
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
        <div class="pagination">
            <?php if ($page > 1): ?>
                <a href="?q=<?= urlencode($search) ?>&filter=<?= urlencode($filter) ?>&page=<?= $page - 1 ?>">← Prev</a>
                <span class="sep">|</span>
            <?php endif; ?>
            <span>Page <span class="current"><?= $page ?></span> of <?= $pages ?></span>
            <?php if ($page < $pages): ?>
                <span class="sep">|</span>
                <a href="?q=<?= urlencode($search) ?>&filter=<?= urlencode($filter) ?>&page=<?= $page + 1 ?>">Next →</a>
            <?php endif; ?>
        </div>
    <?php endif; ?>
</div>
<?php
admin_foot();
