<?php

declare(strict_types=1);

// System › Settings › Admins (super admins only): who can use the back office, with which role.
// New admins get a temporary password (shown once) and must choose their own at first sign-in.

admin_require_login();
$e = fn ($s) => htmlspecialchars((string) $s, ENT_QUOTES);
$me = AdminAuth::user();
$errors = [];
$tempPassword = null;
$form = ['name' => '', 'email' => '', 'role' => 'moderator'];

$activeSupers = fn (): int => (int) Database::pdo()->query("SELECT count(*) FROM admin_users WHERE role = 'super_admin' AND disabled_at IS NULL")->fetchColumn();
$snapshot = fn (array $a): array => ['email' => $a['email'], 'name' => $a['name'], 'role' => $a['role'], 'disabled' => $a['disabled_at'] !== null, '2fa' => AdminAuth::has2fa($a)];

if ($method === 'POST') {
    csrf_verify();
    $do = (string) ($_POST['do'] ?? '');
    $target = isset($_POST['id']) ? AdminAuth::find((int) $_POST['id']) : null;

    if ($do === 'add') {
        $form = ['name' => trim((string) ($_POST['name'] ?? '')), 'email' => trim((string) ($_POST['email'] ?? '')), 'role' => (string) ($_POST['role'] ?? '')];
        if ($form['name'] === '') $errors['name'] = 'Enter their name.';
        if (!filter_var($form['email'], FILTER_VALIDATE_EMAIL)) $errors['email'] = 'Enter a valid email address.';
        if (!isset(AdminAuth::ROLES[$form['role']])) $errors['role'] = 'Pick a role.';
        if ($errors === []) {
            $tempPassword = implode('-', str_split(strtolower(AdminTotp::base32Encode(random_bytes(10))), 4));
            try {
                $id = AdminAuth::create($form['email'], $form['name'], $tempPassword, $form['role'], true);
                AdminAuth::log('admin_user.create', 'admin_user', (string) $id, null, ['email' => $form['email'], 'name' => $form['name'], 'role' => $form['role']]);
            } catch (\InvalidArgumentException $ex) {
                $errors['email'] = $ex->getMessage();
                $tempPassword = null;
            }
        }
    } elseif ($target !== null) {
        $before = $snapshot($target);
        $isMe = (int) $target['id'] === (int) $me['id'];
        $lastSuper = $target['role'] === 'super_admin' && $target['disabled_at'] === null && $activeSupers() <= 1;
        if ($do === 'role') {
            $role = (string) ($_POST['role'] ?? '');
            if (!isset(AdminAuth::ROLES[$role])) {
                flash_set('error', 'Unknown role.');
            } elseif ($lastSuper && $role !== 'super_admin') {
                flash_set('error', 'There must always be one active super admin. Add another one first.');
            } else {
                Database::pdo()->prepare("UPDATE admin_users SET role = ?, updated_at = now() WHERE id = ?")->execute([$role, $target['id']]);
                AdminAuth::log('admin_user.role', 'admin_user', (string) $target['id'], $before, ['role' => $role] + $before);
                flash_set('success', $target['name'] . ' is now ' . AdminAuth::ROLES[$role] . '.'
                    . ($role === 'super_admin' && !AdminAuth::has2fa($target) ? ' They will have to set up 2FA at their next sign-in.' : ''));
            }
        } elseif ($do === 'disable') {
            if ($isMe || $lastSuper) {
                flash_set('error', $isMe ? 'You can\'t disable your own account.' : 'There must always be one active super admin.');
            } else {
                Database::pdo()->prepare("UPDATE admin_users SET disabled_at = now(), updated_at = now() WHERE id = ?")->execute([$target['id']]);
                AdminAuth::endSessions((int) $target['id']);
                AdminAuth::log('admin_user.disable', 'admin_user', (string) $target['id'], $before, ['disabled' => true] + $before);
                flash_set('success', $target['name'] . ' can no longer sign in, and was signed out.');
            }
        } elseif ($do === 'enable') {
            Database::pdo()->prepare("UPDATE admin_users SET disabled_at = NULL, updated_at = now() WHERE id = ?")->execute([$target['id']]);
            AdminAuth::log('admin_user.enable', 'admin_user', (string) $target['id'], $before, ['disabled' => false] + $before);
            flash_set('success', $target['name'] . ' can sign in again.');
        } elseif ($do === 'reset2fa' && !$isMe) {
            AdminAuth::disable2fa((int) $target['id']);
            AdminAuth::endSessions((int) $target['id']);
            AdminAuth::log('admin_user.2fa_reset', 'admin_user', (string) $target['id'], $before, ['2fa' => false] + $before);
            flash_set('success', $target['name'] . '\'s 2FA was reset. ' . ($target['role'] === 'super_admin' ? 'They set it up again at their next sign-in.' : 'They can set it up again on My account.'));
        } elseif ($do === 'resetpw' && !$isMe) {
            $tempPassword = implode('-', str_split(strtolower(AdminTotp::base32Encode(random_bytes(10))), 4));
            AdminAuth::setPassword((int) $target['id'], $tempPassword, true);
            AdminAuth::endSessions((int) $target['id']);
            AdminAuth::log('admin_user.password_reset', 'admin_user', (string) $target['id']);
            $form = ['name' => $target['name'], 'email' => $target['email'], 'role' => $target['role']];
        }
        if ($tempPassword === null) admin_redirect('/admin/settings');
    }
}

