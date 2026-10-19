<?php
/**
 * Daily Challenge demo content (DailyDemo): seed today's challenge with demo
 * accounts, proofs, spots and votes to test the app with no real players, and
 * remove it all again.
 *
 *   php scripts/daily_demo.php status
 *   php scripts/daily_demo.php seed --photos=/path/to/folder --dry   # check, write nothing
 *   php scripts/daily_demo.php seed --photos=/path/to/folder         # upload the photos, seed
 *   php scripts/daily_demo.php seed --photo-urls=URL1,URL2,...       # already hosted photos (local testing)
 *   php scripts/daily_demo.php cleanup --dry                         # what would be deleted
 *   php scripts/daily_demo.php cleanup                               # delete everything demo
 *
 * The folder needs one JPEG/PNG/WebP per demo player (DailyDemo::PLAYERS),
 * taken in name order. Uploads strip all metadata. The cleanup also runs by
 * itself at the start of the next drop. Reads DATABASE_URL, R2_* etc. from the
 * environment or backend/api/.env.
 */

declare(strict_types=1);

$args    = array_slice($argv, 1);
$command = $args[0] ?? '';
$dry     = in_array('--dry', $args, true);
$opt     = static function (string $name) use ($args): ?string {
    foreach ($args as $a) {
        if (str_starts_with($a, "--{$name}=")) {
            return substr($a, strlen($name) + 3);
        }
    }
    return null;
};
if (!in_array($command, ['status', 'seed', 'cleanup'], true)) {
    fwrite(STDERR, "Usage: php scripts/daily_demo.php status | seed --photos=<folder> [--dry] | seed --photo-urls=<a,b,...> | cleanup [--dry]\n");
    exit(1);
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
    'Database', 'Cache', 'Request', 'CityRepository', 'R2Uploader', 'ImageProcessor', 'ModerationService', 'DbRateLimiter',
    'NotificationI18n', 'BotAccountService', 'NotificationPreferencesRepository', 'PushService', 'MobilePushService',
    'NotificationRepository', 'DailyClock', 'DailyRules', 'DailyProofRepository', 'DailyChallengeRepository',
    'DailyAdminService', 'DailyCards', 'DailyPushes', 'DailyDrop', 'DailyVotes', 'DailyResults', 'DailyPoints',
    'MonthlyRankService', 'DailyTwistProposals', 'DailyI18n', 'DailyPushText', 'DailyLeaderboard', 'DailyThemes', 'DailySpecials', 'DailyPresence', 'AnalyticsService', 'CityNames', 'Currencies', 'DailyCompare', 'DailyLocalPass', 'DailyProposals', 'DailyDemo', 'DailyNotify',
] as $class) {
    require_once __DIR__ . "/../src/{$class}.php";
}

$print = static fn(array $data) => print(json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n");
$host  = parse_url((string) getenv('DATABASE_URL'), PHP_URL_HOST) ?: '(no DATABASE_URL)';
fwrite(STDERR, "Database host: {$host}\n");

try {
    if ($command === 'status') {
        $print(DailyDemo::status());
        exit(0);
    }

    if ($command === 'cleanup') {
        $counts = DailyDemo::cleanup($dry);
        $print([($dry ? 'wouldDelete' : 'deleted') => $counts]);
        exit(0);
    }

    // seed
    $folder = $opt('photos');
    $urls   = $opt('photo-urls');
    if (($folder === null) === ($urls === null)) {
        throw new InvalidArgumentException('Give either --photos=<folder> or --photo-urls=<a,b,...>.');
    }
    $files = [];
    if ($folder !== null) {
        if (!is_dir($folder)) {
            throw new InvalidArgumentException("Not a folder: {$folder}");
        }
        $files = array_values(array_filter(glob(rtrim($folder, '/') . '/*') ?: [],
            static fn(string $f): bool => is_file($f) && preg_match('/\.(jpe?g|png|webp)$/i', $f) === 1));
        sort($files, SORT_NATURAL | SORT_FLAG_CASE);
        $files = array_slice($files, 0, count(DailyDemo::PLAYERS));
    }
    $urlList = $urls !== null ? array_values(array_filter(array_map('trim', explode(',', $urls)))) : [];

    [$challenge] = DailyDemo::prepare($folder !== null ? count($files) : count($urlList));
    $plan = [];
    foreach (array_values(DailyDemo::PLAYERS) as $i => $p) {
        $plan[] = [
            'account' => 'Demo · ' . $p['name'], 'city' => $p['city'], 'as' => $p['local'] ? 'local' : 'traveler',
            'spot' => $p['spot'], 'price' => $p['price'] !== null ? implode(' ', $p['price']) : null,
            'photo' => $folder !== null ? basename($files[$i]) : $urlList[$i],
        ];
    }
    fwrite(STDERR, "Today's challenge ({$challenge['challenge_date']}): " . (json_decode((string) $challenge['text_i18n'], true)['en'] ?? '') . "\n");
    if ($dry) {
        $print(['dryRun' => true, 'players' => $plan, 'votes' => count(DailyDemo::VOTES)]);
        exit(0);
    }

    if ($folder !== null) {
        foreach ($files as $f) {
            fwrite(STDERR, 'Uploading ' . basename($f) . "...\n");
            $urlList[] = DailyDemo::uploadPhoto($f);
        }
    }
    $print(DailyDemo::seed($urlList));
} catch (\Throwable $e) {
    fwrite(STDERR, 'Error: ' . $e->getMessage() . "\n");
    exit(1);
}
