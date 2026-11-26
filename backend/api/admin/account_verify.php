<?php

declare(strict_types=1);

// Confirm it's you: a fresh 2FA code before the Danger zone (and the other game-wide actions),
// even on a trusted device. Valid for AdminAuth::REAUTH_SECONDS, then asked again.

admin_require_login();
$u = AdminAuth::user();
$to = (string) ($_SESSION['admin_after_reauth'] ?? '/admin/danger');
if (!str_starts_with($to, '/admin')) $to = '/admin/danger';
$error = null;
$useRecovery = isset($_GET['recovery']) || isset($_POST['recovery_code']);

if ($method === 'POST') {
    csrf_verify();
    $ip = AdminAuth::ip();
    if (AdminAuth::locked($ip, (string) $u['email'])) {
        $error = 'Too many failed attempts. Wait 15 minutes and try again.';
    } else {
        $viaRecovery = isset($_POST['recovery_code']);
        $code = trim((string) ($_POST['code'] ?? $_POST['recovery_code'] ?? ''));
        $ok = $viaRecovery ? AdminAuth::useRecoveryCode($u, $code) : AdminAuth::checkCode($u, $code);
        AdminAuth::attempt($ip, (string) $u['email'], $ok);
        if ($ok) {
            AdminAuth::markReauth();
            unset($_SESSION['admin_after_reauth']);
            AdminAuth::log('admin.reauth', 'admin_user', (string) $u['id'], null, ['with' => $viaRecovery ? 'recovery code' : '2FA code', 'for' => $to]);
            admin_redirect($to);
        }
        usleep(400_000);
        $error = $viaRecovery ? 'That recovery code doesn\'t match (each code works once).' : 'Wrong or expired code. Use the newest one in your app.';
    }
}

admin_head('Confirm it\'s you');
admin_nav('/admin/account');
?>
<div class="admin-main" style="max-width:560px">
    <?= ui_page_head('System', 'Confirm it\'s you', 'The Danger zone changes the whole game, so it asks for a code from your authenticator app, even on a trusted device. It stays open for ' . (AdminAuth::REAUTH_SECONDS / 60) . ' minutes.') ?>
    <?= flash_html() ?>
    <?php if ($error): ?><div class="flash flash-error"><?= ui_e($error) ?></div><?php endif; ?>
    <div class="card card-pad">
        <form method="POST" action="/admin/account/verify">
            <?= csrf_input() ?>
            <?php if ($useRecovery): ?>
                <div class="field"><label for="rc">Recovery code</label>
                    <input id="rc" name="recovery_code" autocomplete="off" spellcheck="false" placeholder="xxxx-xxxx-xxxx" autofocus required></div>
            <?php else: ?>
                <div class="field"><label for="code">Code from your app</label>
                    <input id="code" name="code" class="otp" inputmode="numeric" autocomplete="one-time-code" maxlength="7" autofocus required></div>
            <?php endif; ?>
            <div class="form-actions" style="margin-top:4px">
                <button type="submit" class="btn btn-primary">Continue</button>
                <a class="btn btn-ghost" href="/admin">Cancel</a>
                <a class="hint" style="margin-left:auto" href="/admin/account/verify<?= $useRecovery ? '' : '?recovery=1' ?>"><?= $useRecovery ? 'Use a code from the app' : 'No phone? Use a recovery code' ?></a>
            </div>
        </form>
    </div>
</div>
<?php
admin_foot();
