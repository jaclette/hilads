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
    'display_name'      => $user['display_name']      ?? '',
    'email'             => $user['email']              ?? '',
    'home_city'         => $user['home_city']          ?? '',
    'vibe'              => $user['vibe']               ?? 'chill',
    'birth_year'        => $user['birth_year']         ?? '',
    'profile_photo_url' => $user['profile_photo_url']  ?? '',
    'is_fake'           => $user['is_fake'] ? '1' : '',
    'interests'         => $currentInterests,
];

if ($method === 'POST') {
    csrf_verify();

    $displayName     = mb_substr(trim($post['display_name'] ?? ''), 0, 40);
    $email           = strtolower(trim($post['email'] ?? ''));
    $newPassword     = $post['password'] ?? '';
    $homeCity        = trim($post['home_city'] ?? '') ?: null;
    $vibe            = $post['vibe'] ?? 'chill';
    $birthYear       = ($post['birth_year'] ?? '') !== '' ? (int)$post['birth_year'] : null;
    $profilePhotoUrl = trim($post['profile_photo_url'] ?? '') ?: null;
    $isFake          = isset($post['is_fake']);
    $rawInterests    = (array)($post['interests'] ?? []);
    $interests       = array_values(array_filter($rawInterests, fn($i) => in_array($i, $allowedInterests, true)));

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

    // Email uniqueness — skip check if unchanged
    if (empty($errors) && $email !== ($user['email'] ?? '')) {
        if (UserRepository::findByEmail($email) !== null) {
            $errors[] = 'This email is already used by another account.';
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
            'profile_photo_url' => $profilePhotoUrl,
            'is_fake'           => $isFake,
        ];
        if ($newPassword !== '') {
            $fields['password_hash'] = password_hash($newPassword, PASSWORD_BCRYPT);
        }
        $user = UserRepository::adminUpdate($userId, $fields);
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

    <form method="POST" action="/admin/users/<?= urlencode($userId) ?>/edit" class="form-card" style="max-width:600px">
        <?= csrf_input() ?>

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
            <label for="home_city">Home city</label>
            <input type="text" id="home_city" name="home_city"
                   value="<?= htmlspecialchars($post['home_city'] ?? '', ENT_QUOTES) ?>"
                   list="cities-list" placeholder="e.g. Paris">
            <datalist id="cities-list">
                <?php foreach ($cities as $c): ?>
                    <option value="<?= htmlspecialchars($c['name'], ENT_QUOTES) ?>">
                <?php endforeach; ?>
            </datalist>
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
            <label for="profile_photo_url">Profile photo URL <span style="color:#555">(optional)</span></label>
            <input type="url" id="profile_photo_url" name="profile_photo_url"
                   value="<?= htmlspecialchars($post['profile_photo_url'] ?? '', ENT_QUOTES) ?>"
                   placeholder="https://...">
            <?php if (!empty($post['profile_photo_url'])): ?>
                <div style="margin-top:8px">
                    <img src="<?= htmlspecialchars($post['profile_photo_url'], ENT_QUOTES) ?>"
                         alt="avatar" style="width:48px;height:48px;border-radius:50%;object-fit:cover;border:1px solid #333">
                </div>
            <?php endif; ?>
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
<style>
.interests-grid { display:flex; flex-wrap:wrap; gap:6px; }
.interest-item { display:flex; align-items:center; gap:5px; padding:4px 10px; border:1px solid #2a2a2a; border-radius:5px; font-size:12px; color:#888; cursor:pointer; }
.interest-item:has(input:checked) { border-color:#FF7A3C; color:#FF7A3C; background:rgba(255,122,60,.08); }
.interest-item input[type=checkbox] { display:none; }
</style>
<?php
admin_foot();
