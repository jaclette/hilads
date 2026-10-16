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

    public function testCalendarDays(): void
    {
        $days = DailyChallengeRepository::calendarDays('2026-11-02', '2026-11-05', [
            ['challenge_date' => '2026-11-02', 'theme' => 'coffee', 'status' => 'published', 'my_status' => 'approved'],
            ['challenge_date' => '2026-11-03', 'theme' => null, 'status' => 'published', 'my_status' => null],
            ['challenge_date' => '2026-11-05', 'theme' => 'market', 'status' => 'scheduled', 'my_status' => null],
        ]);
        $this->assertCount(4, $days);
        $this->assertSame(['date' => '2026-11-02', 'theme' => ['key' => 'coffee', 'name' => 'Coffee'], 'published' => true, 'myStatus' => 'approved'], $days[0]);
        $this->assertSame('street_food', $days[1]['theme']['key']);   // Tuesday default
        $this->assertFalse($days[2]['published']);                    // nothing that day
        $this->assertSame('coffee', $days[2]['theme']['key']);
        $this->assertFalse($days[3]['published']);                    // scheduled: theme only
        $this->assertSame('market', $days[3]['theme']['key']);
        $this->assertNull($days[3]['myStatus']);
    }
}
