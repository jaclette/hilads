<?php

declare(strict_types=1);

// Seasonal events (SeasonalEvents): a theme the apps put on the Daily screens
// around a date (Halloween first). Dates are challenge dates. Preview: the
// listed usernames see the chosen phase now, on the apps and the web.

admin_require_login();
require_once __DIR__ . '/daily_common.php';

$self   = '/admin/daily/events';
$editId = isset($_GET['id']) ? (string) $_GET['id'] : null;
$by     = (string) (getenv('ADMIN_USERNAME') ?: 'admin');

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    csrf_verify();
    $p = $_POST;
    match ($p['action'] ?? '') {
        'save' => daily_action(function () use ($p, $by) {
            $e = SeasonalEvents::clean($p);
            SeasonalEvents::save($e, $by);
            DailyAdminService::audit('seasonal_event.save', 'seasonal_event', $e['id'], null, $e);
            return "Saved {$e['id']}. The apps pick it up within a minute.";
        }, 'Saved.', $self),

        'delete' => daily_action(function () use ($p, $by) {
            $id = (string) ($p['id'] ?? '');
            SeasonalEvents::delete($id, $by);
            DailyAdminService::audit('seasonal_event.delete', 'seasonal_event', $id, null, null);
        }, 'Deleted.', $self),

        default => admin_redirect($self),
    };
}

$events  = SeasonalEvents::all();
$editing = null;
foreach ($events as $e) {
    if ($e['id'] === $editId) $editing = $e;
}
$today = DailyClock::currentDate();

admin_head('Seasonal events');
admin_nav('/admin/daily');
daily_styles();
?>
<div class="admin-main">
    <h1 class="page-title">🎃 Seasonal events</h1>
    <?php daily_subnav($self); ?>
    <?= flash_html() ?>
    <p class="daily-muted" style="max-width:720px;margin-bottom:12px">
        A look the apps put on Today and the Daily screens. Dates are <strong>challenge dates</strong> (today's challenge: <?= dh($today) ?>):
        <strong>teaser</strong> from the teaser start to the day before the start (a countdown banner),
        <strong>live</strong> from the start to the end, <strong>recap</strong> the day after the end (the Yesterday card).
        The look lives in the apps: a theme key they don't know shows nothing. Known: <?= dh(implode(', ', SeasonalEvents::THEMES)) ?>.
    </p>

    <div class="table-wrapper">
        <table>
            <thead><tr><th>Id</th><th>Name</th><th>Theme</th><th>Teaser</th><th>Live</th><th>Today</th><th>Preview</th><th></th></tr></thead>
            <tbody>
            <?php if ($events === []): ?>
                <tr><td colspan="8" class="daily-muted">No event yet.</td></tr>
            <?php endif; ?>
            <?php foreach ($events as $e): ?>
                <tr>
                    <td class="td-mono"><?= dh($e['id']) ?></td>
                    <td><?= dh($e['name']) ?></td>
                    <td class="td-mono"><?= dh($e['theme']) ?></td>
                    <td class="daily-muted"><?= $e['teaserStart'] ? dh($e['teaserStart']) . ' →' : '-' ?></td>
                    <td class="td-mono"><?= dh($e['start'] === $e['end'] ? $e['start'] : $e['start'] . ' → ' . $e['end']) ?></td>
                    <td><?= dh(SeasonalEvents::phase($e, $today) ?? '-') ?></td>
                    <td class="daily-muted"><?= $e['previewUsers'] ? dh($e['previewPhase'] . ' for @' . implode(', @', $e['previewUsers'])) : '-' ?></td>
                    <td class="td-actions"><a class="btn btn-secondary btn-sm" href="<?= dh($self . '?id=' . rawurlencode($e['id'])) ?>">Edit</a></td>
                </tr>
            <?php endforeach; ?>
            </tbody>
        </table>
    </div>

    <form method="POST" action="<?= dh($self) ?>" class="form-card" style="margin-top:16px">
        <?= csrf_input() ?>
        <input type="hidden" name="action" value="save">
        <h3 style="margin-bottom:8px"><?= $editing ? 'Edit ' . dh($editing['id']) : 'New event' ?></h3>
        <div class="form-group"><label>Id</label>
            <input type="text" name="id" value="<?= dh($editing['id'] ?? '') ?>" placeholder="halloween-2026" <?= $editing ? 'readonly' : '' ?> required></div>
        <div class="form-group"><label>Name</label><input type="text" name="name" maxlength="80" value="<?= dh($editing['name'] ?? '') ?>" placeholder="Halloween 2026"></div>
        <div class="form-group"><label>Theme key</label>
            <input type="text" name="theme" list="event-themes" value="<?= dh($editing['theme'] ?? '') ?>" placeholder="halloween" required>
            <datalist id="event-themes"><?php foreach (SeasonalEvents::THEMES as $t): ?><option value="<?= dh($t) ?>"><?php endforeach; ?></datalist></div>
        <div class="form-group"><label>Teaser start</label><input type="date" name="teaserStart" value="<?= dh((string) ($editing['teaserStart'] ?? '')) ?>">
            <div class="hint">Empty: no teaser.</div></div>
        <div class="form-group"><label>Start</label><input type="date" name="start" value="<?= dh($editing['start'] ?? '') ?>" required></div>
        <div class="form-group"><label>End</label><input type="date" name="end" value="<?= dh($editing['end'] ?? '') ?>" required>
            <div class="hint">The same as the start for a one-day event.</div></div>
        <div class="form-group"><label>Preview for (usernames)</label>
            <input type="text" name="previewUsers" value="<?= dh(implode(', ', $editing['previewUsers'] ?? [])) ?>" placeholder="jacques, linh">
            <div class="hint">These accounts see the phase below right now, whatever the date (signed in, app or web). Empty it when you're done.</div></div>
        <div class="form-group"><label>Preview phase</label>
            <select name="previewPhase">
                <?php foreach (SeasonalEvents::PHASES as $ph): ?>
                    <option value="<?= $ph ?>"<?= ($editing['previewPhase'] ?? 'live') === $ph ? ' selected' : '' ?>><?= $ph ?></option>
                <?php endforeach; ?>
            </select></div>
        <div class="form-actions" style="gap:8px">
            <button class="btn btn-primary" type="submit">Save</button>
            <?php if ($editing): ?><a class="btn btn-secondary" href="<?= dh($self) ?>">New</a><?php endif; ?>
        </div>
    </form>

    <?php if ($editing): ?>
        <form method="POST" action="<?= dh($self) ?>" class="form-card" style="margin-top:16px" onsubmit="return confirm('Delete <?= dh($editing['id']) ?>?')">
            <?= csrf_input() ?>
            <input type="hidden" name="action" value="delete">
            <input type="hidden" name="id" value="<?= dh($editing['id']) ?>">
            <button class="btn btn-secondary btn-sm" type="submit">Delete <?= dh($editing['id']) ?></button>
        </form>
    <?php endif; ?>
</div>
<?php admin_foot(); ?>
