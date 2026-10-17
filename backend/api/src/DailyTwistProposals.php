<?php

declare(strict_types=1);

/**
 * Local Twists proposed by locals (SPEC 3.3, phase 3).
 *
 * From the drop of D-1 until 12h before the drop of D (09:00-21:00 Saigon with
 * the default drop), a local of a live city can read the challenge scheduled
 * for D and propose a Local Twist for their city: one proposal per local per
 * day, editable or withdrawn until picked or closed.
 *
 * A proposal is a daily_twists row with proposed_at set, status 'proposed' and
 * moderation 'pending' (it passed the text filter). The founder picks one in
 * the back office before the drop of D: it becomes the selected twist with its
 * author credited (points at the close: DailyPoints, kind daily_twist), and
 * the previously selected twist goes back to 'proposed' so it can be restored.
 * Without a pick, the founder's twist stays.
 *
 * "Local" is the proof rule (DailyRules::isLocalFor) on the user's current city.
 */
final class DailyTwistProposals
{
    public const CLOSE_BEFORE_DROP = 12 * 3600;
    public const ALERT_EVERY       = 1800;   // seconds between "proposals waiting" pushes to the admin

    // ── Pure helpers (unit-tested) ────────────────────────────────────────────

    /** The challenge date proposals are for at $now: tomorrow's (D = active date + 1). */
    public static function targetDate(?DateTimeImmutable $now = null): string
    {
        $active = DailyClock::currentDate($now);
        return (new DateTimeImmutable($active, new DateTimeZone('UTC')))->modify('+1 day')->format('Y-m-d');
    }

    /** [opensAt, closesAt] for proposals on $date: the drop of D-1, and 12h before the drop of D. */
    public static function window(string $date): array
    {
        $drop = DailyClock::dropAt($date);
        return [$drop->modify('-1 day'), $drop->modify('-' . self::CLOSE_BEFORE_DROP . ' seconds')];
    }

    public static function isOpen(string $date, DateTimeImmutable $now): bool
    {
        [$opens, $closes] = self::window($date);
        return $now >= $opens && $now < $closes;
    }

    /**
     * Why a user cannot propose (null = they can, window permitting):
     * no_city, city_not_live, not_local, no_challenge.
     */
    public static function ineligibility(?string $mode, ?string $homeCity, ?string $cityName,
                                         bool $cityIsLive, bool $hasChallenge): ?string
    {
        if ($cityName === null) {
            return 'no_city';
        }
        if (!$cityIsLive) {
            return 'city_not_live';
        }
        if (!DailyRules::isLocalFor($mode, $homeCity, $cityName)) {
            return 'not_local';
        }
        return $hasChallenge ? null : 'no_challenge';
    }

    /** What the proposer sees: pending, picked or not_picked. */
    public static function statusOf(array $row): string
    {
        return match ($row['status']) {
            'selected' => 'picked',
            'rejected' => 'not_picked',
            default    => DailyClock::dropAt((string) $row['challenge_date']) <= new DateTimeImmutable('now') ? 'not_picked' : 'pending',
        };
    }

    /** Trimmed text with inner whitespace collapsed, or null when empty / too long. */
    public static function cleanText(mixed $text): ?string
    {
        $s = is_string($text) ? trim((string) preg_replace('/\s+/u', ' ', $text)) : '';
        return $s === '' || mb_strlen($s) > DailyAdminService::TWIST_MAX ? null : $s;
    }

    // ── For the app ──────────────────────────────────────────────────────────

    /**
     * The proposal screen for a user: tomorrow's date and window, their city,
     * whether they can propose (or why not), tomorrow's challenge (only for
     * locals of a live city) and their proposal.
     */
    public static function forViewer(array $user, ?DateTimeImmutable $now = null): array
    {
        $now  = $now ?? new DateTimeImmutable('now');
        $date = self::targetDate($now);
        [$opens, $closes] = self::window($date);
        $ctx  = self::context($user, $date);

        $proposal = $ctx['challenge'] !== null ? self::findMine($ctx['challenge']['id'], $user['id']) : null;
        $reason   = $ctx['reason'];
        $showChallenge = $reason === null;
        return [
            'date'      => $date,
            'opensAt'   => $opens->getTimestamp(),
            'closesAt'  => $closes->getTimestamp(),
            'open'      => $reason === null && self::isOpen($date, $now),
            'city'      => $ctx['city'],
            'reason'    => $reason ?? (self::isOpen($date, $now) ? null : 'closed'),
            'challenge' => $showChallenge ? self::challengeText($ctx['challenge']) : null,
            'proposal'  => $proposal !== null ? self::format($proposal) : null,
            'maxLength' => DailyAdminService::TWIST_MAX,
        ];
    }

