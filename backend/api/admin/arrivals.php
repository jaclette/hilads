<?php

declare(strict_types=1);

admin_require_login();

$pdo = Database::pdo();

// Arrivals are stored as city-channel system messages (type='system',
// event='join'); nickname = who arrived. channels.id === messages.channel_id
// (city = "city_<n>"). Day boundaries computed in UTC for determinism.
$channel = trim($_GET['channel'] ?? '');

// ── Date range ──────────────────────────────────────────────────────────────
// Back-compat: a legacy ?date= maps to from=to=date.
$today = gmdate('Y-m-d');
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
$ds = $from . ' 00:00:00+00';
$de = (new DateTime($to . ' 00:00:00', new DateTimeZone('UTC')))
          ->modify('+1 day')->format('Y-m-d H:i:s') . '+00';
$rangeLabel = $from === $to ? $from : "$from → $to";

// Per-city colour palette (stable within the page; assigned by total desc).
$PALETTE = ['#FF7A3C','#3b82f6','#22c55e','#a855f7','#eab308','#ec4899',
            '#14b8a6','#f97316','#8b5cf6','#06b6d4','#ef4444','#84cc16'];

admin_head('Arrivals');
admin_nav('/admin/arrivals');
?>
<div class="admin-main">
<?php if ($channel !== ''):
    // ── City mode: who arrived in this city over the range ──────────────────
    $chStmt = $pdo->prepare("SELECT id, type, name FROM channels WHERE id = :id");
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
        SELECT id, nickname, user_id, guest_id,
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

    $backHref = '/admin/arrivals?from=' . urlencode($from) . '&to=' . urlencode($to) . '&view=' . urlencode($view);
    ?>
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <h1 class="page-title" style="margin-bottom:0">
            <span class="badge" style="background:#3b82f622;color:#3b82f6;border:1px solid #3b82f655">City</span>
            <?= htmlspecialchars($ch['name'] ?? '(untitled)', ENT_QUOTES) ?>
            <span style="color:#555;font-size:14px;font-weight:400"><?= number_format($total) ?> arrivals · <?= htmlspecialchars($rangeLabel, ENT_QUOTES) ?></span>
        </h1>
        <a href="<?= $backHref ?>" class="btn btn-secondary btn-sm">← Back</a>
    </div>
    <div class="td-mono" style="color:#555;margin-bottom:16px;font-size:11px"><?= htmlspecialchars($ch['id'], ENT_QUOTES) ?></div>

    <div class="table-wrapper">
        <table>
            <thead><tr><th style="width:160px">When</th><th>Who arrived</th></tr></thead>
            <tbody>
            <?php if (empty($arrivals)): ?>
                <tr><td colspan="2" class="no-results">No arrivals in this range.</td></tr>
            <?php else: foreach ($arrivals as $a):
                $who = $a['nickname'] ?: '(no name)';
                if ($a['user_id'] !== null) {
                    $idBadge = '<span class="badge badge-registered" title="' . htmlspecialchars($a['user_id'], ENT_QUOTES) . '">Reg.</span>';
                    $profile = '/admin/users?q=' . urlencode($a['user_id']);
                } elseif ($a['guest_id'] !== null) {
                    $idBadge = '<span class="badge badge-guest" title="' . htmlspecialchars($a['guest_id'], ENT_QUOTES) . '">Guest</span>';
                    $profile = null;
                } else { $idBadge = ''; $profile = null; }
                ?>
                <tr>
                    <td style="color:#888;white-space:nowrap">✨ <?= date('M d, H:i', (int) $a['created_ts']) ?></td>
                    <td>
                        <?= $idBadge ?>
                        <?php if ($profile): ?>
                            <a href="<?= $profile ?>" style="color:#ddd;margin-left:4px"><?= htmlspecialchars($who, ENT_QUOTES) ?></a>
                        <?php else: ?>
                            <span style="color:#ccc;margin-left:4px"><?= htmlspecialchars($who, ENT_QUOTES) ?></span>
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
    <h1 class="page-title">Arrivals <span style="color:#555;font-size:14px;font-weight:400">by city</span></h1>
    <p style="color:#777;margin:-8px 0 16px;font-size:13px">How many people arrived in each city over a date range. Click a city to see who arrived.</p>

    <!-- Range + view controls -->
    <form method="GET" action="/admin/arrivals" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">
        <span style="color:#888;font-size:13px;font-weight:600">From</span>
        <input type="date" name="from" value="<?= htmlspecialchars($from, ENT_QUOTES) ?>" max="<?= $today ?>"
               onchange="this.form.submit()" onclick="if(this.showPicker)this.showPicker()"
               style="background:#1a1a1a;border:1px solid #333;color:#eee;border-radius:6px;padding:6px 8px;font-size:13px">
        <span style="color:#888;font-size:13px;font-weight:600">to</span>
        <input type="date" name="to" value="<?= htmlspecialchars($to, ENT_QUOTES) ?>" max="<?= $today ?>"
               onchange="this.form.submit()" onclick="if(this.showPicker)this.showPicker()"
               style="background:#1a1a1a;border:1px solid #333;color:#eee;border-radius:6px;padding:6px 8px;font-size:13px">
        <input type="hidden" name="view" value="<?= htmlspecialchars($view, ENT_QUOTES) ?>">
        <a href="/admin/arrivals" class="btn btn-secondary btn-sm">Today</a>
    </form>

    <!-- View toggle: Accumulation vs Per day -->
    <div style="display:flex;gap:8px;margin-bottom:16px">
        <?php
        $viewOpts = ['sum' => '∑ Accumulation', 'daily' => '📅 Per day'];
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
            SELECT c.id, c.name,
                   (m.created_at AT TIME ZONE 'UTC')::date AS day,
                   COUNT(m.id) AS cnt
            FROM channels c
            JOIN messages m ON m.channel_id = c.id
            WHERE c.type = 'city'
              AND m.type = 'system' AND m.event = 'join'
              AND m.created_at >= :ds::timestamptz AND m.created_at < :de::timestamptz
            GROUP BY c.id, c.name, day
        ");
        $stmt->execute([':ds' => $ds, ':de' => $de]);
        $rows = $stmt->fetchAll();

        $daily = []; $dayTotals = []; $cityTotals = []; $cityName = [];
        foreach ($rows as $r) {
            $cid = $r['id']; $day = $r['day']; $cnt = (int) $r['cnt'];
            $daily[$day][$cid] = $cnt;
            $dayTotals[$day]   = ($dayTotals[$day] ?? 0) + $cnt;
            $cityTotals[$cid]  = ($cityTotals[$cid] ?? 0) + $cnt;
            $cityName[$cid]    = $r['name'];
        }
        arsort($cityTotals);
        $cityColor = [];
        $i = 0;
        foreach ($cityTotals as $cid => $t) { $cityColor[$cid] = $PALETTE[$i % count($PALETTE)]; $i++; }
        $maxDayTotal = $dayTotals ? max($dayTotals) : 0;
        $grandTotal  = array_sum($cityTotals);
        ?>
        <p style="color:#666;font-size:13px;margin:0 0 12px"><?= count($cityTotals) ?> cities · <?= number_format($grandTotal) ?> arrivals · <?= htmlspecialchars($rangeLabel, ENT_QUOTES) ?> (UTC)</p>

        <?php if (empty($cityTotals)): ?>
            <p class="no-results" style="padding:30px 0">No arrivals in this range.</p>
        <?php else: ?>
            <!-- Legend -->
            <div style="display:flex;flex-wrap:wrap;gap:12px;margin-bottom:16px">
                <?php foreach ($cityColor as $cid => $col): ?>
                    <a href="/admin/arrivals?channel=<?= urlencode($cid) ?>&from=<?= urlencode($from) ?>&to=<?= urlencode($to) ?>"
                       style="display:flex;align-items:center;gap:6px;text-decoration:none;font-size:13px;color:#ddd">
                        <span style="width:12px;height:12px;border-radius:3px;background:<?= $col ?>;display:inline-block"></span>
                        <?= htmlspecialchars($cityName[$cid] ?? '?', ENT_QUOTES) ?>
                        <span style="color:#666">(<?= number_format((int) $cityTotals[$cid]) ?>)</span>
                    </a>
                <?php endforeach; ?>
            </div>

            <!-- Stacked bar per day -->
            <div style="background:#161310;border:1px solid #2a2a2a;border-radius:12px;padding:14px 18px">
                <?php
                $cursor = new DateTime($from);
                $end    = new DateTime($to);
                while ($cursor <= $end):
                    $day      = $cursor->format('Y-m-d');
                    $dayTotal = $dayTotals[$day] ?? 0;
                    ?>
                    <div style="display:flex;align-items:center;gap:12px;padding:5px 0">
                        <span style="width:90px;flex-shrink:0;color:#aaa;font-size:12px;white-space:nowrap"><?= $cursor->format('D M d') ?></span>
                        <span style="flex:1;height:18px;background:rgba(255,255,255,0.05);border-radius:5px;overflow:hidden;display:flex">
                            <?php foreach ($cityColor as $cid => $col):
                                $cnt = $daily[$day][$cid] ?? 0;
                                if ($cnt <= 0) continue;
                                $w = $maxDayTotal > 0 ? ($cnt / $maxDayTotal * 100) : 0;
                                ?>
                                <span title="<?= htmlspecialchars(($cityName[$cid] ?? '?') . ': ' . $cnt, ENT_QUOTES) ?>"
                                      style="height:100%;width:<?= $w ?>%;background:<?= $col ?>"></span>
                            <?php endforeach; ?>
                        </span>
                        <span style="width:46px;text-align:right;color:#fff;font-weight:700;font-size:13px"><?= number_format($dayTotal) ?></span>
                    </div>
                    <?php $cursor->modify('+1 day'); endwhile; ?>
            </div>
        <?php endif; ?>

    <?php else:
        // Accumulation: sum per city over the whole range.
        $cityStmt = $pdo->prepare("
            SELECT c.id, c.name,
                   COUNT(m.id)        AS cnt,
                   MAX(m.created_at)  AS last_at
            FROM channels c
            JOIN messages m ON m.channel_id = c.id
            WHERE c.type = 'city'
              AND m.type = 'system' AND m.event = 'join'
              AND m.created_at >= :ds::timestamptz AND m.created_at < :de::timestamptz
            GROUP BY c.id, c.name
            ORDER BY cnt DESC, c.name ASC
        ");
        $cityStmt->execute([':ds' => $ds, ':de' => $de]);
        $cities = $cityStmt->fetchAll();
        $totalArr = 0;
        foreach ($cities as $r) { $totalArr += (int) $r['cnt']; }
        // One colour per city (by rank).
        $barColors = [];
        $i = 0;
        foreach ($cities as $r) { $barColors[$r['id']] = $PALETTE[$i % count($PALETTE)]; $i++; }
        ?>
        <p style="color:#666;font-size:13px;margin:0 0 12px"><?= count($cities) ?> cities · <?= number_format($totalArr) ?> arrivals · <?= htmlspecialchars($rangeLabel, ENT_QUOTES) ?> (UTC)</p>

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
                            <strong><?= htmlspecialchars($c['name'] ?? '(untitled)', ENT_QUOTES) ?></strong>
                        </td>
                        <td><strong style="color:#fff;font-size:15px"><?= number_format((int) $c['cnt']) ?></strong></td>
                        <td style="color:#888;white-space:nowrap"><?= $lastTs ? date('M d, H:i', $lastTs) : '-' ?></td>
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
