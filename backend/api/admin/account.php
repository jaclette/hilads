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
    } elseif ($do === 'device_revoke' || $do === 'device_revoke_all') {
        $n = AdminAuth::revokeDevices((int) $u['id'], $do === 'device_revoke' ? (int) ($_POST['device_id'] ?? 0) : null, 'revoked by its owner');
        flash_set('success', $n === 0 ? 'Nothing to revoke.' : ($n === 1 ? 'That device is no longer trusted: it will ask for a code next time.' : "{$n} devices are no longer trusted."));
        admin_redirect('/admin/account#devices');
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
                <div class="form-actions" style="margin-top:0">
                    <a class="btn" href="/admin/account/2fa">Make new recovery codes</a>
                    <a class="btn btn-ghost" href="/admin/account/2fa">Manage 2FA</a>
                </div>
            <?php else: ?>
                <p class="hint"><span class="badge b-warn dot">Off</span> &nbsp;<?= AdminAuth::needs2fa($u) ? 'Required for your role.' : 'Optional for your role, recommended.' ?></p>
                <a class="btn btn-primary" href="/admin/account/2fa">Set up 2FA</a>
            <?php endif; ?>
        </div>
        <div class="section" id="devices">
            <h2>Trusted devices</h2>
            <p class="hint">On these browsers you sign in with your email and password only, for <?= AdminAuth::TRUST_DAYS ?> days after you ticked
                "Trust this device", and you stay signed in for <?= AdminAuth::TRUSTED_IDLE_SECONDS / 86400 ?> days after your last visit.
                The code is asked again when the trust ends, when you change your password, and always before the Danger zone.</p>
            <?php $devices = []; try { $devices = AdminAuth::trustedDevices((int) $u['id']); } catch (\Throwable) {} $here = AdminAuth::currentDeviceId(); ?>
            <?php if ($devices === []): ?>
                <p class="muted" style="font-size:var(--fs-sm)">No trusted device. Tick "Trust this device" on the code screen at your next sign-in.</p>
            <?php else: ?>
            <div class="table-wrapper" style="margin-bottom:12px"><table>
                <thead><tr><th>Device</th><th>Last used</th><th>Where (approx.)</th><th>Trusted until</th><th></th></tr></thead>
                <tbody>
                <?php foreach ($devices as $d): ?>
                    <tr>
                        <td><?= $e($d['label']) ?><?= (int) $d['id'] === $here ? ' <span class="badge b-brand">This device</span>' : '' ?></td>
                        <td title="<?= $e(ui_when($d['last_used_at'])) ?>"><?= $e(ui_ago($d['last_used_at'])) ?></td>
                        <td><?= $d['country'] ? $e($d['country']) . ' · ' : '' ?><span class="mono"><?= $e(AdminAuth::maskIp($d['ip'])) ?></span></td>
                        <td><?= $e(date('j M Y', strtotime((string) $d['expires_at']))) ?></td>
                        <td><form method="POST" action="/admin/account" style="margin:0" data-confirm="Stop trusting <?= $e($d['label']) ?>?"
                                  data-confirm-text="It will ask for a code at its next sign-in<?= (int) $d['id'] === $here ? '' : ', and is signed out now' ?>." data-confirm-button="Revoke">
                            <?= csrf_input() ?><input type="hidden" name="do" value="device_revoke"><input type="hidden" name="device_id" value="<?= (int) $d['id'] ?>">
                            <button class="btn btn-sm btn-danger" type="submit">Revoke</button></form></td>
                    </tr>
                <?php endforeach; ?>
                </tbody>
            </table></div>
            <form method="POST" action="/admin/account" data-confirm="Revoke every trusted device?" data-confirm-text="Every browser asks for a code at its next sign-in; the other ones are signed out now." data-confirm-button="Revoke all">
                <?= csrf_input() ?><input type="hidden" name="do" value="device_revoke_all">
                <button class="btn" type="submit">Revoke all</button>
            </form>
            <?php endif; ?>
        </div>
        <div class="section">
            <h2>Where you're signed in</h2>
            <p class="hint">On a browser you don't trust, a session ends after <?= AdminAuth::IDLE_SECONDS / 3600 ?> h without activity and after <?= AdminAuth::ABSOLUTE_SECONDS / 3600 ?> h in any case.
                On a trusted one, <?= AdminAuth::TRUSTED_IDLE_SECONDS / 86400 ?> days after your last visit.</p>
            <?php if ($sessions !== []): ?>
            <div class="table-wrapper" style="margin-bottom:12px"><table>
                <thead><tr><th>Device</th><th>IP</th><th>Signed in</th><th>Last active</th></tr></thead>
                <tbody>
                <?php foreach ($sessions as $s): ?>
                    <tr>
                        <td><?= $e($browser((string) $s['user_agent'])) ?><?= $s['id'] === $currentKey ? ' <span class="badge b-brand">This one</span>' : '' ?></td>
                        <td class="td-mono"><?= $e(AdminAuth::maskIp($s['ip'])) ?></td>
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
