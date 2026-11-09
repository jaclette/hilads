<?php

declare(strict_types=1);

// A "Different Worlds" topic in the reaction + ranking format (DwReaction), included by
// worlds_topic.php: the version, the rendered video and PNG, a live preview of the screen,
// the reaction clip (Pixabay: "Find another clip", 3 options at a time; its AI mark), the
// ranking's rows (editable) and the text fields (saved on change, like the slides format).
// In scope: $topic, $pkg, $c, $self, $versions.

$clip = $c['clip'] ?? null;
$highlight = DwStudio::settings()['countries_always_included'];
?>
<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px" id="slides">
    <strong>Version <?= $pkg['version'] ?></strong>
    <span class="worlds-badge is-clip">📊 Reaction + ranking · <?= trim((string) ($c['outro_question'] ?? '')) !== '' ? '10 s (table 7 s + question 3 s)' : DwReaction::VIDEO_SECONDS . ' s' ?></span>
    <span class="worlds-muted"><?= wh($pkg['model']) ?> · <?= wh(date('j M H:i', strtotime($pkg['created_at']))) ?></span>
    <?php if (count($versions) > 1): ?>
        <select onchange="location.href='<?= $self ?>?v='+this.value">
            <?php foreach ($versions as $v): ?><option value="<?= (int) $v['version'] ?>"<?= (int) $v['version'] === $pkg['version'] ? ' selected' : '' ?>>v<?= (int) $v['version'] ?><?= $v === $versions[0] ? ' (latest)' : '' ?></option><?php endforeach; ?>
        </select>
    <?php endif; ?>
    <button type="button" class="btn btn-secondary" data-full-caption data-question="outro_question" data-cta="<?= wh(DwStudio::settings()['caption_cta']) ?>">Copy full caption</button>
</div>

<?php if ($clip === null): ?>
    <div class="worlds-warn" style="background:#2a0f0f;border-color:#7f1d1d;color:#f87171">🚩 <strong>No clip yet.</strong> Find one below ("Find another clip") before rendering.</div>
<?php elseif (!empty($clip['ai_generated'])): ?>
    <div class="worlds-warn">🤖 <strong>AI-generated clip:</strong> turn on the AI label (TikTok "AI-generated content", Instagram "AI info") when you publish.</div>
<?php endif; ?>

<?php if (!empty($pkg['video_url']) || !empty($pkg['still_url'])): ?>
    <div class="worlds-video">
        <?php if (!empty($pkg['video_url'])): ?><video src="<?= wh($pkg['video_url']) ?>" controls playsinline preload="metadata"></video><?php endif; ?>
        <?php foreach (array_filter([$pkg['still_url'] ?? null, $pkg['still2_url'] ?? null]) as $still): ?><a href="<?= wh($still) ?>" target="_blank" rel="noopener"><img src="<?= wh($still) ?>" alt="" style="width:160px;aspect-ratio:9/16;border-radius:8px;background:#000"></a><?php endforeach; ?>
        <div>
            <strong>Video and PNGs</strong>
            <p class="worlds-muted">Rendered <?= wh(date('j M H:i', strtotime((string) ($pkg['video_at'] ?? 'now')))) ?> from version <?= $pkg['version'] ?>. Silent: add the music when you publish.</p>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
                <?php if (!empty($pkg['video_url'])): ?><a class="btn btn-primary" href="<?= wh($pkg['video_url']) ?>" download>⬇ Video</a><?php endif; ?>
                <?php if (!empty($pkg['still_url'])): ?><a class="btn btn-secondary" href="<?= wh($pkg['still_url']) ?>" download>⬇ PNG 01 (table)</a><?php endif; ?>
                <?php if (!empty($pkg['still2_url'])): ?><a class="btn btn-secondary" href="<?= wh($pkg['still2_url']) ?>" download>⬇ PNG 02 (question)</a><?php endif; ?>
            </div>
            <p class="worlds-muted" style="margin-top:8px">After an edit, render it again on the Mac: <code>cd tools/promo && npm run worlds -- <?= wh($topic['date']) ?></code></p>
        </div>
    </div>
<?php else: ?>
    <p class="worlds-muted" style="margin-bottom:12px">No video yet. On the Mac: <code>cd tools/promo && npm run worlds -- <?= wh($topic['date']) ?></code> (renders the 8 s video and the PNG, and uploads them here).</p>
