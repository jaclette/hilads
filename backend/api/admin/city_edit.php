<?php

declare(strict_types=1);

admin_require_login();

/**
 * One city ($cityId): its names (the name changes its /city/<slug> URL),
 * short name (Saigon) and its forms per language, aliases the app's search
 * finds, the live switch and the proof location tolerance; its first members
 * and photos; and "Merge into…" (dry run first, city_merge.php).
 */

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    csrf_verify();
    try {
        CityAdmin::update($cityId, $_POST);
        flash_set('success', 'Saved. Apps see it within the hour (city list cache).');
    } catch (\Throwable $e) {
        flash_set('error', $e->getMessage());
    }
    header('Location: /admin/cities/' . $cityId);
    exit;
}

$city = null;
$err  = null;
try {
    $city = CityAdmin::get($cityId);
} catch (\Throwable $e) {
    $err = 'Run php migrate.php first (' . $e->getMessage() . ').';
}
if ($city === null && $err === null) {
    flash_set('error', "Unknown city {$cityId}.");
    header('Location: /admin/cities');
    exit;
}
$h      = fn($v) => htmlspecialchars((string) $v, ENT_QUOTES);
$i18n   = $city ? implode("\n", array_map(fn($l, $n) => "{$l} = {$n}", array_keys($city['short_name_i18n']), $city['short_name_i18n'])) : '';
$slug   = $city ? trim(preg_replace('/[^a-z0-9]+/', '-', strtolower($city['name'])), '-') : '';

