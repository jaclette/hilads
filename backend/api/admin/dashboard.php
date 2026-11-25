<?php

declare(strict_types=1);

// Today › Dashboard: how today is going (photos, players, cities, sign-ups, who comes back),
// what needs a person (photos to check, reports, proposals, new cities), today's challenge and
// the week ahead (gaps in red), the season's top 5, photos over 14 days, recent errors.
// Every tile links to the page where it is handled. Numbers: AdminDashboard (cached briefly).

admin_require_login();
require_once __DIR__ . '/daily_common.php';

$e = fn ($s) => htmlspecialchars((string) $s, ENT_QUOTES);
$n = fn ($v) => number_format((int) $v);

$k       = AdminDashboard::kpis();
$back    = AdminDashboard::retention() ?? AdminDashboard::cameBack();
$own     = ($back['source'] ?? '') !== 'posthog';
$att     = AdminDashboard::attention();
$today   = AdminDashboard::today();
$week    = AdminDashboard::week(7);
$top     = AdminDashboard::seasonTop(5);
$bars    = AdminDashboard::photosByDay(14);
$errors  = AdminDashboard::errors(5);
$posthogError = isset($back['error']) && AdminDashboard::posthogConfigured() ? $back['error'] : null;
if ($posthogError !== null) $back = AdminDashboard::cameBack();   // fall back to our own number

/** "+3 vs yesterday" in green / red / grey. */
$delta = function (int $now, int $before, string $what = 'yesterday') use ($n): string {
    $d = $now - $before;
    $cls = $d > 0 ? 'up' : ($d < 0 ? 'down' : '');
    return '<div class="delta ' . $cls . '">' . ($d === 0 ? 'same as ' . $what : ($d > 0 ? '+' : '−') . $n(abs($d)) . ' vs ' . $what) . '</div>';
};
$ago = function (?string $ts): string {
    if (!$ts) return '';
    $s = time() - strtotime($ts);
    return $s < 3600 ? max(1, intdiv($s, 60)) . ' min' : ($s < 86400 ? intdiv($s, 3600) . ' h' : intdiv($s, 86400) . ' d');
};
$hour = (int) date('G');
$hello = $hour < 12 ? 'Good morning' : ($hour < 18 ? 'Good afternoon' : 'Good evening');
$name = explode(' ', (string) AdminAuth::name())[0];

