<?php
/**
 * The GeoNames world city base (V5-01): cities5000 (every place of 5,000
 * inhabitants or more), their names in our 19 locales (alternateNamesV2) and
 * each country's currency (countryInfo). Data © GeoNames, CC BY 4.0
 * (https://www.geonames.org) - keep the credit where our sources are listed.
 *
 *   php scripts/geonames_import.php --build --dir=/tmp/geonames
 *       downloads the files into --dir when missing, writes geo_cities.csv,
 *       geo_city_names.csv and geo_countries.csv there; --names-min-pop=15000
 *       keeps only the English names of the smaller cities (saves space)
 *   php scripts/geonames_import.php --load --dir=/tmp/geonames
 *       replaces geo_cities, geo_city_names and geo_countries with those CSVs
 *       (one transaction) in DATABASE_URL - run migrate.php first
 *   php scripts/geonames_import.php --fixture --dir=/tmp/geonames
 *       writes tests/fixtures/geo_cities_near.json: the cities within 60 km of
 *       each case of tests/fixtures/placement_cases.json (CityPlacementTest)
 *
 * Reads DATABASE_URL from the environment or backend/api/.env (--load only).
 */

declare(strict_types=1);

ini_set('memory_limit', '2G'); // alternateNames: about a million names in memory while building

$args = array_slice($argv, 1);
$opt  = static function (string $name) use ($args): ?string {
    foreach ($args as $a) {
        if (str_starts_with($a, "--{$name}=")) return substr($a, strlen($name) + 3);
    }
    return null;
};
$dir = rtrim((string) ($opt('dir') ?? ''), '/');
if ($dir === '' || !(in_array('--build', $args, true) || in_array('--load', $args, true) || in_array('--fixture', $args, true))) {
    fwrite(STDERR, "usage: php scripts/geonames_import.php --build|--load|--fixture --dir=<folder>\n");
    exit(1);
}
@mkdir($dir, 0777, true);

const BASE = 'https://download.geonames.org/export/dump/';
const NULL_MARK = '__null__';

// Historical, abandoned, destroyed or religious places: never a city to play in.
const SKIP_FEATURES = ['PPLH', 'PPLQ', 'PPLW', 'PPLCH'];

// GeoNames language code → our locales (pt and zh cover two each when no
// regional name exists; a regional name, e.g. zh-TW, wins - see below).
const LOCALES = [
    'en' => ['en'], 'fr' => ['fr'], 'vi' => ['vi'], 'es' => ['es'], 'it' => ['it'],
    'pt' => ['pt-br', 'pt-pt'], 'pt-BR' => ['pt-br'], 'pt-PT' => ['pt-pt'],
    'de' => ['de'], 'nl' => ['nl'],
    'zh' => ['zh-hans'], 'zh-CN' => ['zh-hans'], 'zh-Hans' => ['zh-hans'], 'zh-TW' => ['zh-hant'], 'zh-Hant' => ['zh-hant'], 'zh-HK' => ['zh-hant'],
    'ja' => ['ja'], 'ko' => ['ko'], 'tl' => ['fil'], 'fil' => ['fil'], 'th' => ['th'], 'id' => ['id'],
    'hi' => ['hi'], 'ru' => ['ru'], 'ar' => ['ar'],
];

function fetchFile(string $dir, string $name): string
{
    $path = "{$dir}/{$name}";
    if (!file_exists($path)) {
        fwrite(STDERR, "downloading {$name}…\n");
        if (!copy(BASE . $name, $path)) throw new RuntimeException("could not download {$name}");
    }
    return $path;
}

function writeCsv(string $path, iterable $rows): int
{
    $f = fopen($path, 'w');
    $n = 0;
    foreach ($rows as $row) {
        fputcsv($f, $row, ',', '"', '');
        $n++;
    }
    fclose($f);
    return $n;
}

function readCsv(string $path): Generator
{
    $f = fopen($path, 'r');
    while (($row = fgetcsv($f, 0, ',', '"', '')) !== false) yield $row;
    fclose($f);
}

// ── --build ──────────────────────────────────────────────────────────────────

