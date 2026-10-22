<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

/** The challenge screen's subtitle (headlineJson with SUBTITLE_MAX): limits and translations. */
final class DailySubtitleTest extends TestCase
{
    public function testSubtitleAllowsEightyCharactersAndKeepsKnownLocales(): void
    {
        $en   = str_repeat('a', DailyAdminService::SUBTITLE_MAX);
        $json = DailyAdminService::headlineJson($en, ['fr' => '  Trinque  là où boivent les locaux. ', 'xx' => 'nope'], 'Subtitle', DailyAdminService::SUBTITLE_MAX);
        $this->assertSame(['en' => $en, 'fr' => 'Trinque là où boivent les locaux.'], json_decode((string) $json, true));
    }

    public function testSubtitleLongerThanEightyIsRefused(): void
    {
        $this->expectException(InvalidArgumentException::class);
        DailyAdminService::headlineJson(str_repeat('a', DailyAdminService::SUBTITLE_MAX + 1), [], 'Subtitle', DailyAdminService::SUBTITLE_MAX);
    }

    public function testEmptySubtitleClearsIt(): void
    {
        $this->assertNull(DailyAdminService::headlineJson('  ', ['fr' => 'x'], 'Subtitle', DailyAdminService::SUBTITLE_MAX));
    }

    public function testHeadlineKeepsItsFortyFiveLimit(): void
    {
        $this->expectException(InvalidArgumentException::class);
        DailyAdminService::headlineJson(str_repeat('a', DailyAdminService::HEADLINE_MAX + 1), []);
    }
}
