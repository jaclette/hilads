<?php

declare(strict_types=1);

admin_require_login();

$pdo        = Database::pdo();
$cities     = CityRepository::all();
$categories = TopicRepository::allowedCategories();
$errors     = [];
$post       = $_POST;

if ($method === 'POST') {
    csrf_verify();

    $cityId      = (int) ($post['city_id'] ?? 0);
    $title       = trim($post['title'] ?? '');
    $description = trim($post['description'] ?? '') ?: null;
    $category    = $post['category'] ?? 'general';
    $creatorId   = trim($post['creator_id'] ?? '') ?: null;
    $ttlHours    = max(1, min(168, (int) ($post['ttl_hours'] ?? 24)));

    // ── Validation ────────────────────────────────────────────────────────────

    $city = $cityId > 0 ? CityRepository::findById($cityId) : null;
    if ($city === null) {
        $errors[] = 'Select a valid city.';
    }
    if ($title === '') {
        $errors[] = 'Title is required.';
    } elseif (mb_strlen($title) > 100) {
        $errors[] = 'Title must be 100 characters or fewer.';
    }
    if (!in_array($category, $categories, true)) {
        $category = 'general';
    }
    if ($description !== null && mb_strlen($description) > 500) {
        $errors[] = 'Description must be 500 characters or fewer.';
    }

    // ── Creator lookup ────────────────────────────────────────────────────────

    $creatorUser = null;
    if ($creatorId !== null) {
        $creatorUser = UserRepository::findById($creatorId);
        if ($creatorUser === null) {
            $errors[] = 'Selected creator not found.';
        }
    }

    // ── Create ────────────────────────────────────────────────────────────────

    if (empty($errors)) {
        $cityChannelId = 'city_' . $cityId;
        $topicId = TopicRepository::adminCreate(
            $cityChannelId,
            $title,
            $description,
            $category,
            $creatorUser['id'] ?? null,
            $ttlHours
        );
        error_log('[admin] topic created: "' . $title . '" (' . $topicId . ') in city ' . $cityId);
        flash_set('success', 'Topic "' . $title . '" created successfully.');
        admin_redirect('/admin/topics');
    }
}

$CATEGORY_LABELS = [
    'general' => '💬 General',
    'tips'    => '💡 Tips',
    'food'    => '🍴 Food',
    'drinks'  => '🍺 Drinks',
    'help'    => '🙋 Help',
    'meetup'  => '👋 Meetup',
];

