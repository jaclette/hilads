<?php

declare(strict_types=1);

admin_require_login();

// Admin › Launch Season › exports. what=ranking: the final and season ranks with the points
// breakdown (no personal data). what=participants (POST + the admin password again): emails,
// country, 18+, join date, rules version, inviter - GDPR data, every download logged.

$season = Contest::season((int) ($_GET['season'] ?? 0)) ?? admin_die('Unknown season.');
$what   = (string) ($_GET['what'] ?? '');
$pdo    = Database::pdo();

$csv = static function (string $name, array $head, array $rows): never {
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="' . $name . '"');
    header('Cache-Control: no-store');
    $out = fopen('php://output', 'w');
    fwrite($out, "\xEF\xBB\xBF");
    fputcsv($out, $head);
    foreach ($rows as $r) {
        // A cell starting with = + - @ would run as a formula in a spreadsheet.
        fputcsv($out, array_map(static fn($v) => is_string($v) && preg_match('/^[=+\-@]/', $v) ? "'" . $v : $v, $r));
    }
    fclose($out);
    exit;
};

$st   = Contest::standings($season);
$slug = preg_replace('/[^a-z0-9]+/', '-', strtolower($season['name'])) . '-' . $season['id'];

if ($what === 'ranking') {
    Contest::log($season['id'], 'export_ranking');
    $rows = [];
    foreach ($st['rows'] as $id => $r) {
        $rows[] = [$r['finalRank'] ?? '', $r['seasonRank'] ?? '', $r['username'], $r['finalPoints'], $r['finalVotes'], $r['seasonPoints'],
                   $r['seasonVotes'], $r['referralBonus'], $r['referralsCounted'], $r['headstart'], $r['days'], $r['photos'], $r['allVotes'],
                   $r['disqualified'] ? 'yes' : '', $r['dqReason'] ?? ''];
    }
    usort($rows, static fn($a, $b) => [$a[0] === '' ? PHP_INT_MAX : $a[0]] <=> [$b[0] === '' ? PHP_INT_MAX : $b[0]]);
    $csv("{$slug}-ranking.csv", ['final_rank', 'season_rank', 'username', 'final_points', 'final_votes', 'season_points', 'season_votes',
         'referral_points', 'referrals_counted', 'headstart', 'days_played', 'photos', 'likes_uncapped', 'disqualified', 'dq_reason'], $rows);
}

if ($what === 'participants') {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') admin_die('Use the form in Winner & export.');
    csrf_verify();
    $pass = (string) (getenv('ADMIN_PASSWORD') ?: '');
    if ($pass === '' || !hash_equals($pass, (string) ($_POST['password'] ?? ''))) {
        Contest::log($season['id'], 'export_participants_refused');
        flash_set('error', 'Wrong password: personal data not exported.');
        admin_redirect('/admin/launch-season?tab=winner&season=' . $season['id']);
    }
    Contest::log($season['id'], 'export_participants', null, ['ip' => Request::ip() !== '' ? substr(hash('sha256', Request::ip()), 0, 12) : null]);
    $stmt = $pdo->prepare("
        SELECT cp.*, u.username, u.display_name, u.email, iu.username AS inviter
        FROM contest_participants cp JOIN users u ON u.id = cp.user_id
        LEFT JOIN users iu ON iu.id = cp.referred_by
        WHERE cp.season_id = ? ORDER BY cp.joined_at
    ");
    $stmt->execute([$season['id']]);
    $rows = [];
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $p) {
        $r = $st['rows'][$p['user_id']] ?? null;
        $rows[] = [$p['user_id'], $p['username'], $p['display_name'], $p['email'], $p['country'],
                   DailyProofRepository::bool($p['age_confirmed']) ? 'yes' : 'no', $p['joined_at'], $p['rules_accepted_at'], $p['rules_version'],
                   $p['inviter'] ?? '', DailyProofRepository::bool($p['disqualified']) ? 'yes' : '', $p['dq_reason'] ?? '',
                   $r['finalRank'] ?? '', $r['finalPoints'] ?? '', $r === null ? 'excluded account' : ''];
    }
    $csv("{$slug}-participants.csv", ['user_id', 'username', 'display_name', 'email', 'country', 'age_18_confirmed', 'joined_at',
         'rules_accepted_at', 'rules_version', 'invited_by', 'disqualified', 'dq_reason', 'final_rank', 'final_points', 'note'], $rows);
}

admin_die('Unknown export.');
