<?php

declare(strict_types=1);

admin_require_login();

/**
 * Admin push notification broadcast page.
 *
 * GET  /admin/push          → render form + history
 * POST /admin/push          → action=count|test|send (form-encoded, CSRF protected)
 * POST /admin/push (search) → action=search_user, AJAX-style JSON response
 *
 * Auth: admin_require_login() above. Single-user env-based auth - there's no
 * admin_users table, so audit captures the env's ADMIN_USERNAME + remote IP.
 */

// ── Constants ────────────────────────────────────────────────────────────────

const PUSH_TITLE_MAX = 80;
const PUSH_BODY_MAX  = 200;

// Common deep-link presets for the dropdown. Custom path field overrides.
const PUSH_DEEP_LINK_PRESETS = [
    ''                    => 'Open the app (default)',
    '/notifications'      => 'Notifications screen',
    '/(tabs)/now'         => 'Now feed (mobile tab)',
    '/(tabs)/me'          => 'Profile / Me tab',
    '/messages'           => 'Messages / conversations',
    '/friend-requests'    => 'Friend requests inbox',
    '/upcoming-events'    => 'Upcoming events',
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function admin_push_username(): string
{
    return (string) (getenv('ADMIN_USERNAME') ?: 'admin');
}

function admin_push_test_user_id(): ?string
{
    $id = trim((string) (getenv('ADMIN_TEST_USER_ID') ?: ''));
    return $id !== '' ? $id : null;
}

function admin_push_remote_ip(): ?string
{
    $ip = $_SERVER['REMOTE_ADDR'] ?? null;
    // INET column type - accept ipv4/ipv6, drop weird proxy chains.
    return is_string($ip) && filter_var($ip, FILTER_VALIDATE_IP) ? $ip : null;
}

/**
 * Cities the broadcast form's dropdown shows. Reuses the same source the
 * mobile / web clients use - no second source of truth.
 */
function admin_push_cities(): array
{
    return CityRepository::all();
}

/**
 * Pulls the audience filter shape out of $_POST. Returns [type, filter].
 * Validates so we never pass garbage into PushBroadcastService.
 */
function admin_push_parse_audience(): array
{
    $type = (string) ($_POST['audience_type'] ?? 'all');
    switch ($type) {
        case 'all':
            return ['all', []];
        case 'all_installs':
            return ['all_installs', []];
        case 'city':
            $channelId = (int) ($_POST['city_channel_id'] ?? 0);
            if ($channelId <= 0) admin_die('City audience requires a valid channelId.');
            return ['city', ['channelId' => $channelId]];
        case 'user':
            $userId = trim((string) ($_POST['user_id'] ?? ''));
            if (!preg_match('/^[a-f0-9]{32}$/', $userId)) {
                admin_die('User audience requires a valid 32-hex userId.');
            }
            return ['user', ['userId' => $userId]];
        default:
            admin_die('Unknown audience_type: ' . htmlspecialchars($type));
    }
}

/**
 * Letterbox an image onto a 2:1 dark canvas (contain, centered). Android's
 * big-picture notification crops to ~2:1 and would clip a portrait image; fitting
 * the WHOLE image on a 2:1 canvas guarantees nothing is cut off. Returns the path
 * to a temp JPEG, or null if GD is unavailable / the source can't be decoded.
 */
function admin_letterbox_2to1(string $srcPath, string $mime): ?string
{
    if (!extension_loaded('gd')) return null;
    $src = match ($mime) {
        'image/jpeg' => @imagecreatefromjpeg($srcPath),
        'image/png'  => @imagecreatefrompng($srcPath),
        'image/webp' => @imagecreatefromwebp($srcPath),
        default      => null,
    };
    if (!$src) return null;
    $sw = imagesx($src); $sh = imagesy($src);
    if ($sw < 1 || $sh < 1) { imagedestroy($src); return null; }

    $cw = 1080; $ch = 540;                              // 2:1 canvas
    $canvas = imagecreatetruecolor($cw, $ch);
    $bg = imagecolorallocate($canvas, 0x16, 0x13, 0x10); // app dark surface
    imagefilledrectangle($canvas, 0, 0, $cw, $ch, $bg);

    $scale = min($cw / $sw, $ch / $sh);                 // contain
    $dw = max(1, (int) round($sw * $scale));
    $dh = max(1, (int) round($sh * $scale));
    $dx = (int) (($cw - $dw) / 2);
    $dy = (int) (($ch - $dh) / 2);
    imagecopyresampled($canvas, $src, $dx, $dy, 0, 0, $dw, $dh, $sw, $sh);

    $tmp = tempnam(sys_get_temp_dir(), 'push_img');
    $ok  = imagejpeg($canvas, $tmp, 88);
    imagedestroy($src); imagedestroy($canvas);
    return $ok ? $tmp : null;
}

/**
 * Validate + letterbox + upload a campaign image to R2. Returns the public URL,
 * null when no file was selected, or throws with a user-facing message.
 */
function admin_upload_notification_image(?array $file): ?string
{
    if ($file === null || ($file['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE) {
        return null;
    }
    if ($file['error'] !== UPLOAD_ERR_OK)  throw new \RuntimeException('Image upload failed (code ' . $file['error'] . ').');
    if (!is_uploaded_file($file['tmp_name'])) throw new \RuntimeException('Invalid image upload.');
    if ($file['size'] > 5 * 1024 * 1024)   throw new \RuntimeException('Image must be under 5 MB.');

    $mime    = (new \finfo(FILEINFO_MIME_TYPE))->file($file['tmp_name']);
    $allowed = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'];
    if (!isset($allowed[$mime])) throw new \RuntimeException('Image must be a JPEG, PNG, or WebP.');

    // Letterbox so the whole picture shows in the Android big-picture push.
    $boxed = admin_letterbox_2to1($file['tmp_name'], $mime);
    $path  = $boxed ?? $file['tmp_name'];
    $upMime = $boxed ? 'image/jpeg' : $mime;
    $ext    = $boxed ? 'jpg' : $allowed[$mime];

    $filename = 'campaign-' . bin2hex(random_bytes(12)) . '.' . $ext;
    $url      = \R2Uploader::put($path, $filename, $upMime);
    if ($boxed) @unlink($boxed);
    return $url;
}

// ── POST handling ────────────────────────────────────────────────────────────

$flash      = null;
$flashError = null;
$savedTitle    = '';
$savedBody     = '';
$savedAudience = 'all';
$savedCity     = '';
$savedUserId   = '';
$savedDeepLink = '';
$savedImageUrl = '';

if ($method === 'POST') {
    csrf_verify();

    $action = (string) ($_POST['action'] ?? '');

    // Rate limit broadcast-creating actions (test + send). Search and count
    // are read-only, so they're not rate-limited. 10/hour is enough headroom
    // for testing while still blocking accidental "tap send 50 times" mistakes.
    if ($action === 'send' || $action === 'test') {
        $bucketKey = 'admin_push_broadcast|' . admin_push_username();
        if (!RateLimiter::allow($bucketKey, 10, 3600)) {
            $flashError = 'Rate limit exceeded - max 10 broadcasts per hour. Wait a bit and try again.';
            $action = 'noop';
        }
    }

    if ($action === 'search_user') {
        // AJAX endpoint: returns top-10 users matching display-name query.
        header('Content-Type: application/json');
        $q = trim((string) ($_POST['q'] ?? ''));
        echo json_encode(['users' => PushBroadcastService::searchUsers($q)]);
        exit;
    }

    if ($action === 'count') {
        // AJAX endpoint: server-computed audience count for the confirm modal.
        header('Content-Type: application/json');
        [$audienceType, $audienceFilter] = admin_push_parse_audience();
        echo json_encode(['count' => PushBroadcastService::countAudience($audienceType, $audienceFilter)]);
        exit;
    }

    if ($action === 'send' || $action === 'test') {
        $title = trim((string) ($_POST['title'] ?? ''));
        $body  = trim((string) ($_POST['body']  ?? ''));

        // Custom deep_link wins over the preset dropdown if both are set.
        $deepLinkPreset = (string) ($_POST['deep_link_preset'] ?? '');
        $deepLinkCustom = trim((string) ($_POST['deep_link_custom'] ?? ''));
        $deepLink = $deepLinkCustom !== '' ? $deepLinkCustom : ($deepLinkPreset !== '' ? $deepLinkPreset : null);

        // Optional campaign image → a big-picture, colorful "special" push
        // (Android rich notification). An uploaded file (→ R2) wins over a pasted
        // URL. Threaded into the push data as imageUrl; MobilePushService turns it
        // into richContent.
        $imageUrl  = trim((string) ($_POST['image_url'] ?? ''));
        if ($imageUrl !== '' && !preg_match('#^https://\S+#i', $imageUrl)) {
            $imageUrl = ''; // ignore non-https / malformed - degrade to a normal push
        }
        $imageUploadError = null;
        try {
            // Letterboxes to 2:1 so the whole picture shows (no Android crop).
            $uploadedImg = admin_upload_notification_image($_FILES['image_file'] ?? null);
            if ($uploadedImg !== null) $imageUrl = $uploadedImg;   // R2 public URL
        } catch (\Throwable $e) {
            $imageUploadError = 'Campaign image upload failed: ' . $e->getMessage();
        }
        $pushExtra = $imageUrl !== '' ? ['imageUrl' => $imageUrl] : [];
        $savedImageUrl = (string) ($_POST['image_url'] ?? '');

        // Extract a typed id from a challenge/event/topic deep link and attach it
        // as challengeId/eventId/topicId. The native app routes on those ids in
        // its default push handler, so the tap opens the right screen even on
        // builds that don't yet honor the generic `deepLink` path field.
        if ($deepLink !== null) {
            if (preg_match('#/challenge/(?:[a-z0-9-]+-)?([a-f0-9]{16})#i', $deepLink, $mm)) {
                $pushExtra['challengeId'] = $mm[1];
            } elseif (preg_match('#/(?:event|e)/(?:[a-z0-9-]+-)?([a-f0-9]{16})#i', $deepLink, $mm)) {
                $pushExtra['eventId'] = $mm[1];
            } elseif (preg_match('#/(?:topic|t)/(?:[a-z0-9-]+-)?([a-f0-9]{16})#i', $deepLink, $mm)) {
                $pushExtra['topicId'] = $mm[1];
            }
        }

        // Save form values for re-rendering on validation failure.
        $savedTitle    = $title;
        $savedBody     = $body;
        $savedAudience = (string) ($_POST['audience_type'] ?? 'all');
        $savedCity     = (string) ($_POST['city_channel_id'] ?? '');
        $savedUserId   = (string) ($_POST['user_id'] ?? '');
        $savedDeepLink = $deepLinkCustom !== '' ? $deepLinkCustom : $deepLinkPreset;

        if ($imageUploadError !== null) {
            $flashError = $imageUploadError;
        } elseif ($title === '' || $body === '') {
            $flashError = 'Title and body are required.';
        } elseif (mb_strlen($title) > PUSH_TITLE_MAX) {
            $flashError = 'Title is too long (max ' . PUSH_TITLE_MAX . ' chars).';
        } elseif (mb_strlen($body) > PUSH_BODY_MAX) {
            $flashError = 'Body is too long (max ' . PUSH_BODY_MAX . ' chars).';
        } else {
            try {
                if ($action === 'test') {
                    $testUserId = admin_push_test_user_id();
                    if ($testUserId === null) {
                        $flashError = 'Test send requires ADMIN_TEST_USER_ID env var to be set.';
                    } else {
                        $audienceType   = 'test';
                        $audienceFilter = ['userId' => $testUserId];
                        $userIds = PushBroadcastService::resolveAudience($audienceType, $audienceFilter);
                        if (empty($userIds)) {
                            $flashError = 'Test user not found or deleted (ADMIN_TEST_USER_ID=' . htmlspecialchars($testUserId, ENT_QUOTES) . ').';
                        } else {
                            $broadcastId = PushBroadcastService::recordBroadcast(
                                admin_push_username(), admin_push_remote_ip(),
                                $title, $body, $audienceType, $audienceFilter, $deepLink,
                                count($userIds),
                            );
                            $result = PushBroadcastService::dispatch($broadcastId, $userIds, $title, $body, $deepLink, $pushExtra);
                            $flash = "Test push sent ({$result['delivered']} delivered, {$result['failed']} failed). Form kept - edit if needed, then send to your audience.";
                            // Intentionally KEEP the form populated after a test: the
                            // whole point of a test is to verify the content, then send
                            // the SAME content to the real audience without re-typing.
                            // (Only a real "send" clears the form - see below.)
                        }
                    }
                } else {
                    [$audienceType, $audienceFilter] = admin_push_parse_audience();
                    $userIds       = PushBroadcastService::resolveAudience($audienceType, $audienceFilter);
                    // 'all_installs' also reaches unregistered guest devices, which
                    // resolveAudience can't return (no userId). They're pushed
                    // natively after the registered dispatch.
                    $includeGuests = ($audienceType === 'all_installs');
                    $guestCount    = $includeGuests ? count(PushBroadcastService::guestTokens()) : 0;
                    if (empty($userIds) && $guestCount === 0) {
                        $flashError = 'Audience resolved to 0 recipients - nothing to send.';
                    } else {
                        $broadcastId = PushBroadcastService::recordBroadcast(
                            admin_push_username(), admin_push_remote_ip(),
                            $title, $body, $audienceType, $audienceFilter, $deepLink,
                            count($userIds) + $guestCount,
                        );

                        // Defer the dispatch loop until after the response flushes
                        // so the admin doesn't sit on a hanging request while we
                        // POST 50k pushes one by one. The history table reflects
                        // sending → sent as the loop runs.
                        register_shutdown_function(static function () use ($broadcastId, $userIds, $title, $body, $deepLink, $includeGuests, $pushExtra): void {
                            if (function_exists('fastcgi_finish_request')) {
                                fastcgi_finish_request();
                            }
                            try {
                                PushBroadcastService::dispatch($broadcastId, $userIds, $title, $body, $deepLink, $pushExtra);
                                // Guest devices: native-only push after the registered
                                // dispatch sets status='sent'; this bumps delivered_count.
                                if ($includeGuests) {
                                    PushBroadcastService::dispatchGuestTokens($broadcastId, $title, $body, $deepLink, $pushExtra);
                                }
                            } catch (\Throwable $e) {
                                error_log('[admin/push] dispatch crashed for broadcast=' . $broadcastId . ' err=' . $e->getMessage());
                                PushBroadcastService::markFailed($broadcastId);
                            }
                        });

                        $flash = "Broadcast started - sending to " . count($userIds) . " registered user" . (count($userIds) === 1 ? '' : 's')
                               . ($includeGuests ? " + " . $guestCount . " unregistered guest device" . ($guestCount === 1 ? '' : 's') : "")
                               . ". Refresh the history table to watch progress.";
                        $savedTitle = $savedBody = '';
                    }
                }
            } catch (\Throwable $e) {
                error_log('[admin/push] action=' . $action . ' crashed: ' . $e->getMessage());
                $flashError = 'Send failed: ' . $e->getMessage();
            }
        }
    }
}

// ── Render ───────────────────────────────────────────────────────────────────

$cities       = admin_push_cities();
$recent       = PushBroadcastService::listRecent(50);
$testUserId   = admin_push_test_user_id();

admin_head('Push Notifications');
admin_nav('/admin/push');

?>
<div class="admin-main">
    <h1 class="page-title">Push Notifications</h1>

    <?php if ($flash): ?>
        <div class="flash flash-success"><?= htmlspecialchars($flash, ENT_QUOTES) ?></div>
    <?php endif; ?>
    <?php if ($flashError): ?>
        <div class="flash flash-error"><?= htmlspecialchars($flashError, ENT_QUOTES) ?></div>
    <?php endif; ?>

    <form method="POST" action="/admin/push" id="push-form" enctype="multipart/form-data">
        <?= csrf_input() ?>
        <input type="hidden" name="action" id="push-action" value="send">

        <div class="form-card">
            <div class="form-group">
                <label>
                    Title
                    <span style="color:#666;font-size:11px;float:right" id="title-counter">0 / <?= PUSH_TITLE_MAX ?></span>
                </label>
                <input type="text" name="title" id="push-title"
                       maxlength="<?= PUSH_TITLE_MAX ?>" required
                       value="<?= htmlspecialchars($savedTitle, ENT_QUOTES) ?>">
            </div>

            <div class="form-group">
                <label>
                    Body
                    <span style="color:#666;font-size:11px;float:right" id="body-counter">0 / <?= PUSH_BODY_MAX ?></span>
                </label>
                <textarea name="body" id="push-body" rows="3"
                          maxlength="<?= PUSH_BODY_MAX ?>" required><?= htmlspecialchars($savedBody, ENT_QUOTES) ?></textarea>
            </div>

            <div class="form-group">
                <label>Audience</label>
                <div style="display:flex;flex-direction:column;gap:8px">
                    <label style="font-weight:normal;text-transform:none;letter-spacing:0">
                        <input type="radio" name="audience_type" value="all" <?= $savedAudience === 'all' ? 'checked' : '' ?>>
                        All registered users
                    </label>
                    <label style="font-weight:normal;text-transform:none;letter-spacing:0">
                        <input type="radio" name="audience_type" value="all_installs" <?= $savedAudience === 'all_installs' ? 'checked' : '' ?>>
                        All app installs (incl. guests)
                        <span style="color:#666;font-size:11px;display:block;margin-left:22px">Registered users + unregistered guest devices. Guests get a native push only (no in-app inbox).</span>
                    </label>
                    <label style="font-weight:normal;text-transform:none;letter-spacing:0;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                        <input type="radio" name="audience_type" value="city" <?= $savedAudience === 'city' ? 'checked' : '' ?>>
                        Users active in city
                        <select name="city_channel_id" style="max-width:240px">
                            <option value="">- pick a city -</option>
                            <?php foreach ($cities as $c): ?>
                                <option value="<?= (int)$c['id'] ?>" <?= $savedCity === (string)$c['id'] ? 'selected' : '' ?>>
                                    <?= htmlspecialchars($c['name'], ENT_QUOTES) ?> (<?= htmlspecialchars($c['country'], ENT_QUOTES) ?>)
                                </option>
                            <?php endforeach; ?>
                        </select>
                    </label>
                    <label style="font-weight:normal;text-transform:none;letter-spacing:0;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                        <input type="radio" name="audience_type" value="user" <?= $savedAudience === 'user' ? 'checked' : '' ?>>
                        Specific user
                        <input type="text" id="user-search" placeholder="search by display name…" style="max-width:240px">
                        <input type="hidden" name="user_id" id="user-id" value="<?= htmlspecialchars($savedUserId, ENT_QUOTES) ?>">
                        <span id="user-search-result" style="font-size:12px;color:#888"></span>
                    </label>
                </div>
            </div>

            <div class="form-group">
                <label>Deep link (optional)</label>
                <select name="deep_link_preset" style="max-width:360px">
                    <?php foreach (PUSH_DEEP_LINK_PRESETS as $path => $label): ?>
                        <option value="<?= htmlspecialchars($path, ENT_QUOTES) ?>" <?= $savedDeepLink === $path ? 'selected' : '' ?>>
                            <?= htmlspecialchars($label, ENT_QUOTES) ?><?= $path !== '' ? ' (' . htmlspecialchars($path, ENT_QUOTES) . ')' : '' ?>
                        </option>
                    <?php endforeach; ?>
                </select>
                <div class="hint">Or custom path:</div>
                <input type="text" name="deep_link_custom" placeholder="/event/abc123… (overrides preset)"
                       value="<?= htmlspecialchars($savedDeepLink, ENT_QUOTES) ?>">
            </div>

            <div class="form-group">
                <label>🎉 Campaign image <span style="color:#666;font-weight:400">(optional — a big colorful picture for a special campaign push)</span></label>
                <input type="file" name="image_file" accept="image/jpeg,image/png,image/webp"
                       style="color:#aaa;font-size:13px;margin-bottom:8px">
                <div class="hint" style="color:#666;margin-bottom:8px">Upload a picture (JPEG / PNG / WebP, max 5 MB) — or paste a link below.</div>
                <input type="text" name="image_url" placeholder="…or an https:// image URL"
                       value="<?= htmlspecialchars($savedImageUrl, ENT_QUOTES) ?>">
                <div class="hint" style="color:#666">Turns the push into a rich, eye-catching notification (Android big-picture; iOS shows text only). Leave blank for a plain push.</div>
            </div>

            <div class="form-actions" style="display:flex;gap:12px;flex-wrap:wrap">
                <?php if ($testUserId): ?>
                    <button type="button" id="btn-test" class="btn btn-secondary">
                        Send test to me
                    </button>
                <?php else: ?>
                    <button type="button" class="btn btn-secondary" disabled
                            title="Set ADMIN_TEST_USER_ID env var to enable">
                        Send test (ADMIN_TEST_USER_ID not set)
                    </button>
                <?php endif; ?>
                <button type="button" id="btn-send" class="btn btn-primary">
                    Preview &amp; send →
                </button>
            </div>
        </div>
    </form>

    <h2 style="margin-top:32px;margin-bottom:12px;color:#ccc;font-size:18px">Recent broadcasts</h2>
    <table class="admin-table" style="width:100%">
        <thead>
            <tr>
                <th>When</th>
                <th>Admin</th>
                <th>Title</th>
                <th>Audience</th>
                <th style="text-align:right">Recipients</th>
                <th style="text-align:right">Delivered</th>
                <th style="text-align:right">Failed</th>
                <th>Status</th>
            </tr>
        </thead>
        <tbody>
            <?php if (empty($recent)): ?>
                <tr><td colspan="8" style="text-align:center;color:#666;padding:24px">No broadcasts yet.</td></tr>
            <?php endif; ?>
            <?php foreach ($recent as $r): ?>
                <?php
                    $audienceText = match ($r['audience_type']) {
                        'all'          => 'All',
                        'all_installs' => 'All installs (+guests)',
                        'city'         => 'City #' . (json_decode($r['audience_filter'], true)['channelId'] ?? '?'),
                        'user'         => 'User',
                        'test'         => 'Test (self)',
                        default        => $r['audience_type'],
                    };
                    $statusColor = match ($r['status']) {
                        'sending' => '#fbbf24',
                        'sent'    => '#4ade80',
                        'failed'  => '#f87171',
                        default   => '#888',
                    };
                ?>
                <tr>
                    <td><?= htmlspecialchars(substr((string)$r['created_at'], 0, 16), ENT_QUOTES) ?></td>
                    <td><?= htmlspecialchars((string)$r['admin_username'], ENT_QUOTES) ?></td>
                    <td title="<?= htmlspecialchars((string)$r['body'], ENT_QUOTES) ?>"><?= htmlspecialchars((string)$r['title'], ENT_QUOTES) ?></td>
                    <td><?= htmlspecialchars($audienceText, ENT_QUOTES) ?></td>
                    <td style="text-align:right"><?= number_format((int)$r['recipient_count']) ?></td>
                    <td style="text-align:right;color:#4ade80"><?= number_format((int)$r['delivered_count']) ?></td>
                    <td style="text-align:right;color:<?= ((int)$r['failed_count']) > 0 ? '#f87171' : '#666' ?>"><?= number_format((int)$r['failed_count']) ?></td>
                    <td style="color:<?= $statusColor ?>"><?= htmlspecialchars((string)$r['status'], ENT_QUOTES) ?></td>
                </tr>
            <?php endforeach; ?>
        </tbody>
    </table>
</div>

<script>
// ── Char counters ──────────────────────────────────────────────────────────
function bindCounter(inputId, counterId, max) {
    const input = document.getElementById(inputId);
    const counter = document.getElementById(counterId);
    function refresh() {
        const len = input.value.length;
        counter.textContent = len + ' / ' + max;
        counter.style.color = len > max * 0.9 ? '#fbbf24' : '#666';
    }
    input.addEventListener('input', refresh);
    refresh();
}
bindCounter('push-title', 'title-counter', <?= PUSH_TITLE_MAX ?>);
bindCounter('push-body',  'body-counter',  <?= PUSH_BODY_MAX ?>);

// ── User search (debounced AJAX hitting /admin/push action=search_user) ──
const userSearch = document.getElementById('user-search');
const userIdHidden = document.getElementById('user-id');
const userResult = document.getElementById('user-search-result');
let userSearchTimer = null;
userSearch.addEventListener('input', () => {
    clearTimeout(userSearchTimer);
    userIdHidden.value = '';
    userResult.textContent = '';
    const q = userSearch.value.trim();
    if (q.length < 2) return;
    userSearchTimer = setTimeout(async () => {
        const fd = new FormData();
        fd.append('action', 'search_user');
        fd.append('q', q);
        fd.append('csrf', document.querySelector('input[name=csrf]').value);
        const res = await fetch('/admin/push', { method: 'POST', body: fd });
        const data = await res.json();
        if (!data.users || data.users.length === 0) {
            userResult.textContent = 'no matches';
            userResult.style.color = '#888';
            return;
        }
        // Auto-pick the first match. Show "X (n more)" so the admin sees there were others.
        const top = data.users[0];
        userIdHidden.value = top.id;
        userResult.innerHTML = '✓ <strong style="color:#4ade80">' + escapeHtml(top.display_name) + '</strong>'
                             + (data.users.length > 1 ? ' <span style="color:#666">(' + (data.users.length - 1) + ' more matches - refine to pick a different one)</span>' : '');
    }, 250);
});

// ── Send / test handlers - confirm modal computes recipient count first ──
document.getElementById('btn-send').addEventListener('click', confirmAndSend);
const btnTest = document.getElementById('btn-test');
if (btnTest) btnTest.addEventListener('click', () => submitWithAction('test'));

async function confirmAndSend() {
    const form = document.getElementById('push-form');
    if (!form.reportValidity()) return;

    // Validate audience selection before hitting the count endpoint
    const audienceType = form.querySelector('input[name=audience_type]:checked').value;
    if (audienceType === 'city' && !form.querySelector('select[name=city_channel_id]').value) {
        alert('Pick a city first.');
        return;
    }
    if (audienceType === 'user' && !userIdHidden.value) {
        alert('Search for a user and let the search resolve before sending.');
        return;
    }

    // Compute recipient count server-side
    const fd = new FormData(form);
    fd.set('action', 'count');
    const res = await fetch('/admin/push', { method: 'POST', body: fd });
    const data = await res.json();
    const count = data.count || 0;
    if (count === 0) {
        alert('Audience resolves to 0 users - nothing would be sent.');
        return;
    }

    const title = form.querySelector('input[name=title]').value;
    const body  = form.querySelector('textarea[name=body]').value;
    const ok = confirm(
        '🔔 PUSH NOTIFICATION CONFIRMATION\n\n' +
        'Title: ' + title + '\n' +
        'Body:  ' + body + '\n\n' +
        'This will send to ' + count.toLocaleString() + ' user' + (count === 1 ? '' : 's') + '.\n\n' +
        'Are you sure?'
    );
    if (!ok) return;

    submitWithAction('send');
}

function submitWithAction(action) {
    document.getElementById('push-action').value = action;
    document.getElementById('push-form').submit();
}

function escapeHtml(s) {
    return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
</script>
<?php
admin_foot();
