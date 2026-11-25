<?php

declare(strict_types=1);

admin_require_login();

$user = UserRepository::findById($userId);

if ($user === null) {
    flash_set('error', 'User not found.');
    admin_redirect('/admin/users');
}

// ── POST → perform the soft-delete ────────────────────────────────────────────
if ($method === 'POST') {
    csrf_verify();

    if ($user['deleted_at'] !== null) {
        flash_set('error', 'User is already deleted.');
        admin_redirect('/admin/users');
    }

    UserRepository::softDelete($userId);
    AdminAuth::log('user.delete', 'user', (string) $userId,
        ['name' => $user['display_name'] ?? null, 'username' => $user['username'] ?? null, 'email' => $user['email'] ?? null], ['deleted' => true]);

    $name = $user['display_name'] ?? $userId;
    flash_set('success', "{$name}'s account is deleted and signed out everywhere.");
    admin_redirect('/admin/users');
}

// ── GET → show the confirmation screen ────────────────────────────────────────
if ($user['deleted_at'] !== null) {
    flash_set('error', 'User is already deleted.');
    admin_redirect('/admin/users');
}

$name  = $user['display_name'] ?? $userId;
$email = $user['email'] ?? '-';

admin_head('Delete user');
admin_nav('/admin/users');
?>
<div class="admin-main">
    <?= ui_page_head('Community › Users', 'Delete ' . $name . '\'s account') ?>
    <div class="card card-pad danger-card" style="max-width:600px">
        <p style="font-size:var(--fs-md);margin-bottom:12px"><b><?= ui_e($name) ?></b> <span class="muted"><?= ui_e($email) ?></span></p>
        <ul class="affects">
            <li>The account stops working and is signed out everywhere.</li>
            <li>They can't sign back in or sign up again with this email.</li>
            <li>Their messages, photos and plans stay.</li>
            <li>Only an engineer can bring the account back.</li>
        </ul>
        <div class="form-actions">
            <form method="POST" action="/admin/users/<?= ui_e(urlencode($userId)) ?>/delete" style="margin:0"
                  data-confirm="Delete <?= ui_e($name) ?>'s account?" data-confirm-text="They are signed out at once and can't come back with this email." data-confirm-button="Delete account">
                <?= csrf_input() ?>
                <button type="submit" class="btn btn-danger-solid">Delete account</button>
            </form>
            <a href="/admin/users/<?= ui_e(urlencode($userId)) ?>/edit" class="btn">Cancel</a>
        </div>
    </div>
</div>
<?php
admin_foot();
