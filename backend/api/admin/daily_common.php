<?php

declare(strict_types=1);

// Shared helpers for the Daily Challenge back office pages (admin/daily_*.php).
// Admin pages run in Asia/Ho_Chi_Minh (boot.php); a challenge_date is the UTC
// date of its drop, so every date is shown with its live window in Saigon time.

function dh(?string $s): string
{
    return htmlspecialchars((string) $s, ENT_QUOTES);
}

/** "Mon 2 Nov 09:00 → Tue 3 Nov 09:00" in Saigon time. */
function daily_window_label(string $date): string
{
    [$start, $end] = DailyClock::window($date);
    return date('D j M H:i', $start->getTimestamp()) . ' → ' . date('D j M H:i', $end->getTimestamp());
}

function daily_text(?string $json): string
{
    return (string) (json_decode((string) $json, true)['en'] ?? '');
}

function daily_state_badge(string $state): string
{
    $map = [
        'empty'        => ['b-bad', 'Nothing planned'],
        'draft'        => ['b-mute', 'Draft'],
        'scheduled'    => ['b-info', 'Scheduled'],
        'published'    => ['b-ok', 'Published'],
        'reserve_used' => ['b-warn', 'From reserve'],
        'pending'      => ['b-warn', 'Pending'],
        'approved'     => ['b-ok', 'Approved'],
        'rejected'     => ['b-bad', 'Rejected'],
        'removed'      => ['b-mute', 'Removed'],
    ];
    [$cls, $label] = $map[$state] ?? ['b-mute', $state];
    return '<span class="badge ' . $cls . '">' . dh($label) . '</span>';
}

/**
 * Run a back office action: success → flash + redirect; refusal
 * (InvalidArgumentException) → error flash + redirect. Keeps every POST
 * handler a one-liner and post/redirect/get.
 */
/** Theme label for a stored theme (or the date's weekday theme). */
function daily_theme_label(?string $theme, ?string $date, ?string $specialId = null): string
{
    // effective(), not format(): the back office is a browser without "X-Themes: 2",
    // which format() takes for an old app and answers with the v1 names (Market, Coffee...).
    $key = DailyThemes::effective($theme, $date);
    if ($key === DailyThemes::SPECIAL) {
        $sp = DailySpecials::find($specialId);
        return $sp !== null ? DailySpecials::emoji($specialId) . ' ' . DailySpecials::nameOf($sp, 'en') : 'Special';
    }
    return $key === null ? '' : DailyThemes::name($key);
}

/**
 * Theme <select>: the 7 themes, preselected with $theme, else the weekday
 * theme of $date. With data-weekday-default, the editor's script follows the
 * date field until the admin picks a theme by hand. An empty value = the
 * weekday default.
 */
function daily_theme_select(?string $theme, ?string $date, bool $followDate = false, ?string $specialId = null): string
{
    $selected = DailyThemes::effective($theme, $date !== '' ? $date : null);
    if ($selected === DailyThemes::SPECIAL) {
        $selected = 'special:' . $specialId;
    }
    $days     = [1 => 'Mon', 2 => 'Tue', 3 => 'Wed', 4 => 'Thu', 5 => 'Fri', 6 => 'Sat', 7 => 'Sun'];
    $html     = '<select name="theme" id="dc-theme"' . ($followDate && $theme === null ? ' data-follow-date="1"' : '') . '>';
    $html    .= '<option value=""' . ($selected === null ? ' selected' : '') . '>Weekday default</option>';
    foreach (DailyThemes::all() as $t) {
        $html .= '<option value="' . dh($t['key']) . '" data-weekday="' . $t['weekday'] . '"'
               . ($selected === $t['key'] ? ' selected' : '') . '>'
               . dh($t['name']) . ' (' . $days[$t['weekday']] . ')</option>';
    }
    // World special days replace the weekly theme (Special days page).
    $specials = array_filter(DailySpecials::listFrom(DailyClock::currentDate()), static fn(array $s): bool => $s['scope'] === 'world');
    if ($specials !== [] || str_starts_with((string) $selected, 'special:')) {
        $html .= '<optgroup label="Special days">';
        $listed = false;
        foreach ($specials as $s) {
            $v       = 'special:' . $s['id'];
            $listed  = $listed || $selected === $v;
            $html   .= '<option value="' . dh($v) . '"' . ($selected === $v ? ' selected' : '') . '>'
                     . dh(($s['emoji'] ?: '✨') . ' ' . DailySpecials::nameOf($s, 'en') . ' (' . $s['date'] . ')') . '</option>';
        }
        if (!$listed && str_starts_with((string) $selected, 'special:')) {
            $html .= '<option value="' . dh($selected) . '" selected>' . dh(daily_theme_label(DailyThemes::SPECIAL, $date, $specialId)) . '</option>';
        }
        $html .= '</optgroup>';
    }
    return $html . '</select>';
}

