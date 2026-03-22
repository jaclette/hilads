<?php

declare(strict_types=1);

class MessageRepository
{
    private static function filePath(int|string $channelId): string
    {
        return Storage::path('messages_' . $channelId . '.json');
    }

    public static function getByChannel(int|string $channelId): array
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
        $lastActivityAt = null;

        foreach ($messages as $msg) {
            if ($lastActivityAt === null || $msg['createdAt'] > $lastActivityAt) {
                $lastActivityAt = $msg['createdAt'];
            }
        }

        return [
            'messageCount'   => count($messages),
            'activeUsers'    => PresenceRepository::getCount($channelId),
            'lastActivityAt' => $lastActivityAt,
        ];
    }

    public static function addJoinEvent(int $channelId, string $guestId, string $nickname): array
    {
        $messages = self::getByChannel($channelId);

        $message = [
            'type'      => 'system',
            'event'     => 'join',
            'guestId'   => $guestId,
            'nickname'  => $nickname,
            'createdAt' => time(),
        ];

        $messages[] = $message;

        file_put_contents(self::filePath($channelId), json_encode($messages), LOCK_EX);

        return $message;
    }

    public static function add(int|string $channelId, string $guestId, string $nickname, string $content): array
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

    public static function addImage(int $channelId, string $guestId, string $nickname, string $imageUrl): array
    {
        $messages = self::getByChannel($channelId);

        $message = [
            'id'        => bin2hex(random_bytes(8)),
            'channelId' => $channelId,
            'guestId'   => $guestId,
            'nickname'  => $nickname,
            'type'      => 'image',
            'imageUrl'  => $imageUrl,
            'content'   => '',
            'createdAt' => time(),
        ];

        $messages[] = $message;

        file_put_contents(self::filePath($channelId), json_encode($messages), LOCK_EX);

        return $message;
    }
}
