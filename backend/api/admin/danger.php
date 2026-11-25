<?php

declare(strict_types=1);

// System › Danger zone (super admins only): the heavy, game-wide actions. Each one says exactly
// what it will touch (counted now), asks for a typed phrase (checked again on the server) and
// is written to the audit log with the counts before and after.

admin_require_login();
admin_require_super();

$pdo = Database::pdo();
$e = fn ($s) => htmlspecialchars((string) $s, ENT_QUOTES);
$n = fn ($v) => number_format((int) $v);
$q = function (string $sql) use ($pdo) { try { return $pdo->query($sql)->fetchColumn(); } catch (\Throwable) { return 0; } };

$ledger   = (int) $q("SELECT count(*) FROM score_events");
$scorers  = (int) $q("SELECT count(*) FROM users WHERE deleted_at IS NULL AND (score_alltime > 0 OR score_month > 0)");
$top      = $pdo->query("SELECT display_name, score_alltime FROM users WHERE deleted_at IS NULL AND score_alltime > 0 ORDER BY score_alltime DESC LIMIT 1")->fetch(\PDO::FETCH_ASSOC) ?: null;
$seasons  = (int) $q("SELECT CASE WHEN to_regclass('season_results') IS NULL THEN 0 ELSE (SELECT count(*) FROM season_results) END");
$today    = DailyChallengeRepository::findPublishedByDate(DailyClock::currentDate());
$todayPts = $today ? (int) $q("SELECT count(DISTINCT user_id) FROM score_events WHERE daily_challenge_id = " . $pdo->quote($today['id'])) : 0;
$cities   = (int) $q("SELECT count(DISTINCT channel_id) FROM user_city_memberships");
$thumbs   = (int) $q("SELECT count(*) FROM users WHERE deleted_at IS NULL AND profile_photo_url IS NOT NULL AND profile_thumb_photo_url IS NULL");

/** A danger card: title, what it touches, the phrase, the form fields. */
$card = function (string $id, string $title, string $what, array $affects, string $phrase, string $action, string $button, string $extra = '', bool $disabled = false) use ($e): void {
    echo '<section class="card danger-card" id="' . $id . '"><div class="card-head"><h2>' . $e($title) . '</h2></div><div class="card-body">';
    echo '<p class="muted" style="margin-bottom:8px">' . $what . '</p><ul class="affects">';
    foreach ($affects as $a) echo '<li>' . $a . '</li>';
    echo '</ul>';
    echo '<form method="POST" action="' . $e($action) . '">' . csrf_input() . '<input type="hidden" name="back" value="danger">' . $extra;
    echo '<div class="field" style="max-width:420px;margin-top:6px"><label for="p-' . $id . '">Type <span class="phrase">' . $e($phrase) . '</span> to confirm</label>'
       . '<input id="p-' . $id . '" name="confirm_phrase" autocomplete="off" spellcheck="false" data-phrase="' . $e($phrase) . '" data-phrase-for="b-' . $id . '"' . ($disabled ? ' disabled' : '') . '></div>';
    echo '<button class="btn btn-danger-solid" id="b-' . $id . '" type="submit" disabled>' . $e($button) . '</button>';
    echo '</form></div></section>';
};

admin_head('Danger zone');
admin_nav('/admin/danger');
?>
<div class="admin-main" style="max-width:900px">
    <div class="page-head">
        <div>
            <div class="crumbs">System ›</div>
            <h1 class="page-title">Danger zone</h1>
            <p class="sub">Actions that change the whole game at once. Super admins only. Each one needs its phrase typed, and lands in the
                <a href="/admin/audit">audit log</a> under your name.</p>
        </div>
    </div>
    <?= flash_html() ?>

    <?php
    $card('reset', 'Reset all scores to 0',
        'Every player goes back to 0 points and every ranking starts empty (they refresh within a minute). Photos, likes, streaks, stamps, invitations and ratings stay. <b>Can\'t be undone.</b>',
        [
            '<b>' . $n($ledger) . '</b> lines of points history deleted',
            '<b>' . $n($scorers) . '</b> players back to 0 points' . ($top ? ' (top today: ' . $e($top['display_name']) . ', ' . $n($top['score_alltime']) . ' pts)' : ''),
            'Monthly ranks cleared for every city and the world',
        ],
        'RESET ALL SCORES', '/admin/scores/reset-all', 'Reset all scores',
        '<label class="check" style="margin:4px 0"><input type="checkbox" name="keep_today" value="1"' . ($today ? '' : ' disabled') . '> Keep the points of today\'s challenge'
        . ($today ? ' (' . $n($todayPts) . ' players already played today)' : ' (no challenge published today)') . '</label>'
        . '<label class="check" style="margin:4px 0 8px"><input type="checkbox" name="with_seasons" value="1"> Also delete past season results and medals (' . $n($seasons) . ' results)</label>',
        $ledger === 0 && $scorers === 0);

    $card('ranks', 'Recalculate every rank',
        'Rebuilds the monthly rank of every player in every city and the world from the points history. Safe to repeat; ranks only change where they had drifted. Takes a few seconds.',
        ['Monthly ranks of about <b>' . $n($cities) . '</b> cities + the world'],
        'RECALCULATE', '/admin/ranks/recalc-all', 'Recalculate ranks');

    $card('thumbs', 'Make missing profile thumbnails',
        'Makes the small version of profile photos uploaded before thumbnails existed (each card otherwise loads the full photo). 20 players per run: run again until none are left.',
        ['<b>' . $n($thumbs) . '</b> players without a thumbnail', 'Writes new files to storage, never deletes one'],
        'BACKFILL', '/admin/thumbs/backfill', 'Make 20 thumbnails', '', $thumbs === 0);
    ?>

    <section class="card danger-card">
        <div class="card-head"><h2>Places migration</h2></div>
        <div class="card-body">
            <p class="muted" style="margin-bottom:10px">Turns old pinned photos into spots and deletes the old Google venues for good. Opens a dry run first: nothing changes until you apply it there.</p>
            <a class="btn btn-danger" href="/admin/daily/spots/migration">Open the dry run</a>
        </div>
    </section>

    <section class="card card-pad">
        <h2 style="margin-bottom:8px">Also protected, on their own page</h2>
        <ul class="affects" style="margin:0">
            <li><a href="/admin/cities">Merge two cities</a>: super admins, type the city name</li>
            <li><a href="/admin/email">Email every registered user</a>: type the phrase, once a day at most</li>
            <li><a href="/admin/app-versions">Block old apps</a>: type the phrase when turning it on</li>
            <li><a href="/admin/daily/import">Daily import that replaces unplayed days</a>: type REPLACE</li>
        </ul>
    </section>
</div>
<?php
admin_foot();
