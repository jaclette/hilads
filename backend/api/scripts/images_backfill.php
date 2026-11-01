<?php
/**
 * One-off: the stored sizes of every upload already on R2 (new uploads get
 * them at upload time, R2Uploader::putVariants).
 *
 *   php scripts/images_backfill.php                       # dry run: what's missing, nothing written
 *   php scripts/images_backfill.php --apply               # make the missing WebP sizes
 *   php scripts/images_backfill.php --apply --resize-originals
 *                                                         # also shrink originals over 1600 px (quality 75,
 *                                                         # metadata stripped again), each first copied to
 *                                                         # backup/originals/<name>
 *   --limit=N   stop after N originals handled (run again to resume: done work is skipped)
 *   php scripts/images_backfill.php --hashes              # only the photo placeholders (thumbhash) still
 *                                                         # missing on daily photos (the tick does 30 / 5 min)
 *
 * Sizes made (ImageProcessor::VARIANTS, WebP): thumb + medium for every upload,
 * c600 + c800 for the challenge covers. Safe to rerun: a size already on R2 is
 * never redone, an original with a backup was already shrunk.
 */

declare(strict_types=1);

$args   = array_slice($argv, 1);
$apply  = in_array('--apply', $args, true);
$resize = in_array('--resize-originals', $args, true);
$hashes = in_array('--hashes', $args, true);
$limit  = null;
foreach ($args as $a) {
    if (str_starts_with($a, '--limit=')) {
        $limit = max(1, (int) substr($a, 8));
    }
}

$envFile = __DIR__ . '/../.env';
if (file_exists($envFile)) {
    foreach (file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        if (preg_match('/^([A-Z0-9_]+)=(.*)$/', trim($line), $m) && getenv($m[1]) === false) {
            putenv($m[1] . '=' . trim($m[2], "\"' "));
        }
    }
}

require_once __DIR__ . '/../vendor/autoload.php';
foreach (['Database', 'R2Uploader', 'ImageProcessor', 'DailyProofRepository'] as $class) {
    require_once __DIR__ . "/../src/{$class}.php";
}

if ($hashes) {
    $total = ['copied' => 0, 'computed' => 0, 'failed' => 0];
    do {
        $r = DailyProofRepository::fillHashes(200);
        foreach ($total as $k => $_) $total[$k] += $r[$k] ?? 0;
        fwrite(STDERR, "… {$total['computed']} computed, {$total['failed']} unreadable\n");
        if (isset($r['error'])) {
            fwrite(STDERR, "FAILED: {$r['error']}\n");
            exit(1);
        }
    } while (($r['computed'] + $r['failed']) > 0);
    printf("placeholders: %d copied from uploads, %d computed, %d unreadable\n", $total['copied'], $total['computed'], $total['failed']);
    exit(0);
}

const BACKUP = 'backup/originals/';

// An image's size from its first 64 kB (a Range request), or null.
function headDims(string $url): ?array
{
    $ctx  = stream_context_create(['http' => ['header' => "Range: bytes=0-65535\r\n", 'timeout' => 20]]);
    $head = @file_get_contents($url, false, $ctx, 0, 65536);
    $info = $head ? @getimagesizefromstring($head) : false;
    return $info ? [(int) $info[0], (int) $info[1]] : null;
}
$kb = static fn(int $b): string => number_format($b / 1024, 0) . ' kB';

fwrite(STDERR, ($apply ? 'APPLY' : 'DRY RUN') . ($resize ? ' + resize originals' : '') . "\n");
$keys = R2Uploader::listKeys();
$originals = array_filter($keys, static fn($size, $k) => preg_match('/^[a-f0-9]{32}\.(jpe?g|png|webp)$/', (string) $k) === 1, ARRAY_FILTER_USE_BOTH);
ksort($originals);

// The challenge covers also get the hero sizes.
$covers = [];
foreach (Database::pdo()->query("SELECT cover_url FROM daily_challenges WHERE cover_url IS NOT NULL")->fetchAll(PDO::FETCH_COLUMN) as $url) {
    $covers[basename((string) parse_url((string) $url, PHP_URL_PATH))] = true;
}

