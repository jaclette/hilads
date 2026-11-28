<?php

declare(strict_types=1);

/**
 * A user's page: the "Sign-up" block (when, how, where from, platform, language, sources) and the
 * "Activity" timeline (arrivals with city and platform, photos, comments, messages, reports), the
 * account's guest history included (GuestLinks). Expects $user (a users row) and $pdo.
 */
require_once __DIR__ . '/_people.php';

$uid      = (string) $user['id'];
$guestIds = GuestLinks::guestIdsOf($uid);
if (!empty($user['guest_id']) && !in_array($user['guest_id'], $guestIds, true)) $guestIds[] = $user['guest_id'];
$gIn  = $guestIds === [] ? "''" : implode(',', array_fill(0, count($guestIds), '?'));
$mine = "(m.user_id = ? OR (m.user_id IS NULL AND m.guest_id IN ($gIn)))";   // this person's rows, as a guest too
$mineArgs = array_merge([$uid], $guestIds);

$st = $pdo->prepare("SELECT s.*, iu.username AS inviter_username, iu.display_name AS inviter_name
                     FROM user_signups s LEFT JOIN users iu ON iu.id = s.inviter_user_id WHERE s.user_id = ?");
try { $st->execute([$uid]); $su = $st->fetch(PDO::FETCH_ASSOC) ?: null; } catch (\Throwable) { $su = null; }

// The guest names this person had before signing up ("was guest ElectricWolf").
$guestNames = [];
if ($guestIds !== []) {
    $st = $pdo->prepare("SELECT DISTINCT ON (m.guest_id) m.guest_id, m.nickname FROM messages m
                         WHERE m.guest_id IN ($gIn) AND m.user_id IS NULL AND m.type = 'system' AND m.event = 'join' ORDER BY m.guest_id, m.created_at");
    $st->execute($guestIds);
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) if ($r['nickname']) $guestNames[] = $r['nickname'];
}

// Activity: the latest 60 events, newest first.
$events = [];
$st = $pdo->prepare("SELECT m.id, m.created_at, m.channel_id, ch.name AS city, m.platform, m.country, m.geo_city, m.ip_hash, m.user_id IS NULL AS as_guest,
                            m.ip_address IS NOT NULL AS has_ip, m.payload->>'how' AS how
                     FROM messages m LEFT JOIN channels ch ON ch.id = m.channel_id
                     WHERE m.type = 'system' AND m.event = 'join' AND $mine ORDER BY m.created_at DESC LIMIT 40");
$st->execute($mineArgs);
foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) $events[] = ['at' => strtotime((string) $r['created_at']), 'kind' => 'arrival', 'r' => $r];
$st = $pdo->prepare("SELECT p.id, p.created_at, p.moderation_status, dc.challenge_date::text AS date, ch.name AS city
                     FROM daily_proofs p JOIN daily_challenges dc ON dc.id = p.challenge_id LEFT JOIN channels ch ON ch.id = p.city_id
                     WHERE p.user_id = ? AND NOT p.is_seed AND NOT p.is_demo ORDER BY p.created_at DESC LIMIT 20");
$st->execute([$uid]);
foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) $events[] = ['at' => strtotime((string) $r['created_at']), 'kind' => 'photo', 'r' => $r];
try {
    $st = $pdo->prepare("SELECT c.id, c.created_at, c.body, c.photo_id FROM photo_comments c WHERE c.user_id = ? AND c.deleted_at IS NULL ORDER BY c.created_at DESC LIMIT 20");
    $st->execute([$uid]);
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) $events[] = ['at' => strtotime((string) $r['created_at']), 'kind' => 'comment', 'r' => $r];
} catch (\Throwable) { /* before the comments migration */ }
$st = $pdo->prepare("SELECT r.id, r.created_at, r.reason, r.status, r.reporter_user_id = ? AS by_them FROM user_reports r
                     WHERE r.reporter_user_id = ? OR r.target_user_id = ? " . ($guestIds !== [] ? "OR r.target_guest_id IN ($gIn) OR r.reporter_guest_id IN ($gIn)" : '') . "
                     ORDER BY r.created_at DESC LIMIT 20");
$st->execute(array_merge([$uid, $uid, $uid], $guestIds, $guestIds));
foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) $events[] = ['at' => strtotime((string) $r['created_at']), 'kind' => 'report', 'r' => $r];
usort($events, fn ($a, $b) => $b['at'] <=> $a['at']);
$events = array_slice($events, 0, 60);

