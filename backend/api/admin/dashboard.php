<?php

declare(strict_types=1);

admin_require_login();

$pdo = Database::pdo();

$totalUsers    = (int)$pdo->query("SELECT COUNT(*) FROM users")->fetchColumn();
$totalEvents   = (int)$pdo->query("SELECT COUNT(*) FROM channel_events")->fetchColumn();
$activeEvents  = (int)$pdo->query("
    SELECT COUNT(*)
    FROM channel_events ce
    JOIN channels c ON c.id = ce.channel_id
    WHERE c.status = 'active' AND ce.expires_at > now()
")->fetchColumn();
$totalMessages = (int)$pdo->query("SELECT COUNT(*) FROM messages")->fetchColumn();

// PR51 - quick leaderboard stat for the dashboard.
$totalScoreEvents = (int)$pdo->query("SELECT COUNT(*) FROM score_events")->fetchColumn();
$topScorer = $pdo->query("
    SELECT id, display_name, score_alltime
    FROM users
    WHERE deleted_at IS NULL AND score_alltime > 0
    ORDER BY score_alltime DESC
    LIMIT 1
")->fetch(\PDO::FETCH_ASSOC) ?: null;

admin_head('Dashboard');
admin_nav('/admin');
?>
<div class="admin-main">
    <h1 class="page-title">Dashboard</h1>

    <?= flash_html() ?>

    <div class="stats-row">
        <div class="stat-card">
            <div class="stat-value"><?= number_format($totalUsers) ?></div>
            <div class="stat-label">Registered Users</div>
        </div>
        <div class="stat-card">
            <div class="stat-value"><?= number_format($activeEvents) ?></div>
            <div class="stat-label">Active Events</div>
        </div>
        <div class="stat-card">
            <div class="stat-value"><?= number_format($totalEvents) ?></div>
            <div class="stat-label">Total Events</div>
        </div>
        <div class="stat-card">
            <div class="stat-value"><?= number_format($totalMessages) ?></div>
            <div class="stat-label">Messages</div>
        </div>
    </div>

    <div style="display:flex; gap:12px; flex-wrap:wrap;">
        <a href="/admin/users" class="btn btn-secondary">→ Manage Users</a>
        <a href="/admin/events" class="btn btn-secondary">→ Manage Events</a>
    </div>

    <!-- PR51 - Danger zone. Reset every user's leaderboard score back to
         zero. Confirms via a native JS prompt (no extra page); the form
         POSTs to /admin/scores/reset-all where the server runs the
         actual wipe inside a transaction (see scores_reset.php). -->
    <div style="margin-top: 32px; padding: 16px; border: 1px solid rgba(248, 113, 113, 0.35); border-radius: 8px; background: rgba(248, 113, 113, 0.04);">
        <h2 style="margin: 0 0 6px; font-size: 14px; color: #f87171; text-transform: uppercase; letter-spacing: 0.5px;">⚠️ Danger zone</h2>
        <p style="margin: 0 0 10px; color: #aaa; font-size: 13px; line-height: 1.5;">
            Wipes every user's <code>score_alltime</code> + <code>score_month</code>
            back to zero and deletes every row from <code>score_events</code>.
            Ratings (stars + comments) are preserved.
            <?php if ($totalScoreEvents > 0): ?>
                Currently <strong style="color: #ddd;"><?= number_format($totalScoreEvents) ?></strong> event<?= $totalScoreEvents === 1 ? '' : 's' ?> in the ledger<?php
                    if ($topScorer):
                ?>; top scorer: <strong style="color: #ddd;"><?= htmlspecialchars($topScorer['display_name'], ENT_QUOTES) ?></strong> (<?= number_format((int)$topScorer['score_alltime']) ?> pts)<?php
                    endif;
                ?>.
            <?php else: ?>
                The ledger is already empty.
            <?php endif; ?>
        </p>
        <form
            method="POST"
            action="/admin/scores/reset-all"
            style="margin: 0;"
            onsubmit="return confirm('Reset every user\'s score back to zero?\n\nThis wipes ALL score_events and resets every users.score_alltime / score_month to 0. Ratings stay.\n\nThis can\'t be undone.')"
        >
            <?= csrf_input() ?>
            <button type="submit" class="btn btn-danger btn-sm" <?= $totalScoreEvents === 0 ? 'disabled' : '' ?>>
                Reset all scores to zero
            </button>
        </form>
    </div>
</div>
<?php
admin_foot();
