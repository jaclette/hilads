<?php
/**
 * Daily Challenge - bulk import challenges, reserve and Local Twists from JSON.
 *
 *   php scripts/daily_import.php path/to/challenges.json --dry   # validate + report, write nothing
 *   php scripts/daily_import.php path/to/challenges.json         # apply
 *
 * File format: docs/daily-challenge/daily-challenges.example.json. Twist cities
 * are city slugs ("ho-chi-minh-city"). Nothing is written if any entry is
 * invalid. Dated entries create or update the day's challenge (published days
 * and past dates are skipped); reserve entries skip existing texts. Same code
 * path as the back office import (DailyAdminService::import), logged as "cli".
 */

declare(strict_types=1);

$args   = array_slice($argv, 1);
$dryRun = in_array('--dry', $args, true);
$files  = array_values(array_filter($args, fn($a) => $a !== '--dry'));
if (count($files) !== 1) {
    fwrite(STDERR, "Usage: php scripts/daily_import.php <file.json> [--dry]\n");
    exit(1);
}

// ── .env (same pattern as migrate.php) ───────────────────────────────────────

$envFile = __DIR__ . '/../.env';
if (file_exists($envFile)) {
    $vars = @parse_ini_file($envFile);
    if (is_array($vars)) {
        foreach ($vars as $key => $value) putenv("$key=$value");
    }
}

require_once __DIR__ . '/../src/Database.php';
require_once __DIR__ . '/../src/Cache.php';
require_once __DIR__ . '/../src/CityRepository.php';
require_once __DIR__ . '/../src/R2Uploader.php';
require_once __DIR__ . '/../src/DailyClock.php';
require_once __DIR__ . '/../src/DailyRules.php';
require_once __DIR__ . '/../src/DailyProofRepository.php';
require_once __DIR__ . '/../src/ModerationService.php';
require_once __DIR__ . '/../src/DailyAdminService.php';

$raw = @file_get_contents($files[0]);
if ($raw === false) {
    fwrite(STDERR, "ERROR: cannot read {$files[0]}\n");
    exit(1);
}
$doc = json_decode($raw, true);
if (!is_array($doc)) {
    fwrite(STDERR, "ERROR: {$files[0]} is not valid JSON\n");
    exit(1);
}

DailyAdminService::$actor = 'cli';
$result = DailyAdminService::import($doc, $dryRun);

echo $dryRun ? "DRY RUN - nothing written\n\n" : "APPLIED\n\n";
if (!$result['ok']) {
    echo "Invalid file, nothing imported:\n";
    foreach ($result['errors'] as $err) echo "  ERR {$err}\n";
    exit(1);
}
foreach ($result['report'] as $line) {
    $detail = $line['reason'] ?? trim(($line['date'] ?? '') . ' ' . ($line['id'] ?? ''));
    printf("  %-6s %-15s %s\n", $line['entry'], $line['action'], $detail);
}
$counts = array_count_values(array_column($result['report'], 'action'));
echo "\n" . json_encode($counts) . "\n";
