<?php

declare(strict_types=1);

admin_require_login();

$pdo        = Database::pdo();
$cities     = CityRepository::all();
$errors     = [];
$eventTypes = ['drinks', 'party', 'music', 'food', 'coffee', 'sport', 'meetup', 'other'];
$dayLabels  = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Repopulate form values on validation failure
$post = $_POST;

if ($method === 'POST') {
    csrf_verify();

    $kind      = $post['kind']       ?? 'one-shot';   // 'one-shot' | 'recurring'
    $cityId    = (int) ($post['city_id'] ?? 0);
    $title     = trim($post['title'] ?? '');
    $eventType = $post['event_type'] ?? 'other';
    $location  = trim($post['location'] ?? '') ?: null;
    $venue     = trim($post['venue']    ?? '') ?: null;
    $creatorId = trim($post['creator_id'] ?? '') ?: null;

    // ── Common validation ─────────────────────────────────────────────────────

    $city = $cityId > 0 ? CityRepository::findById($cityId) : null;
    if ($city === null) {
        $errors[] = 'Select a valid city.';
    }
    if ($title === '') {
        $errors[] = 'Title is required.';
    } elseif (mb_strlen($title) > 120) {
        $errors[] = 'Title must be 120 characters or fewer.';
    }
    if (!in_array($eventType, $eventTypes, true)) {
        $errors[] = 'Invalid event type.';
    }

    // ── Creator lookup ────────────────────────────────────────────────────────
    $creatorUser = null;
    if ($creatorId !== null) {
        $creatorUser = UserRepository::findById($creatorId);
        if ($creatorUser === null) {
            $errors[] = 'Selected creator not found.';
        }
    }

    // ── Kind-specific validation + creation ───────────────────────────────────

    if ($kind === 'one-shot') {
        $rawStartsAt = trim($post['starts_at'] ?? '');
        $rawEndsAt   = trim($post['ends_at']   ?? '');

        $startsAt = $rawStartsAt !== '' ? strtotime($rawStartsAt) : false;
        $endsAt   = $rawEndsAt   !== '' ? strtotime($rawEndsAt)   : false;

        if ($startsAt === false) $errors[] = 'Valid start date/time is required.';
        if ($endsAt   === false) $errors[] = 'Valid end date/time is required.';
        if ($startsAt !== false && $endsAt !== false && $endsAt <= $startsAt) {
            $errors[] = 'End time must be after start time.';
        }

        if (empty($errors)) {
            EventRepository::adminAdd(
                $cityId,
                $title,
                $eventType,
                $location,
                $venue,
                (int) $startsAt,
                (int) $endsAt,
                $creatorUser['id']       ?? null,
                $creatorUser['guest_id'] ?? null
            );
            error_log('[admin] one-shot event created: "' . $title . '" in city ' . $cityId);
            flash_set('success', 'Event "' . $title . '" created successfully.');
            admin_redirect('/admin/events');
        }

    } else {
        // Recurring
        $recurrenceType = $post['recurrence_type'] ?? 'daily';
        $startTime      = trim($post['start_time'] ?? '');
        $endTime        = trim($post['end_time']   ?? '');
        $startsOn       = trim($post['starts_on']  ?? '');
        $endsOn         = trim($post['ends_on']    ?? '') ?: null;
        $weekdays       = array_map('intval', (array) ($post['weekdays'] ?? []));

        if (!in_array($recurrenceType, ['daily', 'weekly'], true)) {
            $errors[] = 'Invalid recurrence type.';
        }
        if (!preg_match('/^\d{2}:\d{2}$/', $startTime)) {
            $errors[] = 'Valid start time required (HH:MM).';
        }
        if (!preg_match('/^\d{2}:\d{2}$/', $endTime)) {
            $errors[] = 'Valid end time required (HH:MM).';
        }
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $startsOn)) {
            $errors[] = 'Valid start date required.';
        }
        if ($recurrenceType === 'weekly' && empty($weekdays)) {
            $errors[] = 'Select at least one weekday for weekly recurrence.';
        }

        if (empty($errors)) {
            EventSeriesRepository::adminCreate(
                $cityId,
                $title,
                $eventType,
                $location,
                $startTime,
                $endTime,
                $city['timezone'],
                $recurrenceType,
                $recurrenceType === 'weekly' ? $weekdays : null,
                null,
                $startsOn,
                $endsOn,
                $creatorUser['id']       ?? null,
                $creatorUser['guest_id'] ?? null
            );
            error_log('[admin] recurring series created: "' . $title . '" in city ' . $cityId);
            flash_set('success', 'Recurring event "' . $title . '" created (30 days generated).');
            admin_redirect('/admin/events');
        }
    }
}

