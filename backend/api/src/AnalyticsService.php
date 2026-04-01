<?php

declare(strict_types=1);

/**
 * PostHog server-side analytics.
 *
 * Usage:
 *   AnalyticsService::capture('user_registered', $userId, ['city' => 'paris']);
 *
 * Fire-and-forget: failures are logged but never fatal.
 */
class AnalyticsService
{
    public static function capture(string $event, string $distinctId, array $properties = []): void
    {
        $apiKey = getenv('POSTHOG_API_KEY');
        $host   = rtrim(getenv('POSTHOG_HOST') ?: 'https://eu.i.posthog.com', '/');

        if (!$apiKey) {
            return;
        }

        $properties['platform'] = 'backend';

        $payload = json_encode([
            'api_key'    => $apiKey,
            'event'      => $event,
            'distinct_id' => $distinctId,
            'properties' => $properties,
            'timestamp'  => gmdate('c'),
        ]);

        try {
            $ch = curl_init("{$host}/capture/");
            curl_setopt_array($ch, [
                CURLOPT_POST           => true,
                CURLOPT_POSTFIELDS     => $payload,
                CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_TIMEOUT        => 2,
                CURLOPT_CONNECTTIMEOUT => 2,
            ]);
            curl_exec($ch);
            curl_close($ch);
        } catch (\Throwable $e) {
            error_log('[analytics] capture failed: ' . $e->getMessage());
        }
    }
}