$admins = AdminAuth::all();
admin_head('Settings');
admin_nav('/admin/settings');
?>
<div class="admin-main">
    <div class="page-head">
        <div>
            <div class="crumbs">System ›</div>
            <h1 class="page-title">Settings · Admins</h1>
            <p class="sub">Who can use the back office. Everyone signs in with their own email; every change is in the <a href="/admin/audit">audit log</a> under their name.</p>
        </div>
    </div>
    <?= flash_html() ?>

    <?php if ($tempPassword !== null): ?>
        <div class="card card-pad" style="margin-bottom:16px;border-color:var(--ok)">
            <h2>Temporary password for <?= $e($form['name']) ?></h2>
            <p class="hint" style="margin:4px 0 10px">Shown only now. Send it to them privately (not in the same message as the address of this page).
                They sign in with <b><?= $e($form['email']) ?></b> and this password, then choose their own<?= $form['role'] === 'super_admin' ? ' and set up 2FA' : '' ?>.</p>
            <div class="codes" style="grid-template-columns:1fr;max-width:360px"><span><?= $e($tempPassword) ?></span></div>
        </div>
    <?php endif; ?>

    <div class="card" style="margin-bottom:20px">
        <div class="table-wrapper"><table data-sortable>
            <thead><tr><th data-sort>Name</th><th data-sort>Role</th><th>2FA</th><th data-sort>Last sign-in</th><th>Status</th><th></th></tr></thead>
            <tbody>
            <?php foreach ($admins as $a): $isMe = (int) $a['id'] === (int) $me['id']; ?>
                <tr>
                    <td><div class="who"><b><?= $e($a['name']) ?><?= $isMe ? ' <span class="badge b-brand">You</span>' : '' ?></b><span><?= $e($a['email']) ?></span></div></td>
                    <td>
                        <form method="POST" action="/admin/settings" style="display:flex;gap:6px">
                            <?= csrf_input() ?><input type="hidden" name="do" value="role"><input type="hidden" name="id" value="<?= (int) $a['id'] ?>">
                            <select class="select" name="role" data-autosubmit aria-label="Role of <?= $e($a['name']) ?>">
                                <?php foreach (AdminAuth::ROLES as $k => $label): ?>
                                    <option value="<?= $k ?>"<?= $a['role'] === $k ? ' selected' : '' ?>><?= $e($label) ?></option>
                                <?php endforeach; ?>
                            </select>
                            <noscript><button class="btn btn-sm">Save</button></noscript>
                        </form>
                    </td>
                    <td><?= AdminAuth::has2fa($a) ? '<span class="badge b-ok dot">On</span>' : ($a['role'] === 'super_admin' ? '<span class="badge b-warn dot">Not set up</span>' : '<span class="badge b-mute">Off</span>') ?></td>
                    <td data-v="<?= $e($a['last_login_at']) ?>"><?= $a['last_login_at'] ? $e(date('j M Y, H:i', strtotime((string) $a['last_login_at']))) : '<span class="faint">Never</span>' ?></td>
                    <td><?= $a['disabled_at'] ? '<span class="badge b-bad">Disabled</span>' : ($a['must_change_password'] ? '<span class="badge b-warn">Temporary password</span>' : '<span class="badge b-ok">Active</span>') ?></td>
                    <td><div class="row-actions" style="display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap">
                        <?php if (!$isMe): ?>
                            <?php if (AdminAuth::has2fa($a)): ?>
                            <form method="POST" action="/admin/settings" data-confirm="Reset <?= $e($a['name']) ?>'s 2FA?" data-confirm-text="For a lost phone. Their 2FA and recovery codes are removed and they are signed out." data-confirm-button="Reset 2FA">
                                <?= csrf_input() ?><input type="hidden" name="do" value="reset2fa"><input type="hidden" name="id" value="<?= (int) $a['id'] ?>">
                                <button class="btn btn-sm">Reset 2FA</button>
                            </form>
                            <?php endif; ?>
                            <form method="POST" action="/admin/settings" data-confirm="Give <?= $e($a['name']) ?> a temporary password?" data-confirm-text="Their current password stops working and they are signed out. You'll see the temporary one once." data-confirm-button="Reset password">
                                <?= csrf_input() ?><input type="hidden" name="do" value="resetpw"><input type="hidden" name="id" value="<?= (int) $a['id'] ?>">
                                <button class="btn btn-sm">Reset password</button>
                            </form>
                            <?php if ($a['disabled_at']): ?>
                            <form method="POST" action="/admin/settings"><?= csrf_input() ?><input type="hidden" name="do" value="enable"><input type="hidden" name="id" value="<?= (int) $a['id'] ?>"><button class="btn btn-sm">Enable</button></form>
                            <?php else: ?>
                            <form method="POST" action="/admin/settings" data-confirm="Disable <?= $e($a['name']) ?>?" data-confirm-text="They are signed out and can't sign in until enabled again. Their audit history stays." data-confirm-button="Disable">
                                <?= csrf_input() ?><input type="hidden" name="do" value="disable"><input type="hidden" name="id" value="<?= (int) $a['id'] ?>">
                                <button class="btn btn-sm btn-danger">Disable</button>
                            </form>
                            <?php endif; ?>
                        <?php endif; ?>
                    </div></td>
                </tr>
            <?php endforeach; ?>
            </tbody>
        </table></div>
    </div>

    <div class="grid cols-2-1">
        <div class="card">
            <div class="section">
                <h2>Add an admin</h2>
                <p class="hint">They get a temporary password to change at their first sign-in.</p>
                <form method="POST" action="/admin/settings" novalidate>
                    <?= csrf_input() ?><input type="hidden" name="do" value="add">
                    <div class="row2">
                        <div class="field<?= isset($errors['name']) ? ' invalid' : '' ?>">
                            <label for="n">Name</label><input id="n" name="name" value="<?= $tempPassword ? '' : $e($form['name']) ?>" required>
                            <?= isset($errors['name']) ? '<div class="err">' . $e($errors['name']) . '</div>' : '' ?>
                        </div>
                        <div class="field<?= isset($errors['email']) ? ' invalid' : '' ?>">
                            <label for="m">Email</label><input id="m" name="email" type="email" value="<?= $tempPassword ? '' : $e($form['email']) ?>" required>
                            <?= isset($errors['email']) ? '<div class="err">' . $e($errors['email']) . '</div>' : '' ?>
                        </div>
                    </div>
                    <div class="field">
                        <label for="r">Role</label>
                        <select id="r" name="role">
                            <?php foreach (AdminAuth::ROLES as $k => $label): ?>
                                <option value="<?= $k ?>"<?= ($tempPassword ? 'moderator' : $form['role']) === $k ? ' selected' : '' ?>><?= $e($label) ?></option>
                            <?php endforeach; ?>
                        </select>
                    </div>
                    <button class="btn btn-primary" type="submit">Add admin</button>
                </form>
            </div>
        </div>
        <div class="card card-pad">
            <h2 style="margin-bottom:10px">Roles</h2>
            <dl style="display:grid;gap:10px;margin:0">
                <?php foreach (AdminAuth::ROLE_HELP as $k => $help): ?>
                    <div><dt style="font-weight:700"><?= $e(AdminAuth::ROLES[$k]) ?></dt><dd class="hint" style="margin:2px 0 0"><?= $e($help) ?></dd></div>
                <?php endforeach; ?>
            </dl>
        </div>
    </div>
</div>
<?php
admin_foot();
