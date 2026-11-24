<?php

declare(strict_types=1);

admin_require_login();

// Admin › Launch Season (Contest): seasons and their settings, the live dashboard, the
// participants (invalidate a photo / like, disqualify), the suspicious signals, the winner
// and the exports, the public rules text, the log. Every change is logged in
// contest_admin_log; destructive ones ask first. The contest never touches the game's
// score: see src/Contest.php.

$pdo  = Database::pdo();
$esc  = static fn($v): string => htmlspecialchars((string) $v, ENT_QUOTES);
$tabs = ['seasons' => '🗓️ Seasons', 'dashboard' => '📊 Dashboard', 'participants' => '👥 Participants',
         'signals' => '🚩 Signals', 'winner' => '🏆 Winner & export', 'rules' => '📜 Rules', 'log' => '🧾 Log'];
$tab  = isset($tabs[$_GET['tab'] ?? '']) ? (string) $_GET['tab'] : 'dashboard';
$seasons = Contest::seasons();
$sid  = (int) ($_GET['season'] ?? ($seasons[0]['id'] ?? 0));
$season = $sid > 0 ? Contest::season($sid) : null;
$url  = static function (string $t, array $q = []) use (&$sid): string {
    return '/admin/launch-season?' . http_build_query(['tab' => $t, 'season' => $sid] + $q);
};

$intField = static function (string $k, int $min = 0): int {
    $v = filter_var($_POST[$k] ?? null, FILTER_VALIDATE_INT);
    if ($v === false || $v < $min) throw new InvalidArgumentException("{$k} must be a number ≥ {$min}.");
    return $v;
};
$dateField = static function (string $k): string {
    $v = (string) ($_POST[$k] ?? '');
    if (!DailyClock::isValidDate($v)) throw new InvalidArgumentException("{$k} must be a date.");
    return $v;
};

