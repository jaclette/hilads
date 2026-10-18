<?php

declare(strict_types=1);

/**
 * Challenge proposals (SPEC 8.6, V2-05).
 *
 * Any registered user proposes a Daily Challenge: an English text of 120
 * characters, a theme, a short why and, when they are a local of a live
 * current city, an optional Local Twist for it. At most MAX_PENDING pending
 * proposals per user. Every proposal passes the text filter, then waits for
 * the founder in the back office inbox:
 * - approve: edited if needed, then scheduled on a date (the inbox suggests the
 *   next free day of its theme) or sent to the reserve; the Local Twist becomes
 *   the selected twist of the author's city. The challenge carries the author
 *   (daily_challenges.proposed_by_user_id) and shows "Proposed by".
 * - reject: with a reason from editable templates; shown in the app, no push.
 *
 * The author is notified through the push log and the daily cap (English):
 * proposal_approved when approved, proposal_day as the morning push of its day,
 * proposal_result the next morning. Points (proposal_selected, score_rules)
 * when the challenge goes live.
 *
 * Twist proposals for tomorrow stay in daily_twists (DailyTwistProposals);
 * "My proposals" lists both.
 */
final class DailyProposals
{
    public const TEXT_MAX    = 120;
    public const WHY_MAX     = 200;
    public const MAX_PENDING = 1;
    public const ALERT_EVERY = 1800;   // seconds between "proposals waiting" pushes to the admin

    // ── Pure helpers (unit-tested) ────────────────────────────────────────────

    /**
     * Clean a proposal body. Returns [fields, null] or [[], code]:
     * invalid_text, invalid_theme, invalid_why, invalid_twist.
     */
    public static function validate(array $body): array
    {
        $clean = static fn(mixed $v): string => is_string($v) ? trim((string) preg_replace('/\s+/u', ' ', $v)) : '';
        $text  = $clean($body['text'] ?? null);
        if ($text === '' || mb_strlen($text) > self::TEXT_MAX) {
            return [[], 'invalid_text'];
        }
        $theme = DailyThemes::normalize($body['theme'] ?? null);
        if ($theme === null) {
            return [[], 'invalid_theme'];
        }
        $why = $clean($body['why'] ?? null);
        if (mb_strlen($why) > self::WHY_MAX) {
            return [[], 'invalid_why'];
        }
        $twist = $clean($body['twistText'] ?? null);
        if (mb_strlen($twist) > DailyAdminService::TWIST_MAX) {
            return [[], 'invalid_twist'];
        }
        return [['text' => $text, 'theme' => $theme, 'why' => $why === '' ? null : $why,
                 'twist_text' => $twist === '' ? null : $twist], null];
    }

    /**
     * What the author sees: pending, rejected, or once approved scheduled
     * (with its date), published or reserve. Row: status, challenge_status,
     * challenge_date, is_reserve.
     */
    public static function statusOf(array $row): string
    {
        if ($row['status'] !== 'approved') {
            return $row['status'];
        }
        if (($row['challenge_status'] ?? null) === 'published') {
            return 'published';
        }
        if (($row['challenge_date'] ?? null) !== null) {
            return 'scheduled';
        }
        return DailyProofRepository::bool($row['is_reserve'] ?? false) ? 'reserve' : 'approved';
    }

    /** The next date after $today on the theme's weekday with no challenge ($taken: set of Y-m-d). */
    public static function nextFreeDay(string $theme, string $today, array $taken): string
    {
        $weekday = DailyThemes::THEMES[$theme][1] ?? 1;
        $d = (new DateTimeImmutable($today, new DateTimeZone('UTC')))->modify('+1 day');
        while ((int) $d->format('N') !== $weekday) {
            $d = $d->modify('+1 day');
        }
        for ($i = 0; $i < 104 && isset($taken[$d->format('Y-m-d')]); $i++) {
            $d = $d->modify('+7 days');
        }
        return $d->format('Y-m-d');
    }

    // ── For the app ──────────────────────────────────────────────────────────

