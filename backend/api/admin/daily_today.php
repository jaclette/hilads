<?php

declare(strict_types=1);

// Daily Challenge today panel: the active challenge, proof counts, the
// moderation queue (pending + reported), the latest proofs, today's twists and
// the force_live switch per city.

admin_require_login();
require_once __DIR__ . '/daily_common.php';

$self = '/admin/daily/today';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    csrf_verify();
    $p     = $_POST;
    $proof = (string) ($p['proof_id'] ?? '');
    match ((string) ($p['action'] ?? '')) {
        'approve'         => daily_action(fn() => DailyModerationService::approveProof($proof), 'Approved - it is live with its cards.', $self . '#queue'),
        'reject'          => daily_action(fn() => DailyModerationService::rejectProof($proof, (string) ($p['reason'] ?? '')), 'Rejected - the author sees your reason.', $self . '#queue'),
        'dismiss_reports' => daily_action(fn() => DailyModerationService::resolveReports($proof, 'dismissed'), 'Reports dismissed.', $self . '#queue'),
        'remove_proof'    => daily_action(fn() => DailyAdminService::removeProof($proof, (string) ($p['reason'] ?? '')), 'Proof removed.', $self . '#latest'),
        'remove_twist'    => daily_action(fn() => DailyAdminService::removeTwist((string) ($p['twist_id'] ?? '')), 'Twist removed.', $self . '#twists'),
        'force_live'      => daily_action(function () use ($p) {
            $cityId = (string) ($p['city_id'] ?? '');
            if ($cityId === '' && ($p['city_name'] ?? '') !== '') {
                $cityId = (string) CityRepository::findChannelIdByName((string) $p['city_name']);
            }
            $live = ($p['live'] ?? '') === '1';
            DailyAdminService::setForceLive($cityId, $live);
            return ($live ? 'City is live: ' : 'City is no longer live: ') . $cityId . '.';
        }, 'Saved.', $self . '#cities'),
        default => admin_redirect($self),
    };
}

$date      = DailyClock::currentDate();
$challenge = DailyChallengeRepository::findPublishedByDate($date);
$full      = $challenge ? DailyAdminService::find($challenge['id']) : null;
$stats     = $challenge ? DailyAdminService::todayStats($challenge['id']) : ['approved' => 0, 'pending' => 0, 'byCity' => []];
$queue     = DailyModerationService::queue(50);
$latest    = $challenge ? DailyProofRepository::listApproved($challenge['id'], null, null, 20) : [];
$twists    = $challenge ? DailyAdminService::twistsFor($challenge['id']) : [];
$runStmt   = Database::pdo()->prepare("SELECT * FROM daily_drop_runs WHERE challenge_date = ?");
$runStmt->execute([$date]);
$run       = $runStmt->fetch(PDO::FETCH_ASSOC) ?: null;

$cityName = function (?string $cityId): string {
    if ($cityId === null) return '-';
    return CityRepository::findById((int) substr($cityId, 5))['name'] ?? $cityId;
};
$left = DailyClock::secondsLeft();

/** One proof row: photo, author, city, caption, label. */
$proofCell = function (array $r) use ($cityName): string {
    $label = DailyProofRepository::bool($r['is_local']) ? '🌍 Local' : '🧭 Traveler';
    return '<div style="display:flex;gap:10px;align-items:flex-start">'
        . '<a href="' . dh($r['photo_url']) . '" target="_blank"><img class="daily-thumb" src="' . dh(R2Uploader::thumbProxy($r['photo_url'])) . '" alt=""></a>'
        . '<div><strong>@' . dh($r['username'] ?: $r['display_name']) . '</strong> <span class="daily-muted">' . dh($label) . ' · ' . dh($cityName($r['city_id'])) . '</span>'
        . ($r['edited_at'] ? ' <span class="badge" style="background:#3f3f46;color:#ddd">edited</span>' : '')
        . '<div style="margin-top:4px">' . ($r['caption'] !== null ? dh($r['caption']) : '<span class="daily-muted">no caption</span>') . '</div>'
        . ($r['price_amount'] !== null ? '<div class="daily-muted">' . dh(rtrim(rtrim((string) $r['price_amount'], '0'), '.') . ' ' . $r['price_currency']) . '</div>' : '')
        . ($r['place_lat'] !== null ? '<div class="daily-muted">📍 ' . dh($r['place_name'] ?: ($r['place_lat'] . ', ' . $r['place_lng'])) . '</div>' : '')
        . '<div class="daily-muted">' . dh($r['challenge_date']) . ' · posted ' . dh(date('j M H:i', strtotime($r['created_at']))) . '</div>'
        . '</div></div>';
};

