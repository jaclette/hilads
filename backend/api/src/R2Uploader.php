<?php

declare(strict_types=1);

use Aws\S3\S3Client;
use Aws\Exception\AwsException;

class R2Uploader
{
    private static ?S3Client $client = null;

    private static function client(): S3Client
    {
        if (self::$client !== null) {
            return self::$client;
        }

        $accountId = getenv('R2_ACCOUNT_ID');

        self::$client = new S3Client([
            'version'                 => 'latest',
            'region'                  => 'auto',
            'endpoint'                => 'https://' . $accountId . '.r2.cloudflarestorage.com',
            'credentials'             => [
                'key'    => getenv('R2_ACCESS_KEY_ID'),
                'secret' => getenv('R2_SECRET_ACCESS_KEY'),
            ],
            'use_path_style_endpoint' => true,
        ]);

        return self::$client;
    }

    /**
     * Upload a local file to R2 and return its public URL.
     *
     * @throws RuntimeException on upload failure
     */
    public static function put(string $tmpPath, string $filename, string $mimeType): string
    {
        try {
            self::client()->putObject([
                'Bucket'      => getenv('R2_BUCKET'),
                'Key'         => $filename,
                'SourceFile'  => $tmpPath,
                'ContentType' => $mimeType,
            ]);
        } catch (AwsException $e) {
            error_log('[hilads] R2 upload failed: ' . ($e->getAwsErrorMessage() ?: $e->getMessage()));
            throw new RuntimeException('Upload failed');
        }

        return rtrim(getenv('R2_PUBLIC_URL'), '/') . '/' . $filename;
    }

    /**
     * Rewrite an uploaded-image URL to point at the on-the-fly thumbnail proxy
     * (`/api/v1/img-thumb?f=…`) so feeds never serve the full original. This is
     * the server-side mirror of the client `thumbUrl()` helper - applying it at
     * the API boundary means EVERY client (web + native, any deploy) gets the
     * ≤400px JPEG, and a newly-added avatar render site can't regress.
     *
     * Only rewrites URLs whose basename is our deterministic `<32hex>.<ext>`
     * upload name (the only form the proxy accepts). Already-small pre-generated
     * `thumb_<base>.jpg` names, external avatars, and nulls pass through
     * unchanged. Returns null/'' unchanged so "no photo → initial" still works.
     */
    public static function thumbProxy(?string $url): ?string
    {
        if ($url === null || $url === '') {
            return $url;
        }
        $base = basename((string) (parse_url($url, PHP_URL_PATH) ?? $url));
        if (!preg_match('/^[a-f0-9]{32}\.(jpe?g|png|webp)$/i', $base)) {
            return $url;
        }
        // The JSON is served from the same host that exposes the proxy route, so
        // derive the absolute base from the current request; fall back to the
        // public API host for non-HTTP contexts (cron/CLI).
        $host = $_SERVER['HTTP_HOST'] ?? '';
        $apiBase = $host !== ''
            ? 'https://' . $host
            : rtrim(getenv('API_PUBLIC_URL') ?: 'https://api.hilads.live', '/');
        return $apiBase . '/api/v1/img-thumb?f=' . strtolower($base);
    }
}