/** OpenStreetMap link to a position. */
function daily_osm_link(float $lat, float $lng): string
{
    $q = sprintf('mlat=%.6F&mlon=%.6F#map=18/%.6F/%.6F', $lat, $lng, $lat, $lng);
    return '<a href="https://www.openstreetmap.org/?' . $q . '" target="_blank" rel="noopener">'
         . sprintf('%.5F, %.5F', $lat, $lng) . ' ↗</a>';
}

/** Badge for a place's status (V3-05), plus hidden / merged. */
function daily_place_badges(array $p): string
{
    $html = daily_state_badge($p['status'] === 'pending' ? 'pending' : $p['status']);
    if (DailyProofRepository::bool($p['hidden'] ?? false)) {
        $html .= ' <span class="badge" style="background:var(--surface-2);color:var(--text)">hidden</span>';
    }
    if (($p['merged_into'] ?? null) !== null) {
        $html .= ' <span class="badge" style="background:var(--surface-2);color:var(--text)">merged</span>';
    }
    return $html;
}

function daily_action(callable $fn, string $successMessage, string $redirect): never
{
    try {
        $result = $fn();
        flash_set('success', is_string($result) && $result !== '' ? $result : $successMessage);
    } catch (InvalidArgumentException $e) {
        flash_set('error', $e->getMessage());
    }
    admin_redirect($redirect);
}

/** The app's other 18 locales with their names, for the translation forms. */
function daily_locale_names(): array
{
    return [
        'fr' => 'French', 'vi' => 'Vietnamese', 'es' => 'Spanish', 'it' => 'Italian', 'pt-br' => 'Portuguese (Brazil)',
        'pt-pt' => 'Portuguese (Portugal)', 'de' => 'German', 'nl' => 'Dutch', 'zh-hans' => 'Chinese (Simplified)',
        'zh-hant' => 'Chinese (Traditional)', 'ja' => 'Japanese', 'ko' => 'Korean', 'fil' => 'Filipino', 'th' => 'Thai',
        'id' => 'Indonesian', 'hi' => 'Hindi', 'ru' => 'Russian', 'ar' => 'Arabic',
    ];
}

/** Brand-term warnings for a {locale: text} map against its English: "fr: Daily Challenge; vi: Local Twist". */
function daily_brand_warnings(string $english, array $translations): string
{
    $out = [];
    foreach ($translations as $locale => $text) {
        if (!is_string($text) || str_starts_with((string) $locale, '_') || $locale === 'en') continue;
        $missing = DailyI18n::missingBrandTerms($english, $text);
        if ($missing !== []) $out[] = $locale . ': ' . implode(', ', $missing);
    }
    return implode('; ', $out);
}

function daily_subnav(string $current): void
{
    echo daily_tabs($current);
}

/**
 * The tabs of the sidebar section a Daily page belongs to: Daily challenges (calendar, today,
 * reserve, proposals, import, covers, translations, history), Special days & events, Places.
 */
