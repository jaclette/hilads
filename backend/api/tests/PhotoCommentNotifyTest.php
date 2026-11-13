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
        $this->assertSame('↩️ Lan replied to your comment', PhotoCommentNotify::title('reply', 'xx', self::DATA, 0), 'unknown locale: English');
    }

    /** One line per notification type, as the push, the Today card and the Notifications rows say it. */
    public function testEveryNotificationType(): void
    {
        $d = ['actorName' => 'bigfatbison', 'ownerName' => 'Maxime', 'selfPhoto' => false];
        $this->assertSame('💬 bigfatbison commented on your photo', PhotoCommentNotify::title('author', 'en', $d, 0));
        $this->assertSame("💬 bigfatbison also commented on Maxime's photo", PhotoCommentNotify::title('previous', 'en', $d, 0));
        $this->assertSame('↩️ bigfatbison replied to your comment', PhotoCommentNotify::title('reply', 'en', $d, 0));
        $this->assertSame('👋 bigfatbison mentioned you', PhotoCommentNotify::title('mention', 'en', $d, 0));
        $this->assertSame("💬 bigfatbison and 2 others commented on Maxime's photo", PhotoCommentNotify::title('previous', 'en', $d, 2));
        $this->assertSame("💬 bigfatbison and 1 other commented on Maxime's photo", PhotoCommentNotify::title('previous', 'en', $d, 1));
        $this->assertSame('💬 bigfatbison and 2 others commented on your photo', PhotoCommentNotify::title('author', 'en', $d, 2));
        $this->assertSame('💬 bigfatbison replied on their photo', PhotoCommentNotify::title('previous', 'en', ['selfPhoto' => true] + $d, 0));
        // The possessive and "also" in a few locales.
        $this->assertSame('💬 bigfatbison a aussi commenté la photo de Maxime', PhotoCommentNotify::title('previous', 'fr', $d, 0));
        $this->assertSame('💬 bigfatbison cũng đã bình luận ảnh của Maxime', PhotoCommentNotify::title('previous', 'vi', $d, 0));
        $this->assertSame('💬 bigfatbisonさんもMaximeさんの写真にコメントしました', PhotoCommentNotify::title('previous', 'ja', $d, 0));
        $this->assertSame('↩️ bigfatbison a répondu à ton commentaire', PhotoCommentNotify::title('reply', 'fr', $d, 0));
    }

    /**
     * The app and the web show the same lines (notifications.json "photoComment", one formatter for the Today card
     * and the rows): every locale of both, identical to the push's catalog ({name} → {{name}}).
     */
    public function testTheAppsSayTheSameAsThePush(): void
    {
        $root = dirname(__DIR__, 3);
        $dirs = ["$root/apps/mobile/src/i18n/locales", "$root/apps/web/src/i18n/locales"];
        if (!is_dir($dirs[0]) || !is_dir($dirs[1])) {
            $this->markTestSkipped('The apps are not in this checkout.');
        }
        foreach (PhotoCommentNotify::catalog() as $locale => $lines) {
            $want = array_map(static fn($l) => strtr($l, ['{name}' => '{{name}}', '{owner}' => '{{owner}}', '{n}' => '{{n}}']), $lines);
            foreach ($dirs as $dir) {
                $json = json_decode((string) file_get_contents("$dir/$locale/notifications.json"), true);
                $this->assertSame($want, $json['photoComment'] ?? null, "$dir/$locale");
            }
        }
    }
}