    /** Compact version for /daily/today: null unless the user is a local of a live city with a challenge tomorrow. */
    public static function summaryFor(array $user, ?DateTimeImmutable $now = null): ?array
    {
        $now  = $now ?? new DateTimeImmutable('now');
        $date = self::targetDate($now);
        $ctx  = self::context($user, $date);
        if ($ctx['reason'] !== null) {
            return null;
        }
        $mine = self::findMine($ctx['challenge']['id'], $user['id']);
        return [
            'date'     => $date,
            'open'     => self::isOpen($date, $now),
            'closesAt' => self::window($date)[1]->getTimestamp(),
            'status'   => $mine !== null ? self::statusOf($mine) : null,
        ];
    }

    /** Propose a twist. Throws InvalidArgumentException with a code. Returns the formatted proposal. */
    public static function propose(array $user, mixed $text, ?DateTimeImmutable $now = null): array
    {
        $now  = $now ?? new DateTimeImmutable('now');
        $date = self::targetDate($now);
        $ctx  = self::guardWrite($user, $date, $now);
        $text = self::guardText($text);

        $stmt = Database::pdo()->prepare("
            INSERT INTO daily_twists (id, challenge_id, city_id, text, author_user_id, status, moderation_status,
                                      created_by, proposed_at)
            VALUES (?, ?, ?, ?, ?, 'proposed', 'pending', 'local', now())
            ON CONFLICT (challenge_id, author_user_id) WHERE proposed_at IS NOT NULL DO NOTHING
            RETURNING id
        ");
        $stmt->execute([bin2hex(random_bytes(8)), $ctx['challenge']['id'], $ctx['cityId'], $text, $user['id']]);
        if ($stmt->fetchColumn() === false) {
            throw new InvalidArgumentException('already_proposed');
        }
        self::alertAdmin($date);
        return self::format(self::findMine($ctx['challenge']['id'], $user['id']));
    }

    /** Edit my proposal while the window is open and it was not picked. */
    public static function edit(array $user, mixed $text, ?DateTimeImmutable $now = null): array
    {
        $now  = $now ?? new DateTimeImmutable('now');
        $ctx  = self::guardWrite($user, self::targetDate($now), $now);
        $mine = self::mustFindEditable($ctx['challenge']['id'], $user['id']);
        $text = self::guardText($text);
        Database::pdo()->prepare("UPDATE daily_twists SET text = ?, updated_at = now() WHERE id = ?")
            ->execute([$text, $mine['id']]);
        return self::format(self::findMine($ctx['challenge']['id'], $user['id']));
    }

    /** Withdraw my proposal while the window is open and it was not picked. */
    public static function withdraw(array $user, ?DateTimeImmutable $now = null): void
    {
        $now  = $now ?? new DateTimeImmutable('now');
        $ctx  = self::guardWrite($user, self::targetDate($now), $now);
        $mine = self::mustFindEditable($ctx['challenge']['id'], $user['id']);
        Database::pdo()->prepare("DELETE FROM daily_twists WHERE id = ?")->execute([$mine['id']]);
    }

    // ── Back office ──────────────────────────────────────────────────────────

    /**
     * Every twist of a challenge for the editor, keyed by city id: the selected
     * one, proposals (newest first) and the founder's earlier twists.
     */
    public static function listForChallenge(string $challengeId): array
    {
        $stmt = Database::pdo()->prepare("
            SELECT t.*, u.username, u.display_name
            FROM daily_twists t
            LEFT JOIN users u ON u.id = t.author_user_id
            WHERE t.challenge_id = ?
            ORDER BY (t.status = 'selected') DESC, (t.status = 'rejected'), t.proposed_at DESC NULLS LAST, t.created_at DESC
        ");
        $stmt->execute([$challengeId]);
        $out = [];
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $out[$r['city_id']][] = $r;
        }
        return $out;
    }

    /** Proposal counts per challenge date (calendar badges). */
    /** Locals' proposals still waiting for a pick, on challenges not live yet (Proposals inbox, V2-05). */
    public static function listPending(int $limit = 100): array
    {
        $stmt = Database::pdo()->prepare("
            SELECT t.id, t.text, t.proposed_at, t.city_id, ch.name AS city_name, u.username, u.display_name,
                   dc.id AS challenge_id, dc.challenge_date::text AS challenge_date, dc.text_i18n
            FROM daily_twists t
            JOIN daily_challenges dc ON dc.id = t.challenge_id
            LEFT JOIN channels ch    ON ch.id = t.city_id
            LEFT JOIN users u        ON u.id = t.author_user_id
            WHERE t.proposed_at IS NOT NULL AND t.status = 'proposed' AND dc.challenge_date > ?
            ORDER BY dc.challenge_date, t.proposed_at
            LIMIT ?
        ");
        $stmt->execute([DailyClock::currentDate(), $limit]);
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    public static function countsByDate(string $from, string $to): array
    {
        $stmt = Database::pdo()->prepare("
            SELECT dc.challenge_date::text AS d, count(*) AS n
            FROM daily_twists t JOIN daily_challenges dc ON dc.id = t.challenge_id
            WHERE t.proposed_at IS NOT NULL AND dc.challenge_date BETWEEN ? AND ?
            GROUP BY dc.challenge_date
        ");
        $stmt->execute([$from, $to]);
        return array_map('intval', $stmt->fetchAll(PDO::FETCH_KEY_PAIR));
    }

    /**
     * Pick a twist (a local's proposal, or an earlier founder twist) as the
     * selected one of its (challenge, city). The current one goes back to
     * 'proposed'. A local author gets a push + bell, once per pick.
     */
    public static function pick(string $twistId): array
    {
        $before = self::findRow($twistId);
        if ($before === null) {
            throw new InvalidArgumentException('Twist not found.');
        }
        if ($before['status'] === 'selected') {
            return $before;
        }
        $pdo = Database::pdo();
        $pdo->beginTransaction();
        try {
            $pdo->prepare("
                UPDATE daily_twists SET status = 'proposed', updated_at = now()
                WHERE challenge_id = ? AND city_id = ? AND status = 'selected'
            ")->execute([$before['challenge_id'], $before['city_id']]);
            $pdo->prepare("
                UPDATE daily_twists SET status = 'selected', moderation_status = 'approved', updated_at = now()
                WHERE id = ?
            ")->execute([$twistId]);
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        $after = self::findRow($twistId);
        DailyAdminService::audit('daily_twist.pick', 'daily_twist', $twistId, $before, $after);

        if ($after['proposed_at'] !== null && $after['author_user_id'] !== null) {
            try {
                $today = DailyClock::isActive((string) $after['challenge_date']);
                $when  = $today ? "today's" : "tomorrow's";
                $stmt  = Database::pdo()->prepare("SELECT locale FROM users WHERE id = ?");
                $stmt->execute([$after['author_user_id']]);
                $body  = DailyPushText::render($today ? 'picked_today' : 'picked_tomorrow',
                                               DailyI18n::normalize($stmt->fetchColumn() ?: null), ['city' => $after['city_name']])
                         ?? "Your Local Twist was picked for {$when} Daily Challenge in {$after['city_name']}";
                NotificationRepository::createUnchecked(
                    $after['author_user_id'],
                    'daily_twist_picked',
                    'Daily Challenge',
                    $body,
                    ['date' => $after['challenge_date'], 'cityId' => $after['city_id']],
                    'en',
                );
            } catch (\Throwable $e) {
                error_log("[daily] twist picked notification failed for {$twistId}: " . $e->getMessage());
            }
        }
        return $after;
    }

    /** Reject a proposal that is not the selected twist, with an optional reason its author sees (V2-05). */
    public static function reject(string $twistId, ?string $reason = null): void
    {
        $before = self::findRow($twistId);
        if ($before === null) {
            throw new InvalidArgumentException('Twist not found.');
        }
        if ($before['status'] === 'selected') {
            throw new InvalidArgumentException('Pick another twist before rejecting the selected one.');
        }
        Database::pdo()->prepare("
            UPDATE daily_twists SET status = 'rejected', moderation_status = 'rejected', rejection_reason = ?, updated_at = now()
            WHERE id = ?
        ")->execute([$reason !== null && trim($reason) !== '' ? mb_substr(trim($reason), 0, 280) : null, $twistId]);
        DailyAdminService::audit('daily_twist.reject', 'daily_twist', $twistId, $before, self::findRow($twistId));
    }

    // ── Internals ────────────────────────────────────────────────────────────

    /** The user's city, its live flag, tomorrow's challenge (scheduled or published) and the ineligibility reason. */
    private static function context(array $user, string $date): array
    {
        $cityId   = is_string($user['current_city_id'] ?? null) && preg_match('/^city_\d+$/', $user['current_city_id'])
            ? $user['current_city_id'] : null;
        $cityName = $cityId !== null ? (CityRepository::findById((int) substr($cityId, 5))['name'] ?? null) : null;

        $stmt = Database::pdo()->prepare("
            SELECT id, challenge_date, text_i18n, context_i18n FROM daily_challenges
            WHERE challenge_date = ? AND status IN ('scheduled', 'published')
        ");
        $stmt->execute([$date]);
        $challenge = $stmt->fetch(PDO::FETCH_ASSOC) ?: null;

        return [
            'cityId'    => $cityId,
            'city'      => $cityName !== null ? ['id' => (int) substr($cityId, 5), 'name' => $cityName] : null,
            'challenge' => $challenge,
            'reason'    => self::ineligibility($user['mode'] ?? null, $user['home_city'] ?? null, $cityName,
                                               DailyRules::isLive($cityId), $challenge !== null),
        ];
    }

    /** Tomorrow's challenge text and context in the viewer's language, with the English original when translated. */
    private static function challengeText(array $row): array
    {
        $c = DailyChallengeRepository::formatChallenge($row);
        return ['text' => $c['text'], 'context' => $c['context'], 'original' => $c['original'], 'lang' => $c['lang']];
    }

    private static function guardWrite(array $user, string $date, DateTimeImmutable $now): array
    {
        $ctx = self::context($user, $date);
        if ($ctx['reason'] !== null) {
            throw new InvalidArgumentException($ctx['reason']);
        }
        if (!self::isOpen($date, $now)) {
            throw new InvalidArgumentException('closed');
        }
        return $ctx;
    }

    private static function guardText(mixed $text): string
    {
        $clean = self::cleanText($text);
        if ($clean === null) {
            throw new InvalidArgumentException('invalid_text');
        }
        if (ModerationService::check($clean) !== null) {
            throw new InvalidArgumentException('moderation_blocked');
        }
        return $clean;
    }

    private static function mustFindEditable(string $challengeId, string $userId): array
    {
        $mine = self::findMine($challengeId, $userId);
        if ($mine === null) {
            throw new InvalidArgumentException('not_found');
        }
        if ($mine['status'] !== 'proposed') {
            throw new InvalidArgumentException('not_editable');
        }
        return $mine;
    }

    private static function findMine(string $challengeId, string $userId): ?array
    {
        $stmt = Database::pdo()->prepare("
            SELECT t.*, dc.challenge_date::text AS challenge_date FROM daily_twists t
            JOIN daily_challenges dc ON dc.id = t.challenge_id
            WHERE t.challenge_id = ? AND t.author_user_id = ? AND t.proposed_at IS NOT NULL
        ");
        $stmt->execute([$challengeId, $userId]);
        return $stmt->fetch(PDO::FETCH_ASSOC) ?: null;
    }

    private static function findRow(string $id): ?array
    {
        $stmt = Database::pdo()->prepare("
            SELECT t.*, dc.challenge_date::text AS challenge_date, ch.name AS city_name
            FROM daily_twists t
            JOIN daily_challenges dc ON dc.id = t.challenge_id
            LEFT JOIN channels ch ON ch.id = t.city_id
            WHERE t.id = ?
        ");
        $stmt->execute([$id]);
        return $stmt->fetch(PDO::FETCH_ASSOC) ?: null;
    }

    private static function format(array $row): array
    {
        return [
            'id'        => $row['id'],
            'text'      => $row['text'],
            'status'    => self::statusOf($row),
            'createdAt' => DailyProofRepository::ts($row['proposed_at']),
            'editedAt'  => $row['updated_at'] !== $row['created_at'] ? DailyProofRepository::ts($row['updated_at']) : null,
        ];
    }

    /** Push the admin (ADMIN_TEST_USER_ID) that proposals are waiting, at most once every 30 minutes. Best effort. */
    private static function alertAdmin(string $date): void
    {
        $adminId = trim((string) getenv('ADMIN_TEST_USER_ID'));
        if ($adminId === '' || !DbRateLimiter::allow('daily_twist_alert', 1, self::ALERT_EVERY)) {
            return;
        }
        try {
            $stmt = Database::pdo()->prepare("
                SELECT count(*) FROM daily_twists t JOIN daily_challenges dc ON dc.id = t.challenge_id
                WHERE dc.challenge_date = ? AND t.proposed_at IS NOT NULL AND t.status = 'proposed'
            ");
            $stmt->execute([$date]);
            $n = (int) $stmt->fetchColumn();
            if ($n > 0) {
                NotificationRepository::createUnchecked($adminId, 'daily_admin', 'Daily Challenge',
                    $n === 1 ? "1 Local Twist proposal for {$date}." : "{$n} Local Twist proposals for {$date}.", [], 'en');
            }
        } catch (\Throwable $e) {
            error_log('[daily] twist proposal alert failed: ' . $e->getMessage());
        }
    }
}
