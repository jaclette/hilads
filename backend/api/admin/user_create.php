<?php

declare(strict_types=1);

admin_require_login();

$cities         = CityRepository::all();
$errors         = [];
$post           = $_POST;
$allowedVibes   = ['party', 'board_games', 'coffee', 'music', 'food', 'chill'];
$allowedInterests = [
    'drinks', 'party', 'nightlife', 'music', 'live music', 'culture', 'art',
    'food', 'coffee', 'sport', 'fitness', 'hiking', 'beach', 'wellness',
    'travel', 'hangout', 'socializing', 'language exchange', 'dating',
    'networking', 'startup', 'tech', 'gaming',
];

if ($method === 'POST') {
    csrf_verify();

    $displayName  = mb_substr(trim($post['display_name'] ?? ''), 0, 40);
    $email        = strtolower(trim($post['email'] ?? ''));
    $password     = $post['password'] ?? '';
    $homeCity     = trim($post['home_city'] ?? '') ?: null;
    $vibe         = $post['vibe'] ?? 'chill';
    $birthYear    = ($post['birth_year'] ?? '') !== '' ? (int)$post['birth_year'] : null;
    $isFake       = isset($post['is_fake']);
    $rawInterests = (array)($post['interests'] ?? []);
    $interests    = array_values(array_filter($rawInterests, fn($i) => in_array($i, $allowedInterests, true)));

    // Validation
    if ($displayName === '') {
        $errors[] = 'Display name is required.';
    }
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        $errors[] = 'A valid email address is required.';
    }
    if (mb_strlen($password) < 8) {
        $errors[] = 'Password must be at least 8 characters.';
    } elseif (mb_strlen($password) > 72) {
        $errors[] = 'Password must not exceed 72 characters.';
    }
    if (!in_array($vibe, $allowedVibes, true)) {
        $errors[] = 'Invalid vibe selected.';
    }
    if ($birthYear !== null && ($birthYear < 1900 || $birthYear > (int)date('Y') - 13)) {
        $errors[] = 'Invalid birth year.';
    }

    // Email uniqueness check
    if (empty($errors) && UserRepository::findByEmail($email) !== null) {
        $errors[] = 'An account with this email already exists.';
    }

    if (empty($errors)) {
        try {
            $user = UserRepository::adminCreate([
                'display_name'  => $displayName,
                'email'         => $email,
                'password_hash' => password_hash($password, PASSWORD_BCRYPT),
                'home_city'     => $homeCity,
                'vibe'          => $vibe,
                'interests'     => json_encode($interests),
                'birth_year'    => $birthYear,
                'is_fake'       => $isFake,
            ]);
            flash_set('success', "User \"{$displayName}\" created successfully.");
            admin_redirect('/admin/users/' . $user['id'] . '/edit');
        } catch (\RuntimeException $e) {
            if ($e->getMessage() === 'email_already_exists') {
                $errors[] = 'An account with this email already exists.';
            } else {
                throw $e;
            }
        }
    }
}

admin_head('Create User');
admin_nav('/admin/users');
?>
<div class="admin-main">
    <div style="margin-bottom:16px">
        <a href="/admin/users" class="btn btn-secondary btn-sm">← Users</a>
    </div>

    <h1 class="page-title">Create User</h1>

    <?= flash_html() ?>

    <?php if (!empty($errors)): ?>
        <div class="flash flash-error">
            <?php foreach ($errors as $e): ?>
                <div><?= htmlspecialchars($e, ENT_QUOTES) ?></div>
            <?php endforeach; ?>
        </div>
    <?php endif; ?>

    <form method="POST" action="/admin/users/create" class="form-card" style="max-width:600px">
        <?= csrf_input() ?>

        <div class="form-group">
            <label for="display_name">Display name <span style="color:#f87171">*</span></label>
            <input type="text" id="display_name" name="display_name" maxlength="40" required
                   value="<?= htmlspecialchars($post['display_name'] ?? '', ENT_QUOTES) ?>"
                   placeholder="e.g. Sophie M.">
            <div class="hint">Max 40 characters.</div>
        </div>

        <div class="form-group">
            <label for="email">Email <span style="color:#f87171">*</span></label>
            <input type="email" id="email" name="email" required
                   value="<?= htmlspecialchars($post['email'] ?? '', ENT_QUOTES) ?>"
                   placeholder="user@example.com">
        </div>

        <div class="form-group">
            <label for="password">Password <span style="color:#f87171">*</span></label>
            <input type="password" id="password" name="password" minlength="8" maxlength="72" required
                   placeholder="Min 8 characters">
            <div class="hint">The user can reset it via the app if needed.</div>
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
                   value="<?= htmlspecialchars($post['birth_year'] ?? '', ENT_QUOTES) ?>"
                   placeholder="e.g. 1995" style="max-width:140px">
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
            <button type="submit" class="btn btn-primary">Create user</button>
            <a href="/admin/users" class="btn btn-secondary">Cancel</a>
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