// ── Actions ────────────────────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    csrf_verify();
    $do   = (string) ($_POST['do'] ?? '');
    $back = $url($tab, array_filter(['user' => $_POST['user'] ?? null, 'q' => $_POST['q'] ?? null]));
    try {
        if ($do === 'save_season') {
            $fields = ['name' => trim((string) ($_POST['name'] ?? '')), 'start_date' => $dateField('start_date'),
                       'end_date' => $dateField('end_date'), 'final_week_start' => $dateField('final_week_start')];
            if ($fields['name'] === '') throw new InvalidArgumentException('Give the season a name.');
            if (!($fields['start_date'] <= $fields['final_week_start'] && $fields['final_week_start'] <= $fields['end_date'])) {
                throw new InvalidArgumentException('Dates: start ≤ final week start ≤ end.');
            }
            foreach (Contest::SETTINGS as $k) $fields[$k] = $intField($k, in_array($k, ['referral_points', 'referral_cap', 'headstart_top_n'], true) ? 0 : 1);
            $fields['is_test'] = !empty($_POST['is_test']) ? 'true' : 'false';
            $id = (int) ($_POST['id'] ?? 0);
            if ($id > 0) {
                $old = Contest::season($id) ?? throw new InvalidArgumentException('Unknown season.');
                $set = implode(', ', array_map(static fn($k) => "{$k} = ?", array_keys($fields)));
                $pdo->prepare("UPDATE contest_seasons SET {$set}, updated_at = now() WHERE id = ?")->execute([...array_values($fields), $id]);
                $changed = [];
                foreach ($fields as $k => $v) {
                    $was = is_bool($old[$k]) ? ($old[$k] ? 'true' : 'false') : (string) $old[$k];
                    if ($was !== (string) $v) $changed[$k] = [$was, $v];
                }
                Contest::log($id, 'settings', null, $changed);
                Contest::forget($id);
                $msg = 'Season saved' . ($changed ? ' (' . implode(', ', array_keys($changed)) . ')' : ', nothing changed') . '. Standings recomputed.';
                if (!empty($_POST['refreeze']) && ($s = Contest::season($id)) && $s['headstart_frozen_at'] !== null) {
                    $n = Contest::freezeHeadstart($s, true);
                    Contest::log($id, 'refreeze_headstart', null, ['players' => $n]);
                    $msg .= " Head-start re-taken ({$n} players).";
                }
                flash_set('success', $msg);
                $sid = $id;
            } else {
                $cols = implode(', ', array_keys($fields));
                $q    = implode(', ', array_fill(0, count($fields), '?'));
                $stmt = $pdo->prepare("INSERT INTO contest_seasons ({$cols}) VALUES ({$q}) RETURNING id");
                $stmt->execute(array_values($fields));
                $sid = (int) $stmt->fetchColumn();
                $s   = Contest::season($sid);
                $pdo->prepare("INSERT INTO contest_rules (season_id, locale, body) VALUES (?, 'en', ?) ON CONFLICT DO NOTHING")
                    ->execute([$sid, Contest::placeholderRules($s)]);
                Contest::log($sid, 'create', null, $fields);
                flash_set('success', 'Season created as a draft. Start it when ready.');
            }
            admin_redirect('/admin/launch-season?tab=seasons&season=' . $sid);
        } elseif ($season !== null && in_array($do, ['start', 'pause', 'resume', 'end', 'reopen'], true)) {
            $sql = match ($do) {
                'start'  => "UPDATE contest_seasons SET status = 'running', paused = false, updated_at = now() WHERE id = ?",
                'pause'  => "UPDATE contest_seasons SET paused = true, updated_at = now() WHERE id = ?",
                'resume' => "UPDATE contest_seasons SET paused = false, updated_at = now() WHERE id = ?",
                'end'    => "UPDATE contest_seasons SET status = 'ended', updated_at = now() WHERE id = ?",
                'reopen' => "UPDATE contest_seasons SET status = 'running', updated_at = now() WHERE id = ?",
            };
            if ($do === 'start' && !$season['is_test']) {
                $other = $pdo->prepare("SELECT name FROM contest_seasons WHERE NOT is_test AND status = 'running' AND id <> ?");
                $other->execute([$season['id']]);
                if ($n = $other->fetchColumn()) throw new InvalidArgumentException("End “{$n}” first: one real season runs at a time.");
            }
            $pdo->prepare($sql)->execute([$season['id']]);
            Contest::log($season['id'], $do);
            Contest::forget($season['id']);
            flash_set('success', 'Season: ' . $do . '.');
        } elseif ($season !== null && $do === 'freeze') {
            $n = Contest::freezeHeadstart($season, true);
            Contest::log($season['id'], 'refreeze_headstart', null, ['players' => $n]);
            flash_set('success', "Head-start taken from the season ranking now: {$n} players.");
        } elseif ($season !== null && $do === 'tester_add') {
            $name = ltrim(trim((string) ($_POST['username'] ?? '')), '@');
            $stmt = $pdo->prepare("SELECT id FROM users WHERE lower(username) = lower(?) AND deleted_at IS NULL");
            $stmt->execute([$name]);
            $uid = $stmt->fetchColumn() ?: throw new InvalidArgumentException("No account @{$name}.");
            $pdo->prepare("INSERT INTO contest_testers (season_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING")->execute([$season['id'], $uid]);
            Contest::log($season['id'], 'tester_add', $uid, ['username' => $name]);
            flash_set('success', "@{$name} can see this test season.");
        } elseif ($season !== null && $do === 'tester_remove') {
            $pdo->prepare("DELETE FROM contest_testers WHERE season_id = ? AND user_id = ?")->execute([$season['id'], (string) $_POST['user_id']]);
            Contest::log($season['id'], 'tester_remove', (string) $_POST['user_id']);
            flash_set('success', 'Tester removed.');
        } elseif ($season !== null && in_array($do, ['invalidate_photo', 'invalidate_vote'], true)) {
            Contest::invalidate($season['id'], substr($do, 11), (string) ($_POST['target'] ?? ''), (string) ($_POST['reason'] ?? ''));
            flash_set('success', 'Invalidated for the contest (the game keeps it). Standings recomputed.');
        } elseif ($season !== null && $do === 'undo_invalidation') {
            Contest::undoInvalidation($season['id'], (int) ($_POST['id'] ?? 0));
            flash_set('success', 'Counts again.');
        } elseif ($season !== null && in_array($do, ['disqualify', 'undo_disqualify'], true)) {
            Contest::disqualify($season['id'], (string) ($_POST['user'] ?? ''), $do === 'disqualify', (string) ($_POST['reason'] ?? ''));
            flash_set('success', $do === 'disqualify' ? 'Disqualified.' : 'Back in the contest.');
        } elseif ($season !== null && $do === 'winner') {
            $field = (string) ($_POST['field'] ?? '');
            if ($field === 'winner_user_id') {
                $pdo->prepare("UPDATE contest_seasons SET winner_user_id = ?, updated_at = now() WHERE id = ?")->execute([(string) $_POST['user'] ?: null, $season['id']]);
            } elseif (in_array($field, ['winner_contacted_at', 'winner_confirmed_at', 'prize_sent_at'], true)) {
                $on = !empty($_POST['on']);
                $pdo->prepare("UPDATE contest_seasons SET {$field} = " . ($on ? 'now()' : 'NULL') . ", updated_at = now() WHERE id = ?")->execute([$season['id']]);
            } else {
                throw new InvalidArgumentException('Unknown field.');
            }
            Contest::log($season['id'], 'winner_' . $field, (string) ($_POST['user'] ?? ''), ['on' => !empty($_POST['on'])]);
            flash_set('success', 'Saved.');
        } elseif ($season !== null && $do === 'rules') {
            $locale = strtolower(trim((string) ($_POST['locale'] ?? '')));
            if (!preg_match('/^[a-z]{2}(-[a-z]{2,4})?$/', $locale)) throw new InvalidArgumentException('Locale like en, fr, pt-br.');
            $body = trim((string) ($_POST['body'] ?? ''));
            if ($body === '') throw new InvalidArgumentException('The rules text is empty.');
            $final = !empty($_POST['is_final']) ? 'true' : 'false';
            $pdo->prepare("
                INSERT INTO contest_rules (season_id, locale, body, is_final) VALUES (?, ?, ?, ?)
                ON CONFLICT (season_id, locale) DO UPDATE SET body = EXCLUDED.body, is_final = EXCLUDED.is_final,
                    version = contest_rules.version + 1, updated_at = now()
            ")->execute([$season['id'], $locale, $body, $final]);
            Contest::log($season['id'], 'rules', $locale, ['final' => $final === 'true', 'length' => mb_strlen($body)]);
            flash_set('success', "Rules ({$locale}) saved. New joiners accept this version; the public page updates within a minute.");
            $back = $url('rules', ['locale' => $locale]);
        }
    } catch (\Throwable $e) {
        flash_set('error', $e->getMessage());
    }
    admin_redirect($back);
}

// ── Page ───────────────────────────────────────────────────────────────────
$badge = static function (?array $s) use ($esc): string {
    if ($s === null) return '';
    $phase = Contest::phase($s);
    $label = ['draft' => 'Draft', 'upcoming' => 'Running · not started', 'season' => 'Running', 'final' => 'Final week',
              'over' => 'Over · not ended', 'ended' => 'Ended'][$phase];
    $color = ['draft' => '#555', 'upcoming' => '#2a6', 'season' => '#2a6', 'final' => '#d90', 'over' => '#a60', 'ended' => '#444'][$phase];
    return '<span class="badge" style="background:' . $color . ';color:#fff">' . $esc($s['paused'] ? $label . ' · paused' : $label) . '</span>'
         . ($s['is_test'] ? ' <span class="badge" style="background:#6a3fd0;color:#fff">TEST</span>' : '');
};
$who = static fn(array $r): string => $esc($r['username'] ? '@' . $r['username'] : ($r['displayName'] ?? $r['userId']));

