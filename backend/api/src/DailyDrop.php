<?php

declare(strict_types=1);

/**
 * The daily drop and the scheduler tick (SPEC 3.2).
 *
 * An external pinger (cron-job.org, AUDIT Q6) calls GET /internal/daily-tick
 * every 5 minutes. Each tick runs the drop of today's challenge date if it has
 * not completed yet, queues the top 10 pushes (V2-01), then sends the pushes
 * that are due. The drop time lives in
 * DailyClock (DAILY_DROP_UTC), not in the pinger: the first tick after 02:00
 * UTC runs it, and a late or repeated tick is harmless.
 *
 * Exactly once per date without advisory locks (the pooler runs in transaction
 * mode): daily_drop_runs has one row per date, claimed with INSERT ... ON
 * CONFLICT DO NOTHING; a crashed run is taken over after a timeout. Every step
 * is itself idempotent, so a takeover never doubles anything.
 *
 * Runs in a web request (mod_php): the drop only writes rows; push sending is
 * the tick's second half, in bounded batches.
 */
final class DailyDrop
{
    public const STALE_RUNNING_MINUTES = 20;
    public const RETRY_FAILED_MINUTES  = 5;
    public const MAX_ATTEMPTS          = 5;
    public const GAP_DAYS              = 3;

    /** One scheduler tick: the drop if due, then due pushes. Never throws. */
    public static function tick(?DateTimeImmutable $now = null): array
    {
        $now = $now ?? new DateTimeImmutable('now');
        $out = ['date' => DailyClock::currentDate($now), 'now' => $now->format(DATE_ATOM)];

        try {
            $out['drop'] = self::runDrop(DailyClock::currentDate($now), $now);
        } catch (\Throwable $e) {
            error_log('[daily-drop] tick drop failed: ' . $e->getMessage());
            $out['drop'] = ['status' => 'error', 'error' => $e->getMessage()];
        }
        try {
            $out['top10'] = DailyLeaderboard::queueTop10($now);
        } catch (\Throwable $e) {
            error_log('[daily-push] tick top10 failed: ' . $e->getMessage());
            $out['top10'] = ['status' => 'error', 'error' => $e->getMessage()];
        }
        // Daily reference exchange rates (SPEC 10.5): once a day, never blocks the tick.
        $out['rates'] = Currencies::refreshIfStale($now);
        try {
            $out['pushes'] = DailyPushes::sendDue($now);
        } catch (\Throwable $e) {
            error_log('[daily-push] tick send failed: ' . $e->getMessage());
            $out['pushes'] = ['status' => 'error', 'error' => $e->getMessage()];
        }
        return $out;
    }

