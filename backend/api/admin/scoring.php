<?php

declare(strict_types=1);

admin_require_login();

// Admin › Scoring (scoring v2, P0): read-only. The 30-day before / after simulation,
// what each fair-play switch would change on the same days, and the fair-play report.
// Writes nothing. docs/scoring-v2-audit.md.

$days = max(7, min(90, (int) ($_GET['days'] ?? 30)));
$esc  = static fn($v): string => htmlspecialchars((string) $v, ENT_QUOTES);
$minPhotos = [3, 5, 10, 20];

try {
    $sim  = ScoringReport::simulate($days, $minPhotos);
    $fair = ScoringReport::fairPlay($days);
} catch (\Throwable $e) {
    error_log('[admin-scoring] ' . $e->getMessage());
    admin_head('Scoring');
    admin_nav('/admin/scoring');
    echo '<main class="admin-main"><h1 class="page-title">Scoring</h1><p>Report failed: ' . $esc($e->getMessage()) . '</p></main>';
    admin_foot();
    return;
}
$rows = $sim['players'];

if (($_GET['csv'] ?? '') === '1') {
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="scoring-v2-simulation-' . $sim['window'][1] . '.csv"');
    $out = fopen('php://output', 'w');
    $head = ['username', 'user_id', 'hidden', 'old_rank', 'old', 'old_photo', 'old_vote', 'old_top', 'old_other',
             'new_rank', 'new', 'photos', 'podiums', 'top_points', 'perfect_weeks', 'new_vote_requires_play'];
    foreach ($minPhotos as $n) $head[] = 'new_podium_min_photos_' . $n;
    fputcsv($out, $head);
    foreach ($rows as $r) {
        $line = [$r['username'], $r['user_id'], $r['hidden'] ? 1 : 0, $r['old_rank'], $r['old'], $r['old_photo'], $r['old_vote'],
                 $r['old_top'], $r['old_other'], $r['new_rank'], $r['new'], $r['photos'], $r['podiums'], $r['top_points'],
                 $r['weeks'], $r['new_play']];
        foreach ($minPhotos as $n) $line[] = $r['new_min_photos'][$n];
        fputcsv($out, $line);
    }
    fclose($out);
    return;
}

$cfg     = Scoring::config();
$ranked  = array_values(array_filter($rows, static fn(array $r): bool => !$r['hidden']));
$byOld   = $ranked;
usort($byOld, static fn(array $a, array $b): int => [$a['old_rank'] ?? PHP_INT_MAX, $a['username']] <=> [$b['old_rank'] ?? PHP_INT_MAX, $b['username']]);
$byNew   = $ranked;
usort($byNew, static fn(array $a, array $b): int => [$a['new_rank'] ?? PHP_INT_MAX, $a['username']] <=> [$b['new_rank'] ?? PHP_INT_MAX, $b['username']]);
$sum     = static fn(string $k): int => array_sum(array_column($ranked, $k));
$move    = static function (array $r): string {
    if ($r['old_rank'] === null || $r['new_rank'] === null) return $r['new_rank'] === null ? '—' : 'new';
    $d = $r['old_rank'] - $r['new_rank'];
    return $d === 0 ? '=' : ($d > 0 ? '▲' . $d : '▼' . -$d);
};

