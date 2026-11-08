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
    <span class="worlds-badge is-clip">📊 Reaction + ranking · <?= DwReaction::VIDEO_SECONDS ?> s</span>
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
        <?php if (!empty($pkg['still_url'])): ?><a href="<?= wh($pkg['still_url']) ?>" target="_blank" rel="noopener"><img src="<?= wh($pkg['still_url']) ?>" alt="" style="width:220px;aspect-ratio:9/16;border-radius:8px;background:#000"></a><?php endif; ?>
        <div>
            <strong>Video and PNG</strong>
            <p class="worlds-muted">Rendered <?= wh(date('j M H:i', strtotime((string) ($pkg['video_at'] ?? 'now')))) ?> from version <?= $pkg['version'] ?>. Silent: add the music when you publish.</p>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
                <?php if (!empty($pkg['video_url'])): ?><a class="btn btn-primary" href="<?= wh($pkg['video_url']) ?>" download>⬇ Video</a><?php endif; ?>
                <?php if (!empty($pkg['still_url'])): ?><a class="btn btn-secondary" href="<?= wh($pkg['still_url']) ?>" download>⬇ PNG</a><?php endif; ?>
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
            <table class="rx-rows"><thead><tr><th>#</th><th>Flag</th><th>Country</th><th>Value</th><th>Unit</th><th></th></tr></thead>
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
        <?php worlds_field('outro_question', 'Outro question (caption only)', (string) ($c['outro_question'] ?? '')); ?>
        <?php worlds_field('hashtags', 'Hashtags', implode(' ', $c['hashtags'] ?? []), false, count($c['hashtags'] ?? []) . ''); ?>
        <?php worlds_field('warnings', 'Warnings (one per line)', implode("\n", $c['warnings'] ?? []), true); ?>
    </div>
</div>