admin_head('Create Topic');
admin_nav('/admin/topics');
?>
<div class="admin-main">
    <div style="margin-bottom:16px">
        <a href="/admin/topics" class="btn btn-secondary btn-sm">← Topics</a>
    </div>

    <h1 class="page-title">Create Topic</h1>

    <?= flash_html() ?>

    <?php if (!empty($errors)): ?>
        <div class="flash flash-error">
            <?php foreach ($errors as $e): ?>
                <div><?= htmlspecialchars($e, ENT_QUOTES) ?></div>
            <?php endforeach; ?>
        </div>
    <?php endif; ?>

    <form method="POST" action="/admin/topics/create" class="form-card">
        <?= csrf_input() ?>

        <!-- City -->
        <div class="form-group">
            <label for="city_id">City <span style="color:#ef4444">*</span></label>
            <select id="city_id" name="city_id" onchange="loadMembers(this.value)" required>
                <option value="">— Select city —</option>
                <?php foreach ($cities as $c): ?>
                    <option value="<?= $c['id'] ?>"
                        <?= (int) ($post['city_id'] ?? 0) === $c['id'] ? 'selected' : '' ?>>
                        <?= htmlspecialchars($c['name'], ENT_QUOTES) ?>
                        (<?= htmlspecialchars($c['country'] ?? '', ENT_QUOTES) ?>)
                    </option>
                <?php endforeach; ?>
            </select>
        </div>

        <!-- Title -->
        <div class="form-group">
            <label for="title">Title <span style="color:#ef4444">*</span></label>
            <input type="text" id="title" name="title" maxlength="100" required
                   value="<?= htmlspecialchars($post['title'] ?? '', ENT_QUOTES) ?>"
                   placeholder="e.g. Best rooftop bars in the city?">
            <div class="hint">Max 100 characters.</div>
        </div>

        <!-- Category -->
        <div class="form-group">
            <label for="category">Category</label>
            <select id="category" name="category">
                <?php foreach ($CATEGORY_LABELS as $val => $label): ?>
                    <option value="<?= $val ?>"
                        <?= ($post['category'] ?? 'general') === $val ? 'selected' : '' ?>>
                        <?= htmlspecialchars($label, ENT_QUOTES) ?>
                    </option>
                <?php endforeach; ?>
            </select>
        </div>

        <!-- Description -->
        <div class="form-group">
            <label for="description">Description <span style="color:#555">(optional)</span></label>
            <textarea id="description" name="description" maxlength="500"
                      placeholder="Short context for this conversation…"><?= htmlspecialchars($post['description'] ?? '', ENT_QUOTES) ?></textarea>
            <div class="hint">Max 500 characters.</div>
        </div>

        <!-- Expiry -->
        <div class="form-group">
            <label for="ttl_hours">Expires in</label>
            <select id="ttl_hours" name="ttl_hours">
                <?php
                $ttlOptions = [6 => '6 hours', 12 => '12 hours', 24 => '24 hours (default)', 48 => '48 hours', 72 => '3 days'];
                $selTtl = (int) ($post['ttl_hours'] ?? 24);
                foreach ($ttlOptions as $h => $label):
                ?>
                    <option value="<?= $h ?>" <?= $selTtl === $h ? 'selected' : '' ?>>
                        <?= htmlspecialchars($label, ENT_QUOTES) ?>
                    </option>
                <?php endforeach; ?>
            </select>
        </div>

        <!-- Creator -->
        <div class="form-group">
            <label for="creator_id">Creator <span style="color:#555">(optional)</span></label>
            <select id="creator_id" name="creator_id">
                <option value="">— Admin / no specific creator —</option>
                <?php
                // Re-populate members after validation failure
                $preloadCityId = (int) ($post['city_id'] ?? 0);
                if ($preloadCityId > 0) {
                    $preloadCity = CityRepository::findById($preloadCityId);
                    if ($preloadCity) {
                        $ck   = 'city_' . $preloadCityId;
                        $stmt = $pdo->prepare("
                            SELECT DISTINCT u.id, u.display_name
                            FROM users u
                            LEFT JOIN user_city_memberships m ON m.user_id = u.id AND m.channel_id = :ck
                            WHERE u.deleted_at IS NULL
                              AND (m.channel_id IS NOT NULL
                                   OR LOWER(TRIM(COALESCE(u.home_city, ''))) = LOWER(TRIM(:cn)))
                            ORDER BY u.display_name ASC
                            LIMIT 100
                        ");
                        $stmt->execute([':ck' => $ck, ':cn' => $preloadCity['name']]);
                        foreach ($stmt->fetchAll() as $member) {
                            $sel = ($post['creator_id'] ?? '') === $member['id'] ? 'selected' : '';
                            echo '<option value="' . htmlspecialchars($member['id'], ENT_QUOTES) . '" ' . $sel . '>'
                               . htmlspecialchars($member['display_name'], ENT_QUOTES) . '</option>';
                        }
                    }
                }
                ?>
            </select>
            <div class="hint">Select a city member as the topic creator, or leave blank.</div>
        </div>

        <div class="form-actions">
            <button type="submit" class="btn btn-primary">Create topic</button>
            <a href="/admin/topics" class="btn btn-secondary">Cancel</a>
        </div>
    </form>
</div>

<script>
function loadMembers(cityId) {
    var sel = document.getElementById('creator_id');
    if (!cityId) {
        sel.innerHTML = '<option value="">— Admin / no specific creator —</option>';
        return;
    }
    fetch('/admin/api/cities/' + cityId + '/members')
        .then(function(r) { return r.json(); })
        .then(function(members) {
            sel.innerHTML = '<option value="">— Admin / no specific creator —</option>';
            members.forEach(function(m) {
                var opt = document.createElement('option');
                opt.value       = m.id;
                opt.textContent = m.display_name;
                sel.appendChild(opt);
            });
        })
        .catch(function() { /* ignore */ });
}
</script>
<?php
admin_foot();
