<?php
// Push / bell text of one locale, for a translation pass (same loop as export.mjs / apply.mjs).
//
//   php tools/i18n/push.php export vi            → tmp/i18n/vi/push-in.json
//   php tools/i18n/push.php apply vi             ← tmp/i18n/vi/push-out.json (same keys, "t": text or [title, body])
//
// Sources: backend/api/src/NotificationI18n.php (T: type → locale → [title, body|null], MENTION)
// and backend/api/src/DailyPushText.php (T: locale → key → text). Apply rewrites only that
// locale's lines; a value whose {placeholders} differ from the current one is refused.
declare(strict_types=1);

[$cmd, $locale] = [$argv[1] ?? '', $argv[2] ?? ''];
$repo = dirname(__DIR__, 2);
$files = ['notif' => "$repo/backend/api/src/NotificationI18n.php", 'daily' => "$repo/backend/api/src/DailyPushText.php"];
require_once $files['notif'];
require_once $files['daily'];
$dir = "$repo/tmp/i18n/$locale";
$ph = static function ($s): string {
    preg_match_all('/\{[a-zA-Z_]+\}/', (string) $s, $m);
    sort($m[0]);
    return implode(' ', $m[0]);
};

$notifT  = (new ReflectionClassConstant('NotificationI18n', 'T'))->getValue();
$mention = (new ReflectionClassConstant('NotificationI18n', 'MENTION'))->getValue();
$daily   = DailyPushText::catalog();

if ($cmd === 'export') {
    // The comment above each notification type says what it is (the English lives at the call site).
    $src = file($files['notif']);
    $about = [];
    foreach ($src as $i => $line) {
        if (preg_match("/^        '([a-z_]+)' => \[\s*$/", $line, $m)) {
            $c = [];
            for ($j = $i - 1; $j > 0 && preg_match('#^\s*//\s?(.*)$#', $src[$j], $cm); $j--) array_unshift($c, $cm[1]);
            $about[$m[1]] = implode(' ', $c);
        }
    }
    $out = [];
    foreach ($notifT as $type => $byLocale) {
        if (!isset($byLocale[$locale])) continue;
        $out["notif.$type"] = ['about' => $about[$type] ?? '', 'ref_fr' => $byLocale['fr'] ?? null, 'ref_es' => $byLocale['es'] ?? null,
                               'current' => $byLocale[$locale], 'shape' => '[title, body] (body null = the app keeps the message preview / proper noun)'];
    }
    foreach ($mention[$locale] ?? [] as $k => $v) {
        $out["mention.$k"] = ['about' => 'someone mentioned you (' . $k . ')', 'ref_fr' => $mention['fr'][$k], 'ref_es' => $mention['es'][$k], 'current' => $v];
    }
    foreach ($daily[$locale] ?? [] as $k => $v) {
        $out["daily.$k"] = ['ref_fr' => $daily['fr'][$k] ?? null, 'ref_es' => $daily['es'][$k] ?? null, 'current' => $v];
    }
    @mkdir($dir, 0777, true);
    file_put_contents("$dir/push-in.json", json_encode($out, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n");
    echo count($out) . " push strings → tmp/i18n/$locale/push-in.json\n";
    exit(0);
}

if ($cmd !== 'apply' || !is_file("$dir/push-out.json")) {
    fwrite(STDERR, "usage: push.php export|apply <locale>\n");
    exit(1);
}

$new = json_decode((string) file_get_contents("$dir/push-out.json"), true, 512, JSON_THROW_ON_ERROR);
$q = static fn(?string $s): string => $s === null ? 'null' : '"' . strtr($s, ['\\' => '\\\\', '"' => '\\"', '$' => '\\$']) . '"';
$loc = preg_quote($locale, '/');
$changed = 0;
$refused = [];

// NotificationI18n: one line per locale inside each type block, then the MENTION block.
$lines = file($files['notif']);
$block = null;
$inMention = false;
$mentionLocale = null;
foreach ($lines as $i => $line) {
    if (preg_match('/private const MENTION/', $line)) $inMention = true;
    if (!$inMention && preg_match("/^        '([a-z_]+)' => \[\s*$/", $line, $m)) $block = $m[1];
    if (!$inMention && $block && preg_match("/^(\s+'$loc'\s*=>\s*)\[(.*)\],\s*$/u", $line, $m)) {
        $v = $new["notif.$block"]['t'] ?? null;
        $cur = $notifT[$block][$locale];
        if (!is_array($v) || count($v) !== 2 || $v === $cur) continue;
        if ($ph($v[0]) !== $ph($cur[0]) || $ph($v[1]) !== $ph($cur[1]) || ($cur[1] === null) !== ($v[1] === null)) { $refused[] = "notif.$block"; continue; }
        $repl = $m[1] . '[' . $q($v[0]) . ', ' . $q($v[1]) . "],\n";
        if ($repl !== $line) { $lines[$i] = $repl; $changed++; }
    }
    if ($inMention && preg_match("/^        '([a-z-]+)' => \[\s*$/", $line, $m)) $mentionLocale = $m[1];
    if ($inMention && $mentionLocale === $locale && preg_match("/^(\s+'(titled|city|world)'\s*=>\s*)\"(.*)\",(.*)$/u", $line, $m)) {
        $v = $new["mention.{$m[2]}"]['t'] ?? null;
        if (!is_string($v) || $v === $mention[$locale][$m[2]]) continue;
        if ($ph($v) !== $ph($mention[$locale][$m[2]])) { $refused[] = "mention.{$m[2]}"; continue; }
        $repl = $m[1] . $q($v) . ',' . rtrim($m[4]) . "\n";
        if ($repl !== $line) { $lines[$i] = $repl; $changed++; }
    }
    if ($inMention && preg_match('/^    \];/', $line)) $inMention = false;
}
file_put_contents($files['notif'], implode('', $lines));

// DailyPushText: the locale's block, one line per key.
$lines = file($files['daily']);
$in = false;
foreach ($lines as $i => $line) {
    if (preg_match("/^        '([a-z-]+)' => \[\s*$/", $line, $m)) $in = $m[1] === $locale;
    if ($in && preg_match("/^(\s+'([a-z_]+)'\s*=>\s*)\"(.*)\",\s*$/u", $line, $m)) {
        $v = $new["daily.{$m[2]}"]['t'] ?? null;
        if (!is_string($v) || $v === $daily[$locale][$m[2]]) continue;
        if ($ph($v) !== $ph($daily[$locale][$m[2]])) { $refused[] = "daily.{$m[2]}"; continue; }
        $repl = $m[1] . $q($v) . ",\n";
        if ($repl !== $line) { $lines[$i] = $repl; $changed++; }
    }
}
file_put_contents($files['daily'], implode('', $lines));

echo "$locale: $changed push string(s) changed" . ($refused ? '; refused (placeholders): ' . implode(' ', $refused) : '') . "\n";
