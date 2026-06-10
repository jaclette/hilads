<?php

declare(strict_types=1);

admin_require_login();

$user = UserRepository::findById($userId);

if ($user === null) {
    flash_set('error', 'User not found.');
    admin_redirect('/admin/users');
}

$cities           = CityRepository::all();
$errors           = [];
$allowedVibes     = ['party', 'board_games', 'coffee', 'music', 'food', 'chill'];
$allowedInterests = [
    'drinks', 'party', 'nightlife', 'music', 'live music', 'culture', 'art',
    'food', 'coffee', 'sport', 'fitness', 'hiking', 'beach', 'wellness',
    'travel', 'hangout', 'socializing', 'language exchange', 'dating',
    'networking', 'startup', 'tech', 'gaming',
];

// Decode current interests from user record
$currentInterests = json_decode($user['interests'] ?? '[]', true) ?: [];

// Use POST values on error re-render, otherwise user record values
$post = $method === 'POST' ? $_POST : [
    'display_name'  => $user['display_name'] ?? '',
    'email'         => $user['email']        ?? '',
    'home_city'     => $user['home_city']    ?? '',
    'vibe'          => $user['vibe']         ?? 'chill',
    'birth_year'    => $user['birth_year']   ?? '',
    'is_fake'       => $user['is_fake'] ? '1' : '',
    'interests'     => $currentInterests,
    // PR14 - pre-fill the score inputs with the current cached values
    // so the admin sees what they're starting from.
    'score_alltime' => (string) ($user['score_alltime'] ?? 0),
    'score_month'   => (string) ($user['score_month']   ?? 0),
    // PR16 - pre-fill the current city so the picker shows the active
    // selection. Empty string = unset (no city).
    'current_city_id' => (string) ($user['current_city_id'] ?? ''),
];

