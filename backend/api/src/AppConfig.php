<?php

declare(strict_types=1);

/**
 * App-wide switches read from the environment (V3-04), all off or empty by
 * default so nothing changes until the founder sets them on Render:
 *   CHALLENGE_CREATION_CLOSED  "1" when 1.8.0 ships: user challenge creation
 *                              becomes read-only (SPEC 9.10).
 *   APP_LATEST_VERSION         e.g. "1.8.0": older apps show "Update available".
 *   APP_MIN_VERSION            e.g. "1.8.0": older apps show "Update required".
 * The app sends X-App-Version from 1.8.0 and reads GET /api/v1/app/config.
 */
final class AppConfig
{
    public const STORE_URLS = [
        'ios'     => 'https://apps.apple.com/app/id6768905591',
        'android' => 'https://play.google.com/store/apps/details?id=com.hilads.app',
    ];

    /** Shown as is by older apps on a blocked create call: keep it a plain sentence. */
    public const CHALLENGE_CLOSED_MESSAGE =
        'Creating challenges is no longer available in this version. Update Hilads to get the Daily Challenge.';

    public static function challengeCreationClosed(): bool
    {
        return in_array(strtolower(trim((string) getenv('CHALLENGE_CREATION_CLOSED'))), ['1', 'true', 'on', 'yes'], true);
    }

    /** A "major.minor.patch" version from the environment, else null. */
    public static function version(string $env): ?string
    {
        return self::parseVersion(getenv($env) ?: null);
    }

    /** "1.8" or "1.8.0" → "1.8.0"; anything else → null. */
    public static function parseVersion(?string $v): ?string
    {
        $v = trim((string) $v);
        if (!preg_match('/^(\d{1,4})\.(\d{1,4})(?:\.(\d{1,4}))?$/', $v, $m)) {
            return null;
        }
        return (int) $m[1] . '.' . (int) $m[2] . '.' . (int) ($m[3] ?? 0);
    }

    /** Is $version older than $than? Both "x.y.z". */
    public static function isOlder(string $version, string $than): bool
    {
        return version_compare($version, $than, '<');
    }

    /** GET /app/config payload. */
    public static function payload(): array
    {
        return [
            'minVersion'              => self::version('APP_MIN_VERSION'),
            'latestVersion'           => self::version('APP_LATEST_VERSION'),
            'storeUrls'               => self::STORE_URLS,
            'challengeCreationClosed' => self::challengeCreationClosed(),
        ];
    }
}
