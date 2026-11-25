<?php

declare(strict_types=1);

// Global search (top bar, "/" to focus): players, Daily photos and cities in one go.
// A player matches on name, @username, email or id; a photo on its id or its author's @username;
// a city on its name or id.

admin_require_login();

$pdo = Database::pdo();
$e = fn ($s) => htmlspecialchars((string) $s, ENT_QUOTES);
$q = trim((string) ($_GET['q'] ?? ''));
$term = ltrim($q, '@');
$like = '%' . str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], mb_strtolower($term)) . '%';

$players = $photos = $cities = [];
if (mb_strlen($term) >= 2) {
    $st = $pdo->prepare("
        SELECT id, display_name, username, email, profile_thumb_photo_url, profile_photo_url, home_city_name, created_at, deleted_at, guest_id
        FROM users
        WHERE id = :exact OR lower(username) LIKE :like OR lower(display_name) LIKE :like OR lower(coalesce(email, '')) LIKE :like
        ORDER BY (lower(username) = lower(:exact)) DESC, deleted_at IS NOT NULL, score_alltime DESC NULLS LAST
        LIMIT 8
    ");
    $st->execute([':exact' => $term, ':like' => $like]);
    $players = $st->fetchAll(\PDO::FETCH_ASSOC);

    $st = $pdo->prepare("
        SELECT p.id, p.challenge_id, p.photo_url, p.moderation_status, p.created_at, u.username, ch.name AS city
        FROM daily_proofs p
        JOIN users u ON u.id = p.user_id
        LEFT JOIN channels ch ON ch.id = p.city_id
        WHERE (p.id = :exact OR lower(u.username) = lower(:exact)) AND NOT p.is_demo
        ORDER BY p.created_at DESC
        LIMIT 8
    ");
    $st->execute([':exact' => $term]);
    $photos = $st->fetchAll(\PDO::FETCH_ASSOC);

    $st = $pdo->prepare("
        SELECT c.channel_id, ch.name, c.country, c.merged_into
        FROM cities c JOIN channels ch ON ch.id = c.channel_id
        WHERE c.channel_id = :exact OR lower(ch.name) LIKE :like
        ORDER BY (lower(ch.name) = lower(:exact)) DESC, c.merged_into IS NOT NULL, ch.name
        LIMIT 8
    ");
    $st->execute([':exact' => $term, ':like' => $like]);
    $cities = $st->fetchAll(\PDO::FETCH_ASSOC);
}

// One exact hit: go straight there.
$all = count($players) + count($photos) + count($cities);
if ($all === 1 && isset($_GET['go'])) {
    if ($players) admin_redirect('/admin/users/' . rawurlencode($players[0]['id']) . '/edit');
    if ($cities) admin_redirect('/admin/cities/' . rawurlencode($cities[0]['channel_id']));
}

$statusBadge = fn (string $s): string => ['approved' => '<span class="badge b-ok">Published</span>', 'pending' => '<span class="badge b-warn">To check</span>',
    'rejected' => '<span class="badge b-bad">Removed</span>'][$s] ?? '<span class="badge">' . htmlspecialchars($s) . '</span>';

admin_head($q !== '' ? "Search: {$q}" : 'Search');
admin_nav('/admin/search');
?>
<div class="admin-main" style="max-width:980px">
    <div class="page-head"><div>
        <h1 class="page-title">Search</h1>
        <p class="sub"><?= $q === '' ? 'Type at least 2 letters in the search box above: a player\'s name, @username or email, a photo id, a city.'
            : ($all === 0 ? 'Nothing found for “' . $e($q) . '”.' : $all . ' result' . ($all === 1 ? '' : 's') . ' for “' . $e($q) . '”.') ?></p>
    </div></div>

    <div class="results">
        <?php if ($players): ?>
        <section class="card">
            <div class="card-head"><h2>Players</h2><a class="link" href="/admin/users?q=<?= urlencode($term) ?>">See all in Users</a></div>
            <?php foreach ($players as $u): $thumb = $u['profile_thumb_photo_url'] ?: $u['profile_photo_url']; ?>
                <a class="result-row" href="/admin/users/<?= $e(rawurlencode($u['id'])) ?>/edit">
                    <?php if ($thumb): ?><img src="<?= $e($thumb) ?>" alt="" loading="lazy"><?php else: ?><span class="avatar" style="width:40px;height:40px"><?= $e(mb_strtoupper(mb_substr((string) $u['display_name'], 0, 1))) ?></span><?php endif; ?>
                    <div class="who"><b><?= $e($u['display_name']) ?><?= $u['username'] ? ' <span class="muted" style="font-weight:500">@' . $e($u['username']) . '</span>' : '' ?></b>
                        <span><?= $e($u['email'] ?: ($u['guest_id'] ? 'Guest' : '')) ?><?= $u['home_city_name'] ? ' · ' . $e($u['home_city_name']) : '' ?> · joined <?= $e(date('j M Y', (int) $u['created_at'])) ?></span></div>
                    <?php if ($u['deleted_at']): ?><span class="badge b-bad" style="margin-left:auto">Deleted</span><?php endif; ?>
                </a>
            <?php endforeach; ?>
        </section>
        <?php endif; ?>

        <?php if ($photos): ?>
        <section class="card">
            <div class="card-head"><h2>Photos</h2><a class="link" href="/admin/photos">Open Photos</a></div>
            <?php foreach ($photos as $p): ?>
                <a class="result-row" href="/admin/daily/<?= $e($p['challenge_id']) ?>#proof-<?= $e($p['id']) ?>">
                    <img src="<?= $e(R2Uploader::thumbProxy($p['photo_url'])) ?>" alt="" loading="lazy">
                    <div class="who"><b>@<?= $e($p['username']) ?><?= $p['city'] ? ' <span class="muted" style="font-weight:500">in ' . $e($p['city']) . '</span>' : '' ?></b>
                        <span><?= $e(date('j M Y, H:i', strtotime((string) $p['created_at']))) ?> · <span class="mono"><?= $e($p['id']) ?></span></span></div>
                    <span style="margin-left:auto"><?= $statusBadge((string) $p['moderation_status']) ?></span>
                </a>
            <?php endforeach; ?>
        </section>
        <?php endif; ?>

        <?php if ($cities): ?>
        <section class="card">
            <div class="card-head"><h2>Cities</h2><a class="link" href="/admin/cities?q=<?= urlencode($term) ?>">See all in Cities</a></div>
            <?php foreach ($cities as $c): ?>
                <a class="result-row" href="/admin/cities/<?= $e($c['channel_id']) ?>">
                    <span class="avatar" style="width:40px;height:40px;border-radius:8px"><?= $e($c['country']) ?></span>
                    <div class="who"><b><?= $e($c['name']) ?></b><span class="mono"><?= $e($c['channel_id']) ?></span></div>
                    <?php if ($c['merged_into']): ?><span class="badge b-mute" style="margin-left:auto">Merged into <?= $e($c['merged_into']) ?></span><?php endif; ?>
                </a>
            <?php endforeach; ?>
        </section>
        <?php endif; ?>
    </div>
</div>
<?php
admin_foot();
