<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

/** Weekly themes (V2-03): weekday defaults, names, payload fallback. */
final class DailyThemesTest extends TestCase
{
    public function testEveryWeekdayHasItsTheme(): void
    {
        // 2026-11-02 is a Monday.
        $expected = ['language', 'street_food', 'coffee', 'market', 'night_out', 'neighborhood', 'traditions'];
        foreach ($expected as $i => $key) {
            $date = (new DateTimeImmutable('2026-11-02'))->modify("+{$i} days")->format('Y-m-d');
            $this->assertSame($key, DailyThemes::forDate($date), $date);
        }
    }

    public function testNormalizeAcceptsKeysAndNames(): void
    {
        $this->assertSame('street_food', DailyThemes::normalize('street_food'));
        $this->assertSame('street_food', DailyThemes::normalize('Street food'));
        $this->assertSame('street_food', DailyThemes::normalize(' street FOOD '));
        $this->assertSame('night_out', DailyThemes::normalize('Night out'));
        $this->assertNull(DailyThemes::normalize('Brunch'));
        $this->assertNull(DailyThemes::normalize(null));
        $this->assertNull(DailyThemes::normalize(3));
    }

    public function testFormatFallsBackToTheWeekday(): void
    {
        $this->assertSame(['key' => 'coffee', 'name' => 'Coffee'], DailyThemes::format('coffee', '2026-11-02'));
        $this->assertSame(['key' => 'language', 'name' => 'Language'], DailyThemes::format(null, '2026-11-02'));
        $this->assertSame(['key' => 'language', 'name' => 'Language'], DailyThemes::format('gone', '2026-11-02'));
        $this->assertNull(DailyThemes::format(null, null));
    }

    public function testImportThemes(): void
    {
        $doc = ['challenges' => [
            ['date' => '2026-11-03', 'theme' => 'Coffee', 'text' => ['en' => 'A']],
            ['date' => '2026-11-04', 'text' => ['en' => 'B']],
            ['date' => null, 'reserve' => true, 'text' => ['en' => 'C']],
            ['date' => '2026-11-05', 'theme' => 'Brunch', 'text' => ['en' => 'D']],
        ]];
        $r = DailyAdminService::validateImport($doc, fn(string $slug): ?string => null);
        $this->assertSame('coffee', $r['entries'][0]['theme']);   // given (a name), even off its weekday
        $this->assertSame('coffee', $r['entries'][1]['theme']);   // Wednesday default
        $this->assertNull($r['entries'][2]['theme']);             // reserve: themed when used
        $this->assertCount(1, $r['errors']);
        $this->assertStringContainsString('#4: unknown theme "Brunch"', $r['errors'][0]);
    }
}
