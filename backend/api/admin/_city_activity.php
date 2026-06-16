<?php
// Shared "<noun> by city" analytics view: From/To range + Accumulation/Per-day
// toggle, colour-per-city bar chart (sum) or stacked-per-day chart (daily).
// Each page (challenges / hangouts / events) supplies its own count SQL and a
// drill-in param; the city links point back to "$pageBase?<cityParam>=<id>".
//
// Expects in scope:
//   $pdo, $PALETTE
//   $pageBase   e.g. '/admin/challenges'
//   $cityParam  e.g. 'city'   (drill-in query param)
//   $noun       e.g. 'challenges'
//   $actionLabel e.g. 'View challenges'
//   $from,$to,$view,$ds,$de,$today,$rangeLabel
//   $sumSql     SELECT id,name,cnt,last_at  (named :ds,:de) GROUP BY ... ORDER BY cnt DESC
//   $dailySql   SELECT id,name,day,cnt      (named :ds,:de) GROUP BY ...
declare(strict_types=1);

// $chartOnly: when set, render only the chart (no per-city table) - used when
// the host page already shows a detail list below (e.g. Users).
$chartOnly = $chartOnly ?? false;

$cityLink = static fn(string $id): string =>
    $pageBase . '?' . $cityParam . '=' . urlencode($id) . '&from=' . urlencode($from) . '&to=' . urlencode($to);
?>
<!-- Range + view controls -->
<form method="GET" action="<?= $pageBase ?>" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">
    <span style="color:#888;font-size:13px;font-weight:600">From</span>
    <input type="date" name="from" value="<?= htmlspecialchars($from, ENT_QUOTES) ?>" max="<?= $today ?>"
           onchange="this.form.submit()" onclick="if(this.showPicker)this.showPicker()"
           style="background:#1a1a1a;border:1px solid #333;color:#eee;border-radius:6px;padding:6px 8px;font-size:13px">
    <span style="color:#888;font-size:13px;font-weight:600">to</span>
    <input type="date" name="to" value="<?= htmlspecialchars($to, ENT_QUOTES) ?>" max="<?= $today ?>"
           onchange="this.form.submit()" onclick="if(this.showPicker)this.showPicker()"
           style="background:#1a1a1a;border:1px solid #333;color:#eee;border-radius:6px;padding:6px 8px;font-size:13px">
    <input type="hidden" name="view" value="<?= htmlspecialchars($view, ENT_QUOTES) ?>">
    <a href="<?= $pageBase ?>?from=<?= $today ?>&to=<?= $today ?>&view=<?= htmlspecialchars($view, ENT_QUOTES) ?>" class="btn btn-secondary btn-sm">Today</a>
</form>

<div style="display:flex;gap:8px;margin-bottom:16px">
    <?php
    $viewOpts = ['sum' => '∑ Accumulation', 'daily' => '📅 Per day'];
    foreach ($viewOpts as $vk => $vlabel):
        $active = $view === $vk;
        $href = $pageBase . '?from=' . urlencode($from) . '&to=' . urlencode($to) . '&view=' . $vk;
    ?>
        <a href="<?= $href ?>" class="btn btn-sm <?= $active ? 'btn-primary' : 'btn-secondary' ?>"><?= $vlabel ?></a>
    <?php endforeach; ?>
</div>

<?php if ($view === 'daily'):
    $st = $pdo->prepare($dailySql);
    $st->execute([':ds' => $ds, ':de' => $de]);
    $rows = $st->fetchAll();

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
    <p style="color:#666;font-size:13px;margin:0 0 12px"><?= count($cityTotals) ?> cities · <?= number_format($grandTotal) ?> <?= $noun ?> · <?= htmlspecialchars($rangeLabel, ENT_QUOTES) ?> (UTC+7)</p>

    <?php if (empty($cityTotals)): ?>
        <p class="no-results" style="padding:30px 0">No <?= $noun ?> in this range.</p>
    <?php else:
        $legendHref = static fn(string $id): string => $cityLink($id);
        $segHref = static fn(string $id, string $day): string =>
            $pageBase . '?' . $cityParam . '=' . urlencode($id) . '&from=' . urlencode($day) . '&to=' . urlencode($day);
        include __DIR__ . '/_daily_stacked_chart.php';
    endif; ?>

<?php else:
    $st = $pdo->prepare($sumSql);
    $st->execute([':ds' => $ds, ':de' => $de]);
    $cities = $st->fetchAll();
    $totalCnt = 0;
    foreach ($cities as $r) { $totalCnt += (int) $r['cnt']; }
    $barColors = [];
    $i = 0;
    foreach ($cities as $r) { $barColors[$r['id']] = $PALETTE[$i % count($PALETTE)]; $i++; }
    ?>
    <p style="color:#666;font-size:13px;margin:0 0 12px"><?= count($cities) ?> cities · <?= number_format($totalCnt) ?> <?= $noun ?> · <?= htmlspecialchars($rangeLabel, ENT_QUOTES) ?> (UTC+7)</p>

    <?php
    $chartLink = static fn(string $id): string => $cityLink($id);
    include __DIR__ . '/_city_bar_chart.php';
    ?>

    <?php if (!$chartOnly): ?>
    <div class="table-wrapper">
        <table>
            <thead>
                <tr><th>City</th><th style="width:120px"><?= ucfirst($noun) ?></th><th style="width:150px">Last</th><th style="width:150px">Actions</th></tr>
            </thead>
            <tbody>
            <?php if (empty($cities)): ?>
                <tr><td colspan="4" class="no-results">No city had <?= $noun ?> in this range.</td></tr>
            <?php else: foreach ($cities as $c):
                // last_at is a tstz string for most tables, but an epoch int for
                // users.created_at - handle both.
                $lastTs = $c['last_at'] ? (is_numeric($c['last_at']) ? (int) $c['last_at'] : strtotime($c['last_at'])) : 0;
                ?>
                <tr>
                    <td>
                        <span style="width:10px;height:10px;border-radius:3px;background:<?= $barColors[$c['id']] ?>;display:inline-block;margin-right:6px"></span>
                        <strong><?= htmlspecialchars($c['name'] ?? '(untitled)', ENT_QUOTES) ?></strong>
                    </td>
                    <td><strong style="color:#fff;font-size:15px"><?= number_format((int) $c['cnt']) ?></strong></td>
                    <td style="color:#888;white-space:nowrap"><?= $lastTs ? date('M d, H:i', $lastTs) : '-' ?></td>
                    <td><a href="<?= $cityLink($c['id']) ?>" class="btn btn-primary btn-sm"><?= htmlspecialchars($actionLabel, ENT_QUOTES) ?> →</a></td>
                </tr>
            <?php endforeach; endif; ?>
            </tbody>
        </table>
    </div>
    <?php endif; /* !$chartOnly */ ?>
<?php endif; ?>
