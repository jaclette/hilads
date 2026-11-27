<?php

declare(strict_types=1);

// Two-step verification: set it up (scan a QR code, confirm one code, save the recovery codes),
// make new recovery codes, or turn it off (not for super admins, who must keep it).
// Reached signed in (My account), or right after the password when a super admin has no 2FA yet.

$preAuth = false;
if (admin_is_logged_in()) {
    admin_require_login();
    $u = AdminAuth::user();
} else {
    $uid = (int) ($_SESSION['admin_enroll_uid'] ?? 0);
    $u = $uid > 0 && time() - (int) ($_SESSION['admin_pending_at'] ?? 0) < 900 ? AdminAuth::find($uid) : null;
    if ($u === null || $u['disabled_at'] !== null || AdminAuth::has2fa($u)) {
        unset($_SESSION['admin_enroll_uid']);
        flash_set('error', 'Sign in again.');
        admin_redirect('/admin/login');
    }
    $preAuth = true;
}

$e = fn ($s) => htmlspecialchars((string) $s, ENT_QUOTES);
$error = null;
$codes = null;           // freshly made recovery codes, shown once
$codesTitle = '';

if ($method === 'POST') {
    csrf_verify();
    $do = (string) ($_POST['do'] ?? '');
    $code = (string) ($_POST['code'] ?? '');
    if ($do === 'enable' && !AdminAuth::has2fa($u)) {
        $secret = (string) ($_SESSION['admin_enroll_secret'] ?? '');
        $step = $secret !== '' ? AdminTotp::verify($secret, $code) : null;
        if ($step === null) {
            $error = 'That code doesn\'t match. Check the time on your phone is automatic, and use the newest code.';
        } else {
            $codes = AdminAuth::enable2fa((int) $u['id'], $secret, $step);
            unset($_SESSION['admin_enroll_secret']);
            if ($preAuth) {
                AdminAuth::signIn(AdminAuth::find((int) $u['id']));
            }
            AdminAuth::markReauth();
            AdminAuth::log('admin_user.2fa_on', 'admin_user', (string) $u['id']);
            $codesTitle = 'Two-step verification is on';
            $u = AdminAuth::find((int) $u['id']);
        }
    } elseif ($do === 'regen' && AdminAuth::has2fa($u)) {
        if (AdminAuth::checkCode($u, $code)) {
            $codes = AdminAuth::newRecoveryCodes((int) $u['id']);
            AdminAuth::log('admin_user.recovery_codes_new', 'admin_user', (string) $u['id']);
            $codesTitle = 'New recovery codes';
        } else {
            $error = 'Wrong or expired code. Nothing was changed.';
        }
    } elseif ($do === 'off' && AdminAuth::has2fa($u) && !AdminAuth::needs2fa($u)) {
        if (AdminAuth::checkCode($u, $code)) {
            AdminAuth::disable2fa((int) $u['id']);
            AdminAuth::log('admin_user.2fa_off', 'admin_user', (string) $u['id']);
            flash_set('success', 'Two-step verification is off.');
            admin_redirect('/admin/account');
        }
        $error = 'Wrong or expired code. Nothing was changed.';
    }
}

if ($codes === null && !AdminAuth::has2fa($u) && empty($_SESSION['admin_enroll_secret'])) {
    $_SESSION['admin_enroll_secret'] = AdminTotp::newSecret();
}
$secret = (string) ($_SESSION['admin_enroll_secret'] ?? '');

// ── Rendering ────────────────────────────────────────────────────────────
admin_head('Two-step verification');
if ($preAuth) {
    echo '<div class="login-page"><div class="login-box wide"><div class="brand">' . admin_logo() . ' Hilads back office</div>';
} else {
    admin_nav('/admin/account');
    echo '<div class="admin-main" style="max-width:760px"><div class="crumbs"><a href="/admin/account">My account</a> ›</div>';
}

if ($codes !== null): ?>
    <h1 class="page-title"><?= $e($codesTitle) ?></h1>
    <div class="callout warn">Save these recovery codes now, they are shown only once. Each one signs you in once if you lose your phone.
        Keep them in your password manager or print them, not on the phone itself.</div>
    <div class="codes" id="codes"><?php foreach ($codes as $c) echo '<span>' . $e($c) . '</span>'; ?></div>
    <div class="form-actions" style="margin-top:0">
        <button type="button" class="btn" id="copy-codes">Copy</button>
        <button type="button" class="btn" id="dl-codes">Download as .txt</button>
    </div>
    <label class="check" style="margin-top:18px"><input type="checkbox" id="saved"> I saved them somewhere safe</label>
    <div class="form-actions"><a class="btn btn-primary" id="go" href="<?= $preAuth || isset($_SESSION['admin_uid']) ? '/admin' : '/admin/login' ?>" aria-disabled="true">Continue</a></div>
    <script>
    (function () {
        var text = 'Hilads Admin recovery codes for <?= $e($u['email']) ?> (<?= date('Y-m-d') ?>)\n'
                 + Array.prototype.map.call(document.querySelectorAll('#codes span'), function (s) { return s.textContent; }).join('\n') + '\n';
        document.getElementById('copy-codes').onclick = function () { navigator.clipboard.writeText(text).then(function () { window.adminToast && adminToast('Copied'); }); };
        document.getElementById('dl-codes').onclick = function () {
            var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
            a.download = 'hilads-admin-recovery-codes.txt'; a.click();
        };
        var go = document.getElementById('go'), box = document.getElementById('saved');
        go.addEventListener('click', function (ev) { if (!box.checked) { ev.preventDefault(); box.focus(); } });
        box.addEventListener('change', function () { go.setAttribute('aria-disabled', box.checked ? 'false' : 'true'); });
    })();
    </script>
