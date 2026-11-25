<?php
// Shared search toolbar for /admin/messages (search mode + default day view).
// Expects $search, $typeF, $TYPE_LABELS in scope.
declare(strict_types=1);
?>
<form method="GET" action="/admin/messages" class="toolbar">
    <input type="text" name="q" value="<?= htmlspecialchars($search, ENT_QUOTES) ?>" placeholder="Chat name (city, plan, topic) or id" style="width:320px">
    <select name="type">
        <?php
        $opts = ['all' => 'All chats'] + $TYPE_LABELS;
        foreach ($opts as $val => $label):
        ?>
            <option value="<?= $val ?>" <?= $typeF === $val ? 'selected' : '' ?>><?= $label ?></option>
        <?php endforeach; ?>
    </select>
    <button type="submit" class="btn btn-sm">Search</button>
    <?php if ($search !== '' || $typeF !== 'all'): ?>
        <a href="/admin/messages" class="btn btn-sm btn-ghost">Clear</a>
    <?php endif; ?>
</form>
