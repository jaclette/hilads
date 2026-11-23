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
$back = ($_POST['back'] ?? '') === 'scoring' ? '/admin/scoring' : '/admin';
// Admin › Scoring asks to type RESET (the dashboard keeps its confirm dialog).
if ($back === '/admin/scoring' && trim((string) ($_POST['confirm_text'] ?? '')) !== 'RESET') {
    flash_set('error', 'Type RESET to confirm - nothing was changed.');
    admin_redirect($back);
}
$withSeasons = !empty($_POST['with_seasons']);
$seasons = 0;

try {
    $pdo->beginTransaction();

    $deleted = $pdo->exec("DELETE FROM score_events");
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

error_log("[admin-scores-reset] wiped {$deleted} score_events + reset all user aggregates" . ($withSeasons ? " + {$seasons} season results" : ''));
flash_set('success', "All scores reset to 0. Deleted {$deleted} score events" . ($withSeasons ? " and {$seasons} season results" : '') . '.');
admin_redirect($back);
