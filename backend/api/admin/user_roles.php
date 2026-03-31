<?php

declare(strict_types=1);

admin_require_login();

$pdo = Database::pdo();

// ── Load user ─────────────────────────────────────────────────────────────────

$stmt = $pdo->prepare("SELECT id, display_name, email, google_id FROM users WHERE id = ?");
$stmt->execute([$userId]);
$user = $stmt->fetch();

if (!$user) {
    http_response_code(404);
    admin_head('User Not Found');
    admin_nav('/admin/users');
    echo '<div class="admin-main"><h1 class="page-title">User not found</h1>';
    echo '<p><a href="/admin/users" class="btn btn-secondary btn-sm">← Users</a></p></div>';
    admin_foot();
    exit;
}

// ── Handle POST actions ───────────────────────────────────────────────────────

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    csrf_verify();

    $action = $_POST['action'] ?? '';

    if ($action === 'add_role') {
        $cityId = trim($_POST['city_id'] ?? '');
        $role   = trim($_POST['role'] ?? 'ambassador');

        if ($cityId === '' || !in_array($role, ['ambassador'], true)) {
            flash_set('error', 'Invalid city or role.');
        } else {
            // Verify city exists
            $cityStmt = $pdo->prepare("SELECT id FROM channels WHERE id = ? AND type = 'city'");
            $cityStmt->execute([$cityId]);
            if (!$cityStmt->fetch()) {
                flash_set('error', 'City not found.');
            } else {
                try {
                    $id = bin2hex(random_bytes(8));
                    $pdo->prepare("
                        INSERT INTO user_city_roles (id, user_id, city_id, role)
                        VALUES (?, ?, ?, ?)
                        ON CONFLICT (user_id, city_id, role) DO NOTHING
                    ")->execute([$id, $userId, $cityId, $role]);
                    flash_set('success', 'Role added.');
                } catch (\Throwable $e) {
                    flash_set('error', 'Could not add role: ' . $e->getMessage());
                }
            }
        }

    } elseif ($action === 'remove_role') {
        $roleId = trim($_POST['role_id'] ?? '');
        if ($roleId !== '') {
            $pdo->prepare("DELETE FROM user_city_roles WHERE id = ? AND user_id = ?")->execute([$roleId, $userId]);
            flash_set('success', 'Role removed.');
        }
    }

    header('Location: /admin/users/' . urlencode($userId) . '/roles');
    exit;
}

// ── Load current roles ────────────────────────────────────────────────────────

$roles = $pdo->prepare("
    SELECT ucr.id, ucr.role, ucr.created_at,
           c.name AS city_name
    FROM user_city_roles ucr
    JOIN channels c ON c.id = ucr.city_id
    WHERE ucr.user_id = ?
    ORDER BY c.name
");
$roles->execute([$userId]);
$roles = $roles->fetchAll();

// ── Load all cities for the add-role dropdown ─────────────────────────────────

$cities = $pdo->query("SELECT id, name FROM channels WHERE type = 'city' ORDER BY name")->fetchAll();

// ── Render ────────────────────────────────────────────────────────────────────

$displayName = $user['display_name'] ?? $user['email'] ?? $user['id'];

admin_head('Roles — ' . $displayName);
admin_nav('/admin/users');
?>
<div class="admin-main">
    <div style="display:flex; align-items:center; gap:12px; margin-bottom:20px">
        <a href="/admin/users" class="btn btn-secondary btn-sm">← Users</a>
        <h1 class="page-title" style="margin-bottom:0">
            Roles — <?= htmlspecialchars($displayName, ENT_QUOTES) ?>
        </h1>
    </div>

    <?= flash_html() ?>

    <!-- ── Current roles ──────────────────────────────────────────────────── -->
    <div class="form-card" style="max-width:520px; margin-bottom:24px">
        <h3 class="info-section" style="font-size:12px; color:#555; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:14px">
            Current Roles
        </h3>

        <?php if (empty($roles)): ?>
            <p style="color:#555; font-size:13px">No roles assigned. This user is a regular member.</p>
        <?php else: ?>
            <div class="table-wrapper">
                <table>
                    <thead>
                        <tr>
                            <th>City</th>
                            <th>Role</th>
                            <th>Assigned</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
                        <?php foreach ($roles as $r): ?>
                            <tr>
                                <td><?= htmlspecialchars($r['city_name'], ENT_QUOTES) ?></td>
                                <td><span class="badge badge-ambassador">Ambassador</span></td>
                                <td style="color:#666; white-space:nowrap">
                                    <?= date('Y-m-d', strtotime($r['created_at'])) ?>
                                </td>
                                <td>
                                    <form method="POST" style="display:inline" onsubmit="return confirm('Remove this role?')">
                                        <?= csrf_input() ?>
                                        <input type="hidden" name="action"  value="remove_role">
                                        <input type="hidden" name="role_id" value="<?= htmlspecialchars($r['id'], ENT_QUOTES) ?>">
                                        <button type="submit" class="btn btn-danger btn-sm">Remove</button>
                                    </form>
                                </td>
                            </tr>
                        <?php endforeach; ?>
                    </tbody>
                </table>
            </div>
        <?php endif; ?>
    </div>

    <!-- ── Add role ───────────────────────────────────────────────────────── -->
    <div class="form-card" style="max-width:520px">
        <h3 style="font-size:12px; color:#555; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:14px">
            Add Role
        </h3>

        <form method="POST">
            <?= csrf_input() ?>
            <input type="hidden" name="action" value="add_role">

            <div class="form-group">
                <label>City</label>
                <select name="city_id" required>
                    <option value="">— select a city —</option>
                    <?php foreach ($cities as $city): ?>
                        <option value="<?= htmlspecialchars($city['id'], ENT_QUOTES) ?>">
                            <?= htmlspecialchars($city['name'], ENT_QUOTES) ?>
                        </option>
                    <?php endforeach; ?>
                </select>
            </div>

            <div class="form-group">
                <label>Role</label>
                <select name="role">
                    <option value="ambassador">Ambassador</option>
                </select>
            </div>

            <div class="form-actions">
                <button type="submit" class="btn btn-primary">Make Ambassador</button>
            </div>
        </form>
    </div>
</div>
<?php
admin_foot();
