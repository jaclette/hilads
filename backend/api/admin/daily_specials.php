<?php

declare(strict_types=1);

// Special days and theme covers (SPEC 9.15).
// - Special days: date, id, localized name, emoji (pushes, stamp), icon (app,
//   an Ionicons name), cover, scope. A world special replaces the weekday
//   theme (pick it as the challenge's theme, or import "theme": "Special");
//   a country or city special comes through the Local Twist.
// - Theme covers: each theme's default cover, used when a challenge has none
//   (no upload = the image bundled in the apps).

admin_require_login();
require_once __DIR__ . '/daily_common.php';

$self   = '/admin/daily/specials';
$editId = isset($_GET['id']) ? (string) $_GET['id'] : null;

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    csrf_verify();
    $p  = $_POST;
    $id = (string) ($p['id'] ?? '');
    match ($p['action'] ?? '') {
        'save' => daily_action(function () use ($p) {
            $names = ['en' => (string) ($p['name_en'] ?? '')];
            foreach (array_keys(daily_locale_names()) as $l) {
                $names[$l] = (string) ($p['name'][$l] ?? '');
            }
            $s = DailySpecials::clean([
                'id' => $p['id'] ?? '', 'date' => $p['date'] ?? '', 'names' => $names, 'emoji' => $p['emoji'] ?? '',
                'icon' => $p['icon'] ?? '', 'scope' => $p['scope'] ?? 'world', 'country' => $p['country'] ?? '',
                'cityId' => $p['city_id'] ?? '',
            ], fn(string $c): bool => CityRepository::findById((int) substr($c, 5)) !== null);
            DailySpecials::save($s);
            DailyAdminService::audit('daily_special.save', 'daily_special', $s['id'], null, $s);
            return "Saved {$s['id']}.";
        }, 'Saved.', $self),

        'cover_upload' => daily_action(function () use ($id) {
            DailySpecials::setCover($id, daily_cover_upload($_FILES['cover'] ?? null));
            DailyAdminService::audit('daily_special.cover', 'daily_special', $id, null, null);
        }, 'Cover saved.', $self . '?id=' . rawurlencode($id)),

        'cover_remove' => daily_action(fn() => DailySpecials::setCover($id, null), 'Cover removed.', $self . '?id=' . rawurlencode($id)),

        'delete' => daily_action(function () use ($id) {
            DailySpecials::delete($id);
            DailyAdminService::audit('daily_special.delete', 'daily_special', $id, null, null);
        }, 'Deleted: its challenges went back to their weekday theme.', $self),

        'theme_cover_upload' => daily_action(function () use ($p) {
            $key = (string) ($p['theme'] ?? '');
            if (!isset(DailyThemes::THEMES[$key]) && $key !== DailyThemes::SPECIAL) {
                throw new InvalidArgumentException('Unknown theme.');
            }
            DailyThemes::setCover($key, daily_cover_upload($_FILES['cover'] ?? null));
            DailyAdminService::audit('daily_theme.cover', 'daily_theme', $key, null, null);
        }, 'Theme cover saved.', $self . '#themes'),

        'theme_cover_remove' => daily_action(fn() => DailyThemes::setCover((string) ($p['theme'] ?? ''), null),
            'Theme cover removed: the image bundled in the apps shows.', $self . '#themes'),

        default => admin_redirect($self),
    };
}

$specials = DailySpecials::listFrom(null);
$editing  = $editId !== null ? DailySpecials::find($editId) : null;
$names    = $editing !== null ? (json_decode((string) $editing['name_i18n'], true) ?: []) : [];
$covers   = DailyThemes::covers();
$cities   = Database::pdo()->query("SELECT id, name FROM channels WHERE type = 'city' ORDER BY name")->fetchAll(PDO::FETCH_KEY_PAIR);

