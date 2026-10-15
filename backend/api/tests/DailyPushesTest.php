<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

/** Morning push timing: at the drop in local daytime (09:00-21:00), else at the next 09:00 local. */
final class DailyPushesTest extends TestCase
{
    private static function utc(string $s): DateTimeImmutable
    {
        return new DateTimeImmutable($s, new DateTimeZone('UTC'));
    }

    private static function sendAt(string $nowUtc, string $tz): string
    {
        return DailyPushes::morningSendAt(self::utc($nowUtc), $tz)->format('Y-m-d H:i');
    }

    public function testSaigonGetsItAtTheDrop(): void
    {
        // 02:00 UTC = 09:00 in Saigon: daytime, send now.
        $this->assertSame('2026-11-02 02:00', self::sendAt('2026-11-02 02:00', 'Asia/Ho_Chi_Minh'));
    }

    public function testParisAtNightWaitsForNineLocal(): void
    {
        // 02:00 UTC = 03:00 in Paris (CET, after the DST change): wait for 09:00 = 08:00 UTC.
        $this->assertSame('2026-11-02 08:00', self::sendAt('2026-11-02 02:00', 'Europe/Paris'));
        // Same drop in summer time (CEST): 09:00 Paris = 07:00 UTC.
        $this->assertSame('2026-07-02 07:00', self::sendAt('2026-07-02 02:00', 'Europe/Paris'));
    }

    public function testNewYorkLateEveningWaitsForNextMorning(): void
    {
        // 02:00 UTC = 21:00 in New York (EST): 21:00 is outside the window -> next day 09:00 = 14:00 UTC.
        $this->assertSame('2026-11-02 14:00', self::sendAt('2026-11-02 02:00', 'America/New_York'));
    }

    public function testWindowEdges(): void
    {
        // UTC recipient: 08:59 -> 09:00 same day; 09:00 and 20:59 -> now; 21:00 and 23:00 -> next day 09:00.
        $this->assertSame('2026-11-02 09:00', self::sendAt('2026-11-02 08:59', 'UTC'));
        $this->assertSame('2026-11-02 09:00', self::sendAt('2026-11-02 09:00', 'UTC'));
        $this->assertSame('2026-11-02 20:59', self::sendAt('2026-11-02 20:59', 'UTC'));
        $this->assertSame('2026-11-03 09:00', self::sendAt('2026-11-02 21:00', 'UTC'));
        $this->assertSame('2026-11-03 09:00', self::sendAt('2026-11-02 23:00', 'UTC'));
    }

    public function testLateDropUsesTheActualRunTime(): void
    {
        // A drop that ran at 05:00 UTC reaches Paris (06:00) at 09:00 local, Saigon (12:00) right away.
        $this->assertSame('2026-11-02 08:00', self::sendAt('2026-11-02 05:00', 'Europe/Paris'));
        $this->assertSame('2026-11-02 05:00', self::sendAt('2026-11-02 05:00', 'Asia/Ho_Chi_Minh'));
    }

    public function testInvalidZoneFallsBackToUtc(): void
    {
        $this->assertSame('2026-11-02 09:00', self::sendAt('2026-11-02 02:00', 'Mars/Olympus'));
    }

    public function testTimezoneFallbackOrder(): void
    {
        $this->assertSame('Asia/Bangkok', DailyPushes::pickTimezone('Asia/Bangkok', 'Europe/Paris', 'UTC'));
        $this->assertSame('Europe/Paris', DailyPushes::pickTimezone(null, 'Europe/Paris', 'Asia/Ho_Chi_Minh'));
        $this->assertSame('Asia/Ho_Chi_Minh', DailyPushes::pickTimezone('GMT+7', '', 'Asia/Ho_Chi_Minh'));
        $this->assertSame('UTC', DailyPushes::pickTimezone(null, null, null));
    }

    public function testMorningMessageIsEnglishAndHasNoChallengeId(): void
    {
        $m = DailyPushes::morningMessage(['text_i18n' => '{"en":"Eat what locals eat"}', 'challenge_date' => '2026-11-02']);
        $this->assertSame("Today's Daily Challenge: Eat what locals eat", $m['body']);
        $this->assertSame('https://hilads.live/today', $m['data']['deepLink']);
        $this->assertArrayNotHasKey('challengeId', $m['data']);
    }
}
