<?php

declare(strict_types=1);

admin_require_login();

$pdo = Database::pdo();

// Channel-type vocabulary. channels.type is one of these four; channels.name
// holds the human label (city name / event title / hangout title / challenge
// title) and channels.id === messages.channel_id for every type (city =
// "city_<n>", the rest = hex), so one query spans them all.
$TYPE_LABELS = [
    'city'      => 'City',
    'event'     => 'Event',
    'topic'     => 'Hangout',
    'challenge' => 'Challenge',
];
$TYPE_BADGE = [
    'city'      => '#3b82f6',
    'event'     => '#f59e0b',
    'topic'     => '#a855f7',
    'challenge' => '#ef4444',
];

$search  = trim($_GET['q'] ?? '');
$typeF   = $_GET['type'] ?? 'all';
$channel = trim($_GET['channel'] ?? '');

admin_head('Messages');
admin_nav('/admin/messages');
?>
<div class="admin-main">
<?php if ($channel !== ''):
    // ── Channel mode: list a single channel's messages ──────────────────────
    $chStmt = $pdo->prepare("SELECT id, type, name, status FROM channels WHERE id = :id");
    $chStmt->execute([':id' => $channel]);
    $ch = $chStmt->fetch();

    if (!$ch) {
        echo '<h1 class="page-title">Channel not found</h1>';
        echo flash_html();
        echo '<p style="margin-top:12px"><a href="/admin/messages" class="btn btn-secondary btn-sm">← Back to search</a></p>';
        echo '</div>';
        admin_foot();
        return;
    }

    $typeLabel = $TYPE_LABELS[$ch['type']] ?? $ch['type'];
    $badgeCol  = $TYPE_BADGE[$ch['type']] ?? '#666';

    $perPage = 200;
    $page    = max(1, (int)($_GET['page'] ?? 1));
    $offset  = ($page - 1) * $perPage;

    // Total real (user) messages in this channel - excludes system/join/weather.
    $cntStmt = $pdo->prepare("
        SELECT COUNT(*) FROM messages
        WHERE channel_id = :cid AND type IN ('text', 'image')
    ");
    $cntStmt->execute([':cid' => $channel]);
    $total = (int) $cntStmt->fetchColumn();
    $pages = (int) ceil($total / $perPage);

    $mStmt = $pdo->prepare("
        SELECT id, nickname, user_id, guest_id, content, image_url,
               EXTRACT(EPOCH FROM created_at)::INTEGER AS created_ts,
               deleted_at
        FROM messages
        WHERE channel_id = :cid AND type IN ('text', 'image')
        ORDER BY created_at DESC
        LIMIT :lim OFFSET :off
    ");
    $mStmt->bindValue(':cid', $channel);
    $mStmt->bindValue(':lim', $perPage, PDO::PARAM_INT);
    $mStmt->bindValue(':off', $offset, PDO::PARAM_INT);
    $mStmt->execute();
    $messages = $mStmt->fetchAll();
    ?>
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <h1 class="page-title" style="margin-bottom:0">
            <span class="badge" style="background:<?= $badgeCol ?>22;color:<?= $badgeCol ?>;border:1px solid <?= $badgeCol ?>55"><?= htmlspecialchars($typeLabel, ENT_QUOTES) ?></span>
            <?= htmlspecialchars($ch['name'] ?? '(untitled)', ENT_QUOTES) ?>
            <span style="color:#555;font-size:14px;font-weight:400"><?= number_format($total) ?> messages</span>
        </h1>
        <a href="/admin/messages?q=<?= urlencode($search) ?>&type=<?= urlencode($typeF) ?>" class="btn btn-secondary btn-sm">← Back to search</a>
    </div>
    <div class="td-mono" style="color:#555;margin-bottom:16px;font-size:11px"><?= htmlspecialchars($ch['id'], ENT_QUOTES) ?></div>

    <?= flash_html() ?>

    <div class="table-wrapper">
        <table>
            <thead>
                <tr>
                    <th style="width:140px">When</th>
                    <th style="width:200px">Sender</th>
                    <th>Message</th>
                    <th style="width:90px">Actions</th>
                </tr>
            </thead>
            <tbody>
            <?php if (empty($messages)): ?>
                <tr><td colspan="4" class="no-results">No messages in this channel.</td></tr>
            <?php else: foreach ($messages as $msg):
                $isDeleted = !empty($msg['deleted_at']);
                $who = $msg['nickname'] ?: '(no name)';
                if ($msg['user_id'] !== null) {
                    $idBadge = '<span class="badge badge-registered" title="' . htmlspecialchars($msg['user_id'], ENT_QUOTES) . '">Reg.</span>';
                } elseif ($msg['guest_id'] !== null) {
                    $idBadge = '<span class="badge badge-guest" title="' . htmlspecialchars($msg['guest_id'], ENT_QUOTES) . '">Guest</span>';
                } else {
                    $idBadge = '';
                }
                ?>
                <tr<?= $isDeleted ? ' style="opacity:0.45"' : '' ?>>
                    <td style="color:#888;white-space:nowrap"><?= date('M d, H:i', (int) $msg['created_ts']) ?></td>
                    <td class="td-clip"><?= $idBadge ?> <span style="color:#ccc"><?= htmlspecialchars($who, ENT_QUOTES) ?></span></td>
                    <td>
                        <?php if ($isDeleted): ?>
                            <span style="color:#555;font-style:italic">— deleted —</span>
                        <?php else: ?>
                            <?php if (!empty($msg['content'])): ?>
                                <span style="color:#ddd;white-space:pre-wrap"><?= htmlspecialchars($msg['content'], ENT_QUOTES) ?></span>
                            <?php endif; ?>
                            <?php if (!empty($msg['image_url'])): ?>
                                <a href="<?= htmlspecialchars($msg['image_url'], ENT_QUOTES) ?>" target="_blank" rel="noopener" style="color:#3b82f6;margin-left:6px">🖼 image</a>
                            <?php endif; ?>
                        <?php endif; ?>
                    </td>
                    <td>
                        <?php if (!$isDeleted): ?>
                            <form method="POST" action="/admin/messages/<?= urlencode($msg['id']) ?>/delete"
                                  onsubmit="return confirm('Delete this message? It will be replaced by a tombstone and cannot be undone.')">
                                <?= csrf_input() ?>
                                <input type="hidden" name="channel" value="<?= htmlspecialchars($channel, ENT_QUOTES) ?>">
                                <input type="hidden" name="q" value="<?= htmlspecialchars($search, ENT_QUOTES) ?>">
                                <input type="hidden" name="type" value="<?= htmlspecialchars($typeF, ENT_QUOTES) ?>">
                                <input type="hidden" name="page" value="<?= $page ?>">
                                <button type="submit" class="btn btn-danger btn-sm">Delete</button>
                            </form>
                        <?php else: ?>
                            <span style="color:#444;font-size:11px">deleted</span>
                        <?php endif; ?>
                    </td>
                </tr>
            <?php endforeach; endif; ?>
            </tbody>
        </table>
    </div>

    <?php if ($pages > 1): ?>
        <div class="pagination">
            <?php $qs = 'channel=' . urlencode($channel) . '&q=' . urlencode($search) . '&type=' . urlencode($typeF); ?>
            <?php if ($page > 1): ?>
                <a href="?<?= $qs ?>&page=<?= $page - 1 ?>">← Prev</a>
                <span class="sep">|</span>
            <?php endif; ?>
            <span>Page <span class="current"><?= $page ?></span> of <?= $pages ?></span>
            <?php if ($page < $pages): ?>
                <span class="sep">|</span>
                <a href="?<?= $qs ?>&page=<?= $page + 1 ?>">Next →</a>
            <?php endif; ?>
        </div>
    <?php endif; ?>

<?php else:
    // ── Search mode: find channels by name across all four types ────────────
    $rows = [];
    if ($search !== '') {
        $where  = ["c.type IN ('city','event','topic','challenge')"];
        $params = [];
        $where[]          = '(c.name ILIKE :q OR c.id = :exact)';
        $params[':q']     = '%' . $search . '%';
        $params[':exact'] = $search;
        if (isset($TYPE_LABELS[$typeF])) {
            $where[]       = 'c.type = :tf';
            $params[':tf'] = $typeF;
        }
        $whereClause = 'WHERE ' . implode(' AND ', $where);

        // Channels only (no message join) so the search stays cheap even with
        // hundreds of thousands of messages - counts load when a channel opens.
        $stmt = $pdo->prepare("
            SELECT c.id, c.type, c.name, c.status, c.updated_at
            FROM channels c
            $whereClause
            ORDER BY c.updated_at DESC NULLS LAST
            LIMIT 80
        ");
        $stmt->execute($params);
        $rows = $stmt->fetchAll();
    }
    ?>
    <h1 class="page-title">Messages <span style="color:#555;font-size:14px;font-weight:400">moderation</span></h1>
    <p style="color:#777;margin:-8px 0 16px;font-size:13px">Search a city, event, hangout or challenge by name, open it, and remove any message.</p>

    <?= flash_html() ?>

    <form method="GET" action="/admin/messages" class="toolbar">
        <input type="text" name="q" value="<?= htmlspecialchars($search, ENT_QUOTES) ?>" placeholder="Search by city / event / hangout / challenge name or channel ID…" autofocus>
        <select name="type">
            <?php
            $opts = ['all' => 'All channels'] + $TYPE_LABELS;
            foreach ($opts as $val => $label):
            ?>
                <option value="<?= $val ?>" <?= $typeF === $val ? 'selected' : '' ?>><?= $label ?></option>
            <?php endforeach; ?>
        </select>
        <button type="submit" class="btn btn-primary btn-sm">Search</button>
        <?php if ($search !== '' || $typeF !== 'all'): ?>
            <a href="/admin/messages" class="btn btn-secondary btn-sm">Clear</a>
        <?php endif; ?>
    </form>

    <?php if ($search === ''): ?>
        <p class="no-results" style="padding:40px 0">Type a name above to find a channel to moderate.</p>
    <?php else: ?>
        <div class="table-wrapper">
            <table>
                <thead>
                    <tr>
                        <th style="width:110px">Type</th>
                        <th>Name</th>
                        <th style="width:90px">Status</th>
                        <th style="width:130px">Actions</th>
                    </tr>
                </thead>
                <tbody>
                <?php if (empty($rows)): ?>
                    <tr><td colspan="4" class="no-results">No channels match “<?= htmlspecialchars($search, ENT_QUOTES) ?>”.</td></tr>
                <?php else: foreach ($rows as $r):
                    $typeLabel = $TYPE_LABELS[$r['type']] ?? $r['type'];
                    $badgeCol  = $TYPE_BADGE[$r['type']] ?? '#666';
                    ?>
                    <tr>
                        <td><span class="badge" style="background:<?= $badgeCol ?>22;color:<?= $badgeCol ?>;border:1px solid <?= $badgeCol ?>55"><?= htmlspecialchars($typeLabel, ENT_QUOTES) ?></span></td>
                        <td class="td-clip" title="<?= htmlspecialchars($r['name'] ?? '', ENT_QUOTES) ?>">
                            <strong><?= htmlspecialchars($r['name'] ?? '(untitled)', ENT_QUOTES) ?></strong>
                            <span class="td-mono" style="color:#555;display:block;font-size:11px"><?= htmlspecialchars($r['id'], ENT_QUOTES) ?></span>
                        </td>
                        <td>
                            <?php if ($r['status'] === 'deleted'): ?>
                                <span class="badge badge-deleted">Deleted</span>
                            <?php else: ?>
                                <span class="badge badge-active">Active</span>
                            <?php endif; ?>
                        </td>
                        <td>
                            <a href="/admin/messages?channel=<?= urlencode($r['id']) ?>&q=<?= urlencode($search) ?>&type=<?= urlencode($typeF) ?>" class="btn btn-primary btn-sm">View messages →</a>
                        </td>
                    </tr>
                <?php endforeach; endif; ?>
                </tbody>
            </table>
        </div>
    <?php endif; ?>
<?php endif; ?>
</div>
<?php
admin_foot();