$st = $pdo->prepare("SELECT count(*) FILTER (WHERE m.user_id IS NOT NULL), count(*) FILTER (WHERE m.user_id IS NULL)
                     FROM messages m WHERE m.type IN ('text', 'image') AND m.deleted_at IS NULL AND $mine");
$st->execute($mineArgs);
[$msgAccount, $msgGuest] = $st->fetch(PDO::FETCH_NUM);

// Why "Home city" is empty, in plain words.
$homeWhy = null;
if (empty($user['home_city']) && empty($user['home_city_id'])) {
    [$curName] = people_city_by_id($user['current_city_id'] ?? null);
    $how = ['gps' => 'their GPS', 'manual' => 'they picked it', 'profile' => 'from their profile', 'join' => 'the city they opened'][$user['current_city_source'] ?? ''] ?? null;
    $homeWhy = 'Home city is an optional profile field (Settings › Home city); this player never filled it in. '
        . ($curName !== '' ? 'They are in ' . $curName . ($how ? ' (' . $how . ')' : '') . '.' : 'They have no current city either: they have not opened a city since signing up.');
}
$methodLabel = ['email' => 'Email and password', 'google' => 'Google'][$su['method'] ?? ''] ?? ($user['google_id'] ? 'Google' : 'Email and password');
?>
<div class="card" style="padding:16px;margin-bottom:20px">
    <h2 style="font-size:16px;margin:0 0 10px">Sign-up</h2>
    <div class="info-grid">
        <span class="info-label">Signed up</span>
        <span class="info-value"><?= ui_e(ui_when($su ? strtotime((string) $su['signed_up_at']) : (int) $user['created_at'])) ?> · <?= ui_e($methodLabel) ?><?= ($su['source'] ?? '') === 'backfill' ? ' <span class="faint" title="Rebuilt from history: this account signed up before sign-ups were recorded (2026-11-28)">(from history)</span>' : '' ?></span>
        <span class="info-label">From</span>
        <span class="info-value"><?= $su ? people_where($su['country'], $su['city'], $su['ip_hash']) : '<span class="faint">–</span>' ?>
            <?php if (($su['city_source'] ?? null) === 'arrival'): ?><span class="faint" style="font-size:12px"> (the city they were in, not located by IP)</span><?php endif; ?></span>
        <span class="info-label">Platform</span>
        <span class="info-value"><?= people_platform($su['platform'] ?? null, $su['app_version'] ?? null) ?><?= !empty($su['store']) ? ' · ' . ui_e($su['store']) : '' ?></span>
        <span class="info-label">Language</span>
        <span class="info-value"><?= ui_e($su['locale'] ?? '') ?: ('<span class="faint">' . ui_e($user['locale'] ?? '–') . ' (app setting)</span>') ?></span>
        <span class="info-label">Source</span>
        <span class="info-value"><?php
            $src = [];
            if (!empty($su['inviter_user_id'])) $src[] = 'Invited by <a href="/admin/users/' . ui_e(urlencode($su['inviter_user_id'])) . '/edit">' . ui_e($su['inviter_username'] ? '@' . $su['inviter_username'] : $su['inviter_name']) . '</a>' . (!empty($su['invite_code']) ? ' (code ' . ui_e($su['invite_code']) . ')' : '');
            if (!empty($su['share_link'])) $src[] = 'Share link ' . ui_e($su['share_link']);
            if (!empty($su['utm'])) { $u = json_decode((string) $su['utm'], true) ?: []; $src[] = 'Campaign ' . ui_e(implode(' · ', array_map(fn ($k, $v) => "$k=$v", array_keys($u), $u))); }
            if (!empty($su['store_referrer'])) $src[] = 'Store referrer ' . ui_e(mb_substr($su['store_referrer'], 0, 80));
            echo $src ? implode('<br>', $src) : '<span class="faint">None recorded (direct, or before sources were recorded)</span>'; ?></span>
        <span class="info-label">As a guest</span>
        <span class="info-value"><?= $guestNames ? 'was guest ' . ui_e(implode(', ', $guestNames)) : '<span class="faint">No guest visit linked</span>' ?></span>
        <span class="info-label">Home city</span>
        <span class="info-value"><?= $homeWhy === null ? ui_e($user['home_city'] ?: people_city_by_id($user['home_city_id'] ?? null)[0]) : '<span class="faint">' . ui_e($homeWhy) . '</span>' ?></span>
        <span class="info-label">Last seen</span>
        <span class="info-value"><?php if (!empty($user['last_seen_at'])): [$lsc] = people_city_by_id($user['last_seen_city_id'] ?? null); ?>
            <?= ui_e(ui_ago(strtotime((string) $user['last_seen_at']))) ?><?= $lsc ? ' · ' . ui_e($lsc) : '' ?> · <?= people_platform($user['last_seen_platform'] ?? null, $user['last_seen_app_version'] ?? null) ?>
        <?php else: ?><span class="faint">Not recorded yet</span><?php endif; ?></span>
    </div>
</div>

<div class="card" style="padding:16px;margin-bottom:20px">
    <h2 style="font-size:16px;margin:0 0 4px">Activity</h2>
    <p class="faint" style="margin:0 0 10px;font-size:13px">Messages: <?= number_format((int) $msgAccount) ?> with the account<?= $msgGuest ? ', ' . number_format((int) $msgGuest) . ' as a guest before' : '' ?>.</p>
    <?php if ($events === []): ?>
        <p class="faint">Nothing yet.</p>
    <?php else: ?>
    <div class="table-wrapper"><table class="data"><tbody>
    <?php foreach ($events as $e): $r = $e['r']; ?>
        <tr>
            <td style="white-space:nowrap;color:var(--faint);width:130px" title="<?= ui_e(ui_when($e['at'])) ?>"><?= ui_e(date('M d, H:i', $e['at'])) ?></td>
            <td><?php switch ($e['kind']):
                case 'arrival': ?>✨ Arrived in <b><?= ui_e(people_city($r['city'] ?? '')) ?></b> <?= people_platform($r['platform']) ?><?= DailyProofRepository::bool($r['as_guest']) ? ' <span class="badge b-warn">as a guest</span>' : '' ?>
                    <div style="font-size:12px"><?= people_where($r['country'], $r['geo_city'], $r['ip_hash'], DailyProofRepository::bool($r['has_ip']) ? ['message', $r['id']] : null) ?></div><?php break;
                case 'photo': ?>📸 Daily photo (<?= ui_e($r['date']) ?><?= $r['city'] ? ', ' . ui_e(people_city($r['city'])) : '' ?>) <span class="badge <?= $r['moderation_status'] === 'approved' ? 'b-ok' : 'b-mute' ?>"><?= ui_e($r['moderation_status']) ?></span>
                    <a href="/admin/photos?tab=all&q=<?= ui_e(urlencode($r['id'])) ?>" style="font-size:12px">Open</a><?php break;
                case 'comment': ?>💬 Comment: “<?= ui_e(mb_strimwidth((string) $r['body'], 0, 90, '…')) ?>”<?php break;
                case 'report': ?>🚩 <?= DailyProofRepository::bool($r['by_them']) ? 'Reported someone' : 'Was reported' ?>: <?= ui_e($r['reason']) ?> <span class="badge b-mute"><?= ui_e($r['status']) ?></span><?php break;
            endswitch; ?></td>
        </tr>
    <?php endforeach; ?>
    </tbody></table></div>
    <?php endif; ?>
</div>
