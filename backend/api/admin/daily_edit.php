<?php

declare(strict_types=1);

// Daily Challenge editor: create or edit one challenge (dated or reserve), set
// the Local Twist of each live city, preview the World card and the morning
// push, and run the actions (test push, duplicate, move, delete).
// Router vars: $dailyId (null for /admin/daily/new).

admin_require_login();
require_once __DIR__ . '/daily_common.php';

$challenge = $dailyId !== null ? DailyAdminService::find($dailyId) : null;
if ($dailyId !== null && $challenge === null) {
    flash_set('error', 'Challenge not found.');
    admin_redirect('/admin/daily');
}
$isNew       = $challenge === null;
$isReserve   = $isNew ? (($_GET['reserve'] ?? '') === '1') : $challenge['is_reserve'];
$isPublished = !$isNew && $challenge['status'] === 'published';
$self        = $isNew ? '/admin/daily/new' : '/admin/daily/' . $challenge['id'];

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    csrf_verify();
    $p      = $_POST;
    $action = (string) ($p['action'] ?? 'save');

    if ($action === 'save' && $isNew) {
        // Not daily_action: on a refusal the form re-renders with what was typed.
        try {
            $row = $isReserve
                ? DailyAdminService::createReserve((string) ($p['text'] ?? ''), (string) ($p['context'] ?? ''))
                : DailyAdminService::createChallenge([
                    'text' => $p['text'] ?? '', 'context' => $p['context'] ?? '',
                    'date' => $p['date'] ?? '', 'status' => $p['status'] ?? 'draft',
                ]);
            flash_set('success', 'Saved.');
            admin_redirect('/admin/daily/' . $row['id']);
        } catch (InvalidArgumentException $e) {
            $formError = $e->getMessage();
        }
    } elseif ($isNew) {
        admin_redirect($self);
    }
}

if ($_SERVER['REQUEST_METHOD'] === 'POST' && !$isNew) {
    $p      = $_POST;
    $action = (string) ($p['action'] ?? 'save');

    $id = $challenge['id'];
    match ($action) {
        'save' => daily_action(function () use ($p, $challenge, $isReserve, $isPublished) {
            $newDate = trim((string) ($p['date'] ?? ''));
            if (!$isReserve && !$isPublished && $newDate !== '' && $newDate !== $challenge['challenge_date']) {
                DailyAdminService::moveChallenge($challenge['id'], $newDate);
            }
            $fields = ['text' => $p['text'] ?? '', 'context' => $p['context'] ?? ''];
            if (!$isReserve && !$isPublished) {
                $fields['status'] = $p['status'] ?? 'draft';
            }
            DailyAdminService::updateChallenge($challenge['id'], $fields);
        }, 'Saved.', $self),

        'set_twist' => daily_action(function () use ($p, $id) {
            $username = trim((string) ($p['author_username'] ?? ''));
            $authorId = null;
            if ($username !== '') {
                $authorId = DailyAdminService::userIdForUsername($username);
                if ($authorId === null) {
                    throw new InvalidArgumentException("No user @{$username}.");
                }
            }
            DailyAdminService::setTwist($id, (string) ($p['city_id'] ?? ''), (string) ($p['twist_text'] ?? ''),
                                        $authorId, (string) ($p['credit'] ?? ''));
        }, 'Twist saved.', $self . '#twists'),

        'remove_twist' => daily_action(fn() => DailyAdminService::removeTwist((string) ($p['twist_id'] ?? '')),
            'Twist removed.', $self . '#twists'),

        'pick_twist' => daily_action(fn() => DailyTwistProposals::pick((string) ($p['twist_id'] ?? '')),
            'Twist picked.', $self . '#twists'),

        'reject_twist' => daily_action(fn() => DailyTwistProposals::reject((string) ($p['twist_id'] ?? '')),
            'Proposal rejected.', $self . '#twists'),

        'duplicate' => daily_action(function () use ($p, $id) {
            $date = trim((string) ($p['date'] ?? ''));
            $row  = DailyAdminService::duplicateChallenge($id, $date !== '' ? $date : null);
            $_SESSION['daily_last_duplicate'] = $row['id'];
            return 'Duplicated as a draft' . ($date !== '' ? " on {$date}" : '') . '.';
        }, 'Duplicated.', $self),

        'move' => daily_action(fn() => DailyAdminService::moveChallenge($id, trim((string) ($p['date'] ?? ''))),
            'Moved.', $self),

        'delete' => daily_action(fn() => DailyAdminService::deleteChallenge($id), 'Deleted.', '/admin/daily'),

        'test_push' => daily_action(function () use ($challenge) {
            $adminId = trim((string) getenv('ADMIN_TEST_USER_ID'));
            if ($adminId === '') {
                throw new InvalidArgumentException('Set ADMIN_TEST_USER_ID to receive test pushes.');
            }
            $row = $challenge;
            $row['challenge_date'] ??= DailyClock::currentDate();
            $n   = DailyPushes::sendTest($row, $adminId);
            if ($n === 0) {
                throw new InvalidArgumentException('Your test account has no device registered for push.');
            }
            DailyAdminService::audit('daily_challenge.test_push', 'daily_challenge', $challenge['id'], null, ['devices' => $n]);
            return "Test push sent to {$n} device(s).";
        }, 'Sent.', $self),

        default => admin_redirect($self),
    };
}

