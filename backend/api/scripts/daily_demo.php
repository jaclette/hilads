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
 *   php scripts/daily_demo.php plan --file=week.json --photos=<folder> --dry   # check a week ahead
 *   php scripts/daily_demo.php plan --file=week.json --photos=<folder>         # upload and store it
 *
 * A plan (week.json): {"days": [{"date": "2026-10-19", "players": {"linh":
 * {"caption", "answer", "price": [45000, "VND"] | null, "spot" | null, "lat",
 * "lng"}, ...}}]}; photos in <folder>/<date>/<player>.jpg (png, webp). Each
 * drop seeds its day; today's is seeded at once when nothing demo is there.
 * Photos already uploaded: each player carries its "photoUrl" and --photos is
 * not needed; --file can then be an https URL (the Render shell):
 *   php scripts/daily_demo.php plan --file=https://.../demo-week.json
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
if (!in_array($command, ['status', 'seed', 'cleanup', 'plan'], true)) {
    fwrite(STDERR, "Usage: php scripts/daily_demo.php status | seed --photos=<folder> [--dry] | seed --photo-urls=<a,b,...> | cleanup [--dry] | plan --file=<week.json> --photos=<folder> [--dry]\n");
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
    'MonthlyRankService', 'DailyTwistProposals', 'DailyI18n', 'DailyPushText', 'DailyLeaderboard', 'DailyThemes', 'DailySpecials', 'DailyPresence', 'AnalyticsService', 'CityNames', 'Currencies', 'DailyCompare', 'DailyBoard', 'DailyTour', 'DailyIndex', 'DailyLocalPass', 'DailyProposals', 'DailyDemo', 'DailyNotify',
] as $class) {
    require_once __DIR__ . "/../src/{$class}.php";
}

$print = static fn(array $data) => print(json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n");
$host  = parse_url((string) getenv('DATABASE_URL'), PHP_URL_HOST) ?: '(no DATABASE_URL)';
fwrite(STDERR, "Database host: {$host}\n");

try {
    if ($command === 'status') {
        $print(DailyDemo::status() + ['plannedDays' => DailyDemo::plannedDays()]);
        exit(0);
    }

    if ($command === 'plan') {
        $file   = $opt('file');
        $folder = $opt('photos');
        $remote = $file !== null && preg_match('#^https://#', $file) === 1;
        if ($file === null || (!$remote && !is_file($file))) {
            throw new InvalidArgumentException('Give --file=<week.json> (or an https URL) and, unless it has photoUrls, --photos=<folder> (<folder>/<date>/<player>.jpg).');
        }
        $days = DailyDemo::cleanPlan((json_decode((string) file_get_contents($file), true) ?: [])['days'] ?? []);
        // Photos already uploaded: store as is.
        $hosted = array_reduce($days, static fn(bool $ok, array $players): bool =>
            $ok && array_reduce($players, static fn(bool $o, array $p): bool => $o && is_string($p['photoUrl'] ?? null) && str_starts_with($p['photoUrl'], 'https://'), true), true);
        if ($hosted) {
            if ($dry) {
                $print(['dryRun' => true, 'days' => array_map(static fn(array $p): array => array_keys($p), $days)]);
                exit(0);
            }
            foreach ($days as $date => $players) {
                DailyDemo::storeDay($date, $players, array_map(static fn(array $p): string => $p['photoUrl'], $players));
            }
            $print(['stored' => array_keys($days), 'today' => DailyDemo::seedPlanned(DailyClock::currentDate())]);
            exit(0);
        }
        if ($folder === null || !is_dir($folder)) {
            throw new InvalidArgumentException('Give --photos=<folder> (<folder>/<date>/<player>.jpg), or photoUrls in the plan.');
        }
        $photo = static function (string $date, string $key) use ($folder): string {
            foreach (['jpg', 'jpeg', 'png', 'webp', 'JPG', 'JPEG', 'PNG'] as $ext) {
                if (is_file($f = rtrim($folder, '/') . "/{$date}/{$key}.{$ext}")) {
                    return $f;
                }
            }
            throw new InvalidArgumentException("Missing photo {$folder}/{$date}/{$key}.jpg");
        };
        $report = [];
        foreach ($days as $date => $players) {
            $files = [];
            foreach (array_keys($players) as $key) {
                $files[$key] = $photo($date, (string) $key);
            }
            $report[$date] = array_map('basename', $files);
        }
        if ($dry) {
            $print(['dryRun' => true, 'days' => $report]);
            exit(0);
        }
        foreach ($days as $date => $players) {
            $urls = [];
            foreach (array_keys($players) as $key) {
                fwrite(STDERR, "Uploading {$date}/{$key}...\n");
                $urls[$key] = DailyDemo::uploadPhoto($photo($date, (string) $key));
            }
            DailyDemo::storeDay($date, $players, $urls);
        }
        // Today's day goes live at once; the next ones at their drop.
        $print(['stored' => array_keys($days), 'today' => DailyDemo::seedPlanned(DailyClock::currentDate())]);
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
