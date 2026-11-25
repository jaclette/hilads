<?php
/**
 * Recover back office access when an admin lost their phone and their recovery codes
 * (or forgot their password). Run it in the Render Shell of the API service:
 *
 *   php scripts/admin_recover.php                      # list the admin accounts
 *   php scripts/admin_recover.php you@example.com      # reset that account's 2FA + set a temporary password
 *
 * The temporary password is printed once (never stored in clear). At the next sign-in the admin
 * chooses a new password and, if super admin, sets up 2FA again with new recovery codes.
 * Every other session of that admin is signed out. Written to the audit log as "cli".
 * Anyone who can open the Render Shell can do this: keep Render access to the people who
 * should be able to recover the back office.
 */

declare(strict_types=1);

$envFile = __DIR__ . '/../.env';
if (file_exists($envFile)) {
    foreach (file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        if (preg_match('/^([A-Z0-9_]+)=(.*)$/', trim($line), $m) && getenv($m[1]) === false) {
            putenv($m[1] . '=' . trim($m[2], "\"' "));
        }
    }
}
require_once __DIR__ . '/../vendor/autoload.php';
require_once __DIR__ . '/../src/Database.php';
require_once __DIR__ . '/../src/DailyAdminService.php';
require_once __DIR__ . '/../src/AdminAuth.php';

DailyAdminService::$actor = 'cli';
$email = $argv[1] ?? '';

if ($email === '') {
    $rows = AdminAuth::all();
    if ($rows === []) {
        echo "No admin account yet: sign in at /admin/login with ADMIN_USERNAME / ADMIN_PASSWORD to create the first one.\n";
        exit(0);
    }
    foreach ($rows as $r) {
        printf("%-32s %-14s 2FA %-3s %s\n", $r['email'], $r['role'], AdminAuth::has2fa($r) ? 'on' : 'off', $r['disabled_at'] ? 'DISABLED' : '');
    }
    echo "\nUsage: php scripts/admin_recover.php <email>\n";
    exit(0);
}

$u = AdminAuth::findByEmail($email);
if ($u === null) {
    fwrite(STDERR, "No admin account with that email. Run without an argument to list them.\n");
    exit(1);
}

$temp = implode('-', str_split(strtolower(AdminTotp::base32Encode(random_bytes(10))), 4));
AdminAuth::disable2fa((int) $u['id']);
AdminAuth::setPassword((int) $u['id'], $temp, true);
Database::pdo()->prepare("UPDATE admin_users SET disabled_at = NULL WHERE id = ?")->execute([$u['id']]);
$ended = AdminAuth::endSessions((int) $u['id']);
Database::pdo()->prepare("DELETE FROM admin_login_attempts WHERE lower(email) = lower(?)")->execute([$u['email']]);
AdminAuth::log('admin_user.recover', 'admin_user', (string) $u['id'], null, ['email' => $u['email'], 'sessions_ended' => $ended]);

echo "Access reset for {$u['name']} <{$u['email']}> ({$u['role']}).\n";
echo "Temporary password (shown once): {$temp}\n";
echo "Sign in at /admin/login, choose a new password" . ($u['role'] === 'super_admin' ? ', then set up 2FA again (new recovery codes).' : '.') . "\n";
