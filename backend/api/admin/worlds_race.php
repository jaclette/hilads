<?php

declare(strict_types=1);

// A "Different Worlds" topic in the race format (DwRace), included by worlds_topic.php: the version, the rendered video
// and its three PNGs, a preview of the first and the last year's top 10, the text fields and the year-by-year series
// (JSON), saved on change like the other formats. In scope: $topic, $pkg, $c, $self, $versions.

$years = DwRace::years($c);
$stills = ['still_url' => 'PNG 01 (first year)', 'still2_url' => 'PNG 02 (final ranking)', 'still3_url' => 'PNG 03 (closing slide)'];
/** A year's top 10: [[country, flag, value]]. */
$topOf = static function (array $c, int $year): array {
    $rows = array_map(static fn($s) => [$s['country'], $s['flag'], (float) ($s['values'][(string) $year] ?? 0)], $c['series'] ?? []);
    usort($rows, static fn($a, $b) => $b[2] <=> $a[2]);
    return array_slice($rows, 0, DwRace::SHOWN);
};
$secs = DwRace::videoSeconds($c);
?>
<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px" id="slides">
    <strong>Version <?= $pkg['version'] ?></strong>
    <span class="worlds-badge is-clip">🏁 Race · <?= wh(number_format($secs, 1)) ?> s · <?= $years ? $years[0] . ' → ' . end($years) : '' ?> · <?= count($years) ?> years, 0.7 s each · closing slide the last 3 s · no clip</span>
    <span class="worlds-muted"><?= wh($pkg['model']) ?> · <?= wh(date('j M H:i', strtotime($pkg['created_at']))) ?></span>
    <?php if (count($versions) > 1): ?>
        <select onchange="location.href='<?= $self ?>?v='+this.value">
            <?php foreach ($versions as $v): ?><option value="<?= (int) $v['version'] ?>"<?= (int) $v['version'] === $pkg['version'] ? ' selected' : '' ?>>v<?= (int) $v['version'] ?><?= $v === $versions[0] ? ' (latest)' : '' ?></option><?php endforeach; ?>
        </select>
    <?php endif; ?>
    <button type="button" class="btn btn-secondary" data-full-caption data-question="outro_question" data-cta="<?= wh(DwStudio::settings()['caption_cta']) ?>">Copy full caption</button>
</div>

<?php if (!empty($pkg['video_url']) || !empty($pkg['still_url'])): ?>
    <div class="worlds-video">
        <?php if (!empty($pkg['video_url'])): ?><video src="<?= wh($pkg['video_url']) ?>" controls playsinline preload="metadata"></video><?php endif; ?>
        <?php foreach (array_filter(array_map(fn($col) => $pkg[$col] ?? null, array_keys($stills))) as $still): ?><a href="<?= wh($still) ?>" target="_blank" rel="noopener"><img src="<?= wh($still) ?>" alt="" style="width:160px;aspect-ratio:9/16;border-radius:8px;background:#000"></a><?php endforeach; ?>
        <div>
            <strong>Video and PNGs</strong>
            <p class="worlds-muted">Rendered <?= wh(date('j M H:i', strtotime((string) ($pkg['video_at'] ?? 'now')))) ?> from version <?= $pkg['version'] ?>. Silent: add the music when you publish.</p>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
                <?php if (!empty($pkg['video_url'])): ?><a class="btn btn-primary" href="<?= wh($pkg['video_url']) ?>" download>⬇ Video</a><?php endif; ?>
                <?php foreach ($stills as $col => $label): if (!empty($pkg[$col])): ?><a class="btn btn-secondary" href="<?= wh($pkg[$col]) ?>" download>⬇ <?= wh($label) ?></a><?php endif; endforeach; ?>
            </div>
            <p class="worlds-muted" style="margin-top:8px">After an edit, render it again on the Mac: <code>cd tools/promo && npm run worlds -- <?= wh($topic['date']) ?></code></p>
        </div>
    </div>
<?php else: ?>
    <p class="worlds-muted" style="margin-bottom:12px">No video yet. On the Mac: <code>cd tools/promo && npm run worlds -- <?= wh($topic['date']) ?></code> (renders the <?= wh(number_format($secs, 1)) ?> s video and its three PNGs, and uploads them here).</p>
<?php endif; ?>

<?php if (!empty($c['warnings'])): ?>
    <div class="worlds-warn"><strong>Warnings</strong><ul class="worlds-report"><?php foreach ($c['warnings'] as $w): ?><li><?= wh($w) ?></li><?php endforeach; ?></ul></div>
<?php endif; ?>

