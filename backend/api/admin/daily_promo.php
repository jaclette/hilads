<?php

declare(strict_types=1);

// Daily promo (SPEC 10.13): a day's video, carousel and captions, rendered on a
// Mac by tools/promo from yesterday's world tour, with a download per file.
// Below, every photo of that tour: the one each city shows, and why the others
// are left out. Exclude leaves one photo out (rerun the command after).

admin_require_login();
require_once __DIR__ . '/daily_common.php';

$date = (string) ($_GET['date'] ?? DailyClock::currentDate());
if (!DailyClock::isValidDate($date)) {
    $date = DailyClock::currentDate();
}
$self = '/admin/daily/promo?date=' . $date;

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    csrf_verify();
    $proof    = (string) ($_POST['proof_id'] ?? '');
    $excluded = ($_POST['action'] ?? '') === 'exclude';
    daily_action(function () use ($proof, $excluded) {
        DailyPromo::setExcluded($proof, $excluded);
        DailyAdminService::audit($excluded ? 'daily_proof.promo_exclude' : 'daily_proof.promo_include', 'daily_proof', $proof, null, null);
    }, $excluded ? 'Left out of the promo. Run the command again to render without it.' : 'Back in the promo. Run the command again to render with it.', $self . '#photos');
}

$tourDate   = (new DateTimeImmutable($date))->modify('-1 day')->format('Y-m-d');
$yesterday  = DailyChallengeRepository::findPublishedByDate($tourDate);
$candidates = $yesterday ? DailyPromo::candidates($yesterday) : [];
$data       = DailyPromo::data($date);
$assets     = DailyPromo::assets($date);
$used       = array_column($data['cities'] ?? [], 'proofId');
$countries  = count(array_unique(array_filter(array_column($data['cities'] ?? [], 'country'))));
$prev       = (new DateTimeImmutable($date))->modify('-1 day')->format('Y-m-d');
$next       = (new DateTimeImmutable($date))->modify('+1 day')->format('Y-m-d');

$reasons = [
    'excluded'     => ['Excluded', '#7f1d1d'],
    'opted_out'    => ['Author opted out', '#3f3f46'],
    'before_terms' => ['Before the terms, no yes', '#3f3f46'],
];

