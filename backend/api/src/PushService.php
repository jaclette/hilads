<?php

declare(strict_types=1);

use Minishlink\WebPush\WebPush;
use Minishlink\WebPush\Subscription;

class PushService
{
    /** Map notification type → notification_preferences column. null = never push. */
    private static function prefColumn(string $type): ?string
    {
        return match ($type) {
            'dm_message'    => 'dm_push',
            'event_message' => 'event_message_push',
            'event_join'    => 'event_join_push',
            'new_event'     => 'new_event_push',
            'vibe_received' => 'vibe_received_push',
            'profile_view'  => 'profile_view_push',
            default         => null,
        };
    }

    /**
     * Attempt to deliver a web push for a notification.
     *
     * - Silently exits if VAPID keys are not configured.
     * - Checks the user's push preference for this notification type.
     * - Deletes subscriptions that return 404/410 (expired or unsubscribed).
     * - All errors are swallowed — the in-app notification is already persisted.
     */
    public static function send(
        string  $userId,
        string  $type,
        string  $title,
        ?string $body,
        string  $url,
        string  $tag,
        array   $data = []
    ): void {
        $vapidPublic  = getenv('VAPID_PUBLIC_KEY')  ?: null;
        $vapidPrivate = getenv('VAPID_PRIVATE_KEY') ?: null;

        if (!$vapidPublic || !$vapidPrivate) {
            return; // Web push not configured — skip silently
        }

        $prefColumn = self::prefColumn($type);
        if ($prefColumn === null) {
            return; // Unknown type — no push
        }

        // Check user preference (row may not exist for new users — fall back to coded defaults)
        try {
            $prefStmt = Database::pdo()->prepare(
                "SELECT $prefColumn FROM notification_preferences WHERE user_id = ?"
            );
            $prefStmt->execute([$userId]);
            $prefRow = $prefStmt->fetch(\PDO::FETCH_ASSOC);

            $defaults = ['dm_push' => true, 'event_message_push' => true, 'new_event_push' => false, 'vibe_received_push' => true, 'profile_view_push' => true];
            $enabled  = $prefRow ? (bool) ($prefRow[$prefColumn] ?? $defaults[$prefColumn] ?? true) : ($defaults[$prefColumn] ?? false);

            if (!$enabled) return;
        } catch (\Throwable) {
            return;
        }

        // Load subscriptions, then exclude any endpoint shared with the sender.
        try {
            $subStmt = Database::pdo()->prepare(
                "SELECT id, endpoint, p256dh, auth_key FROM push_subscriptions WHERE user_id = ?"
            );
            $subStmt->execute([$userId]);
            $subs = $subStmt->fetchAll(\PDO::FETCH_ASSOC);
        } catch (\Throwable) {
            return;
        }

        if (empty($subs)) return;

        // Remove subscriptions whose endpoint is also registered under the sender.
        $senderUserId = ($data ?? [])['senderUserId'] ?? null;
        if ($senderUserId !== null && $senderUserId !== $userId) {
            try {
                $senderEndpointStmt = Database::pdo()->prepare(
                    "SELECT endpoint FROM push_subscriptions WHERE user_id = ?"
                );
                $senderEndpointStmt->execute([$senderUserId]);
                $senderEndpoints = array_flip($senderEndpointStmt->fetchAll(\PDO::FETCH_COLUMN));
                if (!empty($senderEndpoints)) {
                    $subs = array_values(array_filter($subs, fn($s) => !isset($senderEndpoints[$s['endpoint']])));
                }
            } catch (\Throwable) { /* non-fatal */ }
        }

        try {
            $webPush = new WebPush(
                ['VAPID' => [
                    'subject'    => getenv('VAPID_SUBJECT') ?: 'mailto:hello@hilads.com',
                    'publicKey'  => $vapidPublic,
                    'privateKey' => $vapidPrivate,
                ]],
                ['TTL' => 86400],
                5 // 5-second timeout per push request
            );

            $payload = json_encode([
                'title' => $title,
                'body'  => $body ?? '',
                'url'   => $url,
                'tag'   => $tag,
            ]);

            // Index subscriptions by endpoint for cleanup
            $endpointToId = array_column($subs, 'id', 'endpoint');

            foreach ($subs as $sub) {
                $webPush->queueNotification(
                    new Subscription($sub['endpoint'], $sub['p256dh'], $sub['auth_key'], 'aesgcm'),
                    $payload
                );
            }

            $expiredIds = [];
            foreach ($webPush->flush() as $report) {
                if ($report->isExpired()) {
                    $ep = $report->getEndpoint();
                    if (isset($endpointToId[$ep])) {
                        $expiredIds[] = $endpointToId[$ep];
                    }
                }
            }

            // Clean up dead subscriptions
            if (!empty($expiredIds)) {
                $placeholders = implode(',', array_fill(0, count($expiredIds), '?'));
                Database::pdo()
                    ->prepare("DELETE FROM push_subscriptions WHERE id IN ($placeholders)")
                    ->execute($expiredIds);
            }
        } catch (\Throwable) {
            // Non-fatal — in-app notification is already created
        }
    }
}
