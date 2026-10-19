<?php

declare(strict_types=1);

// Hilads picks: editorial spots. A pick is a place with the official account's
// photo (and its credit) and a "Good to know" text; published, it shows on the
// map with the "Hilads pick" badge. Picks never count as answers (no votes,
// ranks, tour, Index, presence, streak or pioneer); a player's photo at the
// place becomes the spot's cover and the pick text stays as context.
// /admin/daily/picks: list + new · /admin/daily/picks?id=<place>: edit.

admin_require_login();
require_once __DIR__ . '/daily_common.php';

$editId = preg_match('/^[a-f0-9]{16}$/', (string) ($_GET['id'] ?? $_POST['id'] ?? '')) ? (string) ($_GET['id'] ?? $_POST['id']) : null;
$ready  = Spots::picksReady();

if ($_SERVER['REQUEST_METHOD'] === 'POST' && $ready) {
    csrf_verify();
    try {
        if ($editId !== null) {
            SpotsAdmin::pickUpdate($editId, $_POST, $_FILES['photo'] ?? null);
            flash_set('success', 'Pick saved.');
            admin_redirect('/admin/daily/picks?id=' . $editId);
        }
        $placeId = SpotsAdmin::pickCreate($_POST, $_FILES['photo'] ?? null);
        flash_set('success', 'Pick created.');
        admin_redirect('/admin/daily/picks?id=' . $placeId);
    } catch (InvalidArgumentException $e) {
        flash_set('error', $e->getMessage());
        admin_redirect('/admin/daily/picks' . ($editId !== null ? '?id=' . $editId : ''));
    }
}

$picks = $ready ? SpotsAdmin::picks() : [];
$edit  = $editId !== null && $ready ? SpotsAdmin::pick($editId) : null;
$note  = $edit && $edit['pick_note_i18n'] ? (json_decode((string) $edit['pick_note_i18n'], true) ?: []) : [];
$tr    = array_diff_key($note, ['en' => true]);
$statusLabel = ['draft' => 'Draft', 'published' => 'Published', 'hidden' => 'Hidden'];

