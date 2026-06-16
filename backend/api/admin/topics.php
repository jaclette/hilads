<?php

declare(strict_types=1);

admin_require_login();

$pdo     = Database::pdo();
$perPage = 50;
$page    = max(1, (int)($_GET['page'] ?? 1));
$offset  = ($page - 1) * $perPage;
$search  = trim($_GET['q'] ?? '');
$filter  = $_GET['filter'] ?? 'all';   // all | active | expired
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
$isDefault = ($search === '' && $filter === 'all' && $city === '');

// Build WHERE
$where  = ["ct.channel_id IS NOT NULL"];
$params = [];

// City drill-in (from the diagram): hangouts created in this city, in the range.
if ($city !== '') {
    $where[]         = 'ct.city_id = :city AND ct.created_at >= :ds::timestamptz AND ct.created_at < :de::timestamptz';
    $params[':city'] = $city;
    $params[':ds']   = $ds;
    $params[':de']   = $de;
}

if ($search !== '') {
    $where[]           = "(ct.title ILIKE :search OR ct.city_id = :exact OR ct.guest_id = :exact2 OR ct.created_by = :exact3)";
    $params[':search'] = '%' . $search . '%';
    $params[':exact']  = $search;
    $params[':exact2'] = $search;
    $params[':exact3'] = $search;
}

switch ($filter) {
    case 'active':
        $where[] = "ct.expires_at > now()";
        break;
    case 'expired':
        $where[] = "ct.expires_at <= now()";
        break;
}

$whereClause = 'WHERE ' . implode(' AND ', $where);

$baseQuery = "
    FROM channel_topics ct
    JOIN channels c       ON c.id = ct.channel_id
    LEFT JOIN channels p  ON p.id = ct.city_id
    LEFT JOIN (
        SELECT channel_id, COUNT(*) AS msg_count
        FROM messages
        GROUP BY channel_id
    ) m ON m.channel_id = ct.channel_id
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
        ct.channel_id,
        ct.title,
        ct.description,
        ct.category,
        ct.created_by,
        ct.guest_id,
        ct.expires_at,
        ct.created_at,
        ct.city_id,
        p.name       AS city_name,
        c.status     AS channel_status,
        COALESCE(m.msg_count, 0) AS message_count
    $baseQuery
    ORDER BY ct.created_at DESC
    LIMIT :lim OFFSET :off
");
$stmt->execute($params);
$topics = $stmt->fetchAll();

$now = time();

