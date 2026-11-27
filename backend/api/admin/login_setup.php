<?php

declare(strict_types=1);

// First run only: after the shared setup login, create the first super admin (your own account).
// Once it exists the shared login stops working; next step is the 2FA setup.

if (AdminAuth::hasAccounts()) {
    unset($_SESSION['admin_bootstrap']);
    admin_redirect('/admin/login');
}
if (time() - (int) ($_SESSION['admin_bootstrap'] ?? 0) > 1800) {
    flash_set('error', 'Sign in with the setup login first.');
    admin_redirect('/admin/login');
}

$errors = [];
$name  = trim((string) ($_POST['name'] ?? ''));
$email = trim((string) ($_POST['email'] ?? ''));

if ($method === 'POST') {
    csrf_verify();
    $pw  = (string) ($_POST['password'] ?? '');
    $pw2 = (string) ($_POST['password2'] ?? '');
    if ($name === '') $errors['name'] = 'Enter your name, it appears in the audit log.';
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) $errors['email'] = 'Enter a valid email address.';
    if (($p = AdminAuth::passwordProblem($pw, $email)) !== null) $errors['password'] = $p;
    elseif ($pw !== $pw2) $errors['password2'] = 'The two passwords are different.';
    if ($errors === []) {
        try {
            $id = AdminAuth::create($email, $name, $pw, 'super_admin');
            unset($_SESSION['admin_bootstrap']);
            session_regenerate_id(true);
            $_SESSION['admin_enroll_uid'] = $id;
            $_SESSION['admin_pending_at'] = time();
            DailyAdminService::$actor = $name;
            AdminAuth::log('admin_user.create', 'admin_user', (string) $id, null, ['email' => $email, 'name' => $name, 'role' => 'super_admin', 'first_account' => true]);
            DailyAdminService::$actor = null;
            admin_redirect('/admin/account/2fa');
        } catch (\InvalidArgumentException $e) {
            $errors['email'] = $e->getMessage();
        }
    }
}

$e = fn ($s) => htmlspecialchars((string) $s, ENT_QUOTES);
$err = fn ($k) => isset($errors[$k]) ? '<div class="err">' . $e($errors[$k]) . '</div>' : '';
admin_head('Create your account');
?>
<div class="login-page">
    <div class="login-box wide">
        <div class="brand"><?= admin_logo() ?> Hilads back office</div>
        <h1>Create your admin account</h1>
        <p class="subtitle">You'll be the first super admin. After this the shared setup login stops working, and you'll set up
            two-step verification (an authenticator app on your phone).</p>
        <form method="POST" action="/admin/login/setup" novalidate>
            <?= csrf_input() ?>
            <div class="field<?= isset($errors['name']) ? ' invalid' : '' ?>">
                <label for="name">Your name</label>
                <input id="name" name="name" value="<?= $e($name) ?>" autocomplete="name" required autofocus>
                <?= $err('name') ?>
            </div>
            <div class="field<?= isset($errors['email']) ? ' invalid' : '' ?>">
                <label for="email">Email</label>
                <input id="email" name="email" type="email" value="<?= $e($email) ?>" autocomplete="username" required>
                <div class="help">You sign in with it. No email is sent.</div>
                <?= $err('email') ?>
            </div>
            <div class="row2">
                <div class="field<?= isset($errors['password']) ? ' invalid' : '' ?>">
                    <label for="password">Password</label>
                    <input id="password" name="password" type="password" autocomplete="new-password" minlength="<?= AdminAuth::MIN_PASSWORD ?>" required>
                    <div class="help">At least <?= AdminAuth::MIN_PASSWORD ?> characters. A password manager helps.</div>
                    <?= $err('password') ?>
                </div>
                <div class="field<?= isset($errors['password2']) ? ' invalid' : '' ?>">
                    <label for="password2">Same password again</label>
                    <input id="password2" name="password2" type="password" autocomplete="new-password" required>
                    <?= $err('password2') ?>
                </div>
            </div>
            <button type="submit" class="btn btn-primary">Create my account</button>
        </form>
    </div>
</div>
<?php
admin_foot();
