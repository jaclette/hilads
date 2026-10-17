<?php

declare(strict_types=1);

// Seed a spot (V3-05): an approved seed proof (photo, price, theme, caption)
// posted from an account (default @hilads), on an existing spot or a new
// place. Seeds back the spot but stay out of the game (no points, cards,
// stamps or challenge gallery).

admin_require_login();
require_once __DIR__ . '/daily_common.php';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    csrf_verify();
    try {
        $placeId = SpotsAdmin::seed($_POST, $_FILES['photo'] ?? null);
        flash_set('success', 'Seeded.');
        admin_redirect('/admin/daily/spots/' . $placeId);
    } catch (InvalidArgumentException $e) {
        flash_set('error', $e->getMessage());
        admin_redirect('/admin/daily/spots/new' . (!empty($_POST['spot_id']) ? '?spot=' . urlencode((string) $_POST['spot_id']) : ''));
    }
}

$spot = preg_match('/^[a-f0-9]{16}$/', (string) ($_GET['spot'] ?? '')) ? SpotsAdmin::find((string) $_GET['spot']) : null;

admin_head('Seed a spot');
admin_nav('/admin/daily');
daily_styles();
?>
<div class="admin-main">
    <h1 class="page-title">＋ Seed a spot</h1>
    <?php daily_subnav('/admin/daily/spots'); ?>
    <?= flash_html() ?>

    <form method="POST" action="/admin/daily/spots/new" enctype="multipart/form-data" class="form-card">
        <?= csrf_input() ?>
        <?php if ($spot): ?>
            <input type="hidden" name="spot_id" value="<?= dh($spot['id']) ?>">
            <p>Spot: <a href="/admin/daily/spots/<?= dh($spot['id']) ?>"><strong><?= dh($spot['name']) ?></strong></a> · <?= dh($spot['city_name'] ?? '') ?>
                · <a href="/admin/daily/spots/new">a new place instead</a></p>
        <?php else: ?>
            <div class="form-group"><label>New place name</label>
                <input type="text" name="name" maxlength="<?= Places::NAME_MAX ?>" placeholder="Cơm tấm Ba Ghiền" required>
                <div class="hint">To add a photo to an existing spot, use "Seed a photo here" on its page.</div></div>
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
        <?php endif; ?>
        <div class="form-group"><label>Photo (your own)</label><input type="file" name="photo" accept="image/jpeg,image/png,image/webp" required>
            <div class="hint">Metadata (EXIF, GPS) is stripped, like every upload.</div></div>
        <div class="form-group"><label>Theme</label>
            <select name="theme" required>
                <?php foreach (DailyThemes::all() as $t): if (!Places::isPlaceTheme($t['key'])) continue; ?>
                    <option value="<?= dh($t['key']) ?>"><?= dh($t['name']) ?></option>
                <?php endforeach; ?>
            </select></div>
        <div class="form-group"><label>Caption (optional, one sentence)</label>
            <input type="text" name="caption" maxlength="<?= DailyProofRepository::CAPTION_MAX ?>"></div>
        <div class="form-group"><label>Price paid (optional)</label>
            <div class="daily-inline"><input type="text" name="price_amount" placeholder="45000" inputmode="decimal">
                <input type="text" name="price_currency" value="VND" maxlength="3" style="width:70px"></div></div>
        <div class="form-group"><label>Posted as</label>
            <input type="text" name="username" value="@<?= SpotsAdmin::SEED_USERNAME ?>">
            <div class="hint">Seeds earn nothing, whatever the account.</div></div>
        <div class="form-actions"><button class="btn btn-primary" type="submit">Seed</button></div>
    </form>
</div>
<?php admin_foot();
