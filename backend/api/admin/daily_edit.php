<?php

declare(strict_types=1);

// Daily Challenge editor: create or edit one challenge (dated or reserve), set
// the Local Twist of each live city, preview the World card and the morning
// push, and run the actions (test push, duplicate, move, delete).
// Router vars: $dailyId (null for /admin/daily/new).

admin_require_login();
require_once __DIR__ . '/daily_common.php';

$challenge = $dailyId !== null ? DailyAdminService::find($dailyId) : null;
if ($dailyId !== null && $challenge === null) {
    flash_set('error', 'Challenge not found.');
    admin_redirect('/admin/daily');
}
$isNew       = $challenge === null;
$isReserve   = $isNew ? (($_GET['reserve'] ?? '') === '1') : $challenge['is_reserve'];
$isPublished = !$isNew && $challenge['status'] === 'published';
$self        = $isNew ? '/admin/daily/new' : '/admin/daily/' . $challenge['id'];

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    csrf_verify();
    $p      = $_POST;
    $action = (string) ($p['action'] ?? 'save');

    if ($action === 'save' && $isNew) {
        // Not daily_action: on a refusal the form re-renders with what was typed.
        try {
            $row = $isReserve
                ? DailyAdminService::createReserve((string) ($p['text'] ?? ''), (string) ($p['context'] ?? ''), (string) ($p['theme'] ?? ''))
                : DailyAdminService::createChallenge([
                    'text' => $p['text'] ?? '', 'context' => $p['context'] ?? '',
                    'date' => $p['date'] ?? '', 'status' => $p['status'] ?? 'draft',
                    'theme' => $p['theme'] ?? '',
                ]);
            flash_set('success', 'Saved.');
            admin_redirect('/admin/daily/' . $row['id']);
        } catch (InvalidArgumentException $e) {
            $formError = $e->getMessage();
        }
    } elseif ($isNew) {
        admin_redirect($self);
    }
}

