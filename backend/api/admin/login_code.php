<?php

declare(strict_types=1);

// Sign in, step 2: the 6-digit code from the authenticator app, or one recovery code.

$uid = (int) ($_SESSION['admin_pending_uid'] ?? 0);
$fresh = time() - (int) ($_SESSION['admin_pending_at'] ?? 0) < 600;
$u = $uid > 0 && $fresh ? AdminAuth::find($uid) : null;
if ($u === null || $u['disabled_at'] !== null || !AdminAuth::has2fa($u)) {
    unset($_SESSION['admin_pending_uid']);
    flash_set('error', 'Sign in again.');
    admin_redirect('/admin/login');
}

$error = null;
$useRecovery = isset($_GET['recovery']) || isset($_POST['recovery_code']);

if ($method === 'POST') {
    csrf_verify();
    $ip = AdminAuth::ip();
    if (AdminAuth::locked($ip, (string) $u['email'])) {
        $error = 'Too many failed attempts. Wait 15 minutes and try again.';
    } else {
        $code = trim((string) ($_POST['code'] ?? $_POST['recovery_code'] ?? ''));
        $viaRecovery = isset($_POST['recovery_code']);
        $ok = $viaRecovery ? AdminAuth::useRecoveryCode($u, $code) : AdminAuth::checkCode($u, $code);
        AdminAuth::attempt($ip, (string) $u['email'], $ok);
        if ($ok) {
            $deviceId = null;
            if (!empty($_POST['trust_device'])) {
                try { $deviceId = AdminAuth::trustDevice((int) $u['id']); } catch (\Throwable $e) { error_log('[admin] trust device failed: ' . $e->getMessage()); }
            }
            AdminAuth::signIn($u, $deviceId);
            AdminAuth::markReauth();
            AdminAuth::log('admin.sign_in', 'admin_user', (string) $u['id'], null, ['with' => $viaRecovery ? 'recovery code' : '2FA code'] + ($deviceId ? ['trusted_device' => $deviceId] : []));
            if ($viaRecovery) {
                $left = AdminAuth::recoveryCodesLeft(AdminAuth::find((int) $u['id']));
                flash_set('error', "You used a recovery code ({$left} left). If you lost your phone, set up 2FA again and make new codes on My account.");
                admin_redirect('/admin/account');
            }
            $to = (string) ($_SESSION['admin_after_login'] ?? '/admin');
            unset($_SESSION['admin_after_login']);
            admin_redirect(str_starts_with($to, '/admin') ? $to : '/admin');
        }
        usleep(400_000);
        $error = $viaRecovery ? 'That recovery code doesn\'t match (each code works once).' : 'Wrong or expired code. Use the newest one in your app.';
    }
}

admin_head('Two-step verification');
?>
<div class="login-page">
    <div class="login-box">
        <div class="brand"><span class="brand-mark">Hi</span> Hilads back office</div>
        <h1>Two-step verification</h1>
        <p class="subtitle">
            <?= $useRecovery ? 'Enter one of the recovery codes you saved when you set up 2FA. Each one works once.'
                             : 'Open your authenticator app and enter the 6-digit code for Hilads Admin.' ?>
        </p>
        <?php if ($error !== null): ?>
            <div class="flash flash-error"><?= htmlspecialchars($error, ENT_QUOTES) ?></div>
        <?php endif; ?>
        <form method="POST" action="/admin/login/code">
            <?= csrf_input() ?>
            <?php if ($useRecovery): ?>
                <div class="field">
                    <label for="rc">Recovery code</label>
                    <input id="rc" name="recovery_code" autocomplete="off" spellcheck="false" placeholder="xxxx-xxxx-xxxx" autofocus required>
                </div>
            <?php else: ?>
                <div class="field">
                    <label for="code">Code</label>
                    <input id="code" name="code" class="otp" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]{6,7}" maxlength="7" autofocus required>
                </div>
            <?php endif; ?>
            <label class="check" style="margin:4px 0 14px"><input type="checkbox" name="trust_device" value="1">
                <span>Trust this device for <?= AdminAuth::TRUST_DAYS ?> days<br><span class="hint">Only email and password here until then. Don't tick it on a shared computer.</span></span></label>
            <button type="submit" class="btn btn-primary">Verify</button>
        </form>
        <p class="hint" style="margin-top:16px">
            <?php if ($useRecovery): ?>
                <a href="/admin/login/code">Use a code from the app instead</a>
            <?php else: ?>
                No phone? <a href="/admin/login/code?recovery=1">Use a recovery code</a>
            <?php endif; ?>
            · <a href="/admin/login">Start over</a>
        </p>
    </div>
</div>
<?php
admin_foot();
