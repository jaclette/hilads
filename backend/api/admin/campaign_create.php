<?php

declare(strict_types=1);

// Admin: create a Hilads CAMPAIGN challenge (group photo-proof, 2× points),
// owned by @hilads, then auto-share it with a fun join CTA. Scope:
//   city   → rooted in one city, shared to that city's channel
//   world  → origin → target city, shared to the World channel
//   global → shown in EVERY city's feed (no origin picked; a home channel is
//            auto-assigned), shared to the World channel.

admin_require_login();

$pdo    = Database::pdo();
$cities = CityRepository::all();
$errors = [];
$types  = ['food', 'place', 'culture', 'help'];
// User-facing labels: the 'help' KEY is displayed as "Crazy" 🤪 across the app
// (the old "Help" wording is gone). Keys stay stable for data continuity.
$TYPE_LABELS = ['food' => '🍜 Food', 'place' => '📍 Place', 'culture' => '🎭 Culture', 'help' => '🤪 Crazy'];
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
    $audience     = 'locals';   // Audience is legacy/unused - always store a stable value.
    $scope        = in_array($post['scope'] ?? 'city', ['city', 'world', 'global'], true) ? $post['scope'] : 'city';
    $originCityId = (int) ($post['origin_city_id'] ?? 0);
    $targetCityId = (int) ($post['target_city_id'] ?? 0);
    $deadlineDays = max(1, min(60, (int) ($post['deadline_days'] ?? 7)));
    $customCopy   = trim((string) ($post['copy'] ?? ''));

    // Global campaigns apply to ALL cities - the admin doesn't pick an origin.
    // The challenge still needs a home channel to live in; default to the brand
    // home (Ho Chi Minh City), falling back to the first city.
    if ($scope === 'global' && $originCityId <= 0) {
        $home = null;
        foreach ($cities as $c) {
            if (stripos($c['name'], 'Ho Chi Minh') !== false || stripos($c['name'], 'Saigon') !== false) { $home = $c; break; }
        }
        $home = $home ?? ($cities[0] ?? null);
        $originCityId = $home ? (int) $home['id'] : 0;
    }

    if ($hilads === false)      $errors[] = 'The @hilads account is missing — run migrations first.';
    if ($title === '')          $errors[] = 'Title is required.';
    if ($originCityId <= 0)     $errors[] = $scope === 'global' ? 'No cities exist to host the campaign.' : 'Pick an origin city.';
    if ($scope === 'world' && $targetCityId <= 0) $errors[] = 'World campaigns need a target city.';
    if ($originCityId > 0 && CityRepository::findById($originCityId) === null) $errors[] = 'Unknown origin city.';

    if (empty($errors)) {
        try {
            // city → local (shares to that city) · world → international origin→target
            // (shares to World) · global → shown in EVERY city's feed (shares to World).
            $mode     = match ($scope) { 'world' => 'international', 'global' => 'global', default => 'local' };
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
            // Lead with the CHALLENGE TITLE (the actual ask) so people see what
            // it is, then a short DOUBLE-points hook. The title carries the message.
            $hook = $scope === 'global'
                ? '🌍 Hilads Campaign in every city — take it on for DOUBLE points! ⚡🏆'
                : '⚡ Hilads Campaign — take it on for DOUBLE points! 🏆';
            $defaultCopy = $title . "\n" . $hook;
            $copy = $customCopy !== '' ? $customCopy : $defaultCopy;
            $text = $copy . "\n" . $url;

            // city → post into that city; world & global → post into World.
            $shareChannel = $scope === 'city' ? $originCityId : WorldRepository::WORLD_ID;
            $msg = MessageRepository::add($shareChannel, (string) $hilads['guest_id'], 'Hilads', $text, (string) $hilads['id']);
            campaign_broadcast_ws($shareChannel, $msg);

            $sharedTo = match ($scope) {
                'world'  => 'the World channel',
                'global' => 'the World channel (visible in every city)',
                default  => 'the city',
            };
            flash_set('success', 'Campaign "' . $title . '" created (2× points) and shared to ' . $sharedTo . '.');
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
                    <option value="<?= $t ?>" <?= ($post['type'] ?? '') === $t ? 'selected' : '' ?>><?= $TYPE_LABELS[$t] ?? ucfirst($t) ?></option>
                <?php endforeach; ?>
            </select>
        </div>

        <div class="form-group">
            <label>Scope</label>
            <div class="scope-toggle">
                <label><input type="radio" name="scope" value="city"   onchange="toggleScope()" <?= (($post['scope'] ?? 'city') === 'city') ? 'checked' : '' ?>> 🏙️ City<br><small>shows &amp; shares in one city</small></label>
                <label><input type="radio" name="scope" value="world"  onchange="toggleScope()" <?= (($post['scope'] ?? '') === 'world') ? 'checked' : '' ?>> 🌐 World<br><small>city → target, shares to World</small></label>
                <label><input type="radio" name="scope" value="global" onchange="toggleScope()" <?= (($post['scope'] ?? '') === 'global') ? 'checked' : '' ?>> 🌍 All cities<br><small>shows in EVERY city</small></label>
            </div>
        </div>

        <div class="form-group" id="origin-city-group">
            <label for="origin_city_id">Origin city <small>(city &amp; world only — “All cities” needs none)</small></label>
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
            <label for="copy">Share message <small>(optional — blank = the challenge title + a DOUBLE points hook)</small></label>
            <textarea id="copy" name="copy" rows="3" placeholder='Leave blank to lead with the challenge title, e.g. “Find me the tastiest bánh mì” + ⚡ DOUBLE points hook'><?= htmlspecialchars($post['copy'] ?? '', ENT_QUOTES) ?></textarea>
        </div>

        <button type="submit" class="btn btn-primary">Create &amp; share campaign 🚀</button>
    </form>
</div>

<script>
function toggleScope() {
    var v = document.querySelector('input[name=scope]:checked').value;
    // World needs a target city; global needs NO origin (applies to every city).
    document.getElementById('target-city-group').style.display = (v === 'world')  ? 'block' : 'none';
    document.getElementById('origin-city-group').style.display = (v === 'global') ? 'none'  : 'block';
    // A hidden required field blocks submit - only require origin when it's shown.
    document.getElementById('origin_city_id').required = (v !== 'global');
}
toggleScope();
</script>
<?php
admin_foot();
