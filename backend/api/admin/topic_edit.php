<?php

declare(strict_types=1);

admin_require_login();

$pdo = Database::pdo();

// ── Load topic (admin: no status/expiry filter) ────────────────────────────────

$stmt = $pdo->prepare("
    SELECT
        ct.channel_id,
        ct.title,
        ct.description,
        ct.category,
        ct.created_by,
        ct.guest_id,
        ct.city_id,
        c.status,
        EXTRACT(EPOCH FROM ct.expires_at)::INTEGER AS expires_at_ts
    FROM channel_topics ct
    JOIN channels c ON c.id = ct.channel_id
    WHERE ct.channel_id = :id
");
$stmt->execute([':id' => $topicId]);
$topic = $stmt->fetch();

if (!$topic) {
    flash_set('error', 'Topic not found.');
    admin_redirect('/admin/topics');
}

$categories = TopicRepository::allowedCategories();
$errors     = [];
$post       = $_POST ?: [];

// Pre-populate form values from DB on GET (or repopulate on failed POST)
if ($method !== 'POST') {
    $post = [
        'title'       => $topic['title'],
        'description' => $topic['description'] ?? '',
        'category'    => $topic['category'],
        'expires_at'  => $topic['expires_at_ts'] > 0
            ? date('Y-m-d\TH:i', (int) $topic['expires_at_ts'])
            : '',
    ];
}

if ($method === 'POST') {
    csrf_verify();

    $title       = trim($post['title'] ?? '');
    $description = trim($post['description'] ?? '') ?: null;
    $category    = $post['category'] ?? 'general';
    $rawExpiry   = trim($post['expires_at'] ?? '');

    // ── Validation ────────────────────────────────────────────────────────────

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

    $newExpiresAt = null;
    if ($rawExpiry !== '') {
        $ts = strtotime($rawExpiry);
        if ($ts === false || $ts < time()) {
            $errors[] = 'Expiry date must be a valid future date/time.';
        } else {
            $newExpiresAt = $ts;
        }
    }

    // ── Update ────────────────────────────────────────────────────────────────

    if (empty($errors)) {
        TopicRepository::adminUpdate($topicId, $title, $description, $category, $newExpiresAt);
        error_log('[admin] topic updated: ' . $topicId . ' → "' . $title . '"');
        flash_set('success', 'Topic updated successfully.');
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

admin_head('Edit Topic');
admin_nav('/admin/topics');
?>
<div class="admin-main">
    <div style="margin-bottom:16px">
        <a href="/admin/topics" class="btn btn-secondary btn-sm">← Topics</a>
    </div>

    <h1 class="page-title">Edit Topic</h1>

    <?php if ($topic['status'] === 'deleted'): ?>
        <div class="warning-box">This topic is deleted. Editing will not restore it in the app feed.</div>
    <?php elseif ($topic['expires_at_ts'] > 0 && $topic['expires_at_ts'] <= time()): ?>
        <div class="warning-box">This topic is expired. Update the expiry date to make it active again in the feed.</div>
    <?php endif; ?>

    <?= flash_html() ?>

    <?php if (!empty($errors)): ?>
        <div class="flash flash-error">
            <?php foreach ($errors as $e): ?>
                <div><?= htmlspecialchars($e, ENT_QUOTES) ?></div>
            <?php endforeach; ?>
        </div>
    <?php endif; ?>

    <div class="form-card" style="margin-bottom:20px">
        <div class="info-section">
            <h3>Topic info</h3>
            <div class="info-grid">
                <span class="info-label">ID</span>
                <span class="info-value"><?= htmlspecialchars($topic['channel_id'], ENT_QUOTES) ?></span>
                <span class="info-label">City channel</span>
                <span class="info-value"><?= htmlspecialchars($topic['city_id'], ENT_QUOTES) ?></span>
                <span class="info-label">Status</span>
                <span class="info-value"><?= htmlspecialchars($topic['status'], ENT_QUOTES) ?></span>
                <?php if ($topic['created_by']): ?>
                    <span class="info-label">Creator</span>
                    <span class="info-value"><?= htmlspecialchars($topic['created_by'], ENT_QUOTES) ?></span>
                <?php elseif ($topic['guest_id']): ?>
                    <span class="info-label">Guest</span>
                    <span class="info-value"><?= htmlspecialchars($topic['guest_id'], ENT_QUOTES) ?></span>
                <?php endif; ?>
            </div>
        </div>
    </div>

    <form method="POST" action="/admin/topics/<?= urlencode($topicId) ?>/edit" class="form-card">
        <?= csrf_input() ?>

        <!-- Title -->
        <div class="form-group">
            <label for="title">Title <span style="color:#ef4444">*</span></label>
            <input type="text" id="title" name="title" maxlength="100" required
                   value="<?= htmlspecialchars($post['title'] ?? '', ENT_QUOTES) ?>"
                   placeholder="Topic title">
            <div class="hint">Max 100 characters. Updates everywhere the topic title is displayed.</div>
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
        </div>

        <!-- Expiry -->
        <div class="form-group">
            <label for="expires_at">Expiry date &amp; time <span style="color:#555">(optional — leave blank to keep current)</span></label>
            <input type="datetime-local" id="expires_at" name="expires_at"
                   value="<?= htmlspecialchars($post['expires_at'] ?? '', ENT_QUOTES) ?>">
            <div class="hint">
                Current expiry:
                <?= $topic['expires_at_ts'] > 0
                    ? date('M d, Y H:i', (int) $topic['expires_at_ts'])
                    : '—' ?>
            </div>
        </div>

        <div class="form-actions">
            <button type="submit" class="btn btn-primary">Save changes</button>
            <a href="/admin/topics" class="btn btn-secondary">Cancel</a>
        </div>
    </form>
</div>
<?php
admin_foot();