$posted  = isset($formError) ? $_POST : null; // re-render a refused new form with its input
$text    = $isNew ? (string) ($posted['text'] ?? '') : daily_text($challenge['text_i18n']);
$context = $isNew ? (string) ($posted['context'] ?? '') : daily_text($challenge['context_i18n']);
$date    = $isNew ? (string) ($posted['date'] ?? $_GET['date'] ?? '') : (string) ($challenge['challenge_date'] ?? '');
$status  = $isNew ? (string) ($posted['status'] ?? 'scheduled') : $challenge['status'];
$lastDuplicate = $_SESSION['daily_last_duplicate'] ?? null;
unset($_SESSION['daily_last_duplicate']);

$liveCities = [];
foreach (DailyRules::liveCityIds() as $cityId) {
    $city = CityRepository::findById((int) substr($cityId, 5));
    if ($city) $liveCities[$cityId] = $city['name'];
}
$twists = $isNew ? [] : DailyAdminService::twistsFor($challenge['id']);
// Every other twist per city: locals' proposals and the founder's earlier twists (pickable).
$otherTwists = $isNew ? [] : DailyTwistProposals::listForChallenge($challenge['id']);

$title = $isNew ? ($isReserve ? 'New reserve challenge' : 'New challenge') : ($isReserve ? 'Reserve challenge' : 'Challenge ' . $date);
admin_head($title);
admin_nav('/admin/daily');
daily_styles();
?>
<div class="admin-main">
    <div style="margin-bottom:12px"><a href="<?= $isReserve ? '/admin/daily/reserve' : '/admin/daily' ?>" class="btn btn-secondary btn-sm">← Back</a></div>
    <h1 class="page-title"><?= dh($title) ?>
        <?php if (!$isNew): ?><?= daily_state_badge($isReserve && $challenge['challenge_date'] ? 'reserve_used' : $status) ?><?php endif; ?>
    </h1>
    <?= flash_html() ?>
    <?php if (isset($formError)): ?><div class="flash flash-error"><?= dh($formError) ?></div><?php endif; ?>
    <?php if ($lastDuplicate): ?><p style="margin-bottom:12px"><a class="btn btn-secondary btn-sm" href="/admin/daily/<?= dh($lastDuplicate) ?>">Open the copy →</a></p><?php endif; ?>
    <?php if (!$isNew && $date !== ''): ?>
        <p class="daily-muted" style="margin-bottom:14px">Live in Saigon: <?= dh(daily_window_label($date)) ?></p>
    <?php endif; ?>
    <?php if ($isPublished): ?>
        <div class="warning-box" style="margin-bottom:14px">This challenge is published: text edits are live for everyone (cards already posted keep their text).</div>
    <?php endif; ?>

    <div class="daily-cols">
        <div>
            <form method="POST" action="<?= dh($self) ?><?= $isNew && $isReserve ? '?reserve=1' : '' ?>" class="form-card">
                <?= csrf_input() ?>
                <input type="hidden" name="action" value="save">
                <?php if (!$isReserve): ?>
                    <div class="form-group">
                        <label>Date (UTC date of the drop)</label>
                        <input type="date" name="date" value="<?= dh($date) ?>" <?= $isPublished ? 'disabled' : '' ?>>
                        <div class="hint">Leave empty for an undated draft. Only future drops can be planned.</div>
                    </div>
                <?php else: ?>
                    <p class="daily-muted" style="margin-bottom:12px">Reserve: no date. The drop publishes the oldest unused reserve on a day with nothing scheduled.
                        <?= !$isNew && $challenge['challenge_date'] ? '<br>Used on ' . dh($challenge['challenge_date']) . '.' : '' ?></p>
                <?php endif; ?>
                <div class="form-group">
                    <label>Challenge (English)</label>
                    <textarea name="text" id="dc-text" rows="3" required><?= dh($text) ?></textarea>
                    <div class="daily-counter" id="dc-counter"></div>
                </div>
                <div class="form-group">
                    <label>Context (English, optional)</label>
                    <textarea name="context" id="dc-context" rows="3"><?= dh($context) ?></textarea>
                </div>
                <?php if (!$isReserve && !$isPublished): ?>
                    <div class="form-group">
                        <label>Status</label>
                        <select name="status">
                            <option value="draft" <?= $status === 'draft' ? 'selected' : '' ?>>Draft (not published by the drop)</option>
                            <option value="scheduled" <?= $status === 'scheduled' ? 'selected' : '' ?>>Scheduled (goes live at its drop)</option>
                        </select>
                    </div>
                <?php endif; ?>
                <div class="form-actions"><button class="btn btn-primary" type="submit">Save</button></div>
            </form>

            <?php if (!$isNew): ?>
                <div class="form-card" id="twists">
                    <h3 style="margin-bottom:6px">Local Twists</h3>
                    <?php if ($liveCities === []): ?>
                        <p class="daily-muted">No city is live yet. Switch one on in <a href="/admin/daily/today#cities">Today → Live cities</a>.</p>
                    <?php endif; ?>
                    <?php foreach ($liveCities as $cityId => $cityName): $t = $twists[$cityId] ?? null; ?>
                        <div class="daily-twist">
                            <strong><?= dh($cityName) ?></strong>
                            <form method="POST" action="<?= dh($self) ?>" style="margin-top:6px">
                                <?= csrf_input() ?>
                                <input type="hidden" name="action" value="set_twist">
                                <input type="hidden" name="city_id" value="<?= dh($cityId) ?>">
                                <div class="form-group">
                                    <textarea name="twist_text" rows="2" class="dc-twist" data-city="<?= dh($cityName) ?>" placeholder="e.g. Cơm tấm before 8am, ask for sườn bì chả."><?= dh($t['text'] ?? '') ?></textarea>
                                </div>
                                <div class="daily-inline">
                                    <input type="text" name="author_username" placeholder="author @username" value="<?= dh($t['author_username'] ?? '') ?>">
                                    <input type="text" name="credit" placeholder="or free-text credit" value="<?= dh($t['author_credit'] ?? '') ?>">
                                    <button class="btn btn-primary btn-sm" type="submit">Save twist</button>
                                </div>
                            </form>
                            <?php if ($t): ?>
                                <form method="POST" action="<?= dh($self) ?>" style="margin-top:6px" onsubmit="return confirm('Remove this twist?')">
                                    <?= csrf_input() ?>
                                    <input type="hidden" name="action" value="remove_twist">
                                    <input type="hidden" name="twist_id" value="<?= dh($t['id']) ?>">
                                    <button class="btn btn-danger btn-sm" type="submit">Remove twist</button>
                                </form>
                            <?php endif; ?>
                            <?php $others = array_values(array_filter($otherTwists[$cityId] ?? [], fn($o) => $o['status'] !== 'selected')); ?>
                            <?php if ($others !== []): ?>
                                <div class="daily-muted" style="margin:10px 0 4px">Proposals and earlier twists (<?= count($others) ?>)</div>
                                <div class="table-wrapper"><table class="daily-stack"><tbody>
                                    <?php foreach ($others as $o): ?>
                                        <tr>
                                            <td style="width:150px">
                                                <?php if ($o['proposed_at'] !== null): ?>
                                                    @<?= dh($o['username'] ?? '?') ?><br>
                                                    <span class="daily-muted"><?= dh(date('D H:i', strtotime((string) $o['proposed_at']))) ?></span>
                                                <?php else: ?>
                                                    <span class="daily-muted">your twist</span>
                                                <?php endif; ?>
                                            </td>
                                            <td><?= dh($o['text']) ?></td>
                                            <td style="width:90px"><?= daily_state_badge($o['status'] === 'rejected' ? 'rejected' : 'pending') ?></td>
                                            <td style="width:170px; white-space:nowrap">
                                                <form method="POST" action="<?= dh($self) ?>" style="display:inline">
                                                    <?= csrf_input() ?><input type="hidden" name="action" value="pick_twist"><input type="hidden" name="twist_id" value="<?= dh($o['id']) ?>">
                                                    <button class="btn btn-primary btn-sm" type="submit">Pick</button>
                                                </form>
                                                <?php if ($o['status'] !== 'rejected'): ?>
                                                    <form method="POST" action="<?= dh($self) ?>" style="display:inline" onsubmit="return confirm('Reject this proposal?')">
                                                        <?= csrf_input() ?><input type="hidden" name="action" value="reject_twist"><input type="hidden" name="twist_id" value="<?= dh($o['id']) ?>">
                                                        <button class="btn btn-secondary btn-sm" type="submit">Reject</button>
                                                    </form>
                                                <?php endif; ?>
                                            </td>
                                        </tr>
                                    <?php endforeach; ?>
                                </tbody></table></div>
                            <?php endif; ?>
                        </div>
                    <?php endforeach; ?>
                </div>

                <div class="form-card">
                    <h3 style="margin-bottom:10px">Actions</h3>
                    <form method="POST" action="<?= dh($self) ?>" class="daily-inline" style="margin-bottom:10px">
                        <?= csrf_input() ?><input type="hidden" name="action" value="test_push">
                        <button class="btn btn-secondary btn-sm" type="submit">📲 Send the morning push to me</button>
                    </form>
                    <form method="POST" action="<?= dh($self) ?>" class="daily-inline" style="margin-bottom:10px">
                        <?= csrf_input() ?><input type="hidden" name="action" value="duplicate">
                        <input type="date" name="date"><button class="btn btn-secondary btn-sm" type="submit">Duplicate (date optional)</button>
                    </form>
                    <?php if (!$isPublished && !$isReserve): ?>
                        <form method="POST" action="<?= dh($self) ?>" class="daily-inline" style="margin-bottom:10px">
                            <?= csrf_input() ?><input type="hidden" name="action" value="move">
                            <input type="date" name="date" required><button class="btn btn-secondary btn-sm" type="submit">Move to date</button>
                        </form>
                    <?php endif; ?>
                    <?php if (!$isPublished): ?>
                        <form method="POST" action="<?= dh($self) ?>" class="daily-inline" onsubmit="return confirm('Delete this challenge and its twists?')">
                            <?= csrf_input() ?><input type="hidden" name="action" value="delete">
                            <button class="btn btn-danger btn-sm" type="submit">Delete</button>
                        </form>
                    <?php endif; ?>
                </div>
            <?php endif; ?>
        </div>

        <div>
            <div class="form-card daily-checklist">
                <h3 style="margin-bottom:6px">Editorial checklist</h3>
                <?php foreach ([
                    'Doable anywhere in a city',
                    'Takes under an hour',
                    'Costs at most the price of a local meal',
                    'Safe',
                    'Respectful of residents',
                    'Phrased as "find a…", never a precise address',
                    'Teaches something (a name, a gesture, a habit)',
                    'Under 120 characters, so the push shows it whole',
                ] as $item): ?>
                    <label><input type="checkbox"> <?= dh($item) ?></label>
                <?php endforeach; ?>
            </div>
            <div class="form-card">
                <h3 style="margin-bottom:10px">Preview</h3>
                <div class="daily-muted" style="margin-bottom:6px">World card<?= $liveCities ? ' (with the first live city\'s twist)' : '' ?></div>
                <div class="daily-preview-card">
                    <div class="kicker">🔥 Daily Challenge</div>
                    <div class="text" id="pv-text"></div>
                    <div class="context" id="pv-context"></div>
                    <div class="twist" id="pv-twist" hidden></div>
                    <div class="cta">Take the challenge</div>
                </div>
                <div class="daily-muted" style="margin-bottom:6px">Morning push</div>
                <div class="daily-preview-push">
                    <div class="icon">Hi</div>
                    <div><div class="title">Daily Challenge</div><div class="body" id="pv-push"></div></div>
                </div>
                <p class="daily-muted" style="margin-top:8px">Content and order match what the app shows; the final card design lands with the app update.</p>
            </div>
        </div>
    </div>
</div>
<script>
(function () {
    var text = document.getElementById('dc-text'), ctx = document.getElementById('dc-context');
    var counter = document.getElementById('dc-counter');
    var twist = document.querySelector('.dc-twist');
    function render() {
        var t = text.value.trim(), n = [...text.value.trim()].length;
        counter.textContent = n + ' / 120';
        counter.className = 'daily-counter' + (n > 120 ? ' over' : n > 100 ? ' near' : '');
        document.getElementById('pv-text').textContent = t || 'Your challenge text';
        document.getElementById('pv-context').textContent = ctx.value.trim();
        document.getElementById('pv-push').textContent = "Today's Daily Challenge: " + (t || '…');
        var tw = document.getElementById('pv-twist');
        if (twist && twist.value.trim()) { tw.hidden = false; tw.textContent = '📍 ' + twist.dataset.city + ' Local Twist: ' + twist.value.trim(); }
        else { tw.hidden = true; }
    }
    [text, ctx, twist].forEach(function (el) { if (el) el.addEventListener('input', render); });
    render();
})();
</script>
<?php admin_foot();
