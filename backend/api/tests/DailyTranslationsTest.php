<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

/** Translations-only import of the Daily Challenge (Admin › Daily › Translations). */
final class DailyTranslationsTest extends TestCase
{
    public function testMergeKeepsEnglishAndOtherLocales(): void
    {
        $stored = ['en' => 'Find a fruit locals love.', 'fr' => 'Trouve un fruit.', 'vi' => 'Tìm trái cây.', '_src' => 'Find a fruit locals love.'];
        [$map, $changed, $error] = DailyTranslations::mergeField($stored,
            ['en' => 'Find a fruit locals love.', 'vi' => 'Tìm loại trái cây dân ở đây mê.', 'pt-BR' => 'Encontre uma fruta.'], 500, true, 'text');
        $this->assertNull($error);
        $this->assertSame(['vi', 'pt-br'], $changed);
        $this->assertSame('Find a fruit locals love.', $map['en']);
        $this->assertSame('Trouve un fruit.', $map['fr']);
        $this->assertSame('Tìm loại trái cây dân ở đây mê.', $map['vi']);
        $this->assertSame('Encontre uma fruta.', $map['pt-br']);
        $this->assertSame('Find a fruit locals love.', $map['_src']);
    }

    public function testSkipsWhenTheEnglishChanged(): void
    {
        [$map, , $error] = DailyTranslations::mergeField(['en' => 'New text'], ['en' => 'Old text', 'vi' => 'Cũ'], 500, true, 'text');
        $this->assertNull($map);
        $this->assertStringContainsString('English changed', (string) $error);
    }

    public function testNothingToDoAndTooLong(): void
    {
        [$map, $changed, $error] = DailyTranslations::mergeField(['en' => 'Hi', 'vi' => 'Chào'], ['en' => 'Hi', 'vi' => 'Chào'], 45, false, 'headline');
        $this->assertNull($map);
        $this->assertSame([], $changed);
        $this->assertNull($error);
        [$map, , $error] = DailyTranslations::mergeField(['en' => 'Hi'], ['en' => 'Hi', 'fr' => str_repeat('a', 46)], 45, false, 'headline');
        $this->assertNull($map);
        $this->assertStringContainsString('longer than 45', (string) $error);
    }

    public function testHeadlineHasNoSrcStamp(): void
    {
        [$map] = DailyTranslations::mergeField(['en' => 'Hi'], ['en' => 'Hi', 'fr' => 'Salut'], 45, false, 'headline');
        $this->assertSame(['en' => 'Hi', 'fr' => 'Salut'], $map);
    }
}
