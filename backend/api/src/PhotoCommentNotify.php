<?php

declare(strict_types=1);

/**
 * Who hears about a new comment on a Daily photo (docs/photo-comments-audit.md).
 *
 * One notification per person and comment, the strongest reason winning:
 * mention > reply > the photo's author > someone who commented before.
 * Never the writer, never someone blocked either way, never on a demo photo.
 * Each gets a bell row (live over the WebSocket) and a push, in their language:
 * types photo_mention (mention_push) and photo_comment (comment_push).
 *
 * Grouping: for the author and earlier commenters, more comments on the same
 * photo (not its author's own) while the last row is unread and under
 * GROUP_WINDOW old update that row ("Lan and 2 others commented on your photo") without a new push.
 * Mentions and replies always come one by one. Best effort: a failure here
 * never fails the comment.
 */
final class PhotoCommentNotify
{
    public const TYPE_COMMENT   = 'photo_comment';
    public const TYPE_MENTION   = 'photo_mention';
    public const GROUP_WINDOW   = 300; // seconds
    private const MAX_PREVIOUS  = 50;  // earlier commenters told, at most
    private const PRIORITY      = ['mention' => 4, 'reply' => 3, 'author' => 2, 'previous' => 1];

    /** After $comment (a PhotoComments row) was written on $photo by $writer. */
    public static function onComment(array $photo, array $comment, array $writer): void
    {
        try {
            if (DailyProofRepository::bool($photo['is_demo'] ?? false)) {
                return;
            }
            $recipients = self::recipients($photo, $comment, $writer['id']);
            if ($recipients === []) {
                return;
            }
            $blocked = BlockRepository::getBidirectional($writer['id'], null)['user_ids'] ?? [];
            $name    = self::name($writer);
            $owner   = self::name($photo);
            $text    = mb_substr(preg_replace('/\s+/u', ' ', (string) $comment['body']) ?? '', 0, 140);
            foreach ($recipients as $uid => $kind) {
                if (in_array($uid, $blocked, true)) {
                    continue;
                }
                $data = [
                    'proofId'    => $photo['id'],
                    'date'       => (string) $photo['challenge_date'],
                    'commentId'  => (int) $comment['id'],
                    'kind'       => $kind,
                    'actorId'    => $writer['id'],
                    'actorIds'   => [$writer['id']],
                    'actorName'  => $name,
                    'actorPhoto' => R2Uploader::thumbProxy($writer['profile_photo_url'] ?? null),
                    'photoThumb' => R2Uploader::thumbProxy($photo['photo_url'] ?? null),
                    'ownerName'  => $owner,
                    'selfPhoto'  => $photo['user_id'] === $writer['id'],
                ];
                // The photo's author answering on it is told on its own ("Lan replied on their photo").
                if (($kind === 'author' || $kind === 'previous') && !$data['selfPhoto'] && self::grouped($uid, $data, $text)) {
                    continue;
                }
                $locale = self::locale($uid);
                $type   = $kind === 'mention' ? self::TYPE_MENTION : self::TYPE_COMMENT;
                $notif  = NotificationRepository::createUnchecked($uid, $type, self::title($kind, $locale, $data, 0), $text, $data, $locale, true);
                if ($notif !== [] && function_exists('broadcastUserEventToWs')) {
                    broadcastUserEventToWs($uid, 'newNotification', $notif);
                }
            }
        } catch (\Throwable $e) {
            error_log('[comments] notification failed: ' . $e->getMessage());
        }
    }

    /**
     * user id → why they hear about it ('mention', 'reply', 'author', 'previous'),
     * the strongest reason kept. The writer is never in it.
     */
    public static function recipients(array $photo, array $comment, string $writerId): array
    {
        $pdo = Database::pdo();
        $out = [];
        $add = static function (?string $uid, string $kind) use (&$out, $writerId): void {
            if ($uid === null || $uid === '' || $uid === $writerId) {
                return;
            }
            if (!isset($out[$uid]) || self::PRIORITY[$kind] > self::PRIORITY[$out[$uid]]) {
                $out[$uid] = $kind;
            }
        };

        $stmt = $pdo->prepare("
            SELECT DISTINCT c.user_id FROM photo_comments c JOIN users u ON u.id = c.user_id
            WHERE c.photo_id = ? AND c.id <> ? AND c.deleted_at IS NULL AND u.deleted_at IS NULL
            LIMIT " . self::MAX_PREVIOUS
        );
        $stmt->execute([$photo['id'], $comment['id']]);
        foreach ($stmt->fetchAll(PDO::FETCH_COLUMN) as $uid) {
            $add((string) $uid, 'previous');
        }
        $add((string) $photo['user_id'], 'author');
        $add($comment['reply_user_id'] ?? null, 'reply');
        $stmt = $pdo->prepare("SELECT mentioned_user_id FROM photo_comment_mentions WHERE comment_id = ?");
        $stmt->execute([$comment['id']]);
        foreach ($stmt->fetchAll(PDO::FETCH_COLUMN) as $uid) {
            $add((string) $uid, 'mention');
        }
        return $out;
    }

