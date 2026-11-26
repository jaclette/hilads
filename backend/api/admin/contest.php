<?php

declare(strict_types=1);

admin_require_login();

// Admin › Launch Season (Contest): seasons and their settings, the live dashboard, the
// participants (invalidate a photo / like, disqualify), the suspicious signals, the winner
// and the exports, the public rules text, the log. Every change is logged in
// contest_admin_log; destructive ones ask first. The contest never touches the game's
// score: see src/Contest.php.

$pdo  = Database::pdo();
$esc  = static fn($v): string => htmlspecialchars((string) $v, ENT_QUOTES);
$tabs = ['seasons' => 'Seasons', 'dashboard' => 'Overview', 'participants' => 'Participants',
         'signals' => 'Fair play signals', 'winner' => 'Winner & export', 'rules' => 'Rules', 'log' => 'History'];
$tab  = isset($tabs[$_GET['tab'] ?? '']) ? (string) $_GET['tab'] : 'dashboard';
$seasons = Contest::seasons();
$sid  = (int) ($_GET['season'] ?? ($seasons[0]['id'] ?? 0));
$season = $sid > 0 ? Contest::season($sid) : null;
$url  = static function (string $t, array $q = []) use (&$sid): string {
    return '/admin/launch-season?' . http_build_query(['tab' => $t, 'season' => $sid] + $q);
};

$intField = static function (string $k, int $min = 0): int {
    $v = filter_var($_POST[$k] ?? null, FILTER_VALIDATE_INT);
    if ($v === false || $v < $min) throw new InvalidArgumentException("{$k} must be a number ≥ {$min}.");
    return $v;
};
$dateField = static function (string $k): string {
    $v = (string) ($_POST[$k] ?? '');
    if (!DailyClock::isValidDate($v)) throw new InvalidArgumentException("{$k} must be a date.");
    return $v;
};

// Tester picker: accounts matching what is typed (username first, then display name), as JSON.
if (isset($_GET['suggest'])) {
    $q = ltrim(trim((string) ($_GET['q'] ?? '')), '@');
    $out = [];
    if (mb_strlen($q) >= 2) {
        $like = str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $q);
        $stmt = $pdo->prepare("
            SELECT u.username, u.display_name, u.home_country, to_timestamp(u.created_at)::date::text AS since,
                   (SELECT count(*) FROM daily_proofs p WHERE p.user_id = u.id AND p.moderation_status = 'approved') AS photos
            FROM users u
            WHERE u.deleted_at IS NULL AND u.username IS NOT NULL AND NOT u.is_demo AND NOT u.is_fake
              AND (u.username ILIKE ? OR u.display_name ILIKE ?)
            ORDER BY (lower(u.username) = lower(?)) DESC, (u.username ILIKE ?) DESC, length(u.username)
            LIMIT 8
        ");
        $stmt->execute([$like . '%', '%' . $like . '%', $q, $like . '%']);
        $out = $stmt->fetchAll(PDO::FETCH_ASSOC);
    }
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($out, JSON_UNESCAPED_UNICODE);
    exit;
}