admin_head('Special days');
admin_nav('/admin/daily');
daily_styles();
?>
<div class="admin-main">
    <h1 class="page-title">✨ Special days</h1>
    <?php daily_subnav($self); ?>
    <?= flash_html() ?>

    <div class="table-wrapper">
        <table>
            <thead><tr><th>Date</th><th>Id</th><th>Name</th><th>Scope</th><th>Icon</th><th>Cover</th><th></th></tr></thead>
            <tbody>
            <?php if ($specials === []): ?>
                <tr><td colspan="7" class="daily-muted">No special day yet.</td></tr>
            <?php endif; ?>
            <?php foreach ($specials as $s): ?>
                <tr>
                    <td class="td-mono"><?= dh((string) $s['date']) ?></td>
                    <td class="td-mono"><?= dh($s['id']) ?></td>
                    <td><?= dh(($s['emoji'] ?: '✨') . ' ' . DailySpecials::nameOf($s, 'en')) ?></td>
                    <td class="daily-muted"><?= dh($s['scope'] === 'country' ? 'country ' . $s['country'] : ($s['scope'] === 'city' ? 'city ' . ($s['city_name'] ?? '') : 'world: replaces the theme')) ?></td>
                    <td class="daily-muted"><?= dh((string) $s['icon']) ?></td>
                    <td><?= $s['cover_url'] ? '<img src="' . dh($s['cover_url']) . '" alt="" style="width:80px;aspect-ratio:5/2;object-fit:cover;border-radius:6px">' : '<span class="daily-muted">-</span>' ?></td>
                    <td class="td-actions"><a class="btn btn-secondary btn-sm" href="<?= dh($self . '?id=' . rawurlencode($s['id'])) ?>">Edit</a></td>
                </tr>
            <?php endforeach; ?>
            </tbody>
        </table>
    </div>

    <form method="POST" action="<?= dh($self) ?>" class="form-card" style="margin-top:16px">
        <?= csrf_input() ?>
        <input type="hidden" name="action" value="save">
        <h3 style="margin-bottom:8px"><?= $editing ? 'Edit ' . dh($editing['id']) : 'New special day' ?></h3>
        <div class="form-group"><label>Id</label>
            <input type="text" name="id" value="<?= dh($editing['id'] ?? '') ?>" placeholder="halloween" <?= $editing ? 'readonly' : '' ?> required>
            <div class="hint">Lowercase, digits and dashes. One id per occurrence (halloween-2027 next year) so each stamp stays limited.</div></div>
        <div class="form-group"><label>Date</label><input type="date" name="date" value="<?= dh((string) ($editing['date'] ?? '')) ?>" required></div>
        <div class="form-group"><label>Scope</label>
            <select name="scope">
                <?php foreach (['world' => 'World: the challenge gets theme Special and a limited stamp', 'country' => 'Country: through the Local Twist', 'city' => 'City: through the Local Twist'] as $v => $l): ?>
                    <option value="<?= $v ?>"<?= ($editing['scope'] ?? 'world') === $v ? ' selected' : '' ?>><?= dh($l) ?></option>
                <?php endforeach; ?>
            </select></div>
        <div class="form-group"><label>Country (country scope)</label><input type="text" name="country" maxlength="2" value="<?= dh((string) ($editing['country'] ?? '')) ?>" placeholder="VN"></div>
        <div class="form-group"><label>City (city scope)</label>
            <select name="city_id"><option value="">-</option>
                <?php foreach ($cities as $cid => $cname): ?>
                    <option value="<?= dh($cid) ?>"<?= ($editing['city_id'] ?? '') === $cid ? ' selected' : '' ?>><?= dh($cname) ?></option>
                <?php endforeach; ?>
            </select></div>
        <div class="form-group"><label>Emoji (pushes, stamp)</label><input type="text" name="emoji" value="<?= dh((string) ($editing['emoji'] ?? '')) ?>" placeholder="🎃"></div>
        <div class="form-group"><label>Icon (app, an Ionicons name)</label><input type="text" name="icon" value="<?= dh((string) ($editing['icon'] ?? '')) ?>" placeholder="skull-outline">
            <div class="hint">See ionic.io/ionicons; default sparkles-outline.</div></div>
        <div class="form-group"><label>Name (English)</label><input type="text" name="name_en" maxlength="40" value="<?= dh((string) ($names['en'] ?? '')) ?>" required></div>
        <details><summary class="daily-muted" style="cursor:pointer;margin-bottom:8px">Names in the 18 other languages</summary>
            <?php foreach (daily_locale_names() as $l => $label): ?>
                <div class="form-group"><label><?= dh($label) ?></label><input type="text" name="name[<?= dh($l) ?>]" maxlength="40" value="<?= dh((string) ($names[$l] ?? '')) ?>"></div>
            <?php endforeach; ?>
        </details>
        <div class="form-actions" style="gap:8px">
            <button class="btn btn-primary" type="submit">Save</button>
            <?php if ($editing): ?><a class="btn btn-secondary" href="<?= dh($self) ?>">New</a><?php endif; ?>
        </div>
    </form>

    <?php if ($editing): ?>
        <form method="POST" action="<?= dh($self) ?>" enctype="multipart/form-data" class="form-card" style="margin-top:16px">
            <?= csrf_input() ?>
            <input type="hidden" name="id" value="<?= dh($editing['id']) ?>">
            <h3 style="margin-bottom:4px">Cover of <?= dh($editing['id']) ?></h3>
            <p class="daily-muted">Used by its challenge when it has no cover of its own (at least 1200×480).</p>
            <?php if ($editing['cover_url']): ?><img src="<?= dh($editing['cover_url']) ?>" alt="" style="width:100%;max-width:480px;aspect-ratio:5/2;object-fit:cover;border-radius:10px;display:block;margin:10px 0"><?php endif; ?>
            <input type="file" name="cover" accept="image/jpeg,image/png,image/webp">
            <div class="form-actions" style="gap:8px">
                <button class="btn btn-primary btn-sm" type="submit" name="action" value="cover_upload">Upload cover</button>
                <?php if ($editing['cover_url']): ?><button class="btn btn-secondary btn-sm" type="submit" name="action" value="cover_remove">Remove cover</button><?php endif; ?>
                <button class="btn btn-secondary btn-sm" type="submit" name="action" value="delete" onclick="return confirm('Delete this special day? Its challenges go back to their weekday theme.')">Delete</button>
            </div>
        </form>
    <?php endif; ?>

    <h2 id="themes" style="margin:28px 0 8px">Theme covers</h2>
    <p class="daily-muted" style="margin-bottom:12px">Each theme's default cover, used when a challenge has none of its own. Without an upload, the image bundled in the apps shows.</p>
    <div class="daily-cover-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px">
        <?php foreach (array_merge(DailyThemes::keys(), [DailyThemes::SPECIAL]) as $key):
            $url = $covers[$key] ?? null; ?>
            <form method="POST" action="<?= dh($self) ?>" enctype="multipart/form-data" class="form-card" style="margin:0">
                <?= csrf_input() ?>
                <input type="hidden" name="theme" value="<?= dh($key) ?>">
                <h3 style="margin-bottom:6px"><?= dh(DailyThemes::name($key)) ?><?= $key === DailyThemes::SPECIAL ? ' <span class="daily-muted" style="font-size:12px">(a special without its own cover)</span>' : '' ?></h3>
                <img src="<?= dh($url ?? ('https://hilads.live/covers/' . ($key === DailyThemes::SPECIAL ? 'only_here' : $key) . '.jpg')) ?>" alt=""
                     style="width:100%;aspect-ratio:5/2;object-fit:cover;border-radius:8px;display:block;margin-bottom:6px">
                <div class="hint" style="margin-bottom:6px"><?= $url ? 'Uploaded.' : 'Bundled default.' ?></div>
                <input type="file" name="cover" accept="image/jpeg,image/png,image/webp">
                <div class="form-actions" style="gap:6px">
                    <button class="btn btn-primary btn-sm" type="submit" name="action" value="theme_cover_upload">Upload</button>
                    <?php if ($url): ?><button class="btn btn-secondary btn-sm" type="submit" name="action" value="theme_cover_remove">Remove</button><?php endif; ?>
                </div>
            </form>
        <?php endforeach; ?>
    </div>
</div>
<?php admin_foot();
