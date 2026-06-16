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

// ── Date range (UTC). Back-compat: legacy ?date= → from=to=date. ────────────
$today  = gmdate('Y-m-d');
$valid  = static fn($d): string => preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $d) ? (string) $d : '';
$legacy = $valid($_GET['date'] ?? '');
$fromRaw = $valid($_GET['from'] ?? '');
$toRaw   = $valid($_GET['to']   ?? '');
$rangeExplicit = ($fromRaw !== '' || $toRaw !== '' || $legacy !== '');
$from = $fromRaw ?: ($legacy ?: $today);
$to   = $toRaw   ?: ($legacy ?: $from);
if ($to < $from) { $to = $from; }
if ((strtotime($to) - strtotime($from)) / 86400 > 92) {
    $to = (new DateTime($from))->modify('+92 days')->format('Y-m-d');
}
$view = (($_GET['view'] ?? '') === 'daily') ? 'daily' : 'sum';
$ds = $from . ' 00:00:00+00';
$de = (new DateTime($to . ' 00:00:00', new DateTimeZone('UTC')))
          ->modify('+1 day')->format('Y-m-d H:i:s') . '+00';
$rangeLabel = $from === $to ? $from : "$from → $to";

$PALETTE = ['#FF7A3C','#3b82f6','#22c55e','#a855f7','#eab308','#ec4899',
            '#14b8a6','#f97316','#8b5cf6','#06b6d4','#ef4444','#84cc16'];

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
        echo '<p style="margin-top:12px"><a href="/admin/messages" class="btn btn-secondary btn-sm">← Back</a></p>';
        echo '</div>';
        admin_foot();
        return;
    }

    $typeLabel = $TYPE_LABELS[$ch['type']] ?? $ch['type'];
    $badgeCol  = $TYPE_BADGE[$ch['type']] ?? '#666';

    // Date scoping applied only when a range was explicitly passed (opened from
    // the city-activity view). Search → channel keeps the full history.
    $dateFilter = '';
    $dateBinds  = [];
    if ($rangeExplicit) {
        $dateFilter = " AND created_at >= :ds::timestamptz AND created_at < :de::timestamptz";
        $dateBinds  = [':ds' => $ds, ':de' => $de];
    }

    $perPage = 200;
    $page    = max(1, (int)($_GET['page'] ?? 1));
    $offset  = ($page - 1) * $perPage;

    $cntStmt = $pdo->prepare("
        SELECT COUNT(*) FROM messages
        WHERE channel_id = :cid AND type IN ('text', 'image')$dateFilter
    ");
    $cntStmt->execute([':cid' => $channel] + $dateBinds);
    $total = (int) $cntStmt->fetchColumn();
    $pages = (int) ceil($total / $perPage);

    $mStmt = $pdo->prepare("
        SELECT id, nickname, user_id, guest_id, content, image_url,
               EXTRACT(EPOCH FROM created_at)::INTEGER AS created_ts,
               deleted_at
        FROM messages
        WHERE channel_id = :cid AND type IN ('text', 'image')$dateFilter
        ORDER BY created_at DESC
        LIMIT :lim OFFSET :off
    ");
    $mStmt->bindValue(':cid', $channel);
    foreach ($dateBinds as $k => $v) { $mStmt->bindValue($k, $v); }
    $mStmt->bindValue(':lim', $perPage, PDO::PARAM_INT);
    $mStmt->bindValue(':off', $offset, PDO::PARAM_INT);
    $mStmt->execute();
    $messages = $mStmt->fetchAll();

    $backHref = $rangeExplicit
        ? '/admin/messages?from=' . urlencode($from) . '&to=' . urlencode($to) . '&view=' . urlencode($view)
        : '/admin/messages?q=' . urlencode($search) . '&type=' . urlencode($typeF);
    ?>
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <h1 class="page-title" style="margin-bottom:0">
            <span class="badge" style="background:<?= $badgeCol ?>22;color:<?= $badgeCol ?>;border:1px solid <?= $badgeCol ?>55"><?= htmlspecialchars($typeLabel, ENT_QUOTES) ?></span>
            <?= htmlspecialchars($ch['name'] ?? '(untitled)', ENT_QUOTES) ?>
            <span style="color:#555;font-size:14px;font-weight:400">
                <?= number_format($total) ?> messages<?php if ($rangeExplicit): ?> · <?= htmlspecialchars($rangeLabel, ENT_QUOTES) ?><?php endif; ?>
            </span>
        </h1>
        <a href="<?= $backHref ?>" class="btn btn-secondary btn-sm">← Back</a>
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
                <tr><td colspan="4" class="no-results">No messages<?php if ($rangeExplicit): ?> in this range<?php endif; ?>.</td></tr>
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
                                <input type="hidden" name="from" value="<?= htmlspecialchars($rangeExplicit ? $from : '', ENT_QUOTES) ?>">
                                <input type="hidden" name="to" value="<?= htmlspecialchars($rangeExplicit ? $to : '', ENT_QUOTES) ?>">
                                <input type="hidden" name="view" value="<?= htmlspecialchars($view, ENT_QUOTES) ?>">
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
            <?php $qs = 'channel=' . urlencode($channel) . '&q=' . urlencode($search) . '&type=' . urlencode($typeF)
                      . '&from=' . urlencode($rangeExplicit ? $from : '') . '&to=' . urlencode($rangeExplicit ? $to : '') . '&view=' . urlencode($view); ?>
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

<?php elseif ($search !== ''):
    // ── Search mode: find channels by name across all four types ────────────
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

    $stmt = $pdo->prepare("
        SELECT c.id, c.type, c.name, c.status, c.updated_at
        FROM channels c
        $whereClause
        ORDER BY c.updated_at DESC NULLS LAST
        LIMIT 80
    ");
    $stmt->execute($params);
    $rows = $stmt->fetchAll();
    ?>
    <h1 class="page-title">Messages <span style="color:#555;font-size:14px;font-weight:400">moderation</span></h1>
    <p style="color:#777;margin:-8px 0 16px;font-size:13px">Search a city, event, hangout or challenge by name, open it, and remove any message.</p>

    <?= flash_html() ?>

    <?php include __DIR__ . '/_messages_search_form.php'; ?>

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

<?php else:
    // ── Default: per-city message activity over a date range ────────────────
    ?>
    <h1 class="page-title">Messages <span style="color:#555;font-size:14px;font-weight:400">moderation</span></h1>
    <p style="color:#777;margin:-8px 0 16px;font-size:13px">Search a channel by name, or browse city message activity over a date range — click a city to open and moderate its messages.</p>

    <?= flash_html() ?>

    <?php include __DIR__ . '/_messages_search_form.php'; ?>

    <!-- Range + view controls -->
    <form method="GET" action="/admin/messages" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">
        <span style="color:#888;font-size:13px;font-weight:600">From</span>
        <input type="date" name="from" value="<?= htmlspecialchars($from, ENT_QUOTES) ?>" max="<?= $today ?>"
               onchange="this.form.submit()" onclick="if(this.showPicker)this.showPicker()"
               style="background:#1a1a1a;border:1px solid #333;color:#eee;border-radius:6px;padding:6px 8px;font-size:13px">
        <span style="color:#888;font-size:13px;font-weight:600">to</span>
        <input type="date" name="to" value="<?= htmlspecialchars($to, ENT_QUOTES) ?>" max="<?= $today ?>"
               onchange="this.form.submit()" onclick="if(this.showPicker)this.showPicker()"
               style="background:#1a1a1a;border:1px solid #333;color:#eee;border-radius:6px;padding:6px 8px;font-size:13px">
        <input type="hidden" name="view" value="<?= htmlspecialchars($view, ENT_QUOTES) ?>">
        <a href="/admin/messages?from=<?= $today ?>&to=<?= $today ?>&view=<?= htmlspecialchars($view, ENT_QUOTES) ?>" class="btn btn-secondary btn-sm">Today</a>
    </form>

    <div style="display:flex;gap:8px;margin-bottom:16px">
        <?php
        $viewOpts = ['sum' => '∑ Accumulation', 'daily' => '📅 Per day'];
        foreach ($viewOpts as $vk => $vlabel):
            $active = $view === $vk;
            $href = '/admin/messages?from=' . urlencode($from) . '&to=' . urlencode($to) . '&view=' . $vk;
        ?>
            <a href="<?= $href ?>" class="btn btn-sm <?= $active ? 'btn-primary' : 'btn-secondary' ?>"><?= $vlabel ?></a>
        <?php endforeach; ?>
    </div>

    <?php
    if ($view === 'daily'):
        $stmt = $pdo->prepare("
            SELECT c.id, c.name,
                   (m.created_at AT TIME ZONE 'UTC')::date AS day,
                   COUNT(m.id) AS cnt
            FROM channels c
            JOIN messages m ON m.channel_id = c.id
            WHERE c.type = 'city'
              AND m.type IN ('text', 'image')
              AND m.created_at >= :ds::timestamptz AND m.created_at < :de::timestamptz
            GROUP BY c.id, c.name, day
        ");
        $stmt->execute([':ds' => $ds, ':de' => $de]);
        $rows = $stmt->fetchAll();

        $daily = []; $dayTotals = []; $cityTotals = []; $cityName = [];
        foreach ($rows as $r) {
            $cid = $r['id']; $day = $r['day']; $cnt = (int) $r['cnt'];
            $daily[$day][$cid] = $cnt;
            $dayTotals[$day]   = ($dayTotals[$day] ?? 0) + $cnt;
            $cityTotals[$cid]  = ($cityTotals[$cid] ?? 0) + $cnt;
            $cityName[$cid]    = $r['name'];
        }
        arsort($cityTotals);
        $cityColor = [];
        $i = 0;
        foreach ($cityTotals as $cid => $t) { $cityColor[$cid] = $PALETTE[$i % count($PALETTE)]; $i++; }
        $maxDayTotal = $dayTotals ? max($dayTotals) : 0;
        $grandTotal  = array_sum($cityTotals);
        ?>
        <p style="color:#666;font-size:13px;margin:0 0 12px"><?= count($cityTotals) ?> cities · <?= number_format($grandTotal) ?> messages · <?= htmlspecialchars($rangeLabel, ENT_QUOTES) ?> (UTC)</p>

        <?php if (empty($cityTotals)): ?>
            <p class="no-results" style="padding:30px 0">No city messages in this range.</p>
        <?php else: ?>
            <div style="display:flex;flex-wrap:wrap;gap:12px;margin-bottom:16px">
                <?php foreach ($cityColor as $cid => $col): ?>
                    <a href="/admin/messages?channel=<?= urlencode($cid) ?>&from=<?= urlencode($from) ?>&to=<?= urlencode($to) ?>"
                       style="display:flex;align-items:center;gap:6px;text-decoration:none;font-size:13px;color:#ddd">
                        <span style="width:12px;height:12px;border-radius:3px;background:<?= $col ?>;display:inline-block"></span>
                        <?= htmlspecialchars($cityName[$cid] ?? '?', ENT_QUOTES) ?>
                        <span style="color:#666">(<?= number_format((int) $cityTotals[$cid]) ?>)</span>
                    </a>
                <?php endforeach; ?>
            </div>

            <div style="background:#161310;border:1px solid #2a2a2a;border-radius:12px;padding:14px 18px">
                <?php
                $cursor = new DateTime($from);
                $end    = new DateTime($to);
                while ($cursor <= $end):
                    $day      = $cursor->format('Y-m-d');
                    $dayTotal = $dayTotals[$day] ?? 0;
                    ?>
                    <div style="display:flex;align-items:center;gap:12px;padding:5px 0">
                        <span style="width:90px;flex-shrink:0;color:#aaa;font-size:12px;white-space:nowrap"><?= $cursor->format('D M d') ?></span>
                        <span style="flex:1;height:18px;background:rgba(255,255,255,0.05);border-radius:5px;overflow:hidden;display:flex">
                            <?php foreach ($cityColor as $cid => $col):
                                $cnt = $daily[$day][$cid] ?? 0;
                                if ($cnt <= 0) continue;
                                $w = $maxDayTotal > 0 ? ($cnt / $maxDayTotal * 100) : 0;
                                ?>
                                <span title="<?= htmlspecialchars(($cityName[$cid] ?? '?') . ': ' . $cnt, ENT_QUOTES) ?>"
                                      style="height:100%;width:<?= $w ?>%;background:<?= $col ?>"></span>
                            <?php endforeach; ?>
                        </span>
                        <span style="width:46px;text-align:right;color:#fff;font-weight:700;font-size:13px"><?= number_format($dayTotal) ?></span>
                    </div>
                    <?php $cursor->modify('+1 day'); endwhile; ?>
            </div>
        <?php endif; ?>

    <?php else:
        $cityStmt = $pdo->prepare("
            SELECT c.id, c.name,
                   COUNT(m.id)        AS cnt,
                   MAX(m.created_at)  AS last_at
            FROM channels c
            JOIN messages m ON m.channel_id = c.id
            WHERE c.type = 'city'
              AND m.type IN ('text', 'image')
              AND m.created_at >= :ds::timestamptz AND m.created_at < :de::timestamptz
            GROUP BY c.id, c.name
            ORDER BY cnt DESC, c.name ASC
        ");
        $cityStmt->execute([':ds' => $ds, ':de' => $de]);
        $cities = $cityStmt->fetchAll();
        $totalMsgs = 0;
        foreach ($cities as $r) { $totalMsgs += (int) $r['cnt']; }
        $barColors = [];
        $i = 0;
        foreach ($cities as $r) { $barColors[$r['id']] = $PALETTE[$i % count($PALETTE)]; $i++; }
        ?>
        <p style="color:#666;font-size:13px;margin:0 0 12px"><?= count($cities) ?> cities · <?= number_format($totalMsgs) ?> messages · <?= htmlspecialchars($rangeLabel, ENT_QUOTES) ?> (UTC)</p>

        <?php
        $chartLink = static fn(string $id): string =>
            '/admin/messages?channel=' . urlencode($id) . '&from=' . urlencode($from) . '&to=' . urlencode($to);
        include __DIR__ . '/_city_bar_chart.php';
        ?>

        <div class="table-wrapper">
            <table>
                <thead>
                    <tr><th>City</th><th style="width:120px">Messages</th><th style="width:150px">Last activity</th><th style="width:130px">Actions</th></tr>
                </thead>
                <tbody>
                <?php if (empty($cities)): ?>
                    <tr><td colspan="4" class="no-results">No city had messages in this range.</td></tr>
                <?php else: foreach ($cities as $c):
                    $lastTs = $c['last_at'] ? strtotime($c['last_at']) : 0;
                    ?>
                    <tr>
                        <td>
                            <span style="width:10px;height:10px;border-radius:3px;background:<?= $barColors[$c['id']] ?>;display:inline-block;margin-right:6px"></span>
                            <strong><?= htmlspecialchars($c['name'] ?? '(untitled)', ENT_QUOTES) ?></strong>
                        </td>
                        <td><strong style="color:#fff;font-size:15px"><?= number_format((int) $c['cnt']) ?></strong></td>
                        <td style="color:#888;white-space:nowrap"><?= $lastTs ? date('M d, H:i', $lastTs) : '-' ?></td>
                        <td><a href="/admin/messages?channel=<?= urlencode($c['id']) ?>&from=<?= urlencode($from) ?>&to=<?= urlencode($to) ?>" class="btn btn-primary btn-sm">View messages →</a></td>
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
