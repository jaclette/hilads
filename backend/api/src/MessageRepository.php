<?php

declare(strict_types=1);

class MessageRepository
{
    private static function filePath(int $channelId): string
    {
        return __DIR__ . '/../storage/messages_' . $channelId . '.json';
    }

    public static function getByChannel(int $channelId): array
    {
        $path = self::filePath($channelId);

        if (!file_exists($path)) {
            return [];
        }

        $data = json_decode(file_get_contents($path), true);

        return is_array($data) ? $data : [];
    }

    public static function getStats(int $channelId): array
    {
        $messages = self::getByChannel($channelId);
        $activeWindow = time() - 15 * 60;
        $activeGuests = [];
        $lastActivityAt = null;

        foreach ($messages as $msg) {
            if (isset($msg['guestId']) && $msg['createdAt'] >= $activeWindow) {
                $activeGuests[$msg['guestId']] = true;
            }
            if ($lastActivityAt === null || $msg['createdAt'] > $lastActivityAt) {
                $lastActivityAt = $msg['createdAt'];
            }
        }

        return [
            'messageCount'   => count($messages),
            'activeUsers'    => count($activeGuests),
            'lastActivityAt' => $lastActivityAt,
        ];
    }

    public static function addJoinEvent(int $channelId, string $nickname): array
    {
        $messages = self::getByChannel($channelId);

        $message = [
            'type'      => 'system',
            'event'     => 'join',
            'nickname'  => $nickname,
            'createdAt' => time(),
        ];

        $messages[] = $message;

        file_put_contents(self::filePath($channelId), json_encode($messages), LOCK_EX);

        return $message;
    }

    public static function add(int $channelId, string $guestId, string $nickname, string $content): array
    {
        $messages = self::getByChannel($channelId);

        $message = [
            'id'        => bin2hex(random_bytes(8)),
            'channelId' => $channelId,
            'guestId'   => $guestId,
            'nickname'  => $nickname,
            'content'   => $content,
            'createdAt' => time(),
        ];

        $messages[] = $message;

        file_put_contents(self::filePath($channelId), json_encode($messages), LOCK_EX);

        return $message;
    }
}
