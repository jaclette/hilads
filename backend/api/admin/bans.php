<?php

declare(strict_types=1);

// Moderation › Bans: who can't post right now. Guests are blocked by guest id and/or IP address
// (checked on every message and photo); registered players are handled in Users (delete the
// account). Adding and lifting a ban are in the audit log (a lifted ban's row is deleted).

admin_require_login();

$bans = [];
$err  = null;
try {
    $bans = BanRepository::listActive(500);
} catch (\Throwable $e) {
    $err = 'Could not load the bans: ' . $e->getMessage();
}
$canEdit = admin_can_edit('moderation');
$help = '<h3>What a ban does</h3><p>A banned guest or IP address can still open the app but can\'t send messages or photos. It is checked on every send.</p>'
      . '<h3>Which kind</h3><ul><li><b>Guest + their IPs</b> (usual): the guest id and every IP address their recent messages came from.</li>'
      . '<li><b>Guest only</b>: just that guest id; a new install gets a new one.</li>'
      . '<li><b>IP address</b>: everyone behind that address (a café or office Wi-Fi too), so prefer short bans.</li></ul>'
      . '<h3>Registered players</h3><p>Open them in Users: delete the account if they break the rules.</p>'
      . '<h3>From a report</h3><p>Reports › Players has a "Ban 7 days" button for reported guests.</p>';

admin_head('Bans');
admin_nav('/admin/bans');
echo '<div class="admin-main">';
echo ui_page_head('Moderation', 'Bans', 'Guests and IP addresses that can\'t post right now. Registered players are handled in <a href="/admin/users">Users</a>.',
    ui_help('How bans work', $help));
echo flash_html();
if ($err) echo '<div class="flash flash-error">' . ui_e($err) . '</div>';
?>
<div class="grid cols-2-1" style="align-items:start">
<div class="card">
    <div class="card-head"><h2>Active bans</h2><span class="hint"><?= count($bans) ?></span></div>
    <?php if ($bans === []): ?>
        <?= ui_empty('Nobody is banned', 'Bans you add appear here until they expire.') ?>
    <?php else: ?>
    <div class="table-wrapper"><table class="data" data-sortable>
        <thead><tr><th data-sort>Who</th><th>Why</th><th data-sort>By</th><th data-sort>Since</th><th data-sort>Until</th><th></th></tr></thead>
        <tbody>
        <?php foreach ($bans as $b):
            $isIp = !empty($b['ip_address']);
            $expires = $b['expires_at'] ? strtotime((string) $b['expires_at']) : 0; ?>
            <tr>
                <td><span class="badge <?= $isIp ? 'b-bad' : 'b-warn' ?>"><?= $isIp ? 'IP address' : 'Guest' ?></span>
                    <div class="mono" style="margin-top:3px"><?= ui_e($isIp ? $b['ip_address'] : $b['guest_id']) ?></div></td>
                <td style="max-width:260px"><?= ui_e($b['reason'] ?? '') ?: '<span class="faint">–</span>' ?></td>
                <td class="muted"><?= ui_e($b['created_by'] ?? '–') ?></td>
                <td title="<?= ui_e(ui_when($b['created_at'])) ?>" data-v="<?= ui_e($b['created_at']) ?>" style="white-space:nowrap"><?= ui_e(ui_ago($b['created_at'])) ?></td>
                <td data-v="<?= $expires ?: '9999999999' ?>" style="white-space:nowrap"><?= $expires ? ui_e(date('j M, H:i', $expires)) : '<span class="badge b-bad">Permanent</span>' ?></td>
                <td><?php if ($canEdit): ?>
                    <form method="POST" action="/admin/bans/<?= (int) $b['id'] ?>/unban" style="margin:0"
                          data-confirm="Lift this ban?" data-confirm-text="They can post again at once." data-confirm-button="Lift ban" data-danger="0">
                        <?= csrf_input() ?><button type="submit" class="btn btn-sm">Lift</button>
                    </form>
                <?php endif; ?></td>
            </tr>
        <?php endforeach; ?>
        </tbody>
    </table></div>
    <?php endif; ?>
</div>

<?php if ($canEdit): ?>
<div class="card">
    <div class="section">
        <h2>Ban someone</h2>
        <p class="hint">Find the guest id or IP address on a message (Messages) or a report.</p>
        <form method="POST" action="/admin/bans/add" data-confirm="Add this ban?" data-confirm-text="They won't be able to post until it ends." data-confirm-button="Ban">
            <?= csrf_input() ?>
            <div class="field">
                <label for="b-target">What to ban</label>
                <select id="b-target" name="target">
                    <option value="guest_fanout">Guest + the IPs they posted from</option>
                    <option value="guest">Guest only</option>
                    <option value="ip">IP address</option>
                </select>
            </div>
            <div class="field">
                <label for="b-value">Guest id or IP address</label>
                <input id="b-value" name="value" required autocomplete="off" spellcheck="false">
            </div>
            <div class="field">
                <label for="b-days">For</label>
                <select id="b-days" name="days">
                    <option value="1">1 day</option>
                    <option value="7" selected>7 days</option>
                    <option value="30">30 days</option>
                    <option value="90">90 days</option>
                    <option value="0">Permanent</option>
                </select>
            </div>
            <div class="field">
                <label for="b-reason">Reason</label>
                <input id="b-reason" name="reason" placeholder="Spam in Saigon chat">
                <div class="help">Shown in this list and the audit log, never to the person.</div>
            </div>
            <button type="submit" class="btn btn-danger">Ban</button>
        </form>
    </div>
</div>
<?php endif; ?>
</div>
</div>
<?php
admin_foot();
