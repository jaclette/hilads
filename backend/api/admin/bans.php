<?php

declare(strict_types=1);

admin_require_login();

$bans = [];
$err  = null;
try {
    $bans = BanRepository::listActive(500);
} catch (\Throwable $e) {
    $err = 'Could not load bans (migration run?): ' . $e->getMessage();
}

admin_head('Bans');
admin_nav('/admin/bans');
?>
<div class="admin-main">
    <h1 class="page-title">Bans <span style="color:#555;font-size:14px;font-weight:400">block by IP / guest</span></h1>
    <p style="color:#777;margin:-8px 0 16px;font-size:13px">Block a returning anonymous guest by IP or guest id. A ban stops new posts (checked on every send). Registered users are blocked via Users → Delete.</p>

    <?= flash_html() ?>
    <?php if ($err): ?><p class="badge badge-deleted" style="display:inline-block;margin-bottom:12px"><?= htmlspecialchars($err, ENT_QUOTES) ?></p><?php endif; ?>

    <!-- Add ban -->
    <form method="POST" action="/admin/bans/add" class="toolbar" style="flex-wrap:wrap;gap:8px;align-items:center">
        <?= csrf_input() ?>
        <select name="target" style="background:#1a1a1a;border:1px solid #333;color:#eee;border-radius:6px;padding:8px;font-size:13px">
            <option value="ip">IP address</option>
            <option value="guest">Guest id</option>
            <option value="guest_fanout">Guest id + their IPs</option>
        </select>
        <input type="text" name="value" placeholder="IP or guest id…" required
               style="min-width:240px;background:#1a1a1a;border:1px solid #333;color:#eee;border-radius:6px;padding:8px;font-size:13px">
        <input type="text" name="reason" placeholder="Reason (optional)"
               style="min-width:180px;background:#1a1a1a;border:1px solid #333;color:#eee;border-radius:6px;padding:8px;font-size:13px">
        <select name="days" style="background:#1a1a1a;border:1px solid #333;color:#eee;border-radius:6px;padding:8px;font-size:13px">
            <option value="0">Permanent</option>
            <option value="7" selected>7 days</option>
            <option value="30">30 days</option>
            <option value="90">90 days</option>
        </select>
        <button type="submit" class="btn btn-danger btn-sm">Block</button>
    </form>

    <div class="table-wrapper">
        <table>
            <thead>
                <tr>
                    <th style="width:90px">Type</th>
                    <th>Target</th>
                    <th>Reason</th>
                    <th style="width:80px">By</th>
                    <th style="width:150px">Created</th>
                    <th style="width:150px">Expires</th>
                    <th style="width:100px">Actions</th>
                </tr>
            </thead>
            <tbody>
            <?php if (empty($bans)): ?>
                <tr><td colspan="7" class="no-results">No active bans.</td></tr>
            <?php else: foreach ($bans as $b):
                $isIp     = !empty($b['ip_address']);
                $target   = $isIp ? $b['ip_address'] : $b['guest_id'];
                $created  = $b['created_at'] ? strtotime($b['created_at']) : 0;
                $expires  = $b['expires_at'] ? strtotime($b['expires_at']) : 0;
                ?>
                <tr>
                    <td>
                        <?php if ($isIp): ?>
                            <span class="badge" style="background:#ef444422;color:#ef4444;border:1px solid #ef444455">IP</span>
                        <?php else: ?>
                            <span class="badge badge-guest">Guest</span>
                        <?php endif; ?>
                    </td>
                    <td class="td-mono" style="color:#ddd"><?= htmlspecialchars((string) $target, ENT_QUOTES) ?></td>
                    <td style="color:#888"><?= htmlspecialchars($b['reason'] ?? '-', ENT_QUOTES) ?></td>
                    <td style="color:#666"><?= htmlspecialchars($b['created_by'] ?? '-', ENT_QUOTES) ?></td>
                    <td style="color:#666;white-space:nowrap"><?= $created ? date('M d, H:i', $created) : '-' ?></td>
                    <td style="color:#888;white-space:nowrap"><?= $expires ? date('M d, H:i', $expires) : '<span style="color:#ef4444">permanent</span>' ?></td>
                    <td>
                        <form method="POST" action="/admin/bans/<?= (int) $b['id'] ?>/unban"
                              onsubmit="return confirm('Lift this ban?')">
                            <?= csrf_input() ?>
                            <button type="submit" class="btn btn-secondary btn-sm">Unban</button>
                        </form>
                    </td>
                </tr>
            <?php endforeach; endif; ?>
            </tbody>
        </table>
    </div>
</div>
<?php
admin_foot();
