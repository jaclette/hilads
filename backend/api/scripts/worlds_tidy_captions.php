<?php
/**
 * One-off: the Different Worlds captions and hashtags as the rules now want them, on every package.
 * A "#" in the caption goes (a rank "#16" becomes "No. 16", an inline "#tag" loses its "#"), and
 * the hashtags are cut to 5 (#DifferentWorlds kept, then the others in order). Only the stored
 * texts change: nothing is re-rendered or re-uploaded. Safe to re-run.
 *
 *   php scripts/worlds_tidy_captions.php           # dry run: each change, nothing written
 *   php scripts/worlds_tidy_captions.php --apply   # write them
 */

declare(strict_types=1);

$apply = in_array('--apply', array_slice($argv, 1), true);

$envFile = __DIR__ . '/../.env';
if (file_exists($envFile)) {
    foreach (file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        if (preg_match('/^([A-Z0-9_]+)=(.*)$/', trim($line), $m) && getenv($m[1]) === false) {
            putenv($m[1] . '=' . trim($m[2], "\"' "));
        }
    }
}

require_once __DIR__ . '/../vendor/autoload.php';
foreach (['Database', 'R2Uploader', 'DwClips', 'DwStudio'] as $class) {
    require_once __DIR__ . "/../src/{$class}.php";
}

$pdo = Database::pdo();
$rows = $pdo->query("
    SELECT t.date::text AS date, p.id, p.version, p.content
    FROM dw_packages p JOIN dw_topics t ON t.id = p.topic_id
    ORDER BY t.date, p.version
")->fetchAll(PDO::FETCH_ASSOC);
$update = $pdo->prepare('UPDATE dw_packages SET content = ? WHERE id = ?');

$changed = 0;
foreach ($rows as $r) {
    $c = json_decode($r['content'], true);
    if (!is_array($c)) {
        continue;
    }
    $notes = [];
    if (is_string($c['caption'] ?? null) && str_contains($c['caption'], '#')) {
        $before = $c['caption'];
        $c['caption'] = DwStudio::tidyCaption($before);
        preg_match_all('/#\S*/u', $before, $m);
        $notes[] = 'caption ' . implode(' ', $m[0]) . ' → ' . (str_contains($c['caption'], '#') ? 'still a "#"' : 'none');
    }
    if (is_array($c['hashtags'] ?? null) && count($c['hashtags']) > DwStudio::HASHTAGS_MAX) {
        $dropped = array_diff($c['hashtags'], $tags = DwStudio::tidyHashtags($c['hashtags']));
        $c['hashtags'] = $tags;
        $notes[] = 'hashtags ' . implode(' ', $tags) . ' (dropped ' . implode(' ', $dropped) . ')';
    }
    if ($notes === []) {
        continue;
    }
    $changed++;
    if ($apply) {
        $update->execute([json_encode($c, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), $r['id']]);
    }
    printf("%s v%d\n  %s\n", $r['date'], $r['version'], implode("\n  ", $notes));
}
printf("%s%d package%s%s\n", $apply ? '' : 'Dry run: ', $changed, $changed === 1 ? '' : 's', $apply ? ' updated' : ' to update (run with --apply)');