$defaultStartsOn = date('Y-m-d');

admin_head('Create Event');
admin_nav('/admin/events');
?>
<style>
.kind-toggle { display:flex; gap:0; border:1px solid #2a2a2a; border-radius:6px; overflow:hidden; margin-bottom:24px; width:fit-content; }
.kind-toggle label { display:flex; align-items:center; gap:8px; padding:8px 20px; cursor:pointer; font-size:13px; color:#888; transition:all .15s; }
.kind-toggle input[type=radio] { display:none; }
.kind-toggle input[type=radio]:checked + span { color:#fff; }
.kind-toggle label:has(input:checked) { background:#252525; color:#fff; }
.weekdays-row { display:flex; gap:6px; flex-wrap:wrap; }
.weekday-cb { display:none; }
.weekday-label { display:inline-flex; align-items:center; justify-content:center; width:44px; height:32px; border:1px solid #2a2a2a; border-radius:5px; font-size:12px; color:#666; cursor:pointer; transition:all .15s; }
.weekday-cb:checked + .weekday-label { background:rgba(255,122,60,.2); border-color:#FF7A3C; color:#FF7A3C; }
.section-divider { border:none; border-top:1px solid #222; margin:20px 0; }
#recurring-fields { display:none; }
#oneshot-fields   { display:block; }
</style>

<div class="admin-main">
    <div style="margin-bottom:16px">
        <a href="/admin/events" class="btn btn-secondary btn-sm">← Events</a>
    </div>

    <h1 class="page-title">Create Event</h1>

    <?= flash_html() ?>

    <?php if (!empty($errors)): ?>
        <div class="flash flash-error">
            <?php foreach ($errors as $e): ?>
                <div><?= htmlspecialchars($e, ENT_QUOTES) ?></div>
            <?php endforeach; ?>
        </div>
    <?php endif; ?>

    <form method="POST" action="/admin/events/create" class="form-card" style="max-width:640px" id="create-form">
        <?= csrf_input() ?>

        <!-- Kind toggle -->
        <div class="form-group">
            <label>Event kind</label>
            <div class="kind-toggle">
                <label>
                    <input type="radio" name="kind" value="one-shot" <?= ($post['kind'] ?? 'one-shot') === 'one-shot' ? 'checked' : '' ?> onchange="setKind('one-shot')">
                    <span>One-shot</span>
                </label>
                <label>
                    <input type="radio" name="kind" value="recurring" <?= ($post['kind'] ?? '') === 'recurring' ? 'checked' : '' ?> onchange="setKind('recurring')">
                    <span>↻ Recurring</span>
                </label>
            </div>
        </div>

        <!-- City -->
        <div class="form-group">
            <label for="city_id">City</label>
            <select id="city_id" name="city_id" onchange="loadMembers(this.value)" required>
                <option value="">— Select city —</option>
                <?php foreach ($cities as $c): ?>
                    <option value="<?= $c['id'] ?>" <?= (int)($post['city_id'] ?? 0) === $c['id'] ? 'selected' : '' ?>>
                        <?= htmlspecialchars($c['name'], ENT_QUOTES) ?>
                        (<?= htmlspecialchars($c['country'], ENT_QUOTES) ?>)
                    </option>
                <?php endforeach; ?>
            </select>
        </div>

        <!-- Title -->
        <div class="form-group">
            <label for="title">Title</label>
            <input type="text" id="title" name="title" maxlength="120" required
                   value="<?= htmlspecialchars($post['title'] ?? '', ENT_QUOTES) ?>"
                   placeholder="e.g. Tuesday Rooftop Drinks">
        </div>

        <!-- Event type -->
        <div class="form-group">
            <label for="event_type">Category</label>
            <select id="event_type" name="event_type">
                <?php foreach ($eventTypes as $et): ?>
                    <option value="<?= $et ?>" <?= ($post['event_type'] ?? 'other') === $et ? 'selected' : '' ?>><?= ucfirst($et) ?></option>
                <?php endforeach; ?>
            </select>
        </div>

        <!-- Location / venue -->
        <div class="form-group">
            <label for="location">Location hint</label>
            <input type="text" id="location" name="location" maxlength="200"
                   value="<?= htmlspecialchars($post['location'] ?? '', ENT_QUOTES) ?>"
                   placeholder="e.g. Near the fountain">
        </div>

        <div class="form-group">
            <label for="venue">Venue name</label>
            <input type="text" id="venue" name="venue" maxlength="200"
                   value="<?= htmlspecialchars($post['venue'] ?? '', ENT_QUOTES) ?>"
                   placeholder="e.g. Le Comptoir">
        </div>

        <hr class="section-divider">

        <!-- One-shot fields -->
        <div id="oneshot-fields">
            <div class="form-group">
                <label for="starts_at">Start date &amp; time</label>
                <input type="datetime-local" id="starts_at" name="starts_at"
                       value="<?= htmlspecialchars($post['starts_at'] ?? '', ENT_QUOTES) ?>">
            </div>
            <div class="form-group">
                <label for="ends_at">End date &amp; time</label>
                <input type="datetime-local" id="ends_at" name="ends_at"
                       value="<?= htmlspecialchars($post['ends_at'] ?? '', ENT_QUOTES) ?>">
            </div>
        </div>

        <!-- Recurring fields -->
        <div id="recurring-fields">
            <div class="form-group">
                <label>Recurrence</label>
                <div style="display:flex;gap:8px">
                    <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px;color:#ccc">
                        <input type="radio" name="recurrence_type" value="daily"
                               <?= ($post['recurrence_type'] ?? 'daily') === 'daily' ? 'checked' : '' ?>
                               onchange="setRecurrence('daily')"> Daily
                    </label>
                    <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px;color:#ccc">
                        <input type="radio" name="recurrence_type" value="weekly"
                               <?= ($post['recurrence_type'] ?? '') === 'weekly' ? 'checked' : '' ?>
                               onchange="setRecurrence('weekly')"> Weekly
                    </label>
                </div>
            </div>

            <div id="weekdays-group" class="form-group" style="display:none">
                <label>Days of the week</label>
                <div class="weekdays-row">
                    <?php foreach ($dayLabels as $i => $day): ?>
                        <input type="checkbox" class="weekday-cb" id="wd<?= $i ?>" name="weekdays[]" value="<?= $i ?>"
                               <?= in_array((string)$i, (array)($post['weekdays'] ?? []), true) ? 'checked' : '' ?>>
                        <label class="weekday-label" for="wd<?= $i ?>"><?= $day ?></label>
                    <?php endforeach; ?>
                </div>
            </div>

            <div style="display:flex;gap:12px">
                <div class="form-group" style="flex:1">
                    <label for="start_time">Start time</label>
                    <input type="time" id="start_time" name="start_time"
                           value="<?= htmlspecialchars($post['start_time'] ?? '20:00', ENT_QUOTES) ?>">
                </div>
                <div class="form-group" style="flex:1">
                    <label for="end_time">End time</label>
                    <input type="time" id="end_time" name="end_time"
                           value="<?= htmlspecialchars($post['end_time'] ?? '23:00', ENT_QUOTES) ?>">
                </div>
            </div>

            <div style="display:flex;gap:12px">
                <div class="form-group" style="flex:1">
                    <label for="starts_on">Starts on</label>
                    <input type="date" id="starts_on" name="starts_on"
                           value="<?= htmlspecialchars($post['starts_on'] ?? $defaultStartsOn, ENT_QUOTES) ?>">
                </div>
                <div class="form-group" style="flex:1">
                    <label for="ends_on">Ends on <span style="color:#555">(optional)</span></label>
                    <input type="date" id="ends_on" name="ends_on"
                           value="<?= htmlspecialchars($post['ends_on'] ?? '', ENT_QUOTES) ?>">
                    <div class="hint">Leave blank for indefinite recurrence</div>
                </div>
            </div>
        </div>

        <hr class="section-divider">

        <!-- Creator -->
        <div class="form-group">
            <label for="creator_id">Creator</label>
            <select id="creator_id" name="creator_id">
                <option value="">System / Seeded (no creator)</option>
                <?php
                // If city was pre-selected (validation failed), repopulate members
                $preloadCityId = (int) ($post['city_id'] ?? 0);
                if ($preloadCityId > 0) {
                    $preloadCity = CityRepository::findById($preloadCityId);
                    if ($preloadCity) {
                        $ck   = 'city_' . $preloadCityId;
                        $stmt = $pdo->prepare("
                            SELECT DISTINCT u.id, u.display_name
                            FROM users u
                            LEFT JOIN user_city_memberships m ON m.user_id = u.id AND m.channel_id = :ck
                            WHERE m.channel_id IS NOT NULL
                               OR LOWER(TRIM(COALESCE(u.home_city, ''))) = LOWER(TRIM(:cn))
                            ORDER BY u.display_name ASC
                            LIMIT 100
                        ");
                        $stmt->execute([':ck' => $ck, ':cn' => $preloadCity['name']]);
                        foreach ($stmt->fetchAll() as $member):
                            $sel = ($post['creator_id'] ?? '') === $member['id'] ? 'selected' : '';
                            echo '<option value="' . htmlspecialchars($member['id'], ENT_QUOTES) . '" ' . $sel . '>'
                               . htmlspecialchars($member['display_name'], ENT_QUOTES) . '</option>';
                        endforeach;
                    }
                }
                ?>
            </select>
            <div class="hint">Choose a city member as the event creator, or leave blank for a seeded event.</div>
        </div>

        <div class="form-actions">
            <button type="submit" class="btn btn-primary">Create event</button>
            <a href="/admin/events" class="btn btn-secondary">Cancel</a>
        </div>
    </form>
</div>

<script>
// ── Kind toggle ───────────────────────────────────────────────────────────────
function setKind(kind) {
    document.getElementById('oneshot-fields').style.display   = kind === 'one-shot'  ? 'block' : 'none';
    document.getElementById('recurring-fields').style.display = kind === 'recurring' ? 'block' : 'none';

    // Toggle required on datetime fields
    ['starts_at','ends_at'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.required = kind === 'one-shot';
    });
    ['start_time','end_time','starts_on'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.required = kind === 'recurring';
    });
}

// ── Weekly weekday selector ────────────────────────────────────────────────────
function setRecurrence(type) {
    document.getElementById('weekdays-group').style.display = type === 'weekly' ? 'block' : 'none';
}

// ── City member loader ─────────────────────────────────────────────────────────
function loadMembers(cityId) {
    var sel = document.getElementById('creator_id');
    if (!cityId) {
        sel.innerHTML = '<option value="">System / Seeded (no creator)</option>';
        return;
    }
    fetch('/admin/api/cities/' + cityId + '/members')
        .then(function(r) { return r.json(); })
        .then(function(members) {
            sel.innerHTML = '<option value="">System / Seeded (no creator)</option>';
            members.forEach(function(m) {
                var opt = document.createElement('option');
                opt.value       = m.id;
                opt.textContent = m.display_name;
                sel.appendChild(opt);
            });
        })
        .catch(function() { /* ignore — creator stays as system */ });
}

// ── Init on page load ─────────────────────────────────────────────────────────
(function() {
    var checked = document.querySelector('input[name="kind"]:checked');
    setKind(checked ? checked.value : 'one-shot');

    var recChecked = document.querySelector('input[name="recurrence_type"]:checked');
    if (recChecked) setRecurrence(recChecked.value);

    // If city already selected (validation failure reload), members were server-rendered
})();
</script>
<?php
admin_foot();
