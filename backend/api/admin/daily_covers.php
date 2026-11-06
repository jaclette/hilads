<?php

declare(strict_types=1);

// Daily Challenge covers in bulk: each file named after its day (2026-11-16.jpg,
// 2026-11-16-chilies.webp…) becomes that day's own cover, as the Upload cover
// button on the day's page does. Days without a challenge are skipped.
// The page sends the files one at a time (a progress bar, a row per file as it
// lands, no post_max_size limit on the batch); without JavaScript the form
// posts them all at once.

admin_require_login();
require_once __DIR__ . '/daily_common.php';

/** Save each uploaded file ($_FILES['covers'], multiple) as its day's cover: one report line per file. */
function daily_covers_save(?array $files): array
{
    $report = [];
    $count  = is_array($files['name'] ?? null) ? count($files['name']) : 0;
    for ($i = 0; $i < $count; $i++) {
        $name = (string) $files['name'][$i];
        if (($files['error'][$i] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE) {
            continue;
        }
        $line = ['file' => $name, 'date' => null, 'ok' => false, 'detail' => '', 'url' => null, 'id' => null];
        if (!preg_match('/^(\d{4}-\d{2}-\d{2})/', $name, $m)) {
            $line['detail'] = 'The file name must start with the day, e.g. 2026-11-16.jpg.';
            $report[] = $line;
            continue;
        }
        $line['date'] = $m[1];
        $stmt = Database::pdo()->prepare("SELECT id, cover_url FROM daily_challenges WHERE challenge_date = ?");
        $stmt->execute([$m[1]]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$row) {
            $line['detail'] = 'No challenge on that day: import it first.';
            $report[] = $line;
            continue;
        }
        $line['id'] = $row['id'];
        try {
            $url = daily_cover_upload([
                'name' => $name, 'tmp_name' => $files['tmp_name'][$i], 'error' => $files['error'][$i], 'size' => $files['size'][$i],
            ]);
            DailyAdminService::setCover((string) $row['id'], $url);
            $line['ok'] = true;
            $line['url'] = $url;
            $line['detail'] = $row['cover_url'] ? 'Saved, replaces its previous cover.' : 'Saved.';
        } catch (InvalidArgumentException $e) {
            $line['detail'] = $e->getMessage();
        }
        $report[] = $line;
    }
    usort($report, fn($a, $b) => strcmp((string) $a['date'] . $a['file'], (string) $b['date'] . $b['file']));
    return $report;
}

$report = null;

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $one = ($_GET['one'] ?? '') === '1';   // the page's one-file-at-a-time upload: answers JSON
    // Over post_max_size PHP drops the whole body (no CSRF token, no files): say why.
    if ($_POST === [] && (int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > 0) {
        $error = 'Too much at once (the limit is ' . ini_get('post_max_size') . ' per upload): send the files in smaller batches.';
        if ($one) {
            http_response_code(413);
            header('Content-Type: application/json');
            echo json_encode(['error' => 'Too big (the limit is ' . ini_get('post_max_size') . ').']);
            exit;
        }
        flash_set('error', $error);
        admin_redirect('/admin/daily/covers');
    }
    csrf_verify();
    $report = daily_covers_save($_FILES['covers'] ?? null);
    if ($one) {
        header('Content-Type: application/json');
        echo json_encode(['report' => $report]);
        exit;
    }
    if ($report === []) {
        flash_set('error', 'Choose the cover images to upload.');
    }
}

admin_head('Daily covers');
admin_nav('/admin/daily');
daily_styles();
?>
<style>
.covers-progress { margin: 4px 0 14px; }
.covers-bar { height: 10px; border-radius: 5px; background: #2a2a2a; overflow: hidden; }
.covers-bar span { display: block; height: 100%; width: 0; background: #FF7A3C; transition: width .2s; }
.covers-status { margin-top: 8px; font-size: 13px; color: #aaa; }
.covers-thumb { width: 200px; aspect-ratio: 5/2; object-fit: cover; border-radius: 6px; display: block; }
</style>
<div class="admin-main">
    <h1 class="page-title">🖼️ Covers</h1>
    <?php daily_subnav('/admin/daily/covers'); ?>
    <?= flash_html() ?>

    <div class="form-card" id="covers-results"<?= $report ? '' : ' hidden' ?>>
        <h3 style="margin-bottom:8px" id="covers-summary">
            <?php if ($report): $saved = count(array_filter($report, fn($l) => $l['ok'])); ?><?= $saved ?> of <?= count($report) ?> cover(s) saved<?php endif; ?>
        </h3>
        <div class="covers-progress" id="covers-progress" hidden>
            <div class="covers-bar"><span id="covers-bar"></span></div>
            <div class="covers-status" id="covers-status"></div>
        </div>
        <div class="table-wrapper"><table class="daily-stack">
            <thead><tr><th>Day</th><th>File</th><th>Cover</th><th>Result</th></tr></thead>
            <tbody id="covers-rows">
            <?php foreach ($report ?? [] as $l): ?>
                <tr><td><?= $l['id'] ? '<a href="/admin/daily/' . dh($l['id']) . '#cover">' . dh($l['date']) . '</a>' : dh($l['date'] ?? '') ?></td>
                    <td class="daily-muted"><?= dh($l['file']) ?></td>
                    <td><?php if ($l['url']): ?><img class="covers-thumb" src="<?= dh($l['url']) ?>" alt=""><?php endif; ?></td>
                    <td style="color:<?= $l['ok'] ? '#4ade80' : '#f87171' ?>"><?= dh($l['detail']) ?></td></tr>
            <?php endforeach; ?>
            </tbody>
        </table></div>
    </div>

    <form method="POST" action="/admin/daily/covers" enctype="multipart/form-data" class="form-card" id="covers-form">
        <?= csrf_input() ?>
        <div class="form-group"><label>Cover images</label>
            <input type="file" name="covers[]" accept="image/jpeg,image/png,image/webp" multiple required>
            <div class="hint">Each file is named after its day (<code>2026-11-16.jpg</code>, or <code>2026-11-16-anything.jpg</code>) and becomes that day's own cover, replacing the one it had. JPEG, PNG or WebP under 10 MB; best at 1200×480 (the card's 5:2 band). Sent one at a time, as many as you like. Import the days first: an import that changes a day's text clears its cover.</div></div>
        <div class="form-actions"><button class="btn btn-primary" type="submit" id="covers-submit">Upload covers</button></div>
    </form>
</div>
<script>
// One file per request, in day order: the bar fills as the bytes go up, a row lands per file.
(function () {
  var form = document.getElementById('covers-form');
  if (!form || !window.FormData || !window.XMLHttpRequest) return;
  var input = form.querySelector('input[type=file]');
  var token = form.querySelector('input[name=csrf_token]').value;
  var button = document.getElementById('covers-submit');
  var results = document.getElementById('covers-results');
  var rows = document.getElementById('covers-rows');
  var summary = document.getElementById('covers-summary');
  var progress = document.getElementById('covers-progress');
  var bar = document.getElementById('covers-bar');
  var status = document.getElementById('covers-status');

  function esc(s) { var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
  function addRow(l) {
    var day = l.id ? '<a href="/admin/daily/' + esc(l.id) + '#cover">' + esc(l.date) + '</a>' : esc(l.date || '');
    var tr = document.createElement('tr');
    tr.innerHTML = '<td>' + day + '</td><td class="daily-muted">' + esc(l.file) + '</td>'
      + '<td>' + (l.url ? '<img class="covers-thumb" src="' + esc(l.url) + '" alt="">' : '') + '</td>'
      + '<td style="color:' + (l.ok ? '#4ade80' : '#f87171') + '">' + esc(l.detail) + '</td>';
    rows.appendChild(tr);
  }
  function send(file, onProgress) {
    return new Promise(function (resolve) {
      var fd = new FormData();
      fd.append('csrf_token', token);
      fd.append('covers[]', file, file.name);
      var xhr = new XMLHttpRequest();
      xhr.open('POST', '/admin/daily/covers?one=1');
      xhr.upload.onprogress = function (e) { if (e.lengthComputable) onProgress(e.loaded / e.total); };
      xhr.onload = function () {
        var body = null;
        try { body = JSON.parse(xhr.responseText); } catch (e) {}
        if (body && body.report) resolve(body.report);
        else if (/\/admin\/login/.test(xhr.responseURL || '')) resolve([{ file: file.name, ok: false, detail: 'Logged out: log in again, then upload the rest.' }]);
        else resolve([{ file: file.name, ok: false, detail: (body && body.error) || ('Upload failed (HTTP ' + xhr.status + ').') }]);
      };
      xhr.onerror = function () { resolve([{ file: file.name, ok: false, detail: 'Network error: try this file again.' }]); };
      xhr.send(fd);
    });
  }

  form.addEventListener('submit', function (e) {
    var files = Array.prototype.slice.call(input.files || []);
    if (!files.length) return;
    e.preventDefault();
    files.sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });
    button.disabled = true;
    input.disabled = true;
    rows.innerHTML = '';
    results.hidden = false;
    progress.hidden = false;
    var total = files.length, saved = 0, i = 0;
    summary.textContent = 'Uploading ' + total + ' cover(s)…';
    (function next() {
      if (i >= total) {
        bar.style.width = '100%';
        status.textContent = 'Done.';
        summary.textContent = saved + ' of ' + total + ' cover(s) saved';
        button.disabled = false;
        input.disabled = false;
        input.value = '';
        return;
      }
      var file = files[i];
      status.textContent = (i + 1) + ' of ' + total + ' · ' + file.name;
      send(file, function (f) { bar.style.width = ((i + f) / total * 100) + '%'; }).then(function (report) {
        report.forEach(function (l) { if (l.ok) saved++; addRow(l); });
        i++;
        bar.style.width = (i / total * 100) + '%';
        next();
      });
    })();
  });
})();
</script>
<?php admin_foot();