<?php if ($years): ?>
<div class="rx-race" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px;margin-bottom:16px">
    <?php foreach (array_unique([$years[0], end($years)]) as $y): $top = $topOf($c, $y); $max = max(1e-9, $top[0][2] ?? 0); ?>
        <div class="form-card" style="max-width:none">
            <h3 style="margin-bottom:8px"><?= $y === $years[0] ? 'First year' : 'Final ranking' ?> · <?= (int) $y ?><?= (int) ($c['banner_year'] ?? 0) === $y ? ' · banner' : '' ?></h3>
            <?php foreach ($top as $i => [$country, $flag, $v]): ?>
                <div style="display:flex;align-items:center;gap:8px;margin:3px 0;font-size:13px">
                    <span style="width:18px;text-align:right;color:#888"><?= $i + 1 ?></span><span><?= wh($flag) ?></span>
                    <span style="width:110px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"><?= wh($country) ?></span>
                    <span style="flex:1"><span style="display:block;height:10px;border-radius:5px;background:#F2783A;width:<?= round(100 * $v / $max, 1) ?>%"></span></span>
                    <span style="width:64px;text-align:right;font-weight:700"><?= wh(number_format($v, 1)) ?><?= !empty($c['unit']) ? ' ' . wh($c['unit']) : '' ?></span>
                </div>
            <?php endforeach; ?>
        </div>
    <?php endforeach; ?>
</div>
<?php endif; ?>

<div class="worlds-grid" data-package="<?= $pkg['id'] ?>">
    <div class="form-card">
        <h3>Screen</h3>
        <?php $h = (string) ($c['headline'] ?? ''); worlds_field('headline', 'Headline (the header, from the first frame)', $h, false, DwStudio::screenWords($h) . ' / ' . DwRace::HEADLINE_WORDS . ' words'); ?>
        <?php worlds_field('headline_accent', 'Headline words in orange (optional, exactly as in the headline)', (string) ($c['headline_accent'] ?? '')); ?>
        <?php worlds_field('detail', 'Banner (pops at the banner year, the race goes on)', (string) ($c['detail'] ?? '')); ?>
        <?php worlds_field('banner_year', 'Banner year (one of the years, or empty)', (string) ($c['banner_year'] ?? '')); ?>
        <?php worlds_field('value_label', 'What the value measures', (string) ($c['value_label'] ?? '')); ?>
        <?php worlds_field('unit', 'Unit after each value (short, e.g. M)', (string) ($c['unit'] ?? '')); ?>
        <?php worlds_field('data_years', 'Years shown (e.g. 2000–2020)', (string) ($c['data_years'] ?? '')); ?>
        <?php worlds_field('source', 'Source', (string) ($c['source'] ?? '')); ?>
        <?php worlds_field('source_url', 'Source URL', (string) ($c['source_url'] ?? '')); ?>
        <?php worlds_field('card_bg', 'Card color (optional: ' . implode(', ', DwReaction::CARD_THEMES) . ' or a light #rrggbb; cream by default)', (string) ($c['card_bg'] ?? '')); ?>
        <?php worlds_field('series', 'Year-by-year data (JSON: [{country, flag, values: {"2000": 77.2, …}}], every country every year)',
            json_encode($c['series'] ?? [], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), true, count($c['series'] ?? []) . ' countries'); ?>
        <?php worlds_field('topic', 'Topic', (string) ($c['topic'] ?? '')); ?>
    </div>
    <div class="form-card">
        <h3>Post</h3>
        <?php worlds_field('caption', 'Caption', (string) ($c['caption'] ?? ''), true, DwStudio::words((string) ($c['caption'] ?? '')) . ' words'); ?>
        <?php worlds_field('outro_question', 'Question (the closing slide, and the caption\'s last line)', (string) ($c['outro_question'] ?? ''), false, DwStudio::screenWords((string) ($c['outro_question'] ?? '')) . ' / ' . DwReaction::QUESTION_WORDS . ' words'); ?>
        <?php $cta = (string) ($c['cta_line'] ?? ''); worlds_field('cta_line', 'Invitation (the closing slide\'s button, with hilads.live)', $cta, false, DwStudio::screenWords($cta) . ' / ' . DwReaction::CTA_WORDS . ' words'); ?>
        <?php worlds_field('hashtags', 'Hashtags', implode(' ', $c['hashtags'] ?? []), false, count($c['hashtags'] ?? []) . ''); ?>
        <?php worlds_field('warnings', 'Warnings (one per line)', implode("\n", $c['warnings'] ?? []), true); ?>
    </div>
</div>
