<?php
/**
 * Clears the GUESSED current city of accounts the Saigon bug placed there, when their Saigon arrival
 * came from an IP outside Vietnam (same rule as scripts/geo_saigon_audit.php --lookup-ips).
 *
 *   php scripts/geo_saigon_fix_accounts.php            # DRY RUN (default): lists what would change, changes nothing
 *   php scripts/geo_saigon_fix_accounts.php --apply    # clears them, one audit-log line per account
 *
 * Only touches: real accounts (not seeded / demo / review / deleted) whose current city is Saigon by a
 * guess (source join / profile / none, never gps or manual) AND whose latest Saigon arrival IP is in
 * another country per ipinfo.io. Accounts with no arrival IP, a Vietnamese IP, a data-centre IP or a
 * failed lookup are left as they are. Sets current_city_id / _set_at / _source to NULL: the app asks
 * for their city again (GPS or the picker). Photos, points, arrivals, rankings: untouched.
 */

declare(strict_types=1);

$apply = in_array('--apply', array_slice($argv, 1), true);

$envFile = __DIR__ . '/../.env';
if (file_exists($envFile)) {
    foreach (file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        if (preg_match('/^([A-Z0-9_]+)=(.*)$/', trim($line), $m) && getenv($m[1]) === false) putenv($m[1] . '=' . trim($m[2], "\"' "));
    }
}
require_once __DIR__ . '/../vendor/autoload.php';
require_once __DIR__ . '/../src/Database.php';
require_once __DIR__ . '/../src/DailyAdminService.php';
$pdo = Database::pdo();

$saigon = $pdo->query("SELECT c.channel_id FROM cities c JOIN channels ch ON ch.id = c.channel_id WHERE ch.name = 'Ho Chi Minh City' LIMIT 1")->fetchColumn();
if (!$saigon) { fwrite(STDERR, "Ho Chi Minh City not found.\n"); exit(1); }

$st = $pdo->prepare("
    SELECT u.id, u.current_city_source AS source, u.current_city_set_at AS set_at, to_timestamp(u.created_at)::date AS joined,
           (SELECT m.ip_address FROM messages m WHERE m.user_id = u.id AND m.channel_id = :c AND m.type = 'system' AND m.event = 'join'
             ORDER BY m.created_at DESC LIMIT 1) AS ip
    FROM users u
    WHERE u.current_city_id = :c AND coalesce(u.current_city_source, '') NOT IN ('gps', 'manual')
      AND NOT coalesce(u.is_fake, false) AND NOT coalesce(u.is_demo, false) AND NOT coalesce(u.is_review, false) AND u.deleted_at IS NULL
    ORDER BY u.created_at
");
$st->execute([':c' => $saigon]);
$guessed = $st->fetchAll(PDO::FETCH_ASSOC);

function ip_country(string $ip): ?string {
    $token = getenv('IPINFO_TOKEN');
    $ctx = stream_context_create(['http' => ['timeout' => 4, 'header' => "Accept: application/json\r\n"]]);
    $raw = @file_get_contents('https://ipinfo.io/' . rawurlencode($ip) . '/json' . ($token ? '?token=' . rawurlencode($token) : ''), false, $ctx);
    $d = $raw ? json_decode($raw, true) : null;
    usleep(120000);
    if (!$d || !isset($d['country'])) return null;
    $dc = preg_match('/\b(amazon|google|microsoft|azure|byteplus|bytedance|alibaba|tencent|hetzner|ovh|digitalocean|linode|vultr|choopa|oracle|contabo|leaseweb|m247|datacamp|cdn77|hosting|data ?cent(er|re)|vps|server)\b/i', (string) ($d['org'] ?? ''));
    return $dc ? 'DATACENTER' : strtoupper($d['country']);
}

$targets = [];
$kept = ['no arrival IP' => 0, 'IP in Vietnam' => 0, 'data-centre IP' => 0, 'lookup failed' => 0];
foreach ($guessed as $g) {
    if ($g['ip'] === null || !filter_var($g['ip'], FILTER_VALIDATE_IP)) { $kept['no arrival IP']++; continue; }
    $cc = ip_country($g['ip']);
    if ($cc === null) { $kept['lookup failed']++; continue; }
    if ($cc === 'VN') { $kept['IP in Vietnam']++; continue; }
    if ($cc === 'DATACENTER') { $kept['data-centre IP']++; continue; }
    $targets[] = $g + ['country' => $cc];
}

echo ($apply ? "APPLY" : "DRY RUN (nothing is changed; add --apply to do it)") . ". Saigon = {$saigon}.\n\n";
echo count($guessed) . " account(s) in Saigon by a guess. Left as they are:\n";
foreach ($kept as $k => $n) printf("  %-20s %d\n", $k, $n);
echo "\n" . count($targets) . " account(s) to clear (arrival IP outside Vietnam):\n";
foreach ($targets as $t) {
    printf("  user %s  joined %s  arrival IP country %s\n", $t['id'], $t['joined'], $t['country']);
    printf("      current city: Saigon (source %s, set %s)  ->  none (asked again by the app)\n", $t['source'] ?? 'none', $t['set_at'] ?? '–');
}
if ($targets === [] || !$apply) { echo "\n" . ($apply ? "Nothing to do.\n" : "Nothing was changed.\n"); exit(0); }

DailyAdminService::$actor = 'cli: geo_saigon_fix_accounts';
$upd = $pdo->prepare("UPDATE users SET current_city_id = NULL, current_city_set_at = NULL, current_city_source = NULL
                      WHERE id = ? AND current_city_id = ? AND coalesce(current_city_source, '') NOT IN ('gps', 'manual')");
$done = 0;
foreach ($targets as $t) {
    $upd->execute([$t['id'], $saigon]);
    if ($upd->rowCount() === 1) {
        $done++;
        DailyAdminService::audit('user.current_city_cleared', 'user', (string) $t['id'],
            ['current_city_id' => $saigon, 'current_city_source' => $t['source'], 'current_city_set_at' => $t['set_at']],
            ['current_city_id' => null, 'reason' => 'Saigon geo bug: arrival IP in ' . $t['country']]);
    }
}
echo "\nCleared {$done} account(s). Each change is in the back office audit log (user.current_city_cleared).\n";
