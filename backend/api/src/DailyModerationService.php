<?php

declare(strict_types=1);

/**
 * Daily Challenge moderation (AUDIT Q7: manual approval).
 *
 * Captions and twists pass ModerationService (text) when written. Every new or
 * edited proof then waits as 'pending' until an admin approves it in the back
 * office; only approved proofs are shown to others and get channel cards.
 * Reports: three open reports from different people send an approved proof
 * back to review and hide its cards until an admin decides.
 *
 * DAILY_AUTO_APPROVE=true approves on submit - local development only.
 */
final class DailyModerationService
{
    public const REPORT_HIDE_THRESHOLD = 3;
    public const REPORT_REASONS = ['inappropriate', 'person_without_consent', 'dangerous', 'spam', 'other'];
    public const QUEUE_ALERT_EVERY = 1800; // seconds between "proofs waiting" pushes to the admin

    public static function autoApproveEnabled(): bool
    {
        $v = strtolower(trim((string) getenv('DAILY_AUTO_APPROVE')));
        return in_array($v, ['1', 'true', 'on', 'yes'], true);
    }

    /** Approved proofs a player needs, none ever rejected or removed, before their answers skip the queue. */
    public const TRUSTED_MIN_APPROVED = 3;

    /**
     * A trusted author's proofs are approved on submit and moderated after
     * publication: an admin, or a player with TRUSTED_MIN_APPROVED approved
     * proofs and none rejected or removed. Demo accounts never.
     */
    public static function isTrusted(array $user): bool
    {
        if (!empty($user['is_demo'])) {
            return false;
        }
        if (!empty($user['is_admin'])) {
            return true;
        }
        $stmt = Database::pdo()->prepare("
            SELECT count(*) FILTER (WHERE moderation_status = 'approved')               AS approved,
                   count(*) FILTER (WHERE moderation_status IN ('rejected', 'removed')) AS refused
            FROM daily_proofs
            WHERE user_id = ? AND NOT is_seed AND NOT is_demo
        ");
        $stmt->execute([$user['id']]);
        $r = $stmt->fetch(PDO::FETCH_ASSOC) ?: ['approved' => 0, 'refused' => 0];
        return (int) $r['refused'] === 0 && (int) $r['approved'] >= self::TRUSTED_MIN_APPROVED;
    }

    /** Back office queue: pending proofs (oldest first) and approved proofs with open reports. */
    public static function queue(int $limit = 50): array
    {
        return [
            'pending'  => DailyProofRepository::listPending($limit),
            'reported' => DailyProofRepository::listReported($limit),
        ];
    }

    /**
     * Approve a pending (or reported) proof: it becomes visible and its cards
     * are posted, or updated in place after an edit. Open reports are marked
     * reviewed. Proofs posted on time can still be approved after the drop.
     */
    public static function approveProof(string $proofId): array
    {
        $before = self::mustFind($proofId);
        if ($before['moderation_status'] === 'removed') {
            throw new InvalidArgumentException('A removed proof cannot be approved.');
        }
        $pdo = Database::pdo();
        $pdo->beginTransaction();
        try {
            $pdo->prepare("
                UPDATE daily_proofs
                SET moderation_status = 'approved', approved_at = now(), rejection_reason = NULL,
                    moderated_at = now(), updated_at = now()
                WHERE id = ?
            ")->execute([$proofId]);
            $pdo->prepare("UPDATE daily_proof_reports SET status = 'reviewed' WHERE proof_id = ? AND status = 'open'")
                ->execute([$proofId]);
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }

        // Its place in review becomes a spot (V3-02).
        Places::approveForProof(DailyProofRepository::findById($proofId) ?? []);
        // Local Pass first (V2-03), so the card of the proof that completes it shows it.
        try {
            DailyLocalPass::checkAfterApproval(DailyProofRepository::findById($proofId));
        } catch (\Throwable $e) {
            error_log("[daily] local pass for proof {$proofId} failed: " . $e->getMessage());
        }
        $after = DailyProofRepository::findById($proofId);
        // Represent your city (SPEC 9.16): presence, first-of-the-day tracking, the city's Pioneer.
        try {
            DailyPresence::afterApproval($after);
        } catch (\Throwable $e) {
            error_log("[daily] presence for proof {$proofId} failed: " . $e->getMessage());
        }
        DailyCards::postProof($after);
        // The city's Local Twist author: a live bell row (prompt 12).
        DailyNotify::onApproved($after);
        DailyAdminService::audit('daily_proof.approve', 'daily_proof', $proofId, $before, $after);
        // Proof + streak points (idempotent; an edit re-approved earns nothing new).
        // Best effort: the close's safety pass catches a failure here.
        try {
            DailyPoints::awardProof($after);
        } catch (\Throwable $e) {
            error_log("[daily] points for proof {$proofId} failed: " . $e->getMessage());
        }
        // Evening digest of the votes it gets (idempotent; none once the challenge closed).
        try {
            if (DailyClock::isActive((string) $after['challenge_date'])) {
                DailyPushes::queueDigests((string) $after['challenge_date'], [$after['user_id']], new DateTimeImmutable('now'));
            }
        } catch (\Throwable $e) {
            error_log("[daily] digest for proof {$proofId} failed: " . $e->getMessage());
        }
        return $after;
    }

    /** Reject with a reason the owner sees; they can fix it with an edit while the challenge is active. */
    public static function rejectProof(string $proofId, string $reason): array
    {
        $before = self::mustFind($proofId);
        $reason = trim($reason);
        if ($reason === '' || mb_strlen($reason) > 280) {
            throw new InvalidArgumentException('Give a reason (max 280 characters) - the author sees it.');
        }
        if ($before['moderation_status'] === 'removed') {
            throw new InvalidArgumentException('This proof was already removed.');
        }
        $pdo = Database::pdo();
        $pdo->beginTransaction();
        try {
            $pdo->prepare("
                UPDATE daily_proofs
                SET moderation_status = 'rejected', rejection_reason = ?, approved_at = NULL,
                    moderated_at = now(), updated_at = now()
                WHERE id = ?
            ")->execute([$reason, $proofId]);
            $pdo->prepare("DELETE FROM score_events WHERE daily_proof_id = ?")->execute([$proofId]);
            $pdo->prepare("UPDATE daily_proof_reports SET status = 'reviewed' WHERE proof_id = ? AND status = 'open'")
                ->execute([$proofId]);
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }

        DailyCards::hideProof($proofId, $before['city_id']);
        DailyPresence::forget($before['city_id'] ?? null, $before['challenge_id'] ?? null);
        Places::rejectIfOrphan($before['place_id'] ?? null);
        $after = DailyProofRepository::findById($proofId);
        DailyAdminService::audit('daily_proof.reject', 'daily_proof', $proofId, $before, $after);
        return $after;
    }

    /** Close the open reports of a proof without changing the proof. */
    public static function resolveReports(string $proofId, string $status): int
    {
        if (!in_array($status, ['reviewed', 'dismissed'], true)) {
            throw new InvalidArgumentException('Status must be reviewed or dismissed.');
        }
        $stmt = Database::pdo()->prepare("UPDATE daily_proof_reports SET status = ? WHERE proof_id = ? AND status = 'open'");
        $stmt->execute([$status, $proofId]);
        DailyAdminService::audit('daily_proof.reports_' . $status, 'daily_proof', $proofId, null, ['reports' => $stmt->rowCount()]);
        return $stmt->rowCount();
    }

    /**
     * Report a visible proof. Returns 'reported', 'reported_hidden' (the
     * report reached the threshold and the proof went back to review),
     * 'already_reported', or throws InvalidArgumentException.
     */
    public static function report(array $proof, ?string $reporterUserId, ?string $reporterGuestId,
                                  string $reasonCode, ?string $details): string
    {
        if (!in_array($reasonCode, self::REPORT_REASONS, true)) {
            throw new InvalidArgumentException('invalid_reason');
        }
        if ($reporterUserId !== null && $reporterUserId === $proof['user_id']) {
            throw new InvalidArgumentException('own_proof');
        }
        $details = $details !== null ? trim($details) : null;
        if ($details !== null && mb_strlen($details) > 500) {
            throw new InvalidArgumentException('invalid_details');
        }

        $pdo  = Database::pdo();
        $stmt = $pdo->prepare("
            INSERT INTO daily_proof_reports (proof_id, reporter_user_id, reporter_guest_id, reason_code, details)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT DO NOTHING
            RETURNING id
        ");
        $stmt->execute([$proof['id'], $reporterUserId, $reporterUserId === null ? $reporterGuestId : null,
                        $reasonCode, $details === '' ? null : $details]);
        if ($stmt->fetchColumn() === false) {
            return 'already_reported';
        }

        $count = $pdo->prepare("SELECT count(*) FROM daily_proof_reports WHERE proof_id = ? AND status = 'open'");
        $count->execute([$proof['id']]);
        if (!self::shouldHide((int) $count->fetchColumn())) {
            return 'reported';
        }

        // Back to review: hidden from everyone but its owner until an admin decides.
        $hide = $pdo->prepare("
            UPDATE daily_proofs SET moderation_status = 'pending', approved_at = NULL, updated_at = now()
            WHERE id = ? AND moderation_status = 'approved'
        ");
        $hide->execute([$proof['id']]);
        if ($hide->rowCount() === 0) {
            return 'reported';
        }
        DailyCards::hideProof($proof['id'], $proof['city_id']);
        error_log("[daily] proof {$proof['id']} hidden after " . self::REPORT_HIDE_THRESHOLD . " reports");
        self::alertAdminQueue(DailyProofRepository::findById($proof['id']));
        return 'reported_hidden';
    }

    /** True when a proof's open reports keep it hidden until an admin decides (an edit does not bring it back). */
    public static function heldByReports(string $proofId): bool
    {
        $stmt = Database::pdo()->prepare("SELECT count(*) FROM daily_proof_reports WHERE proof_id = ? AND status = 'open'");
        $stmt->execute([$proofId]);
        return self::shouldHide((int) $stmt->fetchColumn());
    }

    public static function shouldHide(int $openReports): bool
    {
        return $openReports >= self::REPORT_HIDE_THRESHOLD;
    }

    /**
     * Push the admin (ADMIN_TEST_USER_ID) that proofs are waiting, at most once
     * every 30 minutes. Best effort. With the `$proof` that triggered it, the
     * push says who, where and which challenge: "@jaclette in Ho Chi Minh City:
     * Ask a local where they eat… · 1 waiting".
     */
    public static function alertAdminQueue(?array $proof = null): void
    {
        $adminId = trim((string) getenv('ADMIN_TEST_USER_ID'));
        if ($adminId === '' || self::autoApproveEnabled()) {
            return;
        }
        if (!DbRateLimiter::allow('daily_queue_alert', 1, self::QUEUE_ALERT_EVERY)) {
            return;
        }
        try {
            $n = (int) Database::pdo()
                ->query("SELECT count(*) FROM daily_proofs WHERE moderation_status = 'pending'")
                ->fetchColumn();
            if ($n === 0) {
                return;
            }
            $waiting = $n === 1 ? '1 waiting' : "{$n} waiting";
            $body = $proof !== null ? self::queueLine($proof) . " · {$waiting}"
                : ($n === 1 ? '1 photo is waiting for review.' : "{$n} photos are waiting for review.");
            NotificationRepository::createUnchecked(
                $adminId,
                'daily_moderation',
                'New photo to review',
                $body,
                $proof !== null ? ['proofId' => $proof['id'], 'date' => (string) ($proof['challenge_date'] ?? '')] : [],
                'en',
            );
        } catch (\Throwable $e) {
            error_log('[daily] queue alert failed: ' . $e->getMessage());
        }
    }

    /** "@jaclette in Ho Chi Minh City: Ask a local where they eat…" (the challenge in English, 70 characters at most). */
    public static function queueLine(array $proof): string
    {
        $who   = '@' . ($proof['username'] ?? $proof['display_name'] ?? '?');
        $where = !empty($proof['city_name']) ? " in {$proof['city_name']}" : '';
        $texts = json_decode((string) ($proof['challenge_text_i18n'] ?? ''), true);
        $text  = is_array($texts) ? (string) ($texts['en'] ?? reset($texts) ?: '') : '';
        if (mb_strlen($text) > 70) {
            $text = rtrim(mb_substr($text, 0, 69)) . '…';
        }
        return $text !== '' ? "{$who}{$where}: {$text}" : "{$who}{$where}";
    }

    private static function mustFind(string $proofId): array
    {
        $row = DailyProofRepository::findById($proofId);
        if ($row === null) {
            throw new InvalidArgumentException('Proof not found.');
        }
        return $row;
    }
}
