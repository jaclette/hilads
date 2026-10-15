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

        $after = DailyProofRepository::findById($proofId);
        DailyCards::postProof($after);
        DailyAdminService::audit('daily_proof.approve', 'daily_proof', $proofId, $before, $after);
        // Proof + streak points (idempotent; an edit re-approved earns nothing new).
        // Best effort: the close's safety pass catches a failure here.
        try {
            DailyPoints::awardProof($after);
        } catch (\Throwable $e) {
            error_log("[daily] points for proof {$proofId} failed: " . $e->getMessage());
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
        self::alertAdminQueue();
        return 'reported_hidden';
    }

    public static function shouldHide(int $openReports): bool
    {
        return $openReports >= self::REPORT_HIDE_THRESHOLD;
    }

    /**
     * Push the admin (ADMIN_TEST_USER_ID) that proofs are waiting, at most once
     * every 30 minutes. Best effort.
     */
    public static function alertAdminQueue(): void
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
            NotificationRepository::createUnchecked(
                $adminId,
                'daily_moderation',
                'Daily Challenge',
                $n === 1 ? '1 proof is waiting for review.' : "{$n} proofs are waiting for review.",
                [],
                'en',
            );
        } catch (\Throwable $e) {
            error_log('[daily] queue alert failed: ' . $e->getMessage());
        }
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