// ── Actions ────────────────────────────────────────────────────────────────
// Copies a season's content (photos, sample itinerary, founder word, prize text, souvenir prizes) onto
// another: never its participants, testers, head-start, rules or scores. The photo files are shared (a
// removed photo only leaves the season's list, the file stays on R2). Returns the source's name.
$copyContent = static function (int $dst, int $src) use ($pdo): string {
    if ($dst === $src) throw new InvalidArgumentException('Pick another season to copy from.');
    $from = Contest::season($src) ?? throw new InvalidArgumentException('Unknown season to copy from.');
    $pdo->prepare("UPDATE contest_seasons d SET photos = s.photos, itinerary = s.itinerary, founder = s.founder,
                          prize_i18n = s.prize_i18n, souvenir = s.souvenir, fallback_prize_i18n = s.fallback_prize_i18n, tab = s.tab, updated_at = now()
                   FROM contest_seasons s WHERE d.id = ? AND s.id = ?")->execute([$dst, $src]);
    Contest::log($dst, 'copy_content', null, ['from' => $src]);
    Contest::forget($dst);
    return (string) $from['name'];
};

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    csrf_verify();
    $do   = (string) ($_POST['do'] ?? '');
    $back = $url($tab, array_filter(['user' => $_POST['user'] ?? null, 'q' => $_POST['q'] ?? null]));
    try {
        if ($do === 'save_season') {
            $fields = ['name' => trim((string) ($_POST['name'] ?? '')), 'start_date' => $dateField('start_date'),
                       'end_date' => $dateField('end_date'), 'final_week_start' => $dateField('final_week_start')];
            if ($fields['name'] === '') throw new InvalidArgumentException('Give the season a name.');
            if (!($fields['start_date'] <= $fields['final_week_start'] && $fields['final_week_start'] <= $fields['end_date'])) {
                throw new InvalidArgumentException('Dates: start ≤ final week start ≤ end.');
            }
            // The campaign counts the regular points (2026-11-26): only these settings are used and posted.
            foreach (['headstart_top_n', 'prize_threshold_players', 'prize_threshold_photos', 'seats_show_from'] as $k) $fields[$k] = $intField($k, in_array($k, ['headstart_top_n', 'seats_show_from'], true) ? 0 : 1);
            $fields['is_test'] = !empty($_POST['is_test']) ? 'true' : 'false';
            $id = (int) ($_POST['id'] ?? 0);
            if ($id > 0) {
                $old = Contest::season($id) ?? throw new InvalidArgumentException('Unknown season.');
                $set = implode(', ', array_map(static fn($k) => "{$k} = ?", array_keys($fields)));
                $pdo->prepare("UPDATE contest_seasons SET {$set}, updated_at = now() WHERE id = ?")->execute([...array_values($fields), $id]);
                $changed = [];
                foreach ($fields as $k => $v) {
                    $was = is_bool($old[$k]) ? ($old[$k] ? 'true' : 'false') : (string) $old[$k];
                    if ($was !== (string) $v) $changed[$k] = [$was, $v];
                }
                Contest::log($id, 'settings', null, $changed);
                Contest::forget($id);
                $msg = 'Season saved' . ($changed ? ' (' . implode(', ', array_keys($changed)) . ')' : ', nothing changed') . '. Standings recomputed.';
                if (!empty($_POST['refreeze']) && ($s = Contest::season($id)) && $s['headstart_frozen_at'] !== null) {
                    $n = Contest::freezeHeadstart($s, true);
                    Contest::log($id, 'refreeze_headstart', null, ['players' => $n]);
                    $msg .= " Head-start re-taken ({$n} players).";
                }
                flash_set('success', $msg);
                $sid = $id;
            } else {
                $cols = implode(', ', array_keys($fields));
                $q    = implode(', ', array_fill(0, count($fields), '?'));
                $stmt = $pdo->prepare("INSERT INTO contest_seasons ({$cols}) VALUES ({$q}) RETURNING id");
                $stmt->execute(array_values($fields));
                $sid = (int) $stmt->fetchColumn();
                $s   = Contest::season($sid);
                $pdo->prepare("INSERT INTO contest_rules (season_id, locale, body) VALUES (?, 'en', ?) ON CONFLICT DO NOTHING")
                    ->execute([$sid, Contest::placeholderRules($s)]);
                Contest::log($sid, 'create', null, $fields);
                $copied = (int) ($_POST['copy_from'] ?? 0) > 0 ? $copyContent($sid, (int) $_POST['copy_from']) : null;
                flash_set('success', 'Season created as a draft' . ($copied !== null ? ", with the content of \"{$copied}\" (photos, itinerary, founder word, prize, souvenirs)" : '') . '. Publish it when ready.');
            }
            admin_redirect('/admin/launch-season?tab=seasons&season=' . $sid);
        } elseif ($season !== null && $do === 'save_prize') {
            $prize = [];
            foreach (Contest::LOCALES as $l) {
                $t  = trim((string) ($_POST['prize_title'][$l] ?? ''));
                $st = trim((string) ($_POST['prize_subtitle'][$l] ?? ''));
                $de = trim((string) ($_POST['prize_description'][$l] ?? ''));
                if ($t === '' && $st === '' && $de === '') continue;
                if ($t === '') throw new InvalidArgumentException("Prize ({$l}): a title is needed when there is a line or a description.");
                if (mb_strlen($t) > 60 || mb_strlen($st) > 140 || mb_strlen($de) > 400) throw new InvalidArgumentException("Prize ({$l}): title 60 characters max, line 140, description 400.");
                $prize[$l] = ['title' => $t, 'subtitle' => $st, 'description' => $de];
            }
            if (empty($prize['en'])) throw new InvalidArgumentException('The English prize title is required (other languages fall back to it).');
            $pdo->prepare("UPDATE contest_seasons SET prize_i18n = ?::jsonb, updated_at = now() WHERE id = ?")
                ->execute([json_encode($prize, JSON_UNESCAPED_UNICODE), $season['id']]);
            Contest::log($season['id'], 'prize', null, ['en' => $prize['en'], 'locales' => array_keys($prize)]);
            flash_set('success', 'Prize saved: the app and the web show it at their next refresh (no new app version required).');
        } elseif ($season !== null && $do === 'save_fallback') {
            $fb = [];
            foreach (Contest::LOCALES as $l) {
                $t = trim((string) ($_POST['fallback'][$l] ?? ''));
                if ($t === '') continue;
                if (mb_strlen($t) > 120) throw new InvalidArgumentException("Fallback prize ({$l}): 120 characters max.");
                $fb[$l] = $t;
            }
            if ($fb !== [] && empty($fb['en'])) throw new InvalidArgumentException('The English fallback prize is required (other languages fall back to it).');
            $pdo->prepare("UPDATE contest_seasons SET fallback_prize_i18n = ?::jsonb, updated_at = now() WHERE id = ?")
                ->execute([json_encode((object) $fb, JSON_UNESCAPED_UNICODE), $season['id']]);
            Contest::log($season['id'], 'fallback_prize', null, ['en' => $fb['en'] ?? null, 'locales' => array_keys($fb)]);
            Contest::forget($season['id']);
            flash_set('success', $fb === [] ? 'Fallback prize cleared: the apps show the placeholder ("a prize to be announced").' : 'Fallback prize saved: shown on the goal card, the rules section and the rules page.');
        } elseif ($season !== null && $do === 'save_tab') {
            $icon = (string) ($_POST['tab_icon'] ?? 'airplane');
            if (!in_array($icon, Contest::TAB_ICONS, true)) throw new InvalidArgumentException('Pick one of the icons.');
            $labels = [];
            foreach (Contest::LOCALES as $l) {
                $t = trim((string) ($_POST['tab_label'][$l] ?? ''));
                if ($t === '') continue;
                if (mb_strlen($t) > 12) throw new InvalidArgumentException("Tab label ({$l}): 12 characters max (it sits under an icon).");
                $labels[$l] = $t;
            }
            $ctas = [];
            foreach (Contest::LOCALES as $l) {
                $t = trim((string) ($_POST['prize_cta'][$l] ?? ''));
                if ($t === '') continue;
                if (mb_strlen($t) > 28) throw new InvalidArgumentException("Prize button ({$l}): 28 characters max (a pill on the photo).");
                $ctas[$l] = $t;
            }
            $pdo->prepare("UPDATE contest_seasons SET tab = ?::jsonb, updated_at = now() WHERE id = ?")
                ->execute([json_encode(['icon' => $icon, 'label' => (object) $labels, 'prize_cta' => (object) $ctas], JSON_UNESCAPED_UNICODE), $season['id']]);
            Contest::log($season['id'], 'tab', null, ['icon' => $icon, 'en' => $labels['en'] ?? null]);
            flash_set('success', 'Tab saved: the apps show it at their next refresh.');
        } elseif ($season !== null && $do === 'copy_content') {
            $name = $copyContent((int) $season['id'], (int) ($_POST['copy_from'] ?? 0));
            flash_set('success', "Content copied from \"{$name}\": photos, sample itinerary, founder word, prize text and souvenir prizes. Participants, testers, rules and scores untouched.");
        } elseif ($season !== null && $do === 'save_souvenir') {
            $i18n = [];
            foreach (Contest::LOCALES as $l) {
                $t = trim((string) ($_POST['souvenir_text'][$l] ?? ''));
                if ($t === '') continue;
                if (mb_strlen($t) > 160) throw new InvalidArgumentException("Souvenir line ({$l}): 160 characters max.");
                $i18n[$l] = $t;
            }
            $sv = ['enabled' => !empty($_POST['souvenir_enabled']), 'to' => max(2, min(50, (int) ($_POST['souvenir_to'] ?? 10))), 'i18n' => $i18n];
            $pdo->prepare("UPDATE contest_seasons SET souvenir = ?::jsonb, updated_at = now() WHERE id = ?")
                ->execute([json_encode($sv, JSON_UNESCAPED_UNICODE), $season['id']]);
            Contest::log($season['id'], 'souvenir', null, ['enabled' => $sv['enabled'], 'to' => $sv['to'], 'locales' => array_keys($i18n)]);
            flash_set('success', 'Souvenir prizes ' . ($sv['enabled'] ? 'on: ranks 2 to ' . $sv['to'] : 'off') . '. The app and the web show it at their next refresh.');
        } elseif ($season !== null && in_array($do, ['trip_text', 'founder_meta', 'founder_photo', 'day_photo_upload', 'day_photo_remove'], true)) {
            $days = ContestTrip::days($season);
            $founder = ContestTrip::founder($season);
            $tl = in_array($_POST['tl'] ?? '', Contest::LOCALES, true) ? (string) $_POST['tl'] : 'en';
            if ($do === 'trip_text') {
                for ($d = 0; $d < ContestTrip::DAYS; $d++) {
                    $title = trim((string) ($_POST['day_title'][$d] ?? ''));
                    $text  = trim((string) ($_POST['day_text'][$d] ?? ''));
                    if (mb_strlen($title) > 60 || mb_strlen($text) > 220) throw new InvalidArgumentException('Day ' . ($d + 1) . ': title 60 characters max, line 220.');
                    if ($title === '' && $tl === 'en') throw new InvalidArgumentException('Day ' . ($d + 1) . ': the English title is required.');
                    $days[$d]['i18n'][$tl] = ['title' => $title, 'text' => $text];
                }
                $msg = trim((string) ($_POST['founder_message'] ?? ''));
                if (mb_strlen($msg) > 600) throw new InvalidArgumentException('Founder message: 600 characters max.');
                $founder['i18n'][$tl] = $msg;
            } elseif ($do === 'founder_meta') {
                $founder['name'] = mb_substr(trim((string) ($_POST['founder_name'] ?? '')), 0, 60);
                $founder['role'] = mb_substr(trim((string) ($_POST['founder_role'] ?? '')), 0, 60);
            } elseif ($do === 'founder_photo') {
                $founder['photo'] = ContestPhotos::importUpload($_FILES['photo'] ?? [], $founder['name'] ?: 'Hilads', '');
            } else {
                $d = (int) ($_POST['day'] ?? 0) - 1;
                if ($d < 0 || $d >= ContestTrip::DAYS) throw new InvalidArgumentException('Unknown day.');
                $days[$d]['photo'] = $do === 'day_photo_upload'
                    ? ContestPhotos::importUpload($_FILES['photo'] ?? [], (string) ($_POST['credit'] ?? ''), '')
                    : null;
            }
            $pdo->prepare("UPDATE contest_seasons SET itinerary = ?::jsonb, founder = ?::jsonb, updated_at = now() WHERE id = ?")
                ->execute([json_encode($days, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), json_encode($founder, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), $season['id']]);
            Contest::log($season['id'], $do, $tl);
            flash_set('success', 'Saved: the prize screen shows it at its next refresh.');
            $back = $url('seasons', ['tl' => $tl]) . '#trip';
        } elseif ($season !== null && in_array($do, ['photo_pixabay', 'photo_upload', 'photo_remove', 'photo_up', 'photo_caption'], true)) {
            $photos = ContestPhotos::of($season);
            $i = (int) ($_POST['i'] ?? -1);
            $target = (string) ($_POST['target'] ?? 'photos');
            if ($do === 'photo_pixabay' && preg_match('/^day([1-7])$/', $target, $tm)) {
                $entry = ContestPhotos::importPixabay((string) ($_POST['large'] ?? ''), (string) ($_POST['page'] ?? ''), (string) ($_POST['user'] ?? ''), (string) ($_POST['caption'] ?? ''), (string) ($_POST['fallback'] ?? ''));
                $days = ContestTrip::days($season);
                $days[(int) $tm[1] - 1]['photo'] = $entry;
                $pdo->prepare("UPDATE contest_seasons SET itinerary = ?::jsonb, updated_at = now() WHERE id = ?")
                    ->execute([json_encode($days, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), $season['id']]);
                Contest::log($season['id'], 'day_photo_pixabay', $target);
                flash_set('success', 'Photo set for ' . str_replace('day', 'day ', $target) . '.');
                admin_redirect($url('seasons', ['q' => $_POST['q'] ?? null]) . '#trip');
            }
            if ($do === 'photo_pixabay' || $do === 'photo_upload') {
                if (count($photos) >= ContestPhotos::MAX) throw new InvalidArgumentException('Up to ' . ContestPhotos::MAX . ' photos: remove one first.');
                $photos[] = $do === 'photo_pixabay'
                    ? ContestPhotos::importPixabay((string) ($_POST['large'] ?? ''), (string) ($_POST['page'] ?? ''), (string) ($_POST['user'] ?? ''), (string) ($_POST['caption'] ?? ''), (string) ($_POST['fallback'] ?? ''))
                    : ContestPhotos::importUpload($_FILES['photo'] ?? [], (string) ($_POST['credit'] ?? ''), (string) ($_POST['caption'] ?? ''));
            } elseif (!isset($photos[$i])) {
                throw new InvalidArgumentException('Unknown photo.');
            } elseif ($do === 'photo_remove') {
                array_splice($photos, $i, 1);
            } elseif ($do === 'photo_up' && $i > 0) {
                [$photos[$i - 1], $photos[$i]] = [$photos[$i], $photos[$i - 1]];
            } elseif ($do === 'photo_caption') {
                $photos[$i]['caption'] = mb_substr(trim((string) ($_POST['caption'] ?? '')), 0, 60);
            }
            $pdo->prepare("UPDATE contest_seasons SET photos = ?::jsonb, updated_at = now() WHERE id = ?")
                ->execute([json_encode(array_values($photos), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), $season['id']]);
            Contest::log($season['id'], $do, (string) $i, ['count' => count($photos)]);
            flash_set('success', 'Photos saved: the app and the web show them at their next refresh.');
            $back = $url('seasons', ['q' => $_POST['q'] ?? null]) . '#photos';
        } elseif ($season !== null && in_array($do, ['start', 'pause', 'resume', 'end', 'reopen'], true)) {
            $sql = match ($do) {
                'start'  => "UPDATE contest_seasons SET status = 'running', paused = false, updated_at = now() WHERE id = ?",
                'pause'  => "UPDATE contest_seasons SET paused = true, updated_at = now() WHERE id = ?",
                'resume' => "UPDATE contest_seasons SET paused = false, updated_at = now() WHERE id = ?",
                'end'    => "UPDATE contest_seasons SET status = 'ended', updated_at = now() WHERE id = ?",
                'reopen' => "UPDATE contest_seasons SET status = 'running', updated_at = now() WHERE id = ?",
            };
            if ($do === 'start' && !$season['is_test']) {
                $other = $pdo->prepare("SELECT name FROM contest_seasons WHERE NOT is_test AND status = 'running' AND id <> ?");
                $other->execute([$season['id']]);
                if ($n = $other->fetchColumn()) throw new InvalidArgumentException("End “{$n}” first: one real season runs at a time.");
            }
            $pdo->prepare($sql)->execute([$season['id']]);
            Contest::log($season['id'], $do);
            Contest::forget($season['id']);
            flash_set('success', 'Season: ' . $do . '.');
        } elseif ($season !== null && $do === 'freeze') {
            $n = Contest::freezeHeadstart($season, true);
            Contest::log($season['id'], 'refreeze_headstart', null, ['players' => $n]);
            flash_set('success', "Head-start taken from the season ranking now: {$n} players.");
        } elseif ($season !== null && $do === 'tester_add') {
            $name = ltrim(trim((string) ($_POST['username'] ?? '')), '@');
            $stmt = $pdo->prepare("SELECT id FROM users WHERE lower(username) = lower(?) AND deleted_at IS NULL");
            $stmt->execute([$name]);
            $uid = $stmt->fetchColumn() ?: throw new InvalidArgumentException("No account @{$name}.");
            $pdo->prepare("INSERT INTO contest_testers (season_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING")->execute([$season['id'], $uid]);
            Contest::log($season['id'], 'tester_add', $uid, ['username' => $name]);
            flash_set('success', "@{$name} can see this test season.");
        } elseif ($season !== null && $do === 'tester_remove') {
            $pdo->prepare("DELETE FROM contest_testers WHERE season_id = ? AND user_id = ?")->execute([$season['id'], (string) $_POST['user_id']]);
            Contest::log($season['id'], 'tester_remove', (string) $_POST['user_id']);
            flash_set('success', 'Tester removed.');
        } elseif ($season !== null && in_array($do, ['invalidate_photo', 'invalidate_vote'], true)) {
            Contest::invalidate($season['id'], substr($do, 11), (string) ($_POST['target'] ?? ''), (string) ($_POST['reason'] ?? ''));
            flash_set('success', 'Invalidated for the contest (the game keeps it). Standings recomputed.');
        } elseif ($season !== null && $do === 'undo_invalidation') {
            Contest::undoInvalidation($season['id'], (int) ($_POST['id'] ?? 0));
            flash_set('success', 'Counts again.');
        } elseif ($season !== null && in_array($do, ['disqualify', 'undo_disqualify'], true)) {
            Contest::disqualify($season['id'], (string) ($_POST['user'] ?? ''), $do === 'disqualify', (string) ($_POST['reason'] ?? ''));
            flash_set('success', $do === 'disqualify' ? 'Disqualified.' : 'Back in the contest.');
        } elseif ($season !== null && $do === 'winner') {
            $field = (string) ($_POST['field'] ?? '');
            if ($field === 'winner_user_id') {
                $pdo->prepare("UPDATE contest_seasons SET winner_user_id = ?, updated_at = now() WHERE id = ?")->execute([(string) $_POST['user'] ?: null, $season['id']]);
            } elseif (in_array($field, ['winner_contacted_at', 'winner_confirmed_at', 'prize_sent_at'], true)) {
                $on = !empty($_POST['on']);
                $pdo->prepare("UPDATE contest_seasons SET {$field} = " . ($on ? 'now()' : 'NULL') . ", updated_at = now() WHERE id = ?")->execute([$season['id']]);
            } else {
                throw new InvalidArgumentException('Unknown field.');
            }
            Contest::log($season['id'], 'winner_' . $field, (string) ($_POST['user'] ?? ''), ['on' => !empty($_POST['on'])]);
            flash_set('success', 'Saved.');
        } elseif ($season !== null && $do === 'rules') {
            $locale = strtolower(trim((string) ($_POST['locale'] ?? '')));
            if (!preg_match('/^[a-z]{2,3}(-[a-z]{2,4})?$/', $locale)) throw new InvalidArgumentException('Locale like en, fr, fil, pt-br.');
            $body = trim((string) ($_POST['body'] ?? ''));
            if ($body === '') throw new InvalidArgumentException('The rules text is empty.');
            $final = !empty($_POST['is_final']) ? 'true' : 'false';
            $pdo->prepare("
                INSERT INTO contest_rules (season_id, locale, body, is_final) VALUES (?, ?, ?, ?)
                ON CONFLICT (season_id, locale) DO UPDATE SET body = EXCLUDED.body, is_final = EXCLUDED.is_final,
                    version = contest_rules.version + 1, updated_at = now()
            ")->execute([$season['id'], $locale, $body, $final]);
            Contest::log($season['id'], 'rules', $locale, ['final' => $final === 'true', 'length' => mb_strlen($body)]);
            flash_set('success', "Rules ({$locale}) saved. New joiners accept this version; the public page updates within a minute.");
            $back = $url('rules', ['locale' => $locale]);
        }
    } catch (\Throwable $e) {
        flash_set('error', $e->getMessage());
    }
    admin_redirect($back);
}

// ── Page ───────────────────────────────────────────────────────────────────
$badge = static function (?array $s) use ($esc): string {
    if ($s === null) return '';
    $phase = Contest::phase($s);
    $label = ['draft' => 'Draft', 'upcoming' => 'Running · not started', 'season' => 'Running', 'final' => 'Final week',
              'over' => 'Over · not ended', 'ended' => 'Ended'][$phase];
    $cls = ['draft' => 'b-mute', 'upcoming' => 'b-info', 'season' => 'b-ok', 'final' => 'b-brand', 'over' => 'b-warn', 'ended' => 'b-mute'][$phase];
    return '<span class="badge ' . $cls . '">' . $esc($s['paused'] ? $label . ' · paused' : $label) . '</span>'
         . ($s['is_test'] ? ' <span class="badge b-violet">TEST</span>' : '');
};
$who = static fn(array $r): string => $esc($r['username'] ? '@' . $r['username'] : ($r['displayName'] ?? $r['userId']));

admin_head('Launch Season');
admin_nav('/admin/launch-season');
?>
<style>
.ls-subnav { display:flex; gap:6px; flex-wrap:wrap; margin:10px 0 18px; }
.ls-subnav a { padding:6px 12px; border:1px solid var(--line); border-radius:6px; color:var(--muted); font-size:13px; }
.ls-subnav a.active, .ls-subnav a:hover { color:var(--text); background:var(--surface-2); text-decoration:none; }
.ls-grid { display:grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap:10px 16px; }
.ls-grid label { display:flex; flex-direction:column; gap:4px; color:var(--muted); font-size:12px; }
.ls-grid input { background:var(--surface); border:1px solid var(--line); color:var(--text); padding:6px 8px; border-radius:5px; }
.ls-bar { height:14px; background:var(--surface-2); border-radius:7px; overflow:hidden; max-width:520px; }
.ls-bar i { display:block; height:100%; background:#FF7A3C; }
.ls-muted { color:var(--faint); font-size:12px; }
.ls-inline { display:inline-flex; gap:6px; align-items:center; margin:0; }
.ls-inline input[type=text] { background:var(--surface); border:1px solid var(--line); color:var(--text); padding:4px 6px; border-radius:4px; width:180px; }
.ls-photo { width:64px; height:64px; object-fit:cover; border-radius:6px; }
.ls-cols { display:grid; grid-template-columns: 1fr 1fr; gap:20px; }
@media (max-width: 1100px) { .ls-cols { grid-template-columns: 1fr; } }
.ls-x { text-decoration: line-through; color:var(--faint); }
</style>
<main class="admin-main">
  <?= ui_page_head('Game', 'Seasons', 'Launch Season contests: dates, prize, participants, the ranking, the winner. Test seasons are only seen by their testers.') ?>
  <?= flash_html() ?>
  <form method="get" class="toolbar" style="margin:0">
    <input type="hidden" name="tab" value="<?= $esc($tab) ?>">
    <select name="season" onchange="this.form.submit()">
      <?php foreach ($seasons as $s): ?>
        <option value="<?= $s['id'] ?>"<?= $s['id'] === $sid ? ' selected' : '' ?>><?= $esc($s['name']) ?> (<?= $esc($s['start_date']) ?> → <?= $esc($s['end_date']) ?>)<?= $s['is_test'] ? ' · TEST' : '' ?></option>
      <?php endforeach; ?>
      <?php if ($seasons === []): ?><option>No season yet</option><?php endif; ?>
    </select>
    <?= $badge($season) ?>
  </form>
  <div style="margin:12px 0 18px"><?= ui_tabs(array_map(fn ($t, $label) => [$label, $url($t), null, $t === $tab], array_keys($tabs), $tabs), 'Season section') ?>
  </div>

<?php if ($tab === 'seasons'): ?>
  <?php
  $form = static function (?array $s) use ($esc, $pdo): void {
      $v = static fn(string $k, $d = '') => $esc($s[$k] ?? $d);
      // Points are the regular Hilads points (config/scoring.php): no likes cap or referral settings any more.
      $defaults = ['headstart_top_n' => 10, 'prize_threshold_players' => 500, 'prize_threshold_photos' => 10, 'seats_show_from' => 20];
      $labels = ['headstart_top_n' => 'Head-start top N', 'prize_threshold_players' => "Players' goal: players needed",
                 'prize_threshold_photos' => "Players' goal: photos each", 'seats_show_from' => 'Show "x of 500 seats taken" from (players)'];
      ?>
      <form method="post" class="form-card" style="max-width:none">
        <?= csrf_input() ?><input type="hidden" name="do" value="save_season"><input type="hidden" name="id" value="<?= (int) ($s['id'] ?? 0) ?>">
        <div class="ls-grid">
          <label>Name<input type="text" name="name" value="<?= $v('name', 'Launch Trip') ?>" required></label>
          <label>Start date<input type="date" name="start_date" value="<?= $v('start_date') ?>" required></label>
          <label>Final week starts<input type="date" name="final_week_start" value="<?= $v('final_week_start') ?>" required></label>
          <label>End date<input type="date" name="end_date" value="<?= $v('end_date') ?>" required></label>
          <?php foreach ($labels as $k => $l): ?>
            <label><?= $esc($l) ?><input type="number" min="0" name="<?= $k ?>" value="<?= $v($k, $defaults[$k]) ?>" required></label>
          <?php endforeach; ?>
        </div>
        <p style="margin:12px 0 0"><label><input type="checkbox" name="is_test" value="1"<?= !empty($s['is_test']) ? ' checked' : '' ?>> Test season: only the testers below see it (and only they get the "season is live" push); never in a real season</label></p>
        <?php if (!$s): $others = $pdo->query("SELECT id, name, is_test FROM contest_seasons ORDER BY id DESC")->fetchAll(PDO::FETCH_ASSOC); ?>
          <?php if ($others): ?>
            <p style="margin:8px 0 0"><label>Copy content from
              <select name="copy_from" style="background:var(--surface);border:1px solid var(--line);color:var(--text);padding:4px 6px;border-radius:4px">
                <option value="0">Nothing (start empty)</option>
                <?php foreach ($others as $o): ?><option value="<?= (int) $o['id'] ?>">#<?= (int) $o['id'] ?> <?= $esc($o['name']) ?><?= $o['is_test'] ? ' (test)' : '' ?></option><?php endforeach; ?>
              </select></label>
              <span class="ls-muted">photos, sample itinerary, founder word, prize text, souvenir prizes; never participants, testers, rules or scores</span></p>
          <?php endif; ?>
        <?php endif; ?>
        <?php if (!empty($s['headstart_frozen_at'])): ?>
          <p style="margin:6px 0 0"><label><input type="checkbox" name="refreeze" value="1"> Also re-take the head-start (frozen <?= $esc(substr((string) $s['headstart_frozen_at'], 0, 16)) ?>) with these settings</label></p>
        <?php endif; ?>
        <p class="ls-muted">Dates are challenge dates (the daily drop). Settings apply live: the standings are recomputed at once.</p>
        <div class="form-actions"><button class="btn btn-primary"><?= $s ? 'Save season' : 'Create season (draft)' ?></button></div>
      </form>
      <?php if ($s): $others = $pdo->query("SELECT id, name, is_test FROM contest_seasons WHERE id <> " . (int) $s['id'] . " ORDER BY id DESC")->fetchAll(PDO::FETCH_ASSOC); ?>
        <?php if ($others): ?>
          <form method="post" class="ls-inline" style="margin:8px 0;flex-wrap:wrap" onsubmit="return confirm('Replace this season\'s photos, sample itinerary, founder word, prize text and souvenir prizes with the chosen season\'s? Participants, testers, rules and scores stay.')">
            <?= csrf_input() ?><input type="hidden" name="do" value="copy_content">
            <label>Copy content from
              <select name="copy_from" style="background:var(--surface);border:1px solid var(--line);color:var(--text);padding:4px 6px;border-radius:4px">
                <?php foreach ($others as $o): ?><option value="<?= (int) $o['id'] ?>">#<?= (int) $o['id'] ?> <?= $esc($o['name']) ?><?= $o['is_test'] ? ' (test)' : '' ?></option><?php endforeach; ?>
              </select></label>
            <button class="btn btn-secondary btn-sm">Copy content</button>
            <span class="ls-muted">photos, sample itinerary, founder word, prize text, souvenir prizes</span>
          </form>
        <?php endif; ?>
      <?php endif; ?>
  <?php }; ?>

  <?php if ($season !== null): ?>
    <h2 style="font-size:15px;color:var(--text)">Edit “<?= $esc($season['name']) ?>” <?= $badge($season) ?></h2>
    <?php $form($season); ?>
    <h2 id="photos" style="font-size:15px;color:var(--text);margin-top:24px">Photos</h2>
    <p class="ls-muted">The prize screen's photos, in this order (the first one is also the cards' photo). Only photos we may use: a Pixabay pick (copied to our storage with its author and the Pixabay Content License) or your own upload. With no photo, the apps show the illustration.</p>
    <?php $photos = ContestPhotos::of($season); ?>
    <div style="display:flex;flex-wrap:wrap;gap:12px;margin:8px 0">
      <?php foreach ($photos as $i => $ph): ?>
        <div style="width:220px;border:1px solid var(--line);border-radius:8px;overflow:hidden;background:var(--surface-2)">
          <img src="<?= $esc($ph['url']) ?>" alt="" style="width:220px;height:130px;object-fit:cover;display:block">
          <div style="padding:8px;display:flex;flex-direction:column;gap:6px;font-size:12px">
            <span class="ls-muted">#<?= $i + 1 ?> · <?= $esc($ph['credit']) ?> · <?php if ($ph['sourceUrl']): ?><a href="<?= $esc($ph['sourceUrl']) ?>" target="_blank" rel="noopener"><?= $esc($ph['license']) ?></a><?php else: ?><?= $esc($ph['license']) ?><?php endif; ?></span>
            <form method="post" class="ls-inline"><?= csrf_input() ?><input type="hidden" name="do" value="photo_caption"><input type="hidden" name="i" value="<?= $i ?>">
              <input type="text" name="caption" value="<?= $esc($ph['caption']) ?>" placeholder="Caption (e.g. Ha Long Bay)" style="width:130px"><button class="btn btn-secondary btn-sm">Save</button></form>
            <div class="ls-inline">
              <?php if ($i > 0): ?><form method="post" class="ls-inline"><?= csrf_input() ?><input type="hidden" name="do" value="photo_up"><input type="hidden" name="i" value="<?= $i ?>"><button class="btn btn-secondary btn-sm">← Move up</button></form><?php endif; ?>
              <form method="post" class="ls-inline" onsubmit="return confirm('Remove this photo from the season?')"><?= csrf_input() ?><input type="hidden" name="do" value="photo_remove"><input type="hidden" name="i" value="<?= $i ?>"><button class="btn btn-danger btn-sm">Remove</button></form>
            </div>
          </div>
        </div>
      <?php endforeach; ?>
      <?php if ($photos === []): ?><p class="no-results">No photo yet: the apps show the illustration.</p><?php endif; ?>
    </div>
    <form method="post" enctype="multipart/form-data" class="ls-inline" style="margin:8px 0;flex-wrap:wrap">
      <?= csrf_input() ?><input type="hidden" name="do" value="photo_upload">
      <input type="file" name="photo" accept="image/jpeg,image/png,image/webp" required style="color:var(--muted)">
      <input type="text" name="caption" placeholder="Caption (optional)">
      <input type="text" name="credit" placeholder="Credit (your name)">
      <button class="btn btn-primary btn-sm">Upload my photo</button>
    </form>
    <?php $q = trim((string) ($_GET['q'] ?? '')); ?>
    <form method="get" action="/admin/launch-season#photos" class="ls-inline" style="margin:8px 0">
      <input type="hidden" name="tab" value="seasons"><input type="hidden" name="season" value="<?= $sid ?>">
      <input type="text" name="q" value="<?= $esc($q) ?>" placeholder="Search Pixabay: ha long bay, hoi an lanterns…" style="width:280px">
      <button class="btn btn-secondary btn-sm">Search Pixabay</button>
      <?php if (!ContestPhotos::configured()): ?><span class="ls-muted">PIXABAY_API_KEY is not set here (it is on Render).</span><?php endif; ?>
    </form>
    <?php if ($q !== ''): ?>
      <?php try { $hits = ContestPhotos::search($q); $hitErr = null; } catch (\Throwable $e) { $hits = []; $hitErr = $e->getMessage(); } ?>
      <?php if ($hitErr): ?><p class="flash flash-error"><?= $esc($hitErr) ?></p><?php endif; ?>
      <div style="display:flex;flex-wrap:wrap;gap:10px;margin:8px 0">
        <?php foreach ($hits as $h): ?>
          <form method="post" style="width:200px;border:1px solid var(--line);border-radius:8px;overflow:hidden;background:var(--surface-2)">
            <?= csrf_input() ?><input type="hidden" name="do" value="photo_pixabay"><input type="hidden" name="q" value="<?= $esc($q) ?>">
            <input type="hidden" name="large" value="<?= $esc($h['large']) ?>"><input type="hidden" name="fallback" value="<?= $esc($h['fallback'] ?? '') ?>"><input type="hidden" name="page" value="<?= $esc($h['page']) ?>"><input type="hidden" name="user" value="<?= $esc($h['user']) ?>">
            <img src="<?= $esc($h['preview']) ?>" referrerpolicy="no-referrer" alt="" style="width:200px;height:120px;object-fit:cover;display:block">
            <div style="padding:6px;display:flex;flex-direction:column;gap:4px;font-size:11px">
              <span class="ls-muted"><?= $esc($h['user']) ?> · <a href="<?= $esc($h['page']) ?>" target="_blank" rel="noopener">Pixabay</a></span>
              <input type="text" name="caption" placeholder="Caption" style="width:100%">
              <select name="target" style="width:100%;background:var(--surface);border:1px solid var(--line);color:var(--text);padding:3px;border-radius:4px">
                <option value="photos">Prize photos</option>
                <?php for ($d = 1; $d <= ContestTrip::DAYS; $d++): ?><option value="day<?= $d ?>">Itinerary · day <?= $d ?></option><?php endfor; ?>
              </select>
              <button class="btn btn-primary btn-sm">Use this photo</button>
            </div>
          </form>
        <?php endforeach; ?>
        <?php if ($hits === [] && !$hitErr): ?><p class="no-results">No photo found.</p><?php endif; ?>
      </div>
      <p class="ls-muted">Pixabay Content License: free for commercial use, no attribution required (we credit the author anyway). Avoid photos with recognisable people or brands for promotion.</p>
    <?php endif; ?>

    <?php
    $tl = in_array($_GET['tl'] ?? '', Contest::LOCALES, true) ? (string) $_GET['tl'] : 'en';
    $days = ContestTrip::days($season);
    $founder = ContestTrip::founder($season);
    $inp = 'width:100%;background:var(--surface);border:1px solid var(--line);color:var(--text);padding:5px 8px;border-radius:4px';
    ?>
    <h2 id="trip" style="font-size:15px;color:var(--text);margin-top:24px">Sample itinerary &amp; founder</h2>
    <p class="ls-muted">The prize screen's "Your week in Vietnam" (a sample, labelled so: the real trip is planned with the winner) and "A word from the founder" (shown only once a name and an English message are saved). Text per language (empty = English); a photo per day: a Pixabay pick (choose the day in the search results above) or your own upload.</p>
    <div class="toolbar" style="gap:4px;flex-wrap:wrap">
      <?php foreach (Contest::LOCALES as $l): ?><a class="btn btn-sm <?= $l === $tl ? 'btn-primary' : 'btn-secondary' ?>" href="<?= $esc($url('seasons', ['tl' => $l])) ?>#trip"><?= $esc($l) ?></a><?php endforeach; ?>
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:10px;margin:8px 0">
      <?php foreach ($days as $i => $d): ?>
        <div style="width:180px;border:1px solid var(--line);border-radius:8px;overflow:hidden;background:var(--surface-2);font-size:12px">
          <?php if ($d['photo']): ?><img src="<?= $esc($d['photo']['url']) ?>" alt="" style="width:180px;height:100px;object-fit:cover;display:block"><?php else: ?><div style="height:100px;display:grid;place-items:center;color:var(--faint)">No photo</div><?php endif; ?>
          <div style="padding:6px;display:flex;flex-direction:column;gap:4px">
            <strong>Day <?= $i + 1 ?></strong>
            <?php if ($d['photo']): ?><span class="ls-muted"><?= $esc($d['photo']['credit'] ?? '') ?> · <?= $esc($d['photo']['license'] ?? '') ?></span>
              <form method="post" class="ls-inline"><?= csrf_input() ?><input type="hidden" name="do" value="day_photo_remove"><input type="hidden" name="day" value="<?= $i + 1 ?>"><button class="btn btn-secondary btn-sm">Remove photo</button></form>
            <?php endif; ?>
            <form method="post" enctype="multipart/form-data" style="display:flex;flex-direction:column;gap:4px"><?= csrf_input() ?><input type="hidden" name="do" value="day_photo_upload"><input type="hidden" name="day" value="<?= $i + 1 ?>">
              <input type="file" name="photo" accept="image/jpeg,image/png,image/webp" required style="color:var(--muted);width:100%"><input type="text" name="credit" placeholder="Credit" style="width:100%"><button class="btn btn-secondary btn-sm">Upload</button></form>
          </div>
        </div>
      <?php endforeach; ?>
    </div>
    <form method="post" class="form-card" style="max-width:none">
      <?= csrf_input() ?><input type="hidden" name="do" value="trip_text"><input type="hidden" name="tl" value="<?= $esc($tl) ?>">
      <div class="table-wrapper"><table><thead><tr><th style="width:60px">Day</th><th>Title (60 max) · <?= $esc($tl) ?></th><th>Line (220 max)</th></tr></thead><tbody>
        <?php foreach ($days as $i => $d): ?>
          <tr><td><?= $i + 1 ?></td>
            <td><input type="text" name="day_title[<?= $i ?>]" value="<?= $esc($d['i18n'][$tl]['title'] ?? '') ?>" maxlength="60" style="<?= $inp ?>"<?= $tl === 'ar' ? ' dir="rtl"' : '' ?>></td>
            <td><input type="text" name="day_text[<?= $i ?>]" value="<?= $esc($d['i18n'][$tl]['text'] ?? '') ?>" maxlength="220" style="<?= $inp ?>"<?= $tl === 'ar' ? ' dir="rtl"' : '' ?>></td></tr>
        <?php endforeach; ?>
      </tbody></table></div>
      <div class="form-group" style="margin-top:12px"><label>Founder message · <?= $esc($tl) ?> (600 max; empty = English<?= ($founder['i18n']['en'] ?? '') === '' ? '; a draft is prefilled, rewrite it in your words' : '' ?>)</label>
        <textarea name="founder_message" rows="4" maxlength="600" style="<?= $inp ?>"<?= $tl === 'ar' ? ' dir="rtl"' : '' ?>><?= $esc($founder['i18n'][$tl] ?? ($tl === 'en' ? ContestTrip::FOUNDER_DRAFT_EN : '')) ?></textarea></div>
      <div class="form-actions"><button class="btn btn-primary">Save itinerary &amp; message (<?= $esc($tl) ?>)</button></div>
    </form>
    <div class="ls-inline" style="gap:16px;flex-wrap:wrap;margin:8px 0 0">
      <?php if ($founder['photo']): ?><img src="<?= $esc($founder['photo']['url']) ?>" alt="" style="width:64px;height:64px;border-radius:50%;object-fit:cover"><?php endif; ?>
      <form method="post" class="ls-inline"><?= csrf_input() ?><input type="hidden" name="do" value="founder_meta">
        <input type="text" name="founder_name" value="<?= $esc($founder['name']) ?>" placeholder="Founder name (shown)"><input type="text" name="founder_role" value="<?= $esc($founder['role']) ?>" placeholder="Role (empty = founder of Hilads, translated)"><button class="btn btn-secondary btn-sm">Save name</button></form>
      <form method="post" enctype="multipart/form-data" class="ls-inline"><?= csrf_input() ?><input type="hidden" name="do" value="founder_photo">
        <input type="file" name="photo" accept="image/jpeg,image/png,image/webp" required style="color:var(--muted)"><button class="btn btn-secondary btn-sm">Upload my photo</button></form>
      <span class="ls-muted"><?= $founder['name'] !== '' && ($founder['i18n']['en'] ?? '') !== '' ? '✓ Shown on the prize screen' : 'Hidden until a name and an English message are saved' ?></span>
    </div>

    <h2 style="font-size:15px;color:var(--text);margin-top:24px">Prize</h2>
    <p class="ls-muted">What the app and the web show as the hero (the Trip tab's header, the Today banner). Change it any time. English is required; an empty language shows the English text.</p>
    <form method="post" class="form-card" style="max-width:none">
      <?= csrf_input() ?><input type="hidden" name="do" value="save_prize">
      <div class="table-wrapper"><table><thead><tr><th style="width:70px">Lang</th><th>Title (60 max)</th><th>Line under it (140 max)</th><th>Prize screen description (400 max)</th></tr></thead><tbody>
        <?php foreach (Contest::LOCALES as $l): $p = $season['prize_i18n'][$l] ?? ['title' => '', 'subtitle' => '', 'description' => '']; ?>
          <tr><td><?= $esc($l) ?></td>
            <td><input type="text" name="prize_title[<?= $esc($l) ?>]" value="<?= $esc($p['title'] ?? '') ?>" maxlength="60" style="width:100%;background:var(--surface);border:1px solid var(--line);color:var(--text);padding:5px 8px;border-radius:4px"<?= $l === 'en' ? ' required' : '' ?><?= $l === 'ar' ? ' dir="rtl"' : '' ?>></td>
            <td><input type="text" name="prize_subtitle[<?= $esc($l) ?>]" value="<?= $esc($p['subtitle'] ?? '') ?>" maxlength="140" style="width:100%;background:var(--surface);border:1px solid var(--line);color:var(--text);padding:5px 8px;border-radius:4px"<?= $l === 'ar' ? ' dir="rtl"' : '' ?>></td>
            <td><textarea name="prize_description[<?= $esc($l) ?>]" maxlength="400" rows="2" style="width:100%;min-width:260px;background:var(--surface);border:1px solid var(--line);color:var(--text);padding:5px 8px;border-radius:4px"<?= $l === 'ar' ? ' dir="rtl"' : '' ?>><?= $esc($p['description'] ?? '') ?></textarea></td></tr>
        <?php endforeach; ?>
      </tbody></table></div>
      <div class="form-actions"><button class="btn btn-primary">Save prize</button></div>
    </form>
    <h2 id="fallback" style="font-size:15px;color:var(--text);margin-top:24px">If the players' goal isn't reached</h2>
    <?php $fbSet = $season['fallback_prize_i18n'] !== []; ?>
    <p class="ls-muted">What the winner of the final week wins instead of the trip when fewer than <?= (int) $season['prize_threshold_players'] ?> players reach <?= (int) $season['prize_threshold_photos'] ?> photos. Shown from day one on the goal card ("Not full by the end? The winner still wins …"), in the app's Rules section and on the rules page ({{fallback}}). Write it to follow "still wins", e.g. "a Vietnam souvenir pack". English is required; an empty language shows the English text.</p>
    <?php if (!$fbSet): ?><div class="callout warn" style="margin-bottom:10px">Not set yet: the apps show the placeholder "<?= $esc(Contest::DEFAULT_FALLBACK['en']) ?>". Set the real fallback prize before the season goes live.</div><?php endif; ?>
    <form method="post" class="form-card" style="max-width:none">
      <?= csrf_input() ?><input type="hidden" name="do" value="save_fallback">
      <div class="table-wrapper"><table><thead><tr><th style="width:70px">Lang</th><th>Fallback prize (120 max)</th></tr></thead><tbody>
        <?php foreach (Contest::LOCALES as $l): ?>
          <tr><td><?= $esc($l) ?></td><td><input type="text" name="fallback[<?= $esc($l) ?>]" value="<?= $esc($season['fallback_prize_i18n'][$l] ?? '') ?>" maxlength="120" placeholder="<?= $esc(Contest::DEFAULT_FALLBACK[$l] ?? '') ?>" style="width:100%;background:var(--surface);border:1px solid var(--line);color:var(--text);padding:5px 8px;border-radius:4px"<?= $l === 'ar' ? ' dir="rtl"' : '' ?>></td></tr>
        <?php endforeach; ?>
      </tbody></table></div>
      <div class="form-actions"><button class="btn btn-primary">Save fallback prize</button></div>
    </form>

    <h2 id="tab" style="font-size:15px;color:var(--text);margin-top:24px">The campaign's tab</h2>
    <?php $tabNow = Contest::tab($season, 'en'); ?>
    <p class="ls-muted">The temporary tab in the middle of the app's tab bar while this season is on (and 7 days after it ends, for the winner). Empty labels = "Trip" in each language. 12 characters max: it sits under the icon.</p>
    <form method="post" class="form-card" style="max-width:none">
      <?= csrf_input() ?><input type="hidden" name="do" value="save_tab">
      <label style="display:flex;gap:8px;align-items:center;margin-bottom:10px">Icon
        <select name="tab_icon" style="background:var(--surface);border:1px solid var(--line);color:var(--text);padding:4px 6px;border-radius:4px">
          <?php foreach (Contest::TAB_ICONS as $ic): ?><option value="<?= $esc($ic) ?>"<?= $tabNow['icon'] === $ic ? ' selected' : '' ?>><?= $esc($ic) ?></option><?php endforeach; ?>
        </select></label>
      <div class="table-wrapper"><table><thead><tr><th style="width:70px">Lang</th><th>Label (12 max)</th><th>"See the prize" button on the photo (28 max)</th></tr></thead><tbody>
        <?php foreach (Contest::LOCALES as $l): ?>
          <tr><td><?= $esc($l) ?></td><td><input type="text" name="tab_label[<?= $esc($l) ?>]" value="<?= $esc($season['tab']['label'][$l] ?? '') ?>" maxlength="12" placeholder="<?= $esc(Contest::DEFAULT_TAB['label'][$l] ?? '') ?>" style="width:100%;background:var(--surface);border:1px solid var(--line);color:var(--text);padding:5px 8px;border-radius:4px"<?= $l === 'ar' ? ' dir="rtl"' : '' ?>></td>
            <td><input type="text" name="prize_cta[<?= $esc($l) ?>]" value="<?= $esc($season['tab']['prize_cta'][$l] ?? '') ?>" maxlength="28" placeholder="<?= $esc(Contest::DEFAULT_PRIZE_CTA[$l] ?? '') ?>" style="width:100%;background:var(--surface);border:1px solid var(--line);color:var(--text);padding:5px 8px;border-radius:4px"<?= $l === 'ar' ? ' dir="rtl"' : '' ?>></td></tr>
        <?php endforeach; ?>
      </tbody></table></div>
      <div class="form-actions"><button class="btn btn-primary">Save tab</button></div>
    </form>

    <h2 id="souvenir" style="font-size:15px;color:var(--text);margin-top:24px">Souvenir prizes (ranks 2 to N)</h2>
    <?php $sv = json_decode((string) ($season['souvenir'] ?? '{}'), true); $sv = is_array($sv) ? $sv : []; ?>
    <p class="ls-muted">The winner of the final week wins the prize above; when this is on, ranks 2 to N each get a Vietnam souvenir pack, shipped to them (that is N − 1 parcels to send worldwide). Shown on the Prize screen and the ranking. Leave a line empty for the app's own wording ("Ranks 2 to N of the final week each win a Vietnam souvenir pack, shipped to them"), translated; a line you type replaces it in that language (empty = English). Not part of the score. Remember the rules page.</p>
    <form method="post" class="form-card" style="max-width:none">
      <?= csrf_input() ?><input type="hidden" name="do" value="save_souvenir">
      <div class="ls-inline" style="gap:16px;margin-bottom:8px">
        <label style="display:flex;gap:6px;align-items:center"><input type="checkbox" name="souvenir_enabled" value="1"<?= !empty($sv['enabled']) ? ' checked' : '' ?>> On for this season</label>
        <label style="display:flex;gap:6px;align-items:center">Ranks 2 to <input type="number" name="souvenir_to" min="2" max="50" value="<?= (int) ($sv['to'] ?? 10) ?>" style="width:70px;background:var(--surface);border:1px solid var(--line);color:var(--text);padding:4px 6px;border-radius:4px"></label>
      </div>
      <div class="table-wrapper"><table><thead><tr><th style="width:70px">Lang</th><th>Line (optional, 160 max)</th></tr></thead><tbody>
        <?php foreach (Contest::LOCALES as $l): ?>
          <tr><td><?= $esc($l) ?></td><td><input type="text" name="souvenir_text[<?= $esc($l) ?>]" value="<?= $esc($sv['i18n'][$l] ?? '') ?>" maxlength="160" style="width:100%;background:var(--surface);border:1px solid var(--line);color:var(--text);padding:5px 8px;border-radius:4px"<?= $l === 'ar' ? ' dir="rtl"' : '' ?>></td></tr>
        <?php endforeach; ?>
      </tbody></table></div>
      <div class="form-actions"><button class="btn btn-primary">Save souvenir prizes</button></div>
    </form>
    <div class="toolbar" style="gap:8px;margin:14px 0">
      <?php $act = static function (string $do, string $label, string $cls = 'btn-secondary', ?string $confirm = null) use ($esc): void { ?>
        <form method="post" class="ls-inline"<?= $confirm ? ' onsubmit="return confirm(\'' . $esc($confirm) . '\')"' : '' ?>><?= csrf_input() ?><input type="hidden" name="do" value="<?= $do ?>"><button class="btn <?= $cls ?> btn-sm"><?= $esc($label) ?></button></form>
      <?php }; ?>
      <?php if ($season['status'] === 'draft') $act('start', 'Publish', 'btn-primary', 'Publish this season? It becomes visible ' . ($season['is_test'] ? 'to its testers' : 'to everyone') . ': a teaser with Notify me until its start date, then the contest.'); ?>
      <?php if ($season['status'] === 'running' && !$season['paused']) $act('pause', 'Pause', 'btn-secondary', 'Pause? The contest is hidden and joining closes; photos and likes keep counting by date.'); ?>
      <?php if ($season['status'] === 'running' && $season['paused']) $act('resume', 'Resume'); ?>
      <?php if ($season['status'] === 'running') $act('end', 'End the season', 'btn-danger', 'End the season? It disappears from the app. Rankings stay readable here.'); ?>
      <?php if ($season['status'] === 'ended') $act('reopen', 'Reopen', 'btn-secondary', 'Reopen this season?'); ?>
      <?php if ($season['status'] !== 'draft') $act('freeze', 'Take the head-start now', 'btn-secondary', 'Replace the head-start with the current season top ' . $season['headstart_top_n'] . '?'); ?>
      <span class="ls-muted">Head-start: <?= $season['headstart_frozen_at'] ? 'frozen ' . $esc(substr((string) $season['headstart_frozen_at'], 0, 16)) : 'taken automatically at the first drop of the final week' ?></span>
      <span class="ls-muted">· Notify me: <b style="color:var(--text)"><?= class_exists('ContestNotify') ? ContestNotify::count((int) $season['id']) : 0 ?></b> tap(s)<?= $season['is_test'] ? ' (testers only)' : '' ?> · live push: <?= !empty($season['live_notified_at']) ? 'sent ' . $esc(substr((string) $season['live_notified_at'], 0, 16)) : 'sent by the cron once ' . $esc($season['start_date']) . ' arrives' ?></span>
      <span class="ls-muted">· State from the dates: <b style="color:var(--text)"><?= $esc(['upcoming' => 'Upcoming (teaser, Notify me)', 'season' => 'Running', 'final' => 'Running · final week', 'over' => 'Ended', 'ended' => 'Ended', 'draft' => 'Draft (not published)'][Contest::phase($season)] ?? Contest::phase($season)) ?></b></span>
    </div>

    <?php if ($season['is_test']): ?>
      <h2 style="font-size:15px;color:var(--text);margin-top:24px">Testers</h2>
      <?php
      $stmt = $pdo->prepare("SELECT u.id, u.username, u.display_name FROM contest_testers t JOIN users u ON u.id = t.user_id WHERE t.season_id = ? ORDER BY u.username");
      $stmt->execute([$season['id']]);
      ?>
      <p class="ls-muted">Only these accounts see this test season and can join it. A tester can never join a real season.</p>
      <div class="table-wrapper"><table><tbody>
        <?php foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $t): ?>
          <tr><td>@<?= $esc($t['username']) ?></td><td><?= $esc($t['display_name']) ?></td>
            <td class="td-actions"><form method="post" class="ls-inline"><?= csrf_input() ?><input type="hidden" name="do" value="tester_remove"><input type="hidden" name="user_id" value="<?= $esc($t['id']) ?>"><button class="btn btn-secondary btn-sm">Remove</button></form></td></tr>
        <?php endforeach; ?>
      </tbody></table></div>
      <form method="post" class="ls-inline" style="margin-top:8px;align-items:flex-start"><?= csrf_input() ?><input type="hidden" name="do" value="tester_add">
        <span style="display:inline-flex;flex-direction:column;gap:4px">
          <input type="text" name="username" id="ls-tester" placeholder="@username or name" list="ls-tester-list" autocomplete="off" required>
          <datalist id="ls-tester-list"></datalist>
          <span id="ls-tester-pick" class="ls-muted"></span>
        </span>
        <button class="btn btn-primary btn-sm" id="ls-tester-add" disabled>Add tester</button></form>
      <script>
      (function () {
        var input = document.getElementById('ls-tester'), list = document.getElementById('ls-tester-list'),
            pick = document.getElementById('ls-tester-pick'), add = document.getElementById('ls-tester-add'), rows = [], timer;
        function line(r) {
          return (r.display_name || '') + (r.home_country ? ' · ' + r.home_country : '') + ' · ' + r.photos + ' photos · since ' + r.since;
        }
        function check() {
          var v = input.value.trim().replace(/^@/, '').toLowerCase();
          var hit = rows.filter(function (r) { return r.username.toLowerCase() === v; })[0];
          pick.textContent = hit ? '✓ @' + hit.username + ' — ' + line(hit) : (v.length >= 2 ? 'Pick an account from the list' : '');
          pick.style.color = hit ? '#4ade80' : '';
          add.disabled = !hit;
        }
        input.addEventListener('input', function () {
          clearTimeout(timer);
          check();
          var q = input.value.trim().replace(/^@/, '');
          if (q.length < 2) return;
          timer = setTimeout(function () {
            fetch('/admin/launch-season?suggest=1&q=' + encodeURIComponent(q), { credentials: 'same-origin' })
              .then(function (r) { return r.json(); })
              .then(function (data) {
                rows = data;
                list.innerHTML = '';
                data.forEach(function (r) {
                  var o = document.createElement('option');
                  o.value = r.username;
                  o.label = line(r);
                  list.appendChild(o);
                });
                check();
              }).catch(function () {});
          }, 200);
        });
      })();
      </script>
    <?php endif; ?>
    <h2 style="font-size:15px;color:var(--text);margin-top:32px">New season</h2>
  <?php endif; ?>
  <?php $form(null); ?>

<?php elseif ($season === null): ?>
  <p class="no-results">No season yet. <a href="/admin/launch-season?tab=seasons">Create one</a>.</p>

<?php elseif ($tab === 'dashboard'): ?>
  <?php
  $st = Contest::standings($season);
  $season = Contest::season($season['id']) ?? $season;
  [$monday, $sunday] = Scoring::week(DailyClock::currentDate());
  $stmt = $pdo->prepare("
      SELECT count(DISTINCT cp.user_id) FROM contest_participants cp
      JOIN daily_proofs dp ON dp.user_id = cp.user_id AND dp.created_at >= cp.joined_at
      JOIN daily_challenges dc ON dc.id = dp.challenge_id
      WHERE cp.season_id = ? AND NOT cp.disqualified AND dp.moderation_status = 'approved'
        AND NOT dp.is_demo AND NOT dp.is_seed AND NOT dp.is_suggestion AND dc.challenge_date BETWEEN ? AND ?
  ");
  $stmt->execute([$season['id'], max($monday, $season['start_date']), min($sunday, $season['end_date'])]);
  $active = (int) $stmt->fetchColumn();
  $c = $st['counter'];
  $pct = min(100, $c['players'] / max(1, $c['threshold']) * 100);
  $table = static function (array $order, string $phase) use ($st, $who, $esc, $url): void { ?>
    <div class="table-wrapper"><table>
      <thead><tr><th>#</th><th>Player</th><th>Points</th><th>Play</th><th>Podium</th><th>Perfect week</th><th>Friends</th><?= $phase === 'final' ? '<th>Head-start</th>' : '' ?><th>Likes (tie-break)</th><th>Days</th><th>Photos</th></tr></thead>
      <tbody>
      <?php foreach (array_slice($order, 0, 100) as $i => $id): $r = $st['rows'][$id]; ?>
        <tr><td><?= $i + 1 ?></td><td><a href="<?= $esc($url('participants', ['user' => $id])) ?>"><?= $who($r) ?></a></td>
          <td><strong><?= $phase === 'final' ? $r['finalPoints'] : $r['seasonPoints'] ?></strong></td>
          <?php $by = $phase === 'final' ? $r['finalBy'] : $r['seasonBy']; ?>
          <td><?= $by['play'] ?></td><td><?= $by['podium'] ?></td><td><?= $by['week'] ?></td><td><?= $by['friends'] ?></td>
          <?= $phase === 'final' ? '<td>' . $r['headstart'] . '</td>' : '' ?>
          <td><?= $phase === 'final' ? $r['finalLikes'] : $r['seasonLikes'] ?></td>
          <td><?= $r['days'] ?></td><td><?= $r['photos'] ?></td></tr>
      <?php endforeach; ?>
      <?php if ($order === []): ?><tr><td colspan="9" class="no-results">Nobody yet.</td></tr><?php endif; ?>
      </tbody></table></div>
  <?php }; ?>
  <div class="stats-row">
    <div class="stat-card"><div class="stat-value"><?= $c['players'] ?> / <?= $c['threshold'] ?></div><div class="stat-label">Players with <?= $c['photos'] ?>+ photos</div></div>
    <div class="stat-card"><div class="stat-value"><?= $st['totals']['participants'] ?></div><div class="stat-label">Joined</div></div>
    <div class="stat-card"><div class="stat-value"><?= $active ?></div><div class="stat-label">Active this week</div></div>
    <div class="stat-card"><div class="stat-value"><?= $st['totals']['photos'] ?></div><div class="stat-label">Contest photos</div></div>
  </div>
  <div class="ls-bar" title="<?= round($pct) ?>%"><i style="width:<?= $pct ?>%"></i></div>
  <p class="ls-muted">Prize threshold: <?= round($pct) ?>%. Standings are live (cached <?= Contest::CACHE_TTL ?> s).</p>
  <div class="ls-cols" style="margin-top:18px">
    <div><h2 style="font-size:15px;color:var(--text)">Season ranking (before <?= $esc($season['final_week_start']) ?>)</h2><?php $table($st['season'], 'season'); ?></div>
    <div><h2 style="font-size:15px;color:var(--text)">Final-week ranking <?= $season['headstart_frozen_at'] ? '' : '<span class="ls-muted">(head-start not taken yet)</span>' ?></h2><?php $table($st['final'], 'final'); ?></div>
  </div>

<?php elseif ($tab === 'participants'): ?>
  <?php
  $q    = trim((string) ($_GET['q'] ?? ''));
  $user = (string) ($_GET['user'] ?? '');
  $stmt = $pdo->prepare("
      SELECT cp.user_id, u.username, u.display_name, u.email, cp.country, cp.joined_at, cp.disqualified
      FROM contest_participants cp JOIN users u ON u.id = cp.user_id
      WHERE cp.season_id = ? AND (? = '' OR u.username ILIKE ? OR u.email ILIKE ? OR u.display_name ILIKE ?)
      ORDER BY cp.joined_at DESC LIMIT 100
  ");
  $like = '%' . ltrim($q, '@') . '%';
  $stmt->execute([$season['id'], $q, $like, $like, $like]);
  $list = $stmt->fetchAll(PDO::FETCH_ASSOC);
  ?>
  <form method="get" class="toolbar"><input type="hidden" name="tab" value="participants"><input type="hidden" name="season" value="<?= $sid ?>">
    <input type="search" name="q" value="<?= $esc($q) ?>" placeholder="@username, name or email"><button class="btn btn-secondary btn-sm">Search</button></form>
  <div class="ls-cols">
    <div class="table-wrapper"><table><thead><tr><th>Player</th><th>Country</th><th>Joined</th><th></th></tr></thead><tbody>
      <?php foreach ($list as $p): ?>
        <tr<?= $p['user_id'] === $user ? ' style="background:var(--surface-2)"' : '' ?>><td><a href="<?= $esc($url('participants', ['user' => $p['user_id'], 'q' => $q])) ?>">@<?= $esc($p['username']) ?></a>
          <?= DailyProofRepository::bool($p['disqualified']) ? '<span class="badge badge-deleted">DQ</span>' : '' ?></td>
          <td><?= $esc($p['country']) ?></td><td class="ls-muted"><?= $esc(substr((string) $p['joined_at'], 0, 16)) ?></td><td></td></tr>
      <?php endforeach; ?>
      <?php if ($list === []): ?><tr><td colspan="4" class="no-results">No participant.</td></tr><?php endif; ?>
    </tbody></table></div>
    <div>
    <?php if ($user !== '' && ($part = Contest::participant($season['id'], $user))): ?>
      <?php
      $st = Contest::standings($season);
      $r  = $st['rows'][$user] ?? null;
      $detail = Contest::participantDetail($season, $user);
      $stmt = $pdo->prepare("SELECT username FROM users WHERE id = ?");
      $stmt->execute([$user]);
      $uname = (string) $stmt->fetchColumn();
      $inv = $pdo->prepare("SELECT * FROM contest_invalidations WHERE season_id = ? AND undone_at IS NULL AND (target_id = ANY (?::text[]))");
      $ids = array_column($detail['photos'], 'id');
      foreach ($detail['votes'] as $vs) foreach ($vs as $v) $ids[] = (string) $v['id'];
      $inv->execute([$season['id'], '{' . implode(',', array_map(static fn($x) => '"' . $x . '"', $ids)) . '}']);
      $invalidations = $inv->fetchAll(PDO::FETCH_ASSOC);
      ?>
      <h2 style="font-size:16px;color:var(--text);margin-top:0">@<?= $esc($uname) ?>
        <?= DailyProofRepository::bool($part['disqualified']) ? '<span class="badge badge-deleted">Disqualified: ' . $esc($part['dq_reason']) . '</span>' : '' ?></h2>
      <p class="ls-muted">Joined <?= $esc(substr((string) $part['joined_at'], 0, 16)) ?> · <?= $esc($part['country']) ?> · 18+ <?= DailyProofRepository::bool($part['age_confirmed']) ? 'yes' : 'no' ?> · rules v<?= (int) $part['rules_version'] ?></p>
      <?php if ($r !== null): ?>
        <div class="stats-row">
          <?php $sb = $r['seasonBy']; $fb = $r['finalBy']; ?>
          <div class="stat-card"><div class="stat-value"><?= $r['seasonPoints'] ?></div><div class="stat-label">Before the final week (#<?= $r['seasonRank'] ?? '–' ?>): play <?= $sb['play'] ?> · podium <?= $sb['podium'] ?> · week <?= $sb['week'] ?> · friends <?= $sb['friends'] ?></div></div>
          <div class="stat-card"><div class="stat-value"><?= $r['finalPoints'] ?></div><div class="stat-label">Final week (#<?= $r['finalRank'] ?? '–' ?>): play <?= $fb['play'] ?> · podium <?= $fb['podium'] ?> · week <?= $fb['week'] ?> · friends <?= $fb['friends'] ?> + <?= $r['headstart'] ?> head-start</div></div>
          <div class="stat-card"><div class="stat-value"><?= $r['days'] ?></div><div class="stat-label">Days · <?= $r['allLikes'] ?> likes (tie-break) · points counted from <?= $esc($r['joinDate']) ?></div></div>
        </div>
        <p class="ls-muted">Points are the player's regular Hilads points on the season's challenges (Scoring). Invalidating a photo here removes its points and likes from the campaign only.</p>
      <?php else: ?>
        <p class="ls-muted">Not in the standings (an excluded account: review, demo, fake, hidden, deleted or a tester in a real season).</p>
      <?php endif; ?>

      <?php if (DailyProofRepository::bool($part['disqualified'])): ?>
        <form method="post" class="ls-inline" onsubmit="return confirm('Put this player back in the contest?')"><?= csrf_input() ?><input type="hidden" name="do" value="undo_disqualify"><input type="hidden" name="user" value="<?= $esc($user) ?>"><button class="btn btn-secondary btn-sm">Undo disqualification</button></form>
      <?php else: ?>
        <form method="post" class="ls-inline" onsubmit="return confirm('Disqualify this player from the contest? (The game is not affected.)')"><?= csrf_input() ?><input type="hidden" name="do" value="disqualify"><input type="hidden" name="user" value="<?= $esc($user) ?>"><input type="text" name="reason" placeholder="Reason" required><button class="btn btn-danger btn-sm">Disqualify</button></form>
      <?php endif; ?>

      <h3 style="font-size:14px;color:var(--text);margin-top:18px">Photos in the season</h3>
      <?php foreach ($detail['photos'] as $ph):
        $out = $ph['invalidation_id'] !== null; $counts = $ph['moderation_status'] === 'approved' && DailyProofRepository::bool($ph['after_join']) && !$out;
        $votes = $detail['votes'][$ph['id']] ?? []; ?>
        <div style="display:flex;gap:12px;margin:10px 0;padding:10px;border:1px solid var(--line);border-radius:8px">
          <img class="ls-photo" src="<?= $esc(R2Uploader::thumbProxy($ph['photo_url'])) ?>" alt="">
          <div style="flex:1">
            <div><strong><?= $esc($ph['date']) ?></strong> · <?= $esc($ph['moderation_status']) ?>
              <?= !DailyProofRepository::bool($ph['after_join']) ? '<span class="badge">before joining</span>' : '' ?>
              <?= $out ? '<span class="badge badge-deleted">invalidated</span>' : '' ?>
              <?= $counts ? '<span class="badge badge-active">counts</span>' : '' ?>
              · <?= count($votes) ?> likes</div>
            <?php if (!$out): ?>
              <form method="post" class="ls-inline" style="margin-top:4px" onsubmit="return confirm('Invalidate this photo for the contest?')"><?= csrf_input() ?><input type="hidden" name="do" value="invalidate_photo"><input type="hidden" name="user" value="<?= $esc($user) ?>"><input type="hidden" name="target" value="<?= $esc($ph['id']) ?>"><input type="text" name="reason" placeholder="Reason" required><button class="btn btn-danger btn-sm">Invalidate photo</button></form>
            <?php endif; ?>
            <details style="margin-top:6px"><summary class="ls-muted">Likes</summary>
              <?php foreach ($votes as $v): $vOut = $v['invalidation_id'] !== null; $vEx = DailyProofRepository::bool($v['excluded']); ?>
                <div style="display:flex;gap:8px;align-items:center;margin:3px 0">
                  <span class="<?= $vOut || $vEx ? 'ls-x' : '' ?>">@<?= $esc($v['username']) ?></span><span class="ls-muted"><?= $esc(substr((string) $v['created_at'], 0, 16)) ?><?= $vEx ? ' · excluded account' : '' ?></span>
                  <?php if (!$vOut && !$vEx): ?>
                    <form method="post" class="ls-inline" onsubmit="return confirm('Invalidate this like for the contest?')"><?= csrf_input() ?><input type="hidden" name="do" value="invalidate_vote"><input type="hidden" name="user" value="<?= $esc($user) ?>"><input type="hidden" name="target" value="<?= (int) $v['id'] ?>"><input type="text" name="reason" placeholder="Reason" required style="width:120px"><button class="btn btn-secondary btn-sm">Invalidate</button></form>
                  <?php endif; ?>
                </div>
              <?php endforeach; ?>
            </details>
          </div>
        </div>
      <?php endforeach; ?>
      <?php if ($detail['photos'] === []): ?><p class="no-results">No photo in the season yet.</p><?php endif; ?>

      <?php if ($invalidations !== []): ?>
        <h3 style="font-size:14px;color:var(--text)">Invalidations</h3>
        <div class="table-wrapper"><table><tbody>
          <?php foreach ($invalidations as $iv): ?>
            <tr><td><?= $esc($iv['kind']) ?> <span class="td-mono"><?= $esc($iv['target_id']) ?></span></td><td><?= $esc($iv['reason']) ?></td><td class="ls-muted"><?= $esc(substr((string) $iv['created_at'], 0, 16)) ?></td>
              <td><form method="post" class="ls-inline" onsubmit="return confirm('Make it count again?')"><?= csrf_input() ?><input type="hidden" name="do" value="undo_invalidation"><input type="hidden" name="user" value="<?= $esc($user) ?>"><input type="hidden" name="id" value="<?= (int) $iv['id'] ?>"><button class="btn btn-secondary btn-sm">Undo</button></form></td></tr>
          <?php endforeach; ?>
        </tbody></table></div>
      <?php endif; ?>
    <?php else: ?>
      <p class="ls-muted">Pick a participant.</p>
    <?php endif; ?>
    </div>
  </div>

<?php elseif ($tab === 'signals'): ?>
  <?php $sg = Contest::signals($season); $link = static fn(string $id, ?string $name) => '<a href="' . $esc($url('participants', ['user' => $id])) . '">@' . $esc($name) . '</a>'; ?>
  <p class="ls-muted">Computed now, nothing is blocked automatically: check, then invalidate or disqualify from the participant's page.</p>
  <h2 style="font-size:15px;color:var(--text)">Vote-only accounts (no photo of their own, 3+ likes to one participant)</h2>
  <div class="table-wrapper"><table><thead><tr><th>Voter</th><th>Account since</th><th>Liked</th><th>Likes</th></tr></thead><tbody>
    <?php foreach ($sg['voteOnly'] as $r): ?><tr><td>@<?= $esc($r['voter_name']) ?></td><td class="ls-muted"><?= $esc(substr((string) $r['voter_created'], 0, 10)) ?></td><td><?= $link($r['target'], $r['target_name']) ?></td><td><?= (int) $r['n'] ?></td></tr><?php endforeach; ?>
    <?php if ($sg['voteOnly'] === []): ?><tr><td colspan="4" class="no-results">None.</td></tr><?php endif; ?>
  </tbody></table></div>
  <h2 style="font-size:15px;color:var(--text)">Vote spikes (10+ likes on one photo within an hour)</h2>
  <div class="table-wrapper"><table><thead><tr><th>Player</th><th>Photo</th><th>Hour (UTC)</th><th>Likes</th></tr></thead><tbody>
    <?php foreach ($sg['spikes'] as $r): ?><tr><td><?= $link($r['target'], $r['target_name']) ?></td><td class="td-mono"><?= $esc($r['photo']) ?></td><td><?= $esc(substr((string) $r['hour'], 0, 16)) ?></td><td><?= (int) $r['n'] ?></td></tr><?php endforeach; ?>
    <?php if ($sg['spikes'] === []): ?><tr><td colspan="4" class="no-results">None.</td></tr><?php endif; ?>
  </tbody></table></div>
  <h2 style="font-size:15px;color:var(--text)">Referral rings (invited friend on the inviter's device or network, or liking the inviter 3+ times)</h2>
  <div class="table-wrapper"><table><thead><tr><th>Inviter</th><th>Friend</th><th>Same device</th><th>Same network</th><th>Friend's likes to inviter</th></tr></thead><tbody>
    <?php foreach ($sg['rings'] as $r): ?><tr><td><?= $link($r['referrer'], $r['referrer_name']) ?></td><td><?= $link($r['friend'], $r['friend_name']) ?></td>
      <td><?= DailyProofRepository::bool($r['same_device']) ? '⚠️ yes' : 'no' ?></td><td><?= DailyProofRepository::bool($r['same_network']) ? 'yes' : 'no' ?></td><td><?= (int) $r['likes_to_referrer'] ?></td></tr><?php endforeach; ?>
    <?php if ($sg['rings'] === []): ?><tr><td colspan="5" class="no-results">None.</td></tr><?php endif; ?>
  </tbody></table></div>
  <h2 style="font-size:15px;color:var(--text)">Participants sharing a device (one participant per person)</h2>
  <div class="table-wrapper"><table><thead><tr><th>Install id</th><th>Participants</th></tr></thead><tbody>
    <?php foreach ($sg['sharedDevices'] as $r): ?><tr><td class="td-mono"><?= $esc(substr((string) $r['install_id'], 0, 12)) ?>…</td><td><?= $esc($r['players']) ?></td></tr><?php endforeach; ?>
    <?php if ($sg['sharedDevices'] === []): ?><tr><td colspan="2" class="no-results">None.</td></tr><?php endif; ?>
  </tbody></table></div>

<?php elseif ($tab === 'winner'): ?>
  <?php
  $st = Contest::standings($season);
  $season = Contest::season($season['id']) ?? $season;
  $phase = Contest::phase($season);
  $leader = $st['final'][0] ?? null;
  $winnerName = null;
  if ($season['winner_user_id']) { $s2 = $pdo->prepare("SELECT username FROM users WHERE id = ?"); $s2->execute([$season['winner_user_id']]); $winnerName = $s2->fetchColumn(); }
  $flag = static function (string $field, string $label) use ($season, $esc): void {
      $at = $season[$field]; ?>
      <form method="post" class="ls-inline" onsubmit="return confirm('<?= $at ? 'Clear' : 'Mark' ?>: <?= $esc($label) ?>?')"><?= csrf_input() ?><input type="hidden" name="do" value="winner"><input type="hidden" name="field" value="<?= $field ?>"><input type="hidden" name="on" value="<?= $at ? '' : '1' ?>">
        <button class="btn <?= $at ? 'btn-primary' : 'btn-secondary' ?> btn-sm"><?= $at ? '✓ ' : '' ?><?= $esc($label) ?><?= $at ? ' · ' . $esc(substr((string) $at, 0, 10)) : '' ?></button></form>
  <?php }; ?>
  <div class="form-card" style="max-width:none">
    <p><?= in_array($phase, ['over', 'ended'], true) ? 'Final ranking (the season is over):' : 'Current leader (not final yet, phase: ' . $esc($phase) . '):' ?>
      <strong><?= $leader ? $who($st['rows'][$leader]) . ' · ' . $st['rows'][$leader]['finalPoints'] . ' pts' : '—' ?></strong></p>
    <p>Winner: <strong><?= $winnerName ? '@' . $esc($winnerName) : 'not set' ?></strong>
      <?php if ($leader): ?>
        <form method="post" class="ls-inline" onsubmit="return confirm('Set the winner to the first of the final ranking?')"><?= csrf_input() ?><input type="hidden" name="do" value="winner"><input type="hidden" name="field" value="winner_user_id"><input type="hidden" name="user" value="<?= $esc($leader) ?>"><button class="btn btn-secondary btn-sm">Set the leader as the winner</button></form>
      <?php endif; ?>
    </p>
    <div class="toolbar" style="gap:8px"><?php $flag('winner_contacted_at', 'Winner contacted'); $flag('winner_confirmed_at', 'Winner confirmed'); $flag('prize_sent_at', 'Prize sent'); ?></div>
  </div>
  <h2 style="font-size:15px;color:var(--text)">Exports</h2>
  <p><a class="btn btn-secondary btn-sm" href="/admin/launch-season/export?season=<?= $sid ?>&amp;what=ranking">⬇ Ranking CSV</a>
     <span class="ls-muted">Ranks, points breakdown, days, photos (no personal data).</span></p>
  <form method="post" action="/admin/launch-season/export?season=<?= $sid ?>&amp;what=participants" class="ls-inline" style="margin-top:8px">
    <?= csrf_input() ?><input type="password" name="password" placeholder="Admin password" required autocomplete="current-password" style="background:var(--surface);border:1px solid var(--line);color:var(--text);padding:4px 6px;border-radius:4px">
    <button class="btn btn-danger btn-sm">⬇ Participants CSV (personal data)</button>
  </form>
  <p class="ls-muted">Emails, country, 18+, join date, rules version, inviter. GDPR data: asks the admin password again and every download is logged.</p>

<?php elseif ($tab === 'rules'): ?>
  <?php
  $stmt = $pdo->prepare("SELECT * FROM contest_rules WHERE season_id = ? ORDER BY locale = 'en' DESC, locale");
  $stmt->execute([$season['id']]);
  $rules = $stmt->fetchAll(PDO::FETCH_ASSOC);
  $locale = (string) ($_GET['locale'] ?? ($rules[0]['locale'] ?? 'en'));
  $cur = null; foreach ($rules as $r) if ($r['locale'] === $locale) $cur = $r;
  $public = 'https://hilads.live' . ($locale !== 'en' ? '/' . $locale : '') . '/launch-season/rules' . ($season['is_test'] ? '?season=' . $season['id'] : '');
  ?>
  <p class="ls-muted">Markdown (# title, ## heading, - list, **bold**, [link](https://…)). The English text is the reference: joiners accept its version. Other locales fall back to English until added.
    Public page: <a href="<?= $esc($public) ?>" target="_blank"><?= $esc($public) ?></a></p>
  <p class="ls-muted">Placeholders, filled from this season's dates and settings on the public page (keep them as they are in every translation):
    <?php foreach (Contest::RULES_TOKENS as $tk): ?><code style="color:var(--text)">{{<?= $esc($tk) ?>}}</code> <?php endforeach; ?>
    · <code>[TBD: …]</code> marks what is still to decide. The page shows the red DRAFT banner until Final is ticked.</p>
  <div class="toolbar" style="gap:6px">
    <?php foreach ($rules as $r): ?><a class="btn btn-sm <?= $r['locale'] === $locale ? 'btn-primary' : 'btn-secondary' ?>" href="<?= $esc($url('rules', ['locale' => $r['locale']])) ?>"><?= $esc($r['locale']) ?> v<?= (int) $r['version'] ?><?= DailyProofRepository::bool($r['is_final']) ? ' ✓' : ' · draft' ?></a><?php endforeach; ?>
    <form method="get" class="ls-inline"><input type="hidden" name="tab" value="rules"><input type="hidden" name="season" value="<?= $sid ?>"><input type="text" name="locale" placeholder="Add a locale: fr, vi…" style="width:150px"><button class="btn btn-secondary btn-sm">Add</button></form>
  </div>
  <form method="post" class="form-card" style="max-width:none">
    <?= csrf_input() ?><input type="hidden" name="do" value="rules"><input type="hidden" name="locale" value="<?= $esc($locale) ?>">
    <div class="form-group"><label>Rules · <?= $esc($locale) ?><?= $cur ? ' · v' . (int) $cur['version'] . ' · ' . $esc(substr((string) $cur['updated_at'], 0, 16)) : ' · new' ?></label>
      <textarea name="body" rows="26" style="font-family:ui-monospace,monospace;font-size:13px"><?= $esc(!empty($_GET['template']) ? Contest::placeholderRules($season) : ($cur['body'] ?? ($locale === 'en' ? Contest::placeholderRules($season) : ($rules[0]['body'] ?? '')))) ?></textarea></div>
    <?php if (!empty($_GET['template'])): ?><p class="flash flash-success" style="margin:6px 0">The full rules template is loaded in the box: nothing is saved until you press Save rules.</p><?php endif; ?>
    <p><label><input type="checkbox" name="is_final" value="1"<?= $cur && DailyProofRepository::bool($cur['is_final']) ? ' checked' : '' ?>> Final (removes the “DRAFT - not final” banner on the public page)</label></p>
    <div class="form-actions"><button class="btn btn-primary">Save rules</button>
      <a class="btn btn-secondary" href="<?= $esc($url('rules', ['locale' => $locale, 'template' => 1])) ?>">Load the full template (English)</a></div>
  </form>

<?php elseif ($tab === 'log'): ?>
  <?php
  $stmt = $pdo->prepare("SELECT * FROM contest_admin_log WHERE season_id = ? ORDER BY id DESC LIMIT 300");
  $stmt->execute([$season['id']]);
  ?>
  <div class="table-wrapper"><table><thead><tr><th>When</th><th>Action</th><th>Target</th><th>Detail</th></tr></thead><tbody>
    <?php foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $l): ?>
      <tr><td class="ls-muted"><?= $esc(date('Y-m-d H:i', strtotime((string) $l['created_at']))) ?></td><td><?= $esc($l['action']) ?></td><td class="td-mono"><?= $esc($l['target']) ?></td><td class="td-mono td-clip"><?= $esc($l['detail']) ?></td></tr>
    <?php endforeach; ?>
  </tbody></table></div>
<?php endif; ?>
</main>
<?php admin_foot(); ?>