function daily_tabs(string $current): string
{
    $groups = [
        'challenges' => ['/admin/daily' => 'Calendar', '/admin/daily/today' => 'Today', '/admin/daily/reserve' => 'Reserve',
                         '/admin/daily/proposals' => 'Proposals', '/admin/daily/translations' => 'Translations',
                         '/admin/daily/covers' => 'Covers', '/admin/daily/import' => 'Import', '/admin/daily/log' => 'History'],
        'specials'   => ['/admin/daily/specials' => 'Special days', '/admin/daily/events' => 'Seasonal events'],
        'places'     => ['/admin/daily/spots' => 'Spots', '/admin/daily/picks' => 'Hilads picks'],
        'promo'      => [],
    ];
    $group = match (true) {
        str_starts_with($current, '/admin/daily/specials'), str_starts_with($current, '/admin/daily/events') => 'specials',
        str_starts_with($current, '/admin/daily/spots'), str_starts_with($current, '/admin/daily/picks') => 'places',
        str_starts_with($current, '/admin/daily/promo') => 'promo',
        default => 'challenges',
    };
    if ($groups[$group] === []) return '';
    $pending = admin_pending_proposals();
    $tabs = [];
    foreach ($groups[$group] as $href => $label) {
        $tabs[] = [$label, $href, $href === '/admin/daily/proposals' && $pending > 0 ? $pending : null, $current === $href];
    }
    return '<div style="margin-bottom:18px">' . ui_tabs($tabs, 'Section') . '</div>';
}

/** Header + tabs of a Daily page: the sidebar group, a plain title, one line about the page. */
function daily_head(string $current, string $title, string $sub = '', string $actions = ''): void
{
    $group = match (true) {
        str_starts_with($current, '/admin/daily/specials'), str_starts_with($current, '/admin/daily/events') => 'Today › Special days & events',
        str_starts_with($current, '/admin/daily/spots'), str_starts_with($current, '/admin/daily/picks') => 'Community › Places',
        str_starts_with($current, '/admin/daily/promo') => 'Growth',
        default => 'Today › Daily challenges',
    };
    echo ui_page_head($group, $title, $sub, $actions);
    echo daily_tabs($current);
}

