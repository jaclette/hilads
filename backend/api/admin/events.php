<?php

declare(strict_types=1);

admin_require_login();

$pdo     = Database::pdo();
$perPage = 50;
$page    = max(1, (int)($_GET['page'] ?? 1));
$offset  = ($page - 1) * $perPage;
$search  = trim($_GET['q'] ?? '');
$filter  = $_GET['filter'] ?? 'all';   // all | active | expired | deleted | recurring | one-shot
$city    = trim($_GET['city'] ?? '');

// Per-city diagram + city drill-in range (UTC+7).
$today  = date('Y-m-d');
$dvalid = static fn($d): string => preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $d) ? (string) $d : '';
$from   = $dvalid($_GET['from'] ?? '') ?: $today;
$to     = $dvalid($_GET['to']   ?? '') ?: $from;
if ($to < $from) { $to = $from; }
if ((strtotime($to) - strtotime($from)) / 86400 > 92) { $to = (new DateTime($from))->modify('+92 days')->format('Y-m-d'); }
$view = (($_GET['view'] ?? '') === 'daily') ? 'daily' : 'sum';
$ds = $from . ' 00:00:00+07:00';
$de = (new DateTime($to . ' 00:00:00', new DateTimeZone('Asia/Ho_Chi_Minh')))->modify('+1 day')->format('Y-m-d H:i:s') . '+07:00';
$rangeLabel = $from === $to ? $from : "$from → $to";
$PALETTE = ['#FF7A3C','#3b82f6','#22c55e','#a855f7','#eab308','#ec4899','#14b8a6','#f97316','#8b5cf6','#06b6d4','#ef4444','#84cc16'];
// Default view (no search/filter/city) → the per-city diagram; otherwise the list.
$isDefault = ($search === '' && $filter === 'all' && $city === '');

// Build WHERE clauses
$where  = ['c.type = \'event\''];
$params = [];

