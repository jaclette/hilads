<?php

declare(strict_types=1);

admin_require_login();

$pdo = Database::pdo();

// Arrivals are stored as city-channel system messages (type='system',
// event='join'); nickname = who arrived. channels.id === messages.channel_id
// (city = "city_<n>"). Day boundaries computed in UTC for determinism.
$channel = trim($_GET['channel'] ?? '');

$dateParam    = trim($_GET['date'] ?? '');
$dateValid    = preg_match('/^\d{4}-\d{2}-\d{2}$/', $dateParam) ? $dateParam : '';
$activityDate = $dateValid !== '' ? $dateValid : gmdate('Y-m-d');
$dayBounds = static function (string $d): array {
    $start = $d . ' 00:00:00+00';
    $end   = (new DateTime($d . ' 00:00:00', new DateTimeZone('UTC')))
                 ->modify('+1 day')->format('Y-m-d H:i:s') . '+00';
    return [$start, $end];
};

admin_head('Arrivals');
admin_nav('/admin/arrivals');
?>
<div class="admin-main">
<?php if ($channel !== ''):
    // ── City mode: who arrived in this city ─────────────────────────────────
    $chStmt = $pdo->prepare("SELECT id, type, name FROM channels WHERE id = :id");
    $chStmt->execute([':id' => $channel]);
    $ch = $chStmt->fetch();

    if (!$ch) {
        echo '<h1 class="page-title">City not found</h1>';
        echo '<p style="margin-top:12px"><a href="/admin/arrivals" class="btn btn-secondary btn-sm">← Back</a></p>';
        echo '</div>';
        admin_foot();
        return;
    }

    $dateFilter = '';
    $dateBinds  = [];
    if ($dateValid !== '') {
        [$ds, $de]  = $dayBounds($dateValid);
        $dateFilter = " AND created_at >= :ds::timestamptz AND created_at < :de::timestamptz";
        $dateBinds  = [':ds' => $ds, ':de' => $de];
    }

    $perPage = 200;
    $page    = max(1, (int)($_GET['page'] ?? 1));
    $offset  = ($page - 1) * $perPage;

    $cntStmt = $pdo->prepare("
        SELECT COUNT(*) FROM messages
        WHERE channel_id = :cid AND type = 'system' AND event = 'join'$dateFilter
    ");
    $cntStmt->execute([':cid' => $channel] + $dateBinds);
    $total = (int) $cntStmt->fetchColumn();
    $pages = (int) ceil($total / $perPage);

    $aStmt = $pdo->prepare("
        SELECT id, nickname, user_id, guest_id,
               EXTRACT(EPOCH FROM created_at)::INTEGER AS created_ts
        FROM messages
        WHERE channel_id = :cid AND type = 'system' AND event = 'join'$dateFilter
        ORDER BY created_at DESC
        LIMIT :lim OFFSET :off
    ");
    $aStmt->bindValue(':cid', $channel);
    foreach ($dateBinds as $k => $v) { $aStmt->bindValue($k, $v); }
    $aStmt->bindValue(':lim', $perPage, PDO::PARAM_INT);
    $aStmt->bindValue(':off', $offset, PDO::PARAM_INT);
    $aStmt->execute();
    $arrivals = $aStmt->fetchAll();

    $backHref = $dateValid !== ''
        ? '/admin/arrivals?date=' . urlencode($dateValid)
        : '/admin/arrivals';
    ?>
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <h1 class="page-title" style="margin-bottom:0">
            <span class="badge" style="background:#3b82f622;color:#3b82f6;border:1px solid #3b82f655">City</span>
            <?= htmlspecialchars($ch['name'] ?? '(untitled)', ENT_QUOTES) ?>
            <span style="color:#555;font-size:14px;font-weight:400">
                <?= number_format($total) ?> arrivals<?php if ($dateValid !== ''): ?> on <?= htmlspecialchars($dateValid, ENT_QUOTES) ?><?php endif; ?>
            </span>
        </h1>
        <a href="<?= $backHref ?>" class="btn btn-secondary btn-sm">← Back</a>
    </div>
    <div class="td-mono" style="color:#555;margin-bottom:16px;font-size:11px"><?= htmlspecialchars($ch['id'], ENT_QUOTES) ?></div>

    <div class="table-wrapper">
        <table>
            <thead>
                <tr>
                    <th style="width:160px">When</th>
                    <th>Who arrived</th>
                </tr>
            </thead>
            <tbody>
            <?php if (empty($arrivals)): ?>
                <tr><td colspan="2" class="no-results">No arrivals<?php if ($dateValid !== ''): ?> on this day<?php endif; ?>.</td></tr>
            <?php else: foreach ($arrivals as $a):
                $who = $a['nickname'] ?: '(no name)';
                if ($a['user_id'] !== null) {
                    $idBadge = '<span class="badge badge-registered" title="' . htmlspecialchars($a['user_id'], ENT_QUOTES) . '">Reg.</span>';
                    $profile = '/admin/users?q=' . urlencode($a['user_id']);
                } elseif ($a['guest_id'] !== null) {
                    $idBadge = '<span class="badge badge-guest" title="' . htmlspecialchars($a['guest_id'], ENT_QUOTES) . '">Guest</span>';
                    $profile = null;
                } else {
                    $idBadge = '';
                    $profile = null;
                }
                ?>
                <tr>
                    <td style="color:#888;white-space:nowrap">✨ <?= date('M d, H:i', (int) $a['created_ts']) ?></td>
                    <td>
                        <?= $idBadge ?>
                        <?php if ($profile): ?>
                            <a href="<?= $profile ?>" style="color:#ddd;margin-left:4px"><?= htmlspecialchars($who, ENT_QUOTES) ?></a>
                        <?php else: ?>
                            <span style="color:#ccc;margin-left:4px"><?= htmlspecialchars($who, ENT_QUOTES) ?></span>
                        <?php endif; ?>
                    </td>
                </tr>
            <?php endforeach; endif; ?>
            </tbody>
        </table>
    </div>

    <?php if ($pages > 1): ?>
        <div class="pagination">
            <?php $qs = 'channel=' . urlencode($channel) . '&date=' . urlencode($dateValid); ?>
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
    // ── Default: per-city arrival counts for a chosen day ───────────────────
    [$ds, $de] = $dayBounds($activityDate);
    $cityStmt = $pdo->prepare("
        SELECT c.id, c.name,
               COUNT(m.id)        AS cnt,
               MAX(m.created_at)  AS last_at
        FROM channels c
        JOIN messages m ON m.channel_id = c.id
        WHERE c.type = 'city'
          AND m.type = 'system' AND m.event = 'join'
          AND m.created_at >= :ds::timestamptz AND m.created_at < :de::timestamptz
        GROUP BY c.id, c.name
        ORDER BY cnt DESC, c.name ASC
    ");
    $cityStmt->execute([':ds' => $ds, ':de' => $de]);
    $cities = $cityStmt->fetchAll();
    $totalArr = 0;
    foreach ($cities as $row) { $totalArr += (int) $row['cnt']; }

    $prevDate = (new DateTime($activityDate))->modify('-1 day')->format('Y-m-d');
    $nextDate = (new DateTime($activityDate))->modify('+1 day')->format('Y-m-d');
    $today    = gmdate('Y-m-d');
    ?>
    <h1 class="page-title">Arrivals <span style="color:#555;font-size:14px;font-weight:400">by city</span></h1>
    <p style="color:#777;margin:-8px 0 16px;font-size:13px">How many people arrived in each city on a given day. Click a city to see who arrived.</p>

    <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px">
        <h2 style="margin:0;font-size:16px;font-weight:700;color:#eee">✨ Arrivals</h2>
        <form method="GET" action="/admin/arrivals" style="display:flex;align-items:center;gap:8px;margin:0">
            <a href="?date=<?= $prevDate ?>" class="btn btn-secondary btn-sm" title="Previous day">←</a>
            <input type="date" name="date" value="<?= htmlspecialchars($activityDate, ENT_QUOTES) ?>" max="<?= $today ?>"
                   onchange="this.form.submit()"
                   style="background:#1a1a1a;border:1px solid #333;color:#eee;border-radius:6px;padding:6px 8px;font-size:13px">
            <a href="?date=<?= $nextDate ?>" class="btn btn-secondary btn-sm" title="Next day">→</a>
            <?php if ($activityDate !== $today): ?>
                <a href="/admin/arrivals" class="btn btn-secondary btn-sm">Today</a>
            <?php endif; ?>
        </form>
        <span style="color:#666;font-size:13px">
            <?= count($cities) ?> cities · <?= number_format($totalArr) ?> arrivals on <?= htmlspecialchars($activityDate, ENT_QUOTES) ?> (UTC)
        </span>
    </div>

    <?php
    $chartLink = static fn(string $id): string =>
        '/admin/arrivals?channel=' . urlencode($id) . '&date=' . urlencode($activityDate);
    include __DIR__ . '/_city_bar_chart.php';
    ?>

    <div class="table-wrapper">
        <table>
            <thead>
                <tr>
                    <th>City</th>
                    <th style="width:120px">Arrivals</th>
                    <th style="width:150px">Last arrival</th>
                    <th style="width:130px">Actions</th>
                </tr>
            </thead>
            <tbody>
            <?php if (empty($cities)): ?>
                <tr><td colspan="4" class="no-results">No city had arrivals on <?= htmlspecialchars($activityDate, ENT_QUOTES) ?>.</td></tr>
            <?php else: foreach ($cities as $c):
                $lastTs = $c['last_at'] ? strtotime($c['last_at']) : 0;
                ?>
                <tr>
                    <td>
                        <span class="badge" style="background:#3b82f622;color:#3b82f6;border:1px solid #3b82f655">City</span>
                        <strong style="margin-left:6px"><?= htmlspecialchars($c['name'] ?? '(untitled)', ENT_QUOTES) ?></strong>
                    </td>
                    <td><strong style="color:#fff;font-size:15px"><?= number_format((int) $c['cnt']) ?></strong></td>
                    <td style="color:#888;white-space:nowrap"><?= $lastTs ? date('M d, H:i', $lastTs) : '-' ?></td>
                    <td>
                        <a href="/admin/arrivals?channel=<?= urlencode($c['id']) ?>&date=<?= urlencode($activityDate) ?>" class="btn btn-primary btn-sm">Who arrived →</a>
                    </td>
                </tr>
            <?php endforeach; endif; ?>
            </tbody>
        </table>
    </div>
<?php endif; ?>
</div>
<?php
admin_foot();
