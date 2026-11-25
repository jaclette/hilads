<?php

declare(strict_types=1);

// Daily Challenge calendar: the past 7 days and the next 30, each with its
// state and its live window in Saigon time. Empty days in the next 7 stand out.

admin_require_login();
require_once __DIR__ . '/daily_common.php';

$utc   = new DateTimeZone('UTC');
$today = DailyClock::currentDate();
$from  = (new DateTimeImmutable($today, $utc))->modify('-7 days')->format('Y-m-d');
$to    = (new DateTimeImmutable($today, $utc))->modify('+30 days')->format('Y-m-d');
$soon  = (new DateTimeImmutable($today, $utc))->modify('+7 days')->format('Y-m-d');

$days = DailyAdminService::calendar($from, $to);
$specialsByDate = DailySpecials::byDate($from, $to);

$runs = [];
$stmt = Database::pdo()->prepare("SELECT * FROM daily_drop_runs WHERE challenge_date BETWEEN ? AND ?");
$stmt->execute([$from, $today]);
foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
    $runs[$r['challenge_date']] = $r;
}

$unusedReserve = (int) Database::pdo()->query(
    "SELECT count(*) FROM daily_challenges WHERE is_reserve AND challenge_date IS NULL AND status = 'scheduled'"
)->fetchColumn();
$gaps = DailyAdminService::gapsInNextDays(7);
$proposalCounts = DailyTwistProposals::countsByDate($from, $to);

admin_head('Daily Challenge');
admin_nav('/admin/daily');
daily_styles();
?>
<div class="admin-main">
    <?php daily_head('/admin/daily', 'Daily challenges', 'One challenge a day for every city. Plan the coming days, fill the gaps in red, check translations and covers.', '<a class="btn" href="/admin/daily/new?reserve=1">New reserve challenge</a><a class="btn btn-primary" href="/admin/daily/new">New challenge</a>'); ?>
    <?= flash_html() ?>

    <div class="grid cols-3" style="margin-bottom:16px">
        <a class="card kpi" href="#soon"><div class="label">Gaps in the next 7 days</div><div class="value num<?= count($gaps) > 0 ? ' down' : '' ?>"><?= count($gaps) ?></div>
            <div class="tile-note"><?= count($gaps) > 0 ? 'days with nothing scheduled, in red below' : 'every day is planned' ?></div></a>
        <a class="card kpi" href="/admin/daily/reserve"><div class="label">In reserve</div><div class="value num<?= $unusedReserve === 0 ? ' down' : '' ?>"><?= $unusedReserve ?></div>
            <div class="tile-note">used on a day with nothing scheduled</div></a>
        <div class="card kpi"><div class="label">Live now</div><div class="value" style="font-size:var(--fs-md);margin-top:8px"><?= dh(daily_window_label($today)) ?></div>
            <div class="tile-note">Saigon time</div></div>
    </div>
    <?php if ($unusedReserve === 0): ?>
        <div class="callout bad" style="margin-bottom:16px">The reserve is empty: a day with nothing scheduled will publish nothing. <a href="/admin/daily/reserve">Add reserve challenges</a>.</div>
    <?php endif; ?>

    <div class="card" id="soon">
    <div class="table-wrapper">
        <table class="data">
            <thead><tr><th>Date</th><th>Live (Saigon)</th><th>Status</th><th>Theme</th><th>Challenge</th><th>Languages</th><th>Local twists</th><th>Drop</th><th></th></tr></thead>
            <tbody>
            <?php foreach ($days as $day):
                $c       = $day['challenge'];
                $isPast  = $day['date'] < $today;
                $isToday = $day['date'] === $today;
                $flag    = !$isPast && !$isToday && $day['state'] !== 'scheduled' && $day['state'] !== 'published' && $day['date'] <= $soon;
                $run     = $runs[$day['date']] ?? null;
            ?>
                <tr class="<?= $flag ? 'daily-row-empty-soon' : '' ?><?= $isToday ? ' daily-row-today' : '' ?>">
                    <td class="td-mono"><?= dh($day['date']) ?><?= $isToday ? ' <span class="badge b-brand">today</span>' : '' ?></td>
                    <td class="daily-muted"><?= dh(daily_window_label($day['date'])) ?></td>
                    <td><?= daily_state_badge($day['state']) ?></td>
                    <td class="daily-muted"><?= dh(daily_theme_label($c['theme'] ?? null, $day['date'], $c['special_id'] ?? null)) ?><?= $c === null ? ' <span style="opacity:.6">(default)</span>' : '' ?>
                        <?php foreach ($specialsByDate[$day['date']] ?? [] as $sp): if ($sp['scope'] === 'world' && ($c['special_id'] ?? null) === $sp['id']) continue; ?>
                            <br><span class="badge" style="background:var(--warn-soft);color:var(--warn)" title="<?= $sp['scope'] === 'world' ? 'World special: pick it as the theme' : 'Bring it in through the Local Twist' ?>">
                                <?= dh(($sp['emoji'] ?: '✨') . ' ' . DailySpecials::nameOf($sp, 'en')) ?> · <?= dh($sp['scope'] === 'country' ? $sp['country'] : ($sp['scope'] === 'city' ? 'city' : 'world')) ?></span>
                        <?php endforeach; ?></td>
                    <td class="td-clip" style="max-width:420px"><?= $c ? dh(mb_strimwidth(daily_text($c['text_i18n']), 0, 90, '…')) : '<span class="daily-muted">-</span>' ?>
                        <?php if ($c && ($c['compare_type'] ?? null) === null): ?><br><span class="badge b-warn">no comparison question</span><?php endif; ?></td>
                    <td><?php if ($c):
                            $tr = DailyI18n::translated(json_decode((string) $c['text_i18n'], true) ?: []); ?>
                            <span class="badge <?= count($tr) === 18 ? 'b-ok' : (count($tr) === 0 ? 'b-bad' : 'b-warn') ?>"><?= count($tr) + 1 ?>/19</span>
                        <?php endif; ?></td>
                    <td><?= $c ? (int) $c['twist_count'] : '' ?><?= !empty($proposalCounts[$day['date']]) ? ' <span class="badge" style="background:var(--warn-soft);color:var(--warn)">' . (int) $proposalCounts[$day['date']] . ' proposed</span>' : '' ?></td>
                    <td class="daily-muted">
                        <?php if ($run): ?>
                            <?= dh($run['status']) ?><?= $run['source'] ? ' · ' . dh($run['source']) : '' ?><?= $run['error'] ? ' · <span style="color:var(--bad)">' . dh(mb_strimwidth($run['error'], 0, 60, '…')) . '</span>' : '' ?>
                        <?php elseif ($isPast || $isToday): ?>
                            <span class="badge b-bad">did not run</span>
                        <?php endif; ?>
                    </td>
                    <td class="td-actions">
                        <?php if ($c): ?>
                            <a class="btn btn-sm" href="/admin/daily/<?= dh($c['id']) ?>">Open</a>
                        <?php elseif (!$isPast && !$isToday): ?>
                            <a class="btn btn-primary btn-sm" href="/admin/daily/new?date=<?= dh($day['date']) ?>">Plan it</a>
                        <?php endif; ?>
                    </td>
                </tr>
            <?php endforeach; ?>
            </tbody>
        </table>
    </div>
    </div>
    <p class="daily-muted" style="margin-top:10px">A date is the UTC date of its drop (<?= dh(sprintf('%02d:%02d', ...DailyClock::dropTime())) ?> UTC). Planning starts tomorrow: today's challenge is handled by the drop.</p>
</div>
<?php admin_foot();
