<?php

declare(strict_types=1);

admin_require_login();

// Admin › Hi questions: the Hi chat's "question of the day" (HiQuestions). One list per
// scope (a city channel: local tips, {city} = the city's name; World: compare cities),
// rotated by date; an empty list uses the built-in defaults. The switch turns the
// question off everywhere.

$pdo = Database::pdo();
$esc = static fn($v): string => htmlspecialchars((string) $v, ENT_QUOTES);

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    csrf_verify();
    $do = (string) ($_POST['do'] ?? '');
    try {
        if ($do === 'switch') {
            $pdo->prepare("INSERT INTO app_settings (key, value, updated_at, updated_by) VALUES ('hi_question_enabled', ?, now(), 'admin')
                           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()")->execute([!empty($_POST['enabled']) ? '1' : '0']);
            AppConfig::forgetSettings();
            flash_set('success', 'Question of the day ' . (!empty($_POST['enabled']) ? 'on' : 'off') . '.');
        } elseif ($do === 'add') {
            $scope = ($_POST['scope'] ?? '') === 'world' ? 'world' : 'city';
            $text  = trim((string) ($_POST['text'] ?? ''));
            if ($text === '' || mb_strlen($text) > 200) throw new InvalidArgumentException('Write a question (200 characters max).');
            $pdo->prepare("INSERT INTO hi_questions (scope, text, position) VALUES (?, ?, (SELECT coalesce(max(position), 0) + 1 FROM hi_questions WHERE scope = ?))")
                ->execute([$scope, $text, $scope]);
            flash_set('success', 'Question added.');
        } elseif ($do === 'save') {
            $id = (int) ($_POST['id'] ?? 0);
            $text = trim((string) ($_POST['text'] ?? ''));
            if ($text === '' || mb_strlen($text) > 200) throw new InvalidArgumentException('Write a question (200 characters max).');
            $pdo->prepare("UPDATE hi_questions SET text = ?, position = ?, active = ? WHERE id = ?")
                ->execute([$text, (int) ($_POST['position'] ?? 0), !empty($_POST['active']) ? 't' : 'f', $id]);
            flash_set('success', 'Saved.');
        } elseif ($do === 'delete') {
            $pdo->prepare("DELETE FROM hi_questions WHERE id = ?")->execute([(int) ($_POST['id'] ?? 0)]);
            flash_set('success', 'Deleted.');
        } elseif ($do === 'seed') {
            $scope = ($_POST['scope'] ?? '') === 'world' ? 'world' : 'city';
            $ins = $pdo->prepare("INSERT INTO hi_questions (scope, text, position) VALUES (?, ?, ?)");
            foreach ($scope === 'world' ? HiQuestions::WORLD : HiQuestions::CITY as $i => $q) $ins->execute([$scope, $q, $i + 1]);
            flash_set('success', 'Default questions copied, edit them freely.');
        }
    } catch (\Throwable $e) {
        flash_set('error', $e->getMessage());
    }
    admin_redirect('/admin/hi-questions');
}

$rows = $pdo->query("SELECT * FROM hi_questions ORDER BY scope, position, id")->fetchAll(PDO::FETCH_ASSOC);
$by   = ['city' => [], 'world' => []];
foreach ($rows as $r) $by[$r['scope']][] = $r;
$today = DailyClock::currentDate();

admin_head('Hi questions');
admin_nav('/admin/hi-questions');
?>
<main class="admin-main">
  <?= flash_html() ?>
  <h1 class="page-title">Hi — question of the day</h1>
  <p style="color:var(--faint);max-width:820px">Once a day, Hilads posts one question in every city chat (local tips, <code>{city}</code> becomes the city's name) and one in World (comparing cities). The list rotates by date; with no question here, the built-in defaults are used.</p>
  <form method="post" class="toolbar" style="margin:12px 0 24px">
    <?= csrf_input() ?><input type="hidden" name="do" value="switch">
    <label><input type="checkbox" name="enabled" value="1"<?= HiQuestions::enabled() ? ' checked' : '' ?>> Post the question of the day</label>
    <button class="btn btn-primary btn-sm">Save</button>
  </form>
  <?php foreach (['city' => 'City chats', 'world' => 'World'] as $scope => $title): ?>
    <h2 style="font-size:15px;color:var(--text);margin:24px 0 8px"><?= $esc($title) ?> — today: “<?= $esc(HiQuestions::render(HiQuestions::textFor($scope, $today), $scope === 'city' ? 'Saigon' : null)) ?>”</h2>
    <?php if ($by[$scope] === []): ?>
      <form method="post" style="margin-bottom:8px"><?= csrf_input() ?><input type="hidden" name="do" value="seed"><input type="hidden" name="scope" value="<?= $scope ?>">
        <span style="color:var(--faint)">Using the <?= count($scope === 'world' ? HiQuestions::WORLD : HiQuestions::CITY) ?> built-in questions.</span>
        <button class="btn btn-secondary btn-sm">Copy them here to edit</button></form>
    <?php endif; ?>
    <div class="table-wrapper"><table><thead><tr><th>Order</th><th>Question</th><th>On</th><th></th></tr></thead><tbody>
      <?php foreach ($by[$scope] as $r): ?>
        <tr><form method="post"><?= csrf_input() ?><input type="hidden" name="do" value="save"><input type="hidden" name="id" value="<?= (int) $r['id'] ?>">
          <td><input type="number" name="position" value="<?= (int) $r['position'] ?>" style="width:60px;background:var(--surface);border:1px solid var(--line);color:var(--text);padding:4px"></td>
          <td><input type="text" name="text" value="<?= $esc($r['text']) ?>" maxlength="200" style="width:100%;min-width:420px;background:var(--surface);border:1px solid var(--line);color:var(--text);padding:6px"></td>
          <td><input type="checkbox" name="active" value="1"<?= ($r['active'] === true || $r['active'] === 't') ? ' checked' : '' ?>></td>
          <td class="td-actions"><button class="btn btn-secondary btn-sm">Save</button></form>
            <form method="post" onsubmit="return confirm('Delete this question?')"><?= csrf_input() ?><input type="hidden" name="do" value="delete"><input type="hidden" name="id" value="<?= (int) $r['id'] ?>"><button class="btn btn-danger btn-sm">Delete</button></form></td></tr>
      <?php endforeach; ?>
      <tr><form method="post"><?= csrf_input() ?><input type="hidden" name="do" value="add"><input type="hidden" name="scope" value="<?= $scope ?>">
        <td></td><td><input type="text" name="text" maxlength="200" placeholder="<?= $scope === 'city' ? "Where's the best phở in {city}?" : 'What do people in your city eat for breakfast?' ?>" style="width:100%;min-width:420px;background:var(--surface);border:1px solid var(--line);color:var(--text);padding:6px"></td>
        <td></td><td><button class="btn btn-primary btn-sm">Add</button></td></form></tr>
    </tbody></table></div>
  <?php endforeach; ?>
</main>
<?php
admin_foot();