if ($_SERVER['REQUEST_METHOD'] === 'POST' && !$isNew) {
    $p      = $_POST;
    $action = (string) ($p['action'] ?? 'save');

    $id = $challenge['id'];
    match ($action) {
        'save' => daily_action(function () use ($p, $challenge, $isReserve, $isPublished) {
            $newDate = trim((string) ($p['date'] ?? ''));
            if (!$isReserve && !$isPublished && $newDate !== '' && $newDate !== $challenge['challenge_date']) {
                DailyAdminService::moveChallenge($challenge['id'], $newDate);
            }
            $fields = ['text' => $p['text'] ?? '', 'context' => $p['context'] ?? '', 'theme' => $p['theme'] ?? ''];
            if (!$isReserve && !$isPublished) {
                $fields['status'] = $p['status'] ?? 'draft';
            }
            DailyAdminService::updateChallenge($challenge['id'], $fields);
        }, 'Saved.', $self),

        // SPEC 10.2: the comparison question. No type = no question.
        'save_compare' => daily_action(function () use ($p, $id) {
            $type = (string) ($p['compare_type'] ?? '');
            if ($type === '') {
                DailyAdminService::setChallengeCompare($id, null);
                return 'Question removed.';
            }
            $question = ['en' => (string) ($p['q_en'] ?? '')] + (is_array($p['q_tr'] ?? null) ? $p['q_tr'] : []);
            $unit     = ['en' => (string) ($p['unit_en'] ?? '')] + (is_array($p['unit_tr'] ?? null) ? $p['unit_tr'] : []);
            $title    = ['en' => (string) ($p['title_en'] ?? '')] + (is_array($p['title_tr'] ?? null) ? $p['title_tr'] : []);
            $label    = ['en' => (string) ($p['price_label_en'] ?? '')] + (is_array($p['price_label_tr'] ?? null) ? $p['price_label_tr'] : []);
            DailyAdminService::setChallengeCompare($id, ['type' => $type, 'question' => $question, 'unit' => $unit,
                'key' => (string) ($p['compare_key'] ?? ''), 'title' => $title,
                'price' => ['key' => (string) ($p['price_key'] ?? ''), 'label' => $label]]);
        }, 'Question saved.', $self . '#compare'),

        'set_twist' => daily_action(function () use ($p, $id) {
            $username = trim((string) ($p['author_username'] ?? ''));
            $authorId = null;
            if ($username !== '') {
                $authorId = DailyAdminService::userIdForUsername($username);
                if ($authorId === null) {
                    throw new InvalidArgumentException("No user @{$username}.");
                }
            }
            DailyAdminService::setTwist($id, (string) ($p['city_id'] ?? ''), (string) ($p['twist_text'] ?? ''),
                                        $authorId, (string) ($p['credit'] ?? ''), (string) ($p['dish_tags'] ?? ''));
        }, 'Twist saved.', $self . '#twists'),

        'remove_twist' => daily_action(fn() => DailyAdminService::removeTwist((string) ($p['twist_id'] ?? '')),
            'Twist removed.', $self . '#twists'),

        'save_headline' => daily_action(function () use ($p, $id) {
            $tr = trim((string) ($p['headline_tr'] ?? '')) !== '' ? json_decode((string) $p['headline_tr'], true) : [];
            if (!is_array($tr)) {
                throw new InvalidArgumentException('Translations must be a JSON object: {"fr": "...", "vi": "..."}.');
            }
            DailyAdminService::setChallengeHeadline($id, (string) ($p['headline_en'] ?? ''), $tr);
            return 'Headline saved.';
        }, 'Headline saved.', $self . '#headline'),

        'save_subtitle' => daily_action(function () use ($p, $id) {
            $tr = trim((string) ($p['subtitle_tr'] ?? '')) !== '' ? json_decode((string) $p['subtitle_tr'], true) : [];
            if (!is_array($tr)) {
                throw new InvalidArgumentException('Translations must be a JSON object: {"fr": "...", "vi": "..."}.');
            }
            DailyAdminService::setChallengeSubtitle($id, (string) ($p['subtitle_en'] ?? ''), $tr);
            return 'Subtitle saved.';
        }, 'Subtitle saved.', $self . '#subtitle'),

        'save_translations' => daily_action(function () use ($p, $id) {
            $row  = DailyAdminService::setChallengeTranslations($id, (array) ($p['tr_text'] ?? []), (array) ($p['tr_context'] ?? []));
            $text = json_decode((string) $row['text_i18n'], true) ?: [];
            $warn = daily_brand_warnings((string) ($text['en'] ?? ''), $text);
            return 'Translations saved (' . count(DailyI18n::translated($text)) . '/18).'
                . ($warn !== '' ? " Check brand terms (they stay in English): {$warn}." : '');
        }, 'Translations saved.', $self . '#translations'),

        'save_twist_translations' => daily_action(function () use ($p) {
            $row  = DailyAdminService::setTwistTranslations((string) ($p['twist_id'] ?? ''), (array) ($p['tr_twist'] ?? []));
            $map  = json_decode((string) $row['text_i18n'], true) ?: [];
            $warn = daily_brand_warnings((string) $row['text'], $map);
            return 'Twist translations saved (' . count(DailyI18n::translated($map)) . '/18).'
                . ($warn !== '' ? " Check brand terms (they stay in English): {$warn}." : '');
        }, 'Twist translations saved.', $self . '#twists'),

        'pick_twist' => daily_action(fn() => DailyTwistProposals::pick((string) ($p['twist_id'] ?? '')),
            'Twist picked.', $self . '#twists'),

        'reject_twist' => daily_action(fn() => DailyTwistProposals::reject((string) ($p['twist_id'] ?? '')),
            'Proposal rejected.', $self . '#twists'),

        'duplicate' => daily_action(function () use ($p, $id) {
            $date = trim((string) ($p['date'] ?? ''));
            $row  = DailyAdminService::duplicateChallenge($id, $date !== '' ? $date : null);
            $_SESSION['daily_last_duplicate'] = $row['id'];
            return 'Duplicated as a draft' . ($date !== '' ? " on {$date}" : '') . '.';
        }, 'Duplicated.', $self),

        'move' => daily_action(fn() => DailyAdminService::moveChallenge($id, trim((string) ($p['date'] ?? ''))),
            'Moved.', $self),

        'delete' => daily_action(fn() => DailyAdminService::deleteChallenge($id), 'Deleted.', '/admin/daily'),

        'cover_upload' => daily_action(fn() => DailyAdminService::setCover($id, daily_cover_upload($_FILES['cover'] ?? null)),
            'Cover saved.', $self . '#cover'),

        'cover_remove' => daily_action(fn() => DailyAdminService::setCover($id, null),
            'Cover removed: the theme\'s default image shows.', $self . '#cover'),

        // This challenge's cover becomes its theme's default: every challenge of
        // the theme without a cover of its own shows it (Specials → Theme covers).
        'cover_as_theme' => daily_action(function () use ($challenge) {
            $url = $challenge['cover_url'] ?? null;
            $key = DailyThemes::effective($challenge['theme'] ?? null, $challenge['challenge_date'] ?? DailyClock::currentDate());
            if (!$url || $key === null) {
                throw new InvalidArgumentException('Upload a cover for this challenge first.');
            }
            DailyThemes::setCover($key, $url);
            return 'Now the default cover of every ' . DailyThemes::name($key) . ' challenge without its own.';
        }, 'Saved.', $self . '#cover'),

        'test_push' => daily_action(function () use ($challenge) {
            $adminId = trim((string) getenv('ADMIN_TEST_USER_ID'));
            if ($adminId === '') {
                throw new InvalidArgumentException('Set ADMIN_TEST_USER_ID to receive test pushes.');
            }
            $row = $challenge;
            $row['challenge_date'] ??= DailyClock::currentDate();
            $n   = DailyPushes::sendTest($row, $adminId);
            if ($n === 0) {
                throw new InvalidArgumentException('Your test account has no device registered for push.');
            }
            DailyAdminService::audit('daily_challenge.test_push', 'daily_challenge', $challenge['id'], null, ['devices' => $n]);
            return "Test push sent to {$n} device(s).";
        }, 'Sent.', $self),

        default => admin_redirect($self),
    };
}

