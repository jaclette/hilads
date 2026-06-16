<?php
// Horizontal bar chart of per-city counts (CSS bars, no JS/library).
// Expects in scope:
//   $cities    - rows with id, name, cnt (ordered desc)
//   $chartLink - fn(string $id): string  → href for a city's drill-in
//   $barColors - OPTIONAL [id => '#hex'] per-city colours; falls back to the
//                brand orange gradient when a city has no entry.
declare(strict_types=1);

if (empty($cities)) { return; }

$barColors = $barColors ?? [];
$maxCnt = 0;
foreach ($cities as $r) { $maxCnt = max($maxCnt, (int) $r['cnt']); }
?>
<div style="background:#161310;border:1px solid #2a2a2a;border-radius:12px;padding:14px 18px;margin-bottom:18px">
    <?php foreach ($cities as $c):
        $cnt = (int) $c['cnt'];
        // Min 2% so a count of 1 still shows a sliver next to the max.
        $pct = $maxCnt > 0 ? max(2, (int) round($cnt / $maxCnt * 100)) : 0;
        ?>
        <a href="<?= $chartLink($c['id']) ?>"
           style="display:flex;align-items:center;gap:12px;padding:5px 0;text-decoration:none"
           onmouseover="this.style.opacity=0.8" onmouseout="this.style.opacity=1">
            <span style="width:150px;flex-shrink:0;color:#ddd;font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"><?= htmlspecialchars($c['name'] ?? '(untitled)', ENT_QUOTES) ?></span>
            <?php $fill = $barColors[$c['id']] ?? 'linear-gradient(90deg,#FF7A3C,#C24A38)'; ?>
            <span style="flex:1;height:18px;background:rgba(255,255,255,0.05);border-radius:5px;overflow:hidden">
                <span style="display:block;height:100%;width:<?= $pct ?>%;background:<?= $fill ?>;border-radius:5px"></span>
            </span>
            <span style="width:46px;text-align:right;color:#fff;font-weight:700;font-size:13px"><?= number_format($cnt) ?></span>
        </a>
    <?php endforeach; ?>
</div>