admin_head('Launch Season');
admin_nav('/admin/launch-season');
?>
<style>
.ls-subnav { display:flex; gap:6px; flex-wrap:wrap; margin:10px 0 18px; }
.ls-subnav a { padding:6px 12px; border:1px solid #2a2a2a; border-radius:6px; color:#aaa; font-size:13px; }
.ls-subnav a.active, .ls-subnav a:hover { color:#fff; background:#252525; text-decoration:none; }
.ls-grid { display:grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap:10px 16px; }
.ls-grid label { display:flex; flex-direction:column; gap:4px; color:#aaa; font-size:12px; }
.ls-grid input { background:#1a1a1a; border:1px solid #2a2a2a; color:#eee; padding:6px 8px; border-radius:5px; }
.ls-bar { height:14px; background:#222; border-radius:7px; overflow:hidden; max-width:520px; }
.ls-bar i { display:block; height:100%; background:#FF7A3C; }
.ls-muted { color:#777; font-size:12px; }
.ls-inline { display:inline-flex; gap:6px; align-items:center; margin:0; }
.ls-inline input[type=text] { background:#1a1a1a; border:1px solid #2a2a2a; color:#eee; padding:4px 6px; border-radius:4px; width:180px; }
.ls-photo { width:64px; height:64px; object-fit:cover; border-radius:6px; }
.ls-cols { display:grid; grid-template-columns: 1fr 1fr; gap:20px; }
@media (max-width: 1100px) { .ls-cols { grid-template-columns: 1fr; } }
.ls-x { text-decoration: line-through; color:#777; }
</style>
<main class="admin-main">
  <?= flash_html() ?>
  <h1 class="page-title">🚀 Launch Season</h1>
  <form method="get" class="toolbar" style="margin:0">
    <input type="hidden" name="tab" value="<?= $esc($tab) ?>">
    <select name="season" onchange="this.form.submit()">
      <?php foreach ($seasons as $s): ?>
        <option value="<?= $s['id'] ?>"<?= $s['id'] === $sid ? ' selected' : '' ?>><?= $esc($s['name']) ?> (<?= $esc($s['start_date']) ?> → <?= $esc($s['end_date']) ?>)<?= $s['is_test'] ? ' · TEST' : '' ?></option>
      <?php endforeach; ?>
      <?php if ($seasons === []): ?><option>No season yet</option><?php endif; ?>
    </select>
    <?= $badge($season) ?>
  </form>
  <div class="ls-subnav">
    <?php foreach ($tabs as $t => $label): ?><a href="<?= $esc($url($t)) ?>"<?= $t === $tab ? ' class="active"' : '' ?>><?= $label ?></a><?php endforeach; ?>
  </div>

<?php if ($tab === 'seasons'): ?>
  <?php
  $form = static function (?array $s) use ($esc): void {
      $v = static fn(string $k, $d = '') => $esc($s[$k] ?? $d);
      $defaults = ['vote_cap_per_photo' => 20, 'referral_points' => 20, 'referral_min_photos' => 5, 'referral_cap' => 10,
                   'headstart_top_n' => 10, 'prize_threshold_players' => 500, 'prize_threshold_photos' => 10];
      $labels = ['vote_cap_per_photo' => 'Vote cap per photo', 'referral_points' => 'Referral points', 'referral_min_photos' => 'Referral: min photos',
                 'referral_cap' => 'Referral cap (friends)', 'headstart_top_n' => 'Head-start top N', 'prize_threshold_players' => 'Prize: players needed',
                 'prize_threshold_photos' => 'Prize: photos each'];
      ?>
      <form method="post" class="form-card" style="max-width:none">
        <?= csrf_input() ?><input type="hidden" name="do" value="save_season"><input type="hidden" name="id" value="<?= (int) ($s['id'] ?? 0) ?>">
        <div class="ls-grid">
          <label>Name<input type="text" name="name" value="<?= $v('name', 'Launch Season') ?>" required></label>
          <label>Start date<input type="date" name="start_date" value="<?= $v('start_date') ?>" required></label>
          <label>Final week starts<input type="date" name="final_week_start" value="<?= $v('final_week_start') ?>" required></label>
          <label>End date<input type="date" name="end_date" value="<?= $v('end_date') ?>" required></label>
          <?php foreach ($labels as $k => $l): ?>
            <label><?= $esc($l) ?><input type="number" min="0" name="<?= $k ?>" value="<?= $v($k, $defaults[$k]) ?>" required></label>
          <?php endforeach; ?>
        </div>
        <p style="margin:12px 0 0"><label><input type="checkbox" name="is_test" value="1"<?= !empty($s['is_test']) ? ' checked' : '' ?>> Test season: only the testers below see it; no push to anyone; never in a real season</label></p>
        <?php if (!empty($s['headstart_frozen_at'])): ?>
          <p style="margin:6px 0 0"><label><input type="checkbox" name="refreeze" value="1"> Also re-take the head-start (frozen <?= $esc(substr((string) $s['headstart_frozen_at'], 0, 16)) ?>) with these settings</label></p>
        <?php endif; ?>
        <p class="ls-muted">Dates are challenge dates (the daily drop). Settings apply live: the standings are recomputed at once.</p>
        <div class="form-actions"><button class="btn btn-primary"><?= $s ? 'Save season' : 'Create season (draft)' ?></button></div>
      </form>
  <?php }; ?>

  <?php if ($season !== null): ?>
    <h2 style="font-size:15px;color:#fff">Edit “<?= $esc($season['name']) ?>” <?= $badge($season) ?></h2>
    <?php $form($season); ?>
    <div class="toolbar" style="gap:8px;margin:14px 0">
      <?php $act = static function (string $do, string $label, string $cls = 'btn-secondary', ?string $confirm = null) use ($esc): void { ?>
        <form method="post" class="ls-inline"<?= $confirm ? ' onsubmit="return confirm(\'' . $esc($confirm) . '\')"' : '' ?>><?= csrf_input() ?><input type="hidden" name="do" value="<?= $do ?>"><button class="btn <?= $cls ?> btn-sm"><?= $esc($label) ?></button></form>
      <?php }; ?>
      <?php if ($season['status'] === 'draft') $act('start', '▶ Start', 'btn-primary', 'Start this season? It becomes visible ' . ($season['is_test'] ? 'to its testers.' : 'to everyone.')); ?>
      <?php if ($season['status'] === 'running' && !$season['paused']) $act('pause', '⏸ Pause', 'btn-secondary', 'Pause? The contest is hidden and joining closes; photos and likes keep counting by date.'); ?>
      <?php if ($season['status'] === 'running' && $season['paused']) $act('resume', '▶ Resume'); ?>
      <?php if ($season['status'] === 'running') $act('end', '■ End', 'btn-danger', 'End the season? It disappears from the app. Rankings stay readable here.'); ?>
      <?php if ($season['status'] === 'ended') $act('reopen', 'Reopen', 'btn-secondary', 'Reopen this season?'); ?>
      <?php if ($season['status'] !== 'draft') $act('freeze', '❄ Take the head-start now', 'btn-secondary', 'Replace the head-start with the current season top ' . $season['headstart_top_n'] . '?'); ?>
      <span class="ls-muted">Head-start: <?= $season['headstart_frozen_at'] ? 'frozen ' . $esc(substr((string) $season['headstart_frozen_at'], 0, 16)) : 'taken automatically at the first drop of the final week' ?></span>
    </div>

    <?php if ($season['is_test']): ?>
      <h2 style="font-size:15px;color:#fff;margin-top:24px">Testers</h2>
      <?php
      $stmt = $pdo->prepare("SELECT u.id, u.username, u.display_name FROM contest_testers t JOIN users u ON u.id = t.user_id WHERE t.season_id = ? ORDER BY u.username");
      $stmt->execute([$season['id']]);
      ?>
      <p class="ls-muted">Only these accounts see this test season and can join it. A tester can never join a real season.</p>
      <div class="table-wrapper"><table><tbody>
        <?php foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $t): ?>
          <tr><td>@<?= $esc($t['username']) ?></td><td><?= $esc($t['display_name']) ?></td>
            <td class="td-actions"><form method="post" class="ls-inline"><?= csrf_input() ?><input type="hidden" name="do" value="tester_remove"><input type="hidden" name="user_id" value="<?= $esc($t['id']) ?>"><button class="btn btn-secondary btn-sm">Remove</button></form></td></tr>
        <?php endforeach; ?>
      </tbody></table></div>
      <form method="post" class="ls-inline" style="margin-top:8px"><?= csrf_input() ?><input type="hidden" name="do" value="tester_add"><input type="text" name="username" placeholder="@username"><button class="btn btn-primary btn-sm">Add tester</button></form>
    <?php endif; ?>
    <h2 style="font-size:15px;color:#fff;margin-top:32px">New season</h2>
  <?php endif; ?>
  <?php $form(null); ?>

<?php elseif ($season === null): ?>
  <p class="no-results">No season yet. <a href="/admin/launch-season?tab=seasons">Create one</a>.</p>

<?php elseif ($tab === 'dashboard'): ?>
  <?php
  $st = Contest::standings($season);
  $season = Contest::season($season['id']) ?? $season;
  [$monday, $sunday] = Scoring::week(DailyClock::currentDate());
  $stmt = $pdo->prepare("
      SELECT count(DISTINCT cp.user_id) FROM contest_participants cp
      JOIN daily_proofs dp ON dp.user_id = cp.user_id AND dp.created_at >= cp.joined_at
      JOIN daily_challenges dc ON dc.id = dp.challenge_id
      WHERE cp.season_id = ? AND NOT cp.disqualified AND dp.moderation_status = 'approved'
        AND NOT dp.is_demo AND NOT dp.is_seed AND NOT dp.is_suggestion AND dc.challenge_date BETWEEN ? AND ?
  ");
  $stmt->execute([$season['id'], max($monday, $season['start_date']), min($sunday, $season['end_date'])]);
  $active = (int) $stmt->fetchColumn();
  $c = $st['counter'];
  $pct = min(100, $c['players'] / max(1, $c['threshold']) * 100);
  $table = static function (array $order, string $phase) use ($st, $who, $esc, $url): void { ?>
    <div class="table-wrapper"><table>
      <thead><tr><th>#</th><th>Player</th><th>Points</th><th>Votes</th><th>Referral</th><?= $phase === 'final' ? '<th>Head-start</th>' : '' ?><th>Days</th><th>Photos</th><th>Likes (all)</th></tr></thead>
      <tbody>
      <?php foreach (array_slice($order, 0, 100) as $i => $id): $r = $st['rows'][$id]; ?>
        <tr><td><?= $i + 1 ?></td><td><a href="<?= $esc($url('participants', ['user' => $id])) ?>"><?= $who($r) ?></a></td>
          <td><strong><?= $phase === 'final' ? $r['finalPoints'] : $r['seasonPoints'] ?></strong></td>
          <td><?= $phase === 'final' ? $r['finalVotes'] : $r['seasonVotes'] ?></td>
          <td><?= $r['referralBonus'] ?> <span class="ls-muted">(<?= $r['referralsCounted'] ?>)</span></td>
          <?= $phase === 'final' ? '<td>' . $r['headstart'] . '</td>' : '' ?>
          <td><?= $r['days'] ?></td><td><?= $r['photos'] ?></td><td><?= $r['allVotes'] ?></td></tr>
      <?php endforeach; ?>
      <?php if ($order === []): ?><tr><td colspan="9" class="no-results">Nobody yet.</td></tr><?php endif; ?>
      </tbody></table></div>
  <?php }; ?>
  <div class="stats-row">
    <div class="stat-card"><div class="stat-value"><?= $c['players'] ?> / <?= $c['threshold'] ?></div><div class="stat-label">Players with <?= $c['photos'] ?>+ photos</div></div>
    <div class="stat-card"><div class="stat-value"><?= $st['totals']['participants'] ?></div><div class="stat-label">Joined</div></div>
    <div class="stat-card"><div class="stat-value"><?= $active ?></div><div class="stat-label">Active this week</div></div>
    <div class="stat-card"><div class="stat-value"><?= $st['totals']['photos'] ?></div><div class="stat-label">Contest photos</div></div>
  </div>
  <div class="ls-bar" title="<?= round($pct) ?>%"><i style="width:<?= $pct ?>%"></i></div>
  <p class="ls-muted">Prize threshold: <?= round($pct) ?>%. Standings are live (cached <?= Contest::CACHE_TTL ?> s).</p>
  <div class="ls-cols" style="margin-top:18px">
    <div><h2 style="font-size:15px;color:#fff">Season ranking (before <?= $esc($season['final_week_start']) ?>)</h2><?php $table($st['season'], 'season'); ?></div>
    <div><h2 style="font-size:15px;color:#fff">Final-week ranking <?= $season['headstart_frozen_at'] ? '' : '<span class="ls-muted">(head-start not taken yet)</span>' ?></h2><?php $table($st['final'], 'final'); ?></div>
  </div>

<?php elseif ($tab === 'participants'): ?>
  <?php
  $q    = trim((string) ($_GET['q'] ?? ''));
  $user = (string) ($_GET['user'] ?? '');
  $stmt = $pdo->prepare("
      SELECT cp.user_id, u.username, u.display_name, u.email, cp.country, cp.joined_at, cp.disqualified
      FROM contest_participants cp JOIN users u ON u.id = cp.user_id
      WHERE cp.season_id = ? AND (? = '' OR u.username ILIKE ? OR u.email ILIKE ? OR u.display_name ILIKE ?)
      ORDER BY cp.joined_at DESC LIMIT 100
  ");
  $like = '%' . ltrim($q, '@') . '%';
  $stmt->execute([$season['id'], $q, $like, $like, $like]);
  $list = $stmt->fetchAll(PDO::FETCH_ASSOC);
  ?>
  <form method="get" class="toolbar"><input type="hidden" name="tab" value="participants"><input type="hidden" name="season" value="<?= $sid ?>">
    <input type="search" name="q" value="<?= $esc($q) ?>" placeholder="@username, name or email"><button class="btn btn-secondary btn-sm">Search</button></form>
  <div class="ls-cols">
    <div class="table-wrapper"><table><thead><tr><th>Player</th><th>Country</th><th>Joined</th><th></th></tr></thead><tbody>
      <?php foreach ($list as $p): ?>
        <tr<?= $p['user_id'] === $user ? ' style="background:#252525"' : '' ?>><td><a href="<?= $esc($url('participants', ['user' => $p['user_id'], 'q' => $q])) ?>">@<?= $esc($p['username']) ?></a>
          <?= DailyProofRepository::bool($p['disqualified']) ? '<span class="badge badge-deleted">DQ</span>' : '' ?></td>
          <td><?= $esc($p['country']) ?></td><td class="ls-muted"><?= $esc(substr((string) $p['joined_at'], 0, 16)) ?></td><td></td></tr>
      <?php endforeach; ?>
      <?php if ($list === []): ?><tr><td colspan="4" class="no-results">No participant.</td></tr><?php endif; ?>
    </tbody></table></div>
    <div>
    <?php if ($user !== '' && ($part = Contest::participant($season['id'], $user))): ?>
      <?php
      $st = Contest::standings($season);
      $r  = $st['rows'][$user] ?? null;
      $detail = Contest::participantDetail($season, $user);
      $stmt = $pdo->prepare("SELECT username FROM users WHERE id = ?");
      $stmt->execute([$user]);
      $uname = (string) $stmt->fetchColumn();
      $inv = $pdo->prepare("SELECT * FROM contest_invalidations WHERE season_id = ? AND undone_at IS NULL AND (target_id = ANY (?::text[]))");
      $ids = array_column($detail['photos'], 'id');
      foreach ($detail['votes'] as $vs) foreach ($vs as $v) $ids[] = (string) $v['id'];
      $inv->execute([$season['id'], '{' . implode(',', array_map(static fn($x) => '"' . $x . '"', $ids)) . '}']);
      $invalidations = $inv->fetchAll(PDO::FETCH_ASSOC);
      ?>
      <h2 style="font-size:16px;color:#fff;margin-top:0">@<?= $esc($uname) ?>
        <?= DailyProofRepository::bool($part['disqualified']) ? '<span class="badge badge-deleted">Disqualified: ' . $esc($part['dq_reason']) . '</span>' : '' ?></h2>
      <p class="ls-muted">Joined <?= $esc(substr((string) $part['joined_at'], 0, 16)) ?> · <?= $esc($part['country']) ?> · 18+ <?= DailyProofRepository::bool($part['age_confirmed']) ? 'yes' : 'no' ?> · rules v<?= (int) $part['rules_version'] ?></p>
      <?php if ($r !== null): ?>
        <div class="stats-row">
          <div class="stat-card"><div class="stat-value"><?= $r['seasonPoints'] ?></div><div class="stat-label">Season (#<?= $r['seasonRank'] ?? '–' ?>): <?= $r['seasonVotes'] ?> votes + <?= $r['referralBonus'] ?> ref.</div></div>
          <div class="stat-card"><div class="stat-value"><?= $r['finalPoints'] ?></div><div class="stat-label">Final (#<?= $r['finalRank'] ?? '–' ?>): <?= $r['finalVotes'] ?> + <?= $r['referralBonus'] ?> + <?= $r['headstart'] ?> head-start</div></div>
          <div class="stat-card"><div class="stat-value"><?= $r['days'] ?></div><div class="stat-label">Days · <?= $r['allVotes'] ?> likes uncapped</div></div>
        </div>
        <h3 style="font-size:14px;color:#fff">Referrals (<?= $r['referrals'] ?> active, <?= $r['referralsCounted'] ?> counted)</h3>
        <div class="table-wrapper"><table><tbody>
          <?php foreach ($r['referralFriends'] as $f): ?>
            <tr><td><a href="<?= $esc($url('participants', ['user' => $f['userId']])) ?>">@<?= $esc($f['username']) ?></a></td><td><?= $f['photos'] ?> photos</td><td><?= $esc($f['status']) ?></td></tr>
          <?php endforeach; ?>
          <?php if ($r['referralFriends'] === []): ?><tr><td class="no-results">No invited participant.</td></tr><?php endif; ?>
        </tbody></table></div>
      <?php else: ?>
        <p class="ls-muted">Not in the standings (an excluded account: review, demo, fake, hidden, deleted or a tester in a real season).</p>
      <?php endif; ?>

      <?php if (DailyProofRepository::bool($part['disqualified'])): ?>
        <form method="post" class="ls-inline" onsubmit="return confirm('Put this player back in the contest?')"><?= csrf_input() ?><input type="hidden" name="do" value="undo_disqualify"><input type="hidden" name="user" value="<?= $esc($user) ?>"><button class="btn btn-secondary btn-sm">Undo disqualification</button></form>
      <?php else: ?>
        <form method="post" class="ls-inline" onsubmit="return confirm('Disqualify this player from the contest? (The game is not affected.)')"><?= csrf_input() ?><input type="hidden" name="do" value="disqualify"><input type="hidden" name="user" value="<?= $esc($user) ?>"><input type="text" name="reason" placeholder="Reason" required><button class="btn btn-danger btn-sm">Disqualify</button></form>
      <?php endif; ?>

      <h3 style="font-size:14px;color:#fff;margin-top:18px">Photos in the season</h3>
      <?php foreach ($detail['photos'] as $ph):
        $out = $ph['invalidation_id'] !== null; $counts = $ph['moderation_status'] === 'approved' && DailyProofRepository::bool($ph['after_join']) && !$out;
        $votes = $detail['votes'][$ph['id']] ?? []; ?>
        <div style="display:flex;gap:12px;margin:10px 0;padding:10px;border:1px solid #2a2a2a;border-radius:8px">
          <img class="ls-photo" src="<?= $esc(R2Uploader::thumbProxy($ph['photo_url'])) ?>" alt="">
          <div style="flex:1">
            <div><strong><?= $esc($ph['date']) ?></strong> · <?= $esc($ph['moderation_status']) ?>
              <?= !DailyProofRepository::bool($ph['after_join']) ? '<span class="badge">before joining</span>' : '' ?>
              <?= $out ? '<span class="badge badge-deleted">invalidated</span>' : '' ?>
              <?= $counts ? '<span class="badge badge-active">counts</span>' : '' ?>
              · <?= count($votes) ?> likes</div>
            <?php if (!$out): ?>
              <form method="post" class="ls-inline" style="margin-top:4px" onsubmit="return confirm('Invalidate this photo for the contest?')"><?= csrf_input() ?><input type="hidden" name="do" value="invalidate_photo"><input type="hidden" name="user" value="<?= $esc($user) ?>"><input type="hidden" name="target" value="<?= $esc($ph['id']) ?>"><input type="text" name="reason" placeholder="Reason" required><button class="btn btn-danger btn-sm">Invalidate photo</button></form>
            <?php endif; ?>
            <details style="margin-top:6px"><summary class="ls-muted">Likes</summary>
              <?php foreach ($votes as $v): $vOut = $v['invalidation_id'] !== null; $vEx = DailyProofRepository::bool($v['excluded']); ?>
                <div style="display:flex;gap:8px;align-items:center;margin:3px 0">
                  <span class="<?= $vOut || $vEx ? 'ls-x' : '' ?>">@<?= $esc($v['username']) ?></span><span class="ls-muted"><?= $esc(substr((string) $v['created_at'], 0, 16)) ?><?= $vEx ? ' · excluded account' : '' ?></span>
                  <?php if (!$vOut && !$vEx): ?>
                    <form method="post" class="ls-inline" onsubmit="return confirm('Invalidate this like for the contest?')"><?= csrf_input() ?><input type="hidden" name="do" value="invalidate_vote"><input type="hidden" name="user" value="<?= $esc($user) ?>"><input type="hidden" name="target" value="<?= (int) $v['id'] ?>"><input type="text" name="reason" placeholder="Reason" required style="width:120px"><button class="btn btn-secondary btn-sm">Invalidate</button></form>
                  <?php endif; ?>
                </div>
              <?php endforeach; ?>
            </details>
          </div>
        </div>
      <?php endforeach; ?>
      <?php if ($detail['photos'] === []): ?><p class="no-results">No photo in the season yet.</p><?php endif; ?>

      <?php if ($invalidations !== []): ?>
        <h3 style="font-size:14px;color:#fff">Invalidations</h3>
        <div class="table-wrapper"><table><tbody>
          <?php foreach ($invalidations as $iv): ?>
            <tr><td><?= $esc($iv['kind']) ?> <span class="td-mono"><?= $esc($iv['target_id']) ?></span></td><td><?= $esc($iv['reason']) ?></td><td class="ls-muted"><?= $esc(substr((string) $iv['created_at'], 0, 16)) ?></td>
              <td><form method="post" class="ls-inline" onsubmit="return confirm('Make it count again?')"><?= csrf_input() ?><input type="hidden" name="do" value="undo_invalidation"><input type="hidden" name="user" value="<?= $esc($user) ?>"><input type="hidden" name="id" value="<?= (int) $iv['id'] ?>"><button class="btn btn-secondary btn-sm">Undo</button></form></td></tr>
          <?php endforeach; ?>
        </tbody></table></div>
      <?php endif; ?>
    <?php else: ?>
      <p class="ls-muted">Pick a participant.</p>
    <?php endif; ?>
    </div>
  </div>

<?php elseif ($tab === 'signals'): ?>
  <?php $sg = Contest::signals($season); $link = static fn(string $id, ?string $name) => '<a href="' . $esc($url('participants', ['user' => $id])) . '">@' . $esc($name) . '</a>'; ?>
  <p class="ls-muted">Computed now, nothing is blocked automatically: check, then invalidate or disqualify from the participant's page.</p>
  <h2 style="font-size:15px;color:#fff">Vote-only accounts (no photo of their own, 3+ likes to one participant)</h2>
  <div class="table-wrapper"><table><thead><tr><th>Voter</th><th>Account since</th><th>Liked</th><th>Likes</th></tr></thead><tbody>
    <?php foreach ($sg['voteOnly'] as $r): ?><tr><td>@<?= $esc($r['voter_name']) ?></td><td class="ls-muted"><?= $esc(substr((string) $r['voter_created'], 0, 10)) ?></td><td><?= $link($r['target'], $r['target_name']) ?></td><td><?= (int) $r['n'] ?></td></tr><?php endforeach; ?>
    <?php if ($sg['voteOnly'] === []): ?><tr><td colspan="4" class="no-results">None.</td></tr><?php endif; ?>
  </tbody></table></div>
  <h2 style="font-size:15px;color:#fff">Vote spikes (10+ likes on one photo within an hour)</h2>
  <div class="table-wrapper"><table><thead><tr><th>Player</th><th>Photo</th><th>Hour (UTC)</th><th>Likes</th></tr></thead><tbody>
    <?php foreach ($sg['spikes'] as $r): ?><tr><td><?= $link($r['target'], $r['target_name']) ?></td><td class="td-mono"><?= $esc($r['photo']) ?></td><td><?= $esc(substr((string) $r['hour'], 0, 16)) ?></td><td><?= (int) $r['n'] ?></td></tr><?php endforeach; ?>
    <?php if ($sg['spikes'] === []): ?><tr><td colspan="4" class="no-results">None.</td></tr><?php endif; ?>
  </tbody></table></div>
  <h2 style="font-size:15px;color:#fff">Referral rings (invited friend on the inviter's device or network, or liking the inviter 3+ times)</h2>
  <div class="table-wrapper"><table><thead><tr><th>Inviter</th><th>Friend</th><th>Same device</th><th>Same network</th><th>Friend's likes to inviter</th></tr></thead><tbody>
    <?php foreach ($sg['rings'] as $r): ?><tr><td><?= $link($r['referrer'], $r['referrer_name']) ?></td><td><?= $link($r['friend'], $r['friend_name']) ?></td>
      <td><?= DailyProofRepository::bool($r['same_device']) ? '⚠️ yes' : 'no' ?></td><td><?= DailyProofRepository::bool($r['same_network']) ? 'yes' : 'no' ?></td><td><?= (int) $r['likes_to_referrer'] ?></td></tr><?php endforeach; ?>
    <?php if ($sg['rings'] === []): ?><tr><td colspan="5" class="no-results">None.</td></tr><?php endif; ?>
  </tbody></table></div>
  <h2 style="font-size:15px;color:#fff">Participants sharing a device (one participant per person)</h2>
  <div class="table-wrapper"><table><thead><tr><th>Install id</th><th>Participants</th></tr></thead><tbody>
    <?php foreach ($sg['sharedDevices'] as $r): ?><tr><td class="td-mono"><?= $esc(substr((string) $r['install_id'], 0, 12)) ?>…</td><td><?= $esc($r['players']) ?></td></tr><?php endforeach; ?>
    <?php if ($sg['sharedDevices'] === []): ?><tr><td colspan="2" class="no-results">None.</td></tr><?php endif; ?>
  </tbody></table></div>

<?php elseif ($tab === 'winner'): ?>
  <?php
  $st = Contest::standings($season);
  $season = Contest::season($season['id']) ?? $season;
  $phase = Contest::phase($season);
  $leader = $st['final'][0] ?? null;
  $winnerName = null;
  if ($season['winner_user_id']) { $s2 = $pdo->prepare("SELECT username FROM users WHERE id = ?"); $s2->execute([$season['winner_user_id']]); $winnerName = $s2->fetchColumn(); }
  $flag = static function (string $field, string $label) use ($season, $esc): void {
      $at = $season[$field]; ?>
      <form method="post" class="ls-inline" onsubmit="return confirm('<?= $at ? 'Clear' : 'Mark' ?>: <?= $esc($label) ?>?')"><?= csrf_input() ?><input type="hidden" name="do" value="winner"><input type="hidden" name="field" value="<?= $field ?>"><input type="hidden" name="on" value="<?= $at ? '' : '1' ?>">
        <button class="btn <?= $at ? 'btn-primary' : 'btn-secondary' ?> btn-sm"><?= $at ? '✓ ' : '' ?><?= $esc($label) ?><?= $at ? ' · ' . $esc(substr((string) $at, 0, 10)) : '' ?></button></form>
  <?php }; ?>
  <div class="form-card" style="max-width:none">
    <p><?= in_array($phase, ['over', 'ended'], true) ? 'Final ranking (the season is over):' : 'Current leader (not final yet, phase: ' . $esc($phase) . '):' ?>
      <strong><?= $leader ? $who($st['rows'][$leader]) . ' · ' . $st['rows'][$leader]['finalPoints'] . ' pts' : '—' ?></strong></p>
    <p>Winner: <strong><?= $winnerName ? '@' . $esc($winnerName) : 'not set' ?></strong>
      <?php if ($leader): ?>
        <form method="post" class="ls-inline" onsubmit="return confirm('Set the winner to the #1 of the final ranking?')"><?= csrf_input() ?><input type="hidden" name="do" value="winner"><input type="hidden" name="field" value="winner_user_id"><input type="hidden" name="user" value="<?= $esc($leader) ?>"><button class="btn btn-secondary btn-sm">Set #1 as the winner</button></form>
      <?php endif; ?>
    </p>
    <div class="toolbar" style="gap:8px"><?php $flag('winner_contacted_at', 'Winner contacted'); $flag('winner_confirmed_at', 'Winner confirmed'); $flag('prize_sent_at', 'Prize sent'); ?></div>
  </div>
  <h2 style="font-size:15px;color:#fff">Exports</h2>
  <p><a class="btn btn-secondary btn-sm" href="/admin/launch-season/export?season=<?= $sid ?>&amp;what=ranking">⬇ Ranking CSV</a>
     <span class="ls-muted">Ranks, points breakdown, days, photos (no personal data).</span></p>
  <form method="post" action="/admin/launch-season/export?season=<?= $sid ?>&amp;what=participants" class="ls-inline" style="margin-top:8px">
    <?= csrf_input() ?><input type="password" name="password" placeholder="Admin password" required autocomplete="current-password" style="background:#1a1a1a;border:1px solid #2a2a2a;color:#eee;padding:4px 6px;border-radius:4px">
    <button class="btn btn-danger btn-sm">⬇ Participants CSV (personal data)</button>
  </form>
  <p class="ls-muted">Emails, country, 18+, join date, rules version, inviter. GDPR data: asks the admin password again and every download is logged.</p>

<?php elseif ($tab === 'rules'): ?>
  <?php
  $stmt = $pdo->prepare("SELECT * FROM contest_rules WHERE season_id = ? ORDER BY locale = 'en' DESC, locale");
  $stmt->execute([$season['id']]);
  $rules = $stmt->fetchAll(PDO::FETCH_ASSOC);
  $locale = (string) ($_GET['locale'] ?? ($rules[0]['locale'] ?? 'en'));
  $cur = null; foreach ($rules as $r) if ($r['locale'] === $locale) $cur = $r;
  $public = 'https://hilads.live' . ($locale !== 'en' ? '/' . $locale : '') . '/launch-season/rules' . ($season['is_test'] ? '?season=' . $season['id'] : '');
  ?>
  <p class="ls-muted">Markdown (# title, ## heading, - list, **bold**). The English text is the reference: joiners accept its version. Other locales fall back to English until added.
    Public page: <a href="<?= $esc($public) ?>" target="_blank"><?= $esc($public) ?></a></p>
  <div class="toolbar" style="gap:6px">
    <?php foreach ($rules as $r): ?><a class="btn btn-sm <?= $r['locale'] === $locale ? 'btn-primary' : 'btn-secondary' ?>" href="<?= $esc($url('rules', ['locale' => $r['locale']])) ?>"><?= $esc($r['locale']) ?> v<?= (int) $r['version'] ?><?= DailyProofRepository::bool($r['is_final']) ? ' ✓' : ' · draft' ?></a><?php endforeach; ?>
    <form method="get" class="ls-inline"><input type="hidden" name="tab" value="rules"><input type="hidden" name="season" value="<?= $sid ?>"><input type="text" name="locale" placeholder="Add a locale: fr, vi…" style="width:150px"><button class="btn btn-secondary btn-sm">Add</button></form>
  </div>
  <form method="post" class="form-card" style="max-width:none">
    <?= csrf_input() ?><input type="hidden" name="do" value="rules"><input type="hidden" name="locale" value="<?= $esc($locale) ?>">
    <div class="form-group"><label>Rules · <?= $esc($locale) ?><?= $cur ? ' · v' . (int) $cur['version'] . ' · ' . $esc(substr((string) $cur['updated_at'], 0, 16)) : ' · new' ?></label>
      <textarea name="body" rows="26" style="font-family:ui-monospace,monospace;font-size:13px"><?= $esc($cur['body'] ?? ($locale === 'en' ? Contest::placeholderRules($season) : ($rules[0]['body'] ?? ''))) ?></textarea></div>
    <p><label><input type="checkbox" name="is_final" value="1"<?= $cur && DailyProofRepository::bool($cur['is_final']) ? ' checked' : '' ?>> Final (removes the “DRAFT - not final” banner on the public page)</label></p>
    <div class="form-actions"><button class="btn btn-primary">Save rules</button></div>
  </form>

<?php elseif ($tab === 'log'): ?>
  <?php
  $stmt = $pdo->prepare("SELECT * FROM contest_admin_log WHERE season_id = ? ORDER BY id DESC LIMIT 300");
  $stmt->execute([$season['id']]);
  ?>
  <div class="table-wrapper"><table><thead><tr><th>When</th><th>Action</th><th>Target</th><th>Detail</th></tr></thead><tbody>
    <?php foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $l): ?>
      <tr><td class="ls-muted"><?= $esc(date('Y-m-d H:i', strtotime((string) $l['created_at']))) ?></td><td><?= $esc($l['action']) ?></td><td class="td-mono"><?= $esc($l['target']) ?></td><td class="td-mono td-clip"><?= $esc($l['detail']) ?></td></tr>
    <?php endforeach; ?>
  </tbody></table></div>
<?php endif; ?>
</main>
<?php admin_foot(); ?>
