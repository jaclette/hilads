<?php
/**
 * Hilads picks (editorial spots): create picks from a JSON file whose photos
 * are already hosted, as drafts unless an entry says otherwise. Publish them in
 * the back office (/admin/daily/picks). A place that already has a pick photo
 * is skipped, so a re-run never duplicates.
 *
 *   php scripts/picks_import.php --file=picks.json --dry     # check, write nothing
 *   php scripts/picks_import.php --file=https://.../picks.json
 *
 * File: {"picks": [{"name", "lat", "lng", "theme", "caption", "credit",
 * "note": {"en", "fr", ...}, "photoUrl", "status": "draft"}]}. Reads
 * DATABASE_URL etc. from the environment or backend/api/.env.
 */

declare(strict_types=1);

$args = array_slice($argv, 1);
$dry  = in_array('--dry', $args, true);
$file = null;
foreach ($args as $a) {
    if (str_starts_with($a, '--file=')) {
        $file = substr($a, 7);
    }
}
if ($file === null) {
    fwrite(STDERR, "Usage: php scripts/picks_import.php --file=<picks.json | https URL> [--dry]\n");
    exit(1);
}

$envFile = __DIR__ . '/../.env';
if (file_exists($envFile)) {
    foreach (file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        if (preg_match('/^([A-Z0-9_]+)=(.*)$/', trim($line), $m) && getenv($m[1]) === false) {
            putenv($m[1] . '=' . trim($m[2], "\"' "));
        }
    }
}

require_once __DIR__ . '/../vendor/autoload.php';
foreach ([
    'Database', 'Cache', 'CityRepository', 'R2Uploader', 'ImageProcessor', 'ModerationService', 'DailyClock', 'DailyRules',
    'DailyI18n', 'DailyThemes', 'DailyCompare', 'Currencies', 'DailyProofRepository', 'DailyChallengeRepository', 'DailyAdminService',
    'Places', 'Spots', 'SpotsAdmin',
] as $class) {
    require_once __DIR__ . "/../src/{$class}.php";
}

$host = parse_url((string) getenv('DATABASE_URL'), PHP_URL_HOST) ?: '(no DATABASE_URL)';
fwrite(STDERR, "Database host: {$host}\n");

try {
    $raw   = (string) file_get_contents($file);
    $picks = (json_decode($raw, true) ?: [])['picks'] ?? null;
    if (!is_array($picks) || $picks === []) {
        throw new InvalidArgumentException('No "picks" in the file.');
    }
    DailyAdminService::$actor = 'picks_import';
    $report = [];
    foreach ($picks as $p) {
        $id = SpotsAdmin::pickImport($p, $dry);
        $report[] = ['name' => $p['name'] ?? '?', 'action' => $id === null ? 'skip (already a pick)' : ($dry ? 'would create' : 'created'), 'place' => $id];
    }
    echo json_encode(['dryRun' => $dry, 'picks' => $report], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), "\n";
} catch (Throwable $e) {
    fwrite(STDERR, 'Error: ' . $e->getMessage() . "\n");
    exit(1);
}
