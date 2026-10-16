<?php

declare(strict_types=1);

// Daily Challenge proposals inbox (V2-05): users' challenge proposals (approve
// with a date or to the reserve, after editing; or reject with a reason),
// locals' Local Twist proposals for upcoming days (pick or reject), and the
// rejection reason templates.

admin_require_login();
require_once __DIR__ . '/daily_common.php';

$self = '/admin/daily/proposals';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    csrf_verify();
    $p      = $_POST;
    $reason = static function (array $p): string {
        $tpl   = trim((string) ($p['template'] ?? ''));
        $extra = trim((string) ($p['reason_extra'] ?? ''));
        return trim($tpl . ($tpl !== '' && $extra !== '' ? ' ' : '') . $extra);
    };
    match ((string) ($p['action'] ?? '')) {
        'approve' => daily_action(fn() => DailyProposals::approve((string) ($p['id'] ?? ''), [
                'text' => (string) ($p['text'] ?? ''), 'context' => (string) ($p['context'] ?? ''),
                'theme' => (string) ($p['theme'] ?? ''), 'twistText' => (string) ($p['twist_text'] ?? ''),
                'date' => (string) ($p['date'] ?? ''), 'reserve' => ($p['to'] ?? '') === 'reserve',
            ]), ($p['to'] ?? '') === 'reserve' ? 'Approved - it is in the reserve.' : 'Approved and scheduled.', $self),
        'reject' => daily_action(fn() => DailyProposals::reject((string) ($p['id'] ?? ''), $reason($p)),
            'Rejected - the author sees your reason in the app.', $self),
        'pick_twist' => daily_action(fn() => DailyTwistProposals::pick((string) ($p['twist_id'] ?? '')),
            'Twist picked.', $self . '#twists'),
        'reject_twist' => daily_action(fn() => DailyTwistProposals::reject((string) ($p['twist_id'] ?? ''), $reason($p)),
            'Twist proposal rejected.', $self . '#twists'),
        'add_template' => daily_action(fn() => DailyProposals::addTemplate((string) ($p['text'] ?? '')),
            'Template added.', $self . '#templates'),
        'delete_template' => daily_action(fn() => DailyProposals::deleteTemplate((int) ($p['template_id'] ?? 0)),
            'Template deleted.', $self . '#templates'),
        default => admin_redirect($self),
    };
}

$pending   = DailyProposals::listPending();
$twists    = DailyTwistProposals::listPending();
$reviewed  = DailyProposals::listReviewed();
$templates = DailyProposals::templates();

/** The reject controls: a template, plus optional words. */
function daily_reason_fields(array $templates): string
{
    $html = '<select name="template"><option value="">Reason…</option>';
    foreach ($templates as $t) {
        $html .= '<option value="' . dh($t['text']) . '">' . dh(mb_strimwidth($t['text'], 0, 60, '…')) . '</option>';
    }
    return $html . '</select> <input type="text" name="reason_extra" placeholder="Add words (optional)" maxlength="200">';
}

