<?php
/**
 * Daily Challenge - run one scheduler tick from the command line (same code as
 * GET /internal/daily-tick): the drop of today's challenge date if it has not
 * run yet, then the pushes that are due.
 *
 *   php scripts/daily_tick.php                              # now
 *   php scripts/daily_tick.php --now="2026-11-02 02:01"     # simulate a moment (UTC) - local testing only
 *
 * Prints the tick report as JSON. Reads DATABASE_URL etc. from the environment
 * or backend/api/.env.
 */

declare(strict_types=1);

$now = null;
foreach (array_slice($argv, 1) as $arg) {
    if (str_starts_with($arg, '--now=')) {
        $now = new DateTimeImmutable(substr($arg, 6), new DateTimeZone('UTC'));
    }
}

$envFile = __DIR__ . '/../.env';
if (file_exists($envFile)) {
    $vars = @parse_ini_file($envFile);
    if (is_array($vars)) {
        foreach ($vars as $key => $value) {
            if (getenv($key) === false) putenv("$key=$value");
        }
    }
}

require_once __DIR__ . '/../vendor/autoload.php';
foreach ([
    'Database', 'Cache', 'Request', 'CityRepository', 'R2Uploader', 'ModerationService', 'DbRateLimiter',
    'NotificationI18n', 'BotAccountService', 'NotificationPreferencesRepository', 'PushService', 'MobilePushService',
    'NotificationRepository', 'DailyClock', 'DailyRules', 'DailyProofRepository', 'DailyChallengeRepository',
    'DailyAdminService', 'DailyCards', 'DailyPushes', 'DailyDrop', 'DailyVotes', 'DailyResults', 'DailyPoints',
    'MonthlyRankService', 'DailyTwistProposals', 'DailyI18n', 'DailyPushText', 'DailyLeaderboard', 'DailyThemes', 'DailySpecials', 'DailyPresence', 'AnalyticsService', 'CityNames', 'Currencies', 'DailyCompare', 'DailyLocalPass', 'DailyProposals', 'DailyDemo', 'DailyNotify',
] as $class) {
    require_once __DIR__ . "/../src/{$class}.php";
}

echo json_encode(DailyDrop::tick($now), JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), "\n";