// City drill-in (from the diagram): events created in this city, in the range.
if ($city !== '') {
    $where[]         = 'c.parent_id = :city AND c.created_at >= :ds::timestamptz AND c.created_at < :de::timestamptz';
    $params[':city'] = $city;
    $params[':ds']   = $ds;
    $params[':de']   = $de;
}

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
    LEFT JOIN users u    ON u.id = ce.created_by
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
        ce.host_nickname,
        u.display_name AS creator_display_name,
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
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
        <h1 class="page-title" style="margin-bottom:0">Events <span style="color:#555;font-size:14px;font-weight:400"><?= number_format($total) ?> total</span></h1>
        <a href="/admin/events/create" class="btn btn-primary btn-sm">+ Create event</a>
    </div>

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
        <?php if ($search !== '' || $filter !== 'all' || $city !== ''): ?>
            <a href="/admin/events" class="btn btn-secondary btn-sm">Clear</a>
        <?php endif; ?>
    </form>

    <?php if ($isDefault):
        // Per-city "events created" diagram (range + Accumulation/Per-day).
        $pageBase    = '/admin/events';
        $cityParam   = 'city';
        $noun        = 'events';
        $actionLabel = 'View events';
        $sumSql = "
            SELECT c.parent_id AS id, p.name AS name, COUNT(*) AS cnt, MAX(c.created_at) AS last_at
            FROM channel_events ce
            JOIN channels c ON c.id = ce.channel_id
            JOIN channels p ON p.id = c.parent_id AND p.type = 'city'
            WHERE c.created_at >= :ds::timestamptz AND c.created_at < :de::timestamptz
            GROUP BY c.parent_id, p.name
            ORDER BY cnt DESC, p.name ASC
        ";
        $dailySql = "
            SELECT c.parent_id AS id, p.name AS name,
                   (c.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS day, COUNT(*) AS cnt
            FROM channel_events ce
            JOIN channels c ON c.id = ce.channel_id
            JOIN channels p ON p.id = c.parent_id AND p.type = 'city'
            WHERE c.created_at >= :ds::timestamptz AND c.created_at < :de::timestamptz
            GROUP BY c.parent_id, p.name, day
        ";
        include __DIR__ . '/_city_activity.php';
    else: ?>

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
                            <td style="color:#888"><?= htmlspecialchars($ev['city_name'] ?? '-', ENT_QUOTES) ?></td>
                            <td style="color:#666"><?= htmlspecialchars($ev['event_type'] ?? '-', ENT_QUOTES) ?></td>
                            <td>
                                <?php if ($isRecurring): ?>
                                    <span class="badge badge-recurring">↻ Recurring</span>
                                <?php else: ?>
                                    <span style="color:#555">One-shot</span>
                                <?php endif; ?>
                            </td>
                            <td class="td-clip">
                                <?php if ($ev['created_by'] !== null): ?>
                                    <?php $creatorName = $ev['creator_display_name'] ?: $ev['host_nickname'] ?: substr($ev['created_by'], 0, 10) . '…'; ?>
                                    <span class="badge badge-registered" title="<?= htmlspecialchars($ev['created_by'], ENT_QUOTES) ?>">Reg.</span>
                                    <span style="color:#ccc"><?= htmlspecialchars($creatorName, ENT_QUOTES) ?></span>
                                <?php elseif ($ev['guest_id'] !== null): ?>
                                    <?php $creatorName = $ev['host_nickname'] ?: substr($ev['guest_id'], 0, 10) . '…'; ?>
                                    <span class="badge badge-guest" title="<?= htmlspecialchars($ev['guest_id'], ENT_QUOTES) ?>">Guest</span>
                                    <span style="color:#888"><?= htmlspecialchars($creatorName, ENT_QUOTES) ?></span>
                                <?php else: ?>
                                    <span style="color:#444">-</span>
                                <?php endif; ?>
                            </td>
                            <td style="color:#888; white-space:nowrap">
                                <?= $startsTs > 0 ? date('M d, H:i', $startsTs) : '-' ?>
                            </td>
                            <td style="color:#888; white-space:nowrap">
                                <?= $expiresTs > 0 ? date('M d, H:i', $expiresTs) : '-' ?>
                            </td>
                            <td><?= $statusBadge ?></td>
                            <td style="color:#666; white-space:nowrap">
                                <?= $ev['created_at'] ? date('M d, H:i', strtotime($ev['created_at'])) : '-' ?>
                            </td>
                            <td>
                                <div class="td-actions">
                                    <a href="/admin/events/<?= urlencode($ev['channel_id']) ?>/edit" class="btn btn-secondary btn-sm">Edit</a>
                                    <?php if (!$isDeleted): ?>
                                        <?php if ($isRecurring): ?>
                                            <form method="POST" action="/admin/events/<?= urlencode($ev['channel_id']) ?>/delete"
                                                  onsubmit="return confirm('Delete this occurrence only?\n\n«<?= htmlspecialchars(addslashes($ev['title']), ENT_QUOTES) ?>»\n\nOther occurrences of this series will not be affected.')">
                                                <?= csrf_input() ?>
                                                <input type="hidden" name="mode" value="single">
                                                <button type="submit" class="btn btn-secondary btn-sm">Del. occurrence</button>
                                            </form>
                                            <form method="POST" action="/admin/events/<?= urlencode($ev['channel_id']) ?>/delete"
                                                  onsubmit="return confirm('DELETE ENTIRE SERIES?\n\n«<?= htmlspecialchars(addslashes($ev['title']), ENT_QUOTES) ?>»\n\nThis will delete ALL future occurrences and stop new ones from being generated.\n\nThis cannot be undone.')">
                                                <?= csrf_input() ?>
                                                <input type="hidden" name="mode" value="series">
                                                <button type="submit" class="btn btn-danger btn-sm">Del. series</button>
                                            </form>
                                        <?php else: ?>
                                            <form method="POST" action="/admin/events/<?= urlencode($ev['channel_id']) ?>/delete"
                                                  onsubmit="return confirm('Delete event «<?= htmlspecialchars(addslashes($ev['title']), ENT_QUOTES) ?>»? This cannot be undone.')">
                                                <?= csrf_input() ?>
                                                <button type="submit" class="btn btn-danger btn-sm">Delete</button>
                                            </form>
                                        <?php endif; ?>
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

    <?php if ($pages > 1):
        $pqs = 'q=' . urlencode($search) . '&filter=' . urlencode($filter) . '&city=' . urlencode($city) . '&from=' . urlencode($from) . '&to=' . urlencode($to); ?>
        <div class="pagination">
            <?php if ($page > 1): ?>
                <a href="?<?= $pqs ?>&page=<?= $page - 1 ?>">← Prev</a>
                <span class="sep">|</span>
            <?php endif; ?>
            <span>Page <span class="current"><?= $page ?></span> of <?= $pages ?></span>
            <?php if ($page < $pages): ?>
                <span class="sep">|</span>
                <a href="?<?= $pqs ?>&page=<?= $page + 1 ?>">Next →</a>
            <?php endif; ?>
        </div>
    <?php endif; ?>
    <?php endif; /* end $isDefault list branch */ ?>
</div>
<?php
admin_foot();
