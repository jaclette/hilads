<?php

declare(strict_types=1);

// My account: password, two-step verification, where I'm signed in.

admin_require_login();
$u = AdminAuth::user();
$e = fn ($s) => htmlspecialchars((string) $s, ENT_QUOTES);
$errors = [];

if ($method === 'POST') {
    csrf_verify();
    $do = (string) ($_POST['do'] ?? '');
    if ($do === 'password') {
        $cur = (string) ($_POST['current'] ?? '');
        $pw  = (string) ($_POST['password'] ?? '');
        $pw2 = (string) ($_POST['password2'] ?? '');
        if (!AdminAuth::checkPassword($u, $cur)) $errors['current'] = 'That isn\'t your current password.';
        elseif (($p = AdminAuth::passwordProblem($pw, (string) $u['email'])) !== null) $errors['password'] = $p;
        elseif ($pw !== $pw2) $errors['password2'] = 'The two passwords are different.';
        elseif (hash_equals($cur, $pw)) $errors['password'] = 'Choose a password different from the current one.';
        if ($errors === []) {
            AdminAuth::setPassword((int) $u['id'], $pw);
            $other = AdminAuth::endSessions((int) $u['id'], true);
            AdminAuth::log('admin_user.password_change', 'admin_user', (string) $u['id'], null, ['other_sessions_ended' => $other]);
            flash_set('success', 'Password changed' . ($other > 0 ? " and {$other} other session(s) signed out." : '.'));
            admin_redirect('/admin/account');
        }
    } elseif ($do === 'sessions') {
        $n = AdminAuth::endSessions((int) $u['id'], true);
        AdminAuth::log('admin_user.sessions_end', 'admin_user', (string) $u['id'], null, ['ended' => $n]);
        flash_set('success', $n > 0 ? "Signed out of {$n} other session(s)." : 'No other session was open.');
        admin_redirect('/admin/account');
    }
}

$u = AdminAuth::find((int) $u['id']);
$sessions = [];
try {
    $st = Database::pdo()->prepare("SELECT id, ip, user_agent, created_at, last_seen_at FROM admin_sessions WHERE admin_user_id = ? ORDER BY last_seen_at DESC LIMIT 20");
    $st->execute([$u['id']]);
    $sessions = $st->fetchAll(\PDO::FETCH_ASSOC);
} catch (\Throwable) { /* table not migrated yet */ }
$currentKey = session_id() !== '' ? AdminSessionHandler::key(session_id()) : '';
$browser = function (string $ua): string {
    $b = str_contains($ua, 'Edg/') ? 'Edge' : (str_contains($ua, 'Chrome/') ? 'Chrome' : (str_contains($ua, 'Firefox/') ? 'Firefox' : (str_contains($ua, 'Safari/') ? 'Safari' : 'Browser')));
    $os = str_contains($ua, 'iPhone') ? 'iPhone' : (str_contains($ua, 'iPad') ? 'iPad' : (str_contains($ua, 'Android') ? 'Android' : (str_contains($ua, 'Mac OS') ? 'Mac' : (str_contains($ua, 'Windows') ? 'Windows' : (str_contains($ua, 'Linux') ? 'Linux' : '')))));
    return $b . ($os !== '' ? ' on ' . $os : '');
};
$err = fn ($k) => isset($errors[$k]) ? '<div class="err">' . $e($errors[$k]) . '</div>' : '';

admin_head('My account');
admin_nav('/admin/account');
?>
<div class="admin-main" style="max-width:880px">
    <div class="page-head">
        <div>
            <h1 class="page-title">My account</h1>
            <p class="sub"><?= $e($u['name']) ?> · <?= $e($u['email']) ?> · <?= $e(AdminAuth::ROLES[$u['role']] ?? $u['role']) ?></p>
        </div>
    </div>
    <?= flash_html() ?>
    <?php if ($u['must_change_password']): ?>
        <div class="callout warn" style="margin-bottom:16px">You signed in with a temporary password. Choose your own before going on.</div>
    <?php endif; ?>

    <div class="card">
        <div class="section">
            <h2>Password</h2>
            <p class="hint">Changing it signs you out everywhere else.</p>
            <form method="POST" action="/admin/account" novalidate style="max-width:520px">
                <?= csrf_input() ?><input type="hidden" name="do" value="password">
                <div class="field<?= isset($errors['current']) ? ' invalid' : '' ?>">
                    <label for="current">Current password</label>
                    <input id="current" name="current" type="password" autocomplete="current-password" required>
                    <?= $err('current') ?>
                </div>
                <div class="row2">
                    <div class="field<?= isset($errors['password']) ? ' invalid' : '' ?>">
                        <label for="password">New password</label>
                        <input id="password" name="password" type="password" autocomplete="new-password" required>
                        <div class="help">At least <?= AdminAuth::MIN_PASSWORD ?> characters.</div>
                        <?= $err('password') ?>
                    </div>
                    <div class="field<?= isset($errors['password2']) ? ' invalid' : '' ?>">
                        <label for="password2">Same again</label>
                        <input id="password2" name="password2" type="password" autocomplete="new-password" required>
                        <?= $err('password2') ?>
                    </div>
                </div>
                <button class="btn btn-primary" type="submit">Change password</button>
            </form>
        </div>
        <div class="section">
            <h2>Two-step verification</h2>
            <?php if (AdminAuth::has2fa($u)): ?>
                <p class="hint"><span class="badge b-ok dot">On</span> &nbsp;<?= AdminAuth::recoveryCodesLeft($u) ?> of 10 recovery codes left.</p>
                <a class="btn" href="/admin/account/2fa">Manage 2FA and recovery codes</a>
            <?php else: ?>
                <p class="hint"><span class="badge b-warn dot">Off</span> &nbsp;<?= AdminAuth::needs2fa($u) ? 'Required for your role.' : 'Optional for your role, recommended.' ?></p>
                <a class="btn btn-primary" href="/admin/account/2fa">Set up 2FA</a>
            <?php endif; ?>
        </div>
        <div class="section">
            <h2>Where you're signed in</h2>
            <p class="hint">Sessions end after <?= AdminAuth::IDLE_SECONDS / 3600 ?> h without activity, and after <?= AdminAuth::ABSOLUTE_SECONDS / 3600 ?> h in any case.</p>
            <?php if ($sessions !== []): ?>
            <div class="table-wrapper" style="margin-bottom:12px"><table>
                <thead><tr><th>Device</th><th>IP</th><th>Signed in</th><th>Last active</th></tr></thead>
                <tbody>
                <?php foreach ($sessions as $s): ?>
                    <tr>
                        <td><?= $e($browser((string) $s['user_agent'])) ?><?= $s['id'] === $currentKey ? ' <span class="badge b-brand">This one</span>' : '' ?></td>
                        <td class="td-mono"><?= $e($s['ip']) ?></td>
                        <td><?= $e(date('j M, H:i', strtotime((string) $s['created_at']))) ?></td>
                        <td><?= $e(date('j M, H:i', strtotime((string) $s['last_seen_at']))) ?></td>
                    </tr>
                <?php endforeach; ?>
                </tbody>
            </table></div>
            <?php endif; ?>
            <form method="POST" action="/admin/account" data-confirm="Sign out everywhere else?" data-confirm-text="Every other browser where you're signed in will have to sign in again." data-confirm-button="Sign out others">
                <?= csrf_input() ?><input type="hidden" name="do" value="sessions">
                <button class="btn" type="submit">Sign out everywhere else</button>
            </form>
        </div>
    </div>
</div>
<?php
admin_foot();
