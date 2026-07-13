<?php
// Per-day stacked bar chart (one colour per city). CSS-only hover tooltip +
// clickable segments (→ that city for that single day). Expects in scope:
//   $cityColor   [id => '#hex']  ordered by total desc
//   $cityName    [id => name]
//   $cityFlag    [id => flag emoji]  OPTIONAL - country flag per city
//   $cityTotals  [id => int]
//   $daily       [day][id] => int
//   $dayTotals   [day] => int
//   $maxDayTotal int
//   $from, $to   YYYY-MM-DD
//   $legendHref  fn(string $id): string          → city over the whole range
//   $segHref     fn(string $id, string $day): string → city for that single day
declare(strict_types=1);
?>
<style>
.dsc-seg { display:block; height:100%; position:relative; }
.dsc-seg:hover { filter: brightness(1.25); }
.dsc-seg:hover::after {
  content: attr(data-tip);
  position:absolute; bottom:140%; left:50%; transform:translateX(-50%);
  background:#000; color:#fff; padding:4px 9px; border-radius:6px;
  font-size:12px; font-weight:600; white-space:nowrap; z-index:30;
  pointer-events:none; border:1px solid #555;
}
.dsc-seg:first-child  { border-top-left-radius:5px; border-bottom-left-radius:5px; }
.dsc-seg:last-child   { border-top-right-radius:5px; border-bottom-right-radius:5px; }
.dsc-legend-item { display:flex; align-items:center; gap:6px; text-decoration:none; font-size:13px; color:#ddd; }
.dsc-legend-item:hover { color:#fff; }
</style>

<!-- Legend -->
<div style="display:flex;flex-wrap:wrap;gap:12px;margin-bottom:16px">
    <?php foreach ($cityColor as $cid => $col): ?>
        <a class="dsc-legend-item" href="<?= $legendHref($cid) ?>">
            <span style="width:12px;height:12px;border-radius:3px;background:<?= $col ?>;display:inline-block"></span>
            <?php if (!empty($cityFlag[$cid])) echo $cityFlag[$cid] . ' '; ?><?= htmlspecialchars($cityName[$cid] ?? '?', ENT_QUOTES) ?>
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
            <span style="flex:1;height:18px;background:rgba(255,255,255,0.05);border-radius:5px;display:flex">
                <?php foreach ($cityColor as $cid => $col):
                    $cnt = $daily[$day][$cid] ?? 0;
                    if ($cnt <= 0) continue;
                    $w   = $maxDayTotal > 0 ? ($cnt / $maxDayTotal * 100) : 0;
                    $tip = ($cityName[$cid] ?? '?') . ' · ' . $cnt;
                    ?>
                    <a class="dsc-seg"
                       href="<?= $segHref($cid, $day) ?>"
                       data-tip="<?= htmlspecialchars($tip, ENT_QUOTES) ?>"
                       style="width:<?= $w ?>%;background:<?= $col ?>"></a>
                <?php endforeach; ?>
            </span>
            <span style="width:46px;text-align:right;color:#fff;font-weight:700;font-size:13px"><?= number_format($dayTotal) ?></span>
        </div>
        <?php $cursor->modify('+1 day'); endwhile; ?>
</div>