$posted  = isset($formError) ? $_POST : null; // re-render a refused new form with its input
$text    = $isNew ? (string) ($posted['text'] ?? '') : daily_text($challenge['text_i18n']);
$context = $isNew ? (string) ($posted['context'] ?? '') : daily_text($challenge['context_i18n']);
$date    = $isNew ? (string) ($posted['date'] ?? $_GET['date'] ?? '') : (string) ($challenge['challenge_date'] ?? '');
$status  = $isNew ? (string) ($posted['status'] ?? 'scheduled') : $challenge['status'];
$postedTheme = (string) ($posted['theme'] ?? '');
$theme   = $isNew ? (str_starts_with($postedTheme, 'special:') ? DailyThemes::SPECIAL : DailyThemes::normalize($postedTheme)) : ($challenge['theme'] ?? null);
$specialId = $isNew ? (str_starts_with($postedTheme, 'special:') ? substr($postedTheme, 8) : null) : ($challenge['special_id'] ?? null);
$lastDuplicate = $_SESSION['daily_last_duplicate'] ?? null;
unset($_SESSION['daily_last_duplicate']);

$liveCities = [];
foreach (DailyRules::liveCityIds() as $cityId) {
    $city = CityRepository::findById((int) substr($cityId, 5));
    if ($city) $liveCities[$cityId] = $city['name'];
}
$twists = $isNew ? [] : DailyAdminService::twistsFor($challenge['id']);
// Every other twist per city: locals' proposals and the founder's earlier twists (pickable).
$otherTwists = $isNew ? [] : DailyTwistProposals::listForChallenge($challenge['id']);

