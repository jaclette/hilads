<?php

declare(strict_types=1);

// One "Different Worlds" topic: its details and status, the package (latest
// version or ?v=N) with its slides, every text field editable inline (an
// on-screen text redraws its slide), copy buttons, ZIP of the slides.

admin_require_login();
require_once __DIR__ . '/worlds_common.php';

$topic = DwStudio::topic((int) $worldsTopicId);
if ($topic === null) {
    http_response_code(404);
    admin_die('Topic not found.');
}
$id   = $topic['id'];
$self = '/admin/worlds/' . $id;
$ver  = isset($_GET['v']) ? max(1, (int) $_GET['v']) : null;
$pkg  = DwStudio::package($id, $ver);
$back = $self . ($ver !== null ? '?v=' . $ver : '');

if (isset($_GET['zip']) && $pkg !== null) {
    try {
        $path = DwStudio::zip($pkg['id']);
    } catch (RuntimeException $e) {
        flash_set('error', $e->getMessage());
        admin_redirect($back);
    }
    header('Content-Type: application/zip');
    header('Content-Disposition: attachment; filename="different-worlds-' . $topic['date'] . '-v' . $pkg['version'] . '.zip"');
    header('Content-Length: ' . filesize($path));
    readfile($path);
    @unlink($path);
    exit;
}

