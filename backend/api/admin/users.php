<?php

declare(strict_types=1);

admin_require_login();

$pdo     = Database::pdo();
$perPage = 50;
$page    = max(1, (int)($_GET['page'] ?? 1));
$offset  = ($page - 1) * $perPage;
$search  = trim($_GET['q'] ?? '');
$filter  = in_array($_GET['filter'] ?? '', ['all', 'active', 'fake', 'deleted'], true) ? (string) $_GET['filter'] : 'active';
$city    = trim($_GET['city'] ?? '');

// Per-city "new users" diagram + city drill-in range. users.created_at is an
// INTEGER epoch (not timestamptz), so bounds are epoch ints.
$today  = date('Y-m-d');
$dvalid = static fn($d): string => preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $d) ? (string) $d : '';
$from   = $dvalid($_GET['from'] ?? '') ?: $today;
$to     = $dvalid($_GET['to']   ?? '') ?: $from;
if ($to < $from) { $to = $from; }
if ((strtotime($to) - strtotime($from)) / 86400 > 92) { $to = (new DateTime($from))->modify('+92 days')->format('Y-m-d'); }
$view = (($_GET['view'] ?? '') === 'daily') ? 'daily' : 'sum';
$ds = strtotime($from . ' 00:00:00');             // epoch, inclusive
$de = strtotime($to   . ' 00:00:00') + 86400;     // epoch, to + 1 day
$rangeLabel = $from === $to ? $from : "$from → $to";
$PALETTE = ['#FF7A3C','#3b82f6','#22c55e','#a855f7','#eab308','#ec4899','#14b8a6','#f97316','#8b5cf6','#06b6d4','#ef4444','#84cc16'];

// ── Build WHERE clause ────────────────────────────────────────────────────────

$where  = [];
$params = [];

if ($search !== '') {
    $where[]       = '(u.display_name ILIKE :s1 OR u.email ILIKE :s2 OR u.id = :s3 OR u.username ILIKE :s4)';
    $params[':s1'] = '%' . $search . '%';
    $params[':s2'] = '%' . $search . '%';
    $params[':s3'] = $search;
    $params[':s4'] = ltrim($search, '@') . '%';
}

// City drill-in (from the diagram): users in this city, registered in the range.
if ($city !== '') {
    $where[]         = 'u.current_city_id = :city AND u.created_at >= :ds AND u.created_at < :de';
    $params[':city'] = $city;
    $params[':ds']   = $ds;
    $params[':de']   = $de;
}

switch ($filter) {
    case 'active':
        $where[] = 'u.deleted_at IS NULL';
        break;
    case 'fake':
        $where[] = 'u.is_fake = true';
        $where[] = 'u.deleted_at IS NULL';
        break;
    case 'deleted':
        $where[] = 'u.deleted_at IS NOT NULL';
        break;
    // 'all' - no extra filter
}

$whereClause = $where ? ('WHERE ' . implode(' AND ', $where)) : '';
$baseQuery   = "FROM users u $whereClause";

// ── Count ─────────────────────────────────────────────────────────────────────

$countStmt = $pdo->prepare("SELECT COUNT(*) $baseQuery");
$countStmt->execute($params);
$total = (int)$countStmt->fetchColumn();
$pages = (int)ceil($total / $perPage);

// ── Fetch page ────────────────────────────────────────────────────────────────

$params[':lim'] = $perPage;
$params[':off'] = $offset;