$title = $isNew ? ($isReserve ? 'New reserve challenge' : 'New challenge') : ($isReserve ? 'Reserve challenge' : 'Challenge ' . $date);
admin_head($title);
admin_nav('/admin/daily');
daily_styles();
?>
<div class="admin-main">
    <div style="margin-bottom:12px"><a href="<?= $isReserve ? '/admin/daily/reserve' : '/admin/daily' ?>" class="btn btn-secondary btn-sm">← Back</a></div>
    <h1 class="page-title"><?= dh($title) ?>
        <?php if (!$isNew): ?><?= daily_state_badge($isReserve && $challenge['challenge_date'] ? 'reserve_used' : $status) ?><?php endif; ?>
    </h1>
    <?= flash_html() ?>
    <?php if (isset($formError)): ?><div class="flash flash-error"><?= dh($formError) ?></div><?php endif; ?>
    <?php if ($lastDuplicate): ?><p style="margin-bottom:12px"><a class="btn btn-secondary btn-sm" href="/admin/daily/<?= dh($lastDuplicate) ?>">Open the copy →</a></p><?php endif; ?>
    <?php if (!$isNew && $date !== ''): ?>
        <p class="daily-muted" style="margin-bottom:14px">Live in Saigon: <?= dh(daily_window_label($date)) ?></p>
    <?php endif; ?>
    <?php if ($isPublished): ?>
        <div class="warning-box" style="margin-bottom:14px">This challenge is published: text edits are live for everyone (cards already posted keep their text).</div>
    <?php endif; ?>

    <div class="daily-cols">
        <div>
            <form method="POST" action="<?= dh($self) ?><?= $isNew && $isReserve ? '?reserve=1' : '' ?>" class="form-card">
                <?= csrf_input() ?>
                <input type="hidden" name="action" value="save">
                <?php if (!$isReserve): ?>
                    <div class="form-group">
                        <label>Date (UTC date of the drop)</label>
                        <input type="date" name="date" value="<?= dh($date) ?>" <?= $isPublished ? 'disabled' : '' ?>>
                        <div class="hint">Leave empty for an undated draft. Only future drops can be planned.</div>
                    </div>
                <?php else: ?>
                    <p class="daily-muted" style="margin-bottom:12px">Reserve: no date. The drop publishes the oldest unused reserve on a day with nothing scheduled.
                        <?= !$isNew && $challenge['challenge_date'] ? '<br>Used on ' . dh($challenge['challenge_date']) . '.' : '' ?></p>
                <?php endif; ?>
                <div class="form-group">
                    <label>Theme</label>
                    <?= daily_theme_select($theme, $date, !$isReserve && !$isPublished, $specialId) ?>
                    <div class="hint"><?= $isReserve ? 'Weekday default: the theme of the day it is used.' : 'Defaults to the theme of the date\'s weekday. A world special day (<a href="/admin/daily/specials">Special days</a>) replaces it.' ?></div>
                </div>
                <div class="form-group">
                    <label>Challenge (English)</label>
                    <textarea name="text" id="dc-text" rows="3" required><?= dh($text) ?></textarea>
                    <div class="daily-counter" id="dc-counter"></div>
                </div>
                <div class="form-group">
                    <label>Context (English, optional)</label>
                    <textarea name="context" id="dc-context" rows="3"><?= dh($context) ?></textarea>
                </div>
                <?php if (!$isReserve && !$isPublished): ?>
                    <div class="form-group">
                        <label>Status</label>
                        <select name="status">
                            <option value="draft" <?= $status === 'draft' ? 'selected' : '' ?>>Draft (not published by the drop)</option>
                            <option value="scheduled" <?= $status === 'scheduled' ? 'selected' : '' ?>>Scheduled (goes live at its drop)</option>
                        </select>
                    </div>
                <?php endif; ?>
                <div class="form-actions"><button class="btn btn-primary" type="submit">Save</button></div>
            </form>

            <?php if (!$isNew):
                $coverTheme = DailyThemes::effective($theme, $date !== '' ? $date : DailyClock::currentDate()) ?? 'only_here';
                $coverUrl   = $challenge['cover_url'] ?? null; ?>
                <?php $hl = json_decode((string) ($challenge['headline_i18n'] ?? ''), true) ?: []; $hlTr = array_diff_key($hl, ['en' => true]); ?>
                <form method="POST" action="<?= dh($self) ?>" class="form-card" id="headline" style="margin-top:16px">
                    <?= csrf_input() ?><input type="hidden" name="action" value="save_headline">
                    <h3 style="margin-bottom:4px">Headline <span class="daily-muted">(Today hero, <?= DailyAdminService::HEADLINE_MAX ?> characters max, <?= count($hlTr) ?>/18 translated)</span></h3>
                    <div class="form-group"><input type="text" name="headline_en" maxlength="<?= DailyAdminService::HEADLINE_MAX ?>" value="<?= dh($hl['en'] ?? '') ?>" placeholder="Find the oldest shop on your street.">
                        <div class="hint">Empty: the hero shows the challenge text.</div></div>
                    <div class="form-group"><label>Translations (optional JSON)</label>
                        <textarea name="headline_tr" rows="3" style="font-family:monospace" placeholder='{"fr": "Trouve la plus vieille boutique de ta rue."}'><?= dh($hlTr ? json_encode($hlTr, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) : '') ?></textarea></div>
                    <div class="form-actions"><button class="btn btn-primary" type="submit">Save headline</button></div>
                </form>

                <?php $st = json_decode((string) ($challenge['subtitle_i18n'] ?? ''), true) ?: []; $stTr = array_diff_key($st, ['en' => true]); ?>
                <form method="POST" action="<?= dh($self) ?>" class="form-card" id="subtitle" style="margin-top:16px">
                    <?= csrf_input() ?><input type="hidden" name="action" value="save_subtitle">
                    <h3 style="margin-bottom:4px">Subtitle <span class="daily-muted">(challenge screen, under the question, <?= DailyAdminService::SUBTITLE_MAX ?> characters max, <?= count($stTr) ?>/18 translated)</span></h3>
                    <div class="form-group"><input type="text" name="subtitle_en" maxlength="<?= DailyAdminService::SUBTITLE_MAX ?>" value="<?= dh($st['en'] ?? '') ?>" placeholder="Raise a glass where the locals drink.">
                        <div class="hint">One short line that doesn't repeat the question. Empty: the challenge text shows.</div></div>
                    <div class="form-group"><label>Translations (optional JSON)</label>
                        <textarea name="subtitle_tr" rows="3" style="font-family:monospace" placeholder='{"fr": "Trinque là où boivent les locaux."}'><?= dh($stTr ? json_encode($stTr, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) : '') ?></textarea></div>
                    <div class="form-actions"><button class="btn btn-primary" type="submit">Save subtitle</button></div>
                </form>

                <form method="POST" action="<?= dh($self) ?>" enctype="multipart/form-data" class="form-card" id="cover" style="margin-top:16px">
                    <?= csrf_input() ?>
                    <h3 style="margin-bottom:4px">Cover image</h3>
                    <p class="daily-muted">The image band at the top of the Daily Challenge card (about 400×160 shown, upload at least 1200×480). Without one, the theme's default image shows.</p>
                    <img src="<?= dh($coverUrl ?? ('https://hilads.live/covers/' . $coverTheme . '.jpg')) ?>" alt=""
                         style="width:100%;max-width:480px;aspect-ratio:5/2;object-fit:cover;border-radius:10px;display:block;margin:10px 0">
                    <div class="hint" style="margin-bottom:10px"><?= $coverUrl ? 'Custom cover for this challenge.' : 'Default image of the theme (' . dh($coverTheme) . ').' ?></div>
                    <input type="file" name="cover" accept="image/jpeg,image/png,image/webp">
                    <div class="form-actions" style="gap:8px">
                        <button class="btn btn-primary btn-sm" type="submit" name="action" value="cover_upload">Upload cover</button>
                        <?php if ($coverUrl): ?>
                            <button class="btn btn-secondary btn-sm" type="submit" name="action" value="cover_as_theme" formnovalidate>Make it the <?= dh(DailyThemes::name($coverTheme)) ?> default</button>
                            <button class="btn btn-secondary btn-sm" type="submit" name="action" value="cover_remove" formnovalidate>Use the theme's default</button>
                        <?php endif; ?>
                    </div>
                    <div class="hint" style="margin-top:8px">Every theme's default cover: <a href="/admin/daily/specials#themes">Specials → Theme covers</a>.</div>
                </form>
            <?php endif; ?>

            <?php if (!$isNew):
                $cmpType = $challenge['compare_type'] ?? null;
                $cmpQ    = json_decode((string) ($challenge['compare_question_i18n'] ?? ''), true) ?: [];
                $cmpU    = json_decode((string) ($challenge['compare_unit_i18n'] ?? ''), true) ?: [];
                $cmpT    = json_decode((string) ($challenge['compare_title_i18n'] ?? ''), true) ?: [];
                $cmpL    = json_decode((string) ($challenge['price_label_i18n'] ?? ''), true) ?: []; ?>
                <form method="POST" action="<?= dh($self) ?>" class="form-card" id="compare" style="margin-top:16px">
                    <?= csrf_input() ?>
                    <input type="hidden" name="action" value="save_compare">
                    <h3 style="margin-bottom:4px">Comparison question <span class="daily-muted">(<?= count(DailyI18n::translated($cmpQ)) ?>/18 translated)</span></h3>
                    <p class="daily-muted" style="margin-bottom:8px">One question whose short answer changes from city to city: a name, a price, a time, a gesture, a word.
                        Answered after the photo (required in the new apps), and again for the poster's home city in Back home.</p>
                    <?php if ($cmpType === null): ?><div class="warning-box" style="margin-bottom:8px">No question yet: every challenge should carry one.</div><?php endif; ?>
                    <div class="form-group">
                        <label>Answer type</label>
                        <select name="compare_type" id="cq-type">
                            <option value="">No question</option>
                            <?php foreach (['word' => 'Word (30 characters): How do locals say cheers?', 'text' => 'Text (80 characters): What\'s the one rule visitors should follow?',
                                            'number' => 'Number with a unit: How many years has it been open?', 'time' => 'Time of day, rounded to 30 min: What time do locals have dinner?'] as $v => $l): ?>
                                <option value="<?= $v ?>"<?= $cmpType === $v ? ' selected' : '' ?>><?= dh($l) ?></option>
                            <?php endforeach; ?>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Question (English)</label>
                        <input type="text" name="q_en" id="cq-q" maxlength="<?= DailyCompare::QUESTION_MAX ?>" value="<?= dh((string) ($cmpQ['en'] ?? '')) ?>" placeholder="How do locals say cheers?">
                        <div class="daily-counter" id="cq-counter"></div>
                    </div>
                    <div class="form-group" id="cq-unit-group">
                        <label>Unit (English, numbers only)</label>
                        <input type="text" name="unit_en" id="cq-unit" maxlength="<?= DailyCompare::UNIT_MAX ?>" value="<?= dh((string) ($cmpU['en'] ?? '')) ?>" placeholder="years">
                    </div>
                    <div class="form-group">
                        <label>Index key <span class="daily-muted">(shared by every question that asks the same thing, so answers add up across days: dinner_time, cheers_word)</span></label>
                        <input type="text" name="compare_key" maxlength="40" pattern="[a-z][a-z0-9_]{1,39}" value="<?= dh((string) ($challenge['compare_key'] ?? '')) ?>" placeholder="dinner_time">
                    </div>
                    <div class="form-group">
                        <label>Index card title (English, optional) <span class="daily-muted">(else the question)</span></label>
                        <input type="text" name="title_en" maxlength="<?= DailyCompare::QUESTION_MAX ?>" value="<?= dh((string) ($cmpT['en'] ?? '')) ?>" placeholder="What time is dinner?">
                    </div>
                    <div class="form-group">
                        <label>Price: what it is for <span class="daily-muted">(optional: the price posters give, shared key and English label)</span></label>
                        <div style="display:flex;gap:8px">
                            <input type="text" name="price_key" maxlength="40" pattern="[a-z][a-z0-9_]{1,39}" value="<?= dh((string) ($challenge['price_key'] ?? '')) ?>" placeholder="coffee_price" style="max-width:200px">
                            <input type="text" name="price_label_en" maxlength="<?= DailyCompare::LABEL_MAX ?>" value="<?= dh((string) ($cmpL['en'] ?? '')) ?>" placeholder="a coffee">
                        </div>
                    </div>
                    <?php if (DailyI18n::isStale($cmpQ, (string) ($cmpQ['en'] ?? ''))): ?>
                        <div class="warning-box" style="margin-bottom:8px">The English question changed since these translations were saved: review them.</div>
                    <?php endif; ?>
                    <details style="margin-bottom:8px"><summary class="daily-muted" style="cursor:pointer;margin-bottom:8px">Question in the 18 other languages</summary>
                        <table class="daily-tr">
                            <?php foreach (daily_locale_names() as $loc => $name): ?>
                                <tr>
                                    <td class="lang"><?= dh($name) ?><br><span class="td-mono"><?= dh($loc) ?></span>
                                        <?= DailyI18n::pick($cmpQ, $loc) === null ? '<br><span class="missing">missing</span>' : '' ?></td>
                                    <td>
                                        <input type="text" name="q_tr[<?= dh($loc) ?>]" maxlength="<?= DailyCompare::QUESTION_TR_MAX ?>" value="<?= dh((string) ($cmpQ[$loc] ?? '')) ?>" placeholder="Question">
                                        <input type="text" name="unit_tr[<?= dh($loc) ?>]" class="cq-unit-tr" maxlength="<?= DailyCompare::UNIT_TR_MAX ?>" value="<?= dh((string) ($cmpU[$loc] ?? '')) ?>" placeholder="Unit" style="margin-top:4px">
                                        <input type="text" name="title_tr[<?= dh($loc) ?>]" maxlength="<?= DailyCompare::QUESTION_TR_MAX ?>" value="<?= dh((string) ($cmpT[$loc] ?? '')) ?>" placeholder="Index card title" style="margin-top:4px">
                                        <input type="text" name="price_label_tr[<?= dh($loc) ?>]" maxlength="<?= DailyCompare::LABEL_TR_MAX ?>" value="<?= dh((string) ($cmpL[$loc] ?? '')) ?>" placeholder="Price label (with its article: une bière)" style="margin-top:4px">
                                    </td>
                                </tr>
                            <?php endforeach; ?>
                        </table>
                    </details>
                    <div class="form-actions"><button class="btn btn-primary" type="submit">Save question</button></div>
                </form>
            <?php endif; ?>

            <?php if (!$isNew):
                $trText = json_decode((string) $challenge['text_i18n'], true) ?: [];
                $trCtx  = json_decode((string) $challenge['context_i18n'], true) ?: [];
                $trDone = DailyI18n::translated($trText);
            ?>
                <form method="POST" action="<?= dh($self) ?>" class="form-card" id="translations">
                    <?= csrf_input() ?>
                    <input type="hidden" name="action" value="save_translations">
                    <h3 style="margin-bottom:4px">Translations <span class="daily-muted">(<?= count($trDone) ?>/18)</span></h3>
                    <p class="daily-muted" style="margin-bottom:8px">Shown to users in their app language; an empty language falls back to English.
                        Keep in English: <?= dh(implode(', ', DailyI18n::BRAND_TERMS)) ?>.</p>
                    <?php if (DailyI18n::isStale($trText, $text)): ?>
                        <div class="warning-box" style="margin-bottom:8px">The English changed since these translations were saved: review them.</div>
                    <?php endif; ?>
                    <?php if (($w = daily_brand_warnings($text, $trText)) !== ''): ?>
                        <div class="warning-box" style="margin-bottom:8px">Brand terms missing: <?= dh($w) ?></div>
                    <?php endif; ?>
                    <table class="daily-tr">
                        <?php foreach (daily_locale_names() as $loc => $name): ?>
                            <tr>
                                <td class="lang"><?= dh($name) ?><br><span class="td-mono"><?= dh($loc) ?></span>
                                    <?= DailyI18n::pick($trText, $loc) === null ? '<br><span class="missing">missing</span>' : '' ?></td>
                                <td>
                                    <textarea name="tr_text[<?= dh($loc) ?>]" rows="2" placeholder="Challenge"><?= dh($trText[$loc] ?? '') ?></textarea>
                                    <textarea name="tr_context[<?= dh($loc) ?>]" rows="2" placeholder="Context (optional)" style="margin-top:4px"><?= dh($trCtx[$loc] ?? '') ?></textarea>
                                </td>
                            </tr>
                        <?php endforeach; ?>
                    </table>
                    <div class="form-actions"><button class="btn btn-primary" type="submit">Save translations</button></div>
                </form>

                <div class="form-card" id="twists">
                    <h3 style="margin-bottom:6px">Local Twists</h3>
                    <?php if ($liveCities === []): ?>
                        <p class="daily-muted">No city is live yet. Switch one on in <a href="/admin/daily/today#cities">Today → Live cities</a>.</p>
                    <?php endif; ?>
                    <?php foreach ($liveCities as $cityId => $cityName): $t = $twists[$cityId] ?? null; ?>
                        <div class="daily-twist">
                            <strong><?= dh($cityName) ?></strong>
                            <form method="POST" action="<?= dh($self) ?>" style="margin-top:6px">
                                <?= csrf_input() ?>
                                <input type="hidden" name="action" value="set_twist">
                                <input type="hidden" name="city_id" value="<?= dh($cityId) ?>">
                                <div class="form-group">
                                    <textarea name="twist_text" rows="2" class="dc-twist" data-city="<?= dh($cityName) ?>" placeholder="e.g. Cơm tấm before 8am, ask for sườn bì chả."><?= dh($t['text'] ?? '') ?></textarea>
                                </div>
                                <div class="daily-inline">
                                    <input type="text" name="author_username" placeholder="author @username" value="<?= dh($t['author_username'] ?? '') ?>">
                                    <input type="text" name="credit" placeholder="or free-text credit" value="<?= dh($t['author_credit'] ?? '') ?>">
                                    <input type="text" name="dish_tags" placeholder="dish tags: cơm tấm, sườn" title="Shown on the spots posted that day in this city (max 5, comma-separated)" value="<?= dh($t['dish_tags'] ?? '') ?>">
                                    <button class="btn btn-primary btn-sm" type="submit">Save twist</button>
                                </div>
                            </form>
                            <?php if ($t): ?>
                                <form method="POST" action="<?= dh($self) ?>" style="margin-top:6px" onsubmit="return confirm('Remove this twist?')">
                                    <?= csrf_input() ?>
                                    <input type="hidden" name="action" value="remove_twist">
                                    <input type="hidden" name="twist_id" value="<?= dh($t['id']) ?>">
                                    <button class="btn btn-danger btn-sm" type="submit">Remove twist</button>
                                </form>
                                <?php $twTr = json_decode((string) ($t['text_i18n'] ?? '{}'), true) ?: []; ?>
                                <details style="margin-top:8px" <?= DailyI18n::isStale($twTr, (string) $t['text']) ? 'open' : '' ?>>
                                    <summary class="daily-muted" style="cursor:pointer">Translations (<?= count(DailyI18n::translated($twTr)) ?>/18)<?= DailyI18n::isStale($twTr, (string) $t['text']) ? ' · English changed, review them' : '' ?></summary>
                                    <form method="POST" action="<?= dh($self) ?>" style="margin-top:6px">
                                        <?= csrf_input() ?>
                                        <input type="hidden" name="action" value="save_twist_translations">
                                        <input type="hidden" name="twist_id" value="<?= dh($t['id']) ?>">
                                        <table class="daily-tr">
                                            <?php foreach (daily_locale_names() as $loc => $name): ?>
                                                <tr><td class="lang"><?= dh($name) ?></td>
                                                    <td><input type="text" name="tr_twist[<?= dh($loc) ?>]" value="<?= dh($twTr[$loc] ?? '') ?>" maxlength="<?= DailyAdminService::TWIST_MAX ?>"></td></tr>
                                            <?php endforeach; ?>
                                        </table>
                                        <div class="form-actions"><button class="btn btn-primary btn-sm" type="submit">Save twist translations</button></div>
                                    </form>
                                </details>
                            <?php endif; ?>
                            <?php $others = array_values(array_filter($otherTwists[$cityId] ?? [], fn($o) => $o['status'] !== 'selected')); ?>
                            <?php if ($others !== []): ?>
                                <div class="daily-muted" style="margin:10px 0 4px">Proposals and earlier twists (<?= count($others) ?>)</div>
                                <div class="table-wrapper"><table class="daily-stack"><tbody>
                                    <?php foreach ($others as $o): ?>
                                        <tr>
                                            <td style="width:150px">
                                                <?php if ($o['proposed_at'] !== null): ?>
                                                    @<?= dh($o['username'] ?? '?') ?><br>
                                                    <span class="daily-muted"><?= dh(date('D H:i', strtotime((string) $o['proposed_at']))) ?></span>
                                                <?php else: ?>
                                                    <span class="daily-muted">your twist</span>
                                                <?php endif; ?>
                                            </td>
                                            <td><?= dh($o['text']) ?></td>
                                            <td style="width:90px"><?= daily_state_badge($o['status'] === 'rejected' ? 'rejected' : 'pending') ?></td>
                                            <td style="width:170px; white-space:nowrap">
                                                <form method="POST" action="<?= dh($self) ?>" style="display:inline">
                                                    <?= csrf_input() ?><input type="hidden" name="action" value="pick_twist"><input type="hidden" name="twist_id" value="<?= dh($o['id']) ?>">
                                                    <button class="btn btn-primary btn-sm" type="submit">Pick</button>
                                                </form>
                                                <?php if ($o['status'] !== 'rejected'): ?>
                                                    <form method="POST" action="<?= dh($self) ?>" style="display:inline" onsubmit="return confirm('Reject this proposal?')">
                                                        <?= csrf_input() ?><input type="hidden" name="action" value="reject_twist"><input type="hidden" name="twist_id" value="<?= dh($o['id']) ?>">
                                                        <button class="btn btn-secondary btn-sm" type="submit">Reject</button>
                                                    </form>
                                                <?php endif; ?>
                                            </td>
                                        </tr>
                                    <?php endforeach; ?>
                                </tbody></table></div>
                            <?php endif; ?>
                        </div>
                    <?php endforeach; ?>
                </div>

                <div class="form-card">
                    <h3 style="margin-bottom:10px">Actions</h3>
                    <form method="POST" action="<?= dh($self) ?>" class="daily-inline" style="margin-bottom:10px">
                        <?= csrf_input() ?><input type="hidden" name="action" value="test_push">
                        <button class="btn btn-secondary btn-sm" type="submit">📲 Send the morning push to me</button>
                    </form>
                    <form method="POST" action="<?= dh($self) ?>" class="daily-inline" style="margin-bottom:10px">
                        <?= csrf_input() ?><input type="hidden" name="action" value="duplicate">
                        <input type="date" name="date"><button class="btn btn-secondary btn-sm" type="submit">Duplicate (date optional)</button>
                    </form>
                    <?php if (!$isPublished && !$isReserve): ?>
                        <form method="POST" action="<?= dh($self) ?>" class="daily-inline" style="margin-bottom:10px">
                            <?= csrf_input() ?><input type="hidden" name="action" value="move">
                            <input type="date" name="date" required><button class="btn btn-secondary btn-sm" type="submit">Move to date</button>
                        </form>
                    <?php endif; ?>
                    <?php if (!$isPublished): ?>
                        <form method="POST" action="<?= dh($self) ?>" class="daily-inline" onsubmit="return confirm('Delete this challenge and its twists?')">
                            <?= csrf_input() ?><input type="hidden" name="action" value="delete">
                            <button class="btn btn-danger btn-sm" type="submit">Delete</button>
                        </form>
                    <?php endif; ?>
                </div>
            <?php endif; ?>
        </div>

        <div>
            <div class="form-card daily-checklist">
                <h3 style="margin-bottom:6px">Editorial checklist</h3>
                <?php foreach ([
                    // SPEC 10.3: every challenge, scheduled or proposed.
                    'Universal: doable in any city, attached to a moment people live anyway (a meal, a coffee, a walk, an evening)',
                    'The photo shows the difference',
                    'The comparison question has a short answer that changes from city to city: a name, a price, a time, a gesture, a word',
                    'The Local Twist shows what makes this city unique',
                    'Inclusive and respectful: alcohol always optional, people asked before being photographed, no stereotypes, nothing that mocks a culture',
                    'Challenge text of 120 characters max, question of 60 characters max',
                    'Phrased as "find a…", never a precise address',
                ] as $item): ?>
                    <label><input type="checkbox"> <?= dh($item) ?></label>
                <?php endforeach; ?>
            </div>
            <div class="form-card">
                <h3 style="margin-bottom:10px">Preview</h3>
                <div class="daily-muted" style="margin-bottom:6px">World card<?= $liveCities ? ' (with the first live city\'s twist)' : '' ?></div>
                <div class="daily-preview-card">
                    <div class="kicker">🔥 Daily Challenge</div>
                    <div class="text" id="pv-text"></div>
                    <div class="context" id="pv-context"></div>
                    <div class="context" id="pv-question" hidden></div>
                    <div class="twist" id="pv-twist" hidden></div>
                    <div class="cta">Take the challenge</div>
                </div>
                <div id="pv-answer-wrap" hidden>
                    <div class="daily-muted" style="margin-bottom:6px">Answer step in the app</div>
                    <div class="daily-preview-card" style="margin-bottom:12px">
                        <div class="text" id="pv-answer-q"></div>
                        <div class="context" id="pv-answer-input"></div>
                    </div>
                </div>
                <div class="daily-muted" style="margin-bottom:6px">Morning push</div>
                <div class="daily-preview-push">
                    <div class="icon">Hi</div>
                    <div><div class="title">Daily Challenge</div><div class="body" id="pv-push"></div></div>
                </div>
                <p class="daily-muted" style="margin-top:8px">Content and order match what the app shows; the final card design lands with the app update.</p>
            </div>
        </div>
    </div>