admin_head('Scoring');
admin_nav('/admin/scoring');
?>
<style>
  .sc-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 28px; }
  .sc-h2 { font-size: 15px; font-weight: 600; color: var(--text); margin: 28px 0 10px; }
  .sc-note { color: var(--faint); font-size: 12px; margin-bottom: 12px; max-width: 900px; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .up { color: var(--ok); } .down { color: var(--bad); }
  .pill { display: inline-block; padding: 1px 7px; border-radius: 9px; background: var(--surface-2); color: var(--muted); font-size: 11px; }
  @media (max-width: 900px) { .sc-grid { grid-template-columns: 1fr; } }
</style>
<main class="admin-main">
  <?= flash_html() ?>
  <h1 class="page-title">Scoring v2 — simulation and fair play</h1>
  <?php
    $since    = Scoring::since();
    $minNow   = (int) Scoring::switch('podium_min_photos');
    $playNow  = (bool) Scoring::switch('vote_requires_play');
    $seasonNow = Scoring::season(DailyClock::currentDate());
  ?>
  <div class="stats-row">
    <div class="stat-card"><div class="stat-value" style="font-size:18px"><?= $since !== null ? 'Live since ' . $esc($since) : 'Not live' ?></div><div class="stat-label">v2 rules<?= $since === null ? ' (run php migrate.php)' : '' ?></div></div>
    <div class="stat-card"><div class="stat-value" style="font-size:18px"><?= $esc($seasonNow['key']) ?><?= $seasonNow['pre'] ? ' (pre-season)' : '' ?></div><div class="stat-label">Season, ends <?= $esc($seasonNow['endsAt']) ?> · <?= (int) $seasonNow['daysLeft'] ?> days left</div></div>
  </div>

  <h2 class="sc-h2">Fair-play switches</h2>
  <form method="post" action="/admin/scoring" class="toolbar" style="gap:16px">
    <?= csrf_input() ?>
    <label>Minimum photos worldwide for a full podium
      <input type="number" name="podium_min_photos" min="0" max="1000" value="<?= $minNow ?>" style="width:80px;background:var(--surface);border:1px solid var(--line);color:var(--text);padding:6px;border-radius:6px">
      <span class="sc-note">(0 = off; below it only 🥇 is paid)</span></label>
    <label><input type="checkbox" name="vote_requires_play" value="1"<?= $playNow ? ' checked' : '' ?>> Play to like (only players who posted the day's photo can like it)</label>
    <button class="btn btn-primary btn-sm" type="submit">Save switches</button>
  </form>

  <p class="sc-note">
    Read-only: nothing is changed. Last <?= $days ?> closed challenges
    (<?= $esc($sim['window'][0]) ?> → <?= $esc($sim['window'][1]) ?>, <?= (int) $sim['days'] ?> published).
    <b>Old</b> = the points actually awarded on those challenges. <b>New</b> = v2:
    photo +<?= Scoring::points('daily_proof') ?>, podium +<?= Scoring::points('daily_top1') ?> / +<?= Scoring::points('daily_top2') ?> / +<?= Scoring::points('daily_top3') ?>
    (likes, then posted first; admin and review accounts excluded), Perfect week +<?= Scoring::points('perfect_week') ?>
    (every published challenge of a Mon–Sun week, counted for the weeks ending in the window), no vote points.
    Invites are 0 (never tracked before). Values from <code>config/scoring.php</code>.
  </p>
  <form class="toolbar" method="get">
    <select name="days" onchange="this.form.submit()">
      <?php foreach ([14, 30, 60, 90] as $d): ?>
        <option value="<?= $d ?>"<?= $d === $days ? ' selected' : '' ?>>Last <?= $d ?> days</option>
      <?php endforeach; ?>
    </select>
    <a class="btn btn-secondary btn-sm" href="/admin/scoring?days=<?= $days ?>&csv=1">Export CSV</a>
  </form>

  <div class="stats-row">
    <div class="stat-card"><div class="stat-value"><?= count($ranked) ?></div><div class="stat-label">Active players</div></div>
    <div class="stat-card"><div class="stat-value"><?= number_format($sum('old')) ?></div><div class="stat-label">Points, old rules</div></div>
    <div class="stat-card"><div class="stat-value"><?= number_format($sum('old_vote')) ?></div><div class="stat-label">of which votes</div></div>
    <div class="stat-card"><div class="stat-value"><?= number_format($sum('new')) ?></div><div class="stat-label">Points, v2</div></div>
    <div class="stat-card"><div class="stat-value"><?= number_format($sum('weeks')) ?></div><div class="stat-label">Perfect weeks</div></div>
  </div>

  <div class="sc-grid">
    <?php foreach (['Top 10, old rules' => [$byOld, 'old_rank', 'old'], 'Top 10, v2' => [$byNew, 'new_rank', 'new']] as $title => [$list, $rk, $pk]): ?>
      <div>
        <h2 class="sc-h2"><?= $esc($title) ?></h2>
        <div class="table-wrapper"><table>
          <thead><tr><th>#</th><th>Player</th><th class="num">Points</th><th class="num">Photos</th><th class="num">Podiums</th><th class="num">Weeks</th><th class="num">Votes (old)</th><?= $pk === 'new' ? '<th class="num">Move</th>' : '' ?></tr></thead>
          <tbody>
          <?php foreach (array_slice(array_filter($list, static fn(array $r): bool => $r[$rk] !== null), 0, 10) as $r): $m = $move($r); ?>
            <tr>
              <td><?= (int) $r[$rk] ?></td>
              <td><a href="/admin/users?q=<?= urlencode((string) $r['username']) ?>">@<?= $esc($r['username']) ?></a></td>
              <td class="num"><b><?= (int) $r[$pk] ?></b></td>
              <td class="num"><?= (int) $r['photos'] ?></td>
              <td class="num"><?= (int) $r['podiums'] ?></td>
              <td class="num"><?= (int) $r['weeks'] ?></td>
              <td class="num"><?= (int) $r['old_vote'] ?></td>
              <?php if ($pk === 'new'): ?><td class="num <?= str_starts_with($m, '▲') ? 'up' : (str_starts_with($m, '▼') ? 'down' : '') ?>"><?= $esc($m) ?></td><?php endif; ?>
            </tr>
          <?php endforeach; ?>
          </tbody>
        </table></div>
      </div>
    <?php endforeach; ?>
  </div>

  <h2 class="sc-h2">Fair-play switches — impact on these <?= $days ?> days (both off)</h2>
  <p class="sc-note">
    <b>vote_requires_play</b> (only players who posted the day's photo can like it): replayed by keeping only the likes from
    people with an approved photo that day. Real behaviour would shift (people would post to like), so read it as an upper bound.
  </p>
  <?php $lk = $sim['switches']['play']['likes']; ?>
  <div class="stats-row">
    <div class="stat-card"><div class="stat-value"><?= (int) ($lk['non_players'] ?? 0) ?> / <?= (int) ($lk['likes'] ?? 0) ?></div><div class="stat-label">Likes from non-players</div></div>
    <div class="stat-card"><div class="stat-value"><?= (int) ($lk['non_player_voters'] ?? 0) ?> / <?= (int) ($lk['voters'] ?? 0) ?></div><div class="stat-label">Likers who hadn't played</div></div>
    <div class="stat-card"><div class="stat-value"><?= (int) $sim['switches']['play']['podiums_changed'] ?> / <?= (int) $sim['switches']['play']['days'] ?></div><div class="stat-label">Podiums that change</div></div>
    <div class="stat-card"><div class="stat-value"><?= (int) $sim['switches']['play']['players'] ?></div><div class="stat-label">Players whose points change</div></div>
  </div>
  <p class="sc-note"><b>podium_min_photos = N</b> (fewer than N photos worldwide that day → only 🥇 is paid):</p>
  <div class="table-wrapper" style="max-width:640px"><table>
    <thead><tr><th>N</th><th class="num">Days paying only 🥇</th><th class="num">Points not given</th><th class="num">Players losing points</th></tr></thead>
    <tbody>
    <?php foreach ($sim['switches']['min_photos'] as $n => $s): ?>
      <tr><td><?= (int) $n ?></td><td class="num"><?= (int) $s['days'] ?> / <?= (int) $sim['days'] ?></td><td class="num"><?= (int) $s['points'] ?></td><td class="num"><?= (int) ($s['players'] ?? 0) ?></td></tr>
    <?php endforeach; ?>
    </tbody>
  </table></div>

  <h2 class="sc-h2">Every active player</h2>
  <div class="table-wrapper"><table>
    <thead><tr><th>Player</th><th class="num">Old #</th><th class="num">Old</th><th class="num">photo</th><th class="num">vote</th><th class="num">top</th><th class="num">other</th>
      <th class="num">New #</th><th class="num">New</th><th class="num">Photos</th><th class="num">Podiums</th><th class="num">Weeks</th><th class="num">Δ</th>
      <th class="num">play-to-like</th><?php foreach ($minPhotos as $n): ?><th class="num">min <?= $n ?></th><?php endforeach; ?></tr></thead>
    <tbody>
    <?php foreach ($rows as $r): $d = $r['new'] - $r['old']; ?>
      <tr>
        <td>@<?= $esc($r['username']) ?><?= $r['hidden'] ? ' <span class="pill">hidden</span>' : '' ?></td>
        <td class="num"><?= $r['old_rank'] ?? '—' ?></td><td class="num"><?= (int) $r['old'] ?></td>
        <td class="num"><?= (int) $r['old_photo'] ?></td><td class="num"><?= (int) $r['old_vote'] ?></td><td class="num"><?= (int) $r['old_top'] ?></td><td class="num"><?= (int) $r['old_other'] ?></td>
        <td class="num"><?= $r['new_rank'] ?? '—' ?></td><td class="num"><b><?= (int) $r['new'] ?></b></td>
        <td class="num"><?= (int) $r['photos'] ?></td><td class="num"><?= (int) $r['podiums'] ?></td><td class="num"><?= (int) $r['weeks'] ?></td>
        <td class="num <?= $d > 0 ? 'up' : ($d < 0 ? 'down' : '') ?>"><?= $d > 0 ? '+' . $d : $d ?></td>
        <td class="num"><?= (int) $r['new_play'] ?></td>
        <?php foreach ($minPhotos as $n): ?><td class="num"><?= (int) $r['new_min_photos'][$n] ?></td><?php endforeach; ?>
      </tr>
    <?php endforeach; ?>
    </tbody>
  </table></div>

  <h2 class="sc-h2" id="fair-play">Fair play — to check by hand (nothing is blocked)</h2>
  <p class="sc-note">Devices: the app's install id (X-Install-Id) and hashed networks are recorded from the invites release on; older accounts show up once they open the app.</p>

  <h3 class="sc-h2" style="font-size:13px">Several accounts on one device (same guest id)</h3>
  <?php if ($fair['shared_device'] === []): ?><p class="sc-note">None.</p><?php else: ?>
  <div class="table-wrapper"><table><thead><tr><th>Accounts</th><th>Usernames</th><th>First</th><th>Last</th><th>Guest id</th></tr></thead><tbody>
    <?php foreach ($fair['shared_device'] as $r): ?>
      <tr><td class="num"><?= (int) $r['accounts'] ?></td><td><?= $esc($r['usernames']) ?></td><td><?= $esc(substr((string) $r['first'], 0, 16)) ?></td><td><?= $esc(substr((string) $r['last'], 0, 16)) ?></td><td class="td-mono"><?= $esc(substr((string) $r['guest_id'], 0, 12)) ?>…</td></tr>
    <?php endforeach; ?>
  </tbody></table></div><?php endif; ?>

  <?php foreach ([
      'installs' => ['Several accounts on one install (same phone)', ['accounts' => 'Accounts', 'usernames' => 'Usernames']],
      'networks' => ['Many accounts on one network (3+, last 30 days)', ['accounts' => 'Accounts', 'usernames' => 'Usernames']],
      'invite_bursts' => ['Invite bursts (3+ friends signing up within an hour)', ['inviter' => 'Inviter', 'hour' => 'Hour', 'signups' => 'Signups', 'friends' => 'Friends']],
      'invites_by_ip' => ['Invites credited by network only (no code: the same-IP fallback)', ['inviter' => 'Inviter', 'friend' => 'Friend', 'day' => 'Day']],
  ] as $k => [$title, $cols]): ?>
  <h3 class="sc-h2" style="font-size:13px"><?= $esc($title) ?></h3>
  <?php if (($fair[$k] ?? []) === []): ?><p class="sc-note">None.</p><?php else: ?>
  <div class="table-wrapper"><table><thead><tr><?php foreach ($cols as $c): ?><th><?= $esc($c) ?></th><?php endforeach; ?></tr></thead><tbody>
    <?php foreach ($fair[$k] as $r): ?><tr><?php foreach (array_keys($cols) as $c): ?><td><?= $esc($r[$c] ?? '') ?></td><?php endforeach; ?></tr><?php endforeach; ?>
  </tbody></table></div><?php endif; ?>
  <?php endforeach; ?>

  <h3 class="sc-h2" style="font-size:13px">Likers who mostly like one player (≥ 5 likes, ≥ 80 % to one)</h3>
  <?php if ($fair['one_fan'] === []): ?><p class="sc-note">None.</p><?php else: ?>
  <div class="table-wrapper"><table><thead><tr><th>Liker</th><th>Likes mostly</th><th class="num">Likes to them</th><th class="num">All likes</th><th class="num">Share</th><th>Liker since</th></tr></thead><tbody>
    <?php foreach ($fair['one_fan'] as $r): ?>
      <tr><td>@<?= $esc($r['voter']) ?></td><td>@<?= $esc($r['author']) ?></td><td class="num"><?= (int) $r['likes'] ?></td><td class="num"><?= (int) $r['total'] ?></td><td class="num"><?= (int) $r['share'] ?> %</td><td><?= $esc(substr((string) $r['voter_since'], 0, 10)) ?></td></tr>
    <?php endforeach; ?>
  </tbody></table></div><?php endif; ?>

  <h3 class="sc-h2" style="font-size:13px">Podium points given to admin / review accounts (v2 excludes them)</h3>
  <?php if ($fair['hidden_podium'] === []): ?><p class="sc-note">None.</p><?php else: ?>
  <div class="table-wrapper"><table><thead><tr><th>Date</th><th>Account</th><th>Kind</th><th class="num">Points</th></tr></thead><tbody>
    <?php foreach ($fair['hidden_podium'] as $r): ?>
      <tr><td><?= $esc($r['date']) ?></td><td>@<?= $esc($r['username']) ?></td><td><?= $esc($r['kind']) ?></td><td class="num"><?= (int) $r['points'] ?></td></tr>
    <?php endforeach; ?>
  </tbody></table></div><?php endif; ?>

  <h3 class="sc-h2" style="font-size:13px">Heavy voters (liked ≥ 80 % of a city's photos)</h3>
  <?php if ($fair['heavy_voters'] === []): ?><p class="sc-note">None.</p><?php else: ?>
  <div class="table-wrapper"><table><thead><tr><th>Player</th><th class="num">Days flagged</th><th class="num">Highest share</th><th>Last</th></tr></thead><tbody>
    <?php foreach ($fair['heavy_voters'] as $r): ?>
      <tr><td>@<?= $esc($r['username']) ?></td><td class="num"><?= (int) $r['days'] ?></td><td class="num"><?= (int) $r['max_share'] ?> %</td><td><?= $esc($r['last_date']) ?></td></tr>
    <?php endforeach; ?>
  </tbody></table></div><?php endif; ?>

  <div class="callout warn" style="margin-top:32px;max-width:900px">
    Resetting every player's points now lives in <a href="/admin/danger">System › Danger zone</a> (super admins, typed confirmation).
  </div>
</main>
<?php
admin_foot();
