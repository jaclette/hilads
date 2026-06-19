<?php
/**
 * Phase 5 (step 1) - force-migrate SAFE legacy challenges to the group model.
 *
 *   php scripts/migrate_open_legacy_challenges_to_group.php --dry   # plan only
 *   php scripts/migrate_open_legacy_challenges_to_group.php         # apply
 *
 * ⚠️  DO NOT RUN until the GROUP build is released to the app stores AND is the
 *     minimum supported version. Current live clients are legacy-only and CANNOT
 *     render a challenge_format='group' row - migrating before they update would
 *     break their challenge screens. This script is committed dormant on purpose:
 *     it is NOT wired into migrate.php / the auto-migration endpoint.
 *
 * WHAT IT TOUCHES (deliberately the safe subset only):
 *   - challenge_format='legacy' (or NULL) rows
 *   - status='open'  (never accepted / no in-flight pipeline state)
 *   - with ZERO non-rejected acceptances
 * These have no accept→date→rate / proof state to corrupt, so flipping them to
 * 'group' is loss-less. They simply gain the join (+2) / validate / pick-winner
 * surface. meet_at / venue are left NULL - the challenger can set a date+place
 * (meet) via the edit screen; a photo-proof group with a NULL deadline still
 * works (no auto-close until a deadline is set).
 *
 * WHAT IT LEAVES ALONE (drains naturally as the legacy model completes):
 *   - any legacy row WITH an acceptance (pending/accepted/scheduled/approved/…)
 *   - already-group rows
 *   - validated / archived rows
 *
 * Idempotent: re-runs only touch rows still matching the safe filter.
 */

declare(strict_types=1);

$dryRun = in_array('--dry', $argv, true);

// ── .env + PDO (same pattern as migrate.php / backfill_venue_geo.php) ─────────

$envFile = __DIR__ . '/../.env';
if (file_exists($envFile)) {
    $vars = @parse_ini_file($envFile);
    if (is_array($vars)) {
        foreach ($vars as $key => $value) putenv("$key=$value");
    }
}

$url = getenv('DATABASE_URL');
if (!$url) { fwrite(STDERR, "ERROR: DATABASE_URL is not set\n"); exit(1); }

$parts   = parse_url($url);
$sslmode = getenv('PG_SSLMODE') ?: 'require';
$dsn     = sprintf('pgsql:host=%s;port=%s;dbname=%s;sslmode=%s',
    $parts['host'], $parts['port'] ?? 5432, ltrim($parts['path'], '/'), $sslmode);

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

// ── Identify the safe subset ─────────────────────────────────────────────────
// open, legacy/NULL format, and no non-rejected acceptance.

$SAFE_FILTER = "
      cc.status = 'open'
  AND COALESCE(cc.challenge_format, 'legacy') = 'legacy'
  AND NOT EXISTS (
        SELECT 1 FROM challenge_acceptances ca
        WHERE ca.challenge_id = cc.channel_id
          AND ca.phase <> 'rejected'
      )
";

$rows = $pdo->query("
    SELECT cc.channel_id, cc.title, cc.mode, cc.validation_method
      FROM channel_challenges cc
     WHERE $SAFE_FILTER
     ORDER BY cc.created_at
")->fetchAll();

$total = count($rows);
echo ($dryRun ? "[DRY RUN] " : "") . "Safe open legacy challenges to migrate: $total\n";
foreach ($rows as $r) {
    $kind = ($r['mode'] === 'international' || $r['validation_method'] === 'photo_proof') ? 'photo' : 'meet';
    echo sprintf("  - %s  [%s/%s → group %s]  %s\n",
        $r['channel_id'], $r['mode'], $r['validation_method'] ?? 'meet', $kind, $r['title']);
}

if ($total === 0) { echo "Nothing to do.\n"; exit(0); }
if ($dryRun)      { echo "\nDry run - no changes written. Drop --dry to apply.\n"; exit(0); }

// ── Apply (single bounded UPDATE over the same filter) ───────────────────────

$stmt = $pdo->prepare("
    UPDATE channel_challenges cc
       SET challenge_format = 'group', updated_at = now()
     WHERE $SAFE_FILTER
");
$stmt->execute();
echo "\nMigrated " . $stmt->rowCount() . " challenge(s) to challenge_format='group'.\n";
echo "meet_at / venue left NULL - challengers can set a date+place via edit.\n";
