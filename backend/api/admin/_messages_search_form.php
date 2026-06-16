<?php
// Shared search toolbar for /admin/messages (search mode + default day view).
// Expects $search, $typeF, $TYPE_LABELS in scope.
declare(strict_types=1);
?>
<form method="GET" action="/admin/messages" class="toolbar">
    <input type="text" name="q" value="<?= htmlspecialchars($search, ENT_QUOTES) ?>" placeholder="Search by city / event / hangout / challenge name or channel ID…">
    <select name="type">
        <?php
        $opts = ['all' => 'All channels'] + $TYPE_LABELS;
        foreach ($opts as $val => $label):
        ?>
            <option value="<?= $val ?>" <?= $typeF === $val ? 'selected' : '' ?>><?= $label ?></option>
        <?php endforeach; ?>
    </select>
    <button type="submit" class="btn btn-primary btn-sm">Search</button>
    <?php if ($search !== '' || $typeF !== 'all'): ?>
        <a href="/admin/messages" class="btn btn-secondary btn-sm">Clear</a>
    <?php endif; ?>
</form>
