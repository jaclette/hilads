<?php

declare(strict_types=1);

admin_require_login();

/**
 * App versions: per-platform minimum and latest versions (GET /app/config: the
 * app shows "Update required" below the minimum, "Update available" below the
 * latest; empty = the APP_MIN_VERSION / APP_LATEST_VERSION environment), and
 * "Block old apps" (the apps from before the update screen get 426, see
 * AppConfig::guardOldApp). Their accounts make the Push page's "Old app
 * versions" audience.
 */

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    csrf_verify();
    try {
        // Turning "Block old apps" on locks every old app out: it needs the phrase (checked here).
        $wasBlocking = AppConfig::blockOldApps();
        if (!$wasBlocking && !empty($_POST['block_old_apps'])
            && strtoupper(trim((string) ($_POST['confirm_phrase'] ?? ''))) !== 'BLOCK OLD APPS') {
            flash_set('error', 'Type "BLOCK OLD APPS" to turn the block on. Nothing was saved.');
            header('Location: /admin/app-versions');
            exit;
        }
        $before = AppConfig::settings();
        AppConfig::saveSettings($_POST, admin_actor());
        AppConfig::setSettings(null);
        AdminAuth::log('app_settings.save', 'app_settings', null, $before, AppConfig::settings());
        flash_set('success', 'Saved. Apps pick it up within 5 minutes.');
    } catch (\Throwable $e) {
        flash_set('error', $e->getMessage());
    }
    header('Location: /admin/app-versions');
    exit;
}

