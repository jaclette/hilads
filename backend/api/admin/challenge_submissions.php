<?php

declare(strict_types=1);

// Admin: view every photo submitted to a GROUP photo-proof challenge and crown
// the winner. Primary use: @hilads campaign challenges (no human challenger).

admin_require_login();

$pdo = Database::pdo();

$challenge = ChallengeRepository::findByIdUnchecked($challengeId);
if ($challenge === null) {
    admin_head('Challenge not found');
    echo '<div class="admin-main"><h1 class="page-title">Challenge not found</h1>';
    echo '<p style="margin-top:12px"><a href="/admin/challenges" class="btn btn-secondary btn-sm">← Challenges</a></p></div>';
    admin_foot();
    return;
}

$isPhoto = ($challenge['validation_method'] ?? 'meet') === 'photo_proof' || ($challenge['mode'] ?? 'local') === 'international';
$isGroup = ($challenge['challenge_format'] ?? 'legacy') === 'group';

$submissions = ($isGroup && $isPhoto) ? ChallengeProofRepository::listGroupSubmissions($challengeId) : [];

$w = $pdo->prepare("SELECT user_id FROM score_events WHERE challenge_id = ? AND kind = 'winner' LIMIT 1");
$w->execute([$challengeId]);
$winnerUserId = $w->fetchColumn() ?: null;

admin_head('Challenge submissions');
admin_nav('/admin/challenges');
?>
<div class="admin-main">
    <div style="margin-bottom:16px">
        <a href="/admin/challenges" class="btn btn-secondary btn-sm">← Challenges</a>
    </div>

    <h1 class="page-title">🏆 Pick the winner
        <span style="color:#555;font-size:14px;font-weight:400"><?= htmlspecialchars($challenge['title'] ?? '', ENT_QUOTES) ?></span>
    </h1>
    <?= flash_html() ?>

    <?php if (!$isGroup || !$isPhoto): ?>
        <p class="no-results" style="padding:20px 0">This isn’t a group photo-proof challenge, so there’s no winner to pick.</p>
    <?php elseif (empty($submissions)): ?>
        <p class="no-results" style="padding:20px 0">No photos have been submitted yet.</p>
    <?php else: ?>
        <p style="color:#777;margin:-4px 0 16px;font-size:13px">
            <?= count($submissions) ?> submission(s).
            <?php if ($winnerUserId): ?><strong style="color:#22c55e">A winner has been crowned.</strong><?php else: ?>Choose the best photo — the winner earns the reward (2× for a campaign).<?php endif; ?>
        </p>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px">
            <?php foreach ($submissions as $s):
                $isWinner = $winnerUserId !== null && ($s['user_id'] ?? null) === $winnerUserId;
                ?>
                <div style="border:1px solid <?= $isWinner ? '#22c55e' : '#2a2a2a' ?>;border-radius:12px;overflow:hidden;background:#161310">
                    <a href="<?= htmlspecialchars($s['media_url'] ?? '#', ENT_QUOTES) ?>" target="_blank" rel="noopener">
                        <img src="<?= htmlspecialchars($s['media_url'] ?? '', ENT_QUOTES) ?>" alt="" style="width:100%;height:200px;object-fit:cover;display:block">
                    </a>
                    <div style="padding:10px 12px">
                        <div style="color:#ddd;font-weight:600;font-size:13px">
                            <?= htmlspecialchars($s['display_name'] ?? '(unknown)', ENT_QUOTES) ?>
                            <?php if ($isWinner): ?><span class="badge" style="background:#22c55e22;color:#22c55e;border:1px solid #22c55e55;margin-left:4px">🏆 Winner</span><?php endif; ?>
                        </div>
                        <div class="td-mono" style="color:#555;font-size:10px;margin:4px 0 8px"><?= htmlspecialchars((string) ($s['user_id'] ?? ''), ENT_QUOTES) ?></div>
                        <?php if (!$winnerUserId): ?>
                            <form method="POST" action="/admin/challenges/<?= urlencode($challengeId) ?>/pick-winner"
                                  onsubmit="return confirm('Crown this photo as the winner? Points are awarded and the challenge is validated. This cannot be undone.')">
                                <?= csrf_input() ?>
                                <input type="hidden" name="winner_user_id" value="<?= htmlspecialchars((string) ($s['user_id'] ?? ''), ENT_QUOTES) ?>">
                                <button type="submit" class="btn btn-primary btn-sm" style="width:100%">🏆 Crown winner</button>
                            </form>
                        <?php endif; ?>
                    </div>
                </div>
            <?php endforeach; ?>
        </div>
    <?php endif; ?>
</div>
<?php
admin_foot();