admin_head('Hilads picks');
admin_nav('/admin/daily');
daily_styles();
?>
<div class="admin-main">
    <h1 class="page-title">⭐ Hilads picks</h1>
    <?php daily_subnav('/admin/daily/picks'); ?>
    <?= flash_html() ?>

    <?php if (!$ready): ?>
        <div class="form-card"><p>Run <code>php migrate.php</code> first: the picks columns are missing.</p></div>
    <?php else: ?>

    <form method="POST" action="/admin/daily/picks" enctype="multipart/form-data" class="form-card">
        <?= csrf_input() ?>
        <?php if ($edit): ?>
            <input type="hidden" name="id" value="<?= dh($edit['id']) ?>">
            <h2 style="margin-top:0">Edit: <a href="/admin/daily/spots/<?= dh($edit['id']) ?>"><?= dh($edit['name']) ?></a> · <?= dh($edit['city_name'] ?? '') ?></h2>
            <p class="daily-muted"><?= (int) $edit['answers'] ?> player answer(s) here<?= (int) $edit['answers'] ? ': the most voted one is the cover, this pick stays as context' : '' ?>. <a href="/admin/daily/picks">New pick</a></p>
            <?php if ($edit['photo_url']): ?><img src="<?= dh($edit['photo_url']) ?>" alt="" style="max-width:240px;border-radius:8px"><?php endif; ?>
            <div class="form-group"><label>Replace the photo (optional)</label><input type="file" name="photo" accept="image/jpeg,image/png,image/webp"></div>
        <?php else: ?>
            <h2 style="margin-top:0">New pick</h2>
            <div class="form-group"><label>Existing spot id (optional)</label>
                <input type="text" name="spot_id" pattern="[a-f0-9]{16}" placeholder="from a spot's page; leave empty for a new place">
                <div class="hint">Or create the place below.</div></div>
            <div class="form-group"><label>New place name</label>
                <input type="text" name="name" maxlength="<?= Places::NAME_MAX ?>" placeholder="Thien Hau Temple"></div>
            <?php daily_place_picker(); ?>
            <div class="form-group"><label>Photo</label><input type="file" name="photo" accept="image/jpeg,image/png,image/webp" required>
                <div class="hint">Metadata (EXIF, GPS) is stripped, like every upload.</div></div>
            <div class="form-group"><label>Theme</label>
                <select name="theme" required>
                    <?php foreach (DailyThemes::all() as $t): if (!Places::isPlaceTheme($t['key'])) continue; ?>
                        <option value="<?= dh($t['key']) ?>"><?= dh($t['name']) ?></option>
                    <?php endforeach; ?>
                </select></div>
            <div class="form-group"><label>Posted as</label>
                <input type="text" name="username" value="@<?= SpotsAdmin::SEED_USERNAME ?>">
                <div class="hint">The official account. Picks earn nothing and never count as answers.</div></div>
        <?php endif; ?>
        <div class="form-group"><label>Photo credit</label>
            <input type="text" name="credit" maxlength="<?= SpotsAdmin::PICK_CREDIT_MAX ?>" required value="<?= dh($edit['photo_credit'] ?? '') ?>" placeholder="Chinh Le Duc / Unsplash · or Hilads">
            <div class="hint">Shown under the photo instead of "Photo by @username". For CC BY / BY-SA photos, include the license: "P. Hughes, CC BY 4.0, Wikimedia Commons".</div></div>
        <div class="form-group"><label>Caption (optional, one sentence)</label>
            <input type="text" name="caption" maxlength="<?= DailyProofRepository::CAPTION_MAX ?>" value="<?= dh($edit['caption'] ?? '') ?>"></div>
        <div class="form-group"><label>Good to know (English)</label>
            <textarea name="note_en" rows="3" maxlength="<?= SpotsAdmin::PICK_NOTE_MAX ?>" required><?= dh($note['en'] ?? '') ?></textarea>
            <div class="hint">Only facts you checked. Up to <?= SpotsAdmin::PICK_NOTE_MAX ?> characters.</div></div>
        <div class="form-group"><label>Translations (optional JSON)</label>
            <textarea name="note_translations" rows="3" style="font-family:monospace" placeholder='{"fr": "Bon à savoir…", "vi": "…"}'><?= dh($tr ? json_encode($tr, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) : '') ?></textarea>
            <div class="hint">Missing languages show the English text.</div></div>
        <div class="form-group"><label>Status</label>
            <select name="pick_status">
                <?php foreach ($statusLabel as $k => $label): ?>
                    <option value="<?= $k ?>" <?= ($edit['pick_status'] ?? 'draft') === $k ? 'selected' : '' ?>><?= $label ?></option>
                <?php endforeach; ?>
            </select>
            <div class="hint">Only published picks show on the map. Hiding a pick never hides the players' answers at the place.</div></div>
        <div class="form-actions"><button class="btn btn-primary" type="submit"><?= $edit ? 'Save' : 'Create' ?></button></div>
    </form>

    <div class="form-card">
        <h2 style="margin-top:0">All picks (<?= count($picks) ?>)</h2>
        <?php if ($picks === []): ?><p class="daily-muted">No pick yet.</p><?php endif; ?>
        <table class="table">
            <?php foreach ($picks as $p): $n = json_decode((string) $p['pick_note_i18n'], true) ?: []; ?>
                <tr>
                    <td><?php if ($p['photo_url']): ?><img src="<?= dh(R2Uploader::thumbProxy($p['photo_url']) ?? $p['photo_url']) ?>" alt="" style="width:64px;height:64px;object-fit:cover;border-radius:6px"><?php endif; ?></td>
                    <td><a href="/admin/daily/picks?id=<?= dh($p['id']) ?>"><strong><?= dh($p['name']) ?></strong></a><br>
                        <span class="daily-muted"><?= dh($p['city_name'] ?? '') ?> · <?= dh($p['theme'] ?? '') ?> · <?= dh($p['photo_credit'] ?? 'no credit') ?></span><br>
                        <span><?= dh(mb_strimwidth((string) ($n['en'] ?? ''), 0, 120, '…')) ?></span></td>
                    <td><?= dh($statusLabel[$p['pick_status']] ?? $p['pick_status']) ?><br><span class="daily-muted"><?= (int) $p['answers'] ?> answer(s)</span></td>
                </tr>
            <?php endforeach; ?>
        </table>
    </div>
    <?php endif; ?>
</div>
<?php admin_foot();