$report = null;
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    csrf_verify();
    $action = (string) ($_POST['action'] ?? '');
    if ($action === 'update') {
        worlds_action(fn() => DwStudio::updateTopic($id, $_POST), 'Topic saved.', $back);
    }
    if ($action === 'delete') {
        worlds_action(function () use ($id, $topic) {
            DwStudio::deleteTopic($id);
            flash_set('success', 'Topic deleted.');
            admin_redirect('/admin/worlds?month=' . substr($topic['date'], 0, 7));
        }, '', $back);
    }
    if ($action === 'status') {
        $status = (string) ($_POST['status'] ?? '');
        worlds_action(fn() => DwStudio::setStatus($id, $status, $status === 'published' ? (array) ($_POST['links'] ?? []) : null),
            'Marked ' . $status . '.', $back);
    }
    if ($action === 'svg' && $pkg !== null) {
        $svg  = (string) ($_POST['svg'] ?? '');
        $file = $_FILES['svg_file'] ?? null;
        if ($file && ($file['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_OK && is_uploaded_file($file['tmp_name'])) {
            $svg = (string) file_get_contents($file['tmp_name']);
        }
        $pos = (int) ($_POST['position'] ?? 0);
        worlds_action(fn() => DwStudio::replaceIllustration($pkg['id'], $pos, $svg) ?? "Slide {$pos} redrawn.", '', $back . '#slides');
    }
    if ($action === 'import') {
        $json = (string) ($_POST['json'] ?? '');
        $file = $_FILES['file'] ?? null;
        if ($file && ($file['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_OK && is_uploaded_file($file['tmp_name'])) {
            $json = (string) file_get_contents($file['tmp_name']);
        }
        $doc = json_decode($json, true);
        if (!is_array($doc)) {
            flash_set('error', 'That is not valid JSON.');
            admin_redirect($self);
        }
        set_time_limit(300);
        $report = DwStudio::import($doc, $id)[0] ?? null;
        if ($report !== null && $report['ok']) {
            $_SESSION['dw_import_warnings'] = $report['warnings'];
            flash_set('success', 'Version ' . $report['version'] . ' imported, slides rendered.');
            admin_redirect($self);
        }
    }
}
$importWarnings = $_SESSION['dw_import_warnings'] ?? [];
unset($_SESSION['dw_import_warnings']);

$topic    = DwStudio::topic($id);
$versions = DwStudio::versions($id);
$slides   = $pkg !== null ? DwStudio::slides($pkg['id']) : [];
$plan     = $pkg !== null ? DwStudio::slidePlan($pkg['content']) : [];
$c        = $pkg['content'] ?? [];
$links    = $topic['published_links'];

/** One editable field: a textarea (or input) saved on change, with a copy button. */
function worlds_field(string $path, string $label, string $value, bool $long = false, ?string $hint = null): void
{
    echo '<div class="worlds-field"><label><span>' . wh($label) . ($hint ? ' <span class="worlds-muted">· ' . wh($hint) . '</span>' : '')
        . '</span><span><span class="state"></span> <button type="button" class="btn btn-secondary btn-sm" data-copy>Copy</button></span></label>';
    echo '<textarea data-path="' . wh($path) . '" rows="' . ($long ? 3 : 1) . '">' . wh($value) . '</textarea></div>';
}

admin_head('Worlds · ' . $topic['title']);
admin_nav('/admin/worlds');
worlds_styles();
?>
<div class="admin-main">
    <h1 class="page-title">🌍 <?= wh($topic['title']) ?></h1>
    <?php worlds_subnav(''); ?>
    <p class="worlds-muted" style="margin-bottom:14px">
        <a href="/admin/worlds?month=<?= substr($topic['date'], 0, 7) ?>">← <?= wh((new DateTimeImmutable($topic['date']))->format('F Y')) ?></a> ·
        <?= wh((new DateTimeImmutable($topic['date']))->format('l j F Y')) ?> · <?= wh($topic['type']) ?> · <?= worlds_status_badge($topic['status']) ?>
        <?php foreach ($links as $p => $u): ?> · <a href="<?= wh($u) ?>" target="_blank" rel="noopener"><?= wh($p) ?></a><?php endforeach; ?>
    </p>
    <?php if ($topic['needs_date_check']): ?><div class="worlds-warn">⚠️ The date of this event must be checked before publishing.</div><?php endif; ?>
    <?= flash_html() ?>

    <?php if ($report !== null && !$report['ok']): ?>
        <div class="form-card" style="max-width:none;margin-bottom:18px"><h3 style="color:#f87171;margin-bottom:6px">Not imported</h3>
            <ul class="worlds-report"><?php foreach (array_merge($report['errors'], $report['warnings']) as $e): ?><li><?= wh($e) ?></li><?php endforeach; ?></ul></div>
    <?php endif; ?>
    <?php if ($importWarnings !== []): ?>
        <div class="worlds-warn"><strong>Import notes</strong><ul class="worlds-report"><?php foreach ($importWarnings as $w): ?><li><?= wh($w) ?></li><?php endforeach; ?></ul></div>
    <?php endif; ?>

    <?php if ($pkg === null): ?>
        <div class="form-card" style="max-width:none;margin-bottom:18px">
            <h3 style="margin-bottom:6px">No package yet</h3>
            <p class="worlds-muted">Prepare it from the <a href="/admin/worlds?brief=1&days=14">brief</a> in Claude Code, then import it below.</p>
        </div>
    <?php else: ?>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px" id="slides">
            <strong>Version <?= $pkg['version'] ?></strong>
            <span class="worlds-muted"><?= wh($pkg['model']) ?> · <?= wh(date('j M H:i', strtotime($pkg['created_at']))) ?></span>
            <?php if (count($versions) > 1): ?>
                <select onchange="location.href='<?= $self ?>?v='+this.value">
                    <?php foreach ($versions as $v): ?><option value="<?= (int) $v['version'] ?>"<?= (int) $v['version'] === $pkg['version'] ? ' selected' : '' ?>>v<?= (int) $v['version'] ?><?= $v === $versions[0] ? ' (latest)' : '' ?></option><?php endforeach; ?>
                </select>
            <?php endif; ?>
            <a class="btn btn-primary" href="<?= $self ?>?v=<?= $pkg['version'] ?>&zip=1">⬇ Download all slides (ZIP)</a>
            <button type="button" class="btn btn-secondary" data-full-caption>Copy full caption</button>
        </div>

        <div class="worlds-strip">
            <?php foreach ($plan as $p): $s = array_values(array_filter($slides, fn($r) => (int) $r['position'] === $p['position']))[0] ?? null; ?>
                <div class="worlds-slide">
                    <a href="<?= wh($s['png_url'] ?? '#') ?>" target="_blank" rel="noopener"><img data-pos="<?= $p['position'] ?>" src="<?= wh($s['png_url'] ?? '') ?>" alt="" loading="lazy"></a>
                    <div class="worlds-muted"><?= wh(DwSlides::fileName($p['position'], $p['kind'], $p['country'] ?? null)) ?>
                        <?= !empty($s['error']) ? '<br><span style="color:#f87171">' . wh($s['error']) . '</span>' : '' ?>
                        <?= ($s && filter_var($s['fallback'], FILTER_VALIDATE_BOOLEAN)) ? '<br><span style="color:#fbbf24">plain background</span>' : '' ?></div>
                    <details><summary>Replace illustration</summary>
                        <p class="worlds-muted" title="<?= wh($p['brief']) ?>"><?= wh(mb_strimwidth($p['brief'], 0, 90, '…')) ?></p>
                        <form method="POST" action="<?= wh($back) ?>" enctype="multipart/form-data">
                            <?= csrf_input() ?><input type="hidden" name="action" value="svg"><input type="hidden" name="position" value="<?= $p['position'] ?>">
                            <textarea name="svg" placeholder="<svg …> (empty = plain background)"></textarea>
                            <input type="file" name="svg_file" accept=".svg,image/svg+xml" style="width:180px;font-size:11px">
                            <button class="btn btn-secondary btn-sm" type="submit">Redraw</button>
                        </form></details>
                </div>
            <?php endforeach; ?>
        </div>

        <?php if (!empty($c['warnings'])): ?>
            <div class="worlds-warn"><strong>Warnings</strong><ul class="worlds-report"><?php foreach ($c['warnings'] as $w): ?><li><?= wh($w) ?></li><?php endforeach; ?></ul></div>
        <?php endif; ?>

        <div class="worlds-grid" data-package="<?= $pkg['id'] ?>">
            <div class="form-card">
                <h3>Video</h3>
                <?php worlds_field('hook.on_screen_text', 'Hook · on screen', (string) ($c['hook']['on_screen_text'] ?? ''), false, DwStudio::words((string) ($c['hook']['on_screen_text'] ?? '')) . ' words'); ?>
                <?php worlds_field('hook.illustration_brief', 'Hook · illustration brief', (string) ($c['hook']['illustration_brief'] ?? ''), true); ?>
                <?php worlds_field('outro.question', 'Outro · question', (string) ($c['outro']['question'] ?? ''), false); ?>
                <?php worlds_field('outro.illustration_brief', 'Outro · illustration brief', (string) ($c['outro']['illustration_brief'] ?? ''), true); ?>
                <?php worlds_field('topic', 'Topic', (string) ($c['topic'] ?? '')); ?>
                <?php worlds_field('why_today', 'Why today', (string) ($c['why_today'] ?? ''), true); ?>
            </div>
            <div class="form-card">
                <h3>Post</h3>
                <?php worlds_field('caption', 'Caption', (string) ($c['caption'] ?? ''), true, DwStudio::words((string) ($c['caption'] ?? '')) . ' words'); ?>
                <?php worlds_field('hashtags', 'Hashtags', implode(' ', $c['hashtags'] ?? []), false, count($c['hashtags'] ?? []) . ''); ?>
                <?php worlds_field('ai_disclosure', 'AI disclosure', (string) ($c['ai_disclosure'] ?? ''), true); ?>
                <?php worlds_field('follow_up_idea', 'Follow-up idea', (string) ($c['follow_up_idea'] ?? ''), true); ?>
                <?php worlds_field('warnings', 'Warnings (one per line)', implode("\n", $c['warnings'] ?? []), true); ?>
            </div>
        </div>

        <h3 style="margin-bottom:10px">Countries</h3>
        <div class="worlds-grid" data-package="<?= $pkg['id'] ?>">
            <?php foreach (array_values($c['slides'] ?? []) as $i => $s): ?>
                <div class="worlds-country">
                    <h4><?= wh(($s['flag'] ?? '') . ' ' . ($s['country'] ?? '')) ?>
                        <?php if (!empty($s['source_url'])): ?><a class="worlds-muted" href="<?= wh($s['source_url']) ?>" target="_blank" rel="noopener">source ↗</a><?php endif; ?></h4>
                    <?php worlds_field("slides.{$i}.on_screen_text", 'On screen', (string) ($s['on_screen_text'] ?? ''), false, DwStudio::words((string) ($s['on_screen_text'] ?? '')) . ' words'); ?>
                    <?php worlds_field("slides.{$i}.caption_detail", 'Caption detail', (string) ($s['caption_detail'] ?? ''), true); ?>
                    <?php worlds_field("slides.{$i}.source_url", 'Source', (string) ($s['source_url'] ?? '')); ?>
                    <?php worlds_field("slides.{$i}.country", 'Country', (string) ($s['country'] ?? '')); ?>
                    <?php worlds_field("slides.{$i}.flag", 'Flag', (string) ($s['flag'] ?? '')); ?>
                    <?php worlds_field("slides.{$i}.illustration_brief", 'Illustration brief', (string) ($s['illustration_brief'] ?? ''), true); ?>
                </div>
            <?php endforeach; ?>
        </div>
    <?php endif; ?>

    <div class="worlds-grid">
        <form method="POST" action="<?= wh($back) ?>" class="form-card">
            <?= csrf_input() ?><input type="hidden" name="action" value="status">
            <h3 style="margin-bottom:8px">Status</h3>
            <p class="worlds-muted" style="margin-bottom:10px">Now: <?= worlds_status_badge($topic['status']) ?></p>
            <?php foreach (DwStudio::PLATFORMS as $p): ?>
                <div class="form-group"><label><?= ucfirst($p) ?> link</label><input type="url" name="links[<?= $p ?>]" value="<?= wh($links[$p] ?? '') ?>" placeholder="https://"></div>
            <?php endforeach; ?>
            <div class="form-actions" style="display:flex;gap:8px;flex-wrap:wrap">
                <button class="btn btn-secondary" name="status" value="ready" type="submit">Mark ready</button>
                <button class="btn btn-primary" name="status" value="published" type="submit">Mark published (with links)</button>
                <?php if ($topic['status'] !== 'planned'): ?><button class="btn btn-secondary btn-sm" name="status" value="<?= $pkg ? 'generated' : 'planned' ?>" type="submit">Back to <?= $pkg ? 'generated' : 'planned' ?></button><?php endif; ?>
            </div>
        </form>

        <form method="POST" action="<?= wh($self) ?>" enctype="multipart/form-data" class="form-card">
            <?= csrf_input() ?><input type="hidden" name="action" value="import">
            <h3 style="margin-bottom:8px"><?= $pkg ? 'Import a new version' : 'Import the package' ?></h3>
            <div class="form-group"><label>JSON file</label><input type="file" name="file" accept="application/json,.json"></div>
            <div class="form-group"><label>…or paste JSON</label><textarea name="json" rows="4" style="font-family:monospace;width:100%"></textarea></div>
            <button class="btn btn-primary" type="submit">Import and render</button>
        </form>

        <form method="POST" action="<?= wh($back) ?>" class="form-card">
            <?= csrf_input() ?><input type="hidden" name="action" value="update">
            <h3 style="margin-bottom:8px">Topic</h3>
            <div class="form-group"><label>Date</label><input type="date" name="date" required value="<?= wh($topic['date']) ?>"></div>
            <div class="form-group"><label>Title</label><input type="text" name="title" required maxlength="200" value="<?= wh($topic['title']) ?>"></div>
            <div class="form-group"><label>Notes</label><textarea name="notes" rows="2"><?= wh($topic['notes']) ?></textarea></div>
            <div class="form-group"><label>Type</label><select name="type">
                <?php foreach (['evergreen', 'dated'] as $ty): ?><option value="<?= $ty ?>"<?= $topic['type'] === $ty ? ' selected' : '' ?>><?= $ty ?></option><?php endforeach; ?></select></div>
            <div class="form-group"><label><input type="checkbox" name="needs_date_check" value="1"<?= $topic['needs_date_check'] ? ' checked' : '' ?>> The event date needs checking</label></div>
            <div class="form-actions"><button class="btn btn-primary" type="submit">Save</button></div>
        </form>
    </div>

    <form method="POST" action="<?= wh($self) ?>" onsubmit="return confirm('Delete this topic, its packages and slides?')" style="margin-top:8px">
        <?= csrf_input() ?><input type="hidden" name="action" value="delete">
        <button class="btn btn-danger btn-sm" type="submit">Delete topic</button>
    </form>
</div>
<script>
(function () {
  const csrf = <?= json_encode(csrf_token()) ?>;
  function copy(text, btn) {
    navigator.clipboard.writeText(text).then(() => { const t = btn.textContent; btn.textContent = 'Copied'; setTimeout(() => btn.textContent = t, 1200); });
  }
  // Caption + hashtags + disclosure, as edited on the page (same as DwStudio::fullCaption).
  const val = p => (document.querySelector('textarea[data-path="' + p + '"]') || {}).value || '';
  document.querySelectorAll('[data-full-caption]').forEach(b => b.addEventListener('click', () =>
    copy([val('caption'), val('hashtags'), val('ai_disclosure')].map(s => s.trim()).filter(Boolean).join('\n\n'), b)));
  document.querySelectorAll('.worlds-field').forEach(field => {
    const area = field.querySelector('textarea');
    const state = field.querySelector('.state');
    field.querySelector('[data-copy]').addEventListener('click', e => copy(area.value, e.target));
    const fit = () => { area.style.height = 'auto'; area.style.height = (area.scrollHeight + 2) + 'px'; };
    fit(); area.addEventListener('input', fit);
    let saved = area.value;
    area.addEventListener('change', async () => {
      if (area.value === saved) return;
      const pkg = area.closest('[data-package]').dataset.package;
      state.className = 'state'; state.textContent = 'saving…';
      const body = new URLSearchParams({ csrf_token: csrf, action: 'update_field', package_id: pkg, path: area.dataset.path, value: area.value });
      try {
        const res = await fetch('/admin/worlds/api', { method: 'POST', body });
        const out = await res.json();
        if (!res.ok || !out.ok) throw new Error(out.error || res.status);
        saved = area.value;
        state.className = 'state saved'; state.textContent = out.slide ? 'saved · slide redrawn' : 'saved';
        if (out.warning) { state.className = 'state failed'; state.textContent = out.warning; }
        if (out.slide && out.slide.png_url) {
          document.querySelectorAll('img[data-pos="' + out.slide.position + '"]').forEach(img => { img.src = out.slide.png_url; img.parentElement.href = out.slide.png_url; });
        }
      } catch (e) { state.className = 'state failed'; state.textContent = 'not saved: ' + e.message; }
    });
  });
})();
</script>
<?php admin_foot();
