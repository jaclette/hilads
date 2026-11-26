<?php
/**
 * READ-ONLY audit of the "everyone lands in Saigon" bug (web /api/geo fell back to Saigon and JOINED
 * visitors there: chat arrival, current city = Saigon with source "join", their Daily photos counted
 * for Saigon). Prints counts only: no names, emails or IPs. Changes nothing.
 *
 *   php scripts/geo_saigon_audit.php                          # counts from our own data
 *   php scripts/geo_saigon_audit.php --lookup-ips             # + the country of each Saigon arrival's IP,
 *                                                             #   via ipinfo.io (the service /api/geo already
 *                                                             #   uses for every visitor; IPINFO_TOKEN if set)
 *   --since=2026-06-01   only arrivals / accounts from that date (default: 120 days ago)
 *
 * "Likely wrong" = an account whose current city is Saigon by a GUESS (source join / profile / none,
 * never gps or manual) with evidence it is elsewhere: a device timezone outside Vietnam, or (with
 * --lookup-ips) its Saigon arrival from an IP outside Vietnam.
 */

declare(strict_types=1);

$args = array_slice($argv, 1);
$lookup = in_array('--lookup-ips', $args, true);
$since = date('Y-m-d', strtotime('-120 days'));
foreach ($args as $a) {
    if (preg_match('/^--since=(\d{4}-\d{2}-\d{2})$/', $a, $m)) $since = $m[1];
}

$envFile = __DIR__ . '/../.env';
if (file_exists($envFile)) {
    foreach (file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        if (preg_match('/^([A-Z0-9_]+)=(.*)$/', trim($line), $m) && getenv($m[1]) === false) putenv($m[1] . '=' . trim($m[2], "\"' "));
    }
}
require_once __DIR__ . '/../vendor/autoload.php';
require_once __DIR__ . '/../src/Database.php';
$pdo = Database::pdo();

$saigon = $pdo->query("SELECT c.channel_id FROM cities c JOIN channels ch ON ch.id = c.channel_id WHERE ch.name = 'Ho Chi Minh City' LIMIT 1")->fetchColumn();
if (!$saigon) { fwrite(STDERR, "Ho Chi Minh City not found.\n"); exit(1); }
$VN_TZ = ['Asia/Ho_Chi_Minh', 'Asia/Saigon'];
$hasSource = (bool) $pdo->query("SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'current_city_source'")->fetchColumn();
$real = "NOT coalesce(u.is_fake, false) AND NOT coalesce(u.is_demo, false) AND NOT coalesce(u.is_review, false) AND u.deleted_at IS NULL";

function line(string $label, $value): void { printf("  %-62s %s\n", $label, is_int($value) ? number_format($value) : $value); }

echo "Saigon = {$saigon}. Window: arrivals and accounts since {$since}." . ($lookup ? ' IP lookup: on.' : ' IP lookup: off (add --lookup-ips).') . "\n\n";

// ── 1. Accounts whose current city is Saigon ────────────────────────────────
echo "1. Accounts with current city = Saigon (real accounts, not deleted)\n";
$src = $hasSource ? "coalesce(u.current_city_source, 'none')" : "'none'";
$rows = $pdo->query("SELECT {$src} AS src, count(*) FROM users u WHERE u.current_city_id = " . $pdo->quote($saigon) . " AND {$real} GROUP BY 1 ORDER BY 2 DESC")->fetchAll(PDO::FETCH_KEY_PAIR);
line('total', array_sum($rows));
foreach ($rows as $s => $n) line("  by source: {$s}" . (in_array($s, ['gps', 'manual'], true) ? ' (set by the player: fine)' : ' (a guess)'), (int) $n);

