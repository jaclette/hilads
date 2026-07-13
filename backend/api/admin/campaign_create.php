<?php

declare(strict_types=1);

// Admin: create a Hilads CAMPAIGN challenge (group photo-proof, 2× points),
// owned by @hilads, then auto-share it to the origin city channel (city scope)
// or the World channel (world scope) with a fun join CTA.

admin_require_login();

$pdo    = Database::pdo();
$cities = CityRepository::all();
$errors = [];
$types  = ['food', 'place', 'culture', 'help'];
$post   = $_POST;

// Resolve the @hilads brand account (seeded by the migration).
$hilads = $pdo->query("SELECT id, guest_id FROM users WHERE username = 'hilads' LIMIT 1")->fetch(\PDO::FETCH_ASSOC);

/** Fire the shared message to the WS server (best-effort; message is already in DB). */
function campaign_broadcast_ws(int|string $channelId, array $message): void
{
    $wsUrl   = rtrim(getenv('WS_INTERNAL_URL') ?: 'http://localhost:8082', '/');
    $payload = json_encode(['channelId' => $channelId, 'message' => $message]);
    $token   = getenv('WS_INTERNAL_TOKEN') ?: '';
    $headers = "Content-Type: application/json\r\nContent-Length: " . strlen($payload) . "\r\n";
    if ($token !== '') $headers .= "X-Internal-Token: {$token}\r\n";
    $ctx = stream_context_create(['http' => [
        'method' => 'POST', 'header' => $headers, 'content' => $payload,
        'timeout' => 2, 'ignore_errors' => true,
    ]]);
    @file_get_contents($wsUrl . '/broadcast/message', false, $ctx);
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    csrf_verify();

    $title        = trim((string) ($post['title'] ?? ''));
    $type         = in_array($post['type'] ?? '', $types, true) ? $post['type'] : 'food';
    $audience     = ($post['audience'] ?? 'locals') === 'explorers' ? 'explorers' : 'locals';
    $scope        = ($post['scope'] ?? 'city') === 'world' ? 'world' : 'city';
    $originCityId = (int) ($post['origin_city_id'] ?? 0);
    $targetCityId = (int) ($post['target_city_id'] ?? 0);
    $deadlineDays = max(1, min(60, (int) ($post['deadline_days'] ?? 7)));
    $customCopy   = trim((string) ($post['copy'] ?? ''));

    if ($hilads === false)      $errors[] = 'The @hilads account is missing — run migrations first.';
    if ($title === '')          $errors[] = 'Title is required.';
    if ($originCityId <= 0)     $errors[] = 'Pick an origin city.';
    if ($scope === 'world' && $targetCityId <= 0) $errors[] = 'World campaigns need a target city.';
    if ($originCityId > 0 && CityRepository::findById($originCityId) === null) $errors[] = 'Unknown origin city.';

    if (empty($errors)) {
        try {
            $mode     = $scope === 'world' ? 'international' : 'local';
            $target   = $scope === 'world' ? ('city_' . $targetCityId) : null;
            $group    = ['format' => 'group', 'meet_at' => time() + $deadlineDays * 86400, 'meet_ends_at' => null];

            $challenge = ChallengeRepository::create(
                'city_' . $originCityId,      // origin city channel
                (string) $hilads['guest_id'],
                (string) $hilads['id'],
                'Hilads',
                $title, $type, $audience,
                null,                         // return clause
                $mode,
                $target,
                null,                         // proof requirements
                'public',
                'photo_proof',                // takers submit a photo
                $group,
                true                          // is_campaign → 2× points
            );

            // Auto-share: post as @hilads into the target channel with a join CTA.
            $challengeId = (string) $challenge['id'];
            $url  = 'https://hilads.live/challenge/' . $challengeId;
            $copy = $customCopy !== ''
                ? $customCopy
                : '🔥 HILADS CAMPAIGN — "' . $title . '"! Take it on and earn DOUBLE points ⚡ Rocket up the leaderboard before anyone else. Who\'s in? 👀🏆';
            $text = $copy . "\n" . $url;

            $shareChannel = $scope === 'world' ? WorldRepository::WORLD_ID : $originCityId;
            $msg = MessageRepository::add($shareChannel, (string) $hilads['guest_id'], 'Hilads', $text, (string) $hilads['id']);
            campaign_broadcast_ws($shareChannel, $msg);

            flash_set('success', 'Campaign "' . $title . '" created (2× points) and shared to ' . ($scope === 'world' ? 'the World channel' : 'the city') . '.');
            admin_redirect('/admin/challenges');
        } catch (\Throwable $e) {
            $errors[] = 'Create failed: ' . $e->getMessage();
        }
    }
}

