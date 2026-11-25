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
            $pdo->prepare("INSERT INTO app_settings (key, value, updated_at, updated_by) VALUES ('hi_question_enabled', ?, now(), ?)
                           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by")->execute([!empty($_POST['enabled']) ? '1' : '0', admin_actor()]);
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
<div class="admin-main">
  <?= ui_page_head('Today', 'Hi questions', 'Once a day Hilads posts one question in every city chat (<code>{city}</code> becomes the city\'s name) and one in World. The list rotates by date; with no question here, the built-in ones are used.') ?>
  <?= flash_html() ?>
  <div class="card card-pad" style="margin-bottom:16px">
    <form method="post" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:0">
      <?= csrf_input() ?><input type="hidden" name="do" value="switch">
      <label class="check"><input type="checkbox" name="enabled" value="1"<?= HiQuestions::enabled() ? ' checked' : '' ?>> Post the question of the day</label>
      <button class="btn btn-sm">Save</button>
    </form>
  </div>
  <?php foreach (['city' => 'City chats', 'world' => 'World'] as $scope => $title): ?>
  <section class="card" style="margin-bottom:16px">
    <div class="card-head"><h2><?= $esc($title) ?></h2>
      <span class="hint">Today: “<?= $esc(HiQuestions::render(HiQuestions::textFor($scope, $today), $scope === 'city' ? 'Saigon' : null)) ?>”</span></div>
    <?php if ($by[$scope] === []): ?>
      <div class="card-body"><form method="post" style="display:flex;gap:10px;align-items:center;margin:0"><?= csrf_input() ?><input type="hidden" name="do" value="seed"><input type="hidden" name="scope" value="<?= $scope ?>">
        <span class="muted">Using the <?= count($scope === 'world' ? HiQuestions::WORLD : HiQuestions::CITY) ?> built-in questions.</span>
        <button class="btn btn-sm">Copy them here to edit</button></form></div>
    <?php endif; ?>
    <div class="table-wrapper"><table class="data"><thead><tr><th style="width:90px">Order</th><th>Question</th><th style="width:60px">On</th><th style="width:170px"></th></tr></thead><tbody>
      <?php foreach ($by[$scope] as $r): $fid = 'q' . (int) $r['id']; ?>
        <tr>
          <td><input class="input" form="<?= $fid ?>" type="number" name="position" value="<?= (int) $r['position'] ?>" style="width:70px" aria-label="Order"></td>
          <td><input class="input" form="<?= $fid ?>" type="text" name="text" value="<?= $esc($r['text']) ?>" maxlength="200" style="width:100%" aria-label="Question"></td>
          <td><input form="<?= $fid ?>" type="checkbox" name="active" value="1"<?= ($r['active'] === true || $r['active'] === 't') ? ' checked' : '' ?> aria-label="On"></td>
          <td><div style="display:flex;gap:6px;justify-content:flex-end">
            <form id="<?= $fid ?>" method="post" style="margin:0"><?= csrf_input() ?><input type="hidden" name="do" value="save"><input type="hidden" name="id" value="<?= (int) $r['id'] ?>"><button class="btn btn-sm">Save</button></form>
            <form method="post" style="margin:0" data-confirm="Delete this question?" data-confirm-text="It leaves the rotation." data-confirm-button="Delete"><?= csrf_input() ?><input type="hidden" name="do" value="delete"><input type="hidden" name="id" value="<?= (int) $r['id'] ?>"><button class="btn btn-sm btn-danger">Delete</button></form>
          </div></td>
        </tr>
      <?php endforeach; ?>
      <tr>
        <td></td>
        <td><input class="input" form="add-<?= $scope ?>" type="text" name="text" maxlength="200" style="width:100%" aria-label="New question"
                   placeholder="<?= $scope === 'city' ? "Where's the best phở in {city}?" : 'What do people in your city eat for breakfast?' ?>"></td>
        <td></td>
        <td><form id="add-<?= $scope ?>" method="post" style="margin:0;display:flex;justify-content:flex-end"><?= csrf_input() ?><input type="hidden" name="do" value="add"><input type="hidden" name="scope" value="<?= $scope ?>"><button class="btn btn-sm btn-primary">Add</button></form></td>
      </tr>
    </tbody></table></div>
  </section>
  <?php endforeach; ?>
</div>
<?php
admin_foot();
