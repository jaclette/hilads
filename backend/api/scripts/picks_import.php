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
 * "note": {"en", "fr", ...}, "photoUrl", "status": "draft" | "published",
 * "attach": [{"date", "answer"}]}], "attach": [{"name", "date", "answer"}]}.
 * "attach" puts a pick in that day's Compare tab ("Meanwhile, from our
 * picks") with its checked answer (null: none); the top-level "attach" is for
 * picks that already exist, by exact name. Re-attaching replaces the answer.
 * Reads DATABASE_URL etc. from the environment or backend/api/.env.
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
    $doc    = json_decode((string) file_get_contents($file), true) ?: [];
    $picks  = is_array($doc['picks'] ?? null) ? $doc['picks'] : [];
    $extra  = is_array($doc['attach'] ?? null) ? $doc['attach'] : [];
    if ($picks === [] && $extra === []) {
        throw new InvalidArgumentException('No "picks" or "attach" in the file.');
    }
    DailyAdminService::$actor = 'picks_import';
    $report = [];
    $attach = static function (?string $placeId, string $name, array $a) use ($dry, &$report): void {
        $line = ['name' => $name, 'date' => $a['date'] ?? '?', 'answer' => $a['answer'] ?? null];
        if ($placeId === null) {
            $report[] = $line + ['action' => $dry ? 'would attach (after create)' : 'attach skipped: no pick'];
            return;
        }
        $action = $dry ? 'would attach' : 'attached';
        if (!$dry) {
            try {
                SpotsAdmin::pickAttach($placeId, (string) ($a['date'] ?? ''), (string) ($a['answer'] ?? ''));
            } catch (InvalidArgumentException $e) {
                // An answer that doesn't fit the question: attached without it; no challenge that day: reported. Never a stopped import.
                try {
                    SpotsAdmin::pickAttach($placeId, (string) ($a['date'] ?? ''), '');
                    $action = 'attached without answer: ' . $e->getMessage();
                } catch (InvalidArgumentException $e2) {
                    $action = 'not attached: ' . $e2->getMessage();
                }
            }
        }
        $report[] = $line + ['action' => $action];
    };
    foreach ($picks as $p) {
        $r = SpotsAdmin::pickImport($p, $dry);
        $report[] = ['name' => $p['name'] ?? '?', 'action' => $r['action'], 'status' => $p['status'] ?? 'draft', 'place' => $r['place']];
        foreach (is_array($p['attach'] ?? null) ? $p['attach'] : [] as $a) {
            $attach($r['place'], (string) ($p['name'] ?? '?'), $a);
        }
    }
    foreach ($extra as $a) {
        $attach(SpotsAdmin::pickIdByName((string) ($a['name'] ?? '')), (string) ($a['name'] ?? '?'), $a);
    }
    echo json_encode(['dryRun' => $dry, 'report' => $report], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), "\n";
} catch (Throwable $e) {
    fwrite(STDERR, 'Error: ' . $e->getMessage() . "\n");
    exit(1);
}
