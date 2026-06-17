<?php

declare(strict_types=1);

admin_require_login();

$pdo = Database::pdo();

$TYPE_ICON = ['food' => '🍜', 'place' => '📍', 'culture' => '🎭', 'help' => '🤝'];

// ── Date range (UTC+7) ────────────────────────────────────────────────────────
$today  = date('Y-m-d');
$valid  = static fn($d): string => preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $d) ? (string) $d : '';
$city   = trim($_GET['city'] ?? '');
$from   = $valid($_GET['from'] ?? '') ?: $today;
$to     = $valid($_GET['to']   ?? '') ?: $from;
if ($to < $from) { $to = $from; }
if ((strtotime($to) - strtotime($from)) / 86400 > 92) {
    $to = (new DateTime($from))->modify('+92 days')->format('Y-m-d');
}
$view = (($_GET['view'] ?? '') === 'daily') ? 'daily' : 'sum';
$ds = $from . ' 00:00:00+07:00';
$de = (new DateTime($to . ' 00:00:00', new DateTimeZone('Asia/Ho_Chi_Minh')))
          ->modify('+1 day')->format('Y-m-d H:i:s') . '+07:00';
$rangeLabel = $from === $to ? $from : "$from → $to";
$PALETTE = ['#FF7A3C','#3b82f6','#22c55e','#a855f7','#eab308','#ec4899',
            '#14b8a6','#f97316','#8b5cf6','#06b6d4','#ef4444','#84cc16'];

