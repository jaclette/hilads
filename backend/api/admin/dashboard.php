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

admin_head('Dashboard');
admin_nav('/admin');
?>
<div class="admin-main">
    <h1 class="page-title">Dashboard</h1>

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
</div>
<?php
admin_foot();