<?php endif; ?>

<?php if (!empty($c['warnings'])): ?>
    <div class="worlds-warn"><strong>Warnings</strong><ul class="worlds-report"><?php foreach ($c['warnings'] as $w): ?><li><?= wh($w) ?></li><?php endforeach; ?></ul></div>
<?php endif; ?>

<div class="rx-layout" data-package="<?= $pkg['id'] ?>">
    <div>
        <div class="rx-frame"><div class="rx-screen" id="rx-screen"></div></div>
        <div class="worlds-muted" style="margin-top:6px">Live preview of the last frame (the video and the PNG are rendered on the Mac).</div>
    </div>
    <div>
        <div class="form-card" style="max-width:none;margin-bottom:16px">
            <h3 style="margin-bottom:8px">Reaction clip</h3>
            <div id="rx-clip">
                <?php if ($clip !== null): ?>
                    <video src="<?= wh($clip['url']) ?>" muted loop autoplay playsinline style="width:100%;max-width:360px;aspect-ratio:1080/640;object-fit:cover;border-radius:8px;background:#000"></video>
                    <?php if (($clip['source'] ?? 'pixabay') === 'upload'): ?>
                        <p class="worlds-muted">Our own clip (uploaded from the Mac: <code>npm run worlds -- <?= wh($topic['date']) ?> --clip …</code>)<?= trim((string) ($clip['credit'] ?? '')) !== '' ? ' · ' . wh($clip['credit']) : '' ?> · no credit on screen</p>
                    <?php else: ?>
                    <p class="worlds-muted">Pixabay #<?= (int) $clip['pixabay_id'] ?> · by <?= wh($clip['author']) ?> · <?= (int) ($clip['duration'] ?? 0) ?> s ·
                        <a href="<?= wh($clip['source_url']) ?>" target="_blank" rel="noopener">source ↗</a> ·
                        <a href="<?= wh($clip['license_url']) ?>" target="_blank" rel="noopener"><?= wh($clip['license']) ?></a></p>
                    <?php endif; ?>
                    <label class="worlds-muted"><input type="checkbox" id="rx-ai"<?= !empty($clip['ai_generated']) ? ' checked' : '' ?>> AI-generated (the AI label is needed when publishing)</label>
                <?php else: ?>
                    <p style="color:#f87171">No clip.</p>
                <?php endif; ?>
            </div>
            <details id="rx-find"<?= $clip === null ? ' open' : '' ?> style="margin-top:10px"><summary style="cursor:pointer;color:#FF7A3C">Find another clip</summary>
                <div style="display:flex;gap:6px;margin:8px 0">
                    <input type="text" id="rx-query" value="<?= wh((string) ($c['clip_query'] ?? '')) ?>" placeholder="shocked face" style="flex:1">
                    <button type="button" class="btn btn-secondary btn-sm" id="rx-search">Search Pixabay</button>
                </div>
                <div class="worlds-muted">The clip must clearly show the funny moment. No celebrities, no minors, nobody visibly drunk, no brands.</div>
                <div class="rx-options" id="rx-options"></div>
                <button type="button" class="btn btn-secondary btn-sm" id="rx-more" style="display:none">3 more</button>
                <div class="worlds-muted" id="rx-find-state"></div>
            </details>
        </div>

        <div class="form-card" style="max-width:none;margin-bottom:16px">
            <h3 style="margin-bottom:8px">Ranking</h3>
            <table class="rx-rows"><thead><tr><th>#</th><th>Flag</th><th>Country</th><th>Value</th><th>Unit</th><th title="A “• • •” separator above this row (the ranking skips to it)">…</th><th title="Highlighted (e.g. a reference country)">★</th><th></th></tr></thead>
                <tbody id="rx-rows"></tbody></table>
            <div style="display:flex;gap:8px;align-items:center;margin-top:8px">
                <button type="button" class="btn btn-secondary btn-sm" id="rx-add">+ Row</button>
                <button type="button" class="btn btn-primary btn-sm" id="rx-save">Save rows</button>
                <span class="worlds-muted" id="rx-rows-state"></span>
            </div>
            <div class="worlds-muted" style="margin-top:6px">One source, one year, one unit. Highlighted: #1 and <?= wh(implode(', ', $highlight)) ?> (an extra last row with its real rank, only if the same source ranks it).</div>
        </div>
    </div>
</div>

