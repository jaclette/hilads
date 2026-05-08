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
 * Auth: admin_require_login() above. Single-user env-based auth — there's no
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
    // INET column type — accept ipv4/ipv6, drop weird proxy chains.
    return is_string($ip) && filter_var($ip, FILTER_VALIDATE_IP) ? $ip : null;
}

/**
 * Cities the broadcast form's dropdown shows. Reuses the same source the
 * mobile / web clients use — no second source of truth.
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

// ── POST handling ────────────────────────────────────────────────────────────

$flash      = null;
$flashError = null;
$savedTitle    = '';
$savedBody     = '';
$savedAudience = 'all';
$savedCity     = '';
$savedUserId   = '';
$savedDeepLink = '';

if ($method === 'POST') {
    csrf_verify();

    $action = (string) ($_POST['action'] ?? '');

    // Rate limit broadcast-creating actions (test + send). Search and count
    // are read-only, so they're not rate-limited. 10/hour is enough headroom
    // for testing while still blocking accidental "tap send 50 times" mistakes.
    if ($action === 'send' || $action === 'test') {
        $bucketKey = 'admin_push_broadcast|' . admin_push_username();
        if (!RateLimiter::allow($bucketKey, 10, 3600)) {
            $flashError = 'Rate limit exceeded — max 10 broadcasts per hour. Wait a bit and try again.';
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

        // Save form values for re-rendering on validation failure.
        $savedTitle    = $title;
        $savedBody     = $body;
        $savedAudience = (string) ($_POST['audience_type'] ?? 'all');
        $savedCity     = (string) ($_POST['city_channel_id'] ?? '');
        $savedUserId   = (string) ($_POST['user_id'] ?? '');
        $savedDeepLink = $deepLinkCustom !== '' ? $deepLinkCustom : $deepLinkPreset;

        if ($title === '' || $body === '') {
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
                            $result = PushBroadcastService::dispatch($broadcastId, $userIds, $title, $body, $deepLink);
                            $flash = "Test push sent ({$result['delivered']} delivered, {$result['failed']} failed).";
                            // Reset the form on a successful send so we don't accidentally
                            // re-broadcast on refresh.
                            $savedTitle = $savedBody = '';
                        }
                    }
                } else {
                    [$audienceType, $audienceFilter] = admin_push_parse_audience();
                    $userIds = PushBroadcastService::resolveAudience($audienceType, $audienceFilter);
                    if (empty($userIds)) {
                        $flashError = 'Audience resolved to 0 users — nothing to send.';
                    } else {
                        $broadcastId = PushBroadcastService::recordBroadcast(
                            admin_push_username(), admin_push_remote_ip(),
                            $title, $body, $audienceType, $audienceFilter, $deepLink,
                            count($userIds),
                        );

                        // Defer the dispatch loop until after the response flushes
                        // so the admin doesn't sit on a hanging request while we
                        // POST 50k pushes one by one. The history table reflects
                        // sending → sent as the loop runs.
                        register_shutdown_function(static function () use ($broadcastId, $userIds, $title, $body, $deepLink): void {
                            if (function_exists('fastcgi_finish_request')) {
                                fastcgi_finish_request();
                            }
                            try {
                                PushBroadcastService::dispatch($broadcastId, $userIds, $title, $body, $deepLink);
                            } catch (\Throwable $e) {
                                error_log('[admin/push] dispatch crashed for broadcast=' . $broadcastId . ' err=' . $e->getMessage());
                                PushBroadcastService::markFailed($broadcastId);
                            }
                        });

                        $flash = "Broadcast started — sending to " . count($userIds) . " user" . (count($userIds) === 1 ? '' : 's') . ". Refresh the history table to watch progress.";
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

    <form method="POST" action="/admin/push" id="push-form">
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
                    <label style="font-weight:normal;text-transform:none;letter-spacing:0;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                        <input type="radio" name="audience_type" value="city" <?= $savedAudience === 'city' ? 'checked' : '' ?>>
                        Users active in city
                        <select name="city_channel_id" style="max-width:240px">
                            <option value="">— pick a city —</option>
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
                        'all'   => 'All',
                        'city'  => 'City #' . (json_decode($r['audience_filter'], true)['channelId'] ?? '?'),
                        'user'  => 'User',
                        'test'  => 'Test (self)',
                        default => $r['audience_type'],
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
                             + (data.users.length > 1 ? ' <span style="color:#666">(' + (data.users.length - 1) + ' more matches — refine to pick a different one)</span>' : '');
    }, 250);
});

// ── Send / test handlers — confirm modal computes recipient count first ──
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
        alert('Audience resolves to 0 users — nothing would be sent.');
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
