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
            <div class="form-group"><label>Position</label>
                <input type="text" name="position" placeholder="10.7769, 106.7009 - or a map link with the coordinates" required>
                <div class="hint">The city is the nearest Hilads city. A place with the same name within <?= Places::DEDUP_RADIUS_M ?> m is reused.</div></div>
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