if ($method === 'POST') {
    csrf_verify();

    $displayName     = mb_substr(trim($post['display_name'] ?? ''), 0, 40);
    $email           = strtolower(trim($post['email'] ?? ''));
    $newPassword     = $post['password'] ?? '';
    $homeCity        = trim($post['home_city'] ?? '') ?: null;
    $vibe            = $post['vibe'] ?? 'chill';
    $birthYear       = ($post['birth_year'] ?? '') !== '' ? (int)$post['birth_year'] : null;
    $profilePhotoUrl = $user['profile_photo_url'] ?? null; // existing URL, may be replaced
    $isFake          = isset($post['is_fake']);
    $rawInterests    = (array)($post['interests'] ?? []);
    $interests       = array_values(array_filter($rawInterests, fn($i) => in_array($i, $allowedInterests, true)));

    $removeAvatar    = isset($post['remove_avatar']);

    // Validation
    if ($displayName === '') {
        $errors[] = 'Display name is required.';
    }
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        $errors[] = 'A valid email address is required.';
    }
    if ($newPassword !== '' && mb_strlen($newPassword) < 8) {
        $errors[] = 'New password must be at least 8 characters.';
    } elseif ($newPassword !== '' && mb_strlen($newPassword) > 72) {
        $errors[] = 'Password must not exceed 72 characters.';
    }
    if (!in_array($vibe, $allowedVibes, true)) {
        $errors[] = 'Invalid vibe selected.';
    }
    if ($birthYear !== null && ($birthYear < 1900 || $birthYear > (int)date('Y') - 13)) {
        $errors[] = 'Invalid birth year.';
    }

    // Email uniqueness - skip check if unchanged
    if (empty($errors) && $email !== ($user['email'] ?? '')) {
        if (UserRepository::findByEmail($email) !== null) {
            $errors[] = 'This email is already used by another account.';
        }
    }

    // ── Avatar ────────────────────────────────────────────────────────────────
    $newPhotoUrl = $profilePhotoUrl; // default: keep existing
    if ($removeAvatar) {
        $newPhotoUrl = null;
    } elseif (!empty($_FILES['avatar']['name'])) {
        if (empty($errors)) {
            try {
                $uploaded = admin_upload_avatar($_FILES['avatar'] ?? null);
                if ($uploaded !== null) {
                    $newPhotoUrl = $uploaded;
                }
            } catch (\RuntimeException $e) {
                $errors[] = 'Avatar: ' . $e->getMessage();
            }
        }
    }

    // PR14 - leaderboard score override. Blank input = leave unchanged.
    // Non-negative ints only; we force score_month_ref to the current UTC
    // month when a month score is provided, so the value is attributed to
    // the right monthly bucket (otherwise it'd be stranded under an old
    // month_ref and look weird in the leaderboard).
    $scoreAlltimeRaw = $post['score_alltime'] ?? '';
    $scoreMonthRaw   = $post['score_month']   ?? '';
    $scoreAlltime = $scoreAlltimeRaw !== '' ? max(0, (int) $scoreAlltimeRaw) : null;
    $scoreMonth   = $scoreMonthRaw   !== '' ? max(0, (int) $scoreMonthRaw)   : null;

    // PR16 - city-membership override. The admin picks a city from the
    // searchable list; the form posts the channel id ("city_<int>") or an
    // empty string to leave it untouched. We validate that the id parses
    // and that the city exists in our static catalog before accepting it,
    // otherwise the FK-less column would happily store garbage.
    $cityIdRaw  = trim((string) ($post['current_city_id'] ?? ''));
    $newCityId  = null; // null = no change
    if ($cityIdRaw !== '') {
        if (!preg_match('/^city_(\d+)$/', $cityIdRaw, $cm)) {
            $errors[] = 'Invalid city selection.';
        } else {
            $cityIntId = (int) $cm[1];
            if (CityRepository::findById($cityIntId) === null) {
                $errors[] = 'Selected city does not exist.';
            } else {
                $newCityId = $cityIdRaw;
            }
        }
    }

    if (empty($errors)) {
        $fields = [
            'display_name'      => $displayName,
            'email'             => $email,
            'home_city'         => $homeCity,
            'vibe'              => $vibe,
            'interests'         => json_encode($interests),
            'birth_year'        => $birthYear,
            'profile_photo_url' => $newPhotoUrl,
            'is_fake'           => $isFake,
        ];
        if ($newPassword !== '') {
            $fields['password_hash'] = password_hash($newPassword, PASSWORD_BCRYPT);
        }
        // Audit-log the score changes before the UPDATE so the old values
        // are captured. Direct error_log call - the admin journal lives in
        // ops logs alongside push-broadcast / event-edit entries.
        if ($scoreAlltime !== null && $scoreAlltime !== (int) ($user['score_alltime'] ?? 0)) {
            $fields['score_alltime'] = $scoreAlltime;
            error_log("[admin-score] user={$userId} score_alltime " . ((int) ($user['score_alltime'] ?? 0)) . " → {$scoreAlltime}");
        }
        if ($scoreMonth !== null) {
            $fields['score_month']     = $scoreMonth;
            $fields['score_month_ref'] = gmdate('Y-m');
            error_log("[admin-score] user={$userId} score_month " . ((int) ($user['score_month'] ?? 0)) . " → {$scoreMonth} (ref=" . gmdate('Y-m') . ")");
        }

        // PR16 - apply the city change. Only writes when the picker has a
        // value AND it differs from what's on file (avoid bumping the
        // set/confirmed timestamps when the admin saves the form without
        // actually touching the city). Mirrors the timestamp behavior of
        // POST /api/v1/me/city so the change reads as a deliberate switch.
        $oldCityId = (string) ($user['current_city_id'] ?? '');
        if ($newCityId !== null && $newCityId !== $oldCityId) {
            // ISO 8601 with explicit UTC offset - TIMESTAMPTZ columns parse
            // this unambiguously regardless of the Postgres session timezone.
            $nowIso = gmdate('c');
            $fields['current_city_id']                = $newCityId;
            $fields['current_city_set_at']            = $nowIso;
            $fields['current_city_last_confirmed_at'] = $nowIso;
            error_log("[admin-city] user={$userId} current_city_id {$oldCityId} → {$newCityId}");
        }

        $user = UserRepository::adminUpdate($userId, $fields);

        // PR16 - alongside the current_city_id update, upsert the legacy
        // user_city_memberships row so the user shows up in that city's
        // members list under both feature-flag modes (same as POST /me/city).
        if ($newCityId !== null && $newCityId !== $oldCityId) {
            try {
                Database::pdo()->prepare("
                    INSERT INTO user_city_memberships (user_id, channel_id, first_seen_at, last_seen_at)
                    VALUES (?, ?, now(), now())
                    ON CONFLICT (user_id, channel_id) DO UPDATE SET last_seen_at = now()
                ")->execute([$userId, $newCityId]);
            } catch (\Throwable $e) {
                error_log('[admin-city] membership upsert failed: ' . $e->getMessage());
            }
        }

        // Monthly-rank recalc on admin-driven score / city changes. These
        // paths bypass the score_events DB triggers (direct UPDATE on
        // users), so the rank columns would otherwise go stale until an
        // organic score change in the same scope. Two cases:
        //   - score_month override → recalc the user's home city + world
        //   - current_city_id move  → recalc old + new city
        if ($scoreMonth !== null) {
            MonthlyRankService::recalcAfterScoreChange($userId);
        }
        if ($newCityId !== null && $newCityId !== $oldCityId) {
            MonthlyRankService::recalcAfterCityChange($userId, $oldCityId ?: null, $newCityId);
        }

        flash_set('success', 'User updated successfully.');
        admin_redirect("/admin/users/{$userId}/edit");
    }
}

