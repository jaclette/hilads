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

// Avatar thumbnail backfill - how many users still serve the full
// profile_photo_url as their "thumb" via the COALESCE fallback. Each
// of those costs 500 kB-3 MB on every card render.
$thumbsMissing = (int)$pdo->query("
    SELECT COUNT(*) FROM users
    WHERE deleted_at IS NULL
      AND profile_photo_url       IS NOT NULL
      AND profile_thumb_photo_url IS NULL
")->fetchColumn();

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
            <div class="stat-label">Active Hi plan</div>
        </div>
        <div class="stat-card">
            <div class="stat-value"><?= number_format($totalEvents) ?></div>
            <div class="stat-label">Total Hi plan</div>
        </div>
        <div class="stat-card">
            <div class="stat-value"><?= number_format($totalMessages) ?></div>
            <div class="stat-label">Messages</div>
        </div>
    </div>

    <div class="callout">The heavy actions (reset scores, recalculate ranks, thumbnails) moved to
        <?= AdminAuth::isSuper() ? '<a href="/admin/danger">System › Danger zone</a>' : 'System › Danger zone (super admins)' ?>.
        The new dashboard (photos, players, retention, today's challenge, the week ahead) comes next.</div>
</div>
<?php
admin_foot();