admin_head('Daily proposals');
admin_nav('/admin/daily');
daily_styles();
?>
<div class="admin-main">
    <h1 class="page-title">💡 Proposals</h1>
    <?php daily_subnav('/admin/daily/proposals'); ?>
    <?= flash_html() ?>

    <h3 style="margin:6px 0 8px">Challenge proposals (<?= count($pending) ?>)</h3>
    <?php if ($pending === []): ?><p class="daily-muted">Nothing waiting.</p><?php endif; ?>
    <?php foreach ($pending as $r): ?>
        <div class="form-card">
            <p class="daily-muted" style="margin-bottom:8px">
                @<?= dh($r['username'] ?: $r['display_name']) ?><?= $r['city_name'] ? ' · ' . dh($r['city_name']) : '' ?>
                · <?= dh(date('j M H:i', strtotime($r['created_at']))) ?>
                <?= $r['why'] ? '<br>Why: <em>' . dh($r['why']) . '</em>' : '' ?>
            </p>
            <form method="POST" action="<?= $self ?>">
                <?= csrf_input() ?>
                <input type="hidden" name="action" value="approve">
                <input type="hidden" name="id" value="<?= dh($r['id']) ?>">
                <div class="form-group">
                    <label>Challenge (English, edit if needed)</label>
                    <textarea name="text" rows="2" maxlength="<?= DailyProposals::TEXT_MAX ?>" class="dp-text" required><?= dh($r['text']) ?></textarea>
                    <div class="daily-counter"></div>
                </div>
                <div class="form-group"><label>Context (optional)</label><textarea name="context" rows="2"></textarea></div>
                <div class="form-group"><label>Theme</label><?= daily_theme_select($r['theme'], null) ?></div>
                <?php if ($r['twist_text'] !== null || $r['city_id'] !== null): ?>
                    <div class="form-group">
                        <label>Local Twist for <?= dh($r['city_name'] ?? 'their city') ?> (optional, credited to the author)</label>
                        <textarea name="twist_text" rows="2" maxlength="<?= DailyAdminService::TWIST_MAX ?>"><?= dh($r['twist_text'] ?? '') ?></textarea>
                    </div>
                <?php endif; ?>
                <div class="form-group">
                    <label>Date (next free <?= dh(DailyThemes::name($r['theme'])) ?> day suggested)</label>
                    <input type="date" name="date" value="<?= dh($r['suggested_date']) ?>">
                </div>
                <div class="form-actions">
                    <button class="btn btn-primary" type="submit" name="to" value="date">Approve on this date</button>
                    <button class="btn btn-secondary" type="submit" name="to" value="reserve" formnovalidate>Approve to the reserve</button>
                </div>
            </form>
            <form method="POST" action="<?= $self ?>" style="margin-top:10px">
                <?= csrf_input() ?>
                <input type="hidden" name="action" value="reject">
                <input type="hidden" name="id" value="<?= dh($r['id']) ?>">
                <?= daily_reason_fields($templates) ?>
                <button class="btn btn-danger btn-sm" type="submit">Reject</button>
            </form>
        </div>
    <?php endforeach; ?>

    <h3 id="twists" style="margin:18px 0 8px">Local Twist proposals for upcoming days (<?= count($twists) ?>)</h3>
    <div class="table-wrapper"><table>
        <thead><tr><th>Day</th><th>City</th><th>Proposal</th><th>By</th><th></th></tr></thead>
        <tbody>
        <?php foreach ($twists as $t): ?>
            <tr>
                <td class="td-mono"><a href="/admin/daily/<?= dh($t['challenge_id']) ?>#twists"><?= dh($t['challenge_date']) ?></a></td>
                <td><?= dh($t['city_name'] ?? '') ?></td>
                <td><?= dh($t['text']) ?><div class="daily-muted"><?= dh(mb_strimwidth(daily_text($t['text_i18n']), 0, 70, '…')) ?></div></td>
                <td class="daily-muted">@<?= dh($t['username'] ?: $t['display_name']) ?></td>
                <td class="td-actions">
                    <form method="POST" action="<?= $self ?>" style="display:inline">
                        <?= csrf_input() ?><input type="hidden" name="action" value="pick_twist"><input type="hidden" name="twist_id" value="<?= dh($t['id']) ?>">
                        <button class="btn btn-primary btn-sm" type="submit">Pick</button>
                    </form>
                    <form method="POST" action="<?= $self ?>" style="display:inline">
                        <?= csrf_input() ?><input type="hidden" name="action" value="reject_twist"><input type="hidden" name="twist_id" value="<?= dh($t['id']) ?>">
                        <?= daily_reason_fields($templates) ?>
                        <button class="btn btn-danger btn-sm" type="submit">Reject</button>
                    </form>
                </td>
            </tr>
        <?php endforeach; ?>
        <?php if ($twists === []): ?><tr><td colspan="5" class="no-results">Nothing waiting.</td></tr><?php endif; ?>
        </tbody>
    </table></div>

    <h3 id="templates" style="margin:18px 0 8px">Rejection reasons</h3>
    <div class="table-wrapper"><table>
        <tbody>
        <?php foreach ($templates as $t): ?>
            <tr>
                <td><?= dh($t['text']) ?></td>
                <td class="td-actions">
                    <form method="POST" action="<?= $self ?>">
                        <?= csrf_input() ?><input type="hidden" name="action" value="delete_template"><input type="hidden" name="template_id" value="<?= (int) $t['id'] ?>">
                        <button class="btn btn-secondary btn-sm" type="submit">Delete</button>
                    </form>
                </td>
            </tr>
        <?php endforeach; ?>
        </tbody>
    </table></div>
    <form method="POST" action="<?= $self ?>" class="form-card" style="margin-top:8px">
        <?= csrf_input() ?><input type="hidden" name="action" value="add_template">
        <div class="form-group"><label>New reason (the author reads it in the app)</label><input type="text" name="text" maxlength="280" required></div>
        <div class="form-actions"><button class="btn btn-primary btn-sm" type="submit">Add</button></div>
    </form>

    <h3 style="margin:18px 0 8px">Recently reviewed</h3>
    <div class="table-wrapper"><table>
        <thead><tr><th>Proposal</th><th>By</th><th>Result</th></tr></thead>
        <tbody>
        <?php foreach ($reviewed as $r): ?>
            <tr>
                <td><?= dh($r['text']) ?></td>
                <td class="daily-muted">@<?= dh($r['username'] ?: $r['display_name']) ?></td>
                <td class="daily-muted">
                    <?php $st = DailyProposals::statusOf($r); ?>
                    <?= dh($st) ?><?= $r['challenge_date'] ? ' · ' . dh($r['challenge_date']) : '' ?>
                    <?= $r['created_challenge_id'] ? ' · <a href="/admin/daily/' . dh($r['created_challenge_id']) . '">open</a>' : '' ?>
                    <?= $r['status'] === 'rejected' ? '<br>' . dh($r['rejection_reason']) : '' ?>
                </td>
            </tr>
        <?php endforeach; ?>
        <?php if ($reviewed === []): ?><tr><td colspan="3" class="no-results">None yet.</td></tr><?php endif; ?>
        </tbody>
    </table></div>
</div>
<script>
document.querySelectorAll('.dp-text').forEach(function (el) {
    var counter = el.parentNode.querySelector('.daily-counter');
    function render() { var n = [...el.value.trim()].length; counter.textContent = n + ' / 120'; counter.className = 'daily-counter' + (n > 120 ? ' over' : n > 100 ? ' near' : ''); }
    el.addEventListener('input', render); render();
});
</script>
<?php admin_foot();