</div>
<script>
(function () {
    var text = document.getElementById('dc-text'), ctx = document.getElementById('dc-context');
    var counter = document.getElementById('dc-counter');
    var twist = document.querySelector('.dc-twist');
    function render() {
        var t = text.value.trim(), n = [...text.value.trim()].length;
        counter.textContent = n + ' / 120';
        counter.className = 'daily-counter' + (n > 120 ? ' over' : n > 100 ? ' near' : '');
        document.getElementById('pv-text').textContent = t || 'Your challenge text';
        document.getElementById('pv-context').textContent = ctx.value.trim();
        document.getElementById('pv-push').textContent = "Today's Daily Challenge: " + (t || '…');
        var tw = document.getElementById('pv-twist');
        if (twist && twist.value.trim()) { tw.hidden = false; tw.textContent = '📍 ' + twist.dataset.city + ' Local Twist: ' + twist.value.trim(); }
        else { tw.hidden = true; }
    }
    [text, ctx, twist].forEach(function (el) { if (el) el.addEventListener('input', render); });
    render();

    // Comparison question: counter, unit field for numbers, and the card line and answer step previews.
    var cqType = document.getElementById('cq-type'), cqQ = document.getElementById('cq-q'), cqUnit = document.getElementById('cq-unit');
    function renderCompare() {
        if (!cqType) return;
        var type = cqType.value, q = cqQ.value.trim(), n = [...q].length, unit = cqUnit.value.trim();
        var cc = document.getElementById('cq-counter');
        cc.textContent = n + ' / 60';
        cc.className = 'daily-counter' + (n > 60 ? ' over' : n > 50 ? ' near' : '');
        document.getElementById('cq-unit-group').hidden = type !== 'number';
        document.querySelectorAll('.cq-unit-tr').forEach(function (el) { el.hidden = type !== 'number'; });
        var line = document.getElementById('pv-question');
        line.hidden = !type;
        line.textContent = "Today's question: " + (q || '…');
        document.getElementById('pv-answer-wrap').hidden = !type;
        document.getElementById('pv-answer-q').textContent = q || 'Your question';
        document.getElementById('pv-answer-input').textContent = {
            word: '[ text field ]  0 / 30', text: '[ text field ]  0 / 80',
            number: '[ number pad ]  ' + (unit || '(no unit)'), time: '[ time wheel ]  19:00 · 19:30 · 20:00'
        }[type] || '';
    }
    if (cqType) {
        [cqType, cqQ, cqUnit].forEach(function (el) { el.addEventListener('input', renderCompare); });
        renderCompare();
    }

    // Theme follows the date's weekday until picked by hand.
    var theme = document.getElementById('dc-theme'), date = document.querySelector('input[name="date"]');
    if (theme && date && theme.dataset.followDate) {
        theme.addEventListener('change', function () { delete theme.dataset.followDate; });
        date.addEventListener('change', function () {
            if (!theme.dataset.followDate || !date.value) return;
            var dow = new Date(date.value + 'T00:00:00Z').getUTCDay() || 7;
            var opt = theme.querySelector('option[data-weekday="' + dow + '"]');
            if (opt) theme.value = opt.value;
        });
    }
})();
</script>
<?php admin_foot();