admin_head('Create campaign');
admin_nav('/admin/campaigns');
?>
<style>
.scope-toggle { display:flex; gap:8px; }
.scope-toggle label { flex:1; text-align:center; padding:10px; border:1px solid #2a2a2a; border-radius:6px; cursor:pointer; color:#999; }
.scope-toggle input { display:none; }
.scope-toggle label:has(input:checked) { background:rgba(255,122,60,.2); border-color:#FF7A3C; color:#FF7A3C; }
#target-city-group { display:none; }
</style>

<div class="admin-main">
    <div style="margin-bottom:16px">
        <a href="/admin/challenges" class="btn btn-secondary btn-sm">← Challenges</a>
    </div>

    <h1 class="page-title">⚡ Create campaign challenge <span style="color:#FF7A3C">2× points</span></h1>

    <?= flash_html() ?>
    <?php if (!empty($errors)): ?>
        <div class="flash flash-error">
            <?php foreach ($errors as $e): ?><div><?= htmlspecialchars($e, ENT_QUOTES) ?></div><?php endforeach; ?>
        </div>
    <?php endif; ?>

    <form method="POST" action="/admin/campaigns/create" class="form-card" style="max-width:640px">
        <?= csrf_input() ?>

        <div class="form-group">
            <label for="title">Title</label>
            <input type="text" id="title" name="title" maxlength="120" required
                   value="<?= htmlspecialchars($post['title'] ?? '', ENT_QUOTES) ?>">
        </div>

        <div class="form-group">
            <label>Type</label>
            <select name="type">
                <?php foreach ($types as $t): ?>
                    <option value="<?= $t ?>" <?= ($post['type'] ?? '') === $t ? 'selected' : '' ?>><?= ucfirst($t) ?></option>
                <?php endforeach; ?>
            </select>
        </div>

        <div class="form-group">
            <label>Audience</label>
            <select name="audience">
                <option value="locals"    <?= ($post['audience'] ?? '') === 'locals'    ? 'selected' : '' ?>>Locals</option>
                <option value="explorers" <?= ($post['audience'] ?? '') === 'explorers' ? 'selected' : '' ?>>Explorers</option>
            </select>
        </div>

        <div class="form-group">
            <label>Scope</label>
            <div class="scope-toggle">
                <label><input type="radio" name="scope" value="city"  onchange="toggleScope()" <?= ($post['scope'] ?? 'city') !== 'world' ? 'checked' : '' ?>> 🏙️ City (shares to the city)</label>
                <label><input type="radio" name="scope" value="world" onchange="toggleScope()" <?= ($post['scope'] ?? '') === 'world' ? 'checked' : '' ?>> 🌍 World (shares to World)</label>
            </div>
        </div>

        <div class="form-group">
            <label for="origin_city_id">Origin city</label>
            <select id="origin_city_id" name="origin_city_id" required>
                <option value="">— pick —</option>
                <?php foreach ($cities as $c): ?>
                    <option value="<?= $c['id'] ?>" <?= (int)($post['origin_city_id'] ?? 0) === $c['id'] ? 'selected' : '' ?>>
                        <?= htmlspecialchars($c['name'], ENT_QUOTES) ?> (<?= htmlspecialchars($c['country'], ENT_QUOTES) ?>)
                    </option>
                <?php endforeach; ?>
            </select>
        </div>

        <div class="form-group" id="target-city-group">
            <label for="target_city_id">Target city (world only)</label>
            <select id="target_city_id" name="target_city_id">
                <option value="">— pick —</option>
                <?php foreach ($cities as $c): ?>
                    <option value="<?= $c['id'] ?>" <?= (int)($post['target_city_id'] ?? 0) === $c['id'] ? 'selected' : '' ?>>
                        <?= htmlspecialchars($c['name'], ENT_QUOTES) ?> (<?= htmlspecialchars($c['country'], ENT_QUOTES) ?>)
                    </option>
                <?php endforeach; ?>
            </select>
        </div>

        <div class="form-group">
            <label for="deadline_days">Submission window (days)</label>
            <input type="number" id="deadline_days" name="deadline_days" min="1" max="60"
                   value="<?= (int)($post['deadline_days'] ?? 7) ?>">
        </div>

        <div class="form-group">
            <label for="copy">Share message (optional — a fun default is used if blank)</label>
            <textarea id="copy" name="copy" rows="3" placeholder='🔥 HILADS CAMPAIGN! Take it on and earn DOUBLE points ⚡'><?= htmlspecialchars($post['copy'] ?? '', ENT_QUOTES) ?></textarea>
        </div>

        <button type="submit" class="btn btn-primary">Create &amp; share campaign 🚀</button>
    </form>
</div>

<script>
function toggleScope() {
    var world = document.querySelector('input[name=scope]:checked').value === 'world';
    document.getElementById('target-city-group').style.display = world ? 'block' : 'none';
}
toggleScope();
</script>
<?php
admin_foot();
