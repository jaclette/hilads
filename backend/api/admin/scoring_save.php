<?php

declare(strict_types=1);

admin_require_login();
csrf_verify();

// Admin › Scoring: the two fair-play switches (app_settings scoring_*; config/scoring.php
// holds the defaults, both off). podium_min_photos: 0 = off, N = a day with fewer than N
// photos worldwide pays only 🥇. vote_requires_play: only players who posted the day's
// photo can like it.

$min  = (int) ($_POST['podium_min_photos'] ?? 0);
$play = !empty($_POST['vote_requires_play']);
if ($min < 0 || $min > 1000) {
    flash_set('error', 'Minimum photos must be between 0 (off) and 1000.');
    admin_redirect('/admin/scoring');
}
$stmt = Database::pdo()->prepare("
    INSERT INTO app_settings (key, value, updated_at, updated_by) VALUES (?, ?, now(), ?)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by
");
$by = 'admin';
$stmt->execute(['scoring_podium_min_photos', (string) $min, $by]);
$stmt->execute(['scoring_vote_requires_play', $play ? '1' : '0', $by]);
AppConfig::forgetSettings();
error_log("[admin-scoring] switches: podium_min_photos={$min} vote_requires_play=" . ($play ? 'on' : 'off') . " by {$by}");
flash_set('success', 'Saved: minimum photos for a full podium ' . ($min > 0 ? $min : 'off') . ', play to like ' . ($play ? 'on' : 'off') . '.');
admin_redirect('/admin/scoring');