    /** Run the drop of $date unless it already ran. */
    public static function runDrop(string $date, DateTimeImmutable $now): array
    {
        $claim = self::claim($date, $now);
        if ($claim !== 'claimed') {
            return ['status' => $claim];
        }

        $steps = [];
        try {
            $yesterday     = (new DateTimeImmutable($date, new DateTimeZone('UTC')))->modify('-1 day')->format('Y-m-d');
            // Demo content (DailyDemo) never outlives its day: removed before
            // results and points are computed. Never blocks the drop.
            try {
                $steps['demoCleanup'] = DailyDemo::cleanup();
            } catch (\Throwable $e) {
                $steps['demoCleanup'] = ['status' => 'failed', 'error' => $e->getMessage()];
                error_log("[daily-drop] demo cleanup failed: " . $e->getMessage());
            }
            // Never blocks today's publish: a failed close is logged, alerted
            // and re-run by hand (scripts/daily_close.php).
            try {
                $steps['close'] = self::closeChallenge($yesterday);
            } catch (\Throwable $e) {
                $steps['close'] = ['status' => 'failed', 'error' => $e->getMessage()];
                error_log("[daily-drop] close of {$yesterday} failed: " . $e->getMessage());
                self::alertAdmin('Daily Challenge: results failed',
                    "Results and points of {$yesterday} failed: " . $e->getMessage() . " - re-run scripts/daily_close.php --date={$yesterday}");
            }
            // Heavy voters of yesterday, flagged for review (never blocked).
            try {
                $closed = DailyChallengeRepository::findPublishedByDate($yesterday);
                $steps['voteFlags'] = $closed !== null ? DailyVotes::flagHeavyVoters((string) $closed['id']) : 0;
            } catch (\Throwable $e) {
                $steps['voteFlags'] = ['status' => 'failed', 'error' => $e->getMessage()];
            }

            // The Hilads Index (SPEC 10.9): Monday's drop builds last week's cards. Never blocks the drop.
            if ((new DateTimeImmutable($date, new DateTimeZone('UTC')))->format('N') === '1') {
                try {
                    $steps['index'] = DailyIndex::build(DailyIndex::lastWeek($date));
                } catch (\Throwable $e) {
                    $steps['index'] = ['status' => 'failed', 'error' => $e->getMessage()];
                    error_log("[daily-drop] index of the week before {$date} failed: " . $e->getMessage());
                }
            }

            [$challenge, $source, $publishNote] = self::publish($date);
            $steps['publish'] = ['source' => $source, 'challengeId' => $challenge['id'] ?? null] + $publishNote;
            Database::pdo()->prepare("
                UPDATE daily_drop_runs SET daily_challenge_id = ?, source = COALESCE(source, ?) WHERE challenge_date = ?
            ")->execute([$challenge['id'] ?? null, $source, $date]);

            if ($challenge !== null) {
                // Hand-written translations (prompt 15): a soft warning only, English always works.
                $translated = DailyI18n::translated(json_decode((string) $challenge['text_i18n'], true) ?: []);
                $steps['translations'] = count($translated);
                if ($translated === []) {
                    self::alertAdmin('Daily Challenge: not translated', "Today's challenge ({$date}) has no translations: everyone sees it in English.");
                }
                DailyRules::forgetLiveCities();
                $steps['cards']  = ['posted' => DailyCards::postChallenge($challenge), 'liveCities' => count(DailyRules::liveCityIds())];
                // The day's planned demo content (DailyDemo::plan), if any. Never blocks the drop.
                try {
                    $steps['demoSeed'] = DailyDemo::seedPlanned((string) $challenge['challenge_date']);
                } catch (\Throwable $e) {
                    $steps['demoSeed'] = ['status' => 'failed', 'error' => $e->getMessage()];
                    error_log("[daily-drop] demo seed failed: " . $e->getMessage());
                }
                $steps['pushes'] = DailyPushes::queueMorning($challenge, $now);
                $steps['reminders'] = DailyPushes::queueReminders((string) $challenge['challenge_date'], $now);
                $steps['twistDigests'] = DailyPushes::queueTwistDigests($challenge, $now);
                // V2-05: a proposed challenge pays its author when it goes live.
                if (!empty($challenge['proposed_by_user_id'])) {
                    $steps['proposalPoints'] = DailyPoints::awardProposal($challenge['proposed_by_user_id'], $challenge['id']);
                }
            }
            // V2-05: yesterday's author learns how many completed their challenge.
            try {
                $steps['proposalResult'] = DailyProposals::queueResult($yesterday, $now);
            } catch (\Throwable $e) {
                error_log("[daily-drop] proposal result of {$yesterday} failed: " . $e->getMessage());
            }
            if ($source === 'reserve') {
                self::alertAdmin('Daily Challenge: reserve used', "Nothing was scheduled for {$date}; a reserve challenge went live.");
            } elseif ($source === 'none') {
                self::alertAdmin('Daily Challenge: NOTHING went live', "No scheduled or reserve challenge for {$date}. Add one now.");
            }

            $gaps = DailyAdminService::gapsInNextDays(self::GAP_DAYS, $date);
            $steps['gaps'] = $gaps;
            if ($gaps !== []) {
                self::alertAdmin('Daily Challenge: days to plan', 'Nothing scheduled for ' . implode(', ', $gaps) . '.');
            }

            self::finish($date, 'done', $steps, null);
            error_log("[daily-drop] {$date} done " . json_encode($steps, JSON_UNESCAPED_UNICODE));
            return ['status' => 'done', 'steps' => $steps];
        } catch (\Throwable $e) {
            self::finish($date, 'failed', $steps, $e->getMessage());
            error_log("[daily-drop] {$date} FAILED: " . $e->getMessage() . ' steps=' . json_encode($steps));
            self::alertAdmin('Daily Challenge: drop failed', "The {$date} drop failed and will be retried: " . $e->getMessage());
            return ['status' => 'failed', 'error' => $e->getMessage(), 'steps' => $steps];
        }
    }

    /**
     * Closing step for the challenge that just ended: results (World top 3,
     * city ranks, best of each live city), then the close points. Both are
     * idempotent, so a rerun or a takeover changes nothing. Runs before the
     * publish step, so the new World card carries yesterday's top 3.
     */
    public static function closeChallenge(string $date): array
    {
        $challenge = DailyChallengeRepository::findPublishedByDate($date);
        if ($challenge === null) {
            return ['status' => 'no_challenge'];
        }
        $plan   = DailyResults::compute($challenge['id']);
        $points = DailyPoints::awardClose($challenge['id'], $plan);
        // Yesterday around the world (SPEC 10.7), after the results (the podium leads it). Never fails the close.
        try {
            $tour = DailyTour::build($challenge);
        } catch (\Throwable $e) {
            $tour = 'failed: ' . $e->getMessage();
            error_log("[daily-drop] world tour of {$date} failed: " . $e->getMessage());
        }
        return ['status' => 'closed', 'results' => $plan['counts'], 'points' => $points, 'tourCities' => $tour];
    }

    /**
     * Claim $date: 'claimed' (this call runs the drop), 'already_done',
     * 'in_progress' (another run is live), or 'gave_up' (too many attempts).
     */
    private static function claim(string $date, DateTimeImmutable $now): string
    {
        $pdo   = Database::pdo();
        $nowTs = $now->format('Y-m-d H:i:sP');

        $stmt = $pdo->prepare("
            INSERT INTO daily_drop_runs (challenge_date, status, started_at) VALUES (?, 'running', ?)
            ON CONFLICT (challenge_date) DO NOTHING
            RETURNING challenge_date
        ");
        $stmt->execute([$date, $nowTs]);
        if ($stmt->fetchColumn() !== false) {
            return 'claimed';
        }

        $stmt = $pdo->prepare("SELECT status, attempts FROM daily_drop_runs WHERE challenge_date = ?");
        $stmt->execute([$date]);
        $run = $stmt->fetch(PDO::FETCH_ASSOC);
        if ($run['status'] === 'done') {
            return 'already_done';
        }
        if ((int) $run['attempts'] >= self::MAX_ATTEMPTS) {
            return 'gave_up';
        }

        // Take over a crashed run, or retry a failed one, after a pause. The
        // WHERE makes the takeover atomic: only one concurrent tick wins.
        $stmt = $pdo->prepare("
            UPDATE daily_drop_runs
            SET status = 'running', started_at = ?, attempts = attempts + 1, error = NULL
            WHERE challenge_date = ?
              AND ((status = 'running' AND started_at < ?::timestamptz - make_interval(mins => ?))
                OR (status = 'failed'  AND started_at < ?::timestamptz - make_interval(mins => ?)))
            RETURNING challenge_date
        ");
        $stmt->execute([$nowTs, $date, $nowTs, self::STALE_RUNNING_MINUTES, $nowTs, self::RETRY_FAILED_MINUTES]);
        return $stmt->fetchColumn() !== false ? 'claimed' : 'in_progress';
    }

    /**
     * Make sure $date has a published challenge: keep it if already published,
     * else publish the scheduled one, else the oldest unused reserve. Returns
     * [challengeRow|null, source, notes].
     */
    private static function publish(string $date): array
    {
        $pdo   = Database::pdo();
        $notes = [];
        $find  = $pdo->prepare("SELECT * FROM daily_challenges WHERE challenge_date = ?");
        $find->execute([$date]);
        $row = $find->fetch(PDO::FETCH_ASSOC);

        if ($row && $row['status'] === 'published') {
            $source = DailyProofRepository::bool($row['is_reserve']) ? 'reserve' : 'scheduled';
            return [$row, $source, ['alreadyPublished' => true]];
        }
        if ($row && $row['status'] === 'scheduled') {
            $pdo->prepare("UPDATE daily_challenges SET status = 'published', published_at = now(), updated_at = now(),
                                                       theme = COALESCE(theme, ?) WHERE id = ?")
                ->execute([DailyThemes::forDate($date), $row['id']]);
            $find->execute([$date]);
            return [$find->fetch(PDO::FETCH_ASSOC), 'scheduled', []];
        }
        if ($row) {
            // An unfinished draft sits on the date: move it off so the reserve can take the day.
            $pdo->prepare("UPDATE daily_challenges SET challenge_date = NULL, updated_at = now() WHERE id = ?")
                ->execute([$row['id']]);
            $notes['draftMovedOff'] = $row['id'];
        }

        $stmt = $pdo->prepare("
            UPDATE daily_challenges
            SET challenge_date = ?, status = 'published', published_at = now(), updated_at = now(), updated_by = 'drop',
                theme = COALESCE(theme, ?)
            WHERE id = (
                SELECT id FROM daily_challenges
                WHERE is_reserve AND challenge_date IS NULL AND status = 'scheduled'
                ORDER BY created_at
                LIMIT 1
                FOR UPDATE SKIP LOCKED
            )
            RETURNING *
        ");
        $stmt->execute([$date, DailyThemes::forDate($date)]);
        $reserve = $stmt->fetch(PDO::FETCH_ASSOC);
        return $reserve ? [$reserve, 'reserve', $notes] : [null, 'none', $notes];
    }

    private static function finish(string $date, string $status, array $steps, ?string $error): void
    {
        Database::pdo()->prepare("
            UPDATE daily_drop_runs SET status = ?, steps = ?::jsonb, error = ?, finished_at = now()
            WHERE challenge_date = ?
        ")->execute([$status, json_encode($steps, JSON_UNESCAPED_UNICODE), $error, $date]);
    }

    /** Push + bell to ADMIN_TEST_USER_ID (there are no admin accounts). Best effort, always logged. */
    private static function alertAdmin(string $title, string $body): void
    {
        error_log("[daily-drop] ADMIN ALERT: {$title} - {$body}");
        $adminId = trim((string) getenv('ADMIN_TEST_USER_ID'));
        if ($adminId === '') {
            return;
        }
        try {
            NotificationRepository::createUnchecked($adminId, 'daily_admin', $title, $body, [], 'en');
        } catch (\Throwable $e) {
            error_log('[daily-drop] admin alert failed: ' . $e->getMessage());
        }
    }
}
