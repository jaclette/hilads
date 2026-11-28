<?php

declare(strict_types=1);

/**
 * GET /admin/ip?kind=message|ban&id=…: the full IP of one row, for abuse cases. Super admins only;
 * every view is written to the audit log. Full IPs are kept 30 days (then only the hash stays).
 */
admin_require_login();
require_once __DIR__ . '/_people.php';

if (!AdminAuth::isSuper()) {
    http_response_code(403);
    admin_head('Not allowed');
    admin_nav('/admin/arrivals');
    echo '<div class="admin-main">' . ui_empty('Super admins only', 'Full IP addresses are only shown to super admins. Other admins see the country, the approximate city and the network id.') . '</div>';
    admin_foot();
    return;
}

$kind = ($_GET['kind'] ?? '') === 'ban' ? 'ban' : 'message';
$id   = (string) ($_GET['id'] ?? '');
$pdo  = Database::pdo();
$row  = null;
if ($kind === 'message') {
    $st = $pdo->prepare("SELECT ip_address, ip_hash, country, geo_city, nickname, created_at FROM messages WHERE id = ?");
    $st->execute([$id]);
    $row = $st->fetch(PDO::FETCH_ASSOC) ?: null;
} else {
    $st = $pdo->prepare("SELECT ip_address, ip_hash, NULL AS country, NULL AS geo_city, reason AS nickname, created_at FROM bans WHERE id = ?");
    $st->execute([(int) $id]);
    $row = $st->fetch(PDO::FETCH_ASSOC) ?: null;
}
if ($row !== null) {
    AdminAuth::log('ip_viewed', $kind, $id, null, ['network' => UserSignups::networkId($row['ip_hash'] ?? null), 'had_ip' => !empty($row['ip_address'])]);
}
$back = (string) ($_SERVER['HTTP_REFERER'] ?? '/admin/arrivals');
if (!str_starts_with(parse_url($back, PHP_URL_PATH) ?: '', '/admin/')) $back = '/admin/arrivals';

admin_head('IP address');
admin_nav('/admin/arrivals');
?>
<div class="admin-main">
    <?= ui_page_head('Moderation', 'IP address', 'Shown to super admins only. This view is in the audit log.') ?>
    <div class="card" style="padding:16px;max-width:520px">
        <?php if ($row === null): ?>
            <p class="faint">Row not found.</p>
        <?php elseif (empty($row['ip_address'])): ?>
            <p>The full IP is no longer stored (kept 30 days). Network id: <span class="mono"><?= ui_e(UserSignups::networkId($row['ip_hash'] ?? null) ?? '–') ?></span></p>
        <?php else: ?>
            <p style="font-size:18px" class="mono"><?= ui_e($row['ip_address']) ?></p>
            <p class="faint" style="margin-top:8px"><?= people_where($row['country'], $row['geo_city'], $row['ip_hash']) ?></p>
        <?php endif; ?>
        <p style="margin-top:12px"><a href="<?= ui_e($back) ?>" class="btn btn-secondary btn-sm">← Back</a></p>
    </div>
</div>
<?php
admin_foot();
