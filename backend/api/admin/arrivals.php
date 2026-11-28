<?php

declare(strict_types=1);

admin_require_login();
require_once __DIR__ . '/_people.php';

$pdo = Database::pdo();

// Arrivals are stored as city-channel system messages (type='system',
// event='join'); nickname = who arrived. channels.id === messages.channel_id
// (city = "city_<n>"). Day boundaries computed in UTC for determinism.
$channel = trim($_GET['channel'] ?? '');

// ── Date range ──────────────────────────────────────────────────────────────
// Back-compat: a legacy ?date= maps to from=to=date.
$today = date('Y-m-d');
$valid = static fn($d): string => preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $d) ? (string) $d : '';
$legacy = $valid($_GET['date'] ?? '');
$from = $valid($_GET['from'] ?? '') ?: ($legacy ?: $today);
$to   = $valid($_GET['to']   ?? '') ?: ($legacy ?: $from);
if ($to < $from) { $to = $from; }
// Cap the window so the aggregate query stays bounded.
if ((strtotime($to) - strtotime($from)) / 86400 > 92) {
    $to = (new DateTime($from))->modify('+92 days')->format('Y-m-d');
}
$view = (($_GET['view'] ?? '') === 'daily') ? 'daily' : 'sum';

// UTC bounds for [from, to] inclusive.
$ds = $from . ' 00:00:00+07:00';
$de = (new DateTime($to . ' 00:00:00', new DateTimeZone('Asia/Ho_Chi_Minh')))
          ->modify('+1 day')->format('Y-m-d H:i:s') . '+07:00';
$rangeLabel = $from === $to ? $from : "$from → $to";

// Per-city colour palette (stable within the page; assigned by total desc).
$PALETTE = ['#FF7A3C','#3b82f6','#22c55e','#a855f7','#eab308','#ec4899',
            '#14b8a6','#f97316','#8b5cf6','#06b6d4','#ef4444','#84cc16'];

// ISO-2 → flag emoji (regional-indicator pair). Empty when missing/invalid.
// Shared by every view (city list, charts, city-detail header).
$isoFlag = static function (?string $cc): string {
    if (!$cc || !preg_match('/^[A-Za-z]{2}$/', $cc)) return '';
    $cc = strtoupper($cc);
    return mb_chr(127397 + ord($cc[0])) . mb_chr(127397 + ord($cc[1]));
};