admin_head('Daily promo');
admin_nav('/admin/daily');
daily_styles();
?>
<style>
.promo-files { display:grid; grid-template-columns:repeat(auto-fill,minmax(220px,1fr)); gap:12px; margin-bottom:18px; }
.promo-file { background:#181818; border:1px solid #2a2a2a; border-radius:10px; padding:12px; }
.promo-file video { width:100%; aspect-ratio:9/16; background:#000; border-radius:8px; margin-bottom:8px; }
.promo-captions { display:grid; grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); gap:12px; margin-bottom:24px; }
.promo-captions textarea { width:100%; min-height:200px; background:#111; border:1px solid #333; color:#eee; padding:8px; border-radius:6px; font:13px/1.45 inherit; }
.promo-city { border-top:1px solid #222; padding:10px 0; }
.promo-photos { display:flex; gap:10px; flex-wrap:wrap; margin-top:6px; }
.promo-photo { width:150px; }
.promo-photo img { width:150px; height:150px; object-fit:cover; border-radius:8px; display:block; background:#222; }
.promo-photo.used img { outline:3px solid #22c55e; }
.promo-photo .badge { display:inline-block; margin-top:4px; font-size:11px; }
</style>
<div class="admin-main">
    <h1 class="page-title">🎬 Promo</h1>
    <?php daily_subnav('/admin/daily/promo'); ?>

    <div class="daily-inline" style="margin-bottom:14px">
        <a class="btn btn-secondary btn-sm" href="/admin/daily/promo?date=<?= $prev ?>">← <?= $prev ?></a>
        <strong style="padding:0 8px"><?= dh($date) ?></strong>
        <a class="btn btn-secondary btn-sm" href="/admin/daily/promo?date=<?= $next ?>"><?= $next ?> →</a>
    </div>

    <?php if ($data === null): ?>
        <p class="daily-muted">No published challenge on <?= dh($date) ?> or the day before: nothing to promote.</p>
    <?php else: ?>
        <p style="margin-bottom:6px"><strong>Yesterday (<?= dh($tourDate) ?>):</strong> <?= dh($data['yesterday']['question']['en']) ?>
            · <strong>Today:</strong> <?= dh($data['today']['question']['en']) ?></p>
        <p class="daily-muted" style="margin-bottom:16px"><?= count($data['cities']) ?> cities in <?= $countries ?> countries can be shown.
            Render on the Mac: <code>cd tools/promo && npm run promo -- <?= dh($date) ?></code></p>

        <h2 style="margin:0 0 10px">Files</h2>
        <?php if (!array_filter($assets, fn($a) => $a['url'] !== null)): ?>
            <p class="daily-muted" style="margin-bottom:18px">Not rendered yet.</p>
        <?php else: ?>
            <div class="promo-files">
                <?php foreach (['video_en' => 'Video EN', 'video_fr' => 'Video FR', 'carousel_en' => 'Carousel EN (zip)', 'carousel_fr' => 'Carousel FR (zip)'] as $kind => $label):
                    $a = $assets[$kind] ?? null; ?>
                    <div class="promo-file">
                        <strong><?= $label ?></strong>
                        <?php if ($a && $a['url']): ?>
                            <?php if (str_starts_with($kind, 'video')): ?><video src="<?= dh($a['url']) ?>" controls preload="metadata" playsinline></video><?php endif; ?>
                            <div class="daily-muted" style="margin:4px 0 8px">Rendered <?= dh(date('j M H:i', strtotime($a['rendered_at']))) ?></div>
                            <a class="btn btn-primary btn-sm" href="<?= dh($a['url']) ?>" download>Download</a>
                        <?php else: ?>
                            <div class="daily-muted">Not rendered.</div>
                        <?php endif; ?>
                    </div>
                <?php endforeach; ?>
            </div>
        <?php endif; ?>

        <?php if (isset($assets['caption_en']) || isset($assets['caption_fr'])): ?>
            <h2 style="margin:0 0 10px">Captions</h2>
            <div class="promo-captions">
                <?php foreach (['caption_en' => 'English', 'caption_fr' => 'Français'] as $kind => $label): if (!isset($assets[$kind])) continue; ?>
                    <div>
                        <div class="daily-inline" style="justify-content:space-between;width:100%;margin-bottom:6px">
                            <strong><?= $label ?></strong>
                            <button class="btn btn-secondary btn-sm" type="button" onclick="navigator.clipboard.writeText(document.getElementById('<?= $kind ?>').value); this.textContent='Copied'">Copy</button>
                        </div>
                        <textarea id="<?= $kind ?>" readonly><?= dh($assets[$kind]['content']) ?></textarea>
                    </div>
                <?php endforeach; ?>
            </div>
        <?php endif; ?>

        <h2 id="photos" style="margin:0 0 4px">Photos of <?= dh($tourDate) ?></h2>
        <p class="daily-muted" style="margin-bottom:8px">Green: the photo the city shows. A city shows its best allowed photo; one city per country comes first.</p>
        <?php foreach ($candidates as $cityId => $list): ?>
            <div class="promo-city">
                <strong><?= dh($list[0]['city']['name']['en']) ?></strong> <span class="daily-muted"><?= dh(strtoupper((string) $list[0]['city']['country'])) ?> · <?= count($list) ?> photo<?= count($list) > 1 ? 's' : '' ?></span>
                <div class="promo-photos">
                    <?php foreach ($list as $c): $isUsed = in_array($c['proofId'], $used, true); ?>
                        <div class="promo-photo<?= $isUsed ? ' used' : '' ?>">
                            <a href="<?= dh($c['photoUrl']) ?>" target="_blank"><img src="<?= dh($c['thumbUrl']) ?>" alt="" loading="lazy"></a>
                            <div style="font-size:12px;margin-top:4px">@<?= dh($c['username']) ?></div>
                            <?php if ($c['city']['answer']['en'] !== null): ?><div class="daily-muted">“<?= dh($c['city']['answer']['en']) ?>”</div><?php endif; ?>
                            <?php if ($c['reason'] !== null): [$text, $bg] = $reasons[$c['reason']]; ?>
                                <span class="badge" style="background:<?= $bg ?>;color:#eee"><?= $text ?></span>
                            <?php elseif ($isUsed): ?>
                                <span class="badge" style="background:#14532d;color:#dcfce7">In the promo</span>
                            <?php endif; ?>
                            <form method="POST" action="<?= dh($self) ?>" style="margin-top:4px">
                                <?= csrf_input() ?><input type="hidden" name="proof_id" value="<?= dh($c['proofId']) ?>">
                                <?php if ($c['excluded']): ?>
                                    <button class="btn btn-secondary btn-sm" type="submit" name="action" value="include">Put back</button>
                                <?php else: ?>
                                    <button class="btn btn-secondary btn-sm" type="submit" name="action" value="exclude">Exclude</button>
                                <?php endif; ?>
                            </form>
                        </div>
                    <?php endforeach; ?>
                </div>
            </div>
        <?php endforeach; ?>
        <?php if ($candidates === []): ?><p class="daily-muted">No photos in yesterday's tour.</p><?php endif; ?>
    <?php endif; ?>
</div>
<?php admin_foot();
