<?php

declare(strict_types=1);

admin_require_login();

$pdo = Database::pdo();

// Load event with channel info
$stmt = $pdo->prepare("
    SELECT
        ce.channel_id,
        ce.title,
        ce.event_type,
        ce.source_type,
        ce.series_id,
        ce.created_by,
        ce.guest_id,
        ce.starts_at,
        ce.ends_at,
        ce.expires_at,
        ce.location,
        ce.venue,
        c.status   AS channel_status,
        c.parent_id,
        p.name     AS city_name
    FROM channel_events ce
    JOIN channels c      ON c.id = ce.channel_id
    LEFT JOIN channels p ON p.id = c.parent_id
    WHERE ce.channel_id = :id AND c.type = 'event'
");
$stmt->execute([':id' => $eventId]);
$event = $stmt->fetch();

if (!$event) {
    http_response_code(404);
    admin_head('Event Not Found');
    admin_nav('/admin/events');
    echo '<div class="admin-main"><p style="color:#666">Event not found.</p>';
    echo '<p style="margin-top:12px"><a href="/admin/events" class="btn btn-secondary btn-sm">← Events</a></p></div>';
    admin_foot();
    exit;
}

$isRecurring = $event['series_id'] !== null;
$errors      = [];
$success     = false;

if ($method === 'POST') {
    csrf_verify();

    $newTitle    = trim($_POST['title'] ?? '');
    $newLocation = trim($_POST['location'] ?? '');
    $newVenue    = trim($_POST['venue'] ?? '');
    $newStatus   = $_POST['status'] ?? $event['channel_status'];

    // Time fields — only for one-shot events
    $newStartsAt  = null;
    $newEndsAt    = null;
    $newExpiresAt = null;

    // Validate title
    if ($newTitle === '') {
        $errors[] = 'Title is required.';
    } elseif (mb_strlen($newTitle) > 120) {
        $errors[] = 'Title must be 120 characters or fewer.';
    }

    // Validate status
    if (!in_array($newStatus, ['active', 'deleted'], true)) {
        $errors[] = 'Invalid status value.';
    }

    // Time fields — only editable for one-shot events
    if (!$isRecurring) {
        $rawStartsAt  = trim($_POST['starts_at'] ?? '');
        $rawEndsAt    = trim($_POST['ends_at'] ?? '');
        $rawExpiresAt = trim($_POST['expires_at'] ?? '');

        if ($rawStartsAt !== '') {
            $ts = strtotime($rawStartsAt);
            if ($ts === false) {
                $errors[] = 'Invalid starts_at date format.';
            } else {
                $newStartsAt = date('Y-m-d H:i:sP', $ts);
            }
        }

        if ($rawEndsAt !== '') {
            $ts = strtotime($rawEndsAt);
            if ($ts === false) {
                $errors[] = 'Invalid ends_at date format.';
            } else {
                $newEndsAt = date('Y-m-d H:i:sP', $ts);
            }
        }

        if ($rawExpiresAt !== '') {
            $ts = strtotime($rawExpiresAt);
            if ($ts === false) {
                $errors[] = 'Invalid expires_at date format.';
            } else {
                $newExpiresAt = date('Y-m-d H:i:sP', $ts);
            }
        }
    }

    if (empty($errors)) {
        // Update channel_events
        $updateFields   = ['title = :title', 'location = :location', 'venue = :venue'];
        $updateParams   = [
            ':title'    => $newTitle,
            ':location' => $newLocation !== '' ? $newLocation : null,
            ':venue'    => $newVenue    !== '' ? $newVenue    : null,
            ':id'       => $eventId,
        ];

        if (!$isRecurring) {
            if ($newStartsAt !== null) {
                $updateFields[]            = 'starts_at = :starts_at';
                $updateParams[':starts_at'] = $newStartsAt;
            }
            if ($newEndsAt !== null) {
                $updateFields[]           = 'ends_at = :ends_at';
                $updateParams[':ends_at']  = $newEndsAt;
            }
            if ($newExpiresAt !== null) {
                $updateFields[]              = 'expires_at = :expires_at';
                $updateParams[':expires_at']  = $newExpiresAt;
            }
        }

        $pdo->prepare(
            'UPDATE channel_events SET ' . implode(', ', $updateFields) . ' WHERE channel_id = :id'
        )->execute($updateParams);

        // Update channel name (mirrors the title) and status
        $pdo->prepare("
            UPDATE channels SET name = :name, status = :status, updated_at = now() WHERE id = :id
        ")->execute([':name' => $newTitle, ':status' => $newStatus, ':id' => $eventId]);

        flash_set('success', 'Event updated successfully.');
        admin_redirect('/admin/events/' . urlencode($eventId) . '/edit');
    }
}

// Format timestamps for datetime-local inputs (browser local format)
function fmt_dt(?string $ts): string
{
    if (!$ts) return '';
    $t = strtotime($ts);
    return $t ? date('Y-m-d\TH:i', $t) : '';
}

admin_head('Edit Event');
admin_nav('/admin/events');
?>
<div class="admin-main">
    <div style="margin-bottom:16px">
        <a href="/admin/events" class="btn btn-secondary btn-sm">← Events</a>
    </div>

    <h1 class="page-title">Edit Event</h1>

    <?= flash_html() ?>

    <?php if (!empty($errors)): ?>
        <div class="flash flash-error">
            <?php foreach ($errors as $e): ?>
                <div><?= htmlspecialchars($e, ENT_QUOTES) ?></div>
            <?php endforeach; ?>
        </div>
    <?php endif; ?>

    <?php if ($isRecurring): ?>
        <div class="warning-box">
            ⚠ This is a <strong>recurring event occurrence</strong> (series ID: <?= htmlspecialchars(substr($event['series_id'], 0, 16), ENT_QUOTES) ?>…).
            Editing start/end times is disabled to avoid breaking automatically generated occurrences.
            Only title, location, and venue can be changed here.
        </div>
    <?php endif; ?>

    <!-- Read-only metadata -->
    <div class="form-card" style="margin-bottom:16px">
        <div class="info-section">
            <h3>Event Info</h3>
            <div class="info-grid">
                <div class="info-label">ID</div>
                <div class="info-value"><?= htmlspecialchars($event['channel_id'], ENT_QUOTES) ?></div>

                <div class="info-label">City</div>
                <div class="info-value"><?= htmlspecialchars($event['city_name'] ?? '—', ENT_QUOTES) ?></div>

                <div class="info-label">Source</div>
                <div class="info-value"><?= htmlspecialchars($event['source_type'], ENT_QUOTES) ?></div>

                <div class="info-label">Type</div>
                <div class="info-value"><?= htmlspecialchars($event['event_type'] ?? '—', ENT_QUOTES) ?></div>

                <?php if ($event['created_by']): ?>
                    <div class="info-label">Created by</div>
                    <div class="info-value"><?= htmlspecialchars($event['created_by'], ENT_QUOTES) ?></div>
                <?php elseif ($event['guest_id']): ?>
                    <div class="info-label">Guest ID</div>
                    <div class="info-value"><?= htmlspecialchars($event['guest_id'], ENT_QUOTES) ?></div>
                <?php endif; ?>
            </div>
        </div>
    </div>

    <!-- Edit form -->
    <form method="POST" action="/admin/events/<?= urlencode($eventId) ?>/edit" class="form-card">
        <?= csrf_input() ?>

        <div class="form-group">
            <label for="title">Title</label>
            <input
                type="text"
                id="title"
                name="title"
                maxlength="120"
                required
                value="<?= htmlspecialchars($_POST['title'] ?? $event['title'], ENT_QUOTES) ?>"
            >
        </div>

        <div class="form-group">
            <label for="location">Location hint</label>
            <input
                type="text"
                id="location"
                name="location"
                maxlength="200"
                value="<?= htmlspecialchars($_POST['location'] ?? ($event['location'] ?? ''), ENT_QUOTES) ?>"
                placeholder="e.g. Near the fountain"
            >
        </div>

        <div class="form-group">
            <label for="venue">Venue</label>
            <input
                type="text"
                id="venue"
                name="venue"
                maxlength="200"
                value="<?= htmlspecialchars($_POST['venue'] ?? ($event['venue'] ?? ''), ENT_QUOTES) ?>"
                placeholder="e.g. Le Comptoir"
            >
        </div>

        <?php if (!$isRecurring): ?>
            <div class="form-group">
                <label for="starts_at">Starts at</label>
                <input
                    type="datetime-local"
                    id="starts_at"
                    name="starts_at"
                    value="<?= htmlspecialchars($_POST['starts_at'] ?? fmt_dt($event['starts_at']), ENT_QUOTES) ?>"
                >
                <div class="hint">Leave blank to keep current value</div>
            </div>

            <div class="form-group">
                <label for="ends_at">Ends at</label>
                <input
                    type="datetime-local"
                    id="ends_at"
                    name="ends_at"
                    value="<?= htmlspecialchars($_POST['ends_at'] ?? fmt_dt($event['ends_at']), ENT_QUOTES) ?>"
                >
                <div class="hint">Leave blank to keep current value</div>
            </div>

            <div class="form-group">
                <label for="expires_at">Expires at (disappears from listing)</label>
                <input
                    type="datetime-local"
                    id="expires_at"
                    name="expires_at"
                    value="<?= htmlspecialchars($_POST['expires_at'] ?? fmt_dt($event['expires_at']), ENT_QUOTES) ?>"
                >
                <div class="hint">Leave blank to keep current value</div>
            </div>
        <?php endif; ?>

        <div class="form-group">
            <label for="status">Channel status</label>
            <select id="status" name="status">
                <option value="active"  <?= ($event['channel_status'] === 'active')  ? 'selected' : '' ?>>Active</option>
                <option value="deleted" <?= ($event['channel_status'] === 'deleted') ? 'selected' : '' ?>>Deleted</option>
            </select>
            <div class="hint">Setting to "Deleted" hides the event from the app immediately.</div>
        </div>

        <div class="form-actions">
            <button type="submit" class="btn btn-primary">Save changes</button>
            <a href="/admin/events" class="btn btn-secondary">Cancel</a>
        </div>
    </form>
</div>
<?php
admin_foot();