admin_head($city['name'] ?? 'City');
admin_nav('/admin/cities');
?>
<div class="admin-main">
    <?php if ($err): ?><?= ui_page_head('Community › Cities', 'City') ?><div class="flash flash-error"><?= $h($err) ?></div><?php else: ?>
    <?= ui_page_head('Community › Cities', (string) $city['name'], '<span class="mono">' . $h($city['id']) . '</span>', '<a class="btn" href="/admin/cities">Back to cities</a>') ?>
    <?= flash_html() ?>
    <p class="muted" style="margin:-8px 0 16px;font-size:13px">
        <?= $h($city['country']) ?> · <?= $h($city['timezone']) ?> · <?= round((float) $city['lat'], 4) ?>, <?= round((float) $city['lng'], 4) ?>
        · <?= $city['members'] ?> members · <?= $city['photos'] ?> photos
        <?php if ($city['geoname_id'] !== null): ?>
            · GeoNames <a href="https://www.geonames.org/<?= $city['geoname_id'] ?>" target="_blank" rel="noopener"><?= $city['geoname_id'] ?></a>
            <?= isset($city['geo']['population']) ? '(' . $h($city['geo']['name']) . ', ' . number_format((int) $city['geo']['population']) . ' people)' : '' ?>
        <?php else: ?>
            · <span class="badge b-warn">not matched to the world city base</span>
        <?php endif; ?>
        <?= $city['auto_created'] ? ' · <span class="badge b-violet">created automatically</span>' : '' ?>
        · <a href="https://hilads.live/city/<?= $h($slug) ?>" target="_blank" rel="noopener">/city/<?= $h($slug) ?></a>
    </p>

    <?php if ($city['status'] !== 'active'): ?>
        <p class="callout warn" style="margin-bottom:16px">Merged into <a href="/admin/cities/<?= $h($city['merged_into']) ?>"><?= $h($city['merged_into']) ?></a>: read only.</p>
    <?php else: ?>

    <form method="POST" action="/admin/cities/<?= $h($city['id']) ?>" class="form-card" style="max-width:640px">
        <?= csrf_input() ?>
        <div class="form-group">
            <label>Name (English)</label>
            <input type="text" name="name" value="<?= $h($city['name']) ?>" required maxlength="80">
            <p style="color:var(--faint);font-size:12px;margin-top:4px">Changing it changes the city's /city/&lt;slug&gt; page address. Apps show the name in each language from GeoNames.</p>
        </div>
        <div class="form-group">
            <label>Short name</label>
            <input type="text" name="short_name" value="<?= $h($city['short_name']) ?>" placeholder="Saigon">
            <p style="color:var(--faint);font-size:12px;margin-top:4px">Only for a city known worldwide by a shorter name (Saigon, Rio), shown where space is tight. Never a local abbreviation (CDMX, LA).</p>
        </div>
        <div class="form-group">
            <label>Short name per language</label>
            <textarea name="short_name_i18n" rows="2" placeholder="vi = Sài Gòn"><?= $h($i18n) ?></textarea>
            <p style="color:var(--faint);font-size:12px;margin-top:4px">One "locale = name" a line, where the short name differs (non-Latin languages get none otherwise).</p>
        </div>
        <div class="form-group">
            <label>Aliases</label>
            <textarea name="aliases" rows="2" placeholder="Saigon, HCMC"><?= $h(implode(', ', $city['aliases'])) ?></textarea>
            <p style="color:var(--faint);font-size:12px;margin-top:4px">More names the app's city search finds, comma separated.</p>
        </div>
        <div class="form-group">
            <label>How far from the city a photo can be taken (km)</label>
            <input type="text" name="tolerance_km" value="<?= $h($city['proof_geotag_tolerance_km']) ?>" placeholder="default" style="max-width:120px">
            <p class="hint">Empty: the default. Larger for spread-out cities.</p>
        </div>
        <div class="form-group">
            <label style="text-transform:none;letter-spacing:0;font-size:14px;color:var(--text)">
                <input type="checkbox" name="force_live" value="1" style="width:auto;margin-right:6px" <?= $city['force_live'] ? 'checked' : '' ?>> Always live for the Daily challenge, even with few players
            </label>
        </div>
        <button type="submit" class="btn btn-primary">Save</button>
    </form>

    <form method="GET" action="/admin/cities/<?= $h($city['id']) ?>/merge" class="form-card" style="max-width:640px;margin-top:16px">
        <h3 style="margin-bottom:8px">Merge into another city <?= AdminAuth::isSuper() ? '' : '<span class="badge b-mute">super admins</span>' ?></h3>
        <p style="color:var(--muted);font-size:13px;margin-bottom:12px">
            Everything of <?= $h($city['name']) ?> (photos, chat, events, spots, scores, members…) moves to the other city, its name becomes an alias there, and its GeoNames place plays in the other city from then on. You see the counts before anything changes.
        </p>
        <div style="display:flex;gap:8px">
            <input type="text" name="into" placeholder="city_20" required pattern="city_\d+" style="max-width:180px">
            <button type="submit" class="btn">Preview the merge</button>
        </div>
    </form>
    <?php endif; ?>

    <div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:16px">
        <div class="form-card" style="flex:1;min-width:280px">
            <h3 style="margin-bottom:8px">First members</h3>
            <?php foreach ($city['firstUsers'] as $u): ?>
                <p style="font-size:13px;margin:4px 0"><a href="/admin/users/<?= $h($u['id']) ?>/edit"><?= $h($u['display_name']) ?></a> <span class="td-mono">@<?= $h($u['username']) ?></span></p>
            <?php endforeach; ?>
            <?php if (!$city['firstUsers']): ?><p style="color:var(--faint);font-size:13px">Nobody lives here now.</p><?php endif; ?>
        </div>
        <div class="form-card" style="flex:2;min-width:280px">
            <h3 style="margin-bottom:8px">First photos</h3>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
                <?php foreach ($city['firstPhotos'] as $p): ?>
                    <a href="/admin/daily/<?= $h($p['challenge_id']) ?>" title="@<?= $h($p['username']) ?> · <?= $h(substr((string) $p['created_at'], 0, 16)) ?>">
                        <img src="<?= $h($p['photo_url']) ?>" alt="" style="width:72px;height:72px;object-fit:cover;border-radius:6px">
                    </a>
                <?php endforeach; ?>
            </div>
            <?php if (!$city['firstPhotos']): ?><p style="color:var(--faint);font-size:13px">No photo yet.</p><?php endif; ?>
        </div>
    </div>
    <?php endif; ?>
</div>
<?php admin_foot(); ?>