// Fetch roles for this user
$roleStmt = Database::pdo()->prepare("
    SELECT ucr.role, ucr.city_id, c.name AS city_name
    FROM user_city_roles ucr
    JOIN channels c ON c.id = ucr.city_id
    WHERE ucr.user_id = ?
    ORDER BY c.name
");
$roleStmt->execute([$userId]);
$roles = $roleStmt->fetchAll();

$isDeleted = $user['deleted_at'] !== null;

admin_head('Edit User');
admin_nav('/admin/users');
?>
<div class="admin-main">
    <div style="margin-bottom:16px">
        <a href="/admin/users" class="btn btn-secondary btn-sm">← Users</a>
    </div>

    <h1 class="page-title">
        Edit User
        <?php if ($user['is_fake']): ?>
            <span class="badge badge-fake" style="font-size:12px;vertical-align:middle">Fake</span>
        <?php endif; ?>
        <?php if ($isDeleted): ?>
            <span class="badge badge-deleted" style="font-size:12px;vertical-align:middle">Deleted</span>
        <?php endif; ?>
    </h1>

    <?= flash_html() ?>

    <?php if ($isDeleted): ?>
        <div class="warning-box" style="margin-bottom:20px">
            This account was soft-deleted on <?= date('Y-m-d H:i', strtotime($user['deleted_at'])) ?>.
            All sessions were cleared. Data is preserved. Editing is still possible.
        </div>
    <?php endif; ?>

    <!-- Profile info summary -->
    <div class="info-section" style="margin-bottom:24px">
        <div class="info-grid">
            <span class="info-label">User ID</span>
            <span class="info-value"><?= htmlspecialchars($user['id'], ENT_QUOTES) ?></span>
            <span class="info-label">Auth type</span>
            <span class="info-value">
                <?= $user['google_id'] ? 'Google' : ($user['email'] ? 'Email/password' : 'Guest only') ?>
            </span>
            <?php if ($user['guest_id']): ?>
            <span class="info-label">Guest ID</span>
            <span class="info-value"><?= htmlspecialchars($user['guest_id'], ENT_QUOTES) ?></span>
            <?php endif; ?>
            <?php if (!empty($roles)): ?>
            <span class="info-label">City roles</span>
            <span class="info-value">
                <?php foreach ($roles as $r): ?>
                    <?= htmlspecialchars($r['city_name'] . ' (' . $r['role'] . ')', ENT_QUOTES) ?>
                <?php endforeach; ?>
            </span>
            <?php endif; ?>
        </div>
    </div>

    <?php if (!empty($errors)): ?>
        <div class="flash flash-error">
            <?php foreach ($errors as $e): ?>
                <div><?= htmlspecialchars($e, ENT_QUOTES) ?></div>
            <?php endforeach; ?>
        </div>
    <?php endif; ?>

    <form method="POST" action="/admin/users/<?= urlencode($userId) ?>/edit"
          class="form-card" style="max-width:600px"
          enctype="multipart/form-data">
        <?= csrf_input() ?>

        <!-- ── Avatar ──────────────────────────────────────────────────────── -->
        <?php $currentPhoto = $user['profile_photo_url'] ?? null; ?>
        <div class="form-group">
            <label>Avatar</label>
            <div class="avatar-picker">
                <div class="avatar-preview" id="avatar-preview">
                    <?php if ($currentPhoto): ?>
                        <img id="avatar-preview-img"
                             src="<?= htmlspecialchars($currentPhoto, ENT_QUOTES) ?>"
                             alt="Avatar"
                             style="width:100%;height:100%;object-fit:cover;border-radius:50%">
                        <span class="avatar-placeholder" id="avatar-placeholder" style="display:none">
                            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                                <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
                            </svg>
                        </span>
                    <?php else: ?>
                        <span class="avatar-placeholder" id="avatar-placeholder">
                            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                                <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
                            </svg>
                        </span>
                        <img id="avatar-preview-img" src="" alt="" style="display:none;width:100%;height:100%;object-fit:cover;border-radius:50%">
                    <?php endif; ?>
                </div>
                <div class="avatar-actions">
                    <label for="avatar" class="btn btn-secondary btn-sm" style="cursor:pointer">
                        <?= $currentPhoto ? 'Replace image' : 'Choose image' ?>
                    </label>
                    <input type="file" id="avatar" name="avatar"
                           accept="image/jpeg,image/png,image/webp"
                           style="display:none"
                           onchange="handleAvatarChange(this)">
                    <?php if ($currentPhoto): ?>
                        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px;color:#aaa">
                            <input type="checkbox" name="remove_avatar" value="1" id="remove_avatar" style="width:auto"
                                   onchange="handleRemoveToggle(this)">
                            Remove avatar
                        </label>
                    <?php endif; ?>
                    <div class="hint" style="margin-top:2px">JPEG, PNG or WebP · Max 5 MB</div>
                </div>
            </div>
        </div>

        <hr class="section-divider">

        <div class="form-group">
            <label for="display_name">Display name <span style="color:#f87171">*</span></label>
            <input type="text" id="display_name" name="display_name" maxlength="40" required
                   value="<?= htmlspecialchars($post['display_name'] ?? '', ENT_QUOTES) ?>">
        </div>

        <div class="form-group">
            <label for="email">Email <span style="color:#f87171">*</span></label>
            <input type="email" id="email" name="email" required
                   value="<?= htmlspecialchars($post['email'] ?? '', ENT_QUOTES) ?>">
        </div>

        <div class="form-group">
            <label for="password">New password <span style="color:#555">(leave blank to keep current)</span></label>
            <input type="password" id="password" name="password" minlength="8" maxlength="72"
                   placeholder="Leave blank to keep unchanged">
        </div>

        <hr class="section-divider">

        <div class="form-group">
            <label for="home_city_search">Home city</label>
            <?php $selectedHomeCity = (string)($post['home_city'] ?? ''); ?>
            <div class="city-picker">
                <input type="text" id="home_city_search" class="city-picker-search"
                       autocomplete="off" placeholder="Search <?= count($cities) ?> cities..."
                       value="<?= htmlspecialchars($selectedHomeCity, ENT_QUOTES) ?>">
                <input type="hidden" id="home_city" name="home_city"
                       value="<?= htmlspecialchars($selectedHomeCity, ENT_QUOTES) ?>">
                <ul class="city-picker-options" hidden></ul>
            </div>
            <div class="hint">Type to search. Leave blank for none.</div>
        </div>

        <!-- PR16 - Live city (current_city_id) override. Searchable list of
             every city in the catalog. The admin picks one and Save commits:
             writes users.current_city_id + bumps set/confirmed timestamps and
             upserts user_city_memberships so the user appears in that city's
             roster under both feature-flag modes. -->
        <?php
            $currentCityRaw = (string) ($post['current_city_id'] ?? '');
            $currentCityNum = preg_match('/^city_(\d+)$/', $currentCityRaw, $cm) ? (int) $cm[1] : null;
            $currentCityRow = $currentCityNum !== null ? CityRepository::findById($currentCityNum) : null;
            $currentCityLbl = $currentCityRow
                ? ($currentCityRow['name'] . ' (' . $currentCityRow['country'] . ')')
                : '- none -';
        ?>
        <div class="form-group">
            <label>Live city (current_city_id)</label>
            <p style="margin:-2px 0 8px;color:#888;font-size:12px">
                Drives city-member status, the NOW screen, and the city chat.
                Current: <strong style="color:#ddd"><?= htmlspecialchars($currentCityLbl, ENT_QUOTES) ?></strong>
            </p>
            <input
                type="text"
                id="city-search"
                placeholder="🔎 Search by city or country…"
                autocomplete="off"
                style="margin-bottom:6px"
            >
            <select id="current_city_id" name="current_city_id" size="8" style="width:100%;font-family:inherit;font-size:13px">
                <option value="" <?= $currentCityRaw === '' ? 'selected' : '' ?>>- No city -</option>
                <?php foreach ($cities as $c):
                    $optVal   = 'city_' . $c['id'];
                    $optLabel = $c['name'] . ' (' . $c['country'] . ')';
                    $haystack = mb_strtolower($optLabel);
                ?>
                    <option value="<?= htmlspecialchars($optVal, ENT_QUOTES) ?>"
                            data-search="<?= htmlspecialchars($haystack, ENT_QUOTES) ?>"
                            <?= $currentCityRaw === $optVal ? 'selected' : '' ?>>
                        <?= htmlspecialchars($optLabel, ENT_QUOTES) ?>
                    </option>
                <?php endforeach; ?>
            </select>
        </div>

        <div class="form-group">
            <label for="vibe">Vibe</label>
            <select id="vibe" name="vibe">
                <?php
                $vibeLabels = [
                    'chill'       => 'Chill',
                    'party'       => 'Party',
                    'board_games' => 'Board games',
                    'coffee'      => 'Coffee',
                    'music'       => 'Music',
                    'food'        => 'Food',
                ];
                foreach ($vibeLabels as $val => $label):
                ?>
                    <option value="<?= $val ?>" <?= ($post['vibe'] ?? 'chill') === $val ? 'selected' : '' ?>><?= $label ?></option>
                <?php endforeach; ?>
            </select>
        </div>

        <div class="form-group">
            <label for="birth_year">Birth year <span style="color:#555">(optional)</span></label>
            <input type="number" id="birth_year" name="birth_year" min="1900" max="<?= (int)date('Y') - 13 ?>"
                   value="<?= htmlspecialchars((string)($post['birth_year'] ?? ''), ENT_QUOTES) ?>"
                   style="max-width:140px">
        </div>

        <div class="form-group">
            <label>Interests</label>
            <div class="interests-grid">
                <?php foreach ($allowedInterests as $interest): ?>
                    <?php $checked = in_array($interest, (array)($post['interests'] ?? []), true); ?>
                    <label class="interest-item">
                        <input type="checkbox" name="interests[]" value="<?= htmlspecialchars($interest, ENT_QUOTES) ?>" <?= $checked ? 'checked' : '' ?>>
                        <?= htmlspecialchars($interest, ENT_QUOTES) ?>
                    </label>
                <?php endforeach; ?>
            </div>
        </div>

        <hr class="section-divider">

        <div class="form-group">
            <label style="display:flex;align-items:center;gap:10px;cursor:pointer">
                <input type="checkbox" name="is_fake" value="1" <?= !empty($post['is_fake']) ? 'checked' : '' ?> style="width:auto">
                <span>Fake / seeded user <span style="color:#555;font-size:11px">(admin-only, never shown to users)</span></span>
            </label>
        </div>

        <hr class="section-divider">

        <!-- PR14 - leaderboard score override. Direct mutation of the cached
             users.score_* columns; bypasses the score_events ledger. Used for
             moderation / seed-data corrections / leaderboard tuning. The
             score_month_ref is force-set to the current UTC month when the
             month value changes, so the value lands in the right bucket. -->
        <div style="margin-bottom:8px">
            <h3 style="margin:0 0 4px;font-size:14px;font-weight:700">🏆 Leaderboard score</h3>
            <p style="margin:0 0 12px;color:#888;font-size:12px">
                Direct override of <code>users.score_alltime</code> / <code>users.score_month</code>.
                Bypasses the <code>score_events</code> ledger. Leave blank to keep current.
            </p>
        </div>
        <div class="form-group" style="display:flex;gap:12px">
            <div style="flex:1">
                <label>All-time points</label>
                <input
                    type="number"
                    name="score_alltime"
                    min="0"
                    step="1"
                    value="<?= htmlspecialchars((string) ($post['score_alltime'] ?? ''), ENT_QUOTES) ?>"
                    placeholder="0"
                >
            </div>
            <div style="flex:1">
                <label>This month (<?= htmlspecialchars(gmdate('Y-m'), ENT_QUOTES) ?>)</label>
                <input
                    type="number"
                    name="score_month"
                    min="0"
                    step="1"
                    value="<?= htmlspecialchars((string) ($post['score_month'] ?? ''), ENT_QUOTES) ?>"
                    placeholder="0"
                >
            </div>
        </div>

        <div class="form-actions">
            <button type="submit" class="btn btn-primary">Save changes</button>
            <a href="/admin/users/<?= urlencode($userId) ?>/roles" class="btn btn-secondary">Manage roles</a>
            <?php if (!$isDeleted): ?>
                <form method="POST" action="/admin/users/<?= urlencode($userId) ?>/delete"
                      style="margin:0"
                      onsubmit="return confirm('Delete user «<?= htmlspecialchars(addslashes($user['display_name'] ?? ''), ENT_QUOTES) ?>»?\n\nThis will deactivate their account and sign them out.\nMessages and events will be preserved.\n\nThis can be reversed by an engineer.')">
                    <?= csrf_input() ?>
                    <button type="submit" class="btn btn-danger">Delete user</button>
                </form>
            <?php endif; ?>
        </div>
    </form>
</div>

<script>
(function () {
    const CITIES = <?= json_encode(
        array_map(static fn(array $c): array => [
            'name'    => (string) ($c['name']    ?? ''),
            'country' => (string) ($c['country'] ?? ''),
        ], $cities),
        JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE,
    ) ?>;
    initCityPickers(CITIES);
})();
</script>

<style>
/* Avatar picker */
.avatar-picker { display:flex; align-items:center; gap:20px; }
.avatar-preview {
    width:80px; height:80px; border-radius:50%;
    background:#1a1a1a; border:2px dashed #333;
    display:flex; align-items:center; justify-content:center;
    flex-shrink:0; overflow:hidden; transition:border-color .15s;
}
.avatar-preview:has(img:not([style*="display:none"])) { border-style:solid; border-color:#FF7A3C; }
.avatar-placeholder { color:#444; display:flex; align-items:center; justify-content:center; }
.avatar-actions { display:flex; flex-direction:column; gap:8px; align-items:flex-start; }

/* Interests */
.interests-grid { display:flex; flex-wrap:wrap; gap:6px; }
.interest-item { display:flex; align-items:center; gap:5px; padding:4px 10px; border:1px solid #2a2a2a; border-radius:5px; font-size:12px; color:#888; cursor:pointer; }
.interest-item:has(input:checked) { border-color:#FF7A3C; color:#FF7A3C; background:rgba(255,122,60,.08); }
.interest-item input[type=checkbox] { display:none; }
</style>

<script>
function handleAvatarChange(input) {
    const file = input.files[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
        alert('Avatar must be under 5 MB.');
        input.value = '';
        return;
    }

    // Uncheck "remove" if user picks a new file
    const rem = document.getElementById('remove_avatar');
    if (rem) rem.checked = false;

    const reader = new FileReader();
    reader.onload = function (e) {
        const img = document.getElementById('avatar-preview-img');
        const ph  = document.getElementById('avatar-placeholder');
        img.src           = e.target.result;
        img.style.display = 'block';
        ph.style.display  = 'none';
    };
    reader.readAsDataURL(file);
}

// PR16 - client-side filter for the live-city picker. The full city list
// ships in the <select>; the search input hides options whose data-search
// haystack ("name (country)" lowercased) doesn't include the query. Pure
// JS, no deps, no network - works against ~hundreds of cities instantly.
(function () {
    const search = document.getElementById('city-search');
    const select = document.getElementById('current_city_id');
    if (!search || !select) return;
    search.addEventListener('input', function (e) {
        const q = (e.target.value || '').trim().toLowerCase();
        for (const opt of select.options) {
            if (!opt.value) continue; // keep "- No city -" visible
            const hay = opt.dataset.search || opt.text.toLowerCase();
            opt.hidden = q !== '' && !hay.includes(q);
        }
    });
})();

function handleRemoveToggle(cb) {
    const img = document.getElementById('avatar-preview-img');
    const ph  = document.getElementById('avatar-placeholder');
    const fileInput = document.getElementById('avatar');
    if (cb.checked) {
        // Show placeholder, hide preview
        img.style.display = 'none';
        ph.style.display  = 'flex';
        if (fileInput) fileInput.value = '';
    } else {
        // Restore original avatar
        const original = img.dataset.original || img.src;
        img.src           = original;
        img.style.display = 'block';
        ph.style.display  = 'none';
    }
}
</script>
<?php
admin_foot();
