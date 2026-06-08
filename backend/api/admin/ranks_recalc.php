<?php

declare(strict_types=1);

admin_require_login();
csrf_verify();

// Manual rank recalc — exposed because the route-level recalc hooks
// only fire on score-changing actions (rate / approve / accept / etc).
// If a user's monthly_rank_* column drifts (cold path inserted a
// score_event without triggering a hook, or a backfill bypassed PHP),
// the badge surface goes silent until the next action. This endpoint
// forces a fresh recalc for every city + worldwide so the columns
// match the live leaderboard.
//
// Safe to call repeatedly — the recalc UPDATE only writes rows where
// the new rank differs from the old, so back-to-back hits are no-ops.

try {
    $summary = MonthlyRankService::recalcAll();
} catch (\Throwable $e) {
    error_log('[admin-ranks-recalc] failed: ' . $e->getMessage());
    flash_set('error', 'Recalc failed - check logs.');
    admin_redirect('/admin');
}

flash_set('success', sprintf(
    'Ranks recalculated: %d cit%s + world in %dms.',
    $summary['cities'],
    $summary['cities'] === 1 ? 'y' : 'ies',
    $summary['total_ms'],
));
admin_redirect('/admin');