admin_head('Arrivals');
admin_nav('/admin/arrivals');
?>
<div class="admin-main">
<?php if ($channel !== ''):
    // ── City mode: who arrived in this city over the range ──────────────────
    $chStmt = $pdo->prepare("
        SELECT c.id, c.type, c.name, ci.country
        FROM channels c LEFT JOIN cities ci ON ci.channel_id = c.id
        WHERE c.id = :id
    ");
    $chStmt->execute([':id' => $channel]);
    $ch = $chStmt->fetch();

    if (!$ch) {
        echo '<h1 class="page-title">City not found</h1>';
        echo '<p style="margin-top:12px"><a href="/admin/arrivals" class="btn btn-secondary btn-sm">← Back</a></p>';
        echo '</div>';
        admin_foot();
        return;
    }

    $perPage = 200;
    $page    = max(1, (int)($_GET['page'] ?? 1));
    $offset  = ($page - 1) * $perPage;

    $cntStmt = $pdo->prepare("
        SELECT COUNT(*) FROM messages
        WHERE channel_id = :cid AND type = 'system' AND event = 'join'
          AND created_at >= :ds::timestamptz AND created_at < :de::timestamptz
    ");
    $cntStmt->execute([':cid' => $channel, ':ds' => $ds, ':de' => $de]);
    $total = (int) $cntStmt->fetchColumn();
    $pages = (int) ceil($total / $perPage);

    $aStmt = $pdo->prepare("
        SELECT id, nickname, user_id, guest_id, country, platform, ip_address IS NOT NULL AS has_ip, ip_hash, geo_city, payload->>'how' AS how,
               EXTRACT(EPOCH FROM created_at)::INTEGER AS created_ts
        FROM messages
        WHERE channel_id = :cid AND type = 'system' AND event = 'join'
          AND created_at >= :ds::timestamptz AND created_at < :de::timestamptz
        ORDER BY created_at DESC
        LIMIT :lim OFFSET :off
    ");
    $aStmt->bindValue(':cid', $channel);
    $aStmt->bindValue(':ds', $ds);
    $aStmt->bindValue(':de', $de);
    $aStmt->bindValue(':lim', $perPage, PDO::PARAM_INT);
    $aStmt->bindValue(':off', $offset, PDO::PARAM_INT);
    $aStmt->execute();
    $arrivals = $aStmt->fetchAll();

    // Guests who later signed up (GuestLinks): their account, and the first arrival of each account
    // (the guest's first visit, where the "New sign-up" badge goes when the account came after it).
    $links = GuestLinks::accountsFor(array_column(array_filter($arrivals, fn ($a) => $a['user_id'] === null), 'guest_id'));
    $accIds = array_values(array_unique(array_filter(array_merge(array_column($arrivals, 'user_id'), array_column($links, 'user_id')))));
    $firstArrival = [];
    $accounts = [];
    if ($accIds !== []) {
        $in = implode(',', array_fill(0, count($accIds), '?'));
        $st = $pdo->prepare("
            SELECT x.uid, min(x.at) AS first FROM (
                SELECT m.user_id AS uid, m.created_at AS at FROM messages m WHERE m.type = 'system' AND m.event = 'join' AND m.user_id IN ($in)
                UNION ALL
                SELECT gl.user_id, m.created_at FROM user_guest_links gl JOIN messages m ON m.guest_id = gl.guest_id AND m.type = 'system' AND m.event = 'join'
                WHERE gl.user_id IN ($in)
            ) x GROUP BY x.uid
        ");
        $st->execute(array_merge($accIds, $accIds));
        foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) $firstArrival[$r['uid']] = strtotime((string) $r['first']);
        $st = $pdo->prepare("SELECT id, username, display_name, created_at FROM users WHERE id IN ($in)");
        $st->execute($accIds);
        foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) $accounts[$r['id']] = $r;
    }

    $backHref = '/admin/arrivals?from=' . urlencode($from) . '&to=' . urlencode($to) . '&view=' . urlencode($view);
    ?>
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <h1 class="page-title" style="margin-bottom:0">
            <span class="badge" style="background:#3b82f622;color:var(--info);border:1px solid #3b82f655">City</span>
            <?php $chFlag = $isoFlag($ch['country'] ?? ''); if ($chFlag) echo '<span style="margin-right:2px">' . $chFlag . '</span> '; ?><?= htmlspecialchars(people_city($ch['name'] ?? '') ?: '(untitled)', ENT_QUOTES) ?>
            <span style="color:var(--faint);font-size:14px;font-weight:400"><?= number_format($total) ?> arrivals · <?= htmlspecialchars($rangeLabel, ENT_QUOTES) ?></span>
        </h1>
        <a href="<?= $backHref ?>" class="btn btn-secondary btn-sm">← Back</a>
    </div>
    <div style="margin-bottom:16px"></div>

    <div class="table-wrapper">
        <table>
            <thead><tr><th style="width:160px">When</th><th>Who arrived</th><th style="width:150px" title="Country and approximate city of the connection, and a network id (the same id on two rows = the same connection). Full IPs: super admins only, kept 30 days.">From</th><th style="width:150px" title="How this city was chosen. Recorded since 2026-11-27 (older arrivals and older apps: —).">How</th><th style="width:110px">Platform</th><th style="width:90px">Actions</th></tr></thead>
            <tbody>
            <?php if (empty($arrivals)): ?>
                <tr><td colspan="6" class="no-results">No arrivals in this range.</td></tr>
            <?php else:
                // Platform → label + emoji. Unknown/legacy rows (pre-capture) show "—".
                $platformBadge = static function (?string $p): string {
                    return match ($p) {
                        'ios'     => '<span style="color:var(--text);font-size:12px">🍎 iOS</span>',
                        'android' => '<span style="color:var(--text);font-size:12px">🤖 Android</span>',
                        'web'     => '<span style="color:var(--text);font-size:12px">🌐 Web</span>',
                        default   => '<span style="color:var(--faint)">—</span>',
                    };
                };
                // How the city was chosen (the join's payload), in plain words.
                $howLabel = static function (?string $h): string {
                    [$label, $tip] = match ($h) {
                        'ip'     => ['📍 By IP', 'Placed in the city of their connection (home page, no GPS)'],
                        'gps'    => ['🛰 GPS', 'Their phone or browser location'],
                        'link'   => ['🔗 City link', 'Opened a link to this city: its page, an event, a challenge or a plan'],
                        'picked' => ['👆 Picked', 'Chose the city themselves (city picker or switch)'],
                        'saved'  => ['↩ Returning', 'Came back to the city of their last visit'],
                        default  => ['—', 'Not recorded (before 2026-11-27, or an older app)'],
                    };
                    return '<span title="' . htmlspecialchars($tip, ENT_QUOTES) . '" style="font-size:12px;color:' . ($h === null ? 'var(--faint)' : 'var(--text)') . '">' . $label . '</span>';
                };
                $cityCc = strtoupper((string) ($ch['country'] ?? ''));
                foreach ($arrivals as $a):
                $who = $a['nickname'] ?: '(no name)';
                $wasGuest = null;
                $accId = $a['user_id'] ?? ($links[$a['guest_id'] ?? '']['user_id'] ?? null);
                $newSignup = false;
                if ($a['user_id'] === null && $accId !== null) {
                    // A guest who later signed up: their handle, "was guest ElectricWolf".
                    $acc = $accounts[$accId] ?? null;
                    $wasGuest = $who;
                    $who = $acc ? ($acc['username'] ? '@' . $acc['username'] : $acc['display_name']) : $who;
                    $newSignup = isset($firstArrival[$accId]) && $firstArrival[$accId] === (int) $a['created_ts']
                        && $acc !== null && (int) $acc['created_at'] >= (int) $a['created_ts'] - 60;
                }
                if ($accId !== null) {
                    $idBadge = '<span class="badge badge-registered" title="An account">Reg.</span>';
                    $profile = '/admin/users/' . urlencode($accId) . '/edit';
                } elseif ($a['guest_id'] !== null) {
                    $idBadge = '<span class="badge badge-guest" title="' . htmlspecialchars($a['guest_id'], ENT_QUOTES) . '">Guest</span>';
                    $profile = null;
                } else { $idBadge = ''; $profile = null; }
                ?>
                <tr>
                    <td style="color:var(--faint);white-space:nowrap">✨ <?= date('M d, H:i', (int) $a['created_ts']) ?></td>
                    <td>
                        <?= $idBadge ?>
                        <?php if ($profile): ?>
                            <a href="<?= $profile ?>" style="color:var(--text);margin-left:4px"><?= htmlspecialchars($who, ENT_QUOTES) ?></a>
                        <?php else: ?>
                            <span style="color:var(--muted);margin-left:4px"><?= htmlspecialchars($who, ENT_QUOTES) ?></span>
                        <?php endif; ?>
                        <?php if ($newSignup): ?><span class="badge b-ok" style="margin-left:4px" title="This guest's first visit; they created an account afterwards">New sign-up</span><?php endif; ?>
                        <?php if ($wasGuest !== null): ?><div style="color:var(--faint);font-size:11px;margin-top:2px">was guest <?= htmlspecialchars($wasGuest, ENT_QUOTES) ?></div><?php endif; ?>
                    </td>
                    <td style="white-space:nowrap"><?= people_where($a['country'] ?? null, $a['geo_city'] ?? null, $a['ip_hash'] ?? null,
                        DailyProofRepository::bool($a['has_ip']) ? ['message', $a['id']] : null) ?></td>
                    <td style="white-space:nowrap">
                        <?= $howLabel($a['how'] ?? null) ?>
                        <?php if ($cityCc !== '' && !empty($a['country']) && strtoupper($a['country']) !== $cityCc): ?>
                            <div><span class="badge" style="background:var(--surface-2);color:var(--muted);font-size:11px" title="Connected from another country than the city's (<?= htmlspecialchars(strtoupper($a['country']), ENT_QUOTES) ?> ≠ <?= htmlspecialchars($cityCc, ENT_QUOTES) ?>): browsing from abroad, travelling, or a VPN">Remote</span></div>
                        <?php endif; ?>
                    </td>
                    <td style="white-space:nowrap"><?= $platformBadge($a['platform'] ?? null) ?></td>
                    <td>
                        <?php if ($a['guest_id'] !== null): ?>
                            <form method="POST" action="/admin/bans/add"
                                  data-confirm="Ban <?= htmlspecialchars($who, ENT_QUOTES) ?> for good?" data-confirm-text="The guest and the IP addresses they arrived or posted from can't post anymore, with no end date. You can lift it on the Bans page." data-confirm-button="Ban">
                                <?= csrf_input() ?>
                                <input type="hidden" name="target" value="guest_fanout">
                                <input type="hidden" name="value" value="<?= htmlspecialchars($a['guest_id'], ENT_QUOTES) ?>">
                                <input type="hidden" name="reason" value="arrival ban">
                                <input type="hidden" name="days" value="0">
                                <button type="submit" class="btn btn-danger btn-sm">Ban</button>
                            </form>
                        <?php else: ?>
                            <span style="color:var(--faint);font-size:11px">-</span>
                        <?php endif; ?>
                    </td>
                </tr>
            <?php endforeach; endif; ?>
            </tbody>
        </table>
    </div>

    <?php if ($pages > 1): ?>
        <div class="pagination">
            <?php $qs = 'channel=' . urlencode($channel) . '&from=' . urlencode($from) . '&to=' . urlencode($to) . '&view=' . urlencode($view); ?>
            <?php if ($page > 1): ?><a href="?<?= $qs ?>&page=<?= $page - 1 ?>">← Prev</a> <span class="sep">|</span><?php endif; ?>
            <span>Page <span class="current"><?= $page ?></span> of <?= $pages ?></span>
            <?php if ($page < $pages): ?><span class="sep">|</span> <a href="?<?= $qs ?>&page=<?= $page + 1 ?>">Next →</a><?php endif; ?>
        </div>
    <?php endif; ?>

<?php else:
    // ── Range views: accumulation (sum) or per-day breakdown ────────────────
    $prevFrom = (new DateTime($from))->modify('-1 day')->format('Y-m-d');
    $nextTo   = (new DateTime($to))->modify('+1 day')->format('Y-m-d');
    ?>
    <?= ui_page_head('Moderation', 'Arrivals', 'Who arrived in each city over a date range ("X arrived" in the city chat). Open a city to see who arrived, and ban a guest if needed.') ?>

    <!-- Range + view controls -->
    <form method="GET" action="/admin/arrivals" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">
        <span style="color:var(--faint);font-size:13px;font-weight:600">From</span>
        <input type="date" name="from" value="<?= htmlspecialchars($from, ENT_QUOTES) ?>" max="<?= $today ?>"
               onchange="this.form.submit()" onclick="if(this.showPicker)this.showPicker()"
               style="background:var(--surface);border:1px solid var(--line);color:var(--text);border-radius:6px;padding:6px 8px;font-size:13px">
        <span style="color:var(--faint);font-size:13px;font-weight:600">to</span>
        <input type="date" name="to" value="<?= htmlspecialchars($to, ENT_QUOTES) ?>" max="<?= $today ?>"
               onchange="this.form.submit()" onclick="if(this.showPicker)this.showPicker()"
               style="background:var(--surface);border:1px solid var(--line);color:var(--text);border-radius:6px;padding:6px 8px;font-size:13px">
        <input type="hidden" name="view" value="<?= htmlspecialchars($view, ENT_QUOTES) ?>">
        <a href="/admin/arrivals" class="btn btn-secondary btn-sm">Today</a>
    </form>

    <!-- View toggle: Accumulation vs Per day -->
    <div style="display:flex;gap:8px;margin-bottom:16px">
        <?php
        $viewOpts = ['sum' => 'Total', 'daily' => 'Per day'];
        foreach ($viewOpts as $vk => $vlabel):
            $active = $view === $vk;
            $href = '/admin/arrivals?from=' . urlencode($from) . '&to=' . urlencode($to) . '&view=' . $vk;
        ?>
            <a href="<?= $href ?>" class="btn btn-sm <?= $active ? 'btn-primary' : 'btn-secondary' ?>"><?= $vlabel ?></a>
        <?php endforeach; ?>
    </div>

    <?php
    if ($view === 'daily'):
        // Per-(city, UTC-day) counts pivoted in PHP.
        $stmt = $pdo->prepare("
            SELECT c.id, c.name, ci.country,
                   (m.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS day,
                   COUNT(m.id) AS cnt
            FROM channels c
            JOIN messages m ON m.channel_id = c.id
            LEFT JOIN cities ci ON ci.channel_id = c.id
            WHERE c.type = 'city'
              AND m.type = 'system' AND m.event = 'join'
              AND m.created_at >= :ds::timestamptz AND m.created_at < :de::timestamptz
            GROUP BY c.id, c.name, ci.country, day
        ");
        $stmt->execute([':ds' => $ds, ':de' => $de]);
        $rows = $stmt->fetchAll();

        $daily = []; $dayTotals = []; $cityTotals = []; $cityName = []; $cityFlag = [];
        foreach ($rows as $r) {
            $cid = $r['id']; $day = $r['day']; $cnt = (int) $r['cnt'];
            $daily[$day][$cid] = $cnt;
            $dayTotals[$day]   = ($dayTotals[$day] ?? 0) + $cnt;
            $cityTotals[$cid]  = ($cityTotals[$cid] ?? 0) + $cnt;
            $cityName[$cid]    = people_city($r['name']);
            $cityFlag[$cid]    = $isoFlag($r['country'] ?? '');
        }
        arsort($cityTotals);
        $cityColor = [];
        $i = 0;
        foreach ($cityTotals as $cid => $t) { $cityColor[$cid] = $PALETTE[$i % count($PALETTE)]; $i++; }
        $maxDayTotal = $dayTotals ? max($dayTotals) : 0;
        $grandTotal  = array_sum($cityTotals);
        ?>
        <p style="color:var(--faint);font-size:13px;margin:0 0 12px"><?= count($cityTotals) ?> cities · <?= number_format($grandTotal) ?> arrivals · <?= htmlspecialchars($rangeLabel, ENT_QUOTES) ?> (UTC+7)</p>

        <?php if (empty($cityTotals)): ?>
            <p class="no-results" style="padding:30px 0">No arrivals in this range.</p>
        <?php else:
            $legendHref = static fn(string $id): string =>
                '/admin/arrivals?channel=' . urlencode($id) . '&from=' . urlencode($from) . '&to=' . urlencode($to);
            $segHref = static fn(string $id, string $day): string =>
                '/admin/arrivals?channel=' . urlencode($id) . '&from=' . urlencode($day) . '&to=' . urlencode($day);
            include __DIR__ . '/_daily_stacked_chart.php';
        endif; ?>

    <?php else:
        // Accumulation: sum per city over the whole range.
        $cityStmt = $pdo->prepare("
            SELECT c.id, c.name, ci.country,
                   COUNT(m.id)        AS cnt,
                   MAX(m.created_at)  AS last_at
            FROM channels c
            JOIN messages m ON m.channel_id = c.id
            LEFT JOIN cities ci ON ci.channel_id = c.id
            WHERE c.type = 'city'
              AND m.type = 'system' AND m.event = 'join'
              AND m.created_at >= :ds::timestamptz AND m.created_at < :de::timestamptz
            GROUP BY c.id, c.name, ci.country
            ORDER BY cnt DESC, c.name ASC
        ");
        $cityStmt->execute([':ds' => $ds, ':de' => $de]);
        $cities = $cityStmt->fetchAll();
        foreach ($cities as &$cr) { $cr['name'] = people_city($cr['name']); } unset($cr);   // Hilads names ("Saigon")
        $totalArr = 0;
        foreach ($cities as $r) { $totalArr += (int) $r['cnt']; }
        // One colour per city (by rank).
        $barColors = [];
        $i = 0;
        foreach ($cities as $r) { $barColors[$r['id']] = $PALETTE[$i % count($PALETTE)]; $i++; }
        ?>
        <p style="color:var(--faint);font-size:13px;margin:0 0 12px"><?= count($cities) ?> cities · <?= number_format($totalArr) ?> arrivals · <?= htmlspecialchars($rangeLabel, ENT_QUOTES) ?> (UTC+7)</p>

        <?php
        $chartLink = static fn(string $id): string =>
            '/admin/arrivals?channel=' . urlencode($id) . '&from=' . urlencode($from) . '&to=' . urlencode($to);
        include __DIR__ . '/_city_bar_chart.php';
        ?>

        <div class="table-wrapper">
            <table>
                <thead>
                    <tr><th>City</th><th style="width:120px">Arrivals</th><th style="width:150px">Last arrival</th><th style="width:130px">Actions</th></tr>
                </thead>
                <tbody>
                <?php if (empty($cities)): ?>
                    <tr><td colspan="4" class="no-results">No city had arrivals in this range.</td></tr>
                <?php else: foreach ($cities as $c):
                    $lastTs = $c['last_at'] ? strtotime($c['last_at']) : 0;
                    ?>
                    <tr>
                        <td>
                            <span style="width:10px;height:10px;border-radius:3px;background:<?= $barColors[$c['id']] ?>;display:inline-block;margin-right:6px"></span>
                            <?php $cFlag = $isoFlag($c['country'] ?? ''); if ($cFlag) echo '<span style="margin-right:4px">' . $cFlag . '</span>'; ?>
                            <strong><?= htmlspecialchars(people_city($c['name'] ?? '') ?: '(untitled)', ENT_QUOTES) ?></strong>
                        </td>
                        <td><strong style="color:var(--text);font-size:15px"><?= number_format((int) $c['cnt']) ?></strong></td>
                        <td style="color:var(--faint);white-space:nowrap"><?= $lastTs ? date('M d, H:i', $lastTs) : '-' ?></td>
                        <td><a href="/admin/arrivals?channel=<?= urlencode($c['id']) ?>&from=<?= urlencode($from) ?>&to=<?= urlencode($to) ?>" class="btn btn-primary btn-sm">Who arrived →</a></td>
                    </tr>
                <?php endforeach; endif; ?>
                </tbody>
            </table>
        </div>
    <?php endif; ?>
<?php endif; ?>
</div>
<?php
admin_foot();
