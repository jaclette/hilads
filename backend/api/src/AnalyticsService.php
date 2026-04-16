<?php

declare(strict_types=1);

/**
 * PostHog server-side analytics.
 *
 * Usage:
 *   AnalyticsService::capture('user_registered', $userId, ['city' => 'paris']);
 *   AnalyticsService::defer('joined_city', $guestId, [...]);  // runs after response is sent
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
            'api_key'     => $apiKey,
            'event'       => $event,
            'distinct_id' => $distinctId,
            'properties'  => $properties,
            'timestamp'   => gmdate('c'),
        ]);

        try {
            $ch = curl_init("{$host}/capture/");
            curl_setopt_array($ch, [
                CURLOPT_POST           => true,
                CURLOPT_POSTFIELDS     => $payload,
                CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
                CURLOPT_RETURNTRANSFER => false, // don't buffer response — fire and forget
                // Keep timeouts short: this call runs post-fastcgi_finish_request so it is
                // normally invisible to the client. If the flush ever fails and this runs
                // synchronously, 500 ms caps the worst-case damage instead of 2 s.
                CURLOPT_TIMEOUT_MS        => 500,
                CURLOPT_CONNECTTIMEOUT_MS => 300,
                CURLOPT_NOSIGNAL          => 1, // required when using ms timeouts under 1 s
            ]);
            curl_exec($ch);
            curl_close($ch);
        } catch (\Throwable $e) {
            error_log('[analytics] capture failed: ' . $e->getMessage());
        }
    }

    /**
     * Schedule a capture to run AFTER the HTTP response is sent to the client.
     *
     * Uses PHP's shutdown hook + fastcgi_finish_request() so the analytics
     * HTTP call is completely off the critical path — the client receives the
     * response immediately, then the PHP-FPM worker fires the PostHog call
     * in the background.
     *
     * Falls back to a short-timeout synchronous call when fastcgi_finish_request()
     * is unavailable (Apache/mod_php), capping the overhead at ~300 ms.
     */
    public static function defer(string $event, string $distinctId, array $properties = []): void
    {
        if (!getenv('POSTHOG_API_KEY')) {
            return;
        }

        // Snapshot scalar values so the closure holds no large object references.
        $e = $event;
        $d = $distinctId;
        $p = $properties;

        register_shutdown_function(static function () use ($e, $d, $p): void {
            // Flush the response buffer and close the FPM connection to the
            // web server — the client receives its response here, before the
            // analytics HTTP call begins.
            if (function_exists('fastcgi_finish_request')) {
                fastcgi_finish_request();
            }

            AnalyticsService::capture($e, $d, $p);
        });
    }
}