$stmt = $pdo->prepare("
    SELECT u.id, u.display_name, u.username, u.email, u.google_id, u.profile_photo_url, u.profile_thumb_photo_url,
           u.home_city, u.guest_id, u.created_at, u.is_fake, u.is_demo, u.is_review, u.deleted_at, u.vibe, u.score_alltime
    $baseQuery
    ORDER BY u.created_at DESC
    LIMIT :lim OFFSET :off
");
$stmt->execute($params);
$users = $stmt->fetchAll();

// ── Batch-load roles ──────────────────────────────────────────────────────────

$rolesByUser = [];
if (!empty($users)) {
    $ids      = array_column($users, 'id');
    $in       = implode(',', array_fill(0, count($ids), '?'));
    $roleStmt = $pdo->prepare("
        SELECT ucr.user_id, ucr.role, c.name AS city_name
        FROM user_city_roles ucr
        JOIN channels c ON c.id = ucr.city_id
        WHERE ucr.user_id IN ($in)
        ORDER BY c.name
    ");
    $roleStmt->execute($ids);
    foreach ($roleStmt->fetchAll() as $row) {
        $rolesByUser[$row['user_id']][] = $row;
    }
}

// ── Render ────────────────────────────────────────────────────────────────────

admin_head('Users');
admin_nav('/admin/users');
?>
<div class="admin-main">
    <?php
    $uq = fn (array $over) => '/admin/users?' . http_build_query(array_filter($over + ['q' => $search, 'filter' => $filter, 'city' => $city], fn ($v) => $v !== '' && $v !== 'active'));
    echo ui_page_head('Community', 'Users', number_format($total) . ' ' . (['active' => 'active accounts', 'all' => 'accounts', 'fake' => 'seeded accounts', 'deleted' => 'deleted accounts'][$filter] ?? 'accounts'),
        admin_can_edit('community') ? '<a href="/admin/users/create" class="btn btn-primary">Create an account</a>' : '');
    echo flash_html();
    ?>
    <form method="GET" action="/admin/users" class="toolbar">
        <?= ui_tabs([
            ['Active', $uq(['filter' => 'active']), null, $filter === 'active'],
            ['Seeded', $uq(['filter' => 'fake']), null, $filter === 'fake'],
            ['Deleted', $uq(['filter' => 'deleted']), null, $filter === 'deleted'],
            ['All', $uq(['filter' => 'all']), null, $filter === 'all'],
        ], 'Accounts') ?>
        <input type="hidden" name="filter" value="<?= ui_e($filter) ?>">
        <input type="search" name="q" value="<?= ui_e($search) ?>" placeholder="Name, @username, email or id">
        <button type="submit" class="btn btn-sm">Search</button>
        <?php if ($search !== '' || $filter !== 'active' || $city !== ''): ?>
            <a href="/admin/users" class="btn btn-sm btn-ghost">Clear</a>
        <?php endif; ?>
    </form>

    <?php if ($search === ''):
        // Per-city "new users" diagram (real, non-deleted registrations by
        // current_city_id). Chart-only - the user list below is the detail.
        // Click a bar/legend → the list filtered to that city + range.
        $pageBase    = '/admin/users';
        $cityParam   = 'city';
        $noun        = 'users';
        $actionLabel = 'View users';
        $chartOnly   = true;
        $sumSql = "
            SELECT u.current_city_id AS id, p.name AS name, COUNT(*) AS cnt, MAX(u.created_at) AS last_at
            FROM users u
            JOIN channels p ON p.id = u.current_city_id AND p.type = 'city'
            WHERE u.created_at >= :ds AND u.created_at < :de AND u.deleted_at IS NULL AND u.is_fake = false
            GROUP BY u.current_city_id, p.name
            ORDER BY cnt DESC, p.name ASC
        ";
        $dailySql = "
            SELECT u.current_city_id AS id, p.name AS name,
                   (to_timestamp(u.created_at) AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS day, COUNT(*) AS cnt
            FROM users u
            JOIN channels p ON p.id = u.current_city_id AND p.type = 'city'
            WHERE u.created_at >= :ds AND u.created_at < :de AND u.deleted_at IS NULL AND u.is_fake = false
            GROUP BY u.current_city_id, p.name, day
        ";
        include __DIR__ . '/_city_activity.php';
        if ($city !== '') {
            echo '<p style="color:var(--faint);font-size:13px;margin:16px 0 4px">Users in this city, registered ' . htmlspecialchars($rangeLabel, ENT_QUOTES) . ':</p>';
        }
    endif; ?>

    <div class="card">
    <div class="table-wrapper">
        <table class="data" data-sortable>
            <thead><tr><th data-sort>Player</th><th data-sort>Email</th><th>Signs in with</th><th data-sort>Home city</th><th>Roles</th><th data-sort="num">Points</th><th data-sort="num">Joined</th><th>Status</th><th></th></tr></thead>
            <tbody>
            <?php if (empty($users)): ?>
                <tr><td colspan="9"><?= ui_empty('No player found', $search !== '' ? 'Nothing matches this search.' : '') ?></td></tr>
            <?php else: foreach ($users as $u):
                $isDeleted = $u['deleted_at'] !== null;
                $thumb = $u['profile_thumb_photo_url'] ?: $u['profile_photo_url'];
                $ts = is_numeric($u['created_at']) ? (int) $u['created_at'] : strtotime((string) $u['created_at']);
                $userRoles = $rolesByUser[$u['id']] ?? []; ?>
                <tr<?= $isDeleted ? ' style="opacity:.55"' : '' ?>>
                    <td><a href="/admin/users/<?= ui_e(urlencode($u['id'])) ?>/edit" style="display:flex;gap:10px;align-items:center;color:var(--text)">
                        <?php if ($thumb): ?><img src="<?= ui_e($thumb) ?>" alt="" loading="lazy" style="width:36px;height:36px;border-radius:50%;object-fit:cover;background:var(--surface-2)" onerror="this.style.visibility='hidden'"><?php else: ?><span class="avatar" style="width:36px;height:36px"><?= ui_e(mb_strtoupper(mb_substr((string) ($u['display_name'] ?? '?'), 0, 1))) ?></span><?php endif; ?>
                        <span class="who"><b><?= ui_e($u['display_name'] ?? '–') ?></b><span><?= $u['username'] ? '@' . ui_e($u['username']) : '<span class="mono">' . ui_e($u['id']) . '</span>' ?></span></span></a></td>
                    <td class="td-clip"><?= ui_e($u['email'] ?? '') ?: '<span class="faint">–</span>' ?></td>
                    <td><?= $u['google_id'] !== null ? '<span class="badge b-info">Google</span>' : ($u['email'] !== null ? '<span class="badge b-info">Email</span>' : '<span class="badge b-warn">Guest</span>') ?></td>
                    <td><?= ui_e($u['home_city'] ?? '') ?: '<span class="faint">–</span>' ?></td>
                    <td><?php if ($userRoles === []): ?><span class="faint">–</span><?php else: foreach ($userRoles as $r): ?>
                        <span class="badge b-brand" title="<?= ui_e($r['role']) ?>">Host · <?= ui_e($r['city_name']) ?></span>
                    <?php endforeach; endif; ?></td>
                    <td class="num" data-v="<?= (int) $u['score_alltime'] ?>"><?= number_format((int) $u['score_alltime']) ?></td>
                    <td data-v="<?= (int) $ts ?>" title="<?= ui_e(ui_when($ts)) ?>" style="white-space:nowrap"><?= $ts > 0 ? ui_e(ui_ago($ts)) : '–' ?></td>
                    <td><?php
                        $tags = [];
                        if ($isDeleted) $tags[] = '<span class="badge b-bad">Deleted</span>';
                        if ($u['is_fake']) $tags[] = '<span class="badge b-violet">Seeded</span>';
                        if ($u['is_demo'] ?? false) $tags[] = '<span class="badge b-violet">Demo</span>';
                        if ($u['is_review'] ?? false) $tags[] = '<span class="badge b-mute">Store review</span>';
                        echo $tags ? implode(' ', $tags) : '<span class="badge b-ok">Active</span>'; ?></td>
                    <td><div class="row-actions" style="display:flex;gap:6px;justify-content:flex-end">
                        <?php if (!$isDeleted): ?>
                            <a href="/admin/users/<?= ui_e(urlencode($u['id'])) ?>/edit" class="btn btn-sm">Open</a>
                        <?php else: ?>
                            <span class="hint">deleted <?= ui_e(date('j M Y', strtotime((string) $u['deleted_at']))) ?></span>
                        <?php endif; ?>
                    </div></td>
                </tr>
            <?php endforeach; endif; ?>
            </tbody>
        </table>
    </div>
    <?= ui_pager($page, $perPage, $total, fn (int $p) => $uq(['page' => $p]) . '&from=' . urlencode($from) . '&to=' . urlencode($to)) ?>
    </div>
</div>
<?php
admin_foot();