admin_head('Challenges');
admin_nav('/admin/challenges');
?>
<div class="admin-main">
<?php if ($city !== ''):
    // ── City mode: challenges created in this city over the range ───────────
    $cStmt = $pdo->prepare("SELECT id, name FROM channels WHERE id = :id AND type = 'city'");
    $cStmt->execute([':id' => $city]);
    $cityRow = $cStmt->fetch();

    if (!$cityRow) {
        echo '<h1 class="page-title">City not found</h1>';
        echo '<p style="margin-top:12px"><a href="/admin/challenges" class="btn btn-secondary btn-sm">← Back</a></p>';
        echo '</div>';
        admin_foot();
        return;
    }

    $stmt = $pdo->prepare("
        SELECT cc.channel_id, cc.title, cc.challenge_type, cc.mode, cc.status, cc.validation_method,
               cc.created_by, cc.guest_id, c.status AS channel_status,
               u.display_name AS creator_name,
               EXTRACT(EPOCH FROM cc.created_at)::INTEGER AS created_ts,
               pr.media_url AS proof_media_url, pr.media_type AS proof_media_type, pr.proof_status
        FROM channel_challenges cc
        JOIN channels c   ON c.id = cc.channel_id
        LEFT JOIN users u ON u.id = cc.created_by
        -- Latest photo proof across the challenge's acceptances (any status).
        LEFT JOIN LATERAL (
            SELECT p.media_url, p.media_type, p.status AS proof_status
            FROM challenge_proofs p
            JOIN challenge_acceptances a ON a.id = p.acceptance_id
            WHERE a.challenge_id = cc.channel_id
            ORDER BY p.submitted_at DESC LIMIT 1
        ) pr ON true
        WHERE (cc.city_id = :cid OR (cc.mode = 'international' AND cc.target_city_id = :cid2))
          AND cc.created_at >= :ds::timestamptz AND cc.created_at < :de::timestamptz
        ORDER BY cc.created_at DESC
        LIMIT 300
    ");
    $stmt->execute([':cid' => $city, ':cid2' => $city, ':ds' => $ds, ':de' => $de]);
    $items = $stmt->fetchAll();
    $backHref = '/admin/challenges?from=' . urlencode($from) . '&to=' . urlencode($to) . '&view=' . urlencode($view);
    ?>
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <h1 class="page-title" style="margin-bottom:0">
            <span class="badge" style="background:#ef444422;color:#ef4444;border:1px solid #ef444455">Challenges</span>
            <?= htmlspecialchars($cityRow['name'] ?? '(untitled)', ENT_QUOTES) ?>
            <span style="color:#555;font-size:14px;font-weight:400"><?= number_format(count($items)) ?> challenges · <?= htmlspecialchars($rangeLabel, ENT_QUOTES) ?></span>
        </h1>
        <a href="<?= $backHref ?>" class="btn btn-secondary btn-sm">← Back</a>
    </div>
    <div class="td-mono" style="color:#555;margin-bottom:16px;font-size:11px"><?= htmlspecialchars($cityRow['id'], ENT_QUOTES) ?></div>

    <?= flash_html() ?>

    <div class="table-wrapper">
        <table>
            <thead>
                <tr>
                    <th style="width:130px">Created</th>
                    <th>Title</th>
                    <th style="width:110px">Type</th>
                    <th style="width:160px">Creator</th>
                    <th style="width:100px">Status</th>
                    <th style="width:230px">Photo proof</th>
                    <th style="width:200px">Actions</th>
                </tr>
            </thead>
            <tbody>
            <?php if (empty($items)): ?>
                <tr><td colspan="7" class="no-results">No challenges in this range.</td></tr>
            <?php else: foreach ($items as $it):
                $deleted = $it['channel_status'] === 'deleted';
                $icon    = $TYPE_ICON[$it['challenge_type']] ?? '🔥';
                $intl    = ($it['mode'] ?? 'local') === 'international';
                $creator = $it['creator_name'] ?: ($it['guest_id'] ? 'Guest' : '-');
                ?>
                <tr<?= $deleted ? ' style="opacity:0.45"' : '' ?>>
                    <td style="color:#888;white-space:nowrap"><?= date('M d, H:i', (int) $it['created_ts']) ?></td>
                    <td class="td-clip" title="<?= htmlspecialchars($it['title'], ENT_QUOTES) ?>">
                        <?= $icon ?> <strong><?= htmlspecialchars($it['title'], ENT_QUOTES) ?></strong>
                        <?php if ($intl): ?><span class="badge" style="background:#38bdf822;color:#38bdf8;border:1px solid #38bdf855;margin-left:4px">🌐</span><?php endif; ?>
                    </td>
                    <td style="color:#888"><?= htmlspecialchars($it['challenge_type'] ?? '-', ENT_QUOTES) ?></td>
                    <td class="td-clip"><?= htmlspecialchars($creator, ENT_QUOTES) ?></td>
                    <td>
                        <?php if ($deleted): ?>
                            <span class="badge badge-deleted">Deleted</span>
                        <?php elseif ($it['status'] === 'validated'): ?>
                            <span class="badge" style="background:#22c55e22;color:#4ade80;border:1px solid #22c55e33">✓ Validated</span>
                        <?php else: ?>
                            <span class="badge badge-active">Open</span>
                        <?php endif; ?>
                    </td>
                    <td>
                        <?php
                        // Photo-proof challenges: international, or local with
                        // validation_method='photo_proof'. View / replace / delete
                        // the current proof image. Meet-only challenges show "-".
                        $usesProof = ($it['validation_method'] ?? 'meet') === 'photo_proof'
                                  || ($it['mode'] ?? 'local') === 'international';
                        $proofCtx  = csrf_input()
                            . '<input type="hidden" name="city" value="' . htmlspecialchars($city, ENT_QUOTES) . '">'
                            . '<input type="hidden" name="from" value="' . htmlspecialchars($from, ENT_QUOTES) . '">'
                            . '<input type="hidden" name="to" value="' . htmlspecialchars($to, ENT_QUOTES) . '">'
                            . '<input type="hidden" name="view" value="' . htmlspecialchars($view, ENT_QUOTES) . '">';
                        ?>
                        <?php if (!$usesProof): ?>
                            <span style="color:#555">—</span>
                        <?php elseif (empty($it['proof_media_url'])): ?>
                            <span style="color:#888;font-size:12px">No proof yet</span>
                        <?php else: ?>
                            <div style="display:flex;gap:8px;align-items:flex-start">
                                <a href="<?= htmlspecialchars($it['proof_media_url'], ENT_QUOTES) ?>" target="_blank" rel="noopener" title="Open full size">
                                    <img src="<?= htmlspecialchars($it['proof_media_url'], ENT_QUOTES) ?>" alt="proof"
                                         style="width:56px;height:56px;object-fit:cover;border-radius:6px;border:1px solid #2a2a2a;display:block">
                                </a>
                                <div class="td-actions" style="flex-direction:column;gap:6px">
                                    <form method="POST" action="/admin/challenges/<?= urlencode($it['channel_id']) ?>/proof/replace"
                                          enctype="multipart/form-data" style="display:flex;flex-direction:column;gap:3px">
                                        <?= $proofCtx ?>
                                        <input type="file" name="photo" accept="image/jpeg,image/png,image/webp" required
                                               style="font-size:11px;max-width:150px;color:#aaa">
                                        <button type="submit" class="btn btn-secondary btn-sm">Replace</button>
                                    </form>
                                    <form method="POST" action="/admin/challenges/<?= urlencode($it['channel_id']) ?>/proof/delete"
                                          onsubmit="return confirm('Delete this photo proof permanently? This cannot be undone.')">
                                        <?= $proofCtx ?>
                                        <button type="submit" class="btn btn-danger btn-sm">Delete proof</button>
                                    </form>
                                </div>
                            </div>
                        <?php endif; ?>
                    </td>
                    <td>
                        <div class="td-actions">
                            <a href="/admin/messages?channel=<?= urlencode($it['channel_id']) ?>" class="btn btn-secondary btn-sm">Messages</a>
                            <?php if (!$deleted): ?>
                                <form method="POST" action="/admin/challenges/<?= urlencode($it['channel_id']) ?>/delete"
                                      onsubmit="return confirm('Delete challenge «<?= htmlspecialchars(addslashes($it['title']), ENT_QUOTES) ?>»? It will be hidden from the app. This cannot be undone.')">
                                    <?= csrf_input() ?>
                                    <input type="hidden" name="city" value="<?= htmlspecialchars($city, ENT_QUOTES) ?>">
                                    <input type="hidden" name="from" value="<?= htmlspecialchars($from, ENT_QUOTES) ?>">
                                    <input type="hidden" name="to" value="<?= htmlspecialchars($to, ENT_QUOTES) ?>">
                                    <input type="hidden" name="view" value="<?= htmlspecialchars($view, ENT_QUOTES) ?>">
                                    <button type="submit" class="btn btn-danger btn-sm">Delete</button>
                                </form>
                            <?php endif; ?>
                        </div>
                    </td>
                </tr>
            <?php endforeach; endif; ?>
            </tbody>
        </table>
    </div>

<?php else:
    // ── Default: challenges created per city over a date range ──────────────
    ?>
    <h1 class="page-title">Challenges <span style="color:#555;font-size:14px;font-weight:400">by city</span></h1>
    <p style="color:#777;margin:-8px 0 16px;font-size:13px">How many challenges were created in each city over a date range. Click a city to list and moderate them.</p>

    <?= flash_html() ?>

    <?php
    $pageBase    = '/admin/challenges';
    $cityParam   = 'city';
    $noun        = 'challenges';
    $actionLabel = 'View challenges';
    // Each challenge counts for its origin city AND (for international) its
    // target city - so HCMC → Manaus is +1 HCMC and +1 Manaus. unnest expands
    // each row into 1 (local) or 2 (international) city ids; the JOIN drops the
    // NULL second element for local rows.
    $sumSql = "
        SELECT cid AS id, p.name AS name, COUNT(*) AS cnt, MAX(cc.created_at) AS last_at
        FROM channel_challenges cc
        CROSS JOIN LATERAL unnest(ARRAY[cc.city_id,
               CASE WHEN cc.mode = 'international' THEN cc.target_city_id END]) AS cid
        JOIN channels p ON p.id = cid AND p.type = 'city'
        WHERE cc.created_at >= :ds::timestamptz AND cc.created_at < :de::timestamptz
        GROUP BY cid, p.name
        ORDER BY cnt DESC, p.name ASC
    ";
    $dailySql = "
        SELECT cid AS id, p.name AS name,
               (cc.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS day, COUNT(*) AS cnt
        FROM channel_challenges cc
        CROSS JOIN LATERAL unnest(ARRAY[cc.city_id,
               CASE WHEN cc.mode = 'international' THEN cc.target_city_id END]) AS cid
        JOIN channels p ON p.id = cid AND p.type = 'city'
        WHERE cc.created_at >= :ds::timestamptz AND cc.created_at < :de::timestamptz
        GROUP BY cid, p.name, day
    ";
    include __DIR__ . '/_city_activity.php';
    ?>
<?php endif; ?>
</div>
<?php
admin_foot();
