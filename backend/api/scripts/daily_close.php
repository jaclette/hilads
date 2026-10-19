<?php
/**
 * Daily Challenge - (re)run the closing step of a challenge date: results
 * (World top 3, city ranks, best of each live city) and the close points.
 * Idempotent: points already awarded are never awarded twice. Use it when the
 * drop reported a failed close.
 *
 *   php scripts/daily_close.php --date=2026-11-02
 *
 * Prints the report as JSON. Reads DATABASE_URL etc. from the environment or
 * backend/api/.env.
 */

declare(strict_types=1);

$date = null;
foreach (array_slice($argv, 1) as $arg) {
    if (str_starts_with($arg, '--date=')) {
        $date = substr($arg, 7);
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
    'MonthlyRankService', 'DailyTwistProposals', 'DailyI18n', 'DailyPushText', 'DailyLeaderboard', 'DailyThemes', 'DailySpecials', 'DailyPresence', 'AnalyticsService', 'CityNames', 'Currencies', 'DailyCompare', 'DailyBoard', 'DailyLocalPass', 'DailyProposals', 'DailyDemo', 'DailyNotify',
] as $class) {
    require_once __DIR__ . "/../src/{$class}.php";
}

if ($date === null || !DailyClock::isValidDate($date) || DailyClock::isActive($date) || $date > DailyClock::currentDate()) {
    fwrite(STDERR, "Usage: php scripts/daily_close.php --date=YYYY-MM-DD (a past challenge date)\n");
    exit(1);
}

echo json_encode(DailyDrop::closeChallenge($date), JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), "\n";
