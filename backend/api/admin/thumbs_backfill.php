<?php

declare(strict_types=1);

admin_require_login();
csrf_verify();

// Backfill profile thumbnails for users who uploaded their photo
// BEFORE the on-upload thumbnail pipeline shipped (or whose thumb
// generation failed). Without this, the COALESCE fallback in every
// avatar SELECT serves the full-size original - 500 kB JPEG /
// 2-3 MB PNG payloads on what renders as a 48 px avatar (visible
// in the Network tab on the Now feed).
//
// Strategy: for every user with profile_photo_url AND NULL
// profile_thumb_photo_url, download the source from R2, resize to
// 400 px via the existing generateAvatarThumbnail() helper, upload
// the JPEG to R2 with a thumb_*.jpg name, and update the column.
//
// Each iteration is independent - partial progress is fine; the
// script just resumes where it left off on the next click.

$pdo = Database::pdo();
$started = microtime(true);

// Bounded per-click so a backlog never times out the response.
// 20 conversions ≈ 5-15s including network. Operator can click
// again until the SELECT comes back empty.
$BATCH = 20;

$stmt = $pdo->prepare("
    SELECT id, profile_photo_url
    FROM users
    WHERE deleted_at IS NULL
      AND profile_photo_url       IS NOT NULL
      AND profile_thumb_photo_url IS NULL
    ORDER BY id ASC
    LIMIT :limit
");
$stmt->bindValue(':limit', $BATCH, \PDO::PARAM_INT);
$stmt->execute();
$rows = $stmt->fetchAll(\PDO::FETCH_ASSOC);

$updated = 0;
$skipped = 0;
$errors  = [];

$update = $pdo->prepare("UPDATE users SET profile_thumb_photo_url = :url WHERE id = :id");

foreach ($rows as $row) {
    $userId = $row['id'];
    $srcUrl = $row['profile_photo_url'];

    // Download the source. R2_PUBLIC_URL points to the public bucket
    // host so an unauthenticated GET works.
    $bytes = @file_get_contents($srcUrl);
    if ($bytes === false || strlen($bytes) === 0) {
        $skipped++;
        $errors[] = "user={$userId}: download failed";
        continue;
    }

    // Persist to a temp file so the existing GD path (which expects
    // a filesystem path) doesn't need a parallel in-memory variant.
    $tmpSrc = tempnam(sys_get_temp_dir(), 'hilads_avatar_src_');
    file_put_contents($tmpSrc, $bytes);

    $finfo = new finfo(FILEINFO_MIME_TYPE);
    $mime  = $finfo->file($tmpSrc);
    if (!in_array($mime, ['image/jpeg', 'image/png', 'image/webp'], true)) {
        @unlink($tmpSrc);
        $skipped++;
        $errors[] = "user={$userId}: unsupported mime {$mime}";
        continue;
    }

    $tmpThumb = ImageProcessor::generateAvatarThumbnail($tmpSrc, $mime);
    @unlink($tmpSrc);
    if ($tmpThumb === null) {
        $skipped++;
        $reason = ImageProcessor::$lastError ?? 'unknown';
        $errors[] = "user={$userId}: {$reason}";
        continue;
    }

    try {
        $thumbName = 'thumb_' . bin2hex(random_bytes(8)) . '.jpg';
        $thumbUrl  = R2Uploader::put($tmpThumb, $thumbName, 'image/jpeg');
        $update->execute([':url' => $thumbUrl, ':id' => $userId]);
        $updated++;
    } catch (\Throwable $e) {
        $skipped++;
        $errors[] = "user={$userId}: upload/update failed - " . $e->getMessage();
    } finally {
        @unlink($tmpThumb);
    }
}

// How many remain? Helps the operator know whether to click again.
$remaining = (int) $pdo->query("
    SELECT COUNT(*)
    FROM users
    WHERE deleted_at IS NULL
      AND profile_photo_url       IS NOT NULL
      AND profile_thumb_photo_url IS NULL
")->fetchColumn();

$totalMs = (int) round((microtime(true) - $started) * 1000);

if (!empty($errors)) {
    error_log('[admin-thumbs-backfill] errors: ' . implode(' | ', array_slice($errors, 0, 10)));
}

// Surface the actual error reasons when nothing succeeded - without
// this the operator stares at "10 skipped" with no signal as to why
// (download failure, GD missing, unsupported MIME, etc.).
$detail = '';
if ($updated === 0 && !empty($errors)) {
    $detail = ' First errors: ' . implode(' | ', array_slice($errors, 0, 3));
}

$flashType = ($updated === 0 && $skipped > 0) ? 'error' : 'success';
flash_set($flashType, sprintf(
    'Thumbnails backfilled: %d updated, %d skipped, %d remaining (%dms).%s%s',
    $updated,
    $skipped,
    $remaining,
    $totalMs,
    $remaining > 0 && $updated > 0 ? ' Click again to continue.' : '',
    $detail,
));
admin_redirect('/admin');
