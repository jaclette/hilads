<?php

declare(strict_types=1);

admin_require_login();

$pdo     = Database::pdo();
$perPage = 50;
$page    = max(1, (int)($_GET['page'] ?? 1));
$offset  = ($page - 1) * $perPage;
$search  = trim($_GET['q'] ?? '');

// Build query — created_at on users is INTEGER (unix timestamp)
if ($search !== '') {
    $like = '%' . $search . '%';
    $stmt = $pdo->prepare("
        SELECT id, display_name, email, google_id, profile_photo_url, home_city, guest_id, created_at
        FROM users
        WHERE display_name ILIKE :like1
           OR email        ILIKE :like2
           OR id           = :exact
        ORDER BY created_at DESC
        LIMIT :lim OFFSET :off
    ");
    $stmt->bindValue(':like1', $like);
    $stmt->bindValue(':like2', $like);
    $stmt->bindValue(':exact', $search);
    $stmt->bindValue(':lim',   $perPage, PDO::PARAM_INT);
    $stmt->bindValue(':off',   $offset,  PDO::PARAM_INT);
    $stmt->execute();

    $countStmt = $pdo->prepare("
        SELECT COUNT(*)
        FROM users
        WHERE display_name ILIKE :like1
           OR email        ILIKE :like2
           OR id           = :exact
    ");
    $countStmt->execute([':like1' => $like, ':like2' => $like, ':exact' => $search]);
} else {
    $stmt = $pdo->prepare("
        SELECT id, display_name, email, google_id, profile_photo_url, home_city, guest_id, created_at
        FROM users
        ORDER BY created_at DESC
        LIMIT :lim OFFSET :off
    ");
    $stmt->bindValue(':lim', $perPage, PDO::PARAM_INT);
    $stmt->bindValue(':off', $offset,  PDO::PARAM_INT);
    $stmt->execute();

    $countStmt = $pdo->query("SELECT COUNT(*) FROM users");
}

$users = $stmt->fetchAll();
$total = (int)$countStmt->fetchColumn();
$pages = (int)ceil($total / $perPage);

// Batch-load roles for users on this page
$rolesByUser = [];
if (!empty($users)) {
    $ids       = array_column($users, 'id');
    $in        = implode(',', array_fill(0, count($ids), '?'));
    $roleStmt  = $pdo->prepare("
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

admin_head('Users');
admin_nav('/admin/users');
?>
<div class="admin-main">
    <h1 class="page-title">Users <span style="color:#555;font-size:14px;font-weight:400"><?= number_format($total) ?> total</span></h1>

    <?= flash_html() ?>

    <form method="GET" action="/admin/users" class="toolbar">
        <input type="text" name="q" value="<?= htmlspecialchars($search, ENT_QUOTES) ?>" placeholder="Search by name, email or ID…">
        <button type="submit" class="btn btn-primary btn-sm">Search</button>
        <?php if ($search !== ''): ?>
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
                    <th>Photo</th>
                    <th>Home City</th>
                    <th>Roles</th>
                    <th>Guest ID</th>
                    <th>Created</th>
                    <th></th>
                </tr>
            </thead>
            <tbody>
                <?php if (empty($users)): ?>
                    <tr><td colspan="10" class="no-results">No users found.</td></tr>
                <?php else: ?>
                    <?php foreach ($users as $u): ?>
                        <tr>
                            <td class="td-mono"><?= htmlspecialchars(substr($u['id'], 0, 12), ENT_QUOTES) ?>…</td>
                            <td><strong><?= htmlspecialchars($u['display_name'] ?? '—', ENT_QUOTES) ?></strong></td>
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
                            <td>
                                <?php if (!empty($u['profile_photo_url'])): ?>
                                    <span class="badge badge-photo">Yes</span>
                                <?php else: ?>
                                    <span style="color:#444">—</span>
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
                            <td class="td-mono" style="font-size:10px"><?= $u['guest_id'] ? htmlspecialchars(substr($u['guest_id'], 0, 10), ENT_QUOTES) . '…' : '—' ?></td>
                            <td style="white-space:nowrap; color:#666">
                                <?php
                                    // created_at is INTEGER (unix timestamp) on users table
                                    $ts = is_numeric($u['created_at']) ? (int)$u['created_at'] : strtotime((string)$u['created_at']);
                                    echo $ts > 0 ? date('Y-m-d H:i', $ts) : '—';
                                ?>
                            </td>
                            <td>
                                <a href="/admin/users/<?= urlencode($u['id']) ?>/roles" class="btn btn-secondary btn-sm">Roles</a>
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
                <a href="?q=<?= urlencode($search) ?>&page=<?= $page - 1 ?>">← Prev</a>
                <span class="sep">|</span>
            <?php endif; ?>
            <span>Page <span class="current"><?= $page ?></span> of <?= $pages ?></span>
            <?php if ($page < $pages): ?>
                <span class="sep">|</span>
                <a href="?q=<?= urlencode($search) ?>&page=<?= $page + 1 ?>">Next →</a>
            <?php endif; ?>
        </div>
    <?php endif; ?>
</div>
<?php
admin_foot();
