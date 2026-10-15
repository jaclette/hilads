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

    /**
     * Re-encode an uploaded image so NO metadata survives (EXIF, GPS, XMP,
     * PNG text chunks): GD decodes to raw pixels and writes a fresh file in
     * the same format. The JPEG EXIF orientation is applied first so the
     * pixels end up upright once the tag is gone (needs the exif extension;
     * without it the image is still stripped, just not rotated).
     *
     * Returns the path to a temporary file (caller MUST unlink it), or null
     * on any failure with the reason in self::$lastError. Callers fail closed:
     * an image that cannot be stripped is never stored.
     */
    public static function stripMetadata(string $srcPath, string $srcMime): ?string
    {
        self::$lastError = null;

        if (!extension_loaded('gd')) {
            self::$lastError = 'GD extension not loaded';
            return null;
        }

        $img = match ($srcMime) {
            'image/jpeg' => @imagecreatefromjpeg($srcPath),
            'image/png'  => @imagecreatefrompng($srcPath),
            'image/webp' => @imagecreatefromwebp($srcPath),
            default      => null,
        };
        if (!$img) {
            self::$lastError = "decode failed (mime={$srcMime}): " . (error_get_last()['message'] ?? 'unknown');
            return null;
        }

        if ($srcMime === 'image/jpeg' && function_exists('exif_read_data')) {
            $exif = @exif_read_data($srcPath);
            $img  = self::applyOrientation($img, (int) ($exif['Orientation'] ?? 1));
        }

        if ($srcMime !== 'image/jpeg') {
            imagealphablending($img, false);
            imagesavealpha($img, true);
        }

        $tmpPath = tempnam(sys_get_temp_dir(), 'hilads_strip_');
        $ok = match ($srcMime) {
            'image/jpeg' => imagejpeg($img, $tmpPath, 88),
            'image/png'  => imagepng($img, $tmpPath, 6),
            'image/webp' => imagewebp($img, $tmpPath, 85),
        };
        imagedestroy($img);

        if (!$ok) {
            @unlink($tmpPath);
            self::$lastError = "encode failed (mime={$srcMime})";
            return null;
        }

        return $tmpPath;
    }

    /** Rotate/flip pixels per the EXIF Orientation tag (1 = already upright). */
    private static function applyOrientation(\GdImage $img, int $orientation): \GdImage
    {
        // imagerotate() turns counter-clockwise: 270 = a quarter turn clockwise.
        $rotate = fn(\GdImage $i, int $deg): \GdImage => imagerotate($i, $deg, 0) ?: $i;

        switch ($orientation) {
            case 2: imageflip($img, IMG_FLIP_HORIZONTAL); break;
            case 3: $img = $rotate($img, 180); break;
            case 4: imageflip($img, IMG_FLIP_VERTICAL); break;
            case 5: $img = $rotate($img, 270); imageflip($img, IMG_FLIP_HORIZONTAL); break;
            case 6: $img = $rotate($img, 270); break;
            case 7: $img = $rotate($img, 270); imageflip($img, IMG_FLIP_VERTICAL); break;
            case 8: $img = $rotate($img, 90); break;
        }
        return $img;
    }
}
