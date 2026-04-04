<?php

declare(strict_types=1);

admin_require_login();

$pdo     = Database::pdo();
$perPage = 50;
$page    = max(1, (int)($_GET['page'] ?? 1));
$offset  = ($page - 1) * $perPage;
$search  = trim($_GET['q'] ?? '');
$filter  = $_GET['filter'] ?? 'active';  // all | active | fake | deleted

// ── Build WHERE clause ────────────────────────────────────────────────────────

$where  = [];
$params = [];

if ($search !== '') {
    $where[]       = '(u.display_name ILIKE :s1 OR u.email ILIKE :s2 OR u.id = :s3)';
    $params[':s1'] = '%' . $search . '%';
    $params[':s2'] = '%' . $search . '%';
    $params[':s3'] = $search;
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
    // 'all' — no extra filter
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
    SELECT u.id, u.display_name, u.email, u.google_id, u.profile_photo_url,
           u.home_city, u.guest_id, u.created_at, u.is_fake, u.deleted_at, u.vibe
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
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
        <h1 class="page-title" style="margin-bottom:0">Users <span style="color:#555;font-size:14px;font-weight:400"><?= number_format($total) ?> total</span></h1>
        <a href="/admin/users/create" class="btn btn-primary btn-sm">+ Create user</a>
    </div>

    <?= flash_html() ?>

    <form method="GET" action="/admin/users" class="toolbar">
        <input type="text" name="q" value="<?= htmlspecialchars($search, ENT_QUOTES) ?>" placeholder="Search by name, email or ID…">
        <select name="filter">
            <?php
            $filters = [
                'active'  => 'Active',
                'all'     => 'All users',
                'fake'    => 'Fake users',
                'deleted' => 'Deleted',
            ];
            foreach ($filters as $val => $label):
            ?>
                <option value="<?= $val ?>" <?= $filter === $val ? 'selected' : '' ?>><?= $label ?></option>
            <?php endforeach; ?>
        </select>
        <button type="submit" class="btn btn-primary btn-sm">Filter</button>
        <?php if ($search !== '' || $filter !== 'active'): ?>
            <a href="/admin/users" class="btn btn-secondary btn-sm">Clear</a>
        <?php endif; ?>
    </form>

    <div class="table-wrapper">
        <table>
            <thead>
                <tr>
                    <th>ID</th>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Auth</th>
                    <th>Home City</th>
                    <th>Roles</th>
                    <th>Created</th>
                    <th>Status</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody>
                <?php if (empty($users)): ?>
                    <tr><td colspan="9" class="no-results">No users found.</td></tr>
                <?php else: ?>
                    <?php foreach ($users as $u): ?>
                        <?php $isDeleted = $u['deleted_at'] !== null; ?>
                        <tr <?= $isDeleted ? 'style="opacity:0.5"' : '' ?>>
                            <td class="td-mono"><?= htmlspecialchars(substr($u['id'], 0, 12), ENT_QUOTES) ?>…</td>
                            <td>
                                <strong><?= htmlspecialchars($u['display_name'] ?? '—', ENT_QUOTES) ?></strong>
                                <?php if ($u['is_fake']): ?>
                                    <span class="badge badge-fake" title="Fake / seeded user">Fake</span>
                                <?php endif; ?>
                            </td>
                            <td class="td-clip"><?= htmlspecialchars($u['email'] ?? '—', ENT_QUOTES) ?></td>
                            <td>
                                <?php if ($u['google_id'] !== null): ?>
                                    <span class="badge badge-registered">Google</span>
                                <?php elseif ($u['email'] !== null): ?>
                                    <span class="badge badge-registered">Email</span>
                                <?php else: ?>
                                    <span class="badge badge-guest">Guest</span>
                                <?php endif; ?>
                            </td>
                            <td><?= htmlspecialchars($u['home_city'] ?? '—', ENT_QUOTES) ?></td>
                            <td>
                                <?php $userRoles = $rolesByUser[$u['id']] ?? []; ?>
                                <?php if (empty($userRoles)): ?>
                                    <span style="color:#444">—</span>
                                <?php else: ?>
                                    <?php foreach ($userRoles as $r): ?>
                                        <span class="badge badge-ambassador" title="<?= htmlspecialchars($r['role'], ENT_QUOTES) ?>">
                                            <?= htmlspecialchars($r['city_name'], ENT_QUOTES) ?>
                                        </span>
                                    <?php endforeach; ?>
                                <?php endif; ?>
                            </td>
                            <td style="white-space:nowrap; color:#666">
                                <?php
                                $ts = is_numeric($u['created_at']) ? (int)$u['created_at'] : strtotime((string)$u['created_at']);
                                echo $ts > 0 ? date('Y-m-d H:i', $ts) : '—';
                                ?>
                            </td>
                            <td>
                                <?php if ($isDeleted): ?>
                                    <span class="badge badge-deleted">Deleted</span>
                                <?php else: ?>
                                    <span class="badge badge-active">Active</span>
                                <?php endif; ?>
                            </td>
                            <td>
                                <div class="td-actions">
                                    <?php if (!$isDeleted): ?>
                                        <a href="/admin/users/<?= urlencode($u['id']) ?>/edit" class="btn btn-secondary btn-sm">Edit</a>
                                        <a href="/admin/users/<?= urlencode($u['id']) ?>/roles" class="btn btn-secondary btn-sm">Roles</a>
                                        <form method="POST" action="/admin/users/<?= urlencode($u['id']) ?>/delete"
                                              onsubmit="return confirm('Delete user «<?= htmlspecialchars(addslashes($u['display_name'] ?? ''), ENT_QUOTES) ?>»?\n\nThis will deactivate their account and sign them out.\nMessages and events will be preserved.\n\nThis can be reversed by an engineer.')">
                                            <?= csrf_input() ?>
                                            <button type="submit" class="btn btn-danger btn-sm">Delete</button>
                                        </form>
                                    <?php else: ?>
                                        <span style="color:#444;font-size:11px">deleted <?= date('Y-m-d', strtotime($u['deleted_at'])) ?></span>
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
