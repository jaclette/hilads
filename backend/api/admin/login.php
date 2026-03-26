<?php

declare(strict_types=1);

// Already logged in → redirect to dashboard
if (admin_is_logged_in()) {
    admin_redirect('/admin');
}

$error = null;

if ($method === 'POST') {
    csrf_verify();

    $username = trim($_POST['username'] ?? '');
    $password = $_POST['password'] ?? '';

    $adminUser = (string)(getenv('ADMIN_USERNAME') ?: '');
    $adminPass = (string)(getenv('ADMIN_PASSWORD') ?: '');

    if ($adminUser === '' || $adminPass === '') {
        $error = 'Admin credentials are not configured. Set ADMIN_USERNAME and ADMIN_PASSWORD environment variables.';
    } elseif (
        hash_equals($adminUser, $username) &&
        hash_equals($adminPass, $password)
    ) {
        session_regenerate_id(true);
        $_SESSION['admin_logged_in'] = true;
        admin_redirect('/admin');
    } else {
        // Intentionally vague to avoid username enumeration
        $error = 'Invalid credentials.';
        error_log('[admin] failed login attempt from IP ' . ($_SERVER['REMOTE_ADDR'] ?? 'unknown'));
    }
}

admin_head('Login');
?>
<div class="login-page">
    <div class="login-box">
        <h1>Hilads Admin</h1>
        <p class="subtitle">Sign in to continue</p>

        <?php if ($error !== null): ?>
            <div class="flash flash-error"><?= htmlspecialchars($error, ENT_QUOTES) ?></div>
        <?php endif; ?>

        <form method="POST" action="/admin/login">
            <?= csrf_input() ?>
            <div class="form-group">
                <label for="username">Username</label>
                <input
                    type="text"
                    id="username"
                    name="username"
                    autocomplete="username"
                    autofocus
                    required
                    value="<?= htmlspecialchars($_POST['username'] ?? '', ENT_QUOTES) ?>"
                >
            </div>
            <div class="form-group">
                <label for="password">Password</label>
                <input
                    type="password"
                    id="password"
                    name="password"
                    autocomplete="current-password"
                    required
                >
            </div>
            <button type="submit" class="btn btn-primary">Sign in</button>
        </form>
    </div>
</div>
<?php
admin_foot();