/** Page-local styles: layout of the Daily pages and the phone rules. */
function daily_styles(): void
{
    echo '<style>
.daily-subnav { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:18px; }
.daily-subnav a { padding:6px 12px; border:1px solid var(--line); border-radius:6px; color:var(--muted); font-size:13px; }
.daily-subnav a.active, .daily-subnav a:hover { color:var(--text); background:var(--surface-2); text-decoration:none; }
.daily-cols { display:grid; grid-template-columns: minmax(0,1fr) 360px; gap:20px; align-items:start; }
.daily-cols > div:last-child { position: sticky; top: 72px; }
.daily-cols .form-card { max-width: none; }
.daily-cols .form-card > h3:first-of-type, .daily-cols .form-card > h3 { font-size: var(--fs-md); font-weight: 700; }
.daily-cols .form-card + .form-card, .daily-cols form + .form-card, .daily-cols .form-card + form { margin-top: 16px; }
.daily-jump { display:flex; gap:6px; flex-wrap:wrap; margin: 0 0 16px; position: sticky; top: 56px; z-index: 20; padding: 8px 0; background: var(--bg); }
.daily-jump a { display:inline-flex; gap:6px; align-items:center; font-size: var(--fs-sm); font-weight: 600; padding: 5px 10px; border-radius: 999px;
  border: 1px solid var(--line); background: var(--surface); color: var(--text); text-decoration: none; }
.daily-jump a:hover { border-color: var(--line-strong); }
.daily-jump .ok { color: var(--ok); } .daily-jump .warn { color: var(--warn); } .daily-jump .bad { color: var(--bad); }
[id] { scroll-margin-top: 120px; }
.daily-row-empty-soon td { background:var(--bad-soft); }
.daily-row-today td { box-shadow: inset 0 1px 0 var(--brand), inset 0 -1px 0 var(--brand); }
.daily-muted { color:var(--faint); font-size:12px; }
.daily-counter { font-size:12px; color:var(--faint); text-align:right; margin-top:4px; }
.daily-counter.near { color:var(--brand-text); } .daily-counter.over { color:var(--bad); font-weight:600; }
.daily-checklist label { display:flex; gap:8px; align-items:flex-start; padding:4px 0; color:var(--muted); font-size:13px; }
.daily-preview-card { background:#1f1410; border:1px solid #FF7A3C55; border-radius:14px; padding:14px; margin-bottom:14px; }
.daily-preview-card .kicker { color:#FF7A3C; font-size:11px; font-weight:700; letter-spacing:.5px; text-transform:uppercase; }
.daily-preview-card .text { color:#fff; font-size:16px; font-weight:600; margin:6px 0; }
.daily-preview-card .context { color:#bbb; font-size:13px; }
.daily-preview-card .twist { margin-top:10px; padding:8px 10px; background:#2a1a12; border-radius:8px; color:#ffd2bd; font-size:13px; }
.daily-preview-card .cta { margin-top:12px; background:#FF7A3C; color:#111; text-align:center; font-weight:700; border-radius:10px; padding:9px; }
.daily-preview-push { background:#2c2c2e; border-radius:16px; padding:10px 12px; display:flex; gap:10px; }
.daily-preview-push .icon { width:34px; height:34px; border-radius:8px; background:#FF7A3C; color:#111; font-weight:800; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
.daily-preview-push .title { color:#fff; font-weight:600; font-size:13px; }
.daily-preview-push .body { color:#ddd; font-size:13px; display:-webkit-box; -webkit-line-clamp:4; -webkit-box-orient:vertical; overflow:hidden; }
.daily-thumb { width:72px; height:72px; object-fit:cover; border-radius:6px; background:var(--surface-2); }
.daily-inline { display:inline-flex; gap:6px; align-items:center; flex-wrap:wrap; }
.daily-inline input[type=text], .daily-inline input[type=date] { background:var(--surface-2); border:1px solid var(--line); color:var(--text); padding:6px 8px; border-radius:5px; font-size:13px; }
.daily-twist { border-top:1px solid var(--line); padding:12px 0; }
.daily-tr { width:100%; border-collapse:collapse; }
.daily-tr td { padding:4px 4px; vertical-align:top; border-top:1px solid var(--line); }
.daily-tr td.lang { width:130px; color:var(--muted); font-size:12px; padding-top:10px; }
.daily-tr textarea, .daily-tr input[type=text] { width:100%; background:var(--surface-2); border:1px solid var(--line); color:var(--text); padding:6px 8px; border-radius:5px; font-size:13px; font-family:inherit; }
.daily-tr .missing { color:var(--bad); font-size:11px; }
@media (max-width: 1100px) { .daily-cols { grid-template-columns: 1fr; } .daily-cols > div:last-child { position: static; } }
@media (max-width: 720px) {
  .daily-cols { grid-template-columns: 1fr; }
  .daily-stack tr { display: block; border-bottom: 1px solid var(--line); padding: 6px 0; }
  .daily-stack td { display: block; width: 100%; min-width: 0 !important; }
  .daily-stack .daily-inline input[type=text] { flex: 1 1 100%; }
  .form-card { max-width: 100%; }
  .admin-main { padding: 16px 12px; }
  .btn, .btn-sm, button { min-height: 40px; }
  .daily-inline input[type=text] { width: 100%; }
}
</style>';
}

/**
 * Upload a challenge's cover image (the Daily Challenge card's image band):
 * JPEG, PNG or WebP under 10 MB, metadata stripped. Returns its URL.
 */
function daily_cover_upload(?array $file): string
{
    if ($file === null || ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK || !is_uploaded_file($file['tmp_name'])) {
        throw new InvalidArgumentException('Choose an image to upload.');
    }
    $allowed = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'];
    $mime    = (new finfo(FILEINFO_MIME_TYPE))->file($file['tmp_name']);
    $info    = @getimagesize($file['tmp_name']);
    if (!isset($allowed[$mime]) || $info === false || $info[0] > 6000 || $info[1] > 6000 || $file['size'] > 10 * 1024 * 1024) {
        throw new InvalidArgumentException('The cover must be a JPEG, PNG or WebP under 10 MB and 6000 px.');
    }
    $clean = ImageProcessor::stripMetadata($file['tmp_name'], $mime);
    if ($clean === null) {
        throw new InvalidArgumentException('Could not read the image (' . ImageProcessor::$lastError . ').');
    }
    try {
        $filename = bin2hex(random_bytes(16)) . '.' . $allowed[$mime];
        $url      = R2Uploader::put($clean, $filename, $mime);
        // The hero sizes (1x, 2x) and the thumbnail, ready before the first view.
        R2Uploader::putVariants($clean, $mime, $filename, ['thumb', 'c600', 'c800']);
        return $url;
    } finally {
        @unlink($clean);
    }
}

/** A new place's address search, position field and draggable pin (seed and pick forms). */
function daily_place_picker(): void
{
?>
            <div class="form-group"><label>Find the address</label>
                <div class="daily-inline">
                    <input type="text" id="geo-q" placeholder="27 Ngô Đức Kế, Quận 1, Hồ Chí Minh - or a place name" style="flex:1;min-width:240px">
                    <button type="button" class="btn btn-secondary" id="geo-find">Find</button>
                </div>
                <div id="geo-results" class="hint"></div>
                <div class="hint">OpenStreetMap search. House numbers are not always known in Vietnam: pick the closest match, then drag the pin onto the entrance.</div></div>
            <div class="form-group"><label>Position</label>
                <input type="text" name="position" id="geo-pos" placeholder="10.7769, 106.7009 - or a map link with the coordinates" required>
                <div id="geo-map" style="height:280px;border-radius:8px;margin-top:8px;display:none"></div>
                <div class="hint">The city is the nearest Hilads city. A place with the same name within <?= Places::DEDUP_RADIUS_M ?> m is reused. Proofs must be posted within about 150 m of this point.</div></div>
            <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
            <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
            <script>
            // Address search → Position, with a draggable pin to fix the exact entrance.
            (function () {
                const q = document.getElementById('geo-q'), find = document.getElementById('geo-find');
                const out = document.getElementById('geo-results'), pos = document.getElementById('geo-pos');
                const box = document.getElementById('geo-map');
                let map = null, pin = null;
                const fmt = (n) => Number(n).toFixed(6);
                function place(lat, lng) {
                    pos.value = fmt(lat) + ', ' + fmt(lng);
                    box.style.display = 'block';
                    if (!map) {
                        map = L.map(box).setView([lat, lng], 18);
                        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                            maxZoom: 19, attribution: '&copy; OpenStreetMap contributors',
                        }).addTo(map);
                        pin = L.marker([lat, lng], { draggable: true }).addTo(map);
                        pin.on('dragend', () => { const p = pin.getLatLng(); pos.value = fmt(p.lat) + ', ' + fmt(p.lng); });
                        map.on('click', (e) => { pin.setLatLng(e.latlng); pos.value = fmt(e.latlng.lat) + ', ' + fmt(e.latlng.lng); });
                    } else {
                        map.setView([lat, lng], 18);
                        pin.setLatLng([lat, lng]);
                    }
                }
                async function search() {
                    const text = q.value.trim();
                    if (text.length < 3) return;
                    out.textContent = 'Searching…';
                    try {
                        const res = await fetch('/admin/daily/spots/geocode?q=' + encodeURIComponent(text), { credentials: 'same-origin' });
                        const items = (await res.json()).items || [];
                        out.textContent = '';
                        if (items.length === 0) { out.textContent = 'No match. Try the street and district only, or a nearby landmark.'; return; }
                        items.forEach((it, i) => {
                            const b = document.createElement('button');
                            b.type = 'button'; b.className = 'btn btn-secondary btn-sm';
                            b.style.cssText = 'display:block;margin:4px 0;text-align:left;white-space:normal';
                            b.textContent = it.label;
                            b.onclick = () => place(it.lat, it.lng);
                            out.appendChild(b);
                            if (i === 0) place(it.lat, it.lng);
                        });
                    } catch (e) { out.textContent = 'Search failed. Paste the coordinates instead.'; }
                }
                find.addEventListener('click', search);
                q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); search(); } });
                // Coordinates typed or pasted by hand move the pin too.
                pos.addEventListener('change', () => {
                    const m = pos.value.match(/(-?\d{1,3}\.\d+)\s*[,; ]\s*(-?\d{1,3}\.\d+)/);
                    if (m) place(parseFloat(m[1]), parseFloat(m[2]));
                });
            })();
            </script>
<?php
}
