<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

final class PhotoCommentNotifyTest extends TestCase
{
    private const DATA = ['actorName' => 'Lan', 'ownerName' => 'Minh', 'selfPhoto' => false];

    public function testEveryLocaleHasEveryLineWithTheSamePlaceholders(): void
    {
        $catalog = PhotoCommentNotify::catalog();
        $this->assertCount(19, $catalog);
        foreach ($catalog as $locale => $lines) {
            $this->assertSame(array_keys($catalog['en']), array_keys($lines), $locale);
            foreach ($lines as $key => $line) {
                preg_match_all('/\{\w+\}/', $catalog['en'][$key], $en);
                preg_match_all('/\{\w+\}/', $line, $mine);
                sort($en[0]);
                sort($mine[0]);
                $this->assertSame($en[0], $mine[0], "$locale.$key");
            }
        }
    }

    public function testLines(): void
    {
        $this->assertSame('💬 Lan commented on your photo', PhotoCommentNotify::title('author', 'en', self::DATA, 0));
        $this->assertSame('💬 Lan and 1 other commented on your photo', PhotoCommentNotify::title('author', 'en', self::DATA, 1));
        $this->assertSame('💬 Lan and 3 others commented on your photo', PhotoCommentNotify::title('author', 'en', self::DATA, 3));
        $this->assertSame("💬 Lan also commented on Minh's photo", PhotoCommentNotify::title('previous', 'en', self::DATA, 0));
        $this->assertSame('💬 Lan replied on their photo', PhotoCommentNotify::title('previous', 'en', ['selfPhoto' => true] + self::DATA, 0));
        $this->assertSame('👋 Lan mentioned you', PhotoCommentNotify::title('mention', 'en', self::DATA, 0));
        $this->assertSame("👋 Lan t'a mentionné", PhotoCommentNotify::title('mention', 'fr', self::DATA, 0));
        $this->assertSame('↩️ Lan replied to you', PhotoCommentNotify::title('reply', 'xx', self::DATA, 0), 'unknown locale: English');
    }
}
