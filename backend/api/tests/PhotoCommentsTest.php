<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

final class PhotoCommentsTest extends TestCase
{
    private static function row(array $over = []): array
    {
        return $over + [
            'id' => '7', 'photo_id' => 'p1', 'user_id' => 'u2', 'body' => 'So local! @anh',
            'reply_to_comment_id' => null, 'created_at' => '2026-10-29 10:00:00+00', 'edited_at' => null,
            'username' => 'lan', 'display_name' => 'Lan', 'profile_photo_url' => null,
            'user_country' => 'DE', 'user_city' => 'Berlin', 'photo_user_id' => 'u1',
            'reply_user_id' => null, 'reply_username' => null, 'reply_body' => null, 'reply_gone' => 'f',
            'like_count' => '2', 'my_like' => 't',
            'mentions' => '[{"userId":"u1","username":"anh"}]',
        ];
    }

    public function testParsesHandles(): void
    {
        $this->assertSame(['anh', 'minh_2'], PhotoComments::parseHandles('@Anh where is it? cc @minh_2 and @anh'));
        $this->assertSame([], PhotoComments::parseHandles('mail me at lan@hilads.live'));
        $this->assertSame(['x'], PhotoComments::parseHandles('(@x)'));
    }

    public function testCleansBody(): void
    {
        $this->assertSame("a\n\nb", PhotoComments::clean("  a\r\n\n\n\nb \u{0007}"));
        $this->assertSame('Ngon quá 🔥', PhotoComments::clean('Ngon quá 🔥'));
    }

    public function testFormatsForAViewer(): void
    {
        $c = PhotoComments::format(self::row(), 'u1');
        $this->assertSame(7, $c['id']);
        $this->assertFalse($c['isAuthor']);
        $this->assertFalse($c['isMine']);
        $this->assertTrue($c['canDelete'], "the photo's author can delete any comment on it");
        $this->assertSame(['name' => 'Berlin', 'country' => 'DE'], $c['user']['city']);
        $this->assertSame(2, $c['likeCount']);
        $this->assertTrue($c['myLike']);
        $this->assertSame([['userId' => 'u1', 'username' => 'anh']], $c['mentions']);
        $this->assertNull($c['replyTo']);
    }

    public function testAuthorAndReply(): void
    {
        $c = PhotoComments::format(self::row([
            'user_id' => 'u1', 'reply_to_comment_id' => '5', 'reply_user_id' => 'u2', 'reply_username' => 'lan',
            'reply_body' => 'Where is it?', 'mentions' => null,
        ]), 'u3');
        $this->assertTrue($c['isAuthor']);
        $this->assertFalse($c['canDelete']);
        $this->assertSame(['id' => 5, 'username' => 'lan', 'body' => 'Where is it?'], $c['replyTo']);
        $this->assertSame([], $c['mentions']);
    }

    public function testReplyToADeletedCommentIsNotQuoted(): void
    {
        $c = PhotoComments::format(self::row(['reply_to_comment_id' => '5', 'reply_user_id' => 'u2', 'reply_gone' => 't']), null);
        $this->assertNull($c['replyTo']);
    }
}