    /**
     * Fold this comment into the user's unread row for the same photo and kind
     * from the last GROUP_WINDOW seconds, if any: new actors, new title, no push.
     */
    private static function grouped(string $uid, array $data, string $text): bool
    {
        $pdo  = Database::pdo();
        $stmt = $pdo->prepare("
            SELECT id, data FROM notifications
            WHERE user_id = ? AND type = ? AND is_read = false AND data->>'proofId' = ? AND data->>'kind' = ?
              AND COALESCE((data->>'selfPhoto')::boolean, false) = false
              AND created_at > now() - make_interval(secs => ?)
            ORDER BY id DESC LIMIT 1
        ");
        $stmt->execute([$uid, self::TYPE_COMMENT, $data['proofId'], $data['kind'], self::GROUP_WINDOW]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if ($row === false) {
            return false;
        }
        $old    = json_decode((string) $row['data'], true) ?: [];
        $actors = array_values(array_unique(array_merge([$data['actorId']], (array) ($old['actorIds'] ?? []))));
        $data['actorIds'] = $actors;
        $title = self::title($data['kind'], self::locale($uid), $data, count($actors) - 1);
        $pdo->prepare("UPDATE notifications SET title = ?, body = ?, data = ?::jsonb, created_at = now() WHERE id = ?")
            ->execute([$title, $text, json_encode($data), $row['id']]);
        if (function_exists('broadcastUserEventToWs')) {
            broadcastUserEventToWs($uid, 'notificationUpdated', ['id' => (int) $row['id'], 'title' => $title, 'body' => $text, 'data' => $data]);
        }
        return true;
    }

    /** The line for a kind in a locale; $others = other people in a grouped row. */
    public static function title(string $kind, string $locale, array $data, int $others): string
    {
        $key = match (true) {
            $kind === 'previous' && $data['selfPhoto'] && $others === 0 => 'previous_self',
            $kind === 'author' || $kind === 'previous'                 => $kind . ($others === 0 ? '' : ($others === 1 ? '_many_one' : '_many')),
            default                                                    => $kind,
        };
        $tpl = self::T[$locale][$key] ?? self::T['en'][$key];
        return strtr($tpl, ['{name}' => $data['actorName'], '{owner}' => $data['ownerName'], '{n}' => (string) $others]);
    }

    /** Every locale has every key (tests). */
    public static function catalog(): array
    {
        return self::T;
    }

    private static function name(array $person): string
    {
        $name = trim((string) ($person['display_name'] ?? ''));
        return $name !== '' ? $name : (string) ($person['username'] ?? 'Someone');
    }

    private static function locale(string $userId): string
    {
        $stmt = Database::pdo()->prepare("SELECT locale FROM users WHERE id = ?");
        $stmt->execute([$userId]);
        $loc = strtolower((string) ($stmt->fetchColumn() ?: 'en'));
        return isset(self::T[$loc]) ? $loc : 'en';
    }

    // Keys: author, author_many ({n} others), author_many_one, mention, reply,
    // previous (on {owner}'s photo), previous_many, previous_many_one,
    // previous_self (the author answering on their own photo).
    private const T = [
        'en' => [
            'author' => "💬 {name} commented on your photo", 'author_many' => "💬 {name} and {n} others commented on your photo",
            'author_many_one' => "💬 {name} and 1 other commented on your photo", 'mention' => "👋 {name} mentioned you",
            'reply' => "↩️ {name} replied to you", 'previous' => "💬 {name} also commented on {owner}'s photo",
            'previous_many' => "💬 {name} and {n} others also commented on {owner}'s photo",
            'previous_many_one' => "💬 {name} and 1 other also commented on {owner}'s photo", 'previous_self' => "💬 {name} replied on their photo",
        ],
        'fr' => [
            'author' => "💬 {name} a commenté ta photo", 'author_many' => "💬 {name} et {n} autres ont commenté ta photo",
            'author_many_one' => "💬 {name} et 1 autre personne ont commenté ta photo", 'mention' => "👋 {name} t'a mentionné",
            'reply' => "↩️ {name} t'a répondu", 'previous' => "💬 {name} a aussi commenté la photo de {owner}",
            'previous_many' => "💬 {name} et {n} autres ont aussi commenté la photo de {owner}",
            'previous_many_one' => "💬 {name} et 1 autre personne ont aussi commenté la photo de {owner}", 'previous_self' => "💬 {name} a répondu sur sa photo",
        ],
        'de' => [
            'author' => "💬 {name} hat dein Foto kommentiert", 'author_many' => "💬 {name} und {n} andere haben dein Foto kommentiert",
            'author_many_one' => "💬 {name} und 1 weitere Person haben dein Foto kommentiert", 'mention' => "👋 {name} hat dich erwähnt",
            'reply' => "↩️ {name} hat dir geantwortet", 'previous' => "💬 {name} hat auch das Foto von {owner} kommentiert",
            'previous_many' => "💬 {name} und {n} andere haben auch das Foto von {owner} kommentiert",
            'previous_many_one' => "💬 {name} und 1 weitere Person haben auch das Foto von {owner} kommentiert", 'previous_self' => "💬 {name} hat unter dem eigenen Foto geantwortet",
        ],
        'es' => [
            'author' => "💬 {name} comentó tu foto", 'author_many' => "💬 {name} y {n} más comentaron tu foto",
            'author_many_one' => "💬 {name} y 1 persona más comentaron tu foto", 'mention' => "👋 {name} te mencionó",
            'reply' => "↩️ {name} te respondió", 'previous' => "💬 {name} también comentó la foto de {owner}",
            'previous_many' => "💬 {name} y {n} más también comentaron la foto de {owner}",
            'previous_many_one' => "💬 {name} y 1 persona más también comentaron la foto de {owner}", 'previous_self' => "💬 {name} respondió en su foto",
        ],
        'it' => [
            'author' => "💬 {name} ha commentato la tua foto", 'author_many' => "💬 {name} e altri {n} hanno commentato la tua foto",
            'author_many_one' => "💬 {name} e un'altra persona hanno commentato la tua foto", 'mention' => "👋 {name} ti ha menzionato",
            'reply' => "↩️ {name} ti ha risposto", 'previous' => "💬 Anche {name} ha commentato la foto di {owner}",
            'previous_many' => "💬 {name} e altri {n} hanno commentato anche la foto di {owner}",
            'previous_many_one' => "💬 {name} e un'altra persona hanno commentato anche la foto di {owner}", 'previous_self' => "💬 {name} ha risposto sulla sua foto",
        ],
        'pt-br' => [
            'author' => "💬 {name} comentou sua foto", 'author_many' => "💬 {name} e mais {n} pessoas comentaram sua foto",
            'author_many_one' => "💬 {name} e mais 1 pessoa comentaram sua foto", 'mention' => "👋 {name} mencionou você",
            'reply' => "↩️ {name} respondeu você", 'previous' => "💬 {name} também comentou a foto de {owner}",
            'previous_many' => "💬 {name} e mais {n} pessoas também comentaram a foto de {owner}",
            'previous_many_one' => "💬 {name} e mais 1 pessoa também comentaram a foto de {owner}", 'previous_self' => "💬 {name} respondeu na própria foto",
        ],
        'pt-pt' => [
            'author' => "💬 {name} comentou a tua foto", 'author_many' => "💬 {name} e mais {n} pessoas comentaram a tua foto",
            'author_many_one' => "💬 {name} e mais 1 pessoa comentaram a tua foto", 'mention' => "👋 {name} mencionou-te",
            'reply' => "↩️ {name} respondeu-te", 'previous' => "💬 {name} também comentou a foto de {owner}",
            'previous_many' => "💬 {name} e mais {n} pessoas também comentaram a foto de {owner}",
            'previous_many_one' => "💬 {name} e mais 1 pessoa também comentaram a foto de {owner}", 'previous_self' => "💬 {name} respondeu na própria foto",
        ],
        'nl' => [
            'author' => "💬 {name} reageerde op je foto", 'author_many' => "💬 {name} en {n} anderen reageerden op je foto",
            'author_many_one' => "💬 {name} en 1 ander reageerden op je foto", 'mention' => "👋 {name} noemde je",
            'reply' => "↩️ {name} antwoordde je", 'previous' => "💬 {name} reageerde ook op de foto van {owner}",
            'previous_many' => "💬 {name} en {n} anderen reageerden ook op de foto van {owner}",
            'previous_many_one' => "💬 {name} en 1 ander reageerden ook op de foto van {owner}", 'previous_self' => "💬 {name} reageerde op de eigen foto",
        ],
        'ru' => [
            'author' => "💬 {name}: новый комментарий к твоему фото", 'author_many' => "💬 {name} и ещё {n}: новые комментарии к твоему фото",
            'author_many_one' => "💬 {name} и ещё 1: новые комментарии к твоему фото", 'mention' => "👋 {name} упоминает тебя",
            'reply' => "↩️ {name} отвечает тебе", 'previous' => "💬 {name} тоже комментирует фото {owner}",
            'previous_many' => "💬 {name} и ещё {n} тоже комментируют фото {owner}",
            'previous_many_one' => "💬 {name} и ещё 1 тоже комментируют фото {owner}", 'previous_self' => "💬 {name} отвечает под своим фото",
        ],
        'ar' => [
            'author' => "💬 علّق {name} على صورتك", 'author_many' => "💬 علّق {name} و{n} آخرون على صورتك",
            'author_many_one' => "💬 علّق {name} وشخص آخر على صورتك", 'mention' => "👋 أشار إليك {name}",
            'reply' => "↩️ ردّ عليك {name}", 'previous' => "💬 علّق {name} أيضًا على صورة {owner}",
            'previous_many' => "💬 علّق {name} و{n} آخرون أيضًا على صورة {owner}",
            'previous_many_one' => "💬 علّق {name} وشخص آخر أيضًا على صورة {owner}", 'previous_self' => "💬 ردّ {name} على صورته",
        ],
        'ja' => [
            'author' => "💬 {name}さんがあなたの写真にコメントしました", 'author_many' => "💬 {name}さんほか{n}人があなたの写真にコメントしました",
            'author_many_one' => "💬 {name}さんほか1人があなたの写真にコメントしました", 'mention' => "👋 {name}さんがあなたをメンションしました",
            'reply' => "↩️ {name}さんがあなたに返信しました", 'previous' => "💬 {name}さんも{owner}さんの写真にコメントしました",
            'previous_many' => "💬 {name}さんほか{n}人も{owner}さんの写真にコメントしました",
            'previous_many_one' => "💬 {name}さんほか1人も{owner}さんの写真にコメントしました", 'previous_self' => "💬 {name}さんが自分の写真に返信しました",
        ],
        'ko' => [
            'author' => "💬 {name}님이 내 사진에 댓글을 남겼어요", 'author_many' => "💬 {name}님 외 {n}명이 내 사진에 댓글을 남겼어요",
            'author_many_one' => "💬 {name}님 외 1명이 내 사진에 댓글을 남겼어요", 'mention' => "👋 {name}님이 나를 언급했어요",
            'reply' => "↩️ {name}님이 내게 답글을 남겼어요", 'previous' => "💬 {name}님도 {owner}님의 사진에 댓글을 남겼어요",
            'previous_many' => "💬 {name}님 외 {n}명도 {owner}님의 사진에 댓글을 남겼어요",
            'previous_many_one' => "💬 {name}님 외 1명도 {owner}님의 사진에 댓글을 남겼어요", 'previous_self' => "💬 {name}님이 자기 사진에 답글을 남겼어요",
        ],
        'zh-hans' => [
            'author' => "💬 {name} 评论了你的照片", 'author_many' => "💬 {name} 和另外 {n} 人评论了你的照片",
            'author_many_one' => "💬 {name} 和另外 1 人评论了你的照片", 'mention' => "👋 {name} 提到了你",
            'reply' => "↩️ {name} 回复了你", 'previous' => "💬 {name} 也评论了 {owner} 的照片",
            'previous_many' => "💬 {name} 和另外 {n} 人也评论了 {owner} 的照片",
            'previous_many_one' => "💬 {name} 和另外 1 人也评论了 {owner} 的照片", 'previous_self' => "💬 {name} 在自己的照片下回复了",
        ],
        'zh-hant' => [
            'author' => "💬 {name} 在你的照片留言了", 'author_many' => "💬 {name} 和另外 {n} 人在你的照片留言了",
            'author_many_one' => "💬 {name} 和另外 1 人在你的照片留言了", 'mention' => "👋 {name} 提到了你",
            'reply' => "↩️ {name} 回覆了你", 'previous' => "💬 {name} 也在 {owner} 的照片留言了",
            'previous_many' => "💬 {name} 和另外 {n} 人也在 {owner} 的照片留言了",
            'previous_many_one' => "💬 {name} 和另外 1 人也在 {owner} 的照片留言了", 'previous_self' => "💬 {name} 在自己的照片下回覆了",
        ],
        'vi' => [
            'author' => "💬 {name} đã bình luận ảnh của bạn", 'author_many' => "💬 {name} và {n} người khác đã bình luận ảnh của bạn",
            'author_many_one' => "💬 {name} và 1 người khác đã bình luận ảnh của bạn", 'mention' => "👋 {name} đã nhắc đến bạn",
            'reply' => "↩️ {name} đã trả lời bạn", 'previous' => "💬 {name} cũng đã bình luận ảnh của {owner}",
            'previous_many' => "💬 {name} và {n} người khác cũng đã bình luận ảnh của {owner}",
            'previous_many_one' => "💬 {name} và 1 người khác cũng đã bình luận ảnh của {owner}", 'previous_self' => "💬 {name} đã trả lời dưới ảnh của mình",
        ],
        'th' => [
            'author' => "💬 {name} แสดงความคิดเห็นในรูปของคุณ", 'author_many' => "💬 {name} และอีก {n} คนแสดงความคิดเห็นในรูปของคุณ",
            'author_many_one' => "💬 {name} และอีก 1 คนแสดงความคิดเห็นในรูปของคุณ", 'mention' => "👋 {name} กล่าวถึงคุณ",
            'reply' => "↩️ {name} ตอบกลับคุณ", 'previous' => "💬 {name} แสดงความคิดเห็นในรูปของ {owner} ด้วย",
            'previous_many' => "💬 {name} และอีก {n} คนแสดงความคิดเห็นในรูปของ {owner} ด้วย",
            'previous_many_one' => "💬 {name} และอีก 1 คนแสดงความคิดเห็นในรูปของ {owner} ด้วย", 'previous_self' => "💬 {name} ตอบกลับในรูปของตัวเอง",
        ],
        'id' => [
            'author' => "💬 {name} mengomentari fotomu", 'author_many' => "💬 {name} dan {n} lainnya mengomentari fotomu",
            'author_many_one' => "💬 {name} dan 1 lainnya mengomentari fotomu", 'mention' => "👋 {name} menyebutmu",
            'reply' => "↩️ {name} membalasmu", 'previous' => "💬 {name} juga mengomentari foto {owner}",
            'previous_many' => "💬 {name} dan {n} lainnya juga mengomentari foto {owner}",
            'previous_many_one' => "💬 {name} dan 1 lainnya juga mengomentari foto {owner}", 'previous_self' => "💬 {name} membalas di fotonya sendiri",
        ],
        'fil' => [
            'author' => "💬 Nag-comment si {name} sa photo mo", 'author_many' => "💬 Nag-comment si {name} at {n} iba pa sa photo mo",
            'author_many_one' => "💬 Nag-comment si {name} at 1 iba pa sa photo mo", 'mention' => "👋 Binanggit ka ni {name}",
            'reply' => "↩️ Sinagot ka ni {name}", 'previous' => "💬 Nag-comment din si {name} sa photo ni {owner}",
            'previous_many' => "💬 Nag-comment din si {name} at {n} iba pa sa photo ni {owner}",
            'previous_many_one' => "💬 Nag-comment din si {name} at 1 iba pa sa photo ni {owner}", 'previous_self' => "💬 Sumagot si {name} sa sarili niyang photo",
        ],
        'hi' => [
            'author' => "💬 {name} ने आपकी फ़ोटो पर कमेंट किया", 'author_many' => "💬 {name} और {n} अन्य ने आपकी फ़ोटो पर कमेंट किया",
            'author_many_one' => "💬 {name} और 1 अन्य ने आपकी फ़ोटो पर कमेंट किया", 'mention' => "👋 {name} ने आपको मेंशन किया",
            'reply' => "↩️ {name} ने आपको जवाब दिया", 'previous' => "💬 {name} ने भी {owner} की फ़ोटो पर कमेंट किया",
            'previous_many' => "💬 {name} और {n} अन्य ने भी {owner} की फ़ोटो पर कमेंट किया",
            'previous_many_one' => "💬 {name} और 1 अन्य ने भी {owner} की फ़ोटो पर कमेंट किया", 'previous_self' => "💬 {name} ने अपनी फ़ोटो पर जवाब दिया",
        ],
    ];
}
