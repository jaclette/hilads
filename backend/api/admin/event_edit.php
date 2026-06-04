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
        c.status              AS channel_status,
        c.parent_id,
        p.name                AS city_name,
        es.timezone           AS series_timezone,
        es.recurrence_type    AS series_recurrence_type,
        es.weekdays           AS series_weekdays,
        es.interval_days      AS series_interval_days,
        es.starts_on::TEXT    AS series_starts_on
    FROM channel_events ce
    JOIN channels c             ON c.id  = ce.channel_id
    LEFT JOIN channels p        ON p.id  = c.parent_id
    LEFT JOIN event_series es   ON es.id = ce.series_id
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

    // Time fields — editable for both one-shot AND recurring events. For
    // recurring, we additionally shift the series schedule (starts_on /
    // start_time / end_time) below so future occurrences pick up the change.
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

    if (empty($errors)) {
        // Update channel_events
        $updateFields   = ['title = :title', 'location = :location', 'venue = :venue'];
        $updateParams   = [
            ':title'    => $newTitle,
            ':location' => $newLocation !== '' ? $newLocation : null,
            ':venue'    => $newVenue    !== '' ? $newVenue    : null,
            ':id'       => $eventId,
        ];

        if ($newStartsAt !== null) {
            $updateFields[]             = 'starts_at = :starts_at';
            $updateParams[':starts_at'] = $newStartsAt;
        }
        if ($newEndsAt !== null) {
            $updateFields[]           = 'ends_at = :ends_at';
            $updateParams[':ends_at'] = $newEndsAt;
        }
        // For recurring rows we preserve the 2999 sentinel on expires_at by
        // default — only let it be overridden if the admin explicitly typed a
        // value. Sentinel keeps the canonical row from ageing out of feeds.
        if ($newExpiresAt !== null) {
            $updateFields[]              = 'expires_at = :expires_at';
            $updateParams[':expires_at'] = $newExpiresAt;
        }

        $pdo->prepare(
            'UPDATE channel_events SET ' . implode(', ', $updateFields) . ' WHERE channel_id = :id'
        )->execute($updateParams);

        // For recurring events, also shift the series schedule so future
        // occurrences pick up the new times. Date and time-of-day are
        // extracted in the series timezone (NOT UTC — recurrence days are
        // tz-aware). Mirrors EventRepository::update's recurring branch.
        if ($isRecurring && ($newStartsAt !== null || $newEndsAt !== null)) {
            $tz = $event['series_timezone'] ?: 'UTC';
            // Build the new start/end timestamps to extract from. Fall back to
            // the row's existing values when one side was left blank.
            $startBasis = $newStartsAt ?? $event['starts_at'];
            $endBasis   = $newEndsAt   ?? $event['ends_at'] ?? $event['expires_at'];

            $pdo->prepare("
                UPDATE event_series
                SET starts_on  = (:starts::timestamptz AT TIME ZONE :tz)::date,
                    start_time = (:starts::timestamptz AT TIME ZONE :tz)::time,
                    end_time   = (:ends::timestamptz   AT TIME ZONE :tz)::time,
                    updated_at = now()
                WHERE id = :sid
            ")->execute([
                ':starts' => $startBasis,
                ':ends'   => $endBasis,
                ':tz'     => $tz,
                ':sid'    => $event['series_id'],
            ]);
        }

        // For recurring events, also accept direct recurrence-rule edits
        // (weekdays + interval_days). Used to repair existing series whose
        // stored weekday no longer matches the visible series name (e.g. the
        // mobile "init weekday = today" bug that mislabelled a Thursday
        // series as a Wednesday one).
        if ($isRecurring) {
            $rawWeekdays = $_POST['weekdays'] ?? null;
            $rawInterval = trim($_POST['interval_days'] ?? '');
            $seriesFields = [];
            $seriesParams = [':sid' => $event['series_id']];

            // Weekdays only relevant for weekly series. Accept array of "0".."6"
            // strings; persist as JSON. Empty array = no day selected; ignore.
            if (is_array($rawWeekdays) && $event['series_recurrence_type'] === 'weekly') {
                $clean = array_values(array_filter(
                    array_map('intval', $rawWeekdays),
                    fn($d) => $d >= 0 && $d <= 6
                ));
                if (!empty($clean)) {
                    sort($clean);
                    $clean = array_values(array_unique($clean));
                    $seriesFields[]              = 'weekdays = :weekdays';
                    $seriesParams[':weekdays']   = json_encode($clean);
                }
            }

            // Interval only relevant for every_n_days. 2..365 mirrors the
            // public create-series validation.
            if ($rawInterval !== '' && $event['series_recurrence_type'] === 'every_n_days') {
                $n = filter_var($rawInterval, FILTER_VALIDATE_INT, ['options' => ['min_range' => 2, 'max_range' => 365]]);
                if ($n !== false) {
                    $seriesFields[]                  = 'interval_days = :interval_days';
                    $seriesParams[':interval_days']  = $n;
                }
            }

            if (!empty($seriesFields)) {
                $seriesFields[] = 'updated_at = now()';
                $pdo->prepare(
                    'UPDATE event_series SET ' . implode(', ', $seriesFields) . ' WHERE id = :sid'
                )->execute($seriesParams);
            }
        }

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
            ⚠ This is a <strong>recurring event</strong> (series ID: <?= htmlspecialchars(substr($event['series_id'], 0, 16), ENT_QUOTES) ?>…).
            Editing the start/end times here will <strong>shift the entire series schedule</strong> — future occurrences pick up the new date and time-of-day. <code>expires_at</code> should normally be left blank to preserve the far-future sentinel that keeps the canonical row alive.
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

        <div class="form-group">
            <label for="starts_at">Starts at<?= $isRecurring ? ' (shifts series anchor + first occurrence)' : '' ?></label>
            <input
                type="datetime-local"
                id="starts_at"
                name="starts_at"
                value="<?= htmlspecialchars($_POST['starts_at'] ?? fmt_dt($event['starts_at']), ENT_QUOTES) ?>"
            >
            <div class="hint">Leave blank to keep current value<?= $isRecurring ? '. Series start_time + starts_on are updated to match.' : '' ?></div>
        </div>

        <div class="form-group">
            <label for="ends_at">Ends at<?= $isRecurring ? ' (shifts series end_time)' : '' ?></label>
            <input
                type="datetime-local"
                id="ends_at"
                name="ends_at"
                value="<?= htmlspecialchars($_POST['ends_at'] ?? fmt_dt($event['ends_at']), ENT_QUOTES) ?>"
            >
            <div class="hint">Leave blank to keep current value<?= $isRecurring ? '. Series end_time is updated to match.' : '' ?></div>
        </div>

        <div class="form-group">
            <label for="expires_at">Expires at (disappears from listing)</label>
            <input
                type="datetime-local"
                id="expires_at"
                name="expires_at"
                value="<?= htmlspecialchars($_POST['expires_at'] ?? fmt_dt($event['expires_at']), ENT_QUOTES) ?>"
            >
            <div class="hint"><?= $isRecurring
                ? 'Leave blank for recurring events — overwriting the 2999 sentinel turns the canonical row into a one-shot and removes it from feeds.'
                : 'Leave blank to keep current value' ?></div>
        </div>

        <?php if ($isRecurring): ?>
            <?php
                $currentWeekdays = !empty($event['series_weekdays'])
                    ? (json_decode($event['series_weekdays'], true) ?: [])
                    : [];
                $postedWeekdays  = isset($_POST['weekdays']) && is_array($_POST['weekdays'])
                    ? array_map('intval', $_POST['weekdays'])
                    : null;
                $shownWeekdays   = $postedWeekdays ?? $currentWeekdays;
                $dayNames        = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            ?>

            <div class="form-group">
                <label>Recurrence pattern (<?= htmlspecialchars($event['series_recurrence_type'] ?? '?', ENT_QUOTES) ?>)</label>
                <?php if ($event['series_recurrence_type'] === 'weekly'): ?>
                    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:4px">
                        <?php foreach ($dayNames as $dow => $name): ?>
                            <label style="display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border:1px solid #333;border-radius:6px;cursor:pointer;background:<?= in_array($dow, $shownWeekdays, true) ? '#3a2a18' : 'transparent' ?>">
                                <input
                                    type="checkbox"
                                    name="weekdays[]"
                                    value="<?= $dow ?>"
                                    <?= in_array($dow, $shownWeekdays, true) ? 'checked' : '' ?>
                                >
                                <?= $name ?>
                            </label>
                        <?php endforeach; ?>
                    </div>
                    <div class="hint">Currently: <strong><?= empty($currentWeekdays) ? '— (none)' : implode(' · ', array_map(fn($d) => $dayNames[$d] ?? '?', $currentWeekdays)) ?></strong>. Tick the days the series should repeat on.</div>
                <?php elseif ($event['series_recurrence_type'] === 'every_n_days'): ?>
                    <input
                        type="number"
                        name="interval_days"
                        min="2"
                        max="365"
                        value="<?= htmlspecialchars((string) ($_POST['interval_days'] ?? $event['series_interval_days'] ?? ''), ENT_QUOTES) ?>"
                        style="max-width:120px"
                    >
                    <div class="hint">Days between occurrences (2–365). Current: <strong><?= htmlspecialchars((string) ($event['series_interval_days'] ?? '—'), ENT_QUOTES) ?></strong></div>
                <?php else: ?>
                    <div class="hint">Daily — runs every day. Nothing to configure.</div>
                <?php endif; ?>
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