$stats = ['originals' => count($originals), 'sizes_missing' => 0, 'sizes_made' => 0, 'failed' => 0,
          'resize_candidates' => 0, 'resized' => 0, 'bytes_before' => 0, 'bytes_after' => 0];
fwrite(STDERR, sprintf("%d objects, %d uploads, %d covers\n", count($keys), count($originals), count($covers)));

$handled = 0;
foreach ($originals as $name => $size) {
    $base    = pathinfo($name, PATHINFO_FILENAME);
    $wanted  = isset($covers[$name]) ? ['thumb', 'medium', 'c600', 'c800'] : ['thumb', 'medium'];
    $missing = array_values(array_filter($wanted, static fn($k) => !isset($keys[ImageProcessor::variantName($k, $base, true)])));
    // Over 1600 px can't be told from the listing: anything above 400 kB has its size read from its first bytes.
    $maybeBig = $resize && $size > 400 * 1024 && !isset($keys[BACKUP . $name]);
    if ($maybeBig) {
        $dims     = headDims(R2Uploader::publicUrl($name));
        $maybeBig = $dims === null || max($dims) > ImageProcessor::UPLOAD_MAX_DIM;
    }
    if (!$missing && !$maybeBig) {
        continue;
    }
    if ($limit !== null && $handled >= $limit) {
        break;
    }
    $handled++;
    $stats['sizes_missing'] += count($missing);
    if (!$apply && !$maybeBig) {
        continue;
    }

    $src = tempnam(sys_get_temp_dir(), 'bf_');
    try {
        $bytes = @file_get_contents(R2Uploader::publicUrl($name));
        if ($bytes === false || $bytes === '') {
            throw new RuntimeException('download failed');
        }
        file_put_contents($src, $bytes);
        $mime = (new finfo(FILEINFO_MIME_TYPE))->file($src) ?: 'image/jpeg';
        $info = @getimagesize($src);

        if ($maybeBig && $info && max($info[0], $info[1]) > ImageProcessor::UPLOAD_MAX_DIM) {
            $stats['resize_candidates']++;
            $stats['bytes_before'] += strlen($bytes);
            $clean = ImageProcessor::stripMetadata($src, $mime);
            if ($clean === null) {
                throw new RuntimeException('resize failed: ' . ImageProcessor::$lastError);
            }
            $stats['bytes_after'] += (int) filesize($clean);
            if ($apply) {
                R2Uploader::copy($name, BACKUP . $name);
                R2Uploader::put($clean, $name, $mime);
                rename($clean, $src);   // the sizes below come from the smaller file
                $stats['resized']++;
                printf("resized %s %dx%d %s -> %s\n", $name, $info[0], $info[1], $kb(strlen($bytes)), $kb((int) filesize($src)));
            } else {
                @unlink($clean);
            }
        }

        if ($apply) {
            foreach ($missing as $key) {
                $tmp = ImageProcessor::variant($src, $mime, $key, true);
                if ($tmp === null) {
                    throw new RuntimeException("{$key} failed: " . ImageProcessor::$lastError);
                }
                try {
                    R2Uploader::put($tmp, ImageProcessor::variantName($key, $base, true), 'image/webp');
                    $stats['sizes_made']++;
                } finally {
                    @unlink($tmp);
                }
            }
        }
    } catch (Throwable $e) {
        $stats['failed']++;
        fwrite(STDERR, "FAILED {$name}: {$e->getMessage()}\n");
    } finally {
        @unlink($src);
    }
    if ($handled % 50 === 0) {
        fwrite(STDERR, "… {$handled} handled\n");
    }
}

printf("uploads: %d, handled: %d, sizes missing: %d, made: %d, failed: %d\n",
    $stats['originals'], $handled, $stats['sizes_missing'], $stats['sizes_made'], $stats['failed']);
if ($resize) {
    printf("originals over %d px: %d (%s -> %s), replaced: %d\n", ImageProcessor::UPLOAD_MAX_DIM, $stats['resize_candidates'],
        $kb($stats['bytes_before']), $kb($stats['bytes_after']), $stats['resized']);
}
if (!$apply) {
    echo "Dry run: nothing written. Add --apply to make them.\n";
}
