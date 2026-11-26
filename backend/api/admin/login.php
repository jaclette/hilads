<?php

declare(strict_types=1);

// Sign in, step 1: email + password. Then a 2FA code (login/code), or setting 2FA up when the
// role requires it (account/2fa). Before any account exists, the shared ADMIN_USERNAME /
// ADMIN_PASSWORD login opens the "create the first super admin" form, and nothing else.

if (admin_is_logged_in()) {
    admin_redirect('/admin');
}

$error = null;
$hasAccounts = AdminAuth::hasAccounts();
$email = trim((string) ($_POST['email'] ?? ''));

if ($method === 'POST') {
    csrf_verify();
    $password = (string) ($_POST['password'] ?? '');
    $ip = AdminAuth::ip();

    if ($hasAccounts && AdminAuth::locked($ip, $email)) {
        $error = 'Too many failed attempts. Wait 15 minutes and try again.';
    } elseif (!$hasAccounts) {
        $envUser = (string) (getenv('ADMIN_USERNAME') ?: '');
        $envPass = (string) (getenv('ADMIN_PASSWORD') ?: '');
        if ($envUser === '' || $envPass === '') {
            $error = 'No admin account exists yet and the setup login (ADMIN_USERNAME / ADMIN_PASSWORD) is not configured.';
        } elseif (hash_equals($envUser, $email) && hash_equals($envPass, $password)) {
            session_regenerate_id(true);
            $_SESSION['admin_bootstrap'] = time();
            admin_redirect('/admin/login/setup');
        } else {
            usleep(400_000);
            $error = 'Wrong username or password.';
            error_log('[admin] failed setup login from ' . $ip);
        }
    } else {
        $u = AdminAuth::findByEmail($email);
        if ($u !== null && $u['disabled_at'] === null && AdminAuth::checkPassword($u, $password)) {
            session_regenerate_id(true);
            // A device trusted in the last 30 days (secure cookie checked against its stored hash): no code.
            $device = null;
            if (AdminAuth::has2fa($u) && !$u['must_change_password']) {
                try { $device = AdminAuth::trustedDeviceFor($u); } catch (\Throwable) { $device = null; }
            }
            if ($device !== null) {
                AdminAuth::attempt($ip, $email, true);
                AdminAuth::signIn($u, (int) $device['id']);
                AdminAuth::log('admin.sign_in', 'admin_user', (string) $u['id'], null, ['with' => 'password on a trusted device', 'device' => (int) $device['id'], 'label' => $device['label']]);
                $to = (string) ($_SESSION['admin_after_login'] ?? '/admin');
                unset($_SESSION['admin_after_login']);
                admin_redirect(str_starts_with($to, '/admin') ? $to : '/admin');
            }
            if (AdminAuth::has2fa($u)) {
                $_SESSION['admin_pending_uid'] = (int) $u['id'];
                $_SESSION['admin_pending_at'] = time();
                admin_redirect('/admin/login/code');
            }
            if (AdminAuth::needs2fa($u)) {
                // Super admin without 2FA (first sign-in, or after a recovery): set it up first.
                AdminAuth::attempt($ip, $email, true);
                $_SESSION['admin_enroll_uid'] = (int) $u['id'];
                $_SESSION['admin_pending_at'] = time();
                admin_redirect('/admin/account/2fa');
            }
            AdminAuth::attempt($ip, $email, true);
            AdminAuth::signIn($u);
            AdminAuth::log('admin.sign_in', 'admin_user', (string) $u['id'], null, ['with' => 'password']);
            $to = (string) ($_SESSION['admin_after_login'] ?? '/admin');
            unset($_SESSION['admin_after_login']);
            admin_redirect(str_starts_with($to, '/admin') ? $to : '/admin');
        }
        AdminAuth::attempt($ip, $email, false);
        usleep(400_000);
        $envUser = (string) (getenv('ADMIN_USERNAME') ?: '');
        $error = $envUser !== '' && hash_equals($envUser, $email)
            ? 'The shared login is switched off now that admin accounts exist. Sign in with your own email.'
            : 'Wrong email or password.';
    }
}

admin_head('Sign in');
?>
<div class="login-page">
    <div class="login-box">
        <div class="brand"><span class="brand-mark">Hi</span> Hilads back office</div>
        <h1>Sign in</h1>
        <p class="subtitle"><?= $hasAccounts ? 'With your own admin account.' : 'First time: use the setup login, then create your own account.' ?></p>

        <?= flash_html() ?>
        <?php if ($error !== null): ?>
            <div class="flash flash-error"><?= htmlspecialchars($error, ENT_QUOTES) ?></div>
        <?php endif; ?>

        <form method="POST" action="/admin/login">
            <?= csrf_input() ?>
            <div class="field">
                <label for="email"><?= $hasAccounts ? 'Email' : 'Setup username' ?></label>
                <input type="<?= $hasAccounts ? 'email' : 'text' ?>" id="email" name="email" autocomplete="username" autofocus required
                       value="<?= htmlspecialchars($email, ENT_QUOTES) ?>">
            </div>
            <div class="field">
                <label for="password">Password</label>
                <input type="password" id="password" name="password" autocomplete="current-password" required>
            </div>
            <button type="submit" class="btn btn-primary">Continue</button>
        </form>
        <?php if ($hasAccounts): ?>
            <p class="hint" style="margin-top:16px">Lost your phone or your recovery codes? See “Recover access” in docs/admin-guide.md.</p>
        <?php endif; ?>
    </div>
</div>
<?php
admin_foot();
