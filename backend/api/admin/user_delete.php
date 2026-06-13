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

    $name = $user['display_name'] ?? $userId;
    flash_set('success', "User \"{$name}\" has been deleted (soft). Sessions cleared.");
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
    <h1 class="page-title">Delete user</h1>

    <div style="max-width:560px;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:10px;padding:24px;margin-top:8px">
        <p style="font-size:16px;margin:0 0 16px">
            Delete <strong><?= htmlspecialchars($name, ENT_QUOTES) ?></strong>
            <span style="color:#777">&lt;<?= htmlspecialchars($email, ENT_QUOTES) ?>&gt;</span>?
        </p>
        <ul style="color:#aaa;font-size:13px;line-height:1.8;margin:0 0 22px 18px;padding:0">
            <li>Account is deactivated and signed out everywhere.</li>
            <li>They can't log back in or re-register with this email.</li>
            <li>Messages and events are preserved.</li>
            <li>Reversible by an engineer.</li>
        </ul>
        <div style="display:flex;gap:10px;align-items:center">
            <form method="POST" action="/admin/users/<?= urlencode($userId) ?>/delete" style="margin:0">
                <?= csrf_input() ?>
                <button type="submit" class="btn btn-danger btn-sm">Delete user</button>
            </form>
            <a href="/admin/users" class="btn btn-secondary btn-sm">Cancel</a>
        </div>
    </div>
</div>
<?php
admin_foot();
