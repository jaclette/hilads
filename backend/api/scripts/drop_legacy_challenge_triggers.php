<?php
/**
 * Phase 5 (database, step 1): drop the legacy 1-to-1 challenge triggers that can no longer fire.
 *
 *   php scripts/drop_legacy_challenge_triggers.php --dry   # list what exists, change nothing
 *   php scripts/drop_legacy_challenge_triggers.php         # drop them (one transaction)
 *
 * DORMANT on purpose: NOT wired into migrate.php or the auto-migration endpoint. Run it by hand
 * when you decide to. migrate.php no longer creates these objects (2026-11-16), so they don't come
 * back on the next deploy.
 *
 * WHAT IT DROPS (nothing writes the data that fires them since the legacy flow was removed):
 *   - trigger trg_chacc_date_locked ON challenge_acceptances + function on_challenge_date_approved()
 *     (fired when the creator approved a proposed date: nothing sets date_approved_at any more)
 *   - trigger trg_chrate_mutual_complete ON challenge_ratings + function on_challenge_rating_insert()
 *     (fired on a meet-up rating: nothing inserts into challenge_ratings any more)
 * Dropping a trigger/function deletes no row. Reversible by re-creating them from git history
 * (migrate.php before 2026-11-16).
 *
 * WHAT IT LEAVES (still read by live code; dropping them needs code changes first, see
 * docs/ux-audit/report.md §8 "Database: what's left"):
 *   - challenge_ratings + view visible_ratings (ChallengeRepository's showcase query reads visible_ratings)
 *   - challenge_acceptances.{proposed_starts_at, proposed_ends_at, proposed_venue, proposed_by_user_id,
 *     date_approved_at, approved_at, rejected_at, thread_channel_id} (the shared acceptance SELECT used
 *     by the group flow, and the API payloads)
 *   - channel_challenges.max_participants (ChallengeRepository / ChallengeAcceptanceRepository)
 *   - challenge_privacy_requests (the privacy vote routes are still live)
 *   - on_challenge_acceptance_score / trg_chacc_accepted_score and on_challenge_proof_verdict /
 *     trg_chacc_intl_debrief (not proven dead for the group flow)
 *
 * Idempotent: IF EXISTS everywhere.
 */

declare(strict_types=1);

$dryRun = in_array('--dry', $argv, true);

// ── .env + PDO (same pattern as migrate.php) ─────────────────────────────────────────

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

// ── What exists today ────────────────────────────────────────────────────────────────

$TRIGGERS = [
    ['trg_chacc_date_locked',      'challenge_acceptances', 'on_challenge_date_approved'],
    ['trg_chrate_mutual_complete', 'challenge_ratings',     'on_challenge_rating_insert'],
];

foreach ($TRIGGERS as [$trigger, $table, $fn]) {
    $t = $pdo->prepare("SELECT 1 FROM pg_trigger WHERE tgname = :n AND NOT tgisinternal");
    $t->execute([':n' => $trigger]);
    $f = $pdo->prepare("SELECT 1 FROM pg_proc WHERE proname = :n");
    $f->execute([':n' => $fn]);
    printf("%-28s on %-22s %s | function %-28s %s\n", $trigger, $table, $t->fetchColumn() ? 'exists' : 'absent',
        $fn . '()', $f->fetchColumn() ? 'exists' : 'absent');
}

if ($dryRun) {
    echo "\n--dry: nothing changed.\n";
    exit(0);
}

// ── Drop ─────────────────────────────────────────────────────────────────────────────

$pdo->beginTransaction();
try {
    foreach ($TRIGGERS as [$trigger, $table, $fn]) {
        $pdo->exec("DROP TRIGGER IF EXISTS {$trigger} ON {$table}");
        $pdo->exec("DROP FUNCTION IF EXISTS {$fn}()");
        echo "dropped {$trigger} and {$fn}()\n";
    }
    $pdo->commit();
} catch (Throwable $e) {
    $pdo->rollBack();
    fwrite(STDERR, "ERROR, rolled back: " . $e->getMessage() . "\n");
    exit(1);
}
echo "done.\n";