admin_head('Dashboard');
admin_nav('/admin');
?>
<div class="admin-main">
    <div class="page-head">
        <div>
            <h1 class="page-title"><?= $e($hello . ($name !== '' ? ", {$name}" : '')) ?></h1>
            <p class="sub"><?= $e(date('l j F')) ?> · today's challenge runs <?= $e(daily_window_label($today['date'] ?? DailyClock::currentDate())) ?> (Saigon)</p>
        </div>
        <div class="head-actions">
            <?php if (!empty($today['id'])): ?><a class="btn" href="/admin/daily/today">Today's photos</a><?php endif; ?>
            <a class="btn btn-primary" href="/admin/daily">Daily calendar</a>
        </div>
    </div>
    <?= flash_html() ?>

    <!-- Today vs yesterday -->
    <div class="grid kpis" style="margin-bottom:16px">
        <?php if (isset($k['error'])): ?>
            <div class="card kpi" style="grid-column:1/-1"><div class="label"><?= $e($k['error']) ?></div></div>
        <?php else: ?>
        <a class="card kpi" href="/admin/daily/today" title="Photos posted on today's challenge (seeds, demos and Hilads suggestions left out)">
            <div class="label">Photos today</div><div class="value num"><?= $n($k['photos']['today']) ?></div><?= $delta($k['photos']['today'], $k['photos']['yesterday']) ?></a>
        <a class="card kpi" href="/admin/daily/today" title="Different players with a photo on today's challenge">
            <div class="label">Players today</div><div class="value num"><?= $n($k['players']['today']) ?></div><?= $delta($k['players']['today'], $k['players']['yesterday']) ?></a>
        <a class="card kpi" href="/admin/cities" title="Cities with at least one photo on today's challenge">
            <div class="label">Cities that played</div><div class="value num"><?= $n($k['cities']['today']) ?></div><?= $delta($k['cities']['today'], $k['cities']['yesterday']) ?></a>
        <a class="card kpi" href="/admin/users" title="Accounts created today (Saigon day); test accounts left out">
            <div class="label">New sign-ups</div><div class="value num"><?= $n($k['signups']['today']) ?></div><?= $delta($k['signups']['today'], $k['signups']['yesterday']) ?>
            <div class="tile-note"><?= $n($k['signups']['week']) ?> in 7 days</div></a>
        <?php endif; ?>
        <?php foreach (['d1' => ['next day', 'D1'], 'd7' => ['7 days later', 'D7']] as $key => [$when, $short]): ?>
            <div class="card kpi" title="<?= $own
                ? 'Of the accounts created on a day, the share that did something (photo, like, comment, chat message) ' . $when . '. Average of the last 7 complete sign-up days. Our own data: it cannot see people who only opened the app.'
                : 'PostHog: of the people first seen on a day, the share who came back ' . $when . ' (any event). Average of the last 7 complete days.' ?>">
                <div class="label"><?= $own ? 'Came back ' . $when : 'Retention ' . $short ?></div>
                <div class="value num"><?= isset($back['error']) ? '–' : ($back[$key] === null ? '–' : $back[$key] . ' %') ?></div>
                <div class="tile-note"><?= isset($back['error']) ? $e($back['error'])
                    : ($own ? 'Active players who came back · ' : 'PostHog · ') . $n($back[$key . 'Base'] ?? 0) . ' sign-ups' ?></div>
            </div>
        <?php endforeach; ?>
    </div>
    <?php if ($posthogError !== null): ?>
        <div class="callout warn" style="margin:-4px 0 16px">PostHog didn't answer, so the came-back numbers are from our own data. <?= $e($posthogError) ?></div>
    <?php endif; ?>

    <!-- Needs attention -->
    <section class="card" style="margin-bottom:16px">
        <div class="card-head"><h2>Needs attention</h2></div>
        <?php if (isset($att['error'])): ?><div class="card-body muted"><?= $e($att['error']) ?></div><?php else: ?>
        <div class="attention" style="border-top:1px solid var(--line)">
            <a href="/admin/photos" class="<?= $att['photos'] > 0 ? 'hot' : 'calm' ?>"><span class="big num"><?= $n($att['photos']) ?></span>
                <span class="what"><b>Photos to check</b><?= $att['photos'] > 0 ? 'oldest ' . $e($ago($att['photosOldest'])) . ' ago' : 'all checked' ?></span></a>
            <a href="<?= $att['reports'] === 0 && $att['commentReports'] > 0 ? '/admin/daily/today' : '/admin/reports' ?>" class="<?= $att['reports'] + $att['commentReports'] > 0 ? 'hot' : 'calm' ?>">
                <span class="big num"><?= $n($att['reports'] + $att['commentReports']) ?></span>
                <span class="what"><b>Open reports</b><?= $att['commentReports'] > 0 ? $n($att['reports']) . ' players · ' . $n($att['commentReports']) . ' comments' : ($att['reports'] > 0 ? 'on players' : 'none open') ?></span></a>
            <a href="/admin/daily/proposals" class="<?= $att['proposals'] > 0 ? 'hot' : 'calm' ?>"><span class="big num"><?= $n($att['proposals']) ?></span>
                <span class="what"><b>Proposals to review</b>challenges and Local twists</span></a>
            <a href="/admin/cities?view=auto" class="<?= $att['cities'] > 0 ? 'hot' : 'calm' ?>"><span class="big num"><?= $n($att['cities']) ?></span>
                <span class="what"><b>New cities</b>created automatically, to check</span></a>
        </div>
        <?php endif; ?>
    </section>

    <div class="grid cols-2-1" style="margin-bottom:16px">
        <!-- Today's challenge -->
        <section class="card">
            <div class="card-head"><h2>Today's challenge</h2>
                <?php if (!empty($today['id'])): ?><a class="link" href="/admin/daily/<?= $e($today['id']) ?>">Open</a><?php endif; ?></div>
            <div class="card-body">
            <?php if (isset($today['error'])): ?><p class="muted"><?= $e($today['error']) ?></p>
            <?php elseif (!$today['exists']): ?>
                <div class="callout bad">No challenge for today. <a href="/admin/daily">Open the calendar</a>.</div>
            <?php else:
                $published = $today['state'] === 'published';
                $run = $today['run'];
                $push = $today['push']; ?>
                <p class="muted" style="font-size:var(--fs-sm)"><?= $e(daily_theme_label($today['theme'], $today['date'], $today['specialId'])) ?></p>
                <p class="today-q"><?= $e($today['text']) ?></p>
                <ul class="checks">
                    <li><span class="st <?= $published ? 'st-ok' : 'st-bad' ?>"><?= $published ? '✓' : '!' ?></span>
                        <?= $published ? 'Published at the drop' : 'Not published (' . $e($today['state']) . ')' ?>
                        <span class="meta"><?= $today['publishedAt'] ? $e(date('H:i', strtotime((string) $today['publishedAt']))) : '' ?>
                            <?= $run && $run['status'] !== 'done' ? ' · drop ' . $e($run['status']) . ($run['error'] ? ': ' . $e(mb_strimwidth((string) $run['error'], 0, 60, '…')) : '') : '' ?></span></li>
                    <li><span class="st <?= $today['langs'] >= 19 ? 'st-ok' : ($today['langs'] > 1 ? 'st-warn' : 'st-bad') ?>"><?= $today['langs'] >= 19 ? '✓' : '!' ?></span>
                        Translated <span class="meta"><a href="/admin/daily/translations"><?= (int) $today['langs'] ?> / 19 languages</a></span></li>
                    <li><span class="st <?= $today['cover'] === 'own' ? 'st-ok' : ($today['cover'] ? 'st-warn' : 'st-bad') ?>"><?= $today['cover'] === 'own' ? '✓' : '!' ?></span>
                        Cover <span class="meta"><?= $today['cover'] === 'own' ? 'its own photo' : ($today['cover'] ? 'the ' . $e($today['cover']) . ' default' : 'none: the app\'s built-in image') ?></span></li>
                    <li><span class="st <?= $today['question'] ? 'st-ok' : 'st-warn' ?>"><?= $today['question'] ? '✓' : '!' ?></span>
                        Comparison question <span class="meta"><?= $today['question'] ? 'set' : 'none' ?></span></li>
                    <li><span class="st <?= $push['sent'] > 0 ? 'st-ok' : ($push['total'] > 0 ? 'st-warn' : 'st-bad') ?>"><?= $push['sent'] > 0 ? '✓' : '!' ?></span>
                        Morning push <span class="meta"><?= $push['total'] === 0 ? 'not queued' : $n($push['sent']) . ' sent' . ($push['waiting'] > 0 ? ' · ' . $n($push['waiting']) . ' waiting for their local morning' : '') ?></span></li>
                </ul>
            <?php endif; ?>
            </div>
        </section>

        <!-- Season top 5 -->
        <section class="card">
            <div class="card-head"><h2><?= $e($top['title'] ?? 'Season') ?></h2><?php if (!empty($top['link'])): ?><a class="link" href="<?= $e($top['link']) ?>">Open</a><?php endif; ?></div>
            <div class="card-body">
            <?php if (isset($top['error'])): ?><p class="muted"><?= $e($top['error']) ?></p>
            <?php elseif (($top['rows'] ?? []) === []): ?><div class="empty" style="padding:20px 0"><b>No points yet</b>The top 5 appears with the first points.</div>
            <?php else: ?>
                <table class="mini"><tbody>
                <?php foreach ($top['rows'] as $r): ?>
                    <tr><td><span class="rank<?= (int) $r['rank'] === 1 ? ' g' : '' ?>"><?= (int) $r['rank'] ?></span>
                        <a href="/admin/users/<?= $e(rawurlencode((string) $r['userId'])) ?>/edit" style="color:var(--text)"><?= $e($r['name']) ?></a>
                        <?= $r['username'] ? '<span class="faint">@' . $e($r['username']) . '</span>' : '' ?></td>
                        <td class="r num"><?= $n($r['points']) ?> pts</td></tr>
                <?php endforeach; ?>
                </tbody></table>
            <?php endif; ?>
            </div>
        </section>
    </div>

    <!-- The week ahead -->
    <section class="card" style="margin-bottom:16px">
        <div class="card-head"><h2>Next 7 days</h2>
            <?php if (!isset($week['error'])):
                $gaps = count(array_filter($week['days'], fn ($d) => $d['gap'])); ?>
                <?= $gaps > 0 ? '<span class="badge b-bad">' . $gaps . ' gap' . ($gaps > 1 ? 's' : '') . '</span>' : '<span class="badge b-ok">All planned</span>' ?>
                <span class="badge <?= $week['reserve'] === 0 ? 'b-bad' : ($week['reserve'] < 3 ? 'b-warn' : 'b-mute') ?>"><?= (int) $week['reserve'] ?> in reserve</span>
            <?php endif; ?>
            <a class="link" href="/admin/daily">Calendar</a></div>
        <div class="card-body">
        <?php if (isset($week['error'])): ?><p class="muted"><?= $e($week['error']) ?></p><?php else: ?>
            <div class="week">
            <?php foreach ($week['days'] as $d):
                $label = date('D j M', strtotime($d['date'])); ?>
                <a class="day<?= $d['gap'] ? ' gap' : '' ?>" href="<?= $d['id'] ? '/admin/daily/' . $e($d['id']) : '/admin/daily/new?date=' . $e($d['date']) ?>">
                    <span class="d"><?= $e($label) ?></span>
                    <span class="q"><?= $d['gap'] ? ($d['exists'] ? 'Draft, not scheduled' : 'Nothing planned') : $e($d['text']) ?></span>
                    <span class="t">
                    <?php if ($d['gap']): ?><span class="badge b-bad"><?= $d['exists'] ? 'Schedule it' : 'Plan it' ?></span>
                    <?php else: ?>
                        <?= $d['langs'] >= 19 ? '<span class="badge b-ok">19 lang.</span>' : '<span class="badge b-warn">' . (int) $d['langs'] . '/19</span>' ?>
                        <?= $d['cover'] === null ? '<span class="badge b-warn">no cover</span>' : '' ?>
                        <?= $d['state'] === 'reserve_used' ? '<span class="badge b-mute">reserve</span>' : '' ?>
                    <?php endif; ?>
                    </span>
                </a>
            <?php endforeach; ?>
            </div>
            <?php if ($week['reserve'] === 0): ?><div class="callout bad" style="margin-top:12px">The reserve is empty: a day with nothing planned will publish nothing. <a href="/admin/daily/reserve">Add reserve challenges</a>.</div><?php endif; ?>
        <?php endif; ?>
        </div>
    </section>

    <div class="grid cols-2-1">
        <!-- Photos, 14 days -->
        <section class="card">
            <div class="card-head"><h2>Photos per day</h2><span class="hint">last 14 challenges</span></div>
            <div class="card-body">
            <?php if (isset($bars['error'])): ?><p class="muted"><?= $e($bars['error']) ?></p><?php else:
                $max = max(1, ...array_column($bars['days'], 'photos')); ?>
                <div class="bars" role="img" aria-label="Photos per day over the last 14 days">
                <?php foreach ($bars['days'] as $i => $b): ?>
                    <span class="<?= $i === count($bars['days']) - 1 ? 'now' : '' ?>" style="height:<?= max(2, (int) round(100 * $b['photos'] / $max)) ?>%"
                          title="<?= $e(date('D j M', strtotime($b['date']))) ?>: <?= (int) $b['photos'] ?> photos"></span>
                <?php endforeach; ?>
                </div>
                <div class="bars-x"><?php foreach ($bars['days'] as $i => $b): ?><span><?= $i % 2 === (count($bars['days']) - 1) % 2 ? $e(date('j', strtotime($b['date']))) : '' ?></span><?php endforeach; ?></div>
                <p class="hint" style="margin-top:8px">Peak <?= $n($max) ?> · total <?= $n(array_sum(array_column($bars['days'], 'photos'))) ?> photos in 14 days</p>
            <?php endif; ?>
            </div>
        </section>

        <!-- Recent errors -->
        <section class="card">
            <div class="card-head"><h2>Recent errors</h2><span class="hint">last 24 h</span></div>
            <div class="card-body">
            <?php if ($errors === null): ?>
                <p class="muted" style="font-size:var(--fs-sm)">Connect Sentry to see the latest errors here: add <code>SENTRY_API_TOKEN</code> (scope <code>event:read</code> only),
                    <code>SENTRY_ORG</code> and <code>SENTRY_PROJECT_ID</code> on Render. See docs/admin-guide.md.</p>
            <?php elseif (isset($errors['error'])): ?>
                <div class="callout warn">Sentry didn't answer: <?= $e($errors['error']) ?></div>
            <?php elseif ($errors['issues'] === []): ?>
                <div class="empty" style="padding:20px 0"><b>No new errors</b>Nothing unresolved in the last 24 hours.</div>
            <?php else: foreach ($errors['issues'] as $i): ?>
                <a class="err-row" href="<?= $e($i['link']) ?>" target="_blank" rel="noopener">
                    <b><?= $e($i['title']) ?></b>
                    <span><?= $e($i['project']) ?> · <?= $n($i['count']) ?> events<?= $i['users'] > 0 ? ' · ' . $n($i['users']) . ' users' : '' ?> · last <?= $e($ago($i['lastSeen'])) ?> ago</span>
                </a>
            <?php endforeach; endif; ?>
            </div>
        </section>
    </div>
</div>
<?php
admin_foot();
