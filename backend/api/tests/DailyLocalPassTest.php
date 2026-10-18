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
            self::row('sip', '2026-11-04'),
            self::row('hidden_gem', '2026-11-02'),
            self::row('coffee', '2026-11-11'),    // a v1 key: its v2 theme (sip)
            self::row(null, '2026-11-06'),        // no stored theme: its weekday's (Friday, night out)
            self::row('special', '2026-10-31'),   // a special day: its own stamp, never a Local Pass one
        ]);
        $this->assertSame(['hidden_gem', 'night_out', 'sip'], $themes);
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
        // A Taste challenge on a Monday counts as Taste, not Hidden gem.
        $this->assertSame(['taste'], DailyLocalPass::themesOf([self::row('taste', '2026-11-02')]));
    }
}
