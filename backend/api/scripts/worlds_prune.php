<?php
/**
 * One-off: keeps only the latest version of every Different Worlds topic.
 * The older versions are deleted with their slides, photos and video on R2
 * (new imports do this themselves once the new version is rendered).
 *
 *   php scripts/worlds_prune.php           # dry run: what would go, nothing deleted
 *   php scripts/worlds_prune.php --apply   # delete them
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

$rows = Database::pdo()->query("
    SELECT t.date::text AS date, p.id, p.version,
           (SELECT COUNT(*) FROM dw_packages o WHERE o.topic_id = p.topic_id AND o.version < p.version) AS older
    FROM dw_packages p JOIN dw_topics t ON t.id = p.topic_id
    WHERE p.version = (SELECT MAX(version) FROM dw_packages m WHERE m.topic_id = p.topic_id)
    ORDER BY t.date
")->fetchAll(PDO::FETCH_ASSOC);

$total = 0;
foreach ($rows as $r) {
    if ((int) $r['older'] === 0) {
        continue;
    }
    $total += (int) $r['older'];
    if ($apply) {
        DwStudio::pruneOlderVersions((int) $r['id']);
    }
    printf("%s: keeps v%d, %s %d older version%s\n", $r['date'], $r['version'], $apply ? 'deleted' : 'would delete', $r['older'], $r['older'] > 1 ? 's' : '');
}
printf("%s%d older version%s%s\n", $apply ? '' : 'Dry run: ', $total, $total === 1 ? '' : 's', $apply ? ' deleted' : ' to delete (run with --apply)');
