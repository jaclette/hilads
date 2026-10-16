<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

/** Local Pass (V2-03): distinct themes from approved proofs, complete at 7. */
final class DailyLocalPassTest extends TestCase
{
    private static function row(?string $theme, string $date): array
    {
        return ['theme' => $theme, 'challenge_date' => $date];
    }

    public function testThemesAreDistinctInWeeklyOrder(): void
    {
        $themes = DailyLocalPass::themesOf([
            self::row('coffee', '2026-11-04'),
            self::row('language', '2026-11-02'),
            self::row('coffee', '2026-11-11'),
            self::row(null, '2026-11-06'),        // no stored theme: its weekday's (Friday, night out)
        ]);
        $this->assertSame(['language', 'coffee', 'night_out'], $themes);
        $this->assertFalse(DailyLocalPass::isComplete($themes));
    }

    public function testCompleteWithAllSeven(): void
    {
        $rows = [];
        for ($i = 0; $i < 7; $i++) {
            $rows[] = self::row(null, (new DateTimeImmutable('2026-11-02'))->modify("+{$i} days")->format('Y-m-d'));
        }
        $this->assertTrue(DailyLocalPass::isComplete(DailyLocalPass::themesOf($rows)));
        array_pop($rows);
        $this->assertFalse(DailyLocalPass::isComplete(DailyLocalPass::themesOf($rows)));
    }

    public function testThemeOnAnotherWeekdayCounts(): void
    {
        // A street food challenge on a Monday counts as street food, not language.
        $this->assertSame(['street_food'], DailyLocalPass::themesOf([self::row('street_food', '2026-11-02')]));
    }
}