    /** Propose a challenge. Throws InvalidArgumentException with a code. Returns the formatted proposal. */
    public static function propose(array $user, array $body): array
    {
        [$f, $err] = self::validate($body);
        if ($err !== null) {
            throw new InvalidArgumentException($err);
        }
        foreach (['text', 'why', 'twist_text'] as $k) {
            if ($f[$k] !== null && ModerationService::check($f[$k]) !== null) {
                throw new InvalidArgumentException('moderation_blocked');
            }
        }
        $cityId = is_string($user['current_city_id'] ?? null) && preg_match('/^city_\d+$/', $user['current_city_id'])
            ? $user['current_city_id'] : null;
        if ($f['twist_text'] !== null) {
            $cityName = $cityId !== null ? (CityRepository::findById((int) substr($cityId, 5))['name'] ?? null) : null;
            if (!DailyRules::isLive($cityId) || !DailyRules::isLocalFor($user['mode'] ?? null, $user['home_city'] ?? null, $cityName)) {
                throw new InvalidArgumentException('twist_not_allowed');
            }
        }

        $pdo  = Database::pdo();
        $stmt = $pdo->prepare("SELECT count(*) FROM daily_proposals WHERE user_id = ? AND status = 'pending'");
        $stmt->execute([$user['id']]);
        if ((int) $stmt->fetchColumn() >= self::MAX_PENDING) {
            throw new InvalidArgumentException('pending_exists');
        }
        $id = bin2hex(random_bytes(8));
        $pdo->prepare("
            INSERT INTO daily_proposals (id, user_id, city_id, text, why, theme, twist_text)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        ")->execute([$id, $user['id'], $cityId, $f['text'], $f['why'], $f['theme'], $f['twist_text']]);
        self::alertAdmin();
        return self::format(self::find($id));
    }

    /** Withdraw my pending proposal. */
    public static function withdraw(array $user, string $id): void
    {
        $row = self::find($id);
        if ($row === null || $row['user_id'] !== $user['id']) {
            throw new InvalidArgumentException('not_found');
        }
        if ($row['status'] !== 'pending') {
            throw new InvalidArgumentException('not_editable');
        }
        Database::pdo()->prepare("DELETE FROM daily_proposals WHERE id = ? AND status = 'pending'")->execute([$id]);
    }

    /** My challenge and twist proposals, newest first (50 at most). */
    public static function mine(string $userId): array
    {
        $pdo  = Database::pdo();
        $stmt = $pdo->prepare(self::SELECT . " WHERE p.user_id = ? ORDER BY p.created_at DESC LIMIT 50");
        $stmt->execute([$userId]);
        $items = array_map([self::class, 'format'], $stmt->fetchAll(PDO::FETCH_ASSOC));

        $stmt = $pdo->prepare("
            SELECT t.id, t.text, t.status, t.rejection_reason, t.proposed_at, t.city_id, ch.name AS city_name,
                   dc.challenge_date::text AS challenge_date, dc.theme
            FROM daily_twists t
            JOIN daily_challenges dc ON dc.id = t.challenge_id
            LEFT JOIN channels ch    ON ch.id = t.city_id
            WHERE t.author_user_id = ? AND t.proposed_at IS NOT NULL
            ORDER BY t.proposed_at DESC
            LIMIT 50
        ");
        $stmt->execute([$userId]);
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $t) {
            $items[] = [
                'id'              => $t['id'],
                'type'            => 'twist',
                'text'            => $t['text'],
                'theme'           => DailyThemes::format($t['theme'], $t['challenge_date']),
                'why'             => null,
                'twistText'       => null,
                'city'            => self::city($t['city_id'], $t['city_name']),
                'status'          => DailyTwistProposals::statusOf($t),
                'date'            => $t['challenge_date'],
                'rejectionReason' => $t['rejection_reason'],
                'createdAt'       => DailyProofRepository::ts($t['proposed_at']),
            ];
        }
        usort($items, static fn(array $a, array $b): int => ($b['createdAt'] ?? 0) <=> ($a['createdAt'] ?? 0));
        return array_slice($items, 0, 50);
    }

    // ── Back office ──────────────────────────────────────────────────────────

    /** Pending challenge proposals, oldest first, with the author and a suggested date. */
    public static function listPending(int $limit = 100): array
    {
        $stmt = Database::pdo()->prepare(self::SELECT . " WHERE p.status = 'pending' ORDER BY p.created_at LIMIT ?");
        $stmt->execute([$limit]);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
        foreach ($rows as &$r) {
            $r['suggested_date'] = self::suggestDate($r['theme']);
        }
        unset($r);
        return $rows;
    }

    /** Recently reviewed challenge proposals, newest first. */
    public static function listReviewed(int $limit = 30): array
    {
        $stmt = Database::pdo()->prepare(self::SELECT . " WHERE p.status <> 'pending' ORDER BY p.reviewed_at DESC NULLS LAST LIMIT ?");
        $stmt->execute([$limit]);
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    /** The next free future day of a theme's weekday. */
    public static function suggestDate(string $theme): string
    {
        $today = DailyClock::currentDate();
        $stmt  = Database::pdo()->prepare("SELECT challenge_date::text FROM daily_challenges WHERE challenge_date > ? AND challenge_date <= ?::date + 800");
        $stmt->execute([$today, $today]);
        return self::nextFreeDay($theme, $today, array_flip($stmt->fetchAll(PDO::FETCH_COLUMN)));
    }

    /**
     * Approve a proposal. $in: text, context, theme, twistText (edited
     * values), and date (Y-m-d) or reserve (true). Creates the challenge
     * (scheduled, or a reserve), credits the author, sets the Local Twist of
     * their city, and queues the "approved" push. Returns the challenge row.
     */
    public static function approve(string $id, array $in): array
    {
        $p = self::find($id);
        if ($p === null) {
            throw new InvalidArgumentException('Proposal not found.');
        }
        if ($p['status'] !== 'pending') {
            throw new InvalidArgumentException('This proposal was already reviewed.');
        }
        $text    = (string) ($in['text'] ?? $p['text']);
        $context = (string) ($in['context'] ?? '');
        $theme   = (string) ($in['theme'] ?? $p['theme']);
        $reserve = ($in['reserve'] ?? false) === true;
        $date    = $reserve ? null : trim((string) ($in['date'] ?? ''));
        if (!$reserve && $date === '') {
            throw new InvalidArgumentException('Give it a date, or send it to the reserve.');
        }
        if (mb_strlen(trim($text)) > self::TEXT_MAX) {
            throw new InvalidArgumentException('The challenge must stay under ' . self::TEXT_MAX . ' characters.');
        }

        $challenge = $reserve
            ? DailyAdminService::createReserve($text, $context, $theme)
            : DailyAdminService::createChallenge(['text' => $text, 'context' => $context, 'date' => $date,
                                                  'status' => 'scheduled', 'theme' => $theme]);
        $pdo = Database::pdo();
        $pdo->prepare("UPDATE daily_challenges SET proposed_by_user_id = ? WHERE id = ?")->execute([$p['user_id'], $challenge['id']]);
        $pdo->prepare("
            UPDATE daily_proposals
            SET status = 'approved', moderation_status = 'approved', created_challenge_id = ?, reviewed_at = now(), updated_at = now()
            WHERE id = ?
        ")->execute([$challenge['id'], $id]);

        $twist = trim((string) ($in['twistText'] ?? $p['twist_text'] ?? ''));
        if ($twist !== '' && $p['city_id'] !== null) {
            DailyAdminService::setTwist($challenge['id'], $p['city_id'], $twist, $p['user_id'], null);
        }
        DailyAdminService::audit('daily_proposal.approve', 'daily_proposal', $id, $p, self::find($id));

        try {
            $now = new DateTimeImmutable('now');
            DailyPushes::queueFor('proposal_approved', $p['user_id'], $date ?? DailyClock::currentDate($now),
                                  DailyPushes::proposalApprovedMessage($date), $now);
        } catch (\Throwable $e) {
            error_log("[daily] proposal approved push failed for {$id}: " . $e->getMessage());
        }
        return DailyAdminService::find($challenge['id']);
    }

    /** Reject with a reason the author sees in the app (no push). */
    public static function reject(string $id, string $reason): void
    {
        $p      = self::find($id);
        $reason = trim($reason);
        if ($p === null) {
            throw new InvalidArgumentException('Proposal not found.');
        }
        if ($p['status'] !== 'pending') {
            throw new InvalidArgumentException('This proposal was already reviewed.');
        }
        if ($reason === '' || mb_strlen($reason) > 280) {
            throw new InvalidArgumentException('Give a reason (max 280 characters) - the author sees it.');
        }
        Database::pdo()->prepare("
            UPDATE daily_proposals
            SET status = 'rejected', moderation_status = 'rejected', rejection_reason = ?, reviewed_at = now(), updated_at = now()
            WHERE id = ?
        ")->execute([$reason, $id]);
        DailyAdminService::audit('daily_proposal.reject', 'daily_proposal', $id, $p, self::find($id));
    }

    public static function templates(): array
    {
        return Database::pdo()->query("SELECT id, text FROM daily_rejection_templates ORDER BY position, id")->fetchAll(PDO::FETCH_ASSOC);
    }

    public static function addTemplate(string $text): void
    {
        $text = trim($text);
        if ($text === '' || mb_strlen($text) > 280) {
            throw new InvalidArgumentException('A template is 1 to 280 characters.');
        }
        Database::pdo()->prepare("
            INSERT INTO daily_rejection_templates (text, position)
            VALUES (?, (SELECT COALESCE(max(position), 0) + 1 FROM daily_rejection_templates))
        ")->execute([$text]);
        DailyAdminService::audit('daily_rejection_template.add', 'daily_rejection_template', null, null, ['text' => $text]);
    }

    public static function deleteTemplate(int $id): void
    {
        Database::pdo()->prepare("DELETE FROM daily_rejection_templates WHERE id = ?")->execute([$id]);
        DailyAdminService::audit('daily_rejection_template.delete', 'daily_rejection_template', (string) $id, null, null);
    }

    // ── At the drop ──────────────────────────────────────────────────────────

    /**
     * The next morning: "214 people completed your challenge." for the author
     * of $date's challenge (its approved proofs, the author's own excluded).
     * Nothing without an author or a completion. Returns rows queued.
     */
    public static function queueResult(string $date, DateTimeImmutable $now): int
    {
        $challenge = DailyChallengeRepository::findPublishedByDate($date);
        $authorId  = $challenge !== null ? self::authorOf($challenge['id']) : null;
        if ($authorId === null) {
            return 0;
        }
        $stmt = Database::pdo()->prepare("
            SELECT count(*) FROM daily_proofs WHERE challenge_id = ? AND moderation_status = 'approved' AND user_id <> ? AND NOT is_demo
        ");
        $stmt->execute([$challenge['id'], $authorId]);
        $n = (int) $stmt->fetchColumn();
        return $n > 0 ? DailyPushes::queueFor('proposal_result', $authorId, $date, DailyPushes::proposalResultMessage($date, $n), $now) : 0;
    }

    /** The user who proposed a challenge, or null. */
    public static function authorOf(string $challengeId): ?string
    {
        $stmt = Database::pdo()->prepare("SELECT proposed_by_user_id FROM daily_challenges WHERE id = ?");
        $stmt->execute([$challengeId]);
        return $stmt->fetchColumn() ?: null;
    }

    // ── Internals ────────────────────────────────────────────────────────────

    private const SELECT = "
        SELECT p.*, u.username, u.display_name, ch.name AS city_name,
               dc.challenge_date::text AS challenge_date, dc.status AS challenge_status, dc.is_reserve
        FROM daily_proposals p
        JOIN users u             ON u.id  = p.user_id
        LEFT JOIN channels ch    ON ch.id = p.city_id
        LEFT JOIN daily_challenges dc ON dc.id = p.created_challenge_id
    ";

    public static function find(string $id): ?array
    {
        $stmt = Database::pdo()->prepare(self::SELECT . " WHERE p.id = ?");
        $stmt->execute([$id]);
        return $stmt->fetch(PDO::FETCH_ASSOC) ?: null;
    }

    private static function format(array $row): array
    {
        return [
            'id'              => $row['id'],
            'type'            => 'challenge',
            'text'            => $row['text'],
            'theme'           => DailyThemes::format($row['theme'], null),
            'why'             => $row['why'],
            'twistText'       => $row['twist_text'],
            'city'            => self::city($row['city_id'], $row['city_name']),
            'status'          => self::statusOf($row),
            'date'            => $row['challenge_date'],
            'rejectionReason' => $row['status'] === 'rejected' ? $row['rejection_reason'] : null,
            'createdAt'       => DailyProofRepository::ts($row['created_at']),
        ];
    }

    private static function city(?string $cityId, ?string $name): ?array
    {
        return $cityId !== null ? ['id' => (int) substr($cityId, 5), 'name' => $name, 'country' => CityRepository::countryOf($cityId)] : null;
    }

    /** Push the admin (ADMIN_TEST_USER_ID) that proposals are waiting, at most once every 30 minutes. Best effort. */
    private static function alertAdmin(): void
    {
        $adminId = trim((string) getenv('ADMIN_TEST_USER_ID'));
        if ($adminId === '' || !DbRateLimiter::allow('daily_proposal_alert', 1, self::ALERT_EVERY)) {
            return;
        }
        try {
            $n = (int) Database::pdo()->query("SELECT count(*) FROM daily_proposals WHERE status = 'pending'")->fetchColumn();
            if ($n > 0) {
                NotificationRepository::createUnchecked($adminId, 'daily_admin', 'Daily Challenge',
                    $n === 1 ? '1 challenge proposal is waiting.' : "{$n} challenge proposals are waiting.", [], 'en');
            }
        } catch (\Throwable $e) {
            error_log('[daily] proposal alert failed: ' . $e->getMessage());
        }
    }
}