// Guessed ones, with their device timezone and latest Saigon arrival IP.
$guess = $hasSource ? "coalesce(u.current_city_source, '') NOT IN ('gps', 'manual')" : 'TRUE';
$st = $pdo->prepare("
    SELECT u.id, u.timezone,
           (SELECT m.ip_address FROM messages m WHERE m.user_id = u.id AND m.channel_id = :c AND m.type = 'system' AND m.event = 'join'
             ORDER BY m.created_at DESC LIMIT 1) AS ip,
           (SELECT m.platform FROM messages m WHERE m.user_id = u.id AND m.channel_id = :c AND m.type = 'system' AND m.event = 'join'
             ORDER BY m.created_at DESC LIMIT 1) AS platform
    FROM users u
    WHERE u.current_city_id = :c AND {$guess} AND {$real}
");
$st->execute([':c' => $saigon]);
$guessed = $st->fetchAll(PDO::FETCH_ASSOC);

// ── IP → country (optional) ─────────────────────────────────────────────────
$ipCountry = [];
$lookupIp = function (?string $ip) use (&$ipCountry, $lookup): ?string {
    if (!$lookup || $ip === null || !filter_var($ip, FILTER_VALIDATE_IP)) return null;
    if (array_key_exists($ip, $ipCountry)) return $ipCountry[$ip];
    $token = getenv('IPINFO_TOKEN');
    $ctx = stream_context_create(['http' => ['timeout' => 4, 'header' => "Accept: application/json\r\n"]]);
    $raw = @file_get_contents('https://ipinfo.io/' . rawurlencode($ip) . '/json' . ($token ? '?token=' . rawurlencode($token) : ''), false, $ctx);
    $d = $raw ? json_decode($raw, true) : null;
    $org = (string) ($d['org'] ?? '');
    $dc = preg_match('/\b(amazon|google|microsoft|azure|byteplus|bytedance|alibaba|tencent|hetzner|ovh|digitalocean|linode|vultr|choopa|oracle|contabo|leaseweb|m247|datacamp|cdn77|hosting|data ?cent(er|re)|vps|server)\b/i', $org);
    usleep(120000);
    return $ipCountry[$ip] = $d && isset($d['country']) ? ($dc ? 'DATACENTER' : strtoupper($d['country'])) : null;
};

$tzVn = $tzOther = $tzNone = 0;
$ipVn = $ipOther = $ipNone = 0;
$likelyWrong = [];
$byCountry = [];
foreach ($guessed as $g) {
    $tz = $g['timezone'];
    $tzForeign = $tz !== null && $tz !== '' && !in_array($tz, $VN_TZ, true);
    if ($tz === null || $tz === '') $tzNone++; elseif ($tzForeign) $tzOther++; else $tzVn++;
    $cc = $lookupIp($g['ip']);
    if ($cc === null) $ipNone++; elseif ($cc === 'VN') $ipVn++; else $ipOther++;
    $ipForeign = $cc !== null && $cc !== 'VN';
    if ($tzForeign || $ipForeign) {
        $likelyWrong[] = $g['id'];
        $key = $ipForeign ? $cc : ('tz:' . explode('/', (string) $tz)[0]);
        $byCountry[$key] = ($byCountry[$key] ?? 0) + 1;
    }
}
echo "\n2. The guessed ones (" . count($guessed) . ")\n";
line('device timezone in Vietnam', $tzVn);
line('device timezone elsewhere', $tzOther);
line('no device timezone (web accounts never send one)', $tzNone);
if ($lookup) {
    line('Saigon arrival from an IP in Vietnam', $ipVn);
    line('Saigon arrival from an IP elsewhere (incl. data centres)', $ipOther);
    line('no arrival IP / lookup failed', $ipNone);
}
echo "\n3. LIKELY WRONGLY ATTACHED TO SAIGON: " . count($likelyWrong) . " account(s)\n";
arsort($byCountry);
foreach (array_slice($byCountry, 0, 12, true) as $k => $n) line("  {$k}", $n);
if (!$lookup) echo "  (web accounts can only be judged with --lookup-ips: they have no device timezone)\n";

// ── 4. Their Daily photos counted for Saigon ────────────────────────────────
echo "\n4. Daily photos counted for Saigon\n";
if ($likelyWrong !== []) {
    $in = implode(',', array_map([$pdo, 'quote'], $likelyWrong));
    $r = $pdo->query("SELECT count(*), count(DISTINCT user_id), min(created_at)::date, max(created_at)::date FROM daily_proofs
                      WHERE city_id = " . $pdo->quote($saigon) . " AND user_id IN ({$in}) AND NOT is_seed AND NOT is_demo AND NOT is_suggestion")->fetch(PDO::FETCH_NUM);
    line('by the likely-wrong accounts (photos / players / from / to)', "{$r[0]} / {$r[1]} / " . ($r[2] ?? '–') . ' / ' . ($r[3] ?? '–'));
}
$far = $pdo->query("
    SELECT count(*) FROM daily_proofs p, (SELECT lat, lng FROM cities WHERE channel_id = " . $pdo->quote($saigon) . ") s
    WHERE p.city_id = " . $pdo->quote($saigon) . " AND p.place_lat IS NOT NULL AND NOT p.is_seed AND NOT p.is_demo AND NOT p.is_suggestion
      AND 6371 * 2 * asin(sqrt(power(sin(radians(p.place_lat - s.lat) / 2), 2) + cos(radians(s.lat)) * cos(radians(p.place_lat)) * power(sin(radians(p.place_lng - s.lng) / 2), 2))) > 100
")->fetchColumn();
line('any Saigon photo whose own location is > 100 km from Saigon', (int) $far);

// ── 5. Guests: web arrivals in Saigon, per week (the before / after baseline) ──
echo "\n5. Arrivals in Saigon (chat \"X arrived\"), per week since {$since}: web / app" . ($lookup ? ' / web from outside VN' : '') . "\n";
$st = $pdo->prepare("
    SELECT date_trunc('week', created_at)::date AS wk, platform, ip_address, user_id IS NULL AS guest
    FROM messages WHERE channel_id = ? AND type = 'system' AND event = 'join' AND created_at >= ?::date ORDER BY created_at
");
$st->execute([$saigon, $since]);
$weeks = [];
foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $m) {
    $w = &$weeks[$m['wk']];
    $w ??= ['web' => 0, 'app' => 0, 'webForeign' => 0];
    $isWeb = $m['platform'] === 'web';
    $w[$isWeb ? 'web' : 'app']++;
    if ($isWeb && $lookup) { $cc = $lookupIp($m['ip_address']); if ($cc !== null && $cc !== 'VN') $w['webForeign']++; }
    unset($w);
}
foreach ($weeks as $wk => $w) line("  week of {$wk}", "{$w['web']} / {$w['app']}" . ($lookup ? " / {$w['webForeign']}" : ''));
if ($lookup) line('distinct IPs looked up', count($ipCountry));

echo "\nNothing was changed.\n";