<div class="worlds-grid" data-package="<?= $pkg['id'] ?>">
    <div class="form-card">
        <h3>Screen</h3>
        <?php $h = (string) ($c['headline'] ?? ''); $d = (string) ($c['detail'] ?? ''); ?>
        <?php worlds_field('headline', 'Headline (the promise)', $h, false, DwStudio::screenWords($h) . ' / ' . DwReaction::HEADLINE_WORDS . ' words'); ?>
        <?php worlds_field('detail', 'Detail (optional)', $d, false, DwStudio::screenWords($d) . ' / ' . DwReaction::DETAIL_WORDS . ' words'); ?>
        <?php worlds_field('headline_accent', 'Headline words in orange (optional, exactly as in the headline)', (string) ($c['headline_accent'] ?? '')); ?>
        <?php worlds_field('card_bg', 'Card color (optional: ' . implode(', ', DwReaction::CARD_THEMES) . ' or a light #rrggbb; cream by default)', (string) ($c['card_bg'] ?? '')); ?>
        <?php worlds_field('value_label', 'What the value measures', (string) ($c['value_label'] ?? '')); ?>
        <?php worlds_field('data_year', 'Year of the data', (string) ($c['data_year'] ?? '')); ?>
        <?php worlds_field('data_years', 'Years shown (optional, when they differ by country, e.g. 2010s)', (string) ($c['data_years'] ?? '')); ?>
        <?php worlds_field('source', 'Source', (string) ($c['source'] ?? '')); ?>
        <?php worlds_field('source_url', 'Source URL', (string) ($c['source_url'] ?? '')); ?>
        <?php worlds_field('clip_query', 'Clip search', (string) ($c['clip_query'] ?? '')); ?>
        <?php worlds_field('topic', 'Topic', (string) ($c['topic'] ?? '')); ?>
    </div>
    <div class="form-card">
        <h3>Post</h3>
        <?php worlds_field('caption', 'Caption', (string) ($c['caption'] ?? ''), true, DwStudio::words((string) ($c['caption'] ?? '')) . ' words'); ?>
        <?php worlds_field('outro_question', 'Question (the closing slide\'s bubble, 7 to 10 s, and the caption\'s last line)', (string) ($c['outro_question'] ?? ''), false, DwStudio::screenWords((string) ($c['outro_question'] ?? '')) . ' / ' . DwReaction::QUESTION_WORDS . ' words'); ?>
        <?php worlds_field('hashtags', 'Hashtags', implode(' ', $c['hashtags'] ?? []), false, count($c['hashtags'] ?? []) . ''); ?>
        <?php worlds_field('warnings', 'Warnings (one per line)', implode("\n", $c['warnings'] ?? []), true); ?>
    </div>
</div>

