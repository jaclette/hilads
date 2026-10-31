<?php

declare(strict_types=1);

// "Different Worlds" settings: the prompts packages are prepared with (they go
// into the brief), the visual style, the Hilads phase, the countries always in.

admin_require_login();
require_once __DIR__ . '/worlds_common.php';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    csrf_verify();
    worlds_action(fn() => DwStudio::saveSettings(
        (string) ($_POST['system_prompt'] ?? ''),
        (string) ($_POST['illustration_prompt'] ?? ''),
        (string) ($_POST['visual_style'] ?? ''),
        (int) ($_POST['phase'] ?? 1),
        preg_split('/[,\n]+/', (string) ($_POST['countries'] ?? '')) ?: [],
    ), 'Settings saved.', '/admin/worlds/settings');
}

$s = DwStudio::settings();
admin_head('Worlds settings');
admin_nav('/admin/worlds');
worlds_styles();
?>
<div class="admin-main">
    <h1 class="page-title">🌍 Different Worlds · Settings</h1>
    <?php worlds_subnav('/admin/worlds/settings'); ?>
    <?= flash_html() ?>
    <form method="POST" action="/admin/worlds/settings" class="form-card" style="max-width:900px">
        <?= csrf_input() ?>
        <div class="form-group"><label>Phase (Hilads mention)</label>
            <select name="phase">
                <?php foreach ([1 => '1 · series name + soft caption mention', 2 => '2 · outro invites to share on Hilads', 3 => '3 · caption invites to post on Hilads to be featured'] as $n => $l): ?>
                    <option value="<?= $n ?>"<?= $s['phase'] === $n ? ' selected' : '' ?>><?= wh($l) ?></option>
                <?php endforeach; ?>
            </select></div>
        <div class="form-group"><label>Countries always included (comma separated)</label>
            <input type="text" name="countries" value="<?= wh(implode(', ', $s['countries_always_included'])) ?>"></div>
        <div class="form-group"><label>Visual style</label>
            <input type="text" name="visual_style" value="<?= wh($s['visual_style']) ?>">
            <div class="hint">Replaces {{VISUAL_STYLE}} in the photo prompt.</div></div>
        <div class="form-group"><label>System prompt</label>
            <textarea name="system_prompt" rows="24" style="font-family:monospace;font-size:12px;width:100%"><?= wh($s['system_prompt']) ?></textarea>
            <div class="hint">{{PHASE}} and {{COUNTRIES_ALWAYS}} are filled in from the fields above.</div></div>
        <div class="form-group"><label>Photo prompt</label>
            <textarea name="illustration_prompt" rows="12" style="font-family:monospace;font-size:12px;width:100%"><?= wh($s['illustration_prompt']) ?></textarea>
            <div class="hint">{{VISUAL_STYLE}} and {{BRIEF}} (the slide's photo description) are filled in.</div></div>
        <div class="form-actions"><button class="btn btn-primary" type="submit">Save</button></div>
    </form>
</div>
<?php admin_foot();
