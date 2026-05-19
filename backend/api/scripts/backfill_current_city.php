<?php
/**
 * Backfill users.current_city_id from existing data. Safe to re-run.
 *
 *   php scripts/backfill_current_city.php
 *
 * Strategy:
 *   1. For each user with no current_city_id, pick the city channel with the
 *      most recent last_seen_at in user_city_memberships. Set current_city_id,
 *      current_city_set_at, current_city_last_confirmed_at to that timestamp.
 *   2. Fallback: for remaining users, match users.home_city text (case- and
 *      whitespace-insensitive) to channels.name where type='city'. Set
 *      current_city_id only; leave timestamps NULL so notifications are
 *      gated until the user actually opens the app and resolves location.
 *
 * Idempotent: every UPDATE filters on `current_city_id IS NULL`, so re-runs
 * after partial completion or new signups are safe.
 */

declare(strict_types=1);

$envFile = __DIR__ . '/../.env';
if (file_exists($envFile)) {
    $vars = @parse_ini_file($envFile);
    if (is_array($vars)) {
        foreach ($vars as $key => $value) {
            putenv("$key=$value");
        }
    }
}

$url = getenv('DATABASE_URL');
if (!$url) {
    fwrite(STDERR, "ERROR: DATABASE_URL is not set\n");
    exit(1);
}

$parts   = parse_url($url);
$sslmode = getenv('PG_SSLMODE') ?: 'require';
$dsn     = sprintf(
    'pgsql:host=%s;port=%s;dbname=%s;sslmode=%s',
    $parts['host'],
    $parts['port'] ?? 5432,
    ltrim($parts['path'], '/'),
    $sslmode,
);

$user = isset($parts['user']) ? urldecode($parts['user']) : null;
$pass = isset($parts['pass']) ? urldecode($parts['pass']) : null;

try {
    $pdo = new PDO($dsn, $user, $pass, [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
} catch (PDOException $e) {
    fwrite(STDERR, "ERROR: DB connection failed: " . $e->getMessage() . "\n");
    exit(1);
}

function scalar(PDO $pdo, string $sql): int
{
    return (int) $pdo->query($sql)->fetchColumn();
}

echo "\nBackfilling users.current_city_id...\n\n";

// ── Baseline ──────────────────────────────────────────────────────────────────

$totalUsers      = scalar($pdo, "SELECT count(*) FROM users WHERE deleted_at IS NULL");
$populatedBefore = scalar($pdo, "SELECT count(*) FROM users WHERE current_city_id IS NOT NULL");

echo "  Active users:       $totalUsers\n";
echo "  Already populated:  $populatedBefore\n\n";

// ── Phase 1: from user_city_memberships (most recent city per user) ──────────

$sqlMemberships = "
    WITH latest AS (
        SELECT DISTINCT ON (m.user_id)
               m.user_id,
               m.channel_id,
               m.last_seen_at
          FROM user_city_memberships m
          JOIN channels c ON c.id = m.channel_id AND c.type = 'city'
         ORDER BY m.user_id, m.last_seen_at DESC
    )
    UPDATE users u
       SET current_city_id                = l.channel_id,
           current_city_set_at            = l.last_seen_at,
           current_city_last_confirmed_at = l.last_seen_at
      FROM latest l
     WHERE u.id = l.user_id
       AND u.current_city_id IS NULL
       AND u.deleted_at IS NULL
";
$pdo->exec($sqlMemberships);

$afterMemberships = scalar($pdo, "SELECT count(*) FROM users WHERE current_city_id IS NOT NULL");
echo "  From user_city_memberships:  " . ($afterMemberships - $populatedBefore) . " users\n";

// ── Phase 2: fallback by home_city text match ─────────────────────────────────

$sqlHomeCity = "
    UPDATE users u
       SET current_city_id = c.id
      FROM channels c
     WHERE c.type = 'city'
       AND LOWER(TRIM(c.name)) = LOWER(TRIM(u.home_city))
       AND u.current_city_id IS NULL
       AND u.deleted_at IS NULL
       AND u.home_city IS NOT NULL
       AND TRIM(u.home_city) <> ''
";
$pdo->exec($sqlHomeCity);

$afterHomeCity = scalar($pdo, "SELECT count(*) FROM users WHERE current_city_id IS NOT NULL");
echo "  From home_city fallback:     " . ($afterHomeCity - $afterMemberships) . " users (timestamps left NULL)\n\n";

// ── Final tally ──────────────────────────────────────────────────────────────

$populatedAfter = $afterHomeCity;
$stillNull      = $totalUsers - $populatedAfter;

echo "  Populated total:    $populatedAfter / $totalUsers";
if ($totalUsers > 0) {
    $pct = round(100 * $populatedAfter / $totalUsers, 1);
    echo "  ({$pct}%)";
}
echo "\n";
echo "  Still NULL:         $stillNull (no memberships, no matching home_city)\n\n";

// Per-city breakdown so we can sanity-check rollout impact
echo "  Top cities by current member count:\n";
$breakdown = $pdo->query("
    SELECT c.name, c.id, count(*) AS members
      FROM users u
      JOIN channels c ON c.id = u.current_city_id
     WHERE u.deleted_at IS NULL
     GROUP BY c.id, c.name
     ORDER BY members DESC
     LIMIT 10
");
foreach ($breakdown as $row) {
    echo sprintf("    %-30s %s  (%d)\n", $row['name'], $row['id'], $row['members']);
}

echo "\nDone.\n";