<style>
.rx-layout { display:grid; grid-template-columns:400px minmax(0, 1fr); gap:20px; margin-bottom:18px; align-items:start; }
@media (max-width: 900px) { .rx-layout { grid-template-columns:1fr; } }
.rx-frame { width:378px; height:672px; overflow:hidden; border-radius:12px; border:1px solid #333; }
.rx-screen { width:1080px; height:1920px; transform:scale(0.35); transform-origin:0 0; position:relative; background:#16110D; color:#fff;
             font-family:'Be Vietnam Pro', system-ui, -apple-system, sans-serif; overflow:hidden; }
.rx-screen .clip { position:absolute; left:0; top:0; width:1080px; height:640px; object-fit:cover; background:#000; }
.rx-screen .noclip { position:absolute; left:0; top:0; width:1080px; height:640px; display:flex; align-items:center; justify-content:center; background:#2a0f0f; color:#f87171; font-size:48px; font-weight:800; }
.rx-screen .fade { position:absolute; left:0; top:580px; width:1080px; height:60px; background:linear-gradient(to bottom, rgba(22,17,13,0), #16110D); }
.rx-screen .credit { position:absolute; right:24px; top:24px; font-size:18px; font-weight:600; color:rgba(255,255,255,.8); background:rgba(0,0,0,.45); border-radius:14px; padding:4px 12px; }
.rx-screen .head { position:absolute; left:72px; top:648px; width:936px; }
.rx-screen .head b { display:block; font-size:60px; line-height:74px; font-weight:800; white-space:nowrap; }
.rx-screen .head span { display:block; font-size:34px; font-weight:600; color:rgba(255,255,255,.78); margin-top:6px; }
.rx-screen .row { position:absolute; left:56px; width:968px; height:44px; border-radius:10px; border:2px solid transparent; box-sizing:border-box; }
.rx-screen .row.alt { background:rgba(255,255,255,.045); }
.rx-screen .row.hot { background:rgba(255,122,61,.18); border-color:#FF7A3D; }
.rx-screen .row > * { position:absolute; top:0; height:40px; display:flex; align-items:center; white-space:nowrap; }
.rx-screen .rank { left:14px; width:50px; justify-content:flex-end; font-size:28px; font-weight:800; color:rgba(255,255,255,.6); }
.rx-screen .hot .rank, .rx-screen .hot .val { color:#FF7A3D; }
.rx-screen .flag { left:80px; font-size:28px; }
.rx-screen .name { left:124px; font-size:29px; font-weight:700; }
.rx-screen .bar { top:12px; height:16px; border-radius:8px; background:#D9AE52; }
.rx-screen .hot .bar { background:#FF7A3D; }
.rx-screen .val { font-size:27px; font-weight:800; }
.rx-screen .source { position:absolute; left:72px; width:936px; font-size:20px; font-weight:600; color:rgba(255,255,255,.55); }
.rx-screen .mark { position:absolute; left:72px; top:1792px; font-size:22px; line-height:28px; }
.rx-screen .mark i { font-style:normal; font-weight:800; letter-spacing:2px; color:#FF7A3D; }
.rx-rows { width:100%; border-collapse:collapse; }
.rx-rows th { text-align:left; color:#888; font-size:12px; font-weight:600; padding:2px 4px; }
.rx-rows td { padding:2px 4px; }
.rx-rows input { width:100%; background:#111; border:1px solid #333; color:#eee; padding:5px 6px; border-radius:5px; font-size:13px; }
.rx-rows td:nth-child(1) { width:56px; } .rx-rows td:nth-child(2) { width:56px; } .rx-rows td:nth-child(4) { width:90px; } .rx-rows td:nth-child(5) { width:60px; } .rx-rows td:nth-child(6) { width:28px; }
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

  // The screen as Reaction.jsx draws it (its last frame).
  function render() {
    const screen = document.getElementById('rx-screen');
    const ok = rows.filter(r => r.country && r.value !== '' && !isNaN(+r.value));
    const max = Math.max(1, ...ok.map(r => +r.value));
    const digits = ok.some(r => !Number.isInteger(+r.value)) ? 1 : 0;
    const BAR_X = 520, BAR_MAX = 1008 - BAR_X - 130, TOP = 812, H = 44;
    const year = field('data_years') || field('data_year'), label = field('value_label');
    const first = [label, year].filter(Boolean).join(', ');
    let html = clip ? `<video class="clip" src="${esc(clip.url)}" muted loop autoplay playsinline></video><div class="credit">${esc(clip.credit)}</div>`
                    : '<div class="noclip">🚩 No clip yet</div>';
    html += '<div class="fade"></div>';
    html += `<div class="head"><b>${esc(field('headline'))}</b>${field('detail') ? `<span>${esc(field('detail'))}</span>` : ''}</div>`;
    ok.forEach((r, i) => {
      const hot = +r.rank === 1 || highlight.includes(String(r.country).trim().toLowerCase());
      const w = BAR_MAX * (+r.value) / max;
      html += `<div class="row${hot ? ' hot' : i % 2 ? ' alt' : ''}" style="top:${TOP + i * H}px">
        <div class="rank">${esc(r.rank)}</div><div class="flag">${esc(r.flag)}</div><div class="name">${esc(r.country)}</div>
        <div class="bar" style="left:${BAR_X - 56}px;width:${Math.max(8, w)}px"></div>
        <div class="val" style="left:${BAR_X - 56 + w + 14}px">${esc((+r.value).toFixed(digits))}${r.unit === '%' ? '' : ' '}${esc(r.unit)}</div></div>`;
    });
    html += `<div class="source" style="top:${TOP + ok.length * H + 14}px">${esc((first ? first + ' · ' : '') + 'Source: ' + field('source'))}</div>`;
    html += '<div class="mark"><div><i>DIFFERENT WORLDS</i> by Hilads</div><div>Compare your city on <i style="letter-spacing:0">hilads.live</i></div></div>';
    screen.innerHTML = html;
  }

  // The rows table.
  const tbody = document.getElementById('rx-rows');
  function table() {
    tbody.innerHTML = rows.map((r, i) => `<tr data-i="${i}">
      <td><input data-k="rank" value="${esc(r.rank)}" inputmode="numeric"></td><td><input data-k="flag" value="${esc(r.flag)}"></td>
      <td><input data-k="country" value="${esc(r.country)}"></td><td><input data-k="value" value="${esc(r.value)}" inputmode="decimal"></td>
      <td><input data-k="unit" value="${esc(r.unit)}"></td><td><button type="button" class="btn btn-secondary btn-sm" data-del>✕</button></td></tr>`).join('');
  }
  tbody.addEventListener('input', e => {
    const tr = e.target.closest('tr'), k = e.target.dataset.k;
    if (!tr || !k) return;
    rows[+tr.dataset.i][k] = e.target.value;
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
