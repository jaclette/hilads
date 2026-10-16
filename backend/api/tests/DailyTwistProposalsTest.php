<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

/** Local Twist proposals: window, target date, eligibility, text. */
final class DailyTwistProposalsTest extends TestCase
{
    private static function utc(string $s): DateTimeImmutable
    {
        return new DateTimeImmutable($s, new DateTimeZone('UTC'));
    }

    public function testTargetIsTomorrowsChallenge(): void
    {
        $this->assertSame('2026-11-03', DailyTwistProposals::targetDate(self::utc('2026-11-02 02:00')));
        $this->assertSame('2026-11-03', DailyTwistProposals::targetDate(self::utc('2026-11-03 01:59')));
        $this->assertSame('2026-11-04', DailyTwistProposals::targetDate(self::utc('2026-11-03 02:00')));
    }

    public function testWindowIsDropOfDMinus1To12hBeforeDropOfD(): void
    {
        [$opens, $closes] = DailyTwistProposals::window('2026-11-03');
        $this->assertSame('2026-11-02 02:00', $opens->format('Y-m-d H:i'));    // 09:00 Saigon
        $this->assertSame('2026-11-02 14:00', $closes->format('Y-m-d H:i'));   // 21:00 Saigon
        $this->assertFalse(DailyTwistProposals::isOpen('2026-11-03', self::utc('2026-11-02 01:59')));
        $this->assertTrue(DailyTwistProposals::isOpen('2026-11-03', self::utc('2026-11-02 02:00')));
        $this->assertTrue(DailyTwistProposals::isOpen('2026-11-03', self::utc('2026-11-02 13:59')));
        $this->assertFalse(DailyTwistProposals::isOpen('2026-11-03', self::utc('2026-11-02 14:00')));
    }

    public function testIneligibility(): void
    {
        $f = [DailyTwistProposals::class, 'ineligibility'];
        $this->assertNull($f('local', 'Ho Chi Minh City', 'Ho Chi Minh City', true, true));
        $this->assertNull($f('local', null, 'Ho Chi Minh City', true, true));              // no home city: local by mode
        $this->assertSame('no_city', $f('local', null, null, false, true));
        $this->assertSame('city_not_live', $f('local', 'Paris', 'Paris', false, true));
        $this->assertSame('not_local', $f('exploring', null, 'Ho Chi Minh City', true, true));
        $this->assertSame('not_local', $f('local', 'Paris', 'Ho Chi Minh City', true, true));
        $this->assertSame('no_challenge', $f('local', null, 'Ho Chi Minh City', true, false));
    }

    public function testCleanText(): void
    {
        $this->assertSame('Cơm tấm before 8am', DailyTwistProposals::cleanText("  Cơm tấm\n before   8am "));
        $this->assertNull(DailyTwistProposals::cleanText('   '));
        $this->assertNull(DailyTwistProposals::cleanText(null));
        $this->assertNull(DailyTwistProposals::cleanText(str_repeat('a', DailyAdminService::TWIST_MAX + 1)));
        $this->assertNotNull(DailyTwistProposals::cleanText(str_repeat('é', DailyAdminService::TWIST_MAX)));
    }

    public function testStatusOf(): void
    {
        $this->assertSame('picked', DailyTwistProposals::statusOf(['status' => 'selected', 'challenge_date' => '2000-01-01']));
        $this->assertSame('not_picked', DailyTwistProposals::statusOf(['status' => 'rejected', 'challenge_date' => '2999-01-01']));
        $this->assertSame('pending', DailyTwistProposals::statusOf(['status' => 'proposed', 'challenge_date' => '2999-01-01']));
        $this->assertSame('not_picked', DailyTwistProposals::statusOf(['status' => 'proposed', 'challenge_date' => '2000-01-01']));
    }
}