$err  = null;
$rows = [];
$seen = ['users' => 0, 'guests' => 0, 'ios' => 0, 'android' => 0, 'last' => null];
try {
    AppConfig::setSettings(null);
    $rows = Database::pdo()->query("SELECT key, value, updated_by, to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') AS at FROM app_settings")
        ->fetchAll(PDO::FETCH_ASSOC);
    $seen = Database::pdo()->query("
        SELECT count(user_id) AS users, count(guest_id) AS guests,
               count(*) FILTER (WHERE platform = 'ios') AS ios, count(*) FILTER (WHERE platform = 'android') AS android,
               to_char(max(seen_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') AS last
        FROM old_app_seen
    ")->fetch(PDO::FETCH_ASSOC);
} catch (\Throwable $e) {
    $err = 'Run php migrate.php first (' . $e->getMessage() . ').';
}
$saved = array_column($rows, 'value', 'key');
$last  = $rows === [] ? null : array_reduce($rows, fn($c, $r) => $c === null || $r['at'] > $c['at'] ? $r : $c);
$env   = ['min' => AppConfig::version('APP_MIN_VERSION'), 'latest' => AppConfig::version('APP_LATEST_VERSION')];
$h     = fn($v) => htmlspecialchars((string) $v, ENT_QUOTES);

admin_head('App versions');
admin_nav('/admin/app-versions');
?>
<div class="admin-main">
    <?= ui_page_head('System', 'App versions & switches', 'Apps from 1.8.0 read these when they open: below the <b>minimum</b> they show a blocking "Update required" screen, below the <b>latest</b> an "Update available" banner they can close. Only raise the minimum once that version is live in the stores. Other switches: <a href="/admin/scoring">scoring</a>, <a href="/admin/hi-questions">Hi questions</a>, <a href="/admin/daily/events">seasonal events</a>.') ?>

    <?= flash_html() ?>
    <?php if ($err): ?><div class="flash flash-error"><?= $h($err) ?></div><?php endif; ?>

    <form method="POST" action="/admin/app-versions" class="form-card" style="max-width:640px">
        <?= csrf_input() ?>
        <table style="width:100%;margin-bottom:18px">
            <thead><tr><th style="text-align:left"></th><th style="text-align:left">Minimum (blocking)</th><th style="text-align:left">Latest (banner)</th></tr></thead>
            <tbody>
            <?php foreach (['ios' => 'iOS', 'android' => 'Android'] as $p => $label): ?>
                <tr>
                    <td style="padding:6px 8px 6px 0;color:var(--text)"><?= $label ?></td>
                    <?php foreach (['min', 'latest'] as $kind): ?>
                        <td style="padding:6px 8px 6px 0">
                            <input type="text" name="<?= "{$p}_{$kind}_version" ?>" value="<?= $h($saved["{$p}_{$kind}_version"] ?? '') ?>"
                                   placeholder="<?= $env[$kind] !== null ? $h($env[$kind]) . ' (env)' : 'e.g. 1.8.1' ?>" style="max-width:150px">
                        </td>
                    <?php endforeach; ?>
                </tr>
            <?php endforeach; ?>
            </tbody>
        </table>
        <div class="form-group">
            <label style="font-weight:normal;text-transform:none;letter-spacing:0;font-size:14px;color:var(--text)">
                <input type="checkbox" name="block_old_apps" id="block-old" value="1" <?= ($saved['block_old_apps'] ?? '0') === '1' ? 'checked' : '' ?>>
                Block old apps (1.7.1 and older)
            </label>
            <p style="color:var(--faint);font-size:12px;margin:6px 0 0 22px">
                These versions have no update screen: every call gets "426 Update required" and the app shows "A new version of Hilads is here. Update the app…" where it shows errors (in the user's language). The web and apps from 1.8.0 are never blocked by this. Accounts and guests seen on an old app join the Push page's "Old app versions" audience. Turn it off to let them back in at once.
            </p>
        </div>
        <div class="form-group">
            <label style="font-weight:normal;text-transform:none;letter-spacing:0;font-size:14px;color:var(--text)">
                <input type="checkbox" name="dual_photo" value="1" <?= ($saved['dual_photo'] ?? '0') === '1' ? 'checked' : '' ?>>
                Dual photo (photo + selfie)
            </label>
            <p style="color:var(--faint);font-size:12px;margin:6px 0 0 22px">
                On: the Daily camera takes the photo, then a selfie (apps with the dual camera). Off: the previous camera (the system camera on iOS). Dual photos already posted show everywhere either way. Apps read it when they open the camera.
            </p>
            <label for="dual_photo_testers" style="display:block;margin:12px 0 4px 22px;font-size:13px;color:var(--muted)">Testers (on for them even when off) - user ids, one per line</label>
            <textarea id="dual_photo_testers" name="dual_photo_testers" rows="3" style="margin-left:22px;width:calc(100% - 22px);font-family:monospace;font-size:12px"
                      placeholder="dc46c6caf828962a4caf13c7c1c4680e"><?= $h($saved['dual_photo_testers'] ?? '') ?></textarea>
        </div>
        <?php if (($saved['block_old_apps'] ?? '0') !== '1'): ?>
        <div class="field" id="block-phrase" style="max-width:360px" hidden>
            <label for="cp">Type <span class="phrase">BLOCK OLD APPS</span> to turn the block on</label>
            <input id="cp" name="confirm_phrase" autocomplete="off" spellcheck="false">
        </div>
        <script>
        (function () { var c = document.getElementById('block-old'), f = document.getElementById('block-phrase');
          c.addEventListener('change', function () { f.hidden = !c.checked; }); })();
        </script>
        <?php endif; ?>
        <button type="submit" class="btn btn-primary">Save</button>
        <?php if ($last): ?><span style="color:var(--faint);font-size:12px;margin-left:10px">Last saved <?= $h($last['at']) ?> UTC by <?= $h($last['updated_by']) ?></span><?php endif; ?>
    </form>

    <div class="form-card" style="max-width:640px;margin-top:16px">
        <h3 style="margin-bottom:8px">Seen on an old app</h3>
        <p style="color:var(--muted);font-size:13px">
            <?= (int) $seen['users'] ?> account<?= (int) $seen['users'] === 1 ? '' : 's' ?> and <?= (int) $seen['guests'] ?> guest<?= (int) $seen['guests'] === 1 ? '' : 's' ?>
            (iOS <?= (int) $seen['ios'] ?>, Android <?= (int) $seen['android'] ?>)<?= $seen['last'] ? ', last ' . $h($seen['last']) . ' UTC' : '' ?>.
            <a href="/admin/push">Send them a push</a> with the "Old app versions" audience.
        </p>
    </div>
</div>
<?php admin_foot(); ?>