<?php elseif (!AdminAuth::has2fa($u)): ?>
    <h1 class="page-title">Set up two-step verification</h1>
    <p class="sub" style="margin:-8px 0 18px">
        <?= AdminAuth::needs2fa($u) ? 'Required for super admins.' : 'Optional for your role, recommended.' ?>
        After your password you'll also enter a code from your phone.
    </p>
    <?php if ($error): ?><div class="flash flash-error"><?= $e($error) ?></div><?php endif; ?>
    <ol style="padding-left:18px;display:grid;gap:14px;margin-bottom:8px">
        <li>Install an authenticator app if you don't have one: Google Authenticator, Microsoft Authenticator, 1Password, Authy…</li>
        <li>In the app, add an account and scan this code:
            <div class="qr" style="margin-top:10px" id="qr" data-uri="<?= $e(AdminTotp::uri($secret, (string) $u['email'])) ?>"></div>
            <div class="hint" style="margin-top:8px">Can't scan? Enter this key by hand (time-based):<br>
                <span class="secret"><?= $e(trim(chunk_split($secret, 4, ' '))) ?></span></div>
        </li>
        <li>Enter the 6-digit code the app shows:
            <form method="POST" action="/admin/account/2fa" style="margin-top:10px;display:flex;gap:10px;align-items:flex-start;flex-wrap:wrap">
                <?= csrf_input() ?>
                <input type="hidden" name="do" value="enable">
                <div class="field" style="margin:0;width:180px"><input name="code" class="otp" inputmode="numeric" autocomplete="one-time-code" maxlength="7" required aria-label="Code"></div>
                <button class="btn btn-primary" type="submit" style="min-height:44px">Turn on</button>
            </form>
        </li>
    </ol>
    <script src="<?= admin_asset('qrcode.js') ?>"></script>
    <script>
    (function () {
        var el = document.getElementById('qr');
        var qr = qrcode(0, 'M'); qr.addData(el.dataset.uri); qr.make();
        el.innerHTML = qr.createImgTag(5, 0);
        el.querySelector('img').alt = 'QR code for your authenticator app';
    })();
    </script>
<?php else: ?>
    <h1 class="page-title">Two-step verification</h1>
    <?php if ($error): ?><div class="flash flash-error"><?= $e($error) ?></div><?php endif; ?>
    <div class="card card-pad" style="margin-bottom:16px">
        <p><span class="badge b-ok dot">On</span> since <?= $e(date('j M Y', strtotime((string) $u['totp_enabled_at']))) ?>.
           <?= AdminAuth::recoveryCodesLeft($u) ?> of 10 recovery codes left.</p>
    </div>
    <div class="card">
        <div class="section">
            <h2>New recovery codes</h2>
            <p class="hint">Makes 10 new codes; the old ones stop working. Do it when you have used some, or if they may have been seen.</p>
            <form method="POST" action="/admin/account/2fa" style="display:flex;gap:10px;flex-wrap:wrap">
                <?= csrf_input() ?><input type="hidden" name="do" value="regen">
                <input name="code" class="input otp" style="width:170px" inputmode="numeric" maxlength="7" placeholder="Code" required aria-label="Code from your app">
                <button class="btn" type="submit">Make new codes</button>
            </form>
        </div>
        <?php if (!AdminAuth::needs2fa($u)): ?>
        <div class="section">
            <h2>Turn off</h2>
            <p class="hint">You'll sign in with your password only.</p>
            <form method="POST" action="/admin/account/2fa" style="display:flex;gap:10px;flex-wrap:wrap">
                <?= csrf_input() ?><input type="hidden" name="do" value="off">
                <input name="code" class="input otp" style="width:170px" inputmode="numeric" maxlength="7" placeholder="Code" required aria-label="Code from your app">
                <button class="btn btn-danger" type="submit">Turn off 2FA</button>
            </form>
        </div>
        <?php else: ?>
        <div class="section"><p class="hint" style="margin:0">Super admins must keep 2FA on. New phone? Use “Recover access” in docs/admin-guide.md, or ask another super admin to reset your 2FA in Settings.</p></div>
        <?php endif; ?>
    </div>
<?php endif;

echo $preAuth ? '</div></div>' : '</div>';
admin_foot();
