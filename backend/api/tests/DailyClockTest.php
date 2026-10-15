<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

/**
 * DailyClock - the one place that decides which challenge is active.
 * Default drop 02:00 UTC (09:00 in Saigon); configurable via DAILY_DROP_UTC.
 */
final class DailyClockTest extends TestCase
{
    protected function tearDown(): void
    {
        putenv('DAILY_DROP_UTC');
    }

    private static function at(string $utc): DateTimeImmutable
    {
        return new DateTimeImmutable($utc, new DateTimeZone('UTC'));
    }

    public function testBeforeTheDropItIsStillYesterdaysChallenge(): void
    {
        $this->assertSame('2026-11-01', DailyClock::currentDate(self::at('2026-11-02 01:59:59')));
    }

    public function testAtTheDropTodaysChallengeStarts(): void
    {
        $this->assertSame('2026-11-02', DailyClock::currentDate(self::at('2026-11-02 02:00:00')));
        $this->assertSame('2026-11-02', DailyClock::currentDate(self::at('2026-11-02 23:59:59')));
    }

    public function testNextDropAndTimeLeft(): void
    {
        $now = self::at('2026-11-02 20:00:00');
        $this->assertSame('2026-11-03 02:00:00', DailyClock::nextDropAt($now)->format('Y-m-d H:i:s'));
        $this->assertSame(6 * 3600, DailyClock::secondsLeft($now));

        $early = self::at('2026-11-02 01:00:00');
        $this->assertSame('2026-11-02 02:00:00', DailyClock::nextDropAt($early)->format('Y-m-d H:i:s'));
        $this->assertSame(3600, DailyClock::secondsLeft($early));
    }

    public function testMonthAndYearBoundaries(): void
    {
        $this->assertSame('2026-12-31', DailyClock::currentDate(self::at('2027-01-01 00:30:00')));
        $this->assertSame('2027-01-01 02:00:00', DailyClock::nextDropAt(self::at('2026-12-31 12:00:00'))->format('Y-m-d H:i:s'));
    }

    public function testOtherTimezonesAreConvertedToUtc(): void
    {
        // 08:59 in Saigon = 01:59 UTC: still yesterday's challenge.
        $saigon = new DateTimeImmutable('2026-11-02 08:59:00', new DateTimeZone('Asia/Ho_Chi_Minh'));
        $this->assertSame('2026-11-01', DailyClock::currentDate($saigon));
    }

    public function testCustomDropTime(): void
    {
        putenv('DAILY_DROP_UTC=14:30');
        $this->assertSame('2026-11-01', DailyClock::currentDate(self::at('2026-11-02 14:29:00')));
        $this->assertSame('2026-11-02', DailyClock::currentDate(self::at('2026-11-02 14:30:00')));
        $this->assertSame('2026-11-02 14:30:00', DailyClock::dropAt('2026-11-02')->format('Y-m-d H:i:s'));
    }

    public function testInvalidDropTimeFallsBackToDefault(): void
    {
        foreach (['25:00', '2am', '', '02:60'] as $bad) {
            putenv('DAILY_DROP_UTC=' . $bad);
            $this->assertSame([2, 0], DailyClock::dropTime(), "for '{$bad}'");
        }
    }

    public function testIsActiveAndWindow(): void
    {
        $now = self::at('2026-11-02 10:00:00');
        $this->assertTrue(DailyClock::isActive('2026-11-02', $now));
        $this->assertFalse(DailyClock::isActive('2026-11-01', $now));
        [$start, $end] = DailyClock::window('2026-11-02');
        $this->assertSame('2026-11-02 02:00', $start->format('Y-m-d H:i'));
        $this->assertSame('2026-11-03 02:00', $end->format('Y-m-d H:i'));
    }

    public function testDateValidation(): void
    {
        $this->assertTrue(DailyClock::isValidDate('2026-11-02'));
        $this->assertFalse(DailyClock::isValidDate('2026-02-30'));
        $this->assertFalse(DailyClock::isValidDate('2026-11-2'));
        $this->assertFalse(DailyClock::isValidDate('nope'));
    }
}