admin_head('Daily today');
admin_nav('/admin/daily');
daily_styles();
?>
<div class="admin-main">
    <h1 class="page-title">🔥 Today</h1>
    <?php daily_subnav($self); ?>
    <?= flash_html() ?>

    <div class="form-card">
        <?php if ($challenge): ?>
            <div class="daily-muted"><?= dh($date) ?> · <?= dh(daily_window_label($date)) ?> · <?= floor($left / 3600) ?>h<?= sprintf('%02d', floor($left % 3600 / 60)) ?> left</div>
            <div style="font-size:18px;font-weight:600;color:#fff;margin:6px 0"><?= dh(daily_text($full['text_i18n'])) ?></div>
            <a class="btn btn-secondary btn-sm" href="/admin/daily/<?= dh($challenge['id']) ?>">Open in the editor</a>
        <?php else: ?>
            <div style="color:#f87171;font-weight:600">Nothing is live for <?= dh($date) ?>.</div>
        <?php endif; ?>
        <div class="daily-muted" style="margin-top:8px">Drop: <?= $run ? dh($run['status'] . ($run['source'] ? ' · ' . $run['source'] : '') . ($run['error'] ? ' · ' . $run['error'] : '')) : 'not run yet' ?></div>
    </div>

    <div class="stats-row">
        <div class="stat-card"><div class="stat-value"><?= $stats['approved'] ?></div><div class="stat-label">approved proofs</div></div>
        <div class="stat-card"><div class="stat-value" style="<?= count($queue['pending']) ? 'color:#fcd34d' : '' ?>"><?= count($queue['pending']) ?></div><div class="stat-label">waiting for review</div></div>
        <div class="stat-card"><div class="stat-value" style="<?= count($queue['reported']) ? 'color:#f87171' : '' ?>"><?= count($queue['reported']) ?></div><div class="stat-label">reported</div></div>
        <?php foreach (array_slice($stats['byCity'], 0, 5, true) as $cid => $n): ?>
            <div class="stat-card"><div class="stat-value"><?= (int) $n ?></div><div class="stat-label"><?= dh($cityName($cid)) ?></div></div>
        <?php endforeach; ?>
    </div>

    <h3 id="queue" style="margin:8px 0">Waiting for review (oldest first)</h3>
    <div class="table-wrapper"><table class="daily-stack"><tbody>
    <?php foreach ($queue['pending'] as $r): ?>
        <tr>
            <td><?= $proofCell($r) ?></td>
            <td class="td-actions" style="min-width:300px">
                <form method="POST" action="<?= $self ?>" style="display:inline"><?= csrf_input() ?>
                    <input type="hidden" name="action" value="approve"><input type="hidden" name="proof_id" value="<?= dh($r['id']) ?>">
                    <button class="btn btn-primary btn-sm" type="submit">Approve</button></form>
                <form method="POST" action="<?= $self ?>" class="daily-inline" style="margin-top:6px"><?= csrf_input() ?>
                    <input type="hidden" name="action" value="reject"><input type="hidden" name="proof_id" value="<?= dh($r['id']) ?>">
                    <input type="text" name="reason" placeholder="Reason (the author sees it)" required>
                    <button class="btn btn-danger btn-sm" type="submit">Reject</button></form>
            </td>
        </tr>
    <?php endforeach; ?>
    <?php if ($queue['pending'] === []): ?><tr><td class="no-results">Nothing waiting. 🎉</td></tr><?php endif; ?>
    </tbody></table></div>

    <?php if ($queue['reported'] !== []): ?>
        <h3 style="margin:18px 0 8px">Reported (still visible)</h3>
        <div class="table-wrapper"><table class="daily-stack"><tbody>
        <?php foreach ($queue['reported'] as $r): ?>
            <tr>
                <td><?= $proofCell($r) ?><div style="margin-top:6px;color:#f87171"><?= (int) $r['report_count'] ?> report(s): <?= dh(str_replace(',', ', ', (string) $r['reasons'])) ?></div></td>
                <td class="td-actions" style="min-width:300px">
                    <form method="POST" action="<?= $self ?>" style="display:inline"><?= csrf_input() ?>
                        <input type="hidden" name="action" value="dismiss_reports"><input type="hidden" name="proof_id" value="<?= dh($r['id']) ?>">
                        <button class="btn btn-secondary btn-sm" type="submit">Keep (dismiss reports)</button></form>
                    <form method="POST" action="<?= $self ?>" class="daily-inline" style="margin-top:6px"><?= csrf_input() ?>
                        <input type="hidden" name="action" value="remove_proof"><input type="hidden" name="proof_id" value="<?= dh($r['id']) ?>">
                        <input type="text" name="reason" placeholder="Reason (the author sees it)">
                        <button class="btn btn-danger btn-sm" type="submit">Remove</button></form>
                </td>
            </tr>
        <?php endforeach; ?>
        </tbody></table></div>
    <?php endif; ?>

    <h3 id="latest" style="margin:18px 0 8px">Latest approved proofs</h3>
    <div class="table-wrapper"><table class="daily-stack"><tbody>
    <?php foreach ($latest as $r): ?>
        <tr>
            <td><?= $proofCell($r) ?></td>
            <td class="td-actions" style="min-width:300px">
                <form method="POST" action="<?= $self ?>" class="daily-inline" onsubmit="return confirm('Remove this proof and its cards?')"><?= csrf_input() ?>
                    <input type="hidden" name="action" value="remove_proof"><input type="hidden" name="proof_id" value="<?= dh($r['id']) ?>">
                    <input type="text" name="reason" placeholder="Reason (the author sees it)">
                    <button class="btn btn-danger btn-sm" type="submit">Remove</button></form>
            </td>
        </tr>
    <?php endforeach; ?>
    <?php if ($latest === []): ?><tr><td class="no-results">No approved proof yet.</td></tr><?php endif; ?>
    </tbody></table></div>

    <h3 id="twists" style="margin:18px 0 8px">Today's Local Twists</h3>
    <div class="table-wrapper"><table class="daily-stack"><tbody>
    <?php foreach ($twists as $cid => $t): ?>
        <tr>
            <td><strong><?= dh($cityName($cid)) ?></strong> <?= DailyRules::isLive($cid) ? '' : '<span class="daily-muted">(city not live: hidden)</span>' ?><div><?= dh($t['text']) ?></div>
                <div class="daily-muted"><?= $t['author_username'] ? '@' . dh($t['author_username']) : '' ?><?= $t['author_credit'] ? ' ' . dh($t['author_credit']) : '' ?></div></td>
            <td class="td-actions">
                <form method="POST" action="<?= $self ?>" onsubmit="return confirm('Remove this twist?')"><?= csrf_input() ?>
                    <input type="hidden" name="action" value="remove_twist"><input type="hidden" name="twist_id" value="<?= dh($t['id']) ?>">
                    <button class="btn btn-danger btn-sm" type="submit">Remove</button></form>
            </td>
        </tr>
    <?php endforeach; ?>
    <?php if ($twists === []): ?><tr><td class="no-results">No twist today.</td></tr><?php endif; ?>
    </tbody></table></div>

    <h3 id="cities" style="margin:18px 0 8px">Live cities</h3>
    <div class="form-card">
        <?php foreach (DailyRules::liveCityIds() as $cid): ?>
            <form method="POST" action="<?= $self ?>" class="daily-inline" style="margin-bottom:8px"><?= csrf_input() ?>
                <input type="hidden" name="action" value="force_live"><input type="hidden" name="city_id" value="<?= dh($cid) ?>"><input type="hidden" name="live" value="0">
                <span class="badge badge-live">live</span> <strong><?= dh($cityName($cid)) ?></strong>
                <button class="btn btn-secondary btn-sm" type="submit" onclick="return confirm('Turn this city off? Its twist and city cards stop.')">Turn off</button>
            </form>
        <?php endforeach; ?>
        <?php if (DailyRules::liveCityIds() === []): ?><p class="daily-muted" style="margin-bottom:8px">No live city: World only.</p><?php endif; ?>
        <form method="POST" action="<?= $self ?>" class="daily-inline" style="margin-top:8px"><?= csrf_input() ?>
            <input type="hidden" name="action" value="force_live"><input type="hidden" name="live" value="1">
            <div class="city-picker" style="min-width:240px">
                <input type="text" class="city-picker-search" placeholder="Search a city…" autocomplete="off">
                <input type="hidden" name="city_name" value="">
                <ul class="city-picker-options" hidden></ul>
            </div>
            <button class="btn btn-primary btn-sm" type="submit">Make live</button>
        </form>
    </div>
</div>
<script>initCityPickers(<?= json_encode(array_map(fn($c) => ['name' => $c['name'], 'country' => $c['country']], CityRepository::all()), JSON_UNESCAPED_UNICODE) ?>);</script>
<?php admin_foot();