if (in_array('--build', $args, true)) {
    $zip = fetchFile($dir, 'cities5000.zip');
    $txt = "{$dir}/cities5000.txt";
    if (!file_exists($txt)) exec('unzip -oq ' . escapeshellarg($zip) . ' -d ' . escapeshellarg($dir));

    // cities5000: geonameid, name, asciiname, alternatenames, lat, lng, feature
    // class, feature code, country, cc2, admin1, admin2, admin3, admin4,
    // population, elevation, dem, timezone, modification date.
    $ids    = [];
    $cities = [];
    foreach (file($txt, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        $c = explode("\t", $line);
        if (in_array($c[7], SKIP_FEATURES, true) || $c[17] === '') continue;
        $ids[(int) $c[0]] = (int) $c[14];
        $cities[] = [(int) $c[0], $c[1], $c[2] !== '' ? $c[2] : $c[1], $c[8], $c[10], $c[11], (int) $c[14], $c[17], (float) $c[4], (float) $c[5], $c[7]];
    }
    $n = writeCsv("{$dir}/geo_cities.csv", $cities);
    fwrite(STDERR, "geo_cities.csv: {$n} cities\n");

    // countryInfo: ISO, ISO3, numeric, fips, name, capital, area, population,
    // continent, tld, currency code, …
    $countries = [];
    foreach (file(fetchFile($dir, 'countryInfo.txt'), FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        if ($line[0] === '#') continue;
        $c = explode("\t", $line);
        $countries[] = [$c[0], $c[4], $c[10] !== '' ? $c[10] : null];
    }
    $n = writeCsv("{$dir}/geo_countries.csv", $countries);
    fwrite(STDERR, "geo_countries.csv: {$n} countries\n");

    // alternateNamesV2: id, geonameid, language, name, isPreferred, isShort,
    // isColloquial, isHistoric, from, to. Only our cities and locales; never a
    // colloquial or historic name. A regional code (pt-BR, zh-TW) takes its
    // locale over the generic one (pt, zh) for the same city.
    $alt = fetchFile($dir, 'alternateNamesV2.zip');
    $in  = popen('unzip -p ' . escapeshellarg($alt) . ' alternateNamesV2.txt', 'r');
    $names    = [];   // "id|locale" => [[name, preferred, short, regional]]
    $minPop   = (int) ($opt('names-min-pop') ?? 0);
    while (($line = fgets($in)) !== false) {
        $c = explode("\t", rtrim($line, "\n"));
        if (count($c) < 8 || !isset(LOCALES[$c[2]]) || !isset($ids[(int) $c[1]])) continue;
        if ($c[6] === '1' || $c[7] === '1' || trim($c[3]) === '') continue;
        if ($c[2] !== 'en' && $ids[(int) $c[1]] < $minPop) continue;
        $regional = str_contains($c[2], '-');
        foreach (LOCALES[$c[2]] as $locale) {
            $names["{$c[1]}|{$locale}"][] = [trim($c[3]), $c[4] === '1', $c[5] === '1', $regional];
        }
    }
    pclose($in);
    $rows = (function () use ($names) {
        foreach ($names as $key => $list) {
            [$id, $locale] = explode('|', $key);
            // Regional names replace the generic ones when there are any.
            if (array_filter($list, fn($n) => $n[3])) $list = array_filter($list, fn($n) => $n[3]);
            $seen = [];
            foreach ($list as [$name, $preferred, $short]) {
                if (isset($seen[$name])) {
                    continue;
                }
                $seen[$name] = true;
                yield [(int) $id, $locale, $name, $preferred ? 't' : 'f', $short ? 't' : 'f'];
            }
        }
    })();
    $n = writeCsv("{$dir}/geo_city_names.csv", $rows);
    fwrite(STDERR, "geo_city_names.csv: {$n} names\n");
}

// ── --load ───────────────────────────────────────────────────────────────────

if (in_array('--load', $args, true)) {
    $envFile = __DIR__ . '/../.env';
    if (file_exists($envFile)) {
        foreach (file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
            if (preg_match('/^([A-Z0-9_]+)=(.*)$/', trim($line), $m) && getenv($m[1]) === false) {
                putenv($m[1] . '=' . trim($m[2], "\"' "));
            }
        }
    }
    require_once __DIR__ . '/../vendor/autoload.php';
    require_once __DIR__ . '/../src/Database.php';
    $host = parse_url((string) getenv('DATABASE_URL'), PHP_URL_HOST) ?: '(no DATABASE_URL)';
    fwrite(STDERR, "Database host: {$host}\n");

    $pdo = Database::pdo();
    $pdo->beginTransaction();
    $pdo->exec('TRUNCATE geo_city_names, geo_cities, geo_countries');
    $tables = [
        'geo_countries'  => ['country', 'name', 'currency'],
        'geo_cities'     => ['geoname_id', 'name', 'ascii_name', 'country', 'admin1', 'admin2', 'population', 'timezone', 'lat', 'lng', 'feature_code'],
        'geo_city_names' => ['geoname_id', 'locale', 'name', 'is_preferred', 'is_short'],
    ];
    foreach ($tables as $table => $cols) {
        $batch = [];
        $n     = 0;
        $flush = static function () use ($pdo, $table, $cols, &$batch) {
            if ($batch) $pdo->pgsqlCopyFromArray($table, $batch, "\t", NULL_MARK, implode(',', $cols));
            $batch = [];
        };
        foreach (readCsv("{$dir}/{$table}.csv") as $row) {
            // COPY text format: tabs, newlines and backslashes escaped, an
            // empty currency = NULL (its own marker: "N" is a real admin1 code).
            $batch[] = implode("\t", array_map(
                static fn($v) => $v === '' && $table === 'geo_countries' ? NULL_MARK : strtr((string) $v, ["\\" => '\\\\', "\t" => '\\t', "\n" => '\\n', "\r" => '\\r']),
                $row,
            ));
            if (++$n % 5000 === 0) $flush();
        }
        $flush();
        fwrite(STDERR, "{$table}: {$n} rows\n");
    }
    $pdo->commit();
}

// ── --fixture ────────────────────────────────────────────────────────────────

if (in_array('--fixture', $args, true)) {
    require_once __DIR__ . '/../src/CityPlacement.php';
    $cases = json_decode(file_get_contents(__DIR__ . '/../tests/fixtures/placement_cases.json'), true, 512, JSON_THROW_ON_ERROR);
    $near  = [];
    foreach (readCsv("{$dir}/geo_cities.csv") as $c) {
        foreach ($cases as $case) {
            if (CityPlacement::distanceKm($case['lat'], $case['lng'], (float) $c[8], (float) $c[9]) <= 60) {
                $near[(int) $c[0]] = [
                    'geoname_id' => (int) $c[0], 'name' => $c[1], 'country' => $c[3], 'admin1' => $c[4],
                    'population' => (int) $c[6], 'lat' => (float) $c[8], 'lng' => (float) $c[9],
                ];
                break;
            }
        }
    }
    ksort($near);
    file_put_contents(__DIR__ . '/../tests/fixtures/geo_cities_near.json', json_encode(array_values($near), JSON_UNESCAPED_UNICODE) . "\n");
    fwrite(STDERR, 'geo_cities_near.json: ' . count($near) . " cities\n");
}
