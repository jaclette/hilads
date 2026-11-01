<?php

declare(strict_types=1);

/**
 * Image utilities: upload clean-up (metadata, orientation, 1600 px cap), the
 * served sizes (VARIANTS) and the map pin.
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

    /** Uploads are stored at most this long on their longer side, at this quality (JPEG / WebP). */
    public const UPLOAD_MAX_DIM = 1600;
    public const UPLOAD_QUALITY = 75;

    /**
     * The sizes GET /api/v1/img-thumb serves, made at upload and by
     * scripts/images_backfill.php too, each cached on R2 as
     * <prefix><base>.jpg|.webp: [prefix, max px, bound the shorter side, JPEG q, WebP q].
     */
    public const VARIANTS = [
        'thumb'  => ['thumb_',       400,  false, 80, 76],   // cards, tiles, avatars, insets
        'medium' => ['thumb_w1080_', 1080, false, 80, 72],   // full-screen viewers
        'c600'   => ['thumb_c600_',  600,  true,  78, 65],   // hero covers, 1x
        'c800'   => ['thumb_c800_',  800,  true,  78, 65],   // hero covers, 2x+
        'c1000'  => ['thumb_c1000_', 1000, true,  78, 65],   // hero covers, older apps
    ];

    /**
     * A photo's placeholder: its thumbhash (base64, ~25 bytes), a blurred
     * preview the apps draw while it loads; null when the image can't be read.
     */
    public static function thumbhash(string $srcPath, string $srcMime): ?string
    {
        $img = match ($srcMime) {
            'image/jpeg' => @imagecreatefromjpeg($srcPath),
            'image/png'  => @imagecreatefrompng($srcPath),
            'image/webp' => @imagecreatefromwebp($srcPath),
            default      => false,
        };
        if (!$img) {
            return null;
        }
        // At most 100 px: thumbhash keeps a handful of colours, more pixels only cost time.
        $w = imagesx($img);
        $h = imagesy($img);
        $scale = min(1, 100 / max($w, $h));
        $small = imagescale($img, max(1, (int) round($w * $scale)), max(1, (int) round($h * $scale)), IMG_BILINEAR_FIXED);
        imagedestroy($img);
        if ($small === false) {
            return null;
        }
        $w = imagesx($small);
        $h = imagesy($small);
        $rgba = [];
        for ($y = 0; $y < $h; $y++) {
            for ($x = 0; $x < $w; $x++) {
                $c = imagecolorat($small, $x, $y);
                $rgba[] = ($c >> 16) & 0xFF;
                $rgba[] = ($c >> 8) & 0xFF;
                $rgba[] = $c & 0xFF;
                $rgba[] = 255 - ((($c >> 24) & 0x7F) << 1);   // GD alpha: 0 opaque … 127 transparent
            }
        }
        imagedestroy($small);
        try {
            return \Thumbhash\Thumbhash::convertHashToString(\Thumbhash\Thumbhash::RGBAToHash($w, $h, $rgba));
        } catch (\Throwable) {
            return null;
        }
    }

    /** The R2 name of a size of the upload <base> (its 32 hex chars). */
    public static function variantName(string $key, string $base, bool $webp): string
    {
        return self::VARIANTS[$key][0] . strtolower($base) . ($webp ? '.webp' : '.jpg');
    }

    /** One size of an image (VARIANTS key), as a temporary file the caller unlinks, or null (see $lastError). */
    public static function variant(string $srcPath, string $srcMime, string $key, bool $webp): ?string
    {
        [, $dim, $short, $jpegQ, $webpQ] = self::VARIANTS[$key];
        return self::generateAvatarThumbnail($srcPath, $srcMime, $dim, $webp ? $webpQ : $jpegQ, $short, $webp);
    }

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
     *
     * $shortSide: bound the SHORTER side instead (a cover cropped to fill
     * its frame keeps enough pixels whichever way the photo was taken).
     */
    public static function generateAvatarThumbnail(
        string $srcPath,
        string $srcMime,
        int $maxDim = 400,
        int $quality = 80,
        bool $shortSide = false,
        bool $webp = false,
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

        if ($shortSide) {
            $scale = min(1, $maxDim / min($srcW, $srcH));
            $newW  = max(1, (int) round($srcW * $scale));
            $newH  = max(1, (int) round($srcH * $scale));
        } elseif ($srcW >= $srcH) {
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
        $ok      = $webp ? imagewebp($dst, $tmpPath, $quality) : imagejpeg($dst, $tmpPath, $quality);

        imagedestroy($src);
        imagedestroy($dst);

        if (!$ok) {
            @unlink($tmpPath);
            self::$lastError = ($webp ? 'imagewebp' : 'imagejpeg') . ' encoder failed';
            return null;
        }

        return $tmpPath;
    }

    /**
     * Re-encode an uploaded image so NO metadata survives (EXIF, GPS, XMP,
     * PNG text chunks): GD decodes to raw pixels and writes a fresh file in
     * the same format. The JPEG EXIF orientation is applied first so the
     * pixels end up upright once the tag is gone (needs the exif extension;
     * without it the image is still stripped, just not rotated). It is also
     * scaled down to $maxDim px on its longer side and saved at quality 75.
     *
     * Returns the path to a temporary file (caller MUST unlink it), or null
     * on any failure with the reason in self::$lastError. Callers fail closed:
     * an image that cannot be stripped is never stored.
     */
    public static function stripMetadata(string $srcPath, string $srcMime, int $maxDim = self::UPLOAD_MAX_DIM): ?string
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

        // Never stored longer than $maxDim on its longer side (a phone's 4032 px original weighs MBs).
        $w = imagesx($img);
        $h = imagesy($img);
        if (max($w, $h) > $maxDim) {
            $scale  = $maxDim / max($w, $h);
            $scaled = imagescale($img, max(1, (int) round($w * $scale)), max(1, (int) round($h * $scale)), IMG_BICUBIC);
            if ($scaled !== false) {
                imagedestroy($img);
                $img = $scaled;
            }
        }

        if ($srcMime !== 'image/jpeg') {
            imagealphablending($img, false);
            imagesavealpha($img, true);
        }

        $tmpPath = tempnam(sys_get_temp_dir(), 'hilads_strip_');
        $ok = match ($srcMime) {
            'image/jpeg' => imagejpeg($img, $tmpPath, self::UPLOAD_QUALITY),
            'image/png'  => imagepng($img, $tmpPath, 6),
            'image/webp' => imagewebp($img, $tmpPath, self::UPLOAD_QUALITY),
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
    /**
     * A map pin photo: the image's centre square as a disc of $size px with a
     * white ring, transparent outside (anti-aliased edges). PNG temp file, or null.
     */
    public static function circlePin(string $srcPath, string $srcMime, int $size = 72, int $ring = 5): ?string
    {
        if (!extension_loaded('gd')) {
            return null;
        }
        $src = match ($srcMime) {
            'image/jpeg' => @imagecreatefromjpeg($srcPath),
            'image/png'  => @imagecreatefrompng($srcPath),
            'image/webp' => @imagecreatefromwebp($srcPath),
            default      => null,
        };
        if (!$src) {
            return null;
        }
        $w = imagesx($src);
        $h = imagesy($src);
        $side = min($w, $h);
        $photo = imagecreatetruecolor($size, $size);
        imagecopyresampled($photo, $src, 0, 0, intdiv($w - $side, 2), intdiv($h - $side, 2), $size, $size, $side, $side);
        imagedestroy($src);

        $out = imagecreatetruecolor($size, $size);
        imagealphablending($out, false);
        imagesavealpha($out, true);
        $r     = $size / 2;
        $inner = $r - $ring;
        for ($y = 0; $y < $size; $y++) {
            for ($x = 0; $x < $size; $x++) {
                $d = hypot($x + 0.5 - $r, $y + 0.5 - $r);
                // Coverage of the disc (outer edge) and of the photo (inner edge), 0..1.
                $disc = max(0.0, min(1.0, $r - $d + 0.5));
                if ($disc <= 0.0) {
                    imagesetpixel($out, $x, $y, imagecolorallocatealpha($out, 255, 255, 255, 127));
                    continue;
                }
                $p   = max(0.0, min(1.0, $inner - $d + 0.5));
                $rgb = imagecolorat($photo, $x, $y);
                $cr  = (int) round((($rgb >> 16) & 0xFF) * $p + 255 * (1 - $p));
                $cg  = (int) round((($rgb >> 8) & 0xFF) * $p + 255 * (1 - $p));
                $cb  = (int) round(($rgb & 0xFF) * $p + 255 * (1 - $p));
                imagesetpixel($out, $x, $y, imagecolorallocatealpha($out, $cr, $cg, $cb, (int) round(127 * (1 - $disc))));
            }
        }
        imagedestroy($photo);
        $tmp = tempnam(sys_get_temp_dir(), 'pin');
        $ok  = imagepng($out, $tmp, 6);
        imagedestroy($out);
        return $ok ? $tmp : null;
    }
}