admin_head('Hangouts');
admin_nav('/admin/topics');
?>
<div class="admin-main">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
        <h1 class="page-title" style="margin-bottom:0">Hangouts <span style="color:#555;font-size:14px;font-weight:400"><?= number_format($total) ?> total</span></h1>
        <a href="/admin/topics/create" class="btn btn-primary btn-sm">+ Create hangout</a>
    </div>

    <?= flash_html() ?>

    <form method="GET" action="/admin/topics" class="toolbar">
        <input type="text" name="q" value="<?= htmlspecialchars($search, ENT_QUOTES) ?>" placeholder="Search by title, hangout ID or creator ID…">
        <select name="filter">
            <?php
            $filters = ['all' => 'All hangouts', 'active' => 'Active', 'expired' => 'Expired'];
            foreach ($filters as $val => $label):
            ?>
                <option value="<?= $val ?>" <?= $filter === $val ? 'selected' : '' ?>><?= $label ?></option>
            <?php endforeach; ?>
        </select>
        <button type="submit" class="btn btn-primary btn-sm">Filter</button>
        <?php if ($search !== '' || $filter !== 'all' || $city !== ''): ?>
            <a href="/admin/topics" class="btn btn-secondary btn-sm">Clear</a>
        <?php endif; ?>
    </form>

    <?php if ($isDefault):
        // Per-city "hangouts created" diagram (range + Accumulation/Per-day).
        $pageBase    = '/admin/topics';
        $cityParam   = 'city';
        $noun        = 'hangouts';
        $actionLabel = 'View hangouts';
        $sumSql = "
            SELECT ct.city_id AS id, p.name AS name, COUNT(*) AS cnt, MAX(ct.created_at) AS last_at
            FROM channel_topics ct
            JOIN channels p ON p.id = ct.city_id AND p.type = 'city'
            WHERE ct.created_at >= :ds::timestamptz AND ct.created_at < :de::timestamptz
            GROUP BY ct.city_id, p.name
            ORDER BY cnt DESC, p.name ASC
        ";
        $dailySql = "
            SELECT ct.city_id AS id, p.name AS name,
                   (ct.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS day, COUNT(*) AS cnt
            FROM channel_topics ct
            JOIN channels p ON p.id = ct.city_id AND p.type = 'city'
            WHERE ct.created_at >= :ds::timestamptz AND ct.created_at < :de::timestamptz
            GROUP BY ct.city_id, p.name, day
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
                    <th>Category</th>
                    <th>Creator</th>
                    <th>Replies</th>
                    <th>Expires at</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody>
                <?php if (empty($topics)): ?>
                    <tr><td colspan="10" class="no-results">No hangouts found.</td></tr>
                <?php else: ?>
                    <?php foreach ($topics as $t): ?>
                        <?php
                        $expiresTs = $t['expires_at'] ? strtotime($t['expires_at']) : 0;
                        $isExpired = $expiresTs > 0 && $expiresTs <= $now;
                        $isDeleted = $t['channel_status'] === 'deleted';

                        if ($isDeleted) {
                            $statusBadge = '<span class="badge badge-deleted">Deleted</span>';
                        } elseif ($isExpired) {
                            $statusBadge = '<span class="badge badge-expired">Expired</span>';
                        } else {
                            $statusBadge = '<span class="badge badge-active">Active</span>';
                        }

                        $CATEGORY_ICONS = [
                            'general' => '💬', 'tips' => '💡', 'food' => '🍴',
                            'drinks' => '🍺', 'help' => '🙋', 'meetup' => '👋',
                        ];
                        $catIcon = $CATEGORY_ICONS[$t['category']] ?? '💬';
                        ?>
                        <tr>
                            <td class="td-mono"><?= htmlspecialchars(substr($t['channel_id'], 0, 10), ENT_QUOTES) ?>…</td>
                            <td class="td-clip" title="<?= htmlspecialchars($t['title'] . ($t['description'] ? ' - ' . $t['description'] : ''), ENT_QUOTES) ?>">
                                <strong><?= htmlspecialchars($t['title'], ENT_QUOTES) ?></strong>
                                <?php if ($t['description']): ?>
                                    <br><span style="color:#555;font-size:11px"><?= htmlspecialchars(mb_substr($t['description'], 0, 60), ENT_QUOTES) ?><?= mb_strlen($t['description']) > 60 ? '…' : '' ?></span>
                                <?php endif; ?>
                            </td>
                            <td style="color:#888"><?= htmlspecialchars($t['city_name'] ?? '-', ENT_QUOTES) ?></td>
                            <td><?= $catIcon ?> <?= htmlspecialchars($t['category'], ENT_QUOTES) ?></td>
                            <td>
                                <?php if ($t['created_by'] !== null): ?>
                                    <span class="badge badge-registered" title="<?= htmlspecialchars($t['created_by'], ENT_QUOTES) ?>">Reg.</span>
                                <?php elseif ($t['guest_id'] !== null): ?>
                                    <span class="badge badge-guest" title="<?= htmlspecialchars($t['guest_id'], ENT_QUOTES) ?>">Guest</span>
                                <?php else: ?>
                                    <span style="color:#444">-</span>
                                <?php endif; ?>
                            </td>
                            <td style="color:#888"><?= (int)$t['message_count'] ?></td>
                            <td style="color:<?= $isExpired ? '#555' : '#888' ?>; white-space:nowrap">
                                <?= $expiresTs > 0 ? date('M d, H:i', $expiresTs) : '-' ?>
                            </td>
                            <td><?= $statusBadge ?></td>
                            <td style="color:#666; white-space:nowrap">
                                <?= $t['created_at'] ? date('M d, H:i', strtotime($t['created_at'])) : '-' ?>
                            </td>
                            <td>
                                <div class="td-actions">
                                    <a href="/admin/topics/<?= urlencode($t['channel_id']) ?>/edit"
                                       class="btn btn-secondary btn-sm<?= $isDeleted ? '" style="opacity:.45' : '' ?>">Edit</a>
                                    <?php if (!$isDeleted): ?>
                                        <form method="POST" action="/admin/topics/<?= urlencode($t['channel_id']) ?>/delete"
                                              onsubmit="return confirm('Delete hangout «<?= htmlspecialchars(addslashes($t['title']), ENT_QUOTES) ?>»?\n\nThis will remove the hangout and all its messages. Cannot be undone.')">
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
