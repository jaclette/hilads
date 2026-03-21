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
            throw new RuntimeException('R2 upload failed: ' . $e->getAwsErrorMessage());
        }

        return rtrim(getenv('R2_PUBLIC_URL'), '/') . '/' . $filename;
    }
}