<style>
.rx-layout { display:grid; grid-template-columns:400px minmax(0, 1fr); gap:20px; margin-bottom:18px; align-items:start; }
@media (max-width: 900px) { .rx-layout { grid-template-columns:1fr; } }
.rx-frame { width:378px; height:672px; overflow:hidden; border-radius:12px; border:1px solid #333; }
.rx-screen { width:1080px; height:1920px; transform:scale(0.35); transform-origin:0 0; position:relative; background:#FFF6E9; color:#2B1A12;
             font-family:'Be Vietnam Pro', system-ui, -apple-system, sans-serif; overflow:hidden; }
.rx-screen .photo { position:absolute; left:0; top:0; width:1080px; overflow:hidden; background:#7a3b1a; }
.rx-screen .clip { width:1080px; object-fit:cover; display:block; }
.rx-screen .noclip { width:1080px; height:100%; display:flex; align-items:center; justify-content:center; background:#2a0f0f; color:#f87171; font-size:48px; font-weight:800; }
.rx-screen .wave { position:absolute; left:0; }
.rx-screen .credit { position:absolute; right:24px; top:24px; font-size:18px; font-weight:600; color:rgba(255,255,255,.85); background:rgba(0,0,0,.4); border-radius:14px; padding:4px 12px; }
.rx-screen .sticker { position:absolute; left:44px; max-width:900px; background:#FFC93C; border-radius:26px; padding:12px 26px 8px; box-shadow:0 8px 0 #C9940F;
                      font:800 40px 'Baloo 2', 'Be Vietnam Pro', sans-serif; transform:rotate(-4deg); transform-origin:10% 100%; }
.rx-screen .head { position:absolute; left:56px; width:968px; font-family:'Baloo 2', 'Be Vietnam Pro', sans-serif; font-weight:800; letter-spacing:-.5px; }
.rx-screen .head em { font-style:normal; color:#C24E1C; }
.rx-screen .pod { position:absolute; border-radius:26px 26px 12px 12px; background:linear-gradient(#F59A6A, #C9612C); box-shadow:0 8px 0 #9C4A20; color:#fff;
                  display:flex; flex-direction:column; align-items:center; justify-content:flex-end; padding-bottom:14px; box-sizing:border-box; font-weight:800; text-align:center; }
.rx-screen .pod .v { font-family:'Baloo 2', 'Be Vietnam Pro', sans-serif; }
.rx-screen .pod .champ { background:#FFC93C; color:#2B1A12; border-radius:10px; padding:3px 12px; letter-spacing:1.5px; transform:rotate(-3deg); margin-top:4px; }
.rx-screen .badge { position:absolute; border-radius:50%; background:#fff; border-style:solid; border-color:#F2783A; box-sizing:border-box; display:flex; align-items:center; justify-content:center; }
.rx-screen .crown { position:absolute; top:-38%; transform:rotate(-10deg); }
.rx-screen .row { position:absolute; left:56px; width:888px; background:#fff; box-shadow:0 4px 0 rgba(150,90,40,.13); box-sizing:border-box; }
.rx-screen .row.hot { background:#FFF0E4; border:3px solid #C24E1C; }
.rx-screen .row > * { position:absolute; top:0; display:flex; align-items:center; white-space:nowrap; }
.rx-screen .rank { left:14px; justify-content:flex-end; font-weight:800; color:#8A6E5C; }
.rx-screen .name { font-weight:800; overflow:visible; }
.rx-screen .bar { border-radius:8px; background:#F2783A; }
.rx-screen .val { font-weight:800; }
.rx-screen .hot .rank, .rx-screen .hot .val { color:#C24E1C; }
.rx-screen .gap { position:absolute; left:56px; width:888px; display:flex; align-items:center; justify-content:center; font-weight:800; color:#8A6E5C; }
.rx-screen .ask { position:absolute; left:56px; top:1650px; width:888px; display:flex; align-items:center; justify-content:space-between; gap:20px;
                  font-family:'Baloo 2', 'Be Vietnam Pro', sans-serif; font-weight:800; }
.rx-screen .ask b { font-size:38px; white-space:nowrap; }
.rx-screen .ask span { background:#C24E1C; color:#fff; font-size:34px; border-radius:24px; padding:14px 26px 8px; box-shadow:0 7px 0 #8A330F; white-space:nowrap; }
.rx-screen .source { position:absolute; left:56px; top:1746px; width:888px; font-size:20px; line-height:1.25; font-weight:600; color:#8A6E5C; }
.rx-rows { width:100%; border-collapse:collapse; }
.rx-rows th { text-align:left; color:#888; font-size:12px; font-weight:600; padding:2px 4px; }
.rx-rows td { padding:2px 4px; }
.rx-rows input { width:100%; background:#111; border:1px solid #333; color:#eee; padding:5px 6px; border-radius:5px; font-size:13px; }
.rx-rows td:nth-child(1) { width:56px; } .rx-rows td:nth-child(2) { width:56px; } .rx-rows td:nth-child(4) { width:90px; } .rx-rows td:nth-child(5) { width:60px; } .rx-rows td:nth-child(6), .rx-rows td:nth-child(7) { width:26px; } .rx-rows td:nth-child(8) { width:28px; }
.rx-rows input[type=checkbox] { width:auto; }
.rx-options { display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:10px; margin:10px 0; }
.rx-options .opt { background:#151515; border:1px solid #262626; border-radius:8px; padding:6px; font-size:12px; color:#aaa; }
.rx-options video { display:block; width:100%; height:auto; aspect-ratio:1080/640; object-fit:cover; border-radius:6px; background:#000; }
</style>
<script>
(function () {
  const csrf = <?= json_encode(csrf_token()) ?>;
  const pkgId = <?= (int) $pkg['id'] ?>;
  const highlight = <?= json_encode(array_map('mb_strtolower', $highlight), JSON_UNESCAPED_UNICODE) ?>;
  let rows = <?= json_encode($c['rows'] ?? [], JSON_UNESCAPED_UNICODE) ?>;
  let clip = <?= json_encode($clip !== null ? ['url' => $clip['url'], 'credit' => DwReaction::clipCredit($clip)] : null, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) ?>;
  const esc = s => String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const field = p => ((document.querySelector('textarea[data-path="' + p + '"]') || {}).value || '').trim();
  const api = async (fields) => {
    const res = await fetch('/admin/worlds/api', { method: 'POST', body: new URLSearchParams({ csrf_token: csrf, ...fields }) });
    const out = await res.json().catch(() => ({ ok: false, error: 'HTTP ' + res.status }));
    if (!res.ok || !out.ok) throw new Error(out.error || res.status);
    return out;
  };

  // The screen as Reaction.jsx draws it (its table's last frame, simplified): the light card, the clip with its wavy
  // edge, the detail's sticker, the headline (accent words in terracotta), the podium and the rows. Flag colors and
  // emoji are drawn by the render on the Mac; here the blocks and bars are Hilads orange.
  let ctx = null;
  const textW = (t, px, weight, fam) => { ctx = ctx || document.createElement('canvas').getContext('2d');
    ctx.font = `${weight} ${px}px ${fam || "'Be Vietnam Pro', system-ui, sans-serif"}`; return ctx.measureText(String(t)).width; };
  const THEMES = { cream: '#FFF6E9', yellow: '#FFEDB8', green: '#E2F0DA', pink: '#FFE4DC', blue: '#E1EDFF' };
  const cardColor = v => { v = String(v || '').trim().toLowerCase(); return THEMES[v] || (/^#[0-9a-f]{6}$/.test(v) ? v : THEMES.cream); };
  const BALOO = "'Baloo 2', 'Be Vietnam Pro', system-ui, sans-serif";
  function render() {
    const screen = document.getElementById('rx-screen');
    const ok = rows.filter(r => r.country && r.value !== '' && !isNaN(+r.value));
    const year = field('data_years') || field('data_year'), what = field('value_label');
    const first = [what, year].filter(Boolean).join(', ');
    const srcText = (first ? first + ' · ' : '') + (field('source').includes(', ') ? 'Sources: ' : 'Source: ') + field('source');
    const vf = <?= json_encode($c['value_format'] ?? null) ?>;
    const pctDec = rows.some(r => r.unit === '%' && !Number.isInteger(+r.value));
    const fmt = (v, unit) => (+v).toFixed(vf === 'ratio' ? (+v < 10 ? 1 : 0) : vf === 'one_decimal' ? 1 : unit === '%' ? (pctDec ? 1 : 0) : (Number.isInteger(+v) ? 0 : 1));
    const val = r => r.unit === '$' ? '$' + (+r.value).toFixed(2) : fmt(r.value, r.unit) + (r.unit === '%' ? '%' : String(r.unit).length <= 3 ? ' ' + r.unit : '');
    const bg = cardColor(field('card_bg'));
    const podium = ok.slice(0, 3), list = ok.slice(3), gaps = list.filter(r => r.gap_before).length;
    const t = Math.max(0, Math.min(1, (list.length - 7) / 10)), photoH = Math.round(560 - 150 * t), s = 1 - 0.3 * t;
    // The headline: up to 2 lines from 64 px down to 44.
    const head = field('headline'), acc = field('headline_accent').toLowerCase(), at = acc ? head.toLowerCase().indexOf(acc) : -1;
    let px = 64; while (px > 44 && textW(head, px, 800, BALOO) > 2 * 968 * 0.95) px -= 2;
    const lines = Math.min(3, Math.ceil(textW(head, px, 800, BALOO) / 968)), lh = Math.round(px * 1.08);
    const headHtml = at < 0 ? esc(head) : esc(head.slice(0, at)) + `<em>${esc(head.slice(at, at + acc.length))}</em>` + esc(head.slice(at + acc.length));
    const titleEnd = photoH + 4 + lines * lh;
    const d = [150 * s, 118 * s, 118 * s], h = [236 * s, 196 * s, 172 * s], blockW = (888 - 44) / 3;
    const podTop = titleEnd + 22 + 44 * s, podBase = podTop + d[0] * 0.82 + h[0];
    const listTop = podBase + 26, slot = list.length ? (1650 - 26 - listTop) / (list.length + 0.6 * gaps) : 0;
    const H = Math.min(76, Math.round(slot * 0.86)), stride = Math.min(slot, H + 12), k = H / 70;
    const vals = list.map(r => +r.value).sort((a, b) => b - a);
    const broken = vals.length > 2 && vals[0] > 2.5 * vals[1];
    const max = Math.max(1e-9, broken ? vals[1] * 1.15 : (vals[0] || 1));
    const valW = Math.max(0, ...list.map(r => textW(val(r), 30 * k, 800))) + 6;
    const nameX = 14 + 44 * k + 12 + H * 0.6 + 14;
    const nameW = Math.min(888 * 0.44, Math.max(888 * 0.26, ...list.map(r => textW(r.country, 30 * k, 800))));
    const barX = nameX + nameW + 18, barMax = Math.max(40, 888 - 20 - valW - 16 - barX);
    screen.style.background = bg;
    let html = `<div class="photo" style="height:${photoH}px">` + (clip ? `<video class="clip" src="${esc(clip.url)}" muted loop autoplay playsinline style="height:${photoH}px"></video>` : '<div class="noclip">🚩 No clip yet</div>') + '</div>';
    html += `<svg class="wave" style="top:${photoH - 94}px" width="1080" height="96" viewBox="0 0 400 34" preserveAspectRatio="none"><path d="M0 22 C70 34 120 4 200 10 C270 15 320 30 400 14 L400 35 L0 35Z" fill="${bg}"/></svg>`;
    if (clip && clip.credit) html += `<div class="credit">${esc(clip.credit)}</div>`;
    if (field('detail')) html += `<div class="sticker" style="bottom:${1920 - photoH + 110}px">${esc(field('detail'))}</div>`;
    html += `<div class="head" style="top:${photoH + 4}px;font-size:${px}px;line-height:${lh}px">${headHtml}</div>`;
    [1, 0, 2].forEach((ri, col) => {
      const r = podium[ri]; if (!r) return;
      const x = 56 + col * (blockW + 22), top = podBase - h[ri];
      html += `<div class="pod" style="left:${x}px;top:${top}px;width:${blockW}px;height:${h[ri]}px;font-size:${32 * s}px">
        <div style="font-size:${52 * s}px">${['🥇', '🥈', '🥉'][+r.rank - 1] || ''}</div><div>${esc(r.country)}</div>
        <div class="v" style="font-size:${54 * s}px">${esc(val(r))}</div>${+r.rank === 1 ? `<div class="champ" style="font-size:${20 * s}px">CHAMPION</div>` : ''}</div>
        <div class="badge" style="left:${x + (blockW - d[ri]) / 2}px;top:${top - d[ri] * 0.82}px;width:${d[ri]}px;height:${d[ri]}px;border-width:${8 * s}px;font-size:${d[ri] * 0.5}px">${esc(r.flag)}${+r.rank === 1 ? `<span class="crown" style="font-size:${60 * s}px">👑</span>` : ''}</div>`;
    });
    let y = listTop;
    list.forEach((r, i) => {
      if (r.gap_before) { html += `<div class="gap" style="top:${y}px;height:${stride * 0.6}px;font-size:${26 * k}px;letter-spacing:${14 * k}px">• • •</div>`; y += stride * 0.6; }
      const hot = r.highlight === true || highlight.includes(String(r.country).trim().toLowerCase());
      const isBroken = broken && +r.value > max, w = isBroken ? barMax : Math.max(10, barMax * (+r.value) / max);
      html += `<div class="row${hot ? ' hot' : ''}" style="top:${y}px;height:${H}px;border-radius:${18 * k}px">
        <div class="rank" style="width:${44 * k}px;height:${H}px;font-size:${28 * k}px">${esc(r.rank)}</div>
        <div style="left:${14 + 44 * k + 12}px;height:${H}px;font-size:${H * 0.5}px">${esc(r.flag)}</div>
        <div class="name" style="left:${nameX}px;width:${nameW}px;height:${H}px;font-size:${30 * k}px">${esc(r.country)}</div>
        <div class="bar" style="left:${barX}px;top:${(H - 16 * k) / 2}px;height:${16 * k}px;width:${w}px"></div>
        <div class="val" style="left:${barX + w + 12}px;height:${H}px;font-size:${30 * k}px">${esc(val(r))}</div></div>`;
      y += stride;
    });
    html += `<div class="ask"><b>What's YOUR country's answer? 🌍</b><span>hilads.live 👉</span></div><div class="source">${esc(srcText)}</div>`;
    screen.innerHTML = html;
  }

  // The rows table.
  const tbody = document.getElementById('rx-rows');
  function table() {
    tbody.innerHTML = rows.map((r, i) => `<tr data-i="${i}">
      <td><input data-k="rank" value="${esc(r.rank)}" inputmode="numeric"></td><td><input data-k="flag" value="${esc(r.flag)}"></td>
      <td><input data-k="country" value="${esc(r.country)}"></td><td><input data-k="value" value="${esc(r.value)}" inputmode="decimal"></td>
      <td><input data-k="unit" value="${esc(r.unit)}"></td>
      <td><input type="checkbox" data-k="gap_before"${r.gap_before ? ' checked' : ''}></td><td><input type="checkbox" data-k="highlight"${r.highlight ? ' checked' : ''}></td>
      <td><button type="button" class="btn btn-secondary btn-sm" data-del>✕</button></td></tr>`).join('');
  }
  tbody.addEventListener('input', e => {
    const tr = e.target.closest('tr'), k = e.target.dataset.k;
    if (!tr || !k) return;
    rows[+tr.dataset.i][k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    document.getElementById('rx-rows-state').textContent = 'not saved';
    render();
  });
  tbody.addEventListener('click', e => {
    if (!e.target.matches('[data-del]')) return;
    rows.splice(+e.target.closest('tr').dataset.i, 1);
    table(); render();
  });
  document.getElementById('rx-add').addEventListener('click', () => {
    const last = rows[rows.length - 1] || {};
    rows.push({ rank: (+last.rank || 0) + 1, flag: '', country: '', value: '', unit: last.unit || '' });
    table();
  });
  document.getElementById('rx-save').addEventListener('click', async () => {
    const state = document.getElementById('rx-rows-state');
    state.textContent = 'saving…';
    try {
      const out = await api({ action: 'save_rows', package_id: pkgId, rows: JSON.stringify(rows) });
      state.textContent = 'saved' + (out.warnings.length ? ' · ' + out.warnings.join(' ') : '');
    } catch (err) { state.textContent = 'not saved: ' + err.message; }
  });

  // The clip: its AI mark, "Find another clip" (3 Pixabay options a page), use one.
  const ai = document.getElementById('rx-ai');
  if (ai) ai.addEventListener('change', () => api({ action: 'clip_ai', package_id: pkgId, ai: ai.checked ? '1' : '' }).then(() => location.reload()));
  let page = 0;
  const opts = document.getElementById('rx-options'), more = document.getElementById('rx-more'), findState = document.getElementById('rx-find-state');
  async function search() {
    findState.textContent = 'searching…';
    try {
      const out = await api({ action: 'clip_search', query: document.getElementById('rx-query').value, page });
      findState.textContent = out.options.length ? '' : 'Nothing found: try other words.';
      opts.innerHTML = out.options.map(o => `<div class="opt">
        <video src="${esc(o.preview)}" poster="${esc(o.thumb)}" muted loop autoplay playsinline></video>
        <div>#${o.id} · ${esc(o.author)} · ${o.duration} s${o.ai ? ' · 🤖 AI' : ''}</div>
        <div title="${esc(o.tags)}" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(o.tags)}</div>
        <a href="${esc(o.page)}" target="_blank" rel="noopener">source ↗</a>
        <button type="button" class="btn btn-primary btn-sm" data-use="${o.id}" style="margin-top:4px;width:100%">Use this clip</button></div>`).join('');
      more.style.display = out.more ? '' : 'none';
    } catch (err) { findState.textContent = 'Search failed: ' + err.message; }
  }
  document.getElementById('rx-search').addEventListener('click', () => { page = 0; search(); });
  more.addEventListener('click', () => { page++; search(); });
  opts.addEventListener('click', async e => {
    const id = e.target.dataset.use;
    if (!id) return;
    findState.textContent = 'copying the clip…';
    opts.querySelectorAll('button').forEach(b => b.disabled = true);
    try {
      await api({ action: 'clip_pick', package_id: pkgId, pixabay_id: id });
      location.reload();
    } catch (err) {
      findState.textContent = 'Not used: ' + err.message;
      opts.querySelectorAll('button').forEach(b => b.disabled = false);
    }
  });

  document.querySelectorAll('.worlds-field textarea').forEach(t => t.addEventListener('input', render));
  table(); render();
})();
</script>
