<?php

declare(strict_types=1);

/**
 * Image utilities - currently just avatar thumbnail generation.
 *
 * Was a free function in routes/api.php; lifted into a class so the
 * admin thumb-backfill tool (which doesn't load routes/api.php) can
 * call the same code path the upload route uses. No state, no DB,
 * no R2 - pure pixel pushing on a local filesystem.
 */
class ImageProcessor
{
    /**
     * Last failure reason from generateAvatarThumbnail(). Set on every
     * null return so the caller can surface "why" without re-running
     * the pipeline. Wiped to null at the start of each successful call.
     */
    public static ?string $lastError = null;

    /**
     * Scale the source image down to ≤$maxDim px on its longest side
     * and re-encode as JPEG (quality $quality). Returns the path to a
     * temporary file on success, or null on any failure (missing GD,
     * unsupported MIME, decoder error, encoder error). Inspect
     * self::$lastError for the specific reason.
     *
     * Callers MUST unlink the returned path when done with it.
     *
     * Safe to call on any valid image - if the source is already
     * smaller than $maxDim, it is re-encoded as JPEG but not enlarged.
     */
    public static function generateAvatarThumbnail(
        string $srcPath,
        string $srcMime,
        int $maxDim = 400,
        int $quality = 80,
    ): ?string {
        self::$lastError = null;

        if (!extension_loaded('gd')) {
            self::$lastError = 'GD extension not loaded';
            return null;
        }

        $info = @getimagesize($srcPath);
        if (!$info || empty($info[0]) || empty($info[1])) {
            $err = error_get_last()['message'] ?? 'unknown';
            self::$lastError = "getimagesize failed: {$err}";
            return null;
        }

        [$srcW, $srcH] = $info;

        $src = match ($srcMime) {
            'image/jpeg' => @imagecreatefromjpeg($srcPath),
            'image/png'  => @imagecreatefrompng($srcPath),
            'image/webp' => @imagecreatefromwebp($srcPath),
            default      => null,
        };
        if (!$src) {
            $err  = error_get_last()['message'] ?? 'unknown';
            $size = filesize($srcPath) ?: 0;
            self::$lastError = sprintf(
                'imagecreatefrom* failed (mime=%s, dims=%dx%d, size=%d): %s',
                $srcMime, $srcW, $srcH, $size, $err,
            );
            return null;
        }

        if ($srcW >= $srcH) {
            $newW = min($srcW, $maxDim);
            $newH = (int) round($srcH * $newW / $srcW);
        } else {
            $newH = min($srcH, $maxDim);
            $newW = (int) round($srcW * $newH / $srcH);
        }

        $dst = imagecreatetruecolor($newW, $newH);
        if (!$dst) {
            imagedestroy($src);
            self::$lastError = "imagecreatetruecolor({$newW}x{$newH}) failed";
            return null;
        }

        // Preserve transparency for PNG sources - flatten onto white
        // because the destination is JPEG (no alpha channel).
        imagealphablending($dst, false);
        imagesavealpha($dst, true);
        $white = imagecolorallocate($dst, 255, 255, 255);
        imagefilledrectangle($dst, 0, 0, $newW, $newH, $white);
        imagealphablending($dst, true);

        imagecopyresampled($dst, $src, 0, 0, 0, 0, $newW, $newH, $srcW, $srcH);

        $tmpPath = tempnam(sys_get_temp_dir(), 'hilads_thumb_');
        $ok      = imagejpeg($dst, $tmpPath, $quality);

        imagedestroy($src);
        imagedestroy($dst);

        if (!$ok) {
            @unlink($tmpPath);
            self::$lastError = 'imagejpeg encoder failed';
            return null;
        }

        return $tmpPath;
    }
}
