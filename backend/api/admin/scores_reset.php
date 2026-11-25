<?php

declare(strict_types=1);

admin_require_login();
csrf_verify();

// PR51 - wipe every user's points back to zero.
//
// Three side-effects, run as a single transaction so the system is
// never observed half-reset:
//   1. DELETE FROM score_events - the ledger goes empty.
//   2. UPDATE users SET score_alltime=0, score_month=0,
//        score_month_ref=NULL - the cached aggregates the leaderboard
//        + ranks queries read off (the score_events sync trigger only
//        fires on INSERT, not DELETE, so the cached values would stay
//        stale without a manual UPDATE).
//   3. UPDATE users SET score_celebrated_at = now() - bump the
//        celebration watermark so the next score_event a user earns
//        triggers a fresh popin (otherwise nothing notable until they
//        next earn enough to clear the old delta).
//
// challenge_ratings rows are KEPT - they're user-generated content
// (stars + comments) and have value beyond the points they produce.
// The mutual-rating trigger won't re-fire because the score_events
// UNIQUE constraint is on (user_id, challenge_id, role, kind) - empty
// now, but the next rating insert would race with an existing rating
// pair and we'd only get the debrief event if a fresh rating arrived.

$pdo  = Database::pdo();
// Only from System › Danger zone, super admins, with the phrase typed (checked here, not only in the page).
$back = '/admin/danger';
admin_require_super($back);
admin_require_phrase('RESET ALL SCORES', $back);
$before = [
    'score_events' => (int) $pdo->query("SELECT count(*) FROM score_events")->fetchColumn(),
    'players_with_points' => (int) $pdo->query("SELECT count(*) FROM users WHERE score_alltime > 0 OR score_month > 0")->fetchColumn(),
];
$withSeasons = !empty($_POST['with_seasons']);
$seasons = 0;
// Keep the points earned on today's challenge under the v2 rules (players who already played
// today keep their +10, tonight's close adds the podium); everything else goes.
$keepToday = !empty($_POST['keep_today']);
$kept = 0;
$todayChallenge = $keepToday ? DailyChallengeRepository::findPublishedByDate(DailyClock::currentDate()) : null;
if ($keepToday && $todayChallenge === null) {
    flash_set('error', "No published challenge today - nothing was changed.");
    admin_redirect($back);
}

try {
    $pdo->beginTransaction();

    if ($todayChallenge !== null) {
        $kinds = Scoring::config()['season_kinds'];
        $in    = implode(',', array_fill(0, count($kinds), '?'));
        $del   = $pdo->prepare("DELETE FROM score_events WHERE NOT (daily_challenge_id IS NOT DISTINCT FROM ? AND kind IN ({$in}))");
        $del->execute([$todayChallenge['id'], ...$kinds]);
        $deleted = $del->rowCount();
    } else {
        $deleted = $pdo->exec("DELETE FROM score_events");
    }
    $pdo->exec("
        UPDATE users
           SET score_alltime    = 0,
               score_month      = 0,
               score_month_ref  = NULL,
               score_celebrated_at = now()
         WHERE score_alltime > 0
            OR score_month   > 0
            OR score_month_ref IS NOT NULL
    ");
    // The score wipe leaves monthly_rank_* dangling on every user that
    // had a rank - clear them in the same transaction so the badge
    // surface stays consistent with the cleared ledger.
    MonthlyRankService::clearAll($pdo);
    // The kept rows (today's challenge): the cached totals from the ledger again.
    if ($todayChallenge !== null) {
        $kept = (int) $pdo->exec("
            UPDATE users u SET score_alltime = t.pts, score_month = t.month_pts, score_month_ref = t.month_ref
            FROM (SELECT user_id, sum(points) AS pts,
                         coalesce(sum(points) FILTER (WHERE month_ref = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM')), 0) AS month_pts,
                         to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM') AS month_ref
                  FROM score_events GROUP BY user_id) t
            WHERE u.id = t.user_id
        ");
    }
    // Scoring v2: past season results and medals go too when asked (seasons are frozen
    // again at the next month's end).
    if ($withSeasons && (int) $pdo->query("SELECT count(*) FROM pg_tables WHERE tablename = 'season_results'")->fetchColumn() > 0) {
        $seasons = (int) $pdo->exec("DELETE FROM season_results");
        $pdo->exec("DELETE FROM seasons");
    }

    $pdo->commit();
} catch (\Throwable $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    error_log('[admin-scores-reset] failed: ' . $e->getMessage());
    flash_set('error', 'Reset failed - check logs.');
    admin_redirect($back);
}

if ($todayChallenge !== null) {
    try { MonthlyRankService::recalcAll(); } catch (\Throwable) { /* ranks refresh on the next score change */ }
}
AdminAuth::log('scores.reset_all', 'scores', null, $before, [
    'deleted_score_events' => $deleted, 'kept_today_players' => $kept, 'season_results_deleted' => $seasons,
    'keep_today' => $todayChallenge !== null, 'with_seasons' => $withSeasons,
]);
error_log("[admin-scores-reset] wiped {$deleted} score_events + reset all user aggregates" . ($withSeasons ? " + {$seasons} season results" : '')
          . ($todayChallenge !== null ? " (kept today's points for {$kept} players)" : ''));
flash_set('success', "All scores reset to 0. Deleted {$deleted} score events" . ($withSeasons ? " and {$seasons} season results" : '')
          . ($todayChallenge !== null ? ", kept today's challenge points for {$kept} player(s)" : '') . '.');
admin_redirect($back);
